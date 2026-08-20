// During `next build`, Next.js imports every route/page module to collect
// metadata - it never invokes a handler, but top-level `const` initializers
// (like the object below, and the NextAuth provider config that reads from
// it) still run. Real deployments always have these env vars set at actual
// runtime (docker compose / the process environment), but the throwaway
// build-time process does not, so `required()` only throws outside of the
// build phase - actual server start-up in production still fails loudly on
// missing config.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    if (isBuildPhase) {
      return "";
    }
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

export const config = {
  realm: required("ADMIN_CONSOLE_KEYCLOAK_REALM"),
  clientId: required("ADMIN_CONSOLE_CLIENT_ID"),
  clientSecret: required("ADMIN_CONSOLE_CLIENT_SECRET"),
  nextAuthSecret: required("NEXTAUTH_SECRET"),
  // Reachable from the end user's browser (login/logout redirects).
  keycloakPublicUrl: required("ADMIN_CONSOLE_KEYCLOAK_PUBLIC_URL").replace(/\/+$/, ""),
  // Reachable from this app's server process (token exchange + Admin REST calls).
  // Defaults to the public URL, which is correct whenever the app and Keycloak
  // are not both members of the same private docker network.
  keycloakInternalUrl: optional(
    "ADMIN_CONSOLE_KEYCLOAK_INTERNAL_URL",
    required("ADMIN_CONSOLE_KEYCLOAK_PUBLIC_URL"),
  ).replace(/\/+$/, ""),
  userManagerRole: optional("ADMIN_CONSOLE_USER_MANAGER_ROLE", "user-manager"),
  delegatedClientAdminRole: optional(
    "ADMIN_CONSOLE_DELEGATED_CLIENT_ADMIN_ROLE",
    "delegated-client-admin-base",
  ),
  appRolesGroupName: optional("ADMIN_CONSOLE_APP_ROLES_GROUP_NAME", "AppRoles"),
  onboardingActions: ["VERIFY_EMAIL", "UPDATE_PASSWORD", "CONFIGURE_TOTP", "CONFIGURE_RECOVERY_AUTHN_CODES"],
  onboardingLifespanSeconds: Number(optional("ADMIN_CONSOLE_ONBOARDING_LIFESPAN_SECONDS", "43200")),
};

export function keycloakRealmPublicUrl(): string {
  return `${config.keycloakPublicUrl}/realms/${config.realm}`;
}

export function keycloakRealmInternalUrl(): string {
  return `${config.keycloakInternalUrl}/realms/${config.realm}`;
}

export function adminApiBaseUrl(): string {
  return `${config.keycloakInternalUrl}/admin/realms/${config.realm}`;
}
