package tech.epidemiology.keycloak.auth;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DefaultValue;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.net.URI;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import org.keycloak.models.ClientModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.RoleModel;
import org.keycloak.models.UserModel;
import org.keycloak.services.managers.AppAuthManager;
import org.keycloak.services.managers.AuthenticationManager;
import org.keycloak.services.resource.RealmResourceProvider;

public class PhoneOtpAdminResourceProvider implements RealmResourceProvider {
  private static final long TEST_TOKEN_TTL_SECONDS = 300L;
  private static final String ENV_TEST_API_ENABLED = "KC_OTP_TEST_API_ENABLED";
  private static final String ENV_TEST_API_ALLOWED_HOSTS = "KC_OTP_TEST_API_ALLOWED_HOSTS";
  private static final ConcurrentHashMap<String, TokenRecord> TOKENS = new ConcurrentHashMap<>();

  private final KeycloakSession session;
  private final SmsHttpSender smsSender;

  public PhoneOtpAdminResourceProvider(KeycloakSession session) {
    this(session, new SmsHttpSender());
  }

  public PhoneOtpAdminResourceProvider(KeycloakSession session, SmsHttpSender smsSender) {
    this.session = session;
    this.smsSender = smsSender;
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
    if (!isTestApiEnabled()) {
      return Response.status(Response.Status.FORBIDDEN)
          .entity("<h3>Forbidden</h3><p>OTP test API is disabled.</p>")
          .type(MediaType.TEXT_HTML)
          .build();
    }
    AuthContext auth = authenticateAdminContext();
    if (!auth.authenticated || !auth.manageRealm) {
      return Response.status(auth.status)
          .entity("<h3>Forbidden</h3><p>manage-realm role is required.</p>")
          .type(MediaType.TEXT_HTML)
          .build();
    }

    String html = """
        <!doctype html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Phone OTP Test</title>
          <style>
            body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:840px;margin:32px auto;padding:0 16px}
            input,textarea{width:100%%;padding:10px;margin:6px 0 14px;border:1px solid #bbb;border-radius:6px}
            button{background:#0b5fff;color:#fff;border:none;padding:10px 14px;border-radius:6px;cursor:pointer}
            pre{background:#111;color:#e8e8e8;padding:12px;border-radius:6px;overflow:auto}
          </style>
        </head>
        <body>
          <h2>Phone OTP Test</h2>
          <p>Use this page to test SMS API config quickly.</p>
          <label>Primary Endpoint</label>
          <input id="primaryEndpoint" placeholder="https://smsapplication.vg.edu/services/api/v1/sms/single"/>
          <label>Backup Endpoint (optional)</label>
          <input id="backupEndpoint" placeholder=""/>
          <label>Bearer Token</label>
          <input id="bearer" placeholder="Bearer token value"/>
          <label>Test Token (X-Phone-Otp-Test-Token)</label>
          <input id="testToken" placeholder="Generate a short-lived token"/>
          <button onclick="genToken()">Generate Test Token</button>
          <label>Mobile Field</label>
          <input id="mobileField" value="mobile"/>
          <label>Message Field</label>
          <input id="messageField" value="message"/>
          <label>Mobile</label>
          <input id="mobile" placeholder="9899xxxxxx"/>
          <label>Message</label>
          <input id="message" value="OTP For VG SSO Verification is: 123456"/>
          <label>Retry Max</label>
          <input id="retryMax" value="2"/>
          <label>Retry Backoff (ms)</label>
          <input id="retryBackoffMs" value="500"/>
          <button onclick="sendTest()">Test OTP</button>
          <h3>Response</h3>
          <pre id="out">Waiting...</pre>
          <script>
            async function sendTest() {
              const payload = {
                primaryEndpoint: document.getElementById('primaryEndpoint').value.trim(),
                backupEndpoint: document.getElementById('backupEndpoint').value.trim(),
                bearer: document.getElementById('bearer').value.trim(),
                mobileField: document.getElementById('mobileField').value.trim() || 'mobile',
                messageField: document.getElementById('messageField').value.trim() || 'message',
                mobile: document.getElementById('mobile').value.trim(),
                message: document.getElementById('message').value.trim(),
                retryMax: Number(document.getElementById('retryMax').value || 2),
                retryBackoffMs: Number(document.getElementById('retryBackoffMs').value || 500)
              };
              const out = document.getElementById('out');
              out.textContent = 'Sending...';
              try {
                const res = await fetch('test', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Phone-Otp-Test-Token': document.getElementById('testToken').value.trim()
                  },
                  body: JSON.stringify(payload)
                });
                const data = await res.json().catch(() => ({}));
                out.textContent = JSON.stringify({ status: res.status, body: data }, null, 2);
              } catch (e) {
                out.textContent = String(e);
              }
            }

            async function genToken() {
              const out = document.getElementById('out');
              out.textContent = 'Generating token...';
              try {
                const res = await fetch('token', { method: 'POST' });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.token) {
                  document.getElementById('testToken').value = data.token;
                }
                out.textContent = JSON.stringify({ status: res.status, body: data }, null, 2);
              } catch (e) {
                out.textContent = String(e);
              }
            }
          </script>
        </body>
        </html>
        """;
    return Response.ok(html).build();
  }

