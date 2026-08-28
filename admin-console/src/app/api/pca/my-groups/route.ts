import { NextResponse } from "next/server";
import { requireAnyRole } from "@/lib/session";
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
  const auth = await requireAnyRole([config.delegatedClientAdminRole, config.userManagerRole]);
  if (!auth.ok) return auth.response;

  try {
    const hasRealmWideAccess = auth.ctx.isRealmAdmin || auth.ctx.roles.includes(config.userManagerRole);
    const appRolesPath = "/" + config.appRolesGroupName;
    let realmGroups: GroupTreeNode[] = [];
    if (hasRealmWideAccess) {
      const { data: topLevelGroups } = await kcAdminRequest<KcGroup[]>(auth.ctx.accessToken, "/groups", {
        query: { briefRepresentation: "true", max: "1000" },
      });
      realmGroups = await Promise.all(
        (topLevelGroups ?? [])
          .filter((group) => group.path !== appRolesPath)
          .map((group) => fetchChildrenTree(auth.ctx.accessToken, group)),
      );
    }

    const ownedRootPaths = await getOwnedRootPaths(auth.ctx.accessToken, auth.ctx.userId, hasRealmWideAccess);
    if (ownedRootPaths.length === 0) {
      return NextResponse.json({ roots: [], realmGroups });
    }

    const { data: matches } = await kcAdminRequest<KcGroup[]>(auth.ctx.accessToken, "/groups", {
      query: { search: config.appRolesGroupName, briefRepresentation: "true", max: "500" },
    });
    const appRoles = (matches ?? []).find((group) => group.path === appRolesPath);
    if (!appRoles?.id) {
      return NextResponse.json({ roots: [], realmGroups });
    }

    const { data: appRoots } = await kcAdminRequest<KcGroup[]>(
      auth.ctx.accessToken,
      "/groups/" + appRoles.id + "/children",
      { query: { briefRepresentation: "true", max: "1000" } },
    );
    const rootGroups = (appRoots ?? []).filter((group) => ownedRootPaths.includes(group.path));
    const roots = await Promise.all(rootGroups.map((g) => fetchChildrenTree(auth.ctx.accessToken, g)));

    return NextResponse.json({ roots, realmGroups });
  } catch (err) {
    return errorResponse(err);
  }
}
