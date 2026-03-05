import {
  type ChildProcess as ChildProcessHandle,
  type ChildProcessWithoutNullStreams,
  spawn,
  spawnSync,
  type StdioOptions,
} from "node:child_process";

import type { ServerRuntimeEnvironment } from "@t3tools/contracts";

import { detectServerRuntimeEnvironment } from "./runtimeEnvironment";

interface ProcessSpawnBaseOptions {
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  runtimeEnvironment?: ServerRuntimeEnvironment | undefined;
  shell?: boolean | undefined;
}

export interface ProcessSpawnOptions extends ProcessSpawnBaseOptions {
  stdio?: StdioOptions | undefined;
  detached?: boolean | undefined;
}

export interface ProcessSpawnSyncOptions extends ProcessSpawnBaseOptions {
  stdio?: StdioOptions | undefined;
  detached?: boolean | undefined;
  encoding?: BufferEncoding | undefined;
  input?: string | undefined;
}

export interface ProcessRunOptions {
  cwd?: string | undefined;
  timeoutMs?: number | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  stdin?: string | undefined;
  allowNonZeroExit?: boolean | undefined;
  maxBufferBytes?: number | undefined;
  outputMode?: "error" | "truncate" | undefined;
  runtimeEnvironment?: ServerRuntimeEnvironment | undefined;
  shell?: boolean | undefined;
}

export interface ProcessRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdoutTruncated?: boolean | undefined;
  stderrTruncated?: boolean | undefined;
}

function commandLabel(command: string, args: readonly string[]): string {
  return [command, ...args].join(" ");
}

function resolveRuntimeEnvironment(
  runtimeEnvironment: ServerRuntimeEnvironment | undefined,
): ServerRuntimeEnvironment {
  return runtimeEnvironment ?? detectServerRuntimeEnvironment();
}

function shouldUseShell(options: ProcessSpawnBaseOptions): boolean {
  if (options.shell !== undefined) {
    return options.shell;
  }

  return resolveRuntimeEnvironment(options.runtimeEnvironment).platform === "windows";
}

function toSpawnOptions(options: ProcessSpawnOptions) {
  return {
    cwd: options.cwd,
    env: options.env,
    shell: shouldUseShell(options),
    ...(options.stdio !== undefined ? { stdio: options.stdio } : {}),
    ...(options.detached !== undefined ? { detached: options.detached } : {}),
  };
}

export function spawnProcess(
  command: string,
  args: readonly string[],
  options: ProcessSpawnOptions = {},
): ChildProcessHandle {
  return spawn(command, args, toSpawnOptions(options));
}

export function spawnPipedProcess(
  command: string,
  args: readonly string[],
  options: Omit<ProcessSpawnOptions, "stdio" | "detached"> = {},
): ChildProcessWithoutNullStreams {
  return spawnProcess(command, args, {
    ...options,
    stdio: "pipe",
  }) as ChildProcessWithoutNullStreams;
}

export function spawnProcessSync(
  command: string,
  args: readonly string[],
  options: ProcessSpawnSyncOptions = {},
) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    shell: shouldUseShell(options),
    encoding: options.encoding ?? "utf8",
    ...(options.stdio !== undefined ? { stdio: options.stdio } : {}),
    ...(options.detached !== undefined ? { detached: options.detached } : {}),
    ...(options.input !== undefined ? { input: options.input } : {}),
  });
}

export function spawnDetachedProcess(
  command: string,
  args: readonly string[],
  options: Omit<ProcessSpawnOptions, "stdio" | "detached"> = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawnProcess(command, args, {
      ...options,
      detached: true,
      stdio: "ignore",
    });

    const handleSpawn = () => {
      child.unref();
      resolve();
    };

    child.once("spawn", handleSpawn);
    child.once("error", (error) => {
      reject(normalizeSpawnError(command, args, error));
    });
  });
}

function normalizeSpawnError(command: string, args: readonly string[], error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(`Failed to run ${commandLabel(command, args)}.`);
  }

  const maybeCode = (error as NodeJS.ErrnoException).code;
  if (maybeCode === "ENOENT") {
    return new Error(`Command not found: ${command}`);
  }

  return new Error(`Failed to run ${commandLabel(command, args)}: ${error.message}`);
}

function isWindowsCommandNotFound(
  code: number | null,
  stderr: string,
  runtimeEnvironment?: ServerRuntimeEnvironment,
): boolean {
  if (resolveRuntimeEnvironment(runtimeEnvironment).platform !== "windows") return false;
  if (code === 9009) return true;
  return /is not recognized as an internal or external command/i.test(stderr);
}

function normalizeExitError(
  command: string,
  args: readonly string[],
  result: ProcessRunResult,
  runtimeEnvironment?: ServerRuntimeEnvironment,
): Error {
  if (isWindowsCommandNotFound(result.code, result.stderr, runtimeEnvironment)) {
    return new Error(`Command not found: ${command}`);
  }

  const reason = result.timedOut
    ? "timed out"
    : `failed (code=${result.code ?? "null"}, signal=${result.signal ?? "null"})`;
  const stderr = result.stderr.trim();
  const detail = stderr.length > 0 ? ` ${stderr}` : "";
  return new Error(`${commandLabel(command, args)} ${reason}.${detail}`);
}

function normalizeStdinError(command: string, args: readonly string[], error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(`Failed to write stdin for ${commandLabel(command, args)}.`);
  }
  return new Error(`Failed to write stdin for ${commandLabel(command, args)}: ${error.message}`);
}

