package tech.epidemiology.keycloak.asyncmail;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.jboss.logging.Logger;
import org.keycloak.models.ClientModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.RoleModel;
import org.keycloak.models.UserModel;
import org.keycloak.services.managers.AppAuthManager;
import org.keycloak.services.managers.AuthenticationManager;
import org.keycloak.services.resource.RealmResourceProvider;

public class AsyncEmailAdminResourceProvider implements RealmResourceProvider {
  private static final Logger LOG = Logger.getLogger(AsyncEmailAdminResourceProvider.class);
  private static final int DASHBOARD_RECENT_ROWS = 10;

  private final KeycloakSession session;
  private final AsyncEmailExportService exportService;
  private final AsyncEmailDatabaseRepository databaseRepository;

  public AsyncEmailAdminResourceProvider(KeycloakSession session) {
    this(session, new AsyncEmailExportService(), new AsyncEmailDatabaseRepository(session));
  }

  AsyncEmailAdminResourceProvider(KeycloakSession session, AsyncEmailExportService exportService, AsyncEmailDatabaseRepository databaseRepository) {
    this.session = session;
    this.exportService = exportService;
    this.databaseRepository = databaseRepository;
  }

  @Override
  public Object getResource() {
    return this;
  }

  @Override
  public void close() {
  }

