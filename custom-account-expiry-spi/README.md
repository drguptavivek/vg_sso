# Custom Account Expiry SPI (Keycloak 26.5.3)

This plugin adds:

- `Account Expiry Check (Custom)` authenticator execution for any auth flow.
- Realm REST API under `/realms/{realm}/account-expiry-admin` for dashboard + updates.
- Admin-console dashboard menu item: **Account Expiry** (list/report only).

## User attributes used

- `account_expiry_date` (date only, format `yyyy-MM-dd`, example `2026-03-01`)
- `account_expiry_timezone` (IANA timezone, example `Asia/Kolkata`)

Auth uses `account_expiry_date` + timezone and converts to UTC internally.

Edit these fields in Keycloak user profile attributes (not in custom modal UI).
If timezone is missing, default is `Asia/Kolkata`.

## Build and deploy

```bash
(cd ./custom-account-expiry-spi && mvn -q -DskipTests package)
cp ./custom-account-expiry-spi/target/custom-account-expiry-spi-1.0.0.jar ./keycloak-26.5.3/providers/
./kc.sh build
```

Start Keycloak (theme cache disabled while developing):

```bash
./kc.sh start-dev --spi-theme-cache-themes=false --spi-theme-cache-templates=false --spi-theme-static-max-age=-1
```

## Add execution to a flow

Example adds this check inside realm browser forms subflow:

```bash
REALM="org-new-delhi"
FORMS_ENC=$(jq -rn --arg s "browser forms" '$s|@uri')
./kcadm.sh create "authentication/flows/$FORMS_ENC/executions/execution" -r "$REALM" -s provider=account-expiry-check-authenticator --config .kcadm.config
```

Set requirement to `REQUIRED`:

```bash
EXEC_ID=$(./kcadm.sh get "authentication/flows/$FORMS_ENC/executions" -r "$REALM" --config .kcadm.config | jq -r '.[]|select(.providerId=="account-expiry-check-authenticator")|.id' | head -n1)
./kcadm.sh update "authentication/flows/$FORMS_ENC/executions" -n -r "$REALM" -s id="$EXEC_ID" -s requirement=REQUIRED --config .kcadm.config
```

## Role access

- Dashboard list (`GET /expirations`): `manage-users` or `view-users`
- Set/clear expiry (`POST /users/{id}/expiry`): `manage-users` (API only, if needed)

## API examples

Get standard timezone list (Java `ZoneId`):

```bash
curl -s --location 'http://localhost:8080/realms/org-new-delhi/account-expiry-admin/timezones' \
  --header "Authorization: Bearer <realm-admin-token>"
```

List next/last 14 days:

```bash
curl -s --location 'http://localhost:8080/realms/org-new-delhi/account-expiry-admin/expirations?windowDays=14' \
  --header "Authorization: Bearer <realm-admin-token>"
```

Set expiry in timezone-aware way (date + timezone, converted to UTC internally):

```bash
curl -s --location 'http://localhost:8080/realms/org-new-delhi/account-expiry-admin/users/<USER_ID>/expiry' \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer <realm-admin-token>" \
  --data '{"localDate":"2026-03-01","timeZone":"Asia/Kolkata"}'
```

Clear expiry:

```bash
curl -s --location 'http://localhost:8080/realms/org-new-delhi/account-expiry-admin/users/<USER_ID>/expiry' \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer <realm-admin-token>" \
  --data '{"clear":true}'
```