  @GET
  @Path("pending-ui")
  @Produces(MediaType.TEXT_HTML)
  public Response pendingUi() {
    AuthContext auth = authenticateAdminContext();
    if (!auth.authenticated) {
      return Response.status(auth.status)
          .entity("<h3>Forbidden</h3><p>" + escapeHtml(auth.message) + "</p>")
          .type(MediaType.TEXT_HTML)
          .build();
    }
    if (!(auth.manageRealm || auth.userManager)) {
      return Response.status(Response.Status.FORBIDDEN)
          .entity("<h3>Forbidden</h3><p>manage-realm or user-manager role is required.</p>")
          .type(MediaType.TEXT_HTML)
          .build();
    }

    String html = """
        <!doctype html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Phone OTP Status</title>
          <style>
            body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f7f7f8;color:#161616}
            .wrap{max-width:1280px;margin:0 auto;padding:24px}
            .bar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}
            .summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px}
            .card{background:#fff;border:1px solid #d8d8d8;border-radius:8px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
            .stat-label{font-size:12px;color:#666}
            .stat-value{font-size:22px;font-weight:600}
            .toolbar{display:grid;grid-template-columns:1fr 100px auto auto auto;gap:8px;align-items:end;margin-bottom:12px}
            label{display:block;font-size:12px;margin-bottom:4px}
            input{width:100%%;box-sizing:border-box;padding:8px;border:1px solid #bbb;border-radius:6px}
            button{padding:8px 12px;border:1px solid #c7c7c7;background:#fff;border-radius:6px;cursor:pointer}
            .primary{background:#0b5fff;color:#fff;border-color:#0b5fff}
            .table-wrap{max-height:62vh;overflow:auto;border:1px solid #ddd;border-radius:8px;background:#fff}
            table{width:100%%;border-collapse:collapse;font-size:13px}
            th,td{text-align:left;padding:10px;border-bottom:1px solid #eee;vertical-align:top}
            thead th{position:sticky;top:0;background:#f8f8f8;z-index:1}
            .pager{display:flex;align-items:center;gap:8px;margin-top:10px}
            .status{margin-top:8px;font-size:12px;color:#666}
            @media (max-width: 900px){.summary{grid-template-columns:1fr}.toolbar{grid-template-columns:1fr 1fr}.toolbar .fill{grid-column:1/-1}}
          </style>
        </head>
        <body>
          <div class="wrap">
            <div class="bar">
              <div>
                <h1 style="margin:0;font-size:28px">Phone OTP Status</h1>
                <div style="font-size:13px;color:#666">Realm: %s</div>
              </div>
              <button type="button" id="reloadBtn" class="primary">Reload</button>
            </div>
            <div class="summary">
              <div class="card"><div class="stat-label">Total Users</div><div class="stat-value" id="totalUsers">-</div></div>
              <div class="card"><div class="stat-label">Phone Verified</div><div class="stat-value" id="verifiedUsers">-</div></div>
              <div class="card"><div class="stat-label">Pending Verification</div><div class="stat-value" id="pendingUsers">-</div></div>
            </div>
            <div class="toolbar">
              <div class="fill">
                <label for="search">Search username or mobile</label>
                <input id="search" placeholder="Search...">
              </div>
              <div>
                <label for="pageSize">Rows</label>
                <input id="pageSize" value="25">
              </div>
              <button type="button" id="searchBtn">Search</button>
              <button type="button" id="clearBtn">Clear</button>
              <button type="button" id="reloadBtn2" class="primary">Reload</button>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr><th>Username</th><th>Name</th><th>Email</th><th>Mobile</th><th>Enabled</th><th>Profile</th></tr>
                </thead>
                <tbody id="rows"><tr><td colspan="6">Loading...</td></tr></tbody>
              </table>
            </div>
            <div class="pager">
              <button type="button" id="prevBtn">Prev</button>
              <button type="button" id="nextBtn">Next</button>
              <div id="pageInfo" style="margin-left:auto;font-size:13px">Page 1 / 1</div>
            </div>
            <div id="status" class="status">Ready</div>
          </div>
          <script>
            (function () {
              var state = { page: 1, pageSize: 25, totalFiltered: 0 };

              function esc(value) {
                return String(value || '')
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#39;');
              }

              function getProfileUrl(row) {
                var p = String(row.adminUserPath || '');
                if (!/\\/settings$/.test(p)) p += '/settings';
                return p;
              }

              function renderRows(users) {
                var tbody = document.getElementById('rows');
                tbody.innerHTML = '';
                if (!users || !users.length) {
                  tbody.innerHTML = "<tr><td colspan='6'>No users found.</td></tr>";
                  return;
                }
                for (var i = 0; i < users.length; i++) {
                  var u = users[i];
                  var tr = document.createElement('tr');
                  tr.innerHTML =
                    "<td>" + esc(u.username) + "</td>" +
                    "<td>" + esc(((u.firstName || '') + ' ' + (u.lastName || '')).trim()) + "</td>" +
                    "<td>" + esc(u.email) + "</td>" +
                    "<td>" + esc(u.mobile) + "</td>" +
                    "<td>" + (u.enabled ? "true" : "false") + "</td>" +
                    "<td><a href='" + esc(getProfileUrl(u)) + "' target='_blank' rel='noopener'>Open</a></td>";
                  tbody.appendChild(tr);
                }
              }

              async function load() {
                var pageSize = Math.max(5, Number(document.getElementById('pageSize').value || 25));
                state.pageSize = pageSize;
                var first = (state.page - 1) * state.pageSize;
                var q = (document.getElementById('search').value || '').trim();
                var status = document.getElementById('status');
                status.textContent = 'Loading users...';
                try {
                  var url = 'pending-users?first=' + encodeURIComponent(first) + '&max=' + encodeURIComponent(state.pageSize) + '&q=' + encodeURIComponent(q);
                  var res = await fetch(url, { credentials: 'include' });
                  var data = await res.json().catch(function () { return {}; });
                  if (!res.ok || !data || !data.ok) {
                    status.textContent = (data && data.error) || ('Failed (' + res.status + ')');
                    renderRows([]);
                    return;
                  }
                  document.getElementById('totalUsers').textContent = String(data.totalUsers || 0);
                  document.getElementById('verifiedUsers').textContent = String(data.verifiedUsers || 0);
                  document.getElementById('pendingUsers').textContent = String(data.pendingUsers || 0);
                  state.totalFiltered = Number(data.filteredPendingUsers || data.pendingUsers || 0);
                  renderRows(data.users || []);
                  var totalPages = Math.max(1, Math.ceil(state.totalFiltered / state.pageSize));
                  var start = state.totalFiltered === 0 ? 0 : ((state.page - 1) * state.pageSize + 1);
                  var end = Math.min(state.page * state.pageSize, state.totalFiltered);
                  document.getElementById('pageInfo').textContent = 'Page ' + state.page + ' / ' + totalPages + ' • Showing ' + start + '-' + end + ' of ' + state.totalFiltered;
                  document.getElementById('prevBtn').disabled = state.page <= 1;
                  document.getElementById('nextBtn').disabled = state.page >= totalPages;
                  status.textContent = 'Loaded page ' + state.page + ' (' + (data.count || 0) + ' rows).';
                } catch (e) {
                  status.textContent = String(e);
                  renderRows([]);
                }
              }

              document.getElementById('searchBtn').addEventListener('click', function () { state.page = 1; load(); });
              document.getElementById('clearBtn').addEventListener('click', function () { document.getElementById('search').value = ''; state.page = 1; load(); });
              document.getElementById('reloadBtn').addEventListener('click', function () { state.page = 1; load(); });
              document.getElementById('reloadBtn2').addEventListener('click', function () { state.page = 1; load(); });
              document.getElementById('prevBtn').addEventListener('click', function () { if (state.page > 1) { state.page -= 1; load(); } });
              document.getElementById('nextBtn').addEventListener('click', function () {
                var totalPages = Math.max(1, Math.ceil(state.totalFiltered / state.pageSize));
                if (state.page < totalPages) { state.page += 1; load(); }
              });
              document.getElementById('search').addEventListener('keydown', function (e) { if (e.key === 'Enter') { state.page = 1; load(); } });
              document.getElementById('pageSize').addEventListener('change', function () { state.page = 1; load(); });
              load();
            })();
          </script>
        </body>
        </html>
        """.formatted(escapeHtml(auth.realm.getName()));
    return Response.ok(html).type(MediaType.TEXT_HTML_TYPE).build();
  }