function normalizeBufferError(
  command: string,
  args: readonly string[],
  stream: "stdout" | "stderr",
  maxBufferBytes: number,
): Error {
  return new Error(
    `${commandLabel(command, args)} exceeded ${stream} buffer limit (${maxBufferBytes} bytes).`,
  );
}

const DEFAULT_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

/**
 * On Windows with `shell: true`, `child.kill()` only terminates the `cmd.exe`
 * wrapper, leaving the actual command running. Use `taskkill /T` to kill the
 * entire process tree instead.
 */
export function killProcessTree(
  child: ChildProcessHandle,
  options: {
    runtimeEnvironment?: ServerRuntimeEnvironment | undefined;
    signal?: NodeJS.Signals | undefined;
  } = {},
): void {
  const signal = options.signal ?? "SIGTERM";
  if (
    resolveRuntimeEnvironment(options.runtimeEnvironment).platform === "windows" &&
    child.pid !== undefined
  ) {
    try {
      const result = spawnProcessSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        shell: false,
        runtimeEnvironment: options.runtimeEnvironment,
      });
      if (!result.error && result.status === 0) {
        return;
      }
      if (result.error) {
        throw result.error;
      }
    } catch {
      // fallback to direct kill
    }
  }
  child.kill(signal);
}

function appendChunkWithinLimit(
  target: string,
  currentBytes: number,
  chunk: Buffer,
  maxBytes: number,
): {
  next: string;
  nextBytes: number;
  truncated: boolean;
} {
  const remaining = maxBytes - currentBytes;
  if (remaining <= 0) {
    return { next: target, nextBytes: currentBytes, truncated: true };
  }
  if (chunk.length <= remaining) {
    return {
      next: `${target}${chunk.toString()}`,
      nextBytes: currentBytes + chunk.length,
      truncated: false,
    };
  }
  return {
    next: `${target}${chunk.subarray(0, remaining).toString()}`,
    nextBytes: currentBytes + remaining,
    truncated: true,
  };
}

export async function runProcess(
  command: string,
  args: readonly string[],
  options: ProcessRunOptions = {},
): Promise<ProcessRunResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  const outputMode = options.outputMode ?? "error";

  return new Promise<ProcessRunResult>((resolve, reject) => {
    const child = spawnPipedProcess(command, args, options);

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child, {
        runtimeEnvironment: options.runtimeEnvironment,
        signal: "SIGTERM",
      });
      forceKillTimer = setTimeout(() => {
        killProcessTree(child, {
          runtimeEnvironment: options.runtimeEnvironment,
          signal: "SIGKILL",
        });
      }, 1_000);
    }, timeoutMs);

    const finalize = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      callback();
    };

    const fail = (error: Error): void => {
      killProcessTree(child, {
        runtimeEnvironment: options.runtimeEnvironment,
        signal: "SIGTERM",
      });
      finalize(() => {
        reject(error);
      });
    };

    const appendOutput = (stream: "stdout" | "stderr", chunk: Buffer | string): Error | null => {
      const chunkBuffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      const text = chunkBuffer.toString();
      const byteLength = chunkBuffer.length;
      if (stream === "stdout") {
        if (outputMode === "truncate") {
          const appended = appendChunkWithinLimit(stdout, stdoutBytes, chunkBuffer, maxBufferBytes);
          stdout = appended.next;
          stdoutBytes = appended.nextBytes;
          stdoutTruncated = stdoutTruncated || appended.truncated;
          return null;
        }
        stdout += text;
        stdoutBytes += byteLength;
        if (stdoutBytes > maxBufferBytes) {
          return normalizeBufferError(command, args, "stdout", maxBufferBytes);
        }
      } else {
        if (outputMode === "truncate") {
          const appended = appendChunkWithinLimit(stderr, stderrBytes, chunkBuffer, maxBufferBytes);
          stderr = appended.next;
          stderrBytes = appended.nextBytes;
          stderrTruncated = stderrTruncated || appended.truncated;
          return null;
        }
        stderr += text;
        stderrBytes += byteLength;
        if (stderrBytes > maxBufferBytes) {
          return normalizeBufferError(command, args, "stderr", maxBufferBytes);
        }
      }
      return null;
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      const error = appendOutput("stdout", chunk);
      if (error) {
        fail(error);
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const error = appendOutput("stderr", chunk);
      if (error) {
        fail(error);
      }
    });

    child.once("error", (error) => {
      finalize(() => {
        reject(normalizeSpawnError(command, args, error));
      });
    });

    child.once("close", (code, signal) => {
      const result: ProcessRunResult = {
        stdout,
        stderr,
        code,
        signal,
        timedOut,
        stdoutTruncated,
        stderrTruncated,
      };

      finalize(() => {
        if (!options.allowNonZeroExit && (timedOut || (code !== null && code !== 0))) {
          reject(normalizeExitError(command, args, result, options.runtimeEnvironment));
          return;
        }
        resolve(result);
      });
    });

    child.stdin.once("error", (error) => {
      fail(normalizeStdinError(command, args, error));
    });

    if (options.stdin !== undefined) {
      child.stdin.write(options.stdin, (error) => {
        if (error) {
          fail(normalizeStdinError(command, args, error));
          return;
        }
        child.stdin.end();
      });
      return;
    }
    child.stdin.end();
  });
}
