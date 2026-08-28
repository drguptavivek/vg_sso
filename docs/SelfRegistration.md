# EHRMS self-registration

The self-registration flow is an unauthenticated route in the LAN-only Next.js `ssoadmin` portal at `/register`. Keycloak native registration remains disabled.

## Runtime identity

Keycloak creates the technical user `service-account-sso-self-registration` automatically for the confidential client `sso-self-registration`. It has no password and no human MFA. It authenticates with `client_credentials`; the employees it creates complete the existing Keycloak email, password, TOTP, recovery-code, and mobile-OTP flow.

The existing delegated-admin guard SPI restricts the `self-registration-service` role to user duplicate searches, user creation, and a compensating delete if Next.js extension storage fails. If the optional client is not installed, this additional guard branch is inert.

## Generated environment file

Run:

```bash
make self-registration-client-setup
```

The command:

1. refreshes the master-admin `kcadm` session;
2. creates or updates the confidential service client with standard and direct grants disabled;
3. lets Keycloak create its service-account user and client secret;
4. creates and maps the restricted service role;
5. generates an independent HMAC secret for one-use registration confirmations;
6. saves both secrets to the gitignored `.env.self-registration` with mode `0600`.

Existing real secrets are not rotated during an ordinary rerun. To rotate the Keycloak client secret explicitly:

```bash
make self-registration-client-secret-rotate
```

The tracked `.env.self-registration.template` contains only placeholders and non-secret defaults. Secret values are never printed by the setup script.

Admin-console Make targets automatically add `.env.self-registration` when it exists. Restart or recreate Next.js after initial setup or rotation:

```bash
make admin-console-up
```

## User flow

1. The employee enters an EHRMS employee ID.
2. The browser receives only the last four mobile digits and the first/last characters of the email local part.
3. Confirmation consumes a short-lived, one-use token and refetches EHRMS server-side.
4. Keycloak is checked in order for matching email, normalized phone, and employee ID.
5. With no match, the account is created in Keycloak and the extension record is stored by Keycloak UUID.
6. Existing Keycloak onboarding and browser flows perform verification and MFA enrollment.

EHRMS remains read-only. The portal is LAN-only, and Next.js calls Keycloak Admin REST using the Docker-internal URL.
