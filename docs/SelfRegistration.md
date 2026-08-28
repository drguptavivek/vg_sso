# EHRMS self-registration

The self-registration flow is an unauthenticated route in the LAN-only Next.js `ssoadmin` portal at `/register`. Keycloak native registration remains disabled.

## Runtime identity

Keycloak creates the technical user `service-account-sso-self-registration` automatically for the confidential client `sso-self-registration`. It has no password and no human MFA. It authenticates with `client_credentials`; the employees it creates complete the existing Keycloak email, password, TOTP, recovery-code, and mobile-OTP flow.

The existing delegated-admin guard SPI restricts the `self-registration-service` role to exact email, username, phone, or employee-ID conflict searches and user creation. A compensating delete is permitted only for an account created during the preceding 15 minutes that carries the server-managed `self_registration_pending` marker. It cannot read an individual user's record, run an unfiltered directory query, update a user, delete an established account, or mutate any other Keycloak resource. If the optional client is not installed, this additional guard branch is inert.

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

1. A signed-out visitor chooses Self-register from `/`; opening the SSO home page does not force a login redirect.
2. A permanent employee enters an EHRMS employee ID. Server-side eligibility is checked during both lookup and confirmation.
3. The browser receives only the last four mobile digits and the first/last characters of the email local part.
4. Confirmation consumes a short-lived, one-use token and refetches EHRMS server-side.
5. Keycloak is checked in order for matching email, normalized phone, and employee ID.
6. With no match, the account is created in Keycloak and the extension record is stored by Keycloak UUID. Its memorable username is lowercase first-name initial + full surname + final five employee-ID characters (for example, `vgupta00065`); a short random suffix is added only on collision.
7. The setup email supplies the username and secure action link. The user verifies email, creates a password, enrols MFA using QR or setup key, and downloads recovery codes.
8. On first login, the existing browser flow verifies the EHRMS mobile number by SMS OTP.

Lookup requests are throttled before EHRMS is called and again using database-backed successful-attempt counters. Confirmation tokens are stored only as hashes. Plain employee IDs are cleared from registration-attempt records when an attempt reaches a terminal state. Mutations require the exact configured Next.js origin.

EHRMS remains read-only. The portal is LAN-only, and Next.js calls Keycloak Admin REST using the Docker-internal URL. The employee username is an identifier, not a secret; password, MFA, brute-force protection, and mobile OTP remain the authentication controls.
