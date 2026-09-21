import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { auditedErrorResponse, logAdminAction } from "@/lib/actionAudit";
import type { KcUserSession } from "@/types/keycloak";

interface RouteParams {
  params: Promise<{ id: string; sessionId: string }>;
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const auth = await requireRole(config.userManagerRole, req);
  if (!auth.ok) return auth.response;
  const { id, sessionId } = await params;
  try {
    const { data: sessions } = await kcAdminRequest<KcUserSession[]>(
      auth.ctx.accessToken,
      `/users/${id}/sessions`,
    );
    const target = sessions?.find((session) => session.id === sessionId);
    if (!target) {
      return NextResponse.json({ error: "Active session not found for this user" }, { status: 404 });
    }
    await kcAdminRequest(auth.ctx.accessToken, `/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
    await logAdminAction(auth.ctx, "user.session.revoke", id, {
      sessionId,
      ipAddress: target.ipAddress ?? "",
      clients: target.clients ?? {},
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return auditedErrorResponse(err, auth.ctx, "user.session.revoke", id);
  }
}
