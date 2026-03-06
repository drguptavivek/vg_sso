(function () {
  "use strict";

  var LINK_TEST_ID = "vg-phone-otp-test-link";
  var LINK_PENDING_ID = "vg-phone-otp-pending-link";
  var TEST_MODAL_ID = "vg-phone-otp-modal";
  var PENDING_MODAL_ID = "vg-phone-otp-pending-modal";
  var ACCESS_RIGHTS = null;

  function getRealmFromPath() {
    var m = window.location.pathname.match(/^\/admin\/([^/]+)\/console/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function getApiBase() {
    var realm = getRealmFromPath();
    if (!realm) return null;
    return window.location.origin + "/realms/" + encodeURIComponent(realm) + "/phone-otp-admin";
  }

  function getUserProfileUrl(user) {
    var p = String((user && user.adminUserPath) || "");
    if (!p) {
      var realm = getRealmFromPath();
      var userId = user && user.id ? String(user.id) : "";
      if (!realm || !userId) return "#";
      p = "/admin/" + realm + "/console/#/" + realm + "/users/" + userId;
    }
    if (!/\/settings$/.test(p)) p += "/settings";
    return window.location.origin + p;
  }

  async function getAccessRights() {
    if (ACCESS_RIGHTS !== null) return ACCESS_RIGHTS;
    var base = getApiBase();
    if (!base) {
      ACCESS_RIGHTS = { ok: false, canTest: false, canPending: false };
      return ACCESS_RIGHTS;
    }
    try {
      var res = await fetch(base + "/access", { method: "GET", credentials: "include" });
      var data = await res.json().catch(function () { return {}; });
      ACCESS_RIGHTS = {
        ok: !!res.ok,
        canTest: !!(data && data.canTest),
        canPending: !!(data && data.canPending)
      };
      return ACCESS_RIGHTS;
    } catch (e) {
      ACCESS_RIGHTS = { ok: false, canTest: false, canPending: false };
      return ACCESS_RIGHTS;
    }
  }

  function createField(labelText, id, placeholder, value) {
    var wrap = document.createElement("div");
    wrap.style.marginBottom = "10px";

    var label = document.createElement("label");
    label.textContent = labelText;
    label.setAttribute("for", id);
    label.style.display = "block";
    label.style.fontSize = "12px";
    label.style.marginBottom = "4px";

    var input = document.createElement("input");
    input.id = id;
    input.placeholder = placeholder || "";
    input.value = value || "";
    input.style.width = "100%";
    input.style.boxSizing = "border-box";
    input.style.padding = "8px";
    input.style.border = "1px solid #c7c7c7";
    input.style.borderRadius = "4px";

    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  function createBaseModal(modalId, titleText) {
    var existing = document.getElementById(modalId);
    if (existing) return existing;

    var overlay = document.createElement("div");
    overlay.id = modalId;
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.45)";
    overlay.style.display = "none";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "9999";

    var modal = document.createElement("div");
    modal.style.width = "min(1200px, 96vw)";
    modal.style.maxHeight = "88vh";
    modal.style.overflow = "auto";
    modal.style.background = "#fff";
    modal.style.borderRadius = "8px";
    modal.style.padding = "16px";
    modal.style.boxShadow = "0 12px 28px rgba(0,0,0,0.25)";

    var header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.marginBottom = "12px";

    var title = document.createElement("h2");
    title.textContent = titleText;
    title.style.margin = "0";
    title.style.fontSize = "20px";

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
    modal.appendChild(header);
    overlay.appendChild(modal);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.style.display = "none";
    });

    document.body.appendChild(overlay);
    return overlay;
  }

  function ensureTestModal() {
    var overlay = createBaseModal(TEST_MODAL_ID, "Phone OTP Test");
    if (overlay.dataset.ready === "true") return overlay;

    var modal = overlay.firstChild;

    var layout = document.createElement("div");
    layout.style.display = "grid";
    layout.style.gridTemplateColumns = "50% 50%";
    layout.style.gap = "14px";

    var left = document.createElement("div");
    var leftTitle = document.createElement("h3");
    leftTitle.textContent = "Request";
    leftTitle.style.margin = "0 0 8px 0";
    leftTitle.style.fontSize = "16px";
    left.appendChild(leftTitle);

    var explain = document.createElement("div");
    explain.style.fontSize = "12px";
    explain.style.lineHeight = "1.4";
    explain.style.background = "#f5f5f5";
    explain.style.border = "1px solid #d8d8d8";
    explain.style.borderRadius = "4px";
    explain.style.padding = "8px";
    explain.style.marginBottom = "10px";
    explain.innerHTML =
      "<b>Bearer Token</b>: SMS provider API token (sent to SMS endpoint).<br>" +
      "<b>Test Token</b>: Keycloak-local short-lived token (used only for /phone-otp-admin/test and curl testing).";
    left.appendChild(explain);

    left.appendChild(createField("Primary Endpoint", "vgOtpPrimary", "https://smsapplication.vg.edu/services/api/v1/sms/single", ""));
    left.appendChild(createField("Backup Endpoint (optional)", "vgOtpBackup", "", ""));
    left.appendChild(createField("Bearer Token (SMS API)", "vgOtpBearer", "Bearer token from SMS provider", ""));
    left.appendChild(createField("Test Token (Keycloak local)", "vgOtpTestToken", "Generate short-lived token", ""));
    left.appendChild(createField("Mobile Field", "vgOtpMobileField", "mobile", "mobile"));
    left.appendChild(createField("Message Field", "vgOtpMessageField", "message", "message"));
    left.appendChild(createField("Mobile", "vgOtpMobile", "9899xxxxxx", ""));
    left.appendChild(createField("Message", "vgOtpMessage", "OTP For VG SSO Verification is: 123456", "OTP For VG SSO Verification is: 123456"));
    left.appendChild(createField("Retry Max", "vgOtpRetryMax", "2", "2"));
    left.appendChild(createField("Retry Backoff (ms)", "vgOtpRetryBackoff", "500", "500"));

    var actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.marginTop = "8px";

    var genBtn = document.createElement("button");
    genBtn.type = "button";
    genBtn.textContent = "Generate Token";
    genBtn.style.padding = "8px 12px";
    genBtn.style.border = "none";
    genBtn.style.background = "#06c";
    genBtn.style.color = "#fff";
    genBtn.style.borderRadius = "4px";
    genBtn.style.cursor = "pointer";

    var sendBtn = document.createElement("button");
    sendBtn.type = "button";
    sendBtn.textContent = "Send Test SMS";
    sendBtn.style.padding = "8px 12px";
    sendBtn.style.border = "none";
    sendBtn.style.background = "#06c";
    sendBtn.style.color = "#fff";
    sendBtn.style.borderRadius = "4px";
    sendBtn.style.cursor = "pointer";

    actions.appendChild(genBtn);
    actions.appendChild(sendBtn);

    var right = document.createElement("div");
    var outLabel = document.createElement("h3");
    outLabel.textContent = "Response";
    outLabel.style.margin = "0 0 8px 0";
    outLabel.style.fontSize = "16px";

    var out = document.createElement("pre");
    out.id = "vgOtpOut";
    out.textContent = "Waiting...";
    out.style.background = "#111";
    out.style.color = "#e8e8e8";
    out.style.padding = "10px";
    out.style.borderRadius = "4px";
    out.style.overflow = "auto";

    genBtn.addEventListener("click", async function () {
      var base = getApiBase();
      if (!base) {
        out.textContent = "Unable to resolve realm context.";
        return;
      }
      out.textContent = "Generating token...";
      try {
        var res = await fetch(base + "/token", { method: "POST", credentials: "include" });
        var data = await res.json().catch(function () { return {}; });
        if (res.ok && data.token) {
          document.getElementById("vgOtpTestToken").value = data.token;
        }
        out.textContent = JSON.stringify({ status: res.status, body: data }, null, 2);
      } catch (e) {
        out.textContent = String(e);
      }
    });

    sendBtn.addEventListener("click", async function () {
      var base = getApiBase();
      if (!base) {
        out.textContent = "Unable to resolve realm context.";
        return;
      }

      var payload = {
        primaryEndpoint: document.getElementById("vgOtpPrimary").value.trim(),
        backupEndpoint: document.getElementById("vgOtpBackup").value.trim(),
        bearer: document.getElementById("vgOtpBearer").value.trim(),
        mobileField: document.getElementById("vgOtpMobileField").value.trim() || "mobile",
        messageField: document.getElementById("vgOtpMessageField").value.trim() || "message",
        mobile: document.getElementById("vgOtpMobile").value.trim(),
        message: document.getElementById("vgOtpMessage").value.trim(),
        retryMax: Number(document.getElementById("vgOtpRetryMax").value || 2),
        retryBackoffMs: Number(document.getElementById("vgOtpRetryBackoff").value || 500)
      };

      out.textContent = "Sending...";
      try {
        var token = document.getElementById("vgOtpTestToken").value.trim();
        var res = await fetch(base + "/test", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-Phone-Otp-Test-Token": token
          },
          body: JSON.stringify(payload)
        });
        var data = await res.json().catch(function () { return {}; });
        out.textContent = JSON.stringify({ status: res.status, body: data }, null, 2);
      } catch (e) {
        out.textContent = String(e);
      }
    });

    right.appendChild(outLabel);
    right.appendChild(out);

    left.appendChild(actions);
    layout.appendChild(left);
    layout.appendChild(right);
    modal.appendChild(layout);

    overlay.dataset.ready = "true";
    return overlay;
  }

  function ensurePendingModal() {
    var overlay = createBaseModal(PENDING_MODAL_ID, "Pending Mobile Verification");
    if (overlay.dataset.ready === "true") return overlay;

    var modal = overlay.firstChild;
    var state = { page: 1, pageSize: 25, totalFiltered: 0, searchTimer: null };

    var summary = document.createElement("div");
    summary.style.display = "grid";
    summary.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
    summary.style.gap = "10px";
    summary.style.marginBottom = "12px";

    function summaryCard(label, id) {
      var card = document.createElement("div");
      card.style.border = "1px solid #e0e0e0";
      card.style.borderRadius = "8px";
      card.style.padding = "10px 12px";
      card.style.background = "#fafafa";
      var l = document.createElement("div");
      l.textContent = label;
      l.style.fontSize = "12px";
      l.style.color = "#666";
      var v = document.createElement("div");
      v.id = id;
      v.textContent = "-";
      v.style.fontSize = "22px";
      v.style.fontWeight = "600";
      card.appendChild(l);
      card.appendChild(v);
      return card;
    }

    summary.appendChild(summaryCard("Total Users", "vgTotalUsers"));
    summary.appendChild(summaryCard("Phone Verified", "vgVerifiedUsers"));
    summary.appendChild(summaryCard("Pending Verification", "vgPendingUsers"));

    var toolbar = document.createElement("div");
    toolbar.style.display = "grid";
    toolbar.style.gridTemplateColumns = "1fr 90px auto auto auto";
    toolbar.style.gap = "8px";
    toolbar.style.alignItems = "end";
    toolbar.style.marginBottom = "12px";

    var searchWrap = createField("Search (username or mobile)", "vgPendingSearch", "Search...", "");
    searchWrap.style.flex = "1";
    searchWrap.style.marginBottom = "0";

    var sizeWrap = createField("Rows", "vgPendingSize", "25", "25");
    sizeWrap.style.marginBottom = "0";
    sizeWrap.style.maxWidth = "90px";

    var searchBtn = document.createElement("button");
    searchBtn.type = "button";
    searchBtn.textContent = "Search";
    searchBtn.style.padding = "8px 12px";
    searchBtn.style.border = "1px solid #c7c7c7";
    searchBtn.style.background = "#fff";
    searchBtn.style.color = "#111";
    searchBtn.style.borderRadius = "4px";
    searchBtn.style.cursor = "pointer";

    var clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.textContent = "Clear";
    clearBtn.style.padding = "8px 12px";
    clearBtn.style.border = "1px solid #c7c7c7";
    clearBtn.style.background = "#fff";
    clearBtn.style.color = "#111";
    clearBtn.style.borderRadius = "4px";
    clearBtn.style.cursor = "pointer";

    var reloadBtn = document.createElement("button");
    reloadBtn.type = "button";
    reloadBtn.textContent = "Reload";
    reloadBtn.style.padding = "8px 12px";
    reloadBtn.style.border = "none";
    reloadBtn.style.background = "#06c";
    reloadBtn.style.color = "#fff";
    reloadBtn.style.borderRadius = "4px";
    reloadBtn.style.cursor = "pointer";

    toolbar.appendChild(searchWrap);
    toolbar.appendChild(sizeWrap);
    toolbar.appendChild(searchBtn);
    toolbar.appendChild(clearBtn);
    toolbar.appendChild(reloadBtn);

    var tableWrap = document.createElement("div");
    tableWrap.style.maxHeight = "52vh";
    tableWrap.style.overflow = "auto";
    tableWrap.style.border = "1px solid #ddd";
    tableWrap.style.borderRadius = "8px";

    var table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.style.fontSize = "13px";
    table.innerHTML =
      "<thead style='position:sticky;top:0;background:#f8f8f8;z-index:1'><tr>" +
      "<th style='text-align:left;padding:10px;border-bottom:1px solid #ddd'>Username</th>" +
      "<th style='text-align:left;padding:10px;border-bottom:1px solid #ddd'>Name</th>" +
      "<th style='text-align:left;padding:10px;border-bottom:1px solid #ddd'>Email</th>" +
      "<th style='text-align:left;padding:10px;border-bottom:1px solid #ddd'>Mobile</th>" +
      "<th style='text-align:left;padding:10px;border-bottom:1px solid #ddd'>Enabled</th>" +
      "<th style='text-align:left;padding:10px;border-bottom:1px solid #ddd'>Profile</th>" +
      "</tr></thead><tbody id='vgPendingBody'><tr><td colspan='5' style='padding:10px'>Loading...</td></tr></tbody>";
    tableWrap.appendChild(table);

    var pager = document.createElement("div");
    pager.style.display = "flex";
    pager.style.alignItems = "center";
    pager.style.gap = "8px";
    pager.style.marginTop = "10px";

    var prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.textContent = "Prev";
    prevBtn.style.padding = "6px 10px";
    prevBtn.style.border = "1px solid #c7c7c7";
    prevBtn.style.background = "#fff";
    prevBtn.style.borderRadius = "4px";
    prevBtn.style.cursor = "pointer";

    var nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.textContent = "Next";
    nextBtn.style.padding = "6px 10px";
    nextBtn.style.border = "1px solid #c7c7c7";
    nextBtn.style.background = "#fff";
    nextBtn.style.borderRadius = "4px";
    nextBtn.style.cursor = "pointer";

    var pageInfo = document.createElement("div");
    pageInfo.id = "vgPendingPageInfo";
    pageInfo.style.marginLeft = "auto";
    pageInfo.style.fontSize = "13px";
    pageInfo.textContent = "Page 1 / 1";

    pager.appendChild(prevBtn);
    pager.appendChild(nextBtn);
    pager.appendChild(pageInfo);

    var status = document.createElement("div");
    status.id = "vgPendingStatus";
    status.style.marginTop = "8px";
    status.style.fontSize = "12px";
    status.style.color = "#666";
    status.textContent = "Ready";

    function renderTable(users) {
      var tbody = document.getElementById("vgPendingBody");
      if (!tbody) return;
      tbody.innerHTML = "";

      if (!users || !users.length) {
        tbody.innerHTML = "<tr><td colspan='6' style='padding:10px'>No users found.</td></tr>";
      } else {
        users.forEach(function (u) {
          var profileUrl = getUserProfileUrl(u);
          var tr = document.createElement("tr");
          tr.innerHTML =
            "<td style='padding:10px;border-bottom:1px solid #f0f0f0'>" + (u.username || "") + "</td>" +
            "<td style='padding:10px;border-bottom:1px solid #f0f0f0'>" + ((u.firstName || "") + " " + (u.lastName || "")).trim() + "</td>" +
            "<td style='padding:10px;border-bottom:1px solid #f0f0f0'>" + (u.email || "") + "</td>" +
            "<td style='padding:10px;border-bottom:1px solid #f0f0f0'>" + (u.mobile || "") + "</td>" +
            "<td style='padding:10px;border-bottom:1px solid #f0f0f0'>" + (u.enabled ? "true" : "false") + "</td>" +
            "<td style='padding:10px;border-bottom:1px solid #f0f0f0'><a href='" + profileUrl + "' target='_blank' rel='noopener'>Open</a></td>";
          tbody.appendChild(tr);
        });
      }

      var totalPages = Math.max(1, Math.ceil(state.totalFiltered / state.pageSize));
      var start = state.totalFiltered === 0 ? 0 : ((state.page - 1) * state.pageSize + 1);
      var end = Math.min(state.page * state.pageSize, state.totalFiltered);
      pageInfo.textContent = "Page " + state.page + " / " + totalPages + " • Showing " + start + "-" + end + " of " + state.totalFiltered;
      prevBtn.disabled = state.page <= 1;
      nextBtn.disabled = state.page >= totalPages;
    }

    async function loadPending() {
      var base = getApiBase();
      if (!base) {
        status.textContent = "Unable to resolve realm context.";
        return;
      }
      state.pageSize = Math.max(5, Number(document.getElementById("vgPendingSize").value || 25));
      var q = (document.getElementById("vgPendingSearch").value || "").trim();
      var first = (state.page - 1) * state.pageSize;
      status.textContent = "Loading users...";
      try {
        var url = base + "/pending-users?first=" + encodeURIComponent(first) + "&max=" + encodeURIComponent(state.pageSize) + "&q=" + encodeURIComponent(q);
        var res = await fetch(url, { method: "GET", credentials: "include" });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data || !data.ok) {
          status.textContent = "Failed to load pending users.";
          renderTable([]);
          return;
        }

        document.getElementById("vgTotalUsers").textContent = String(data.totalUsers || 0);
        document.getElementById("vgVerifiedUsers").textContent = String(data.verifiedUsers || 0);
        document.getElementById("vgPendingUsers").textContent = String(data.pendingUsers || 0);
        state.totalFiltered = Number(data.filteredPendingUsers || data.pendingUsers || 0);
        status.textContent = "Loaded page " + state.page + " (" + (data.count || 0) + " rows).";
        renderTable(data.users || []);
      } catch (e) {
        status.textContent = String(e);
        renderTable([]);
      }
    }

    var searchInput = document.getElementById("vgPendingSearch");
    var sizeInput = document.getElementById("vgPendingSize");
    if (searchInput) {
      searchInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          state.page = 1;
          loadPending();
        }
      });
    }
    if (sizeInput) {
      sizeInput.addEventListener("change", function () {
        state.page = 1;
        loadPending();
      });
    }
    prevBtn.addEventListener("click", function () {
      if (state.page <= 1) return;
      state.page -= 1;
      loadPending();
    });
    nextBtn.addEventListener("click", function () {
      var totalPages = Math.max(1, Math.ceil(state.totalFiltered / state.pageSize));
      if (state.page >= totalPages) return;
      state.page += 1;
      loadPending();
    });
    reloadBtn.addEventListener("click", function () {
      state.page = 1;
      loadPending();
    });
    searchBtn.addEventListener("click", function () {
      state.page = 1;
      loadPending();
    });
    clearBtn.addEventListener("click", function () {
      if (searchInput) searchInput.value = "";
      state.page = 1;
      loadPending();
    });

    modal.appendChild(summary);
    modal.appendChild(toolbar);
    modal.appendChild(tableWrap);
    modal.appendChild(pager);
    modal.appendChild(status);

    overlay.loadPending = loadPending;
    loadPending();
    overlay.dataset.ready = "true";
    return overlay;
  }

  function openTestModal() {
    var modal = ensureTestModal();
    modal.style.display = "flex";
  }

  function openPendingModal() {
    var modal = ensurePendingModal();
    modal.style.display = "flex";
    if (typeof modal.loadPending === "function") modal.loadPending();
  }

  function buildNavItem(id, labelText, iconSvgPath, onClick) {
    var li = document.createElement("li");
    li.className = "pf-v5-c-nav__item pf-c-nav__item";

    var a = document.createElement("a");
    a.id = id;
    a.href = "#";
    a.className = "pf-v5-c-nav__link pf-c-nav__link";

    var icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.style.display = "inline-flex";
    icon.style.width = "14px";
    icon.style.height = "14px";
    icon.style.marginRight = "8px";
    icon.style.verticalAlign = "text-bottom";
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="' + iconSvgPath + '"/></svg>';

    var label = document.createElement("span");
    label.textContent = labelText;

    a.appendChild(icon);
    a.appendChild(label);
    a.addEventListener("click", function (e) {
      e.preventDefault();
      onClick();
    });

    li.appendChild(a);
    return li;
  }

  function injectLinks(access) {
    if (document.getElementById(LINK_TEST_ID) || document.getElementById(LINK_PENDING_ID)) return;

    var navList = document.querySelector(".pf-v5-c-nav__list, .pf-c-nav__list");
    if (!navList) return;

    var parent = navList.parentElement;
    if (parent) {
      parent.style.display = "flex";
      parent.style.flexDirection = "column";
      parent.style.minHeight = "100%";
    }
    navList.style.display = "flex";
    navList.style.flexDirection = "column";
    navList.style.minHeight = "100%";

    var testPath = "M17 1H7c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm0 17H7V4h10v14zm-5 3c-.83 0-1.5-.67-1.5-1.5S11.17 18 12 18s1.5.67 1.5 1.5S12.83 21 12 21zM8 6h8v10H8z";
    var pendingPath = "M3 5h18v2H3V5zm0 6h18v2H3v-2zm0 6h18v2H3v-2z";

    if (access && access.canPending) {
      var pendingItem = buildNavItem(LINK_PENDING_ID, "Pending Phone OTP", pendingPath, openPendingModal);
      pendingItem.style.marginTop = "auto";
      navList.appendChild(pendingItem);
    }
    if (access && access.canTest) {
      var testItem = buildNavItem(LINK_TEST_ID, "Phone OTP Test", testPath, openTestModal);
      if (!(access && access.canPending)) testItem.style.marginTop = "auto";
      navList.appendChild(testItem);
    }
  }

  async function boot() {
    var access = await getAccessRights();
    if (!access.ok) return;
    injectLinks(access);
    var obs = new MutationObserver(function () {
      injectLinks(access);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { boot(); });
  } else {
    boot();
  }
})();
