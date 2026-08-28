import "server-only";
import { recordAdminAction } from "@/db/actionLog";
import type { AuthorizedContext } from "@/lib/session";

export async function logAdminAction(ctx: AuthorizedContext, action: string, targetUserId: string | undefined, summary: Record<string, unknown> = {}) {
  await recordAdminAction({ actorUserId: ctx.userId, actorUsername: ctx.username, targetUserId, action, outcome: "success", summary });
}
