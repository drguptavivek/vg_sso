import { NextRequest, NextResponse } from "next/server";
import { requireAnyRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";
import { getOwnedRootPaths, isOwnedDescendant, isWithinOwnedTree } from "@/lib/ownership";
import type { KcGroup } from "@/types/keycloak";
import { logAdminAction } from "@/lib/actionAudit";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * These routes are a curated UI only. The authoritative scoping check is
 * DelegatedAdminGuardFilter in custom-delegated-admin-guard-spi, which
 * rejects any mutation on a group outside the caller's own AppRoles/{clientId}
 * subtree regardless of what this app sends. The ownership check here exists
 * purely to return a clear, early error instead of a raw Keycloak 403.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAnyRole([config.delegatedClientAdminRole, config.groupManagerRole], req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json()) as { name?: string; parentId?: string; attributes?: Record<string, string[]> };
  const wantsRename = body.name !== undefined;
  const wantsMove = body.parentId !== undefined;
  const wantsAttributes = body.attributes !== undefined;
  if (!wantsRename && !wantsMove && !wantsAttributes) {
    return NextResponse.json({ error: "name, parentId, or attributes is required" }, { status: 400 });
  }
  if (wantsRename && (!body.name || !body.name.trim())) {
    return NextResponse.json({ error: "name must not be blank" }, { status: 400 });
  }

  try {
    const isGroupManager = auth.ctx.roles.includes(config.groupManagerRole);
    const [current, ownedRootPaths] = await Promise.all([
      kcAdminRequest<KcGroup>(auth.ctx.accessToken, `/groups/${id}`),
      getOwnedRootPaths(auth.ctx.accessToken, auth.ctx.userId, auth.ctx.isRealmAdmin || isGroupManager),
    ]);
    const currentGroup = current.data;
    if (!currentGroup) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
    const currentSegments = currentGroup.path.split("/").filter(Boolean);
    if (isGroupManager && currentSegments[0] === config.appRolesGroupName && currentSegments.length <= 2) {
      return NextResponse.json({ error: "AppRoles and application administrator roots are protected" }, { status: 403 });
    }
    if (!isGroupManager && !isOwnedDescendant(currentGroup.path, ownedRootPaths)) {
      return NextResponse.json({ error: "You may only manage groups inside your own AppRoles subtree" }, { status: 403 });
    }

    let destination: KcGroup | null | undefined;
    if (wantsMove) {
      if (!body.parentId || body.parentId === id) {
        return NextResponse.json({ error: "valid parentId is required" }, { status: 400 });
      }
      const destinationResponse = await kcAdminRequest<KcGroup>(auth.ctx.accessToken, `/groups/${body.parentId}`);
      destination = destinationResponse.data;
      if (!destination) return NextResponse.json({ error: "Destination group not found" }, { status: 404 });
      if (!isGroupManager && !isWithinOwnedTree(destination.path, ownedRootPaths)) {
        return NextResponse.json({ error: "You may only move groups inside your own AppRoles subtree" }, { status: 403 });
      }
    }

    if (wantsRename || wantsAttributes) {
      await kcAdminRequest(auth.ctx.accessToken, `/groups/${id}`, {
        method: "PUT",
        body: {
          ...currentGroup,
          name: wantsRename ? body.name!.trim() : currentGroup.name,
          attributes: wantsAttributes ? body.attributes : currentGroup.attributes,
        },
      });
    }

    if (wantsMove && destination) {
      await kcAdminRequest(auth.ctx.accessToken, `/groups/${destination.id}/children`, {
        method: "POST",
        body: { ...currentGroup, id },
      });
    }

    const action = wantsMove ? "group.move" : wantsAttributes ? "group.attributes.update" : "group.rename";
    await logAdminAction(auth.ctx, action, undefined, {
      groupId: id,
      oldPath: currentGroup.path,
      newName: wantsRename ? body.name!.trim() : undefined,
      newParentId: destination?.id,
      newParentPath: destination?.path,
      attributesChanged: wantsAttributes,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAnyRole([config.delegatedClientAdminRole, config.groupManagerRole], req);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const [current, ownedRootPaths] = await Promise.all([
      kcAdminRequest<KcGroup>(auth.ctx.accessToken, `/groups/${id}`),
      getOwnedRootPaths(auth.ctx.accessToken, auth.ctx.userId, auth.ctx.isRealmAdmin || auth.ctx.roles.includes(config.groupManagerRole)),
    ]);
    const currentGroup = current.data;
    if (!currentGroup) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
    const currentSegments = currentGroup.path.split("/").filter(Boolean);
    if (auth.ctx.roles.includes(config.groupManagerRole) && currentSegments[0] === config.appRolesGroupName && currentSegments.length <= 2) {
      return NextResponse.json({ error: "AppRoles and application administrator roots are protected" }, { status: 403 });
    }
    if (!auth.ctx.roles.includes(config.groupManagerRole) && !isOwnedDescendant(currentGroup.path, ownedRootPaths)) {
      return NextResponse.json({ error: "You may only delete groups inside your own AppRoles subtree" }, { status: 403 });
    }

    await kcAdminRequest(auth.ctx.accessToken, `/groups/${id}`, { method: "DELETE" });
    await logAdminAction(auth.ctx, "group.delete", undefined, { groupId: id, groupPath: currentGroup.path });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
