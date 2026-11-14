# Prompt 1: build the HoverScan codebase

> Paste everything below this line into a coding agent at hacking kickoff (H0), not before. One person (role C) runs it and pushes; the others clone.

---

You are setting up the codebase for a three-person team at HackPrinceton (Fall 2026, about 36 hours of hacking). Build a clean monorepo that **runs end-to-end on mocks from the first minute**, so three people can work in parallel without editing each other's files. You are not building the finished product. You are building the frame everyone plugs into, with real libraries wired in wherever that's cheap, and typed TODOs everywhere else.

Read the whole brief before writing anything. If something here is impossible, out of date, or contradicts itself, stop and say so instead of guessing. Where this brief says "verify" or "TODO", leave a typed stub with a comment naming the open question. Don't invent an API.

## 1. Project statement

**Working name:** HoverScan.

**Pitch:** A $10 gesture sensor and your voice let a gloved clinician spin, peel and scrub through a patient's real 3D scan without touching anything. It works inside the software their clinic already uses, and the patient leaves with an interactive, fact-checked explanation on their iPhone.

**Problem:**
- Clinicians in contaminated or sterile gloves can't touch a mouse or keyboard. Today they take gloves off, wrap equipment in plastic, or ask an assistant to click.
- Patients leave consults having seen a few gray slices they didn't understand, with nothing visual and accurate to take home.

**Product:**
- **Hardware:** a puck (ESP32 + PAJ7620U2 gesture sensor) plus a hub that runs on a small Arm computer beside the clinic's screen.
- **Gestures:** move the 3D model.
- **Voice (Amazon Bedrock, Nova 2 Sonic):** handles meaning, e.g. "go to the finding", "explain it", "send it to the patient".
- **Fact-check:** every sentence a patient will see is checked by Bedrock **Automated Reasoning** against a rulebook before it can be sent.
- **Patient delivery (Photon, iMessage):** an interactive card with a snapshot, the verified explanation and a native poll. The patient's vote returns to the screen and to the clinic's software.

**Three ways it plugs in:**
1. Our own viewer.
2. Driving existing software through its API: Open Dental, 3D Slicer, Orthanc/PACS.
3. As a Bluetooth keyboard, which works with any viewer that has hotkeys and needs no install (firmware mode).

**Four applications.** The team picks one to polish around hour 14. The code must keep all four as **data + config**, never as forks or `if (app === ...)` scattered through components. Per-application differences live in the case pack manifest and `config/apps/<app>.json`.

| App id | Setting | Scan | Hover-scrub controls | Clinic software | Rulebook (Automated Reasoning) | Poll |
|---|---|---|---|---|---|---|
| `chairside` | Dentist at the chair | 3D teeth scan (surface mesh, teeth labeled) | Bite open/close | Open Dental API | Dental insurance rules (how often something is covered, waiting periods, annual max) | Which option to discuss next visit |
| `kneeview` | Sports-medicine consult | Knee MRI (volume + label meshes) | Slice through the volume | 3D Slicer WebServer; Orthanc DICOMweb | Consistency with the report; return-to-sport criteria | PT first / surgeon consult / second opinion |
| `neuroview` | MS follow-up | Brain MRI at several visits + lesion masks | Time across visits | 3D Slicer; FHIR (stretch) | MS activity terms; consistency with the report | Questions for the next visit |
| `jawline` | Jaw pain and clicking | Jaw-joint (TMJ) MRI, mouth closed and open | Jaw opening (between the two scans) | Open Dental | DC/TMD disc-displacement definitions | Splint / PT / follow-up imaging |

**Gesture map** (default; per-app override in config). The PAJ7620U2 reports 9 gestures:

| Gesture | Default command |
|---|---|
| left / right | rotate yaw ∓30° (animated) |
| up / down | rotate pitch ±20° |
| forward (toward sensor) / backward | zoom in / out |
| clockwise / counterclockwise | peel the next layer off / put it back |
| wave | start/stop voice listening (push-to-talk) |
| hover: hold still ~1 s | enter scrub mode. Hand height drives `scrub` (0–1), which the app config maps to slice, time or bite/jaw opening. Pulling the hand away exits |

