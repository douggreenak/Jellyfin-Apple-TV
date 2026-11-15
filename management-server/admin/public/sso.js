/* Services Hub single sign-on. If you are not signed in here, go through the hub
   (which signs you in and brings you back). Config comes from data- attributes:
   data-service  hub service id         data-check  "token:<localStorage key>" | "session:<api path>"
   data-logout   "<METHOD> <path>"  (optional) -> after it succeeds, also sign out of the hub */
(function () {
  var el = document.currentScript, id = el.dataset.service;
  var hub = window.__HUB_ORIGIN__ || ('http://' + location.hostname + ':8090');
  if (new URLSearchParams(location.search).has('nosso')) return; // hub said it can't sign us in: show the normal login
  function bounce() {
    try { // loop guard: at most one bounce per 15 s per tab
      var t = +sessionStorage.getItem('hubSsoTried') || 0;
      if (Date.now() - t < (window.__HUB_GUARD_MS__ || 15000)) return;
      sessionStorage.setItem('hubSsoTried', String(Date.now()));
    } catch (e) {}
    location.replace(hub + '/go/' + id + '?sso=1');
  }
  var check = (el.dataset.check || '').split(':'), kind = check[0], arg = check.slice(1).join(':');
  if (kind === 'token') {
    try { if (!localStorage.getItem(arg) && location.hash.indexOf('#sso=') !== 0) bounce(); } catch (e) {}
  } else if (kind === 'session') {
    fetch(arg, { credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (j) { if (!j.authenticated) bounce(); }).catch(function () {});
  }
  var lg = (el.dataset.logout || '').split(' ');
  var realFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    return realFetch.apply(this, arguments).then(function (r) {
      var path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      if (lg.length === 2 && method === lg[0] && path === lg[1] && r.ok) location.href = hub + '/logout';
      else if (r.status === 401 && !/\/(login|session)$|auth\/login$/.test(path) && /\/api\//.test(path)) setTimeout(bounce, 300);
      return r;
    });
  };
})();
