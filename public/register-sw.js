// When a new deploy takes over, the open page is brought up to date in place:
// - changed stylesheets are swapped;
// - a cancelable "deploy" event is dispatched on window, detail { version, changed } (changed: the
//   root-relative keys whose bytes differ, a directory's index.html keyed by the directory URL).
//   A page that updates itself calls preventDefault();
// - otherwise, if this page changed and it runs no script but this one, its content is replaced.
//   A page with other scripts that doesn't handle the event stays as it is until opened again.
if ("serviceWorker" in navigator) {
  const me = document.currentScript;
  const uncontrolled = !navigator.serviceWorker.controller;
  const keyOf = (url) => {
    const u = new URL(url, location.href);
    return u.origin === location.origin ? u.pathname : null;
  };

  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((reg) => {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update().catch(() => {});
    });
  }).catch(() => {});

  navigator.serviceWorker.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.type !== "deploy") return;
    const changed = new Set(d.changed);
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      if (!changed.has(keyOf(link.href))) continue;
      const next = link.cloneNode();
      const url = new URL(link.href);
      url.searchParams.set("v", d.version);
      next.href = url.href;
      next.addEventListener("load", () => link.remove(), { once: true });
      link.after(next);
    }
    if (!dispatchEvent(new CustomEvent("deploy", { detail: d, cancelable: true }))) return;
    const path = location.pathname;
    if (!changed.has(path) && !changed.has(`${path}/`)) return;
    if ([...document.scripts].some((s) => s !== me)) return;
    fetch(location.href).then((r) => (r.ok ? r.text() : null)).then((html) => {
      if (html === null) return;
      const doc = new DOMParser().parseFromString(html, "text/html");
      const y = scrollY;
      document.title = doc.title;
      document.body.replaceChildren(...doc.body.childNodes);
      scrollTo(0, y);
    }).catch(() => {});
  });

  if (uncontrolled) {
    const loaded = new Promise((r) => (document.readyState === "complete" ? r() : addEventListener("load", r, { once: true })));
    Promise.all([navigator.serviceWorker.ready, loaded]).then(([reg]) => {
      const urls = [location.href, ...performance.getEntriesByType("resource").map((e) => e.name)];
      if (reg.active) reg.active.postMessage({ type: "cache", urls });
    });
  }
}
