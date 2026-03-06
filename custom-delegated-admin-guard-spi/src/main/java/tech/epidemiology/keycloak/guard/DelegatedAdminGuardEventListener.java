package tech.epidemiology.keycloak.guard;

import org.jboss.logging.Logger;
import org.keycloak.events.Event;
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.admin.AdminEvent;
import org.keycloak.events.admin.OperationType;
import org.keycloak.events.admin.ResourceType;
import org.keycloak.models.ClientModel;
import org.keycloak.models.GroupModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.RoleModel;
import org.keycloak.models.UserModel;

import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * DelegatedAdminGuardEventListener
 * ─────────────────────────────────
 * An event listener that enforces additional restrictions for users holding only
 * the 'client-manager' delegated administration role (FGAP v2).
 *
 * Restrictions enforced (for client-manager users):
 *  1. CLIENT DELETE — blocked entirely (DB rollback). HTTP 403 handled by filter.
 *  2. CLIENT_SCOPE mutations — blocked entirely (DB rollback). HTTP 403 by filter.
 *
 * Automation triggered (for client-manager users):
 *  3. CLIENT CREATE — auto-provisions AppRoles/{clientId} group, assigns delegated-client-admin-base
 *     role to creator, and adds creator as direct group member (first PCA).
 *
 * How it works:
 *  onAdminEvent() is called within the Keycloak transaction that executed the
 *  admin operation. Throwing an exception here rolls back the whole transaction,
 *  effectively rejecting the operation before it is persisted.
 *
 * Configured via realm event listeners — add "delegated-admin-guard" to the
 * realm's event listener list.
 */
public class DelegatedAdminGuardEventListener implements EventListenerProvider {

    private static final Logger LOG = Logger.getLogger(DelegatedAdminGuardEventListener.class);

    /** The realm role that identifies a delegated (non-realm) client admin */
    static final String CLIENT_MANAGER_ROLE = "client-manager";

    /** Parent group name for all per-client admin group hierarchies */
    static final String APPROLES_GROUP_NAME = "AppRoles";

    /** Realm role with composites granted to each new PCA on client creation */
    static final String PCA_BASE_ROLE_NAME = "delegated-client-admin-base";

    // users/{userId}/groups/{groupId}
    private static final Pattern USER_GROUP_PATH = Pattern.compile("^users/([^/]+)/groups/([^/]+)$");
    // groups/{groupId}/members/{userId}
    private static final Pattern GROUP_MEMBER_PATH = Pattern.compile("^groups/([^/]+)/members/([^/]+)$");

    /**
     * System-managed client IDs that even realm admins shouldn't accidentally
     * touch via delegated paths. These are already protected by FGAP v2 NEGATIVE
     * policy in the bootstrap script; this guard is a belt-and-suspenders.
     */
    private static final Set<String> SYSTEM_CLIENT_IDS = Set.of(
            "admin-cli", "account", "account-console", "broker",
            "realm-management", "security-admin-console", "admin-permissions"
    );

    private final KeycloakSession session;

    public DelegatedAdminGuardEventListener(KeycloakSession session) {
        this.session = session;
    }

    @Override
    public void onEvent(Event event) {
        // No restrictions on user-facing login events
    }

    @Override
    public void onEvent(AdminEvent event, boolean includeRepresentation) {
        RealmModel realm = session.getContext().getRealm();
        if (realm == null) {
            return;
        }

        // Keep delegated-client-admin-base auto-managed based on AppRoles direct root membership changes.
        // This runs for any actor (realm admin or delegated admin).
        trySyncPcaBaseOnMembershipEvent(realm, event);

        // Remaining enforcement paths apply only when auth actor is available.
        if (event.getAuthDetails() == null || event.getAuthDetails().getUserId() == null) {
            return;
        }

        // Resolve the user who triggered this admin action
        String actorUserId = event.getAuthDetails().getUserId();
        UserModel actor = session.users().getUserById(realm, actorUserId);
        if (actor == null) {
            return;
        }

        // Only apply client/client-scope restrictions to client-manager role holders
        if (!hasClientManagerRole(realm, actor)) {
            return;
        }

        ResourceType resourceType = event.getResourceType();
        OperationType opType = event.getOperationType();

        // ── Rule 0: CLIENT CREATE — provision AppRoles/{clientId} group ──
        if (resourceType == ResourceType.CLIENT && opType == OperationType.CREATE) {
            provisionAppRolesGroup(realm, actor, event.getResourcePath());
            return;
        }

        // ── Rule 1: Block CLIENT deletion ────────────────────────────────
        if (resourceType == ResourceType.CLIENT && opType == OperationType.DELETE) {
            LOG.warnf(
                "DELEGATED_ADMIN_GUARD: Blocking CLIENT DELETE by client-manager user=%s realm=%s path=%s",
                actor.getUsername(), realm.getName(), event.getResourcePath()
            );
            // Mark transaction as rollback-only — Keycloak will roll back the delete
            // Note: AdminEventBuilder catches all exceptions so we cannot throw here.
            // The ContainerRequestFilter (DelegatedAdminGuardFilter) handles the 403 response
            // before the request is processed, making this a belt-and-suspenders measure.
            session.getTransactionManager().setRollbackOnly();
            return;
        }

        // ── Rule 2: Block all CLIENT_SCOPE mutations ──────────────────────
        if (resourceType == ResourceType.CLIENT_SCOPE) {
            if (opType == OperationType.CREATE
                    || opType == OperationType.UPDATE
                    || opType == OperationType.DELETE) {

                LOG.warnf(
                    "DELEGATED_ADMIN_GUARD: Blocking CLIENT_SCOPE %s by client-manager user=%s realm=%s path=%s",
                    opType, actor.getUsername(), realm.getName(), event.getResourcePath()
                );
                session.getTransactionManager().setRollbackOnly();
            }
        }
    }

