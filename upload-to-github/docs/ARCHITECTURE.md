# माझा किल्ला · MAJHA KILLA — Architecture

> Build the Diwali Killa you remember. Or the one you never got to build.

This document records the eight foundational decisions taken **before** building, and is kept
up to date as phases land. The 3D builder is the product; everything else serves it.

---

## 1. Engine choice — Three.js (+ React shell, no R3F)

**Decision:** Three.js r178 (WebGL2) for the engine. React 18 + TypeScript for the UI shell only.
`postprocessing` (pmndrs) for the merged post stack. `zustand` (vanilla store) as the bridge.

| Need | Why Three.js wins here |
|---|---|
| Terrain editing | Direct `BufferGeometry` access; partial GPU uploads with `addUpdateRange`; we own the heightfield, normals and raycast (no physics engine needed). |
| 3D interaction | Custom heightfield ray-march picking is O(distance/spacing) and far faster than triangle raycasts on a 100k-triangle terrain. |
| Performance | ~600 KB engine vs. multi-MB for Babylon. Share-link viewers must load fast. `InstancedMesh` + per-instance attributes cover every repeated prop. |
| Material system | `onBeforeCompile` lets us extend the PBR `MeshStandardMaterial` (keeping lights, shadows, fog) with splat blending, clay grain, cloth wind, flame flicker and selection rim light. |
| Lighting / post | pmndrs `postprocessing` merges bloom (luminance threshold, so only lamps bloom), tone mapping, vignette and SMAA into one or two fullscreen passes. |
| Camera | We write our own damped rig. Stock `OrbitControls` fights the tool/camera input split. |
| Future | `WebGPURenderer` path exists in Three when we want it; WebGL2 is the stable Chrome baseline today. |

Babylon.js would give us gizmos, GUI and an inspector out of the box, but the spec explicitly
wants a restrained, non-CAD gizmo, and we would pay for the weight on every share link.

**Why not React Three Fiber:** the engine runs a fixed per-frame loop (camera damping, continuous
brush application, shader time). Putting that through React's reconciler adds overhead and couples
UI re-renders to the scene graph. Instead: the engine is plain imperative TypeScript; React renders
panels; the two meet in a zustand store.

---

## 2. Scene architecture

```
Engine  (renderer, loop, post-processing, quality tier)
 ├─ CameraRig            damped orbit / pan / zoom-to-cursor / WASD / presets
 ├─ Scene
 │   ├─ Environment      sky dome (gradient + sun + stars), Sahyadri-style plateau ring,
 │   │                   ground skirt around the plot, instanced background trees, fog
 │   ├─ Lighting         one shadowed sun, hemisphere fill, clustered lamp lights; curated presets
 │   ├─ Terrain          heightfield mesh + splat-blended material + lamp glow map
 │   ├─ WallSystem       one procedural mesh per spline wall
 │   ├─ ObjectSystem     InstancedMesh batches per (asset, part)
 │   └─ Overlay          ghost previews, wall handles, gizmo ring (no shadows)
 ├─ InputRouter → ToolManager   Select · Sculpt · Paint · Place · Wall
 ├─ History              command stack (undo / redo, coalescing, byte budget)
 └─ Persistence          binary+gzip Killa files, IndexedDB repository, autosave
UI (React)  ⇄  EditorStore (zustand/vanilla)  ⇄  Engine.actions
```

**World scale (miniature-consistent):** 1 unit ≈ 1 "fort metre". Mavla figurine ≈ 2.0 tall
(toy-scale, slightly heroic), house ≈ 4.5, default wall 7, buruj 9, trees 5–9. The plot is
128 / 192 / 256 units wide (Small / Medium / Large). Placement applies sane default scale ranges;
an advanced override can break them deliberately.

---

## 3. Terrain editing architecture

* **Data:** `Heightfield` — `Float32Array` of `res × res` heights over a square plot centred on the
  origin (`res` 161 / 257 / 321 → ~0.8 unit spacing). Heights clamp to [-16, 112].
* **Mesh:** a single indexed grid. Brush strokes touch a bounded rectangle; we rewrite only those
  vertices, recompute normals analytically from the heightfield (central differences) for the rect + 1
  border, and upload just the affected **row range** via `addUpdateRange`. The bounding volume is
  fixed and generous, so no per-stroke bounds recomputation.
* **Raycast:** ray-march the heightfield at sub-spacing steps, then bisect. Outside the plot, the
  ray hits the y=0 ground plane.
* **Brushes** (rate-based, applied every frame while held, so holding still keeps "pulling mud"):
  `raise` / `lower` (with a little built-in settling so it reads as wet mud, not spikes),
  `smooth` (Laplacian toward a 3×3 mean from a pre-pass copy), `flatten` (toward the stroke-start height),
  `slope` (toward the line between the stroke start and the cursor, using pre-stroke heights so it is stable),
  `roughen` (a fixed fractal field, so repeated strokes build consistent detail),
  `erode` (thermal erosion above a talus angle + slight smoothing → natural scree).
  Each has **size**, **strength** and **falloff** (cosine bell with a hard core).
  *As built:* Smooth uses a separable box blur whose width scales with the brush, so a big brush can soften a
  whole mountain (a 3×3 kernel could not). While the pointer is held still the brush centre is locked —
  otherwise the rising hill pulls the cursor's ground point toward the camera and smears the mound into a ridge.
