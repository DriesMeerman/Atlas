#!/usr/bin/env node
// Copy atlas parts into a site folder, shadcn style: the site owns the copies and may
// change them. atlas.json in the site records the engine commit and a hash of each copied
// file, so a later run can tell a local edit from an untouched file.
//
//   node scripts/add.mjs --to docs/architecture-site arch tldr features
//   node scripts/add.mjs --to docs/architecture-site --status
//
// Options:
//   --to <dir>       site folder (required)
//   --title <text>   fills {{TITLE}} in new template files
//   --tagline <text> fills {{TAGLINE}}
//   --key <text>     fills {{STORAGE_KEY}} (localStorage prefix), default from the title
//   --commit <sha>   fills {{COMMIT}} (the commit the content describes)
//   --force          overwrite files the site changed since they were copied
//   --status         list each engine file as unchanged, edited locally, or behind upstream
//
// Without --force an edited file is left alone and reported, so local changes survive.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ATLAS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(fs.readFileSync(path.join(ATLAS, "registry.json"), "utf8"));

function parseArgs(argv) {
  const out = { parts: [], force: false, status: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--to") out.to = argv[++i];
    else if (a === "--title") out.title = argv[++i];
    else if (a === "--tagline") out.tagline = argv[++i];
    else if (a === "--key") out.key = argv[++i];
    else if (a === "--commit") out.commit = argv[++i];
    else if (a === "--force") out.force = true;
    else if (a === "--status") out.status = true;
    else if (a === "-h" || a === "--help") out.help = true;
    else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
    else out.parts.push(a);
  }
  return out;
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 16);
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : null);

function engineCommit() {
  try {
    return execFileSync("git", ["-C", ATLAS, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

function resolve(names) {
  const seen = new Set();
  const order = [];
  const visit = (n) => {
    const p = registry.parts[n];
    if (!p) throw new Error(`No part named "${n}". Parts: ${Object.keys(registry.parts).join(", ")}`);
    if (seen.has(n)) return;
    seen.add(n);
    p.requires.forEach(visit);
    order.push(n);
  };
  names.forEach(visit);
  return order;
}

function fill(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.to) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1).filter((l, i, a) => a.slice(0, i + 1).every((x) => x.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(args.help ? 0 : 1);
  }
  const site = path.resolve(args.to);
  const manifestPath = path.join(site, "atlas.json");
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : { engine: "https://github.com/DriesMeerman/atlas", commit: null, parts: [], files: {} };

  if (args.status) return status(site, manifest);

  const names = args.parts.length ? args.parts : manifest.parts;
  if (!names.length) throw new Error("Name the parts to add, for example: arch tldr features");
  const parts = resolve([...new Set([...names, "core", "theme"])]);
  fs.mkdirSync(path.join(site, "app"), { recursive: true });
  fs.mkdirSync(path.join(site, "data"), { recursive: true });

  const report = { added: [], updated: [], kept: [], same: [] };
  for (const name of parts) {
    for (const f of registry.parts[name].files) {
      const src = fs.readFileSync(path.join(ATLAS, f.from));
      const dest = path.join(site, f.to);
      const have = read(dest);
      const recorded = manifest.files[f.to];
      if (!have) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, src);
        manifest.files[f.to] = sha(src);
        report.added.push(f.to);
      } else if (sha(have) === sha(src)) {
        manifest.files[f.to] = sha(src);
        report.same.push(f.to);
      } else if (f.own || (recorded && recorded !== sha(have) && !args.force) || (!recorded && !args.force)) {
        report.kept.push(f.to + (f.own ? " (site-owned)" : " (edited locally; --force overwrites)"));
      } else {
        fs.writeFileSync(dest, src);
        manifest.files[f.to] = sha(src);
        report.updated.push(f.to);
      }
    }
  }

  // Template files: written once, then owned by the site.
  const title = args.title || "Architecture docs";
  const vars = {
    TITLE: title,
    TAGLINE: args.tagline || "",
    COMMIT: args.commit || "(not recorded yet)",
    COMMIT_SHA: args.commit || "",
    DATE: new Date().toISOString().slice(0, 10),
    STORAGE_KEY: args.key || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "atlas"
  };
  const tdir = path.join(ATLAS, "templates", "site");
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const file of walk(tdir)) {
    const rel = path.relative(tdir, file);
    const dest = path.join(site, rel);
    if (fs.existsSync(dest)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, fill(fs.readFileSync(file, "utf8"), vars));
    report.added.push(rel);
  }
  // Starter data for each view part that has none yet.
  for (const name of parts) {
    const d = registry.parts[name].data;
    if (!d) continue;
    const dest = path.join(site, "data", d);
    if (fs.existsSync(dest)) continue;
    const starter = path.join(ATLAS, "templates", "data", d);
    if (fs.existsSync(starter)) {
      fs.copyFileSync(starter, dest);
      report.added.push("data/" + d);
    }
  }

  writeTags(site, parts);
  manifest.commit = engineCommit();
  manifest.parts = [...new Set([...(manifest.parts || []), ...parts.filter((p) => p !== "core" && p !== "theme")])];
  manifest.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  for (const [k, list] of Object.entries(report)) if (list.length) console.log(`${k}:\n  ${list.join("\n  ")}`);
}

// Rewrite the <!-- atlas:styles --> and <!-- atlas:scripts --> blocks in index.html.
function writeTags(site, parts) {
  const file = path.join(site, "index.html");
  if (!fs.existsSync(file)) return;
  let html = fs.readFileSync(file, "utf8");
  const present = (rel) => fs.existsSync(path.join(site, rel));
  const styles = registry.order.styles.filter(present).map((s) => `<link rel="stylesheet" href="${s}">`);
  const data = ["data/site.js"]
    .concat(parts.map((p) => registry.parts[p].data).filter(Boolean).map((d) => "data/" + d))
    .filter((d, i, a) => a.indexOf(d) === i && present(d));
  // Keep any extra data files the site added.
  const extraData = fs.readdirSync(path.join(site, "data")).filter((f) => f.endsWith(".js")).map((f) => "data/" + f).filter((f) => !data.includes(f)).sort();
  const scripts = data.concat(extraData).concat(registry.order.scripts.filter(present)).map((s) => `<script src="${s}"></script>`);
  const swap = (name, lines) => {
    const re = new RegExp(`<!-- atlas:${name} -->[\\s\\S]*?<!-- /atlas:${name} -->`);
    if (re.test(html)) html = html.replace(re, `<!-- atlas:${name} -->\n${lines.join("\n")}\n<!-- /atlas:${name} -->`);
  };
  swap("styles", styles);
  swap("scripts", scripts);
  fs.writeFileSync(file, html);
}

function status(site, manifest) {
  console.log(`engine commit when last added: ${manifest.commit || "unknown"}\nengine commit here: ${engineCommit()}`);
  for (const [name, part] of Object.entries(registry.parts)) {
    for (const f of part.files) {
      const have = read(path.join(site, f.to));
      if (!have) continue;
      const up = sha(fs.readFileSync(path.join(ATLAS, f.from)));
      const local = sha(have);
      const rec = manifest.files[f.to];
      const edited = rec && rec !== local;
      const behind = rec ? rec !== up : local !== up;
      const state = f.own ? "site-owned" : edited && behind ? "edited locally, and upstream changed" : edited ? "edited locally" : behind ? "upstream changed" : "unchanged";
      console.log(`${f.to.padEnd(24)} ${name.padEnd(9)} ${state}`);
    }
  }
}

try {
  main();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
