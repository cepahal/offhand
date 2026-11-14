# Offhand dental workstation: gesture fix + redesign plan

Scope: the dental view (`/`, `apps/web/src/demo/DentalView.tsx` and its imports) and the ToothFairy2
case packs in `casepacks/dental`. Everything the doctor can do today keeps working: gestures, wave to
talk, voice commands, notes, patient record and prescription change, Photon messages, pressure analysis.

## 1. Cut what the dental view does not use

Traced from `DentalView.tsx`: 22 source files are reachable. Removed: the hospital demo (`/demo`), the
old kiosk and debug screens (`/kiosk`, `/debug`), NeuroVision / MRI / brain and knee (ACL) screens,
the reference-mouth `DentalStage`, their CSS, assets, tests, Vite file routes, configs and policies,
and the ISBI-2015 brain pipeline. Hub messaging, gesture, case-pack and voice routes stay.

## 2. Repeated up/down and push/pull (evidence: 715 recorded board gestures + 10k hover samples in `logs/`)

Findings:
- A swipe's return stroke is reported as the opposite gesture. Stroke→return gaps: median 450–720 ms,
  90th percentile 1.15–1.5 s. The hand is out of view for only ~150–280 ms during a return, but
  >400 ms when the user changes intent.
- Push and pull always arrive as a forward+backward pair (forward first when the hand starts far,
  backward first when it starts near), so "push ×3" and "pull ×3" differ only by which comes first.

Fix (`gesture-intent.ts`, pure and unit-tested, replaces the 280 ms debounce gate):
- Each axis (left/right, up/down, toward/away) tracks a run. The first stroke of a run sets its
  direction and executes at once (no added latency).
- One return per stroke: the next opposite gesture is absorbed as that stroke's return. A second
  opposite in a row is a deliberate reversal and executes.
- The run ends (next stroke is fresh) after an adaptive quiet gap learned from the user's own rhythm
  (1.7× recent median, 0.75–1.4 s), when the hand leaves the sensor for ≥600 ms, or when the hand
  holds still in view for ≥650 ms (a deliberate pause).
- Push/pull: the first of the pair decides, so pushes start far and pulls start near, which is how
  the sensor already reports them.
- Replayed against the recorded sessions to compare with the old gate before shipping.

## 3. Smooth repeated motion

Every gesture currently restarts a 380 ms ease-in-out tween from zero velocity, so motion stops
between steps. Replace with a velocity-preserving spring (slightly under-damped for rotation,
critically damped for zoom). A single gesture keeps its snappy fixed step; a second same-direction
command within ~1.5 s switches to a glide that feeds the remaining steps at the user's cadence, so a
run of swipes becomes one continuous, eased motion.

## 4. Redesign (sources below)

Layout, macOS split-view order: toolbar → sidebar (navigation) | viewports (content) | inspector
(details of the selection) → status bar.
- No cards. NN/g: cards suit heterogeneous content to browse; homogeneous, compared, scanned data reads
  better as lists with fixed positions. The inspector uses flat sections with headers and hairline
  rules (Blender: group under headings, most important first, less used below or collapsed).
- Toolbar: at most three groups (Apple HIG): leading = case title; center = view layout; trailing =
  device status and inspector toggle. Window title names the content, not the app.
- Sidebar: two levels max (Apple HIG): work areas, then cases grouped by review focus.
- Color: neutral graphite, color only where it means something (ISA-101 high-performance HMI):
  muted steel blue for selection, amber for annotations, green/amber/red only for status.
- Legibility from the chair: ISO 9241-3 / ACORN guide set 16 arcmin minimum, 20–22 preferred. At about
  1 m that is roughly 28–30 px text, so voice/command text, gesture feedback and note callouts are
  sized for distance; seated-only metadata stays ≥12 px.
- Skeuomorphic but flat: machined bezels from 1 px highlight/shadow edges, recessed viewport wells,
  embossed labels. No gradients, no glow.
- Motion: springs for input-driven motion, strong ease-out (cubic-bezier(.22,1,.36,1)) for UI,
  100–300 ms, never linear; `prefers-reduced-motion` respected.
- Voice bar moves up off the bottom edge and shows recognized words live as they are spoken.
- Notes become 3D-anchored callouts on the model (leader line + numbered plate), also listed in the
  inspector.

## 5. Verify

Typecheck, unit tests, recorded-session replay, and a browser pass over every flow. Then repeated
critical reviews by a separate "clinician" agent until there are no remaining comments.

Sources: NN/g "Cards: UI-Component Definition"; Apple HIG Toolbars, Sidebars, Split views;
Blender HIG "Layouts"; ISA-101 summaries (ISA Interchange, Control Engineering); ACORN HSI style
guide (arXiv 2312.12579) and ISO 9241-3 legibility; motion-easing guides.
