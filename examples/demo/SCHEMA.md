# Data contract

The site is plain HTML, CSS and JS with no build step and no network dependencies. It must
work when opened over `file://`. Content lives in `data/*.js` files that set globals,
because `file://` blocks `fetch` and ES module imports in some browsers. `index.html` loads
data first, then `app/core.js`, then the views.

This contract is where the site started, not a limit. Add fields, views or data files when
the project needs them, and record them here.

Source references are objects `{ path: "src/server.ts", line: 120, label: "listen" }`.
`line` and `label` are optional. `ATLAS_SITE.refUrl` turns each one into a link.

Text fields are plain strings. `body` fields may use a small subset of markdown:
paragraphs (blank line), `` `code` ``, `**bold**`, `- ` lists and `[text](url)`. Flow step
`text` may use `` `code` ``, `**bold**` and links. The renderer escapes HTML.

## site.js

```js
window.ATLAS_SITE = {
  title: "Project name",
  tagline: "One line.",
  storageKey: "project",           // localStorage prefix for theme and view choices
  views: ["tldr", "arch", "features"], // nav order; a view that is not loaded is skipped
  nav: "tabs",                     // or "knob" with the knob part (three views)
  repoUrl: "https://github.com/owner/repo",
  refUrl: "https://github.com/owner/repo/blob/{commit}/{path}#L{line}",
  commit: "<full sha the content describes>",
  generated: "2026-01-31"         // date the content was written
};
```

## architecture.js

```js
window.ATLAS_ARCH = {
  intro: "Optional text under the Architecture heading.",
  layers: [                        // colours come from --layer-<id> in theme.css
    { id: "edge", title: "Edge", blurb: "Where traffic enters." }
  ],
  nodes: [
    {
      id: "orders",                 // unique, used in #arch/<id>
      title: "Orders service",
      layer: "core",
      summary: "One sentence.",
      body: "How it works, invariants, failure handling.",
      refs: [ { path: "src/orders/service.ts", line: 30 } ],
      docs: [ "docs/orders.md" ]    // optional, repo paths
    }
  ],
  edges: [
    { from: "gateway", to: "orders", label: "placeOrder()", kind: "data" } // data | control | store
  ],
  diagrams: [
    {
      id: "overview",               // #arch/diagram/<id>
      title: "System overview",
      summary: "One or two sentences.",
      nodes: ["gateway", "orders"], // subset of node ids, at most about 14
      layout: { gateway: [0, 0], orders: [1, 0] }, // grid [col, row], one node per cell
      edges: "auto"                 // every edge between listed nodes, or an explicit array
    }
  ],
  flowGroups: [                     // optional titles for flow groups; ids are paths
    { id: "checkout", title: "Checkout", blurb: "..." },
    { id: "checkout/payments", title: "Payments" }
  ],
  flows: [
    {
      id: "place-order",            // #arch/flow/<id> and #arch/flow/<id>/<step>
      group: "checkout",            // optional, "/" nests: "checkout/payments"
      title: "Place an order",
      summary: "One sentence.",     // optional
      body: "Longer notes.",        // optional
      diagram: "overview",          // optional: the diagram to show it on
      steps: [ { node: "gateway", text: "...", refs: [] } ]
    }
  ]
};
```

A flow lights up its nodes and the edges between consecutive steps, and puts step numbers
on the boxes. Steps on nodes that the chosen diagram does not show stay in the list,
faded.

## tldr.js

```js
window.ATLAS_TLDR = {
  intro: "Two sentences.",
  blocks: [
    {
      id: "in",                     // #tldr/<id>
      title: "Requests in",
      oneLiner: "Short.",
      bullets: ["three to five", "short lines"],
      col: 0, row: 0, span: 1,      // position on the block map; span is optional
      layer: "edge",                // block colour
      nodes: ["clients", "gateway"],// every real node the block stands for, shown as chips
      zoom: { diagram: "checkout", focus: ["clients", "gateway"] } // focus must be on that diagram
    }
  ],
  links: [ { from: "in", to: "decide", label: "placeOrder()" } ]
};
```

## features.js

```js
window.ATLAS_FEATURES = {
  intro: "Optional text under the Features heading.",
  groups: [
    { id: "orders", title: "Orders", blurb: "...",
      subgroups: [ { id: "placing", title: "Placing", blurb: "..." } ] } // optional
  ],
  features: [
    {
      id: "checkout",               // #features/<id>
      group: "orders",
      subgroup: "placing",          // optional, must be in the group's subgroups
      title: "Checkout",
      summary: "One sentence.",
      body: "How it works.",
      usage: ["POST /orders"],      // how it is used or triggered
      config: [ { key: "ORDER_MAX_ITEMS", where: "env", default: "100", note: "..." } ],
      archNodes: ["orders", "db"],  // components it touches, main one first
      flows: ["place-order"],       // optional; otherwise derived from shared components
      invariants: ["What always holds."],
      failures: [ { when: "the database is down", then: "the request fails with 503" } ],
      aliases: ["cart"],            // extra search words
      related: ["cancel-order"],    // optional; otherwise derived from shared components
      refs: [ { path: "src/orders/service.ts", line: 30 } ]
    }
  ]
};
```

Give a group subgroups once it has more than about 12 features. The search box takes
`group/subgroup/words` and `@component`; the URL keeps it as `#features/<id>?q=...`.

## Hidden items

Any item above (layer, node, edge, diagram, flow, flow group, TL;DR block, link, feature
group, subgroup, feature) may carry `hidden: true`. It stays in the data, where tools can
use it, but the page leaves it out: no box, no list entry, no search hit. Use it to keep
detail the page does not need. Views read the filtered data through `Atlas.arch()`,
`Atlas.features()` and `Atlas.tldr()`; `window.ATLAS_*` keeps everything.

## Routing and keys

`#<view>` and view-specific parts after it. Architecture: `#arch`, `#arch/<nodeId>`,
`#arch/diagram/<id>[?focus=a,b]`, `#arch/flow/<id>[/<step>]`, `#arch/feature/<id>`.
Features: `#features`, `#features/<id>`, both with `?q=<search>&view=cards|list`. TL;DR: `#tldr`,
`#tldr/<blockId>`, `#tldr/<blockId>/zoom`.

Number keys switch views in nav order. `/` focuses the shown view's own search (the flow
picker on Architecture, the feature search on Features) and Cmd/Ctrl+K the global search.
`Esc` closes a sidebar or leaves fullscreen. Features also has `j` and `k` (next and
previous), `v` (cards or list), `a` (show on the architecture) and `\` (fold the
inspector).

## Code

| File | What it does |
|---|---|
| `app/core.js` | `window.Atlas` helpers, router, nav, global search, theme |
| `app/base.css` | page structure and shared blocks, using theme tokens only |
| `theme.css` | colours, fonts and anything else about the look |
| `app/diagram.js` | `window.AtlasDiagram.render(el, diagramSpec, { focus, onNode })` returns `{ zoomTo, fit, reset, select, highlight(ids, { pairs, badges }), reveal, has, destroy }` |
| `app/arch-view.js` | Architecture view |
| `app/tldr-view.js` | TL;DR view |
| `app/features-view.js` | Features view |

A view registers itself before boot:

```js
window.AtlasViews.myview = {
  label: "My view",
  mount(rootEl) {},                // once, the first time it is shown
  route(parts, query) {},          // hash parts after the view id, and ?key=value pairs
  search(query) { return [ { title, hint, hash } ]; } // optional, feeds the global search
};
```

Then add its id to `ATLAS_SITE.views` and a `<script>` tag to `index.html`.
