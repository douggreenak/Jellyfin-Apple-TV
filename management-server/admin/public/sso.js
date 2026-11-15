/* Services Hub single sign-on. If you are not signed in here, go through the hub
   (which signs you in and brings you back). While that is being decided a loading wheel covers the page,
   so the service's own login screen never flashes. Config comes from data- attributes:
   data-service  hub service id         data-check  "token:<localStorage key>" | "session:<api path>"
   data-logout   "<METHOD> <path>"  (optional) -> after it succeeds, also sign out of the hub */
(function () {
  var el = document.currentScript, id = el.dataset.service;
  var hub = window.__HUB_ORIGIN__ || ('http://' + location.hostname + ':8090');
  var root = document.documentElement;

  /* ---- loading wheel ---- */
  var cover = null;
  function showCover() {
    if (cover) return;
    var dark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
    cover = document.createElement('div'); cover.id = 'hub-sso-overlay';
    cover.setAttribute('role', 'status'); cover.setAttribute('aria-label', 'Loading');
    cover.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:' + (dark ? '#0e1415' : '#f4fafa');
    cover.innerHTML = '<style>@keyframes hubspin{to{transform:rotate(360deg)}}</style><div style="width:44px;height:44px;border-radius:50%;border:5px solid ' +
      (dark ? '#004f50' : '#9cf1f0') + ';border-top-color:' + (dark ? '#80d4d3' : '#006a6a') + ';animation:hubspin .9s linear infinite"></div>';
    root.appendChild(cover);
  }
  function hideCover() { if (cover) { cover.remove(); cover = null; } }

  var qs = new URLSearchParams(location.search);
  if (qs.has('nosso')) return; // hub said it can't sign us in: show the normal login, no cover

  var check = (el.dataset.check || '').split(':'), kind = check[0], arg = check.slice(1).join(':');
  var settled = false;
  function bounce() {
    try { // loop guard: at most one bounce per window per tab
      var t = +sessionStorage.getItem('hubSsoTried') || 0;
      if (Date.now() - t < (window.__HUB_GUARD_MS__ || 15000)) { hideCover(); return; }
      sessionStorage.setItem('hubSsoTried', String(Date.now()));
    } catch (e) {}
    showCover(); // stays up until the browser leaves the page
    location.replace(hub + '/go/' + id + '?sso=1');
  }
  function signedIn() { settled = true; hideCover(); }

  if (kind === 'token') {
    var has = false;
    try { has = !!localStorage.getItem(arg) || location.hash.indexOf('#sso=') === 0; } catch (e) {}
    if (!has) bounce(); else { showCover(); setTimeout(function () { if (!settled) signedIn(); }, 8000); } // token present: wait for the app to confirm it
  } else if (kind === 'session') {
    showCover();
    fetch(arg, { credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (j) { if (j.authenticated) signedIn(); else bounce(); })
      .catch(function () { signedIn(); });
  }

  var lg = (el.dataset.logout || '').split(' ');
  var realFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    return realFetch.apply(this, arguments).then(function (r) {
      var path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      if (lg.length === 2 && method === lg[0] && path === lg[1] && r.ok) { showCover(); location.href = hub + '/logout'; }
      else if (r.status === 401 && !/\/(login|session)$|auth\/login$/.test(path) && /\/api\//.test(path)) { showCover(); setTimeout(bounce, 300); }
      else if (kind === 'token' && r.ok && /\/auth\/me$/.test(path)) signedIn(); // Fleet confirmed the saved token
      return r;
    });
  };
})();
