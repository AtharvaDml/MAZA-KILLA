# Majha Killa — Open World expansion plan

Evolve, don't rebuild: from *my Killa builder* to *a living world of Killas built by everyone*.
Hierarchy stays **Build → Publish → Become part of the world → Explore → Get inspired → Build more.**

## 1. What stays untouched

| System | Status |
|---|---|
| Terrain heightfield, brushes, splat painting, undo | Unchanged. Water carving reuses the existing heights command. |
| Spline walls, kangoore merlons, node editing | Unchanged. Water tanks reuse the wall generator for their stone kerb. |
| Instanced ObjectSystem, catalog, attachments/riders | Unchanged; animals, palace props and wells are new catalog entries. |
| Camera rig, input router, tools, history, inspector pattern | Unchanged; new tools plug into the same `Tool` interface. |
| Lighting presets, shader lamp clusters, glow map, post stack | Unchanged; water reads the same `uNight` / lamp uniforms. |
| KillaFile binary+gzip format, IndexedDB repository | Extended additively (new optional header fields). Old files still load. |

The one structural change is deferred to Phase F: the editor assumes a single plot at the origin. For the world,
a Killa becomes a `KillaInstance` (terrain + walls + water + objects + habitats) that can be placed at a world offset
and rendered at a chosen LOD. The editor then edits one instance.

## 2. Water architecture (Phase A)

```ts
WaterData {
  id, kind: 'pond' | 'lake' | 'tank' | 'moat' | 'river' | 'stream' | 'waterfall',
  mode: 'area' | 'flow',
  points: [x, z][], closed,
  level?: number,          // area: absolute surface height
  depth, width, shore, flow, color, clarity, reflect,
  openings: { t, width }[] // dry crossings in moats
}
```

* **Area water** (pond, lake, tank): a closed, organic outline triangulated at the water level, padded past the shore.
  The real shoreline is wherever the terrain rises above the water. The shader knows the depth per pixel by reading a
  half-float **terrain height texture**, so shores fade, foam and clear up naturally without any explicit shoreline geometry.
* **Flowing water** (moat, river, stream, waterfall): a ribbon along a Catmull-Rom spline. The surface level per sample is
  derived from the *bank* heights (not the carved centre) and kept non-increasing downstream. A drop larger than a threshold
  becomes a **waterfall segment**: a vertical animated sheet, a foam pool and GPU-animated splash and mist particles.
* **Terrain carving** is optional and on by default. A basin or channel is dug with the same before/after heights command as
  sculpting, wrapped with the water creation in one undo step. Objects and walls already "ride along" terrain edits.
* **Shading**: two scrolling noise normals (flow-aligned on rivers), depth-tinted shallow→deep colour, clarity, shore foam,
  Fresnel reflection of the analytic sky, sun/moon glints, and **night reflections**: lamp clusters as glints plus the diya
  glow map. No planar reflection pass and no fluid simulation.
* **Tank** = area water + a low stone kerb (wall generator, no battlements). **Well** and **fountain** = catalog props with a
  small animated water disc.

## 3. Animal habitat architecture (Phase B)

`HabitatData { id, type: 'stable' | 'cowshed' | 'goatpen' | …, p, r, count, variant, radius, active }`. The den is a catalog
building; its animals are *derived*, not saved individually (seeded positions, so a reload looks the same). A tiny per-animal
state machine (IDLE → WANDER → EAT/DRINK → REST → RETURN) moves instance matrices inside the roaming radius. "Drink" picks a
shore point from `water.nearestShore()` when one is within radius. Simulation is distance-gated: off when far, frozen at
medium distance, full when near. Animals reuse the existing instanced batches.

## 4. Modular palace architecture (Phase C)

The Rajwada is built from **parametric modules** (hall, courtyard, gate, chamber, balcony, terrace, verandah, walkway,
garden), each a procedural generator like the wall builder. Width, depth, floors, roof (tiled / flat terrace / domed chhatri),
wall style, arches, pillars and windows are parameters. Modules snap edge-to-edge on a palace-local grid. Presets (Small
Rajwada, Courtyard Palace, Hill Fort Palace, Grand Palace) are just module lists, so everything stays editable. Halls and
courtyards are hollow, with real door openings, so Walk Mode can enter them. Night uses window/lamp materials and the
lamp clusters.

## 5. Backend / cloud architecture (Phase D)

