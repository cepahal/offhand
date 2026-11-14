# Everything else: remaining tasks and how to split them

Prompts 2A and 2B cover A's and B's research. This is every other task the project needs, with a suggested owner. "C" is the third teammate.

## The main rebalancing suggestion

**B is overloaded.** The data pipeline, the viewer, the UI, the firmware and the gesture mapping are all on the critical path for the hour-12 wow. Suggested changes:
- **Move to C:** the firmware, the puck enclosure, sensor tuning on real hardware, and Bluetooth-keyboard mode.
- **B keeps:** the hub's gesture-to-command mapper and the on-screen gesture HUD. That's where the gesture board meets the viewer, so it stays in one person's head.
- **The boundary between them** is the `GestureEvent` JSON line. C makes the puck emit clean events, and B decides what they do.

**A is light on hours 0–6** while waiting on accounts and model access. A should also own **writing the rulebook source documents**, and C can help with research. The rulebooks are the part judges will poke at.

## Task list

### Before the event (now through Thursday)

| Task | Owner | Notes |
|---|---|---|
| Read HackPrinceton's rules: pre-written code, AI tools, disclosure, team size, hardware rules | C | Settles whether Prompt 1 runs at H0 and what to disclose |
| **Request dataset access** (SKM-TEA, MS longitudinal, BraTS, Teeth3DS+) | B | Today. Approvals can take days |
| AWS account, Bedrock model access (Nova 2 Sonic, a text model), Automated Reasoning in us-east-1 | A | Check that sponsor credits will be available at the event |
| Photon account and test numbers; confirm what plan the hackathon gives | A | |
| Buy list (≤ $50, check prices): spare PAJ7620U2, spare ESP32, USB cardioid mic, two data-capable USB cables, header pins/jumpers | C | The sensor modules are fragile. Bring a spare |
| Arm board: OS image, Chromium, Node 22 arm64, power supply, HDMI, microSD | C | Test that a WebGL page runs smoothly |
| Line up one clinician to interview: a dentist, a team physician at University Health Services, an orthopedic resident, or dental/med students | C | A real quote beats any statistic in the pitch |
| Create GitHub org/repo (empty), Discord/Slack channel, shared drive for built case packs | C | Empty is fine. No code before H0 |
| 30-minute meeting Thursday night: walk through 00-plan, lock the shared formats on paper, assign the decision-gate owner | All | |

### At the event: platform and integration (C)

| Task | When |
|---|---|
| Run Prompt 1, review, push, freeze shared formats, add CODEOWNERS handles | H0–H2 |
| Run end-to-end checks at every merge window (H6/H12/H18/H24/H30); keep `main` demoable | Ongoing |
| **Clinic-software integration for the chosen app:** Open Dental API (ChairSide/JawLine) or 3D Slicer + Orthanc (KneeView/NeuroView). One real round trip: the vote lands in the software | H6–H24 |
| Bluetooth-keyboard firmware mode showing the puck driving OHIF or Horos with no install (the "works with anything" proof) | H12–H24 |
| Arm deployment: systemd, kiosk auto-start, offline behavior, a performance check on the real case pack | H6–H20 |
| Network plan: phone hotspot as a backup to venue Wi-Fi; Photon and Bedrock tested on both | H10 |
| Firmware, enclosure and sensor tuning (if you take the rebalancing) | H0–H16 |

### At the event: content, story and judging (mostly C, everyone reviews)

| Task | Owner | When |
|---|---|---|
| Rulebook source documents per app (cited public sources) + 10 test sentences each (5 true, 5 false) | A writes, C researches | H2–H14 |
| Decision-gate meeting: pick the one app using the criteria in 00-plan | C runs it | H12–H14 |
| Problem statement and lived-experience story for the chosen app; the clinician's quote | C | H14–H20 |
| Visit sponsor booths early (Photon, AWS, MLH Arm): show the hour-12 build, ask what impresses them, note criteria | A (Photon/AWS), C (Arm) | Saturday morning |
| Pitch: 3-minute demo script + 30-second version for judges walking by | C | H20–H28 |
| Judge Q&A drill: FDA medical-device boundary, HIPAA and BAAs, accuracy and data provenance, why not a camera or Leap Motion, the "HackNC already did this" question, cost, who buys it | C leads, all answer | H26–H34 |
| Devpost write-up (~1,000 words), screenshots, data credits, honest notes on what's live vs. simulated | C | H24–H34 |
| Backup demo video (record once the build is stable; recut at freeze) | B records, C edits | H24, H30 |
| Per-prize submission checklist: each sponsor's required fields and links | C | H30–H34 |

### At the event: quality and reliability (everyone)

| Task | Owner |
|---|---|
| Failure drills: unplug the puck, kill Wi-Fi, revoke AWS creds, Photon down. Each must degrade gracefully and visibly | C runs, owners fix |
| Accuracy check: a mesh-over-slice overlay screenshot for the chosen case, and every finding traced to its dataset label/report | B |
| Fail-closed test: 10 false sentences never reach the phone | A |
| Rehearse the full demo 5+ times, with a stranger's hand on the puck at least twice | All |
| Sleep plan: stagger sleep so one person is always awake and none is up for 36 hours | All |

## How to split the work

1. **Split by folder, not by feature.** The ownership table in 00-plan is the split. Shared formats are the only meeting point.
2. **Everyone keeps a working mock of everyone else.** If you're blocked, you're doing it wrong: switch to the mock and keep building.
3. **Each person has one key result at each checkpoint:**
   - **H12:**
     - A: a voice command moves the viewer.
     - B: a real case pack peels and scrubs from the real puck.
     - C: the stack runs on the Arm board, plus one integration says hello.
   - **H24:**
     - A: a verified card and poll on a real iPhone.
     - B: the polished wow on the chosen case.
     - C: the vote lands in the clinic software.
   - **H30:** demo-complete. Polish and rehearsal only after this.
4. **One person (C) owns `main` and the demo machine.** Others never push straight to the demo box.
5. **Use the decision gate.** After H14, the three apps you didn't pick get no more effort. Their case packs stay in the repo as "also supports" in the pitch, only if they really load.

## Things that could still sink us (watch these)

- **Dataset approval doesn't arrive.** Pick the app whose data you actually have. This could decide the gate for you.
- **Hover-scrub registers don't work.** Fall back to repeated up/down for slice steps. That's less magical but reliable.
- **Voice in a loud hall.** Use wave-to-talk, a close cardioid mic, and a typed fallback that's visible on screen.
- **Photon sending limits or plan restrictions.** Use the simulated phone, labeled honestly, plus the recorded video.
- **"Isn't this the HackNC project?"** Our answer: no camera, works inside existing clinic software, verified patient messaging, and it runs on a $10 sensor. Rehearse it.
