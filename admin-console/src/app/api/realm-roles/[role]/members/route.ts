import { NextRequest, NextResponse } from "next/server";
import { logAdminAction } from "@/lib/actionAudit";
import { config } from "@/lib/config";
import { errorResponse } from "@/lib/http";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { requireRealmAdmin } from "@/lib/session";
import type { KcRole } from "@/types/keycloak";

const ALLOWED_ROLES = new Set([config.clientManagerRole, config.userManagerRole, config.groupManagerRole]);

interface RouteParams {
  params: Promise<{ role: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireRealmAdmin(req);
  if (!auth.ok) return auth.response;
  const { role: encodedRole } = await params;
  const roleName = decodeURIComponent(encodedRole);
  if (!ALLOWED_ROLES.has(roleName)) {
    return NextResponse.json({ error: "This realm role is not managed by this workspace" }, { status: 403 });
  }
  const body = (await req.json()) as { userId?: string };
  if (!body.userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

  try {
    const { data: role } = await kcAdminRequest<KcRole>(auth.ctx.accessToken, `/roles/${encodeURIComponent(roleName)}`);
    if (!role) return NextResponse.json({ error: "Realm role not found" }, { status: 404 });
    await kcAdminRequest(auth.ctx.accessToken, `/users/${body.userId}/role-mappings/realm`, {
      method: "POST",
      body: [role],
    });
    await logAdminAction(auth.ctx, "realm-role.member.add", body.userId, { role: roleName });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
