package tech.epidemiology.keycloak.failurelogs;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.keycloak.events.Event;
import org.keycloak.events.EventType;
import org.keycloak.events.admin.AdminEvent;
import org.keycloak.events.admin.AuthDetails;
import org.keycloak.events.admin.OperationType;
import org.keycloak.events.admin.ResourceType;

class FailureLogsEventFilterAndFormatterTest {

    @Test
    void shouldLogLoginErrorUserEvent() {
        Event e = new Event();
        e.setType(EventType.LOGIN_ERROR);
        e.setError("invalid_user_credentials");
        e.setRealmName("org-new-delhi");
        e.setIpAddress("10.0.0.9");
        e.setClientId("account-console");
        e.setUserId("u1");
        e.setDetails(Map.of("username", "alice"));

        assertThat(FailureLogsEventFormatter.shouldLog(e)).isTrue();

        String line = FailureLogsEventFormatter.toJsonLine(e);
        assertThat(line).contains("\"kind\":\"user_event\"")
            .contains("\"type\":\"LOGIN_ERROR\"")
            .contains("\"error\":\"invalid_user_credentials\"")
            .contains("\"ip\":\"10.0.0.9\"")
            .contains("\"username\":\"alice\"");
    }

    @Test
    void shouldNotLogSuccessfulLoginUserEvent() {
        Event e = new Event();
        e.setType(EventType.LOGIN);
        e.setRealmName("org-new-delhi");

        assertThat(FailureLogsEventFormatter.shouldLog(e)).isFalse();
    }

    @Test
    void shouldLogTemporaryLockoutEventEvenWithoutError() {
        Event e = new Event();
        e.setType(EventType.USER_DISABLED_BY_TEMPORARY_LOCKOUT);
        e.setRealmName("org-new-delhi");
        e.setIpAddress("10.0.0.11");

        assertThat(FailureLogsEventFormatter.shouldLog(e)).isTrue();
        assertThat(FailureLogsEventFormatter.toJsonLine(e)).contains("USER_DISABLED_BY_TEMPORARY_LOCKOUT");
    }

    @Test
    void shouldLogAdminErrorEvent() {
        AdminEvent e = new AdminEvent();
        e.setOperationType(OperationType.UPDATE);
        e.setResourceType(ResourceType.USER);
        e.setResourcePath("users/abc");
        e.setError("forbidden");
        e.setRealmName("org-new-delhi");

        AuthDetails auth = new AuthDetails();
        auth.setUserId("admin-user-id");
        auth.setIpAddress("10.10.10.5");
        auth.setClientId("security-admin-console");
        e.setAuthDetails(auth);

        assertThat(FailureLogsEventFormatter.shouldLog(e)).isTrue();

        String line = FailureLogsEventFormatter.toJsonLine(e);
        assertThat(line).contains("\"kind\":\"admin_event\"")
            .contains("\"error\":\"forbidden\"")
            .contains("\"operation\":\"UPDATE\"")
            .contains("\"resource_type\":\"USER\"")
            .contains("\"ip\":\"10.10.10.5\"");
    }
}
