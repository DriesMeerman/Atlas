/* Atlas: Features view.
 *
 * A group rail, a result list (cards or rows) and an inspector column. The search box
 * takes a path and filters at once:
 *
 *   ops/recovery/restart      "/" scopes to a group, then a subgroup; the rest filters
 *   @outbox retry             "@" filters to features that touch a component
 *
 * Data (data/features.js):
 *
 *   window.ATLAS_FEATURES = {
 *     intro: "Optional text under the heading.",
 *     groups: [ { id, title, blurb, subgroups: [ { id, title, blurb } ] } ],
 *     features: [ {
 *       id, group, subgroup,          // subgroup is optional
 *       title, summary, body,         // body: markdown subset, how it works
 *       usage: ["POST /orders", "make reindex"],      // how it is used or triggered
 *       config: [ { key, where, default, note } ],
 *       archNodes: ["orders", "db"],  // components it touches, main one first
 *       flows: ["place-order"],       // flow ids; without it, flows are derived
 *       invariants: ["..."],          // what always holds
 *       failures: [ { when, then } ], // failure modes
 *       aliases: ["checkout"],        // extra search words
 *       related: ["other-feature"],   // without it, related features are derived
 *       refs: [ { path, line, label } ],
 *       hidden: true                  // optional: keep in the data, leave off the page
 *     } ]
 *   };
 *
 * Routes: #features, #features/<id>, with ?q=<search as typed>&view=cards|list.
 * Keys while shown: / search, j and k next and previous, v cards or list, a show on the
 * architecture, \ fold the inspector, Esc back out one step.
 */