    /**
     * Auto-manage delegated-client-admin-base on AppRoles direct app-root membership changes:
     * - add to AppRoles/{clientId} root -> grant delegated-client-admin-base
     * - remove from all direct AppRoles roots -> revoke delegated-client-admin-base
     */
    private void trySyncPcaBaseOnMembershipEvent(RealmModel realm, AdminEvent event) {
        String resourcePath = event.getResourcePath();
        if (resourcePath == null || resourcePath.isBlank()) {
            return;
        }

        String userId = null;
        String groupId = null;

        Matcher ug = USER_GROUP_PATH.matcher(resourcePath);
        if (ug.matches()) {
            userId = ug.group(1);
            groupId = ug.group(2);
        } else {
            Matcher gm = GROUP_MEMBER_PATH.matcher(resourcePath);
            if (gm.matches()) {
                groupId = gm.group(1);
                userId = gm.group(2);
            }
        }

        if (userId == null || groupId == null) {
            return; // Not a user<->group membership event path.
        }

        UserModel targetUser = session.users().getUserById(realm, userId);
        GroupModel targetGroup = session.groups().getGroupById(realm, groupId);
        if (targetUser == null || targetGroup == null) {
            return;
        }

        GroupModel appRoles = session.groups().getGroupByName(realm, null, APPROLES_GROUP_NAME);
        if (appRoles == null) {
            return;
        }

        // Only direct AppRoles children define PCA ownership.
        if (!appRoles.getId().equals(targetGroup.getParentId())) {
            return;
        }

        RoleModel pcaBaseRole = realm.getRole(PCA_BASE_ROLE_NAME);
        if (pcaBaseRole == null) {
            LOG.warnf("DELEGATED_ADMIN_GUARD: '%s' role not found while syncing membership event", PCA_BASE_ROLE_NAME);
            return;
        }

        OperationType op = event.getOperationType();
        boolean isAdd = (op == OperationType.CREATE || op == OperationType.UPDATE);
        boolean isRemove = (op == OperationType.DELETE);

        if (isAdd) {
            if (!targetUser.hasRole(pcaBaseRole)) {
                targetUser.grantRole(pcaBaseRole);
                LOG.infof("DELEGATED_ADMIN_GUARD: Granted '%s' to user '%s' on AppRoles root membership add (%s)",
                    PCA_BASE_ROLE_NAME, targetUser.getUsername(), targetGroup.getName());
            }
            return;
        }

        if (isRemove) {
            boolean stillInAnyAppRoot = targetUser.getGroupsStream()
                .anyMatch(g -> appRoles.getId().equals(g.getParentId()));
            if (!stillInAnyAppRoot && targetUser.hasRole(pcaBaseRole)) {
                targetUser.deleteRoleMapping(pcaBaseRole);
                LOG.infof("DELEGATED_ADMIN_GUARD: Revoked '%s' from user '%s' (no remaining AppRoles roots)",
                    PCA_BASE_ROLE_NAME, targetUser.getUsername());
            }
        }
    }

    @Override
    public void close() {
        // Nothing to close
    }

