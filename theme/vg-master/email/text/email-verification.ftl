<#ftl output_format="plainText">
Your AIIMS SSO username is: ${user.username}

${msg("emailVerificationBody",link, linkExpiration, realmName, linkExpirationFormatter(linkExpiration))}
