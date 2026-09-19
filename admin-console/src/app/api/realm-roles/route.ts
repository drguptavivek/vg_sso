import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { errorResponse } from "@/lib/http";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { requireRealmAdmin } from "@/lib/session";
import type { KcRole, KcUser } from "@/types/keycloak";

export const MANAGED_REALM_ROLES = [
  config.clientManagerRole,
  config.userManagerRole,
  config.groupManagerRole,
] as const;

export async function GET(req: NextRequest) {
  const auth = await requireRealmAdmin();
  if (!auth.ok) return auth.response;

  try {
    const search = req.nextUrl.searchParams.get("search")?.trim() ?? "";
    const roles = await Promise.all(MANAGED_REALM_ROLES.map(async (roleName) => {
      const [{ data: role }, { data: members }] = await Promise.all([
        kcAdminRequest<KcRole>(auth.ctx.accessToken, `/roles/${encodeURIComponent(roleName)}`),
        kcAdminRequest<KcUser[]>(auth.ctx.accessToken, `/roles/${encodeURIComponent(roleName)}/users`, {
          query: { first: 0, max: 1000 },
        }),
      ]);
      return { role, members: members ?? [] };
    }));

    let users: KcUser[] = [];
    if (search) {
      const response = await kcAdminRequest<KcUser[]>(auth.ctx.accessToken, "/users", {
        query: { search, first: 0, max: 20, briefRepresentation: true },
      });
      users = response.data ?? [];
    }
    return NextResponse.json({ roles, users });
  } catch (error) {
    return errorResponse(error);
  }
}
