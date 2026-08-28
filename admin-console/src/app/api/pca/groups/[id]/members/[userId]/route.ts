import { NextRequest, NextResponse } from "next/server";
import { requireAnyRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";
import { getOwnedRootPaths, isWithinOwnedTree } from "@/lib/ownership";
import type { KcGroup } from "@/types/keycloak";
import { logAdminAction } from "@/lib/actionAudit";

interface RouteParams {
  params: Promise<{ id: string; userId: string }>;
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const auth = await requireAnyRole([config.delegatedClientAdminRole, config.userManagerRole]);
  if (!auth.ok) return auth.response;

  const { id, userId } = await params;

  try {
    const [current, ownedRootPaths] = await Promise.all([
      kcAdminRequest<KcGroup>(auth.ctx.accessToken, `/groups/${id}`),
      getOwnedRootPaths(
        auth.ctx.accessToken,
        auth.ctx.userId,
        auth.ctx.isRealmAdmin || auth.ctx.roles.includes(config.userManagerRole),
      ),
    ]);
    const group = current.data;
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
    if (
      !auth.ctx.isRealmAdmin &&
      !auth.ctx.roles.includes(config.userManagerRole) &&
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
    return errorResponse(err);
  }
}
