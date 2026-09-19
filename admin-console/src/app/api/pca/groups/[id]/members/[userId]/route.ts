import { NextRequest, NextResponse } from "next/server";
import { requireAnyRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { getOwnedRootPaths, isWithinOwnedTree } from "@/lib/ownership";
import type { KcGroup } from "@/types/keycloak";
import { auditedErrorResponse, logAdminAction } from "@/lib/actionAudit";

interface RouteParams {
  params: Promise<{ id: string; userId: string }>;
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAnyRole([config.delegatedClientAdminRole, config.userManagerRole, config.clientManagerRole, config.groupManagerRole], req);
  if (!auth.ok) return auth.response;

  const { id, userId } = await params;

  try {
    const [current, ownedRootPaths] = await Promise.all([
      kcAdminRequest<KcGroup>(auth.ctx.accessToken, `/groups/${id}`),
      getOwnedRootPaths(
        auth.ctx.accessToken,
        auth.ctx.userId,
        auth.ctx.isRealmAdmin || auth.ctx.roles.includes(config.userManagerRole) || auth.ctx.roles.includes(config.groupManagerRole) || auth.ctx.roles.includes(config.clientManagerRole),
      ),
    ]);
    const group = current.data;
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
    const segments = group.path.split("/").filter(Boolean);
    const isAppRolesRoot = segments[0] === config.appRolesGroupName && segments.length === 1;
    const isApplicationRoot = segments[0] === config.appRolesGroupName && segments.length === 2;
    const hasRealmWideMembership = auth.ctx.roles.includes(config.userManagerRole) || auth.ctx.roles.includes(config.groupManagerRole);
    if (!auth.ctx.isRealmAdmin && auth.ctx.roles.includes(config.clientManagerRole) && !hasRealmWideMembership && !isApplicationRoot) {
      return NextResponse.json(
        { error: "Client managers may only manage direct application administrator membership" },
        { status: 403 },
      );
    }
    if (!auth.ctx.isRealmAdmin && (isAppRolesRoot || (isApplicationRoot && !auth.ctx.roles.includes(config.clientManagerRole)))) {
      return NextResponse.json(
        { error: "Direct membership of AppRoles administrator groups is protected" },
        { status: 403 },
      );
    }
    if (
      !auth.ctx.isRealmAdmin &&
      !auth.ctx.roles.includes(config.userManagerRole) &&
      !auth.ctx.roles.includes(config.groupManagerRole) &&
      !isWithinOwnedTree(group.path, ownedRootPaths)
    ) {
      return NextResponse.json(
        { error: "You may only manage membership inside your own AppRoles subtree" },
        { status: 403 },
      );
    }

    await kcAdminRequest(auth.ctx.accessToken, `/users/${userId}/groups/${id}`, {
      method: "DELETE",
    });
    await logAdminAction(auth.ctx, "user.group.remove", userId, { groupId: id, groupPath: group.path });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return auditedErrorResponse(err, auth.ctx, "user.group.remove", userId, { groupId: id });
  }
}
