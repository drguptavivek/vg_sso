import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";
import { getOwnedRootPaths, isOwnedDescendant } from "@/lib/ownership";
import type { KcGroup } from "@/types/keycloak";

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
  const auth = await requireRole(config.delegatedClientAdminRole);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json()) as { name?: string };
  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const [current, ownedRootPaths] = await Promise.all([
      kcAdminRequest<KcGroup>(auth.ctx.accessToken, `/groups/${id}`),
      getOwnedRootPaths(auth.ctx.accessToken, auth.ctx.userId, auth.ctx.isRealmAdmin),
    ]);
    const currentGroup = current.data;
    if (!currentGroup) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
    if (!isOwnedDescendant(currentGroup.path, ownedRootPaths)) {
      return NextResponse.json({ error: "You may only rename groups inside your own AppRoles subtree" }, { status: 403 });
    }

    await kcAdminRequest(auth.ctx.accessToken, `/groups/${id}`, {
      method: "PUT",
      body: { ...currentGroup, name: body.name.trim() },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const auth = await requireRole(config.delegatedClientAdminRole);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const [current, ownedRootPaths] = await Promise.all([
      kcAdminRequest<KcGroup>(auth.ctx.accessToken, `/groups/${id}`),
      getOwnedRootPaths(auth.ctx.accessToken, auth.ctx.userId, auth.ctx.isRealmAdmin),
    ]);
    const currentGroup = current.data;
    if (!currentGroup) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
    if (!isOwnedDescendant(currentGroup.path, ownedRootPaths)) {
      return NextResponse.json({ error: "You may only delete groups inside your own AppRoles subtree" }, { status: 403 });
    }

    await kcAdminRequest(auth.ctx.accessToken, `/groups/${id}`, { method: "DELETE" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
