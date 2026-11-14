# Prompt 2B: research plan for Member B (MRI data, viewer, UI/UX, gesture board)

> Paste everything below into a research-capable assistant (one with web search). Member B runs it now, before the event. **Request dataset access first.** Some registrations take days. Research and throwaway experiments only. No project code before hacking starts.

---

You're helping me, Member B of a three-person HackPrinceton team (event Nov 13–15, 2026, about 36 hours of hacking), prepare research **before** the event. Hackathon rules require project code to be written during the event. So your output is a research plan, verified facts, and decisions. It is not project code. Small throwaway experiments in a scratch folder are fine, to learn a library; they won't be copied into the project.

## The project (context)

HoverScan lets a gloved clinician manipulate a patient's **real** 3D medical scan without touching anything:
- An ESP32 + PAJ7620U2 gesture puck turns the model, zooms, peels away layers, and scrubs through slices, time or jaw opening.
- Voice (a teammate's job) handles commands like "go to the finding".
- The patient gets a verified explanation on their phone (also the teammate's job).
- It runs in a browser kiosk on an Arm board (Raspberry Pi 5 class) and has to look stunning at first glance.

**Hard rule:** every mesh and every finding must come from real public, de-identified data. No invented anatomy, no example objects. The dataset credit is shown on screen.

There are four candidate applications, and we pick one at about hour 14:

| App | Scan | Layers to peel (outermost first) | Hover-scrub controls | Findings must come from |
|---|---|---|---|---|
| ChairSide | 3D teeth scan from an intraoral scanner (surface mesh) | gums → individual teeth | bite open/close | dataset tooth labels or measured geometry |
| KneeView | Knee MRI | soft tissue → bone → cartilage → menisci/ligaments (whatever the labels support) | slices | dataset injury boxes/labels |
| NeuroView | Brain MRI at several visits (MS) | head → brain surface → white matter → lesions | **time across visits** | rater lesion masks |
| JawLine | Jaw-joint MRI, mouth closed and open | skin → muscle → bone → articular disc | jaw opening | disc labels, **dataset not found yet** |

**My scope:**
- the Python pipeline (download → reorient → meshes → case packs)
- the web viewer (three.js 3D + NiiVue slice panel) and all UI/UX
- mouse and keyboard controls
- the gesture path: the firmware on the ESP32 + PAJ7620U2, the serial reader in the hub, and the mapping from gestures to viewer commands

**Shared formats I build against:**
- `GestureEvent`: 9 gestures (up, down, left, right, forward, backward, cw, ccw, wave) + hover x/y/z.
- `ViewerCommand`: rotate, zoom, peel, slice, scrub, timepoint, focus_finding, bookmark, capture, …
- `ViewerState`.
- `CasePackManifest`: RAS coordinates in mm, layers with peel order, volumes, timepoints, findings with provenance (`dataset_label` | `dataset_report` | `measured`).

**Default gesture map:**

| Gesture | Command |
|---|---|
| left / right | rotate |
| up / down | tilt |
| toward / away | zoom |
| clockwise / counterclockwise | peel / put back |
| wave | voice push-to-talk |
| hold still ~1 s | scrub mode; hand height = scrub value |

**What I believe so far (verify each one; mark it confirmed, changed or unknown, with a link):**
- **Teeth3DS+:** 1,800 intraoral scans from 900 patients, teeth segmented and labeled. Access instructions are on the project page. The license is unclear: one source says CC BY 4.0, another says "Other".
- **Teeth scans show crowns and gums, not roots.** Roots need cone-beam CT (e.g. the ToothFairy datasets), which is a type of CT. We've been avoiding CT, so flag it if ChairSide depends on that.
- **SKM-TEA (Stanford AIMI):**
  - 155 knee MRIs (qDESS), split 86/33/36.
  - Tissue segmentations: the paper says 4 tissues, the dataset page says 6.
  - 3D boxes for 16 types of injury, taken from radiology reports.
- **fastMRI+:** 16,154 expert boxes and 22 types of injury on fastMRI knee, including ACL and meniscus tears. These are boxes, not masks.
- **MS longitudinal data:** the ISBI 2015 longitudinal MS lesion challenge has repeat scans with rater masks; registration is required. BraTS is the tumor alternative (Synapse registration).
- **PAJ7620U2:**
  - 9 gestures over I²C, 3.3 V.
  - Gesture-mode object center registers are reported at Bank 0 0xAE/0xAF (13-bit, X inverted).
  - A separate "cursor mode" in the datasheet reports the object's position. The registers are unverified.
  - The RevEng_PAJ7620 Arduino library supports gestures and possibly cursor mode.
  - It's an infrared sensor, so sunlight or stage lighting may interfere.

## What I need from you

### Part 1: the research plan
A table of every open question, each with:
- why it matters
- which app or shared format it affects
- where to look
- how to answer it (read, or a ≤30-minute throwaway experiment)
- a time box
- the decision it unlocks

Order it so blockers come first: **dataset access requests today**, then must know before Friday, must know by hour 6, nice to know.

### Part 2: do the desk research
Answer everything you can with links. For each experiment I must run myself, give step-by-step instructions, the expected result, and what to do if it fails.

**Questions to cover (add more you think I've missed):**

1. **Datasets.** For each app:
   - The best 1–3 public datasets, with exact access steps, approval time, size, file formats, label definitions, and license.
   - **Can derived meshes be shown publicly and put in a demo video?** Can they go in a public repo? Assume not unless the license says so.
   - Which single subject or case gives the clearest real finding for a demo.
   - **JawLine:** search hard for a public jaw-joint MRI with disc labels, or any closed/open-mouth pair. Give a clear go/no-go by Thursday.
2. **Pipeline**
   - Reading NIfTI/DICOM (nibabel, SimpleITK, pydicom).
   - Orientation (**LPS vs. RAS**; how three.js, NiiVue and 3D Slicer each expect coordinates).
   - Marching cubes in world mm with the affine.
   - Smoothing that doesn't shrink thin structures like cartilage.
   - Decimating to a triangle budget.
   - GLB export with meshopt or Draco compression.
   - Getting soft-tissue or skin surfaces where there's no label (threshold? brain extraction?).
   - Registering visits across time for NeuroView.
   - How to check meshes line up with the slices (overlay test).
3. **Rendering for wow**
   - three.js techniques for peeling layers: opacity tweening, transparency sorting artifacts and fixes, clipping planes, a glow or rim light on the finding, bloom.
   - Material and color choices that look medical-grade, not cartoonish.
   - Camera fly-to animation.
   - Showing a slice plane inside the 3D model, synced with the NiiVue panel.
   - Examples of beautiful medical 3D on the web to borrow ideas from (cite them).
4. **Performance on Arm**
   - WebGL2 limits and realistic triangle counts / frame rates on a Raspberry Pi 5 in Chromium kiosk.
   - Texture and volume size limits for NiiVue there.
   - What to precompute.
5. **Mouse and keyboard**
   - OrbitControls vs. TrackballControls.
   - Routing mouse input through commands without fighting the controls.
   - Keyboard shortcuts that mirror the gestures, for development and accessibility.
6. **UI/UX**
   - A kiosk read from 2–3 m by judges standing around it: type sizes, contrast.
   - A gesture HUD that shows each recognized gesture instantly (the key to the demo feeling responsive and believable).
   - A first-time "try it" prompt for a judge's hand.
   - Showing data provenance and the disclaimer without clutter.
   - A colorblind-safe tissue palette.
   - Clinician vs. patient views.
7. **Gesture board**
   - Wiring and library choice; gesture-mode speed and timing settings.
   - How reliably it tells wave apart from left/right.
   - Recognition range and distance.
   - **Cursor/hover mode registers**: can we get a continuous hand-height or proximity value for scrubbing? If not, what's the fallback? (Repeated up/down? The proximity/brightness register?)
   - Sensor orientation inside a puck.
   - Infrared interference under hall lighting.
   - Debounce and latency budget (gesture to pixels under 150 ms).
   - USB serial vs. Wi-Fi vs. Bluetooth keyboard (HID) transport.
   - Is the MPU6050 useful here at all (e.g. tap-to-confirm through a sterile drape), or should we leave it out?
   - A puck enclosure design that keeps the sensor window clear.
8. **Clinic software (to inform a teammate)**
   - Which hotkeys OHIF and Horos use for rotate, scroll and zoom, so the Bluetooth-keyboard mode can drive them.
   - What 3D Slicer's WebServer API exposes for slice offset and 3D camera control.

### Part 3: output format
One Markdown document, `research/B-imaging-viewer-hardware.md`, with these sections:
1. **Dataset access status** (requested / approved / blocked, with dates)
2. **Decisions**
3. **Verified facts** (with links and the date checked)
4. **Corrections to what I believed**
5. **Experiments I still need to run** (steps, expected result, fallback)
6. **Per-app data verdict** (layers we can really show, best case, real finding, license limits, go/no-go)
7. **Proposed changes to the shared formats** (additive only)
8. **Wow ideas, ranked** (cost vs. impact)
9. **Risks** (with a mitigation for each)
10. **Hour-0 checklist** (data downloaded to laptops, tools installed, hardware tested, sensor orientation known)

Mark anything uncertain as uncertain. Don't present a guess as fact. Prefer dataset owners' pages and official docs, and give the date of every source.
