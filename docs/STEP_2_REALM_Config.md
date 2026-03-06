# Implementation Note: Step 2 Realm Security, Profile, Groups, Delegated User Management

```bash
# Docker-first run (dev override)
docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --build

# Load env vars used by commands below
set -a; source ./.env; set +a
SERVER_URL="http://localhost:8080"
REALM="${KC_NEW_REALM_NAME}"

# Login to target realm as realm admin (matches step2-init behavior)
./kcadm.sh config credentials --server "$SERVER_URL" --realm "$REALM" --user "$KC_NEW_REALM_ADMIN_USER" --password "$KC_NEW_REALM_ADMIN_PASSWORD" --config .kcadm.config
```

> `step2-init` now authenticates with `KC_NEW_REALM_ADMIN_USER` / `KC_NEW_REALM_ADMIN_PASSWORD` in `KC_NEW_REALM_NAME` (not master admin).
>
> If logs show `Account is not fully set up [invalid_grant]`, the realm admin cannot use direct grant yet. Check:
> 1. User has no pending required actions.
> 2. User has no OTP credential configured (or direct grant flow does not require OTP for this automation user).
> 3. `admin-cli` in the target realm has direct access grants enabled.

## Step 2 Automation Coverage (`step2-init`)

`scripts/step2_realm_config_docker.sh` now applies all of these automatically:
- Realm security baseline (login, brute-force, password policy, token/session timeouts, events).
- Required actions (`VERIFY_EMAIL`, `UPDATE_PASSWORD`).
- Client hardening (disable direct grants + implicit flow for all clients except `admin-cli`).
- User profile schema custom attributes (`phone_number`, `employment_type`, `employee_id`, `posts`, `designation`, `remarks`).
- `user-manager` realm role + composite mappings (`view-users`, `query-users`, `query-groups`).
- Group import from `.local/groups/groups_tree.json` when present, otherwise the default image payload (via partial import).
- Fine-grained admin permissions bootstrap via the dedicated `step2-fgap-init` container.

Still manual:
- Custom password phrase policy terms via Admin Console UI path:
  `Authentication -> Policies -> Password Policy -> Add policy -> Forbidden Terms`.

# VG realm direct login/account console landing
http://localhost:8080/realms/$REALM/account

# VG realm admin console (realm admin view)
http://localhost:8080/admin/$REALM/console/



## USER PROFILE SCHEMA
Added fields in `org-new-delhi` user profile:
1. `phone_number`  User/admin can view, only admin can edit; max 20 chars; must match `+` optional and 10–15 digits.
2. `employment_type`  Single-select dropdown: `Permanent`, `Contract`, `Research`, `Student`, `Deputed`, `Outsourced`; user/admin view, admin edit only.
3. `employee_id`  Single text field; max 32 chars; user/admin view, admin edit only.
4. `posts` Multi-valued text field (multiple entries allowed); each value max 50 chars; user/admin view, admin edit only.
5. `designation`  Single-select dropdown with your ~60 designation options; user/admin view, admin edit only.
6. `remarks`  Multi-valued free-text textarea field; each value max 1000 chars; user/admin view, admin edit only.

> Note: Account Expiry Date is not part of Step 2. It is added later during Step 5 account expiry setup.