  @GET
  @Path("access")
  @Produces(MediaType.APPLICATION_JSON)
  public Response access() {
    AuthContext auth = authenticateAdminContext();
    if (!auth.authenticated) {
      return Response.status(auth.status).entity(Map.of("ok", false, "error", auth.message, "canTest", false, "canPending", false)).build();
    }
    return Response.ok(Map.of(
        "ok", true,
        "canTest", auth.manageRealm && isTestApiEnabled(),
        "canPending", auth.manageRealm || auth.userManager)).build();
  }

  @GET
  @Path("pending-users")
  @Produces(MediaType.APPLICATION_JSON)
  public Response pendingUsers(
      @QueryParam("first") @DefaultValue("0") int first,
      @QueryParam("max") @DefaultValue("100") int max,
      @QueryParam("q") @DefaultValue("") String q) {
    AuthContext auth = authenticateAdminContext();
    if (!auth.authenticated) {
      return Response.status(auth.status).entity(Map.of("ok", false, "error", auth.message)).build();
    }
    if (!(auth.manageRealm || auth.userManager)) {
      return Response.status(Response.Status.FORBIDDEN).entity(Map.of("ok", false, "error", "manage-realm or user-manager role is required")).build();
    }

    int safeFirst = Math.max(0, first);
    int safeMax = Math.min(500, Math.max(1, max));
    String needle = q == null ? "" : q.trim().toLowerCase();
    List<Map<String, Object>> rows = new ArrayList<>();
    long totalUsers = Math.max(0, session.users().getUsersCount(auth.realm));
    long verifiedUsers = 0;
    long pendingUsers = 0;
    long filteredPendingUsers = 0;
    int scanFirst = 0;
    int scanMax = 500;

    while (true) {
      List<UserModel> page = session.users().searchForUserStream(auth.realm, "", scanFirst, scanMax).collect(Collectors.toList());
      if (page.isEmpty()) {
        break;
      }

      for (UserModel user : page) {
        String phoneVerified = user.getFirstAttribute("phone_verified");
        boolean isVerified = "true".equalsIgnoreCase(phoneVerified);
        if (isVerified) {
          verifiedUsers++;
          continue;
        }

        pendingUsers++;
        String username = user.getUsername() == null ? "" : user.getUsername();
        String mobile = user.getFirstAttribute("phone_number");
        mobile = mobile == null ? "" : mobile;
        boolean matches = needle.isEmpty()
            || username.toLowerCase().contains(needle)
            || mobile.toLowerCase().contains(needle);
        if (!matches) {
          continue;
        }

        filteredPendingUsers++;
        if (filteredPendingUsers <= safeFirst || rows.size() >= safeMax) {
          continue;
        }

        Map<String, Object> row = new HashMap<>();
        row.put("id", user.getId());
        row.put("username", username);
        row.put("email", user.getEmail());
        row.put("firstName", user.getFirstName());
        row.put("lastName", user.getLastName());
        row.put("enabled", user.isEnabled());
        row.put("mobile", mobile);
        row.put("phoneVerified", phoneVerified == null ? "false" : phoneVerified);
        row.put("phoneVerifiedAt", user.getFirstAttribute("phone_verified_at"));
        row.put("adminUserPath", "/admin/" + auth.realm.getName() + "/console/#/" + auth.realm.getName() + "/users/" + user.getId());
        rows.add(row);
      }

      scanFirst += page.size();
    }

    return Response.ok(Map.of(
        "ok", true,
        "first", safeFirst,
        "max", safeMax,
        "totalUsers", totalUsers,
        "verifiedUsers", verifiedUsers,
        "pendingUsers", pendingUsers,
        "filteredPendingUsers", filteredPendingUsers,
        "query", needle,
        "count", rows.size(),
        "users", rows)).build();
  }

