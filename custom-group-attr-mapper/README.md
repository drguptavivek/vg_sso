# Group Attributes Protocol Mapper

Custom Keycloak OIDC protocol mapper for Keycloak `26.5.3`.

It emits a JSON claim containing the logged-in user's groups and each group's attributes.

## Build

```bash
cd ./custom-group-attr-mapper
mvn -q -DskipTests package
```

## Deploy

```bash
cp ./custom-group-attr-mapper/target/custom-group-attr-mapper-1.0.0.jar ./keycloak-26.5.3/providers/

./kc.sh build
./kc.sh start-dev --features="admin-fine-grained-authz:v2" --spi-theme-cache-themes=false --spi-theme-cache-templates=false --spi-theme-static-max-age=-1
```

## Add Mapper To Client Scope (kcadm)

```bash
REALM="org-new-delhi"; SCOPE="org-minimal"; CLAIM="group_details"; SCOPE_ID=$(./kcadm.sh get client-scopes -r "$REALM" --fields id,name --config .kcadm.config | jq -r --arg n "$SCOPE" '.[]|select(.name==$n)|.id')
./kcadm.sh create "client-scopes/$SCOPE_ID/protocol-mappers/models" -r "$REALM" --config .kcadm.config -s name="group-attributes" -s protocol=openid-connect -s protocolMapper=oidc-group-attributes-mapper -s 'config."claim.name"='"$CLAIM" -s 'config."jsonType.label"=JSON' -s 'config."full.path"=true' -s 'config."include.attributes"=true' -s 'config."access.token.claim"=true' -s 'config."id.token.claim"=true' -s 'config."userinfo.token.claim"=true'
```

## Claim shape

```json
[
  {
    "id": "group-id",
    "name": "Cardiology",
    "path": "/Departments/Cardiology",
    "attributes": {
      "Cardiology": {
        "dept_id": ["14"]
      }
    }
  }
]
```
