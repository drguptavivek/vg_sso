import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { listAdminActions } from "@/db/actionLog";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import type { KcUser } from "@/types/keycloak";

function optionalDate(value: string | null, endOfDay = false): Date | undefined {
  if (value === null || value === "") return undefined;
  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  const date = new Date(`${value}T${time}+05:30`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(req: NextRequest) {
  const auth = await requireRole(config.userManagerRole);
  if (auth.ok === false) return auth.response;
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(10, Number(req.nextUrl.searchParams.get("pageSize") ?? "50") || 50));
  const outcomeValue = req.nextUrl.searchParams.get("outcome");
  const outcome = outcomeValue === "success" || outcomeValue === "failure" ? outcomeValue : undefined;
  const actions = await listAdminActions({
    page, pageSize,
    action: req.nextUrl.searchParams.get("action")?.trim() || undefined,
    outcome,
    from: optionalDate(req.nextUrl.searchParams.get("from")),
    to: optionalDate(req.nextUrl.searchParams.get("to"), true),
  });
  const userRequests = new Map<string, Promise<KcUser | null>>();
  const actionsWithRecipient = await Promise.all(actions.map(async (entry) => {
    if (entry.action !== "user.onboarding.resend" || !entry.targetUserId || Object.keys(entry.summary ?? {}).length > 0) return entry;
    if (!userRequests.has(entry.targetUserId)) {
      userRequests.set(entry.targetUserId, kcAdminRequest<KcUser>(auth.ctx.accessToken, `/users/${entry.targetUserId}`).then(({ data }) => data).catch(() => null));
    }
    const user = await userRequests.get(entry.targetUserId);
    if (!user) return entry;
    return { ...entry, summary: { username: user.username, email: user.email ?? "", phoneNumber: user.attributes?.phone_number?.[0] ?? "" } };
  }));
  return NextResponse.json({ actions: actionsWithRecipient, page, pageSize, hasMore: actions.length === pageSize });
}