  @GET
  @Path("ui")
  @Produces(MediaType.TEXT_HTML)
  public Response ui() {
    AuthContext auth = authenticateForRoles("view-users", "manage-users");
    if (!auth.ok) {
      String body = "<!doctype html><html><head><meta charset='utf-8'><title>Async Email Dashboard</title></head>"
          + "<body style='font-family:system-ui,sans-serif;padding:24px'>"
          + "<h1 style='margin-top:0'>Async Email Dashboard</h1>"
          + "<p style='color:#b42318'>" + escapeHtml(auth.message) + "</p></body></html>";
      return Response.status(auth.status).type(MediaType.TEXT_HTML_TYPE).entity(body).build();
    }

    String html = """
        <!doctype html>
        <html>
        <head>
          <meta charset='utf-8'>
          <meta name='viewport' content='width=device-width, initial-scale=1'>
          <title>Async Email Dashboard</title>
          <style>
            body { font-family: system-ui, sans-serif; margin: 0; background: #f7f7f8; color: #1f2937; }
            .wrap { max-width: 1440px; margin: 0 auto; padding: 16px; }
            .card { background: #fff; border: 1px solid #d6d6dd; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px,1fr)); gap: 8px; margin-bottom: 12px; }
            .grid .item { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px; background: #fafafa; }
            .item .label { font-size: 11px; color: #6b7280; }
            .item .value { font-size: 19px; margin-top: 2px; font-weight: 600; }
            .toolbar { display:grid; grid-template-columns: 180px 220px 1fr 100px auto auto auto; gap:8px; margin-bottom:12px; align-items:end; }
            label { display:block; font-size:12px; margin-bottom:4px; color:#4b5563; }
            input, select { width:100%%; box-sizing:border-box; padding:8px; border:1px solid #c7cbd1; border-radius:6px; background:#fff; }
            button { padding:8px 12px; border:1px solid #c7cbd1; background:#fff; border-radius:6px; cursor:pointer; }
            button.primary { background:#0b5fff; color:#fff; border-color:#0b5fff; }
            button.secondary { background:#eef2ff; color:#1d4ed8; border-color:#c7d2fe; }
            .header-actions { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }
            .table-wrap { overflow:auto; border:1px solid #d6d6dd; border-radius:8px; background:#fff; }
            table { width:100%%; border-collapse:collapse; font-size:12px; }
            th, td { text-align:left; padding:10px; border-bottom:1px solid #eceef2; vertical-align:top; }
            thead th { position:sticky; top:0; background:#f8fafc; z-index:1; }
            .pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; background:#eef2ff; color:#3730a3; }
            .pager { display:flex; gap:8px; align-items:center; margin-top:12px; }
            .statusline { font-size:12px; color:#6b7280; margin-top:8px; }
            .muted { color:#6b7280; font-size:12px; }
            .cell-actions { display:flex; gap:8px; align-items:center; }
            @media (max-width: 980px) { .toolbar { grid-template-columns:1fr 1fr; } .toolbar .fill { grid-column:1/-1; } }
          </style>
        </head>
        <body>
          <div class='wrap'>
            <div class='card'>
              <h2 style='margin:0 0 8px 0'>Async Email Dashboard</h2>
              <div>Realm: %s</div>
              <div>Queue-backed email requests with status, pagination, export, and retry support.</div>
              <div class='header-actions'>
                <button type='button' id='backBtn'>Back</button>
                <button type='button' id='refreshBtn' class='secondary'>Refresh</button>
                <div id='tzLabel' class='muted'></div>
              </div>
            </div>
            <div class='grid' id='stats'></div>
            <div class='card'>
              <h3 style='margin:0 0 12px 0'>Email Requests</h3>
              <div class='toolbar'>
                <div>
                  <label for='statusFilter'>Status</label>
                  <select id='statusFilter'>
                    <option value=''>All</option>
                    <option value='queued'>Queued</option>
                    <option value='sending'>Sending</option>
                    <option value='sent'>Sent</option>
                    <option value='failed_retryable'>Retrying</option>
                    <option value='dead_letter'>Dead Letter</option>
                  </select>
                </div>
                <div>
                  <label for='categoryFilter'>Category</label>
                  <select id='categoryFilter'>
                    <option value=''>All</option>
                  </select>
                </div>
                <div class='fill'>
                  <label for='searchFilter'>Search</label>
                  <input id='searchFilter' placeholder='Subject, username, masked recipient'>
                </div>
                <div>
                  <label for='pageSize'>Rows</label>
                  <input id='pageSize' value='25'>
                </div>
                <button type='button' id='applyBtn' class='primary'>Apply</button>
                <button type='button' id='clearBtn'>Clear</button>
                <button type='button' id='refreshGridBtn' class='secondary'>Refresh</button>
              </div>
              <div class='table-wrap'>
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Category</th>
                      <th>Recipient</th>
                      <th>User</th>
                      <th>Subject</th>
                      <th>Template</th>
                      <th>Created</th>
                      <th>Sent</th>
                      <th>Failed</th>
                      <th>Retry</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody id='requestRows'><tr><td colspan='11'>Loading...</td></tr></tbody>
                </table>
              </div>
              <div class='pager'>
                <button type='button' id='prevBtn'>Prev</button>
                <button type='button' id='nextBtn'>Next</button>
                <div id='pageInfo' style='margin-left:auto'>Page 1</div>
              </div>
              <div id='statusline' class='statusline'>Ready</div>
            </div>
          </div>
          <script>
            let first = 0;
            let latestStats = null;
            const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local browser time';
            async function refresh() {
              const max = Math.max(1, Number(document.getElementById('pageSize').value || 25));
              const params = new URLSearchParams();
              if (document.getElementById('statusFilter').value) params.set('status', document.getElementById('statusFilter').value);
              if (document.getElementById('categoryFilter').value) params.set('category', document.getElementById('categoryFilter').value);
              if (document.getElementById('searchFilter').value.trim()) params.set('q', document.getElementById('searchFilter').value.trim());
              params.set('first', String(first));
              params.set('max', String(max));
              document.getElementById('tzLabel').textContent = 'Showing dates in ' + browserTimeZone;
              const [statsResp, messagesResp] = await Promise.all([
                fetch('stats', { credentials: 'include' }),
                fetch('messages?' + params.toString(), { credentials: 'include' })
              ]);
              const stats = await safeJson(statsResp);
              const messages = await safeJson(messagesResp);
              latestStats = stats;
              document.getElementById('stats').innerHTML =
                '<div class=\\'item\\'><div class=\\'label\\'>Queued</div><div class=\\'value\\'>' + ((stats.statusCounts||{}).queued||0) + '</div></div>' +
                '<div class=\\'item\\'><div class=\\'label\\'>Sending</div><div class=\\'value\\'>' + ((stats.statusCounts||{}).sending||0) + '</div></div>' +
                '<div class=\\'item\\'><div class=\\'label\\'>Sent</div><div class=\\'value\\'>' + ((stats.statusCounts||{}).sent||0) + '</div></div>' +
                '<div class=\\'item\\'><div class=\\'label\\'>Retrying</div><div class=\\'value\\'>' + ((stats.statusCounts||{}).failed_retryable||0) + '</div></div>' +
                '<div class=\\'item\\'><div class=\\'label\\'>Dead Letter</div><div class=\\'value\\'>' + ((stats.statusCounts||{}).dead_letter||0) + '</div></div>' +
                '<div class=\\'item\\'><div class=\\'label\\'>Oldest Queued Age</div><div class=\\'value\\'>' + (((stats.oldestQueuedAgeSeconds||0)) + 's') + '</div></div>';
              populateCategoryDropdown(stats.categoryCounts || {});
              renderRows(messages.rows || []);
              const page = Math.floor((messages.first || 0) / max) + 1;
              document.getElementById('pageInfo').textContent = 'Page ' + page + ' | Total ' + (messages.total || 0);
              document.getElementById('statusline').textContent = 'Showing ' + (messages.rows || []).length + ' requests in ' + browserTimeZone;
            }

            async function safeJson(res) {
              try { return await res.json(); } catch (e) { return { ok: false, error: String(e) }; }
            }
            function populateCategoryDropdown(categoryCounts) {
              const select = document.getElementById('categoryFilter');
              const current = select.value;
              const options = ['<option value=\"\">All</option>'];
              Object.keys(categoryCounts).sort().forEach(function (category) {
                options.push('<option value=\"' + escAttr(category) + '\">' + esc(category) + ' (' + Number(categoryCounts[category] || 0) + ')</option>');
              });
              select.innerHTML = options.join('');
              if ([].slice.call(select.options).some(function (option) { return option.value === current; })) {
                select.value = current;
              }
            }
            function renderRows(rows) {
              const body = document.getElementById('requestRows');
              if (!rows.length) {
                body.innerHTML = '<tr><td colspan="11">No email requests found.</td></tr>';
                return;
              }
              body.innerHTML = rows.map(function (row) {
                return '<tr>' +
                  '<td><span class="pill">' + esc(row.status) + '</span></td>' +
                  '<td>' + esc(row.category) + '</td>' +
                  '<td>' + esc(row.recipient_masked) + '</td>' +
                  '<td>' + esc(row.username) + '</td>' +
                  '<td>' + esc(row.subject) + '</td>' +
                  '<td>' + esc(row.template_name) + '</td>' +
                  '<td>' + esc(formatTimestamp(row.created_at)) + '</td>' +
                  '<td>' + esc(formatTimestamp(row.sent_at)) + '</td>' +
                  '<td>' + esc(formatTimestamp(row.failed_at)) + '</td>' +
                  '<td><div class=\"cell-actions\"><span>' + esc(String(row.retry_count || 0)) + '</span>' + retryButton(row) + '</div></td>' +
                  '<td>' + esc(row.last_error_summary || '') + '</td>' +
                  '</tr>';
              }).join('');
              bindRetryButtons();
            }
            function retryButton(row) {
              if (row.status !== 'failed_retryable' && row.status !== 'dead_letter') {
                return '';
              }
              return '<button type=\"button\" class=\"retryBtn secondary\" data-id=\"' + escAttr(row.id) + '\">Retry</button>';
            }
            function bindRetryButtons() {
              document.querySelectorAll('.retryBtn').forEach(function (button) {
                button.addEventListener('click', async function () {
                  const id = button.getAttribute('data-id');
                  button.disabled = true;
                  try {
                    const resp = await fetch('retry?id=' + encodeURIComponent(id), {
                      method: 'POST',
                      credentials: 'include',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id: id })
                    });
                    const payload = await safeJson(resp);
                    if (!resp.ok || payload.ok === false) {
                      throw new Error(payload.error || ('HTTP ' + resp.status));
                    }
                    document.getElementById('statusline').textContent = 'Retry queued for ' + id;
                    await refresh();
                  } catch (error) {
                    document.getElementById('statusline').textContent = 'Retry failed: ' + String(error);
                    button.disabled = false;
                  }
                });
              });
            }
            function formatTimestamp(value) {
              if (!value) return '';
              const date = new Date(value);
              if (Number.isNaN(date.getTime())) return String(value);
              return new Intl.DateTimeFormat(undefined, {
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZoneName: 'short'
              }).format(date);
            }
            function esc(v) {
              return String(v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
            }
            function escAttr(v) {
              return esc(v);
            }
            document.getElementById('applyBtn').addEventListener('click', function () { first = 0; refresh(); });
            document.getElementById('clearBtn').addEventListener('click', function () {
              first = 0;
              document.getElementById('statusFilter').value = '';
              document.getElementById('categoryFilter').value = '';
              document.getElementById('searchFilter').value = '';
              document.getElementById('pageSize').value = '25';
              refresh();
            });
            document.getElementById('refreshBtn').addEventListener('click', function () { refresh(); });
            document.getElementById('refreshGridBtn').addEventListener('click', function () { refresh(); });
            document.getElementById('backBtn').addEventListener('click', function () {
              if (window.history.length > 1) {
                window.history.back();
                return;
              }
              window.location.href = '/admin/';
            });
            document.getElementById('prevBtn').addEventListener('click', function () {
              const max = Math.max(1, Number(document.getElementById('pageSize').value || 25));
              first = Math.max(0, first - max);
              refresh();
            });
            document.getElementById('nextBtn').addEventListener('click', function () {
              const max = Math.max(1, Number(document.getElementById('pageSize').value || 25));
              first += max;
              refresh();
            });
            refresh();
          </script>
        </body>
        </html>""".formatted(auth.realm.getName());
    return Response.ok(html).type(MediaType.TEXT_HTML_TYPE).build();
  }