  @POST
  @Path("token")
  @Produces(MediaType.APPLICATION_JSON)
  public Response generateToken() {
    if (!isTestApiEnabled()) {
      return Response.status(Response.Status.FORBIDDEN)
          .entity(Map.of("ok", false, "error", "OTP test API is disabled"))
          .build();
    }
    AuthContext auth = authenticateAdminContext();
    if (!auth.authenticated) {
      return Response.status(auth.status)
          .entity(Map.of("ok", false, "error", auth.message))
          .build();
    }
    if (!auth.manageRealm) {
      return Response.status(Response.Status.FORBIDDEN)
          .entity(Map.of("ok", false, "error", "manage-realm role is required"))
          .build();
    }

    purgeExpiredTokens();
    String token = UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "");
    long expiresAt = Instant.now().plusSeconds(TEST_TOKEN_TTL_SECONDS).getEpochSecond();
    TOKENS.put(token, new TokenRecord(auth.realm.getName(), auth.user.getId(), auth.user.getUsername(), expiresAt));
    return Response.ok(Map.of(
        "ok", true,
        "token", token,
        "expiresAtEpoch", expiresAt,
        "ttlSeconds", TEST_TOKEN_TTL_SECONDS)).build();
  }

  @POST
  @Path("test")
  @Consumes(MediaType.APPLICATION_JSON)
  @Produces(MediaType.APPLICATION_JSON)
  public Response sendTest(TestSmsRequest req) {
    if (!isTestApiEnabled()) {
      return Response.status(Response.Status.FORBIDDEN)
          .entity(Map.of("ok", false, "error", "OTP test API is disabled"))
          .build();
    }
    AuthContext auth = authenticateAdminContext();
    boolean authorizedViaAdmin = auth.authenticated && auth.manageRealm;
    String realmName = auth.realm != null ? auth.realm.getName() : (session.getContext().getRealm() != null ? session.getContext().getRealm().getName() : null);
    String userId = auth.user != null ? auth.user.getId() : "token-user";
    String username = auth.user != null ? auth.user.getUsername() : "token-user";

    if (!authorizedViaAdmin) {
      String token = session.getContext().getHttpRequest().getHttpHeaders().getHeaderString("X-Phone-Otp-Test-Token");
      if (isBlank(token)) {
        return Response.status(Response.Status.UNAUTHORIZED)
            .entity(Map.of("ok", false, "error", "Provide manage-realm auth or X-Phone-Otp-Test-Token"))
            .build();
      }
      purgeExpiredTokens();
      TokenRecord rec = TOKENS.get(token);
      if (rec == null || rec.expiresAtEpoch < Instant.now().getEpochSecond()) {
        return Response.status(Response.Status.UNAUTHORIZED)
            .entity(Map.of("ok", false, "error", "Invalid or expired test token"))
            .build();
      }
      realmName = rec.realmName;
      userId = rec.userId;
      username = rec.username;
    }

    if (req == null || isBlank(req.primaryEndpoint) || isBlank(req.mobile) || isBlank(req.message)) {
      return Response.status(Response.Status.BAD_REQUEST)
          .entity(Map.of("ok", false, "error", "primaryEndpoint, mobile, message are required"))
          .build();
    }
    Set<String> allowedHosts = parseAllowedHosts();
    String primaryErr = validateEndpoint(req.primaryEndpoint, allowedHosts);
    if (primaryErr != null) {
      return Response.status(Response.Status.BAD_REQUEST)
          .entity(Map.of("ok", false, "error", primaryErr))
          .build();
    }
    if (!isBlank(req.backupEndpoint)) {
      String backupErr = validateEndpoint(req.backupEndpoint, allowedHosts);
      if (backupErr != null) {
        return Response.status(Response.Status.BAD_REQUEST)
            .entity(Map.of("ok", false, "error", backupErr))
            .build();
      }
    }

    String tokenHeader = isBlank(req.tokenHeader) ? "X-OTP-Token" : req.tokenHeader;
    int retries = req.retryMax == null ? 2 : req.retryMax;
    int backoffMs = req.retryBackoffMs == null ? 500 : req.retryBackoffMs;
    String requestToken = UUID.randomUUID().toString();
    Map<String, Object> payload = SmsHttpSender.buildSmsPayload(
        defaultIfBlank(req.mobileField, "mobile"),
        defaultIfBlank(req.messageField, "message"),
        req.mobile,
        req.message);

    boolean ok = smsSender.sendWithRetry(
        req.primaryEndpoint,
        req.backupEndpoint,
        defaultIfBlank(req.bearer, ""),
        tokenHeader,
        requestToken,
        payload,
        retries,
        backoffMs,
        username,
        userId);

    if (!ok) {
      return Response.status(Response.Status.BAD_GATEWAY)
          .entity(Map.of("ok", false, "error", "SMS API call failed on primary+backup"))
          .build();
    }
    return Response.ok(Map.of("ok", true, "message", "Test SMS sent", "realm", realmName)).build();
  }

  private static boolean isBlank(String s) {
    return s == null || s.isBlank();
  }

  private static boolean isTestApiEnabled() {
    return Boolean.parseBoolean(System.getenv().getOrDefault(ENV_TEST_API_ENABLED, "false"));
  }

  private static Set<String> parseAllowedHosts() {
    String raw = System.getenv().getOrDefault(ENV_TEST_API_ALLOWED_HOSTS, "").trim();
    if (raw.isEmpty()) {
      return Set.of();
    }
    return Arrays.stream(raw.split(","))
        .map(String::trim)
        .filter(v -> !v.isEmpty())
        .map(v -> v.toLowerCase(Locale.ROOT))
        .collect(Collectors.toCollection(HashSet::new));
  }

  private static String validateEndpoint(String endpoint, Set<String> allowedHosts) {
    URI uri;
    try {
      uri = URI.create(endpoint);
    } catch (Exception e) {
      return "Endpoint URL is invalid";
    }
    String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
    String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
    if (host.isBlank()) {
      return "Endpoint host is required";
    }
    boolean localHttp = "http".equals(scheme)
        && ("localhost".equals(host) || "127.0.0.1".equals(host));
    boolean allowedHttp = localHttp || isTestApiEnabled();
    if (!"https".equals(scheme) && !allowedHttp) {
      return "Endpoint must use https (or local http for localhost/127.0.0.1)";
    }
    if (!allowedHosts.isEmpty() && !allowedHosts.contains(host)) {
      return "Endpoint host is not in allowed host list";
    }
    return null;
  }

  private static String defaultIfBlank(String v, String d) {
    return isBlank(v) ? d : v;
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

  public static class TestSmsRequest {
    public String primaryEndpoint;
    public String backupEndpoint;
    public String bearer;
    public String tokenHeader;
    public String mobileField;
    public String messageField;
    public String mobile;
    public String message;
    public Integer retryMax;
    public Integer retryBackoffMs;
  }

  private AuthContext authenticateAdminContext() {
    RealmModel realm = session.getContext().getRealm();
    if (realm == null) {
      return AuthContext.unauth(Response.Status.UNAUTHORIZED, "No realm context");
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
    if (authResult == null) {
      return AuthContext.unauth(Response.Status.UNAUTHORIZED, "User is not authenticated");
    }
    UserModel user = authResult.getUser();
    ClientModel realmManagement = realm.getClientByClientId("realm-management");
    RoleModel manageRealm = realmManagement == null ? null : realmManagement.getRole("manage-realm");
    boolean hasManageRealm = manageRealm != null && user.hasRole(manageRealm);
    RoleModel userManager = realm.getRole("user-manager");
    boolean hasUserManager = userManager != null && user.hasRole(userManager);
    return AuthContext.authenticated(realm, user, hasManageRealm, hasUserManager);
  }

  private void purgeExpiredTokens() {
    long now = Instant.now().getEpochSecond();
    Iterator<Map.Entry<String, TokenRecord>> it = TOKENS.entrySet().iterator();
    while (it.hasNext()) {
      Map.Entry<String, TokenRecord> e = it.next();
      if (e.getValue().expiresAtEpoch < now) {
        it.remove();
      }
    }
  }

  private static final class TokenRecord {
    final String realmName;
    final String userId;
    final String username;
    final long expiresAtEpoch;

    TokenRecord(String realmName, String userId, String username, long expiresAtEpoch) {
      this.realmName = realmName;
      this.userId = userId;
      this.username = username;
      this.expiresAtEpoch = expiresAtEpoch;
    }
  }

  private static final class AuthContext {
    final boolean authenticated;
    final Response.Status status;
    final String message;
    final RealmModel realm;
    final UserModel user;
    final boolean manageRealm;
    final boolean userManager;

    private AuthContext(boolean authenticated, Response.Status status, String message, RealmModel realm, UserModel user, boolean manageRealm, boolean userManager) {
      this.authenticated = authenticated;
      this.status = status;
      this.message = message;
      this.realm = realm;
      this.user = user;
      this.manageRealm = manageRealm;
      this.userManager = userManager;
    }

    static AuthContext authenticated(RealmModel realm, UserModel user, boolean manageRealm, boolean userManager) {
      return new AuthContext(true, Response.Status.OK, "", realm, user, manageRealm, userManager);
    }

    static AuthContext unauth(Response.Status status, String msg) {
      return new AuthContext(false, status, msg, null, null, false, false);
    }
  }
}
