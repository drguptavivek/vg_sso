(function () {
  "use strict";

  var LINK_ID = "vg-account-expiry-link";
  var PUBLIC_ORIGIN_PROMISE = null;

  function getRealmFromPath() {
    var m = window.location.pathname.match(/^\/admin\/([^/]+)\/console/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function getUiPath() {
    var realm = getRealmFromPath();
    if (!realm) return null;
    return "/realms/" + encodeURIComponent(realm) + "/account-expiry-admin/ui";
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

  function openDashboard() {
    var path = getUiPath();
    if (!path) return;
    getPublicOrigin().then(function (origin) {
      window.location.href = origin + path;
    });
  }

  function injectLink() {
    if (document.getElementById(LINK_ID)) return;

    var navList = document.querySelector(".pf-v5-c-nav__list, .pf-c-nav__list");
    if (!navList) return;

    var host = navList.parentElement || navList;
    host.style.display = "flex";
    host.style.flexDirection = "column";
    host.style.minHeight = "100%";

    var footer = document.createElement("div");
    footer.style.marginTop = "auto";
    footer.style.paddingTop = "8px";

    var button = document.createElement("button");
    button.type = "button";
    button.id = LINK_ID;
    button.setAttribute("aria-label", "Account Expiry");
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
      "<svg viewBox='0 0 24 24' width='14' height='14' fill='currentColor' xmlns='http://www.w3.org/2000/svg'><path d='M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 15-4-4 1.4-1.4 2.6 2.58 5.6-5.58L18 9l-7 7z'/></svg>" +
      "</span><span>Account Expiry</span>";
    ["pointerdown", "mousedown", "mouseup"].forEach(function (eventName) {
      button.addEventListener(eventName, swallowEvent, true);
    });
    button.addEventListener("click", function (e) {
      swallowEvent(e);
      openDashboard();
    }, true);

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
