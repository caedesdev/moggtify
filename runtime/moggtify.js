/*!
 * Moggtify for Spotify – runtime
 * Loaded by Spicetify as an extension. Adds the Moggtify button next to the
 * profile picture, the Moggtify Hub (designs, extras, installed, about), the
 * design engine, player helpers and the extras system.
 */
(function () {
  "use strict";
  if (window.Moggtify) return;

  const VERSION = "__MOGG_VERSION__";
  const CFG = window.__MOGG_CONFIG || {};
  const EXTRAS = Array.isArray(window.__MOGG_EXTENSIONS) ? window.__MOGG_EXTENSIONS : [];
  const STATE_KEY = "moggtify:state";
  const SETTINGS_KEY = "moggtify:settings";
  const TAB_KEY = "moggtify:hub-tab";
  const BRAND = "#1ed760";
  // Spotify's own palette (Spicetify's colors.css) in design-schema form.
  const SPOTIFY_COLORS = {
    frame: "#000000", base: "#121212", highlight: "#242424", elevated: "#282828",
    elevatedHighlight: "#2a2a2a", text: "#ffffff", subdued: "#b3b3b3",
    accent: "#1ed760", accentText: "#000000", border: "#535353",
  };

  /* ------------------------------------------------------------------ */
  /* Utilities                                                           */
  /* ------------------------------------------------------------------ */

  const log = (...a) => console.log("%c moggtify ", "background:#1ed760;color:#02130a;border-radius:4px;font-weight:700", ...a);
  const warn = (...a) => console.warn("[moggtify]", ...a);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) { return false; } };

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (k === "html") node.innerHTML = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function createEmitter() {
    const map = new Map();
    return {
      on(evt, fn) {
        if (!map.has(evt)) map.set(evt, new Set());
        map.get(evt).add(fn);
        return () => map.get(evt).delete(fn);
      },
      emit(evt, data) {
        for (const fn of Array.from(map.get(evt) || [])) {
          try { fn(data); } catch (e) { warn("listener error", evt, e); }
        }
      },
    };
  }
  const bus = createEmitter();

  function readJSON(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (_) { return null; } }
  function writeJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) {} }

  /* ---- color math ---- */
  const Color = {
    valid(v) { return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v || "").trim()); },
    parse(hex) {
      hex = String(hex || "").trim().replace("#", "");
      if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
      const n = parseInt(hex.slice(0, 6), 16);
      if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    },
    hex({ r, g, b }) {
      const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
      return "#" + h(r) + h(g) + h(b);
    },
    norm(hex) { return Color.hex(Color.parse(hex)); },
    triple(hex) { const { r, g, b } = Color.parse(hex); return r + "," + g + "," + b; },
    mix(a, b, t) {
      const x = Color.parse(a), y = Color.parse(b);
      return Color.hex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
    },
    alpha(hex, a) { const { r, g, b } = Color.parse(hex); return `rgba(${r},${g},${b},${a})`; },
    luminance(hex) {
      const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const { r, g, b } = Color.parse(hex);
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    },
    readableOn(hex) { return Color.luminance(hex) > 0.36 ? "#0b0b0f" : "#ffffff"; },
    // WCAG contrast ratio between two colors (1 … 21).
    contrast(a, b) {
      const x = Color.luminance(a), y = Color.luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    },
    hsl(hex) { return Color.rgbToHsl(Color.parse(hex)); },
    shiftHue(hex, turns) {
      const c = Color.hsl(hex);
      c.h = (((c.h + turns) % 1) + 1) % 1;
      return Color.hslToHex(c);
    },
    rgbToHsl({ r, g, b }) {
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h = 0, s = 0; const l = (max + min) / 2;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        h /= 6;
      }
      return { h, s, l };
    },
    hslToHex({ h, s, l }) {
      const f = (p, q, t) => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      let r, g, b;
      if (s === 0) r = g = b = l;
      else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
        r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3);
      }
      return Color.hex({ r: r * 255, g: g * 255, b: b * 255 });
    },
  };

  /* ------------------------------------------------------------------ */
  /* Icons                                                               */
  /* ------------------------------------------------------------------ */

  const P = (d, extra) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra ? " " + extra : ""}>${d}</svg>`;
  const DOT = 'fill="currentColor" stroke="none"';
  const ICONS = {
    m: P('<path d="M4.5 18.5V6.8L12 13.6l7.5-6.8v11.7"/>', 'stroke-width="3"'),
    designs: P(`<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2a1.8 1.8 0 0 1 1.3-3.1h2.1c2.1 0 3.8-1.8 3.8-4 0-3.7-3.8-6.9-8.5-6.9z"/><circle cx="7.6" cy="11.4" r="1.2" ${DOT}/><circle cx="10.2" cy="7.5" r="1.2" ${DOT}/><circle cx="14.9" cy="7.6" r="1.2" ${DOT}/>`),
    extras: P('<path d="M11 3.5l1.9 5.2 5.1 1.8-5.1 1.9L11 17.6l-1.9-5.2L4 10.5l5.1-1.8z"/><path d="M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>'),
    installed: P('<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><path d="M17 13.8v6.4M13.8 17h6.4"/>'),
    about: P(`<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2"/><circle cx="12" cy="7.9" r="1.1" ${DOT}/>`),
    close: P('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>', 'stroke-width="2.2"'),
    check: P('<path d="M5.5 12.5l4.3 4.3 8.7-9.6"/>', 'stroke-width="3"'),
    arrow: P('<path d="M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5"/>', 'stroke-width="2.2"'),
    tip: P('<path d="M6.5 4.5v6.5a3 3 0 0 0 3 3h9.5"/><path d="M15 10l4 4-4 4"/>', 'stroke-width="2"'),
    plus: P('<path d="M12 5.5v13M5.5 12h13"/>', 'stroke-width="2.6"'),
    info: P(`<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2"/><circle cx="12" cy="7.9" r="1.1" ${DOT}/>`),
    external: P('<path d="M13.5 4.5h6v6M19.5 4.5 11 13"/><path d="M18 14.5v3.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18V8a1.5 1.5 0 0 1 1.5-1.5H10"/>'),
    wrench: P('<path d="M14.7 6.3a4 4 0 0 0 5 5L21 12.6a6 6 0 0 1-7.6 1.2L7 20.2a2 2 0 0 1-2.8-2.8l6.4-6.4A6 6 0 0 1 11.8 3.4l1.3 1.3a4 4 0 0 0 1.6 1.6z"/>'),
    studio: P('<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>'),
    copy: P('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>'),
    dice: P(`<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.2" ${DOT}/><circle cx="15" cy="15" r="1.2" ${DOT}/><circle cx="15" cy="9" r="1.2" ${DOT}/><circle cx="9" cy="15" r="1.2" ${DOT}/>`),
    remix: P('<path d="M4 8h10a5 5 0 0 1 0 10h-2"/><path d="M8 4 4 8l4 4"/><path d="M12 15l-3 3 3 3"/>'),
    // catalog icons (CatalogItem.icon)
    expand: P('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    trash: P('<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8l1-12M9 7V4.5h6V7"/>'),
    shuffle: P('<path d="M16 4h4v4M4 18.5h2.6a4 4 0 0 0 3.3-1.7l4.2-6.1a4 4 0 0 1 3.3-1.7H20M20 4l-4.5 4.5M16 20h4v-4M20 20l-4.5-4.5M4 5.5h2.6a4 4 0 0 1 3 1.4"/>'),
    bookmark: P('<path d="M6.5 4h11a1 1 0 0 1 1 1v15.5l-6.5-4-6.5 4V5a1 1 0 0 1 1-1z"/>'),
    loop: P('<path d="M17 3.5l3 3-3 3"/><path d="M4 12v-1.5a4 4 0 0 1 4-4h12M7 20.5l-3-3 3-3"/><path d="M20 12v1.5a4 4 0 0 1-4 4H4"/>'),
    lyrics: P('<path d="M4.5 5.5h15M4.5 10h10M4.5 14.5h7"/><circle cx="17" cy="17" r="2.5"/><path d="M19.5 17V9.5"/>'),
    skip: P('<path d="M5 5v14l10-7z"/><path d="M19 5v14"/>'),
    keyboard: P('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9"/>'),
    broadcast: P('<circle cx="12" cy="12" r="2"/><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 15.8a5.4 5.4 0 0 0 0-7.6M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 18.6a9.3 9.3 0 0 0 0-13.2"/>'),
    store: P('<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5.5 12v7.5h13V12"/><path d="M10 19.5V15h4v4.5"/>'),
    sparkle: P('<path d="M12 3.5l1.9 5.2 5.1 1.8-5.1 1.9L12 17.6l-1.9-5.2L5 10.5l5.1-1.8z"/>'),
    chat: P('<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12z"/>'),
    code: P('<path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4"/>'),
    app: P('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 12h6M12 9v6"/>'),
    spark: P('<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3.2"/>'),
    layers: P('<path d="M12 3 2.5 8 12 13l9.5-5z"/><path d="m2.5 12.5 9.5 5 9.5-5"/><path d="m2.5 17 9.5 5 9.5-5" opacity=".5"/>'),
    volume: P('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>'),
    broom: P('<path d="M14.5 3.5 20.5 9.5M12 6l6 6M10.5 7.5l6 6-3.5 7-9.5-9.5z"/><path d="m7 15 2 2"/>'),
  };
  // 16px top-bar mark: rounded square + M, drawn with currentColor so it
  // follows Spotify's own button colors (subdued → white on hover).
  const ICON_TOPBAR = '<svg role="img" height="16" width="16" aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="1.25" y="1.25" width="13.5" height="13.5" rx="4.25" stroke-width="1.5"/><path d="M5.1 10.9V5.7L8 8.4l2.9-2.7v5.2" stroke-width="1.6"/></svg>';

  /* ------------------------------------------------------------------ */
  /* State (lives in Spotify's localStorage, survives restarts)          */
  /* ------------------------------------------------------------------ */

  function isPassthrough(d) { return !d || !!d.passthrough || d.id === "spotify"; }

  const DESIGNS = (() => {
    const raw = Array.isArray(window.__MOGG_THEMES) ? window.__MOGG_THEMES : [];
    const list = raw.filter((d) => d && typeof d.id === "string" && d.id);
    const pass = list.filter(isPassthrough);
    if (!pass.length) pass.push({ id: "spotify", name: "Spotify", description: "Spotify's own colors, untouched.", passthrough: true, colors: SPOTIFY_COLORS });
    return pass.concat(list.filter((d) => !isPassthrough(d)));
  })();

  function colorsOf(d) {
    const c = Object.assign({}, SPOTIFY_COLORS);
    if (d && d.colors) for (const k of Object.keys(d.colors)) if (Color.valid(d.colors[k])) c[k] = d.colors[k];
    if (!(d && d.colors && Color.valid(d.colors.accentText))) c.accentText = Color.readableOn(c.accent);
    return c;
  }

  /* ---- flavors, effects and the design generator (Design Studio) ---- */

  const FLAVORS = ["flat", "glass", "aurora"];   // what sits behind the panels
  const EFFECTS = ["soft", "neon", "wash"];      // extras layered on top
  const COLOR_KEYS = ["frame", "base", "highlight", "elevated", "elevatedHighlight", "text", "subdued", "accent", "accentText", "border"];
  const MAX_CUSTOM = 24;

  const cleanName = (v, fallback) => {
    const s = String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 28);
    return s || fallback;
  };
  const cleanEffects = (v) => (Array.isArray(v) ? EFFECTS.filter((e) => v.includes(e)) : []);
  const cleanFlavor = (v) => (FLAVORS.includes(v) ? v : "flat");
  const cleanAurora = (v) => (Array.isArray(v) ? v.filter((c) => Color.valid(c)).slice(0, 3).map((c) => Color.norm(c)) : []);

  // Build a complete, readable dark palette from just a background tint and
  // an accent. Every result satisfies the same contrast rules the built-in
  // designs are validated against (tools/check-designs.mjs).
  function generateColors(bg, accent) {
    const b = Color.hsl(Color.valid(bg) ? bg : "#121212");
    const h = b.h, s = Math.min(b.s, 0.55), l = Math.max(0, Math.min(b.l, 0.105));
    const tone = (ds, dl) => Color.hslToHex({ h, s: Math.max(0, Math.min(1, s * ds)), l: Math.max(0, Math.min(1, l + dl)) });
    const c = {
      frame: Color.hslToHex({ h, s, l: l * 0.42 }),
      base: tone(1, 0),
      highlight: tone(0.9, 0.06),
      elevated: tone(0.9, 0.045),
      elevatedHighlight: tone(0.85, 0.1),
      border: tone(0.8, 0.105),
      text: Color.hslToHex({ h, s: Math.min(s, 0.3), l: 0.965 }),
    };
    // Secondary text: as soft as possible while staying readable on cards.
    let sl = 0.66;
    c.subdued = Color.hslToHex({ h, s: Math.min(s, 0.2), l: sl });
    while (Color.contrast(c.subdued, c.elevated) < 4.6 && sl < 0.95) { sl += 0.02; c.subdued = Color.hslToHex({ h, s: Math.min(s, 0.2), l: sl }); }
    // Accent: must stand out against the panels and carry readable text.
    // Only ever lighten it – that converges for every input (a near-white
    // accent contrasts with the dark panels and with dark ink).
    let a = Color.norm(Color.valid(accent) ? accent : BRAND), at = "";
    const inkFor = (x) => Color.hslToHex({ h: Color.hsl(x).h, s: 0.55, l: 0.07 });
    const textFor = (x) => {
      const ink = inkFor(x), wi = Color.contrast("#ffffff", x), ki = Color.contrast(ink, x);
      if (wi >= 4.6 && wi >= ki) return "#ffffff";
      return ki >= 4.6 ? ink : "";
    };
    for (let i = 0; i < 80; i++) {
      at = textFor(a);
      if (at && Color.contrast(a, c.base) >= 3.2 && Color.contrast(a, c.frame) >= 3.2) break;
      a = Color.mix(a, "#ffffff", 0.06);
    }
    if (!at) at = inkFor(a);
    c.accent = a; c.accentText = at;
    return c;
  }

  function sanitizeDesign(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = typeof raw.id === "string" && /^my-[a-z0-9]{1,24}$/.test(raw.id) ? raw.id : null;
    if (!id) return null;
    const src = raw.src && Color.valid(raw.src.bg) && Color.valid(raw.src.accent) ? { bg: Color.norm(raw.src.bg), accent: Color.norm(raw.src.accent) } : null;
    let colors = null;
    if (raw.colors && COLOR_KEYS.every((k) => Color.valid(raw.colors[k]))) {
      colors = {};
      for (const k of COLOR_KEYS) colors[k] = Color.norm(raw.colors[k]);
    } else if (src) colors = generateColors(src.bg, src.accent);
    if (!colors) return null;
    const d = { id, name: cleanName(raw.name, "My design"), description: "Made in the Design Studio.", colors, flavor: cleanFlavor(raw.flavor), effects: cleanEffects(raw.effects), custom: true };
    if (src) d.src = src;
    return d;
  }

  // The Studio's input: {name, bg, accent, flavor, effects} → a full design.
  function generateDesign(input, id) {
    const bg = Color.valid(input && input.bg) ? Color.norm(input.bg) : "#121212";
    const accent = Color.valid(input && input.accent) ? Color.norm(input.accent) : BRAND;
    return {
      id: id || "my-draft", name: cleanName(input && input.name, "My design"), description: "Made in the Design Studio.",
      colors: generateColors(bg, accent), flavor: cleanFlavor(input && input.flavor), effects: cleanEffects(input && input.effects),
      custom: true, src: { bg, accent },
    };
  }

  // Share codes: "mogg:" + base64url of the Studio input. Tiny and safe to
  // paste – decoding only ever yields validated colors and whitelisted flags.
  function encodeDesign(d) {
    if (!d || !d.src) return "";
    const payload = { v: 1, n: cleanName(d.name, "My design"), b: d.src.bg, a: d.src.accent, f: cleanFlavor(d.flavor), e: cleanEffects(d.effects) };
    try {
      return "mogg:" + btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    } catch (_) { return ""; }
  }
  function decodeDesign(code) {
    const m = /^\s*mogg:([A-Za-z0-9_-]{8,600})\s*$/.exec(String(code || ""));
    if (!m) return null;
    try {
      const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
      const p = JSON.parse(decodeURIComponent(escape(atob(b64 + "===".slice((b64.length + 3) % 4)))));
      if (!p || p.v !== 1 || !Color.valid(p.b) || !Color.valid(p.a)) return null;
      return { name: cleanName(p.n, "Shared design"), bg: Color.norm(p.b), accent: Color.norm(p.a), flavor: cleanFlavor(p.f), effects: cleanEffects(p.e) };
    } catch (_) { return null; }
  }

  function loadState() {
    const s = readJSON(STATE_KEY);
    const st = { v: 2, design: typeof CFG.design === "string" && CFG.design ? CFG.design : DESIGNS[0].id, accent: "", extras: {}, custom: [] };
    if (s && s.v === 2) {
      if (typeof s.design === "string" && s.design) st.design = s.design;
      if (Color.valid(s.accent)) st.accent = s.accent;
      if (s.extras && typeof s.extras === "object") for (const k of Object.keys(s.extras)) st.extras[k] = !!s.extras[k];
      if (Array.isArray(s.custom)) {
        const seen = new Set();
        for (const raw of s.custom.slice(0, MAX_CUSTOM)) {
          const d = sanitizeDesign(raw);
          if (d && !seen.has(d.id)) { seen.add(d.id); st.custom.push(d); }
        }
      }
    }
    return st;
  }
  const state = loadState();
  const saveState = () => writeJSON(STATE_KEY, state);

  let settingsStore = readJSON(SETTINGS_KEY) || {};
  if (typeof settingsStore !== "object") settingsStore = {};
  const settings = {
    get(ns, key, fallback) {
      const v = settingsStore[ns] && settingsStore[ns][key];
      return v === undefined ? fallback : v;
    },
    set(ns, key, value) {
      (settingsStore[ns] = settingsStore[ns] || {})[key] = value;
      writeJSON(SETTINGS_KEY, settingsStore);
    },
  };

  /* ------------------------------------------------------------------ */
  /* Style manager – our <style> nodes stay last in <head>               */
  /* ------------------------------------------------------------------ */

  const styles = new Map();
  function setStyle(id, css) {
    let node = styles.get(id);
    if (!css) { if (node) { node.remove(); styles.delete(id); } return; }
    if (!node) {
      node = document.createElement("style");
      node.dataset.moggtify = id;
      styles.set(id, node);
    }
    if (node.textContent !== css) node.textContent = css;
    const head = document.head || document.documentElement;
    if (node.parentNode !== head) head.appendChild(node);
    stylesLast();
  }
  function stylesLast() {
    const head = document.head;
    if (!head || !styles.size) return;
    let foreign = null;
    for (let n = head.lastElementChild; n; n = n.previousElementSibling) {
      if (!(n.dataset && n.dataset.moggtify)) { foreign = n; break; }
    }
    const ours = Array.from(styles.values());
    const misplaced = ours.some((n) => n.parentNode !== head || (foreign && (foreign.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING)));
    if (misplaced) for (const n of ours) head.appendChild(n);
  }
  let headWatch = null;
  function watchHead() {
    if (headWatch || !document.head || typeof MutationObserver !== "function") return;
    let queued = false;
    headWatch = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      Promise.resolve().then(() => { queued = false; stylesLast(); });
    });
    headWatch.observe(document.head, { childList: true });
  }

  /* ------------------------------------------------------------------ */
  /* Design engine                                                       */
  /* ------------------------------------------------------------------ */
  // A design sets every --spice-* / --spice-rgb-* variable (exactly how
  // Spicetify themes work) plus encore overrides for the few colors Spotify
  // hardcodes. ":root:root" beats colors.css and Marketplace schemes, which
  // are injected into <body> after our <style>.

  let dynamicAccent = null;           // Vibe Glow
  const glassOwners = new Set();      // "design" (glass flavor) and "ambient"

  let previewDesign = null;           // Design Studio: live, unsaved
  const allDesigns = () => DESIGNS.concat(state.custom);
  function designById(id) { return DESIGNS.find((d) => d.id === id) || state.custom.find((d) => d.id === id) || null; }
  function currentDesign() { return previewDesign || designById(state.design) || DESIGNS[0]; }

  // What a design adds on top of its palette.
  function fxOf(d) {
    if (isPassthrough(d)) return { backdrop: "", soft: false, neon: false, wash: false };
    const eff = Array.isArray(d.effects) ? d.effects : [];
    return {
      backdrop: d.flavor === "glass" ? "cover" : d.flavor === "aurora" ? "aurora" : "",
      soft: d.flavor === "soft" || eff.includes("soft"),
      neon: eff.includes("neon"),
      wash: eff.includes("wash"),
    };
  }
  // The three aurora lights: the design's own, or derived from its accent.
  function auroraOf(d, c) {
    const own = d && Array.isArray(d.aurora) ? d.aurora.filter((x) => Color.valid(x)) : [];
    return [own[0] || c.accent, own[1] || Color.shiftHue(c.accent, 0.16), own[2] || Color.shiftHue(c.accent, -0.2)];
  }
  function accentOverride() {
    if (previewDesign) return ""; // the Studio shows a design exactly as it is made
    return dynamicAccent || (Color.valid(state.accent) ? state.accent : "");
  }

  function effectiveColors() {
    const c = colorsOf(currentDesign());
    const a = accentOverride();
    if (a) { c.accent = a; c.accentText = Color.readableOn(a); }
    return c;
  }

  function spiceVars(c) {
    return {
      main: c.base, sidebar: c.frame, player: c.frame, card: c.elevated,
      "main-elevated": c.highlight, highlight: c.highlight, "highlight-elevated": c.elevatedHighlight,
      shadow: "#000000", "selected-row": c.text,
      button: Color.mix(c.accent, "#000000", 0.12), "button-active": c.accent, "button-disabled": c.border,
      "tab-active": c.elevatedHighlight,
      notification: Color.valid(c.notification) ? c.notification : "#4687d6",
      "notification-error": Color.valid(c.notificationError) ? c.notificationError : "#e22134",
      misc: c.subdued, text: c.text, subtext: c.subdued,
    };
  }
  function varsBlock(map) {
    let s = "";
    for (const k of Object.keys(map)) s += `--spice-${k}:${Color.norm(map[k])};--spice-rgb-${k}:${Color.triple(map[k])};`;
    return s;
  }

  const ACCENT_SETS = ".encore-dark-theme .encore-bright-accent-set.encore-bright-accent-set,.encore-dark-theme .encore-positive-set.encore-positive-set";
  function accentSetCSS(a, at) {
    const hi = Color.mix(a, "#ffffff", 0.14), pr = Color.mix(a, "#000000", 0.16);
    const kids = ACCENT_SETS.split(",").map((s) => s + ">*").join(",");
    return `${ACCENT_SETS}{--background-base:var(--spice-button-active);--background-highlight:${hi};--background-press:${pr};` +
      `--background-elevated-base:${hi};--background-elevated-highlight:${hi};--background-elevated-press:${pr};` +
      `--background-tinted-base:var(--spice-button-active);--background-tinted-highlight:var(--spice-button-active);--background-tinted-press:var(--spice-button-active);` +
      `--text-base:${at};--text-subdued:${at};--text-bright-accent:${at};--text-negative:${at};--text-warning:${at};--text-positive:${at};--text-announcement:${at};` +
      `--essential-base:${at};--essential-subdued:${at};--essential-bright-accent:${at};--essential-negative:${at};--essential-warning:${at};--essential-positive:${at};--essential-announcement:${at};` +
      `--decorative-base:${at};--decorative-subdued:${pr}}${kids}{--parents-essential-base:${at}}`;
  }

  function paletteCSS(c, d) {
    const a = c.accent, at = c.accentText || Color.readableOn(a);
    const light = Color.luminance(c.base) > 0.45;
    const toward = light ? "#000000" : "#ffffff";
    const au = auroraOf(d, c);
    return `:root:root{${varsBlock(spiceVars(c))}--mogg-accent:${a};--mogg-accent-text:${at};--mogg-rgb-accent:${Color.triple(a)};--mogg-au1:${Color.norm(au[0])};--mogg-au2:${Color.norm(au[1])};--mogg-au3:${Color.norm(au[2])}}` +
      `.encore-dark-theme.encore-dark-theme,.encore-dark-theme .encore-base-set.encore-base-set{color-scheme:${light ? "light" : "dark"};` +
      `--background-base:var(--spice-main);--background-highlight:var(--spice-main-elevated);--background-press:var(--spice-sidebar);` +
      `--background-elevated-base:var(--spice-main-elevated);--background-elevated-highlight:var(--spice-highlight-elevated);--background-elevated-press:${Color.mix(c.elevated, light ? "#ffffff" : "#000000", 0.25)};` +
      `--background-tinted-base:rgba(var(--spice-rgb-text),.1);--background-tinted-highlight:rgba(var(--spice-rgb-text),.14);--background-tinted-press:rgba(var(--spice-rgb-text),.21);` +
      `--text-base:var(--spice-text);--text-subdued:var(--spice-subtext);--text-bright-accent:var(--spice-button-active);--text-positive:var(--spice-button-active);` +
      `--essential-base:var(--spice-text);--essential-subdued:${Color.mix(c.subdued, c.base, 0.35)};--essential-bright-accent:var(--spice-button-active);--essential-positive:var(--spice-button-active);` +
      `--decorative-base:var(--spice-text);--decorative-subdued:${c.border}}` +
      `.encore-dark-theme.encore-dark-theme>*,.encore-dark-theme .encore-base-set.encore-base-set>*{--parents-essential-base:var(--spice-text)}` +
      `.encore-dark-theme .encore-app-frame-set.encore-app-frame-set,.encore-dark-theme .encore-muted-accent-set.encore-muted-accent-set{` +
      `--background-base:var(--spice-sidebar);--background-highlight:${Color.mix(c.frame, toward, 0.08)};--background-press:${Color.mix(c.frame, toward, 0.17)};` +
      `--background-elevated-base:${Color.mix(c.frame, toward, 0.08)};--background-elevated-press:${Color.mix(c.frame, toward, 0.04)};` +
      `--text-subdued:${Color.mix(c.subdued, c.frame, 0.06)};--essential-subdued:${Color.mix(c.subdued, c.frame, 0.35)}}` +
      accentSetCSS(a, at) +
      `::selection{background:${Color.alpha(a, 0.32)}}`;
  }

  function accentOnlyCSS(a) {
    const at = Color.readableOn(a), btn = Color.mix(a, "#000000", 0.12);
    return `:root:root{--spice-button:${Color.norm(btn)};--spice-rgb-button:${Color.triple(btn)};--spice-button-active:${Color.norm(a)};--spice-rgb-button-active:${Color.triple(a)};` +
      `--mogg-accent:${a};--mogg-accent-text:${at};--mogg-rgb-accent:${Color.triple(a)}}` +
      `.encore-dark-theme.encore-dark-theme,.encore-dark-theme .encore-base-set.encore-base-set{--text-bright-accent:var(--spice-button-active);--essential-bright-accent:var(--spice-button-active);--text-positive:var(--spice-button-active);--essential-positive:var(--spice-button-active)}` +
      accentSetCSS(a, at) +
      `::selection{background:${Color.alpha(a, 0.32)}}`;
  }

  // "soft": larger radii, only on selectors verified in Spotify 1.3.10's CSS.
  const SOFT_CSS =
    'html.encore-layout-themes[data-mogg-fx~="soft"]{--encore-corner-radius-smaller:4px;--encore-corner-radius-base:6px;--encore-corner-radius-larger:10px;--encore-corner-radius-larger-2:12px;--encore-corner-radius-larger-3:22px;--card-image-radius:10px}' +
    'html[data-mogg-fx~="soft"] .Root__nav-bar,html[data-mogg-fx~="soft"] .Root__main-view,html[data-mogg-fx~="soft"] .main-yourLibraryX-entryPoints{border-radius:16px}' +
    'html[data-mogg-fx~="soft"] .main-trackList-trackListRow{border-radius:8px}';

  // "neon": the accent glows – a lit outline around the panels and a halo on
  // the play button. Only box-shadows on selectors verified in 1.3.10.
  const NEON = "rgba(var(--spice-rgb-button-active),";
  const NEON_CSS =
    `html[data-mogg-fx~="neon"] .Root__main-view,html[data-mogg-fx~="neon"] .main-yourLibraryX-entryPoints{box-shadow:0 0 0 1px ${NEON}.3),0 0 28px -6px ${NEON}.5)}` +
    `html[data-mogg-fx~="neon"] [data-testid="control-button-playpause"]{box-shadow:0 0 0 1px ${NEON}.55),0 0 22px 1px ${NEON}.6)}` +
    `html[data-mogg-fx~="neon"] .main-globalNav-searchInputContainer .main-topBar-searchBar{box-shadow:0 0 0 1px ${NEON}.24),0 0 20px -8px ${NEON}.5)}`;

  // "wash": a soft veil of the accent color over the panels.
  const WASH_CSS =
    `html[data-mogg-fx~="wash"] .main-yourLibraryX-entryPoints{background-image:linear-gradient(180deg,${NEON}.14),transparent 48%)}` +
    `html[data-mogg-fx~="wash"] .Root__main-view{background-image:linear-gradient(180deg,${NEON}.11),transparent 440px)}` +
    `html[data-mogg-fx~="wash"] .Root__now-playing-bar{background-image:linear-gradient(90deg,${NEON}.1),transparent 40%)}`;

  // "glass" (and the Ambient extra): the app frame turns transparent and the
  // panels translucent over a blurred cover-art backdrop. Spice variables stay
  // opaque on purpose – Spotify uses some of them inside mask-image gradients.
  const GLASS_CSS =
    "html[data-mogg-glass]{background-color:var(--spice-sidebar)!important}" +
    "html[data-mogg-glass] .Root__top-container,html[data-mogg-glass] .Root__globalNav,html[data-mogg-glass] .Root__now-playing-bar,html[data-mogg-glass] .Root__nav-bar{background-color:transparent!important}" +
    "html[data-mogg-glass].encore-dark-theme,html[data-mogg-glass].encore-dark-theme .encore-base-set{--background-base:rgba(var(--spice-rgb-main),.56)!important}" +
    ".mogg-backdrop{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;background:radial-gradient(70% 60% at 14% 8%,rgba(var(--spice-rgb-button-active),.26),transparent 70%),radial-gradient(60% 60% at 92% 96%,rgba(var(--spice-rgb-button-active),.14),transparent 70%),var(--spice-sidebar)}" +
    ".mogg-backdrop>i{position:absolute;inset:-14%;background-position:center;background-size:cover;filter:blur(72px) saturate(1.45) brightness(.62);transform:scale(1.12);opacity:0;transition:opacity 1.2s ease}" +
    ".mogg-backdrop>i.on{opacity:1}" +
    ".mogg-backdrop::after{content:\"\";position:absolute;inset:0;background:linear-gradient(180deg,rgba(var(--spice-rgb-sidebar),.12),rgba(var(--spice-rgb-sidebar),.5))}" +
    // "aurora": three slow lights in the design's colors instead of cover art.
    ".mogg-backdrop>b{position:absolute;border-radius:50%;filter:blur(90px);opacity:0;transition:opacity 1.2s ease;will-change:transform}" +
    '.mogg-backdrop[data-kind="aurora"]>b{opacity:.5}' +
    '.mogg-backdrop[data-kind="aurora"]>i{opacity:0!important}' +
    ".mogg-backdrop>b:nth-of-type(1){width:62vw;height:62vw;left:-14vw;top:-26vw;background:var(--mogg-au1,#1ed760);animation:mogg-au1 28s ease-in-out infinite alternate}" +
    ".mogg-backdrop>b:nth-of-type(2){width:54vw;height:54vw;right:-16vw;top:6vh;background:var(--mogg-au2,#38bdf8);animation:mogg-au2 34s ease-in-out infinite alternate}" +
    ".mogg-backdrop>b:nth-of-type(3){width:58vw;height:58vw;left:22vw;bottom:-34vw;background:var(--mogg-au3,#a78bfa);animation:mogg-au3 40s ease-in-out infinite alternate}" +
    "@keyframes mogg-au1{to{transform:translate(16vw,12vh) scale(1.15)}}" +
    "@keyframes mogg-au2{to{transform:translate(-18vw,14vh) scale(.9)}}" +
    "@keyframes mogg-au3{to{transform:translate(-10vw,-16vh) scale(1.2)}}" +
    "@media (prefers-reduced-motion:reduce){.mogg-backdrop>i,.mogg-backdrop>b{transition:none;animation:none}}";

  // Registered so Vibe Glow can glide between accents instead of snapping.
  const ACCENT_ANIM_CSS =
    '@property --spice-button-active{syntax:"<color>";inherits:true;initial-value:#1ed760}' +
    '@property --spice-button{syntax:"<color>";inherits:true;initial-value:#1db954}' +
    ":root[data-mogg-anim]{transition:--spice-button-active .9s ease,--spice-button .9s ease}" +
    "@media (prefers-reduced-motion:reduce){:root[data-mogg-anim]{transition:none}}";

  const backdrop = {
    node: null, url: "", front: 0,
    mount() {
      if (this.node || !document.body) return;
      this.node = el("div", { class: "mogg-backdrop", "aria-hidden": "true" }, el("i"), el("i"), el("b"), el("b"), el("b"));
      document.body.prepend(this.node);
      this.url = "";
      this.set(Player.data().cover);
    },
    unmount() { if (this.node) { this.node.remove(); this.node = null; this.url = ""; } },
    kind(k) { if (this.node && this.node.dataset.kind !== k) this.node.dataset.kind = k; },
    set(url) {
      if (!this.node || !url || url === this.url) return;
      this.url = url;
      const img = new Image();
      img.onload = () => {
        if (!this.node || this.url !== url) return;
        const layers = this.node.children;
        const next = layers[this.front ^ 1], prev = layers[this.front];
        next.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
        next.classList.add("on"); prev.classList.remove("on");
        this.front ^= 1;
      };
      img.src = url;
    },
  };

  let currentFx = { backdrop: "", soft: false, neon: false, wash: false };
  function renderFlavor() {
    const root = document.documentElement;
    const fx = currentFx;
    const glass = glassOwners.size > 0;
    let css = "";
    if (fx.soft) css += SOFT_CSS;
    if (fx.neon) css += NEON_CSS;
    if (fx.wash) css += WASH_CSS;
    if (glass) css += GLASS_CSS;
    setStyle("flavor", css);
    const tokens = ["soft", "neon", "wash"].filter((k) => fx[k]);
    if (tokens.length) root.setAttribute("data-mogg-fx", tokens.join(" ")); else root.removeAttribute("data-mogg-fx");
    if (glass) {
      root.setAttribute("data-mogg-glass", "");
      backdrop.mount();
      // The Ambient extra always shows cover art; otherwise the design decides.
      backdrop.kind(glassOwners.has("ambient") || fx.backdrop !== "aurora" ? "cover" : "aurora");
    } else { root.removeAttribute("data-mogg-glass"); backdrop.unmount(); }
  }

  function renderDesign() {
    const root = document.documentElement;
    const d = currentDesign();
    const pass = isPassthrough(d);
    const override = accentOverride();
    const c = effectiveColors();
    setStyle("design", pass ? (override ? accentOnlyCSS(override) : "") : paletteCSS(c, d));
    currentFx = fxOf(d);
    const flavor = pass ? "" : (currentFx.backdrop === "cover" ? "glass" : currentFx.backdrop === "aurora" ? "aurora" : currentFx.soft ? "soft" : "");
    if (flavor) root.setAttribute("data-mogg-flavor", flavor); else root.removeAttribute("data-mogg-flavor");
    if (currentFx.backdrop) glassOwners.add("design"); else glassOwners.delete("design");
    renderFlavor();
    if (pass) root.removeAttribute("data-mogg-design"); else root.setAttribute("data-mogg-design", d.id);
    bus.emit("designchange", { design: d, colors: c, accent: override });
    bus.emit("themechange", { theme: d, accent: override });
  }

  // Smooth cross-fade for user-initiated design switches. Spotify turns off
  // view-transition animations globally, so we re-enable them for ours.
  let booted = false;
  function crossfade(fn) {
    const root = document.documentElement;
    if (!booted || reducedMotion() || typeof document.startViewTransition !== "function" || root.hasAttribute("data-transition")) { fn(); return; }
    root.setAttribute("data-mogg-vt", "");
    let t = null;
    try { t = document.startViewTransition(fn); } catch (_) { root.removeAttribute("data-mogg-vt"); fn(); return; }
    const done = () => root.removeAttribute("data-mogg-vt");
    const quiet = () => {};
    // A skipped transition (hidden window, timeout) rejects these; the design
    // itself is applied either way, so there is nothing to report.
    if (t.ready && t.ready.catch) t.ready.catch(quiet);
    if (t.updateCallbackDone && t.updateCallbackDone.catch) t.updateCallbackDone.catch(quiet);
    t.finished.then(done, done);
  }

  const design = {
    list: allDesigns,
    custom: () => state.custom.slice(),
    fx: fxOf,
    generate: generateDesign,
    encode: encodeDesign,
    decode: decodeDesign,
    // Live-try a design without saving it (null ends the preview).
    preview(d) {
      const next = d && d.colors ? d : null;
      if (!next && !previewDesign) return;
      previewDesign = next;
      renderDesign();
    },
    isPreviewing: () => !!previewDesign,
    // Save a Studio design to "Your designs" and switch to it.
    save(d) {
      const keep = d && typeof d.id === "string" && d.id !== "my-draft" && /^my-[a-z0-9]{1,24}$/.test(d.id);
      const clean = sanitizeDesign(Object.assign({}, d, { id: keep ? d.id : "my-" + Date.now().toString(36) }));
      if (!clean) return null;
      const i = state.custom.findIndex((x) => x.id === clean.id);
      if (i >= 0) state.custom[i] = clean;
      else { if (state.custom.length >= MAX_CUSTOM) return null; state.custom.push(clean); }
      previewDesign = null;
      state.design = clean.id;
      state.accent = ""; // show the new design with its own accent
      saveState();
      crossfade(renderDesign);
      return clean;
    },
    remove(id) {
      const i = state.custom.findIndex((x) => x.id === id);
      if (i < 0) return false;
      state.custom.splice(i, 1);
      if (state.design === id) state.design = DESIGNS[0].id;
      saveState();
      renderDesign();
      return true;
    },
    get: designById,
    current: currentDesign,
    colors: effectiveColors,
    colorsOf,
    isPassthrough,
    accent: () => (Color.valid(state.accent) ? state.accent : ""),
    set(id, opts) {
      const d = designById(id);
      if (!d) return false;
      if (d.id === state.design && designById(state.design) && !previewDesign) return true;
      previewDesign = null;
      state.design = d.id; saveState();
      if (opts && opts.animate === false) renderDesign(); else crossfade(renderDesign);
      return true;
    },
    setAccent(hex, opts) {
      const v = Color.valid(hex) ? Color.norm(hex) : "";
      state.accent = v;
      if (!opts || opts.persist !== false) saveState();
      renderDesign();
    },
    setDynamicAccent(hex) {
      const v = Color.valid(hex) ? Color.norm(hex) : null;
      if (v === dynamicAccent) return;
      dynamicAccent = v;
      const root = document.documentElement;
      if (booted && !reducedMotion()) {
        root.setAttribute("data-mogg-anim", "");
        clearTimeout(design._animT);
        design._animT = setTimeout(() => root.removeAttribute("data-mogg-anim"), 1100);
      }
      renderDesign();
      bus.emit("accentchange", v);
    },
    glass(owner, on) {
      const before = glassOwners.size;
      if (on) glassOwners.add(String(owner)); else glassOwners.delete(String(owner));
      if (glassOwners.size !== before || String(owner) === "ambient") renderFlavor();
    },
    isGlass: () => glassOwners.size > 0,
    css: (d) => (isPassthrough(d) ? "" : paletteCSS(colorsOf(d), d)),
  };
  // Legacy names used by older extras.
  const themeApi = Object.assign({}, design);

  /* ------------------------------------------------------------------ */
  /* Webpack / Platform access                                           */
  /* ------------------------------------------------------------------ */

  const webpack = {
    require: null,
    _cache: new Map(),
    ready() { return !!this.require; },
    find(filter, { all = false } = {}) {
      const req = this.require;
      if (!req || !req.m) return all ? [] : null;
      const hits = [];
      for (const id of Object.keys(req.m)) {
        let exp;
        try { exp = req(id); } catch (_) { continue; }
        if (!exp) continue;
        const candidates = [exp];
        if (typeof exp === "object") for (const k in exp) { try { candidates.push(exp[k]); } catch (_) {} }
        for (const c of candidates) {
          try { if (c && filter(c)) { if (!all) return c; hits.push(c); } } catch (_) {}
        }
      }
      return all ? hits : null;
    },
    cached(name, filter) {
      if (this._cache.has(name)) return this._cache.get(name);
      const v = this.find(filter);
      if (v) this._cache.set(name, v);
      return v;
    },
  };
  for (const g of ["rspackChunk", "webpackChunkclient_web"]) {
    try { (self[g] = self[g] || []).push([[Symbol("moggtify")], {}, (r) => { if (!webpack.require) webpack.require = r; }]); } catch (_) {}
  }

  let Platform = null;
  const spice = () => window.Spicetify || null;
  async function discoverPlatform() {
    for (let i = 0; i < 120 && !Platform; i++) {
      const S = spice();
      if (S && S.Platform && (S.Platform.PlayerAPI || typeof S.Platform.getPlayerAPI === "function")) Platform = S.Platform;
      if (Platform) break;
      await sleep(500);
    }
    if (Platform) { M.Platform = Platform; bus.emit("platform", Platform); }
  }
  const playerAPI = () => {
    if (!Platform) return null;
    try { return typeof Platform.getPlayerAPI === "function" ? Platform.getPlayerAPI() : Platform.PlayerAPI || null; } catch (_) { return null; }
  };
  const playbackAPI = () => {
    if (!Platform) return null;
    try { return typeof Platform.getPlaybackAPI === "function" ? Platform.getPlaybackAPI() : Platform.PlaybackAPI || null; } catch (_) { return null; }
  };

  /* ------------------------------------------------------------------ */
  /* Player – Spicetify.Player first, DOM data-testids as the fallback   */
  /* ------------------------------------------------------------------ */

  const SEL = {
    widget: '[data-testid="now-playing-widget"]',
    title: '[data-testid="context-item-info-title"]',
    subtitles: '[data-testid="context-item-info-subtitles"]',
    artist: '[data-testid="context-item-info-artist"]',
    playpause: '[data-testid="control-button-playpause"]',
    next: '[data-testid="control-button-skip-forward"]',
    prev: '[data-testid="control-button-skip-back"]',
    position: '[data-testid="playback-position"]',
    duration: '[data-testid="playback-duration"]',
    volume: '[data-testid="volume-bar"] input[type="range"]',
    nowPlayingBar: '[data-testid="now-playing-bar"]',
    cover: '[data-testid="cover-art-image"]',
  };

  const parseTime = (s) => {
    if (!s) return 0;
    return String(s).trim().split(":").reduce((acc, p) => acc * 60 + (parseInt(p, 10) || 0), 0) * 1000;
  };
  function toHttpImage(url) {
    if (!url) return "";
    const m = /^spotify:image:([a-f0-9]+)$/i.exec(url);
    return m ? "https://i.scdn.co/image/" + m[1] : url;
  }
  // i.scdn.co sizes: 4851 = 64px, 1e02 = 300px, b273 = 640px
  const upscaleCover = (url) => (url ? url.replace(/ab67616d0000(4851|1e02)/, "ab67616d0000b273") : "");
  const largest = (imgs) => (imgs || []).slice().sort((a, b) => (b.width || b.height || 0) - (a.width || a.height || 0))[0];

  const spicePlayer = () => { const S = spice(); return S && S.Player ? S.Player : null; };

  function fromSpicetify(SP) {
    const d = SP.data;
    if (!d || !d.item) return null;
    const it = d.item, md = it.metadata || {};
    const artists = Array.isArray(it.artists) && it.artists.length ? it.artists.map((a) => a && a.name).filter(Boolean).join(", ") : "";
    let cover = md.image_xlarge_url || md.image_large_url || md.image_url || "";
    if (!cover) { const img = largest(it.images || (it.album && it.album.images)); cover = img ? img.url : ""; }
    let position = 0;
    try { position = typeof SP.getProgress === "function" ? SP.getProgress() : 0; } catch (_) {}
    if (!position && typeof d.positionAsOfTimestamp === "number") position = d.positionAsOfTimestamp + (d.isPaused ? 0 : Date.now() - (d.timestamp || Date.now()));
    return {
      title: it.name || md.title || "",
      artist: artists || md.artist_name || "",
      album: md.album_title || (it.album && it.album.name) || "",
      cover: toHttpImage(cover),
      isPlaying: !d.isPaused,
      position: Math.max(0, position || 0),
      duration: (it.duration && it.duration.milliseconds) || d.duration || parseInt(md.duration, 10) || 0,
      uri: it.uri || "",
    };
  }

  function readPlatform() {
    const api = playerAPI();
    if (!api || typeof api.getState !== "function") return null;
    try {
      const s = api.getState();
      if (!s || !s.item) return null;
      const it = s.item;
      const img = largest(it.images || (it.metadata && [{ url: it.metadata.image_xlarge_url || it.metadata.image_large_url || it.metadata.image_url }]));
      const elapsed = s.isPaused ? 0 : Date.now() - (s.timestamp || Date.now());
      return {
        title: it.name || "",
        artist: (it.artists || []).map((a) => a.name).join(", "),
        album: (it.album && it.album.name) || "",
        cover: img ? toHttpImage(img.url) : "",
        isPlaying: !s.isPaused,
        position: Math.max(0, (s.positionAsOfTimestamp || 0) + elapsed),
        duration: (it.duration && it.duration.milliseconds) || 0,
        uri: it.uri || "",
      };
    } catch (_) { return null; }
  }

  function readDom() {
    const w = $(SEL.widget);
    const title = ($(SEL.title) || {}).textContent || "";
    const artists = $$(SEL.artist);
    const artist = artists.length ? artists.map((a) => a.textContent.trim()).join(", ") : (($(SEL.subtitles) || {}).textContent || "").trim();
    const img = w && (w.querySelector('img[data-testid="cover-art-image"]') || w.querySelector("img"));
    const pp = $(SEL.playpause);
    const label = (pp && pp.getAttribute("aria-label")) || "";
    return {
      title: title.trim(), artist, album: "",
      cover: upscaleCover(img ? img.currentSrc || img.src : ""),
      isPlaying: /paus/i.test(label),
      position: parseTime(($(SEL.position) || {}).textContent),
      duration: parseTime(($(SEL.duration) || {}).textContent),
      uri: "",
    };
  }

  function clickDom(sel) { const b = $(sel); if (b && !b.disabled) { b.click(); return true; } return false; }
  function setRangeValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const tryCall = (fn) => { try { fn(); return true; } catch (_) { return false; } };

  const Player = {
    data() {
      const SP = spicePlayer();
      let d = null;
      if (SP && SP.data) { try { d = fromSpicetify(SP); } catch (_) { d = null; } }
      if (!d) d = readPlatform();
      if (!d) return readDom();
      if (!d.cover) { const dom = readDom(); if (dom.cover) d.cover = dom.cover; }
      return d;
    },
    toggle() {
      const SP = spicePlayer();
      if (SP && typeof SP.togglePlay === "function" && tryCall(() => SP.togglePlay())) return;
      const api = playerAPI();
      if (api && tryCall(() => (api.getState().isPaused ? api.resume() : api.pause()))) return;
      clickDom(SEL.playpause);
    },
    next() {
      const SP = spicePlayer();
      if (SP && typeof SP.next === "function" && tryCall(() => SP.next())) return;
      const api = playerAPI();
      if (api && tryCall(() => api.skipToNext())) return;
      clickDom(SEL.next);
    },
    prev() {
      const SP = spicePlayer();
      if (SP && typeof SP.back === "function" && tryCall(() => SP.back())) return;
      const api = playerAPI();
      if (api && tryCall(() => api.skipToPrevious())) return;
      clickDom(SEL.prev);
    },
    seek(ms) {
      const SP = spicePlayer();
      if (SP && typeof SP.seek === "function" && tryCall(() => SP.seek(ms))) return;
      const api = playerAPI();
      if (api) tryCall(() => api.seekTo(ms));
    },
    getVolume() {
      const SP = spicePlayer();
      try { if (SP && typeof SP.getVolume === "function") { const v = SP.getVolume(); if (typeof v === "number" && !Number.isNaN(v)) return v; } } catch (_) {}
      try { const pb = playbackAPI(); if (pb) { const v = typeof pb.getVolume === "function" ? pb.getVolume() : pb._volume; if (typeof v === "number") return v; } } catch (_) {}
      const input = $(SEL.volume);
      if (!input) return null;
      return parseFloat(input.value) / (parseFloat(input.max) || 1);
    },
    setVolume(v) {
      v = Math.max(0, Math.min(1, v));
      const SP = spicePlayer();
      if (SP && typeof SP.setVolume === "function" && tryCall(() => SP.setVolume(v))) return;
      const pb = playbackAPI();
      if (pb && typeof pb.setVolume === "function" && tryCall(() => pb.setVolume(v))) return;
      const input = $(SEL.volume);
      if (input) setRangeValue(input, v * (parseFloat(input.max) || 1));
    },
  };

  let lastKey = "";
  let lastPlaying = null;
  let lastData = null;
  function checkPlayer() {
    const d = Player.data();
    lastData = d;
    const key = d.uri || d.title + "|" + d.artist;
    if (d.title && key !== lastKey) { lastKey = key; bus.emit("songchange", d); }
    if (d.title && d.isPlaying !== lastPlaying) { lastPlaying = d.isPlaying; bus.emit("playpause", d); }
    bus.emit("tick", d);
    if (backdrop.node && d.cover) backdrop.set(d.cover);
    return d;
  }
  // Apply the design right away – this still runs before Spotify's UI paints.
  setStyle("anim", ACCENT_ANIM_CSS);
  renderDesign();

  async function bindSpicetifyPlayer() {
    for (let i = 0; i < 200; i++) {
      const SP = spicePlayer();
      if (SP && typeof SP.addEventListener === "function") {
        try {
          SP.addEventListener("songchange", () => setTimeout(checkPlayer, 0));
          SP.addEventListener("onplaypause", () => setTimeout(checkPlayer, 0));
        } catch (e) { warn("player events", e); }
        return;
      }
      await sleep(300);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Hotkeys                                                             */
  /* ------------------------------------------------------------------ */

  const hotkeys = [];
  const normalizeCombo = (combo) => combo.toLowerCase().split("+").map((s) => s.trim()).sort().join("+");
  function comboOf(e) {
    const parts = [];
    if (e.ctrlKey) parts.push("ctrl");
    if (e.shiftKey) parts.push("shift");
    if (e.altKey) parts.push("alt");
    if (e.metaKey) parts.push("meta");
    const k = String(e.key || "").toLowerCase();
    if (!["control", "shift", "alt", "meta"].includes(k)) parts.push(k === " " ? "space" : k);
    return parts.sort().join("+");
  }
  function hotkey(combo, fn, { allowInInputs = false } = {}) {
    const entry = { combo: normalizeCombo(combo), fn, allowInInputs };
    hotkeys.push(entry);
    return () => { const i = hotkeys.indexOf(entry); if (i >= 0) hotkeys.splice(i, 1); };
  }
  window.addEventListener("keydown", (e) => {
    if (!e.key) return;
    const c = comboOf(e);
    const t = e.target;
    const typing = t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName || ""));
    for (const h of hotkeys.slice().reverse()) {
      if (h.combo !== c) continue;
      if (typing && !h.allowInInputs) continue;
      let handled = true;
      try { handled = h.fn(e) !== false; } catch (err) { warn("hotkey", err); }
      if (handled) { e.preventDefault(); e.stopPropagation(); return; }
    }
  }, true);

  /* ------------------------------------------------------------------ */
  /* Toast                                                               */
  /* ------------------------------------------------------------------ */

  let toastWrap = null;
  function toast(message, ms = 2400) {
    const S = spice();
    if (S && typeof S.showNotification === "function" && tryCall(() => S.showNotification(String(message), false, ms))) return;
    if (!document.body) return;
    if (!toastWrap || !toastWrap.isConnected) {
      toastWrap = el("div", { class: "mogg-ui mogg-toast-wrap", role: "status", "aria-live": "polite" });
      document.body.appendChild(toastWrap);
    }
    const t = el("div", { class: "mogg-toast" }, String(message));
    toastWrap.appendChild(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 220); }, ms);
  }

  /* ------------------------------------------------------------------ */
  /* Extras (Moggtify's own add-ons)                                     */
  /* ------------------------------------------------------------------ */

  const registry = new Map(); // id -> { def, running, ctx }
  let started = false;

  function makeContext(id) {
    const disposers = [];
    return {
      id,
      M,
      Player,
      settings: { get: (k, f) => settings.get(id, k, f), set: (k, v) => settings.set(id, k, v) },
      on(evt, fn) { const off = bus.on(evt, fn); disposers.push(off); return off; },
      hotkey(combo, fn, opts) { const off = hotkey(combo, fn, opts); disposers.push(off); return off; },
      style(css) { setStyle("ext:" + id, css); disposers.push(() => setStyle("ext:" + id, "")); },
      interval(fn, ms) { const h = setInterval(fn, ms); disposers.push(() => clearInterval(h)); return h; },
      onDispose(fn) { disposers.push(fn); },
      _dispose() { while (disposers.length) { try { disposers.pop()(); } catch (e) { warn(e); } } },
    };
  }
  function startExt(entry) {
    if (entry.running) return;
    const ctx = makeContext(entry.def.id);
    try {
      const ret = entry.def.start && entry.def.start(ctx);
      if (typeof ret === "function") ctx.onDispose(ret);
      entry.ctx = ctx; entry.running = true;
    } catch (e) { warn("extra", entry.def.id, "failed to start", e); ctx._dispose(); }
  }
  function stopExt(entry) {
    if (!entry.running) return;
    try { if (entry.def.stop) entry.def.stop(); } catch (e) { warn(e); }
    if (entry.ctx) entry.ctx._dispose();
    entry.ctx = null; entry.running = false;
  }
  function isEnabled(id) {
    if (has(state.extras, id)) return !!state.extras[id];
    if (CFG.extras && has(CFG.extras, id)) return !!CFG.extras[id];
    const meta = EXTRAS.find((m) => m.id === id);
    return meta ? !!meta.default : true; // unknown (custom) extras default on
  }
  function setExtraEnabled(id, on) {
    state.extras[id] = !!on; saveState();
    const entry = registry.get(id);
    if (entry && started) (on ? startExt : stopExt)(entry);
    bus.emit("extrachange", { id, on: !!on });
  }
  function extension(def) {
    if (!def || !def.id) throw new Error("extension needs an id");
    if (registry.has(def.id)) stopExt(registry.get(def.id));
    const entry = { def, running: false, ctx: null };
    registry.set(def.id, entry);
    if (started && isEnabled(def.id)) startExt(entry);
    return entry;
  }

  /* ------------------------------------------------------------------ */
  /* Top-bar button (next to the profile picture)                        */
  /* ------------------------------------------------------------------ */

  const CLUSTER = ".main-globalNav-contentRight > .main-actionButtons, .main-actionButtons";
  const Topbar = {
    btn: null, node: null, cluster: null, obs: null, since: Date.now(),
    ensure() {
      const S = spice();
      if (!this.btn && S && S.Topbar && typeof S.Topbar.Button === "function") {
        try {
          const b = new S.Topbar.Button("Moggtify", ICON_TOPBAR, () => hub.toggle(), false, true);
          if (this.node && this.node !== b.element) this.node.remove(); // retire the fallback
          this.btn = b;
          this.node = b.element;
          this.decorate(this.node, b.button || this.node.querySelector("button"));
        } catch (e) { warn("topbar button", e); }
      }
      // No Spicetify.Topbar after a while → our own equivalent button.
      if (!this.node && Date.now() - this.since > 4000) this.node = this.fallback();
      if (this.node) this.place();
      for (const n of $$('[data-moggtify="topbar"]')) if (n !== this.node) n.remove();
    },
    decorate(node, button) {
      node.dataset.moggtify = "topbar";
      node.classList.add("mogg-topbar");
      if (button) {
        button.setAttribute("aria-haspopup", "dialog");
        button.setAttribute("aria-expanded", String(hub.isOpen()));
        if (!button.getAttribute("title") && !(spice() && spice().Tippy)) button.setAttribute("title", "Moggtify");
      }
    },
    fallback() {
      const like = $(".main-actionButtons .main-actionButtons-button") || $(".main-actionButtons button");
      const button = el("button", {
        type: "button", class: like ? like.className : "mogg-topbar-fallback",
        "aria-label": "Moggtify", title: "Moggtify", html: ICON_TOPBAR, onclick: () => hub.toggle(),
      });
      const node = el("div", { class: "spicetify-topbar-button" }, button);
      this.decorate(node, button);
      return node;
    },
    // Last element of the action-button cluster = directly left of the avatar.
    place() {
      const node = this.node;
      const cluster = $(CLUSTER);
      if (cluster) {
        if (node.parentNode !== cluster || cluster.lastElementChild !== node) cluster.appendChild(node);
        this.watch(cluster);
        return;
      }
      const avatar = $('[data-testid="user-widget-link"]');
      if (!avatar) return;
      let box = avatar;
      while (box.parentElement && box.parentElement !== document.body && box.parentElement.childElementCount === 1) box = box.parentElement;
      if (box.parentElement && node.nextElementSibling !== box) box.parentElement.insertBefore(node, box);
    },
    // Spicetify re-prepends its buttons on every navigation and React may
    // re-render the cluster; move ours back before the next paint.
    watch(cluster) {
      if (this.cluster === cluster || typeof MutationObserver !== "function") return;
      if (this.obs) this.obs.disconnect();
      this.cluster = cluster;
      let moves = 0, windowStart = Date.now();
      this.obs = new MutationObserver(() => {
        const node = this.node;
        if (!node || !cluster.isConnected || (node.parentNode === cluster && cluster.lastElementChild === node)) return;
        // Never fight another script that also wants the last slot.
        if (Date.now() - windowStart > 2000) { windowStart = Date.now(); moves = 0; }
        if (++moves > 12) { this.obs.disconnect(); return; }
        cluster.appendChild(node);
      });
      this.obs.observe(cluster, { childList: true });
    },
    setActive(on) {
      if (!this.node) return;
      this.node.classList.toggle("mogg-on", !!on);
      const b = this.node.querySelector("button");
      if (b) b.setAttribute("aria-expanded", String(!!on));
    },
    button() { const b = this.node && this.node.querySelector("button"); return b && b.isConnected ? b : null; },
  };

  /* ------------------------------------------------------------------ */
  /* The Moggtify Hub                                                    */
  /* ------------------------------------------------------------------ */

  const ACCENTS = [
    ["Spotify green", "#1ed760"], ["Mint", "#6ff0a3"], ["Sky", "#38bdf8"], ["Violet", "#a78bfa"],
    ["Pink", "#f472b6"], ["Ember", "#ff7a45"], ["Gold", "#f5c451"], ["Cherry", "#f43f5e"], ["White", "#ffffff"],
  ];

  const BG_PRESETS = [
    ["Graphite", "#121212"], ["Void", "#000000"], ["Midnight", "#0b1020"], ["Ocean", "#06161a"],
    ["Forest", "#0c160d"], ["Plum", "#170f20"], ["Wine", "#1c0c10"], ["Espresso", "#19110b"],
  ];

  function designPreview(d, big) {
    const c = colorsOf(d), fx = fxOf(d);
    const veil = !!fx.backdrop;
    const au = auroraOf(d, c);
    const fxbg = fx.backdrop === "aurora"
      ? `radial-gradient(circle at 16% 12%,${Color.alpha(au[0], 0.75)},transparent 50%),radial-gradient(circle at 90% 34%,${Color.alpha(au[1], 0.65)},transparent 52%),radial-gradient(circle at 46% 104%,${Color.alpha(au[2], 0.65)},transparent 56%)`
      : fx.backdrop === "cover"
        ? `radial-gradient(circle at 22% 18%,${Color.alpha(c.accent, 0.65)},transparent 52%),radial-gradient(circle at 86% 88%,${Color.alpha(Color.mix(c.accent, "#ffffff", 0.35), 0.45)},transparent 55%)`
        : "none";
    const vars = {
      "--f": c.frame, "--b": veil ? Color.alpha(c.base, 0.5) : c.base, "--h": c.highlight, "--e": c.elevated,
      "--t": c.text, "--s": c.subdued, "--a": c.accent, "--an": Color.alpha(c.accent, 0.5),
      "--g": Color.mix(c.base, c.accent, fx.wash ? 0.55 : 0.34), "--r": fx.soft ? "7px" : "3px", "--fx": fxbg,
    };
    const cls = "mogg-pv" + (veil ? " glass" : "") + (fx.soft ? " soft" : "") + (fx.neon ? " neon" : "") + (big ? " xl" : "");
    const row = () => el("i", { class: "pv-row" }, el("i"), el("i"));
    return el("span", { class: cls, style: Object.entries(vars).map(([k, v]) => k + ":" + v).join(";"), "aria-hidden": "true" },
      el("i", { class: "pv-top" }, el("i", { class: "pv-search" }), el("i", { class: "pv-av" })),
      el("i", { class: "pv-lib" }, row(), row(), row(), row()),
      el("i", { class: "pv-main" }, el("i", { class: "pv-title" }), el("i", { class: "pv-cards" }, el("i"), el("i"), el("i"))),
      el("i", { class: "pv-bar" }, el("i", { class: "pv-cov" }), el("i", { class: "pv-prog" }, el("i")), el("i", { class: "pv-play" })));
  }

  // At most two tags: whose it is / what makes it special.
  function designTags(d) {
    if (isPassthrough(d)) return [el("span", { class: "mogg-tag" }, "Default")];
    const fx = fxOf(d), tags = [];
    if (d.custom) tags.push(el("span", { class: "mogg-tag yours" }, "Yours"));
    const kind = fx.backdrop === "aurora" ? "Aurora" : fx.backdrop === "cover" ? "Glass" : fx.neon ? "Neon" : fx.wash ? "Wash" : fx.soft ? "Soft" : "";
    if (kind) tags.push(el("span", { class: "mogg-tag" }, kind));
    return tags;
  }

  const FILTERS = [
    ["all", "All", () => true],
    ["calm", "Calm", (d) => { const f = fxOf(d); return !f.backdrop && !f.neon; }],
    ["glass", "Glass", (d) => fxOf(d).backdrop === "cover"],
    ["aurora", "Aurora", (d) => fxOf(d).backdrop === "aurora"],
    ["neon", "Neon", (d) => fxOf(d).neon],
    ["yours", "Yours", (d) => !!d.custom],
  ];

  function copyText(text) {
    const S = spice();
    try { if (S && S.Platform && S.Platform.ClipboardAPI && typeof S.Platform.ClipboardAPI.copy === "function") { S.Platform.ClipboardAPI.copy(text); return true; } } catch (_) {}
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).catch(() => {}); return true; } } catch (_) {}
    try {
      const ta = el("textarea", { style: { position: "fixed", opacity: "0" } });
      ta.value = text; document.body.append(ta); ta.select();
      const ok = document.execCommand("copy"); ta.remove();
      return ok;
    } catch (_) { return false; }
  }

  function renderDesignsTab() {
    let filter = settings.get("hub", "filter", "all");
    if (!FILTERS.some((f) => f[0] === filter)) filter = "all";
    const cards = new Map();
    const grid = el("div", { class: "mogg-designs" });
    const filterRow = el("div", { class: "mogg-filters", role: "group", "aria-label": "Filter designs" });
    const empty = el("p", { class: "mogg-empty", hidden: true }, "Nothing here yet. Make your first design in the Studio.");

    function buildFilters() {
      filterRow.textContent = "";
      for (const [id, label] of FILTERS) {
        if (id === "yours" && !state.custom.length && filter !== "yours") continue;
        filterRow.append(el("button", { type: "button", class: "mogg-chip", "aria-pressed": String(filter === id), onclick: () => { filter = id; settings.set("hub", "filter", id); buildFilters(); buildGrid(); update(); } }, label));
      }
    }
    function buildGrid() {
      grid.textContent = "";
      cards.clear();
      const test = (FILTERS.find((f) => f[0] === filter) || FILTERS[0])[2];
      const list = allDesigns().filter((d) => test(d));
      for (const d of list) {
        const btn = el("button", { type: "button", class: "mogg-design", "aria-pressed": "false", title: d.description || d.name || d.id, onclick: () => design.set(d.id) },
          designPreview(d),
          el("span", { class: "mogg-design-meta" },
            el("span", { class: "nm" }, el("span", { class: "label" }, d.name || d.id), designTags(d)),
            el("span", { class: "ds" }, d.description || "")),
          el("span", { class: "mogg-check", html: ICONS.check }));
        cards.set(d.id, btn);
        const wrap = el("div", { class: "mogg-design-wrap" }, btn);
        if (d.custom) {
          wrap.append(el("button", { type: "button", class: "mogg-design-del", "aria-label": "Delete " + (d.name || "design"), title: "Delete this design", html: ICONS.trash,
            onclick: () => { if (design.remove(d.id)) { toast("Deleted “" + (d.name || "design") + "”"); buildFilters(); buildGrid(); update(); } } }));
        }
        grid.append(wrap);
      }
      empty.hidden = list.length > 0;
    }

    const swatches = new Map();
    const defDot = el("i");
    const defBtn = el("button", { type: "button", class: "mogg-sw-default", "aria-pressed": "true", onclick: () => design.setAccent("") }, defDot, "Design default");
    const row = el("div", { class: "mogg-swatches", role: "group", "aria-label": "Accent color" }, defBtn, el("span", { class: "mogg-sep", "aria-hidden": "true" }));
    for (const [name, hex] of ACCENTS) {
      const b = el("button", { type: "button", class: "mogg-sw", style: "--c:" + hex, title: name, "aria-label": name + " accent", "aria-pressed": "false", onclick: () => design.setAccent(hex) });
      swatches.set(hex, b);
      row.append(b);
    }
    const picker = el("input", { type: "color", "aria-label": "Custom accent color", value: "#1ed760" });
    picker.addEventListener("input", () => design.setAccent(picker.value, { persist: false }));
    picker.addEventListener("change", () => design.setAccent(picker.value));
    const custom = el("span", { class: "mogg-sw custom", title: "Custom color" }, picker, el("span", { class: "plus", html: ICONS.plus }));
    row.append(custom);
    const vibeNote = el("p", { class: "mogg-inline-note" });

    const node = el("div", null,
      filterRow, grid, empty,
      el("div", { class: "mogg-hero", style: "margin-top:22px" },
        el("span", { class: "mogg-hero-ico", html: ICONS.studio }),
        el("div", { class: "txt" }, el("h3", null, "Make your own"), el("p", null, "Pick a background and an accent – the Studio builds the rest, readable by design.")),
        el("button", { type: "button", class: "mogg-btn primary", onclick: () => hub.select("studio", { focus: true }) }, "Open Studio", el("span", { class: "i", html: ICONS.arrow }))),
      el("section", { class: "mogg-sec" },
        el("div", { class: "mogg-sec-head" }, el("div", null, el("h3", null, "Accent"), el("p", null, "Give any design your own highlight color."))),
        vibeNote, row),
      el("div", { class: "mogg-note" }, el("span", { html: ICONS.info }),
        el("p", null, el("b", null, "Using a Marketplace theme? "), "Marketplace themes and Moggtify designs both recolor Spotify. Pick ",
          el("b", null, (DESIGNS[0] && DESIGNS[0].name) || "Spotify"), " here so they don't fight.")));

    function update() {
      const cur = currentDesign();
      for (const [id, b] of cards) b.setAttribute("aria-pressed", String(cur.id === id));
      const acc = Color.valid(state.accent) ? Color.norm(state.accent) : "";
      defBtn.setAttribute("aria-pressed", String(!acc));
      defDot.style.background = colorsOf(cur).accent;
      let matched = false;
      for (const [hex, b] of swatches) { const on = acc === Color.norm(hex); matched = matched || on; b.setAttribute("aria-pressed", String(on)); }
      const isCustom = !!acc && !matched;
      custom.classList.toggle("on", isCustom);
      custom.style.setProperty("--c", isCustom ? acc : "");
      if (acc && picker.value !== acc) picker.value = acc;
      const vibe = isEnabled("vibe");
      vibeNote.hidden = !vibe;
      vibeNote.textContent = vibe ? "Vibe Glow is on, so the accent follows the cover art. Your pick comes back when you turn it off." : "";
    }
    buildFilters();
    buildGrid();
    update();
    return { node, update };
  }

  /* ---- Design Studio: make your own design ---- */

  function renderStudioTab() {
    const saved = settings.get("studio", "draft", null) || {};
    const draft = {
      name: cleanName(saved.name, ""),
      bg: Color.valid(saved.bg) ? Color.norm(saved.bg) : "#0b1020",
      accent: Color.valid(saved.accent) ? Color.norm(saved.accent) : "#a78bfa",
      flavor: cleanFlavor(saved.flavor),
      effects: cleanEffects(saved.effects),
    };
    let live = settings.get("studio", "live", true) !== false;
    const current = () => generateDesign(Object.assign({}, draft, { name: draft.name || "My design" }), "my-draft");

    const previewBox = el("div", { class: "mogg-studio-pv" });
    const facts = el("div", { class: "mogg-studio-facts" });
    const codeField = el("input", { class: "mogg-input mogg-code", type: "text", readonly: true, "aria-label": "Share code", onfocus: (e) => e.target.select() });

    // -- color control: presets + hue slider + hex field
    function colorControl(label, key, presets, hueToHex) {
      const chips = new Map();
      const rowEl = el("div", { class: "mogg-swatches", role: "group", "aria-label": label });
      for (const [name, hex] of presets) {
        const b = el("button", { type: "button", class: "mogg-sw", style: "--c:" + hex, title: name, "aria-label": name, "aria-pressed": "false", onclick: () => { draft[key] = Color.norm(hex); sync(); } });
        chips.set(Color.norm(hex), b);
        rowEl.append(b);
      }
      const hex = el("input", { class: "mogg-input mogg-hex", type: "text", maxlength: "7", spellcheck: "false", "aria-label": label + " hex color" });
      const commit = () => { const v = hex.value.trim(); const full = v[0] === "#" ? v : "#" + v; if (Color.valid(full)) { draft[key] = Color.norm(full); sync(); } else hex.value = draft[key]; };
      hex.addEventListener("change", commit);
      hex.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } });
      rowEl.append(hex);
      const hue = el("input", { class: "mogg-hue", type: "range", min: "0", max: "359", step: "1", "aria-label": label + " hue" });
      hue.addEventListener("input", () => { draft[key] = hueToHex(Number(hue.value) / 360); sync(); });
      const field = el("div", { class: "mogg-field" }, el("span", { class: "lbl" }, label), rowEl, hue);
      return { field, update() {
        for (const [h, b] of chips) b.setAttribute("aria-pressed", String(h === draft[key]));
        if (document.activeElement !== hex) hex.value = draft[key];
        if (document.activeElement !== hue) hue.value = String(Math.round(Color.hsl(draft[key]).h * 359));
      } };
    }
    const bgCtl = colorControl("Background", "bg", BG_PRESETS, (h) => Color.hslToHex({ h, s: 0.42, l: 0.085 }));
    const acCtl = colorControl("Accent", "accent", ACCENTS, (h) => Color.hslToHex({ h, s: 0.9, l: 0.64 }));

    // -- style + effects
    const flavorBtns = [["flat", "Solid"], ["glass", "Glass"], ["aurora", "Aurora"]].map(([id, label]) =>
      el("button", { type: "button", class: "mogg-chip", "data-v": id, "aria-pressed": "false", onclick: () => { draft.flavor = id; sync(); } }, label));
    const effectBtns = [["soft", "Soft corners"], ["neon", "Neon glow"], ["wash", "Color wash"]].map(([id, label]) =>
      el("button", { type: "button", class: "mogg-chip", "data-v": id, "aria-pressed": "false", onclick: () => {
        draft.effects = draft.effects.includes(id) ? draft.effects.filter((x) => x !== id) : cleanEffects(draft.effects.concat(id)); sync();
      } }, label));

    const nameInput = el("input", { class: "mogg-input", type: "text", maxlength: "28", placeholder: "My design", "aria-label": "Design name", style: "margin-top:0" });
    nameInput.value = draft.name;
    nameInput.addEventListener("input", () => { draft.name = nameInput.value; persist(); refreshCode(); });

    const liveSwitch = el("button", { type: "button", class: "mogg-switch", role: "switch", "aria-checked": String(live), "aria-label": "Preview in Spotify while editing",
      onclick: () => { live = !live; settings.set("studio", "live", live); liveSwitch.setAttribute("aria-checked", String(live)); if (live) design.preview(current()); else design.preview(null); } });

    const importInput = el("input", { class: "mogg-input mogg-code", type: "text", placeholder: "Paste a share code (mogg:…)", "aria-label": "Share code to import", style: "margin-top:0;flex:1;min-width:0" });
    const doImport = () => {
      const got = decodeDesign(importInput.value);
      if (!got) { toast("That code doesn't look right."); return; }
      Object.assign(draft, got);
      nameInput.value = draft.name;
      importInput.value = "";
      sync();
      toast("Design loaded – tweak it or save it.");
    };
    importInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doImport(); } });

    function persist() { settings.set("studio", "draft", { name: draft.name, bg: draft.bg, accent: draft.accent, flavor: draft.flavor, effects: draft.effects.slice() }); }
    function refreshCode() { codeField.value = encodeDesign(current()); }
    function sync() {
      persist();
      const d = current();
      previewBox.textContent = "";
      previewBox.append(designPreview(d, true));
      const c = d.colors;
      facts.textContent = "";
      facts.append(el("span", null, "Text ", el("b", null, Color.contrast(c.text, c.base).toFixed(1) + " : 1")),
        el("span", null, "Accent ", el("b", null, Color.contrast(c.accent, c.base).toFixed(1) + " : 1")),
        el("span", null, "Always readable"));
      bgCtl.update(); acCtl.update();
      for (const b of flavorBtns) b.setAttribute("aria-pressed", String(b.dataset.v === draft.flavor));
      for (const b of effectBtns) b.setAttribute("aria-pressed", String(draft.effects.includes(b.dataset.v)));
      refreshCode();
      if (live) design.preview(d);
    }

    const remix = () => {
      const cur = designById(state.design) || DESIGNS[0];
      const c = colorsOf(cur), fx = fxOf(cur);
      draft.bg = cur.src ? cur.src.bg : c.base;
      draft.accent = cur.src ? cur.src.accent : c.accent;
      draft.flavor = fx.backdrop === "cover" ? "glass" : fx.backdrop === "aurora" ? "aurora" : "flat";
      draft.effects = EFFECTS.filter((e) => fx[e]);
      draft.name = cleanName((cur.name || "Design") + " remix", "My design");
      nameInput.value = draft.name;
      sync();
    };
    const surprise = () => {
      const h = Math.random();
      draft.bg = Color.hslToHex({ h, s: 0.25 + Math.random() * 0.3, l: 0.05 + Math.random() * 0.05 });
      draft.accent = Color.hslToHex({ h: (h + 0.33 + Math.random() * 0.34) % 1, s: 0.8 + Math.random() * 0.2, l: 0.6 + Math.random() * 0.1 });
      draft.flavor = FLAVORS[Math.floor(Math.random() * FLAVORS.length)];
      draft.effects = EFFECTS.filter(() => Math.random() < 0.35);
      sync();
    };
    const save = () => {
      const made = design.save(Object.assign(current(), { id: undefined, name: draft.name || "My design " + (state.custom.length + 1) }));
      if (!made) { toast(state.custom.length >= MAX_CUSTOM ? "You already have " + MAX_CUSTOM + " designs – delete one first." : "Couldn't save this design."); return; }
      toast("Saved “" + made.name + "” to your designs");
      draft.name = ""; persist();
      settings.set("hub", "filter", "all");
      hub.select("designs", { focus: true });
    };

    const node = el("div", { class: "mogg-studio" },
      el("div", { class: "mogg-studio-main" },
        bgCtl.field, acCtl.field,
        el("div", { class: "mogg-field" }, el("span", { class: "lbl" }, "Style"), el("div", { class: "mogg-chips", role: "group", "aria-label": "Style" }, flavorBtns)),
        el("div", { class: "mogg-field" }, el("span", { class: "lbl" }, "Effects"), el("div", { class: "mogg-chips", role: "group", "aria-label": "Effects" }, effectBtns)),
        el("div", { class: "mogg-field" }, el("span", { class: "lbl" }, "Start from"),
          el("div", { class: "mogg-chips" },
            el("button", { type: "button", class: "mogg-btn", onclick: remix }, el("span", { class: "i", html: ICONS.remix }), "Current design"),
            el("button", { type: "button", class: "mogg-btn", onclick: surprise }, el("span", { class: "i", html: ICONS.dice }), "Surprise me"))),
        el("div", { class: "mogg-field" }, el("span", { class: "lbl" }, "Import"),
          el("div", { class: "mogg-studio-row" }, importInput, el("button", { type: "button", class: "mogg-btn", onclick: doImport }, "Load")))),
      el("div", { class: "mogg-studio-side" },
        previewBox, facts,
        el("div", { class: "mogg-field", style: "margin:8px 0 0" }, el("span", { class: "lbl" }, "Name"), nameInput),
        el("div", { class: "mogg-row", style: "margin-top:4px" }, el("p", null, "Preview in Spotify while editing"), liveSwitch),
        el("button", { type: "button", class: "mogg-btn primary", style: "width:100%;margin-top:6px", onclick: save }, "Save design", el("span", { class: "i", html: ICONS.check })),
        el("div", { class: "mogg-field", style: "margin:14px 0 0" }, el("span", { class: "lbl" }, "Share code"),
          el("div", { class: "mogg-studio-row" }, el("div", { style: "flex:1;min-width:0" }, codeField),
            el("button", { type: "button", class: "mogg-btn", "aria-label": "Copy share code", onclick: () => toast(copyText(codeField.value) ? "Share code copied" : "Select the code and press Ctrl+C") }, el("span", { class: "i", html: ICONS.copy }), "Copy")))));
    codeField.style.marginTop = "0";
    sync();
    return { node, update() {}, dispose() { design.preview(null); } };
  }

  function renderSection(s) {
    try { return s.render({ el, settings, state, M, hub, Player, icons: ICONS }) || null; } catch (e) { warn("hub section", e); return null; }
  }

  function renderExtrasTab() {
    const rows = new Map();
    const list = el("div", { class: "mogg-list" });
    for (const meta of EXTRAS) {
      const nameId = "mogg-x-" + meta.id;
      const sw = el("button", { type: "button", role: "switch", class: "mogg-switch", "aria-checked": "false", "aria-labelledby": nameId, onclick: () => setExtraEnabled(meta.id, !isEnabled(meta.id)) });
      const sub = el("div", { class: "mogg-item-sub", hidden: true });
      const item = el("div", { class: "mogg-item" },
        el("span", { class: "mogg-ico", html: ICONS[meta.icon] || ICONS.sparkle }),
        el("div", { class: "txt" },
          el("div", { class: "nm" }, el("span", { id: nameId }, meta.name || meta.id), meta.hotkey ? el("kbd", null, meta.hotkey) : null),
          el("div", { class: "ds" }, meta.description || "")),
        sw);
      const wrap = el("div", { class: "mogg-item-wrap" }, item, sub);
      rows.set(meta.id, { sw, sub, wrap, on: null, n: -1 });
      list.append(wrap);
    }
    const loose = el("div", { class: "mogg-sections" });
    function update() {
      for (const [id, r] of rows) {
        const on = isEnabled(id);
        const mine = hub.sections.filter((s) => s.extra === id);
        r.sw.setAttribute("aria-checked", String(on));
        r.wrap.classList.toggle("on", on);
        if (r.on !== on || r.n !== mine.length) {
          r.on = on; r.n = mine.length;
          r.sub.textContent = "";
          if (on) for (const s of mine) { const n = renderSection(s); if (n) r.sub.append(n); }
          r.sub.hidden = !r.sub.childElementCount;
        }
      }
      loose.textContent = "";
      for (const s of hub.sections) if (!s.extra && s.tab === "extras") { const n = renderSection(s); if (n) loose.append(n); }
    }
    update();
    return { node: el("div", null, EXTRAS.length ? list : el("p", { class: "mogg-empty" }, "No extras in this build."), loose), update };
  }

  function openMarketplace() {
    const S = spice();
    const H = S && S.Platform && S.Platform.History;
    hub.close();
    if (H && typeof H.push === "function" && tryCall(() => H.push("/marketplace"))) return;
    toast("The Marketplace isn't available right now. Run Repair in the Moggtify app.");
  }

  function catalogCard(it) {
    return el("div", { class: "mogg-card" },
      el("span", { class: "mogg-ico", html: ICONS[it.icon] || ICONS.app }),
      el("div", { class: "txt" },
        el("div", { class: "nm" }, it.name || it.id),
        it.description ? el("div", { class: "ds" }, it.description) : null,
        it.tip ? el("div", { class: "mogg-tip" }, el("span", { html: ICONS.tip }), el("span", null, it.tip)) : null));
  }

  function renderInstalledTab() {
    const exts = Array.isArray(CFG.extensions) ? CFG.extensions : [];
    const apps = Array.isArray(CFG.apps) ? CFG.apps : [];
    const group = (title, items) => el("section", { class: "mogg-sec" },
      el("div", { class: "mogg-sec-head" }, el("h3", null, title, el("span", null, String(items.length)))),
      items.length ? el("div", { class: "mogg-cards" }, items.map(catalogCard)) : el("p", { class: "mogg-empty" }, "Nothing here yet."));
    const node = el("div", null,
      el("div", { class: "mogg-hero" },
        el("span", { class: "mogg-hero-ico", html: ICONS.store }),
        el("div", { class: "txt" },
          el("h3", null, "Marketplace"),
          el("p", null, "Community themes, extensions, snippets and apps. Browse and install them right inside Spotify.")),
        el("button", { type: "button", class: "mogg-btn primary", onclick: openMarketplace }, "Open Marketplace", el("span", { class: "i", html: ICONS.arrow }))),
      group("Extensions", exts),
      group("Apps", apps));
    return { node };
  }

  function renderAboutTab() {
    const S = spice();
    const engine = S && S.Config && S.Config.version ? "Spicetify " + S.Config.version : "Spicetify";
    const repo = typeof CFG.repo === "string" && /^https:\/\//.test(CFG.repo) ? CFG.repo : "";
    const fact = (label, ...value) => el("div", { class: "mogg-fact" }, el("dt", null, label), el("dd", null, ...value));
    const link = (href, text) => el("a", { class: "mogg-link", href, target: "_blank", rel: "noopener noreferrer" }, text, el("span", { class: "i", html: ICONS.external }));
    const node = el("div", null,
      el("div", { class: "mogg-about" },
        el("span", { class: "mogg-badge xl", html: ICONS.m }),
        el("div", null, el("div", { class: "mogg-word xl" }, "moggtify", el("i", null, ".")), el("p", null, "Spotify, unlocked."))),
      el("dl", { class: "mogg-facts" },
        fact("Version", (CFG.version || VERSION)),
        fact("Open the hub", el("kbd", null, "Ctrl"), el("kbd", null, "Shift"), el("kbd", null, "M")),
        fact("Source", repo ? link(repo, repo.replace(/^https:\/\/(www\.)?/, "")) : "Open source")),
      el("div", { class: "mogg-help" },
        el("div", { class: "mogg-card" }, el("span", { class: "mogg-ico", html: ICONS.wrench }),
          el("div", { class: "txt" }, el("div", { class: "nm" }, "Moggtify gone after a Spotify update?"),
            el("div", { class: "ds" }, "Open the Moggtify app from the Start menu and click ", el("b", null, "Repair"), ". It re-applies everything and restarts Spotify."))),
        el("div", { class: "mogg-card" }, el("span", { class: "mogg-ico", html: ICONS.trash }),
          el("div", { class: "txt" }, el("div", { class: "nm" }, "Want plain Spotify back?"),
            el("div", { class: "ds" }, "Open the Moggtify app and choose ", el("b", null, "Remove Moggtify"), ". Spotify goes back to exactly how it was.")))),
      el("p", { class: "mogg-fine" }, "Not affiliated with Spotify."));
    return { node };
  }

  const TABS = [
    { id: "designs", label: "Designs", icon: ICONS.designs, title: "Designs", sub: "Recolor Spotify in one click. Changes apply live and stay after restarts.", render: renderDesignsTab },
    { id: "studio", label: "Studio", icon: ICONS.studio, title: "Design Studio", sub: "Mix your own design. Two colors are enough – Moggtify builds the rest.", render: renderStudioTab },
    { id: "extras", label: "Extras", icon: ICONS.extras, title: "Extras", sub: "Small upgrades that run inside Spotify. Switch them on or off any time.", render: renderExtrasTab },
    { id: "installed", label: "Installed", icon: ICONS.installed, title: "Installed", sub: "What Moggtify set up in Spotify, and where to find it.", render: renderInstalledTab },
    { id: "about", label: "About", icon: ICONS.about, title: "About", sub: "Version, source and help.", render: renderAboutTab },
  ];

  const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

  const hub = {
    root: null, dialog: null, panel: null, titleEl: null, subEl: null, tabButtons: [],
    tab: null, current: null, lastFocus: null, sections: [], closeTimer: 0,
    isOpen() { return !!this.root && this.root.dataset.state !== "closing"; },
    toggle(tab) { if (this.isOpen()) this.close(); else this.open(tab); },
    open(tab) {
      if (this.root && this.root.dataset.state === "closing") this.destroy();
      if (this.root) { if (tab) this.select(tab, { focus: true }); return; }
      if (!document.body) return;
      setStyle("ui", UI_CSS);
      const active = document.activeElement;
      this.lastFocus = active && active !== document.body ? active : null;
      this.build();
      this.select(tab || this.tab || (() => { try { return localStorage.getItem(TAB_KEY); } catch (_) { return null; } })() || "designs");
      document.body.appendChild(this.root);
      void this.root.offsetWidth; // commit the closed state so the open state animates
      this.root.dataset.state = "open";
      Topbar.setActive(true);
      this.focusTab();
      bus.emit("hubopen", this.tab);
    },
    close() {
      const root = this.root;
      if (!root || root.dataset.state === "closing") return;
      root.dataset.state = "closing";
      this.leave();
      Topbar.setActive(false);
      clearTimeout(this.closeTimer);
      this.closeTimer = setTimeout(() => { if (this.root === root) this.destroy(); }, reducedMotion() ? 0 : 200);
      const f = this.lastFocus;
      this.lastFocus = null;
      const target = f && f.isConnected && typeof f.focus === "function" ? f : Topbar.button();
      if (target) { try { target.focus({ preventScroll: true }); } catch (_) {} }
      bus.emit("hubclose");
    },
    leave() {
      const v = this.current;
      this.current = null;
      if (v && typeof v.dispose === "function") { try { v.dispose(); } catch (e) { warn("hub dispose", e); } }
    },
    destroy() {
      this.leave();
      if (this.root) this.root.remove();
      this.root = this.dialog = this.panel = this.titleEl = this.subEl = this.current = null;
      this.tabButtons = [];
    },
    build() {
      this.tabButtons = TABS.map((t) => el("button", {
        type: "button", role: "tab", id: "mogg-tab-" + t.id, class: "mogg-tab", "data-tab": t.id,
        "aria-controls": "mogg-hub-panel", "aria-selected": "false", tabindex: "-1",
        onclick: () => this.select(t.id),
      }, el("span", { class: "i", html: t.icon }), el("span", { class: "label" }, t.label)));
      const S = spice();
      const engine = S && S.Config && S.Config.version ? "Spicetify " + S.Config.version : "Spicetify";
      this.titleEl = el("h2", { id: "mogg-hub-title" });
      this.subEl = el("p");
      this.panel = el("div", { class: "mogg-scroll", id: "mogg-hub-panel", role: "tabpanel", tabindex: "-1" });
      this.dialog = el("div", { class: "mogg-hub", role: "dialog", "aria-modal": "true", "aria-label": "Moggtify Hub" },
        el("aside", { class: "mogg-rail" },
          el("div", { class: "mogg-brand" },
            el("span", { class: "mogg-badge", html: ICONS.m }),
            el("div", { class: "brand-txt" }, el("div", { class: "mogg-word" }, "moggtify", el("i", null, ".")), el("small", null, "Hub · v" + (CFG.version || VERSION)))),
          el("div", { class: "mogg-tabs", role: "tablist", "aria-orientation": "vertical", "aria-label": "Moggtify sections" }, this.tabButtons),
          el("div", { class: "mogg-rail-foot" },
            el("div", { class: "mogg-status" }, el("i", { "aria-hidden": "true" }), el("span", null, "Active")),
            el("div", { class: "mogg-keys", "aria-label": "Shortcut Control Shift M" }, el("kbd", null, "Ctrl"), el("kbd", null, "Shift"), el("kbd", null, "M")))),
        el("section", { class: "mogg-main" },
          el("header", { class: "mogg-head" },
            el("div", { class: "txt" }, this.titleEl, this.subEl),
            el("button", { type: "button", class: "mogg-x", "aria-label": "Close Moggtify", title: "Close (Esc)", html: ICONS.close, onclick: () => this.close() })),
          this.panel));
      this.root = el("div", { class: "mogg-ui mogg-hub-root", "data-state": "" },
        el("div", { class: "mogg-hub-scrim", onclick: () => this.close() }),
        this.dialog);
      this.root.addEventListener("keydown", (e) => this.onKey(e));
    },
    select(id, opts) {
      const t = TABS.find((x) => x.id === id) || TABS[0];
      this.tab = t.id;
      try { localStorage.setItem(TAB_KEY, t.id); } catch (_) {}
      if (!this.root) return;
      for (const b of this.tabButtons) {
        const on = b.dataset.tab === t.id;
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
      }
      this.titleEl.textContent = t.title;
      this.subEl.textContent = t.sub;
      this.panel.setAttribute("aria-labelledby", "mogg-tab-" + t.id);
      this.leave();
      let view;
      try { view = t.render(); } catch (e) { warn("hub tab", t.id, e); view = { node: el("p", { class: "mogg-empty" }, "This section failed to load.") }; }
      this.current = view;
      this.panel.textContent = "";
      this.panel.append(el("div", { class: "mogg-pane" }, view.node));
      this.panel.scrollTop = 0;
      if (opts && opts.focus) this.focusTab();
    },
    focusTab() {
      const b = this.tabButtons.find((x) => x.getAttribute("aria-selected") === "true");
      if (b) { try { b.focus({ preventScroll: true }); } catch (_) {} }
    },
    refresh() { if (this.current && this.current.update) { try { this.current.update(); } catch (e) { warn("hub refresh", e); } } },
    onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(); return; }
      if (e.key === "Tab" && this.dialog) {
        const f = $$(FOCUSABLE, this.dialog).filter((n) => n.getClientRects().length && n.tabIndex >= 0);
        if (f.length) {
          const first = f[0], last = f[f.length - 1];
          if (e.shiftKey && (document.activeElement === first || !this.dialog.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && (document.activeElement === last || !this.dialog.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
        }
      }
      const tabBtn = e.target && e.target.closest && e.target.closest(".mogg-tab");
      if (tabBtn && ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        const i = TABS.findIndex((t) => t.id === tabBtn.dataset.tab);
        const n = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + TABS.length) % TABS.length;
        this.select(TABS[n].id, { focus: true });
      }
      // Keep Spotify's own keyboard shortcuts out while the hub has focus.
      e.stopPropagation();
    },
    addSection(def) {
      if (typeof def === "function") def = { render: def };
      if (!def || typeof def.render !== "function") return () => {};
      const s = Object.assign({ tab: "extras" }, def);
      this.sections.push(s);
      this.refresh();
      return () => { const i = this.sections.indexOf(s); if (i >= 0) this.sections.splice(i, 1); this.refresh(); };
    },
  };
  bus.on("designchange", () => hub.refresh());
  bus.on("extrachange", () => hub.refresh());

  /* ------------------------------------------------------------------ */
  /* UI styles                                                           */
  /* ------------------------------------------------------------------ */

  const UI_CSS = `
.mogg-topbar.mogg-on>button,.mogg-topbar>button[aria-expanded="true"]{color:var(--spice-button-active,#1ed760)!important}
.mogg-topbar svg{display:block;pointer-events:none}
.mogg-topbar-fallback{all:unset;box-sizing:border-box;cursor:pointer;width:32px;height:32px;border-radius:50%;display:inline-grid;place-items:center;color:var(--text-subdued,#b3b3b3);transition:color .15s ease,transform .15s ease}
.mogg-topbar-fallback:hover{color:var(--text-base,#fff);transform:scale(1.04)}
.mogg-topbar-fallback:focus-visible{outline:2px solid var(--spice-button-active,#1ed760);outline-offset:2px}
html[data-mogg-vt]::view-transition-old(root){animation:mogg-vt-out .3s cubic-bezier(.4,0,.2,1) both!important}
html[data-mogg-vt]::view-transition-new(root){animation:mogg-vt-in .3s cubic-bezier(.4,0,.2,1) both!important}
@keyframes mogg-vt-out{to{opacity:0}}
@keyframes mogg-vt-in{from{opacity:0}}

.mogg-ui,.mogg-ui *,.mogg-ui *::before,.mogg-ui *::after{box-sizing:border-box}
.mogg-toast-wrap{position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:2147483000;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;font-family:var(--encore-body-font-stack,system-ui,sans-serif)}
.mogg-toast{background:var(--spice-notification,#4687d6);color:#fff;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600;box-shadow:0 12px 32px rgba(0,0,0,.45);animation:mogg-toast-in .22s cubic-bezier(.2,.8,.2,1)}
.mogg-toast.out{opacity:0;transform:translateY(4px);transition:opacity .2s ease,transform .2s ease}
@keyframes mogg-toast-in{from{opacity:0;transform:translateY(6px)}}

.mogg-hub-root{position:fixed;inset:0;z-index:2147482500;display:grid;place-items:center;
--mh-text:var(--spice-text,#fff);--mh-sub:var(--spice-subtext,#b3b3b3);--mh-frame:var(--spice-sidebar,#000);--mh-base:var(--spice-main,#121212);
--mh-rgb:var(--spice-rgb-text,255,255,255);--mh-line:rgba(var(--mh-rgb),.08);--mh-fill:rgba(var(--mh-rgb),.05);--mh-fill2:rgba(var(--mh-rgb),.09);--mh-fill3:rgba(var(--mh-rgb),.15);
--mh-accent:var(--spice-button-active,#1ed760);--mh-accent-rgb:var(--spice-rgb-button-active,30,215,96);--mh-on-accent:var(--mogg-accent-text,#000);
--mh-ease:cubic-bezier(.2,.8,.2,1);
font-family:var(--encore-body-font-stack,"SpotifyMixUI","CircularSp",system-ui,"Segoe UI",sans-serif);font-size:14px;line-height:1.4;font-weight:400;letter-spacing:normal;text-transform:none;color:var(--mh-text);-webkit-font-smoothing:antialiased;text-align:start}
.mogg-hub-root[data-state="closing"]{pointer-events:none}
.mogg-hub-root h2,.mogg-hub-root h3,.mogg-hub-root p,.mogg-hub-root dl,.mogg-hub-root dd{margin:0}
.mogg-hub-scrim{position:absolute;inset:0;background:rgba(0,0,0,.5);opacity:0;transition:opacity .22s ease}
.mogg-hub-root[data-state="open"]>.mogg-hub-scrim{opacity:1}
.mogg-hub-root[data-state="closing"]>.mogg-hub-scrim{transition-duration:.18s}
.mogg-hub{position:relative;display:grid;grid-template-columns:216px minmax(0,1fr);gap:8px;padding:8px;width:min(960px,calc(100vw - 48px));height:min(640px,calc(100vh - 80px));border-radius:18px;background:var(--mh-frame);
box-shadow:0 0 0 1px var(--mh-line),0 40px 100px -24px rgba(0,0,0,.85),0 0 160px -60px rgba(var(--mh-accent-rgb),.5);
opacity:0;transform:translateY(14px) scale(.985);transition:opacity .24s var(--mh-ease),transform .36s var(--mh-ease)}
.mogg-hub-root[data-state="open"]>.mogg-hub{opacity:1;transform:none}
.mogg-hub-root[data-state="closing"]>.mogg-hub{opacity:0;transform:translateY(8px) scale(.99);transition:opacity .15s ease-in,transform .18s ease-in}
.mogg-hub :focus{outline:none}
.mogg-hub :focus-visible{outline:2px solid var(--mh-accent);outline-offset:2px}

.mogg-rail{display:flex;flex-direction:column;min-height:0;padding:12px 4px 6px}
.mogg-brand{display:flex;align-items:center;gap:12px;padding:6px 10px 22px}
.mogg-badge{position:relative;flex:none;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;color:#02130a;
background:linear-gradient(150deg,#8af6bb 0%,#1ed760 50%,#0f8f3f 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.5),inset 0 -1px 0 rgba(0,0,0,.18),0 8px 22px -8px rgba(30,215,96,.8)}
.mogg-badge svg{width:62%;height:62%;stroke-width:3.3}
.mogg-badge.xl{width:68px;height:68px;border-radius:20px;box-shadow:inset 0 1px 0 rgba(255,255,255,.5),inset 0 -2px 0 rgba(0,0,0,.18),0 18px 44px -14px rgba(30,215,96,.85)}
.mogg-word{font-size:19px;font-weight:800;letter-spacing:-.04em;line-height:1;color:var(--mh-text);white-space:nowrap}
.mogg-word i{font-style:normal;color:#1ed760}
.mogg-word.xl{font-size:36px}
.mogg-brand small{display:block;margin-top:5px;font-size:11.5px;font-weight:600;color:var(--mh-sub)}
.mogg-tabs{display:flex;flex-direction:column;gap:2px}
.mogg-tab{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:14px;height:44px;padding:0 12px;border-radius:8px;color:var(--mh-sub);font-size:14.5px;font-weight:700;transition:color .15s ease,background-color .15s ease}
.mogg-tab .i{display:grid;place-items:center;width:22px;height:22px;flex:none;transition:color .15s ease}
.mogg-tab svg{width:22px;height:22px}
.mogg-tab:hover{color:var(--mh-text)}
.mogg-tab[aria-selected="true"]{color:var(--mh-text);background:var(--mh-fill2)}
.mogg-tab[aria-selected="true"] .i{color:var(--mh-accent)}
.mogg-rail-foot{margin-top:auto;display:grid;gap:10px;padding:14px 12px 8px;font-size:12px;color:var(--mh-sub)}
.mogg-status{display:flex;align-items:center;gap:8px;font-weight:600}
.mogg-status i{flex:none;width:7px;height:7px;border-radius:50%;background:#1ed760;box-shadow:0 0 0 3px rgba(30,215,96,.18),0 0 10px rgba(30,215,96,.6)}
.mogg-keys{display:flex;align-items:center;gap:4px}
.mogg-hub kbd{display:inline-block;font:700 11px/1 var(--encore-body-font-stack,system-ui,sans-serif);padding:4px 6px;border-radius:5px;background:var(--mh-fill2);color:var(--mh-text);box-shadow:inset 0 -1px 0 rgba(0,0,0,.3)}

.mogg-main{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;border-radius:12px;background:var(--mh-base);overflow:hidden;isolation:isolate}
.mogg-main::before{content:"";position:absolute;z-index:-1;left:-22%;right:-22%;top:-372px;height:460px;border-radius:50%;border-bottom:1px solid rgba(var(--mh-accent-rgb),.34);box-shadow:0 24px 70px -26px rgba(var(--mh-accent-rgb),.5);pointer-events:none}
.mogg-main::after{content:"";position:absolute;z-index:-1;inset:0 0 auto;height:200px;background:radial-gradient(70% 100% at 50% 0%,rgba(var(--mh-accent-rgb),.11),transparent 72%);pointer-events:none}
.mogg-head{display:flex;align-items:flex-start;gap:16px;padding:26px 24px 16px 28px}
.mogg-head .txt{flex:1;min-width:0}
.mogg-head h2{font-family:var(--encore-title-font-stack,inherit);font-size:28px;font-weight:800;letter-spacing:-.035em;line-height:1.1;color:var(--mh-text)}
.mogg-head p{margin-top:7px;font-size:14px;color:var(--mh-sub)}
.mogg-x{all:unset;box-sizing:border-box;cursor:pointer;flex:none;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;color:var(--mh-sub);background:var(--mh-fill);transition:color .15s ease,background-color .15s ease,transform .15s var(--mh-ease)}
.mogg-x svg{width:16px;height:16px}
.mogg-x:hover{color:var(--mh-text);background:var(--mh-fill2);transform:scale(1.06)}
.mogg-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:6px 28px 28px;scrollbar-width:thin;scrollbar-color:rgba(var(--mh-rgb),.22) transparent}
.mogg-scroll:focus-visible{outline:none}
.mogg-pane{animation:mogg-pane .28s var(--mh-ease) both}
@keyframes mogg-pane{from{opacity:0;transform:translateY(6px)}}

.mogg-designs{display:grid;grid-template-columns:repeat(auto-fill,minmax(186px,1fr));gap:14px}
.mogg-design{all:unset;box-sizing:border-box;cursor:pointer;position:relative;display:flex;flex-direction:column;min-width:0;padding:8px 8px 12px;border-radius:12px;background:var(--mh-fill);transition:background-color .18s ease,transform .22s var(--mh-ease),box-shadow .22s ease}
.mogg-design:hover{background:var(--mh-fill2);transform:translateY(-2px)}
.mogg-design:active{transform:translateY(0) scale(.99)}
.mogg-design[aria-pressed="true"]{background:var(--mh-fill2);box-shadow:0 0 0 2px var(--mh-accent),0 14px 34px -16px rgba(var(--mh-accent-rgb),.75)}
.mogg-design:focus-visible{outline-offset:3px}
.mogg-design-meta{display:block;padding:10px 4px 0;min-width:0}
.mogg-design .nm{display:flex;align-items:center;gap:7px;font-size:14.5px;font-weight:700;color:var(--mh-text);min-width:0}
.mogg-design .nm .label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mogg-design .ds{display:block;margin-top:3px;font-size:12.5px;color:var(--mh-sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mogg-tag{flex:none;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:3px 6px 2px;border-radius:99px;background:var(--mh-fill2);color:var(--mh-sub);line-height:1}
.mogg-check{position:absolute;top:14px;right:14px;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:var(--mh-accent);color:var(--mh-on-accent);box-shadow:0 4px 14px rgba(0,0,0,.45);opacity:0;transform:scale(.4);transition:opacity .15s ease,transform .3s cubic-bezier(.34,1.56,.64,1)}
.mogg-check svg{width:14px;height:14px}
.mogg-design[aria-pressed="true"] .mogg-check{opacity:1;transform:none}

.mogg-pv{position:relative;display:grid;grid-template-columns:30% 1fr;grid-template-rows:11px 1fr 15px;gap:3px;height:112px;padding:5px;border-radius:8px;overflow:hidden;isolation:isolate;background:var(--fx),var(--f);box-shadow:inset 0 0 0 1px rgba(255,255,255,.04)}
.mogg-pv i{display:block;font-style:normal}
.mogg-pv .pv-top{grid-column:1/-1;display:flex;align-items:center;gap:4px;padding:0 3px}
.mogg-pv .pv-search{width:38%;height:7px;margin-left:24%;border-radius:99px;background:var(--h)}
.mogg-pv .pv-av{width:7px;height:7px;margin-left:auto;border-radius:50%;background:var(--s);opacity:.8}
.mogg-pv .pv-lib{display:flex;flex-direction:column;gap:5px;padding:7px 6px;border-radius:var(--r);background:var(--b)}
.mogg-pv .pv-row{display:flex;align-items:center;gap:4px}
.mogg-pv .pv-row i:first-child{flex:none;width:9px;height:9px;border-radius:2px;background:var(--e)}
.mogg-pv .pv-row i:last-child{flex:1;height:3px;border-radius:2px;background:var(--s);opacity:.55}
.mogg-pv .pv-row:first-child i:first-child{background:var(--a)}
.mogg-pv .pv-main{display:flex;flex-direction:column;gap:6px;padding:8px 7px 7px;border-radius:var(--r);background:linear-gradient(180deg,var(--g) 0%,var(--b) 70%)}
.mogg-pv.glass .pv-main{background:linear-gradient(180deg,rgba(255,255,255,.07) 0%,var(--b) 70%)}
.mogg-pv .pv-title{width:46%;height:6px;border-radius:3px;background:var(--t)}
.mogg-pv .pv-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-top:auto}
.mogg-pv .pv-cards i{aspect-ratio:1/1;border-radius:calc(var(--r) - 1px);background:var(--e)}
.mogg-pv .pv-cards i:first-child{background:linear-gradient(135deg,var(--a),var(--e))}
.mogg-pv .pv-bar{grid-column:1/-1;display:flex;align-items:center;gap:7px;padding:0 4px}
.mogg-pv .pv-cov{flex:none;width:10px;height:10px;border-radius:2px;background:var(--e)}
.mogg-pv .pv-prog{flex:1;height:3px;border-radius:2px;background:var(--h);overflow:hidden}
.mogg-pv .pv-prog i{width:42%;height:100%;border-radius:2px;background:var(--a)}
.mogg-pv .pv-play{flex:none;width:10px;height:10px;border-radius:50%;background:var(--t)}

.mogg-pv.neon .pv-lib,.mogg-pv.neon .pv-main{box-shadow:0 0 0 1px var(--an),0 0 9px -2px var(--a)}
.mogg-pv.neon .pv-play{background:var(--a);box-shadow:0 0 7px var(--a)}
.mogg-pv.xl{zoom:1.9}
.mogg-filters{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}
.mogg-design-wrap{position:relative;display:flex;min-width:0}
.mogg-design-wrap>.mogg-design{flex:1}
.mogg-design-del{all:unset;box-sizing:border-box;cursor:pointer;position:absolute;top:14px;left:14px;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:rgba(0,0,0,.62);color:#fff;opacity:0;transform:scale(.8);transition:opacity .15s ease,transform .2s var(--mh-ease),background-color .15s ease}
.mogg-design-wrap:hover .mogg-design-del,.mogg-design-del:focus-visible{opacity:1;transform:none}
.mogg-design-del:hover{background:#e22134}
.mogg-design-del svg{width:14px;height:14px}
.mogg-tag.yours{background:rgba(var(--mh-accent-rgb),.18);color:var(--mh-accent)}
.mogg-empty[hidden]{display:none}

.mogg-studio{display:grid;grid-template-columns:minmax(0,1fr) 318px;gap:26px;align-items:start}
.mogg-studio-side{position:sticky;top:0;display:grid;gap:10px;padding:14px;border-radius:14px;background:var(--mh-fill);box-shadow:inset 0 0 0 1px var(--mh-line)}
.mogg-studio-pv{border-radius:10px;overflow:hidden;box-shadow:0 18px 44px -20px rgba(0,0,0,.8)}
.mogg-studio-facts{display:flex;gap:6px 12px;flex-wrap:wrap;font-size:12px;color:var(--mh-sub)}
.mogg-studio-facts b{color:var(--mh-text);font-weight:700}
.mogg-studio-row{display:flex;gap:8px;align-items:center}
.mogg-field{margin-bottom:22px}
.mogg-field>.lbl{display:block;margin-bottom:10px;font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--mh-sub)}
.mogg-input.mogg-hex{width:92px;height:30px;margin-top:0;padding:0 10px;font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:12.5px}
.mogg-input.mogg-code{font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:12px}
.mogg-studio .mogg-sw{box-shadow:inset 0 0 0 1.5px rgba(var(--mh-rgb),.26)}
.mogg-studio .mogg-sw[aria-pressed="true"]{box-shadow:inset 0 0 0 1.5px rgba(var(--mh-rgb),.26),0 0 0 2px var(--mh-base),0 0 0 4px var(--mh-text)}
.mogg-hue{-webkit-appearance:none;appearance:none;display:block;width:100%;height:12px;margin:14px 0 0;border-radius:99px;background:linear-gradient(90deg,#ff4d4d,#ffd84d,#5dff4d,#4dffe1,#4d7dff,#d44dff,#ff4d4d);cursor:pointer}
.mogg-hue::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 0 0 2px rgba(0,0,0,.35),0 2px 6px rgba(0,0,0,.5);cursor:grab}
.mogg-hue:active::-webkit-slider-thumb{cursor:grabbing;transform:scale(1.1)}

.mogg-sec{margin-top:30px}
.mogg-sec-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:14px}
.mogg-sec h3{font-size:18px;font-weight:800;letter-spacing:-.02em;color:var(--mh-text)}
.mogg-sec h3 span{margin-left:8px;font-size:14px;font-weight:600;color:var(--mh-sub)}
.mogg-sec-head p{margin-top:4px;font-size:13px;color:var(--mh-sub)}
.mogg-inline-note{margin:-4px 0 12px;font-size:12.5px;color:var(--mh-accent)}
.mogg-inline-note[hidden]{display:none}
.mogg-swatches{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.mogg-sep{width:1px;height:22px;margin:0 4px;background:var(--mh-line)}
.mogg-sw{all:unset;box-sizing:border-box;cursor:pointer;position:relative;flex:none;width:30px;height:30px;border-radius:50%;background:var(--c);box-shadow:inset 0 0 0 1px rgba(0,0,0,.28);transition:transform .2s var(--mh-ease),box-shadow .2s ease}
.mogg-sw:hover{transform:scale(1.12)}
.mogg-sw[aria-pressed="true"],.mogg-sw.on{box-shadow:0 0 0 2px var(--mh-base),0 0 0 4px var(--c,var(--mh-text))}
.mogg-sw.custom{display:grid;place-items:center;overflow:visible;background:conic-gradient(from 210deg,#ff5f6d,#ffc371,#f9f871,#6ff0a3,#38bdf8,#a78bfa,#f472b6,#ff5f6d)}
.mogg-sw.custom.on{background:var(--c)}
.mogg-sw.custom input{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;border-radius:50%;opacity:0;cursor:pointer}
.mogg-sw.custom .plus{display:grid;place-items:center;width:14px;height:14px;color:#fff;pointer-events:none;filter:drop-shadow(0 1px 1px rgba(0,0,0,.6))}
.mogg-sw.custom .plus svg{width:14px;height:14px}
.mogg-sw.custom:focus-within{outline:2px solid var(--mh-accent);outline-offset:3px}
.mogg-sw-default{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 14px 0 6px;border-radius:99px;background:var(--mh-fill2);color:var(--mh-text);font-size:13px;font-weight:700;transition:background-color .15s ease,box-shadow .2s ease}
.mogg-sw-default:hover{background:var(--mh-fill3)}
.mogg-sw-default i{width:20px;height:20px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.3)}
.mogg-sw-default[aria-pressed="true"]{box-shadow:inset 0 0 0 2px var(--mh-accent)}
.mogg-note{display:flex;gap:12px;align-items:flex-start;margin-top:28px;padding:14px 16px;border-radius:10px;background:var(--mh-fill);box-shadow:inset 0 0 0 1px var(--mh-line);font-size:13px;line-height:1.5;color:var(--mh-sub)}
.mogg-note>span{display:grid;place-items:center;flex:none;width:18px;height:18px;margin-top:1px;color:var(--mh-text)}
.mogg-note svg{width:18px;height:18px}
.mogg-note b{color:var(--mh-text);font-weight:700}

.mogg-list{display:grid;gap:8px}
.mogg-item-wrap{border-radius:12px;background:var(--mh-fill);transition:background-color .2s ease}
.mogg-item-wrap.on{background:var(--mh-fill2)}
.mogg-item{display:flex;align-items:center;gap:14px;padding:14px 16px}
.mogg-ico{flex:none;width:40px;height:40px;border-radius:10px;display:grid;place-items:center;background:var(--mh-fill2);color:var(--mh-sub);transition:color .2s ease,background-color .2s ease}
.mogg-ico svg{width:20px;height:20px}
.mogg-item-wrap.on .mogg-ico{background:rgba(var(--mh-accent-rgb),.16);color:var(--mh-accent)}
.mogg-item .txt,.mogg-card .txt{flex:1;min-width:0}
.mogg-item .nm,.mogg-card .nm{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700;color:var(--mh-text)}
.mogg-item .ds,.mogg-card .ds{margin-top:3px;font-size:13px;line-height:1.45;color:var(--mh-sub)}
.mogg-card .ds b{color:var(--mh-text)}
.mogg-item-sub{padding:2px 16px 16px 70px}
.mogg-item-sub[hidden]{display:none}
.mogg-switch{all:unset;box-sizing:border-box;cursor:pointer;position:relative;flex:none;width:42px;height:24px;border-radius:99px;background:rgba(var(--mh-rgb),.24);transition:background-color .2s ease}
.mogg-switch::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:var(--mh-text);box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform .24s var(--mh-ease),background-color .2s ease}
.mogg-switch:hover{background:rgba(var(--mh-rgb),.32)}
.mogg-switch[aria-checked="true"]{background:var(--mh-accent)}
.mogg-switch[aria-checked="true"]::after{transform:translateX(18px);background:var(--mh-on-accent)}
.mogg-sections:empty{display:none}
.mogg-sub-label{margin:0 0 10px;font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--mh-sub)}
.mogg-chips{display:flex;flex-wrap:wrap;gap:8px}
.mogg-chip{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;border-radius:99px;background:var(--mh-fill2);color:var(--mh-text);font-size:13px;font-weight:600;transition:background-color .15s ease,color .15s ease}
.mogg-chip:hover{background:var(--mh-fill3)}
.mogg-chip[aria-pressed="true"]{background:var(--mh-text);color:var(--mh-base)}
.mogg-input{all:unset;box-sizing:border-box;display:block;width:100%;height:38px;margin-top:12px;padding:0 14px;border-radius:8px;background:var(--mh-fill2);color:var(--mh-text);font-size:13px;box-shadow:inset 0 0 0 1px transparent;transition:box-shadow .15s ease}
.mogg-input::placeholder{color:var(--mh-sub)}
.mogg-input:focus{box-shadow:inset 0 0 0 1px var(--mh-text)}
.mogg-btn{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 16px;border-radius:99px;background:var(--mh-fill2);color:var(--mh-text);font-size:13.5px;font-weight:700;white-space:nowrap;transition:transform .18s var(--mh-ease),background-color .15s ease,filter .15s ease}
.mogg-btn:hover{background:var(--mh-fill3);transform:scale(1.03)}
.mogg-btn:active{transform:scale(.98)}
.mogg-btn .i{display:grid;place-items:center;width:16px;height:16px}
.mogg-btn svg{width:16px;height:16px}
.mogg-btn.primary{height:46px;padding:0 24px;font-size:15px;background:var(--mh-accent);color:var(--mh-on-accent);box-shadow:0 12px 30px -12px rgba(var(--mh-accent-rgb),.9)}
.mogg-btn.primary:hover{background:var(--mh-accent);filter:brightness(1.07)}
.mogg-btn.primary .i{transition:transform .2s var(--mh-ease)}
.mogg-btn.primary:hover .i{transform:translateX(2px)}
.mogg-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.mogg-row p{font-size:13px;color:var(--mh-sub)}
.mogg-empty{padding:18px;border-radius:10px;background:var(--mh-fill);color:var(--mh-sub);font-size:13px}

.mogg-hero{position:relative;display:flex;align-items:center;gap:18px;padding:22px;border-radius:14px;overflow:hidden;isolation:isolate;
background:linear-gradient(115deg,rgba(var(--mh-accent-rgb),.2),rgba(var(--mh-accent-rgb),.05) 55%,var(--mh-fill));box-shadow:inset 0 0 0 1px rgba(var(--mh-accent-rgb),.22)}
.mogg-hero::after{content:"";position:absolute;z-index:-1;right:-70px;top:-90px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle,rgba(var(--mh-accent-rgb),.28),transparent 66%)}
.mogg-hero-ico{flex:none;width:56px;height:56px;border-radius:14px;display:grid;place-items:center;background:var(--mh-accent);color:var(--mh-on-accent);box-shadow:0 12px 30px -12px rgba(var(--mh-accent-rgb),.95)}
.mogg-hero-ico svg{width:28px;height:28px}
.mogg-hero .txt{flex:1;min-width:0}
.mogg-hero h3{font-size:20px;font-weight:800;letter-spacing:-.025em;color:var(--mh-text)}
.mogg-hero p{margin-top:4px;font-size:13.5px;line-height:1.45;color:var(--mh-sub)}
.mogg-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:8px}
.mogg-card{display:flex;gap:14px;padding:14px 16px;border-radius:12px;background:var(--mh-fill)}
.mogg-card .nm{font-size:14.5px}
.mogg-tip{display:flex;gap:7px;align-items:flex-start;margin-top:9px;font-size:12.5px;line-height:1.4;color:var(--mh-text)}
.mogg-tip>span:first-child{display:grid;place-items:center;flex:none;width:14px;height:14px;margin-top:1px;color:var(--mh-accent)}
.mogg-tip svg{width:14px;height:14px}

.mogg-about{display:flex;align-items:center;gap:20px;padding:4px 0 6px}
.mogg-about p{margin-top:8px;font-size:14px;color:var(--mh-sub)}
.mogg-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:24px}
.mogg-fact{padding:14px 16px;border-radius:12px;background:var(--mh-fill);min-width:0}
.mogg-fact dt{font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--mh-sub)}
.mogg-fact dd{display:flex;align-items:center;gap:4px;min-width:0;margin-top:7px;font-size:15px;font-weight:700;color:var(--mh-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mogg-link{display:inline-flex;align-items:center;gap:5px;min-width:0;color:var(--mh-text);text-decoration:none;border-bottom:1px solid rgba(var(--mh-rgb),.28);transition:border-color .15s ease,color .15s ease}
.mogg-link:hover{border-color:var(--mh-accent);color:var(--mh-accent)}
.mogg-link .i{display:grid;place-items:center;flex:none;width:13px;height:13px}
.mogg-link svg{width:13px;height:13px}
.mogg-help{display:grid;gap:8px;margin-top:8px}
.mogg-fine{margin-top:22px;font-size:12.5px;color:var(--mh-sub)}
.mogg-fine .mogg-link{color:var(--mh-sub)}

@media (max-width:860px){
.mogg-hub{grid-template-columns:60px minmax(0,1fr)}
.mogg-brand{justify-content:center;padding:6px 0 22px}
.mogg-brand .brand-txt,.mogg-tab .label,.mogg-rail-foot{display:none}
.mogg-tab{justify-content:center;padding:0}
.mogg-head{padding:22px 20px 14px 22px}
.mogg-scroll{padding:4px 22px 22px}
.mogg-facts{grid-template-columns:minmax(0,1fr)}
.mogg-studio{grid-template-columns:minmax(0,1fr)}
.mogg-studio-side{position:static;order:-1}
}
@media (prefers-reduced-motion:reduce){
.mogg-hub,.mogg-hub-scrim,.mogg-design,.mogg-switch::after,.mogg-check,.mogg-sw,.mogg-btn{transition:none!important}
.mogg-pane,.mogg-toast{animation:none!important}
.mogg-hub{transform:none!important}
}`;

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  const M = {
    version: VERSION,
    config: CFG,
    Platform: null,
    webpack,
    Player,
    design,
    theme: themeApi,
    Color,
    icons: ICONS,
    settings,
    on: bus.on,
    emit: bus.emit,
    toast,
    hotkey,
    el,
    $, $$,
    style: setStyle,
    extension,
    isEnabled,
    setExtraEnabled,
    setExtensionEnabled: setExtraEnabled,
    hub: {
      open: (tab) => hub.open(tab),
      close: () => hub.close(),
      toggle: (tab) => hub.toggle(tab),
      isOpen: () => hub.isOpen(),
      tab: () => hub.tab,
      addSection: (def) => hub.addSection(def),
      refresh: () => hub.refresh(),
    },
    panel: {
      open: () => hub.open("extras"),
      close: () => hub.close(),
      toggle: () => hub.toggle("extras"),
      addSection: (fn) => hub.addSection({ tab: "extras", render: fn }),
    },
    topbar: { element: () => Topbar.node, ensure: () => Topbar.ensure() },
    player: { last: () => lastData, check: checkPlayer },
    sleep,
    booted: false,
    get React() { return (spice() && spice().React) || webpack.cached("React", (e) => typeof e.createElement === "function" && typeof e.useState === "function"); },
    get ReactDOM() { return (spice() && spice().ReactDOM) || webpack.cached("ReactDOM", (e) => typeof e.createRoot === "function" || (typeof e.createPortal === "function" && typeof e.render === "function")); },
  };
  window.Moggtify = M;

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  async function boot() {
    watchHead();
    setStyle("ui", UI_CSS);
    document.documentElement.setAttribute("data-moggtify", VERSION);
    Topbar.since = Date.now();
    hotkey("ctrl+shift+m", () => { hub.toggle(); return true; }, { allowInInputs: true });
    hotkey("escape", () => (hub.isOpen() ? (hub.close(), true) : false), { allowInInputs: true });

    // The top-bar button: fast polling first (Spicetify.Topbar and the
    // global nav can appear late), then a light watchdog.
    Topbar.ensure();
    let fast = 0;
    const fastTimer = setInterval(() => { Topbar.ensure(); if (++fast > 60) clearInterval(fastTimer); }, 250);
    setInterval(() => { Topbar.ensure(); stylesLast(); }, 1500);

    bindSpicetifyPlayer();
    discoverPlatform();
    booted = true;
    M.booted = true;
    bus.emit("ready", M);

    // Extras start once Spotify's shell is on screen.
    for (let i = 0; i < 240 && !$(SEL.playpause) && !$(SEL.nowPlayingBar); i++) await sleep(250);
    started = true;
    for (const entry of registry.values()) if (isEnabled(entry.def.id)) startExt(entry);
    setInterval(checkPlayer, 700);
    checkPlayer();
    if (glassOwners.size && !backdrop.node) backdrop.mount();
    hub.refresh();
    log("v" + VERSION + " ready");
  }

  // Deferred so the extras bundled after this file register first.
  const kick = () => setTimeout(() => { boot().catch((e) => warn("boot", e)); }, 0);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", kick, { once: true });
  else kick();
})();
