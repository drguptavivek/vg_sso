import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";
import type { KcUser } from "@/types/keycloak";

export async function GET(req: NextRequest) {
  const auth = await requireRole(config.delegatedClientAdminRole);
  if (!auth.ok) return auth.response;

  const rawSearch = req.nextUrl.searchParams.get("search")?.trim() ?? "";
  const searchTerm = rawSearch.replace(/\*/g, "");
  if (!searchTerm) {
    return NextResponse.json({ users: [] });
  }

  try {
    const [{ data: generalMatches }, { data: emailMatches }] = await Promise.all([
      kcAdminRequest<KcUser[]>(auth.ctx.accessToken, "/users", {
        query: { search: "*" + searchTerm + "*", briefRepresentation: "true", max: "20" },
      }),
      kcAdminRequest<KcUser[]>(auth.ctx.accessToken, "/users", {
        query: { email: searchTerm, exact: "false", briefRepresentation: "true", max: "20" },
      }),
    ]);
    const users = Array.from(
      new Map([...(generalMatches ?? []), ...(emailMatches ?? [])].map((user) => [user.id, user])).values(),
    ).slice(0, 20);
    return NextResponse.json({ users });
  } catch (err) {
    return errorResponse(err);
  }
}
