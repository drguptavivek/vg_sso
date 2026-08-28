import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";
import { logAdminAction } from "@/lib/actionAudit";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireRole(config.userManagerRole);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { actions?: string[] };
  const actions = body.actions && body.actions.length ? body.actions : config.onboardingActions;

  try {
    await kcAdminRequest(auth.ctx.accessToken, `/users/${id}/execute-actions-email`, {
      method: "PUT",
      query: { lifespan: config.onboardingLifespanSeconds },
      body: actions,
    });
    await logAdminAction(auth.ctx, "user.onboarding.resend", id, { actions });
    return NextResponse.json({ ok: true, actions });
  } catch (err) {
    return errorResponse(err);
  }
}
