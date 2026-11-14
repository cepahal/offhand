# HoverScan: team plan (working name)

This is the plan the three prompts are built on. Read it first. It fixes the goals, the shared formats that let three people work at once, who owns which folders, and the timeline.

**Rules warning.** Hackathons that follow MLH-style rules usually require the project code to be written during the event. Libraries and open-source code are fine, but a pre-built project is not. So:
- **Before kickoff:** research, accounts, dataset access requests, hardware, and design docs (this plan) only.
- **At kickoff (H0):** one person runs Prompt 1 to generate the codebase.
- **Today:** check HackPrinceton's own rules for whether AI coding tools and pre-written prompts/design docs are allowed, and how to disclose them.

---

## 1. What we're building

A $10 gesture sensor plus voice lets a gloved clinician spin, peel and scrub through a patient's **real** 3D scan without touching anything. It works inside software clinics already use. The patient leaves with an interactive explanation on their iPhone, and that explanation has been fact-checked against a rulebook.

There are four applications on one shared core. We choose one to polish at the decision gate (around H14). Until then, all four exist as **data and config, not forks of the code**.

| | ChairSide | KneeView | NeuroView | JawLine |
|---|---|---|---|---|
| **Who / where** | Dentist at the chair, gloved | Orthopedic / sports-medicine consult | Neurologist follow-up (MS) | Dentist or oral surgeon, jaw pain and clicking |
| **Scan** | 3D teeth scan from an intraoral scanner (surface mesh) | Knee MRI | Brain MRI, repeated over visits | Jaw-joint (TMJ) MRI, mouth closed and open |
| **Candidate data** | Teeth3DS+ (1,800 scans, teeth labeled) | SKM-TEA (tissue segmentations, 16 types of injury boxed from reports); fastMRI+ | ISBI 2015 longitudinal MS lesion challenge; BraTS (tumor) as an alternative | **Not found yet: go/no-go** |
| **Hover-scrub controls** | Bite open and close | Slices through the MRI | **Time** across visits | Jaw opening |
| **Real findings from** | Dataset tooth labels + measured geometry | Dataset injury boxes | Rater lesion masks | Disc labels (if a dataset exists) |
| **Clinic software** | Open Dental API | 3D Slicer WebServer; Orthanc (DICOMweb) | 3D Slicer; FHIR (stretch) | Open Dental |
| **Automated Reasoning rulebook** | Dental insurance rules: how often something is covered, waiting periods, annual maximum, age limits for braces | Consistency with the report + return-to-sport criteria after ACL reconstruction | MS activity terms (new or enlarging lesions) + consistency with the report | DC/TMD definitions of disc displacement |
| **Photon poll** | Which option to discuss next visit | PT first / surgeon consult / second opinion | Questions for the next visit | Splint / PT / follow-up imaging |
| **Biggest risk** | Teeth scans show crowns and gums, **not roots**. Roots need cone-beam CT, which is a CT | Layers limited to whatever the dataset labels | Data registration lead time | No dataset |

## 2. Goals the build must hit (pass/fail)

| # | Goal | How we know |
|---|---|---|
| G1 | Impressive at first glance | A judge waves a hand and a real scan turns or peels in under 150 ms |
| G2 | Accurate | Every mesh and finding comes from public data, with the source shown on screen. Nothing invented |
| G3 | Gesture board used fully | All 9 gestures plus hover-scrub mapped and demoed |
| G4 | Bedrock integral | Nova 2 Sonic voice calls tools that move the viewer. Automated Reasoning gates every claim a patient sees |
| G5 | Photon integral | Card + native poll. The vote shows on the big screen and in the clinic software within seconds |
| G6 | Uses popular software | At least one real integration (Open Dental, 3D Slicer or Orthanc), plus a Bluetooth-keyboard mode for any viewer |
| G7 | Arm | Runs on the Arm board. The only outside connections are the cloud APIs |
| G8 | Reliable demo | Every outside dependency has a fallback. The 3-minute demo has been rehearsed 5+ times |
| G9 | Within the rules | No project code before H0. Dataset licenses respected. No real patient data |

## 3. Architecture

```
ESP32 + PAJ7620U2 ──USB serial (JSON lines)──► HUB (Node, runs on Arm board) ◄──WebSocket──► VIEWER (browser kiosk)
   (optional: BLE keyboard mode → any PACS)      │  command bus + latest ViewerState              three.js 3D + NiiVue slices
                                                 │                                                 mouse/keyboard → commands
Mic (browser) ──PCM audio over WS──────────────► │──► Bedrock Nova 2 Sonic (speech in/out, tool calls → commands)
                                                 │──► Bedrock Converse (draft explanation) ──► ApplyGuardrail w/ Automated Reasoning
                                                 │──► Photon Spectrum ──► patient iPhone (card + poll) ──► vote back to hub
                                                 │──► integrations: Open Dental API · 3D Slicer WebServer (localhost) · Orthanc
Python pipeline (offline, laptops) ──► casepacks/ (GLB meshes + NIfTI volumes + manifest.json) ──► served by hub
```

