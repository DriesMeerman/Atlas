# Repository instructions

atlas is a set of plain-JS parts for interactive architecture docs sites. Sites copy the
parts they need (`scripts/add.mjs`) and own those copies from then on. A site may change
any copied file; nothing here may assume a site still matches the engine.

## Rules for parts

- Plain browser JS and CSS. No build step, no modules, no runtime network requests. A site
  must work when opened over `file://`.
- Each part is one file (or a JS and CSS pair) that a site can take or leave. Talk to other
  parts only through the globals documented in `templates/site/SCHEMA.md`: `window.Atlas`,
  `window.AtlasViews`, `window.AtlasDiagram` and the `ATLAS_*` data globals.
- Styles use theme tokens only (`--bg`, `--panel`, `--accent`, `--layer-<id>` and the rest
  listed in `parts/base.css`). No colours or fonts in parts except the neutral fallbacks in
  `parts/theme.css`.
- Desktop first: use the width of a wide screen, then make narrow screens work.
- Keyboard and screen readers work for everything a mouse can do.
- No project names. The demo in `examples/demo` is made up.

## After changing a part

1. `node --check` every changed JS file.
2. Rebuild the demo: `node scripts/add.mjs --to examples/demo arch tldr features --force`.
3. `node scripts/check.mjs examples/demo`.
4. Open `examples/demo/index.html` and click through the changed view in both themes, at a
   wide and a phone width.
5. Update `templates/site/SCHEMA.md` when data fields or the view API change, and
   `registry.json` when files are added or renamed.

Record design decisions in `DESIGN.md`.
