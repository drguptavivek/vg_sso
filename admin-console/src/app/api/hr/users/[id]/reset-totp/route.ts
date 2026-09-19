import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { auditedErrorResponse, logAdminAction } from "@/lib/actionAudit";
import { hasRealmAdminAccess } from "@/lib/adminAccess";
import type { KcUser } from "@/types/keycloak";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface KcCredential {
  id?: string;
  type?: string;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireRole(config.userManagerRole, req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { confirm?: boolean };
  if (body.confirm !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required" }, { status: 400 });
  }

  try {
    if (!auth.ctx.isRealmAdmin && await hasRealmAdminAccess(auth.ctx.accessToken, id)) {
      return NextResponse.json(
        { error: "Only a realm administrator may reset MFA for another realm administrator" },
        { status: 403 },
      );
    }

    const [{ data: user }, { data: credentials }] = await Promise.all([
      kcAdminRequest<KcUser>(auth.ctx.accessToken, `/users/${id}`),
      kcAdminRequest<KcCredential[]>(auth.ctx.accessToken, `/users/${id}/credentials`),
    ]);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const otpCredentials = (credentials ?? []).filter(
      (credential): credential is KcCredential & { id: string } =>
        credential.type === "otp" && typeof credential.id === "string" && credential.id.length > 0,
    );
    for (const credential of otpCredentials) {
      await kcAdminRequest(
        auth.ctx.accessToken,
        `/users/${id}/credentials/${encodeURIComponent(credential.id)}`,
        { method: "DELETE" },
      );
    }

    const requiredActions = Array.from(new Set([...(user.requiredActions ?? []), "CONFIGURE_TOTP"]));
    await kcAdminRequest(auth.ctx.accessToken, `/users/${id}`, {
      method: "PUT",
      body: { ...user, requiredActions },
    });
    await kcAdminRequest(auth.ctx.accessToken, `/users/${id}/logout`, { method: "POST" });

    await logAdminAction(auth.ctx, "user.totp.reset", id, {
      username: user.username,
      removedOtpCredentials: otpCredentials.length,
      requiredAction: "CONFIGURE_TOTP",
      sessionsRevoked: true,
      passwordChanged: false,
    });

    return NextResponse.json({
      ok: true,
      removedOtpCredentials: otpCredentials.length,
      requiredAction: "CONFIGURE_TOTP",
      sessionsRevoked: true,
      passwordChanged: false,
    });
  } catch (err) {
    return auditedErrorResponse(err, auth.ctx, "user.totp.reset", id);
  }
}
