# Architecture

One Node process (the hub) and one browser page. Everything outside them sits behind an interface
with a mock, so `pnpm dev` runs offline with no credentials.

```
 Browser (apps/web, Chrome)                     Hub (apps/hub, Fastify, 127.0.0.1:8787)
 ┌──────────────────────────────┐   /ws bus    ┌──────────────────────────────────────────────┐
 │ one screen: 3D view, slices, │◀────────────▶│ bus: cmd · state · gesture · voice · share · │
 │ finding, explanation+badge,  │              │      verified · log                           │
 │ mic/typed box, share+timeline│   /api, /casepacks, /snapshots                              │
 │ /debug: health, clinic inbox │◀────────────▶│ modules:                                      │
 └──────────────────────────────┘              │  casepacks   case pack index + files          │
   Chrome speech recognition ──▶ Google        │  gesture     ESP32 board over USB serial      │
                                               │  ai          Converse + ApplyGuardrail ──▶ AWS Bedrock (us-east-2)
                                               │  messaging   Photon / Spectrum ──▶ iMessage   │
                                               │  integrations Slicer ──▶ localhost:2016       │
                                               │               clinic inbox ──▶ data/clinic-inbox.jsonl
                                               └──────────────────────────────────────────────┘
```

## Contracts

`packages/contracts` (`@hoverscan/contracts`, zod) defines every envelope: `ViewerCommand`,
`ViewerState`, `VoiceEvent`, `VerifiedText`, `ShareRequest`, `ShareEvent` and the case-pack
manifest. Changes are additive only.

Envelope ownership is enforced at the WebSocket fan-out: `verified` envelopes are forwarded only if
the `ai` module published them, and `share` envelopes only if `messaging` did. A browser cannot forge
a verified explanation or a vote.

## Run modes

`HOVERSCAN_RUN`, set by the root scripts, overrides `.env`:

| Script | Mode | Behaviour |
| --- | --- | --- |
| `pnpm dev` | `mock` | `AI_MODE`, `PHOTON_MODE` and every `INTEG_*` forced to mock. No network, no hardware. |
| `pnpm start:live` | `live` | `AI_MODE=live`, `PHOTON_MODE=live`. `apps/hub/src/live/startup.ts` prints the active Photon transport and refuses to start, naming each missing setting (AI ids, Photon project/key/line, webhook URL and secret, `INTEG_SLICER=live`, `INTEG_CLINIC_INBOX=live`, a valid `PHOTON_TRANSPORT`). |
| `pnpm e2e:live` | `live` | `apps/hub/scripts/e2e-live.ts`: the NeuroView sequence in-process, PASS/FAIL per step, then the live fail-closed test. |

A live run never falls back to mock. A failing outside service shows up as a visible degraded state
(see `docs/safety.md`).

## AI (`apps/hub/src/ai`)

- **Voice → commands.** `ConverseVoiceAgent` calls Bedrock `Converse` (model `AI_CONVERSE_MODEL_ID`,
  Nova Lite) with one tool per `ViewerCommand` type (`toolConfig.tools[].toolSpec.inputSchema.json`,
  generated from the zod schemas). Each `toolUse` input is validated with zod before it reaches the
  bus. A text reply is accepted only as one short clarifying question. The context sent is the case
  title, the visit and only the findings visible at that visit.
- **Explanations.** `BedrockExplainer` (Converse, temperature 0) receives only the finding's
  measured text (`reportExcerpt`) and the rulebook terms from `policies/<app>/rulebook.json`, and
  must restate them without adding claims.
- **Check.** `AutomatedReasoningChecker` calls `ApplyGuardrail` (`AI_GUARDRAIL_ID`,
  `AI_GUARDRAIL_VERSION`, `source: "OUTPUT"`, `outputScope: "FULL"`). The draft is the
  `guard_content` block, and a fixed question is the `query` block. Results map through
  `statusMapping.ts`. If anything fails, the result is `needs_review`.
- `ExplainFlow` publishes one `VerifiedText` on `verified`. If the explainer throws (for example, no
  credentials), it still publishes the measured text as `needs_review` with the reason.

## Messaging (`apps/hub/src/messaging`)

- `PatientChannel` interface, with `MockPatientChannel` (simulated phone at `/phone`) and
  `PhotonChannel` (spectrum-ts 12.16, loaded dynamically by `spectrum-sdk.ts`).
