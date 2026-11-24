/* Wheel Volume – scroll over the player bar to change the volume */
Moggtify.extension({
  id: "wheelvolume",
  start(ctx) {
    const { M } = ctx;
    const STEP = 0.04;
    let hud = null, hideT = 0;

    function showHud(v) {
      if (!hud || !hud.isConnected) {
        hud = M.el("div", { class: "mogg-ui mogg-vol", role: "status", "aria-live": "polite" },
          M.el("span", { class: "ico", html: M.icons.volume }), M.el("div", { class: "bar" }, M.el("i")), M.el("span", { class: "pct" }));
        document.body.append(hud);
      }
      const pct = Math.round(v * 100);
      hud.querySelector("i").style.width = pct + "%";
      hud.querySelector(".pct").textContent = pct + "%";
      hud.classList.add("show");
      clearTimeout(hideT);
      hideT = setTimeout(() => hud && hud.classList.remove("show"), 900);
    }

    function onWheel(e) {
      const bar = e.target.closest && e.target.closest('[data-testid="now-playing-bar"], .Root__now-playing-bar');
      if (!bar || e.ctrlKey) return;
      const v = M.Player.getVolume();
      if (v == null) return;
      e.preventDefault();
      const next = Math.max(0, Math.min(1, v + (e.deltaY < 0 ? STEP : -STEP)));
      M.Player.setVolume(next);
      showHud(next);
    }

    ctx.style(`
      .mogg-vol{position:fixed;right:24px;bottom:104px;z-index:2147483000;display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;
        background:var(--spice-card,#282828);color:var(--spice-text,#fff);box-shadow:0 16px 40px rgba(0,0,0,.5);font:700 12px/1 var(--encore-body-font-stack,system-ui,sans-serif);
        opacity:0;transform:translateY(6px);transition:opacity .18s ease,transform .18s ease;pointer-events:none}
      .mogg-vol.show{opacity:1;transform:none}
      .mogg-vol .ico{display:grid;place-items:center;width:16px;height:16px;color:var(--spice-subtext,#b3b3b3)}
      .mogg-vol .ico svg{width:16px;height:16px}
      .mogg-vol .bar{width:120px;height:4px;border-radius:4px;background:rgba(var(--spice-rgb-text,255,255,255),.2);overflow:hidden}
      .mogg-vol .bar i{display:block;height:100%;background:var(--spice-button-active,#1ed760);transition:width .12s ease}
      .mogg-vol .pct{min-width:34px;text-align:right;font-variant-numeric:tabular-nums}
      @media (prefers-reduced-motion:reduce){.mogg-vol,.mogg-vol .bar i{transition:none}}
    `);
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    ctx.onDispose(() => {
      window.removeEventListener("wheel", onWheel, { capture: true });
      clearTimeout(hideT);
      if (hud) hud.remove();
      hud = null;
    });
  },
});
