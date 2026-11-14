import { randomUUID } from "node:crypto";
import type { ViewerCommand } from "@hoverscan/contracts";
import { UNMATCHED_REPLY, voiceReply, type VoiceAgent, type VoiceContext, type VoiceResult } from "./voice-agent.js";

type CommandBody = ViewerCommand extends infer C ? (C extends ViewerCommand ? Omit<C, "id" | "ts" | "source"> : never) : never;

/** Either a command to emit or a reply explaining why none was emitted. */
type RuleOutcome = { cmd: CommandBody } | { reply: string };

interface ParseState {
  ctx: VoiceContext;
  /** Finding focused earlier in the same utterance ("show me the finding and explain it"). */
  focusedId: string | undefined;
}

function resolveFinding(s: ParseState): RuleOutcome | { id: string } {
  const id = s.focusedId ?? s.ctx.state?.focusedFindingId;
  if (id) return { id };
  const findings = s.ctx.findings ?? [];
  if (findings.length === 1) return { id: findings[0]!.id };
  if (findings.length === 0) return { reply: "There is no finding in this case to show." };
  return { reply: `Which finding? ${findings.map((f) => f.label).join(", ")}.` };
}

const RULES: { pattern: RegExp; build: (m: RegExpMatchArray, s: ParseState) => RuleOutcome }[] = [
  {
    pattern: /^(show me|go to) the finding$/,
    build: (_, s) => {
      const r = resolveFinding(s);
      if (!("id" in r)) return r;
      s.focusedId = r.id;
      return { cmd: { type: "focus_finding", findingId: r.id } };
    },
  },
  {
    pattern: /^explain( it)?$/,
    build: (_, s) => {
      const id = s.focusedId ?? s.ctx.state?.focusedFindingId;
      return { cmd: id ? { type: "explain", findingId: id } : { type: "explain" } };
    },
  },
  { pattern: /^send (it )?to (the )?patient$/, build: () => ({ cmd: { type: "share_to_patient", bookmarkIds: [] } }) },
  {
    pattern: /^confirm$/,
    build: (_, s) => {
      const pending = s.ctx.state?.pending.confirmFor;
      return pending ? { cmd: { type: "confirm", for: pending } } : { reply: "There is nothing waiting for confirmation." };
    },
  },
  {
    pattern: /^cancel$/,
    build: (_, s) => {
      const pending = s.ctx.state?.pending.confirmFor;
      return pending ? { cmd: { type: "cancel", for: pending } } : { reply: "There is nothing to cancel." };
    },
  },
  { pattern: /^zoom (in|out)$/, build: (m) => ({ cmd: { type: "zoom", factor: m[1] === "in" ? 1.25 : 0.8 } }) },
  { pattern: /^rotate (left|right)$/, build: (m) => ({ cmd: { type: "rotate", yawDeg: m[1] === "left" ? -30 : 30 } }) },
  { pattern: /^reset( the)?( view)?$/, build: () => ({ cmd: { type: "reset_view" } }) },
];

export function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^please /, "")
    .replace(/ please$/, "");
}

/**
 * Exact-phrase rules only. An utterance may chain phrases with "and" / "then";
 * if any part does not match, nothing is emitted. It never guesses.
 */
export class MockVoiceAgent implements VoiceAgent {
  constructor(private readonly now: () => number = Date.now) {}

  async handle(transcript: string, ctx: VoiceContext): Promise<VoiceResult> {
    const parts = normalizeTranscript(transcript).split(/ (?:and then|and|then) /).filter(Boolean);
    const state: ParseState = { ctx, focusedId: undefined };
    const commands: ViewerCommand[] = [];

    for (const part of parts) {
      const rule = RULES.find((r) => r.pattern.test(part));
      if (!rule) return { commands: [], envelopes: [voiceReply(UNMATCHED_REPLY)] };
      const outcome = rule.build(part.match(rule.pattern)!, state);
      if ("reply" in outcome) return { commands: [], envelopes: [voiceReply(outcome.reply)] };
      commands.push({ ...outcome.cmd, id: randomUUID(), ts: this.now(), source: "voice" } as ViewerCommand);
    }
    if (commands.length === 0) return { commands: [], envelopes: [voiceReply(UNMATCHED_REPLY)] };
    return { commands, envelopes: commands.map((c) => ({ ch: "voice", ev: { kind: "tool", tool: c.type } })) };
  }
}
