import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { errorResponse } from "@/lib/http";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { requireAnyRole } from "@/lib/session";
import type { KcClient, KcGroup, KcUser } from "@/types/keycloak";

interface ClientAuditRow extends KcClient {
  appRolesGroup: KcGroup | null;
  administrators: KcUser[];
  roleGroups: KcGroup[];
  roleGroupCount: number;
}

const EXCLUDED_CLIENTS = new Set([
  "account",
  "account-console",
  "admin-cli",
  "admin-permissions",
  "broker",
  "realm-management",
  "security-admin-console",
  "sso-self-registration",
]);

export async function GET() {
  const auth = await requireAnyRole([config.clientManagerRole, config.userManagerRole]);
  if (!auth.ok) return auth.response;

  try {
    const [{ data: clients }, { data: groups }] = await Promise.all([
      kcAdminRequest<KcClient[]>(auth.ctx.accessToken, "/clients", {
        query: { first: 0, max: 1000, viewableOnly: true },
      }),
      kcAdminRequest<KcGroup[]>(auth.ctx.accessToken, "/groups", {
        query: { search: config.appRolesGroupName, exact: true, max: 20, briefRepresentation: false },
      }),
    ]);

    const appRoles = (groups ?? []).find((group) => group.path === `/${config.appRolesGroupName}`);
    let appRoots: KcGroup[] = [];
    if (appRoles?.id) {
      const response = await kcAdminRequest<KcGroup[]>(
        auth.ctx.accessToken,
        `/groups/${appRoles.id}/children`,
        { query: { first: 0, max: 1000, briefRepresentation: false } },
      );
      appRoots = response.data ?? [];
    }
    const rootsByName = new Map(appRoots.map((group) => [group.name, group]));

    const rows: ClientAuditRow[] = await Promise.all(
      (clients ?? [])
        .filter((client) => !EXCLUDED_CLIENTS.has(client.clientId))
        .sort((a, b) => a.clientId.localeCompare(b.clientId))
        .map(async (client) => {
          const appRolesGroup = rootsByName.get(client.clientId) ?? null;
          if (!appRolesGroup?.id) {
            return { ...client, appRolesGroup: null, administrators: [], roleGroups: [], roleGroupCount: 0 };
          }
          const [{ data: administrators }, { data: roleGroups }] = await Promise.all([
            kcAdminRequest<KcUser[]>(auth.ctx.accessToken, `/groups/${appRolesGroup.id}/members`, {
              query: { first: 0, max: 1000, briefRepresentation: true },
            }),
            kcAdminRequest<KcGroup[]>(auth.ctx.accessToken, `/groups/${appRolesGroup.id}/children`, {
              query: { first: 0, max: 1000, briefRepresentation: true },
            }),
          ]);
          return {
            ...client,
            appRolesGroup,
            administrators: administrators ?? [],
            roleGroups: roleGroups ?? [],
            roleGroupCount: (roleGroups ?? []).length,
          };
        }),
    );

    return NextResponse.json({ clients: rows });
  } catch (error) {
    return errorResponse(error);
  }
}
