package tech.epidemiology.keycloak.asyncmail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import org.junit.jupiter.api.Test;
import org.keycloak.models.ClientModel;
import org.keycloak.models.RealmModel;

class AsyncEmailAdminResourceProviderTest {

  @Test
  void normalizeQueryHelpersClampPaginationAndText() {
    assertThat(AsyncEmailAdminResourceProvider.normalizeFirst(null)).isZero();
    assertThat(AsyncEmailAdminResourceProvider.normalizeFirst(-5)).isZero();
    assertThat(AsyncEmailAdminResourceProvider.normalizeFirst(4)).isEqualTo(4);

    assertThat(AsyncEmailAdminResourceProvider.normalizeMax(null)).isEqualTo(100);
    assertThat(AsyncEmailAdminResourceProvider.normalizeMax(0)).isEqualTo(1);
    assertThat(AsyncEmailAdminResourceProvider.normalizeMax(501)).isEqualTo(500);
    assertThat(AsyncEmailAdminResourceProvider.normalizeMax(25)).isEqualTo(25);

    assertThat(AsyncEmailAdminResourceProvider.normalizeTextFilter(null)).isEmpty();
    assertThat(AsyncEmailAdminResourceProvider.normalizeTextFilter("  Hi There  ")).isEqualTo("hi there");
  }

  @Test
  void messageProjectionDropsInternalFields() {
    AsyncEmailAdminResourceProvider.MailRecordDto dto = AsyncEmailAdminResourceProvider.toMessageDto(
        new AsyncEmailExportService.MailRecord(
            "row-id",
            "org",
            AsyncEmailExportService.CATEGORY_EVENT_NOTIFICATION,
            AsyncEmailExportService.STATUS_SENT,
            "c***e@example.com",
            "Subject one",
            "tpl",
            "alice",
            Instant.parse("2026-01-15T10:00:00Z"),
            Instant.parse("2026-01-15T10:01:00Z"),
            null,
            2,
            "all good"));

    assertThat(dto.id()).isEqualTo("row-id");
    assertThat(dto.recipientMasked()).isEqualTo("c***e@example.com");
    assertThat(dto.username()).isEqualTo("alice");
    assertThat(dto.status()).isEqualTo(AsyncEmailExportService.STATUS_SENT);
    assertThat(dto.toMap()).containsEntry("retry_count", 2);
    assertThat(dto.toMap()).containsEntry("username", "alice");
    assertThat(dto.toMap()).doesNotContainKey("payload_json");
    assertThat(dto.toMap().get("id")).isEqualTo("row-id");
  }

  @Test
  void resolvesAdminRolesClientForMasterAndRealmDashboards() {
    RealmModel masterRealm = mock(RealmModel.class);
    ClientModel masterRealmClient = mock(ClientModel.class);
    when(masterRealm.getName()).thenReturn("master");
    when(masterRealm.getClientByClientId("master-realm")).thenReturn(masterRealmClient);

    assertThat(AsyncEmailAdminResourceProvider.adminRolesClientId(masterRealm)).isEqualTo("master-realm");
    assertThat(AsyncEmailAdminResourceProvider.resolveAdminRolesClient(masterRealm)).isSameAs(masterRealmClient);
    verify(masterRealm).getClientByClientId("master-realm");

    RealmModel tenantRealm = mock(RealmModel.class);
    ClientModel realmManagementClient = mock(ClientModel.class);
    when(tenantRealm.getName()).thenReturn("aiims-new-delhi");
    when(tenantRealm.getClientByClientId("realm-management")).thenReturn(realmManagementClient);

    assertThat(AsyncEmailAdminResourceProvider.adminRolesClientId(tenantRealm)).isEqualTo("realm-management");
    assertThat(AsyncEmailAdminResourceProvider.resolveAdminRolesClient(tenantRealm)).isSameAs(realmManagementClient);
    verify(tenantRealm).getClientByClientId("realm-management");
  }

  @Test
  void parseDateRangeReturnsNullForBlankAndThrowsForInvalid() {
    assertThat(AsyncEmailAdminResourceProvider.parseIsoDate(null)).isNull();
    assertThat(AsyncEmailAdminResourceProvider.parseIsoDate("")).isNull();
    try {
      AsyncEmailAdminResourceProvider.parseIsoDate("not-a-date");
      throw new AssertionError("Expected DateTimeParseException");
    } catch (DateTimeParseException expected) {
      assertThat(expected).isInstanceOf(DateTimeParseException.class);
    }
  }
}
