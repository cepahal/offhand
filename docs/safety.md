# Safety

HoverScan is for communication and education. It is not for diagnosis. Every screen and every
patient-facing page carries that sentence.

## This build is not clinic-ready

- **Voice audio goes to Google.** The microphone button uses Chrome's Web Speech API
  (`webkitSpeechRecognition`). Chrome streams the audio to Google's speech service to transcribe it.
  The audio and transcript leave the machine and are handled under Google's terms, not ours. No
  business associate agreement covers this. So the voice input is offered only in Google Chrome
  (other browsers show "Voice needs Google Chrome."). It must not be used with real patients, or
  anywhere near real patient information, until it is replaced by a speech service under a suitable
  agreement. The typed box does the same job without sending audio anywhere.
- **Read-aloud uses the browser's speech synthesis.** Depending on the voice chosen, Chrome may also
  use a Google network voice. It only ever reads text the clinician can already see on screen.
- **Explanations and checks go to AWS.** In live mode, the finding's measured text and the rulebook
  terms are sent to Amazon Bedrock (Converse with Nova Lite, then ApplyGuardrail with an Automated
  Reasoning policy). The data used here is the public ISBI 2015 challenge set, not patient data.
- **Messages go through Photon / Spectrum and Apple iMessage.** These are outside services too.

## Rules the code enforces

1. **Fail closed.** A patient message is sent only when the latest `VerifiedText.status` is
   `"verified"` *and* the clinician presses Confirm for that exact share. The hub checks this (the
   share flow and every channel's `assertSendable`); the browser's disabled buttons are only a
   convenience.
2. **Any check failure is "needs review", never "verified".** Missing or revoked AWS credentials, a
   Bedrock error, a malformed result, a guardrail intervention or any non-VALID Automated Reasoning
   finding all map to `needs_review` or `blocked` through `config/ai.json` → `statusMapping`.
3. **No new medical claims.** The explainer may only restate the finding's measured text and the
   rulebook's terms (`policies/<app>/rulebook.json`). It names no disease and adds no prognosis.
4. **Speech never says unchecked text.** Read-aloud takes the on-screen `VerifiedText` itself and
   refuses anything that is not `"verified"`. A new or downgraded explanation stops speech at once.
   The on-screen text is the source of truth.
5. **Unclear voice requests get a clarifying question, not a guess.** A model reply is accepted as
   text only if it is one short question; anything else becomes the standard "didn't understand"
   reply.
6. **Phone numbers.** They come only from inbound messages of people who texted the opt-in keyword,
   and are replaced by an opaque `recipientRef` at once. No phone number appears in a log line, a bus
   envelope, the clinic inbox or a note. The Spectrum line (`PHOTON_LINE`) is printed as its last 4
   digits only.
7. **Opt-in.** A text from an unregistered number is ignored unless it is the opt-in keyword.
   Replying "STOP" opts out.
8. **One card per share.** `shareId` is the idempotency key. A dropped Photon connection is shown as
   "messaging: reconnecting" and is never answered by resending.
9. **Webhook transport.** `POST /webhooks/photon` processes nothing unless the Spectrum signature
   verifies (`X-Spectrum-Signature`, HMAC-SHA256 over the raw body, five-minute timestamp window).
10. **Slicer is localhost-only.** Only documented WebServer endpoints are called (`/slicer/slice`,
    `/slicer/threeD`, `/slicer/mrml/file`), never `/slicer/exec`.
11. **The hub binds 127.0.0.1** unless `HUB_BIND` is set.

## Failure drills

| Drill | What you see | What is sent |
| --- | --- | --- |
| AWS credentials missing or revoked | Explanation shows the measured text with an amber "Needs review" badge and the credential reason | Nothing: Send and Confirm stay disabled, and the hub refuses |
| Photon unreachable | Timeline: "not sent: messaging unavailable." (with the reason) | Nothing |
| Blocked text | Red "Blocked" badge with the reason | Nothing: no send button works, and voice "send it" is refused by the hub |

## The fail-closed test

`apps/hub/test/live/fail-closed.live.ts` sends the 10 sentences in
`policies/neuroview/rulebook.json` through the real ApplyGuardrail call and then through the full
share path. It fails if a false sentence is ever "verified" or reaches a `sent` event. `pnpm check`
runs it whenever the live AI settings and AWS credentials are present; otherwise it prints a loud
"NOT RUN". `pnpm e2e:live` always runs it and fails if it cannot.

## Data licence

The ISBI 2015 data may not be redistributed, raw or derived. `casepacks/neuroview/` and `data/` are
git-ignored.