  @GET
  @Path("stats")
  @Produces(MediaType.APPLICATION_JSON)
  public Response stats() {
    AuthContext auth = authenticateForRoles("view-users", "manage-users");
    if (!auth.ok) {
      return Response.status(auth.status).entity(Map.of("ok", false, "error", auth.message)).build();
    }

    Map<String, Integer> statusCounts = databaseRepository.countByStatus(auth.realm.getName());
    Map<String, Integer> categoryCounts = databaseRepository.countByCategory(auth.realm.getName());
    List<Map<String, Object>> recentFailures = databaseRepository.listFailures(auth.realm.getName(), "", null, null, 0, DASHBOARD_RECENT_ROWS)
        .stream().map(AsyncEmailAdminResourceProvider::toMessageDto).map(MailRecordDto::toMap).toList();
    List<Map<String, Object>> recentSends = databaseRepository.listMessages(auth.realm.getName(), "sent", null, "", null, null, 0, DASHBOARD_RECENT_ROWS)
        .stream().map(AsyncEmailAdminResourceProvider::toMessageDto).map(MailRecordDto::toMap).toList();

    long oldestQueuedAgeSeconds = databaseRepository.oldestQueuedAgeSeconds(auth.realm.getName());

    return Response.ok(Map.of(
        "ok", true,
        "realm", auth.realm.getName(),
        "statusCounts", statusCounts,
        "categoryCounts", categoryCounts,
        "oldestQueuedAgeSeconds", oldestQueuedAgeSeconds,
        "recentFailures", recentFailures,
        "recentSends", recentSends)).build();
  }