**One vocabulary for everything.**
- Gestures, mouse, keyboard, voice tool calls, integrations and patient votes all become `ViewerCommand`s on one bus.
- The viewer applies them and publishes `ViewerState`.
- Nobody calls anybody else's code directly. That's the main defense against people colliding.

## 4. Shared formats (frozen at H2; changes are additive and approved by both people affected)

1. `GestureEvent`: what the firmware emits. One of the 9 gestures, hover x/y/z, heartbeat.
2. `ViewerCommand`: rotate, zoom, peel, slice, scrub, timepoint, focus_finding, bookmark, reset_view, set_layer, listen, explain, share_to_patient, confirm, cancel, capture. Each has `source` and `id`.
3. `ViewerState`: case, camera, layer opacities, slice/time/scrub, focused finding, bookmarks, mode. The viewer publishes it at up to 10 Hz.
4. `CasePack` manifest: the application, the case, the dataset source + license + citation, RAS/mm coordinates, layers in peel order, volumes, timepoints, findings, report text, and pointers to the rulebook and card template.
5. `VerifiedText`: the text + Automated Reasoning findings + status (`verified` | `needs_review` | `blocked`).
6. `ShareRequest` / `ShareEvent`: snapshots + verified text + poll options → sent / delivered / read / vote / reaction.

## 5. Ownership

| Role | Person | Owns (folders) | Develops against mocks of |
|---|---|---|---|
| **A: AI, voice, messaging** | Member A | `apps/hub/src/ai`, `apps/hub/src/messaging`, `apps/web/src/features/voice`, `apps/web/src/features/share`, `policies/` | Viewer (via the bus), gestures |
| **B: imaging, viewer, gestures** | Member B | `pipeline/`, `casepacks/`, `apps/web` (everything except A's two feature folders), `apps/hub/src/gesture`, `firmware/` (suggest handing to C, see 03) | AI, Photon, integrations |
| **C: platform, integrations, demo** | Member C | `packages/contracts`, `apps/hub/src/bus`, `apps/hub/src/integrations`, repo root/CI/scripts, `deploy/` (Arm), `docs/` (pitch, Devpost, Q&A) | Everything (C runs the integration builds) |

## 6. Rules for working in parallel

1. **The formats are a contract.** `packages/contracts` changes only by pull request, approved by the owners of both sides. Changes are additive (new optional fields or new command types). Never rename.
2. **Folders have owners** (CODEOWNERS). Editing another person's folder means asking first or opening a PR for them to review.
3. **Everything has a mock.** `pnpm dev` runs the whole app with no network and no hardware. Nobody waits on anybody.
4. **Settings are separate per module.** Env vars are prefixed `AI_`, `PHOTON_`, `GESTURE_`, `INTEG_`, `VIEWER_`. Config lives in `config/<module>.json`. There's no shared config file to fight over.
5. **Small PRs onto main, with CI** (typecheck, lint, tests). Merge windows at H6, H12, H18, H24, H30, each with a 5-minute standup. C runs the end-to-end check after each.
6. **Lockfile conflicts:** take main's lockfile, then rerun `pnpm install`. Never hand-merge it.
7. **Large data never goes in git.** Scripts rebuild it, and the built casepacks are shared over a drive link.

## 7. Timeline (H0 = hacking starts)

| When | A | B | C |
|---|---|---|---|
| **Mon–Thu (now)** | Run Prompt 2A. AWS account, Bedrock model access, Photon account | Run Prompt 2B. **Request dataset access today.** Order spare sensor | Read the rules, finish the buy list, set up the repo org, line up a clinician to interview |
| **Thu night** | 30-min meeting: review this plan and the format list, decide anything still open | | |
| **H0–H2** | Review the generated formats | Review the generated formats | Run Prompt 1, push, freeze the formats |
| **H2–H12** | Voice → commands; verification path; Photon card on a real phone | Pipeline builds 2 real casepacks; viewer peels and scrubs; gestures from hardware | Integrations to "hello world"; Arm board running the stack |
| **H12–H14** | **Decision gate:** pick the one application (criteria below) | | |
| **H14–H28** | Rulebook for the chosen app; polish voice | Wow polish, gesture tuning, HUD | Real clinic-software round trip; backups; Devpost draft |
| **H28** | Feature freeze | | |
| **H28–H36** | Rehearse ×5, record backup video, submit to each prize, Q&A drill | | |

**Decision gate criteria (in order):**
1. The real data is loaded and correct.
2. A real finding is on screen.
3. The rulebook gets 10 test sentences right.
4. The problem is one we can speak to from experience.
5. What sponsor mentors said.

On a tie, pick ChairSide. It's the model's top score, if the team accepts that it shows no roots.