- **Transport `sdk` (default).** The hub holds one long-lived `Spectrum({ projectId, projectSecret,
  providers: [imessage.config()] })` connection and consumes `app.messages`. There is no public URL.
  On start it prints `Photon listener connected (sdk), line <last 4>`. If the stream ends or throws,
  it publishes "messaging: reconnecting" and reconnects with backoff (1, 2, 5, 10, 30 s).
- **Transport `webhook`.** `POST /webhooks/photon` (raw body) is checked with
  `verifySpectrumSignature` from `@spectrum-ts/core/webhook`, then handed to `app.webhook(...)`. On
  start it prints the URL to register under Spectrum / Webhooks → Add webhook:
  `<PHOTON_PUBLIC_URL>/webhooks/photon`.
- **Inbound** (both transports): the opt-in keyword registers the sender as an opaque
  `recipientRef` and replies with a confirmation. Other texts from unregistered numbers are
  ignored. `poll_option` becomes a `vote` ShareEvent and `read` becomes a `read` ShareEvent, both
  mapped to the share by the sent message's id through the ledger.
- **Outbound.** Optionally a `customizedMiniApp()` card first (needs `PHOTON_MINIAPP_*` and
  `PHOTON_PUBLIC_URL`; it links to `GET /share/:shareId`, which shows the sent text). Then the
  verified text, the bookmarked snapshots and a native poll. Updates use `edit(content, message)`.
  `shareId` is the idempotency key, and a share is never sent twice.
- `ShareFlow`: `share_to_patient` sets `pending.confirmFor` (published on `state`; the browser
  adopts it). Only a matching `confirm` sends, and only if the latest `VerifiedText` is still
  `verified`. A down channel gives the timeline row "not sent: messaging unavailable. (reason)".

## Integrations (`apps/hub/src/integrations`)

- **3D Slicer** (`slicer.ts`, localhost only). On load it opens the visit's FLAIR volume with
  `POST /slicer/mrml/file?localfile=…&filetype=VolumeFile`, removing the previous one with
  `DELETE /slicer/mrml/file?id=…`. On each state change it sends `GET /slicer/slice` (orientation and
  `scrollTo` from the slice index and the volume's real dimensions), then `GET /slicer/threeD`
  (`lookFromAxis` from the camera direction). It never calls `/slicer/exec`.
- **Clinic inbox** (`clinic-inbox.ts`, the NeuroView clinic-record stand-in). It appends every vote
  to `data/clinic-inbox.jsonl` as `{ts, shareId, app, caseId, recipientRef, optionId, optionLabel,
  selected}`, mode 0600, with no phone number. `/debug` shows it through
  `GET /api/integrations/clinicinbox/entries`. A ChairSide build would replace it with the Open
  Dental integration.
- Open Dental, Orthanc and log-only are present and off by default.

## Web (`apps/web`)

- `/`: the one screen (`app/App.tsx`).
  - Top bar: case, visit and source credit.
  - Left: three.js view (`viewer/`) and the NiiVue slice panel. Focusing a finding moves the camera,
    switches to its visit and slices through its centre.
  - Right: the current finding, the explanation with its badge and reason, the mic button (Chrome
    only) and typed box, then Send to patient / Confirm / Cancel and the timeline.
  - Footer: the disclaimer.
- `/debug`: module health, clinic inbox, Slicer status, timeline, hub log.
- `/phone`: the simulated phone, served by the hub in mock mode only.
- Every input becomes a `ViewerCommand` on the hub bus and is applied when it comes back, so voice,
  keyboard, mouse and gestures take the same path.

## Case data

`pipeline/` (Python, `uv`) builds case packs. `pnpm build:neuroview` converts the ISBI 2015 data
into `casepacks/neuroview/` (canonical RAS NIfTI, GLB surfaces, measured findings, poll options).
The data stays local (git-ignored, licence forbids redistribution).

## Tests

- `pnpm test`: unit and integration tests with fakes, no network. This includes both Photon
  transports with fake inbound events, signature rejection, reconnect without resend, and no phone
  numbers in any output.
- `pnpm check`: typecheck, lint, tests, schema check, and the live fail-closed test when AWS is
  configured (a loud NOT RUN otherwise).
- `pnpm e2e:live`: the live sequence against real services.
