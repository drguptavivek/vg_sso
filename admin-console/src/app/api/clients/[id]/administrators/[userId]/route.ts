import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { requireAnyRole } from "@/lib/session";
import { auditedErrorResponse, logAdminAction } from "@/lib/actionAudit";
import { findClient, assignApplicationAdministrator, appRolesForClient, isProtectedClient } from "@/lib/clientManagementService";
import { kcAdminRequest } from "@/lib/keycloakAdmin";

interface RouteParams { params: Promise<{ id: string; userId: string }>; }

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAnyRole([config.clientManagerRole], req);
  if (!auth.ok) return auth.response;
  const { id, userId } = await params;
  try {
    const client = await findClient(auth.ctx.accessToken, id);
    if (!client || isProtectedClient(client)) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    await assignApplicationAdministrator(auth.ctx.accessToken, client.clientId, userId);
    await logAdminAction(auth.ctx, "CLIENT_ADMIN_ADDED", userId, { clientId: client.clientId, keycloakClientUuid: client.id });
    return NextResponse.json({ ok: true });
  } catch (error) { return auditedErrorResponse(error, auth.ctx, "CLIENT_ADMIN_ADDED", userId, { clientId: id }); }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAnyRole([config.clientManagerRole], req);
  if (!auth.ok) return auth.response;
  const { id, userId } = await params;
  try {
    const client = await findClient(auth.ctx.accessToken, id);
    if (!client || isProtectedClient(client)) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    if (userId === auth.ctx.userId) return NextResponse.json({ error: "You cannot remove your own application administrator access" }, { status: 403 });
    const roles = await appRolesForClient(auth.ctx.accessToken, client.clientId);
    if (!roles.root?.id) return NextResponse.json({ error: "AppRoles root is not available" }, { status: 409 });
    if (!roles.administrators.some((user) => user.id === userId)) return NextResponse.json({ error: "User is not an application administrator" }, { status: 404 });
    if (roles.administrators.length <= 1) return NextResponse.json({ error: "The last application administrator cannot be removed" }, { status: 409 });
    await kcAdminRequest(auth.ctx.accessToken, `/users/${encodeURIComponent(userId)}/groups/${roles.root.id}`, { method: "DELETE" });
    await logAdminAction(auth.ctx, "CLIENT_ADMIN_REMOVED", userId, { clientId: client.clientId, keycloakClientUuid: client.id });
    return NextResponse.json({ ok: true });
  } catch (error) { return auditedErrorResponse(error, auth.ctx, "CLIENT_ADMIN_REMOVED", userId, { clientId: id }); }
}