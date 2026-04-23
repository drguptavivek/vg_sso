package tech.epidemiology.keycloak.asyncmail;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

public class AsyncEmailExportService {
  public static final String STATUS_QUEUED = "queued";
  public static final String STATUS_SENDING = "sending";
  public static final String STATUS_SENT = "sent";
  public static final String STATUS_FAILED_RETRYABLE = "failed_retryable";
  public static final String STATUS_DEAD_LETTER = "dead_letter";

  public static final String CATEGORY_EXECUTE_ACTIONS = "execute-actions";
  public static final String CATEGORY_VERIFY_EMAIL = "verify-email";
  public static final String CATEGORY_PASSWORD_RESET = "password-reset";
  public static final String CATEGORY_EMAIL_UPDATE = "email-update-confirmation";
  public static final String CATEGORY_ORG_INVITE = "org-invite";
  public static final String CATEGORY_SMTP_TEST = "smtp-test";
  public static final String CATEGORY_EVENT_NOTIFICATION = "event-notification";
  public static final String CATEGORY_GENERIC_TEMPLATE = "generic-template";
  public static final String CATEGORY_UNKNOWN = "unknown";

  private static final String[] DEFAULT_EXPORT_COLUMNS = {
      "id",
      "realm_name",
      "category",
      "status",
      "recipient_masked",
      "subject",
      "template_name",
      "created_at",
      "sent_at",
      "failed_at",
      "retry_count",
      "last_error_summary"
  };

  private static final int DEFAULT_EXPORT_MAX_ROWS = 10000;
  private static final int DEFAULT_LIST_MAX = 100;
  private static final int MAX_LIST_MAX = 500;

  private final int exportMaxRows;
  private final Map<String, MailRecord> byId = new ConcurrentHashMap<>();

  public AsyncEmailExportService() {
    this(resolveExportMaxRows());
  }

  public AsyncEmailExportService(int exportMaxRows) {
    this.exportMaxRows = Math.max(1, exportMaxRows);
  }

  public int getExportMaxRows() {
    return exportMaxRows;
  }

  public int normalizeFirst(Integer first) {
    if (first == null || first < 0) {
      return 0;
    }
    return first;
  }

  public int normalizeMax(Integer max) {
    if (max == null) {
      return DEFAULT_LIST_MAX;
    }
    if (max < 1) {
      return 1;
    }
    return Math.min(max, MAX_LIST_MAX);
  }

  public void save(MailRecord record) {
    byId.put(record.id(), record);
  }

  public MailRecord findById(String id) {
    if (id == null) {
      return null;
    }
    return byId.get(id);
  }

  public List<MailRecord> queryMessages(
      String realmName,
      String status,
      String category,
      String queryText,
      Instant createdFrom,
      Instant createdTo,
      Integer first,
      Integer max) {
    List<MailRecord> rows = filterRows(realmName, status, category, queryText, createdFrom, createdTo);
    int safeFirst = normalizeFirst(first);
    int safeMax = normalizeMax(max);
    if (safeFirst >= rows.size()) {
      return List.of();
    }
    return rows.subList(safeFirst, Math.min(safeFirst + safeMax, rows.size()));
  }

  public int countMessages(
      String realmName,
      String status,
      String category,
      String queryText,
      Instant createdFrom,
      Instant createdTo) {
    return filterRows(realmName, status, category, queryText, createdFrom, createdTo).size();
  }

  public List<MailRecord> queryFailures(
      String realmName,
      String queryText,
      Instant createdFrom,
      Instant createdTo,
      Integer first,
      Integer max) {
    Set<String> failureStatuses = Set.of(STATUS_FAILED_RETRYABLE, STATUS_DEAD_LETTER);
    List<MailRecord> rows = filterRows(realmName, null, null, queryText, createdFrom, createdTo)
        .stream()
        .filter(r -> failureStatuses.contains(r.status()))
        .toList();
    int safeFirst = normalizeFirst(first);
    int safeMax = normalizeMax(max);
    if (safeFirst >= rows.size()) {
      return List.of();
    }
    return rows.subList(safeFirst, Math.min(safeFirst + safeMax, rows.size()));
  }

  public long countFailures(String realmName, String queryText, Instant createdFrom, Instant createdTo) {
    return queryFailures(realmName, queryText, createdFrom, createdTo, 0, Integer.MAX_VALUE).size();
  }

