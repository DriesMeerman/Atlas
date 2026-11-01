/* Atlas core: helpers, router, nav, search and theme. Plain script, no modules.
 *
 * Reads window.ATLAS_SITE (data/site.js). Views register themselves on
 * window.AtlasViews before boot:
 *
 *   window.AtlasViews.arch = { label: "Architecture", mount(rootEl), route(parts), search(q) }
 *
 * ATLAS_SITE.views sets the order. A view file that is not loaded is skipped.
 */
(function () {
  "use strict";

  var SITE = window.ATLAS_SITE || {};
  var DEFAULT_LABELS = { tldr: "TL;DR", arch: "Architecture", features: "Features" };
  var DEFAULT_LAYERS = [
    { id: "edge", title: "Edge", blurb: "Where traffic enters and leaves." },
    { id: "core", title: "Core", blurb: "Request handling and decisions." },
    { id: "jobs", title: "Jobs", blurb: "Background and long-running work." },
    { id: "storage", title: "Storage", blurb: "State on disk or in a database." },
    { id: "external", title: "External", blurb: "Services outside this system." }
  ];
  var VIEWS = []; // filled at boot from SITE.views and the registered views

  window.AtlasViews = window.AtlasViews || {};

  function storageKey(name) { return (SITE.storageKey || "atlas") + "-" + name; }

  // ---------- Text helpers ----------

  function esc(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeUrl(url) {
    var u = String(url).trim();
    if (/^(https?:|mailto:|#|\.{0,2}\/)/i.test(u) || !/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
    return "#";
  }

  // Inline markdown on one line: `code`, **bold**, [text](url). Escapes everything else.
  function mdInline(text) {
    var codes = [];
    var s = String(text == null ? "" : text).replace(/`([^`]+)`/g, function (_, c) {
      codes.push("<code>" + esc(c) + "</code>");
      return "\u0000" + (codes.length - 1) + "\u0000";
    });
    s = esc(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, url) {
      var href = safeUrl(url.replace(/&amp;/g, "&"));
      var external = /^https?:/i.test(href);
      return '<a href="' + esc(href) + '"' + (external ? ' target="_blank" rel="noopener"' : "") + ">" + label + "</a>";
    });
    return s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return codes[+i]; });
  }

  // Block markdown: paragraphs split by blank lines, and "- " lists.
  function md(text) {
    var blocks = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split(/\n\s*\n/);
    var out = [];
    blocks.forEach(function (block) {
      var lines = block.split("\n").filter(function (l) { return l.trim() !== ""; });
      if (!lines.length) return;
      var html = "";
      var list = null;
      var para = [];
      function flushPara() {
        if (para.length) html += "<p>" + mdInline(para.join(" ")) + "</p>";
        para = [];
      }
      function flushList() {
        if (list) html += "<ul>" + list.map(function (li) { return "<li>" + mdInline(li) + "</li>"; }).join("") + "</ul>";
        list = null;
      }
      lines.forEach(function (line) {
        var m = /^\s*[-*]\s+(.*)$/.exec(line);
        if (m) {
          flushPara();
          list = list || [];
          list.push(m[1]);
        } else if (list && /^\s{2,}\S/.test(line)) {
          list[list.length - 1] += " " + line.trim();
        } else {
          flushList();
          para.push(line.trim());
        }
      });
      flushPara();
      flushList();
      out.push(html);
    });
    return out.join("");
  }

  // ---------- Source references ----------
  // ATLAS_SITE.refUrl is a template with {path}, {line} and {commit}, for example
  // "https://github.com/owner/repo/blob/{commit}/{path}#L{line}". The "#L{line}" part is
  // dropped when a ref has no line.

  function refUrl(ref) {
    if (!ref || !ref.path) return "#";
    var tpl = SITE.refUrl;
    if (!tpl) return "#";
    var path = String(ref.path).replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
    var line = ref.line ? String(parseInt(ref.line, 10)) : "";
    var url = tpl.replace("{commit}", encodeURIComponent(SITE.commit || "main")).replace("{path}", path);
    if (!line) url = url.replace(/[#?][^#?]*\{line\}[^#?]*$/, "");
    return url.replace("{line}", line);
  }

  function refLink(ref) {
    if (!ref || !ref.path) return "";
    var where = ref.path + (ref.line ? ":" + ref.line : "");
    var url = refUrl(ref);
    var inner = '<span class="ref-path">' + esc(where) + "</span>" + (ref.label ? ' <span class="ref-label">' + esc(ref.label) + "</span>" : "");
    if (url === "#") return '<span class="ref">' + inner + "</span>";
    return '<a class="ref" href="' + esc(url) + '" target="_blank" rel="noopener">' + inner + "</a>";
  }

  function refList(refs) {
    if (!refs || !refs.length) return "";
    return '<ul class="refs">' + refs.map(function (r) { return "<li>" + refLink(r) + "</li>"; }).join("") + "</ul>";
  }

  function emptyState(title, detail) {
    return '<div class="empty-state" role="status"><strong>' + esc(title) + "</strong>" +
      (detail ? "<p>" + mdInline(detail) + "</p>" : "") + "</div>";
  }

  // ---------- Architecture lookups shared by views ----------

  // Data items with hidden: true stay in data/*.js (for tools and later use) but are left
  // out of the page. Views read the filtered copies below; window.ATLAS_* stays complete.
  function visible(list) { return (list || []).filter(function (x) { return x && !x.hidden; }); }
  var cache = {};
  function rawArch() { return window.ATLAS_ARCH || { nodes: [], edges: [], diagrams: [], flows: [] }; }
  function arch() {
    if (cache.arch) return cache.arch;
    var raw = rawArch();
    var hid = {};
    (raw.nodes || []).forEach(function (n) { if (n && n.hidden) hid[n.id] = true; });
    var edgeOk = function (e) { return e && !e.hidden && !hid[e.from] && !hid[e.to]; };
    var out = {};
    Object.keys(raw).forEach(function (k) { out[k] = raw[k]; });
    out.nodes = visible(raw.nodes);
    out.edges = (raw.edges || []).filter(edgeOk);
    out.diagrams = visible(raw.diagrams).map(function (d) {
      var c = {};
      Object.keys(d).forEach(function (k) { c[k] = d[k]; });
      c.nodes = (d.nodes || []).filter(function (n) { return !hid[n]; });
      if (Array.isArray(d.edges)) c.edges = d.edges.filter(edgeOk);
      return c;
    });
    out.flows = visible(raw.flows);
    out.flowGroups = visible(raw.flowGroups);
    out.layers = visible(raw.layers);
    cache.arch = out;
    return out;
  }
  function features() {
    if (cache.features) return cache.features;
    var raw = window.ATLAS_FEATURES || { groups: [], features: [] };
    var hiddenGroups = {};
    (raw.groups || []).forEach(function (g) { if (g && g.hidden) hiddenGroups[g.id] = true; });
    var out = {};
    Object.keys(raw).forEach(function (k) { out[k] = raw[k]; });
    out.groups = visible(raw.groups).map(function (g) {
      var c = {};
      Object.keys(g).forEach(function (k) { c[k] = g[k]; });
      c.subgroups = visible(g.subgroups);
      return c;
    });
    out.features = visible(raw.features).filter(function (f) { return !hiddenGroups[f.group]; });
    cache.features = out;
    return out;
  }
  function tldr() {
    if (cache.tldr) return cache.tldr;
    var raw = window.ATLAS_TLDR || { intro: "", blocks: [], links: [] };
    var out = {};
    Object.keys(raw).forEach(function (k) { out[k] = raw[k]; });
    out.blocks = visible(raw.blocks);
    var ids = {};
    out.blocks.forEach(function (b) { ids[b.id] = true; });
    out.links = visible(raw.links).filter(function (l) { return ids[l.from] && ids[l.to]; });
    cache.tldr = out;
    return out;
  }
  function layers() { return (arch().layers && arch().layers.length) ? arch().layers : DEFAULT_LAYERS; }
  function layer(id) {
    var ls = layers();
    for (var i = 0; i < ls.length; i++) if (ls[i].id === id) return ls[i];
    return { id: id, title: id, blurb: "" };
  }
  // CSS colour for a layer. Themes define --layer-<id>; unknown layers fall back to the accent.
  function layerColor(id) { return "var(--layer-" + String(id || "core").replace(/[^a-z0-9_-]/gi, "") + ", var(--accent))"; }
  function byId(list, id) {
    list = list || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  // Visible nodes first; a hidden node is still found so links to it can show its title.
  function node(id) { return byId(arch().nodes, id) || byId(rawArch().nodes, id); }
  function diagram(id) { return byId(arch().diagrams, id); }
  function flow(id) { return byId(arch().flows, id); }

  // ---------- Theme ----------

  var themeFns = [];
  function getTheme() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  }
  function setTheme(t, save) {
    document.documentElement.setAttribute("data-theme", t);
    if (save) {
      try { localStorage.setItem(storageKey("theme"), t); } catch (e) {}
    }
    paintThemeButton();
    themeFns.forEach(function (fn) {
      try { fn(t); } catch (e) { console.error(e); }
    });
  }
  function onTheme(fn) {
    if (typeof fn === "function") themeFns.push(fn);
  }
  function paintThemeButton() {
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    var next = getTheme() === "dark" ? "light" : "dark";
    btn.innerHTML = (next === "light"
      ? '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.2" fill="currentColor"/><g stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3"/></g></svg>'
      : '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 10.2A6 6 0 0 1 5.8 2.5a6 6 0 1 0 7.7 7.7z" fill="currentColor"/></svg>') +
      "<span>" + (next === "light" ? "Light" : "Dark") + "</span>";
    btn.setAttribute("aria-label", "Switch to " + next + " theme");
  }

  // ---------- Views and router ----------

  var state = { view: null, mounted: {}, lastHash: {} };
  var nav = null; // { set(index) }

  function buildViews() {
    var order = SITE.views && SITE.views.length ? SITE.views.slice() : ["tldr", "arch", "features"];
    Object.keys(window.AtlasViews).forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); });
    VIEWS = order.filter(function (id) { return window.AtlasViews[id]; }).map(function (id, i) {
      var v = window.AtlasViews[id];
      return { id: id, label: v.label || DEFAULT_LABELS[id] || id, key: String(i + 1) };
    });
    var main = document.getElementById("main");
    VIEWS.forEach(function (v) {
      if (document.getElementById("view-" + v.id)) return;
      var s = document.createElement("section");
      s.className = "view";
      s.id = "view-" + v.id;
      s.setAttribute("data-view", v.id);
      s.setAttribute("aria-label", v.label);
      s.hidden = true;
      s.innerHTML = '<div class="view-root"></div>';
      main.insertBefore(s, main.querySelector(".view-anchor") || null);
    });
  }

  function viewLabel(id) {
    for (var i = 0; i < VIEWS.length; i++) if (VIEWS[i].id === id) return VIEWS[i].label;
    return id;
  }

  // "#view/a/b?x=1&y=2" -> { view, parts: ["a", "b"], query: { x: "1", y: "2" } }
  function parseHash(hash) {
    var h = String(hash || "").replace(/^#\/?/, "");
    var query = {};
    var qi = h.indexOf("?");
    if (qi >= 0) {
      h.slice(qi + 1).split("&").forEach(function (kv) {
        if (!kv) return;
        var eq = kv.indexOf("=");
        var k = eq < 0 ? kv : kv.slice(0, eq);
        var v = eq < 0 ? "" : kv.slice(eq + 1);
        try { query[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, " ")); } catch (e) { query[k] = v; }
      });
      h = h.slice(0, qi);
    }
    var parts = h.split("/").filter(Boolean).map(function (p) {
      try { return decodeURIComponent(p); } catch (e) { return p; }
    });
    var view = parts.shift();
    if (!VIEWS.some(function (v) { return v.id === view; })) return { view: VIEWS.length ? VIEWS[0].id : null, parts: [], query: {} };
    return { view: view, parts: parts, query: query };
  }

  function go(hash) {
    var h = String(hash || "");
    if (h.charAt(0) !== "#") h = "#" + h;
    if (location.hash === h) route();
    else location.hash = h;
  }

  // Change the URL without running the router (for state the view already shows).
  function replaceHash(hash) {
    try { history.replaceState(null, "", hash.charAt(0) === "#" ? hash : "#" + hash); } catch (e) { /* file:// may refuse */ }
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function sectionFor(id) { return document.getElementById("view-" + id); }

  function mountView(id) {
    var root = sectionFor(id).querySelector(".view-root");
    var v = window.AtlasViews[id];
    try {
      v.mount(root);
      state.mounted[id] = true;
    } catch (e) {
      console.error(e);
      root.innerHTML = emptyState(viewLabel(id) + " view failed to start", "See the browser console for the error.");
      state.mounted[id] = "failed";
    }
  }

  function route() {
    var r = parseHash(location.hash);
    if (!r.view) return;
    var changed = state.view !== r.view;
    state.lastHash[r.view] = location.hash || "#" + r.view;

    if (changed) {
      VIEWS.forEach(function (v) {
        var s = sectionFor(v.id);
        if (v.id === r.view) s.removeAttribute("hidden");
        else s.setAttribute("hidden", "");
      });
      if (!state.mounted[r.view]) mountView(r.view);
      var label = viewLabel(r.view);
      document.title = label + " | " + (SITE.title || "Docs");
      var status = document.getElementById("view-status");
      if (status && state.view) status.textContent = label + " view";
      if (state.view && !prefersReducedMotion()) playTransition(sectionFor(r.view));
      state.view = r.view;
      if (nav) nav.set(VIEWS.map(function (v) { return v.id; }).indexOf(r.view));
      if (!r.parts.length) window.scrollTo(0, 0);
    }

    var v = window.AtlasViews[r.view];
    if (state.mounted[r.view] === true && v && typeof v.route === "function") {
      try { v.route(r.parts, r.query); } catch (e) { console.error(e); }
    }
  }

  var transitionTimer = null;
  function playTransition(section) {
    section.classList.remove("is-entering");
    void section.offsetWidth; // restart the animation
    section.classList.add("is-entering");
    clearTimeout(transitionTimer);
    transitionTimer = setTimeout(function () { section.classList.remove("is-entering"); }, 400);
  }

  function switchTo(index) {
    var v = VIEWS[index];
    if (!v || state.view === v.id) return;
    go(state.lastHash[v.id] || "#" + v.id);
  }

  // Plain tabs in #nav. The optional knob part replaces them when ATLAS_SITE.nav is "knob".
  function setupNav() {
    var host = document.getElementById("nav");
    if (!host) return;
    var current = VIEWS.map(function (v) { return v.id; }).indexOf(parseHash(location.hash).view);
    if (SITE.nav === "knob" && window.AtlasKnob) {
      nav = window.AtlasKnob.create(host, {
        options: VIEWS.map(function (v) { return v.label.toUpperCase(); }),
        names: VIEWS.map(function (v) { return v.label; }),
        label: "View",
        value: current,
        onChange: switchTo
      });
      return;
    }
    host.innerHTML = '<nav class="nav-tabs" aria-label="Views">' + VIEWS.map(function (v, i) {
      return '<a class="nav-tab" href="#' + esc(v.id) + '" data-i="' + i + '"><span>' + esc(v.label) + '</span><kbd aria-hidden="true">' + v.key + "</kbd></a>";
    }).join("") + "</nav>";
    host.addEventListener("click", function (e) {
      var a = e.target.closest(".nav-tab");
      if (!a) return;
      e.preventDefault();
      switchTo(+a.getAttribute("data-i"));
    });
    nav = {
      set: function (i) {
        Array.prototype.forEach.call(host.querySelectorAll(".nav-tab"), function (a, j) {
          if (j === i) a.setAttribute("aria-current", "page");
          else a.removeAttribute("aria-current");
        });
      }
    };
    nav.set(current);
  }

  // ---------- Global search ----------

  function collectResults(query) {
    var q = query.trim();
    if (!q) return [];
    var groups = [];
    VIEWS.forEach(function (v) {
      var view = window.AtlasViews[v.id];
      if (!view || typeof view.search !== "function") return;
      var items = [];
      try { items = view.search(q) || []; } catch (e) { console.error(e); }
      items = items.filter(function (it) { return it && it.hash; }).slice(0, 8);
      if (items.length) groups.push({ label: v.label, items: items });
    });
    return groups;
  }

  function setupSearch() {
    var input = document.getElementById("search-input");
    var list = document.getElementById("search-results");
    if (!input || !list) return;
    var flat = [];
    var active = -1;

    function close() {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      active = -1;
    }
    function highlight(i) {
      var opts = list.querySelectorAll(".res");
      opts.forEach(function (o) { o.setAttribute("aria-selected", "false"); });
      active = i;
      if (i >= 0 && opts[i]) {
        opts[i].setAttribute("aria-selected", "true");
        input.setAttribute("aria-activedescendant", opts[i].id);
        opts[i].scrollIntoView({ block: "nearest" });
      } else {
        input.removeAttribute("aria-activedescendant");
      }
    }
    function choose(i) {
      var it = flat[i];
      if (!it) return;
      close();
      input.blur();
      go(it.hash);
    }
    function render() {
      var q = input.value;
      if (!q.trim()) { close(); return; }
      var groups = collectResults(q);
      flat = [];
      var html = "";
      groups.forEach(function (g) {
        html += '<li class="res-group" role="presentation">' + esc(g.label) + "</li>";
        g.items.forEach(function (it) {
          var i = flat.length;
          flat.push(it);
          html += '<li class="res" role="option" id="res-' + i + '" data-i="' + i + '" aria-selected="false">' +
            '<span class="res-title">' + esc(it.title) + "</span>" +
            (it.hint ? '<span class="res-hint">' + esc(it.hint) + "</span>" : "") + "</li>";
        });
      });
      if (!flat.length) html = '<li class="res-empty" role="presentation">No matches for "' + esc(q.trim()) + '".</li>';
      list.innerHTML = html;
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      highlight(flat.length ? 0 : -1);
    }

    input.addEventListener("input", render);
    input.addEventListener("focus", function () { if (input.value.trim()) render(); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); if (list.hidden) render(); else highlight(Math.min(flat.length - 1, active + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); highlight(Math.max(0, active - 1)); }
      else if (e.key === "Enter") { e.preventDefault(); choose(active >= 0 ? active : 0); }
      else if (e.key === "Escape") {
        if (!list.hidden) { e.preventDefault(); close(); }
        else if (input.value) { input.value = ""; }
        else input.blur();
      }
    });
    list.addEventListener("mousedown", function (e) { e.preventDefault(); }); // keep focus in the input
    list.addEventListener("click", function (e) {
      var opt = e.target.closest(".res");
      if (opt) choose(+opt.getAttribute("data-i"));
    });
    input.addEventListener("blur", function () { setTimeout(close, 120); });
  }

  // Simple scorer views can share: returns 0 for no match, higher is better.
  function score(query, fields) {
    var words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return 0;
    var total = 0;
    for (var w = 0; w < words.length; w++) {
      var best = 0;
      for (var f = 0; f < fields.length; f++) {
        var text = String(fields[f] || "").toLowerCase();
        var at = text.indexOf(words[w]);
        if (at === -1) continue;
        var s = (fields.length - f) * 2 + (at === 0 ? 3 : 0);
        if (s > best) best = s;
      }
      if (!best) return 0;
      total += best;
    }
    return total;
  }

  // ---------- Keys ----------

  function isShown(el) { return !!(el && el.offsetParent !== null); }

  function isTyping(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  function setupKeys() {
    document.addEventListener("keydown", function (e) {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
        var g = document.getElementById("search-input");
        if (g) { e.preventDefault(); g.focus(); g.select(); }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === "/") {
        // The shown view's own search if it claimed "/" (see claimSlash), else the global one.
        var own = slashOwner && slashOwner();
        var input = own || document.getElementById("search-input");
        if (input) { e.preventDefault(); input.focus(); if (input.select) input.select(); }
        return;
      }
      var idx = VIEWS.map(function (v) { return v.key; }).indexOf(e.key);
      if (idx !== -1) { e.preventDefault(); switchTo(idx); }
    });
  }

  var slashOwner = null;
  // fn returns an input element to focus on "/" while its view is shown, or null.
  // The global search stays on Cmd/Ctrl+K.
  function claimSlash(fn) {
    var prev = slashOwner;
    slashOwner = function () { return fn() || (prev ? prev() : null); };
  }

  // ---------- Boot ----------

  function paintBrand() {
    var t = document.getElementById("site-title");
    if (t && SITE.title) t.textContent = SITE.title;
    var g = document.getElementById("site-tagline");
    if (g) { if (SITE.tagline) g.textContent = SITE.tagline; else g.hidden = true; }
    var s = document.getElementById("site-source");
    if (s) {
      var bits = [];
      if (SITE.repoUrl) bits.push('Source: <a href="' + esc(SITE.repoUrl) + '">' + esc(SITE.repoUrl.replace(/^https?:\/\//, "")) + "</a>");
      if (SITE.commit) bits.push((SITE.repoUrl ? "at " : "Commit ") + "<code>" + esc(String(SITE.commit).slice(0, 7)) + "</code>");
      if (SITE.generated) bits.push("generated " + esc(SITE.generated));
      if (bits.length) s.innerHTML = bits.join(" ");
      else s.hidden = true;
    }
  }

  function boot() {
    buildViews();
    paintBrand();
    var btn = document.getElementById("theme-toggle");
    if (btn) {
      paintThemeButton();
      btn.addEventListener("click", function () { setTheme(getTheme() === "dark" ? "light" : "dark", true); });
    }
    // Follow the system setting until the reader picks a theme.
    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: light)");
      var follow = function (e) {
        var saved = null;
        try { saved = localStorage.getItem(storageKey("theme")); } catch (err) {}
        if (!saved) setTheme(e.matches ? "light" : "dark", false);
      };
      if (mq.addEventListener) mq.addEventListener("change", follow);
      else if (mq.addListener) mq.addListener(follow);
    }
    var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
    var sk = document.querySelector(".search-key");
    if (sk) sk.textContent = mac ? "\u2318K" : "Ctrl K";
    var gk = document.getElementById("global-key");
    if (gk) gk.textContent = mac ? "\u2318K" : "Ctrl K";
    var keys = document.getElementById("view-keys");
    if (keys) keys.innerHTML = VIEWS.map(function (v) { return "<kbd>" + v.key + "</kbd>"; }).join(" ");

    setupNav();
    setupSearch();
    setupKeys();
    window.addEventListener("hashchange", route);
    route();
  }

  window.Atlas = {
    site: SITE,
    md: md,
    mdInline: mdInline,
    esc: esc,
    refLink: refLink,
    refUrl: refUrl,
    refList: refList,
    emptyState: emptyState,
    score: score,
    go: go,
    replaceHash: replaceHash,
    onTheme: onTheme,
    theme: getTheme,
    reducedMotion: prefersReducedMotion,
    claimSlash: claimSlash,
    isTyping: isTyping,
    isShown: isShown,
    parseHash: function (h) { return parseHash(h == null ? location.hash : h); },
    arch: arch,
    features: features,
    tldr: tldr,
    visible: visible,
    layers: layers,
    layer: layer,
    layerColor: layerColor,
    node: node,
    diagram: diagram,
    flow: flow,
    storageKey: storageKey,
    views: function () { return VIEWS.slice(); }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else setTimeout(boot, 0);
})();