  @GET
  @Path("messages")
  @Produces(MediaType.APPLICATION_JSON)
  public Response messages(
      @QueryParam("status") String status,
      @QueryParam("category") String category,
      @QueryParam("q") String queryText,
      @QueryParam("from") String from,
      @QueryParam("to") String to,
      @QueryParam("first") Integer first,
      @QueryParam("max") Integer max) {
    AuthContext auth = authenticateForRoles("view-users", "manage-users");
    if (!auth.ok) {
      return Response.status(auth.status).entity(Map.of("ok", false, "error", auth.message)).build();
    }

    Instant fromTs;
    Instant toTs;
    try {
      fromTs = parseIsoDate(from);
      toTs = parseIsoDate(to);
    } catch (DateTimeParseException ex) {
      return Response.status(Response.Status.BAD_REQUEST).entity(Map.of("ok", false, "error", "from/to must be ISO-8601 timestamps")).build();
    }

    int safeFirst = normalizeFirst(first);
    int safeMax = normalizeMax(max);
    String normalizedQuery = normalizeTextFilter(queryText);

    int total = databaseRepository.countMessages(
        auth.realm.getName(),
        trimOrNull(status),
        trimOrNull(category),
        normalizedQuery,
        fromTs,
        toTs);
    List<Map<String, Object>> rows = databaseRepository.listMessages(
            auth.realm.getName(),
            trimOrNull(status),
            trimOrNull(category),
            normalizedQuery,
            fromTs,
            toTs,
            safeFirst,
            safeMax)
        .stream()
        .map(AsyncEmailAdminResourceProvider::toMessageDto)
        .map(MailRecordDto::toMap)
        .toList();

    return Response.ok(Map.of(
        "ok", true,
        "realm", auth.realm.getName(),
        "total", total,
        "first", safeFirst,
        "max", safeMax,
        "rows", rows)).build();
  }

