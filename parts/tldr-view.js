/* Atlas: TL;DR view.
 * Routes: #tldr, #tldr/<blockId> (block expanded), #tldr/<blockId>/zoom (real diagram).
 * A simple map of big blocks. A block expands in place to show its bullets and the real
 * components inside it, and from there zooms into the real architecture diagram.
 */
(function () {
  "use strict";

  var root = null;
  var stage = null;
  var map = null;
  var wires = null;
  var detail = null;
  var state = { open: null, zoom: false };
  var dg = null; // AtlasDiagram handle while zoomed
  var busy = null; // pending animation timer
  var ro = null;

  function F() { return window.Atlas || {}; }
  function lc(layer) { return F().layerColor ? F().layerColor(layer || "core") : "var(--layer-" + (layer || "core") + ", var(--accent))"; }
  function esc(s) {
    if (F().esc) return F().esc(s);
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function go(h) { if (F().go) F().go(h); else location.hash = h; }
  function reduced() {
    if (F().reducedMotion) return F().reducedMotion();
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function narrow() { return window.innerWidth <= 760; }

  function data() { return F().tldr ? F().tldr() : window.ATLAS_TLDR || { intro: "", blocks: [], links: [] }; }
  function arch() { return F().arch ? F().arch() : window.ATLAS_ARCH || { nodes: [], diagrams: [] }; }
  function blocks() { return data().blocks || []; }
  function block(id) {
    var bs = blocks();
    for (var i = 0; i < bs.length; i++) if (bs[i].id === id) return bs[i];
    return null;
  }
  function indexOf(id) {
    var bs = blocks();
    for (var i = 0; i < bs.length; i++) if (bs[i].id === id) return i;
    return -1;
  }
  function node(id) {
    var ns = arch().nodes || [];
    for (var i = 0; i < ns.length; i++) if (ns[i].id === id) return ns[i];
    return null;
  }
  function diagram(id) {
    var ds = arch().diagrams || [];
    for (var i = 0; i < ds.length; i++) if (ds[i].id === id) return ds[i];
    return null;
  }
  function num(i) { return (i < 9 ? "0" : "") + (i + 1); }
  function zoomOf(b) { return b.zoom || {}; }
  function focusOf(b) {
    var z = zoomOf(b), d = diagram(z.diagram);
    return (z.focus || []).filter(function (id) { return node(id) && (!d || d.nodes.indexOf(id) >= 0); });
  }
  function archHash(b) {
    var z = zoomOf(b), f = focusOf(b);
    return "#arch/diagram/" + z.diagram + (f.length ? "?focus=" + f.join(",") : "");
  }

  /* ---------- styles ---------- */

  function injectStyle() {
    if (document.getElementById("atlas-tldr-style")) return;
    var css = [
      ".tl{display:flex;flex-direction:column;gap:14px}",
      ".tl .view-head{margin-bottom:4px}",
      ".tl .view-head p{font-size:17px;color:var(--text);max-width:76ch}",
      ".tl-hint{margin:0;font-family:var(--font-mono);font-size:13px;color:var(--muted)}",
      ".tl-hint kbd{border:1px solid var(--line);border-radius:3px;padding:0 5px;background:var(--panel);color:var(--text)}",
      ".tl-stage{position:relative}",

      /* map */
      ".tl-map{position:relative;display:grid;column-gap:92px;row-gap:96px;padding:20px 0 28px;transition:opacity .25s}",
      ".tl-wires{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:0}",
      ".tl-wire{fill:none;stroke:color-mix(in srgb,var(--muted) 55%,transparent);stroke-width:2}",
      ".tl-flow{fill:none;stroke:var(--accent);stroke-width:2;stroke-dasharray:3 13;stroke-linecap:round;opacity:.75}",
      ".tl-anim .tl-flow{animation:tl-flow 1.6s linear infinite}",
      "@keyframes tl-flow{to{stroke-dashoffset:-32}}",
      ".tl-arrow{fill:color-mix(in srgb,var(--muted) 80%,transparent)}",
      ".tl-wl text{font-family:var(--font-mono);font-size:12px;fill:var(--muted)}",
      ".tl-wl rect{fill:var(--bg)}",
      ".tl-wg.is-hot .tl-wire{stroke:var(--accent)}",
      ".tl-wg.is-hot .tl-flow{stroke:var(--accent-2);opacity:1}",
      ".tl-wg.is-hot .tl-wl text{fill:var(--text)}",

      /* blocks */
      ".tl-block{position:relative;z-index:1;display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-width:0;min-height:150px;",
      "text-align:left;font:inherit;color:var(--text);cursor:pointer;padding:18px 20px 16px;",
      "background:color-mix(in srgb,var(--tl-c) 7%,var(--panel));border:1px solid color-mix(in srgb,var(--tl-c) 45%,var(--line));",
      "border-left:4px solid var(--tl-c);border-radius:var(--radius);box-shadow:var(--shadow);transition:border-color .16s,box-shadow .16s,transform .16s,opacity .25s}",
      ".tl-block::after{content:'';position:absolute;right:-1px;top:-1px;width:14px;height:14px;border-right:2px solid var(--tl-c);border-top:2px solid var(--tl-c);border-top-right-radius:var(--radius)}",
      ".tl-block:hover,.tl-block:focus-visible{border-color:var(--tl-c);box-shadow:0 0 0 1px var(--tl-c),0 0 22px color-mix(in srgb,var(--tl-c) 30%,transparent)}",
      ".tl-block:focus-visible{outline:2px solid var(--accent);outline-offset:3px}",
      "@media (prefers-reduced-motion:no-preference){.tl-block:hover{transform:translateY(-2px)}}",
      ".tl-num{font-family:var(--font-mono);font-size:13px;font-weight:700;letter-spacing:.12em;color:var(--tl-c)}",
      ".tl-title{font-family:var(--font-mono);font-size:24px;font-weight:700;line-height:1.2}",
      ".tl-one{font-size:16px;line-height:1.45;color:var(--text)}",
      ".tl-more{margin-top:auto;padding-top:6px;font-family:var(--font-mono);font-size:12px;color:var(--muted)}",
      ".tl-block:hover .tl-more,.tl-block:focus-visible .tl-more{color:var(--accent)}",
      ".tl-conn,.tl-loop{display:none}",
      ".tl-stage.is-open .tl-map{opacity:.18;pointer-events:none}",

      /* expanded block */
      ".tl-detail{position:absolute;left:0;right:0;top:0;z-index:5;transform-origin:0 0;",
      "background:color-mix(in srgb,var(--tl-c) 5%,var(--panel));border:1px solid var(--tl-c);border-left:4px solid var(--tl-c);",
      "border-radius:var(--radius);box-shadow:0 0 0 1px color-mix(in srgb,var(--tl-c) 40%,transparent),0 18px 50px rgba(0,0,0,.35)}",
      ".tl-detail[hidden]{display:none}",
      ".tl-detail.is-moving{transition:transform .34s cubic-bezier(.2,.8,.2,1)}",
      ".tl-detail .tl-di{padding:20px 24px 22px;transition:opacity .18s}",
      ".tl-detail.is-moving .tl-di,.tl-detail.is-hidden-content .tl-di{opacity:0}",
      ".tl-dhead{display:flex;align-items:center;gap:14px;flex-wrap:wrap}",
      ".tl-dhead h3{margin:0;font-size:28px;line-height:1.2;flex:1;min-width:0}",
      ".tl-dhead h3:focus{outline:none}",
      ".tl-dhead .btn{white-space:nowrap}",
      ".tl-done{font-size:18px;margin:8px 0 0;max-width:70ch}",
      ".tl-dbody{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:28px;margin-top:18px}",
      ".tl-bullets{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px}",
      ".tl-bullets li{position:relative;padding-left:24px;font-size:16px;line-height:1.5}",
      ".tl-bullets li::before{content:'>';position:absolute;left:2px;top:0;font-family:var(--font-mono);font-weight:700;color:var(--tl-c)}",
      ".tl-inside .section-label{margin-top:0}",
      ".tl-inside .chip-row{margin-top:0}",
      ".tl-chip{font-size:13px;padding:4px 11px;border-color:color-mix(in srgb,var(--chip-color) 55%,var(--line))}",
      ".tl-chip.is-off{border-style:dashed}",
      ".tl-offnote{margin:8px 0 0;font-family:var(--font-mono);font-size:12px;color:var(--muted)}",
      ".tl-thumb{display:block;width:100%;margin-top:14px;padding:10px;cursor:zoom-in;font:inherit;color:var(--muted);text-align:left;",
      "background:var(--bg);border:1px solid var(--line);border-radius:var(--radius)}",
      ".tl-thumb:hover,.tl-thumb:focus-visible{border-color:var(--accent);box-shadow:var(--glow)}",
      ".tl-thumb:focus-visible{outline:none}",
      ".tl-thumb svg{display:block;width:100%;height:auto;max-height:180px}",
      ".tl-thumb .tl-tn{fill:none;stroke:var(--line);stroke-width:2}",
      ".tl-thumb .tl-tn.is-on{fill:color-mix(in srgb,var(--tn-c) 35%,transparent);stroke:var(--tn-c);stroke-width:3}",
      ".tl-thumb .tl-te{stroke:var(--line);stroke-width:2;fill:none}",
      ".tl-thumb .tl-tt{font-family:var(--font-mono);font-size:22px;fill:var(--text)}",
      ".tl-cap{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:6px;font-family:var(--font-mono);font-size:12px}",
      ".tl-zoomgo{display:inline-flex;align-items:center;gap:8px;margin-top:12px;font-size:14px;padding:9px 14px;border-color:var(--accent);color:var(--accent)}",
      ".tl-zoomgo:hover{box-shadow:var(--glow)}",
      ".tl-zoomgo:focus-visible,.tl-detail .btn:focus-visible,.tl-chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}",
      ".tl-dnav{display:flex;justify-content:space-between;gap:10px;margin-top:22px;padding-top:14px;border-top:1px dashed var(--line)}",
      ".tl-dnav .btn{max-width:48%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",

      /* zoomed */
      ".tl-zv{display:none}",
      ".tl-detail.is-zoomed .tl-zv{display:block}",
      ".tl-detail.is-zoomed .tl-done,.tl-detail.is-zoomed .tl-dbody,.tl-detail.is-zoomed .tl-dnav,.tl-detail.is-zoomed .tl-dclose{display:none}",
      ".tl-crumbs{margin:10px 0 0;font-family:var(--font-mono);font-size:13px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center}",
      ".tl-crumbs a{color:var(--muted)}",
      ".tl-crumbs a:hover{color:var(--accent)}",
      ".tl-crumbs b{color:var(--text)}",
      ".tl-zbar{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}",
      ".tl-zsum{margin:10px 0 12px;color:var(--muted);max-width:90ch}",
      ".tl-canvas{height:min(68vh,640px);min-height:340px;transform-origin:0 0}",
      ".tl-canvas.is-growing{transition:transform .45s cubic-bezier(.2,.8,.2,1),opacity .3s}",
      ".tl-canvas.is-leaving{transition:transform .26s ease-in,opacity .26s;transform:scale(.6);opacity:0}",

      /* phone: a vertical stack with connectors */
      "@media (max-width:760px){",
      ".tl-map{display:flex;flex-direction:column;gap:0;padding:8px 0 12px}",
      ".tl-wires{display:none}",
      ".tl-block{min-height:0;padding:14px 16px}",
      ".tl-title{font-size:21px}",
      ".tl-conn{display:flex;align-items:center;gap:12px;height:52px;padding-left:28px;font-family:var(--font-mono);font-size:12px;color:var(--muted)}",
      ".tl-conn i{position:relative;display:block;width:2px;height:100%;background:color-mix(in srgb,var(--muted) 50%,transparent);overflow:hidden}",
      ".tl-conn i::after{content:'';position:absolute;left:0;top:0;width:2px;height:14px;background:var(--accent);opacity:.8}",
      ".tl-anim .tl-conn i::after{animation:tl-drop 1.4s linear infinite}",
      ".tl-conn i::before{content:'';position:absolute;left:-4px;bottom:0;border:5px solid transparent;border-top-color:var(--muted);border-bottom:0}",
      "@keyframes tl-drop{from{transform:translateY(-14px)}to{transform:translateY(52px)}}",
      ".tl-loop{display:block;margin-top:10px;padding-left:20px;font-family:var(--font-mono);font-size:12px;color:var(--muted)}",
      ".tl-detail .tl-di{padding:16px 16px 18px}",
      ".tl-dhead h3{font-size:22px}",
      ".tl-done{font-size:16px}",
      ".tl-dbody{grid-template-columns:minmax(0,1fr);gap:18px}",
      ".tl-canvas{height:62vh;min-height:320px}",
      ".tl-zsum{display:none}",
      "}",
      "@media (prefers-reduced-motion:reduce){.tl-anim .tl-flow,.tl-anim .tl-conn i::after{animation:none}}"
    ].join("\n");
    var st = document.createElement("style");
    st.id = "atlas-tldr-style";
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------- map ---------- */

  function linkBetween(a, b) {
    var ls = data().links || [];
    for (var i = 0; i < ls.length; i++) if (ls[i].from === a && ls[i].to === b) return ls[i];
    return null;
  }

  function mapHtml() {
    var bs = blocks();
    var cols = 1, rows = 1;
    bs.forEach(function (b) {
      cols = Math.max(cols, (b.col || 0) + (b.span || 1));
      rows = Math.max(rows, (b.row || 0) + 1);
    });
    var h = '<div class="tl-map" role="group" aria-label="' + esc(((F().site || {}).title) || "The system") + ' in ' + bs.length + ' blocks. Use the arrow keys to move and Enter to open a block." ' +
      'style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr));grid-template-rows:repeat(' + rows + ',auto)">' +
      '<svg class="tl-wires" aria-hidden="true"></svg>';
    bs.forEach(function (b, i) {
      h += '<button type="button" class="tl-block" data-id="' + esc(b.id) + '" aria-expanded="false" ' +
        'style="--tl-c:' + lc(b.layer) + ';grid-column:' + ((b.col || 0) + 1) + " / span " + (b.span || 1) + ";grid-row:" + ((b.row || 0) + 1) + '">' +
        '<span class="tl-num">' + num(i) + "</span>" +
        '<span class="tl-title">' + esc(b.title) + "</span>" +
        '<span class="tl-one">' + esc(b.oneLiner) + "</span>" +
        '<span class="tl-more" aria-hidden="true">[ open + ]</span></button>';
      var next = bs[i + 1];
      if (next) {
        var l = linkBetween(b.id, next.id);
        h += '<div class="tl-conn" aria-hidden="true"><i></i><span>' + esc(l ? l.label : "") + "</span></div>";
      }
    });
    var last = bs[bs.length - 1], first = bs[0];
    var loop = last && first ? linkBetween(last.id, first.id) : null;
    if (loop) h += '<p class="tl-loop" aria-hidden="true">&#8634; ' + esc(loop.label) + " goes back to " + esc(first.title) + "</p>";
    return h + "</div>";
  }

  function blockEl(id) { return map.querySelector('.tl-block[data-id="' + id + '"]'); }

  function drawWires() {
    if (!map || !wires) return;
    if (narrow() || !map.offsetWidth) { wires.innerHTML = ""; return; }
    var mr = map.getBoundingClientRect();
    var NS = "http://www.w3.org/2000/svg";
    var out = '<defs><marker id="tl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">' +
      '<path class="tl-arrow" d="M0 0L10 5L0 10z"/></marker></defs>';
    var labels = [];
    (data().links || []).forEach(function (l, i) {
      var ea = blockEl(l.from), eb = blockEl(l.to);
      if (!ea || !eb) return;
      var a = rel(ea.getBoundingClientRect(), mr), b = rel(eb.getBoundingClientRect(), mr);
      var d, lx, ly, side;
      var ox0 = Math.max(a.l, b.l), ox1 = Math.min(a.r, b.r);
      var oy0 = Math.max(a.t, b.t), oy1 = Math.min(a.b, b.b);
      if (ox1 - ox0 > 24) {
        // vertical: through the middle of the shared columns, or the source centre when it fits
        var x = (a.l + a.r) / 2;
        if (x < ox0 || x > ox1) x = (ox0 + ox1) / 2;
        var y1 = a.b <= b.t ? a.b : a.t, y2 = a.b <= b.t ? b.t - 2 : b.b + 2;
        d = "M" + x + " " + y1 + "V" + y2;
        lx = x + 10; ly = (y1 + y2) / 2; side = "start";
      } else if (oy1 - oy0 > 24) {
        var y = (oy0 + oy1) / 2;
        var x1 = a.r <= b.l ? a.r : a.l, x2 = a.r <= b.l ? b.l - 2 : b.r + 2;
        d = "M" + x1 + " " + y + "H" + x2;
        lx = (x1 + x2) / 2; ly = y - 12; side = "middle";
      } else {
        var sx = a.r <= b.l ? a.r : a.l, sy = (a.t + a.b) / 2;
        var tx = (b.l + b.r) / 2, ty = a.b <= b.t ? b.t - 2 : b.b + 2;
        d = "M" + sx + " " + sy + "H" + tx + "V" + ty;
        lx = tx + 10; ly = (sy + ty) / 2; side = "start";
      }
      out += '<g class="tl-wg" data-from="' + esc(l.from) + '" data-to="' + esc(l.to) + '">' +
        '<path class="tl-wire" d="' + d + '" marker-end="url(#tl-arrow)"/>' +
        '<path class="tl-flow" d="' + d + '"/>' +
        '<g class="tl-wl" data-i="' + i + '"><rect rx="3"/><text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="' + side + '" dominant-baseline="middle">' +
        esc(l.label || "") + "</text></g></g>";
      labels.push(i);
    });
    wires.innerHTML = out;
    wires.setAttribute("viewBox", "0 0 " + mr.width.toFixed(1) + " " + mr.height.toFixed(1));
    Array.prototype.forEach.call(wires.querySelectorAll(".tl-wl"), function (g) {
      var t = g.querySelector("text"), r = g.querySelector("rect");
      if (!t.textContent) { r.remove(); return; }
      var bb = t.getBBox();
      r.setAttribute("x", (bb.x - 5).toFixed(1));
      r.setAttribute("y", (bb.y - 2).toFixed(1));
      r.setAttribute("width", (bb.width + 10).toFixed(1));
      r.setAttribute("height", (bb.height + 4).toFixed(1));
    });
    void NS;
  }
  function rel(r, m) { return { l: r.left - m.left, r: r.right - m.left, t: r.top - m.top, b: r.bottom - m.top }; }

  function heat(id) {
    if (!wires) return;
    Array.prototype.forEach.call(wires.querySelectorAll(".tl-wg"), function (g) {
      var on = !!id && (g.getAttribute("data-from") === id || g.getAttribute("data-to") === id);
      g.classList.toggle("is-hot", on);
    });
  }

  function moveFocus(fromEl, key) {
    var els = Array.prototype.slice.call(map.querySelectorAll(".tl-block"));
    var i = els.indexOf(fromEl);
    if (i < 0) return false;
    var target = null;
    if (narrow()) {
      if (key === "ArrowDown" || key === "ArrowRight") target = els[i + 1];
      else target = els[i - 1];
    } else {
      var dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[key];
      var a = fromEl.getBoundingClientRect();
      var ax = a.left + a.width / 2, ay = a.top + a.height / 2, best = Infinity;
      els.forEach(function (el) {
        if (el === fromEl) return;
        var r = el.getBoundingClientRect();
        // nearest point of the other block to our centre, so wide blocks count as below
        var bx = Math.max(r.left, Math.min(ax, r.right)), by = Math.max(r.top, Math.min(ay, r.bottom));
        var dx = bx - ax, dy = by - ay;
        var along = dx * dir[0] + dy * dir[1];
        if (along <= 0) return;
        var across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
        var s = along + across * 2;
        if (s < best) { best = s; target = el; }
      });
    }
    if (target) { target.focus(); return true; }
    return false;
  }

  /* ---------- expanded block ---------- */

  function thumbSvg(b) {
    var d = diagram(zoomOf(b).diagram);
    if (!d || !d.layout) return "";
    var on = {};
    focusOf(b).forEach(function (id) { on[id] = true; });
    var W = 200, H = 70, GX = 70, GY = 50, P = 20;
    var maxC = 0, maxR = 0;
    d.nodes.forEach(function (id) {
      var p = d.layout[id] || [0, 0];
      maxC = Math.max(maxC, p[0]); maxR = Math.max(maxR, p[1]);
    });
    var vw = P * 2 + (maxC + 1) * W + maxC * GX, vh = P * 2 + (maxR + 1) * H + maxR * GY;
    function pos(id) { var p = d.layout[id] || [0, 0]; return { x: P + p[0] * (W + GX), y: P + p[1] * (H + GY) }; }
    var s = '<svg viewBox="0 0 ' + vw + " " + vh + '" aria-hidden="true" preserveAspectRatio="xMidYMid meet">';
    var set = {};
    d.nodes.forEach(function (id) { set[id] = true; });
    (arch().edges || []).forEach(function (e) {
      if (!set[e.from] || !set[e.to] || e.from === e.to) return;
      var a = pos(e.from), c = pos(e.to);
      s += '<line class="tl-te" x1="' + (a.x + W / 2) + '" y1="' + (a.y + H / 2) + '" x2="' + (c.x + W / 2) + '" y2="' + (c.y + H / 2) + '"/>';
    });
    d.nodes.forEach(function (id) {
      var n = node(id), p = pos(id);
      var c = n ? lc(n.layer) : "var(--accent)";
      s += '<rect class="tl-tn' + (on[id] ? " is-on" : "") + '" style="--tn-c:' + c + ';fill:' + (on[id] ? "" : "var(--panel)") + '" x="' + p.x + '" y="' + p.y + '" width="' + W + '" height="' + H + '" rx="8"/>';
      if (on[id] && n) {
        var t = n.title.length > 15 ? n.title.slice(0, 14) + "…" : n.title;
        s += '<text class="tl-tt" x="' + (p.x + W / 2) + '" y="' + (p.y + H / 2 + 8) + '" text-anchor="middle">' + esc(t) + "</text>";
      }
    });
    return s + "</svg>";
  }

  function detailHtml(b) {
    var i = indexOf(b.id), bs = blocks();
    var d = diagram(zoomOf(b).diagram);
    var focus = focusOf(b);
    var ids = (b.nodes && b.nodes.length ? b.nodes : focus).filter(function (id) { return node(id); });
    var chips = ids.map(function (id) {
      var n = node(id);
      var off = d && d.nodes.indexOf(id) < 0;
      return '<a class="chip tl-chip' + (off ? " is-off" : "") + '" style="--chip-color:' + lc(n.layer) + '" href="#arch/' + esc(id) + '" title="' + esc(n.summary || "") + '">' +
        '<span class="dot" aria-hidden="true"></span>' + esc(n.title) + "</a>";
    }).join("");
    var prev = bs[i - 1], next = bs[i + 1];
    var dTitle = d ? d.title : zoomOf(b).diagram;
    var h = '<div class="tl-di">' +
      '<div class="tl-dhead"><span class="tl-num">' + num(i) + "</span>" +
      '<h3 id="tl-dtitle" tabindex="-1">' + esc(b.title) + "</h3>" +
      '<button type="button" class="btn tl-dclose" data-act="map" aria-label="Close ' + esc(b.title) + ' and go back to the map">&times; Back to map</button></div>' +
      '<p class="tl-done">' + esc(b.oneLiner) + "</p>" +
      '<div class="tl-dbody">' +
      '<ul class="tl-bullets">' + (b.bullets || []).map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" +
      '<div class="tl-inside"><p class="section-label">Real components inside</p>' +
      '<div class="chip-row">' + chips + "</div>" +
      (d && ids.some(function (id) { return d.nodes.indexOf(id) < 0; }) ? '<p class="tl-offnote">Dashed chips are not on the ' + esc(d.title) + " diagram. They open in the Architecture view.</p>" : "") +
      (d ? '<button type="button" class="tl-thumb" data-act="zoom" aria-label="Zoom into the ' + esc(dTitle) + ' diagram">' + thumbSvg(b) +
        '<span class="tl-cap"><span>' + esc(dTitle) + "</span><span>" + focus.length + " of " + d.nodes.length + " highlighted</span></span></button>" : "") +
      '<button type="button" class="btn tl-zoomgo" data-act="zoom">Zoom into the real architecture <span aria-hidden="true">&#8600;</span></button>' +
      "</div></div>" +
      '<div class="tl-dnav">' +
      (prev ? '<button type="button" class="btn" data-goto="' + esc(prev.id) + '">&larr; ' + esc(prev.title) + "</button>" : "<span></span>") +
      (next ? '<button type="button" class="btn" data-goto="' + esc(next.id) + '">' + esc(next.title) + " &rarr;</button>" : "<span></span>") +
      "</div>" +
      '<div class="tl-zv">' +
      '<p class="tl-crumbs"><a href="#tldr">TL;DR map</a><span aria-hidden="true">/</span><a href="#tldr/' + esc(b.id) + '">' + esc(b.title) + '</a><span aria-hidden="true">/</span><b>' + esc(dTitle) + "</b></p>" +
      '<div class="tl-zbar">' +
      '<button type="button" class="btn" data-act="unzoom">&larr; Back to ' + esc(b.title) + "</button>" +
      '<button type="button" class="btn" data-act="map">&times; Back to map</button>' +
      '<a class="btn" href="' + esc(archHash(b)) + '">Open in Architecture view &#8599;</a></div>' +
      '<p class="tl-zsum">' + esc(d ? d.summary : "") + " Click a box to read about that component.</p>" +
      '<div class="tl-canvas" role="region" aria-label="' + esc(dTitle) + ' diagram"></div>' +
      "</div></div>";
    return h;
  }

  function clearBusy() {
    if (busy) { clearTimeout(busy); busy = null; }
    detail.classList.remove("is-moving", "is-hidden-content");
    detail.style.transform = "";
  }

  function syncHeight() {
    if (!stage) return;
    if (detail.hidden) { stage.style.minHeight = ""; return; }
    stage.style.minHeight = Math.ceil(detail.offsetTop + detail.offsetHeight + 8) + "px";
  }

  function placeDetail(b) {
    var el = blockEl(b.id);
    detail.style.top = narrow() && el ? el.offsetTop + "px" : "0px";
  }

  function expand(id, animate) {
    var b = block(id);
    if (!b) return;
    clearBusy();
    destroyDiagram();
    detail.classList.remove("is-zoomed");
    detail.style.setProperty("--tl-c", lc(b.layer));
    detail.innerHTML = detailHtml(b);
    detail.hidden = false;
    detail.setAttribute("aria-label", b.title);
    stage.classList.add("is-open");
    map.setAttribute("inert", "");
    Array.prototype.forEach.call(map.querySelectorAll(".tl-block"), function (el) {
      el.setAttribute("aria-expanded", el.getAttribute("data-id") === id ? "true" : "false");
    });
    placeDetail(b);
    syncHeight();
    var src = blockEl(id);
    if (animate && src && !reduced()) {
      // Grow from the block's own box into the panel.
      var dr = detail.getBoundingClientRect(), sr = src.getBoundingClientRect();
      detail.style.transform = "translate(" + (sr.left - dr.left) + "px," + (sr.top - dr.top) + "px) scale(" + (sr.width / dr.width) + "," + (sr.height / dr.height) + ")";
      detail.classList.add("is-hidden-content");
      void detail.offsetWidth;
      detail.classList.add("is-moving");
      detail.classList.remove("is-hidden-content");
      detail.style.transform = "";
      busy = setTimeout(function () { busy = null; detail.classList.remove("is-moving"); }, 360);
    }
    var h = detail.querySelector("#tl-dtitle");
    if (h) h.focus({ preventScroll: true });
    revealDetail();
  }

  function revealDetail() {
    var r = detail.getBoundingClientRect();
    if (r.top < 60 || r.top > window.innerHeight * 0.6) {
      var y = window.scrollY + r.top - 80;
      window.scrollTo({ top: Math.max(0, y), behavior: reduced() ? "auto" : "smooth" });
    }
  }

  function collapse(id, animate) {
    clearBusy();
    destroyDiagram();
    var src = id ? blockEl(id) : null;
    function done() {
      busy = null;
      detail.hidden = true;
      detail.innerHTML = "";
      detail.classList.remove("is-moving", "is-zoomed");
      detail.style.transform = "";
      stage.classList.remove("is-open");
      map.removeAttribute("inert");
      Array.prototype.forEach.call(map.querySelectorAll(".tl-block"), function (el) { el.setAttribute("aria-expanded", "false"); });
      syncHeight();
      if (src) {
        src.focus({ preventScroll: true });
        var r = src.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) src.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
      }
    }
    if (detail.hidden) { done(); return; }
    if (animate && src && !reduced()) {
      stage.classList.remove("is-open");
      var dr = detail.getBoundingClientRect(), sr = src.getBoundingClientRect();
      detail.classList.add("is-moving");
      detail.style.transform = "translate(" + (sr.left - dr.left) + "px," + (sr.top - dr.top) + "px) scale(" + (sr.width / dr.width) + "," + (sr.height / dr.height) + ")";
      busy = setTimeout(done, 300);
    } else done();
  }

  /* ---------- zoom into the real diagram ---------- */

  function destroyDiagram() {
    if (dg) { try { dg.destroy(); } catch (e) { /* already gone */ } dg = null; }
  }

  function zoomIn(animate) {
    var b = block(state.open);
    if (!b) return;
    var spec = diagram(zoomOf(b).diagram);
    if (!spec || !window.AtlasDiagram || typeof window.AtlasDiagram.render !== "function") {
      go(archHash(b));
      return;
    }
    var thumb = detail.querySelector(".tl-thumb") || detail.querySelector(".tl-zoomgo");
    var from = thumb ? thumb.getBoundingClientRect() : null;
    detail.classList.add("is-zoomed");
    var canvas = detail.querySelector(".tl-canvas");
    var focus = focusOf(b);
    destroyDiagram();
    var motion = animate && from && !reduced();
    dg = window.AtlasDiagram.render(canvas, spec, {
      focus: motion ? null : focus,
      onNode: function (nid) { go("#arch/" + nid); }
    });
    if (dg && dg.highlight) dg.highlight(focus);
    syncHeight();
    var top = window.scrollY + detail.getBoundingClientRect().top - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: reduced() ? "auto" : "smooth" });
    if (motion) {
      // Scale the real diagram up out of the preview, then zoom the camera onto the block's nodes.
      var to = canvas.getBoundingClientRect();
      canvas.style.transform = "translate(" + (from.left - to.left) + "px," + (from.top - to.top) + "px) scale(" + (from.width / to.width) + "," + (from.height / to.height) + ")";
      canvas.style.opacity = "0.4";
      void canvas.offsetWidth;
      canvas.classList.add("is-growing");
      canvas.style.transform = "";
      canvas.style.opacity = "";
      busy = setTimeout(function () {
        busy = null;
        canvas.classList.remove("is-growing");
        if (dg) dg.zoomTo(focus);
      }, 480);
    }
    var back = detail.querySelector('[data-act="unzoom"]');
    if (back) back.focus({ preventScroll: true });
  }

  function zoomOut(animate) {
    var canvas = detail.querySelector(".tl-canvas");
    function done() {
      busy = null;
      destroyDiagram();
      if (canvas) { canvas.classList.remove("is-leaving"); canvas.style.transform = ""; }
      detail.classList.remove("is-zoomed");
      syncHeight();
      var z = detail.querySelector(".tl-zoomgo");
      if (z) z.focus({ preventScroll: true });
      revealDetail();
    }
    clearBusy();
    if (animate && canvas && dg && !reduced()) {
      if (dg.reset) dg.reset();
      canvas.classList.add("is-leaving");
      busy = setTimeout(done, 280);
    } else done();
  }

  /* ---------- view API ---------- */

  function mount(el) {
    root = el;
    injectStyle();
    var d = data();
    if (!blocks().length) {
      el.innerHTML = F().emptyState ? F().emptyState("No TL;DR data", "`data/tldr.js` did not load.") : "<p>No TL;DR data.</p>";
      return;
    }
    el.innerHTML =
      '<div class="tl' + (reduced() ? "" : " tl-anim") + '">' +
      '<header class="view-head"><h2>TL;DR</h2><p>' + esc(d.intro) + "</p></header>" +
      '<p class="tl-hint">Open a block to see what is inside, then zoom into the real diagram. ' +
      'Keys: <kbd>&larr;</kbd><kbd>&rarr;</kbd><kbd>&uarr;</kbd><kbd>&darr;</kbd> move, <kbd>Enter</kbd> opens, <kbd>Esc</kbd> goes back.</p>' +
      '<div class="tl-stage">' + mapHtml() +
      '<section class="tl-detail" hidden aria-labelledby="tl-dtitle"></section></div></div>';
    stage = el.querySelector(".tl-stage");
    map = el.querySelector(".tl-map");
    wires = el.querySelector(".tl-wires");
    detail = el.querySelector(".tl-detail");

    map.addEventListener("click", function (ev) {
      var b = ev.target.closest(".tl-block");
      if (b) go("#tldr/" + b.getAttribute("data-id"));
    });
    map.addEventListener("keydown", function (ev) {
      if (!/^Arrow/.test(ev.key) || ev.altKey || ev.metaKey || ev.ctrlKey) return;
      var b = ev.target.closest(".tl-block");
      if (b && moveFocus(b, ev.key)) ev.preventDefault();
    });
    ["mouseover", "focusin"].forEach(function (t) {
      map.addEventListener(t, function (ev) {
        var b = ev.target.closest(".tl-block");
        heat(b ? b.getAttribute("data-id") : null);
      });
    });
    map.addEventListener("mouseleave", function () { heat(null); });
    map.addEventListener("focusout", function () { heat(null); });

    detail.addEventListener("click", function (ev) {
      var a = ev.target.closest("[data-act],[data-goto]");
      if (!a) return;
      var act = a.getAttribute("data-act");
      if (a.hasAttribute("data-goto")) go("#tldr/" + a.getAttribute("data-goto"));
      else if (act === "map") go("#tldr");
      else if (act === "zoom") go("#tldr/" + state.open + "/zoom");
      else if (act === "unzoom") go("#tldr/" + state.open);
    });

    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape" || ev.defaultPrevented || !root || root.offsetParent === null) return;
      var t = ev.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (state.zoom) { ev.preventDefault(); go("#tldr/" + state.open); }
      else if (state.open) { ev.preventDefault(); go("#tldr"); }
    });

    var redraw = function () {
      drawWires();
      if (state.open) { var b = block(state.open); if (b) placeDetail(b); syncHeight(); }
    };
    if (window.ResizeObserver) {
      ro = new ResizeObserver(function () { requestAnimationFrame(redraw); });
      ro.observe(map);
      ro.observe(detail);
    } else {
      window.addEventListener("resize", redraw);
    }
    requestAnimationFrame(drawWires);
  }

  function route(parts) {
    if (!root || !stage) return;
    parts = (parts || []).filter(Boolean);
    var id = block(parts[0]) ? parts[0] : null;
    var zoom = !!id && parts[1] === "zoom";
    var visible = root.offsetParent !== null;
    var prev = state;
    state = { open: id, zoom: zoom };

    if (!id) {
      if (prev.open) collapse(prev.open, visible);
      requestAnimationFrame(drawWires);
      return;
    }
    if (prev.open !== id) {
      // Grow from the block when coming from the map. Swapping blocks or deep links skip the growth.
      expand(id, visible && !prev.open && !zoom);
      if (zoom) zoomIn(visible);
      return;
    }
    if (zoom && !prev.zoom) zoomIn(visible);
    else if (!zoom && prev.zoom) zoomOut(visible);
  }

  function search(query) {
    var score = F().score;
    var out = [];
    blocks().forEach(function (b) {
      var fields = [b.title, b.oneLiner, (b.bullets || []).join(" ")];
      var s = score ? score(query, fields) : (fields.join(" ").toLowerCase().indexOf(String(query).toLowerCase()) >= 0 ? 1 : 0);
      if (s) out.push({ s: s, r: { title: b.title, hint: "TL;DR, " + b.oneLiner, hash: "#tldr/" + b.id } });
    });
    out.sort(function (a, b) { return b.s - a.s; });
    return out.map(function (x) { return x.r; });
  }

  window.AtlasViews = window.AtlasViews || {};
  window.AtlasViews.tldr = { mount: mount, route: route, search: search };
})();
