// Builds a browser-previewable copy of a loader page with the mock bridge
// injected, so the UI can be developed without the Go backend.
//
//   node tools/preview/build.mjs [input=ui/index.html] [output=dist/preview/index.html]
//
// Then open the output in a browser, e.g. ...?state=installed&click=repair&hold=patch
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const input = resolve(process.argv[2] || "ui/index.html");
const output = resolve(process.argv[3] || "dist/preview/index.html");

const html = readFileSync(input, "utf8");
const mock = readFileSync(resolve(here, "mock-bridge.js"), "utf8");
if (!html.includes("</head>")) throw new Error(`${input} has no </head>`);

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, html.replace("</head>", `<script>\n${mock}\n</script>\n</head>`));
console.log(output);
