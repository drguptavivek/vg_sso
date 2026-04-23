package tech.epidemiology.keycloak.asyncmail;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

public final class AsyncEmailMasking {
    private static final int HASH_LENGTH = 6;

    private AsyncEmailMasking() {
    }

    public static String maskEmail(String recipient) {
        if (recipient == null || recipient.isBlank()) {
            return "";
        }

        String trimmed = recipient.trim();
        int at = trimmed.indexOf('@');
        if (at <= 0 || at == trimmed.length() - 1) {
            return "***" + obfuscate(trimmed);
        }

        String local = trimmed.substring(0, at);
        String domain = trimmed.substring(at + 1).toLowerCase();
        String maskedLocal = maskLocalPart(local);
        return maskedLocal + "@" + domain;
    }

    static String maskLocalPart(String localPart) {
        String local = localPart.toLowerCase();
        if (local.length() == 1) {
            return local.charAt(0) + "***" + local.charAt(0);
        }
        if (local.length() == 2) {
            return local.charAt(0) + "***" + local.charAt(1);
        }
        return local.charAt(0) + "***" + local.charAt(local.length() - 1);
    }

    private static String obfuscate(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder(HASH_LENGTH);
            for (byte b : bytes) {
                out.append(Character.forDigit((b >> 4) & 0xF, 16));
                if (out.length() >= HASH_LENGTH) {
                    break;
                }
                out.append(Character.forDigit(b & 0xF, 16));
                if (out.length() >= HASH_LENGTH) {
                    break;
                }
            }
            return out.toString();
        } catch (NoSuchAlgorithmException e) {
            return String.valueOf(value.hashCode());
        }
    }
}
