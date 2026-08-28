import "server-only";
import { eq, sql } from "drizzle-orm";
import { adminDatabase } from "@/db/client";
import { userExtensions } from "@/db/schema";
import { adminApiBaseUrl, config, keycloakRealmInternalUrl } from "@/lib/config";
import { normalizeEmail, normalizeEmployeeId, normalizePhone } from "@/lib/selfRegistration";
import type { KeycloakProfileDraft } from "@/types/hrms";
import type { KcUser } from "@/types/keycloak";

interface ServiceToken {
  value: string;
  expiresAt: number;
}

interface AdminResponse<T> {
  data: T | null;
  location: string | null;
}

export type RegistrationConflict = "email" | "phone" | "employee";

export class RegistrationKeycloakError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const tokenCache = globalThis as typeof globalThis & {
  registrationServiceToken?: ServiceToken;
};

function serviceClientConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env.SELF_REGISTRATION_KEYCLOAK_CLIENT_ID?.trim();
  const clientSecret = process.env.SELF_REGISTRATION_KEYCLOAK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Self-registration Keycloak service client is not configured");
  }
  return { clientId, clientSecret };
}

async function serviceAccessToken(): Promise<string> {
  const cached = tokenCache.registrationServiceToken;
  if (cached && cached.expiresAt > Date.now() + 10_000) return cached.value;

  const client = serviceClientConfig();
  const response = await fetch(`${keycloakRealmInternalUrl()}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new RegistrationKeycloakError(response.status, "Registration service authentication failed");
  }
  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw new RegistrationKeycloakError(502, "Registration service returned no access token");
  }
  tokenCache.registrationServiceToken = {
    value: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in ?? 60) * 1000,
  };
  return payload.access_token;
}

async function serviceAdminRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "DELETE";
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
  } = {},
): Promise<AdminResponse<T>> {
  const url = new URL(`${adminApiBaseUrl()}${path}`);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(name, String(value));
  }
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${await serviceAccessToken()}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });
  const text = await response.text();
  let data: T | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    throw new RegistrationKeycloakError(
      response.status,
      response.status === 409 ? "Account data already exists" : "Keycloak registration request failed",
    );
  }
  return { data, location: response.headers.get("location") };
}

async function searchUsers(query: Record<string, string | boolean>): Promise<KcUser[]> {
  const response = await serviceAdminRequest<KcUser[]>("/users", {
    query: { ...query, first: 0, max: 20, briefRepresentation: false },
  });
  return response.data ?? [];
}

function phoneSearchValues(phone: string): string[] {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];
  const values = new Set([phone, normalized]);
  if (normalized.length === 10) {
    values.add(`+91${normalized}`);
    values.add(`91${normalized}`);
  }
  return [...values];
}

export async function findRegistrationConflict(options: {
  email: string;
  phone: string;
  employeeId: string;
}): Promise<RegistrationConflict | null> {
  const email = normalizeEmail(options.email);
  const emailMatches = await searchUsers({ email, exact: true });
  if (emailMatches.some((user) => normalizeEmail(user.email ?? null) === email)) return "email";

  const phone = normalizePhone(options.phone);
  for (const candidate of phoneSearchValues(options.phone)) {
    const users = await searchUsers({ q: `phone_number:${candidate}`, exact: true });
    if (users.some((user) => normalizePhone(user.attributes?.phone_number?.[0] ?? null) === phone)) {
      return "phone";
    }
  }

  const employeeId = normalizeEmployeeId(options.employeeId);
  const users = await searchUsers({ q: `employee_id:${employeeId}`, exact: true });
  if (users.some((user) => normalizeEmployeeId(user.attributes?.employee_id?.[0] ?? "") === employeeId)) {
    return "employee";
  }
  const extension = await adminDatabase().query.userExtensions.findFirst({
    where: sql`upper(trim(${userExtensions.hrmsEmployeeId})) = ${employeeId}`,
    columns: { keycloakUserId: true },
  });
  return extension ? "employee" : null;
}

async function usernameAvailable(username: string): Promise<boolean> {
  const users = await searchUsers({ username, exact: true });
  return !users.some((user) => user.username.toLocaleLowerCase() === username.toLocaleLowerCase());
}

export async function chooseRegistrationUsername(draft: KeycloakProfileDraft, employeeId: string): Promise<string> {
  const cleanEmployeeId = normalizeEmployeeId(employeeId).toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, ".");
  const base = (draft.username || cleanEmployeeId).toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, ".")
    .replace(/^\.+|\.+$/g, "") || `user.${cleanEmployeeId}`;
  if (await usernameAvailable(base)) return base;
  const withEmployeeId = `${base}.${cleanEmployeeId}`.slice(0, 255);
  if (await usernameAvailable(withEmployeeId)) return withEmployeeId;
  return `${withEmployeeId.slice(0, 246)}.${crypto.randomUUID().slice(0, 8)}`;
}

export async function createRegisteredUser(options: {
  draft: KeycloakProfileDraft;
  username: string;
}): Promise<string> {
  const attributes = Object.fromEntries(
    Object.entries(options.draft.attributes)
      .map(([name, values]) => [name, values.map((value) => value.trim()).filter(Boolean)])
      .filter(([, values]) => values.length > 0),
  ) as Record<string, string[]>;
  attributes.phone_verified = ["false"];

  const response = await serviceAdminRequest("/users", {
    method: "POST",
    body: {
      username: options.username,
      email: options.draft.email,
      firstName: options.draft.firstName,
      lastName: options.draft.lastName,
      enabled: true,
      emailVerified: false,
      requiredActions: config.onboardingActions,
      attributes,
    },
  });
  const userId = response.location?.split("/").filter(Boolean).at(-1);
  if (!userId) throw new RegistrationKeycloakError(502, "Created account ID was not returned");
  return userId;
}

export async function deleteRegisteredUser(userId: string): Promise<void> {
  await serviceAdminRequest(`/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
}
