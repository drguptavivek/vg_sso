import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";
import { getOwnedRootPaths, isWithinOwnedTree } from "@/lib/ownership";
import type { KcGroup, KcUser } from "@/types/keycloak";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function assertOwnedGroup(
  accessToken: string,
  userId: string,
  groupId: string,
  isRealmAdmin: boolean,
) {
  const [current, ownedRootPaths] = await Promise.all([
    kcAdminRequest<KcGroup>(accessToken, `/groups/${groupId}`),
    getOwnedRootPaths(accessToken, userId, isRealmAdmin),
  ]);
  const group = current.data;
  if (!group) {
    return { ok: false as const, response: NextResponse.json({ error: "Group not found" }, { status: 404 }) };
  }
  if (!isWithinOwnedTree(group.path, ownedRootPaths)) {
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
  const auth = await requireRole(config.delegatedClientAdminRole);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const owned = await assertOwnedGroup(
      auth.ctx.accessToken,
      auth.ctx.userId,
      id,
      auth.ctx.isRealmAdmin,
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
  const auth = await requireRole(config.delegatedClientAdminRole);
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
    );
    if (!owned.ok) return owned.response;

    await kcAdminRequest(auth.ctx.accessToken, `/users/${body.userId}/groups/${id}`, {
      method: "PUT",
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