  public List<MailRecord> queryRecentFailures(String realmName, int maxRows) {
    return filterRows(realmName, null, null, null, null, null)
        .stream()
        .filter(r -> r.status().equals(STATUS_FAILED_RETRYABLE) || r.status().equals(STATUS_DEAD_LETTER))
        .sorted(Comparator.comparing(MailRecord::failedAt, Comparator.nullsLast(Comparator.reverseOrder())))
        .limit(maxRows)
        .toList();
  }

  public List<MailRecord> queryRecentSends(String realmName, int maxRows) {
    return filterRows(realmName, STATUS_SENT, null, null, null, null)
        .stream()
        .sorted(Comparator.comparing(MailRecord::sentAt, Comparator.nullsLast(Comparator.reverseOrder())))
        .limit(maxRows)
        .toList();
  }

  public Map<String, Integer> countByStatus(String realmName) {
    Map<String, Integer> counts = new LinkedHashMap<>();
    counts.put(STATUS_QUEUED, 0);
    counts.put(STATUS_SENDING, 0);
    counts.put(STATUS_SENT, 0);
    counts.put(STATUS_FAILED_RETRYABLE, 0);
    counts.put(STATUS_DEAD_LETTER, 0);
    for (MailRecord row : filterRows(realmName, null, null, null, null, null)) {
      counts.put(row.status(), counts.getOrDefault(row.status(), 0) + 1);
    }
    return counts;
  }

  public Map<String, Integer> countByCategory(String realmName) {
    Map<String, Integer> counts = new HashMap<>();
    for (MailRecord row : filterRows(realmName, null, null, null, null, null)) {
      counts.put(row.category(), counts.getOrDefault(row.category(), 0) + 1);
    }
    return counts;
  }

  public Long oldestQueuedAgeSeconds(String realmName) {
    return filterRows(realmName, STATUS_QUEUED, null, null, null, null)
        .stream()
        .map(MailRecord::createdAt)
        .filter(ts -> ts != null)
        .min(Comparator.naturalOrder())
        .map(ts -> java.time.Duration.between(ts, Instant.now()).toSeconds())
        .orElse(null);
  }

  public boolean markRetry(String realmName, String id) {
    MailRecord record = byId.get(id);
    if (record == null) {
      return false;
    }
    if (!record.realmName().equals(realmName)) {
      return false;
    }
    if (!(STATUS_FAILED_RETRYABLE.equals(record.status()) || STATUS_DEAD_LETTER.equals(record.status()))) {
      return false;
    }
    byId.put(id, new MailRecord(
        record.id(),
        record.realmName(),
        record.category(),
        STATUS_QUEUED,
        record.recipientMasked(),
        record.subject(),
        record.templateName(),
        record.username(),
        record.createdAt(),
        null,
        null,
        record.retryCount() + 1,
        null));
    return true;
  }

  public String toCsv(List<MailRecord> rows) {
    List<MailRecord> safeRows = limitRows(rows);
    StringBuilder csv = new StringBuilder();
    csv.append(String.join(",", DEFAULT_EXPORT_COLUMNS)).append('\n');
    for (MailRecord row : safeRows) {
      csv.append(escapeCsv(row.id())).append(',')
          .append(escapeCsv(row.realmName())).append(',')
          .append(escapeCsv(row.category())).append(',')
          .append(escapeCsv(row.status())).append(',')
          .append(escapeCsv(row.recipientMasked())).append(',')
          .append(escapeCsv(row.subject())).append(',')
          .append(escapeCsv(row.templateName())).append(',')
          .append(escapeInstant(row.createdAt())).append(',')
          .append(escapeInstant(row.sentAt())).append(',')
          .append(escapeInstant(row.failedAt())).append(',')
          .append(row.retryCount()).append(',')
          .append(quoteCsv(row.lastErrorSummary())).append('\n');
    }
    if (!safeRows.isEmpty()) {
      csv.setLength(csv.length() - 1);
    }
    return csv.toString();
  }

