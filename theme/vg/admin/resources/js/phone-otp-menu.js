(function () {
  "use strict";

  var LINK_ID = "vg-phone-otp-test-link";
  var MODAL_ID = "vg-phone-otp-modal";
  var ACCESS_ALLOWED = null;

  function getRealmFromPath() {
    var m = window.location.pathname.match(/^\/admin\/([^/]+)\/console/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function getApiBase() {
    var realm = getRealmFromPath();
    if (!realm) return null;
    return window.location.origin + "/realms/" + encodeURIComponent(realm) + "/phone-otp-admin";
  }

  async function canAccess() {
    if (ACCESS_ALLOWED !== null) return ACCESS_ALLOWED;
    var base = getApiBase();
    if (!base) {
      ACCESS_ALLOWED = false;
      return ACCESS_ALLOWED;
    }
    try {
      var res = await fetch(base + "/access", { method: "GET", credentials: "include" });
      ACCESS_ALLOWED = !!res.ok;
      return ACCESS_ALLOWED;
    } catch (e) {
      ACCESS_ALLOWED = false;
      return ACCESS_ALLOWED;
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

  function ensureModal() {
    var existing = document.getElementById(MODAL_ID);
    if (existing) return existing;

    var overlay = document.createElement("div");
    overlay.id = MODAL_ID;
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
    title.textContent = "Phone OTP Test";
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
    var curlLabel = document.createElement("h3");
    curlLabel.textContent = "Local Request cURL";
    curlLabel.style.margin = "0 0 8px 0";
    curlLabel.style.fontSize = "16px";
    var curlPre = document.createElement("pre");
    curlPre.id = "vgOtpCurl";
    curlPre.textContent = "Waiting...";
    curlPre.style.background = "#111";
    curlPre.style.color = "#e8e8e8";
    curlPre.style.padding = "10px";
    curlPre.style.borderRadius = "4px";
    curlPre.style.overflow = "auto";
    curlPre.style.whiteSpace = "pre-wrap";
    curlPre.style.wordBreak = "break-word";
    var outLabel = document.createElement("h3");
    outLabel.textContent = "Response";
    outLabel.style.margin = "12px 0 8px 0";
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
        var res = await fetch(base + "/token", {
          method: "POST",
          credentials: "include"
        });
        var data = await res.json().catch(function () { return {}; });
        if (res.ok && data.token) {
          document.getElementById("vgOtpTestToken").value = data.token;
        }
        refreshCurlPreview();
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
        refreshCurlPreview();
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
    right.insertBefore(curlPre, outLabel);
    right.insertBefore(curlLabel, curlPre);
    left.appendChild(actions);
    layout.appendChild(left);
    layout.appendChild(right);

    modal.appendChild(header);
    modal.appendChild(layout);

    [
      "vgOtpPrimary",
      "vgOtpBackup",
      "vgOtpBearer",
      "vgOtpTestToken",
      "vgOtpMobileField",
      "vgOtpMessageField",
      "vgOtpMobile",
      "vgOtpMessage",
      "vgOtpRetryMax",
      "vgOtpRetryBackoff"
    ].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("input", refreshCurlPreview);
    });
    refreshCurlPreview();
    overlay.appendChild(modal);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.style.display = "none";
    });

    document.body.appendChild(overlay);
    return overlay;
  }

  function openModal() {
    var modal = ensureModal();
    modal.style.display = "flex";
  }

  function injectLink() {
    if (document.getElementById(LINK_ID)) return;

    var navList = document.querySelector(".pf-v5-c-nav__list, .pf-c-nav__list");
    if (!navList) return;

    var li = document.createElement("li");
    li.className = "pf-v5-c-nav__item pf-c-nav__item";
    li.style.marginTop = "auto";

    var a = document.createElement("a");
    a.id = LINK_ID;
    a.href = "#";
    a.className = "pf-v5-c-nav__link pf-c-nav__link";
    var icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.style.display = "inline-flex";
    icon.style.width = "14px";
    icon.style.height = "14px";
    icon.style.marginRight = "8px";
    icon.style.verticalAlign = "text-bottom";
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M17 1H7c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm0 17H7V4h10v14zm-5 3c-.83 0-1.5-.67-1.5-1.5S11.17 18 12 18s1.5.67 1.5 1.5S12.83 21 12 21zM8 6h8v10H8z"/></svg>';
    var label = document.createElement("span");
    label.textContent = "Phone OTP Test";
    a.appendChild(icon);
    a.appendChild(label);

    a.addEventListener("click", function (e) {
      e.preventDefault();
      openModal();
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

  async function boot() {
    var allowed = await canAccess();
    if (!allowed) return;
    injectLink();
    var obs = new MutationObserver(function () {
      injectLink();
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { boot(); });
  } else {
    boot();
  }
})();
    function buildLocalCurl() {
      var base = getApiBase() || "http://localhost:8080/realms/org-new-delhi/phone-otp-admin";
      var token = (document.getElementById("vgOtpTestToken") || {}).value || "";
      var payload = {
        primaryEndpoint: (document.getElementById("vgOtpPrimary") || {}).value || "",
        backupEndpoint: (document.getElementById("vgOtpBackup") || {}).value || "",
        bearer: (document.getElementById("vgOtpBearer") || {}).value || "",
        mobileField: (document.getElementById("vgOtpMobileField") || {}).value || "mobile",
        messageField: (document.getElementById("vgOtpMessageField") || {}).value || "message",
        mobile: (document.getElementById("vgOtpMobile") || {}).value || "",
        message: (document.getElementById("vgOtpMessage") || {}).value || "",
        retryMax: Number((document.getElementById("vgOtpRetryMax") || {}).value || 2),
        retryBackoffMs: Number((document.getElementById("vgOtpRetryBackoff") || {}).value || 500)
      };
      return (
        "curl --location '" + base + "/test' " +
        "--header 'Content-Type: application/json' " +
        "--header 'X-Phone-Otp-Test-Token: " + token.replace(/'/g, "'\\''") + "' " +
        "--data '" + JSON.stringify(payload).replace(/'/g, "'\\''") + "'"
      );
    }

    function refreshCurlPreview() {
      var node = document.getElementById("vgOtpCurl");
      if (node) node.textContent = buildLocalCurl();
    }
