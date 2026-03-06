document.addEventListener("DOMContentLoaded", function () {
  var logo = document.getElementById("kc-header-wrapper");
  var params = new URLSearchParams(window.location.search);
  var isAdminConsoleLogin =
    params.get("client_id") === "security-admin-console";

  if (isAdminConsoleLogin) {
    document.documentElement.setAttribute("data-login-context", "admin-console");

    var loginButton = document.getElementById("kc-login");
    if (
      loginButton &&
      !document.querySelector(".vg-admin-login-note")
    ) {
      var note = document.createElement("div");
      note.className = "vg-admin-login-note";
      note.textContent = "Admin Login";
      loginButton.insertAdjacentElement("afterend", note);
    }
  }

  if (!logo) return;

  // Keycloak login URLs include the realm in the path:
  //   /realms/{realm-name}/...
  // This regex extracts that realm name so the redirect stays dynamic.
  var match = window.location.pathname.match(/\/realms\/([^/]+)/);
  // If no realm segment is found, default to "master".
  var realm = match && match[1] ? decodeURIComponent(match[1]) : "master";
  // Build the realm-specific target page (will trigger login if needed).
  var target = "/realms/" + encodeURIComponent(realm) + "/account/";

  logo.style.cursor = "pointer";
  logo.setAttribute("title", "Go to realm login");
  logo.setAttribute("aria-label", "Go to realm login");

  logo.addEventListener("click", function () {
    window.location.href = target;
  });
});
