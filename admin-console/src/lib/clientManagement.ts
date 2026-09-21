import { z } from "zod";
import type { KcClient } from "@/types/keycloak";

export const POST_LOGOUT_REDIRECT_ATTRIBUTE = "post.logout.redirect.uris";

export const clientTemplateSchema = z.enum(["spa", "server-web", "native", "m2m"]);
export const clientEnvironmentSchema = z.enum(["development", "staging", "production"]);
export type ClientTemplate = z.infer<typeof clientTemplateSchema>;
export type ClientEnvironment = z.infer<typeof clientEnvironmentSchema>;

const optionalText = (max: number) => z.string().trim().max(max).optional();
const uriList = z.array(z.string().trim().min(1).max(2048)).max(100);

export const createClientSchema = z.object({
  template: clientTemplateSchema,
  clientId: z.string().trim().min(2).max(128),
  name: optionalText(255),
  description: optionalText(2000),
  environment: clientEnvironmentSchema,
  redirectUris: uriList,
  postLogoutRedirectUris: uriList,
  webOrigins: uriList,
  businessOwner: optionalText(255),
  technicalOwner: optionalText(255),
  primaryContactEmail: z.string().trim().email().max(320).optional(),
  secondaryContactEmail: z.string().trim().email().max(320).optional(),
  supportContact: optionalText(320),
  justification: optionalText(2000),
  initialAdministratorUserId: z.string().uuid().optional(),
}).strict();

export const updateClientSchema = z.object({
  name: optionalText(255),
  description: optionalText(2000),
  redirectUris: uriList.optional(),
  postLogoutRedirectUris: uriList.optional(),
  webOrigins: uriList.optional(),
  businessOwner: optionalText(255),
  technicalOwner: optionalText(255),
  primaryContactEmail: z.string().trim().email().max(320).nullable().optional(),
  secondaryContactEmail: z.string().trim().email().max(320).nullable().optional(),
  supportContact: optionalText(320).nullable().optional(),
}).strict();

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const RESERVED_CLIENTS = new Set([
  "account", "account-console", "admin-cli", "admin-permissions", "broker",
  "realm-management", "security-admin-console", "sso-self-registration",
  "master-realm", "application-role-api",
]);

/**
 * Keycloak's client representation can include credential material (for
 * example `secret` or `registrationAccessToken`) even though those fields are
 * not part of our local type. Never pass the raw representation back to the
 * browser. Keep only the client attributes the Admin Console needs for
 * security display and redirect handling.
 */
export function publicClientRepresentation(client: KcClient): KcClient {
  const safe = { ...(client as unknown as Record<string, unknown>) };
  for (const key of ["secret", "clientSecret", "registrationAccessToken", "bearerOnlyCredential"]) {
    delete safe[key];
  }
  if (safe.attributes && typeof safe.attributes === "object" && !Array.isArray(safe.attributes)) {
    const attributes = safe.attributes as Record<string, unknown>;
    const encodedLogoutUris = attributes[POST_LOGOUT_REDIRECT_ATTRIBUTE];
    if (typeof encodedLogoutUris === "string") {
      safe.postLogoutRedirectUris = encodedLogoutUris.split("##").map((value) => value.trim()).filter(Boolean);
    }
    safe.attributes = Object.fromEntries(
      Object.entries(attributes).filter(([key]) =>
        key === "pkce.code.challenge.method" || key === POST_LOGOUT_REDIRECT_ATTRIBUTE,
      ),
    );
  } else {
    delete safe.attributes;
  }
  return safe as unknown as KcClient;
}

export interface ClientFinding {
  code: string;
  severity: "pass" | "warn" | "fail";
  message: string;
}

export function postLogoutRedirectUrisForClient(client: KcClient): string[] {
  const encoded = client.attributes?.[POST_LOGOUT_REDIRECT_ATTRIBUTE];
  if (encoded !== undefined) return encoded.split("##").map((value) => value.trim()).filter(Boolean);
  return client.postLogoutRedirectUris ?? [];
}

export function postLogoutRedirectAttribute(values: string[]): string | undefined {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized.join("##") : undefined;
}

export function clientTemplateFields(template: ClientTemplate): Partial<KcClient> {
  const common: Partial<KcClient> = {
    protocol: "openid-connect",
    standardFlowEnabled: template !== "m2m",
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: template === "m2m",
    authorizationServicesEnabled: false,
    frontchannelLogout: true,
    attributes: { "pkce.code.challenge.method": "S256" },
  };
  if (template === "spa" || template === "native") {
    return { ...common, publicClient: true, clientAuthenticatorType: undefined };
  }
  return { ...common, publicClient: false, clientAuthenticatorType: "client-secret" };
}

function fail(code: string, message: string): ClientFinding { return { code, severity: "fail", message }; }
function pass(code: string, message: string): ClientFinding { return { code, severity: "pass", message }; }
function warn(code: string, message: string): ClientFinding { return { code, severity: "warn", message }; }