  public String toTxt(List<MailRecord> rows) {
    List<MailRecord> safeRows = limitRows(rows);
    StringBuilder txt = new StringBuilder();
    txt.append(String.join("|", DEFAULT_EXPORT_COLUMNS)).append('\n');
    for (MailRecord row : safeRows) {
      txt.append(escapeTxt(row.id())).append('|')
          .append(escapeTxt(row.realmName())).append('|')
          .append(escapeTxt(row.category())).append('|')
          .append(escapeTxt(row.status())).append('|')
          .append(escapeTxt(row.recipientMasked())).append('|')
          .append(escapeTxt(row.subject())).append('|')
          .append(escapeTxt(row.templateName())).append('|')
          .append(escapeInstant(row.createdAt())).append('|')
          .append(escapeInstant(row.sentAt())).append('|')
          .append(escapeInstant(row.failedAt())).append('|')
          .append(row.retryCount()).append('|')
          .append(escapeTxt(row.lastErrorSummary())).append('\n');
    }
    if (!safeRows.isEmpty()) {
      txt.setLength(txt.length() - 1);
    }
    return txt.toString();
  }

  private List<MailRecord> filterRows(
      String realmName,
      String status,
      String category,
      String queryText,
      Instant createdFrom,
      Instant createdTo) {
    String normalizedStatus = trimToLowerOrNull(status);
    String normalizedCategory = trimToLowerOrNull(category);
    String normalizedQuery = trimToLowerOrNull(queryText);

    return byId.values().stream()
        .filter(r -> realmName == null || realmName.equals(r.realmName()))
        .filter(r -> normalizedStatus == null || normalizedStatus.equals(r.status()))
        .filter(r -> normalizedCategory == null || normalizedCategory.equals(r.category()))
        .filter(r -> createdFrom == null || r.createdAt() == null || !r.createdAt().isBefore(createdFrom))
        .filter(r -> createdTo == null || r.createdAt() == null || !r.createdAt().isAfter(createdTo))
        .filter(r -> {
          if (normalizedQuery == null) {
            return true;
          }
          return (
              containsNormalized(r.subject(), normalizedQuery)
                  || containsNormalized(r.username(), normalizedQuery)
                  || containsNormalized(r.recipientMasked(), normalizedQuery));
        })
        .sorted(Comparator.comparing(MailRecord::createdAt, Comparator.nullsLast(Comparator.reverseOrder())))
        .collect(Collectors.toList());
  }

  private List<MailRecord> limitRows(List<MailRecord> rows) {
    if (rows == null || rows.isEmpty()) {
      return List.of();
    }
    if (rows.size() <= exportMaxRows) {
      return rows;
    }
    return rows.subList(0, exportMaxRows);
  }

  private static String escapeCsv(String value) {
    String v = value == null ? "" : value;
    boolean mustQuote = v.contains(",") || v.contains("\"") || v.contains("\n") || v.contains("\r");
    if (!mustQuote) {
      return v;
    }
    return "\"" + v.replace("\"", "\"\"") + "\"";
  }

  private static String quoteCsv(String value) {
    String v = value == null ? "" : value;
    return "\"" + v.replace("\"", "\"\"") + "\"";
  }

  private static String escapeTxt(String value) {
    String v = value == null ? "" : value;
    return v.replace("|", "\\|").replace("\n", " ").replace("\r", " ");
  }

  private static String escapeInstant(Instant value) {
    if (value == null) {
      return "";
    }
    return DateTimeFormatter.ISO_INSTANT.format(value);
  }

  private static boolean containsNormalized(String value, String query) {
    return value != null && value.toLowerCase().contains(query);
  }

  private static String trimToLowerOrNull(String value) {
    if (value == null) {
      return null;
    }
    String normalized = value.trim().toLowerCase();
    return normalized.isEmpty() ? null : normalized;
  }

  private static int resolveExportMaxRows() {
    String raw = System.getenv().getOrDefault("KC_ASYNC_EMAIL_EXPORT_MAX_ROWS", String.valueOf(DEFAULT_EXPORT_MAX_ROWS));
    try {
      return Integer.parseInt(raw);
    } catch (NumberFormatException ex) {
      return DEFAULT_EXPORT_MAX_ROWS;
    }
  }

  public record MailRecord(
      String id,
      String realmName,
      String category,
      String status,
      String recipientMasked,
      String subject,
      String templateName,
      String username,
      Instant createdAt,
      Instant sentAt,
      Instant failedAt,
      int retryCount,
      String lastErrorSummary) {
  }
}