(function () {
  "use strict";

  var root = null;
  var st = { path: [], comps: [], text: "", sel: null, view: null, folded: false };
  var results = [];
  var mini = null;
  var sugg = { open: false, items: [], active: -1 };

  function A() { return window.Atlas; }
  function esc(s) { return A().esc(s); }
  function D() { return A().features(); }
  function $(q) { return root.querySelector(q); }
  function $$(q) { return Array.prototype.slice.call(root.querySelectorAll(q)); }
  function node(id) { return A().node(id); }
  function color(layer) { return A().layerColor(layer); }

  function group(id) { return (D().groups || []).filter(function (g) { return g.id === id; })[0] || null; }
  function subgroup(g, id) { return g ? (g.subgroups || []).filter(function (s) { return s.id === id; })[0] || null : null; }
  function feature(id) { return (D().features || []).filter(function (f) { return f.id === id; })[0] || null; }
  function nodesOf(f) { return (f.archNodes || []).filter(function (id) { return node(id) && !node(id).hidden; }); }
  function pathLabel(f) {
    var g = group(f.group), s = subgroup(g, f.subgroup);
    return [g ? g.title : f.group, s ? s.title : null].filter(Boolean).join(" / ");
  }
  function pathKey(f) { return [f.group, f.subgroup].filter(Boolean).join("/"); }

  /* ---------- filtering ---------- */

  function inPath(f) {
    if (st.path[0] && f.group !== st.path[0]) return false;
    if (st.path[1] && f.subgroup !== st.path[1]) return false;
    return true;
  }
  function hasComps(f, comps) {
    var ns = f.archNodes || [];
    return comps.every(function (c) { return ns.indexOf(c) >= 0; });
  }

  // Returns { score, why } or null. Every word must match some field.
  function match(f, words) {
    if (!words.length) return { score: 0, why: "" };
    var fields = [
      ["title", f.title, 10], ["id", f.id, 8], ["alias", (f.aliases || []).join(" "), 7],
      ["config key", (f.config || []).map(function (c) { return c.key; }).join(" "), 6],
      ["usage", (f.usage || []).join(" "), 5],
      ["component", (f.archNodes || []).map(function (id) { var n = node(id); return n ? n.title + " " + id : id; }).join(" "), 4],
      ["summary", f.summary, 3],
      ["details", [f.body, (f.invariants || []).join(" "), (f.failures || []).map(function (x) { return x.when + " " + x.then; }).join(" "),
        (f.config || []).map(function (c) { return c.note || ""; }).join(" "), (f.refs || []).map(function (r) { return r.path + " " + (r.label || ""); }).join(" ")].join(" "), 1]
    ];
    var total = 0, why = "";
    for (var w = 0; w < words.length; w++) {
      var best = 0, bestName = "";
      for (var i = 0; i < fields.length; i++) {
        var text = String(fields[i][1] || "").toLowerCase();
        var at = text.indexOf(words[w]);
        if (at < 0) continue;
        var sc = fields[i][2] + (at === 0 || /\W/.test(text.charAt(at - 1)) ? 1 : 0);
        if (sc > best) { best = sc; bestName = fields[i][0]; }
      }
      if (!best) return null;
      total += best;
      if (best < 5 && !why) why = bestName;
      if (bestName === "config key" || bestName === "usage" || bestName === "alias") why = bestName;
    }
    return { score: total, why: why === "summary" ? "" : why };
  }

  function words() { return st.text.toLowerCase().split(/\s+/).filter(Boolean); }

  function compute() {
    var ws = words();
    var out = [];
    (D().features || []).forEach(function (f, i) {
      if (!inPath(f) || !hasComps(f, st.comps)) return;
      var m = match(f, ws);
      if (m) out.push({ f: f, score: m.score, why: m.why, i: i });
    });
    if (ws.length) out.sort(function (a, b) { return b.score - a.score || a.i - b.i; });
    results = out;
    return out;
  }

  /* ---------- search text <-> state ---------- */

  function serialize() {
    var s = st.path.join("/") + (st.path.length ? "/" : "");
    var bits = st.comps.map(function (c) { return "@" + c; });
    if (st.text.trim()) bits.push(st.text.trim());
    return s + bits.join(" ");
  }

  function resolveSeg(seg) {
    var s = seg.toLowerCase().trim();
    if (!s) return null;
    var pool = st.path.length === 0 ? D().groups || [] : st.path.length === 1 ? (group(st.path[0]) || {}).subgroups || [] : [];
    var exact = pool.filter(function (x) { return x.id.toLowerCase() === s || x.title.toLowerCase() === s; });
    if (exact.length) return exact[0].id;
    var pre = pool.filter(function (x) {
      return x.id.toLowerCase().indexOf(s) === 0 || x.title.toLowerCase().split(/\s+/).some(function (w) { return w.indexOf(s) === 0; });
    });
    return pre.length === 1 ? pre[0].id : null;
  }
  function resolveComp(tok) {
    var s = tok.toLowerCase();
    var all = (A().arch().nodes || []);
    var exact = all.filter(function (n) { return n.id.toLowerCase() === s; });
    if (exact.length) return exact[0].id;
    var pre = all.filter(function (n) { return n.id.toLowerCase().indexOf(s) === 0 || n.title.toLowerCase().indexOf(s) === 0; });
    return pre.length === 1 ? pre[0].id : null;
  }

  // Take what the reader typed: leading "seg/" parts become path chips, finished "@x "
  // tokens become component chips, the rest is search text. Returns an error or "".
  function absorb(value, final) {
    var err = "";
    var v = value;
    while (v.indexOf("/") >= 0) {
      var cut = v.indexOf("/");
      var seg = v.slice(0, cut);
      if (!seg.trim()) { v = v.slice(cut + 1); continue; }
      if (st.path.length >= 2) { err = "No deeper level than a subgroup."; break; }
      var id = resolveSeg(seg);
      if (!id) {
        err = 'No ' + (st.path.length ? "subgroup" : "group") + ' starts with "' + seg.trim() + '".';
        break;
      }
      st.path.push(id);
      v = v.slice(cut + 1);
    }
    var toks = v.split(/(\s+)/);
    var keep = [];
    toks.forEach(function (t, i) {
      var last = i === toks.length - 1;
      if (/^@\S+$/.test(t) && (!last || final)) {
        var c = resolveComp(t.slice(1));
        if (c) { if (st.comps.indexOf(c) < 0) st.comps.push(c); return; }
      }
      keep.push(t);
    });
    st.text = keep.join("").replace(/^\s+/, "");
    if (err) st.text = v.replace(/\//g, " ");
    return err;
  }

  function loadQuery(q) {
    st.path = [];
    st.comps = [];
    st.text = "";
    absorb(q || "", true);
  }

  /* ---------- styles ---------- */

  function injectStyle() {
    if (document.getElementById("atlas-features-style")) return;
    var css = [
      ".fx{display:flex;flex-direction:column;gap:14px}",
      ".fx-grid{display:grid;grid-template-columns:232px minmax(0,1fr) var(--fx-iw,clamp(420px,30vw,620px));gap:18px;align-items:start}",
      ".fx-grid.fx-folded{grid-template-columns:232px minmax(0,1fr) 44px}",
      ".fx button:focus-visible,.fx a:focus-visible,.fx input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}",
      /* rail */
      ".fx-rail{position:sticky;top:72px;max-height:calc(100vh - 88px);overflow:auto;display:flex;flex-direction:column;gap:2px;padding-right:4px;font-size:14px}",
      ".fx-rh{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:14px 0 4px;font-weight:600}",
      ".fx-rh:first-child{margin-top:0}",
      ".fx-ri{display:flex;align-items:center;gap:8px;width:100%;text-align:left;font:inherit;font-size:14px;color:var(--text);background:none;border:0;border-radius:4px;padding:5px 8px;cursor:pointer}",
      ".fx-ri:hover{background:var(--panel-2)}",
      ".fx-ri[aria-current=true]{background:var(--panel-2);box-shadow:inset 3px 0 0 var(--accent);font-weight:600}",
      ".fx-ri.fx-sub{padding-left:22px;font-size:13px}",
      ".fx-ri.fx-zero{color:var(--muted)}",
      ".fx-ri .n{margin-left:auto;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}",
      ".fx-ri .sw{width:8px;height:8px;border-radius:2px;flex:none;background:var(--fx-c)}",
      ".fx-ri[aria-pressed=true]{background:color-mix(in srgb,var(--fx-c) 18%,transparent);font-weight:600}",
      ".fx-more{font:inherit;font-size:12px;color:var(--accent);background:none;border:0;padding:2px 8px;text-align:left;cursor:pointer}",
      /* search */
      ".fx-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;position:sticky;top:57px;z-index:20;background:var(--bg);padding:6px 0 8px}",
      ".fx-field{position:relative;flex:1;min-width:min(100%,360px);display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:4px 8px;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius,6px)}",
      ".fx-field:focus-within{border-color:var(--accent)}",
      ".fx-field.fx-shake{animation:fx-shake .25s}",
      "@keyframes fx-shake{25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}",
      ".fx-field input{flex:1;min-width:140px;font:inherit;font-size:15px;color:var(--text);background:transparent;border:0;padding:6px 2px}",
      ".fx-field input:focus{outline:none}",
      ".fx-chip{display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:13px;padding:2px 4px 2px 8px;color:var(--text);background:var(--panel-2);border:1px solid var(--line);border-radius:999px;cursor:default}",
      ".fx-chip.fx-comp{border-left:3px solid var(--fx-c)}",
      ".fx-chip button{font:inherit;line-height:1;width:18px;height:18px;color:var(--muted);background:none;border:0;border-radius:50%;cursor:pointer}",
      ".fx-chip button:hover{color:var(--text);background:var(--line)}",
      ".fx-chip+.fx-slash{color:var(--muted)}",
      ".fx-sugg{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:40;margin:0;padding:6px;list-style:none;max-height:min(55vh,440px);overflow:auto;",
      "background:var(--panel);border:1px solid var(--accent);border-radius:var(--radius,6px);box-shadow:var(--shadow,0 8px 24px rgba(0,0,0,.3))}",
      ".fx-sugg[hidden]{display:none}",
      ".fx-sugg .h{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:6px 8px 2px}",
      ".fx-sugg .o{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:6px 8px;border-radius:4px;cursor:pointer}",
      ".fx-sugg .o[aria-selected=true]{background:var(--panel-2);outline:1px solid var(--accent)}",
      ".fx-sugg .o small{grid-column:1/-1;color:var(--muted);font-size:12px;line-height:1.35}",
      ".fx-sugg .o .k{font-family:var(--font-mono,ui-monospace,monospace);font-size:12px;color:var(--muted)}",
      ".fx-status{margin:-4px 0 0;font-size:13px;color:var(--muted);width:100%}",
      ".fx-status.fx-err{color:var(--warn)}",
      ".fx-seg{display:inline-flex;border:1px solid var(--line);border-radius:var(--radius,6px);overflow:hidden}",
      ".fx-seg button{font:inherit;font-size:13px;padding:6px 10px;color:var(--muted);background:var(--panel);border:0;cursor:pointer}",
      ".fx-seg button[aria-pressed=true]{color:var(--text);background:var(--panel-2);box-shadow:inset 0 -2px 0 var(--accent)}",
      /* results */
      ".fx-gh{display:flex;align-items:baseline;gap:10px;margin:18px 0 8px}",
      ".fx-gh:first-child{margin-top:4px}",
      ".fx-gh h3{margin:0;font-size:16px}",
      ".fx-gh p{margin:0;color:var(--muted);font-size:13px}",
      ".fx-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:10px}",
      ".fx-card{display:flex;flex-direction:column;gap:6px;text-align:left;font:inherit;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:var(--radius,6px);padding:12px 14px;cursor:pointer}",
      ".fx-card:hover{border-color:color-mix(in srgb,var(--accent) 50%,var(--line))}",
      ".fx-card.on,.fx-row.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}",
      ".fx-card .p,.fx-row .p{font-size:12px;color:var(--muted)}",
      ".fx-card b{font-size:15px;line-height:1.3}",
      ".fx-card .s{font-size:14px;color:var(--muted);line-height:1.45}",
      ".fx-card code{font-size:12px;align-self:flex-start;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".fx-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;font-size:12px;color:var(--muted);margin-top:auto}",
      ".fx-why{font-size:12px;color:var(--accent)}",
      ".fx-rows{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:var(--radius,6px);overflow:hidden}",
      ".fx-row{display:grid;grid-template-columns:minmax(200px,1fr) minmax(0,2fr) auto;gap:6px 16px;align-items:center;width:100%;text-align:left;font:inherit;color:var(--text);",
      "background:var(--panel);border:0;border-top:1px solid var(--line);padding:9px 14px;cursor:pointer}",
      ".fx-row:first-child{border-top:0}",
      ".fx-row:hover{background:var(--panel-2)}",
      ".fx-row.on{box-shadow:inset 3px 0 0 var(--accent);background:var(--panel-2)}",
      ".fx-row b{display:block;font-size:14px;font-weight:600}",
      ".fx-row .s{font-size:13px;color:var(--muted);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
      ".fx-foot{display:flex;align-items:center;gap:6px;justify-content:flex-end}",
      ".fx-sq{display:inline-block;width:11px;height:11px;border-radius:2px;background:color-mix(in srgb,var(--fx-c) 70%,transparent);border:1px solid var(--fx-c);cursor:pointer}",
      ".fx-sq.hot{outline:2px solid var(--text);outline-offset:1px}",
      ".fx-cn{font-size:12px;color:var(--muted);white-space:nowrap;min-width:64px;text-align:right}",
      ".fx-pills{display:flex;flex-wrap:wrap;gap:4px}",
      ".fx-pill{font-size:12px;padding:1px 7px;border:1px solid var(--line);border-left:3px solid var(--fx-c);border-radius:3px;background:var(--panel-2);color:var(--text);text-decoration:none}",
      "a.fx-pill:hover{border-color:var(--accent);border-left-color:var(--fx-c)}",
      ".fx-empty{color:var(--muted);padding:20px 0}",
      /* inspector */
      ".fx-insp{position:sticky;top:72px;max-height:calc(100vh - 88px);display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius,6px);overflow:hidden}",
      ".fx-ih{display:flex;align-items:flex-start;gap:8px;padding:12px 12px 10px 16px;border-bottom:1px solid var(--line)}",
      ".fx-ih .t{flex:1;min-width:0}",
      ".fx-ih .p{font-size:12px;color:var(--muted)}",
      ".fx-ih h3{margin:2px 0 0;font-size:18px;line-height:1.3}",
      ".fx-ib{padding:4px 16px 18px;overflow:auto;flex:1}",
      ".fx-ib h4{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:18px 0 6px;font-weight:600}",
      ".fx-ib .lead{font-weight:600;margin:12px 0 0}",
      ".fx-pbtn{font:inherit;font-size:16px;line-height:1;width:32px;height:32px;flex:none;color:var(--muted);background:transparent;border:1px solid var(--line);border-radius:var(--radius,6px);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}",
      ".fx-pbtn:hover{color:var(--accent);border-color:var(--accent)}",
      ".fx-rail2{display:none;flex-direction:column;align-items:center;gap:10px;padding:8px 0}",
      ".fx-rail2 span{writing-mode:vertical-rl;transform:rotate(180deg);font-size:13px;color:var(--muted);white-space:nowrap;max-height:60vh;overflow:hidden;text-overflow:ellipsis}",
      ".fx-folded .fx-ih,.fx-folded .fx-ib{display:none}",
      ".fx-folded .fx-rail2{display:flex}",
      ".fx-mini{height:220px;border:1px solid var(--line);border-radius:var(--radius,6px);overflow:hidden;background:var(--bg)}",
      ".fx-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}",
      ".fx-use{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none}",
      ".fx-use code{display:block;white-space:pre-wrap;padding:4px 8px}",
      ".fx-cfg td:first-child code{white-space:nowrap}",
      ".fx-cfg td{font-size:14px}",
      ".fx-fail{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}",
      ".fx-fail li{font-size:14px;padding:6px 10px;border-left:3px solid var(--warn);background:var(--panel-2);border-radius:3px}",
      ".fx-fail b{font-weight:600}",
      ".fx-ib ul.fx-inv{margin:0;padding-left:1.2em}",
      ".fx-ib ul.fx-inv li::marker{color:var(--ok)}",
      ".fx-flows{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none}",
      ".fx-flows a{font-weight:600;text-decoration:none}",
      ".fx-flows small{color:var(--muted);margin-left:6px}",
      ".fx-tag{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);border:1px solid var(--line);border-radius:3px;padding:0 5px;margin-left:6px}",
      ".fx-nav{display:flex;justify-content:space-between;gap:8px;margin-top:18px}",
      ".fx-bars{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none}",
      ".fx-bars button{display:grid;grid-template-columns:1fr auto;gap:2px 8px;width:100%;text-align:left;font:inherit;font-size:13px;color:var(--text);background:none;border:0;padding:3px 4px;border-radius:4px;cursor:pointer}",
      ".fx-bars button:hover{background:var(--panel-2)}",
      ".fx-bars i{grid-column:1/-1;height:4px;border-radius:2px;background:var(--fx-c)}",
      ".fx-keys{font-size:12px;color:var(--muted);margin-top:16px}",
      /* narrower screens */
      "@media (max-width:1279px){",
      ".fx-grid,.fx-grid.fx-folded{grid-template-columns:minmax(0,1fr)}",
      ".fx-rail{position:static;max-height:none;flex-direction:row;flex-wrap:nowrap;overflow-x:auto;gap:4px;padding-bottom:4px}",
      ".fx-rail .fx-rh,.fx-rail .fx-comps{display:none}",
      ".fx-ri,.fx-ri.fx-sub{width:auto;flex:none;padding:5px 10px;border:1px solid var(--line);border-radius:999px}",
      ".fx-insp{position:fixed;top:0;right:0;bottom:0;width:min(560px,94vw);max-height:none;z-index:70;border-radius:0;box-shadow:-10px 0 30px rgba(0,0,0,.35);display:none}",
      ".fx-grid.fx-sel .fx-insp{display:flex}",
      ".fx-grid.fx-folded .fx-insp{display:none}",
      ".fx-bar{top:0}",
      "}",
      "@media (max-width:899px){.fx-insp{width:100vw}.fx-row{grid-template-columns:1fr auto}.fx-row .s{grid-column:1/-1;grid-row:2}}",
      "@media (prefers-reduced-motion:reduce){.fx-field.fx-shake{animation:none}}"
    ].join("\n");
    var el = document.createElement("style");
    el.id = "atlas-features-style";
    el.textContent = css;
    document.head.appendChild(el);
  }

  /* ---------- mount ---------- */

  function mount(el) {
    root = el;
    injectStyle();
    var d = D();
    if (!(d.features || []).length) {
      el.innerHTML = A().emptyState("No features yet", "`data/features.js` is missing or empty.");
      return;
    }
    try { st.view = localStorage.getItem(A().storageKey("feature-view")); } catch (e) {}
    if (st.view !== "cards" && st.view !== "list") st.view = d.features.length > 24 ? "list" : "cards";
    try { st.folded = localStorage.getItem(A().storageKey("inspector")) === "folded"; } catch (e) {}

    el.innerHTML =
      '<div class="fx">' +
      '<header class="view-head"><h2>Features</h2><p>' + A().mdInline(d.intro || "What the system does, how each feature is used, the settings that control it, and where it lives in the code.") + "</p></header>" +
      '<div class="fx-grid">' +
      '<nav class="fx-rail" aria-label="Feature groups and components"></nav>' +
      '<section class="fx-main" aria-label="Features">' +
      '<div class="fx-bar"><div class="fx-field"><span class="fx-chips"></span>' +
      '<input type="text" class="fx-input" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-autocomplete="list" ' +
      'aria-label="Search features. Type a group and / to scope, @ for a component." placeholder="Search features: group/ to scope, @component to filter">' +
      '<kbd aria-hidden="true">/</kbd><ul class="fx-sugg" role="listbox" hidden></ul></div>' +
      '<span class="fx-seg" role="group" aria-label="Layout"><button type="button" data-v="cards">Cards</button><button type="button" data-v="list">List</button></span>' +
      '<p class="fx-status" aria-live="polite"></p></div>' +
      '<div class="fx-results"></div></section>' +
      '<aside class="fx-insp" aria-label="Feature details">' +
      '<div class="fx-ih"><div class="t"><span class="p"></span><h3></h3></div>' +
      '<button type="button" class="fx-pbtn fx-fold" title="Fold the inspector (\\)" aria-label="Fold the inspector">&rsaquo;</button>' +
      '<button type="button" class="fx-pbtn fx-close" title="Close (Esc)" aria-label="Close the feature">&times;</button></div>' +
      '<div class="fx-ib"></div>' +
      '<div class="fx-rail2"><button type="button" class="fx-pbtn fx-unfold" title="Show the inspector (\\)" aria-label="Show the inspector">&lsaquo;</button><span></span></div>' +
      "</aside></div></div>";

    var input = $(".fx-input");
    input.addEventListener("input", function () {
      var before = st.path.length;
      var err = absorb(input.value, false);
      input.value = st.text;
      status(err);
      if (err) shake();
      paintChips();
      openSugg();
      update(before !== st.path.length);
    });
    input.addEventListener("focus", openSugg);
    input.addEventListener("blur", function () { setTimeout(closeSugg, 120); });
    input.addEventListener("keydown", onKey);
    $(".fx-chips").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-rm]");
      if (!b) return;
      var kind = b.getAttribute("data-rm"), v = b.getAttribute("data-v");
      if (kind === "path") st.path = st.path.slice(0, +v);
      else st.comps = st.comps.filter(function (c) { return c !== v; });
      paintChips();
      update(true);
      input.focus();
    });
    $(".fx-sugg").addEventListener("mousedown", function (e) { e.preventDefault(); });
    $(".fx-sugg").addEventListener("click", function (e) {
      var o = e.target.closest(".o");
      if (o) pick(sugg.items[+o.getAttribute("data-i")]);
    });
    $(".fx-seg").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (b) setView(b.getAttribute("data-v"));
    });
    $(".fx-rail").addEventListener("click", function (e) {
      var b = e.target.closest("[data-path],[data-comp],[data-more]");
      if (!b) return;
      if (b.hasAttribute("data-more")) { b.parentNode.setAttribute("data-all", "1"); paintRail(); return; }
      if (b.hasAttribute("data-path")) {
        var p = b.getAttribute("data-path");
        st.path = p ? p.split("/") : [];
      } else {
        var c = b.getAttribute("data-comp");
        var at = st.comps.indexOf(c);
        if (at >= 0) st.comps.splice(at, 1); else st.comps.push(c);
      }
      paintChips();
      update(true);
    });
    $(".fx-results").addEventListener("click", function (e) {
      var sq = e.target.closest(".fx-sq");
      if (sq) {
        e.stopPropagation();
        var c = sq.getAttribute("data-n");
        if (st.comps.indexOf(c) < 0) st.comps.push(c);
        paintChips();
        update(true);
        return;
      }
      var it = e.target.closest("[data-f]");
      if (it) open(it.getAttribute("data-f"));
    });
    $(".fx-results").addEventListener("mouseover", function (e) {
      var sq = e.target.closest(".fx-sq");
      $$(".fx-sq.hot").forEach(function (x) { x.classList.remove("hot"); });
      if (sq) $$('.fx-sq[data-n="' + sq.getAttribute("data-n") + '"]').forEach(function (x) { x.classList.add("hot"); });
    });
    $(".fx-insp").addEventListener("click", function (e) {
      var c = e.target.closest("[data-comp]");
      if (c) {
        var id = c.getAttribute("data-comp");
        if (st.comps.indexOf(id) < 0) st.comps.push(id);
        paintChips();
        update(true);
        return;
      }
      var g = e.target.closest("[data-f]");
      if (g) { e.preventDefault(); open(g.getAttribute("data-f")); }
    });
    $(".fx-close").addEventListener("click", function () { close(); });
    $(".fx-fold").addEventListener("click", function () { setFolded(true); });
    $(".fx-unfold").addEventListener("click", function () { setFolded(false); });
    document.addEventListener("keydown", onPageKey);
    A().claimSlash(function () { return root && A().isShown(root) ? $(".fx-input") : null; });

    setFolded(st.folded, true);
    paintChips();
  }

  /* ---------- painting ---------- */

  function shake() {
    var f = $(".fx-field");
    f.classList.remove("fx-shake");
    void f.offsetWidth;
    f.classList.add("fx-shake");
  }

  function status(err) {
    var s = $(".fx-status");
    s.classList.toggle("fx-err", !!err);
    s.textContent = err || "";
  }

  function paintChips() {
    var h = "";
    st.path.forEach(function (id, i) {
      var g = i === 0 ? group(id) : subgroup(group(st.path[0]), id);
      h += '<span class="fx-chip">' + esc(g ? g.title : id) + '<button type="button" data-rm="path" data-v="' + i + '" aria-label="Leave ' + esc(g ? g.title : id) + '">&times;</button></span><span class="fx-slash" aria-hidden="true">/</span>';
    });
    st.comps.forEach(function (c) {
      var n = node(c);
      h += '<span class="fx-chip fx-comp" style="--fx-c:' + color(n ? n.layer : "") + '">@' + esc(n ? n.title : c) + '<button type="button" data-rm="comp" data-v="' + esc(c) + '" aria-label="Remove component filter ' + esc(n ? n.title : c) + '">&times;</button></span>';
    });
    $(".fx-chips").innerHTML = h;
  }

  function counts() {
    // Counts use the text and component filters, not the path, so the rail shows where matches are.
    var ws = words();
    var by = {};
    var total = {};
    (D().features || []).forEach(function (f) {
      var k1 = f.group, k2 = f.group + "/" + (f.subgroup || "");
      total[k1] = (total[k1] || 0) + 1;
      total[k2] = (total[k2] || 0) + 1;
      if (!hasComps(f, st.comps) || !match(f, ws)) return;
      by[k1] = (by[k1] || 0) + 1;
      by[k2] = (by[k2] || 0) + 1;
      by[""] = (by[""] || 0) + 1;
    });
    total[""] = (D().features || []).length;
    return { by: by, total: total };
  }

  function paintRail() {
    var rail = $(".fx-rail");
    var c = counts();
    var cur = st.path.join("/");
    var n = function (k) { return '<span class="n">' + (c.by[k] || 0) + (c.by[k] !== c.total[k] ? "/" + c.total[k] : "") + "</span>"; };
    var h = '<p class="fx-rh">Groups</p>' +
      '<button type="button" class="fx-ri" data-path="" aria-current="' + (cur === "") + '">All features' + n("") + "</button>";
    (D().groups || []).forEach(function (g) {
      if (!c.total[g.id]) return;
      h += '<button type="button" class="fx-ri' + (c.by[g.id] ? "" : " fx-zero") + '" data-path="' + esc(g.id) + '" aria-current="' + (cur === g.id) + '" title="' + esc(g.blurb || "") + '">' + esc(g.title) + n(g.id) + "</button>";
      if (st.path[0] === g.id || (g.subgroups || []).length && st.path[0] === g.id) {
        (g.subgroups || []).forEach(function (s) {
          var k = g.id + "/" + s.id;
          if (!c.total[k]) return;
          h += '<button type="button" class="fx-ri fx-sub' + (c.by[k] ? "" : " fx-zero") + '" data-path="' + esc(k) + '" aria-current="' + (cur === k) + '" title="' + esc(s.blurb || "") + '">' + esc(s.title) + n(k) + "</button>";
        });
      }
    });
    // Component facet: components touched by the features in scope.
    var ws = words();
    var tally = {};
    (D().features || []).forEach(function (f) {
      if (!inPath(f) || !match(f, ws)) return;
      nodesOf(f).forEach(function (id) { tally[id] = (tally[id] || 0) + 1; });
    });
    st.comps.forEach(function (id) { if (!tally[id]) tally[id] = 0; });
    var ids = Object.keys(tally);
    if (ids.length) {
      h += '<div class="fx-comps"><p class="fx-rh">Touches component</p>';
      var prevAll = rail.querySelector(".fx-comps") && rail.querySelector(".fx-comps").getAttribute("data-all");
      A().layers().forEach(function (l) {
        var mine = ids.filter(function (id) { return node(id) && node(id).layer === l.id; }).sort(function (a, b) { return tally[b] - tally[a]; });
        if (!mine.length) return;
        mine.forEach(function (id, i) {
          var on = st.comps.indexOf(id) >= 0;
          var hide = !prevAll && i >= 4 && !on;
          if (hide) return;
          h += '<button type="button" class="fx-ri" data-comp="' + esc(id) + '" aria-pressed="' + on + '" style="--fx-c:' + color(l.id) + '"><span class="sw"></span>' + esc(node(id).title) + '<span class="n">' + tally[id] + "</span></button>";
        });
        if (!prevAll && mine.length > 4) h += '<button type="button" class="fx-more" data-more="1">+' + (mine.length - 4) + " more " + esc(l.title.toLowerCase()) + "</button>";
      });
      h += "</div>";
      rail.innerHTML = h;
      if (prevAll) rail.querySelector(".fx-comps").setAttribute("data-all", "1");
    } else rail.innerHTML = h;
  }

  function footprint(f) {
    return nodesOf(f).map(function (id) {
      var n = node(id);
      return '<i class="fx-sq" data-n="' + esc(id) + '" style="--fx-c:' + color(n.layer) + '" title="' + esc(n.title) + ' (click to filter)"></i>';
    }).join("");
  }
  function metaCounts(f) {
    var bits = [];
    if ((f.config || []).length) bits.push(f.config.length + (f.config.length === 1 ? " setting" : " settings"));
    if ((f.refs || []).length) bits.push(f.refs.length + (f.refs.length === 1 ? " ref" : " refs"));
    return bits.join(" · ");
  }

  function itemHtml(r, flat) {
    var f = r.f;
    var on = st.sel === f.id ? " on" : "";
    var why = r.why ? '<span class="fx-why">matched ' + esc(r.why) + "</span>" : "";
    if (st.view === "list") {
      return '<button type="button" class="fx-row' + on + '" data-f="' + esc(f.id) + '"><span><b>' + esc(f.title) + '</b><span class="p">' + esc(flat ? pathLabel(f) : f.id) + "</span></span>" +
        '<span class="s">' + esc(f.summary || "") + (why ? " " + why : "") + "</span>" +
        '<span class="fx-foot">' + footprint(f) + '<span class="fx-cn">' + esc(metaCounts(f)) + "</span></span></button>";
    }
    var use = (f.usage || [])[0];
    return '<button type="button" class="fx-card' + on + '" data-f="' + esc(f.id) + '">' +
      (flat ? '<span class="p">' + esc(pathLabel(f)) + "</span>" : "") +
      "<b>" + esc(f.title) + "</b>" + '<span class="s">' + esc(f.summary || "") + "</span>" +
      (use ? "<code>" + esc(use) + "</code>" : "") +
      '<span class="fx-meta"><span>' + footprint(f) + "</span>" + (metaCounts(f) ? "<span>" + esc(metaCounts(f)) + "</span>" : "") + why + "</span></button>";
  }

  function paintResults() {
    var host = $(".fx-results");
    if (!results.length) {
      host.innerHTML = '<p class="fx-empty">No features match. Remove a chip or some words to see more.</p>';
      return;
    }
    var wrapOpen = st.view === "list" ? '<div class="fx-rows">' : '<div class="fx-cards">';
    if (words().length) {
      host.innerHTML = wrapOpen + results.map(function (r) { return itemHtml(r, true); }).join("") + "</div>";
      return;
    }
    // No search words: keep data order, grouped by group and subgroup.
    var h = "", lastKey = null, open = false;
    results.forEach(function (r) {
      var k = pathKey(r.f);
      if (k !== lastKey) {
        if (open) h += "</div>";
        var g = group(r.f.group), s = subgroup(g, r.f.subgroup);
        var title = s ? (st.path.length ? s.title : (g ? g.title : r.f.group) + " / " + s.title) : g ? g.title : r.f.group;
        var blurb = s ? s.blurb : g ? g.blurb : "";
        h += '<div class="fx-gh"><h3>' + esc(title) + "</h3>" + (blurb ? "<p>" + esc(blurb) + "</p>" : "") + "</div>" + wrapOpen;
        open = true;
        lastKey = k;
      }
      h += itemHtml(r, false);
    });
    if (open) h += "</div>";
    host.innerHTML = h;
  }

  function scopeTitle() {
    if (!st.path.length) return "All features";
    var g = group(st.path[0]);
    var s = subgroup(g, st.path[1]);
    return [g ? g.title : st.path[0], s ? s.title : null].filter(Boolean).join(" / ");
  }

  function paintInspector() {
    var grid = $(".fx-grid");
    var ih = $(".fx-ih"), ib = $(".fx-ib");
    if (mini) { mini.destroy(); mini = null; }
    var f = st.sel && feature(st.sel);
    grid.classList.toggle("fx-sel", !!f);
    $(".fx-close").hidden = !f;
    if (!f) {
      ih.querySelector(".p").textContent = "Overview";
      ih.querySelector("h3").textContent = scopeTitle();
      $(".fx-rail2 span").textContent = scopeTitle();
      ib.innerHTML = scopeHtml();
      return;
    }
    ih.querySelector(".p").textContent = pathLabel(f);
    ih.querySelector("h3").textContent = f.title;
    $(".fx-rail2 span").textContent = f.title;
    ib.innerHTML = featureHtml(f);
    ib.scrollTop = 0;
    drawMini(f);
  }

  function scopeHtml() {
    var fs = results.map(function (r) { return r.f; });
    var h = '<p class="lead">' + fs.length + " feature" + (fs.length === 1 ? "" : "s") + (words().length || st.comps.length ? " match" : "") + ". Pick one to see how it works.</p>";
    var tally = {};
    fs.forEach(function (f) { nodesOf(f).forEach(function (id) { tally[id] = (tally[id] || 0) + 1; }); });
    var top = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; }).slice(0, 8);
    if (top.length) {
      var max = tally[top[0]];
      h += "<h4>Components touched most</h4><ul class=\"fx-bars\">" + top.map(function (id) {
        var n = node(id);
        return '<li><button type="button" data-comp="' + esc(id) + '" style="--fx-c:' + color(n.layer) + '"><span>' + esc(n.title) + "</span><span>" + tally[id] + '</span><i style="width:' + Math.round((tally[id] / max) * 100) + '%"></i></button></li>';
      }).join("") + "</ul>";
    }
    var keys = [];
    fs.forEach(function (f) { (f.config || []).forEach(function (c) { keys.push({ c: c, f: f }); }); });
    if (keys.length) {
      h += "<h4>Settings in scope</h4><table class=\"tbl fx-cfg\"><tbody>" + keys.slice(0, 40).map(function (k) {
        return "<tr><td><code>" + esc(k.c.key) + '</code></td><td><a href="#features/' + esc(k.f.id) + '" data-f="' + esc(k.f.id) + '">' + esc(k.f.title) + "</a></td></tr>";
      }).join("") + "</tbody></table>" + (keys.length > 40 ? '<p class="fx-keys">' + (keys.length - 40) + " more. Narrow the scope to see them.</p>" : "");
    }
    h += '<p class="fx-keys">Keys: <kbd>/</kbd> search, <kbd>j</kbd> <kbd>k</kbd> next and previous, <kbd>v</kbd> cards or list, <kbd>a</kbd> show on the architecture, <kbd>\\</kbd> fold this panel, <kbd>Esc</kbd> back.</p>';
    return h;
  }

  // Flows named on the feature, else flows that pass through two or more of its components.
  function flowsFor(f) {
    var all = A().arch().flows || [];
    var ids = nodesOf(f);
    var stepsOn = function (fl) {
      var out = [];
      (fl.steps || []).forEach(function (s, i) { if (ids.indexOf(s.node) >= 0) out.push(i + 1); });
      return out;
    };
    if (f.flows && f.flows.length) {
      return f.flows.map(function (id) { return all.filter(function (x) { return x.id === id; })[0]; }).filter(Boolean)
        .map(function (fl) { return { flow: fl, steps: stepsOn(fl), derived: false }; });
    }
    return all.map(function (fl) {
      var hit = {};
      (fl.steps || []).forEach(function (s) { if (ids.indexOf(s.node) >= 0) hit[s.node] = true; });
      return { flow: fl, steps: stepsOn(fl), derived: true, n: Object.keys(hit).length };
    }).filter(function (x) { return x.n >= 2; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 6);
  }

  function relatedFor(f) {
    if (f.related && f.related.length) return f.related.map(feature).filter(Boolean).map(function (x) { return { f: x, derived: false }; });
    var mine = nodesOf(f);
    return (D().features || []).filter(function (x) { return x.id !== f.id; }).map(function (x) {
      var shared = nodesOf(x).filter(function (id) { return mine.indexOf(id) >= 0; });
      return { f: x, n: shared.length, derived: true };
    }).filter(function (x) { return x.n >= 2; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 6);
  }

  function featureHtml(f) {
    var h = "";
    if (f.summary) h += '<p class="lead">' + esc(f.summary) + "</p>";
    var ids = nodesOf(f);
    if (ids.length) {
      h += "<h4>Touches</h4>";
      h += ids.length <= 10 ? '<div class="fx-mini"></div>' : "";
      h += '<div class="fx-pills" style="margin-top:8px">' + ids.map(function (id) {
        var n = node(id);
        return '<a class="fx-pill" href="#arch/' + esc(id) + '" style="--fx-c:' + color(n.layer) + '" title="' + esc(n.summary || "") + '">' + esc(n.title) + "</a>";
      }).join("") + "</div>";
      if (window.AtlasViews.arch) h += '<div class="fx-actions"><a class="btn" href="#arch/feature/' + esc(f.id) + '">Show on the architecture <kbd>a</kbd></a></div>';
    }
    if ((f.usage || []).length || (f.refs || []).length) {
      h += "<h4>Entry points</h4>";
      if ((f.usage || []).length) h += '<ul class="fx-use">' + f.usage.map(function (u) { return "<li><code>" + esc(u) + "</code></li>"; }).join("") + "</ul>";
      if ((f.refs || []).length) h += '<div style="margin-top:8px">' + A().refList(f.refs) + "</div>";
    }
    if ((f.config || []).length) {
      h += "<h4>Configuration</h4><table class=\"tbl fx-cfg\"><thead><tr><th>Key</th><th>Where</th><th>Notes</th></tr></thead><tbody>" + f.config.map(function (c) {
        return "<tr><td><code>" + esc(c.key) + "</code></td><td>" + esc(c.where || "") + "</td><td>" + A().mdInline((c.default != null ? "Default `" + c.default + "`. " : "") + (c.note || "")) + "</td></tr>";
      }).join("") + "</tbody></table>";
    }
    if ((f.invariants || []).length) h += '<h4>Invariants</h4><ul class="fx-inv">' + f.invariants.map(function (x) { return "<li>" + A().mdInline(x) + "</li>"; }).join("") + "</ul>";
    if ((f.failures || []).length) {
      h += '<h4>Failure modes</h4><ul class="fx-fail">' + f.failures.map(function (x) {
        return "<li><b>When</b> " + A().mdInline(x.when) + "<br><b>Then</b> " + A().mdInline(x.then) + "</li>";
      }).join("") + "</ul>";
    }
    if (f.body) h += '<h4>How it works</h4><div class="md">' + A().md(f.body) + "</div>";
    var fl = flowsFor(f);
    if (fl.length) {
      h += "<h4>Flows" + (fl[0].derived ? '<span class="fx-tag" title="Flows that pass through two or more of its components">derived</span>' : "") + '</h4><ul class="fx-flows">' + fl.map(function (x) {
        var st1 = x.steps[0];
        return '<li><a href="#arch/flow/' + esc(x.flow.id) + (st1 ? "/" + st1 : "") + '">' + esc(x.flow.title) + "</a>" +
          (x.steps.length ? "<small>step" + (x.steps.length > 1 ? "s " : " ") + x.steps.join(", ") + " of " + x.flow.steps.length + "</small>" : "") + "</li>";
      }).join("") + "</ul>";
    }
    var rel = relatedFor(f);
    if (rel.length) {
      h += "<h4>Related features" + (rel[0].derived ? '<span class="fx-tag" title="Features that share two or more components">derived</span>' : "") + '</h4><div class="fx-pills">' + rel.map(function (x) {
        return '<a class="fx-pill" style="--fx-c:var(--accent)" href="#features/' + esc(x.f.id) + '" data-f="' + esc(x.f.id) + '">' + esc(x.f.title) + "</a>";
      }).join("") + "</div>";
    }
    var i = indexOf(f.id);
    var prev = i > 0 ? results[i - 1].f : null, next = i >= 0 && i < results.length - 1 ? results[i + 1].f : null;
    h += '<div class="fx-nav">' + (prev ? '<a class="btn" href="#features/' + esc(prev.id) + '" data-f="' + esc(prev.id) + '">&larr; ' + esc(prev.title) + "</a>" : "<span></span>") +
      (next ? '<a class="btn" href="#features/' + esc(next.id) + '" data-f="' + esc(next.id) + '">' + esc(next.title) + " &rarr;</a>" : "<span></span>") + "</div>";
    return h;
  }

  // A small diagram of the feature's components. Positions come from the hand-placed
  // diagram that holds most of them, packed tight; the rest go on a row below.
  function drawMini(f) {
    var host = $(".fx-mini");
    if (!host || !window.AtlasDiagram) return;
    var ids = nodesOf(f);
    var best = null, bestN = 0;
    (A().arch().diagrams || []).forEach(function (d) {
      var c = ids.filter(function (id) { return d.nodes.indexOf(id) >= 0; }).length;
      if (c > bestN) { bestN = c; best = d; }
    });
    var layout = {};
    var placed = best ? ids.filter(function (id) { return best.nodes.indexOf(id) >= 0 && best.layout[id]; }) : [];
    var cols = [], rows = [];
    placed.forEach(function (id) {
      var p = best.layout[id];
      if (cols.indexOf(p[0]) < 0) cols.push(p[0]);
      if (rows.indexOf(p[1]) < 0) rows.push(p[1]);
    });
    cols.sort(function (a, b) { return a - b; });
    rows.sort(function (a, b) { return a - b; });
    placed.forEach(function (id) { layout[id] = [cols.indexOf(best.layout[id][0]), rows.indexOf(best.layout[id][1])]; });
    var extraRow = rows.length;
    var x = 0;
    ids.forEach(function (id) { if (!layout[id]) layout[id] = [x++, extraRow]; });
    var spec = { id: "mini-" + f.id, title: f.title + ": components", nodes: ids, layout: layout, edges: "auto" };
    // Size the box to the drawing's shape first, from the grid extent, so the first fit is right.
    var gw = 0, gh = 0;
    ids.forEach(function (id) { gw = Math.max(gw, layout[id][0] + 1); gh = Math.max(gh, layout[id][1] + 1); });
    var w = host.clientWidth || 480;
    var ratio = (gh * 64 + (gh - 1) * 96 + 80) / (gw * 184 + (gw - 1) * 148 + 80);
    host.style.height = Math.max(150, Math.min(Math.round(w * ratio) + 20, 320)) + "px";
    mini = window.AtlasDiagram.render(host, spec, { compact: true, onNode: function (id) { A().go("#arch/" + id); } });
  }

  function indexOf(id) {
    for (var i = 0; i < results.length; i++) if (results[i].f.id === id) return i;
    return -1;
  }

  function setView(v) {
    st.view = v;
    try { localStorage.setItem(A().storageKey("feature-view"), v); } catch (e) {}
    update(false);
  }
  function setFolded(on, quiet) {
    st.folded = on;
    $(".fx-grid").classList.toggle("fx-folded", on);
    try { localStorage.setItem(A().storageKey("inspector"), on ? "folded" : "open"); } catch (e) {}
    if (!quiet) (on ? $(".fx-unfold") : $(".fx-fold")).focus();
    if (!on && st.sel && !mini) paintInspector();
  }

  function hashFor(sel) {
    var q = serialize();
    var params = [];
    if (q) params.push("q=" + encodeURIComponent(q));
    var d = (D().features || []).length > 24 ? "list" : "cards";
    if (st.view !== d) params.push("view=" + st.view);
    return "#features" + (sel ? "/" + encodeURIComponent(sel) : "") + (params.length ? "?" + params.join("&") : "");
  }

  // Re-render after a filter change. Filter changes replace the history entry.
  function update(scrollTop) {
    compute();
    $$(".fx-seg button").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-v") === st.view ? "true" : "false"); });
    paintRail();
    paintResults();
    paintInspector();
    if (sugg.open) openSugg();
    A().replaceHash(hashFor(st.sel));
    if (scrollTop) {
      var top = $(".fx-results").getBoundingClientRect().top;
      if (top < 0) $(".fx-grid").scrollIntoView({ block: "start" });
    }
  }

  // Opening a feature adds a history entry, so Back closes it.
  function open(id, replace) {
    if (!feature(id)) return;
    if (replace) { st.sel = id; A().replaceHash(hashFor(id)); markSel(); paintInspector(); return; }
    A().go(hashFor(id));
  }
  function close() {
    st.sel = null;
    A().go(hashFor(null));
  }
  function markSel() {
    $$("[data-f].on").forEach(function (x) { x.classList.remove("on"); });
    var el = st.sel && root.querySelector('.fx-results [data-f="' + st.sel + '"]');
    if (el) {
      el.classList.add("on");
      var r = el.getBoundingClientRect();
      if (r.top < 120 || r.bottom > window.innerHeight) el.scrollIntoView({ block: "nearest" });
    }
  }

  /* ---------- suggestions ---------- */

  function openSugg() {
    var input = $(".fx-input");
    if (document.activeElement !== input) return;
    var list = $(".fx-sugg");
    var raw = input.value;
    var lastTok = raw.split(/\s+/).pop() || "";
    var items = [];
    var groupsHtml = [];
    if (lastTok.charAt(0) === "@") {
      var q = lastTok.slice(1).toLowerCase();
      var tally = {};
      (D().features || []).forEach(function (f) {
        if (!inPath(f)) return;
        nodesOf(f).forEach(function (id) { tally[id] = (tally[id] || 0) + 1; });
      });
      var cs = Object.keys(tally).filter(function (id) {
        var n = node(id);
        return st.comps.indexOf(id) < 0 && (!q || id.toLowerCase().indexOf(q) === 0 || n.title.toLowerCase().indexOf(q) >= 0);
      }).sort(function (a, b) { return tally[b] - tally[a]; }).slice(0, 10);
      if (cs.length) {
        groupsHtml.push({ head: "Components", items: cs.map(function (id) { return { kind: "comp", id: id, title: node(id).title, sub: node(id).summary || "", count: tally[id] }; }) });
      }
    } else {
      var w = lastTok.toLowerCase();
      var pool = st.path.length === 0 ? D().groups || [] : st.path.length === 1 ? (group(st.path[0]) || {}).subgroups || [] : [];
      var c = counts();
      var kids = pool.filter(function (g) {
        var k = st.path.length ? st.path[0] + "/" + g.id : g.id;
        return c.total[k] && (!w || g.id.indexOf(w) === 0 || g.title.toLowerCase().split(/\s+/).some(function (x) { return x.indexOf(w) === 0; }));
      }).map(function (g) {
        var k = st.path.length ? st.path[0] + "/" + g.id : g.id;
        return { kind: "path", id: g.id, title: g.title, sub: g.blurb || "", count: c.total[k] };
      });
      if (kids.length && raw.trim().split(/\s+/).length <= 1) groupsHtml.push({ head: st.path.length ? "Subgroups" : "Groups", items: kids });
      var fs = results.slice(0, raw.trim() ? 8 : 6).map(function (r) { return { kind: "feature", id: r.f.id, title: r.f.title, sub: pathLabel(r.f) }; });
      if (fs.length) groupsHtml.push({ head: raw.trim() ? "Features" : "Features in scope", items: fs });
    }
    sugg.items = [];
    var h = "";
    groupsHtml.forEach(function (g) {
      h += '<li class="h" role="presentation">' + esc(g.head) + "</li>";
      g.items.forEach(function (it) {
        var i = sugg.items.length;
        sugg.items.push(it);
        h += '<li class="o" role="option" id="fx-o-' + i + '" data-i="' + i + '" aria-selected="false"><span>' + (it.kind === "comp" ? "@" : "") + esc(it.title) + "</span>" +
          '<span class="k">' + (it.kind === "path" ? esc(it.id) + "/ · " + it.count : it.kind === "comp" ? it.count + " features" : "") + "</span>" +
          (it.sub ? "<small>" + esc(it.sub) + "</small>" : "") + "</li>";
      });
    });
    list.innerHTML = h;
    sugg.open = !!h;
    list.hidden = !h;
    input.setAttribute("aria-expanded", h ? "true" : "false");
    setActive(sugg.items.length ? 0 : -1);
  }
  function closeSugg() {
    sugg.open = false;
    if (!root) return;
    $(".fx-sugg").hidden = true;
    $(".fx-input").setAttribute("aria-expanded", "false");
  }
  function setActive(i) {
    var els = $$(".fx-sugg .o");
    els.forEach(function (e) { e.setAttribute("aria-selected", "false"); });
    sugg.active = i;
    var input = $(".fx-input");
    if (i >= 0 && els[i]) {
      els[i].setAttribute("aria-selected", "true");
      input.setAttribute("aria-activedescendant", els[i].id);
      els[i].scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }
  function pick(it) {
    if (!it) return;
    var input = $(".fx-input");
    var toks = input.value.split(/(\s+)/);
    if (it.kind === "feature") { closeSugg(); input.blur(); open(it.id); return; }
    toks.pop();
    if (it.kind === "path") st.path.push(it.id);
    else if (st.comps.indexOf(it.id) < 0) st.comps.push(it.id);
    st.text = toks.join("").replace(/^\s+/, "");
    input.value = st.text;
    status("");
    paintChips();
    update(true);
    openSugg();
  }

  function onKey(e) {
    var input = $(".fx-input");
    if (e.key === "ArrowDown") { e.preventDefault(); if (!sugg.open) openSugg(); else setActive(Math.min(sugg.items.length - 1, sugg.active + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(0, sugg.active - 1)); }
    else if (e.key === "Tab" && !e.shiftKey && sugg.open && sugg.items[sugg.active] && sugg.items[sugg.active].kind !== "feature" && input.value) {
      e.preventDefault();
      pick(sugg.items[sugg.active]);
    }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (sugg.open && sugg.items[sugg.active]) pick(sugg.items[sugg.active]);
      else if (results.length) { closeSugg(); input.blur(); open(results[0].f.id); }
    }
    else if (e.key === "Backspace" && !input.value) {
      if (st.comps.length) st.comps.pop();
      else if (st.path.length) st.path.pop();
      else return;
      e.preventDefault();
      paintChips();
      update(true);
      openSugg();
    }
    else if (e.key === "Escape") {
      e.preventDefault();
      if (sugg.open) closeSugg();
      else if (input.value) { input.value = ""; st.text = ""; update(false); }
      else input.blur();
    }
  }

  function onPageKey(e) {
    if (!root || !A().isShown(root) || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || A().isTyping(e.target)) return;
    var i = st.sel ? indexOf(st.sel) : -1;
    if (e.key === "j" || e.key === "k") {
      if (!results.length) return;
      e.preventDefault();
      var n = e.key === "j" ? Math.min(results.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
      open(results[n].f.id, true);
    } else if (e.key === "v") { e.preventDefault(); setView(st.view === "cards" ? "list" : "cards"); }
    else if (e.key === "a" && st.sel && window.AtlasViews.arch) { e.preventDefault(); A().go("#arch/feature/" + st.sel); }
    else if (e.key === "\\") { e.preventDefault(); setFolded(!st.folded); }
    else if (e.key === "Escape") {
      if (st.sel) { e.preventDefault(); close(); }
      else if (st.comps.length || st.path.length || st.text) { e.preventDefault(); st.comps = []; st.path = []; st.text = ""; $(".fx-input").value = ""; paintChips(); update(true); }
    }
  }

  /* ---------- view API ---------- */

  function route(parts, query) {
    if (!root || !$(".fx-grid")) return;
    query = query || {};
    if (query.view === "cards" || query.view === "list") st.view = query.view;
    var q = query.q || "";
    if (q !== serialize()) {
      loadQuery(q);
      $(".fx-input").value = st.text;
      paintChips();
    }
    var id = parts[0] || null;
    // Old links: #features/<groupId> scopes to that group.
    if (id && !feature(id) && group(id)) { st.path = [id]; paintChips(); id = null; }
    st.sel = id && feature(id) ? id : null;
    compute();
    $$(".fx-seg button").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-v") === st.view ? "true" : "false"); });
    paintRail();
    paintResults();
    paintInspector();
    markSel();
    if (st.sel && window.innerWidth >= 1280 && st.folded) setFolded(false, true);
  }

  function search(query) {
    var ws = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!ws.length) return [];
    var out = [];
    (D().features || []).forEach(function (f) {
      var m = match(f, ws);
      if (m) out.push({ title: f.title, hint: "Feature, " + pathLabel(f), hash: "#features/" + f.id, score: m.score });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.map(function (r) { return { title: r.title, hint: r.hint, hash: r.hash }; });
  }

  window.AtlasViews = window.AtlasViews || {};
  window.AtlasViews.features = { label: "Features", mount: mount, route: route, search: search };
})();
