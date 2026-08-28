# Delegated Admin Guard SPI

`custom-delegated-admin-guard-spi` adds runtime guardrails around delegated client administration that are difficult to express safely with Keycloak FGAP alone.

## Provider

The event listener provider ID is:

```text
delegated-admin-guard
```

It must be enabled in the realm event listener list. The bootstrap flow wires it as part of the delegated administration setup.

## Client Creation And AppRoles

On every authenticated `CLIENT_CREATE` admin event, the listener resolves the newly created client and ensures this group exists:

```text
AppRoles/{clientId}
```

This applies to both delegated `client-manager` users and full realm administrators. The group creation is idempotent, so repeated events or pre-existing groups do not create duplicates.

Only delegated `client-manager` creators are made the first per-client admin automatically:

- the creator is added as a direct member of `AppRoles/{clientId}`
- the creator is granted the `delegated-client-admin-base` realm role

When a realm administrator creates a client, the listener creates `AppRoles/{clientId}` but does not add the realm administrator as a PCA and does not grant `delegated-client-admin-base`. Realm administrators can later assign PCA ownership explicitly by adding the intended user as a direct member of the app root group.

## PCA Role Auto-Management

The `delegated-client-admin-base` role is auto-managed from direct membership in `AppRoles/{clientId}` roots:

- adding a user to an app root grants `delegated-client-admin-base`
- removing a user from their last app root revokes `delegated-client-admin-base`

Manual admin REST mapping of `delegated-client-admin-base` is blocked by the filter. PCA identity should come from AppRoles ownership, not ad hoc role assignment.

## Runtime Restrictions

Version 1.2.0 adds the optional `self-registration-service` mutation allowlist used by the LAN-only Next.js EHRMS registration module. The rule is inert unless that optional realm role is assigned.
For delegated users, the filter blocks or narrows operations that FGAP cannot safely cover by itself:

- deleting clients
- mutating system clients
- creating, updating, or deleting client scopes
- mutating `AppRoles` outside owned app subtrees
- tampering with protected `delegated-client-admin-base` mappings

For every Admin REST caller, including full realm administrators, the filter also blocks self-disable. A non-realm-admin cannot disable a user holding `realm-management -> realm-admin`; a realm administrator may disable a different realm administrator. These checks inspect `PUT /users/{id}` requests containing `enabled=false`.

Full realm administrators are not restricted by these delegated-admin rules, but their client creation still receives the AppRoles group bootstrap described above.

## Development Reload

For local development, rebuild only this SPI and hot-swap it into the running Keycloak container:

```bash
mvn -q -f custom-delegated-admin-guard-spi/pom.xml -DskipTests package
docker exec vg-keycloak find /opt/keycloak/providers -maxdepth 1 -type f \
  -name 'custom-delegated-admin-guard-spi-*.jar' -delete
docker cp custom-delegated-admin-guard-spi/target/custom-delegated-admin-guard-spi-1.2.0.jar \
  vg-keycloak:/opt/keycloak/providers/
docker compose -f docker-compose.yml -f docker-compose.override.yml restart keycloak
curl -sf http://localhost:9000/management/health/ready
```