  @GET
  @Path("failures")
  @Produces(MediaType.APPLICATION_JSON)
  public Response failures(
      @QueryParam("q") String queryText,
      @QueryParam("from") String from,
      @QueryParam("to") String to,
      @QueryParam("first") Integer first,
      @QueryParam("max") Integer max) {
    AuthContext auth = authenticateForRoles("view-users", "manage-users");
    if (!auth.ok) {
      return Response.status(auth.status).entity(Map.of("ok", false, "error", auth.message)).build();
    }
    Instant fromTs;
    Instant toTs;
    try {
      fromTs = parseIsoDate(from);
      toTs = parseIsoDate(to);
    } catch (DateTimeParseException ex) {
      return Response.status(Response.Status.BAD_REQUEST).entity(Map.of("ok", false, "error", "from/to must be ISO-8601 timestamps")).build();
    }

    String normalizedQuery = normalizeTextFilter(queryText);
    int safeFirst = normalizeFirst(first);
    int safeMax = normalizeMax(max);
    List<AsyncEmailExportService.MailRecord> rows = databaseRepository.listFailures(auth.realm.getName(), normalizedQuery, fromTs, toTs, safeFirst, safeMax);
    long total = databaseRepository.countFailures(auth.realm.getName(), normalizedQuery, fromTs, toTs);

    return Response.ok(Map.of(
        "ok", true,
        "realm", auth.realm.getName(),
        "total", total,
        "first", safeFirst,
        "max", safeMax,
        "rows", rows.stream().map(AsyncEmailAdminResourceProvider::toMessageDto).map(MailRecordDto::toMap).toList())).build();
  }

  @POST
  @Path("retry")
  @Consumes(MediaType.APPLICATION_JSON)
  @Produces(MediaType.APPLICATION_JSON)
  public Response retry(RetryRequest request, @QueryParam("id") String id) {
    AuthContext auth = authenticateForRoles("view-users", "manage-users");
    if (!auth.ok) {
      return Response.status(auth.status).entity(Map.of("ok", false, "error", auth.message)).build();
    }

    String targetId = normalizeTextFilter(id);
    if ((targetId.isEmpty()) && request != null) {
      targetId = normalizeTextFilter(request.id);
    }
    if (targetId.isEmpty()) {
      return Response.status(Response.Status.BAD_REQUEST).entity(Map.of("ok", false, "error", "id is required")).build();
    }

    boolean retried = databaseRepository.retry(auth.realm.getName(), targetId);
    if (!retried) {
      return Response.status(Response.Status.NOT_FOUND)
          .entity(Map.of("ok", false, "error", "message not found or not retryable")).build();
    }
    return Response.ok(Map.of("ok", true, "id", targetId)).build();
  }

