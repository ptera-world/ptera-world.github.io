// A new deploy taking over is announced as a "deploy" event on window, detail { version, changed }.
if ("serviceWorker" in navigator) {
  const uncontrolled = !navigator.serviceWorker.controller;
  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((reg) => {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update().catch(() => {});
    });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data && e.data.type === "deploy") dispatchEvent(new CustomEvent("deploy", { detail: e.data }));
  });
  if (uncontrolled) {
    const loaded = new Promise((r) => (document.readyState === "complete" ? r() : addEventListener("load", r, { once: true })));
    Promise.all([navigator.serviceWorker.ready, loaded]).then(([reg]) => {
      const urls = [location.href, ...performance.getEntriesByType("resource").map((e) => e.name)];
      if (reg.active) reg.active.postMessage({ type: "cache", urls });
    });
  }
}
