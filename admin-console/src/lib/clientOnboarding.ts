import "server-only";

import { config, keycloakRealmPublicUrl } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import type { KcGroup } from "@/types/keycloak";
import { RESERVED_CLIENTS } from "@/lib/clientManagement";

/**
 * Only fields deliberately selected here may leave the Admin Console.  In
 * particular, this type does not contain client secrets, registration tokens,
 * protocol mapper values, or any other credential material returned by
 * Keycloak's client representation.
 */
export interface OnboardingClientConfig {
  id: string;
  clientId: string;
  name: string | null;
  description: string | null;
  enabled: boolean | null;
  protocol: string | null;
  publicClient: boolean | null;
  clientAuthenticatorType: string | null;
  standardFlowEnabled: boolean | null;
  implicitFlowEnabled: boolean | null;
  directAccessGrantsEnabled: boolean | null;
  serviceAccountsEnabled: boolean | null;
  authorizationServicesEnabled: boolean | null;
  frontchannelLogout: boolean | null;
  rootUrl: string | null;
  baseUrl: string | null;
  redirectUris: string[];
  webOrigins: string[];
  postLogoutRedirectUris: string[];
  defaultClientScopes: string[];
  optionalClientScopes: string[];
  pkceCodeChallengeMethod: string | null;
}

export interface OnboardingRole {
  id: string;
  name: string;
  path: string;
}

export interface ClientOnboardingManifest {
  schemaVersion: "1";
  generatedAt: string;
  realm: {
    name: string;
    issuer: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    logoutEndpoint: string;
    jwksUri: string;
  };
  client: OnboardingClientConfig;
  appRoles: {
    rootPath: string | null;
    roles: OnboardingRole[];
  };
  security: {
    pkce: "required-s256" | "not-configured";
    clientSecretsIncluded: false;
    privateKeysIncluded: false;
    roleApi: "not-available-in-phase-one";
  };
}

interface RawKeycloakClient {
  id?: string;
  clientId?: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  protocol?: string;
  publicClient?: boolean;
  clientAuthenticatorType?: string;
  standardFlowEnabled?: boolean;
  implicitFlowEnabled?: boolean;
  directAccessGrantsEnabled?: boolean;
  serviceAccountsEnabled?: boolean;
  authorizationServicesEnabled?: boolean;
  frontchannelLogout?: boolean;
  rootUrl?: string;
  baseUrl?: string;
  redirectUris?: unknown;
  webOrigins?: unknown;
  attributes?: Record<string, unknown>;
  defaultClientScopes?: unknown;
  optionalClientScopes?: unknown;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").map(safeUrlOrText);
  if (typeof value === "string") return value.split(/[\r\n]+/).map((item) => item.trim()).filter(Boolean).map(safeUrlOrText);
  return [];
}

const SENSITIVE_KEY = /(?:secret|token|password|private[_. -]?key|credential|authorization|assertion|jwt|code_verifier|client_assertion)/i;

function safeText(value: string): string {
  return value
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gi, "[REDACTED]")
    .replace(/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]")
    .replace(new RegExp(`(${SENSITIVE_KEY.source})\\s*[:=]\\s*[^\\s,;]+`, "gi"), "$1=[REDACTED]");
}

function safeUrlOrText(value: string): string {
  const text = safeText(value);
  try {
    const url = new URL(text);
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_KEY.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return text;
  }
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? safeText(value) : null;
}

