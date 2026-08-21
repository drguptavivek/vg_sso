import { kcAdminRequest } from "./keycloakAdmin";
import { config } from "./config";
import type { KcGroup } from "@/types/keycloak";

/**
 * Returns the full paths of AppRoles/{clientId} groups the caller is a
 * *direct* member of - i.e. the app roots they administer as a delegated
 * client admin. Mirrors the ownership derivation already enforced
 * server-side by DelegatedAdminGuardFilter in custom-delegated-admin-guard-spi.
 */
export async function getOwnedRootPaths(accessToken: string, userId: string): Promise<string[]> {
  const { data } = await kcAdminRequest<KcGroup[]>(accessToken, `/users/${userId}/groups`, {
    query: { briefRepresentation: "false", max: "1000" },
  });
  const prefix = `/${config.appRolesGroupName}/`;
  return (data ?? [])
    .filter((g) => g.path && g.path.startsWith(prefix) && g.path.slice(prefix.length).indexOf("/") === -1)
    .map((g) => g.path);
}

export function isOwnedRoot(path: string, ownedRootPaths: string[]): boolean {
  return ownedRootPaths.includes(path);
}

/** True if `path` is the owned root itself or any descendant of it. */
export function isWithinOwnedTree(path: string, ownedRootPaths: string[]): boolean {
  return ownedRootPaths.some((root) => path === root || path.startsWith(`${root}/`));
}

/** True only for a strict descendant (not the root itself) - required for rename/delete/create. */
export function isOwnedDescendant(path: string, ownedRootPaths: string[]): boolean {
  return ownedRootPaths.some((root) => path.startsWith(`${root}/`));
}
