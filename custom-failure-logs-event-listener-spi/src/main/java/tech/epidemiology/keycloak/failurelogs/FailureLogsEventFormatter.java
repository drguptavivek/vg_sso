package tech.epidemiology.keycloak.failurelogs;

import java.time.Instant;
import java.util.Map;

import org.keycloak.events.Event;
import org.keycloak.events.EventType;
import org.keycloak.events.admin.AdminEvent;
import org.keycloak.events.admin.AuthDetails;

final class FailureLogsEventFormatter {
    private FailureLogsEventFormatter() {}

    static boolean shouldLog(Event event) {
        if (event == null || event.getType() == null) {
            return false;
        }

        EventType type = event.getType();
        String typeName = type.name();
        if (typeName.endsWith("_ERROR")) {
            return true;
        }

        return type == EventType.USER_DISABLED_BY_TEMPORARY_LOCKOUT
            || type == EventType.USER_DISABLED_BY_PERMANENT_LOCKOUT;
    }

    static boolean shouldLog(AdminEvent event) {
        return event != null && event.getError() != null && !event.getError().isBlank();
    }

    static String toJsonLine(Event event) {
        StringBuilder sb = new StringBuilder(256);
        sb.append('{');
        appendField(sb, "kind", "user_event");
        appendField(sb, "ts", Instant.ofEpochMilli(event.getTime()).toString());
        appendField(sb, "realm", event.getRealmName());
        appendField(sb, "type", event.getType() == null ? null : event.getType().name());
        appendField(sb, "error", event.getError());
        appendField(sb, "ip", event.getIpAddress());
        appendField(sb, "client_id", event.getClientId());
        appendField(sb, "user_id", event.getUserId());

        String username = null;
        Map<String, String> details = event.getDetails();
        if (details != null) {
            username = details.get("username");
        }
        appendField(sb, "username", username);

        sb.append('}');
        return sb.toString();
    }

    static String toJsonLine(AdminEvent event) {
        StringBuilder sb = new StringBuilder(256);
        sb.append('{');
        appendField(sb, "kind", "admin_event");
        appendField(sb, "ts", Instant.ofEpochMilli(event.getTime()).toString());
        appendField(sb, "realm", event.getRealmName());
        appendField(sb, "operation", event.getOperationType() == null ? null : event.getOperationType().name());
        appendField(sb, "resource_type", event.getResourceType() == null ? null : event.getResourceType().name());
        appendField(sb, "resource_path", event.getResourcePath());
        appendField(sb, "error", event.getError());

        AuthDetails auth = event.getAuthDetails();
        if (auth != null) {
            appendField(sb, "ip", auth.getIpAddress());
            appendField(sb, "client_id", auth.getClientId());
            appendField(sb, "user_id", auth.getUserId());
        }

        sb.append('}');
        return sb.toString();
    }

    private static void appendField(StringBuilder sb, String key, String value) {
        if (sb.length() > 1) {
            sb.append(',');
        }
        sb.append('"').append(escape(key)).append('"').append(':');
        if (value == null) {
            sb.append("null");
            return;
        }
        sb.append('"').append(escape(value)).append('"');
    }

    private static String escape(String value) {
        StringBuilder out = new StringBuilder(value.length() + 8);
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '\\' -> out.append("\\\\");
                case '"' -> out.append("\\\"");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> out.append(c);
            }
        }
        return out.toString();
    }
}