**Demo script (3 minutes; app-specific wording comes later):**
1. **Setup:** the screen shows a real scan, with the dataset credit visible in the footer. A judge holds a hand over the puck. A swipe turns the model, and a circle peels a layer.
2. **Scrub:** hold still, then raise or lower the hand to scrub slices, years or jaw opening.
3. **Voice:** wave, then say "show me the finding and explain it". The view flies to the finding. A verified explanation appears with a "checked against rulebook" badge, and the voice reads it.
4. **Patient delivery:** the judge texts our number to opt in. Say "send this to the patient" and confirm with a gesture. The judge's iPhone shows the card.
5. **Vote:** the judge votes on the phone. The vote appears on the big screen and in the clinic software within seconds.
6. **Failure case:** say something false ("tell them it's fully healed"). Automated Reasoning flags it, the send is blocked, and the screen shows why.
7. **Close:** it runs on an Arm board, uses no camera, and works with the software clinics already have.

**Non-code tasks** (create the templates and checklists listed in section 8; people fill them in):
- pitch outline
- demo script
- Devpost write-up (~1,000 words)
- backup video plan
- clinician interview notes
- dataset licenses and citations
- per-prize submission checklist (Photon, Amazon Bedrock, MLH Arm, Healthcare track)
- judge Q&A (FDA software-as-a-medical-device boundary, HIPAA, why not a camera or Leap Motion, accuracy)
- safety and disclaimers
- rehearsal log

## 2. Hard rules

1. **No invented medical content.**
   - All anatomy and findings come from public, de-identified datasets, built by the pipeline.
   - Do not download datasets or generate anatomy-shaped placeholders.
   - Dev mode ships one abstract **test-pattern case pack**: colored nested cubes, spheres and axes, labeled `TEST PATTERN — NOT ANATOMY`. The pipeline's unit tests can use synthetic volumes (spheres), and those never ship in a case pack.
2. **No real patient data, ever.** Phone numbers come from env vars, and only for people who opted in by texting first.
3. **Not a diagnostic device.** A persistent UI footer says: "For communication and education. Not for diagnosis." Findings are shown as "from the dataset's report/labels".
4. **Fail closed on patient-facing text.**
   - Nothing is sent to a patient unless `VerifiedText.status === "verified"` **and** the clinician confirms.
   - Every other status blocks the send and shows the reason.
5. **Every outside dependency** (Bedrock, Photon, serial port, Open Dental, Slicer, Orthanc) sits behind an interface with a mock. `pnpm dev` must work offline with no hardware and no credentials.
6. **Secrets:**
   - Only `.env.example` is committed; `.env` is git-ignored.
   - AWS credentials come from the standard credential chain.
   - Log nothing that contains a secret or a phone number (mask it).
7. **Must run on linux-arm64** (Raspberry Pi 5 class) as well as macOS and Windows laptops. Avoid native modules without arm64 prebuilds. If one is unavoidable, document it in `docs/decisions/`.
8. **Licenses:** record every dataset and notable dependency in `docs/attributions.md`. Large data never goes in git (`.gitignore` covers `casepacks/**/*.glb`, `*.nii*`, `*.dcm`, `data/`).
9. **Network safety:**
   - 3D Slicer's WebServer can run arbitrary Python through `/slicer/exec`. The Slicer adapter refuses any host other than `localhost`/`127.0.0.1` and is off by default.
   - The hub binds to `127.0.0.1` unless `HUB_BIND` is set.

## 3. Stack (decided; don't substitute without writing an ADR saying why)

- **Monorepo:** pnpm workspaces, TypeScript `strict`, Node 22 LTS, ESLint + Prettier, Vitest.
- **`packages/contracts`:**
  - Zod schemas, exported TS types, and generated JSON Schema (`contracts/schema/*.json`) for the Python pipeline and the firmware docs.
  - Version the contracts with a `CONTRACTS_VERSION` constant.
