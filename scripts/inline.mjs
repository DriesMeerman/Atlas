#!/usr/bin/env node
// Turn a site folder into one self-contained HTML file: every local stylesheet and
// script index.html loads is inlined.
//
//   node scripts/inline.mjs docs/architecture-site docs/architecture.html
import fs from "node:fs";
import path from "node:path";

const [siteArg, outArg] = process.argv.slice(2);
if (!siteArg || !outArg) {
  console.error("usage: node inline.mjs <site dir> <out.html>");
  process.exit(1);
}
const site = path.resolve(siteArg);
let html = fs.readFileSync(path.join(site, "index.html"), "utf8");
const local = (p) => !/^[a-z]+:|^\/\//i.test(p);
const readRel = (p) => fs.readFileSync(path.join(site, p), "utf8");

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) =>
  local(href) ? `<style data-from="${href}">\n${readRel(href).replace(/<\/style/gi, "<\\/style")}\n</style>` : m);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) =>
  local(src) ? `<script data-from="${src}">\n${readRel(src).replace(/<\/script/gi, "<\\/script")}\n</script>` : m);

fs.mkdirSync(path.dirname(path.resolve(outArg)), { recursive: true });
fs.writeFileSync(outArg, html);
console.log(`wrote ${outArg} (${Math.round(html.length / 1024)} KB)`);
