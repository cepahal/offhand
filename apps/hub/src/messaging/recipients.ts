import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { RECIPIENT_REF_PATTERN } from "@hoverscan/contracts";
import { z } from "zod";

const RecipientsFile = z.object({
  version: z.literal(1),
  recipients: z.array(
    z.object({
      ref: z.string().regex(RECIPIENT_REF_PATTERN),
      phone: z.string().min(1),
      optedInAt: z.number().int().nonnegative(),
    }),
  ),
});
type Entry = z.infer<typeof RecipientsFile>["recipients"][number];

export interface RecipientSummary {
  ref: string;
  optedInAt: number;
}

export type InboundTextOutcome =
  | { kind: "opted_in"; ref: string; isNew: boolean }
  | { kind: "opted_out"; ref: string }
  | { kind: "ignored" };

const REF_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function newRef(): string {
  const bytes = randomBytes(12);
  return `rcp_${Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("")}`;
}

/** E.164-ish handle: keeps a leading "+" and digits. Emails are lower-cased. */
export function normalizeHandle(handle: string): string {
  const t = handle.trim();
  if (t.includes("@")) return t.toLowerCase();
  const digits = t.replace(/\D/g, "");
  return t.startsWith("+") ? `+${digits}` : digits;
}

/**
 * Opt-in registry. A recipient exists only after they text the keyword to the clinic number first.
 * The phone-to-ref map lives only in this class and in the git-ignored recipients file;
 * everything outside the messaging channels sees only the opaque rcp_ ref.
 */
function roleRefsOf(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const roles = (raw as { roles?: unknown }).roles;
  if (!Array.isArray(roles)) return [];
  return roles.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const ref = (item as { ref?: unknown }).ref;
    const role = (item as { role?: unknown }).role;
    if (typeof ref !== "string" || (role !== "hospital" && role !== "patient")) return [];
    return [ref];
  });
}

export class RecipientRegistry {
  private readonly byRef = new Map<string, Entry>();
  /** Demonstration roles stored in this file. They are not the kiosk patient. */
  private readonly demoRoleRefs = new Set<string>();

  constructor(
    private readonly file: string,
    private readonly keywords: { optIn: string; optOut: string },
    private readonly now: () => number = Date.now,
  ) {
    if (!existsSync(file)) return;
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    for (const ref of roleRefsOf(raw)) this.demoRoleRefs.add(ref);
    const parsed = RecipientsFile.safeParse(raw);
    if (!parsed.success) throw new Error(`recipients file is invalid (${file}); fix or delete it`);
    for (const e of parsed.data.recipients) this.byRef.set(e.ref, e);
  }

  /** Handles any inbound text. Only an exact keyword match changes the registry. */
  handleInboundText(handle: string, text: string): InboundTextOutcome {
    const word = text.trim().toUpperCase();
    const phone = normalizeHandle(handle);
    if (!phone) return { kind: "ignored" };
    const existing = this.findByPhone(phone);
    if (word === this.keywords.optIn.toUpperCase()) {
      if (existing) {
        existing.optedInAt = this.now();
        this.save();
        return { kind: "opted_in", ref: existing.ref, isNew: false };
      }
      const entry = { ref: newRef(), phone, optedInAt: this.now() };
      this.byRef.set(entry.ref, entry);
      this.save();
      return { kind: "opted_in", ref: entry.ref, isNew: true };
    }
    if (word === this.keywords.optOut.toUpperCase() && existing) {
      this.byRef.delete(existing.ref);
      this.save();
      return { kind: "opted_out", ref: existing.ref };
    }
    return { kind: "ignored" };
  }

  has(ref: string): boolean {
    return this.byRef.has(ref);
  }

  /** The ref for a handle, if that handle opted in. Used to attribute inbound votes. */
  refForHandle(handle: string): string | undefined {
    return this.findByPhone(normalizeHandle(handle))?.ref;
  }

  /** For messaging channels only: the handle to deliver to. Never log or publish the result. */
  handleFor(ref: string): string | undefined {
    return this.byRef.get(ref)?.phone;
  }

  /**
   * Stores a demonstration role's handle in this private registry, under the role's ref.
   * active() will not select it, so a hospital registration is not a kiosk share target.
   */
  adopt(ref: string, handle: string): void {
    if (!RECIPIENT_REF_PATTERN.test(ref)) return;
    const phone = normalizeHandle(handle);
    if (!phone) return;
    const existing = this.findByPhone(phone);
    if (existing && existing.ref !== ref) return;
    this.demoRoleRefs.add(ref);
    if (!existing) this.byRef.set(ref, { ref, phone, optedInAt: this.now() });
    this.save();
  }

  /** Most recent keyword opt-in: the patient a share goes to. Demonstration roles are excluded. */
  active(): RecipientSummary | undefined {
    let best: Entry | undefined;
    for (const e of this.byRef.values()) {
      if (this.demoRoleRefs.has(e.ref)) continue;
      if (!best || e.optedInAt >= best.optedInAt) best = e;
    }
    return best && { ref: best.ref, optedInAt: best.optedInAt };
  }

  list(): RecipientSummary[] {
    return [...this.byRef.values()].map((e) => ({ ref: e.ref, optedInAt: e.optedInAt }));
  }

  private findByPhone(phone: string): Entry | undefined {
    for (const e of this.byRef.values()) if (e.phone === phone) return e;
    return undefined;
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    let roles: unknown;
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, "utf8")) as { roles?: unknown };
        if (Array.isArray(parsed.roles)) roles = parsed.roles;
      } catch {
        roles = undefined;
      }
    }
    const tmp = `${this.file}.tmp`;
    const body: z.infer<typeof RecipientsFile> & { roles?: unknown } = { version: 1, recipients: [...this.byRef.values()] };
    if (roles) body.roles = roles;
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