function isLoopback(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

function validateUrlList(values: string[], label: string, environment: ClientEnvironment, template: ClientTemplate, findings: ClientFinding[]) {
  for (const value of values) {
    let parsed: URL;
    try { parsed = new URL(value); } catch {
      findings.push(fail("invalid-url", `${label} contains an invalid URL: ${value}`));
      continue;
    }
    if (parsed.hash) findings.push(fail("url-fragment", `${label} must not contain URL fragments`));
    if (parsed.hostname.includes("*")) findings.push(fail("wildcard-host", `${label} must not contain wildcard hosts`));
    const isHttp = parsed.protocol === "http:";
    const isHttps = parsed.protocol === "https:";
    const isCustomNativeScheme = template === "native" && !isHttp && !isHttps && /^[a-z][a-z0-9+.-]*:$/.test(parsed.protocol);
    if (isHttp && !(template === "native" && environment === "development" && isLoopback(parsed))) {
      findings.push(fail("http-url", `${label} may use HTTP only for native development loopback URLs`));
    }
    if (!isHttp && !isHttps && !isCustomNativeScheme) {
      findings.push(fail("unsupported-scheme", `${label} must use HTTPS, or an approved native application scheme`));
    }
    if (environment !== "development" && isHttp) findings.push(fail("insecure-url", `${label} must use HTTPS outside development`));
    if (environment === "production" && parsed.pathname.includes("*")) findings.push(fail("broad-path", `${label} must use an exact production path`));
  }
}

export function validateClientRequest(input: {
  template: ClientTemplate;
  clientId: string;
  environment: ClientEnvironment;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  webOrigins: string[];
}): ClientFinding[] {
  const findings: ClientFinding[] = [];
  if (!/^[a-z0-9][a-z0-9._-]{1,127}$/.test(input.clientId)) findings.push(fail("invalid-client-id", "Client ID must use lowercase letters, digits, dots, underscores, or hyphens and start with a letter or digit"));
  if (RESERVED_CLIENTS.has(input.clientId.toLowerCase())) findings.push(fail("reserved-client-id", "This client ID is reserved by the SSO platform"));
  if (input.redirectUris.length === 0 && input.template !== "m2m") findings.push(fail("redirect-required", "At least one redirect URI is required for interactive clients"));
  if (input.template === "m2m" && input.redirectUris.length > 0) findings.push(fail("m2m-redirects", "Machine-to-machine clients must not register browser redirect URIs"));
  if (input.template === "m2m" && input.postLogoutRedirectUris.length > 0) findings.push(fail("m2m-logout-redirects", "Machine-to-machine clients must not register logout redirect URIs"));
  validateUrlList(input.redirectUris, "Redirect URI", input.environment, input.template, findings);
  validateUrlList(input.postLogoutRedirectUris, "Post-logout redirect URI", input.environment, input.template, findings);
  const redirectOrigins = new Set<string>();
  for (const redirect of input.redirectUris) {
    try {
      const parsed = new URL(redirect);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") redirectOrigins.add(parsed.origin);
    } catch { /* URL errors are reported by validateUrlList. */ }
  }
  for (const origin of input.webOrigins) {
    let parsed: URL;
    try { parsed = new URL(origin); } catch {
      findings.push(fail("invalid-origin", `Web origin is invalid: ${origin}`));
      continue;
    }
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) findings.push(fail("origin-path", `Web origins must contain only scheme and host: ${origin}`));
    if (parsed.hostname.includes("*") || origin === "*") findings.push(fail("wildcard-origin", "Wildcard web origins are not permitted"));
    if (parsed.protocol !== "https:") findings.push(fail("insecure-origin", "Web origins must use HTTPS"));
    if (!redirectOrigins.has(parsed.origin)) findings.push(fail("origin-mismatch", `Web origin must match a registered redirect URI origin: ${origin}`));
  }
  if (input.template === "m2m" && input.webOrigins.length > 0) findings.push(fail("m2m-origins", "Machine-to-machine clients must not register web origins"));
  if (input.template === "spa" && input.webOrigins.length === 0) findings.push(warn("missing-origin", "Browser SPAs should register an explicit web origin"));
  findings.push(pass("pkce", "PKCE S256 is required by the approved template"));
  return findings;
}

export function validateEffectiveClient(client: KcClient, template?: ClientTemplate, environment?: ClientEnvironment): ClientFinding[] {
  const inferredTemplate: ClientTemplate = template ?? (client.serviceAccountsEnabled ? "m2m" : client.publicClient ? "spa" : "server-web");
  const findings = validateClientRequest({
    template: inferredTemplate,
    clientId: client.clientId,
    environment: environment ?? "development",
    redirectUris: client.redirectUris ?? [],
    postLogoutRedirectUris: postLogoutRedirectUrisForClient(client),
    webOrigins: client.webOrigins ?? [],
  });
  if (client.implicitFlowEnabled) findings.push(fail("implicit-flow", "Implicit flow must be disabled"));
  else findings.push(pass("implicit-flow", "Implicit flow is disabled"));
  if (client.directAccessGrantsEnabled) findings.push(fail("direct-grants", "Password/direct access grants must be disabled"));
  else findings.push(pass("direct-grants", "Direct access grants are disabled"));
  if (client.authorizationServicesEnabled) findings.push(warn("authorization-services", "Authorization Services is enabled; confirm this is explicitly required"));
  return findings;
}

export function findingSummary(findings: ClientFinding[]) {
  return { findings, valid: !findings.some((finding) => finding.severity === "fail") };
}
