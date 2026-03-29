import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, vi } from "vitest";

import { ServerConfig } from "../../config.ts";
import {
  GitCore,
  type ExecuteGitInput,
  type ExecuteGitResult,
} from "../../git/Services/GitCore.ts";
import { makeGitCore } from "../../git/Layers/GitCore.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspaceEntriesLive } from "./WorkspaceEntries.ts";

const { executeGitMock } = vi.hoisted(() => ({
  executeGitMock: vi.fn<(input: ExecuteGitInput) => Effect.Effect<ExecuteGitResult, never>>(),
}));

function gitResult(
  overrides: Partial<ExecuteGitResult> & Pick<ExecuteGitResult, "stdout" | "code" | "stderr">,
): ExecuteGitResult {
  return {
    stdout: overrides.stdout,
    code: overrides.code,
    stderr: overrides.stderr,
    stdoutTruncated: overrides.stdoutTruncated ?? false,
    stderrTruncated: overrides.stderrTruncated ?? false,
  };
}

describe("WorkspaceEntries git-ignore chunking", () => {
  beforeEach(() => {
    executeGitMock.mockReset();
  });

  it.effect("chunks git check-ignore stdin to avoid building giant strings", () =>
    Effect.gen(function* () {
      const ignoredPaths = Array.from(
        { length: 5000 },
        (_, index) => `ignored/${index.toString().padStart(5, "0")}/${"x".repeat(80)}.ts`,
      );
      const keptPaths = ["src/keep.ts", "docs/readme.md"];
      const listedPaths = [...ignoredPaths, ...keptPaths];
      let checkIgnoreCalls = 0;

      executeGitMock.mockImplementation((input) => {
        if (input.args[0] === "rev-parse") {
          return Effect.succeed(gitResult({ code: 0, stdout: "true\n", stderr: "" }));
        }

        if (input.args[0] === "ls-files") {
          return Effect.succeed(
            gitResult({
              code: 0,
              stdout: `${listedPaths.join("\0")}\0`,
              stderr: "",
            }),
          );
        }

        if (input.args[0] === "check-ignore") {
          checkIgnoreCalls += 1;
          const chunkPaths = (input.stdin ?? "").split("\0").filter((value) => value.length > 0);
          const chunkIgnored = chunkPaths.filter((value) => value.startsWith("ignored/"));
          return Effect.succeed(
            gitResult({
              code: chunkIgnored.length > 0 ? 0 : 1,
              stdout: chunkIgnored.length > 0 ? `${chunkIgnored.join("\0")}\0` : "",
              stderr: "",
            }),
          );
        }

        return Effect.die(new Error(`Unexpected command: git ${input.args.join(" ")}`));
      });

      const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-workspace-entries-chunking-test-",
      });
      const gitCoreLayer = Layer.effect(
        GitCore,
        makeGitCore({
          executeOverride: executeGitMock,
        }),
      ).pipe(Layer.provide(serverConfigLayer), Layer.provide(NodeServices.layer));
      const workspaceEntriesLayer = WorkspaceEntriesLive.pipe(
        Layer.provide(gitCoreLayer),
        Layer.provide(NodeServices.layer),
      );
      const testLayer = Layer.mergeAll(NodeServices.layer, gitCoreLayer, workspaceEntriesLayer);

      const result = yield* Effect.gen(function* () {
        const workspaceEntries = yield* WorkspaceEntries;
        return yield* workspaceEntries.search({
          cwd: "/virtual/workspace",
          query: "",
          limit: 100,
        });
      }).pipe(Effect.provide(testLayer));

      expect(checkIgnoreCalls).toBeGreaterThan(1);
      expect(result.entries.some((entry) => entry.path.startsWith("ignored/"))).toBe(false);
      expect(result.entries.some((entry) => entry.path === "src/keep.ts")).toBe(true);
    }),
  );
});