```bash
# Export current user-profile config to a temp file so we can patch it safely.
rm ./tmp/vg-user-profile.json 
rm ./tmp/vg-user-profile.new.json
./kcadm.sh get users/profile -r org-new-delhi --config .kcadm.config > ./tmp/vg-user-profile.json

# Add/replace custom attributes: phone_number, employment_type, employee_id, posts (multivalued), designation (dropdown options).
jq 'def upsert(a): .attributes=((.attributes//[])|map(select(.name!=a.name))+[a]); upsert({"name":"phone_number","displayName":"Phone Number","permissions":{"view":["user","admin"],"edit":["admin"]},"validations":{"length":{"max":20},"pattern":{"pattern":"^\\+?[0-9]{10,15}$","error-message":"Invalid phone number"}}}) | upsert({"name":"employment_type","displayName":"Type","permissions":{"view":["user","admin"],"edit":["admin"]},"validations":{"options":{"options":["Permanent","Contract","Research","Student","Deputed","Outsourced"]}}}) | upsert({"name":"employee_id","displayName":"Employee ID","permissions":{"view":["user","admin"],"edit":["admin"]},"validations":{"length":{"max":32}}}) | upsert({"name":"posts","displayName":"Posts","multivalued":true,"permissions":{"view":["user","admin"],"edit":["admin"]},"validations":{"length":{"max":50}}}) | upsert({"name":"designation","displayName":"Designation","permissions":{"view":["user","admin"],"edit":["admin"]},"validations":{"options":{"options":["Director","Dean","Medical Superintendent","Professor","Additional Professor","Associate Professor","Assistant Professor","Senior Resident","Junior Resident","Chief Medical Officer","Medical Officer","Consultant","Specialist","Registrar","Demonstrator","Tutor","Scientist I","Scientist II","Scientist III","Scientist IV","Scientist V","Lab Technician","Senior Lab Technician","Junior Lab Technician","Research Associate","Research Fellow","Project Scientist","Project Assistant","Project Technician","Data Manager","Biostatistician","Epidemiologist","Clinical Psychologist","Physiotherapist","Occupational Therapist","Speech Therapist","Dietician","Pharmacist","Senior Pharmacist","Store Officer","Administrative Officer","Section Officer","Accounts Officer","Finance Officer","HR Officer","IT Officer","System Analyst","Network Engineer","Security Officer","Public Relations Officer","Legal Officer","Warden","Matron","Nursing Superintendent","Deputy Nursing Superintendent","Assistant Nursing Superintendent","Staff Nurse","ANM","Driver","Attendant","Housekeeping Supervisor"]}}}) | upsert({"name":"remarks","displayName":"Remarks","multivalued":true,"permissions":{"view":["user","admin"],"edit":["admin"]},"validations":{"length":{"max":1000}},"annotations":{"inputType":"textarea","inputTypeRows":"4","inputTypeCols":"60"}})' ./tmp/vg-user-profile.json > ./tmp/vg-user-profile.new.json

# Apply the updated user-profile schema to the org-new-delhi realm.
./kcadm.sh update users/profile -r org-new-delhi -f ./tmp/vg-user-profile.new.json --config .kcadm.config

# Verify only the newly added custom attributes are present in realm user-profile config.
./kcadm.sh get users/profile -r org-new-delhi --config .kcadm.config | jq '.attributes[] | select(.name=="phone_number" or .name=="employment_type" or .name=="employee_id" or .name=="posts" or .name=="designation"or .name=="remarks)'
```


## USER Mangement Role

```bash

# FINE GRAINED PERMISSIONS ENABLEMENT
# Restart Keycloak with FGAP v1+v2 enabled (v1 endpoints are needed for kcadm users/groups-management-permissions).
docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --build

./kcadm.sh get realms/org-new-delhi --config .kcadm.config | grep adminPermissionsEnabled




# Delete existing custom realm role `user-manager`.
./kcadm.sh delete roles/user-manager -r org-new-delhi --config .kcadm.config


# Verify the role removed.
./kcadm.sh get roles/user-manager -r org-new-delhi --config .kcadm.config
./kcadm.sh get-roles -r org-new-delhi --rname user-manager --cclientid realm-management --config .kcadm.config



# Recreate     user-manager     role.
./kcadm.sh create roles -r org-new-delhi -s name=user-manager -s description='User operations without group creation' --config .kcadm.config


# Add only read/query composites from realm-management.(no manage-users).
./kcadm.sh add-roles -r org-new-delhi --rname user-manager --cclientid realm-management --rolename view-users --rolename query-users --rolename query-groups --config .kcadm.config

# Verify role metadata.
./kcadm.sh get roles/user-manager -r org-new-delhi --config .kcadm.config

# Verify composite mappings.
./kcadm.sh get-roles -r org-new-delhi --rname user-manager --cclientid realm-management --config .kcadm.config



# Then in Admin Console (Permissions section), create v2 permissions:
# Allow user-manager policy on Users scopes: create/update (and optionally manage-membership).
# Do not grant Groups manage scopes.
```


### FGAP v2 STEPS

#### POLICY for `user-manager` role

