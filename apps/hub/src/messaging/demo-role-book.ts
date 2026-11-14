import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { emptyMessaging, ingestKeyword, persistRoles, type MessagingState, type PersistedRole } from "./demo-messages.js";

function indexPhones(json: string | null): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!json) return map;
  try {
    const parsed = JSON.parse(json) as { recipients?: unknown };
    if (!Array.isArray(parsed.recipients)) return map;
    for (const item of parsed.recipients) {
      if (!item || typeof item !== "object") continue;
      const phone = (item as { phone?: unknown }).phone;
      if (typeof phone !== "string") continue;
      const digits = phone.replace(/\D/g, "");
      const handle = phone.trim().startsWith("+") ? `+${digits}` : digits;
      if (!handle) continue;
      const key = digits.slice(-4);
      const list = map.get(key) ?? [];
      if (!list.includes(handle)) list.push(handle);
      map.set(key, list);
    }
  } catch {
    return map;
  }
  return map;
}

function loadHandles(json: string | null, roles: readonly PersistedRole[]): Record<string, string> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as { recipients?: unknown };
    if (!Array.isArray(parsed.recipients)) return {};
    const refs = new Set(roles.map((role) => role.ref));
    const handles: Record<string, string> = {};
    for (const item of parsed.recipients) {
      if (!item || typeof item !== "object") continue;
      const ref = (item as { ref?: unknown }).ref;
      const phone = (item as { phone?: unknown }).phone;
      if (typeof ref !== "string" || typeof phone !== "string" || !refs.has(ref)) continue;
      const digits = phone.replace(/\D/g, "");
      const handle = phone.trim().startsWith("+") ? `+${digits}` : digits;
      if (handle) handles[handle] = ref;
    }
    return handles;
  } catch {
    return {};
  }
}

function loadRoles(json: string | null): PersistedRole[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as { roles?: unknown };
    if (!Array.isArray(parsed.roles)) return [];
    return parsed.roles.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const role = item as PersistedRole;
      if ((role.role !== "hospital" && role.role !== "patient") || typeof role.ref !== "string" || typeof role.last4 !== "string") return [];
      return [{ ref: role.ref, role: role.role, last4: role.last4, optedInAt: typeof role.optedInAt === "string" ? role.optedInAt : "" }];
    });
  } catch {
    return [];
  }
}

/** Role map for the demonstration. The phone handle stays in memory; the file gets last4 only. */
export class DemoRoleBook {
  state: MessagingState;
  /** Last four digits to opted-in handles. Used only to deliver. Never logged. */
  private readonly phonesByLast4 = new Map<string, string[]>();

  constructor(
    private readonly file: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly newRef: () => string = () => `rcp_${Math.random().toString(36).slice(2, 14).padEnd(12, "a")}`,
  ) {
    const json = existsSync(file) ? readFileSync(file, "utf8") : null;
    const roles = loadRoles(json);
    this.state = { ...emptyMessaging(), roles, handles: loadHandles(json, roles) };
    this.phonesByLast4 = indexPhones(json);
  }

  /** The handle for a registered role. Falls back to the one recipient that shares that role's last four digits. */
  handleForRole(role: "hospital" | "patient"): string | undefined {
    const record = this.state.roles.find((item) => item.role === role);
    if (!record) return undefined;
    const direct = this.handleFor(record.ref);
    if (direct) return direct;
    const matches = this.phonesByLast4.get(record.last4) ?? [];
    return matches.length === 1 ? matches[0] : undefined;
  }

  ingest(handle: string, text: string): ReturnType<typeof ingestKeyword> {
    const result = ingestKeyword(this.state, handle, text, this.now(), this.newRef);
    this.state = result.state;
    if (result.outcome === "registered") this.save();
    return result;
  }

  handleFor(ref: string): string | undefined {
    return Object.entries(this.state.handles).find(([, id]) => id === ref)?.[0];
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const existing = existsSync(this.file) ? readFileSync(this.file, "utf8") : null;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, persistRoles(existing, this.state.roles), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
