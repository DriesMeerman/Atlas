# Architecture docs site

This folder is an interactive docs site for this repository. It was generated with the
`architecture-docs` skill from the [atlas](https://github.com/DriesMeerman/atlas) engine.
It has no build step: open `index.html` in a browser, over `file://` or any static server.

## Layout

| Path | What it is | Who changes it |
|---|---|---|
| `data/*.js` | All content: components, edges, diagrams, flows, TL;DR blocks, features | Update when the code changes |
| `data/site.js` | Title, views, source link format and the commit the content describes | Update `commit` on every content update |
| `theme.css` | The look: colours, fonts, layer colours | Change freely |
| `app/*` | Engine code copied from atlas | Change freely; this copy is ours |
| `index.html` | Page shell; `<!-- atlas:... -->` blocks list the loaded files | Change freely |
| `SCHEMA.md` | Data format and the view API | Keep in step with `data/` and `app/` |
| `SOURCE.md` | The commit the content describes and how to update | Update with the content |
| `atlas.json` | Engine commit and a hash of each copied engine file | Written by atlas's `add.mjs` |

## Update the content

1. Read the commit in `SOURCE.md`, then list what changed since:

   ```sh
   git log --oneline <commit>..HEAD -- <source dirs>
   git diff --stat <commit>..HEAD -- <source dirs>
   ```

2. Find the entries those changes touch: search `data/*.js` for the changed paths (every
   `refs` entry names a file) and for the names of changed functions.
3. Edit only those entries. Check line numbers in refs against the new code. Add nodes,
   edges or flows for new parts, and remove ones for deleted code.
4. Set the new commit in `SOURCE.md` and `data/site.js` (`commit`).
5. Check the data (from an atlas checkout, or copy `check.mjs` next to this file):

   ```sh
   node <atlas>/scripts/check.mjs <this folder> --repo <repo root>
   ```

6. Open the site and click through what changed: the diagram, the sidebar and any flow.

The `architecture-docs` skill does all of this with `/architecture-docs update`.

## Change how it looks or works

`theme.css`, `app/` and `index.html` belong to this site. Edit them directly; nothing
regenerates them. Keep these rules:

- No build step and no network requests at runtime. It must open over `file://`.
- Content stays in `data/`; views read it, never the other way round.
- Both themes (dark and light) keep text readable on panels.
- Record new data fields in `SCHEMA.md`.

## Engine updates

`node <atlas>/scripts/add.mjs --to <this folder> --status` shows, per engine file, whether
it was edited here and whether atlas has changed it since. Re-running `add.mjs` with the
part names updates untouched files and leaves edited ones alone unless you pass `--force`.
Merge an upstream change into an edited file by hand.
