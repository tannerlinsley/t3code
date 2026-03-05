import { describe, expect, it } from "vitest";

import { runProcess, spawnDetachedProcess, spawnProcessSync } from "./processRunner";

describe("runProcess", () => {
  it("fails when output exceeds max buffer in default mode", async () => {
    await expect(
      runProcess("node", ["-e", "process.stdout.write('x'.repeat(2048))"], { maxBufferBytes: 128 }),
    ).rejects.toThrow("exceeded stdout buffer limit");
  });

  it("truncates output when outputMode is truncate", async () => {
    const result = await runProcess("node", ["-e", "process.stdout.write('x'.repeat(2048))"], {
      maxBufferBytes: 128,
      outputMode: "truncate",
    });

    expect(result.code).toBe(0);
    expect(result.stdout.length).toBeLessThanOrEqual(128);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(false);
  });

  it("runs sync commands through the shared spawn strategy", () => {
    const result = spawnProcessSync("node", ["-e", "process.stdout.write('ok')"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("ok");
  });

  it("spawns detached commands through the shared spawn strategy", async () => {
    await expect(
      spawnDetachedProcess(process.execPath, ["-e", "process.exit(0)"]),
    ).resolves.toBeUndefined();
  });
});
