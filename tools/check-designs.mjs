// Validates Moggtify's designs (runtime/themes.json): schema + WCAG contrast.
//
//   node tools/check-designs.mjs [file=runtime/themes.json] [--strict]
//
// Exits 1 when a design breaks the schema or a contrast rule. Advisory
// warnings (hover visibility, look-alike designs, ...) only fail with --strict.
// No dependencies, plain Node.
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const file = resolve(args.find((a) => !a.startsWith("--")) || resolve(here, "../runtime/themes.json"));

/* ---------------------------------------------------------------- rules */

const ROLES = ["frame", "base", "highlight", "elevated", "elevatedHighlight", "text", "subdued", "accent", "accentText", "border"];
const KEYS = new Set(["id", "name", "description", "passthrough", "flavor", "effects", "aurora", "tags", "colors"]);
// flavor = what sits behind the panels; effects = extras layered on top.
const FLAVOR_MAX = { flat: Infinity, glass: 4, aurora: 5 };
const EFFECTS = ["soft", "neon", "wash"];
const COUNT = [12, 32]; // Spotify + Mogg + originals
const SPOTIFY = {
  frame: "#000000", base: "#121212", highlight: "#1f1f1f", elevated: "#1f1f1f", elevatedHighlight: "#2a2a2a",
  text: "#ffffff", subdued: "#b3b3b3", accent: "#1ed760", accentText: "#000000", border: "#292929",
};
// [column, foreground, background, minimum WCAG 2 ratio]: must hold for every design.
const CONTRAST = [
  ["T/B", "text", "base", 7],
  ["T/E", "text", "elevated", 7],
  ["S/B", "subdued", "base", 4.5],
  ["S/E", "subdued", "elevated", 4.5],
  ["AT/A", "accentText", "accent", 4.5],
  ["A/B", "accent", "base", 3],
  ["A/F", "accent", "frame", 3],
];
const DARK = ["frame", "base", "highlight", "elevated"]; // relative luminance must stay below DARK_MAX
const DARK_MAX = 0.06;
// Advisory: [foreground, background, minimum, where it shows up in Spotify]
const ADVICE = [
  ["text", "highlight", 7, "titles on hovered rows"],
  ["subdued", "highlight", 4.5, "secondary text on hovered rows"],
  ["subdued", "elevatedHighlight", 4.5, "secondary text in hovered menu items"],
  ["accent", "base", 4.5, "accent as text (now playing title)"],
  ["accent", "elevated", 3, "accent controls on cards and menus"],
];
// Advisory luminance steps: [lighter, darker, min, max, what the step is for]
const STEPS = [
  ["highlight", "base", 1.08, Infinity, "hover on panels"],
  ["elevatedHighlight", "elevated", 1.08, Infinity, "hover on cards and menus"],
  ["elevated", "base", 1.05, Infinity, "cards and menus vs panels"],
  ["border", "base", 1.12, 2, "dividers"],
  ["base", "frame", 1, Infinity, "panels sit in front of the frame"],
];
// Names that belong to someone else (brands, well-known themes).
const TAKEN = /spotify|catppuccin|nord|dracula|gruvbox|tokyo|solarized|monokai|one ?dark|ayu|everforest|ros. ?pine|kanagawa|night ?owl|synthwave|palenight|nightfox|oxocarbon|poimandres|zenburn|material|github|sleek|dribbblish|ziro|comfy|onepunch|vantablack|ultrablack|tidal|deezer|apple|youtube|soundcloud|discord/i;
const GERMAN = new RegExp("[" + String.fromCharCode(0xe4, 0xf6, 0xfc, 0xc4, 0xd6, 0xdc, 0xdf) + "]"); // umlauts, sharp s

/* ----------------------------------------------------------- color math */

