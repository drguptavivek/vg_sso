import { kcAdminRequest } from "./keycloakAdmin";
import type { KcGroup, KcUser } from "@/types/keycloak";

interface KcRole {
  name: string;
}

interface KcClientRoleMapping {
  client?: string;
  mappings?: KcRole[];
}

interface KcRoleMappings {
  realmMappings?: KcRole[];
  clientMappings?: Record<string, KcClientRoleMapping>;
}

const accessCache = new Map<string, { expires: number; values: string[] }>();
const mfaCache = new Map<string, { expires: number; types: string[] }>();
const CACHE_MS = 30_000;

interface KcCredential {
  type?: string;
}

const MFA_CREDENTIAL_TYPES = new Set([
  "otp",
  "webauthn",
  "webauthn-passwordless",
  "recovery-authn-codes",
]);

export async function mfaCredentialTypesForUser(accessToken: string, userId: string): Promise<string[]> {
  const cached = mfaCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.types;
  const { data } = await kcAdminRequest<KcCredential[]>(accessToken, `/users/${userId}/credentials`);
  const types = Array.from(new Set(
    (data ?? []).map((credential) => credential.type ?? "").filter((type) => MFA_CREDENTIAL_TYPES.has(type)),
  ));
  mfaCache.set(userId, { expires: Date.now() + CACHE_MS, types });
  return types;
}

export async function adminAccessForUser(accessToken: string, userId: string): Promise<string[]> {
  const cached = accessCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.values;

  const [{ data: mappings }, { data: groups }] = await Promise.all([
    kcAdminRequest<KcRoleMappings>(accessToken, `/users/${userId}/role-mappings`),
    kcAdminRequest<KcGroup[]>(accessToken, `/users/${userId}/groups`, {
      query: { first: 0, max: 1000, briefRepresentation: true },
    }),
  ]);
  const values: string[] = [];
  const realmRoles = new Set((mappings?.realmMappings ?? []).map((role) => role.name));
  if (realmRoles.has("client-manager")) values.push("client-manager");
  if (realmRoles.has("user-manager")) values.push("user-manager");

  const realmManagement = Object.values(mappings?.clientMappings ?? {})
    .find((mapping) => mapping.client === "realm-management");
  if (realmManagement?.mappings?.some((role) => role.name === "realm-admin")) {
    values.push("realm-admin");
  }

  for (const group of groups ?? []) {
    const match = group.path.match(/^\/AppRoles\/([^/]+)$/);
    if (match) values.push(`app-admin:${match[1]}`);
  }
  accessCache.set(userId, { expires: Date.now() + CACHE_MS, values });
  return values;
}

export async function enrichUsersWithAdminAccess(
  accessToken: string,
  users: KcUser[],
): Promise<KcUser[]> {
  return Promise.all(users.map(async (user) => {
    const [adminAccess, mfaCredentialTypes] = await Promise.all([
      adminAccessForUser(accessToken, user.id),
      mfaCredentialTypesForUser(accessToken, user.id),
    ]);
    return {
      ...user,
      adminAccess,
      mfaConfigured: mfaCredentialTypes.length > 0,
      mfaCredentialTypes,
    };
  }));
}
