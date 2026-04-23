package tech.epidemiology.keycloak.asyncmail;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.keycloak.connections.jpa.JpaConnectionProvider;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

public final class AsyncEmailDatabaseRepository {
    private static final int MAX_ERROR_SUMMARY = 512;

    private final KeycloakSession session;

    public AsyncEmailDatabaseRepository(KeycloakSession session) {
        this.session = session;
    }

    public void ensureSchema() {
        EntityManager em = entityManager();
        em.createNativeQuery(AsyncEmailQueueSchema.CREATE_TABLE).executeUpdate();
        em.createNativeQuery(AsyncEmailQueueSchema.CREATE_INDEX_STATUS_NEXT_ATTEMPT).executeUpdate();
        em.createNativeQuery(AsyncEmailQueueSchema.CREATE_INDEX_REALM_CREATED_AT).executeUpdate();
        em.createNativeQuery(AsyncEmailQueueSchema.CREATE_INDEX_CATEGORY_CREATED_AT).executeUpdate();
        em.createNativeQuery(AsyncEmailQueueSchema.CREATE_INDEX_CREATED_AT).executeUpdate();
    }

    public void enqueue(
        RealmModel realm,
        AsyncEmailSenderProvider.RequestContext requestContext,
        String address,
        String subject,
        String textBody,
        String htmlBody,
        UserModel user
    ) {
        ensureSchema();
        Instant now = Instant.now();
        Query query = entityManager().createNativeQuery("""
            INSERT INTO kc_vg_async_mail_queue (
              id, realm_name, category, status, recipient_masked, recipient_domain, subject, template_name,
              event_type, user_id, username, created_at, updated_at, queued_at, next_attempt_at,
              sent_at, failed_at, retry_count, last_error_summary, payload_json, payload_scrubbed, worker_node
            ) VALUES (
              :id, :realm_name, :category, :status, :recipient_masked, :recipient_domain, :subject, :template_name,
              :event_type, :user_id, :username, :created_at, :updated_at, :queued_at, :next_attempt_at,
              :sent_at, :failed_at, :retry_count, :last_error_summary, :payload_json, :payload_scrubbed, :worker_node
            )
            """);
        query.setParameter("id", java.util.UUID.randomUUID().toString());
        query.setParameter("realm_name", realm.getName());
        query.setParameter("category", requestContext.category().value());
        query.setParameter("status", AsyncEmailQueueRecord.Status.QUEUED.value());
        query.setParameter("recipient_masked", AsyncEmailMasking.maskEmail(address));
        query.setParameter("recipient_domain", domain(address));
        query.setParameter("subject", subject);
        query.setParameter("template_name", requestContext.templateName() == null ? "" : requestContext.templateName());
        query.setParameter("event_type", requestContext.eventType() == null ? "" : requestContext.eventType());
        query.setParameter("user_id", user == null ? "" : user.getId());
        query.setParameter("username", user == null ? "" : user.getUsername());
        query.setParameter("created_at", Timestamp.from(now));
        query.setParameter("updated_at", Timestamp.from(now));
        query.setParameter("queued_at", Timestamp.from(now));
        query.setParameter("next_attempt_at", Timestamp.from(now));
        query.setParameter("sent_at", null);
        query.setParameter("failed_at", null);
        query.setParameter("retry_count", 0);
        query.setParameter("last_error_summary", null);
        query.setParameter("payload_json", encodePayload(address, textBody, htmlBody));
        query.setParameter("payload_scrubbed", false);
        query.setParameter("worker_node", null);
        query.executeUpdate();
    }

    public Map<String, Integer> countByStatus(String realmName) {
        ensureSchema();
        Map<String, Integer> counts = new LinkedHashMap<>();
        counts.put("queued", 0);
        counts.put("sending", 0);
        counts.put("sent", 0);
        counts.put("failed_retryable", 0);
        counts.put("dead_letter", 0);
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager().createNativeQuery("""
            SELECT status, COUNT(*)
            FROM kc_vg_async_mail_queue
            WHERE realm_name = :realm_name
            GROUP BY status
            """)
            .setParameter("realm_name", realmName)
            .getResultList();
        for (Object[] row : rows) {
            counts.put(String.valueOf(row[0]), ((Number) row[1]).intValue());
        }
        return counts;
    }