* **Edge lock:** brush deltas fade to zero within 6 units of the plot edge so the plot always meets the
  surrounding ground.
* **Painting:** three RGBA8 splat textures (up to 12 layers; 9 used) at ~2.7 texels/unit. Painting raises one
  channel and renormalises the others. Only touched textures are re-uploaded, at most once per frame.
* **Material:** 9 procedurally generated, tileable albedo+height layers (red soil, dark soil, mud, grass,
  dry grass, rock, sand, stone, wet earth) in one `DataArrayTexture`. **Height-based blending** gives
  natural, non-tiled transitions; **auto-cliff** blends rock onto steep slopes; bump from blended height via
  screen-space derivatives gives tactile grain; per-layer roughness. The brush ring is drawn **in the terrain
  shader**, so it conforms to the surface perfectly at constant pixel width.
* **Undo:** at stroke start we snapshot heights (and splat when painting). At stroke end we store
  before/after for the dirty rectangle only.
* **Followers:** when terrain changes under objects, ground-snapped objects ride along (offset from the ground
  is preserved), walls re-conform, and objects standing on walls re-snap to the regenerated wall.

---

## 4. Spline wall architecture

```ts
WallData { id, points: [x, z][], closed, smooth, height, thickness,
           battlement: 'kangoore' | 'square' | 'none', stone: 'laterite' | 'basalt' | 'weathered',
           flip, openings: { t, width }[] }
```

* **Curve:** centripetal Catmull-Rom through the control points (`smooth`) or a mitred polyline (`straight`).
  Re-sampled by arc length every ~0.6 units into frames (position, tangent, side normal).
* **Conforming:** at every sample, the base sits below the lowest ground under the footprint (left, centre,
  right) and the top follows a moving-average of the centre ground + wall height, so walls climb hills
  smoothly without a jagged top.
* **Geometry:** a battered (wider-at-base) cross-section is swept along the frames: outer face, walkway,
  inner face, plus an outer parapet with merlons — rounded **kangoore** (the Maratha-fort silhouette), square,
  or none. End caps on open walls. UVs are world-scaled (arc length × height) so the masonry never stretches.
  Vertex colours carry ground-contact darkening and the stone tint.
* **Openings:** `openings` cut the sweep into runs with caps. Gates (Phase 2) attach by `wallId + t`.
* **Editing:** drawn by clicks (points) and/or press-drag freehand (Ramer–Douglas–Peucker simplified into
  control points). A selected wall shows handles; drag to move a point, double-click the wall to insert,
  Delete to remove. Regeneration is cheap (a 300-unit wall rebuilds in a few ms), so edits are live.

---

## 5. Object & save data model

```ts
AssetDef   { id, name, category, parts: { geometry, material }[], radius, height,
             scale: [min, max], snap, align?, randomize?, variants?, info?, emitter? }
ObjectData { id, type, p: [x,y,z], r: [x,y,z], s: [x,y,z], v?: variantIndex, att?: 'w:<wallId>' | 'o:<objectId>', g?: groupId }
```

**Attachments** (as built): `att` records what an object stands on — a wall (`w:`) or another object's
`platform` (`o:`, e.g. a cannon on a buruj). They drive "things ride along": sculpting under a fort carries
ground objects, re-conforms walls, re-seats wall riders and, recursively, whatever stands on them; wall edits
carry their riders inside the same undo entry. A buruj placed near a wall snaps onto its line and crowns it.
Saved transforms are quantised (mm positions, 1e-4 rad) — visually lossless, ~30% smaller files.

All assets are **procedurally generated** (no downloads), with vertex jitter and colour noise so nothing
looks factory-perfect. A per-vertex `aTint` mask lets variants recolour only the right parts (turban, sash,
horse coat, plaster) through `instanceColor`.

**KillaFile v1** is binary, then gzipped (`CompressionStream`):

```
'KILA' | u32 headerLength | header JSON | heights (Uint16, quantised) | splat0 | splat1 | splat2
header = { format, version, meta, terrain: { res, size, hMin, hMax, splatRes, sections },
           walls, objects, env, camera }
```

Procedural data only (heightmap, wall splines, object transforms, settings) — never baked meshes.
A typical Killa is tens of kilobytes, which is what makes share links (Phase 5) cheap.

**Storage:** `KillaRepository` interface → `LocalRepository` (IndexedDB: `files` + lightweight `listings`
with thumbnails). A `CloudRepository` can implement the same interface later.

---

## 6. Rendering & performance strategy

