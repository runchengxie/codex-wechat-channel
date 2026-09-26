export const SANDBOX_MODES = ["read-only", "workspace-write", "danger-full-access"] as const;
export type SandboxMode = typeof SANDBOX_MODES[number];

export function parseSandboxMode(value: unknown): SandboxMode | null {
  return SANDBOX_MODES.find((mode) => mode === value) ?? null;
}

export function effectiveSandbox(requested: SandboxMode | undefined, serviceMaximum: string): SandboxMode {
  const maximum = parseSandboxMode(serviceMaximum);
  if (!maximum) throw new Error(`Unsupported service sandbox: ${serviceMaximum}`);
  if (!requested || SANDBOX_MODES.indexOf(requested) > SANDBOX_MODES.indexOf(maximum)) return maximum;
  return requested;
}
