import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";

interface RouteParams {
  params: Promise<{ id: string; groupId: string }>;
}

export async function PUT(_req: NextRequest, { params }: RouteParams) {
  const auth = await requireRole(config.userManagerRole);
  if (!auth.ok) return auth.response;

  const { id, groupId } = await params;

  try {
    await kcAdminRequest(auth.ctx.accessToken, `/users/${id}/groups/${groupId}`, {
      method: "PUT",
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const auth = await requireRole(config.userManagerRole);
  if (!auth.ok) return auth.response;

  const { id, groupId } = await params;

  try {
    await kcAdminRequest(auth.ctx.accessToken, `/users/${id}/groups/${groupId}`, {
      method: "DELETE",
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