- **`apps/hub`:**
  - Fastify + `@fastify/websocket`, `serialport`, `pino`.
  - AWS SDK v3 `@aws-sdk/client-bedrock-runtime`: `ConverseCommand`, `ApplyGuardrailCommand`, and `InvokeModelWithBidirectionalStreamCommand` with `NodeHttp2Handler` for Nova 2 Sonic.
  - Region comes from env (default `us-east-1`).
- **`apps/web`:**
  - Vite + TypeScript + Preact (small, fast on Arm).
  - **three.js** for the main 3D scene (GLB via GLTFLoader with meshopt decoding).
  - **NiiVue** for the 2D slice panel.
- **`pipeline/`:**
  - Python 3.11+, managed with `uv`.
  - nibabel, SimpleITK, numpy, scikit-image (marching cubes), trimesh (GLB export); pyvista optional for smoothing and decimation; pytest.
  - A `typer` CLI.
- **`firmware/`:**
  - PlatformIO, Arduino framework, classic ESP32 dev board (`esp32dev`).
  - Libraries: `RevEng_PAJ7620`, ArduinoJson.
  - Build flag `HID_MODE` for an optional Bluetooth-keyboard build (NimBLE-based keyboard library; leave a stub if unsure).
- **Photon:**
  - The Spectrum TypeScript SDK (cloud iMessage). Wrap it behind `PatientChannel`.
  - Implement the real adapter as a thin skeleton with TODOs. Our earlier research found these names, but **verify them against current docs before relying on them**:
    - `customizedMiniApp()` for cards, updated in place with `edit(...)`
    - inbound `content.type === "poll_option"` with `optionIdentifier` and `selected`
    - inbound `"read"` receipts (off by default for recipients)
    - `message.react()`
    - `effect(...)` message effects

## 4. Repo layout and ownership

Create this layout. Put role handles in `.github/CODEOWNERS` as placeholders (`@ROLE_A`, `@ROLE_B`, `@ROLE_C`) for the team to replace.

```
hoverscan/
  package.json  pnpm-workspace.yaml  tsconfig.base.json  .env.example  .gitignore  .editorconfig
  .github/CODEOWNERS  .github/workflows/ci.yml           # C
  packages/contracts/                                    # C (changes need approval from both affected roles)
  apps/hub/src/
    server.ts  bus/  log/                                # C
    gesture/                                             # B
    casepacks/                                           # B
    ai/                                                  # A
    messaging/                                           # A
    integrations/                                        # C
  apps/web/src/
    app/  viewer/  slices/  input/  hud/  ui/            # B
    features/voice/  features/share/                     # A
    pages/phone/  pages/debug/                           # C (fake phone + event log)
  pipeline/                                              # B
  casepacks/test-pattern/                                # B (committed; tiny)
  config/apps/{chairside,kneeview,neuroview,jawline}.json   # B (gesture map, scrub meaning, layer styling)
  config/{ai,photon,gesture,integrations}.json              # owner of each module
  policies/{chairside,kneeview,neuroview,jawline}/          # A (rulebook source docs + test sentences; content help from C)
  firmware/                                              # B (team may reassign to C)
  deploy/arm/                                            # C
  scripts/                                               # C
  docs/                                                  # C (+ everyone)
```

Feature folders register themselves through small registries (`apps/web/src/app/panels.ts`, `apps/hub/src/modules.ts`). Adding a feature then means adding one line, not editing someone else's file. Create the registries now with every module already registered.

## 5. Contracts (implement as Zod in `packages/contracts`)

Field names below are the spec. Add `.describe()` text to every field.

- **`GestureEvent`** (firmware → hub, one JSON object per line, 115200 baud):
  - `{t:"g", g:"up"|"down"|"left"|"right"|"forward"|"backward"|"cw"|"ccw"|"wave", seq:number, ms:number}`
  - `{t:"h", x:number, y:number, z:number, seq, ms}` (hover, normalized 0–1; z = proximity)
  - `{t:"hb", fw:string, ms}` (heartbeat)
  - `{t:"err", msg}`