realm > Permissions > Policies > Create Policy > Role
Name: `policy-user-manager`.  
Descrfiption: Fine grained user and group permissions for user-manager role
Realm role: `user-manager`.  Required - checked
Fetch Roles  ON
Logic: Positive

#### Permissions associated with the Policy created above

USER PERMISSIONS - Go to realm > Permissions -> Create Permission  > Users 
 - Name: `perm-users-user-manager`
 - Description: Allow user-manager to create/edit users and assign group membership
 - Authorization scopes: select view, manage, and manage-group-membership (if shown)
 - Enforce access to: All Users
 - Policies: assign existing policy-user-manager

GROUP PERMISSIONS - Then create a separate Groups permission: realm > Permissions -> Create Permission  >  Groups
 - Name: `perm-groups-user-manager-readonly`
 - Authorization scopes: only view / view-members , manage-memebrship
 - Enforce access to: All Groups
 - Policies: policy-user-manager
 - Do not include manage/create/delete scopes for groups.

http://localhost:8080/admin/org-new-delhi/console/
testusermanager Password@123



## GROUPS

```bash
# Pass 1: create all missing groups/subgroups using parent resolved via group-by-path
REALM="org-new-delhi"; FILE="older_sso/groups_flat.json"; while read -r row; do gpath=$(jq -r '.path' <<<"$row"); name=$(jq -r '.name' <<<"$row"); parent=$(jq -r '.parentPath // empty' <<<"$row"); attrs=$(jq -c '.attributes // {}' <<<"$row"); id=$(./kcadm.sh get groups -r "$REALM" --fields id,path --config .kcadm.config | jq -r --arg p "$gpath" '.[]|select(.path==$p)|.id' | head -n1); if [[ -z "$id" ]]; then if [[ -z "$parent" ]]; then jq -nc --arg n "$name" '{name:$n}' | ./kcadm.sh create groups -r "$REALM" -f - --config .kcadm.config >/dev/null || true; else pid=$(./kcadm.sh get groups -r "$REALM" --fields id,path --config .kcadm.config | jq -r --arg p "$parent" '.[]|select(.path==$p)|.id' | head -n1); [[ -z "$pid" ]] && { echo "Missing parent: $parent for $gpath"; continue; }; jq -nc --arg n "$name" '{name:$n}' | ./kcadm.sh create "groups/$pid/children" -r "$REALM" -f - --config .kcadm.config >/dev/null || true; fi; id=$(./kcadm.sh get groups -r "$REALM" --fields id,path --config .kcadm.config | jq -r --arg p "$gpath" '.[]|select(.path==$p)|.id' | head -n1); fi; [[ -z "$id" ]] && { echo "Could not resolve id for $gpath"; continue; }; ./kcadm.sh get "groups/$id" -r "$REALM" --config .kcadm.config | jq --argjson a "$attrs" '.attributes=$a' | ./kcadm.sh update "groups/$id" -r "$REALM" -f - --config .kcadm.config >/dev/null; echo "Upserted $gpath"; done < <(jq -c 'sort_by((.path|split("/")|length))[]' "$FILE")



# Pass 2: apply attributes to every group from JSON
REALM="org-new-delhi"; FILE="older_sso/groups_flat.json"; jq -c '.[]' "$FILE" | while read -r row; do gpath=$(jq -r '.path' <<<"$row"); attrs=$(jq -c '.attributes // {}' <<<"$row"); enc=$(/usr/bin/jq -rn --arg p "$gpath" '$p|@uri'); gid=$(./kcadm.sh get "group-by-path/$enc" -r "$REALM" --config .kcadm.config | /usr/bin/jq -r '.id // empty'); [[ -z "$gid" ]] && { echo "No id for $gpath"; continue; }; ./kcadm.sh get "groups/$gid" -r "$REALM" --config .kcadm.config | /usr/bin/jq --argjson a "$attrs" '.attributes=$a' | ./kcadm.sh update "groups/$gid" -r "$REALM" -f - --config .kcadm.config >/dev/null; echo "Attrs set $gpath"; done

./kcadm.sh get groups -r org-new-delhi --fields path --config .kcadm.config | jq -r '.[].path' | sort

```
