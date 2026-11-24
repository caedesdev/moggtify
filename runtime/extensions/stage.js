/* Stage – a cinematic full-screen now playing view (F8 or double-click the cover) */
(function () {
  const ICONS = {
    prev: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.5 4.8v14.4L19.5 12z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
  };
  let api = null;

  Moggtify.extension({
    id: "stage",
    start(ctx) {
      const { M } = ctx;
      let root = null;
      let lastFocus = null;
      const fmt = (ms) => { const s = Math.max(0, Math.floor((ms || 0) / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

      ctx.style(`
        .mogg-stage{position:fixed;inset:0;z-index:2147482800;display:grid;place-items:center;overflow:hidden;color:#fff;background:#000;font-family:var(--encore-body-font-stack,system-ui,sans-serif);opacity:0;transition:opacity .32s cubic-bezier(.2,.8,.2,1)}
        .mogg-stage[data-state="open"]{opacity:1}
        .mogg-stage[data-state="closing"]{opacity:0;transition-duration:.2s;pointer-events:none}
        .mogg-stage .bg{position:absolute;inset:-15%;background-size:cover;background-position:center;filter:blur(90px) saturate(1.5) brightness(.45);transform:scale(1.2)}
        .mogg-stage .vignette{position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 30%,rgba(0,0,0,.6) 100%)}
        .mogg-stage .wrap{position:relative;display:flex;align-items:center;gap:min(6vw,72px);width:100%;max-width:1400px;padding:6vh 6vw;transform:translateY(10px);transition:transform .5s cubic-bezier(.2,.8,.2,1)}
        .mogg-stage[data-state="open"] .wrap{transform:none}
        .mogg-stage .cover{flex:none;width:min(46vh,40vw);aspect-ratio:1;border-radius:16px;background-size:cover;background-position:center;background-color:rgba(255,255,255,.06);box-shadow:0 40px 120px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.06);transition:transform .5s cubic-bezier(.2,.8,.2,1)}
        .mogg-stage.paused .cover{transform:scale(.95)}
        .mogg-stage .meta{flex:1;min-width:0}
        .mogg-stage .eyebrow{font-size:12px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;opacity:.6}
        .mogg-stage h1{margin:14px 0 12px;font-family:var(--encore-title-font-stack,inherit);font-size:clamp(32px,5.4vw,84px);line-height:1.02;font-weight:900;letter-spacing:-.03em;overflow-wrap:anywhere}
        .mogg-stage h2{margin:0;font-size:clamp(16px,1.8vw,26px);font-weight:600;opacity:.75}
        .mogg-stage .prog{display:flex;align-items:center;gap:14px;margin-top:36px;font-size:12px;font-variant-numeric:tabular-nums;opacity:.85}
        .mogg-stage .track{flex:1;height:5px;border-radius:5px;background:rgba(255,255,255,.18);overflow:hidden}
        .mogg-stage .track i{display:block;width:0;height:100%;border-radius:5px;background:var(--spice-button-active,#1ed760);transition:width .7s linear}
        .mogg-stage .ctl{display:flex;align-items:center;gap:14px;margin-top:28px}
        .mogg-stage button{all:unset;box-sizing:border-box;cursor:pointer;display:grid;place-items:center;border-radius:50%;transition:transform .15s ease,background-color .15s ease}
        .mogg-stage button:focus-visible{outline:2px solid var(--spice-button-active,#1ed760);outline-offset:3px}
        .mogg-stage .ctl button{width:46px;height:46px;background:rgba(255,255,255,.08)}
        .mogg-stage .ctl button:hover{background:rgba(255,255,255,.16);transform:scale(1.06)}
        .mogg-stage .ctl .main{width:62px;height:62px;background:#fff;color:#000}
        .mogg-stage .ctl .main:hover{background:#fff}
        .mogg-stage .ctl svg{width:20px;height:20px}
        .mogg-stage .ctl .main svg{width:26px;height:26px}
        .mogg-stage .close{position:absolute;top:22px;right:22px;width:40px;height:40px;background:rgba(255,255,255,.08)}
        .mogg-stage .close:hover{background:rgba(255,255,255,.16)}
        .mogg-stage .close svg{width:18px;height:18px}
        .mogg-stage .clock{position:absolute;top:28px;left:32px;font-size:14px;font-weight:700;opacity:.6;font-variant-numeric:tabular-nums}
        @media (max-width:820px){.mogg-stage .wrap{flex-direction:column;text-align:center}.mogg-stage .ctl,.mogg-stage .prog{justify-content:center}}
        @media (prefers-reduced-motion:reduce){.mogg-stage,.mogg-stage .wrap,.mogg-stage .cover,.mogg-stage .track i{transition:none}}
      `);

      function render(d) {
        if (!root || !d) return;
        const q = (s) => root.querySelector(s);
        if (d.cover) {
          const u = `url("${String(d.cover).replace(/"/g, "%22")}")`;
          if (q(".cover").style.backgroundImage !== u) { q(".cover").style.backgroundImage = u; q(".bg").style.backgroundImage = u; }
        }
        q("h1").textContent = d.title || "Nothing playing";
        q("h2").textContent = d.artist || "";
        q(".cur").textContent = fmt(d.position);
        q(".dur").textContent = fmt(d.duration);
        q(".track i").style.width = d.duration ? Math.min(100, (d.position / d.duration) * 100) + "%" : "0";
        const main = q(".main");
        const want = d.isPlaying ? "pause" : "play";
        if (main.dataset.icon !== want) { main.dataset.icon = want; main.innerHTML = ICONS[want]; main.setAttribute("aria-label", d.isPlaying ? "Pause" : "Play"); }
        root.classList.toggle("paused", !d.isPlaying);
        const now = new Date();
        q(".clock").textContent = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
      }

      function open() {
        if (root) return;
        const active = document.activeElement;
        lastFocus = active && active !== document.body ? active : null;
        const btn = (cls, icon, label, fn) => M.el("button", { type: "button", class: cls, html: icon, "aria-label": label, onclick: fn });
        root = M.el("div", { class: "mogg-ui mogg-stage", role: "dialog", "aria-modal": "true", "aria-label": "Stage", "data-state": "" },
          M.el("div", { class: "bg" }), M.el("div", { class: "vignette" }),
          M.el("div", { class: "clock", "aria-hidden": "true" }),
          btn("close", ICONS.close, "Close Stage", close),
          M.el("div", { class: "wrap" },
            M.el("div", { class: "cover", role: "img", "aria-label": "Cover art" }),
            M.el("div", { class: "meta" },
              M.el("div", { class: "eyebrow" }, "Now playing"),
              M.el("h1"), M.el("h2"),
              M.el("div", { class: "prog" }, M.el("span", { class: "cur" }), M.el("div", { class: "track" }, M.el("i")), M.el("span", { class: "dur" })),
              M.el("div", { class: "ctl" },
                btn("", ICONS.prev, "Previous", () => M.Player.prev()),
                btn("main", ICONS.play, "Play", () => M.Player.toggle()),
                btn("", ICONS.next, "Next", () => M.Player.next())))));
        document.body.append(root);
        render(M.Player.data());
        void root.offsetWidth;
        root.dataset.state = "open";
        const main = root.querySelector(".main");
        if (main) main.focus({ preventScroll: true });
      }
      function close() {
        const r = root;
        if (!r) return;
        root = null;
        r.dataset.state = "closing";
        setTimeout(() => r.remove(), 220);
        if (lastFocus && lastFocus.isConnected) { try { lastFocus.focus({ preventScroll: true }); } catch (_) {} }
        lastFocus = null;
      }
      const toggle = () => (root ? close() : open());
      api = { open, close, toggle };

      ctx.on("tick", render);
      ctx.hotkey("f8", () => { toggle(); return true; });
      ctx.hotkey("escape", () => (root ? (close(), true) : false), { allowInInputs: true });
      ctx.hotkey("space", () => (root ? (M.Player.toggle(), true) : false));

      const onDbl = (e) => {
        const w = e.target.closest && e.target.closest('[data-testid="now-playing-widget"]');
        if (w && e.target.tagName === "IMG") { e.preventDefault(); open(); }
      };
      document.addEventListener("dblclick", onDbl, true);
      ctx.onDispose(() => { document.removeEventListener("dblclick", onDbl, true); close(); api = null; });
    },
  });

  Moggtify.hub.addSection({
    extra: "stage",
    render: ({ el }) => el("div", { class: "mogg-row" },
      el("p", null, "Press F8, or double-click the cover art in the player bar."),
      el("button", { type: "button", class: "mogg-btn", onclick: () => { Moggtify.hub.close(); setTimeout(() => api && api.open(), 160); } }, "Open Stage")),
  });
})();