- **`ViewerCommand`** is a discriminated union on `type`, each with `id` (uuid), `ts`, and `source: "gesture"|"mouse"|"keyboard"|"voice"|"integration"|"patient"|"system"`:
  - `rotate{yawDeg?,pitchDeg?}`, `zoom{factor}`, `peel{dir:"out"|"in"}`, `set_layer{layerId,visible?,opacity?}`
  - `slice{plane:"axial"|"coronal"|"sagittal", index?|delta?}`, `scrub{value}`, `timepoint{index?|delta?}`
  - `focus_finding{findingId|"next"|"prev"}`, `bookmark{label?}`, `reset_view{}`, `capture{requestId}`, `mode{mode:"orbit"|"scrub"}`
  - `listen{on:boolean}`, `explain{findingId?}`, `share_to_patient{bookmarkIds:string[]}`, `confirm{for:string}`, `cancel{for:string}`
  - `load_case{app,caseId}`
- **`ViewerState`:**
  - `{app, caseId, camera{position,target,up}, layers[{id,opacity,visible}], slice{plane,index}, timepoint, scrub, mode, focusedFindingId, bookmarks[{id,label,snapshotUrl?,state}], pending{confirmFor?}}`
  - Published by the viewer, throttled to 10 Hz. The hub caches the latest.
- **`CasePackManifest`:**
  - Identity and provenance: `{schema:1, app, caseId, title, source{dataset, url, license, citation, subjectId}, deidentified:true, coordinateSystem:"RAS", units:"mm"}`.
  - `layers[{id,label,file,color,defaultOpacity,peelOrder,kind:"surface"}]` (peelOrder 0 = outermost).
  - `volumes[{id,file,modality,sequence,timepointId?}]`.
  - `timepoints[{id,label,order}]` (optional).
  - `findings[{id,label,layerId?,center[x,y,z],radiusMm,provenance:"dataset_label"|"dataset_report"|"measured", reportExcerpt?, timepointId?}]`.
  - `report?{text,provenance}`.
  - `share{templateId, pollOptions[{id,label}]}`, `policyId`.
- **`VerifiedText`:** `{text, status:"verified"|"needs_review"|"blocked", findings:[{type, detail}], policyId, checkedAt}`.
  - Automated Reasoning result types to model as strings: `VALID`, `INVALID`, `SATISFIABLE`, `IMPOSSIBLE`, `TRANSLATION_AMBIGUOUS`, `TOO_COMPLEX`, `NO_TRANSLATIONS`.
  - Only all-`VALID` maps to `verified`. Put the mapping in one pure function with tests.
- **`ShareRequest`:** `{shareId, recipientRef (opaque id, not a phone number), bookmarks[{snapshotUrl,label}], verified: VerifiedText, pollOptions}`.
- **`ShareEvent`:** `{shareId, kind:"sent"|"delivered"|"read"|"vote"|"reaction"|"error", optionId?, selected?, detail?, ts}`.
- **Bus envelopes over WebSocket:**
  - `{ch:"cmd", cmd:ViewerCommand}`, `{ch:"state", state:ViewerState}`, `{ch:"gesture", ev:GestureEvent}`, `{ch:"share", ev:ShareEvent}`, `{ch:"voice", ev:{kind:"listening"|"transcript"|"speaking"|"tool"|"error", text?}}`, `{ch:"log", ...}`.

## 6. What to implement now

**Hub (`apps/hub`)**
- `bus/`:
  - A WS hub that validates every message with the contracts.
  - Routes commands to the viewer and caches the latest `ViewerState`.
  - Appends every envelope to `logs/session-<ts>.jsonl`.
  - `pnpm replay <file>` re-emits a log in real time. This is the demo backup.
- `gesture/`:
  - A serial reader with auto-reconnect, configured by `GESTURE_PORT` and `GESTURE_BAUD`.
  - A **keyboard mock source** for terminal input (arrows, `[`/`]` for cw/ccw, `w` for wave, `+`/`-` for forward/backward, `h` for hover).
  - A **mapper** that turns `GestureEvent`s into `ViewerCommand`s using `config/apps/<app>.json`, with debounce (default 250 ms) and hover-hold detection.
  - Unit tests for the mapper.