  @GET
  @Path("export.csv")
  @Produces(MediaType.TEXT_PLAIN)
  public Response exportCsv(
      @QueryParam("status") String status,
      @QueryParam("category") String category,
      @QueryParam("q") String queryText,
      @QueryParam("from") String from,
      @QueryParam("to") String to,
      @QueryParam("max") Integer max) {
    AuthContext auth = authenticateForRoles("view-users", "manage-users");
    if (!auth.ok) {
      return Response.status(auth.status).entity(Map.of("ok", false, "error", auth.message)).build();
    }
    Instant fromTs;
    Instant toTs;
    try {
      fromTs = parseIsoDate(from);
      toTs = parseIsoDate(to);
    } catch (DateTimeParseException ex) {
      return Response.status(Response.Status.BAD_REQUEST).entity(Map.of("ok", false, "error", "from/to must be ISO-8601 timestamps")).build();
    }

    int safeMax = normalizeMax(max);
    safeMax = Math.min(safeMax, exportService.getExportMaxRows());
    List<AsyncEmailExportService.MailRecord> rows = databaseRepository.listMessages(
        auth.realm.getName(),
        trimOrNull(status),
        trimOrNull(category),
        normalizeTextFilter(queryText),
        fromTs,
        toTs,
        0,
        safeMax);
    String csv = exportService.toCsv(rows);
    return Response.ok(csv)
        .type("text/csv;charset=UTF-8")
        .header(HttpHeaders.CONTENT_DISPOSITION,
            "attachment; filename=\"async-email-messages-" + auth.realm.getName() + ".csv\"")
        .build();
  }

  @GET
  @Path("export.txt")
  @Produces(MediaType.TEXT_PLAIN)
  public Response exportTxt(
      @QueryParam("status") String status,
      @QueryParam("category") String category,
      @QueryParam("q") String queryText,
      @QueryParam("from") String from,
      @QueryParam("to") String to,
      @QueryParam("max") Integer max) {
    AuthContext auth = authenticateForRoles("view-users", "manage-users");
    if (!auth.ok) {
      return Response.status(auth.status).entity(Map.of("ok", false, "error", auth.message)).build();
    }
    Instant fromTs;
    Instant toTs;
    try {
      fromTs = parseIsoDate(from);
      toTs = parseIsoDate(to);
    } catch (DateTimeParseException ex) {
      return Response.status(Response.Status.BAD_REQUEST).entity(Map.of("ok", false, "error", "from/to must be ISO-8601 timestamps")).build();
    }

    int safeMax = normalizeMax(max);
    safeMax = Math.min(safeMax, exportService.getExportMaxRows());
    List<AsyncEmailExportService.MailRecord> rows = databaseRepository.listMessages(
        auth.realm.getName(),
        trimOrNull(status),
        trimOrNull(category),
        normalizeTextFilter(queryText),
        fromTs,
        toTs,
        0,
        safeMax);
    String txt = exportService.toTxt(rows);
    return Response.ok(txt)
        .type("text/plain;charset=UTF-8")
        .header(HttpHeaders.CONTENT_DISPOSITION,
            "attachment; filename=\"async-email-messages-" + auth.realm.getName() + ".txt\"")
        .build();
  }

  static int normalizeFirst(Integer first) {
    if (first == null || first < 0) {
      return 0;
    }
    return first;
  }

  static int normalizeMax(Integer max) {
    if (max == null) {
      return 100;
    }
    if (max < 1) {
      return 1;
    }
    return Math.min(max, 500);
  }

  static String normalizeTextFilter(String value) {
    return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
  }

  static Instant parseIsoDate(String value) {
    if (value == null || value.trim().isEmpty()) {
      return null;
    }
    return Instant.parse(value.trim());
  }

