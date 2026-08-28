import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";
import type { KcGroup } from "@/types/keycloak";

export async function GET(req: NextRequest) {
  const auth = await requireRole(config.userManagerRole);
  if (!auth.ok) return auth.response;

  const search = req.nextUrl.searchParams.get("search") ?? undefined;
  const rootPath = req.nextUrl.searchParams.get("rootPath")?.trim();

  try {
    if (rootPath) {
      const rootName = rootPath.split("/").filter(Boolean).pop() ?? rootPath;
      const { data: roots } = await kcAdminRequest<KcGroup[]>(auth.ctx.accessToken, "/groups", {
        query: { search: rootName, exact: true, briefRepresentation: "true", max: "50" },
      });
      const root = (roots ?? []).find((group) => group.path === rootPath);
      if (!root) return NextResponse.json({ groups: [] });
      const { data: children } = await kcAdminRequest<KcGroup[]>(
        auth.ctx.accessToken,
        `/groups/${root.id}/children`,
        { query: { first: 0, max: 200, briefRepresentation: "true" } },
      );
      return NextResponse.json({ groups: children ?? [] });
    }

    const { data } = await kcAdminRequest<KcGroup[]>(auth.ctx.accessToken, "/groups", {
      query: { search, briefRepresentation: "true", max: "50" },
    });
    return NextResponse.json({ groups: data ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
}
