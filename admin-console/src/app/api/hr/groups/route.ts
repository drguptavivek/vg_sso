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

  try {
    const { data } = await kcAdminRequest<KcGroup[]>(auth.ctx.accessToken, "/groups", {
      query: { search, briefRepresentation: "true", max: "50" },
    });
    return NextResponse.json({ groups: data ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
}