  static MailRecordDto toMessageDto(AsyncEmailExportService.MailRecord record) {
    if (record == null) {
      return null;
    }
    return new MailRecordDto(
        record.id(),
        record.realmName(),
        record.category(),
        record.status(),
        record.recipientMasked(),
        record.username(),
        record.subject(),
        record.templateName(),
        record.createdAt(),
        record.sentAt(),
        record.failedAt(),
        record.retryCount(),
        record.lastErrorSummary());
  }

  private static String trimOrNull(String value) {
    String normalized = normalizeTextFilter(value);
    return normalized.isEmpty() ? null : normalized;
  }

  private static String escapeHtml(String value) {
    if (value == null) {
      return "";
    }
    return value
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&#39;");
  }

  private AuthContext authenticateForRoles(String... roleNames) {
    RealmModel realm = session.getContext().getRealm();
    if (realm == null) {
      return AuthContext.fail(Response.Status.UNAUTHORIZED, "No realm context");
    }
    AuthenticationManager.AuthResult authResult = new AppAuthManager.BearerTokenAuthenticator(session)
        .setRealm(realm)
        .setUriInfo(session.getContext().getUri())
        .setConnection(session.getContext().getConnection())
        .setHeaders(session.getContext().getRequestHeaders())
        .authenticate();
    if (authResult == null) {
      authResult = new AppAuthManager().authenticateIdentityCookie(session, realm);
    }
    if (authResult == null || authResult.getUser() == null) {
      return AuthContext.fail(Response.Status.UNAUTHORIZED, "User is not authenticated");
    }

    UserModel user = authResult.getUser();
    ClientModel adminRolesClient = resolveAdminRolesClient(realm);
    if (adminRolesClient == null) {
      return AuthContext.fail(Response.Status.FORBIDDEN, adminRolesClientId(realm) + " client is missing");
    }

    for (String roleName : roleNames) {
      RoleModel role = adminRolesClient.getRole(roleName);
      if (role != null && user.hasRole(role)) {
        return AuthContext.ok(realm, user);
      }
    }
    return AuthContext.fail(Response.Status.FORBIDDEN, "Required " + adminRolesClient.getClientId() + " role is missing");
  }

  static String adminRolesClientId(RealmModel realm) {
    return realm != null && "master".equals(realm.getName()) ? "master-realm" : "realm-management";
  }

  static ClientModel resolveAdminRolesClient(RealmModel realm) {
    if (realm == null) {
      return null;
    }
    return realm.getClientByClientId(adminRolesClientId(realm));
  }

  public static final class RetryRequest {
    public String id;
  }

  public record MailRecordDto(
      String id,
      String realmName,
      String category,
      String status,
      String recipientMasked,
      String username,
      String subject,
      String templateName,
      Instant createdAt,
      Instant sentAt,
      Instant failedAt,
      int retryCount,
      String lastErrorSummary) {

    Map<String, Object> toMap() {
      Map<String, Object> out = new java.util.LinkedHashMap<>();
      out.put("id", id);
      out.put("realm_name", realmName);
      out.put("category", category);
      out.put("status", status);
      out.put("recipient_masked", recipientMasked);
      out.put("username", username == null ? "" : username);
      out.put("subject", subject);
      out.put("template_name", templateName);
      out.put("created_at", createdAt == null ? "" : createdAt.toString());
      out.put("sent_at", sentAt == null ? "" : sentAt.toString());
      out.put("failed_at", failedAt == null ? "" : failedAt.toString());
      out.put("retry_count", retryCount);
      out.put("last_error_summary", lastErrorSummary == null ? "" : lastErrorSummary);
      return out;
    }
  }

  private static final class AuthContext {
    final boolean ok;
    final Response.Status status;
    final String message;
    final RealmModel realm;
    final UserModel user;

    private AuthContext(boolean ok, Response.Status status, String message, RealmModel realm, UserModel user) {
      this.ok = ok;
      this.status = status;
      this.message = message;
      this.realm = realm;
      this.user = user;
    }

    static AuthContext ok(RealmModel realm, UserModel user) {
      return new AuthContext(true, Response.Status.OK, "", realm, user);
    }

    static AuthContext fail(Response.Status status, String message) {
      return new AuthContext(false, status, message, null, null);
    }
  }
}
