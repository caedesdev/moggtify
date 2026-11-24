/*
 * Minimal Spicetify API mock for previewing the in-Spotify Moggtify hub
 * (dist/moggtify.js) in a normal browser. Mirrors the parts Moggtify uses.
 */
(function () {
  window.addEventListener("error", (e) => banner(e.message + " @" + e.lineno));
  window.addEventListener("unhandledrejection", (e) => banner("unhandled rejection: " + (e.reason && e.reason.stack || e.reason)));
  function banner(msg) {
    const b = document.createElement("pre");
    b.textContent = "[preview] " + msg;
    b.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;margin:0;padding:10px;background:#b00020;color:#fff;font:12px Consolas,monospace;white-space:pre-wrap";
    (document.body || document.documentElement).appendChild(b);
  }

  // A colorful fake cover so glass / Ambient / Vibe Glow have something to show.
  try {
    const cv = document.createElement("canvas"); cv.width = cv.height = 96;
    const g = cv.getContext("2d");
    const gr = g.createLinearGradient(0, 0, 96, 96);
    gr.addColorStop(0, "#ff5fa2"); gr.addColorStop(0.5, "#7c5cff"); gr.addColorStop(1, "#1ec8ff");
    g.fillStyle = gr; g.fillRect(0, 0, 96, 96);
    window.__mockCover = cv.toDataURL("image/png");
  } catch (_) { window.__mockCover = ""; }

  const listeners = {};
  const data = {
    isPaused: false,
    item: {
      uri: "spotify:track:mock",
      metadata: { title: "Midnight Drive", artist_name: "The Moggers", album_title: "Night Shift", image_xlarge_url: window.__mockCover, image_url: window.__mockCover },
      duration: { milliseconds: 214000 },
    },
    positionAsOfTimestamp: 61000,
    timestamp: Date.now(),
  };
  let volume = 0.6;

  const S = (window.Spicetify = {
    Player: {
      data,
      addEventListener(n, f) { (listeners[n] = listeners[n] || []).push(f); },
      removeEventListener(n, f) { listeners[n] = (listeners[n] || []).filter((x) => x !== f); },
      togglePlay() { data.isPaused = !data.isPaused; (listeners.onplaypause || []).forEach((f) => f({ data })); },
      next() {}, back() {},
      getVolume: () => volume, setVolume(v) { volume = v; },
      getProgress: () => data.positionAsOfTimestamp, getDuration: () => data.item.duration.milliseconds,
      isPlaying: () => !data.isPaused,
    },
    Platform: { History: { push(p) { console.log("[mock] navigate", p); document.title = "navigated " + p; }, listen() {} } },
    showNotification(t) { console.log("[mock] notification", t); },
    PopupModal: { display() {}, hide() {} },
    LocalStorage: { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) },
  });

  // Topbar appears a bit after load, like in the real client.
  setTimeout(() => {
    class Button {
      constructor(label, icon, onClick, disabled = false, isRight = false) {
        this.element = document.createElement("div");
        this.element.className = "spicetify-topbar-button";
        this.button = document.createElement("button");
        this.button.className = "main-actionButtons-button";
        this.button.setAttribute("aria-label", label);
        this.button.innerHTML = icon;
        this.button.onclick = () => onClick(this);
        this.element.appendChild(this.button);
        const target = isRight ? document.querySelector(".main-actionButtons") : document.querySelector(".main-globalNav-historyButtons");
        if (isRight) target.prepend(this.element); else target.append(this.element);
      }
    }
    S.Topbar = { Button };
  }, 300);
})();
