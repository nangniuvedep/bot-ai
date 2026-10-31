#!/usr/bin/env node
/* Rebuild the icon sprite in ui/index.html from the app's own icon file.
   Usage: node tools/sync-icons.js <path to app>/ops/src/ui-icon.js
   Run it again whenever the app changes its icons: the page then never keeps a stale private copy. */
const fs = require("fs"), path = require("path");
const src = process.argv[2];
if (!src) { console.error("usage: node tools/sync-icons.js <app>/ops/src/ui-icon.js"); process.exit(2); }
const V = {}, re = /^\s*"([a-z0-9-]+)":\s*"((?:[^"\\]|\\.)*)"/gm; let m;
const text = fs.readFileSync(src, "utf8"); while ((m = re.exec(text))) V[m[1]] = m[2];
const ui = path.join(__dirname, "..", "ui"), html = path.join(ui, "index.html");
const used = new Set(); let all = fs.readFileSync(html, "utf8") + fs.readFileSync(path.join(ui, "bot-ai.js"), "utf8");
all.replace(/#i-([a-z0-9-]+)/g, (_, k) => used.add(k)); all.replace(/\bic\("([a-z0-9-]+)"/g, (_, k) => used.add(k));
all.replace(/\[\s*"[a-z]+",\s*"([a-z0-9-]+)",\s*"[A-Z]/g, (_, k) => used.add(k)); all.replace(/\["(check|signal|portfolio|warning)",/g, (_, k) => used.add(k));
all.replace(/ic\(LOGT\[[^\]]*\]\[0\]/g, () => 0); ["check", "signal", "portfolio", "warning", "gauge", "chart-area", "lock", "refresh", "theme-light", "theme-dark", "close"].forEach((k) => used.add(k));
const miss = [...used].filter((k) => !V[k]); if (miss.length) { console.error("MISSING in app icon file:", miss.join(" ")); process.exit(1); }
const sprite = '<svg id="bl-ic" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">' +
  [...used].sort().map((k) => `<symbol id="i-${k}" viewBox="0 0 24 24">${V[k]}</symbol>`).join("") + "</svg>";
const out = fs.readFileSync(html, "utf8").replace(/<!--sprite-->[\s\S]*?<!--\/sprite-->/, "<!--sprite-->" + sprite + "<!--/sprite-->");
fs.writeFileSync(html, out); console.log("sprite:", used.size, "icons");
