# offhand

Touchless viewer for 3D medical scans. A hand over a PAJ7620 gesture sensor turns, zooms and
peels a 3D model built from public imaging datasets. HackPrinceton Fall 2026.

**For communication and education. Not for diagnosis.**

```
ESP32 + PAJ7620 --USB serial, JSON lines--> hub (Node) <--WebSocket--> viewer (browser)
                                             |
                    pipeline (Python, offline) -> casepacks/<app>/<case>/ (GLB + NIfTI + manifest.json)
```

## Quick start (no hardware needed)

Needs Node 22+, Python 3.11+ with [uv](https://docs.astral.sh/uv/).

```
corepack enable              # uses pnpm@10.34.9 from package.json (or: npm i -g pnpm@10.34.9)
pnpm install --frozen-lockfile
pnpm testpattern             # writes casepacks/test-pattern/tp-001 (synthetic, NOT anatomy)
pnpm dev                     # hub on :8787, viewer on http://127.0.0.1:5173
```

With no ESP32 plugged in the hub says "No ESP32 connected" and the keyboard mock drives the
same gesture path:

| Key | Gesture | Viewer command |
| --- | --- | --- |
| ← → | swipe left / right | turn 30° |
| ↑ ↓ | swipe up / down | tilt 20° |
| + − | push / pull | zoom in / out |
| [ ] | spin cw / ccw | peel a layer out / back in |
| W | wave | listen on/off |
| hold H + move mouse up/down | hover | after 1 s still: scrub mode, hand height = scrub |

Other keys: R reset, N/P next/previous finding, B bookmark, C capture PNG, M orbit/scrub,
`,` `.` scrub, 1–9 toggle layer, O open case, S slice panel, ? help.

## Mock samples (frontend only)

Start menu → Knee / ACL / Shoulder / Concussion / TMJ (mock), or File → Open case. These are
built in the browser from primitive shapes (rods, discs, balls, rings) so the peel-back,
highlight and gesture flow can be shown before real case packs exist. Each one carries a
"MOCK — NOT ANATOMY" banner, layers are named by role ("bone stand-in"), and highlight targets
are listed as "Mock targets", never findings. They work with the hub offline. In the TMJ mock,
hover-scrub opens and closes the hinge. Code: `apps/web/src/mocks/mockCases.ts`; remove the
`registerLocal(mockSource)` line in `apps/web/src/main.tsx` to ship without them. The real public
source for each area is in `../research/B-imaging-viewer-hardware.md` §6.

## With the gesture board

Flash `firmware/offhand_gesture` (see [firmware/README.md](firmware/README.md)), plug in USB,
close the Arduino Serial Monitor, run `pnpm dev`. The hub auto-detects CP210x / CH340 / FTDI /
Espressif USB bridges; set `GESTURE_PORT=COM7` in `.env` to force a port (`off` to disable).
`pnpm gesture:monitor` tests the board without the viewer.

## Commands

| | |
| --- | --- |
| `pnpm dev` | hub + viewer with hot reload |
| `pnpm build && pnpm start` | production build; hub serves the viewer on :8787 |
| `pnpm test` / `pnpm typecheck` / `pnpm lint` | TypeScript checks (contracts, hub, web) |
| `cd pipeline && uv run pytest` | pipeline tests (synthetic spheres only) |
| `pnpm gen:schema` | regenerate `packages/contracts/schema/*.json` |
| `pnpm replay logs/session-<ts>.jsonl` | replay a recorded session into a running hub |
| `uv run --project pipeline offhand-pipeline inspect <labels.nii.gz>` | label values, voxel counts, orientation |
| `uv run --project pipeline offhand-pipeline build --spec <spec.json>` | build a case pack from a dataset case |
| `uv run --project pipeline offhand-pipeline validate casepacks/<app>/<case>` | check a case pack |

## Layout

```
packages/contracts   Zod schemas + types + JSON Schema: gestures, viewer commands/state, case packs, bus
apps/hub             Fastify + WebSocket bus, serial gesture link + mapper, case pack server
apps/web             Vite + Preact + three.js viewer (Windows 95 look for now; src/mocks = labelled mocks)
pipeline             Python: NIfTI/DICOM -> RAS meshes (GLB) + volumes + manifest
firmware             ESP32 + PAJ7620 Arduino sketch
config/apps          per-app viewer config (what hover-scrub drives)
casepacks            built case packs (only the test pattern is committed)
```

Extension points: hub modules are listed in `apps/hub/src/modules.ts`; viewer side panels in
`apps/web/src/app/panels.ts`. Everything that moves the view is a `ViewerCommand` on the bus,
whatever its source (gesture, mouse, keyboard, voice, integration).

## Rules

- No invented medical content. Meshes and findings come only from public datasets' own
  images and labels, with dataset, license and citation shown on screen.
- Patient data, NIfTI, DICOM and built meshes never go in git (`.gitignore`).
- The hub binds to 127.0.0.1 unless `HUB_BIND` is set.
