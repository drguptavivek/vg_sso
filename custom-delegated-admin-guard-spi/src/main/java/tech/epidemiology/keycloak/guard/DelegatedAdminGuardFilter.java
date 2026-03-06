package tech.epidemiology.keycloak.guard;

import jakarta.annotation.Priority;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.Provider;
import org.jboss.logging.Logger;
import org.keycloak.models.ClientModel;
import org.keycloak.models.GroupModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.RoleModel;
import org.keycloak.models.UserModel;
import org.keycloak.services.managers.AppAuthManager;
import org.keycloak.services.managers.AuthenticationManager;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * DelegatedAdminGuardFilter
 * ─────────────────────────
 * A JAX-RS ContainerRequestFilter that returns HTTP 403 BEFORE the request
 * handler runs, for operations that the delegated-admin-guard event listener
 * cannot block (AdminEventBuilder catches all Throwables from listeners).
 *
 * Registration: @Provider + Jandex index (jandex-maven-plugin in pom.xml) +
 * beans.xml (bean-discovery-mode=all). After 'kc.sh build' merges the Jandex
 * index, RESTEasy discovers this class and registers it as a global
 * ContainerRequestFilter. NOT @PreMatching — running post-route-match ensures
 * KeycloakSession is already in context when filter() executes.
 *
 * Rules enforced (BEFORE the request handler, AFTER route matching):
 *  1. DELETE /admin/realms/{realm}/clients/{uuid}             → 403 (ALL clients)
 *  2. POST/PUT/PATCH/DELETE on /clients/{uuid}[/**]           → 403 (system clients only)
 *     covers: settings, roles, scopes, protocol-mappers, etc.
 *  3. POST   /admin/realms/{realm}/client-scopes              → 403
 *  4. PUT    /admin/realms/{realm}/client-scopes/{id}[/...]   → 403
 *  5. DELETE /admin/realms/{realm}/client-scopes/{id}[/...]   → 403
 *
 * Applies ONLY to users with the 'client-manager' realm role who do NOT
 * also hold 'realm-admin' or manage-realm (from realm-management client).
 */
@Provider
@Priority(Priorities.AUTHORIZATION + 10)  // after auth, before business logic
public class DelegatedAdminGuardFilter implements ContainerRequestFilter {

    private static final Logger LOG = Logger.getLogger(DelegatedAdminGuardFilter.class);

    // /admin/realms/{realm}/clients/{uuid}[/anything...]
    // group(1) = UUID, group(2) = sub-resource path (null for client root).
    private static final Pattern CLIENT_ANY_PATH = Pattern.compile(
        "^/admin/realms/[^/]+/clients/([^/]+)(/.*)?$"
    );

    // POST/PUT/DELETE /admin/realms/{realm}/client-scopes[/{id}[/...]]
    private static final Pattern CLIENT_SCOPE_PATH = Pattern.compile(
        "^/admin/realms/[^/]+/client-scopes(/.*)?$"
    );

    // POST /admin/realms/{realm}/clients (optional trailing slash)
    private static final Pattern CLIENT_COLLECTION_PATH = Pattern.compile(
        "^/admin/realms/[^/]+/clients/?$"
    );

    // POST/PUT/PATCH/DELETE /admin/realms/{realm}/groups/{id}[/...]
    // group(1) = target group UUID, group(2) = sub-resource path (null for group root).
    private static final Pattern GROUP_ANY_PATH = Pattern.compile(
        "^/admin/realms/[^/]+/groups/([^/]+)(/.*)?$"
    );

    // PUT/DELETE /admin/realms/{realm}/users/{userId}/groups/{groupId}
    // group(1) = target group UUID.
    private static final Pattern USER_GROUP_MEMBERSHIP_PATH = Pattern.compile(
        "^/admin/realms/[^/]+/users/[^/]+/groups/([^/]+)$"
    );

    // POST/DELETE /admin/realms/{realm}/users/{userId}/role-mappings/realm
    private static final Pattern USER_REALM_ROLE_MAPPINGS_PATH = Pattern.compile(
        "^/admin/realms/[^/]+/users/[^/]+/role-mappings/realm$"
    );

    // POST/DELETE /admin/realms/{realm}/groups/{groupId}/role-mappings/realm
    private static final Pattern GROUP_REALM_ROLE_MAPPINGS_PATH = Pattern.compile(
        "^/admin/realms/[^/]+/groups/[^/]+/role-mappings/realm$"
    );

    // PUT/DELETE /admin/realms/{realm}/roles/delegated-client-admin-base[/...]
    private static final Pattern ROLE_PCA_BASE_PATH = Pattern.compile(
        "^/admin/realms/[^/]+/roles/delegated-client-admin-base(/.*)?$"
    );

    // Any mutation by role id for delegated-client-admin-base target:
    // /admin/realms/{realm}/roles-by-id/{id}[/...]
    private static final Pattern ROLE_BY_ID_PATH = Pattern.compile(
        "^/admin/realms/[^/]+/roles-by-id/([^/]+)(/.*)?$"
    );

    private static final Set<String> MUTATE_METHODS = Set.of("POST", "PUT", "DELETE", "PATCH");

    // System clients that client-manager can never edit or delete.
    // FGAP v2 NEGATIVE policy would cover this, but when manage-clients is added
    // as a composite to client-manager (needed for the "Create client" UI button),
    // that NEGATIVE policy is bypassed. This filter closes that gap.
    private static final Set<String> SYSTEM_CLIENT_IDS = Set.of(
        "broker",
        "realm-management",
        "account",
        "account-console",
        "security-admin-console",
        "admin-cli",
        "admin-permissions"
    );

    // KeycloakSession is pushed into the JAX-RS @Context by Keycloak's own
    // session filter, which runs before post-matching ContainerRequestFilters.
    @Context
    KeycloakSession session;

    @Override
    public void filter(ContainerRequestContext ctx) throws IOException {
        String method = ctx.getMethod();
        String path   = ctx.getUriInfo().getPath();

        // Fast-path: only check mutation methods on admin paths
        if (session == null || !path.startsWith("/admin/realms/")) {
            return;
        }

        String methodUpper = method.toUpperCase();
        boolean isMutate = MUTATE_METHODS.contains(methodUpper);
        if (!isMutate) {
            return;
        }

        java.util.regex.Matcher clientMatcher = CLIENT_ANY_PATH.matcher(path);
        boolean isClientPath = isMutate && clientMatcher.matches();

        boolean isClientCollectionMutation = isMutate && CLIENT_COLLECTION_PATH.matcher(path).matches();
        boolean isClientScopeMutation = isMutate && CLIENT_SCOPE_PATH.matcher(path).matches();
        java.util.regex.Matcher groupMatcher = GROUP_ANY_PATH.matcher(path);
        boolean isGroupPath = isMutate && groupMatcher.matches();
        java.util.regex.Matcher userGroupMembershipMatcher = USER_GROUP_MEMBERSHIP_PATH.matcher(path);
        boolean isUserGroupMembershipPath = isMutate && userGroupMembershipMatcher.matches();
        boolean isUserRealmRoleMappingsPath = isMutate && USER_REALM_ROLE_MAPPINGS_PATH.matcher(path).matches();
        boolean isGroupRealmRoleMappingsPath = isMutate && GROUP_REALM_ROLE_MAPPINGS_PATH.matcher(path).matches();
        boolean isRolePcaBaseMutationPath = isMutate && ROLE_PCA_BASE_PATH.matcher(path).matches();
        java.util.regex.Matcher roleByIdMatcher = ROLE_BY_ID_PATH.matcher(path);
        boolean isRoleByIdPath = isMutate && roleByIdMatcher.matches();

        // Resolve the authenticated user from the bearer token
        RealmModel realm = session.getContext().getRealm();
        if (realm == null) {
            return;
        }

        AuthenticationManager.AuthResult authResult = new AppAuthManager.BearerTokenAuthenticator(session)
                .setRealm(realm)
                .setUriInfo(session.getContext().getUri())
                .setConnection(session.getContext().getConnection())
                .setHeaders(session.getContext().getRequestHeaders())
                .authenticate();

        if (authResult == null || authResult.getUser() == null) {
            return; // Not authenticated — let the normal auth layer reject it
        }

        UserModel actor = authResult.getUser();

        boolean isClientManager = hasClientManagerRoleOnly(realm, actor);
        boolean hasPcaBase = hasPcaBaseRole(realm, actor);
        // PCA users are identified by direct membership in AppRoles/{clientId} groups.
        Set<String> pcaClientIds = getPcaClientIds(realm, actor);
        boolean isPca = !pcaClientIds.isEmpty();
        GroupModel appRolesRoot = getAppRolesRoot(realm);
        Set<String> ownedAppGroupIds = getOwnedAppGroupIds(actor, appRolesRoot);
        boolean isOrphanPcaBase = hasPcaBase && !isClientManager && !isPca;

        // ── P2: auto-only delegated-client-admin-base role (no manual mapping/tampering over admin REST) ──
        if ((isUserRealmRoleMappingsPath || isGroupRealmRoleMappingsPath)
                && payloadTargetsPcaBaseRole(ctx, realm)) {
            ctx.abortWith(forbidden(
                "Role 'delegated-client-admin-base' is auto-managed by delegated-admin-guard and cannot be mapped manually."
            ));
            return;
        }

        if (isRolePcaBaseMutationPath) {
            ctx.abortWith(forbidden(
                "Role 'delegated-client-admin-base' is protected and cannot be modified through admin REST."
            ));
            return;
        }

        if (isRoleByIdPath && isPcaBaseRoleId(realm, roleByIdMatcher.group(1))) {
            ctx.abortWith(forbidden(
                "Role 'delegated-client-admin-base' is protected and cannot be modified through admin REST."
            ));
            return;
        }

        // ── P0: runtime safety for orphan delegated-client-admin-base holders ────────────────────
        if (isOrphanPcaBase) {
            if (isClientPath || isClientCollectionMutation || isGroupPath || isUserGroupMembershipPath) {
                ctx.abortWith(forbidden(
                    "Role 'delegated-client-admin-base' requires direct membership in AppRoles/{clientId}. " +
                    "Contact a realm administrator."
                ));
                return;
            }
        }

        if (!isClientManager && !isPca) {
            return; // Full realm admin or regular user — not restricted by this filter
        }

        // ── Block the request ───────────────────────────────────────────── //

        if (isClientPath) {
            String clientUuid = clientMatcher.group(1);
            String subPath    = clientMatcher.group(2); // null for client root

            // DELETE on the client root (/clients/{uuid}) → block for ALL delegated users
            boolean isClientRootDelete = "DELETE".equals(methodUpper) && subPath == null;
            if (isClientRootDelete) {
                LOG.warnf(
                    "DELEGATED_ADMIN_GUARD_FILTER: Blocking CLIENT DELETE — user=%s realm=%s path=%s",
                    actor.getUsername(), realm.getName(), path
                );
                ctx.abortWith(forbidden(
                    "Delegated client administrators cannot delete clients. " +
                    "Contact a realm administrator."
                ));
                return;
            }

            // Resolve the target client to get its clientId for checks
            ClientModel targetClient = session.clients().getClientById(realm, clientUuid);
            if (targetClient == null) return;
            String targetClientId = targetClient.getClientId();

            // System clients are always blocked regardless of client-manager or PCA
            if (SYSTEM_CLIENT_IDS.contains(targetClientId)) {
                LOG.warnf(
                    "DELEGATED_ADMIN_GUARD_FILTER: Blocking %s on system client '%s' (sub=%s) — user=%s realm=%s",
                    method, targetClientId, subPath, actor.getUsername(), realm.getName()
                );
                ctx.abortWith(forbidden(
                    "Delegated client administrators cannot modify system clients (" +
                    targetClientId + "). Contact a realm administrator."
                ));
                return;
            }

            // PCA: only allowed to mutate their own client(s)
            if (!isClientManager && isPca && !pcaClientIds.contains(targetClientId)) {
                LOG.warnf(
                    "DELEGATED_ADMIN_GUARD_FILTER: Blocking PCA %s on non-owned client '%s' (sub=%s) — user=%s realm=%s",
                    method, targetClientId, subPath, actor.getUsername(), realm.getName()
                );
                ctx.abortWith(forbidden(
                    "You are not the administrator of client '" + targetClientId + "'. " +
                    "Contact a realm administrator."
                ));
            }
            // client-manager: non-system clients are allowed — fall through
            return;
        }

        if (isClientCollectionMutation) {
            return; // CM may create clients; PCA-only users are handled by upstream authz
        }

        if (isGroupPath) {
            String targetGroupId = groupMatcher.group(1);
            String subPath = groupMatcher.group(2);
            GroupModel targetGroup = session.groups().getGroupById(realm, targetGroupId);
            if (targetGroup == null || appRolesRoot == null) {
                return;
            }

            String appRolesId = appRolesRoot.getId();
            boolean isAppRolesRoot = appRolesId.equals(targetGroup.getId());
            boolean isAppRoot = appRolesId.equals(targetGroup.getParentId());
            boolean isOwnedAppRoot = ownedAppGroupIds.contains(targetGroup.getId());
            boolean inOwnedSubtree = isInOwnedSubtree(realm, targetGroup, ownedAppGroupIds);

            // AppRoles root is immutable for delegated users.
            if (isAppRolesRoot) {
                ctx.abortWith(forbidden("AppRoles parent group is protected. Contact a realm administrator."));
                return;
            }

            // App root itself cannot be deleted/renamed/moved by delegated users.
            if (isAppRoot) {
                boolean isCreateChild = "POST".equals(methodUpper) && "/children".equals(subPath);
                if (isOwnedAppRoot && isCreateChild) {
                    return;
                }
                ctx.abortWith(forbidden(
                    "AppRoles client root groups are protected. You may only manage descendants of your own app group."
                ));
                return;
            }

            // Descendant groups are mutable only inside the actor's owned subtree.
            if (!inOwnedSubtree) {
                ctx.abortWith(forbidden(
                    "You may only manage groups inside AppRoles descendants for your own client groups."
                ));
                return;
            }
            return;
        }

        if (isUserGroupMembershipPath) {
            String targetGroupId = userGroupMembershipMatcher.group(1);
            GroupModel targetGroup = session.groups().getGroupById(realm, targetGroupId);
            if (targetGroup == null || appRolesRoot == null) {
                return;
            }

            String appRolesId = appRolesRoot.getId();
            if (appRolesId.equals(targetGroup.getId())) {
                ctx.abortWith(forbidden("AppRoles parent group membership is protected."));
                return;
            }

            // Membership ops are allowed on owned AppRoles roots and descendants.
            boolean isOwnedAppRoot = ownedAppGroupIds.contains(targetGroup.getId());
            boolean inOwnedSubtree = isInOwnedSubtree(realm, targetGroup, ownedAppGroupIds);
            if (!isOwnedAppRoot && !inOwnedSubtree) {
                ctx.abortWith(forbidden(
                    "You may only manage membership inside AppRoles groups for your own client groups."
                ));
            }
            return;
        }

        if (isClientScopeMutation) {
            LOG.warnf(
                "DELEGATED_ADMIN_GUARD_FILTER: Blocking CLIENT_SCOPE %s — user=%s realm=%s path=%s",
                method, actor.getUsername(), realm.getName(), path
            );
            ctx.abortWith(forbidden(
                "Delegated client administrators cannot create, update, or delete client scopes. " +
                "Contact a realm administrator."
            ));
            return;
        }

        // Default deny: delegated users may mutate only explicitly allowed paths.
        LOG.warnf(
            "DELEGATED_ADMIN_GUARD_FILTER: Default-deny delegated mutation %s path=%s user=%s realm=%s",
            method, path, actor.getUsername(), realm.getName()
        );
        ctx.abortWith(forbidden(
            "This delegated admin operation is not allowed by policy. " +
            "Contact a realm administrator."
        ));
    }

    // ── Helpers ──────────────────────────────────────────────────────────── //

    private static Response forbidden(String message) {
        return Response.status(Response.Status.FORBIDDEN)
                .entity("{\"error\":\"access_denied\",\"error_description\":\"" + message + "\"}")
                .type("application/json")
                .build();
    }

    /**
     * Returns the set of clientIds that this user is a PCA for.
     * A user is a PCA of a client if they are a DIRECT member of the
     * AppRoles/{clientId} group (not a member of a role subgroup beneath it).
     * Returns an empty set if AppRoles group does not exist or user has no PCA groups.
     */
    private Set<String> getPcaClientIds(RealmModel realm, UserModel user) {
        org.keycloak.models.GroupModel appRoles =
            session.groups().getGroupByName(realm, null, DelegatedAdminGuardEventListener.APPROLES_GROUP_NAME);
        if (appRoles == null) return Set.of();
        String appRolesId = appRoles.getId();
        return user.getGroupsStream()
            .filter(g -> appRolesId.equals(g.getParentId()))
            .map(org.keycloak.models.GroupModel::getName)
            .collect(Collectors.toSet());
    }

    private GroupModel getAppRolesRoot(RealmModel realm) {
        return session.groups().getGroupByName(realm, null, DelegatedAdminGuardEventListener.APPROLES_GROUP_NAME);
    }

    private boolean hasPcaBaseRole(RealmModel realm, UserModel user) {
        RoleModel pcaBaseRole = realm.getRole(DelegatedAdminGuardEventListener.PCA_BASE_ROLE_NAME);
        return pcaBaseRole != null && user.hasRole(pcaBaseRole);
    }

    private boolean isPcaBaseRoleId(RealmModel realm, String roleId) {
        if (roleId == null) return false;
        RoleModel pcaBaseRole = realm.getRole(DelegatedAdminGuardEventListener.PCA_BASE_ROLE_NAME);
        return pcaBaseRole != null && roleId.equals(pcaBaseRole.getId());
    }

    private boolean payloadTargetsPcaBaseRole(ContainerRequestContext ctx, RealmModel realm) throws IOException {
        if (ctx.getEntityStream() == null) return false;
        byte[] bytes = ctx.getEntityStream().readAllBytes();
        ctx.setEntityStream(new ByteArrayInputStream(bytes));
        if (bytes.length == 0) return false;
        String body = new String(bytes, StandardCharsets.UTF_8);
        if (body.contains("\"name\":\"" + DelegatedAdminGuardEventListener.PCA_BASE_ROLE_NAME + "\"")
                || body.contains("\"name\": \"" + DelegatedAdminGuardEventListener.PCA_BASE_ROLE_NAME + "\"")) {
            return true;
        }
        RoleModel pcaBaseRole = realm.getRole(DelegatedAdminGuardEventListener.PCA_BASE_ROLE_NAME);
        return pcaBaseRole != null && body.contains(pcaBaseRole.getId());
    }

    private Set<String> getOwnedAppGroupIds(UserModel user, GroupModel appRolesRoot) {
        if (appRolesRoot == null) return Set.of();
        String appRolesId = appRolesRoot.getId();
        return user.getGroupsStream()
            .filter(g -> appRolesId.equals(g.getParentId()))
            .map(GroupModel::getId)
            .collect(Collectors.toSet());
    }

    private boolean isInOwnedSubtree(RealmModel realm, GroupModel targetGroup, Set<String> ownedAppGroupIds) {
        if (targetGroup == null || ownedAppGroupIds.isEmpty()) return false;
        String currentId = targetGroup.getParentId();
        int guard = 0;
        while (currentId != null && guard++ < 50) {
            if (ownedAppGroupIds.contains(currentId)) return true;
            GroupModel parent = session.groups().getGroupById(realm, currentId);
            if (parent == null) return false;
            currentId = parent.getParentId();
        }
        return false;
    }

    /**
     * Returns true if the user has 'client-manager' realm role
     * AND does NOT hold elevated admin roles (realm-admin, manage-realm).
     */
    private boolean hasClientManagerRoleOnly(RealmModel realm, UserModel user) {
        RoleModel clientManagerRole = realm.getRole(DelegatedAdminGuardEventListener.CLIENT_MANAGER_ROLE);
        if (clientManagerRole == null || !user.hasRole(clientManagerRole)) {
            return false;
        }

        // Do not restrict genuine realm admins
        RoleModel realmAdminRole = realm.getRole("realm-admin");
        if (realmAdminRole != null && user.hasRole(realmAdminRole)) {
            return false;
        }

        // Do not restrict manage-realm holders (realm-management client role)
        var realmMgmt = realm.getClientByClientId("realm-management");
        if (realmMgmt != null) {
            RoleModel manageRealmRole = realmMgmt.getRole("manage-realm");
            if (manageRealmRole != null && user.hasRole(manageRealmRole)) {
                return false;
            }
        }

        return true;
    }
}
