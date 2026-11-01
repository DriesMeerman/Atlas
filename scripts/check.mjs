#!/usr/bin/env node
// Check a site's data: every id a view links to must exist, layouts must not overlap,
// and every script or stylesheet index.html names must be there. Items marked hidden are
// checked too: they stay in the data for tools.
//
//   node scripts/check.mjs docs/architecture-site [--repo .]
//
// --repo <dir> also checks that each source ref's path exists in that checkout and that
// its line is inside the file. Exits 1 when it finds an error. Warnings do not fail.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const args = process.argv.slice(2);
const site = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--repo");
const repoIdx = args.indexOf("--repo");
const repo = repoIdx >= 0 ? path.resolve(args[repoIdx + 1]) : null;
if (!site) {
  console.error("usage: node check.mjs <site dir> [--repo <checkout>]");
  process.exit(1);
}
const dir = path.resolve(site);
const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

// Load data files the way the page does: each sets a global on window.
const window = {};
const ctx = vm.createContext({ window, console });
const dataDir = path.join(dir, "data");
if (fs.existsSync(dataDir)) {
  for (const f of fs.readdirSync(dataDir).filter((f) => f.endsWith(".js")).sort()) {
    try {
      vm.runInContext(fs.readFileSync(path.join(dataDir, f), "utf8"), ctx, { filename: f });
    } catch (e) {
      err(`data/${f} does not run: ${e.message}`);
    }
  }
}

// index.html references
const indexFile = path.join(dir, "index.html");
if (fs.existsSync(indexFile)) {
  const html = fs.readFileSync(indexFile, "utf8");
  for (const m of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"#:]+)"/g)) {
    if (!fs.existsSync(path.join(dir, m[1]))) err(`index.html loads ${m[1]}, which is missing`);
  }
}

const A = window.ATLAS_ARCH;
const T = window.ATLAS_TLDR;
const F = window.ATLAS_FEATURES;
const S = window.ATLAS_SITE;
if (!S) warn("data/site.js does not set window.ATLAS_SITE");

const ids = (list, what) => {
  const set = new Set();
  for (const x of list || []) {
    if (!x || !x.id) { err(`${what} entry without an id`); continue; }
    if (set.has(x.id)) err(`duplicate ${what} id "${x.id}"`);
    set.add(x.id);
  }
  return set;
};

const allRefs = [];
const refs = (list, where) => (list || []).forEach((r) => {
  if (!r || !r.path) err(`${where}: ref without a path`);
  else allRefs.push({ ...r, where });
});

let nodes = new Set();
if (A) {
  nodes = ids(A.nodes, "node");
  const layers = A.layers && A.layers.length ? new Set(A.layers.map((l) => l.id)) : null;
  for (const n of A.nodes || []) {
    if (!n.title) err(`node ${n.id} has no title`);
    if (!n.summary) warn(`node ${n.id} has no summary`);
    if (layers && !layers.has(n.layer)) err(`node ${n.id} uses layer "${n.layer}", which ATLAS_ARCH.layers does not list`);
    refs(n.refs, `node ${n.id}`);
  }
  const kinds = new Set(["data", "control", "store"]);
  const edgeCheck = (e, where) => {
    if (!nodes.has(e.from)) err(`${where}: edge from unknown node "${e.from}"`);
    if (!nodes.has(e.to)) err(`${where}: edge to unknown node "${e.to}"`);
    if (e.kind && !kinds.has(e.kind)) err(`${where}: edge ${e.from} -> ${e.to} has kind "${e.kind}" (use data, control or store)`);
  };
  (A.edges || []).forEach((e) => edgeCheck(e, "edges"));
  const diagrams = ids(A.diagrams, "diagram");
  for (const d of A.diagrams || []) {
    const pos = new Map();
    for (const nid of d.nodes || []) {
      if (!nodes.has(nid)) err(`diagram ${d.id} lists unknown node "${nid}"`);
      const p = d.layout && d.layout[nid];
      if (!p) { err(`diagram ${d.id} has no layout for "${nid}"`); continue; }
      const key = p.join(",");
      if (pos.has(key)) err(`diagram ${d.id}: "${nid}" and "${pos.get(key)}" share grid cell ${key}`);
      pos.set(key, nid);
    }
    for (const k of Object.keys(d.layout || {})) if (!(d.nodes || []).includes(k)) warn(`diagram ${d.id} lays out "${k}" but does not list it in nodes`);
    if (Array.isArray(d.edges)) d.edges.forEach((e) => edgeCheck(e, `diagram ${d.id}`));
    if ((d.nodes || []).length > 16) warn(`diagram ${d.id} has ${d.nodes.length} nodes; over about 14 gets hard to read`);
  }
  ids(A.flows, "flow");
  const groupIds = new Set((A.flowGroups || []).map((g) => g.id));
  for (const f of A.flows || []) {
    if (!f.steps || !f.steps.length) err(`flow ${f.id} has no steps`);
    (f.steps || []).forEach((s, i) => {
      if (!nodes.has(s.node)) err(`flow ${f.id} step ${i + 1} names unknown node "${s.node}"`);
      if (!s.text) err(`flow ${f.id} step ${i + 1} has no text`);
      refs(s.refs, `flow ${f.id} step ${i + 1}`);
    });
    if (f.diagram && !diagrams.has(f.diagram)) err(`flow ${f.id} prefers unknown diagram "${f.diagram}"`);
    if (f.group && groupIds.size) {
      const segs = f.group.split("/");
      for (let i = 1; i <= segs.length; i++) {
        const p = segs.slice(0, i).join("/");
        if (!groupIds.has(p) && !groupIds.has(segs[i - 1])) warn(`flow ${f.id}: group "${p}" has no entry in flowGroups (the title falls back to the id)`);
      }
    }
    const onSome = (A.diagrams || []).some((d) => (f.steps || []).every((s) => (d.nodes || []).includes(s.node)));
    if (!onSome) warn(`flow ${f.id}: no single diagram holds every step; set "diagram" to the best one or add the missing nodes`);
  }
  const used = new Set();
  (A.diagrams || []).forEach((d) => (d.nodes || []).forEach((n) => used.add(n)));
  for (const n of nodes) if (!used.has(n)) warn(`node ${n} is on no diagram`);
}

