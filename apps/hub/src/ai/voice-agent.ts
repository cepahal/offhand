import type { BusEnvelope, CasePackManifest, ViewerCommand, ViewerState } from "@hoverscan/contracts";

export type VoiceEnvelope = Extract<BusEnvelope, { ch: "voice" }>;

export interface VoiceContext {
  state?: ViewerState;
  /** Findings of the loaded case, for resolving "the finding". */
  findings?: readonly Pick<CasePackManifest["findings"][number], "id" | "label">[];
}

export interface VoiceResult {
  /** Every command has source "voice". */
  commands: ViewerCommand[];
  envelopes: VoiceEnvelope[];
}

/** Turns a transcript (typed, or produced by the browser's speech recognition) into commands. */
export interface VoiceAgent {
  handle(transcript: string, ctx: VoiceContext): Promise<VoiceResult>;
}

export const UNMATCHED_REPLY = "I didn't catch that. Try: explain it, show the finding, send to patient.";

export function voiceReply(text: string): VoiceEnvelope {
  return { ch: "voice", ev: { kind: "transcript", text } };
}