    public Map<String, Integer> countByCategory(String realmName) {
        ensureSchema();
        Map<String, Integer> counts = new LinkedHashMap<>();
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager().createNativeQuery("""
            SELECT category, COUNT(*)
            FROM kc_vg_async_mail_queue
            WHERE realm_name = :realm_name
            GROUP BY category
            ORDER BY category
            """)
            .setParameter("realm_name", realmName)
            .getResultList();
        for (Object[] row : rows) {
            counts.put(String.valueOf(row[0]), ((Number) row[1]).intValue());
        }
        return counts;
    }

    public long oldestQueuedAgeSeconds(String realmName) {
        ensureSchema();
        Object result = entityManager().createNativeQuery("""
            SELECT EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MIN(created_at)))
            FROM kc_vg_async_mail_queue
            WHERE realm_name = :realm_name AND status = 'queued'
            """)
            .setParameter("realm_name", realmName)
            .getSingleResult();
        if (result == null) {
            return 0L;
        }
        return ((Number) result).longValue();
    }

    public int countMessages(String realmName, String status, String category, String q, Instant from, Instant to) {
        ensureSchema();
        QuerySpec spec = buildListQuery(true, false, realmName, status, category, q, from, to, 0, 0);
        Object result = bind(entityManager().createNativeQuery(spec.sql()), spec).getSingleResult();
        return ((Number) result).intValue();
    }

    public List<AsyncEmailExportService.MailRecord> listMessages(
        String realmName,
        String status,
        String category,
        String q,
        Instant from,
        Instant to,
        int first,
        int max
    ) {
        ensureSchema();
        QuerySpec spec = buildListQuery(false, false, realmName, status, category, q, from, to, first, max);
        @SuppressWarnings("unchecked")
        List<Object[]> rows = bind(entityManager().createNativeQuery(spec.sql()), spec).getResultList();
        return rows.stream().map(this::toMailRecord).toList();
    }

    public List<AsyncEmailExportService.MailRecord> listFailures(String realmName, String q, Instant from, Instant to, int first, int max) {
        ensureSchema();
        QuerySpec spec = buildListQuery(false, true, realmName, null, null, q, from, to, first, max);
        @SuppressWarnings("unchecked")
        List<Object[]> rows = bind(entityManager().createNativeQuery(spec.sql()), spec).getResultList();
        return rows.stream().map(this::toMailRecord).toList();
    }

    public int countFailures(String realmName, String q, Instant from, Instant to) {
        ensureSchema();
        QuerySpec spec = buildListQuery(true, true, realmName, null, null, q, from, to, 0, 0);
        Object result = bind(entityManager().createNativeQuery(spec.sql()), spec).getSingleResult();
        return ((Number) result).intValue();
    }

    public boolean retry(String realmName, String id) {
        ensureSchema();
        int updated = entityManager().createNativeQuery("""
            UPDATE kc_vg_async_mail_queue
            SET status = 'queued',
                updated_at = CURRENT_TIMESTAMP,
                next_attempt_at = CURRENT_TIMESTAMP,
                failed_at = NULL,
                last_error_summary = NULL,
                worker_node = NULL
            WHERE realm_name = :realm_name
              AND id = :id
              AND status IN ('failed_retryable', 'dead_letter')
            """)
            .setParameter("realm_name", realmName)
            .setParameter("id", id)
            .executeUpdate();
        return updated > 0;
    }

