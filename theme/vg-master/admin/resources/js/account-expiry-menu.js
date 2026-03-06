(function () {
  "use strict";

  var DASH_LINK_ID = "vg-account-expiry-link";
  var DASH_MODAL_ID = "vg-account-expiry-modal";

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getRealmFromPath() {
    var m = window.location.pathname.match(/^\/admin\/([^/]+)\/console/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function getApiBase() {
    var realm = getRealmFromPath();
    if (!realm) return null;
    return window.location.origin + "/realms/" + encodeURIComponent(realm) + "/account-expiry-admin";
  }

  function createModal() {
    var overlay = document.createElement("div");
    overlay.id = DASH_MODAL_ID;
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.45)";
    overlay.style.display = "none";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "9999";

    var modal = document.createElement("div");
    modal.style.width = "min(1280px, 97vw)";
    modal.style.maxHeight = "90vh";
    modal.style.overflow = "auto";
    modal.style.background = "#fff";
    modal.style.borderRadius = "8px";
    modal.style.padding = "16px";

    var header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.marginBottom = "12px";

    var title = document.createElement("h2");
    title.textContent = "Account Expiry Dashboard";
    title.style.margin = "0";

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "Close";
    closeBtn.style.padding = "6px 10px";
    closeBtn.style.border = "1px solid #c7c7c7";
    closeBtn.style.background = "#fff";
    closeBtn.style.borderRadius = "4px";
    closeBtn.style.cursor = "pointer";
    closeBtn.addEventListener("click", function () {
      overlay.style.display = "none";
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    var msg = document.createElement("div");
    msg.id = "vg-exp-dash-msg";
    msg.style.marginBottom = "12px";
    msg.style.fontSize = "12px";

    var help = document.createElement("div");
    help.style.fontSize = "12px";
    help.style.background = "#f5f5f5";
    help.style.border = "1px solid #d8d8d8";
    help.style.borderRadius = "4px";
    help.style.padding = "8px";
    help.style.marginBottom = "10px";
    help.innerHTML = "Edit expiry from user profile attributes <code>account_expiry_date</code> (yyyy-MM-dd) and <code>account_expiry_timezone</code> (IANA, default Asia/Kolkata).";

    var refreshWrap = document.createElement("div");
    refreshWrap.style.marginBottom = "10px";
    var refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.textContent = "Refresh";
    refreshBtn.style.padding = "8px 12px";
    refreshBtn.style.border = "1px solid #c7c7c7";
    refreshBtn.style.background = "#fff";
    refreshBtn.style.borderRadius = "4px";
    refreshBtn.style.cursor = "pointer";
    refreshBtn.addEventListener("click", function () { loadDashboard(); });
    refreshWrap.appendChild(refreshBtn);

    var counts = document.createElement("div");
    counts.id = "vg-exp-counts";
    counts.style.margin = "0 0 8px 0";
    counts.style.fontSize = "13px";

    var upTitle = document.createElement("h3");
    upTitle.textContent = "Upcoming Expirations (Next 2 Weeks)";
    upTitle.style.margin = "12px 0 6px 0";

    var upWrap = document.createElement("div");
    upWrap.id = "vg-exp-upcoming";

    var recentTitle = document.createElement("h3");
    recentTitle.textContent = "Recent Expirations (Last 2 Weeks)";
    recentTitle.style.margin = "14px 0 6px 0";

    var recentWrap = document.createElement("div");
    recentWrap.id = "vg-exp-recent";

    modal.appendChild(header);
    modal.appendChild(msg);
    modal.appendChild(help);
    modal.appendChild(refreshWrap);
    modal.appendChild(counts);
    modal.appendChild(upTitle);
    modal.appendChild(upWrap);
    modal.appendChild(recentTitle);
    modal.appendChild(recentWrap);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.style.display = "none";
    });

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    return overlay;
  }

  function getModal() {
    return document.getElementById(DASH_MODAL_ID) || createModal();
  }

  function setDashMessage(text, error) {
    var node = document.getElementById("vg-exp-dash-msg");
    if (!node) return;
    node.textContent = text || "";
    node.style.color = error ? "#b42318" : "#1f6feb";
  }

  function rowToHtml(row) {
    var userPath = String(row.adminUserPath || "");
    if (!/\/settings$/.test(userPath)) userPath += "/settings";
    var url = window.location.origin + userPath;
    return (
      "<tr>" +
      "<td>" + escapeHtml(row.displayName || row.username) + "</td>" +
      "<td>" + escapeHtml(row.designation) + "</td>" +
      "<td>" + escapeHtml(row.email) + "</td>" +
      "<td>" + escapeHtml(row.phoneNumber) + "</td>" +
      "<td><code>" + escapeHtml(row.expiryUtc) + "</code></td>" +
      "<td><a href=\"" + escapeHtml(url) + "\" target=\"_blank\" rel=\"noopener\">Open User</a></td>" +
      "</tr>"
    );
  }

  function renderTable(rows, containerId) {
    var node = document.getElementById(containerId);
    if (!node) return;

    if (!rows || rows.length === 0) {
      node.innerHTML = "<div style='font-size:12px;color:#666'>No records.</div>";
      return;
    }

    var html = "";
    html += "<table style='width:100%;border-collapse:collapse;font-size:12px'>";
    html += "<thead><tr>";
    html += "<th style='text-align:left;border-bottom:1px solid #ddd;padding:6px'>User Name</th>";
    html += "<th style='text-align:left;border-bottom:1px solid #ddd;padding:6px'>Designation</th>";
    html += "<th style='text-align:left;border-bottom:1px solid #ddd;padding:6px'>Email</th>";
    html += "<th style='text-align:left;border-bottom:1px solid #ddd;padding:6px'>Phone Number</th>";
    html += "<th style='text-align:left;border-bottom:1px solid #ddd;padding:6px'>Expiry Date (UTC)</th>";
    html += "<th style='text-align:left;border-bottom:1px solid #ddd;padding:6px'>Actions</th>";
    html += "</tr></thead><tbody>";
    for (var i = 0; i < rows.length; i++) html += rowToHtml(rows[i]);
    html += "</tbody></table>";
    node.innerHTML = html;
  }

  async function loadDashboard() {
    var base = getApiBase();
    if (!base) {
      setDashMessage("Unable to resolve realm context from URL.", true);
      return;
    }

    setDashMessage("Loading...");
    try {
      var res = await fetch(base + "/expirations?windowDays=14", {
        method: "GET",
        credentials: "include"
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        setDashMessage((data && data.error) || ("Failed (" + res.status + ")"), true);
        return;
      }

      document.getElementById("vg-exp-counts").innerHTML =
        "Upcoming: <b>" + (data.counts && data.counts.upcoming || 0) +
        "</b> | Recent: <b>" + (data.counts && data.counts.recent || 0) + "</b>";

      renderTable(data.upcoming || [], "vg-exp-upcoming");
      renderTable(data.recent || [], "vg-exp-recent");
      setDashMessage("Loaded.");
    } catch (e) {
      setDashMessage(String(e), true);
    }
  }

  function openDashboard() {
    var modal = getModal();
    modal.style.display = "flex";
    loadDashboard();
  }

  function injectNavLink() {
    if (document.getElementById(DASH_LINK_ID)) return;

    var navList = document.querySelector(".pf-v5-c-nav__list, .pf-c-nav__list");
    if (!navList) return;

    var li = document.createElement("li");
    li.className = "pf-v5-c-nav__item pf-c-nav__item";
    li.style.marginTop = "auto";

    var a = document.createElement("a");
    a.id = DASH_LINK_ID;
    a.href = "#";
    a.className = "pf-v5-c-nav__link pf-c-nav__link";
    a.innerHTML =
      "<span aria-hidden='true' style='display:inline-flex;width:14px;height:14px;margin-right:8px;vertical-align:text-bottom'>" +
      "<svg viewBox='0 0 24 24' width='14' height='14' fill='currentColor' xmlns='http://www.w3.org/2000/svg'><path d='M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 15-4-4 1.4-1.4 2.6 2.58 5.6-5.58L18 9l-7 7z'/></svg>" +
      "</span><span>Account Expiry</span>";

    a.addEventListener("click", function (e) {
      e.preventDefault();
      openDashboard();
    });

    li.appendChild(a);

    var parent = navList.parentElement;
    if (parent) {
      parent.style.display = "flex";
      parent.style.flexDirection = "column";
      parent.style.minHeight = "100%";
    }
    navList.style.display = "flex";
    navList.style.flexDirection = "column";
    navList.style.minHeight = "100%";
    navList.appendChild(li);
  }

  function boot() {
    injectNavLink();
    var obs = new MutationObserver(function () {
      injectNavLink();
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
