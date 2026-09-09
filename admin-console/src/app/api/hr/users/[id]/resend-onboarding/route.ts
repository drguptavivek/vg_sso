import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";
import { logAdminAction } from "@/lib/actionAudit";
import type { KcUser } from "@/types/keycloak";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireRole(config.userManagerRole, req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { actions?: string[] };
  const actions = body.actions && body.actions.length ? body.actions : config.onboardingActions;

  try {
    const { data: user } = await kcAdminRequest<KcUser>(auth.ctx.accessToken, `/users/${id}`);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    await kcAdminRequest(auth.ctx.accessToken, `/users/${id}/execute-actions-email`, {
      method: "PUT",
      query: { lifespan: config.onboardingLifespanSeconds },
      body: actions,
    });
    await logAdminAction(auth.ctx, "user.onboarding.resend", id, { actions, username: user.username, email: user.email ?? "", phoneNumber: user.attributes?.phone_number?.[0] ?? "" });
    return NextResponse.json({ ok: true, actions });
  } catch (err) {
    return errorResponse(err);
  }
}