    public List<AsyncEmailQueueRecord> claimDueRows(int limit, String workerNode, Instant now) {
        ensureSchema();
        if (limit <= 0) {
            return List.of();
        }
        Instant effectiveNow = now == null ? Instant.now() : now;
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager().createNativeQuery("""
            SELECT id, realm_name, category, status, recipient_masked, recipient_domain, subject, template_name,
                   event_type, user_id, username, created_at, updated_at, queued_at, next_attempt_at, sent_at,
                   failed_at, retry_count, last_error_summary, payload_json, payload_scrubbed, worker_node
            FROM kc_vg_async_mail_queue
            WHERE status IN ('queued', 'failed_retryable')
              AND COALESCE(next_attempt_at, created_at) <= :now_ts
            ORDER BY created_at ASC, id ASC
            LIMIT :limit
            FOR UPDATE SKIP LOCKED
            """)
            .setParameter("now_ts", Timestamp.from(effectiveNow))
            .setParameter("limit", limit)
            .getResultList();

        List<AsyncEmailQueueRecord> claimed = new ArrayList<>(rows.size());
        for (Object[] row : rows) {
            String id = String.valueOf(row[0]);
            int updated = entityManager().createNativeQuery("""
                UPDATE kc_vg_async_mail_queue
                SET status = 'sending',
                    updated_at = :updated_at,
                    worker_node = :worker_node
                WHERE id = :id
                  AND status IN ('queued', 'failed_retryable')
                """)
                .setParameter("updated_at", Timestamp.from(effectiveNow))
                .setParameter("worker_node", workerNode)
                .setParameter("id", id)
                .executeUpdate();
            if (updated <= 0) {
                continue;
            }
            row[3] = "sending";
            row[12] = Timestamp.from(effectiveNow);
            row[21] = workerNode;
            claimed.add(toQueueRecord(row));
        }
        return claimed;
    }

    public void markSent(String id, String workerNode, Instant now) {
        ensureSchema();
        Instant effectiveNow = now == null ? Instant.now() : now;
        entityManager().createNativeQuery("""
            UPDATE kc_vg_async_mail_queue
            SET status = 'sent',
                updated_at = :updated_at,
                sent_at = :sent_at,
                next_attempt_at = NULL
            WHERE id = :id
              AND worker_node = :worker_node
              AND status = 'sending'
            """)
            .setParameter("updated_at", Timestamp.from(effectiveNow))
            .setParameter("sent_at", Timestamp.from(effectiveNow))
            .setParameter("id", id)
            .setParameter("worker_node", workerNode)
            .executeUpdate();
    }

    public void markRetryable(String id, String errorSummary, int retryCount, Instant nextAttemptAt, String workerNode, Instant now) {
        ensureSchema();
        Instant effectiveNow = now == null ? Instant.now() : now;
        entityManager().createNativeQuery("""
            UPDATE kc_vg_async_mail_queue
            SET status = 'failed_retryable',
                updated_at = :updated_at,
                failed_at = :failed_at,
                retry_count = :retry_count,
                next_attempt_at = :next_attempt_at,
                last_error_summary = :last_error_summary
            WHERE id = :id
              AND worker_node = :worker_node
              AND status = 'sending'
            """)
            .setParameter("updated_at", Timestamp.from(effectiveNow))
            .setParameter("failed_at", Timestamp.from(effectiveNow))
            .setParameter("retry_count", Math.max(1, retryCount))
            .setParameter("next_attempt_at", Timestamp.from(nextAttemptAt == null ? effectiveNow : nextAttemptAt))
            .setParameter("last_error_summary", trimErrorSummary(errorSummary))
            .setParameter("id", id)
            .setParameter("worker_node", workerNode)
            .executeUpdate();
    }