**Supabase**: Postgres, Auth, Storage and row-level security. The frontend stays a static Vite app on Vercel; there is no
custom server. Supabase Edge Functions are used only where trust matters: reserving a plot, publishing a version, appreciating
(rate-limited). Big binary data (`.killa` blobs, previews, thumbnails) lives in Storage behind the CDN; Postgres holds
metadata and pointers. The local IndexedDB repository stays the source of truth while editing (offline-first), and a
`CloudRepository` behind the same interface syncs it.

## 6. Killa publishing format

* **Working copy**: the existing KillaFile (binary + gzip), with new header fields `water`, `habitats`, `palace`, `poi`, `view`.
* **Published version**: an immutable snapshot `killa_versions/<id>/<n>.killa` plus a **preview** `…/<n>.preview` (≈20–60 KB):
  a 33×33 height grid, wall polylines with heights, palace/building boxes, water outlines, glow points (diya clusters),
  a dominant palette, and the cover thumbnail. Visitors always load the published version, never the live working copy.

## 7. World / region data structure

```
World (seed, size) → Regions (Sahyadri Ridge, River Valley, …) → Plots (fixed slots, 320 m apart, never overlapping)
plot = { id, regionId, x, z, yaw, size: 'small'|'medium'|'large', state: 'free'|'reserved'|'occupied', killaId? }
```

The world terrain is generated deterministically on the client from the seed (mountains, rivers, lakes, an old stone bridge
and other landmarks), so it is never downloaded. Plots are flattened pads blended into it. Publishing reserves a free plot
with an atomic Edge Function, so there are no land grabs or overlaps.

## 8. LOD architecture

| Level | Distance | What renders |
|---|---|---|
| L0 | region view | region label + count ("Sahyadri Ridge · 24 Killas") |
| L1 | very far | glowing billboard / pin sized by zoom |
| L2 | far | preview mesh: low-res terrain cap, extruded walls, palace boxes, glow points |
| L3 | medium | full terrain, walls, water (simple material), buildings; no small props |
| L4 | near/inside | everything, animals simulated, water full shader |

## 9. World streaming architecture

The world is split into 2 km chunks. The current chunk plus its neighbours stay active. Chunk metadata (published Killas, previews' URLs)
is fetched by bounding box and cached. Previews load first; full `.killa` blobs only when a Killa reaches L3 range. Decoding
runs in a Web Worker, instantiation is budgeted per frame (time-sliced, like the current progressive loader), and resources
are kept in an LRU and disposed once the player is far enough away. Night glow of distant forts comes from preview glow points
rendered as one instanced emissive batch.

## 10. Authentication strategy

Guest Mode by default: build locally, no sign-up. Account Mode (Google or email magic link via Supabase Auth) unlocks cloud
save, publish, appreciation and multiple devices. A guest's local Killas are adopted on first sign-in.

## 11. Security strategy

* RLS on every table: `killas` writable only where `owner_id = auth.uid()`; versions immutable; public reads only for
  `visibility in ('public','unlisted')` and only the published version.
* Storage policies scoped to `killas/<owner_id>/…`; publish and plot reservation through Edge Functions that validate
  ownership, size limits and schema.
* No user-uploaded assets (approved game assets only). Names and descriptions are length-limited and filtered.
* `reports` table plus an admin `unpublish`; appreciation is unique per user and rate-limited.

## 12. Deployment / database changes

New Supabase project with tables `profiles, regions, plots, killas, killa_versions, appreciations, reports`, buckets
`killas` and `previews`, and two Edge Functions. Vercel gets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
Phases A–C need **no** backend changes.

## 13. Performance risks

* Water overdraw (transparent) on large lakes → single pass, no refraction copy, depth from the height texture.
* Animals: hundreds of matrix updates per frame → distance gating and a cap per habitat.
* Palace interiors raise the triangle count → merged per-module geometry, instanced props.
* World: many Killas → strict LOD, at most ~4 at L3/L4, previews are instanced.
* Download size → previews are tiny; full blobs stream only near; CDN cache headers.
* Memory leaks on unload → explicit dispose paths and an LRU budget.

## 14. Phased order

A Water → B Habitats & animals → C Palace → D Auth & cloud → E World & plots → F Streaming, LOD & visiting →
G Explore, appreciation & sharing → H Diwali open-world polish, audio, transitions.
Each phase ships playable; the builder is never broken by the world work.