* WebGL2, ACES tone mapping in the post chain, pixel ratio capped per quality tier.
* **One** shadow-casting sun with an orthographic frustum fitted to the plot. Shadow maps re-render **only when
  something changed** (`autoUpdate = false` + dirty flag) — the single biggest win for static dioramas.
* Every repeated prop is a GPU instance; a batch is one draw call regardless of count. Picking uses a cheap
  bounding-sphere pass, then an exact test on the few candidates.
* **Hundreds of diyas without hundreds of lights:** emissive flames (bloom picks them up) + instanced additive
  halos + a CPU-baked **glow map** the terrain shader samples (warm pools of light on the ground) + six
  **clustered lamps evaluated inside our own material patches** at diya-cluster centroids. *As built:* these are
  not three.js PointLights — real lights cost every fragment of every material even at zero intensity, and
  changing the light count recompiles all shaders. Our lamps sit behind a uniform `uNight` branch, so daytime
  pays nothing.
* Terrain/ground shaders read one shared tileable **noise texture** instead of per-pixel hash noise, and sample each
  layer at two scales (second one rotated) so tiles never read as a grid; layer textures are deliberately uniform at
  large scales and all broad variation (dry, yellowing patches, hue drift) happens in world space.
* Post: `scene → [bloom + ACES] | [ACES] → [vignette (+FXAA)]`. Bloom (threshold 1.0, half resolution) only runs
  from golden hour to night. AA is MSAA×4 on High, FXAA on Medium; Low renders straight to screen.
* Quality tiers LOW / MEDIUM / HIGH control pixel ratio (1 / 1 / 1.5), shadow map (1k / 2k / 4k) and post. The first-run
  default comes from the GPU class (discrete → High, integrated → Medium); only an explicit choice is persisted.
  Frame-time-based AUTO lands in Phase 6.
* Distant forest uses ~200-triangle stand-ins rather than the editable tree meshes.

**Measured** (integrated AMD Radeon / Vega-class laptop GPU, 1920×1080, the 3,088-object demo fort — 32 draw calls,
≈570k triangles, GPU-synchronised, after warm-up): Low ≈ 5 ms · Medium ≈ 8 ms by day, ≈ 12 ms at night · High ≈ 14 ms by day.
* Soft limits: an object meter warns "Your Killa is getting complex" — it never blocks.
* Progressive loading order: terrain → walls → objects (Phase 4 extends this to vegetation/figures/decor tiers).

---

## 7. Editor state architecture

* **EditorStore** (zustand/vanilla): only UI-relevant, serialisable state — active category & tool, per-tool
  settings, transform mode, selection, inspector summary, time preset, quality, history flags, save status,
  radial menu, toasts, modals. React subscribes with selectors; the engine subscribes to slices it cares about.
* **Heavy data never enters the store** (heights, splats, instances stay in engine systems).
* **Tools** are classes implementing `Tool { activate, deactivate, pointerDown/Move/Up, wheel, key, update(dt) }`.
  The **InputRouter** arbitrates camera vs. tool: left-drag on empty ground in Select orbits; with a tool, left-drag
  uses the tool; middle-drag or Alt+left-drag always orbit; right-drag pans; a right-*click* opens the radial menu.
* **History:** `Command { label, undo(), redo(), bytes }`, pushed after the action executes. Inspector slider drags
  coalesce into one entry. Max 200 entries / ~96 MB.
* **Autosave:** any history change marks the doc dirty → saves after 1.2 s of quiet, every 30 s while dirty, and
  immediately when the tab is hidden.

---

## 8. Phased plan

| Phase | Scope | Status |
|---|---|---|
| **1** | Scene, damped camera + presets, heightfield terrain, 7 sculpt brushes, material painting, procedural miniature asset library, placement (ghost, valid/invalid, snapping, scatter), spline fort walls with node editing, select / move / rotate / scale / duplicate / delete, undo / redo, IndexedDB save / load / autosave, Killa library, lighting presets including Night. Pulled forward: buruj that snap to walls with platforms, "line the wall with diyas", .killa export/import, PNG screenshot | **Done** |
| 2 | Parametric buruj that snap to walls, gates that cut wall openings, spline paths (steps / dirt / road / trail) that smooth terrain, more buildings, vegetation brush with species mix, grouping, prefabs | Next |
| 3 | Water (ponds by closed shape, rivers by spline, waterfalls with mist), more figures and animals, ALIVE idle loops, flag wind direction, Diwali mode (draw diya line, torans, string lights, rangoli editor), weather looks | |
| 4 | Multiple Killas on a stylised world map, locations, templates (labelled *Inspired by…*), gallery thumbnails, progressive LOD previews | |
| 5 | Share links (smallest backend: `PUT /k/:id` blob + `GET`), view-only mode, photo mode with DOF, cinematic showcase orbit, Walk mode | |
| 6 | AUTO quality, onboarding (2–3 min, teach by doing), audio, UX polish, performance pass | |
