import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "./auth";

export interface AuthorizedContext {
  accessToken: string;
  userId: string;
  roles: string[];
}

export type RequireRoleResult =
  | { ok: true; ctx: AuthorizedContext }
  | { ok: false; response: NextResponse };

/**
 * Confirms the caller has a live Keycloak session with the given realm role.
 * This is a UX gate for this app's own routes only - the authoritative
 * authorization decision for every mutation still happens inside Keycloak
 * itself (FGAP v2 + the delegated-admin-guard SPI) when we call the Admin
 * REST API with the caller's own access token.
 */
export async function requireRole(role: string): Promise<RequireRoleResult> {
  const session = await getServerSession(authOptions);

  if (!session || !session.accessToken) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }

  if (session.error === "RefreshAccessTokenError") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Session expired, please sign in again" }, { status: 401 }),
    };
  }

  if (!session.roles?.includes(role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: `Missing required role: ${role}` }, { status: 403 }),
    };
  }

  return {
    ok: true,
    ctx: { accessToken: session.accessToken, userId: session.userId ?? "", roles: session.roles },
  };
}
