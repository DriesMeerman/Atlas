/* Atlas: SVG diagram renderer with pan, zoom and keyboard focus.
 *
 * window.AtlasDiagram.render(container, spec, { focus, onNode, select, compact })
 *   compact: no zoom buttons, legend or hint, and the wheel scrolls the page unless Ctrl or Cmd is held.
 *   -> { zoomTo(ids, opts), reset(), select(id), highlight(ids), destroy() }
 *
 * spec is one ATLAS_ARCH.diagrams[] entry. Node details come from ATLAS_ARCH.nodes.
 */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var NW = 184; // node width
  var NH = 64; // node height
  var GX = 148; // gap between columns
  var GY = 96; // gap between rows
  var PAD = 40; // outer padding around the drawing
  var STUB = 16; // straight run out of a port before the first bend
  var TITLE_PX = 15;
  var LABEL_PX = 12;
  var MAX_ZOOM = 2.6;
  var MIN_ZOOM = 0.15;
  var uid = 0;

  var KIND_TEXT = { data: "data", control: "control", store: "store" };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /* ---------- styles ---------- */

  function injectStyle() {
    if (document.getElementById("atlas-diagram-style")) return;
    var css = [
      ".fd-wrap{position:relative;width:100%;height:100%;min-height:240px;overflow:hidden;background:var(--bg);",
      "background-image:radial-gradient(color-mix(in srgb,var(--line) 70%,transparent) 1px,transparent 1px);background-size:24px 24px;",
      "border:1px solid var(--line);border-radius:6px;}",
      ".fd-svg{display:block;width:100%;height:100%;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none;font-family:var(--font-mono,ui-monospace,Menlo,Consolas,monospace)}",
      ".fd-svg.fd-panning{cursor:grabbing}",
      ".fd-compact{border:0;background-size:18px 18px}",
      ".fd-svg:focus{outline:none}",
      ".fd-node{cursor:pointer;transition:opacity .15s}",
      ".fd-node rect.fd-box{fill:color-mix(in srgb,var(--fd-c) 13%,var(--panel));stroke:color-mix(in srgb,var(--fd-c) 70%,var(--line));stroke-width:1.5}",
      ".fd-node rect.fd-bar{fill:var(--fd-c)}",
      ".fd-node .fd-title{fill:var(--text);font-size:" + TITLE_PX + "px;font-weight:600}",
      ".fd-node .fd-layer{fill:var(--muted);font-size:12px;letter-spacing:.06em;text-transform:uppercase}",
      ".fd-node .fd-dot{fill:var(--fd-c)}",
      ".fd-node rect.fd-ring{fill:none;stroke:transparent;stroke-width:2.5}",
      ".fd-node:hover rect.fd-box,.fd-node.fd-hl rect.fd-box{stroke:var(--fd-c);stroke-width:2;fill:color-mix(in srgb,var(--fd-c) 22%,var(--panel))}",
      ".fd-node:focus{outline:none}",
      ".fd-node:focus-visible rect.fd-ring{stroke:var(--accent);stroke-dasharray:5 3}",
      ".fd-node.fd-sel rect.fd-ring{stroke:var(--accent)}",
      ".fd-node.fd-sel rect.fd-box{stroke:var(--fd-c);stroke-width:2.5}",
      ".fd-edge{transition:opacity .15s}",
      ".fd-labels{pointer-events:none}",
      ".fd-elabel.fd-lazy{display:none}",
      ".fd-elabel.fd-lazy.fd-hl{display:inline}",
      ".fd-edge path.fd-line{fill:none;stroke:var(--muted);stroke-width:1.6;stroke-linejoin:round}",
      ".fd-edge.fd-control path.fd-line{stroke-dasharray:7 5}",
      ".fd-edge.fd-store path.fd-line{stroke-dasharray:2 4;stroke-linecap:round;stroke-width:2.2}",
      ".fd-edge.fd-hl path.fd-line{stroke:var(--accent);stroke-width:2.4}",
      ".fd-edge.fd-store.fd-hl path.fd-line{stroke-width:2.8}",
      ".fd-edge .fd-lbg{fill:var(--bg);stroke:color-mix(in srgb,var(--line) 80%,transparent);stroke-width:1}",
      ".fd-edge .fd-ltext{fill:var(--muted);font-size:" + LABEL_PX + "px}",
      ".fd-edge.fd-hl .fd-ltext{fill:var(--text)}",
      ".fd-edge.fd-hl .fd-lbg{stroke:var(--accent)}",
      ".fd-mk{fill:var(--muted)}",
      ".fd-mk-hl{fill:var(--accent)}",
      ".fd-svg.fd-dim .fd-node:not(.fd-hl):not(.fd-near){opacity:.28}",
      ".fd-badge rect{fill:var(--fd-c);stroke:var(--bg);stroke-width:2}",
      ".fd-badge text{fill:var(--bg);font-size:12px;font-weight:700}",
      ".fd-svg.fd-dim .fd-edge:not(.fd-hl){opacity:.14}",
      ".fd-ctl{position:absolute;top:8px;right:8px;display:flex;gap:4px;z-index:2}",
      ".fd-ctl button{min-width:34px;height:34px;padding:0 8px;font:inherit;font-size:15px;line-height:1;color:var(--text);",
      "background:var(--panel);border:1px solid var(--line);border-radius:4px;cursor:pointer}",
      ".fd-ctl button:hover{border-color:var(--accent);color:var(--accent)}",
      ".fd-ctl button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}",
      ".fd-legend{position:absolute;left:8px;bottom:8px;display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;z-index:2;",
      "padding:5px 10px;font-size:12px;color:var(--muted);background:color-mix(in srgb,var(--panel) 92%,transparent);",
      "border:1px solid var(--line);border-radius:4px;pointer-events:none}",
      ".fd-legend span{display:inline-flex;align-items:center;gap:6px}",
      ".fd-legend svg{width:30px;height:8px;overflow:visible}",
      ".fd-legend line{stroke:var(--muted);stroke-width:1.8}",
      ".fd-hint{position:absolute;right:8px;bottom:8px;font-size:12px;color:var(--muted);z-index:2;pointer-events:none;",
      "background:color-mix(in srgb,var(--panel) 85%,transparent);padding:2px 6px;border-radius:3px}",
      "@media (max-width:640px){.fd-hint{display:none}.fd-legend{font-size:12px;gap:2px 10px}}",
      "@media (prefers-reduced-motion:reduce){.fd-node,.fd-edge{transition:none}}"
    ].join("\n");
    var st = document.createElement("style");
    st.id = "atlas-diagram-style";
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------- geometry helpers ---------- */

  function archData() { return window.Atlas && window.Atlas.arch ? window.Atlas.arch() : window.ATLAS_ARCH || {}; }
  function nodeData(id) {
    if (window.Atlas && window.Atlas.node) { var n = window.Atlas.node(id); if (n) return n; }
    var list = archData().nodes || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return { id: id, title: id, layer: "core" };
  }

  function specEdges(spec, ids) {
    var set = {};
    ids.forEach(function (id) { set[id] = true; });
    var src = spec.edges === "auto" || spec.edges == null ? archData().edges || [] : spec.edges;
    var seen = {};
    return src.filter(function (e) {
      if (!set[e.from] || !set[e.to] || e.from === e.to) return false;
      var key = e.from + ">" + e.to + ">" + (e.label || "");
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  // Split a title into at most two lines that fit the box.
  function wrapTitle(title, maxChars) {
    title = String(title || "");
    if (title.length <= maxChars) return [title];
    var words = title.split(/\s+/);
    var a = "";
    var i = 0;
    while (i < words.length && (a ? a.length + 1 + words[i].length : words[i].length) <= maxChars) {
      a = a ? a + " " + words[i] : words[i];
      i++;
    }
    if (!a) { a = title.slice(0, maxChars - 1) + "-"; return [a, clip(title.slice(maxChars - 1), maxChars)]; }
    return [a, clip(words.slice(i).join(" "), maxChars)];
  }
  function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  function segHitsRect(a, b, r, strict) {
    // Axis-aligned segment vs rect. strict: touching the border does not count.
    var e = strict ? 0.5 : 0;
    var minx = Math.min(a.x, b.x), maxx = Math.max(a.x, b.x);
    var miny = Math.min(a.y, b.y), maxy = Math.max(a.y, b.y);
    return maxx > r.x + e && minx < r.x + r.w - e && maxy > r.y + e && miny < r.y + r.h - e;
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function inflate(r, d) { return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d }; }

  function simplify(pts) {
    var out = [];
    pts.forEach(function (p) {
      var l = out[out.length - 1];
      if (l && Math.abs(l.x - p.x) < 0.01 && Math.abs(l.y - p.y) < 0.01) return;
      out.push({ x: p.x, y: p.y });
    });
    // drop collinear middle points
    for (var i = out.length - 2; i > 0; i--) {
      var a = out[i - 1], b = out[i], c = out[i + 1];
      if ((Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01)) out.splice(i, 1);
    }
    return out;
  }

  function roundedPath(pts) {
    var d = "M" + pts[0].x.toFixed(1) + " " + pts[0].y.toFixed(1);
    for (var i = 1; i < pts.length - 1; i++) {
      var p = pts[i - 1], q = pts[i], n = pts[i + 1];
      var l1 = Math.hypot(q.x - p.x, q.y - p.y), l2 = Math.hypot(n.x - q.x, n.y - q.y);
      var r = Math.min(12, l1 / 2, l2 / 2);
      var ax = q.x - ((q.x - p.x) / l1) * r, ay = q.y - ((q.y - p.y) / l1) * r;
      var bx = q.x + ((n.x - q.x) / l2) * r, by = q.y + ((n.y - q.y) / l2) * r;
      d += " L" + ax.toFixed(1) + " " + ay.toFixed(1) + " Q" + q.x.toFixed(1) + " " + q.y.toFixed(1) + " " + bx.toFixed(1) + " " + by.toFixed(1);
    }
    var last = pts[pts.length - 1];
    return d + " L" + last.x.toFixed(1) + " " + last.y.toFixed(1);
  }

  var DIRS = {
    right: { dx: 1, dy: 0 },
    left: { dx: -1, dy: 0 },
    top: { dx: 0, dy: -1 },
    bottom: { dx: 0, dy: 1 }
  };
  var SIDES = ["right", "left", "top", "bottom"];

  function port(box, side, offset) {
    offset = offset || 0;
    if (side === "right") return { x: box.x + box.w, y: box.y + box.h / 2 + offset, side: side };
    if (side === "left") return { x: box.x, y: box.y + box.h / 2 + offset, side: side };
    if (side === "top") return { x: box.x + box.w / 2 + offset, y: box.y, side: side };
    return { x: box.x + box.w / 2 + offset, y: box.y + box.h, side: side };
  }

  /* ---------- layout ---------- */

  function layout(spec) {
    var ids = (spec.nodes || []).slice();
    var lay = spec.layout || {};
    var boxes = {};
    var autoRow = 0;
    var maxRow = 0;
    ids.forEach(function (id) { if (lay[id]) maxRow = Math.max(maxRow, lay[id][1]); });
    ids.forEach(function (id, i) {
      var cr = lay[id];
      if (!cr) cr = [i % 4, maxRow + 1 + Math.floor(autoRow++ / 4)]; // nodes without a layout go below
      boxes[id] = { id: id, col: cr[0], row: cr[1], x: PAD + cr[0] * (NW + GX), y: PAD + cr[1] * (NH + GY), w: NW, h: NH };
    });
    var all = ids.map(function (id) { return boxes[id]; });
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    all.forEach(function (b) {
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    });
    if (!all.length) { minX = minY = 0; maxX = maxY = 100; }
    // Channels: the free lanes between columns and rows, plus one outside each edge.
    function channels(starts, size, gap) {
      var u = starts.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
      var out = [];
      if (!u.length) return out;
      out.push(u[0] - gap / 2);
      for (var i = 0; i < u.length - 1; i++) {
        var lo = u[i] + size, hi = u[i + 1];
        if (hi - lo > 24) out.push((lo + hi) / 2);
      }
      out.push(u[u.length - 1] + size + gap / 2);
      return out;
    }
    var chX = channels(all.map(function (b) { return b.x; }), NW, GX);
    var chY = channels(all.map(function (b) { return b.y; }), NH, GY);
    return {
      ids: ids,
      boxes: boxes,
      list: all,
      chX: chX,
      chY: chY,
      bounds: { x: minX - PAD, y: minY - PAD, w: maxX - minX + 2 * PAD, h: maxY - minY + 2 * PAD }
    };
  }

  /* ---------- edge routing ---------- */

  function Router(L) {
    this.L = L;
    this.placed = []; // segments already used: {a,b}
  }

  Router.prototype.candidates = function (sp, tp) {
    var L = this.L;
    var s = { x: sp.x + DIRS[sp.side].dx * STUB, y: sp.y + DIRS[sp.side].dy * STUB };
    var t = { x: tp.x + DIRS[tp.side].dx * STUB, y: tp.y + DIRS[tp.side].dy * STUB };
    var sH = sp.side === "left" || sp.side === "right";
    var tH = tp.side === "left" || tp.side === "right";
    var off = [0, -10, 10, -20, 20];
    var xs = [], ys = [];
    L.chX.forEach(function (c) { off.forEach(function (o) { xs.push(c + o); }); });
    L.chY.forEach(function (c) { off.forEach(function (o) { ys.push(c + o); }); });
    var midX = (s.x + t.x) / 2, midY = (s.y + t.y) / 2;
    xs.push(midX); ys.push(midY);
    var out = [];
    function push(mid) { out.push([sp].concat(mid, [tp])); }
    if (sH && tH) {
      push([{ x: s.x, y: sp.y }, { x: s.x, y: tp.y }, { x: t.x, y: tp.y }]);
      xs.forEach(function (x) { push([{ x: x, y: sp.y }, { x: x, y: tp.y }]); });
      var near = function (x0, dir) {
        return L.chX.filter(function (c) { return dir > 0 ? c > x0 : c < x0; })
          .sort(function (a, b) { return Math.abs(a - x0) - Math.abs(b - x0); }).slice(0, 1)
          .reduce(function (acc, c) { off.forEach(function (o) { acc.push(c + o); }); return acc; }, []);
      };
      var x1s = near(sp.x, DIRS[sp.side].dx), x2s = near(tp.x, DIRS[tp.side].dx);
      x1s.forEach(function (x1) { x2s.forEach(function (x2) { ys.forEach(function (y) {
        push([{ x: x1, y: sp.y }, { x: x1, y: y }, { x: x2, y: y }, { x: x2, y: tp.y }]);
      }); }); });
    } else if (!sH && !tH) {
      ys.forEach(function (y) { push([{ x: sp.x, y: y }, { x: tp.x, y: y }]); });
      var nearY = function (y0, dir) {
        return L.chY.filter(function (c) { return dir > 0 ? c > y0 : c < y0; })
          .sort(function (a, b) { return Math.abs(a - y0) - Math.abs(b - y0); }).slice(0, 1)
          .reduce(function (acc, c) { off.forEach(function (o) { acc.push(c + o); }); return acc; }, []);
      };
      var y1s = nearY(sp.y, DIRS[sp.side].dy), y2s = nearY(tp.y, DIRS[tp.side].dy);
      y1s.forEach(function (y1) { y2s.forEach(function (y2) { xs.forEach(function (x) {
        push([{ x: sp.x, y: y1 }, { x: x, y: y1 }, { x: x, y: y2 }, { x: tp.x, y: y2 }]);
      }); }); });
    } else if (sH && !tH) {
      push([{ x: tp.x, y: sp.y }]);
      xs.forEach(function (x) { ys.forEach(function (y) {
        push([{ x: x, y: sp.y }, { x: x, y: y }, { x: tp.x, y: y }]);
      }); });
    } else {
      push([{ x: sp.x, y: tp.y }]);
      ys.forEach(function (y) { xs.forEach(function (x) {
        push([{ x: sp.x, y: y }, { x: x, y: y }, { x: x, y: tp.y }]);
      }); });
    }
    return out;
  };

  Router.prototype.score = function (pts, sBox, tBox) {
    var L = this.L;
    pts = simplify(pts);
    if (pts.length < 2) return { cost: Infinity };
    // first and last segments must leave and enter on the port's side
    var sp = pts[0], tp = pts[pts.length - 1];
    function okDir(p, q, side) {
      var d = DIRS[side];
      var len = (q.x - p.x) * d.dx + (q.y - p.y) * d.dy;
      var perp = d.dx ? Math.abs(q.y - p.y) : Math.abs(q.x - p.x);
      return perp < 0.01 && len >= STUB - 0.01;
    }
    var sSide = this._sSide, tSide = this._tSide;
    if (!okDir(pts[0], pts[1], sSide)) return { cost: Infinity };
    if (!okDir(tp, pts[pts.length - 2], tSide)) return { cost: Infinity };
    var cost = 0, len = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      len += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      for (var j = 0; j < L.list.length; j++) {
        var bx = L.list[j];
        if (bx === sBox || bx === tBox) {
          if (segHitsRect(a, b, bx, true)) cost += 20000;
        } else if (segHitsRect(a, b, inflate(bx, 8), false)) cost += 20000;
      }
      // overlap with earlier edges running along the same line
      for (var k = 0; k < this.placed.length; k++) {
        var s = this.placed[k];
        var vA = Math.abs(a.x - b.x) < 0.01, vS = Math.abs(s.a.x - s.b.x) < 0.01;
        if (vA !== vS) {
          // perpendicular crossing with an earlier edge
          var h = vA ? s : { a: a, b: b }, v = vA ? { a: a, b: b } : s;
          if (v.a.x > Math.min(h.a.x, h.b.x) + 1 && v.a.x < Math.max(h.a.x, h.b.x) - 1 &&
              h.a.y > Math.min(v.a.y, v.b.y) + 1 && h.a.y < Math.max(v.a.y, v.b.y) - 1) cost += 28;
          continue;
        }
        if (vA && Math.abs(a.x - s.a.x) < 6) {
          var o = Math.min(Math.max(a.y, b.y), Math.max(s.a.y, s.b.y)) - Math.max(Math.min(a.y, b.y), Math.min(s.a.y, s.b.y));
          if (o > 0) cost += o * 4 + 60;
        } else if (!vA && Math.abs(a.y - s.a.y) < 6) {
          var o2 = Math.min(Math.max(a.x, b.x), Math.max(s.a.x, s.b.x)) - Math.max(Math.min(a.x, b.x), Math.min(s.a.x, s.b.x));
          if (o2 > 0) cost += o2 * 4 + 60;
        }
      }
    }
    cost += len + (pts.length - 2) * 46;
    return { cost: cost, pts: pts };
  };

  Router.prototype.best = function (sBox, tBox, sides, offsets) {
    var bestR = { cost: Infinity };
    var self = this;
    sides.forEach(function (pair) {
      self._sSide = pair[0];
      self._tSide = pair[1];
      var sp = port(sBox, pair[0], offsets ? offsets[0] : 0);
      var tp = port(tBox, pair[1], offsets ? offsets[1] : 0);
      self.candidates(sp, tp).forEach(function (c) {
        var r = self.score(c, sBox, tBox);
        // prefer flows that read left to right / top to bottom
        if (r.cost < Infinity && (pair[0] === "left" || pair[0] === "top")) r.cost += 30;
        if (r.cost < bestR.cost) { bestR = r; bestR.sides = pair; }
      });
    });
    return bestR;
  };

  Router.prototype.commit = function (pts) {
    for (var i = 0; i < pts.length - 1; i++) this.placed.push({ a: pts[i], b: pts[i + 1] });
  };

  function routeEdges(L, edges) {
    var allPairs = [];
    SIDES.forEach(function (a) { SIDES.forEach(function (b) { allPairs.push([a, b]); }); });
    // Pass 1: pick sides with centred ports.
    var r1 = new Router(L);
    var picks = edges.map(function (e) {
      var sB = L.boxes[e.from], tB = L.boxes[e.to];
      var r = r1.best(sB, tB, allPairs);
      return r.sides || ["right", "left"];
    });
    // Spread ports that share a side.
    var bySide = {};
    edges.forEach(function (e, i) {
      [[e.from, picks[i][0], e.to], [e.to, picks[i][1], e.from]].forEach(function (x, end) {
        var key = x[0] + ":" + x[1];
        (bySide[key] = bySide[key] || []).push({ i: i, end: end, other: L.boxes[x[2]], side: x[1] });
      });
    });
    var offs = edges.map(function () { return [0, 0]; });
    Object.keys(bySide).forEach(function (key) {
      var g = bySide[key];
      if (g.length < 2) return;
      var horiz = g[0].side === "left" || g[0].side === "right";
      g.sort(function (a, b) {
        return horiz ? a.other.y - b.other.y || a.other.x - b.other.x : a.other.x - b.other.x || a.other.y - b.other.y;
      });
      var span = horiz ? NH - 20 : NW - 40;
      var step = Math.min(16, span / (g.length - 1));
      g.forEach(function (it, k) { offs[it.i][it.end] = (k - (g.length - 1) / 2) * step; });
    });
    // Pass 2: route with fixed sides and spread ports, longer edges first get the clean lanes last.
    var r2 = new Router(L);
    var order = edges.map(function (e, i) { return i; }).sort(function (a, b) {
      var A = L.boxes[edges[a].from], B = L.boxes[edges[a].to], C = L.boxes[edges[b].from], D = L.boxes[edges[b].to];
      return (Math.abs(A.x - B.x) + Math.abs(A.y - B.y)) - (Math.abs(C.x - D.x) + Math.abs(C.y - D.y));
    });
    var routes = [];
    order.forEach(function (i) {
      var e = edges[i];
      var r = r2.best(L.boxes[e.from], L.boxes[e.to], [picks[i]], offs[i]);
      if (!r.pts) r = r2.best(L.boxes[e.from], L.boxes[e.to], allPairs);
      if (!r.pts) {
        var a = L.boxes[e.from], b = L.boxes[e.to];
        r = { pts: [port(a, "right"), port(b, "left")] };
      }
      r2.commit(r.pts);
      routes[i] = r.pts;
    });
    return routes;
  }

  // Long labels wrap to two lines so they fit in the gaps between boxes.
  function labelLines(text) {
    text = String(text);
    if (text.length <= 16 || text.indexOf(" ") < 0) return [text];
    var mid = text.length / 2, best = -1;
    for (var i = 0; i < text.length; i++) {
      if (text[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    }
    return [text.slice(0, best), text.slice(best + 1)];
  }

  function placeLabels(L, edges, routes) {
    var placed = [];
    var boxes = L.list.map(function (b) { return inflate(b, 4); });
    var segs = [];
    routes.forEach(function (pts, i) {
      for (var k = 0; k < pts.length - 1; k++) segs.push({ a: pts[k], b: pts[k + 1], i: i });
    });
    // Place short labels first; they have fewer spots that fit.
    var order = edges.map(function (e, i) { return i; }).sort(function (a, b) {
      return String(edges[a].label || "").length - String(edges[b].label || "").length;
    });
    var out = [];
    order.forEach(function (i) {
      var e = edges[i];
      if (!e.label) { out[i] = null; return; }
      var lines = labelLines(e.label);
      var longest = Math.max.apply(null, lines.map(function (l) { return l.length; }));
      var w = Math.round(longest * LABEL_PX * 0.6 + 12), h = lines.length * (LABEL_PX + 3) + 6;
      var pts = routes[i];
      var best = null;
      for (var s = 0; s < pts.length - 1; s++) {
        var a = pts[s], b = pts[s + 1];
        var segLen = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        var horiz = Math.abs(a.y - b.y) < 0.01;
        [0.5, 0.35, 0.65, 0.2, 0.8].forEach(function (t, ti) {
          var cx = a.x + (b.x - a.x) * t, cy = a.y + (b.y - a.y) * t;
          var r = { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
          var cost = ti * 4 - segLen * 0.02;
          if (horiz && segLen < w + 10) cost += 120;
          if (!horiz && segLen < h + 14) cost += 120;
          boxes.forEach(function (bx) { if (rectsOverlap(r, bx)) cost += 1000; });
          placed.forEach(function (p) { if (rectsOverlap(r, inflate(p, 3))) cost += 800; });
          segs.forEach(function (sg) { if (sg.i !== i && segHitsRect(sg.a, sg.b, r, true)) cost += 40; });
          if (!best || cost < best.cost) best = { cost: cost, x: r.x, y: r.y, w: w, h: h, lines: lines };
        });
      }
      if (best) {
        best.lazy = best.cost >= 700; // no clean spot: show only while the edge is highlighted
        if (!best.lazy) placed.push(best);
      }
      out[i] = best;
    });
    return out;
  }

  /* ---------- render ---------- */

  function render(container, spec, opts) {
    opts = opts || {};
    injectStyle();
    var id = "fd" + ++uid;
    var L = layout(spec);
    var edges = specEdges(spec, L.ids);
    var routes = routeEdges(L, edges);
    var labels = placeLabels(L, edges, routes);
    var nodes = {};
    L.ids.forEach(function (nid) { nodes[nid] = nodeData(nid); });

    var maxChars = Math.floor((NW - 26) / (TITLE_PX * 0.6));
    var out = [];
    out.push('<svg class="fd-svg" xmlns="' + NS + '" role="group" aria-label="' + esc(spec.title || "Diagram") +
      '. Use Tab or the arrow keys to move between components and Enter to open one.">');
    out.push("<title>" + esc(spec.title || "") + "</title>");
    out.push("<defs>");
    [["", "fd-mk"], ["-hl", "fd-mk-hl"]].forEach(function (m) {
      out.push('<marker id="' + id + "-arrow" + m[0] + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto">' +
        '<path class="' + m[1] + '" d="M0 0 L10 5 L0 10 z"/></marker>');
    });
    out.push("</defs>");
    out.push('<g class="fd-view">');
    out.push('<g class="fd-edges">');
    edges.forEach(function (e, i) {
      var kind = KIND_TEXT[e.kind] ? e.kind : "data";
      var d = roundedPath(routes[i]);
      out.push('<g class="fd-edge fd-' + kind + '" data-from="' + esc(e.from) + '" data-to="' + esc(e.to) + '">');
      out.push("<title>" + esc(nodes[e.from].title + " to " + nodes[e.to].title + (e.label ? ": " + e.label : "") + " (" + kind + ")") + "</title>");
      out.push('<path class="fd-line" d="' + d + '" marker-end="url(#' + id + '-arrow)"/>');
      out.push("</g>");
    });
    out.push("</g>");
    out.push('<g class="fd-nodes">');
    L.ids.forEach(function (nid) {
      var b = L.boxes[nid], n = nodes[nid];
      var layer = n.layer || "core";
      var layerInfo = window.Atlas && window.Atlas.layer ? window.Atlas.layer(layer) : { title: layer };
      var color = window.Atlas && window.Atlas.layerColor ? window.Atlas.layerColor(layer) : "var(--layer-" + layer + ", var(--accent))";
      var lines = wrapTitle(n.title || nid, maxChars);
      var tx = b.x + 18;
      var label = (n.title || nid) + ", " + layerInfo.title + " layer" + (n.summary ? ". " + n.summary : "");
      out.push('<g class="fd-node" tabindex="0" role="button" data-id="' + esc(nid) + '" aria-label="' + esc(label) + '" style="--fd-c:' + color + '">');
      out.push("<title>" + esc(n.summary || n.title || nid) + "</title>");
      out.push('<rect class="fd-ring" x="' + (b.x - 5) + '" y="' + (b.y - 5) + '" width="' + (b.w + 10) + '" height="' + (b.h + 10) + '" rx="8"/>');
      out.push('<rect class="fd-box" x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" rx="5"/>');
      out.push('<rect class="fd-bar" x="' + b.x + '" y="' + b.y + '" width="5" height="' + b.h + '" rx="2"/>');
      out.push('<text class="fd-layer" x="' + tx + '" y="' + (b.y + 19) + '">' + esc(layerInfo.title) + "</text>");
      var ty = lines.length === 1 ? b.y + 45 : b.y + 37;
      lines.forEach(function (ln, k) {
        out.push('<text class="fd-title" x="' + tx + '" y="' + (ty + k * 18) + '">' + esc(ln) + "</text>");
      });
      out.push("</g>");
    });
    out.push("</g>");
    out.push('<g class="fd-labels">');
    edges.forEach(function (e, i) {
      var lb = labels[i];
      if (!lb) return;
      var kind = KIND_TEXT[e.kind] ? e.kind : "data";
      var lh = LABEL_PX + 3;
      var y0 = lb.y + lb.h / 2 - ((lb.lines.length - 1) * lh) / 2;
      out.push('<g class="fd-edge fd-elabel fd-' + kind + (lb.lazy ? " fd-lazy" : "") + '" data-from="' + esc(e.from) + '" data-to="' + esc(e.to) + '">' +
        '<rect class="fd-lbg" x="' + lb.x.toFixed(1) + '" y="' + lb.y.toFixed(1) + '" width="' + lb.w + '" height="' + lb.h + '" rx="3"/>' +
        lb.lines.map(function (ln, k) {
          return '<text class="fd-ltext" x="' + (lb.x + lb.w / 2).toFixed(1) + '" y="' + (y0 + k * lh).toFixed(1) + '" text-anchor="middle" dominant-baseline="central">' + esc(ln) + "</text>";
        }).join("") + "</g>");
    });
    out.push("</g>");
    out.push("</g></svg>");

    var kinds = {};
    edges.forEach(function (e) { kinds[KIND_TEXT[e.kind] ? e.kind : "data"] = true; });
    var legend = "";
    if (Object.keys(kinds).length > 1 || kinds.control || kinds.store) {
      legend = '<div class="fd-legend" aria-hidden="true">' +
        ["data", "control", "store"].filter(function (k) { return kinds[k]; }).map(function (k) {
          var dash = k === "control" ? ' stroke-dasharray="7 5"' : k === "store" ? ' stroke-dasharray="2 4" stroke-linecap="round" style="stroke-width:2.2"' : "";
          return '<span><svg viewBox="0 0 30 8"><line x1="0" y1="4" x2="30" y2="4"' + dash + "/></svg>" + k + "</span>";
        }).join("") + "</div>";
    }

    if (opts.compact) legend = "";
    container.innerHTML = '<div class="fd-wrap' + (opts.compact ? " fd-compact" : "") + '">' + out.join("") + (opts.compact ? "" :
      '<div class="fd-ctl"><button type="button" data-z="in" aria-label="Zoom in" title="Zoom in">+</button>' +
      '<button type="button" data-z="out" aria-label="Zoom out" title="Zoom out">−</button>' +
      '<button type="button" data-z="fit" aria-label="Fit diagram" title="Fit diagram">fit</button></div>' +
      '<div class="fd-hint">drag to pan, scroll to zoom</div>') + legend + "</div>";

    var wrap = container.querySelector(".fd-wrap");
    var svg = wrap.querySelector("svg");
    var nodeEls = {};
    Array.prototype.forEach.call(svg.querySelectorAll(".fd-node"), function (g) { nodeEls[g.getAttribute("data-id")] = g; });
    var edgeEls = Array.prototype.slice.call(svg.querySelectorAll(".fd-edge"));

    /* ----- view state ----- */
    var view = { cx: L.bounds.x + L.bounds.w / 2, cy: L.bounds.y + L.bounds.h / 2, k: 1 };
    var anim = null;
    var lastFit = { all: true }; // what to redo on resize until the reader pans or zooms

    function size() {
      return { w: svg.clientWidth || wrap.clientWidth || 800, h: svg.clientHeight || wrap.clientHeight || 500 };
    }
    function apply() {
      var s = size();
      var w = s.w / view.k, h = s.h / view.k;
      svg.setAttribute("viewBox", (view.cx - w / 2).toFixed(2) + " " + (view.cy - h / 2).toFixed(2) + " " + w.toFixed(2) + " " + h.toFixed(2));
    }
    function clampK(k) { return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k)); }
    function fitView(box, maxK, minK) {
      var s = size();
      var k = Math.min(s.w / box.w, s.h / box.h);
      k = Math.min(k, maxK || MAX_ZOOM);
      if (minK) k = Math.max(k, minK);
      return { cx: box.x + box.w / 2, cy: box.y + box.h / 2, k: clampK(k) };
    }
    function animateTo(target, instant) {
      if (anim) cancelAnimationFrame(anim);
      anim = null;
      if (instant || reducedMotion()) { view = target; apply(); return; }
      var from = { cx: view.cx, cy: view.cy, k: view.k };
      var t0 = performance.now(), dur = 520;
      function step(now) {
        var t = Math.min(1, (now - t0) / dur);
        var e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        // interpolate zoom in log space so it feels even
        view = {
          cx: from.cx + (target.cx - from.cx) * e,
          cy: from.cy + (target.cy - from.cy) * e,
          k: Math.exp(Math.log(from.k) + (Math.log(target.k) - Math.log(from.k)) * e)
        };
        apply();
        anim = t < 1 ? requestAnimationFrame(step) : null;
      }
      anim = requestAnimationFrame(step);
    }
    function boxOf(ids) {
      var bs = (ids || []).map(function (i) { return L.boxes[i]; }).filter(Boolean);
      if (!bs.length) return null;
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      bs.forEach(function (b) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
      var p = 48;
      return { x: x0 - p, y: y0 - p, w: x1 - x0 + 2 * p, h: y1 - y0 + 2 * p };
    }
    function fitAll(instant) {
      var s = size();
      // On narrow screens keep titles readable; the reader can pan.
      var minK = s.w < 560 && !opts.compact ? 0.7 : null;
      var t = fitView(L.bounds, opts.compact ? 1 : 1.15, minK);
      if (minK && t.k * L.bounds.w > s.w) t.cx = L.bounds.x + s.w / 2 / t.k; // start at the left edge
      lastFit = { all: true };
      animateTo(t, instant);
    }
    function zoomTo(ids, o) {
      var b = boxOf(ids);
      if (!b) { fitAll(o && o.instant); return; }
      lastFit = { ids: ids, maxZoom: o && o.maxZoom };
      animateTo(fitView(b, (o && o.maxZoom) || 1.25, size().w < 560 ? 0.7 : null), o && o.instant);
    }
    function zoomBy(f, px, py) {
      var s = size();
      var r = svg.getBoundingClientRect();
      if (px == null) { px = r.left + s.w / 2; py = r.top + s.h / 2; }
      var wx = view.cx + (px - r.left - s.w / 2) / view.k;
      var wy = view.cy + (py - r.top - s.h / 2) / view.k;
      var k = clampK(view.k * f);
      view = { cx: wx - (px - r.left - s.w / 2) / k, cy: wy - (py - r.top - s.h / 2) / k, k: k };
      lastFit = null;
      apply();
    }

    /* ----- highlight ----- */
    var selected = null;
    var hoverId = null;
    var extra = null; // ids highlighted from outside
    var extraPairs = null; // { "a>b": true } edges to light up instead of every edge touching a node
    function paint() {
      var active = hoverId ? [hoverId] : extra && extra.length ? extra : null;
      Object.keys(nodeEls).forEach(function (k) { nodeEls[k].classList.remove("fd-hl", "fd-near"); });
      edgeEls.forEach(function (g) { g.classList.remove("fd-hl"); });
      svg.classList.toggle("fd-dim", !!active);
      if (!active) return;
      var set = {};
      active.forEach(function (a) { set[a] = true; if (nodeEls[a]) nodeEls[a].classList.add("fd-hl"); });
      var pairs = !hoverId && extra && extra.length ? extraPairs : null;
      edgeEls.forEach(function (g) {
        var f = g.getAttribute("data-from"), t = g.getAttribute("data-to");
        if (pairs ? pairs[f + ">" + t] : (set[f] || set[t])) {
          g.classList.add("fd-hl");
          if (active.length === 1) {
            if (nodeEls[f] && !set[f]) nodeEls[f].classList.add("fd-near");
            if (nodeEls[t] && !set[t]) nodeEls[t].classList.add("fd-near");
          }
        }
      });
      Array.prototype.forEach.call(svg.querySelectorAll(".fd-edge.fd-hl path.fd-line"), function (p) {
        p.setAttribute("marker-end", "url(#" + id + "-arrow-hl)");
      });
      Array.prototype.forEach.call(svg.querySelectorAll(".fd-edge:not(.fd-hl) path.fd-line"), function (p) {
        p.setAttribute("marker-end", "url(#" + id + "-arrow)");
      });
    }
    function setBadges(badges) {
      Array.prototype.forEach.call(svg.querySelectorAll(".fd-badge"), function (b) { b.parentNode.removeChild(b); });
      if (!badges) return;
      Object.keys(badges).forEach(function (nid) {
        var g = nodeEls[nid], b = L.boxes[nid];
        if (!g || !b || badges[nid] == null || badges[nid] === "") return;
        var text = String(badges[nid]);
        var w = Math.max(22, 9 + text.length * 7.5);
        var el = document.createElementNS(NS, "g");
        el.setAttribute("class", "fd-badge");
        el.setAttribute("aria-hidden", "true");
        el.innerHTML = '<rect x="' + (b.x - 9) + '" y="' + (b.y - 11) + '" width="' + w + '" height="22" rx="11"/>' +
          '<text x="' + (b.x - 9 + w / 2) + '" y="' + b.y + '" text-anchor="middle" dominant-baseline="central">' + esc(text) + "</text>";
        g.appendChild(el);
      });
    }
    function resetMarkers() {
      Array.prototype.forEach.call(svg.querySelectorAll("path.fd-line"), function (p) {
        p.setAttribute("marker-end", "url(#" + id + "-arrow)");
      });
    }
    function setHover(nid) {
      hoverId = nid;
      paint();
      if (!hoverId && !(extra && extra.length)) resetMarkers();
    }
    function select(nid) {
      if (selected && nodeEls[selected]) nodeEls[selected].classList.remove("fd-sel");
      selected = nid && nodeEls[nid] ? nid : null;
      if (selected) nodeEls[selected].classList.add("fd-sel");
    }
    // highlight(ids, { pairs: [[from, to], ...], badges: { nodeId: "1" } })
    // With pairs, only those edges light up (either direction), as for a flow.
    // Badges are small labels on the top-left corner of a node, such as step numbers.
    function highlight(ids, o) {
      o = o || {};
      extra = ids && ids.length ? ids.slice() : null;
      extraPairs = null;
      if (extra && o.pairs) {
        extraPairs = {};
        o.pairs.forEach(function (p) { extraPairs[p[0] + ">" + p[1]] = true; extraPairs[p[1] + ">" + p[0]] = true; });
      }
      setBadges(extra ? o.badges : null);
      paint();
      if (!extra && !hoverId) resetMarkers();
    }

    /* ----- pointer: pan, pinch, click ----- */
    var pointers = {};
    var drag = null;
    svg.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0 && ev.pointerType === "mouse") return;
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var g = ev.target.closest && ev.target.closest(".fd-node");
      var ids = Object.keys(pointers);
      if (ids.length === 1) {
        drag = { x: ev.clientX, y: ev.clientY, cx: view.cx, cy: view.cy, moved: false, node: g ? g.getAttribute("data-id") : null, pid: ev.pointerId };
      } else if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        drag = { pinch: true, d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k, moved: true };
      }
      if (anim) { cancelAnimationFrame(anim); anim = null; }
    });
    svg.addEventListener("pointermove", function (ev) {
      if (!pointers[ev.pointerId]) return;
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      if (!drag) return;
      if (drag.pinch) {
        var ids = Object.keys(pointers);
        if (ids.length < 2) return;
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        var f = (drag.k * d) / drag.d / view.k;
        zoomBy(f, (a.x + b.x) / 2, (a.y + b.y) / 2);
        return;
      }
      var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 5) {
        drag.moved = true;
        svg.classList.add("fd-panning");
        try { svg.setPointerCapture(drag.pid); } catch (e) { /* ignore */ }
      }
      if (drag.moved) {
        view.cx = drag.cx - dx / view.k;
        view.cy = drag.cy - dy / view.k;
        lastFit = null;
        apply();
      }
    });
    function endPointer(ev) {
      var had = pointers[ev.pointerId];
      delete pointers[ev.pointerId];
      if (!had || !drag) return;
      if (!drag.pinch && !drag.moved && drag.node && ev.type === "pointerup") {
        select(drag.node);
        if (opts.onNode) opts.onNode(drag.node);
      }
      if (Object.keys(pointers).length === 0) {
        drag = null;
        svg.classList.remove("fd-panning");
      } else if (drag.pinch) {
        var rest = Object.keys(pointers)[0];
        drag = { x: pointers[rest].x, y: pointers[rest].y, cx: view.cx, cy: view.cy, moved: true, pid: +rest };
      }
    }
    svg.addEventListener("pointerup", endPointer);
    svg.addEventListener("pointercancel", endPointer);
    svg.addEventListener("wheel", function (ev) {
      if (opts.compact && !ev.ctrlKey && !ev.metaKey) return; // let the page scroll
      ev.preventDefault();
      var dy = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
      zoomBy(Math.exp(-dy * (ev.ctrlKey ? 0.01 : 0.0018)), ev.clientX, ev.clientY);
    }, { passive: false });

    svg.addEventListener("pointerover", function (ev) {
      if (drag && drag.moved) return;
      var g = ev.target.closest && ev.target.closest(".fd-node");
      if (g && ev.pointerType === "mouse") setHover(g.getAttribute("data-id"));
    });
    svg.addEventListener("pointerout", function (ev) {
      var g = ev.target.closest && ev.target.closest(".fd-node");
      if (g && !(ev.relatedTarget && g.contains(ev.relatedTarget))) setHover(null);
    });

    /* ----- keyboard ----- */
    function ensureVisible(nid) {
      var b = L.boxes[nid];
      var s = size();
      var w = s.w / view.k, h = s.h / view.k;
      var x0 = view.cx - w / 2, y0 = view.cy - h / 2;
      if (b.x < x0 + 10 || b.y < y0 + 10 || b.x + b.w > x0 + w - 10 || b.y + b.h > y0 + h - 10) {
        lastFit = null;
        animateTo({ cx: b.x + b.w / 2, cy: b.y + b.h / 2, k: Math.max(view.k, Math.min(1, s.w / (b.w + 80))) });
      }
    }
    svg.addEventListener("focusin", function (ev) {
      var g = ev.target.closest && ev.target.closest(".fd-node");
      if (!g) return;
      var nid = g.getAttribute("data-id");
      setHover(nid);
      ensureVisible(nid);
    });
    svg.addEventListener("focusout", function () { setHover(null); });
    svg.addEventListener("keydown", function (ev) {
      var g = ev.target.closest && ev.target.closest(".fd-node");
      if (!g) return;
      var nid = g.getAttribute("data-id");
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        select(nid);
        if (opts.onNode) opts.onNode(nid);
        return;
      }
      var dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[ev.key];
      if (!dir) {
        if (ev.key === "+" || ev.key === "=") { zoomBy(1.25); ev.preventDefault(); }
        else if (ev.key === "-") { zoomBy(0.8); ev.preventDefault(); }
        return;
      }
      ev.preventDefault();
      var a = L.boxes[nid], best = null, bestS = Infinity;
      L.list.forEach(function (b) {
        if (b === a) return;
        var dx = b.x - a.x, dy = b.y - a.y;
        var along = dx * dir[0] + dy * dir[1];
        if (along <= 0) return;
        var across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
        var sc = along + across * 2.5;
        if (sc < bestS) { bestS = sc; best = b; }
      });
      if (best) nodeEls[best.id].focus({ preventScroll: true });
    });

    if (wrap.querySelector(".fd-ctl")) wrap.querySelector(".fd-ctl").addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      var z = b.getAttribute("data-z");
      if (z === "in") zoomBy(1.3);
      else if (z === "out") zoomBy(1 / 1.3);
      else { lastFit = { all: true }; animateTo(fitView(L.bounds, 1.15)); }
    });

    function onResize() {
      if (!lastFit) { apply(); return; }
      var moving = !!anim; // keep animating, but toward a target that fits the new size
      if (lastFit.all) fitAll(!moving);
      else zoomTo(lastFit.ids, { instant: !moving, maxZoom: lastFit.maxZoom });
    }
    var ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(onResize);
      ro.observe(svg);
    } else {
      window.addEventListener("resize", onResize);
    }

    // first view
    if (opts.focus && opts.focus.length) {
      fitAll(true);
      if (reducedMotion()) zoomTo(opts.focus, { instant: true });
      else requestAnimationFrame(function () { zoomTo(opts.focus); });
    } else {
      fitAll(true);
    }
    if (opts.select) select(opts.select);

    return {
      zoomTo: function (ids, o) { zoomTo(ids, o); },
      reset: function () { highlight(null); select(null); fitAll(); },
      fit: function () { fitAll(); },
      select: select,
      highlight: highlight,
      bounds: { w: L.bounds.w, h: L.bounds.h },
      reveal: function (nid) { if (L.boxes[nid]) ensureVisible(nid); },
      has: function (nid) { return !!L.boxes[nid]; },
      focusNode: function (nid) { if (nodeEls[nid]) nodeEls[nid].focus({ preventScroll: true }); },
      destroy: function () {
        if (ro) ro.disconnect(); else window.removeEventListener("resize", onResize);
        if (anim) cancelAnimationFrame(anim);
        container.innerHTML = "";
      }
    };
  }

  window.AtlasDiagram = { render: render };
})();
