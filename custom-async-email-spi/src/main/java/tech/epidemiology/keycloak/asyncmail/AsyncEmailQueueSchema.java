package tech.epidemiology.keycloak.asyncmail;

public final class AsyncEmailQueueSchema {

    public static final String TABLE_NAME = "kc_vg_async_mail_queue";

    public static final String CREATE_TABLE = """
        CREATE TABLE IF NOT EXISTS kc_vg_async_mail_queue (
            id VARCHAR(64) PRIMARY KEY,
            realm_name VARCHAR(255) NOT NULL,
            category VARCHAR(64) NOT NULL,
            status VARCHAR(32) NOT NULL,
            recipient_masked VARCHAR(255) NOT NULL,
            recipient_domain VARCHAR(255),
            subject TEXT,
            template_name VARCHAR(255),
            event_type VARCHAR(255),
            user_id VARCHAR(255),
            username VARCHAR(255),
            created_at TIMESTAMP NOT NULL,
            updated_at TIMESTAMP NOT NULL,
            queued_at TIMESTAMP NOT NULL,
            next_attempt_at TIMESTAMP,
            sent_at TIMESTAMP,
            failed_at TIMESTAMP,
            retry_count INTEGER NOT NULL DEFAULT 0,
            last_error_summary VARCHAR(1000),
            payload_json TEXT,
            payload_scrubbed BOOLEAN NOT NULL DEFAULT FALSE,
            worker_node VARCHAR(255)
        )
        """;

    public static final String CREATE_INDEX_STATUS_NEXT_ATTEMPT =
        "CREATE INDEX IF NOT EXISTS idx_kc_vg_async_mail_queue_status_next_attempt ON kc_vg_async_mail_queue (status, next_attempt_at)";

    public static final String CREATE_INDEX_REALM_CREATED_AT =
        "CREATE INDEX IF NOT EXISTS idx_kc_vg_async_mail_queue_realm_created_at ON kc_vg_async_mail_queue (realm_name, created_at)";

    public static final String CREATE_INDEX_CATEGORY_CREATED_AT =
        "CREATE INDEX IF NOT EXISTS idx_kc_vg_async_mail_queue_category_created_at ON kc_vg_async_mail_queue (category, created_at)";

    public static final String CREATE_INDEX_CREATED_AT =
        "CREATE INDEX IF NOT EXISTS idx_kc_vg_async_mail_queue_created_at ON kc_vg_async_mail_queue (created_at)";

    private AsyncEmailQueueSchema() {
    }
}
