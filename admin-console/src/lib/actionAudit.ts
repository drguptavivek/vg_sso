import "server-only";
import { NextResponse } from "next/server";
import { recordAdminAction } from "@/db/actionLog";
import { errorResponse } from "@/lib/http";
import { KeycloakAdminError } from "@/lib/keycloakAdmin";
import { HrmsError } from "@/lib/hrms/client";
import type { AuthorizedContext } from "@/lib/session";

export async function logAdminAction(ctx: AuthorizedContext, action: string, targetUserId: string | undefined, summary: Record<string, unknown> = {}) {
  await recordAdminAction({ actorUserId: ctx.userId, actorUsername: ctx.username, targetUserId, action, outcome: "success", summary });
}

function safeFailure(err: unknown): { status: number; reason: string } {
  if (err instanceof KeycloakAdminError) {
    const body = err.body;
    const reason = typeof body === "string"
      ? body
      : body && typeof body === "object"
        ? String((body as Record<string, unknown>).errorMessage ?? (body as Record<string, unknown>).error ?? err.message)
        : err.message;
    return { status: err.status, reason };
  }
  if (err instanceof HrmsError) return { status: err.status, reason: err.message };
  return { status: 500, reason: err instanceof Error ? err.message : "Unexpected server error" };
}

export async function auditedPolicyResponse(
  ctx: AuthorizedContext,
  action: string,
  status: number,
  reason: string,
  targetUserId?: string,
  summary: Record<string, unknown> = {},
) {
  try {
    await recordAdminAction({
      actorUserId: ctx.userId, actorUsername: ctx.username, targetUserId, action, outcome: "failure",
      summary: { ...summary, status, reason: reason.slice(0, 500) },
    });
  } catch (auditError) {
    console.error("Could not persist administrative policy failure audit", auditError);
  }
  return NextResponse.json({ error: reason }, { status });
}

export async function auditedErrorResponse(
  err: unknown,
  ctx: AuthorizedContext,
  action: string,
  targetUserId?: string,
  summary: Record<string, unknown> = {},
) {
  const failure = safeFailure(err);
  try {
    await recordAdminAction({
      actorUserId: ctx.userId,
      actorUsername: ctx.username,
      targetUserId,
      action,
      outcome: "failure",
      summary: { ...summary, status: failure.status, reason: failure.reason.slice(0, 500) },
    });
  } catch (auditError) {
    console.error("Could not persist administrative failure audit", auditError);
  }
  return errorResponse(err);
}
