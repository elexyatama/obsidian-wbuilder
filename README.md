# WBuilder

An Obsidian plugin for worldbuilders: Markdown notes tied to an interactive, editable tile map, with a timeline and family trees.

## What it does

- **Map.** A procedural tile map (deep ocean, shallows, land, mountains) from a seed, stored as a `.worldmap` file.
- **Place notes.** Pick the **Place** tool and click the map, or right-click → *Create … here*, to create a note at that tile. Click a pin to open its note; several notes on one tile open a picker.
- **Hover cards.** Hovering a pin shows the note's name, type and years, its `overview` property, and its affiliations.
- **Tools you can put down.** Click the active tool again (or press Esc) to switch it off. With no tool on, clicks never open or create anything; panning, zooming, hovering and right-click still work.
- **Labels.** The **Label** tool types a name straight onto the map (a sea, a region, a range): click, type, Enter. Click a label to edit it (sizes S to XL, delete) and drag to move it. Labels are saved in the `.worldmap` file.
- **Map size.** **Map…** in the toolbar resizes the current map. Terrain depends only on the seed and position, so growing adds terrain on the right and bottom and shrinking crops from there; painted terrain and labels inside the new size are kept, and notes outside it are hidden (not deleted) until you grow the map again.
- **Brush.** Paint deep water, shallows, land or mountains, raise/lower elevation, or reset to the generated terrain. Undo/redo with Ctrl+Z / Ctrl+Shift+Z. Edits are saved in the `.worldmap` file.
- **Stickers.** 31 built-in stickers (including a hand-drawn well) plus any image in your sticker folder. Click one then click the map, or drag it onto the map.
- **Node types.** `place`, `structure`, `character`, `creature`, `faction`, `affiliation`, `event`, `item` (or your own). Each has its own badge color and default sticker. An **affiliation** is a note other notes can belong to (a guild, an order, a kingdom): they join it with an `affiliation` property, and it shows on the hover card and in the affiliation's backlinks.
- **Timeline.** Give notes a `start` and/or `end` year (indefinite by default). Turn the timeline on, drag the slider, and the map shows only what exists in that year.
- **Family trees.** Characters list `parents`; the tree shows ancestors, descendants or the whole family. Parents without a note appear as dashed boxes you can click to create. Open it with the command **Show family tree of active note**, by right-clicking a character note (file list or editor), by right-clicking a character's pin on the map, or with the **Tree** button in the Characters panel.
- **Character tracker.** The **Characters** panel on the map lists every character. Tick one or more and drag the timeline: each moves to where they are in that year (ring colored per character). **Show paths** draws their routes (solid = already travelled, dashed = ahead, arrows for direction; the line breaks while a character is missing). Where a character is comes from three places, see below.

## Note format

Everything lives in note frontmatter, so your vault stays plain Markdown:

```yaml
---
type: character          # place | structure | character | creature | faction | affiliation | event | item | your own
map: world               # map id (inside the .worldmap file)
x: 80                    # tile coordinates (tile_x / tile_y also work)
y: 32
icon: castle             # optional: sticker id, an emoji, or an image path/name from the sticker folder
overview: Last lord of Dragon Keep.   # optional: one or two sentences, shown when hovering it on the map
affiliation: ["[[Order of the Ash]]"] # optional: the affiliation note(s) it belongs to
start: 100               # optional: first year it exists (born also works). Leave out = always
end: 340                 # optional: last year it exists (died also works). Leave out = indefinite
parents: ["[[Alaric]]", "[[Beatrix]]"]
---
```

A note is part of the world if it has `map`, a known `type`, `parents` or `locations`; other notes are ignored. Bad coordinates or `start` after `end` hide the pin rather than guessing.

### Where is a character in a given year?

A character is shown only while alive (`start`/`born` to `end`/`died`). In a year they are at the **latest entry on or before it** (they stay put until the next one), from these sources:

1. **Their `locations` list.** One line per change, `"year: map x,y"` (map optional) or `"year: missing"`:
   ```yaml
   locations:
     - "315: world 92,32"
     - "325: missing"        # gone from 325 until the next entry
     - "332: world 86,40"
   ```
   Before the first entry they are at their note's own `map`/`x`/`y`, if it has one. You can write entries by hand, or on the map: tick the character, set the timeline to a year, right-click a tile → *Place … here in year …* / *… goes missing from year …*.
2. **Events that mention them.** An event note (`type: event`, with a map tile and a `start` year) places the characters it mentions at its tile in its start year. An entry in a character's own list for the same year wins over an event.
3. **Their own `map`/`x`/`y`.** The fallback described above.

Which mentions count, in the event's text:

| Written | Meaning |
|---|---|
| `@[[Alaric]]` | was there (always counts) |
| `~[[Cedric]]` | only mentioned, wasn't there (never counts, even if the same event also links them plainly) |
| `[[Beatrix]]` | follows the setting *Characters mentioned in events*: **every link counts unless marked `~`** (default), or **only `@` links count** |

A `present: ["[[Alaric]]"]` list in the event's frontmatter counts like `@`. Links inside code, embeds (`![[...]]`) and frontmatter are ignored. A `locations` line the plugin can't read shows a warning (⚠) next to the character in the panel.

Commands: **Open map**, **Create new map**, **Reveal active note on map**, **Show family tree of active note**, **Track active character on map**, **Show how WBuilder reads the active note**. These also work while the map tab is focused (they use the last note you had open). The family tree and track commands are offered for any note; if it isn't a character they say what to add. **Show how WBuilder reads the active note** lists the type, position, years, how each parent link resolved, and any problem with the properties. Numbers typed into text properties (`born: "300"`) are accepted, and several parents may share one value (`parents: "[[Alaric]], [[Beatrix]]"` or `Alaric, Beatrix`). Settings: notes folder (default `World`), sticker folder (default `Stickers`), and how event mentions place characters.

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

Known gaps: dragging a pin to move it (edit `x`/`y` for now), `wmap:` coordinate links inside note text, pinch zoom for mobile (`isDesktopOnly` stays `true`), terrain that changes over time, and spouses with no children don't appear in family trees. Characters are a step function between entries (no travel time between two places), and the set of tracked characters resets when you close the map. Labels have no undo (delete them from their editor), a map can only be resized from its top-left corner (right and bottom edges move), and there is no way yet to filter the map by affiliation.

Before publishing: set `author` in `manifest.json`.
