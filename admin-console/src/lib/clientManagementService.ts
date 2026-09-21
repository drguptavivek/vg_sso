import "server-only";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import type { KcClient, KcGroup, KcUser } from "@/types/keycloak";
import { clientTemplateFields, postLogoutRedirectAttribute, POST_LOGOUT_REDIRECT_ATTRIBUTE, RESERVED_CLIENTS, type ClientEnvironment, type ClientTemplate, validateEffectiveClient } from "./clientManagement";

export function isProtectedClient(client: KcClient): boolean {
  return RESERVED_CLIENTS.has(client.clientId.toLowerCase());
}

export async function findClient(accessToken: string, id: string): Promise<KcClient | null> {
  const direct = await kcAdminRequest<KcClient>(accessToken, `/clients/${encodeURIComponent(id)}`);
  return direct.data;
}

export async function findClientByClientId(accessToken: string, clientId: string): Promise<KcClient | null> {
  const response = await kcAdminRequest<KcClient[]>(accessToken, "/clients", {
    query: { clientId, max: 10, viewableOnly: true },
  });
  return (response.data ?? []).find((client) => client.clientId === clientId) ?? null;
}

export async function findAppRolesRoot(accessToken: string, clientId: string): Promise<KcGroup | null> {
  const { data: parents } = await kcAdminRequest<KcGroup[]>(accessToken, "/groups", {
    query: { search: config.appRolesGroupName, exact: true, max: 20, briefRepresentation: false },
  });
  const parent = (parents ?? []).find((group) => group.path === `/${config.appRolesGroupName}`);
  if (!parent?.id) return null;
  const { data: roots } = await kcAdminRequest<KcGroup[]>(accessToken, `/groups/${parent.id}/children`, {
    query: { max: 1000, briefRepresentation: false },
  });
  return (roots ?? []).find((group) => group.name === clientId || group.path === `/${config.appRolesGroupName}/${clientId}`) ?? null;
}

export async function appRolesForClient(accessToken: string, clientId: string) {
  const root = await findAppRolesRoot(accessToken, clientId);
  if (!root?.id) return { root: null, administrators: [] as KcUser[], roleGroups: [] as KcGroup[] };
  const [{ data: administrators }, { data: roleGroups }] = await Promise.all([
    kcAdminRequest<KcUser[]>(accessToken, `/groups/${root.id}/members`, { query: { max: 1000, briefRepresentation: true } }),
    kcAdminRequest<KcGroup[]>(accessToken, `/groups/${root.id}/children`, { query: { max: 1000, briefRepresentation: true } }),
  ]);
  return { root, administrators: administrators ?? [], roleGroups: roleGroups ?? [] };
}

export function clientPayload(input: {
  clientId: string;
  name?: string;
  description?: string;
  template: ClientTemplate;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  webOrigins: string[];
}) {
  return {
    clientId: input.clientId,
    name: input.name,
    description: input.description,
    ...clientTemplateFields(input.template),
    redirectUris: input.redirectUris,
    webOrigins: input.webOrigins,
    attributes: {
      ...(clientTemplateFields(input.template).attributes ?? {}),
      ...(postLogoutRedirectAttribute(input.postLogoutRedirectUris)
        ? { [POST_LOGOUT_REDIRECT_ATTRIBUTE]: postLogoutRedirectAttribute(input.postLogoutRedirectUris) }
        : {}),
    },
  };
}

export async function createKeycloakClient(accessToken: string, input: Parameters<typeof clientPayload>[0]) {
  const created = await kcAdminRequest(accessToken, "/clients", {
    method: "POST",
    body: clientPayload(input),
  });
  const location = created.location ?? "";
  const match = location.match(/\/clients\/([^/?]+)$/);
  if (match?.[1]) return findClient(accessToken, decodeURIComponent(match[1]));
  return findClientByClientId(accessToken, input.clientId);
}

export async function updateKeycloakClient(accessToken: string, current: KcClient, patch: Partial<KcClient>) {
  const merged = { ...current, ...patch };
  await kcAdminRequest(accessToken, `/clients/${encodeURIComponent(current.id)}`, { method: "PUT", body: merged });
  return findClient(accessToken, current.id);
}

export async function ensureAppRolesRoot(accessToken: string, clientId: string): Promise<KcGroup> {
  const existing = await findAppRolesRoot(accessToken, clientId);
  if (existing?.id) return existing;
  const { data: parents } = await kcAdminRequest<KcGroup[]>(accessToken, "/groups", {
    query: { search: config.appRolesGroupName, exact: true, max: 20, briefRepresentation: false },
  });
  const parent = (parents ?? []).find((group) => group.path === `/${config.appRolesGroupName}`);
  if (!parent?.id) throw new Error(`AppRoles parent group is not available for client ${clientId}`);
  try {
    await kcAdminRequest(accessToken, `/groups/${parent.id}/children`, {
      method: "POST",
      body: { name: clientId },
    });
  } catch {
    // A concurrent Keycloak event listener or provisioning request may have won the race.
  }
  const created = await findAppRolesRoot(accessToken, clientId);
  if (!created?.id) throw new Error(`AppRoles root could not be created for client ${clientId}`);
  return created;
}

export async function assignApplicationAdministrator(accessToken: string, clientId: string, userId: string) {
  const root = await ensureAppRolesRoot(accessToken, clientId);
  await kcAdminRequest(accessToken, `/users/${encodeURIComponent(userId)}/groups/${root.id}`, { method: "PUT" });
  return root;
}

export function clientSecurity(client: KcClient, template?: ClientTemplate, environment?: ClientEnvironment) {
  return validateEffectiveClient(client, template, environment);
}