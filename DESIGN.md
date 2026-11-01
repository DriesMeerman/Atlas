# Design notes

Decisions behind atlas and the `architecture-docs` skill that builds sites with it, with the
reasons. Newest last.

## Engine, not a framework

- **Parts are copied, not installed.** Like shadcn/ui: `scripts/add.mjs` copies the parts a
  site picks into the site's `app/` folder. From then on the site owns them. A generated
  site may change any part, or add its own, when the project needs it. Diverging on every
  run is fine; the engine is a starting point that saves building the hard parts (edge
  routing, pan and zoom, the TL;DR map) from scratch.
- **Design tokens are a floor, not a ceiling.** Parts use the tokens in `theme.css`, but a
  site may add tokens, fonts, textures or per-part overrides, or rewrite a part's styles.
  The model building a site is told this directly.
- `atlas.json` in each site records the engine commit and a hash per copied file, so
  `add.mjs --status` can tell "edited here" from "changed upstream" and updates never
  overwrite local edits without `--force`.

## Output

- **Folder by default, at `docs/architecture-site/`**, with content in `data/*.js`.
  Separate data files make updates small: an update edits the entries a code change
  touches. The folder also gets an `AGENTS.md` (and a `CLAUDE.md` that imports it)
  explaining the layout and the update steps, and a `SOURCE.md` with the commit the content
  describes.
- **Single page on request**: the same folder built in a temporary directory, then
  `scripts/inline.mjs` writes one self-contained HTML file. Updating it means rebuilding.
- Plain HTML, CSS and JS, no build, no CDN, works over `file://`.
- Source links point at the recorded commit (`ATLAS_SITE.refUrl` with `{commit}`), so line
  numbers stay right after the code moves on.

## Audience and layout

- Engineers reading internal, mostly backend, technical docs.
- **Desktop first.** Pages use up to 1840px. The map and its sidebar sit side by side so
  the sidebar can open without shrinking the map to nothing. Mobile works (the sidebar
  becomes a bottom sheet) but is not the target.

## Architecture view

- A diagram is a hand-placed grid (`layout: { id: [col, row] }`). Automatic layout was
  rejected: a model placing about a dozen nodes on a grid gives readable diagrams, and the
  router handles the edges.
- **Flow picker between the map and the flow list.** Type to search flows and components.
  `/` digs down through flow groups (`checkout/payments/capture-payment/3`), with
  completion, breadcrumbs, and Backspace after a `/` to go up a level. Picking a flow:
  - lights up its nodes and only the edges between consecutive steps, with step numbers
    on the boxes;
  - opens the sidebar with the flow's steps, each linking to its code;
  - filters the flow list below to the group in the picker.
- **The sidebar collapses or closes.** Collapse folds it to a rail and keeps the selection
  lit on the map. Close clears the selection.
- **Fullscreen** covers the diagram tabs, the map, the sidebar and the flow picker, so a
  selected flow stays selected and visible. It falls back to a fixed overlay where the
  Fullscreen API is missing.
- Flows show as cards (all steps visible) or as a list (one row per flow with its
  components). The choice is remembered.

## TL;DR view

- A grid of 4 to 8 blocks that tells the story of the system in reading order. Each block
  opens to a few bullets and the real components inside it, then zooms into the real
  diagram with those components highlighted.

## Skill

- Invoked manually only (`disable-model-invocation: true`).
- Asks which pages to make (TL;DR, Architecture, Features) and folder or single page.
- Small, fast subagents gather facts (each returns file and line evidence). A large model
  (Opus on Claude, Sol on Codex) designs the diagrams, flows, TL;DR story and features,
  and the theme. Both Claude Code and Codex are supported as hosts.
- Matches the project's own style when it has one (brand colours, an existing docs or app
  theme, fonts). When it has none, the model invents a look that suits the project.
- `/architecture-docs update` diffs the code since the recorded commit and updates only the
  affected entries.

## Hidden items and generation date

- Any data item (layer, node, edge, diagram, flow, flow group, TL;DR block, feature group,
  feature) can carry `hidden: true`. It stays in `data/*.js` but is left off the page:
  diagrams, lists, search and the TL;DR skip it, and links from visible items still show
  its title. Large projects can record more than the page needs, since the generating
  model has already read the code. Views read filtered data through `Atlas.arch()`,
  `Atlas.features()` and `Atlas.tldr()`; the raw `window.ATLAS_*` globals stay complete.
- `ATLAS_SITE.generated` (a date) and `commit` record when and from what the content was
  written. The footer shows both, and `SOURCE.md` repeats them.

## Future, not built

- **Impact tracing.**¹ The site data is a small code graph: refs tie nodes, flow steps and
  features to files and lines. A later tool could map a diff to the refs it touches, then
  to nodes, flows and features, and list the flows a change may affect. Keep the data
  complete and machine-readable with that in mind: stable ids, refs with paths, hidden
  items kept, commit and date recorded.

¹ Raised by the owner while building the first version; deliberately left for later.