if (T) {
  if (!A) err("tldr.js needs architecture.js");
  const blocks = ids(T.blocks, "tldr block");
  const cells = new Map();
  for (const b of T.blocks || []) {
    for (const n of b.nodes || []) if (!nodes.has(n)) err(`tldr block ${b.id} lists unknown node "${n}"`);
    if (b.zoom) {
      const d = (A && A.diagrams || []).find((x) => x.id === b.zoom.diagram);
      if (!d) err(`tldr block ${b.id} zooms into unknown diagram "${b.zoom.diagram}"`);
      else for (const n of b.zoom.focus || []) if (!d.nodes.includes(n)) err(`tldr block ${b.id}: focus "${n}" is not on diagram ${d.id}`);
    }
    for (let c = 0; c < (b.span || 1); c++) {
      const key = `${(b.col || 0) + c},${b.row || 0}`;
      if (cells.has(key)) err(`tldr blocks ${b.id} and ${cells.get(key)} overlap at ${key}`);
      cells.set(key, b.id);
    }
    if ((b.bullets || []).length > 5) warn(`tldr block ${b.id} has ${b.bullets.length} bullets; 3 to 5 read best`);
  }
  for (const l of T.links || []) {
    if (!blocks.has(l.from) || !blocks.has(l.to)) err(`tldr link ${l.from} -> ${l.to} names an unknown block`);
  }
}

if (F) {
  const groups = ids(F.groups, "feature group");
  ids(F.features, "feature");
  const perGroup = {};
  for (const f of F.features || []) {
    const g = (F.groups || []).find((x) => x.id === f.group);
    if (!g) err(`feature ${f.id} is in unknown group "${f.group}"`);
    else if (f.subgroup && !(g.subgroups || []).some((s) => s.id === f.subgroup)) err(`feature ${f.id} is in unknown subgroup "${f.group}/${f.subgroup}"`);
    if (!f.hidden) perGroup[f.group] = (perGroup[f.group] || 0) + 1;
    if (!f.summary) warn(`feature ${f.id} has no summary`);
    for (const n of f.archNodes || []) if (!nodes.has(n)) err(`feature ${f.id} names unknown node "${n}"`);
    for (const fl of f.flows || []) if (!(A && (A.flows || []).some((x) => x.id === fl))) err(`feature ${f.id} names unknown flow "${fl}"`);
    for (const r of f.related || []) if (!(F.features || []).some((x) => x.id === r)) err(`feature ${f.id} relates to unknown feature "${r}"`);
    for (const fail of f.failures || []) if (!fail.when || !fail.then) err(`feature ${f.id}: each failure needs "when" and "then"`);
    refs(f.refs, `feature ${f.id}`);
  }
  for (const g of F.groups || []) {
    if ((perGroup[g.id] || 0) > 12 && !(g.subgroups || []).length) warn(`feature group ${g.id} has ${perGroup[g.id]} features and no subgroups; split it`);
  }
}

if (repo) {
  const lines = new Map();
  for (const r of allRefs) {
    const p = path.join(repo, r.path);
    if (!fs.existsSync(p)) { err(`${r.where}: ${r.path} does not exist in ${repo}`); continue; }
    if (r.line) {
      if (!lines.has(p)) lines.set(p, fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8").split("\n").length : 0);
      if (r.line > lines.get(p)) err(`${r.where}: ${r.path}:${r.line} is past the end of the file (${lines.get(p)} lines)`);
    }
  }
}

for (const w of warns) console.log("warn  " + w);
for (const e of errors) console.log("error " + e);
console.log(`${errors.length} errors, ${warns.length} warnings` + (A ? `; ${nodes.size} nodes, ${(A.diagrams || []).length} diagrams, ${(A.flows || []).length} flows` : ""));
process.exit(errors.length ? 1 : 0);
