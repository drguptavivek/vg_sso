# Custom Password Phrase Policy SPI

Adds a custom Keycloak password policy provider: `forbiddenTerms`.

## Purpose

Reject password changes when the password contains any org-defined forbidden term or phrase.

## How To Configure (UI)

1. Admin Console -> Authentication -> Policies -> Password Policy
2. Add policy: **Forbidden Terms**
3. Enter terms in the config field, separated by commas, semicolons, or new lines.

Example:

```text
password,admin,welcome
hospital
orgname
```

Matching behavior:

- Case-insensitive.
- Also checks normalized form (symbols removed), so `P@ssword123` matches `password`.

## Build

```bash
mvn -q -f custom-password-phrase-policy-spi/pom.xml -DskipTests package
```
