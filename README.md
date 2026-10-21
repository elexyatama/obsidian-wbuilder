# WBuilder

An Obsidian plugin for worldbuilders: Markdown notes tied to an interactive, editable tile map, with a timeline and family trees.

## What it does

- **Map.** A procedural tile map (deep ocean, shallows, land, mountains) from a seed, stored as a `.worldmap` file.
- **Place notes.** Pick the **Place** tool and click the map, or right-click → *Create … here*, to create a note at that tile. Click a pin to open its note; several notes on one tile open a picker.
- **Brush.** Paint deep water, shallows, land or mountains, raise/lower elevation, or reset to the generated terrain. Undo/redo with Ctrl+Z / Ctrl+Shift+Z. Edits are saved in the `.worldmap` file.
- **Stickers.** 31 built-in stickers (including a hand-drawn well) plus any image in your sticker folder. Click one then click the map, or drag it onto the map.
- **Node types.** `place`, `structure`, `character`, `creature`, `faction`, `event`, `item` (or your own). Each has its own badge color and default sticker.
- **Timeline.** Give notes a `start` and/or `end` year (indefinite by default). Turn the timeline on, drag the slider, and the map shows only what exists in that year.
- **Family trees.** Characters list `parents`; *Show family tree of active note* draws the tree (ancestors, descendants or the whole family). Parents without a note appear as dashed boxes you can click to create.

## Note format

Everything lives in note frontmatter, so your vault stays plain Markdown:

```yaml
---
type: character          # place | structure | character | creature | faction | event | item | your own
map: world               # map id (inside the .worldmap file)
x: 80                    # tile coordinates (tile_x / tile_y also work)
y: 32
icon: castle             # optional: sticker id, an emoji, or an image path/name from the sticker folder
start: 100               # optional: first year it exists (born also works). Leave out = always
end: 340                 # optional: last year it exists (died also works). Leave out = indefinite
parents: ["[[Alaric]]", "[[Beatrix]]"]
---
```

A note is part of the world if it has `map`, a known `type`, or `parents`; other notes are ignored. Bad coordinates or `start` after `end` hide the pin rather than guessing.

Commands: **Open map**, **Create new map**, **Reveal active note on map**, **Show family tree of active note**. Settings: notes folder (default `World`) and sticker folder (default `Stickers`).

## Layout

```
src/
  core/     pure TypeScript, no DOM or Obsidian (unit tested)
            terrain + brush + undo, .worldmap format, node parsing + index,
            timeline, stickers, node types, family graph + tree layout
  render/   canvas map renderer, MapScreen (toolbar, palette, timeline bar),
            SVG family tree renderer; talks to its app through MapScreenHost
  host/
    obsidian/   the only code that imports `obsidian`: plugin, map file view,
                family view, dialogs, settings, vault sync
  main.ts   plugin entry point
```

A standalone (Tauri/Electron) build would replace `host/obsidian` and reuse the rest.

Terrain generator `v1` is frozen: height at (x, y) depends only on the seed and the coordinates, so saved maps and pins never shift. Improve terrain by adding a `v2`, never by editing `v1`.

## Develop

Windows, Node 20+.

```bash
npm run deps -- install   # install dependencies (see below)
npm run dev               # esbuild watch -> main.js
npm test                  # unit tests
npm run build             # typecheck + production bundle
```

**Dependencies live outside OneDrive.** `node_modules` here is a junction to `%USERPROFILE%\dev\wbuilder\node_modules`. Plain `npm install` replaces the junction with a real folder, so always use `npm run deps -- <npm args>` (for example `npm run deps -- install some-package`). `npm run deps` alone repairs the junction.

**Try it in Obsidian.** A test vault with sample notes is at `C:\Users\elexy\dev\wbuilder-vault`, with this folder linked in as its `wbuilder` plugin. Open it as a vault, turn off Restricted mode, enable WBuilder, and read `Welcome.md`. If Obsidian doesn't list the plugin (it may not follow the junction), copy `main.js`, `manifest.json` and `styles.css` into the vault's `.obsidian/plugins/wbuilder/`.

## Status

Unit tests (core), the canvas/UI code (checked in a browser) and the plugin wiring (checked against a stubbed Obsidian API) all pass. **Not yet run inside real Obsidian**, so expect small surprises in the Obsidian-specific parts (file view registration, menus, dialogs).

Known gaps: dragging a pin to move it (edit `x`/`y` for now), `wmap:` coordinate links inside note text, pinch zoom for mobile (`isDesktopOnly` stays `true`), terrain that changes over time, and spouses with no children don't appear in family trees.

Before publishing: set `author` in `manifest.json`.