    public void markDeadLetter(String id, String errorSummary, int retryCount, String workerNode, Instant now) {
        ensureSchema();
        Instant effectiveNow = now == null ? Instant.now() : now;
        entityManager().createNativeQuery("""
            UPDATE kc_vg_async_mail_queue
            SET status = 'dead_letter',
                updated_at = :updated_at,
                failed_at = :failed_at,
                retry_count = :retry_count,
                next_attempt_at = NULL,
                last_error_summary = :last_error_summary
            WHERE id = :id
              AND worker_node = :worker_node
              AND status = 'sending'
            """)
            .setParameter("updated_at", Timestamp.from(effectiveNow))
            .setParameter("failed_at", Timestamp.from(effectiveNow))
            .setParameter("retry_count", Math.max(1, retryCount))
            .setParameter("last_error_summary", trimErrorSummary(errorSummary))
            .setParameter("id", id)
            .setParameter("worker_node", workerNode)
            .executeUpdate();
    }

    public void scrubPayload(String id, Instant now) {
        ensureSchema();
        Instant effectiveNow = now == null ? Instant.now() : now;
        entityManager().createNativeQuery("""
            UPDATE kc_vg_async_mail_queue
            SET updated_at = :updated_at,
                payload_json = NULL,
                payload_scrubbed = TRUE
            WHERE id = :id
            """)
            .setParameter("updated_at", Timestamp.from(effectiveNow))
            .setParameter("id", id)
            .executeUpdate();
    }

    public int deleteExpiredRows(Instant cutoff) {
        ensureSchema();
        if (cutoff == null) {
            return 0;
        }
        return entityManager().createNativeQuery("""
            DELETE FROM kc_vg_async_mail_queue
            WHERE created_at < :cutoff
            """)
            .setParameter("cutoff", Timestamp.from(cutoff))
            .executeUpdate();
    }

    private QuerySpec buildListQuery(
        boolean countOnly,
        boolean failuresOnly,
        String realmName,
        String status,
        String category,
        String q,
        Instant from,
        Instant to,
        int first,
        int max
    ) {
        StringBuilder sql = new StringBuilder();
        sql.append(countOnly
            ? "SELECT COUNT(*) FROM kc_vg_async_mail_queue WHERE realm_name = :realm_name"
            : """
              SELECT id, realm_name, category, status, recipient_masked, subject, template_name, username,
                     created_at, sent_at, failed_at, retry_count, last_error_summary
              FROM kc_vg_async_mail_queue
              WHERE realm_name = :realm_name
              """);
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("realm_name", realmName);
        if (status != null && !status.isBlank()) {
            sql.append(" AND status = :status");
            params.put("status", status);
        }
        if (failuresOnly) {
            sql.append(" AND status IN ('failed_retryable', 'dead_letter')");
        }
        if (category != null && !category.isBlank()) {
            sql.append(" AND category = :category");
            params.put("category", category);
        }
        if (q != null && !q.isBlank()) {
            sql.append(" AND (LOWER(subject) LIKE :q OR LOWER(username) LIKE :q OR LOWER(recipient_masked) LIKE :q)");
            params.put("q", "%" + q.toLowerCase() + "%");
        }
        if (from != null) {
            sql.append(" AND created_at >= :from_ts");
            params.put("from_ts", Timestamp.from(from));
        }
        if (to != null) {
            sql.append(" AND created_at <= :to_ts");
            params.put("to_ts", Timestamp.from(to));
        }
        if (!countOnly) {
            sql.append(" ORDER BY created_at DESC OFFSET :offset LIMIT :limit");
            params.put("offset", Math.max(0, first));
            params.put("limit", Math.max(1, max));
        }
        return new QuerySpec(sql.toString(), params);
    }

    private Query bind(Query query, QuerySpec spec) {
        for (Map.Entry<String, Object> entry : spec.params().entrySet()) {
            query.setParameter(entry.getKey(), entry.getValue());
        }
        return query;
    }

    private AsyncEmailExportService.MailRecord toMailRecord(Object[] row) {
        return new AsyncEmailExportService.MailRecord(
            String.valueOf(row[0]),
            String.valueOf(row[1]),
            String.valueOf(row[2]),
            String.valueOf(row[3]),
            String.valueOf(row[4]),
            stringValue(row[5]),
            stringValue(row[6]),
            stringValue(row[7]),
            toInstant(row[8]),
            toInstant(row[9]),
            toInstant(row[10]),
            row[11] == null ? 0 : ((Number) row[11]).intValue(),
            stringValue(row[12]));
    }

