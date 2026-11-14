# Prompt 2A: research plan for Member A (Bedrock, Photon, AI, voice)

> Paste everything below into a research-capable assistant (one with web search). Member A runs it now, before the event. Research and throwaway experiments only. No project code before hacking starts.

---

You're helping me, Member A of a three-person HackPrinceton team (event Nov 13–15, 2026, about 36 hours of hacking), prepare research **before** the event. Hackathon rules require project code to be written during the event. So your output is a research plan, verified facts, and decisions. It is not project code. Small throwaway experiments in a scratch folder are fine, to learn an API; they won't be copied into the project.

## The project (context)

HoverScan lets a gloved clinician manipulate a patient's real 3D medical scan without touching anything:
- An ESP32 + PAJ7620U2 gesture puck handles spatial moves (rotate, zoom, peel layers, scrub).
- **Voice** handles meaning ("go to the finding", "explain it", "send it to the patient").
- Every patient-facing sentence is checked by **Amazon Bedrock Automated Reasoning** against a rulebook before it can be sent.
- The patient gets an interactive iMessage card through **Photon** (snapshot, verified explanation, native poll). Their vote flows back to the big screen and into the clinic's software.

It runs on an Arm board. There are four candidate applications, and we pick one at about hour 14:

| App | Scan | Rulebook idea for Automated Reasoning | Poll |
|---|---|---|---|
| ChairSide | 3D teeth scan | Dental insurance rules: how often something is covered, waiting periods, annual max, age limits for braces | Which option to discuss next visit |
| KneeView | Knee MRI | Consistency with the radiology report; return-to-sport criteria after ACL reconstruction | PT first / surgeon consult / second opinion |
| NeuroView | Brain MRI over time (MS) | MS activity terms (new or enlarging lesions); consistency with the report | Questions for next visit |
| JawLine | Jaw-joint MRI | DC/TMD disc-displacement definitions | Splint / PT / follow-up imaging |

**My scope:** the hub's AI module (Bedrock Converse, Automated Reasoning, Nova 2 Sonic voice), the Photon messaging module, the voice and share panels in the web UI, and the rulebook source documents in `policies/`. Everything I build talks to the rest of the system only through these shared formats:
- `ViewerCommand` (rotate, zoom, peel, slice, scrub, timepoint, focus_finding, bookmark, explain, share_to_patient, confirm, cancel, listen, …)
- `ViewerState`
- `VerifiedText {text, status: verified|needs_review|blocked, findings[]}`
- `ShareRequest` / `ShareEvent` (sent, delivered, read, vote, reaction)

**Target architecture:**
- **Voice:** browser mic → hub over WebSocket (PCM) → **Nova 2 Sonic** over Bedrock's bidirectional stream (`InvokeModelWithBidirectionalStream`, HTTP/2, Node AWS SDK v3 with `NodeHttp2Handler`). Tool calls become `ViewerCommand`s.
- **Explain:** an `explain_finding` tool call → Bedrock **Converse** drafts plain-language text from the dataset's report excerpt → **ApplyGuardrail** with an Automated Reasoning policy → `VerifiedText` → shown on screen and returned to Sonic to speak.
- **Patient delivery:** Photon is used only for verified text plus the clinician's confirmation.

**What I believe so far (verify each one; mark it confirmed, changed or unknown, with a link):**
- **Nova 2 Sonic:** model id `amazon.nova-2-sonic-v1:0`; regions us-east-1, us-west-2, ap-northeast-1; supports tool use (async). Exact event and tool schema, session time limit, audio formats (input/output sample rates), and barge-in behavior are unknown to me.
- **Automated Reasoning checks:**
  - Part of Bedrock Guardrails, **detect-only**: my app must withhold content itself.
  - Result types: VALID, INVALID, SATISFIABLE, IMPOSSIBLE, TRANSLATION_AMBIGUOUS, TOO_COMPLEX, NO_TRANSLATIONS.
  - Works through ApplyGuardrail or Converse. No streaming, US English only.
  - The policy is built from a source document, with a fidelity report and test scenarios.
  - Available in us-east-1.
- **Photon Spectrum (cloud iMessage, TypeScript):**
  - Mini-app cards via `customizedMiniApp()`, updated in place with `space.send(edit(customizedMiniApp(...), card))`; `live: true` needs the extension.
  - Native polls arrive as `content.type === "poll_option"` with `optionIdentifier`; `selected:false` means a vote was removed.
  - Inbound reactions are cloud-only. `message.react()` sends a tapback.
  - Read receipts arrive as `content.type === "read"` but are off by default for recipients.
  - Chat backgrounds; message effects via `effect(content, imessage.effect.message.celebration)`.
  - Group events need a dedicated cloud line on the Business plan.

## What I need from you

