# Password Phrase Policy

**Realm:** `org-new-delhi`
**Status:** Available, manually configured per realm

---

## 1. Purpose

This repo ships a custom password policy provider that blocks passwords containing organization-specific forbidden words or phrases.

The intent is to stop weak or predictable passwords that reuse obvious institutional terms, department names, welcome-style defaults, or other guessable strings.

---

## 2. Provider

| Item | Value |
|---|---|
| Module | `custom-password-phrase-policy-spi` |
| Provider type | Password policy provider |
| Provider id | `forbiddenTerms` |
| Display name | `Forbidden Terms` |

The provider is packaged into the Keycloak image by the repo `Dockerfile`.

---

## 3. Matching Behavior

- Matching is case-insensitive.
- The provider also checks a normalized password form with symbols removed.
- Terms can be configured as comma-separated, semicolon-separated, or newline-separated values.

Example forbidden terms:

```text
password,admin,welcome
hospital
orgname
```

Example effect:

- configured term `password`
- user password `P@ssword123`
- result: rejected

---

## 4. Configuration Model

This policy is not currently bootstrapped by the init scripts.

It is configured manually in the Keycloak admin console:

1. `Authentication`
2. `Policies`
3. `Password Policy`
4. `Add policy`
5. `Forbidden Terms`

The configured term list is realm-specific and stored in realm password policy settings, not in source control.

---

## 5. Operational Guidance

Use this policy for:

- organization names
- common department names
- obvious welcome/default passwords
- short local acronyms users tend to reuse

Avoid using it as a substitute for:

- password length requirements
- password history
- brute-force protection
- MFA

Those remain separate controls in the realm baseline.

---

## 6. Verification

Confirm the provider is present in the built image by opening the password policy UI and checking that `Forbidden Terms` appears in the add-policy list.

For local SPI iteration:

```bash
./scripts/dev_hot_reload_spi.sh custom-password-phrase-policy-spi
```

Build only this SPI on the host:

```bash
mvn -q -f custom-password-phrase-policy-spi/pom.xml -DskipTests package
```

---

## 7. Source Files

| File | Role |
|---|---|
| `custom-password-phrase-policy-spi/src/main/java/tech/epidemiology/keycloak/password/ForbiddenTermsPasswordPolicyProviderFactory.java` | Provider registration and metadata |
| `custom-password-phrase-policy-spi/src/main/java/tech/epidemiology/keycloak/password/ForbiddenTermsPasswordPolicyProvider.java` | Password validation logic |
| `custom-password-phrase-policy-spi/src/test/java/tech/epidemiology/keycloak/password/ForbiddenTermsPasswordPolicyProviderTest.java` | Unit coverage |

