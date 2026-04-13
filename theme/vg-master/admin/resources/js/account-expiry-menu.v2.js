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
      var target = origin + path;
      var win = window.open(target, "_blank", "noopener");
      if (!win) window.location.href = target;
    });
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
    a.innerHTML =
      "<span aria-hidden='true' style='display:inline-flex;width:14px;height:14px;margin-right:8px;vertical-align:text-bottom'>" +
      "<svg viewBox='0 0 24 24' width='14' height='14' fill='currentColor' xmlns='http://www.w3.org/2000/svg'><path d='M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 15-4-4 1.4-1.4 2.6 2.58 5.6-5.58L18 9l-7 7z'/></svg>" +
      "</span><span>Account Expiry</span>";
    a.addEventListener("click", function (e) {
      e.preventDefault();
      openDashboard();
    });

    li.appendChild(a);
    navList.appendChild(li);
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
