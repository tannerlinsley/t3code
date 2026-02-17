import { describe, expect, it } from "vitest";

import {
  resolveBenchmarkFollowUpPassCount,
  shouldRunOptionalRendererPerfInteractions,
  shouldRunTerminalPerfInteractions,
} from "./perfConfig";

describe("shouldRunTerminalPerfInteractions", () => {
  it("defaults to enabled outside CI when env is unset", () => {
    expect(shouldRunTerminalPerfInteractions({ CI: "false" })).toBe(true);
    expect(shouldRunTerminalPerfInteractions({ CI: "0" })).toBe(true);
    expect(shouldRunTerminalPerfInteractions({ CI: "off" })).toBe(true);
    expect(shouldRunTerminalPerfInteractions({ CI: "no" })).toBe(true);
    expect(shouldRunTerminalPerfInteractions({ CI: undefined })).toBe(true);
  });

  it("defaults to disabled in CI when env is unset", () => {
    expect(shouldRunTerminalPerfInteractions({ CI: "true" })).toBe(false);
    expect(shouldRunTerminalPerfInteractions({ CI: "TRUE" })).toBe(false);
    expect(shouldRunTerminalPerfInteractions({ CI: "1" })).toBe(false);
    expect(shouldRunTerminalPerfInteractions({ CI: " yes " })).toBe(false);
    expect(shouldRunTerminalPerfInteractions({ CI: "on" })).toBe(false);
  });

  it("supports explicit true values", () => {
    expect(
      shouldRunTerminalPerfInteractions({
        T3CODE_DESKTOP_PERF_RUN_TERMINAL: "1",
        CI: "true",
      }),
    ).toBe(true);
    expect(
      shouldRunTerminalPerfInteractions({
        T3CODE_DESKTOP_PERF_RUN_TERMINAL: " true ",
        CI: "true",
      }),
    ).toBe(true);
    expect(
      shouldRunTerminalPerfInteractions({
        T3CODE_DESKTOP_PERF_RUN_TERMINAL: "TRUE",
        CI: "true",
      }),
    ).toBe(true);
    expect(
      shouldRunTerminalPerfInteractions({
        T3CODE_DESKTOP_PERF_RUN_TERMINAL: " yes ",
        CI: "true",
      }),
    ).toBe(true);
    expect(
      shouldRunTerminalPerfInteractions({
        T3CODE_DESKTOP_PERF_RUN_TERMINAL: "ON",
        CI: "true",
      }),
    ).toBe(true);
  });

  it("supports explicit false values", () => {
    expect(
      shouldRunTerminalPerfInteractions({
        T3CODE_DESKTOP_PERF_RUN_TERMINAL: "0",
        CI: "false",
      }),
    ).toBe(false);
    expect(
      shouldRunTerminalPerfInteractions({
        T3CODE_DESKTOP_PERF_RUN_TERMINAL: " false ",
        CI: "false",
      }),
    ).toBe(false);
    expect(
      shouldRunTerminalPerfInteractions({
        T3CODE_DESKTOP_PERF_RUN_TERMINAL: "FALSE",
        CI: "false",
      }),
    ).toBe(false);
    expect(
      shouldRunTerminalPerfInteractions({
        T3CODE_DESKTOP_PERF_RUN_TERMINAL: " no ",
        CI: "false",
      }),
    ).toBe(false);
    expect(
      shouldRunTerminalPerfInteractions({
        T3CODE_DESKTOP_PERF_RUN_TERMINAL: "OFF",
        CI: "false",
      }),
    ).toBe(false);
    expect(
      shouldRunTerminalPerfInteractions({
        T3CODE_DESKTOP_PERF_RUN_TERMINAL: "0",
        CI: "true",
      }),
    ).toBe(false);
  });

  it("falls back to CI-based default for unknown values", () => {
    expect(
      shouldRunTerminalPerfInteractions({
        T3CODE_DESKTOP_PERF_RUN_TERMINAL: "maybe",
        CI: "true",
      }),
    ).toBe(false);
    expect(
      shouldRunTerminalPerfInteractions({
        T3CODE_DESKTOP_PERF_RUN_TERMINAL: "maybe",
        CI: "false",
      }),
    ).toBe(true);
    expect(
      shouldRunTerminalPerfInteractions({
        T3CODE_DESKTOP_PERF_RUN_TERMINAL: "maybe",
        CI: "ON",
      }),
    ).toBe(false);
    expect(
      shouldRunTerminalPerfInteractions({
        T3CODE_DESKTOP_PERF_RUN_TERMINAL: " ",
        CI: "true",
      }),
    ).toBe(false);
    expect(
      shouldRunTerminalPerfInteractions({
        T3CODE_DESKTOP_PERF_RUN_TERMINAL: " ",
        CI: "false",
      }),
    ).toBe(true);
    expect(
      shouldRunTerminalPerfInteractions({
        T3CODE_DESKTOP_PERF_RUN_TERMINAL: "unknown",
        CI: "maybe",
      }),
    ).toBe(true);
  });
});

describe("resolveBenchmarkFollowUpPassCount", () => {
  it("defaults to 1 outside CI", () => {
    expect(resolveBenchmarkFollowUpPassCount({ CI: "false" })).toBe(1);
    expect(resolveBenchmarkFollowUpPassCount({ CI: "0" })).toBe(1);
  });

  it("defaults to 0 in CI", () => {
    expect(resolveBenchmarkFollowUpPassCount({ CI: "true" })).toBe(0);
    expect(resolveBenchmarkFollowUpPassCount({ CI: "on" })).toBe(0);
  });

  it("accepts explicit non-negative integer overrides", () => {
    expect(
      resolveBenchmarkFollowUpPassCount({
        T3CODE_DESKTOP_PERF_BENCHMARK_FOLLOW_UP_PASSES: "2",
        CI: "true",
      }),
    ).toBe(2);
    expect(
      resolveBenchmarkFollowUpPassCount({
        T3CODE_DESKTOP_PERF_BENCHMARK_FOLLOW_UP_PASSES: " 0 ",
        CI: "false",
      }),
    ).toBe(0);
  });

  it("ignores malformed overrides and falls back to CI default", () => {
    expect(
      resolveBenchmarkFollowUpPassCount({
        T3CODE_DESKTOP_PERF_BENCHMARK_FOLLOW_UP_PASSES: "1abc",
        CI: "true",
      }),
    ).toBe(0);
    expect(
      resolveBenchmarkFollowUpPassCount({
        T3CODE_DESKTOP_PERF_BENCHMARK_FOLLOW_UP_PASSES: "-1",
        CI: "false",
      }),
    ).toBe(1);
  });
});

describe("shouldRunOptionalRendererPerfInteractions", () => {
  it("defaults to enabled outside CI and disabled in CI", () => {
    expect(shouldRunOptionalRendererPerfInteractions({ CI: "false" })).toBe(true);
    expect(shouldRunOptionalRendererPerfInteractions({ CI: "true" })).toBe(false);
  });

  it("supports explicit env overrides", () => {
    expect(
      shouldRunOptionalRendererPerfInteractions({
        T3CODE_DESKTOP_PERF_RUN_OPTIONAL_RENDERER: "1",
        CI: "true",
      }),
    ).toBe(true);
    expect(
      shouldRunOptionalRendererPerfInteractions({
        T3CODE_DESKTOP_PERF_RUN_OPTIONAL_RENDERER: "off",
        CI: "false",
      }),
    ).toBe(false);
  });
});
