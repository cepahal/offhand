import {
  BedrockRuntimeClient,
  type ApplyGuardrailCommand,
  type ApplyGuardrailCommandOutput,
  type ConverseCommand,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";

/** The slice of BedrockRuntimeClient the live classes use; tests pass a fake. */
export interface ConverseClient {
  send(command: ConverseCommand): Promise<ConverseCommandOutput>;
}

export interface GuardrailClient {
  send(command: ApplyGuardrailCommand): Promise<ApplyGuardrailCommandOutput>;
}

/** Credentials come from the standard AWS chain (profile, SSO, or role); none are read here. */
export function createBedrockClient(region: string): BedrockRuntimeClient {
  return new BedrockRuntimeClient({ region });
}

/** Concatenated text blocks of a Converse reply. */
export function converseText(out: ConverseCommandOutput): string {
  return (out.output?.message?.content ?? [])
    .map((b) => b.text ?? "")
    .join("")
    .trim();
}
