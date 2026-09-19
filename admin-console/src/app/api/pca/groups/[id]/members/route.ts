import { NextRequest, NextResponse } from "next/server";
import { requireAnyRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";
import { getOwnedRootPaths, isWithinOwnedTree } from "@/lib/ownership";
import type { KcGroup, KcUser } from "@/types/keycloak";
import { auditedErrorResponse, logAdminAction } from "@/lib/actionAudit";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function assertOwnedGroup(
  accessToken: string,
  userId: string,
  groupId: string,
  isRealmAdmin: boolean,
  hasRealmWideAccess: boolean,
  canViewAllAppRoots: boolean,
  isMutation = false,
) {
  const [current, ownedRootPaths] = await Promise.all([
    kcAdminRequest<KcGroup>(accessToken, `/groups/${groupId}`),
    getOwnedRootPaths(accessToken, userId, isRealmAdmin || hasRealmWideAccess || canViewAllAppRoots),
  ]);
  const group = current.data;
  if (!group) {
    return { ok: false as const, response: NextResponse.json({ error: "Group not found" }, { status: 404 }) };
  }
  const segments = group.path.split("/").filter(Boolean);
  const isAppRolesRoot = segments[0] === config.appRolesGroupName && segments.length === 1;
  const isApplicationRoot = segments[0] === config.appRolesGroupName && segments.length === 2;
  if (isMutation && !isRealmAdmin && canViewAllAppRoots && !hasRealmWideAccess && !isApplicationRoot) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Client managers may only manage direct application administrator membership" },
        { status: 403 },
      ),
    };
  }
  if (isMutation && !isRealmAdmin && (isAppRolesRoot || (isApplicationRoot && !canViewAllAppRoots))) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Direct membership of AppRoles administrator groups is protected" },
        { status: 403 },
      ),
    };
  }
  if (!isRealmAdmin && !hasRealmWideAccess && !isWithinOwnedTree(group.path, ownedRootPaths)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "You may only manage membership inside your own AppRoles subtree" },
        { status: 403 },
      ),
    };
  }
  return { ok: true as const, group };
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const auth = await requireAnyRole([config.delegatedClientAdminRole, config.userManagerRole, config.clientManagerRole, config.groupManagerRole]);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const owned = await assertOwnedGroup(
      auth.ctx.accessToken,
      auth.ctx.userId,
      id,
      auth.ctx.isRealmAdmin,
      auth.ctx.roles.includes(config.userManagerRole) || auth.ctx.roles.includes(config.groupManagerRole),
      auth.ctx.roles.includes(config.clientManagerRole),
    );
    if (!owned.ok) return owned.response;

    const { data } = await kcAdminRequest<KcUser[]>(auth.ctx.accessToken, `/groups/${id}/members`, {
      query: { briefRepresentation: "true", max: "500" },
    });
    return NextResponse.json({ members: data ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAnyRole([config.delegatedClientAdminRole, config.userManagerRole, config.clientManagerRole, config.groupManagerRole], req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json()) as { userId?: string };
  if (!body.userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  try {
    const owned = await assertOwnedGroup(
      auth.ctx.accessToken,
      auth.ctx.userId,
      id,
      auth.ctx.isRealmAdmin,
      auth.ctx.roles.includes(config.userManagerRole) || auth.ctx.roles.includes(config.groupManagerRole),
      auth.ctx.roles.includes(config.clientManagerRole),
      true,
    );
    if (!owned.ok) return owned.response;

    await kcAdminRequest(auth.ctx.accessToken, `/users/${body.userId}/groups/${id}`, {
      method: "PUT",
    });
    await logAdminAction(auth.ctx, "user.group.add", body.userId, { groupId: id, groupPath: owned.group.path });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return auditedErrorResponse(err, auth.ctx, "user.group.add", body.userId, { groupId: id });
  }
}
