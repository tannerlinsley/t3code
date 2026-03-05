/**
 * Git process helpers - runtime-aware git execution with typed errors.
 *
 * Centralizes child-process git invocation for server modules. This module
 * only executes git commands and reports structured failures.
 *
 * @module GitServiceLive
 */
import { Effect, Layer, Schema } from "effect";
import { runProcess } from "../../processRunner.ts";
import { GitCommandError } from "../Errors.ts";
import {
  ExecuteGitInput,
  ExecuteGitResult,
  GitService,
  GitServiceShape,
} from "../Services/GitService.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

function quoteGitCommand(args: ReadonlyArray<string>): string {
  return `git ${args.join(" ")}`;
}

function toGitCommandError(
  input: Pick<ExecuteGitInput, "operation" | "cwd" | "args">,
  detail: string,
) {
  return (cause: unknown) =>
    Schema.is(GitCommandError)(cause)
      ? cause
      : new GitCommandError({
          operation: input.operation,
          command: quoteGitCommand(input.args),
          cwd: input.cwd,
          detail: `${cause instanceof Error && cause.message.length > 0 ? cause.message : "Unknown error"} - ${detail}`,
          ...(cause !== undefined ? { cause } : {}),
        });
}

const makeGitService = Effect.sync(() => {
  const execute: GitServiceShape["execute"] = Effect.fnUntraced(function* (input) {
    const commandInput = {
      ...input,
      args: [...input.args],
    } as const;
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

    return yield* Effect.tryPromise({
      try: async () => {
        const result = await runProcess("git", commandInput.args, {
          cwd: commandInput.cwd,
          ...(input.env ? { env: input.env } : {}),
          timeoutMs,
          allowNonZeroExit: true,
          maxBufferBytes: maxOutputBytes,
          outputMode: "error",
        });

        if (result.timedOut) {
          throw new GitCommandError({
            operation: commandInput.operation,
            command: quoteGitCommand(commandInput.args),
            cwd: commandInput.cwd,
            detail: `${quoteGitCommand(commandInput.args)} timed out.`,
          });
        }

        const exitCode = result.code ?? 0;
        if (!input.allowNonZeroExit && exitCode !== 0) {
          const trimmedStderr = result.stderr.trim();
          throw new GitCommandError({
            operation: commandInput.operation,
            command: quoteGitCommand(commandInput.args),
            cwd: commandInput.cwd,
            detail:
              trimmedStderr.length > 0
                ? `${quoteGitCommand(commandInput.args)} failed: ${trimmedStderr}`
                : `${quoteGitCommand(commandInput.args)} failed with code ${exitCode}.`,
          });
        }

        return {
          code: exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        } satisfies ExecuteGitResult;
      },
      catch: toGitCommandError(commandInput, "failed to run."),
    });
  });

  return {
    execute,
  } satisfies GitServiceShape;
});

export const GitServiceLive = Layer.effect(GitService, makeGitService);