const HEX = /^#[0-9a-f]{6}$/i;
const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex) {
  const [r, g, b] = channels(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function oklab(hex) {
  const [r, g, b] = channels(hex).map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function deltaE(a, b) {
  const x = oklab(a), y = oklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/* ---------------------------------------------------------------- check */

const errors = [];
const warnings = [];
const warned = new Set(); // ids with at least one warning
const warn = (ids, msg) => { warnings.push(msg); for (const id of ids) warned.add(id); };
const shown = relative(process.cwd(), file) || file;

let designs;
try {
  designs = JSON.parse(readFileSync(file, "utf8").trimStart()); // trimStart also drops a BOM
} catch (e) {
  console.error(`${shown}: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(designs)) {
  console.error(`${shown}: expected a JSON array of designs`);
  process.exit(1);
}

const label = (d, i) => (d && typeof d.id === "string" && d.id ? d.id : `#${i + 1}`);
const ids = new Map(), names = new Map(), flavors = { flat: 0, glass: 0, aurora: 0 };

designs.forEach((d, i) => {
  const at = label(d, i);
  const err = (msg) => errors.push(`${at}: ${msg}`);
  if (!d || typeof d !== "object" || Array.isArray(d)) return err("not an object");

  for (const k of Object.keys(d)) if (!KEYS.has(k)) err(`unknown key "${k}"`);

  if (typeof d.id !== "string" || !/^[a-z][a-z0-9-]{1,23}$/.test(d.id)) err(`id must be lowercase kebab-case (got ${JSON.stringify(d.id)})`);
  else if (ids.has(d.id)) err(`duplicate id (also #${ids.get(d.id) + 1})`);
  else ids.set(d.id, i);

  if (typeof d.name !== "string" || !/^\S(.{0,22}\S)?$/.test(d.name)) err("name must be 1-24 characters");
  else if (names.has(d.name.toLowerCase())) err(`duplicate name "${d.name}"`);
  else names.set(d.name.toLowerCase(), i);

  if (i > 0 && (TAKEN.test(String(d.id)) || TAKEN.test(String(d.name)))) err("name/id is a brand or a well-known theme, pick an original name");

  if (typeof d.description !== "string" || d.description.trim().length < 8) err("description missing");
  else {
    if (/[\r\n]/.test(d.description)) err("description must be one line");
    if (d.description.length > 90) err(`description too long (${d.description.length} > 90 chars)`);
    if (GERMAN.test(d.description)) err("description must be English");
  }

  if (d.passthrough !== undefined && typeof d.passthrough !== "boolean") err("passthrough must be a boolean");
  if (d.passthrough && i > 0) err("only the Spotify design may be passthrough");

  if (d.flavor !== undefined) {
    if (!Object.hasOwn(FLAVOR_MAX, d.flavor)) err(`flavor must be flat, glass or aurora (got ${JSON.stringify(d.flavor)})`);
    else flavors[d.flavor]++;
  }

  if (d.effects !== undefined) {
    if (!Array.isArray(d.effects) || !d.effects.length) err("effects must be a non-empty array (or leave it out)");
    else {
      for (const e of d.effects) if (!EFFECTS.includes(e)) err(`unknown effect ${JSON.stringify(e)} (soft, neon, wash)`);
      if (new Set(d.effects).size !== d.effects.length) err("duplicate effects");
    }
  }

  if (d.aurora !== undefined) {
    if (d.flavor !== "aurora") err('"aurora" colors only make sense with flavor "aurora"');
    if (!Array.isArray(d.aurora) || d.aurora.length !== 3 || d.aurora.some((c) => typeof c !== "string" || !HEX.test(c))) err("aurora must be three #rrggbb colors");
  }

  if (d.tags !== undefined) {
    if (!Array.isArray(d.tags) || d.tags.length > 4) err("tags must be an array of up to 4 words");
    else {
      for (const t of d.tags) if (typeof t !== "string" || !/^[a-z][a-z0-9-]{1,15}$/.test(t)) err(`bad tag ${JSON.stringify(t)}`);
      if (new Set(d.tags).size !== d.tags.length) err("duplicate tags");
    }
  }

  const c = d.colors;
  if (!c || typeof c !== "object" || Array.isArray(c)) return err("colors missing");
  for (const k of Object.keys(c)) if (!ROLES.includes(k)) err(`unknown color role "${k}"`);
  const bad = ROLES.filter((r) => typeof c[r] !== "string" || !HEX.test(c[r]));
  if (bad.length) return err(`colors must be #rrggbb: ${bad.join(", ")}`);

  for (const [col, fg, bg, min] of CONTRAST) {
    const r = contrast(c[fg], c[bg]);
    if (r < min) err(`${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${min}:1 (${col})`);
  }
  for (const r of DARK) {
    const y = luminance(c[r]);
    if (y >= DARK_MAX) err(`${r} ${c[r]} is too light (luminance ${y.toFixed(3)}, must be < ${DARK_MAX})`);
  }
  if (d.passthrough) return; // Spotify's own palette: advice does not apply
  for (const [fg, bg, min, where] of ADVICE) {
    const r = contrast(c[fg], c[bg]);
    if (r < min) warn([at], `${at}: ${fg} on ${bg} ${r.toFixed(2)}:1 < ${min}:1 (${where})`);
  }
  for (const [a, b, min, max, what] of STEPS) {
    const r = (luminance(c[a]) + 0.05) / (luminance(c[b]) + 0.05);
    if (r < min || r > max) warn([at], `${at}: ${a}/${b} step ${r.toFixed(2)} outside ${min}..${max === Infinity ? "inf" : max} (${what})`);
  }
});

// Order and the fixed Spotify entry
const [first, second] = designs;
if (!first || first.id !== "spotify") errors.push('order: first design must be "spotify"');
else {
  if (first.name !== "Spotify") errors.push('spotify: name must be "Spotify"');
  if (first.passthrough !== true) errors.push("spotify: must be passthrough");
  for (const r of ROLES) {
    if (first.colors && String(first.colors[r]).toLowerCase() !== SPOTIFY[r]) errors.push(`spotify: ${r} must be Spotify's default ${SPOTIFY[r]}`);
  }
}
if (!second || second.id !== "mogg" || second.name !== "Mogg") errors.push('order: second design must be "mogg" ("Mogg")');

if (designs.length < COUNT[0] || designs.length > COUNT[1]) {
  errors.push(`count: expected ${COUNT[0]}-${COUNT[1]} designs, found ${designs.length}`);
}
for (const [f, n] of Object.entries(flavors)) {
  if (n > FLAVOR_MAX[f]) errors.push(`flavor: "${f}" used ${n} times, at most ${FLAVOR_MAX[f]}`);
}

// Look-alikes: accents nearly the same, or accents close and panels nearly the same (OKLab distance).
const valid = designs.filter((d) => d && d.colors && ROLES.every((r) => HEX.test(String(d.colors[r]))));
for (let i = 0; i < valid.length; i++) {
  for (let j = i + 1; j < valid.length; j++) {
    const a = valid[i].colors, b = valid[j].colors;
    const dAccent = deltaE(a.accent, b.accent), dBase = deltaE(a.base, b.base);
    if (dAccent < 0.035 || (dAccent < 0.07 && dBase < 0.03)) {
      warn([valid[i].id, valid[j].id], `${valid[i].id} ~ ${valid[j].id}: look alike (accent dE ${dAccent.toFixed(3)}, base dE ${dBase.toFixed(3)})`);
    }
  }
}

/* ---------------------------------------------------------------- table */

const failing = new Set(errors.map((e) => e.split(":")[0]));
const cols = [
  ["design", 18, "left"], ["flavor", 6, "left"],
  ...CONTRAST.map(([col]) => [col, 6]), ["dark", 5], ["", 4, "left"],
];
const cell = (v, [, w, align]) => (align === "left" ? String(v).padEnd(w) : String(v).padStart(w));
const row = (vals) => vals.map((v, k) => cell(v, cols[k])).join(" ").trimEnd();

console.log(`Moggtify designs | ${shown} | ${designs.length} designs | WCAG 2 contrast ratios`);
console.log(row(cols.map(([h]) => h)));
console.log(row(["minimum", "", ...CONTRAST.map(([, , , min]) => min), `<${DARK_MAX}`.replace("0.", "."), ""]));
designs.forEach((d, i) => {
  const at = label(d, i);
  const c = d && d.colors;
  const ok = c && ROLES.every((r) => HEX.test(String(c[r])));
  const ratios = CONTRAST.map(([, fg, bg, min]) => {
    if (!ok) return "-";
    const r = contrast(c[fg], c[bg]);
    return r.toFixed(2) + (r < min ? "!" : "");
  });
  const dark = ok ? Math.max(...DARK.map((r) => luminance(c[r]))) : NaN;
  const darkCell = ok ? dark.toFixed(3).replace(/^0/, "") + (dark >= DARK_MAX ? "!" : "") : "-";
  const status = failing.has(at) ? "FAIL" : warned.has(at) ? "warn" : "ok";
  const flavor = d && d.passthrough ? "pass" : (d && d.flavor) || "-";
  console.log(row([`${String(i + 1).padStart(2)} ${at}`, flavor, ...ratios, darkCell, status]));
});
console.log("T text, S subdued, A accent, AT accentText, B base, E elevated, F frame; dark = max luminance of frame/base/highlight/elevated");

if (errors.length) console.log("\nErrors\n" + errors.map((e) => "  x " + e).join("\n"));
if (warnings.length) console.log("\nWarnings\n" + warnings.map((w) => "  ! " + w).join("\n"));
const fail = errors.length > 0 || (strict && warnings.length > 0);
console.log(`\n${fail ? "FAIL" : "PASS"}: ${designs.length} designs, ${errors.length} errors, ${warnings.length} warnings` +
  `, glass ${flavors.glass}/${FLAVOR_MAX.glass}, aurora ${flavors.aurora}/${FLAVOR_MAX.aurora}${strict ? " (strict)" : ""}`);
process.exit(fail ? 1 : 0);
