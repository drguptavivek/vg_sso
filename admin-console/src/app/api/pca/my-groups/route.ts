import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";
import { getOwnedRootPaths } from "@/lib/ownership";
import type { GroupTreeNode, KcGroup } from "@/types/keycloak";

async function fetchChildrenTree(accessToken: string, group: KcGroup): Promise<GroupTreeNode> {
  const { data: children } = await kcAdminRequest<KcGroup[]>(accessToken, `/groups/${group.id}/children`, {
    query: { briefRepresentation: "true", max: "1000" },
  });

  const childNodes = await Promise.all(
    (children ?? []).map((child) => fetchChildrenTree(accessToken, child)),
  );

  return { ...group, children: childNodes };
}

export async function GET() {
  const auth = await requireRole(config.delegatedClientAdminRole);
  if (!auth.ok) return auth.response;

  try {
    const ownedRootPaths = await getOwnedRootPaths(auth.ctx.accessToken, auth.ctx.userId);
    if (ownedRootPaths.length === 0) {
      return NextResponse.json({ roots: [] });
    }

    const { data: matches } = await kcAdminRequest<KcGroup[]>(auth.ctx.accessToken, "/groups", {
      query: { search: config.appRolesGroupName, briefRepresentation: "true", max: "500" },
    });

    const rootGroups = (matches ?? []).filter((g) => ownedRootPaths.includes(g.path));
    const roots = await Promise.all(rootGroups.map((g) => fetchChildrenTree(auth.ctx.accessToken, g)));

    return NextResponse.json({ roots });
  } catch (err) {
    return errorResponse(err);
  }
}
