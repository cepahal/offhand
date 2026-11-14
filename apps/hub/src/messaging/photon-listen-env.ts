/**
 * Checks for the registration listener. The returned sentences name settings.
 * They never include a setting's value.
 */
export function photonListenProblems(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];
  if (env.PHOTON_MODE?.trim() !== "live") problems.push("PHOTON_MODE must be live");
  if (env.PHOTON_TRANSPORT?.trim() !== "sdk") problems.push("PHOTON_TRANSPORT must be sdk");
  if (!env.PHOTON_PROJECT_ID?.trim()) problems.push("PHOTON_PROJECT_ID is not set");
  if (!env.PHOTON_API_KEY?.trim()) problems.push("PHOTON_API_KEY is not set");
  if (!env.PHOTON_LINE?.trim()) problems.push("PHOTON_LINE is not set");
  return problems;
}

/** Startup line. `digits` is already the last four digits of the line. */
export function listenBanner(digits: string): string {
  return `Photon listening on line ending ${digits}. Text HOSPITAL or PATIENT to register. Ctrl+C to stop.`;
}

export function registeredLine(role: "hospital" | "patient", digits: string): string {
  return `registered ${role} from ...${digits}`;
}

export function alreadyRegisteredLine(role: "hospital" | "patient", digits: string): string {
  return `already registered ${role} from ...${digits}`;
}

export function waitingLine(role: "hospital" | "patient"): string {
  return `${role} is not registered. Text ${role.toUpperCase()} from that phone.`;
}

export function ignoredLine(digits: string): string {
  return `ignored message from ...${digits}`;
}

/** Removes the key and the line from an error before it is printed. */
export function safeListenError(message: string, env: NodeJS.ProcessEnv): string {
  let out = message;
  const secret = env.PHOTON_API_KEY?.trim();
  const line = env.PHOTON_LINE?.trim();
  if (secret) out = out.split(secret).join("***");
  if (line) out = out.split(line).join("***");
  return out;
}
