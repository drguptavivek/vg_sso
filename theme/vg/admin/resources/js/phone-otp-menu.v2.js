(function () {
  "use strict";

  var TEST_LINK_ID = "vg-phone-otp-test-link";
  var STATUS_LINK_ID = "vg-phone-otp-status-link";
  var PUBLIC_ORIGIN_PROMISE = null;

  function getRealmFromPath() {
    var m = window.location.pathname.match(/^\/admin\/([^/]+)\/console/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function getTestUiPath() {
    var realm = getRealmFromPath();
    if (!realm) return null;
    return "/realms/" + encodeURIComponent(realm) + "/phone-otp-admin/ui";
  }

  function getStatusUiPath() {
    var realm = getRealmFromPath();
    if (!realm) return null;
    return "/realms/" + encodeURIComponent(realm) + "/phone-otp-admin/pending-ui";
  }

  function getPublicOrigin() {
    if (PUBLIC_ORIGIN_PROMISE) return PUBLIC_ORIGIN_PROMISE;
    var realm = getRealmFromPath();
    if (!realm) return Promise.resolve(window.location.origin);
    var wellKnown = window.location.origin + "/realms/" + encodeURIComponent(realm) + "/.well-known/openid-configuration";
    PUBLIC_ORIGIN_PROMISE = fetch(wellKnown, { credentials: "include" })
      .then(function (res) {
        if (!res.ok) throw new Error("Failed to resolve realm issuer");
        return res.json();
      })
      .then(function (data) {
        try {
          return data && data.issuer ? new URL(data.issuer).origin : window.location.origin;
        } catch (e) {
          return window.location.origin;
        }
      })
      .catch(function () {
        return window.location.origin;
      });
    return PUBLIC_ORIGIN_PROMISE;
  }

  function openUi() {
    var path = getTestUiPath();
    if (!path) return;
    getPublicOrigin().then(function (origin) {
      window.location.href = origin + path;
    });
  }

  function openStatusUi() {
    var path = getStatusUiPath();
    if (!path) return;
    getPublicOrigin().then(function (origin) {
      window.location.href = origin + path;
    });
  }

  function injectLink() {
    if (document.getElementById(TEST_LINK_ID) || document.getElementById(STATUS_LINK_ID)) return;

    var navList = document.querySelector(".pf-v5-c-nav__list, .pf-c-nav__list");
    if (!navList) return;

    var host = navList.parentElement || navList;
    host.style.display = "flex";
    host.style.flexDirection = "column";
    host.style.minHeight = "100%";

    var footer = document.createElement("div");
    footer.style.marginTop = "auto";
    footer.style.paddingTop = "8px";

    var statusButton = document.createElement("button");
    statusButton.type = "button";
    statusButton.id = STATUS_LINK_ID;
    statusButton.setAttribute("aria-label", "Phone OTP Status");
    statusButton.style.width = "100%";
    statusButton.style.border = "0";
    statusButton.style.background = "transparent";
    statusButton.style.cursor = "pointer";
    statusButton.style.textAlign = "left";
    statusButton.style.display = "flex";
    statusButton.style.alignItems = "center";
    statusButton.style.padding = "10px 16px";
    statusButton.style.color = "inherit";
    statusButton.style.font = "inherit";
    statusButton.innerHTML =
      "<span aria-hidden='true' style='display:inline-flex;width:14px;height:14px;margin-right:8px;vertical-align:text-bottom'>" +
      "<svg viewBox='0 0 24 24' width='14' height='14' fill='currentColor' xmlns='http://www.w3.org/2000/svg'><path d='M3 5h18v2H3V5zm0 6h18v2H3v-2zm0 6h18v2H3v-2z'/></svg>" +
      "</span><span>Phone OTP Status</span>";
    ["pointerdown", "mousedown", "mouseup"].forEach(function (eventName) {
      statusButton.addEventListener(eventName, swallowEvent, true);
    });
    statusButton.addEventListener("click", function (e) {
      swallowEvent(e);
      openStatusUi();
    }, true);

    var button = document.createElement("button");
    button.type = "button";
    button.id = TEST_LINK_ID;
    button.setAttribute("aria-label", "Phone OTP Test");
    button.style.width = "100%";
    button.style.border = "0";
    button.style.background = "transparent";
    button.style.cursor = "pointer";
    button.style.textAlign = "left";
    button.style.display = "flex";
    button.style.alignItems = "center";
    button.style.padding = "10px 16px";
    button.style.color = "inherit";
    button.style.font = "inherit";
    button.innerHTML =
      "<span aria-hidden='true' style='display:inline-flex;width:14px;height:14px;margin-right:8px;vertical-align:text-bottom'>" +
      "<svg viewBox='0 0 24 24' width='14' height='14' fill='currentColor' xmlns='http://www.w3.org/2000/svg'><path d='M17 1H7c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm0 17H7V4h10v14zm-5 3c-.83 0-1.5-.67-1.5-1.5S11.17 18 12 18s1.5.67 1.5 1.5S12.83 21 12 21zM8 6h8v10H8z'/></svg>" +
      "</span><span>Phone OTP Test</span>";
    ["pointerdown", "mousedown", "mouseup"].forEach(function (eventName) {
      button.addEventListener(eventName, swallowEvent, true);
    });
    button.addEventListener("click", function (e) {
      swallowEvent(e);
      openUi();
    }, true);

    footer.appendChild(statusButton);
    footer.appendChild(button);
    host.appendChild(footer);
  }

  function boot() {
    injectLink();
    var obs = new MutationObserver(injectLink);
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
    function swallowEvent(e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    }
