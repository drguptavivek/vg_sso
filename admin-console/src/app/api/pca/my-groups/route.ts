import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";
import { getOwnedRootPaths } from "@/lib/ownership";
import type { GroupTreeNode, KcGroup, KcUser } from "@/types/keycloak";

async function fetchChildrenTree(accessToken: string, group: KcGroup): Promise<GroupTreeNode> {
  const [{ data: children }, { data: members }] = await Promise.all([
    kcAdminRequest<KcGroup[]>(accessToken, "/groups/" + group.id + "/children", {
      query: { briefRepresentation: "true", max: "1000" },
    }),
    kcAdminRequest<KcUser[]>(accessToken, "/groups/" + group.id + "/members", {
      query: { briefRepresentation: "true", max: "1000" },
    }),
  ]);

  const childNodes = await Promise.all(
    (children ?? []).map((child) => fetchChildrenTree(accessToken, child)),
  );

  return { ...group, children: childNodes, memberCount: (members ?? []).length };
}

export async function GET() {
  const auth = await requireRole(config.delegatedClientAdminRole);
  if (!auth.ok) return auth.response;

  try {
    const ownedRootPaths = await getOwnedRootPaths(auth.ctx.accessToken, auth.ctx.userId, auth.ctx.isRealmAdmin);
    if (ownedRootPaths.length === 0) {
      return NextResponse.json({ roots: [] });
    }

    const appRolesPath = "/" + config.appRolesGroupName;
    const { data: matches } = await kcAdminRequest<KcGroup[]>(auth.ctx.accessToken, "/groups", {
      query: { search: config.appRolesGroupName, briefRepresentation: "true", max: "500" },
    });
    const appRoles = (matches ?? []).find((group) => group.path === appRolesPath);
    if (!appRoles?.id) {
      return NextResponse.json({ roots: [] });
    }

    const { data: appRoots } = await kcAdminRequest<KcGroup[]>(
      auth.ctx.accessToken,
      "/groups/" + appRoles.id + "/children",
      { query: { briefRepresentation: "true", max: "1000" } },
    );
    const rootGroups = (appRoots ?? []).filter((group) => ownedRootPaths.includes(group.path));
    const roots = await Promise.all(rootGroups.map((g) => fetchChildrenTree(auth.ctx.accessToken, g)));

    let realmGroups: GroupTreeNode[] = [];
    if (auth.ctx.isRealmAdmin) {
      const { data: topLevelGroups } = await kcAdminRequest<KcGroup[]>(auth.ctx.accessToken, "/groups", {
        query: { briefRepresentation: "true", max: "1000" },
      });
      realmGroups = (topLevelGroups ?? [])
        .filter((group) => group.path !== appRolesPath)
        .map((group) => ({ ...group, children: [] }));
    }

    return NextResponse.json({ roots, realmGroups });
  } catch (err) {
    return errorResponse(err);
  }
}
