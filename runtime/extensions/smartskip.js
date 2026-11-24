/* Smart Skip – automatically skips versions of songs you don't want */
(function () {
  const RULES = [
    { id: "live", name: "Live", re: /[-(\[]\s*live\b|\blive (at|from|in)\b/i, on: true },
    { id: "spedup", name: "Sped up / Nightcore", re: /\bsped[\s-]?up\b|\bnightcore\b/i, on: true },
    { id: "slowed", name: "Slowed / Reverb", re: /\bslowed\b|\breverb\b/i, on: true },
    { id: "remix", name: "Remixes", re: /\bremix\b|\bedit\)|\bbootleg\b/i, on: false },
    { id: "acoustic", name: "Acoustic", re: /\bacoustic\b|\bakustik\b/i, on: false },
    { id: "instrumental", name: "Instrumentals", re: /\binstrumental\b/i, on: false },
  ];
  const ruleOn = (settings, r) => !!settings.get("smartskip", r.id, r.on);

  Moggtify.extension({
    id: "smartskip",
    start(ctx) {
      const { M } = ctx;
      let lastSkipped = "";
      ctx.on("songchange", (d) => {
        const title = (d && d.title) || "";
        if (!title) return;
        const active = RULES.filter((r) => ctx.settings.get(r.id, r.on));
        const words = String(ctx.settings.get("custom", "")).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        const lower = title.toLowerCase();
        const rule = active.find((r) => r.re.test(title));
        const word = !rule && words.find((w) => lower.includes(w));
        const key = title + "|" + d.artist;
        if ((rule || word) && key !== lastSkipped) {
          lastSkipped = key;
          setTimeout(() => { M.Player.next(); M.toast("Skipped " + (rule ? rule.name.toLowerCase() + " version" : "“" + word + "”") + " · Smart Skip"); }, 350);
        }
      });
    },
  });

  Moggtify.hub.addSection({
    extra: "smartskip",
    render: ({ el, settings }) => {
      const chips = el("div", { class: "mogg-chips", role: "group", "aria-label": "Skip rules" });
      for (const r of RULES) {
        const chip = el("button", { type: "button", class: "mogg-chip", "aria-pressed": String(ruleOn(settings, r)) }, r.name);
        chip.addEventListener("click", () => {
          const v = !ruleOn(settings, r);
          settings.set("smartskip", r.id, v);
          chip.setAttribute("aria-pressed", String(v));
        });
        chips.append(chip);
      }
      const input = el("input", { class: "mogg-input", type: "text", spellcheck: "false", placeholder: "Also skip titles containing… (comma separated, e.g. karaoke, cover)", "aria-label": "Custom words to skip" });
      input.value = settings.get("smartskip", "custom", "");
      input.addEventListener("change", () => settings.set("smartskip", "custom", input.value));
      return el("div", null, el("div", { class: "mogg-sub-label" }, "Skip these versions"), chips, input);
    },
  });
})();
