import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";
import type { KcUser } from "@/types/keycloak";

export async function GET(req: NextRequest) {
  const auth = await requireRole(config.delegatedClientAdminRole);
  if (!auth.ok) return auth.response;

  const search = req.nextUrl.searchParams.get("search") ?? "";
  if (!search.trim()) {
    return NextResponse.json({ users: [] });
  }

  try {
    const { data } = await kcAdminRequest<KcUser[]>(auth.ctx.accessToken, "/users", {
      query: { search, briefRepresentation: "true", max: "20" },
    });
    return NextResponse.json({ users: data ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
}
