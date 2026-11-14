# @hoverscan/contracts changelog

## 1.1.0 — pending approval from both owners

**Status: pending approval from both owners (A: hub modules, B: viewer/gesture).** Nothing
below is final until both sign off. Every change is additive: data valid under 1.0.0
(`@offhand/contracts`) still validates under 1.1.0.

The package was renamed from `@offhand/contracts` to `@hoverscan/contracts`. There is still one
version constant (`CONTRACTS_VERSION` in `src/version.ts`), now `1.1.0`, and the JSON Schema
`$id`s changed from `offhand/*.json` to `hoverscan/*.json`.

### Conflicts between the viewer (offhand) and the ported hub modules

| Field | Viewer (offhand 1.0.0) | Ported modules expected | Resolution in 1.1.0 |
| --- | --- | --- | --- |
| `ViewerState.camera` | `{position, target, up}` | `{azimuth, elevation, distance}` | Kept `{position, target, up}`. Added optional `azimuth`, `elevation`, `distance`. The pure function `cameraOrbit(position, target)` derives them (azimuth 0 = anterior, 90 = patient's right; elevation +90 = superior), and the Slicer and log-only integrations read the camera only through it. |
| `ViewerState.slice` | `slice.plane` | `slice.axis` | Kept `slice.plane`. Every use of `slice.axis` was removed from the ported code. |
| `ViewerState.app`, `caseId` | nullable | non-null | Kept nullable. Ported modules treat `null` as "no case loaded" and refuse to explain or share. |
| `ViewerState.layers[]` | `visible` + `opacity` | `opacity` only | Kept both `visible` and `opacity`. |
| `Bookmark` | embedded view (`state: ViewSnapshot`) | `snapshotUrl` only | Kept the embedded view. `snapshotUrl` stays optional; it was already present in offhand, so nothing new was needed here. |
| `BusEnvelope` | no `verified` channel | `{ch: "verified", ev: VerifiedText}` | Added `{ch: "verified", ev: VerifiedText}`. The hub bus validates it and fans it out like every other channel. The viewer's controller ignores channels it doesn't handle, so it isn't affected. |

### Other additive changes

| Change | Why |
| --- | --- |
| `VerifiedText.policyId` (required inside the new type), `VerifiedText.checker` (optional) | The claim checker records which policy and which checker produced the status. `VerifiedText` is new to the bus, so nothing older depends on it. |
| `VoiceEvent.tool` (optional) | Lets the voice agent report which tool it used. |
| `PollOption`, `PHONE_PATTERN`, `containsPhoneNumber()` | Shared poll option shape, and a single phone-number check used by the "no phone numbers in logs, notes or messages" rule. |
| `RECIPIENT_REF_PATTERN` (`rcp_…`) | Opaque recipient reference, so share requests never carry a phone number. |
| `CameraState.position` description | Now documents the world axes (three.js x = −R, y = S, z = A). |

### Proposals not applied (need both owners)

- `ShareEvent.recipientRef` and `ShareEvent.app`: today the integrations look these up from
  the messaging module's ledger instead.
- `slice.count`: Slicer needs the slice count to scroll accurately. The hub currently assumes
  a 0–255 range (see the TODO(verify) in `apps/hub/src/integrations/slicer.ts`).
- The viewer adopting `pending.confirmFor` from the hub's share flow. Until then the share
  flow keeps its own pending record and enforces confirmation in the hub.