- `casepacks/`:
  - Serves `CASEPACK_DIR`.
  - Validates manifests at startup and lists available cases at `GET /api/cases`.
- `ai/`:
  - Interfaces `VoiceAgent`, `Explainer`, `ClaimChecker`.
  - **Mocks:**
    - `VoiceAgent` takes typed text from the web voice panel and turns it into commands with simple intent rules.
    - `Explainer` returns the finding's `reportExcerpt` as text.
    - `ClaimChecker` returns fixture results from `policies/<app>/fixtures.json`, with at least one `INVALID` example.
  - **Real skeletons:**
    - `NovaSonicVoiceAgent`: bidirectional stream with `NodeHttp2Handler`, model id from `AI_VOICE_MODEL_ID` (default `amazon.nova-2-sonic-v1:0`, verify). Tool definitions are generated from the `ViewerCommand` schema, plus `explain_finding` and `send_to_patient`.
    - `BedrockExplainer`: Converse, model id from env.
    - `AutomatedReasoningChecker`: `ApplyGuardrail` with `AI_GUARDRAIL_ID`/`AI_GUARDRAIL_VERSION`.
    - Each has TODOs for the event schema details.
  - **Flow:** `explain` → Explainer → ClaimChecker → `VerifiedText` → the bus and the web UI. `share_to_patient` requires a `confirm`.
  - Nova Sonic may paraphrase, so the screen always shows the verified text as the source of truth.
- `messaging/`:
  - Interface `PatientChannel {send(ShareRequest), update(shareId, ...), onEvent(cb)}`.
  - **Mock:** writes to an in-memory store that the web `/phone` page renders as a fake iPhone card, with clickable poll options that send `vote` events. It's clearly labeled `SIMULATED PHONE`.
  - **Real skeleton:** `PhotonChannel`, with an opt-in flow: a recipient is registered only after they text the keyword.
- `integrations/`:
  - Interface `Integration {name, start(), onState?(s), onCommand?(c), onShareEvent?(e)}`.
  - Skeletons, all disabled by default and enabled by `INTEG_*` env:
    - `slicer`: localhost-only guard; mirrors camera/slice through the WebServer API; verify endpoints.
    - `opendental`: patient lookup + writes the poll result as a note on the treatment plan; verify endpoints and dev keys.
    - `orthanc`: lists studies over DICOMweb.
  - A `log-only` integration that prints what it would send.
- Health endpoint `GET /api/health` reports each module as `mock` | `live` | `error`.

**Web (`apps/web`)**
- Kiosk layout:
  - Big 3D viewport, collapsible slice panel (NiiVue), findings list.
  - **Gesture HUD**: the last gesture icon, the current mode, and a scrub bar. This is essential for demo legibility.
  - Voice panel (A's folder: mic button, live transcript, typed-text fallback) and share panel (A's folder: verified text with a status badge, a confirm button, and the share status timeline).
  - Footer with the dataset credit and the disclaimer.
- The viewer applies every `ViewerCommand` with eased animations:
  - peel by layer `peelOrder` with opacity tweening and correct transparency sorting
  - scrub mapped per app config
  - focus_finding flies the camera to `center`
  - bookmark stores the state and a snapshot
  - publishes throttled `ViewerState`
- **Mouse and keyboard controls** produce `ViewerCommand`s; they don't mutate the scene directly. OrbitControls are only for free orbit, and the result syncs back to state.
- `capture`: renders a PNG and POSTs it to the hub (`/api/snapshots`).
- Pages: `/` kiosk, `/phone` simulated phone (C), `/debug` live event log and module health (C).
- Loads the test-pattern case pack by default. A case picker lists `/api/cases`.

**Pipeline (`pipeline/`)**
- CLI commands:
  - `hoverscan-pipeline build --app <app> --case <id> --input <path> --out casepacks/<app>/<id>`
  - `hoverscan-pipeline validate <dir>`
