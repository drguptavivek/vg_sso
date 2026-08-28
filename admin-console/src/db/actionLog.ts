import "server-only";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { adminDatabase } from "./client";
import { adminActionLogs } from "./schema";

export interface RecordAdminAction {
  actorUserId: string;
  actorUsername?: string;
  targetUserId?: string;
  action: string;
  outcome: "success" | "failure";
  summary?: Record<string, unknown>;
}

export async function recordAdminAction(entry: RecordAdminAction) {
  await adminDatabase().insert(adminActionLogs).values({
    ...entry,
    actorUsername: entry.actorUsername ?? null,
    targetUserId: entry.targetUserId ?? null,
    summary: entry.summary ?? {},
  });
}

export async function listAdminActions(options: {
  page: number;
  pageSize: number;
  action?: string;
  outcome?: "success" | "failure";
  from?: Date;
  to?: Date;
}) {
  const conditions = [
    options.action ? eq(adminActionLogs.action, options.action) : undefined,
    options.outcome ? eq(adminActionLogs.outcome, options.outcome) : undefined,
    options.from ? gte(adminActionLogs.occurredAt, options.from) : undefined,
    options.to ? lte(adminActionLogs.occurredAt, options.to) : undefined,
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));
  return adminDatabase().query.adminActionLogs.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(adminActionLogs.occurredAt)],
    limit: options.pageSize,
    offset: (options.page - 1) * options.pageSize,
  });
}
