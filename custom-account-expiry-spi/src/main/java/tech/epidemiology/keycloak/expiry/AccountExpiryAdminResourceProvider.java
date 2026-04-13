package tech.epidemiology.keycloak.expiry;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.jboss.logging.Logger;
import org.keycloak.models.ClientModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.RoleModel;
import org.keycloak.models.UserModel;
import org.keycloak.services.managers.AppAuthManager;
import org.keycloak.services.managers.AuthenticationManager;
import org.keycloak.services.resource.RealmResourceProvider;

public class AccountExpiryAdminResourceProvider implements RealmResourceProvider {
  private static final Logger LOG = Logger.getLogger(AccountExpiryAdminResourceProvider.class);

  private final KeycloakSession session;

  public AccountExpiryAdminResourceProvider(KeycloakSession session) {
    this.session = session;
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
  public Response dashboardUi() {
    AuthContext auth = authenticateForRoles("view-users", "manage-users");
    if (!auth.ok) {
      String body = "<!doctype html><html><head><meta charset='utf-8'><title>Account Expiry Dashboard</title></head>"
          + "<body style='font-family:system-ui,sans-serif;padding:24px'>"
          + "<h1 style='margin-top:0'>Account Expiry Dashboard</h1>"
          + "<p style='color:#b42318'>"
          + escapeHtml(auth.message)
          + "</p></body></html>";
      return Response.status(auth.status).type(MediaType.TEXT_HTML_TYPE).entity(body).build();
    }

    String body = "<!doctype html>"
        + "<html><head><meta charset='utf-8'>"
        + "<meta name='viewport' content='width=device-width, initial-scale=1'>"
        + "<title>Account Expiry Dashboard</title>"
        + "<style>"
        + "body{font-family:system-ui,sans-serif;margin:0;background:#f7f7f8;color:#161616}"
        + ".wrap{max-width:1280px;margin:0 auto;padding:24px}"
        + ".bar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}"
        + ".card{background:#fff;border:1px solid #d8d8d8;border-radius:8px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.04)}"
        + ".note{font-size:12px;background:#f5f5f5}"
        + ".msg{margin-bottom:12px;font-size:13px}"
        + "button{padding:8px 12px;border:1px solid #c7c7c7;background:#fff;border-radius:4px;cursor:pointer}"
        + "table{width:100%;border-collapse:collapse;font-size:12px}"
        + "th,td{text-align:left;border-bottom:1px solid #ddd;padding:6px;vertical-align:top}"
        + "h1,h2{margin:0}"
        + "h2{margin:16px 0 8px 0;font-size:18px}"
        + "code{font-family:ui-monospace,SFMono-Regular,monospace}"
        + "@media (max-width: 768px){.wrap{padding:16px}table{display:block;overflow:auto;white-space:nowrap}}"
        + "</style></head>"
        + "<body><div class='wrap'>"
        + "<div class='bar'><div><h1>Account Expiry Dashboard</h1><div style='font-size:13px;color:#666'>Realm: "
        + escapeHtml(auth.realm.getName())
        + "</div></div><button type='button' id='refreshBtn'>Refresh</button></div>"
        + "<div id='msg' class='msg'></div>"
        + "<div class='card note' style='margin-bottom:12px'>"
        + "Edit expiry from user profile attributes <code>account_expiry_date</code> (yyyy-MM-dd) and "
        + "<code>account_expiry_timezone</code> (IANA, default Asia/Kolkata)."
        + "</div>"
        + "<div id='counts' class='card' style='margin-bottom:12px;font-size:13px'>Loading...</div>"
        + "<div class='card'><h2>Upcoming Expirations (Next 2 Weeks)</h2><div id='upcoming'></div></div>"
        + "<div class='card' style='margin-top:12px'><h2>Recent Expirations (Last 2 Weeks)</h2><div id='recent'></div></div>"
        + "</div>"
        + "<script>"
        + "(function(){"
        + "function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\\"/g,'&quot;').replace(/'/g,'&#39;');}"
        + "function msg(text,error){var el=document.getElementById('msg');el.textContent=text||'';el.style.color=error?'#b42318':'#1f6feb';}"
        + "function rowUrl(row){var p=String(row.adminUserPath||'');if(!/\\/settings$/.test(p))p+='/settings';return p;}"
        + "function table(rows){if(!rows||rows.length===0)return \"<div style='font-size:12px;color:#666'>No records.</div>\";"
        + "var html=\"<table><thead><tr><th>User Name</th><th>Designation</th><th>Email</th><th>Phone Number</th><th>Expiry Date (UTC)</th><th>Actions</th></tr></thead><tbody>\";"
        + "for(var i=0;i<rows.length;i++){var row=rows[i];html+=\"<tr><td>\"+esc(row.displayName||row.username)+\"</td><td>\"+esc(row.designation)+\"</td><td>\"+esc(row.email)+\"</td><td>\"+esc(row.phoneNumber)+\"</td><td><code>\"+esc(row.expiryUtc)+\"</code></td><td><a href='\"+esc(rowUrl(row))+\"' target='_blank' rel='noopener'>Open User</a></td></tr>\";}"
        + "return html+\"</tbody></table>\";}"
        + "async function load(){msg('Loading...');try{var res=await fetch('expirations?windowDays=14',{credentials:'include'});var data=await res.json().catch(function(){return {};});if(!res.ok){msg((data&&data.error)||('Failed ('+res.status+')'),true);return;}document.getElementById('counts').innerHTML='Upcoming: <b>' + (((data.counts||{}).upcoming)||0) + '</b> | Recent: <b>' + (((data.counts||{}).recent)||0) + '</b>';document.getElementById('upcoming').innerHTML=table(data.upcoming||[]);document.getElementById('recent').innerHTML=table(data.recent||[]);msg('Loaded.');}catch(e){msg(String(e),true);}}"
        + "document.getElementById('refreshBtn').addEventListener('click',load);load();"
        + "})();"
        + "</script></body></html>";

    return Response.ok(body).type(MediaType.TEXT_HTML_TYPE).build();
  }

  @GET
  @Path("timezones")
  @Produces(MediaType.APPLICATION_JSON)
  public Response listTimezones() {
    AuthContext auth = authenticateForRoles("view-users", "manage-users");
    if (!auth.ok) {
      return Response.status(auth.status).entity(Map.of("ok", false, "error", auth.message)).build();
    }

    List<String> timezones = ZoneId.getAvailableZoneIds().stream()
        .sorted()
        .collect(Collectors.toList());

    return Response.ok(Map.of(
        "ok", true,
        "realm", auth.realm.getName(),
        "count", timezones.size(),
        "defaultTimezone", AccountExpiryUtil.resolveRealmDefaultTimezone(auth.realm),
        "timezones", timezones))
        .build();
  }

  @GET
  @Path("expirations")
  @Produces(MediaType.APPLICATION_JSON)
  public Response listExpirations(@QueryParam("windowDays") Integer windowDays) {
    AuthContext auth = authenticateForRoles("view-users", "manage-users");
    if (!auth.ok) {
      return Response.status(auth.status).entity(Map.of("ok", false, "error", auth.message)).build();
    }

    int days = normalizeDays(windowDays);
    String realmDefaultTz = AccountExpiryUtil.resolveRealmDefaultTimezone(auth.realm);
    Instant now = Instant.now();
    Instant recentStart = now.minusSeconds(days * 86400L);
    Instant upcomingEnd = now.plusSeconds(days * 86400L);

    List<Map<String, Object>> upcoming = new ArrayList<>();
    List<Map<String, Object>> recent = new ArrayList<>();

    try (Stream<UserModel> users = session.users().searchForUserStream(auth.realm, Map.of(), null, null)) {
      users.forEach(user -> {
        AccountExpiryUtil.ExpiryStatus status = resolveEffectiveExpiry(user, auth.realm, realmDefaultTz, now);
        if (status == null) {
          return;
        }

        Instant expiry = status.expiryInstant();
        if (expiry.isAfter(now) && !expiry.isAfter(upcomingEnd)) {
          upcoming.add(toEntry(auth.realm, user, status));
        } else if (!expiry.isBefore(recentStart) && !expiry.isAfter(now)) {
          recent.add(toEntry(auth.realm, user, status));
        }
      });
    }

    Comparator<Map<String, Object>> byUtcAsc = Comparator.comparing(m -> (String) m.get("expiryUtc"));
    upcoming.sort(byUtcAsc);
    recent.sort(byUtcAsc.reversed());

    return Response.ok(Map.of(
        "ok", true,
        "realm", auth.realm.getName(),
        "windowDays", days,
        "upcoming", upcoming,
        "recent", recent,
        "counts", Map.of("upcoming", upcoming.size(), "recent", recent.size())))
        .build();
  }

  @POST
  @Path("users/{userId}/expiry")
  @Consumes(MediaType.APPLICATION_JSON)
  @Produces(MediaType.APPLICATION_JSON)
  public Response setExpiry(@PathParam("userId") String userId, SetExpiryRequest req) {
    AuthContext auth = authenticateForRoles("manage-users");
    if (!auth.ok) {
      return Response.status(auth.status).entity(Map.of("ok", false, "error", auth.message)).build();
    }
    if (userId == null || userId.isBlank()) {
      return Response.status(Response.Status.BAD_REQUEST).entity(Map.of("ok", false, "error", "userId is required")).build();
    }

    UserModel user = session.users().getUserById(auth.realm, userId);
    if (user == null) {
      return Response.status(Response.Status.NOT_FOUND).entity(Map.of("ok", false, "error", "User not found")).build();
    }

    if (req != null && Boolean.TRUE.equals(req.clear)) {
      user.removeAttribute(AccountExpiryUtil.ATTR_EXPIRY_DATE);
      user.removeAttribute(AccountExpiryUtil.ATTR_EXPIRY_TIMEZONE);
      LOG.infof("ACCOUNT_EXPIRY_CLEAR realm=%s userId=%s username=%s admin=%s", auth.realm.getName(), user.getId(),
          user.getUsername(), auth.user.getUsername());
      return Response.ok(Map.of("ok", true, "userId", userId, "cleared", true)).build();
    }

    if (req == null) {
      return Response.status(Response.Status.BAD_REQUEST)
          .entity(Map.of("ok", false, "error", "Request body is required"))
          .build();
    }

    Instant expiryUtc;
    String tzForStorage;

    if (AccountExpiryUtil.isBlank(req.localDate)) {
      return Response.status(Response.Status.BAD_REQUEST)
          .entity(Map.of("ok", false, "error", "Provide localDate (yyyy-MM-dd)"))
          .build();
    }
    tzForStorage = AccountExpiryUtil.normalizeZone(req.timeZone, AccountExpiryUtil.resolveRealmDefaultTimezone(auth.realm));
    if (tzForStorage == null) {
      return Response.status(Response.Status.BAD_REQUEST)
          .entity(Map.of("ok", false, "error", "Invalid IANA timeZone"))
          .build();
    }
    try {
      expiryUtc = AccountExpiryUtil.dateToUtcExpiryInstant(req.localDate, tzForStorage, true);
    } catch (Exception ex) {
      return Response.status(Response.Status.BAD_REQUEST)
          .entity(Map.of("ok", false, "error", "localDate must be format yyyy-MM-dd"))
          .build();
    }

    user.setSingleAttribute(AccountExpiryUtil.ATTR_EXPIRY_DATE, req.localDate);
    user.setSingleAttribute(AccountExpiryUtil.ATTR_EXPIRY_TIMEZONE, tzForStorage);

    LOG.infof("ACCOUNT_EXPIRY_SET realm=%s userId=%s username=%s date=%s expiryUtc=%s timezone=%s admin=%s",
        auth.realm.getName(), user.getId(), user.getUsername(), req.localDate, expiryUtc, tzForStorage,
        auth.user.getUsername());

    return Response.ok(Map.of(
        "ok", true,
        "userId", user.getId(),
        "username", user.getUsername(),
        "localDate", req.localDate,
        "expiryUtc", expiryUtc.toString(),
        "timeZone", tzForStorage))
        .build();
  }

  @GET
  @Path("users/{userId}/expiry")
  @Produces(MediaType.APPLICATION_JSON)
  public Response getExpiry(@PathParam("userId") String userId) {
    AuthContext auth = authenticateForRoles("view-users", "manage-users");
    if (!auth.ok) {
      return Response.status(auth.status).entity(Map.of("ok", false, "error", auth.message)).build();
    }
    if (userId == null || userId.isBlank()) {
      return Response.status(Response.Status.BAD_REQUEST).entity(Map.of("ok", false, "error", "userId is required")).build();
    }
    UserModel user = session.users().getUserById(auth.realm, userId);
    if (user == null) {
      return Response.status(Response.Status.NOT_FOUND).entity(Map.of("ok", false, "error", "User not found")).build();
    }

    String timeZone = AccountExpiryUtil.normalizeZone(
        AccountExpiryUtil.firstNonBlank(
            user.getFirstAttribute(AccountExpiryUtil.ATTR_EXPIRY_TIMEZONE),
            user.getFirstAttribute("zoneinfo")),
        AccountExpiryUtil.resolveRealmDefaultTimezone(auth.realm));
    String localDate = user.getFirstAttribute(AccountExpiryUtil.ATTR_EXPIRY_DATE);

    Instant parsed = null;
    if (!AccountExpiryUtil.isBlank(localDate)) {
      parsed = AccountExpiryUtil.dateToUtcExpiryInstant(localDate, timeZone, true);
    }

    return Response.ok(Map.of(
        "ok", true,
        "userId", user.getId(),
        "username", user.getUsername() == null ? "" : user.getUsername(),
        "expiryUtc", parsed == null ? "" : parsed.toString(),
        "localDate", localDate == null ? "" : localDate,
        "timeZone", timeZone == null ? AccountExpiryUtil.resolveRealmDefaultTimezone(auth.realm) : timeZone,
        "hasExpiry", parsed != null))
        .build();
  }

  private Map<String, Object> toEntry(RealmModel realm, UserModel user, AccountExpiryUtil.ExpiryStatus status) {
    String local = AccountExpiryUtil.isBlank(status.localDate()) ? "" : (status.localDate() + " 23:59:59");

    String displayName = joinName(user.getFirstName(), user.getLastName());
    String designation = AccountExpiryUtil.firstNonBlank(
        user.getFirstAttribute("designation"),
        user.getFirstAttribute("job_title"),
        user.getFirstAttribute("jobTitle"),
        "");
    String phoneNumber = AccountExpiryUtil.firstNonBlank(
        user.getFirstAttribute("phone_number"),
        user.getFirstAttribute("phone"),
        user.getFirstAttribute("mobile"),
        "");
    return Map.ofEntries(
        Map.entry("userId", user.getId()),
        Map.entry("username", nullToEmpty(user.getUsername())),
        Map.entry("displayName", displayName),
        Map.entry("designation", designation),
        Map.entry("email", nullToEmpty(user.getEmail())),
        Map.entry("phoneNumber", phoneNumber),
        Map.entry("enabled", user.isEnabled()),
        Map.entry("expiryUtc", status.expiryInstant().toString()),
        Map.entry("localDateTime", local),
        Map.entry("localDate", nullToEmpty(status.localDate())),
        Map.entry("timeZone", status.timeZone()),
        Map.entry("daysRemaining", status.daysRemaining()),
        Map.entry("warning", AccountExpiryUtil.isWithinWarningWindow(status.daysRemaining(), AccountExpiryUtil.DEFAULT_WARNING_WINDOW_DAYS) && !status.expired()),
        Map.entry("expired", status.expired()),
        Map.entry("adminUserPath", "/admin/" + realm.getName() + "/console/#/" + realm.getName() + "/users/" + user.getId()));
  }

  private AccountExpiryUtil.ExpiryStatus resolveEffectiveExpiry(
      UserModel user,
      RealmModel realm,
      String realmDefaultTz,
      Instant now) {
    try {
      return AccountExpiryUtil.resolveExpiryStatus(
          user,
          realm,
          AccountExpiryUtil.ATTR_EXPIRY_DATE,
          AccountExpiryUtil.ATTR_EXPIRY_TIMEZONE,
          realmDefaultTz,
          true,
          now);
    } catch (Exception e) {
      return null;
    }
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
    ClientModel realmManagement = realm.getClientByClientId("realm-management");
    if (realmManagement == null) {
      return AuthContext.fail(Response.Status.FORBIDDEN, "realm-management client is missing");
    }

    for (String roleName : roleNames) {
      RoleModel role = realmManagement.getRole(roleName);
      if (role != null && user.hasRole(role)) {
        return AuthContext.ok(realm, user);
      }
    }

    return AuthContext.fail(Response.Status.FORBIDDEN, "Required realm-management role is missing");
  }

  private int normalizeDays(Integer days) {
    if (days == null) {
      return 14;
    }
    if (days < 1) {
      return 1;
    }
    return Math.min(days, 60);
  }

  private static String nullToEmpty(String v) {
    return v == null ? "" : v;
  }

  private static String joinName(String firstName, String lastName) {
    String v = (nullToEmpty(firstName) + " " + nullToEmpty(lastName)).trim();
    return v;
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

  public static final class SetExpiryRequest {
    public String localDate;
    public String timeZone;
    public Boolean clear;
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
