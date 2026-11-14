import { randomUUID } from "node:crypto";
import { ViewerCommand, type ViewerCommandType } from "@hoverscan/contracts";
import { z } from "zod";

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the tool input (an object). */
  inputSchema: Record<string, unknown>;
}

/** Extra tool names the model may call, mapped to the command they produce. */
export const TOOL_ALIASES: Readonly<Record<string, ViewerCommandType>> = {
  explain_finding: "explain",
  send_to_patient: "share_to_patient",
};

/** Filled in by the hub, never by the model. */
const HUB_FIELDS = new Set(["type", "id", "ts", "source"]);

const commandTypes = (): ViewerCommandType[] => ViewerCommand.options.map((o) => o.shape.type.value);

function inputSchemaFor(variant: z.ZodType): { description: string; inputSchema: Record<string, unknown> } {
  const schema = z.toJSONSchema(variant, { target: "draft-2020-12", io: "input" }) as {
    $schema?: string;
    description?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  } & Record<string, unknown>;
  delete schema.$schema;
  const { description, properties = {}, required = [], ...rest } = schema;
  return {
    description: description ?? "",
    inputSchema: {
      ...rest,
      type: "object",
      properties: Object.fromEntries(Object.entries(properties).filter(([k]) => !HUB_FIELDS.has(k))),
      required: required.filter((k) => !HUB_FIELDS.has(k)),
    },
  };
}

/** One tool per ViewerCommand type, generated from the schema, plus the alias tools. */
export function buildToolSpecs(): ToolSpec[] {
  const byType = new Map(ViewerCommand.options.map((o) => [o.shape.type.value, inputSchemaFor(o)]));
  const tools: ToolSpec[] = commandTypes().map((type) => ({ name: type, ...byType.get(type)! }));
  for (const [alias, type] of Object.entries(TOOL_ALIASES)) {
    const base = byType.get(type)!;
    tools.push({ name: alias, description: `Same as ${type}. ${base.description}`, inputSchema: base.inputSchema });
  }
  return tools;
}

export type ToolCallResult = { ok: true; command: ViewerCommand } | { ok: false; reason: string };

/** Turns a model tool call into a validated ViewerCommand with source "voice". */
export function toolCallToCommand(name: string | undefined, input: unknown, now: () => number = Date.now): ToolCallResult {
  const type = name ? (TOOL_ALIASES[name] ?? name) : undefined;
  if (!type || !(commandTypes() as string[]).includes(type)) return { ok: false, reason: `unknown tool "${name}"` };
  const args = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const parsed = ViewerCommand.safeParse({ ...args, type, id: randomUUID(), ts: now(), source: "voice" });
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
  }
  return { ok: true, command: parsed.data };
}
