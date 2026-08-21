import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";
import type { KcUser } from "@/types/keycloak";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const auth = await requireRole(config.userManagerRole);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const { data } = await kcAdminRequest<KcUser>(auth.ctx.accessToken, `/users/${id}`);
    const { data: groups } = await kcAdminRequest(auth.ctx.accessToken, `/users/${id}/groups`, {
      query: { briefRepresentation: "true" },
    });
    return NextResponse.json({ user: data, groups: groups ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Only a small, explicit set of fields may be changed from this dashboard. */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await requireRole(config.userManagerRole);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json()) as Partial<Pick<KcUser, "enabled" | "firstName" | "lastName" | "email">>;

  try {
    const { data: current } = await kcAdminRequest<KcUser>(auth.ctx.accessToken, `/users/${id}`);
    if (!current) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const merged: KcUser = {
      ...current,
      enabled: body.enabled ?? current.enabled,
      firstName: body.firstName ?? current.firstName,
      lastName: body.lastName ?? current.lastName,
      email: body.email ?? current.email,
    };

    await kcAdminRequest(auth.ctx.accessToken, `/users/${id}`, {
      method: "PUT",
      body: merged,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
