import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";
import { logAdminAction } from "@/lib/actionAudit";

interface RouteParams {
  params: Promise<{ id: string; groupId: string }>;
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const auth = await requireRole(config.userManagerRole, req);
  if (!auth.ok) return auth.response;

  const { id, groupId } = await params;

  try {
    await kcAdminRequest(auth.ctx.accessToken, `/users/${id}/groups/${groupId}`, {
      method: "PUT",
    });
    await logAdminAction(auth.ctx, "user.group.add", id, { groupId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const auth = await requireRole(config.userManagerRole, req);
  if (!auth.ok) return auth.response;

  const { id, groupId } = await params;

  try {
    await kcAdminRequest(auth.ctx.accessToken, `/users/${id}/groups/${groupId}`, {
      method: "DELETE",
    });
    await logAdminAction(auth.ctx, "user.group.remove", id, { groupId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
