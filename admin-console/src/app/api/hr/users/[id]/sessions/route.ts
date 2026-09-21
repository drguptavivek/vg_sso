import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { auditedErrorResponse, logAdminAction } from "@/lib/actionAudit";
import type { KcUserSession } from "@/types/keycloak";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = await requireRole(config.userManagerRole, req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const { data } = await kcAdminRequest<KcUserSession[]>(auth.ctx.accessToken, `/users/${id}/sessions`);
    return NextResponse.json({ sessions: data ?? [] });
  } catch (err) {
    return auditedErrorResponse(err, auth.ctx, "user.sessions.view", id);
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const auth = await requireRole(config.userManagerRole, req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const { data: sessions } = await kcAdminRequest<KcUserSession[]>(
      auth.ctx.accessToken,
      `/users/${id}/sessions`,
    );
    await kcAdminRequest(auth.ctx.accessToken, `/users/${id}/logout`, { method: "POST" });
    await logAdminAction(auth.ctx, "user.sessions.revoke-all", id, {
      revokedSessions: sessions?.length ?? 0,
    });
    return NextResponse.json({ ok: true, revokedSessions: sessions?.length ?? 0 });
  } catch (err) {
    return auditedErrorResponse(err, auth.ctx, "user.sessions.revoke-all", id);
  }
}