### Part 1: the research plan
A table of every open question, each with:
- why it matters
- which shared format or app it affects
- where to look (official docs first)
- how to answer it (read, or a ≤30-minute throwaway experiment)
- a time box
- the decision it unlocks

Order it so blockers come first. Sort into **must know before Friday**, **must know by hour 6**, and **nice to know**.

### Part 2: do the desk research
Work through the plan and answer everything you can from documentation, with links. For each experiment I must run myself, give step-by-step instructions, the expected result, and what to do if it fails.

**Questions to cover (add more you think I've missed):**

1. **Access and cost**
   - How to get Bedrock model access for Nova 2 Sonic, a text model for Converse, and Automated Reasoning in one region.
   - Quotas, rough cost for 36 hours of development + demo, and whether sponsors usually give credits.
   - The minimum IAM policy.
   - Photon account and plan: what a hackathon team gets, whether a dedicated line is needed for what we want, and the sending limits.
2. **Nova 2 Sonic voice**
   - Exact event sequence (session start, prompt, audio in/out, tool use, tool result, end).
   - Audio formats, browser capture (AudioWorklet → 16-bit PCM), playback, and latency budget.
   - Session length limits and reconnection.
   - Making it speak a tool result **verbatim**, or whether to use a separate TTS (Amazon Polly) for verified text instead.
   - Behavior in a noisy hackathon hall.
3. **Voice activation**
   - Compare: a gesture-triggered push-to-talk ("wave" = listen), a wake word (openWakeWord or Porcupine on an Arm board), and voice-activity detection.
   - Recommend one for a loud room, with privacy reasons (no always-on mic in a clinic).
   - Is a USB cardioid mic worth buying? Name models under $25.
4. **Tool design**
   - How to generate Sonic tool definitions from our `ViewerCommand` schema.
   - Handling ambiguity ("the other one").
   - Requiring a confirmation step for `send_to_patient`.
   - Keeping a voice command to under 1.5 s from end of speech to the screen moving.
5. **Automated Reasoning**
   - The step-by-step workflow from source document to policy to test scenarios to guardrail version.
   - What source documents work well. What size and complexity fail (TOO_COMPLEX).
   - How to write rules so the four app rulebooks translate cleanly.
   - Per app, find **real public sources** for the rulebook, rate how well each fits Automated Reasoning, and pick the best app for this feature:
     - **ChairSide:** a published dental plan summary of benefits with frequency limits and waiting periods.
     - **KneeView:** commonly cited return-to-sport criteria after ACL reconstruction.
     - **NeuroView:** the 2017 McDonald criteria terms.
     - **JawLine:** DC/TMD.
   - How to map each result type to verified / needs_review / blocked (we only send when all results are VALID and a clinician confirms; argue if that's wrong).
   - Latency of ApplyGuardrail with Automated Reasoning.
   - How to show the fidelity report or the rules on screen for judges.
6. **Converse explanations**
   - Model choice in our region.
   - Prompt pattern so explanations only restate the dataset's report and labels, never new medical claims.
   - Reading level (around 6th–8th grade).
7. **Photon**
   - Confirm every API name above against current docs.
   - Can a card include an image (our snapshot) and a poll together?
   - Update a card in place when the vote arrives.
   - Opt-in pattern where the recipient texts us first.
   - What appears on a judge's iPhone with no app or extension installed.
   - Webhook vs. socket delivery, and behavior on flaky hackathon Wi-Fi.
8. **Privacy and safety**
   - HIPAA reality: a production version needs Business Associate Agreements with AWS and Photon. Does Photon offer one?
   - What we must say about it in the pitch.
   - De-identification of what we send.
   - The FDA "software as a medical device" line: why education and communication is different from diagnosis.
9. **Demo resilience**
   - What to record now so a failed live call can be shown honestly (replay logs, the simulated phone).
   - Offline fallbacks for each service.
10. **Prizes**
    - Exact judging criteria and submission requirements for the Photon prize, the Amazon/Bedrock prize, and MLH Best Use of Arm at HackPrinceton Fall 2026 (if published).
    - How our feature use maps onto each.

### Part 3: output format
One Markdown document, `research/A-ai-voice-messaging.md`, with these sections:
1. **Decisions** (one line each, with the reason)
2. **Verified facts** (with links and the date checked)
3. **Corrections to what I believed**
4. **Experiments I still need to run** (steps, expected result, fallback)
5. **Proposed changes to the shared formats** (additive only; e.g. new fields on `VerifiedText` or `ShareEvent`)
6. **Ranking of the four apps for Bedrock and Photon fit** (with reasons)
7. **Risks** (likelihood × impact, with a mitigation for each)
8. **Hour-0 checklist** (accounts, env vars, region, model ids, test phone numbers)

Mark anything uncertain as uncertain. Don't present a guess as fact. Prefer official AWS and Photon docs over blogs, and give the date of every source.
