/* Atlas: Architecture view.
 *
 * A workbench (diagram tabs, the map, a detail sidebar and the flow picker) above a list
 * of flows and an index of every component.
 *
 * Routes:
 *   #arch                         first diagram
 *   #arch/<nodeId>                component details
 *   #arch/diagram/<id>[?focus=a,b]
 *   #arch/flow/<id>[/<step>]      a flow lit up on the map, with its steps in the sidebar
 *   #arch/feature/<id>            a feature's components lit up (needs data/features.js)
 *
 * Keys while the view is shown: / focuses the flow picker, Esc closes the sidebar.
 * Needs core.js and diagram.js.
 */
(function () {
  "use strict";

  var root = null;
  var dg = null; // diagram handle
  var current = null; // diagram id on screen
  var sel = { node: null, flow: null, step: null, feature: null }; // what the sidebar shows
  var collapsed = false; // sidebar folded to a rail, selection kept
  var maxed = false; // CSS fullscreen fallback
  var listMode = "cards";
  var picker = null;

  function A() { return window.Atlas; }
  function esc(s) { return A().esc(s); }
  function md(s) { return A().md(s || ""); }
  function refLink(r) { return A().refLink(r); }
  function go(h) { A().go(h); }
  function arch() { return A().arch(); }
  function node(id) { return A().node(id); }
  function diagram(id) { return A().diagram(id); }
  function flow(id) { return A().flow(id); }
  function color(layer) { return A().layerColor(layer); }
  function layerTitle(id) { return A().layer(id).title; }
  function $(q) { return root.querySelector(q); }
  function $$(q) { return Array.prototype.slice.call(root.querySelectorAll(q)); }

  function diagramsWith(nid) {
    return (arch().diagrams || []).filter(function (d) { return (d.nodes || []).indexOf(nid) >= 0; });
  }
  function flowsWith(nid) {
    return (arch().flows || []).filter(function (f) { return (f.steps || []).some(function (s) { return s.node === nid; }); });
  }
  function slug(s) { return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function humanize(s) { s = String(s || "").replace(/[-_]+/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ---------- flow groups ---------- */

  // A tree of groups from flows[].group ("delivery/retries"). Titles come from
  // ATLAS_ARCH.flowGroups ({ id: "delivery/retries", title, blurb }) when given.
  function flowTree() {
    var meta = {};
    (arch().flowGroups || []).forEach(function (g) { meta[g.id] = g; });
    var top = { kind: "group", id: "", path: "", title: "All flows", groups: [], flows: [] };
    (arch().flows || []).forEach(function (f) {
      var segs = String(f.group || "").split("/").map(function (s) { return s.trim(); }).filter(Boolean);
      var at = top;
      segs.forEach(function (seg) {
        var path = at.path ? at.path + "/" + seg : seg;
        var next = at.groups.filter(function (g) { return g.id === seg; })[0];
        if (!next) {
          var m = meta[path] || meta[seg] || {};
          next = { kind: "group", id: seg, path: path, title: m.title || humanize(seg), blurb: m.blurb || "", groups: [], flows: [], parent: at };
          at.groups.push(next);
        }
        at = next;
      });
      at.flows.push(f);
    });
    return top;
  }
  function groupOf(f, tree) {
    var segs = String(f.group || "").split("/").filter(Boolean);
    var at = tree;
    segs.forEach(function (seg) { at = at.groups.filter(function (g) { return g.id === seg; })[0] || at; });
    return at;
  }
  function allFlowsUnder(g) {
    var out = g.flows.slice();
    g.groups.forEach(function (c) { out = out.concat(allFlowsUnder(c)); });
    return out;
  }
  function flowPath(f) { return (f.group ? String(f.group).replace(/^\/|\/$/g, "") + "/" : "") + f.id; }
  function groupTrail(g) {
    var out = [];
    while (g && g.path) { out.unshift(g); g = g.parent; }
    return out;
  }

  /* ---------- styles ---------- */

  function injectStyle() {
    if (document.getElementById("atlas-arch-style")) return;
    var css = [
      ".fa{display:flex;flex-direction:column;gap:20px}",
      ".fa h2,.fa h3,.fa h4{margin:0}",
      ".fa-intro{color:var(--muted);margin:4px 0 0;max-width:80ch}",
      ".fa-bench{display:flex;flex-direction:column;gap:12px;background:var(--bg)}",
      ".fa-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}",
      ".fa-tabs{display:flex;flex-wrap:wrap;gap:6px;flex:1;min-width:0}",
      ".fa-tab{font:inherit;font-size:14px;padding:6px 12px;color:var(--muted);background:var(--panel);border:1px solid var(--line);border-radius:var(--radius,6px);cursor:pointer}",
      ".fa-tab:hover{color:var(--text);border-color:var(--accent)}",
      ".fa-tab[aria-selected=true]{color:var(--on-accent,var(--bg));background:var(--accent);border-color:var(--accent);font-weight:600}",
      ".fa button:focus-visible,.fa a:focus-visible,.fa input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}",
      ".fa-tools{display:flex;gap:6px;margin-left:auto}",
      ".fa-dsum{margin:0;color:var(--muted);max-width:110ch}",
      /* stage: map + sidebar */
      ".fa-stage{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-items:stretch;height:var(--fa-h,640px)}",
      ".fa-stage.fa-open{grid-template-columns:minmax(0,1fr) var(--fa-pw,clamp(340px,27vw,520px))}",
      ".fa-stage.fa-open.fa-folded{grid-template-columns:minmax(0,1fr) 44px}",
      ".fa-canvas{min-height:0;height:100%}",
      ".fa-panel{display:none;flex-direction:column;min-height:0;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius,6px);overflow:hidden}",
      ".fa-stage.fa-open .fa-panel{display:flex}",
      ".fa-phead{display:flex;align-items:flex-start;gap:8px;padding:14px 14px 10px 16px;border-bottom:1px solid var(--line)}",
      ".fa-phead h3{font-size:18px;line-height:1.3;color:var(--text);margin-top:6px}",
      ".fa-ptitle{flex:1;min-width:0}",
      ".fa-pbtn{font:inherit;font-size:16px;line-height:1;width:32px;height:32px;flex:none;color:var(--muted);background:transparent;border:1px solid var(--line);border-radius:var(--radius,6px);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}",
      ".fa-pbtn:hover{color:var(--accent);border-color:var(--accent)}",
      ".fa-pbody{padding:12px 16px 18px;overflow:auto;flex:1}",
      ".fa-pbody h4{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:16px 0 6px;font-weight:600}",
      ".fa-rail{display:none;flex-direction:column;align-items:center;gap:10px;padding:8px 0;height:100%}",
      ".fa-folded .fa-phead,.fa-folded .fa-pbody{display:none}",
      ".fa-folded .fa-rail{display:flex}",
      ".fa-rail span{writing-mode:vertical-rl;transform:rotate(180deg);font-size:13px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-height:80%}",
      ".fa-sum{color:var(--text);font-weight:600;margin:8px 0}",
      ".fa-badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--text);",
      "padding:2px 8px;border:1px solid var(--fa-c);border-radius:3px;background:color-mix(in srgb,var(--fa-c) 16%,transparent)}",
      ".fa-badge::before{content:'';width:8px;height:8px;border-radius:2px;background:var(--fa-c)}",
      ".fa-back{display:flex;align-items:center;gap:6px;font-size:13px;margin:0 0 6px}",
      ".fa-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}",
      ".fa-list a{word-break:break-word}",
      ".fa-chips{display:flex;flex-wrap:wrap;gap:6px}",
      ".fa-chip{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:13px;padding:3px 9px;color:var(--text);text-decoration:none;",
      "background:var(--panel-2);border:1px solid var(--line);border-left:3px solid var(--fa-c,var(--accent));border-radius:3px;cursor:pointer}",
      ".fa-chip:hover{border-color:var(--accent);border-left-color:var(--fa-c,var(--accent))}",
      ".fa-chip small{color:var(--muted);font-size:12px}",
      /* fullscreen */
      ".fa-bench:fullscreen{padding:16px;overflow:auto}",
      ".fa-bench.fa-max{position:fixed;inset:0;z-index:60;padding:16px;overflow:auto}",
      ".fa-bench:fullscreen .fa-stage,.fa-bench.fa-max .fa-stage{height:auto;flex:1;min-height:320px}",
      ".fa-bench:fullscreen,.fa-bench.fa-max{display:flex;flex-direction:column}",
      /* flow picker */
      ".fa-pick{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}",
      ".fa-field{position:relative;flex:1;min-width:min(100%,420px);display:flex;align-items:center;gap:6px;padding:4px 8px;",
      "background:var(--panel);border:1px solid var(--line);border-radius:var(--radius,6px)}",
      ".fa-field:focus-within{border-color:var(--accent)}",
      ".fa-field input{flex:1;min-width:120px;font:inherit;font-family:var(--font-mono,ui-monospace,monospace);font-size:14px;color:var(--text);background:transparent;border:0;padding:6px 2px}",
      ".fa-field input:focus{outline:none}",
      ".fa-field .fa-lead{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);white-space:nowrap}",
      ".fa-crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:4px;font-size:13px}",
      ".fa-crumb{font:inherit;font-size:13px;padding:2px 8px;color:var(--text);background:var(--panel-2);border:1px solid var(--line);border-radius:999px;cursor:pointer}",
      ".fa-crumb:hover{border-color:var(--accent)}",
      ".fa-crumbs i{color:var(--muted);font-style:normal}",
      ".fa-sugg{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:30;margin:0;padding:6px;list-style:none;max-height:min(50vh,420px);overflow:auto;",
      "background:var(--panel);border:1px solid var(--accent);border-radius:var(--radius,6px);box-shadow:var(--shadow,0 8px 24px rgba(0,0,0,.3))}",
      ".fa-sugg[hidden]{display:none}",
      ".fa-sugg .fa-sh{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:6px 8px 2px}",
      ".fa-sugg .fa-so{display:grid;grid-template-columns:auto 1fr auto;align-items:baseline;gap:4px 10px;padding:6px 8px;border-radius:4px;cursor:pointer}",
      ".fa-sugg .fa-so[aria-selected=true]{background:var(--panel-2);outline:1px solid var(--accent)}",
      ".fa-so .k{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);min-width:56px}",
      ".fa-so .t{color:var(--text);min-width:0}",
      ".fa-so .t small{display:block;color:var(--muted);font-size:12px;line-height:1.35}",
      ".fa-so .h{font-family:var(--font-mono,ui-monospace,monospace);font-size:12px;color:var(--muted)}",
      ".fa-sugg .fa-none{padding:8px;color:var(--muted)}",
      ".fa-hint{font-size:12px;color:var(--muted);width:100%}",
      ".fa-hint.fa-err{color:var(--warn)}",
      ".fa-seg{display:inline-flex;border:1px solid var(--line);border-radius:var(--radius,6px);overflow:hidden}",
      ".fa-seg button{font:inherit;font-size:13px;padding:6px 10px;color:var(--muted);background:var(--panel);border:0;cursor:pointer}",
      ".fa-seg button[aria-pressed=true]{color:var(--text);background:var(--panel-2);box-shadow:inset 0 -2px 0 var(--accent)}",
      /* flows */
      ".fa-section{display:flex;flex-direction:column;gap:10px}",
      ".fa-shead{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 16px}",
      ".fa-count{color:var(--muted);font-size:13px}",
      ".fa-gtitle{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:10px 0 0}",
      ".fa-flows{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,460px),1fr));gap:12px}",
      ".fa-flow{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius,6px);padding:14px 16px;scroll-margin-top:72px}",
      ".fa-flow.fa-target{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}",
      ".fa-fhead{display:flex;align-items:baseline;gap:10px;margin:0 0 8px}",
      ".fa-fhead button{font:inherit;font-size:16px;font-weight:600;color:var(--text);background:none;border:0;padding:0;text-align:left;cursor:pointer}",
      ".fa-fhead button:hover{color:var(--accent)}",
      ".fa-fhead small{color:var(--muted);font-family:var(--font-mono,ui-monospace,monospace);font-size:12px}",
      ".fa-fsum{margin:-2px 0 8px;color:var(--muted);font-size:14px}",
      ".fa-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}",
      ".fa-step{display:grid;grid-template-columns:28px 1fr;gap:8px;width:100%;text-align:left;font:inherit;color:var(--text);background:transparent;",
      "border:1px solid transparent;border-radius:4px;padding:6px;cursor:pointer}",
      ".fa-step:hover{background:var(--panel-2);border-color:var(--line)}",
      ".fa-step.fa-on{border-color:var(--accent);background:var(--panel-2)}",
      ".fa-step.fa-off{opacity:.7}",
      ".fa-num{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;font-size:12px;font-weight:700;",
      "color:var(--bg);background:var(--fa-c,var(--accent))}",
      ".fa-stext{display:flex;flex-direction:column;gap:2px;min-width:0}",
      ".fa-stext b{font-size:13px;color:var(--muted);font-weight:600}",
      ".fa-stext span{font-size:14px;line-height:1.45}",
      ".fa-srefs{font-size:12px;display:flex;flex-wrap:wrap;gap:4px 10px;padding:0 0 4px 42px}",
      ".fa-rows{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:var(--radius,6px);overflow:hidden}",
      ".fa-row{display:grid;grid-template-columns:minmax(220px,1.2fr) minmax(0,2fr) 70px;gap:12px;align-items:center;padding:9px 14px;",
      "background:var(--panel);border:0;border-top:1px solid var(--line);font:inherit;color:var(--text);text-align:left;cursor:pointer}",
      ".fa-row:first-child{border-top:0}",
      ".fa-row:hover{background:var(--panel-2)}",
      ".fa-row.fa-target{box-shadow:inset 3px 0 0 var(--accent);background:var(--panel-2)}",
      ".fa-row b{font-weight:600}",
      ".fa-row small{display:block;color:var(--muted);font-family:var(--font-mono,ui-monospace,monospace);font-size:12px}",
      ".fa-row .fa-chips{gap:4px}",
      ".fa-row .fa-chip{font-size:12px;padding:1px 7px;pointer-events:none}",
      ".fa-row .n{color:var(--muted);font-size:13px;text-align:right}",
      /* index */
      ".fa-index{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr));gap:12px}",
      ".fa-group{background:var(--panel);border:1px solid var(--line);border-top:3px solid var(--fa-c);border-radius:var(--radius,6px);padding:12px 14px}",
      ".fa-group h4{font-size:15px;color:var(--text);margin:0 0 2px}",
      ".fa-group p.fa-gb{margin:0 0 8px;font-size:13px;color:var(--muted)}",
      ".fa-group ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}",
      ".fa-group a{color:var(--text);text-decoration:none;font-weight:600}",
      ".fa-group a:hover{color:var(--accent);text-decoration:underline}",
      ".fa-group li span{display:block;font-size:13px;color:var(--muted);line-height:1.4}",
      ".fa-empty{color:var(--muted)}",
      "@media (max-width:640px){.fa-tabs{flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px}.fa-tab{flex:none;font-size:13px;padding:6px 10px}",
      ".fa-row{grid-template-columns:1fr 50px}.fa-row .fa-chips{display:none}}",
      "@media (max-width:860px){",
      ".fa-stage,.fa-stage.fa-open,.fa-stage.fa-open.fa-folded{grid-template-columns:minmax(0,1fr);height:62vh}",
      ".fa-panel{position:fixed;left:0;right:0;bottom:0;z-index:70;max-height:58vh;border-radius:12px 12px 0 0;border-bottom:none;box-shadow:0 -8px 30px rgba(0,0,0,.35)}",
      ".fa-folded .fa-panel{max-height:48px}",
      ".fa-folded .fa-rail{flex-direction:row;justify-content:space-between;padding:6px 12px}",
      ".fa-rail span{writing-mode:horizontal-tb;transform:none}",
      "}",
      "@media (prefers-reduced-motion:no-preference){.fa-panel{animation:fa-in .18s ease-out}}",
      "@keyframes fa-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}"
    ].join("\n");
    var st = document.createElement("style");
    st.id = "atlas-arch-style";
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------- static parts ---------- */

  var ICON = {
    full: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    exit: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    fold: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    unfold: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>'
  };

  function tabsHtml() {
    return (arch().diagrams || []).map(function (d) {
      return '<button type="button" class="fa-tab" role="tab" aria-selected="false" data-d="' + esc(d.id) + '">' + esc(d.title) + "</button>";
    }).join("");
  }

  function indexHtml() {
    var ns = arch().nodes || [];
    var known = {};
    var out = A().layers().map(function (l) {
      known[l.id] = true;
      var items = ns.filter(function (n) { return n.layer === l.id; });
      return groupCard(l, items);
    });
    var rest = ns.filter(function (n) { return !known[n.layer]; });
    if (rest.length) out.push(groupCard({ id: "other", title: "Other", blurb: "" }, rest));
    return out.join("");
  }
  function groupCard(l, items) {
    if (!items.length) return "";
    return '<section class="fa-group" style="--fa-c:' + color(l.id) + '"><h4>' + esc(l.title) + "</h4>" + (l.blurb ? '<p class="fa-gb">' + esc(l.blurb) + "</p>" : "") + "<ul>" +
      items.map(function (n) {
        return '<li><a href="#arch/' + esc(n.id) + '">' + esc(n.title) + "</a><span>" + esc(n.summary || "") + "</span></li>";
      }).join("") + "</ul></section>";
  }

  function stepHtml(f, s, i) {
    var n = node(s.node);
    var refs = (s.refs || []).length ? '<div class="fa-srefs">' + s.refs.map(refLink).join("") + "</div>" : "";
    var on = sel.flow === f.id && sel.step === i;
    var off = current && diagram(current) && diagram(current).nodes.indexOf(s.node) < 0 && sel.flow === f.id;
    return '<li><button type="button" class="fa-step' + (on ? " fa-on" : "") + (off ? " fa-off" : "") + '" data-flow="' + esc(f.id) + '" data-i="' + i + '" style="--fa-c:' + (n ? color(n.layer) : "var(--accent)") + '">' +
      '<span class="fa-num">' + (i + 1) + "</span>" +
      '<span class="fa-stext"><b>' + esc(n ? n.title : s.node) + "</b><span>" + A().mdInline(s.text) + "</span></span></button>" + refs + "</li>";
  }

  /* ---------- mount ---------- */

  function mount(el) {
    root = el;
    injectStyle();
    try { listMode = localStorage.getItem(A().storageKey("flow-view")) || "cards"; } catch (e) {}
    var a = arch();
    el.innerHTML =
      '<div class="fa">' +
      '<header class="view-head"><h2>Architecture</h2>' +
      '<p class="fa-intro">' + A().mdInline(a.intro || "Pick a diagram, then click a box to read how that part works and where it is in the code. Pick a flow below the map to light up its path.") + "</p></header>" +
      '<div class="fa-bench">' +
      '<div class="fa-bar"><div class="fa-tabs" role="tablist" aria-label="Diagrams">' + tabsHtml() + "</div>" +
      '<div class="fa-tools"><button type="button" class="btn fa-full" aria-pressed="false">' + ICON.full + " <span>Fullscreen</span></button></div></div>" +
      '<p class="fa-dsum"></p>' +
      '<div class="fa-stage">' +
      '<div class="fa-canvas" role="region" aria-label="Diagram"></div>' +
      '<aside class="fa-panel" aria-label="Details">' +
      '<div class="fa-phead"><div class="fa-ptitle"><span class="fa-badge"></span><h3></h3></div>' +
      '<button type="button" class="fa-pbtn fa-fold" aria-label="Collapse the sidebar, keep the selection" title="Collapse (keeps the selection)">' + ICON.fold + "</button>" +
      '<button type="button" class="fa-pbtn fa-close" aria-label="Close and clear the selection" title="Close">&times;</button></div>' +
      '<div class="fa-pbody"></div>' +
      '<div class="fa-rail"><button type="button" class="fa-pbtn fa-unfold" aria-label="Expand the sidebar" title="Expand">' + ICON.unfold + "</button><span></span>" +
      '<button type="button" class="fa-pbtn fa-close" aria-label="Close and clear the selection" title="Close">&times;</button></div>' +
      "</aside></div>" +
      '<div class="fa-pick">' +
      '<div class="fa-field"><span class="fa-lead">Flow</span><input type="text" class="fa-input" autocomplete="off" spellcheck="false" ' +
      'placeholder="Type a flow, or a group and / to dig down" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-label="Pick a flow">' +
      '<kbd aria-hidden="true">/</kbd><ul class="fa-sugg" role="listbox" hidden></ul></div>' +
      '<div class="fa-crumbs" aria-label="Flow path"></div>' +
      '<p class="fa-hint"></p></div>' +
      "</div>" +
      '<section class="fa-section" aria-labelledby="fa-flows-h"><div class="fa-shead"><h3 id="fa-flows-h">Flows</h3><span class="fa-count"></span>' +
      '<span class="fa-seg" role="group" aria-label="Flow layout" style="margin-left:auto"><button type="button" data-mode="cards">Cards</button><button type="button" data-mode="list">List</button></span></div>' +
      '<div class="fa-flowlist"></div></section>' +
      '<section class="fa-section" aria-labelledby="fa-index-h"><h3 id="fa-index-h">All components</h3>' +
      '<div class="fa-index">' + indexHtml() + "</div></section>" +
      "</div>";

    $(".fa-tabs").addEventListener("click", function (ev) {
      var b = ev.target.closest(".fa-tab");
      if (b) go("#arch/diagram/" + b.getAttribute("data-d"));
    });
    $(".fa-tabs").addEventListener("keydown", function (ev) {
      if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
      var tabs = $$(".fa-tab");
      var i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      var n = tabs[(i + (ev.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      n.focus();
      n.click();
    });
    $$(".fa-close").forEach(function (b) { b.addEventListener("click", function () { clearSelection(true); }); });
    $(".fa-fold").addEventListener("click", function () { setFolded(true); });
    $(".fa-unfold").addEventListener("click", function () { setFolded(false); });
    $(".fa-full").addEventListener("click", toggleFull);
    $(".fa-panel").addEventListener("click", function (ev) {
      var st = ev.target.closest(".fa-step");
      if (st) { go("#arch/flow/" + st.getAttribute("data-flow") + "/" + (+st.getAttribute("data-i") + 1)); return; }
      var c = ev.target.closest("[data-node]");
      if (c) { ev.preventDefault(); go("#arch/" + c.getAttribute("data-node")); }
    });
    $(".fa-flowlist").addEventListener("click", function (ev) {
      var st = ev.target.closest(".fa-step");
      if (st) { go("#arch/flow/" + st.getAttribute("data-flow") + "/" + (+st.getAttribute("data-i") + 1)); return; }
      var f = ev.target.closest("[data-pick]");
      if (f) go("#arch/flow/" + f.getAttribute("data-pick"));
    });
    $(".fa-seg").addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      listMode = b.getAttribute("data-mode");
      try { localStorage.setItem(A().storageKey("flow-view"), listMode); } catch (e) {}
      renderFlows();
    });
    picker = setupPicker();
    document.addEventListener("fullscreenchange", paintFull);
    window.addEventListener("resize", function () { if (root) fitHeight(); });
    document.addEventListener("keydown", function (ev) {
      if (!root || root.offsetParent === null && !document.fullscreenElement) return;
      var typing = /INPUT|TEXTAREA|SELECT/.test((ev.target && ev.target.tagName) || "");
      if (ev.key === "Escape" && !typing) {
        if (maxed) { toggleFull(); return; }
        if (sel.node || sel.flow || sel.feature) clearSelection(true);
      }
    });
    A().claimSlash(function () { return root && A().isShown(root) ? $(".fa-input") : null; });
    renderFlows();
  }

  /* ---------- fullscreen and sidebar ---------- */

  function isFull() { return maxed || document.fullscreenElement === $(".fa-bench"); }
  function toggleFull() {
    var bench = $(".fa-bench");
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (maxed) { maxed = false; bench.classList.remove("fa-max"); document.body.style.overflow = ""; paintFull(); return; }
    if (bench.requestFullscreen && document.fullscreenEnabled !== false) {
      bench.requestFullscreen().catch(function () { maxed = true; bench.classList.add("fa-max"); paintFull(); });
    } else {
      maxed = true;
      bench.classList.add("fa-max");
      document.body.style.overflow = "hidden";
      paintFull();
    }
  }
  function paintFull() {
    if (!root) return;
    var on = isFull();
    var b = $(".fa-full");
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.innerHTML = (on ? ICON.exit + " <span>Exit fullscreen</span>" : ICON.full + " <span>Fullscreen</span>");
    fitHeight();
    if (dg) setTimeout(function () { if (sel.flow) zoomFlow(); else if (sel.node && dg.has(sel.node)) dg.reveal(sel.node); else dg.fit(); }, 60);
  }

  function setFolded(on) {
    collapsed = on;
    $(".fa-stage").classList.toggle("fa-folded", on);
    if (!on) $(".fa-fold").focus(); else $(".fa-unfold").focus();
  }

  // Size the map to the diagram's shape on wide screens, within limits.
  function fitHeight() {
    var st = $(".fa-stage");
    if (isFull() || window.innerWidth <= 860) { st.style.removeProperty("--fa-h"); return; }
    if (!dg || !dg.bounds) return;
    var w = $(".fa-canvas").clientWidth || 1000;
    var h = Math.round((w * dg.bounds.h) / dg.bounds.w) + 60;
    var open = st.classList.contains("fa-open") && !collapsed;
    h = Math.max(open ? 560 : 420, Math.min(h, Math.round(window.innerHeight * 0.78), 900));
    st.style.setProperty("--fa-h", h + "px");
  }

  function setOpen(on) {
    $(".fa-stage").classList.toggle("fa-open", on);
    if (!on) { collapsed = false; $(".fa-stage").classList.remove("fa-folded"); }
    fitHeight();
  }

  /* ---------- diagram ---------- */

  function showDiagram(id, o) {
    o = o || {};
    var d = diagram(id) || (arch().diagrams || [])[0];
    if (!d) {
      $(".fa-canvas").innerHTML = '<p class="fa-empty" style="padding:16px">No diagrams yet.</p>';
      return;
    }
    $$(".fa-tab").forEach(function (t) {
      var on = t.getAttribute("data-d") === d.id;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
    });
    $(".fa-dsum").textContent = d.summary || "";
    if (current !== d.id || !dg) {
      if (dg) dg.destroy();
      current = d.id;
      dg = window.AtlasDiagram.render($(".fa-canvas"), d, {
        focus: o.focus,
        onNode: function (nid) { go("#arch/" + nid); }
      });
      fitHeight();
    } else if (o.focus && o.focus.length) {
      dg.zoomTo(o.focus);
    } else if (o.fit) {
      dg.fit();
    }
  }

  // The diagram that shows most of a list of nodes, preferring the one on screen.
  function bestDiagramFor(ids, prefer) {
    var best = null, bestN = -1;
    (arch().diagrams || []).forEach(function (d) {
      var c = ids.filter(function (i) { return d.nodes.indexOf(i) >= 0; }).length;
      if (c > bestN || (c === bestN && d.id === current)) { bestN = c; best = d; }
    });
    if (prefer && diagram(prefer)) {
      var p = diagram(prefer);
      if (ids.filter(function (i) { return p.nodes.indexOf(i) >= 0; }).length >= bestN) best = p;
    }
    return bestN > 0 ? best : null;
  }

  function paintFlowOnMap() {
    var f = flow(sel.flow);
    if (!f || !dg) return;
    var steps = f.steps || [];
    var ids = [], badges = {}, pairs = [];
    steps.forEach(function (s, i) {
      if (!dg.has(s.node)) return;
      if (ids.indexOf(s.node) < 0) ids.push(s.node);
      var b = badges[s.node] ? badges[s.node].split("·") : [];
      if (b.length < 3) b.push(String(i + 1)); else if (b[2] !== "…") b[2] = "…";
      badges[s.node] = b.join("·");
    });
    // Connect each step to the next step that is on this diagram.
    var on = steps.map(function (s) { return dg.has(s.node) ? s.node : null; }).filter(Boolean);
    for (var i = 0; i + 1 < on.length; i++) if (on[i] !== on[i + 1]) pairs.push([on[i], on[i + 1]]);
    dg.highlight(ids, { pairs: pairs, badges: badges });
    var stepNode = sel.step != null && steps[sel.step] ? steps[sel.step].node : null;
    dg.select(stepNode && dg.has(stepNode) ? stepNode : sel.node && dg.has(sel.node) ? sel.node : null);
  }

  function zoomFlow() {
    var f = flow(sel.flow);
    if (!f || !dg) return;
    var steps = f.steps || [];
    if (sel.step != null && steps[sel.step] && dg.has(steps[sel.step].node)) {
      dg.zoomTo([steps[sel.step].node], { maxZoom: 1.15 });
      return;
    }
    var ids = steps.map(function (s) { return s.node; }).filter(function (n) { return dg.has(n); });
    if (ids.length) dg.zoomTo(ids, { maxZoom: 1.1 });
  }

  /* ---------- sidebar content ---------- */

  function chip(id, extra) {
    var n = node(id);
    if (!n) return "";
    return '<a class="fa-chip" href="#arch/' + esc(id) + '" data-node="' + esc(id) + '" style="--fa-c:' + color(n.layer) + '">' + esc(n.title) +
      (extra ? " <small>" + esc(extra) + "</small>" : "") + "</a>";
  }

  function setHead(kind, colorVar, title) {
    var p = $(".fa-panel");
    var badge = p.querySelector(".fa-badge");
    badge.textContent = kind;
    badge.style.setProperty("--fa-c", colorVar);
    p.querySelector("h3").textContent = title;
    p.querySelector(".fa-rail span").textContent = title;
  }

  function nodeBody(nid) {
    var n = node(nid);
    var h = "";
    var f = sel.flow && flow(sel.flow);
    if (f) h += '<p class="fa-back"><a href="#arch/flow/' + esc(f.id) + '">&larr; Back to flow: ' + esc(f.title) + "</a></p>";
    if (n.summary) h += '<p class="fa-sum">' + esc(n.summary) + "</p>";
    if (n.body) h += '<div class="md">' + md(n.body) + "</div>";
    if (n.refs && n.refs.length) h += "<h4>Code</h4><ul class=\"fa-list\">" + n.refs.map(function (r) { return "<li>" + refLink(r) + "</li>"; }).join("") + "</ul>";
    if (n.docs && n.docs.length) {
      h += "<h4>Docs</h4><ul class=\"fa-list\">" + n.docs.map(function (d) {
        var path = typeof d === "string" ? d : d.path;
        var label = typeof d === "string" ? d.split("/").pop().replace(/\.md$/, "").replace(/^\d+-/, "").replace(/-/g, " ") : d.label || d.path;
        return "<li>" + refLink({ path: path, label: label }) + "</li>";
      }).join("") + "</ul>";
    }
    var edges = arch().edges || [];
    var ins = edges.filter(function (e) { return e.to === nid; });
    var outs = edges.filter(function (e) { return e.from === nid; });
    if (ins.length) h += "<h4>Receives from</h4><div class=\"fa-chips\">" + ins.map(function (e) { return chip(e.from, e.label); }).join("") + "</div>";
    if (outs.length) h += "<h4>Sends to</h4><div class=\"fa-chips\">" + outs.map(function (e) { return chip(e.to, e.label); }).join("") + "</div>";
    var fl = flowsWith(nid);
    if (fl.length) {
      h += "<h4>Flows through it</h4><div class=\"fa-chips\">" + fl.map(function (x) {
        var steps = [];
        x.steps.forEach(function (s, i) { if (s.node === nid) steps.push(i + 1); });
        return '<a class="fa-chip" href="#arch/flow/' + esc(x.id) + "/" + steps[0] + '">' + esc(x.title) + " <small>step " + steps.join(", ") + "</small></a>";
      }).join("") + "</div>";
    }
    var feats = (A().features().features || []).filter(function (x) { return (x.archNodes || []).indexOf(nid) >= 0; });
    if (feats.length && window.AtlasViews.features) {
      h += "<h4>Features that use it</h4><div class=\"fa-chips\">" + feats.map(function (x) {
        return '<a class="fa-chip" href="#features/' + esc(x.id) + '">' + esc(x.title) + "</a>";
      }).join("") + "</div>";
    }
    var ds = diagramsWith(nid).filter(function (d) { return d.id !== current; });
    if (ds.length) {
      h += "<h4>Also on</h4><div class=\"fa-chips\">" + ds.map(function (d) {
        return '<a class="fa-chip" href="#arch/diagram/' + esc(d.id) + "?focus=" + esc(nid) + '">' + esc(d.title) + "</a>";
      }).join("") + "</div>";
    }
    return h;
  }

  function feature(id) {
    var fs = A().features().features || [];
    for (var i = 0; i < fs.length; i++) if (fs[i].id === id) return fs[i];
    return null;
  }

  function featureBody(ft) {
    var ids = (ft.archNodes || []).filter(node);
    var off = ids.filter(function (id) { return !(dg && dg.has(id)); });
    var h = "";
    if (ft.summary) h += '<p class="fa-sum">' + esc(ft.summary) + "</p>";
    h += '<p class="fa-back"><a href="#features/' + esc(ft.id) + '">Open in Features &rarr;</a></p>';
    h += "<h4>Components</h4><div class=\"fa-chips\">" + ids.map(function (id) { return chip(id); }).join("") + "</div>";
    if (off.length) {
      h += '<p class="fa-count">Not on this diagram: ' + off.map(function (id) { return esc(node(id).title); }).join(", ") + ".</p>";
    }
    var fl = (ft.flows || []).map(flow).filter(Boolean);
    if (fl.length) {
      h += "<h4>Flows</h4><div class=\"fa-chips\">" + fl.map(function (x) {
        return '<a class="fa-chip" href="#arch/flow/' + esc(x.id) + '">' + esc(x.title) + "</a>";
      }).join("") + "</div>";
    }
    if (ft.refs && ft.refs.length) h += "<h4>Code</h4>" + A().refList(ft.refs);
    return h;
  }

  function flowBody(f) {
    var tree = flowTree();
    var trail = groupTrail(groupOf(f, tree));
    var h = "";
    if (trail.length) h += '<p class="fa-back">' + trail.map(function (g) { return esc(g.title); }).join(" / ") + "</p>";
    if (f.summary) h += '<p class="fa-sum">' + esc(f.summary) + "</p>";
    if (f.body) h += '<div class="md">' + md(f.body) + "</div>";
    var steps = f.steps || [];
    var missing = steps.filter(function (s) { return dg && !dg.has(s.node); }).length;
    h += "<h4>Steps</h4>";
    if (missing) h += '<p class="fa-count">' + missing + " of " + steps.length + " steps are not on this diagram. They are faded here; click one to see it on another diagram.</p>";
    h += '<ol class="fa-steps">' + steps.map(function (s, i) { return stepHtml(f, s, i); }).join("") + "</ol>";
    var touched = [];
    steps.forEach(function (s) { if (touched.indexOf(s.node) < 0) touched.push(s.node); });
    h += "<h4>Components</h4><div class=\"fa-chips\">" + touched.map(function (id) { return chip(id); }).join("") + "</div>";
    if (f.refs && f.refs.length) h += "<h4>Code</h4>" + A().refList(f.refs);
    return h;
  }

  function paintPanel() {
    var body = $(".fa-pbody");
    if (sel.node && node(sel.node)) {
      var n = node(sel.node);
      setHead(layerTitle(n.layer), color(n.layer), n.title);
      body.innerHTML = nodeBody(sel.node);
    } else if (sel.flow && flow(sel.flow)) {
      var f = flow(sel.flow);
      setHead("Flow", "var(--accent)", f.title);
      body.innerHTML = flowBody(f);
      var on = body.querySelector(".fa-step.fa-on");
      if (on) on.scrollIntoView({ block: "nearest" });
    } else if (sel.feature && feature(sel.feature)) {
      var ft = feature(sel.feature);
      setHead("Feature", "var(--accent-2)", ft.title);
      body.innerHTML = featureBody(ft);
    } else {
      setOpen(false);
      return;
    }
    if (!body.querySelector(".fa-step.fa-on")) body.scrollTop = 0;
    setOpen(true);
  }

  function clearSelection(nav) {
    sel = { node: null, flow: null, step: null, feature: null };
    setOpen(false);
    if (dg) { dg.highlight(null); dg.select(null); }
    markFlows();
    if (picker) picker.sync();
    if (nav) go("#arch/diagram/" + current);
  }

  /* ---------- flows list ---------- */

  function visibleFlows() {
    var st = picker ? picker.state() : null;
    var tree = flowTree();
    var g = st && st.group ? st.group : tree;
    var list = allFlowsUnder(g);
    if (st && st.filter) {
      list = list.filter(function (f) {
        return A().score(st.filter, [f.title, f.id, f.group, f.summary, (f.steps || []).map(function (s) { return s.text + " " + s.node; }).join(" ")]) > 0;
      });
    }
    return { group: g, flows: list, total: (arch().flows || []).length };
  }

  function renderFlows() {
    if (!root) return;
    $$(".fa-seg button").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-mode") === listMode ? "true" : "false"); });
    var v = visibleFlows();
    var host = $(".fa-flowlist");
    $(".fa-count").textContent = v.flows.length === v.total ? v.total + " flows" : v.flows.length + " of " + v.total + " flows" + (v.group.path ? " in " + v.group.title : "");
    if (!v.total) { host.innerHTML = '<p class="fa-empty">No flows yet.</p>'; return; }
    if (!v.flows.length) { host.innerHTML = '<p class="fa-empty">No flows match. Clear the flow picker to see them all.</p>'; return; }
    // Group the visible flows by their group path.
    var byGroup = [], idx = {};
    v.flows.forEach(function (f) {
      var key = f.group || "";
      if (!(key in idx)) { idx[key] = byGroup.length; byGroup.push({ key: key, flows: [] }); }
      byGroup[idx[key]].flows.push(f);
    });
    var tree = flowTree();
    var showHeads = byGroup.length > 1 || (byGroup[0] && byGroup[0].key);
    host.innerHTML = byGroup.map(function (b) {
      var head = showHeads ? '<h4 class="fa-gtitle">' + esc(b.key ? groupTrail(groupOf(b.flows[0], tree)).map(function (g) { return g.title; }).join(" / ") : "Other") + "</h4>" : "";
      if (listMode === "list") {
        return head + '<div class="fa-rows">' + b.flows.map(function (f) {
          var touched = [];
          (f.steps || []).forEach(function (s) { if (touched.indexOf(s.node) < 0) touched.push(s.node); });
          return '<button type="button" class="fa-row" data-pick="' + esc(f.id) + '" data-flowrow="' + esc(f.id) + '"><span><b>' + esc(f.title) + "</b><small>" + esc(flowPath(f)) + "</small></span>" +
            '<span class="fa-chips">' + touched.slice(0, 6).map(function (id) { var n = node(id); return n ? '<span class="fa-chip" style="--fa-c:' + color(n.layer) + '">' + esc(n.title) + "</span>" : ""; }).join("") +
            (touched.length > 6 ? '<span class="fa-count">+' + (touched.length - 6) + "</span>" : "") + "</span>" +
            '<span class="n">' + (f.steps || []).length + " steps</span></button>";
        }).join("") + "</div>";
      }
      return head + '<div class="fa-flows">' + b.flows.map(function (f) {
        return '<article class="fa-flow" data-flowrow="' + esc(f.id) + '"><div class="fa-fhead"><button type="button" data-pick="' + esc(f.id) + '">' + esc(f.title) + "</button><small>" + (f.steps || []).length + " steps</small></div>" +
          (f.summary ? '<p class="fa-fsum">' + esc(f.summary) + "</p>" : "") +
          '<ol class="fa-steps">' + (f.steps || []).map(function (s, i) { return stepHtml(f, s, i); }).join("") + "</ol></article>";
      }).join("") + "</div>";
    }).join("");
    markFlows();
  }

  function markFlows() {
    $$("[data-flowrow]").forEach(function (el) { el.classList.toggle("fa-target", el.getAttribute("data-flowrow") === sel.flow); });
    $$(".fa-flowlist .fa-step").forEach(function (b) {
      b.classList.toggle("fa-on", b.getAttribute("data-flow") === sel.flow && +b.getAttribute("data-i") === sel.step);
    });
  }

  /* ---------- flow picker ---------- */

  // The input holds a path: "group/subgroup/flow/step". Each part before a "/" must name
  // a child of the level before it (by id, title or a unique prefix). The text after the
  // last "/" filters the next level. Plain words with no "/" also search every flow and
  // component.
  function setupPicker() {
    var input = $(".fa-input");
    var list = $(".fa-sugg");
    var crumbs = $(".fa-crumbs");
    var hint = $(".fa-hint");
    var opts = [];
    var active = -1;
    var parsed = { trail: [], ctx: null, rest: "", error: null };

    function children(ctx) {
      if (ctx.kind === "group") {
        return ctx.groups.map(function (g) { return { kind: "group", key: g.id, title: g.title, sub: g.blurb || allFlowsUnder(g).length + " flows", obj: g }; })
          .concat(ctx.flows.map(function (f) { return { kind: "flow", key: f.id, title: f.title, sub: f.summary || "", obj: f }; }));
      }
      if (ctx.kind === "flow") {
        return (ctx.obj.steps || []).map(function (s, i) {
          var n = node(s.node);
          return { kind: "step", key: String(i + 1), title: (i + 1) + ". " + (n ? n.title : s.node), sub: s.text.replace(/`/g, ""), obj: { flow: ctx.obj, i: i } };
        });
      }
      return [];
    }
    function match(items, seg) {
      var s = seg.toLowerCase();
      var exact = items.filter(function (c) { return c.key.toLowerCase() === s || slug(c.title) === slug(seg) || c.title.toLowerCase() === s; });
      if (exact.length) return exact[0];
      var pre = items.filter(function (c) { return c.key.toLowerCase().indexOf(s) === 0 || c.title.toLowerCase().indexOf(s) === 0; });
      return pre.length === 1 ? pre[0] : null;
    }
    function parse(text) {
      var tree = flowTree();
      var segs = text.split("/");
      var rest = segs.pop();
      var ctx = { kind: "group", obj: tree, title: "All flows" };
      var trail = [];
      for (var i = 0; i < segs.length; i++) {
        var seg = segs[i].trim();
        if (!seg) continue;
        var c = match(children(ctx.kind === "group" ? ctx.obj : ctx), seg);
        if (!c) return { trail: trail, ctx: ctx, rest: rest, error: '"' + seg + '" is not a group or flow under ' + (trail.length ? trail[trail.length - 1].title : "the top level") + "." };
        var next = c.kind === "group" ? { kind: "group", obj: c.obj, title: c.title } : c.kind === "flow" ? { kind: "flow", obj: c.obj, title: c.title } : { kind: "step", obj: c.obj, title: c.title };
        trail.push(next);
        ctx = next;
        if (c.kind === "step") break;
      }
      return { trail: trail, ctx: ctx, rest: rest, error: null };
    }
    function pathOf(trail) {
      return trail.map(function (t) { return t.kind === "group" ? t.obj.id : t.kind === "flow" ? t.obj.id : String(t.obj.i + 1); }).join("/");
    }

    function compute() {
      parsed = parse(input.value);
      var out = [];
      if (parsed.error) return out;
      var ctx = parsed.ctx;
      var rest = parsed.rest.trim();
      if (ctx.kind === "step") return out;
      var kids = children(ctx.kind === "group" ? ctx.obj : ctx);
      var hits = kids.filter(function (c) { return !rest || A().score(rest, [c.key, c.title, c.sub]) > 0; });
      if (hits.length) out.push({ head: ctx.kind === "flow" ? "Steps in " + ctx.title : (parsed.trail.length ? "In " + ctx.title : "Groups and flows"), items: hits });
      if (rest && ctx.kind === "group") {
        var direct = {};
        kids.forEach(function (c) { if (c.kind === "flow") direct[c.key] = true; });
        var deep = allFlowsUnder(ctx.obj).filter(function (f) {
          return !direct[f.id] && A().score(rest, [f.title, f.id, f.summary, (f.steps || []).map(function (s) { return s.text; }).join(" ")]) > 0;
        }).map(function (f) { return { kind: "flow", key: f.id, title: f.title, sub: flowPath(f), obj: f, deep: true }; });
        if (deep.length) out.push({ head: "Flows further down", items: deep });
        if (!parsed.trail.length) {
          var comps = (arch().nodes || []).filter(function (n) { return A().score(rest, [n.title, n.id, n.summary]) > 0; }).slice(0, 6)
            .map(function (n) { return { kind: "component", key: n.id, title: n.title, sub: n.summary || "", obj: n }; });
          if (comps.length) out.push({ head: "Components", items: comps });
        }
      }
      return out;
    }

    function paintCrumbs() {
      var t = parsed.trail;
      crumbs.innerHTML = t.length ? '<button type="button" class="fa-crumb" data-cut="0">All</button>' + t.map(function (x, i) {
        return '<i aria-hidden="true">/</i><button type="button" class="fa-crumb" data-cut="' + (i + 1) + '">' + esc(x.kind === "step" ? "Step " + (x.obj.i + 1) : x.title) + "</button>";
      }).join("") : "";
      hint.classList.toggle("fa-err", !!parsed.error);
      hint.textContent = parsed.error || (t.length ? "Backspace after a / goes up one level. Enter picks the highlighted item." :
        "Type to search flows and components. Type a group and / to see what is inside it.");
    }

    function render(open) {
      var groups = compute();
      opts = [];
      var html = "";
      groups.forEach(function (g) {
        html += '<li class="fa-sh" role="presentation">' + esc(g.head) + "</li>";
        g.items.forEach(function (it) {
          var i = opts.length;
          opts.push(it);
          html += '<li class="fa-so" role="option" id="fa-so-' + i + '" data-i="' + i + '" aria-selected="false"><span class="k">' + esc(it.kind) + "</span>" +
            '<span class="t">' + esc(it.title) + (it.sub ? "<small>" + esc(it.sub) + "</small>" : "") + "</span>" +
            '<span class="h">' + (it.kind === "group" ? esc(it.key) + "/" : "") + "</span></li>";
        });
      });
      if (!opts.length && !parsed.error && parsed.ctx.kind !== "step") html = '<li class="fa-none" role="presentation">Nothing matches "' + esc(parsed.rest) + '".</li>';
      list.innerHTML = html;
      var show = open && document.activeElement === input && html !== "";
      list.hidden = !show;
      input.setAttribute("aria-expanded", show ? "true" : "false");
      setActive(opts.length ? 0 : -1);
      paintCrumbs();
      renderFlows();
    }
    function setActive(i) {
      var els = list.querySelectorAll(".fa-so");
      Array.prototype.forEach.call(els, function (e) { e.setAttribute("aria-selected", "false"); });
      active = i;
      if (i >= 0 && els[i]) {
        els[i].setAttribute("aria-selected", "true");
        input.setAttribute("aria-activedescendant", els[i].id);
        els[i].scrollIntoView({ block: "nearest" });
      } else input.removeAttribute("aria-activedescendant");
    }
    function choose(it) {
      if (!it) return;
      var base = parsed.trail;
      if (it.kind === "group") {
        input.value = (pathOf(base) ? pathOf(base) + "/" : "") + it.key + "/";
        render(true);
        return;
      }
      if (it.kind === "component") {
        input.value = "";
        render(false);
        input.blur();
        go("#arch/" + it.key);
        return;
      }
      if (it.kind === "flow") {
        input.value = flowPath(it.obj) + "/";
        render(true);
        go("#arch/flow/" + it.obj.id);
        return;
      }
      if (it.kind === "step") {
        input.value = flowPath(it.obj.flow) + "/" + (it.obj.i + 1);
        render(false);
        go("#arch/flow/" + it.obj.flow.id + "/" + (it.obj.i + 1));
      }
    }

    input.addEventListener("input", function () { render(true); });
    input.addEventListener("focus", function () { render(true); });
    input.addEventListener("blur", function () { setTimeout(function () { list.hidden = true; input.setAttribute("aria-expanded", "false"); }, 120); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); if (list.hidden) render(true); else setActive(Math.min(opts.length - 1, active + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(0, active - 1)); }
      else if (e.key === "Enter") {
        e.preventDefault();
        if (opts[active]) choose(opts[active]);
        else if (!parsed.error && parsed.ctx.kind === "flow") go("#arch/flow/" + parsed.ctx.obj.id);
      }
      else if (e.key === "Tab" && !e.shiftKey && opts[active] && input.value && !list.hidden) { e.preventDefault(); choose(opts[active]); }
      else if (e.key === "Backspace" && input.selectionStart === input.value.length && /\/$/.test(input.value) && input.selectionStart === input.selectionEnd) {
        // Go up one level: drop the last whole segment.
        e.preventDefault();
        var segs = input.value.replace(/\/$/, "").split("/");
        segs.pop();
        input.value = segs.length ? segs.join("/") + "/" : "";
        render(true);
      }
      else if (e.key === "Escape") {
        e.preventDefault();
        if (!list.hidden) { list.hidden = true; input.setAttribute("aria-expanded", "false"); }
        else if (input.value) { input.value = ""; render(false); }
        else input.blur();
      }
    });
    list.addEventListener("mousedown", function (e) { e.preventDefault(); });
    list.addEventListener("click", function (e) {
      var o = e.target.closest(".fa-so");
      if (o) choose(opts[+o.getAttribute("data-i")]);
    });
    crumbs.addEventListener("click", function (e) {
      var b = e.target.closest(".fa-crumb");
      if (!b) return;
      var cut = +b.getAttribute("data-cut");
      var t = parsed.trail.slice(0, cut);
      input.value = t.length ? pathOf(t) + "/" : "";
      input.focus();
      render(true);
    });
    paintCrumbs();

    return {
      state: function () {
        var g = null;
        for (var i = parsed.trail.length - 1; i >= 0; i--) if (parsed.trail[i].kind === "group") { g = parsed.trail[i].obj; break; }
        var filter = parsed.ctx && parsed.ctx.kind === "group" && !parsed.error ? parsed.rest.trim() : "";
        return { group: g, filter: filter };
      },
      // Show the selected flow's path in the input without opening suggestions.
      sync: function () {
        if (document.activeElement === input) return;
        var f = sel.flow && flow(sel.flow);
        input.value = f ? flowPath(f) + "/" + (sel.step != null ? String(sel.step + 1) : "") : "";
        parsed = parse(input.value);
        paintCrumbs();
        renderFlows();
      }
    };
  }

  /* ---------- routing ---------- */

  function parseFocus(parts, query) {
    var id = parts[1] || "";
    var focus = query && query.focus ? query.focus.split(",") : null;
    var q = id.indexOf("?");
    if (q >= 0) {
      var qs = id.slice(q + 1);
      id = id.slice(0, q);
      qs.split("&").forEach(function (kv) {
        var p = kv.split("=");
        if (p[0] === "focus" && p[1]) focus = decodeURIComponent(p[1]).split(",");
      });
    }
    if (focus) focus = focus.map(function (s) { return s.trim(); }).filter(Boolean);
    return { id: id, focus: focus };
  }

  function route(parts, query) {
    if (!root) return;
    parts = (parts || []).filter(function (p) { return p !== ""; });
    var head = (parts[0] || "").split("?")[0];

    if (!head) {
      clearSelection(false);
      showDiagram(current || ((arch().diagrams || [])[0] || {}).id);
      return;
    }
    if (head === "diagram") {
      var p = parseFocus(parts, query);
      var keepNode = sel.node && p.focus && p.focus.length === 1 && p.focus[0] === sel.node;
      if (!keepNode) clearSelection(false);
      showDiagram(p.id, { focus: p.focus, fit: !p.focus });
      if (keepNode) { dg.select(sel.node); paintPanel(); }
      return;
    }
    if (head === "flow") {
      var f = flow(parts[1]);
      if (!f) { showDiagram(current); return; }
      var step = parts[2] ? parseInt(parts[2], 10) - 1 : null;
      if (step != null && (isNaN(step) || !f.steps[step])) step = null;
      var sameFlow = sel.flow === f.id;
      sel = { node: null, flow: f.id, step: step, feature: null };
      var ids = (f.steps || []).map(function (s) { return s.node; });
      var d = null;
      if (step != null) {
        // Stay on this diagram if it shows the step, else use the diagram with the
        // step's node that shows most of the flow.
        var stepNode = f.steps[step].node;
        if (dg && dg.has(stepNode)) d = diagram(current);
        else d = diagramsWith(stepNode).sort(function (a, b) {
          var cover = function (x) { return ids.filter(function (i) { return x.nodes.indexOf(i) >= 0; }).length; };
          return cover(b) - cover(a);
        })[0] || null;
      }
      if (!d) d = sameFlow && current ? diagram(current) : bestDiagramFor(ids, f.diagram);
      if (d) showDiagram(d.id);
      paintFlowOnMap();
      paintPanel();
      zoomFlow();
      markFlows();
      if (picker) picker.sync();
      return;
    }
    if (head === "feature") {
      var ft = feature(parts[1]);
      if (!ft) { showDiagram(current); return; }
      var fids = (ft.archNodes || []).filter(node);
      sel = { node: null, flow: null, step: null, feature: ft.id };
      var fd = bestDiagramFor(fids);
      if (fd) showDiagram(fd.id); else showDiagram(current);
      if (dg) {
        var on = fids.filter(function (id) { return dg.has(id); });
        var pairs = (arch().edges || []).filter(function (e) { return on.indexOf(e.from) >= 0 && on.indexOf(e.to) >= 0; }).map(function (e) { return [e.from, e.to]; });
        dg.highlight(on, { pairs: pairs });
        dg.select(null);
        if (on.length) dg.zoomTo(on, { maxZoom: 1.1 });
      }
      paintPanel();
      markFlows();
      if (picker) picker.sync();
      return;
    }
    // #arch/<nodeId>
    var nid = head;
    if (!node(nid)) { showDiagram(current); return; }
    var keepFlow = sel.flow && flowsWith(nid).some(function (x) { return x.id === sel.flow; });
    sel = { node: nid, flow: keepFlow ? sel.flow : null, step: null, feature: null };
    var ds = diagramsWith(nid);
    var keep = ds.filter(function (d) { return d.id === current; })[0];
    var target = keep || ds[0];
    if (target) {
      var near = [nid];
      (arch().edges || []).forEach(function (e) {
        if (e.from === nid && target.nodes.indexOf(e.to) >= 0) near.push(e.to);
        if (e.to === nid && target.nodes.indexOf(e.from) >= 0) near.push(e.from);
      });
      showDiagram(target.id, keep ? {} : { focus: near });
    } else showDiagram(current);
    if (sel.flow) paintFlowOnMap();
    else if (dg) dg.highlight(null);
    if (dg) { dg.select(dg.has(nid) ? nid : null); if (dg.has(nid)) dg.reveal(nid); }
    paintPanel();
    markFlows();
    if (picker) picker.sync();
  }

  function search(query) {
    var q = String(query || "").toLowerCase().trim();
    if (!q) return [];
    var out = [];
    function hit() {
      for (var i = 0; i < arguments.length; i++) if (arguments[i] && String(arguments[i]).toLowerCase().indexOf(q) >= 0) return true;
      return false;
    }
    (arch().nodes || []).forEach(function (n) {
      if (hit(n.title, n.id)) out.push({ title: n.title, hint: "Component, " + layerTitle(n.layer), hash: "#arch/" + n.id, rank: 0 });
      else if (hit(n.summary, n.body, (n.refs || []).map(function (r) { return r.path + " " + (r.label || ""); }).join(" ")))
        out.push({ title: n.title, hint: "Component, " + layerTitle(n.layer), hash: "#arch/" + n.id, rank: 2 });
    });
    (arch().diagrams || []).forEach(function (d) {
      if (hit(d.title, d.summary)) out.push({ title: d.title, hint: "Diagram", hash: "#arch/diagram/" + d.id, rank: 1 });
    });
    (arch().flows || []).forEach(function (f) {
      if (hit(f.title, f.summary, f.group, (f.steps || []).map(function (s) { return s.text; }).join(" "))) out.push({ title: f.title, hint: "Flow", hash: "#arch/flow/" + f.id, rank: 1 });
    });
    out.sort(function (a, b) { return a.rank - b.rank; });
    return out.map(function (r) { return { title: r.title, hint: r.hint, hash: r.hash }; });
  }

  window.AtlasViews = window.AtlasViews || {};
  window.AtlasViews.arch = { label: "Architecture", mount: mount, route: route, search: search };
})();