    /**
     * Provisions the AppRoles/{clientId} group for a newly created client.
     *
     * Steps:
     *  1. Resolve clientId from the resource path (clients/{uuid})
     *  2. Find AppRoles parent group (must already exist — created by step7-init)
     *  3. Create AppRoles/{clientId} subgroup if not already present
     *  4. Add the actor (client-manager who created the client) as direct member
     *  5. Assign delegated-client-admin-base realm role to the actor
     *
     * Called within the same Keycloak transaction as the CLIENT_CREATE event.
     * Failures are logged but do not roll back the client creation.
     */
    private void provisionAppRolesGroup(RealmModel realm, UserModel actor, String resourcePath) {
        try {
            // Extract UUID from "clients/{uuid}"
            if (resourcePath == null || !resourcePath.startsWith("clients/")) {
                LOG.warnf("DELEGATED_ADMIN_GUARD: CLIENT_CREATE resource path unexpected: %s", resourcePath);
                return;
            }
            String clientUuid = resourcePath.substring("clients/".length());
            ClientModel client = session.clients().getClientById(realm, clientUuid);
            if (client == null) {
                LOG.warnf("DELEGATED_ADMIN_GUARD: CLIENT_CREATE — cannot find client by UUID %s", clientUuid);
                return;
            }
            String clientId = client.getClientId();

            // Find AppRoles parent group
            GroupModel appRoles = session.groups().getGroupByName(realm, null, APPROLES_GROUP_NAME);
            if (appRoles == null) {
                LOG.warnf("DELEGATED_ADMIN_GUARD: '%s' group not found — run step7-init first", APPROLES_GROUP_NAME);
                return;
            }

            // Create AppRoles/{clientId} subgroup (idempotent)
            GroupModel appGroup = session.groups().getGroupByName(realm, appRoles, clientId);
            if (appGroup == null) {
                appGroup = realm.createGroup(clientId, appRoles);
                LOG.infof("DELEGATED_ADMIN_GUARD: Created group %s/%s (id=%s)",
                    APPROLES_GROUP_NAME, clientId, appGroup.getId());
            } else {
                LOG.infof("DELEGATED_ADMIN_GUARD: Group %s/%s already exists — skipping creation",
                    APPROLES_GROUP_NAME, clientId);
            }

            // Add actor as direct member of the app group (makes them PCA)
            if (!actor.isMemberOf(appGroup)) {
                actor.joinGroup(appGroup);
                LOG.infof("DELEGATED_ADMIN_GUARD: Added user '%s' to %s/%s",
                    actor.getUsername(), APPROLES_GROUP_NAME, clientId);
            }

            // Assign delegated-client-admin-base realm role to actor (grants admin console composites)
            RoleModel pcaBaseRole = realm.getRole(PCA_BASE_ROLE_NAME);
            if (pcaBaseRole != null && !actor.hasRole(pcaBaseRole)) {
                actor.grantRole(pcaBaseRole);
                LOG.infof("DELEGATED_ADMIN_GUARD: Granted '%s' role to user '%s'",
                    PCA_BASE_ROLE_NAME, actor.getUsername());
            } else if (pcaBaseRole == null) {
                LOG.warnf("DELEGATED_ADMIN_GUARD: '%s' role not found — run step7-init first", PCA_BASE_ROLE_NAME);
            }

            LOG.infof("DELEGATED_ADMIN_GUARD: ✅ PCA provisioned — user='%s' client='%s' group='%s/%s'",
                actor.getUsername(), clientId, APPROLES_GROUP_NAME, clientId);

        } catch (Exception e) {
            // Log but do not roll back — client creation must not be blocked by PCA setup failure
            LOG.errorf(e, "DELEGATED_ADMIN_GUARD: Failed to provision AppRoles group for client — %s", e.getMessage());
        }
    }

    /**
     * Returns true if the user has the 'client-manager' realm role
     * AND does NOT have the 'realm-admin' role (to avoid double-blocking real admins).
     */
    private boolean hasClientManagerRole(RealmModel realm, UserModel user) {
        RoleModel clientManagerRole = realm.getRole(CLIENT_MANAGER_ROLE);
        if (clientManagerRole == null) {
            return false; // role doesn't exist yet — guard is inactive
        }
        if (!user.hasRole(clientManagerRole)) {
            return false;
        }

        // Exclude users who also hold realm-admin (they have full privileges)
        RoleModel realmAdminRole = realm.getRole("realm-admin");
        if (realmAdminRole != null && user.hasRole(realmAdminRole)) {
            return false;
        }

        // Exclude users with realm-management manage-clients (they have elevated access)
        ClientModel realmMgmt = realm.getClientByClientId("realm-management");
        if (realmMgmt != null) {
            RoleModel manageRealmRole = realmMgmt.getRole("manage-realm");
            if (manageRealmRole != null && user.hasRole(manageRealmRole)) {
                return false;
            }
        }

        return true;
    }
}
