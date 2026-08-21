/**
 * Minimal JWT payload decoder. We only ever decode tokens issued to us
 * directly by Keycloak over a trusted server-to-server token exchange, so
 * signature verification is not required here.
 */
export function decodeJwtPayload<T = Record<string, unknown>>(token: string): T | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export interface KeycloakAccessTokenPayload {
  sub: string;
  preferred_username?: string;
  email?: string;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
  exp?: number;
}

export function realmRolesFromAccessToken(accessToken: string): string[] {
  const payload = decodeJwtPayload<KeycloakAccessTokenPayload>(accessToken);
  return payload?.realm_access?.roles ?? [];
}

export function isRealmAdminFromAccessToken(accessToken: string): boolean {
  const payload = decodeJwtPayload<KeycloakAccessTokenPayload>(accessToken);
  return payload?.resource_access?.["realm-management"]?.roles?.includes("realm-admin") ?? false;
}
