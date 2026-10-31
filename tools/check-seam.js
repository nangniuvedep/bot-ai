#!/usr/bin/env node
/* Checks that the page still fits the app's rules, so a change on either side is caught before packaging.
   Usage: node tools/check-seam.js [<app>/pages/_headers]
   1. no inline <script> / inline on*= handlers (CSP + AGENTS 6.2)
   2. every <script src>/<link href> is either a file in ui/ or one of the app's shared files
   3. the only app-wide globals used are __t and BLI18N (the translation layer)
   4. if config.js has a stateUrl, its host must be allowed by connect-src in the app's _headers
   5. all UI text strings are listed in ui/i18n-strings.json */
const fs = require("fs"), path = require("path"), ui = path.join(__dirname, "..", "ui");
let bad = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
const html = fs.readFileSync(path.join(ui, "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), "no inline <script>");
ok(!/\son[a-z]+\s*=\s*["']/i.test(html.replace(/<svg[\s\S]*?<\/svg>/g, "")), "no inline event handlers");
const SHARED = ["/app-i18n.js"], refs = [...html.matchAll(/<(?:script|link|img)[^>]+(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u));
ok(refs.every((u) => SHARED.includes(u) || fs.existsSync(path.join(ui, u.split("?")[0]))), "all local references exist or are shared app files (" + refs.join(", ") + ")");
const js = fs.readFileSync(path.join(ui, "bot-ai.js"), "utf8") + fs.readFileSync(path.join(ui, "config.js"), "utf8");
ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(js), "no storage access (cannot touch the app's keys)");
ok(!/\b(BL|BLA|BLS)\./.test(js.replace(/window\.BLI18N/g, "")), "no use of the app's globals (BL., BLA., BLS.)");
ok(!/method\s*:\s*["'](POST|PUT|DELETE|PATCH)/i.test(js), "read-only: no write requests");
const cfg = {}; new Function("window", js.match(/\(function \(\) \{[\s\S]*?\}\)\(\);/)[0].includes("config") ? fs.readFileSync(path.join(ui, "config.js"), "utf8") : "")(cfg);
const urls = [cfg.BOTAI.config.stateUrl, cfg.BOTAI.config.priceUrl].filter(Boolean), url = urls[0];
if (urls.length) {
  const hp = process.argv[2]; if (!hp) ok(false, "stateUrl/priceUrl is set: pass the app's pages/_headers to check connect-src");
  else {
    const csp = (fs.readFileSync(hp, "utf8").match(/connect-src([^;]*)/) || [, ""])[1].trim().split(/\s+/);
    urls.forEach((u) => { const h = new URL(u).origin; ok(csp.some((s) => s === h || (s.startsWith("https://*.") && new URL(h).host.endsWith(s.slice(10))) || s === "https:"), "host " + h + " allowed by connect-src"); });
  }
} else console.log("INFO no stateUrl/priceUrl -> sample data");
const cat = JSON.parse(fs.readFileSync(path.join(ui, "i18n-strings.json"), "utf8")), have = new Set([...cat.static, ...cat.templates]);
const used = new Set([...js.matchAll(/__t\(\s*"([^"]+)"/g)].map((m) => m[1]));
const miss = [...used].filter((s) => !have.has(s)); ok(!miss.length, "every __t(\"…\") text is in i18n-strings.json" + (miss.length ? " — missing: " + miss.join(" | ") : ""));
process.exit(bad ? 1 : 0);