- Steps, as stubs with clear TODOs where dataset-specific:
  1. Load NIfTI/DICOM.
  2. Reorient to RAS (document LPS ↔ RAS; this is the classic sign-flip bug).
  3. Per-label marching cubes in **world mm using the affine**.
  4. Smooth and decimate to a triangle budget (default 300k per case), then export GLB per layer.
  5. Copy or resample the volumes.
  6. Write the manifest and validate it against `contracts/schema/CasePackManifest.json`.
- A mesh-only path for surface scans (`chairside`): load OBJ/PLY with per-vertex labels → split per label → GLB.
- Tests:
  - a synthetic sphere volume → mesh centroid and radius within 1 mm
  - an orientation-flip test
  - a manifest validation test

**Firmware (`firmware/`)**
- Reads PAJ7620U2 gestures over I²C (3.3 V) and emits `GestureEvent` JSON lines, plus a heartbeat every 2 s.
- `HOVER_MODE` stub, with a TODO: the cursor/object-position registers need verifying against the datasheet's cursor-mode section.
- Sensor orientation is configurable (rotate the gesture labels 0/90/180/270).
- `HID_MODE` build flag: a stub that maps gestures to configurable key codes for use with any viewer.
- `pio run` must compile.

**Scripts and deploy**
- `pnpm dev`: hub + web, all mocks, keyboard gestures.
- `pnpm dev:hw`: real serial.
- `pnpm demo`: env-driven live modules.
- `pnpm replay <log>`.
- `pnpm check`: typecheck, lint and test across everything.
- `deploy/arm/`: README + systemd unit for the hub + a Chromium kiosk launcher + a note on linux-arm64 prebuilds for `serialport`.

## 7. CI

The GitHub Actions workflow runs `pnpm check`, `uv run pytest` in `pipeline/`, and `pio run` in `firmware/` (can be a separate job; cache the toolchain). It must pass on the scaffold.

## 8. Docs to create

- `README.md`: a 60-second quickstart.
- `docs/architecture.md`: the diagram plus data flows.
- `docs/contracts.md`: generated or hand-written field tables.
- `CONTRIBUTING.md`:
  - ownership table, folder rules, contract-change rule
  - merge windows H6/H12/H18/H24/H30, lockfile rule
  - "every module has a mock"
- `docs/decisions/0001-*.md`: one ADR per stack choice made above.
- `docs/safety.md`: fail-closed rule, disclaimers, no real patient data, Slicer exec risk, phone opt-in.
- `docs/attributions.md`.
- Templates with headings and prompts, not filler text:
  - `docs/demo-script.md`
  - `docs/devpost-draft.md` (~1,000 words target; sections: problem, what it does, how we built it, Bedrock features used, Photon features used, Arm, challenges, accuracy and data sources, what's next)
  - `docs/judge-qa.md`
  - `docs/sponsor-checklist.md` (Photon, Amazon Bedrock, MLH Arm, Healthcare track; each with "requirement", "how we meet it", "evidence/link")
  - `docs/clinician-interview.md`
  - `docs/rehearsal-log.md`
  - `docs/backup-plan.md`: what breaks → what we show instead (replay log, simulated phone, prerecorded video). Every fallback is announced honestly in the demo.

## 9. Done means

1. A fresh clone runs `pnpm i && pnpm dev`. The browser shows the test pattern. Keyboard "gestures" rotate, peel and scrub it, and the HUD shows each one.
2. Typing "explain" in the voice panel produces a `VerifiedText`. A fixture `INVALID` sentence is blocked with a visible reason.
3. "Share" → confirm → the `/phone` simulated phone shows the card. Clicking a poll option shows the vote on the kiosk within 1 second.
4. `pnpm check`, `pytest`, and `pio run` all pass. CI is green.
5. `/api/health` shows every module as `mock`.
6. No file outside a module's folder needs editing to add a new command handler, panel or integration (show this in `CONTRIBUTING.md`).

Finish with a short report:
- what you built
- every TODO that needs verification, grouped by role (A/B/C)
- any place you departed from this brief, and why
