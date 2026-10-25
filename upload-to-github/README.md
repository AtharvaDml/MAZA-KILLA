# माझा किल्ला · Majha Killa

Build the Diwali Killa you remember. Or the one you never got to build.

A browser-based 3D miniature fort sandbox: shape wet earth into hills, draw curved fort walls that
climb them, crown them with buruj, fill the courtyard with a little village, then switch to night
and watch the diyas come alive.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5183 in Chrome. `npm run build` produces a static `dist/`.

## Controls

| Input | Action |
|---|---|
| Left-drag on empty ground | Orbit (with damping and inertia) |
| Right-drag | Pan |
| Scroll / pinch | Zoom toward the cursor |
| Middle-drag · Alt+drag | Orbit even while a tool is active |
| W A S D · arrows | Travel (Shift = faster) |
| Right-click | Radial menu (Build / Sculpt / Paint / Decorate, or Move / Rotate / Copy / Delete) |
| 0–9 | Select · Terrain · Walls · Fort · Buildings · Nature · Water · People · Decor · Diwali |
| M · R · T | Move · Rotate · Scale mode (then drag the selection) |
| Q / E | Rotate selection or placement ghost (Shift = 5°) |
| Ctrl+D · Alt+drag | Duplicate · drag a copy |
| Delete | Delete selection (or the selected wall point) |
| Ctrl+Z · Ctrl+Shift+Z | Undo · Redo |
| Ctrl+S | Save now (it also autosaves) |
| [ · ] | Brush size |
| Shift / Ctrl while sculpting | Smooth / invert raise↔lower |
| G · F · N | Grid snap · focus selection · next time of day |

Press **?** in the app for the full list.

## What's in Phase 1

* **Terrain** — Raise, Lower, Smooth, Flatten, Slope, Roughen, Erode brushes with size/strength/falloff;
  holding still keeps pulling mud up in place. Nine blended surface materials (red soil, dark soil, mud,
  grass, dry grass, rock, sand, stone, wet earth) painted directly, with rock appearing on cliffs automatically.
* **Fort walls** — click points or press-and-drag a freehand curve; close a loop by clicking the first point.
  Walls conform to hills, carry kangoore / square / no battlements, laterite / basalt / weathered stone,
  and stay editable: drag handles, double-click to add a point, Delete to remove one.
* **Library of 26 procedural miniatures** — round buruj (snaps onto walls, things can stand on top), Bhagwa flag
  with waving cloth, cannon, cannonballs, mashaal, village house, round hut, five trees and bushes, grass,
  marigolds, stones, boulders, Sahyadri rock pinnacles, Mavla, villagers, horse, cow, diya, akash kandil,
  two rangoli patterns. Colour variants per item, scatter brush for nature.
* **Editing** — hover/selection rim light, Shift multi-select, direct drag to move/rotate/scale, inspector
  (size, rotation, lift, colour), duplicate, Alt-drag copy, delete, 200-step undo/redo for every action
  including terrain and painting. Things ride along: objects follow the ground when you sculpt, objects
  on walls re-seat when walls change, cannons stay on their buruj.
* **Lighting** — Morning, Afternoon, Golden Hour, Diwali Sunset, Night, with smooth transitions. At night,
  diyas, torches, lanterns and windows glow; "Line the wall with diyas" lights a whole rampart in one click.
* **Saving** — autosave to this browser (IndexedDB), My Killas library with thumbnails, new / open /
  duplicate / rename / delete, export & import `.killa` files, PNG screenshots.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the engine decisions and the phase plan.

## Known gaps (planned)

* Gates that cut wall openings, parametric buruj, paths & stone steps — **Phase 2**
* Water (ponds, rivers, moats, waterfalls), ALIVE idle animations, Diwali torans/string lights — **Phase 3**
* World map, templates, gallery — **Phase 4** · share links, view mode, photo/cinematic/walk modes — **Phase 5**
* AUTO quality from frame timing, guided onboarding, audio — **Phase 6**
