/*
 * Mock of the Go bridge for previewing ui/index.html in a normal browser.
 *
 * Query parameters:
 *   state = fresh | installed | outdated | inactive | nospotify | store   (default: fresh)
 *   mode  = uninstall            → window opened from Windows "Apps" settings
 *   click = install,confirm      → after boot, clicks [data-action="install"],
 *                                   then [data-confirm] (comma separated, 400 ms apart)
 *   hold  = <stepId>             → the running operation stops at this step (to capture "running")
 *   fail  = <stepId>             → the running operation fails at this step
 *   speed = <ms per step>        → default 450
 */
(function () {
  // Make script errors visible in screenshots (preview builds only).
  function showError(msg) {
    const box = document.createElement("pre");
    box.textContent = "[preview] " + msg;
    box.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;margin:0;padding:10px 12px;background:#b00020;color:#fff;font:12px/1.4 Consolas,monospace;white-space:pre-wrap;border-radius:8px";
    (document.body || document.documentElement).appendChild(box);
  }
  window.addEventListener("error", (e) => showError(e.message + (e.filename ? " @" + e.lineno + ":" + e.colno : "")));
  window.addEventListener("unhandledrejection", (e) => showError("unhandled rejection: " + (e.reason && e.reason.stack || e.reason)));

  const q = new URLSearchParams(location.search);
  const preset = q.get("state") || "fresh";
  const speed = +(q.get("speed") || 450);

  const steps = {
    install: [
      { id: "app", label: "Install Moggtify" },
      { id: "detect", label: "Find Spotify" },
      { id: "engine", label: "Download engine" },
      { id: "market", label: "Install Marketplace" },
      { id: "config", label: "Set up extensions & designs" },
      { id: "close", label: "Close Spotify" },
      { id: "patch", label: "Patch Spotify" },
      { id: "launch", label: "Launch Spotify" },
    ],
    uninstall: [
      { id: "close", label: "Close Spotify" },
      { id: "restore", label: "Restore original Spotify" },
      { id: "engine", label: "Remove engine" },
      { id: "app", label: "Remove Moggtify" },
      { id: "launch", label: "Launch Spotify" },
    ],
  };
  steps.repair = steps.install.slice(1);

  const details = { detect: "Spotify 1.3.10.2586", engine: "v2.46.7", market: "latest" };

  function makeState() {
    const s = {
      version: "1.0.0",
      mode: q.get("mode") || "",
      spotify: { found: true, store: false, dir: "", exe: "", version: "1.3.10.2586", running: true, status: "clean" },
      installed: false,
      active: false,
      engine: { installed: false, marketplace: false },
      config: { patched: false, autoReapply: true, engineOwned: false },
      busy: false,
      steps,
      repo: "https://github.com/caedesdev/moggtify",
    };
    const installed = () => { s.installed = true; s.engine = { installed: true, marketplace: true }; s.config.patched = true; s.config.engineOwned = true; };
    switch (preset) {
      case "installed": installed(); s.spotify.status = "patched"; s.active = true; break;
      case "outdated": installed(); s.spotify.status = "outdated"; break;
      case "inactive": installed(); s.config.patched = false; break;
      case "nospotify": s.spotify = { found: false, store: false, version: "", running: false, status: "missing" }; break;
      case "store": s.spotify = { found: false, store: true, version: "", running: false, status: "missing" }; break;
    }
    return s;
  }

  let state = makeState();
  const snap = () => JSON.parse(JSON.stringify(state));
  const fire = (name, data) => window.__mogg && window.__mogg(name, data);

  function simulate(op, after) {
    if (state.busy) return Promise.reject("Hang on – something is already running.");
    state.busy = true;
    const list = steps[op];
    const hold = q.get("hold"), fail = q.get("fail");
    let i = 0;
    (function next() {
      if (i >= list.length) {
        state.busy = false;
        after();
        fire("done", { op, state: snap() });
        return;
      }
      const st = list[i];
      fire("progress", { op, step: st.id, state: "run", detail: "" });
      if (st.id === hold) return;
      setTimeout(() => {
        if (st.id === fail) {
          state.busy = false;
          fire("error", { op, message: "Spicetify: Cannot apply – Spotify is running or files are locked. Close Spotify and try again.", state: snap() });
          return;
        }
        fire("progress", { op, step: st.id, state: "done", detail: details[st.id] || "" });
        i++;
        setTimeout(next, 60);
      }, speed);
    })();
    return Promise.resolve(null);
  }

  window.mogg_state = async () => snap();
  window.mogg_install = () => simulate("install", () => {
    state.installed = true; state.active = true; state.spotify.status = "patched";
    state.engine = { installed: true, marketplace: true }; state.config.patched = true; state.config.engineOwned = true;
  });
  window.mogg_repair = () => simulate("repair", () => {
    state.active = true; state.spotify.status = "patched"; state.engine = { installed: true, marketplace: true }; state.config.patched = true;
  });
  window.mogg_uninstall = () => simulate("uninstall", () => {
    state.installed = false; state.active = false; state.spotify.status = "clean";
    state.engine = { installed: false, marketplace: false }; state.config.patched = false;
  });
  window.mogg_open = async (kind) => console.log("[mock] open", kind);
  window.mogg_quit = async () => console.log("[mock] quit");

  const clicks = (q.get("click") || "").split(",").filter(Boolean);
  if (clicks.length) {
    window.addEventListener("load", () => {
      let delay = 700;
      for (const c of clicks) {
        setTimeout(() => {
          const el = c === "confirm" ? document.querySelector("[data-confirm]") : document.querySelector(`[data-action="${c}"]`);
          if (el) el.click(); else console.warn("[mock] nothing to click for", c);
        }, delay);
        delay += 400;
      }
    });
  }
})();