function nullableUrl(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? safeUrlOrText(value) : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function pkceMethod(attributes: Record<string, unknown> | undefined): string | null {
  const value = attributes?.["pkce.code.challenge.method"];
  return value === "S256" || value === "plain" ? value : null;
}

function clientConfig(client: RawKeycloakClient): OnboardingClientConfig {
  return {
    id: nullableString(client.id) ?? "",
    clientId: nullableString(client.clientId) ?? "",
    name: nullableString(client.name),
    description: nullableString(client.description),
    enabled: nullableBoolean(client.enabled),
    protocol: nullableString(client.protocol),
    publicClient: nullableBoolean(client.publicClient),
    clientAuthenticatorType: nullableString(client.clientAuthenticatorType),
    standardFlowEnabled: nullableBoolean(client.standardFlowEnabled),
    implicitFlowEnabled: nullableBoolean(client.implicitFlowEnabled),
    directAccessGrantsEnabled: nullableBoolean(client.directAccessGrantsEnabled),
    serviceAccountsEnabled: nullableBoolean(client.serviceAccountsEnabled),
    authorizationServicesEnabled: nullableBoolean(client.authorizationServicesEnabled),
    frontchannelLogout: nullableBoolean(client.frontchannelLogout),
    rootUrl: nullableUrl(client.rootUrl),
    baseUrl: nullableUrl(client.baseUrl),
    redirectUris: stringList(client.redirectUris),
    webOrigins: stringList(client.webOrigins),
    // Keycloak 26 uses this field for newer client representations. Older
    // versions may omit it; keep the output safe and deterministic either way.
    postLogoutRedirectUris: stringList(client.attributes?.["post.logout.redirect.uris"]),
    defaultClientScopes: stringList(client.defaultClientScopes),
    optionalClientScopes: stringList(client.optionalClientScopes),
    pkceCodeChallengeMethod: pkceMethod(client.attributes),
  };
}

function flattenRoles(groups: KcGroup[], result: OnboardingRole[] = []): OnboardingRole[] {
  for (const group of groups) {
    result.push({ id: safeText(group.id), name: safeText(group.name), path: safeUrlOrText(group.path) });
    flattenRoles(group.subGroups ?? [], result);
  }
  return result;
}

async function appRoleRoot(
  accessToken: string,
  clientId: string,
): Promise<{ rootPath: string | null; roles: OnboardingRole[] }> {
  try {
    const { data: roots } = await kcAdminRequest<KcGroup[]>(accessToken, "/groups", {
      query: { search: config.appRolesGroupName, exact: true, max: 20, briefRepresentation: false },
    });
    const appRoles = (roots ?? []).find((group) => group.path === `/${config.appRolesGroupName}`);
    if (!appRoles?.id) return { rootPath: null, roles: [] };

    const { data: children } = await kcAdminRequest<KcGroup[]>(
      accessToken,
      `/groups/${appRoles.id}/children`,
      { query: { first: 0, max: 1000, briefRepresentation: false } },
    );
    const root = (children ?? []).find((group) => group.name === clientId);
    if (!root?.id) return { rootPath: null, roles: [] };

    const { data: roleGroups } = await kcAdminRequest<KcGroup[]>(
      accessToken,
      `/groups/${root.id}/children`,
      { query: { first: 0, max: 1000, briefRepresentation: false } },
    );
    return { rootPath: safeUrlOrText(root.path), roles: flattenRoles(roleGroups ?? []) };
  } catch {
    // Onboarding still remains useful when the caller can read the client but
    // cannot read AppRoles. Do not make an authorization failure leak group
    // details or prevent safe OIDC documentation generation.
    return { rootPath: null, roles: [] };
  }
}

export async function buildClientOnboardingManifest(
  accessToken: string,
  clientUuid: string,
): Promise<ClientOnboardingManifest> {
  const { data } = await kcAdminRequest<RawKeycloakClient>(accessToken, `/clients/${encodeURIComponent(clientUuid)}`);
  if (!data?.id || !data.clientId) {
    throw new Error("Keycloak returned an incomplete client representation");
  }
  if (RESERVED_CLIENTS.has(data.clientId.toLowerCase())) {
    throw new Error("Onboarding artifacts are not available for protected system clients");
  }

  const realmUrl = safeUrlOrText(keycloakRealmPublicUrl()).replace(/\/+$/, "");
  const roles = await appRoleRoot(accessToken, data.clientId);
  const safeClient = clientConfig(data);
  const pkce = safeClient.standardFlowEnabled === true && safeClient.pkceCodeChallengeMethod === "S256"
    ? "required-s256"
    : "not-configured";

  return {
    schemaVersion: "1",
    generatedAt: new Date().toISOString(),
    realm: {
      name: safeText(config.realm),
      issuer: realmUrl,
      authorizationEndpoint: `${realmUrl}/protocol/openid-connect/auth`,
      tokenEndpoint: `${realmUrl}/protocol/openid-connect/token`,
      logoutEndpoint: `${realmUrl}/protocol/openid-connect/logout`,
      jwksUri: `${realmUrl}/protocol/openid-connect/certs`,
    },
    client: safeClient,
    appRoles: roles,
    security: {
      pkce,
      clientSecretsIncluded: false,
      privateKeysIncluded: false,
      roleApi: "not-available-in-phase-one",
    },
  };
}

function display(value: string | boolean | null | undefined): string {
  return value === null || value === undefined || value === "" ? "Not configured" : String(value);
}

function listMarkdown(values: string[]): string {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "- None configured";
}

export function renderOnboardingMarkdown(manifest: ClientOnboardingManifest): string {
  const { client, realm } = manifest;
  const roleLines = manifest.appRoles.roles.length
    ? manifest.appRoles.roles.map((role) => `- ${role.path} (${role.id})`).join("\n")
    : "- No application roles were found (or the caller cannot read AppRoles).";
  return `# ${display(client.name ?? client.clientId)} – SSO onboarding\n\n` +
    `Generated: ${manifest.generatedAt}\n\n` +
    `This guide is configuration-specific to the provisioned **${client.clientId}** client. ` +
    `It contains no client secret, private key, access token, or refresh token.\n\n` +
    `## OpenID Connect\n\n` +
    `- Realm: ${realm.name}\n` +
    `- Issuer: ${realm.issuer}\n` +
    `- Client ID: ${client.clientId}\n` +
    `- Protocol: ${display(client.protocol)}\n` +
    `- Client authentication: ${display(client.clientAuthenticatorType)}\n` +
    `- Authorization Code flow: ${display(client.standardFlowEnabled)}\n` +
    `- PKCE: ${manifest.security.pkce === "required-s256" ? "required (S256)" : "not confirmed as required"}\n\n` +
    `### Endpoints\n\n` +
    `- Authorization: ${realm.authorizationEndpoint}\n` +
    `- Token: ${realm.tokenEndpoint}\n` +
    `- Logout: ${realm.logoutEndpoint}\n` +
    `- JWKS: ${realm.jwksUri}\n\n` +
    `## Registered URLs\n\n` +
    `### Redirect URIs\n\n${listMarkdown(client.redirectUris)}\n\n` +
    `### Post-logout redirect URIs\n\n${listMarkdown(client.postLogoutRedirectUris)}\n\n` +
    `### Web origins\n\n${listMarkdown(client.webOrigins)}\n\n` +
    `## AppRoles\n\n` +
    `Application root: ${manifest.appRoles.rootPath ?? "Not provisioned or not visible"}\n\n` +
    `${roleLines}\n\n` +
    `## Integration requirements\n\n` +
    `- Validate issuer, audience, signature, nonce, state, and token expiry.\n` +
    `- Use the stable \`sub\` claim as the user identifier.\n` +
    `- Keep confidential-client credentials on the server only.\n` +
    `- Do not store tokens in browser localStorage.\n` +
    `- Use exact registered redirect URIs; request changes through the client manager.\n` +
    `- The public application-role API is not enabled in this phase.\n\n` +
    `## Security status\n\n` +
    `- Client enabled: ${display(client.enabled)}\n` +
    `- Implicit flow: ${display(client.implicitFlowEnabled)}\n` +
    `- Direct access grants: ${display(client.directAccessGrantsEnabled)}\n` +
    `- Service accounts: ${display(client.serviceAccountsEnabled)}\n` +
    `- Authorization Services: ${display(client.authorizationServicesEnabled)}\n`;
}

export function renderOnboardingEnvExample(manifest: ClientOnboardingManifest): string {
  const { client, realm } = manifest;
  return `# Generated from ${client.clientId}; no secrets are included.\n` +
    `OIDC_ISSUER=${realm.issuer}\n` +
    `OIDC_AUTHORIZATION_ENDPOINT=${realm.authorizationEndpoint}\n` +
    `OIDC_TOKEN_ENDPOINT=${realm.tokenEndpoint}\n` +
    `OIDC_LOGOUT_ENDPOINT=${realm.logoutEndpoint}\n` +
    `OIDC_JWKS_URI=${realm.jwksUri}\n` +
    `OIDC_CLIENT_ID=${client.clientId}\n` +
    `OIDC_REDIRECT_URI=<one-of-the-registered-redirect-uris>\n` +
    `# OIDC_CLIENT_SECRET=<configure in your secret manager if this is a confidential client>\n`;
}

export function renderOnboardingOpenApi(manifest: ClientOnboardingManifest): string {
  const document = {
    openapi: "3.1.0",
    info: {
      title: `${manifest.client.name ?? manifest.client.clientId} OIDC integration`,
      version: "1.0.0",
      description: "Configuration-specific OIDC integration metadata. No application-role API is enabled in phase one.",
    },
    servers: [{ url: manifest.realm.issuer }],
    paths: {},
    components: {
      securitySchemes: {
        oidc: {
          type: "openIdConnect",
          openIdConnectUrl: `${manifest.realm.issuer}/.well-known/openid-configuration`,
        },
      },
    },
    "x-keycloak": {
      issuer: manifest.realm.issuer,
      authorizationEndpoint: manifest.realm.authorizationEndpoint,
      tokenEndpoint: manifest.realm.tokenEndpoint,
      logoutEndpoint: manifest.realm.logoutEndpoint,
      jwksUri: manifest.realm.jwksUri,
      clientId: manifest.client.clientId,
      pkce: manifest.security.pkce,
      applicationRoleApi: "not-available-in-phase-one",
    },
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

export type OnboardingFormat = "markdown" | "json" | "env" | "openapi";

export function isOnboardingFormat(value: string | null): value is OnboardingFormat {
  return value === "markdown" || value === "json" || value === "env" || value === "openapi";
}

export function renderOnboardingArtifact(manifest: ClientOnboardingManifest, format: OnboardingFormat): string {
  if (format === "markdown") return renderOnboardingMarkdown(manifest);
  if (format === "env") return renderOnboardingEnvExample(manifest);
  if (format === "openapi") return renderOnboardingOpenApi(manifest);
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function onboardingArtifactMetadata(format: OnboardingFormat): { contentType: string; extension: string } {
  if (format === "markdown") return { contentType: "text/markdown; charset=utf-8", extension: "md" };
  if (format === "env") return { contentType: "text/plain; charset=utf-8", extension: "env.example" };
  if (format === "openapi") return { contentType: "application/vnd.oai.openapi+json; charset=utf-8", extension: "openapi.json" };
  return { contentType: "application/json; charset=utf-8", extension: "json" };
}

export function safeOnboardingFilename(clientId: string, format: OnboardingFormat): string {
  const safeClientId = clientId.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "client";
  return `${safeClientId}-onboarding.${onboardingArtifactMetadata(format).extension}`;
}
