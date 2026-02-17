type PerfToggleEnv = {
  T3CODE_DESKTOP_PERF_RUN_TERMINAL?: string | undefined;
  CI?: string | undefined;
};

type OptionalRendererToggleEnv = {
  T3CODE_DESKTOP_PERF_RUN_OPTIONAL_RENDERER?: string | undefined;
  CI?: string | undefined;
};

type PerfBenchmarkEnv = {
  T3CODE_DESKTOP_PERF_BENCHMARK_FOLLOW_UP_PASSES?: string | undefined;
  CI?: string | undefined;
};

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

function parseBooleanLike(value: string | undefined): boolean | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

function isCiEnvironment(value: string | undefined): boolean {
  return parseBooleanLike(value) === true;
}

/**
 * Controls whether desktop perf automation should include terminal shortcuts.
 *
 * Accepted explicit env values:
 * - truthy: "1", "true", "yes", "on"
 * - falsy: "0", "false", "no", "off"
 *
 * Defaults to "on" for local/dev runs, but "off" in CI unless explicitly enabled.
 * This keeps CI perf checks focused on renderer responsiveness while avoiding
 * flaky PTY-dependent interactions in ephemeral Linux runners.
 */
export function shouldRunTerminalPerfInteractions(env: PerfToggleEnv): boolean {
  const toggleOverride = parseBooleanLike(env.T3CODE_DESKTOP_PERF_RUN_TERMINAL);
  if (toggleOverride !== null) return toggleOverride;
  return !isCiEnvironment(env.CI);
}

export function shouldRunOptionalRendererPerfInteractions(env: OptionalRendererToggleEnv): boolean {
  const toggleOverride = parseBooleanLike(env.T3CODE_DESKTOP_PERF_RUN_OPTIONAL_RENDERER);
  if (toggleOverride !== null) return toggleOverride;
  return !isCiEnvironment(env.CI);
}

export function resolveBenchmarkFollowUpPassCount(env: PerfBenchmarkEnv): number {
  const raw = env.T3CODE_DESKTOP_PERF_BENCHMARK_FOLLOW_UP_PASSES?.trim();
  if (raw && /^\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }
  return isCiEnvironment(env.CI) ? 0 : 1;
}