    private AsyncEmailQueueRecord toQueueRecord(Object[] row) {
        return new AsyncEmailQueueRecord(
            String.valueOf(row[0]),
            stringValue(row[1]),
            AsyncEmailQueueRecord.Category.from(stringValue(row[2])).orElse(AsyncEmailQueueRecord.Category.UNKNOWN),
            AsyncEmailQueueRecord.Status.from(stringValue(row[3])).orElse(AsyncEmailQueueRecord.Status.QUEUED),
            stringValue(row[4]),
            stringValue(row[5]),
            stringValue(row[6]),
            stringValue(row[7]),
            stringValue(row[8]),
            stringValue(row[9]),
            stringValue(row[10]),
            toInstant(row[11]),
            toInstant(row[12]),
            toInstant(row[13]),
            toInstant(row[14]),
            toInstant(row[15]),
            toInstant(row[16]),
            row[17] == null ? 0 : ((Number) row[17]).intValue(),
            stringValue(row[18]),
            stringValue(row[19]),
            row[20] instanceof Boolean b ? b : Boolean.parseBoolean(stringValue(row[20])),
            stringValue(row[21]));
    }

    private Instant toInstant(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Timestamp ts) {
            return ts.toInstant();
        }
        if (value instanceof OffsetDateTime offsetDateTime) {
            return offsetDateTime.toInstant();
        }
        if (value instanceof LocalDateTime localDateTime) {
            return localDateTime.toInstant(ZoneOffset.UTC);
        }
        if (value instanceof java.util.Date date) {
            return date.toInstant();
        }
        String text = String.valueOf(value).trim();
        if (text.isEmpty()) {
            return null;
        }
        try {
            return Instant.parse(text);
        } catch (java.time.format.DateTimeParseException ignored) {
            return LocalDateTime.parse(text).toInstant(ZoneOffset.UTC);
        }
    }

    private String stringValue(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private String domain(String address) {
        if (address == null) {
            return "";
        }
        int at = address.indexOf('@');
        return at < 0 ? "" : address.substring(at + 1).toLowerCase();
    }

    private String encodePayload(String address, String textBody, String htmlBody) {
        return "recipient=" + encodeField(address) + "\n"
            + "text=" + encodeField(textBody) + "\n"
            + "html=" + encodeField(htmlBody);
    }

    public DeliveryPayload decodePayload(String payloadJson) {
        String recipient = "";
        String text = null;
        String html = null;
        String[] lines = payloadJson == null ? new String[0] : payloadJson.split("\\n");
        for (String line : lines) {
            int idx = line.indexOf('=');
            if (idx <= 0) {
                continue;
            }
            String key = line.substring(0, idx);
            String value = decodeField(line.substring(idx + 1));
            switch (key) {
                case "recipient" -> recipient = value == null ? "" : value;
                case "text" -> text = value;
                case "html" -> html = value;
                default -> { }
            }
        }
        return new DeliveryPayload(recipient, text, html);
    }

    private String encodeField(String value) {
        if (value == null) {
            return "";
        }
        return Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private String decodeField(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return new String(Base64.getDecoder().decode(value), StandardCharsets.UTF_8);
    }

    private String trimErrorSummary(String value) {
        if (value == null || value.isBlank()) {
            return "";
        }
        String normalized = value.trim();
        if (normalized.length() <= MAX_ERROR_SUMMARY) {
            return normalized;
        }
        return normalized.substring(0, MAX_ERROR_SUMMARY);
    }

    private EntityManager entityManager() {
        return session.getProvider(JpaConnectionProvider.class).getEntityManager();
    }

    public record DeliveryPayload(String recipient, String textBody, String htmlBody) {
    }

    private record QuerySpec(String sql, Map<String, Object> params) {
    }
}
