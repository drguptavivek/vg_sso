import { adminApiBaseUrl } from "./config";

export class KeycloakAdminError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Keycloak Admin API request failed with status ${status}`);
    this.status = status;
    this.body = body;
  }
}

export interface KcRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildUrl(path: string, query?: KcRequestOptions["query"]): string {
  const url = new URL(`${adminApiBaseUrl()}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

/**
 * Calls the Keycloak Admin REST API on behalf of the signed-in user, using
 * their own access token. Authorization is enforced entirely by Keycloak
 * (FGAP v2 permissions + the delegated-admin-guard SPI already deployed in
 * the realm) - this app does not duplicate that logic, it only presents a
 * curated UI over the same permission model.
 */
export async function kcAdminRequest<T = unknown>(
  accessToken: string,
  path: string,
  options: KcRequestOptions = {},
): Promise<{ status: number; data: T | null; location: string | null }> {
  const res = await fetch(buildUrl(path, options.query), {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const location = res.headers.get("location");
  let data: T | null = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    throw new KeycloakAdminError(res.status, data ?? text);
  }

  return { status: res.status, data, location };
}
