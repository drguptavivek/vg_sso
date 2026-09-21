import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config, keycloakRealmInternalUrl } from "@/lib/config";
import { kcAdminRequest, KeycloakAdminError } from "@/lib/keycloakAdmin";
import { auditedErrorResponse, logAdminAction } from "@/lib/actionAudit";
import type { KcUser } from "@/types/keycloak";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireRole(config.userManagerRole, req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const { data: user } = await kcAdminRequest<KcUser>(auth.ctx.accessToken, `/users/${id}`);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const response = await fetch(
      `${keycloakRealmInternalUrl()}/phone-otp-admin/users/${encodeURIComponent(id)}/test-sms`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.ctx.accessToken}` },
        cache: "no-store",
      },
    );
    const text = await response.text();
    let result: { ok?: boolean; message?: string; mobile?: string; error?: string } = {};
    if (text) {
      try { result = JSON.parse(text) as typeof result; } catch { result = {}; }
    }
    if (!response.ok) {
      throw new KeycloakAdminError(response.status, result.error ? { error: result.error } : text);
    }

    await logAdminAction(auth.ctx, "user.sms.test", id, {
      username: user.username,
      phoneNumber: user.attributes?.phone_number?.[0] ?? "",
    });
    return NextResponse.json({ ok: true, message: result.message, mobile: result.mobile });
  } catch (err) {
    return auditedErrorResponse(err, auth.ctx, "user.sms.test", id);
  }
}
