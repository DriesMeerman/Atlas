# atlas

Parts for interactive architecture docs sites: a TL;DR block map that zooms into the real
diagrams, architecture diagrams with a component sidebar and flows that light up their
path, and a features catalog you can scope with `group/subgroup` paths and filter by
component.

Sites are plain HTML, CSS and JS. They have no build step, make no network requests, and
open straight from disk (`file://`). Content lives in `data/*.js`, so an update edits only
the entries a code change touches.

atlas is the engine behind the
[`architecture-docs`](https://github.com/DriesMeerman/3stack-skills/blob/main/skills/architecture-docs/SKILL.md)
agent skill. The skill reads a repository with small, fast subagents, has a large model
design the diagrams, flows and TL;DR, and assembles a site from these parts.

## Copy the parts in, then change them

Parts are copied into a site rather than installed, the way shadcn/ui works. Once copied,
the site owns them. A project that needs a different layout, another view or a custom node
shape changes its copy. `atlas.json` in each site records which engine commit the parts
came from and a hash of each file, so later updates leave local edits alone.

```sh
git clone https://github.com/DriesMeerman/atlas
node atlas/scripts/add.mjs --to docs/architecture-site --title "My service" arch tldr features
node atlas/scripts/check.mjs docs/architecture-site --repo .
open docs/architecture-site/index.html
```

| Script | What it does |
|---|---|
| `scripts/add.mjs` | Copies parts and templates into a site. Run it with `--status` to see which engine files a site edited and which changed upstream. |
| `scripts/check.mjs` | Checks a site's data: unknown ids, overlapping grid cells, flows and features that point at missing nodes, and (with `--repo`) refs to missing files or lines. |
| `scripts/inline.mjs` | Writes a site folder out as one self-contained HTML file. |

## Parts

| Part | Files | What it is |
|---|---|---|
| `core` | `core.js`, `base.css` | Router, nav, global search (Cmd/Ctrl+K), theme toggle, markdown and source-link helpers, hidden-item filtering |
| `theme` | `theme.css` | Colour and font tokens. Every site gets its own. |
| `diagram` | `diagram.js` | SVG renderer: grid layout, orthogonal edge routing, pan and zoom, keyboard focus, highlights and step badges |
| `arch` | `arch-view.js` | Diagram tabs, the map with a sidebar that collapses or closes, fullscreen, a flow picker with `/` paths, flows as cards or a list, and a component index |
| `tldr` | `tldr-view.js` | A block map that tells the system's story, where each block opens and zooms into the real diagram |
| `features` | `features-view.js` | Group rail with counts, search with `group/` scopes and `@component` filters, cards or list, and an inspector with a small diagram, config, invariants, failure modes, flows and related features |
| `knob` | `knob.js`, `knob.css` | An optional rotary switcher for exactly three views |

The data format and the view API are in [templates/site/SCHEMA.md](templates/site/SCHEMA.md).
Design decisions and the reasons behind them are in [DESIGN.md](DESIGN.md).

## Demo

`examples/demo` is a complete site for a made-up order service. Open
`examples/demo/index.html` in a browser.

## License

MIT, see [LICENSE](LICENSE).
