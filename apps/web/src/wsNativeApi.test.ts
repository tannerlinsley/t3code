import {
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  type DesktopBridge,
  EventId,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  type OrchestrationEvent,
  type ServerConfig,
  type ServerConfigStreamEvent,
  type ServerLifecycleStreamEvent,
  type ServerProvider,
  ThreadId,
  WS_METHODS,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContextMenuItem } from "@t3tools/contracts";

const requestMock = vi.fn<(...args: Array<unknown>) => Promise<unknown>>();
const showContextMenuFallbackMock =
  vi.fn<
    <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>
  >();
const streamListeners = new Map<string, Set<(event: unknown) => void>>();
const subscribeMock = vi.fn<
  (method: string, params: unknown, listener: (event: unknown) => void) => () => void
>((method, _params, listener) => {
  const listeners = streamListeners.get(method) ?? new Set<(event: unknown) => void>();
  listeners.add(listener);
  streamListeners.set(method, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      streamListeners.delete(method);
    }
  };
});

vi.mock("./wsTransport", () => {
  return {
    WsTransport: class MockWsTransport {
      request = requestMock;
      subscribe = subscribeMock;
      dispose() {}
    },
  };
});

vi.mock("./contextMenuFallback", () => ({
  showContextMenuFallback: showContextMenuFallbackMock,
}));

function emitStreamEvent(method: string, event: unknown) {
  const listeners = streamListeners.get(method);
  if (!listeners) {
    return;
  }
  for (const listener of listeners) {
    listener(event);
  }
}

function emitLifecycleEvent(event: ServerLifecycleStreamEvent) {
  emitStreamEvent(WS_METHODS.subscribeServerLifecycle, event);
}

function emitServerConfigEvent(event: ServerConfigStreamEvent) {
  emitStreamEvent(WS_METHODS.subscribeServerConfig, event);
}

function getWindowForTest(): Window & typeof globalThis & { desktopBridge?: unknown } {
  const testGlobal = globalThis as typeof globalThis & {
    window?: Window & typeof globalThis & { desktopBridge?: unknown };
  };
  if (!testGlobal.window) {
    testGlobal.window = {} as Window & typeof globalThis & { desktopBridge?: unknown };
  }
  return testGlobal.window;
}

function makeDesktopBridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    getWsUrl: () => null,
    pickFolder: async () => null,
    confirm: async () => true,
    setTheme: async () => undefined,
    showContextMenu: async () => null,
    openExternal: async () => true,
    onMenuAction: () => () => undefined,
    getUpdateState: async () => {
      throw new Error("getUpdateState not implemented in test");
    },
    downloadUpdate: async () => {
      throw new Error("downloadUpdate not implemented in test");
    },
    installUpdate: async () => {
      throw new Error("installUpdate not implemented in test");
    },
    onUpdateState: () => () => undefined,
    ...overrides,
  };
}

const defaultProviders: ReadonlyArray<ServerProvider> = [
  {
    provider: "codex",
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    authStatus: "authenticated",
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [],
  },
];

const baseServerConfig: ServerConfig = {
  cwd: "/tmp/workspace",
  keybindingsConfigPath: "/tmp/workspace/.config/keybindings.json",
  keybindings: [],
  issues: [],
  providers: defaultProviders,
  availableEditors: ["cursor"],
  settings: DEFAULT_SERVER_SETTINGS,
};

beforeEach(() => {
  vi.resetModules();
  requestMock.mockReset();
  showContextMenuFallbackMock.mockReset();
  subscribeMock.mockClear();
  streamListeners.clear();
  Reflect.deleteProperty(getWindowForTest(), "desktopBridge");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wsNativeApi", () => {
  it("delivers and caches welcome lifecycle events", async () => {
    const { createWsNativeApi, onServerWelcome } = await import("./wsNativeApi");

    createWsNativeApi();
    const listener = vi.fn();
    onServerWelcome(listener);

    emitLifecycleEvent({
      version: 1,
      sequence: 1,
      type: "welcome",
      payload: { cwd: "/tmp/workspace", projectName: "t3-code" },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      cwd: "/tmp/workspace",
      projectName: "t3-code",
    });

    const lateListener = vi.fn();
    onServerWelcome(lateListener);

    expect(lateListener).toHaveBeenCalledTimes(1);
    expect(lateListener).toHaveBeenCalledWith({
      cwd: "/tmp/workspace",
      projectName: "t3-code",
    });
  });

  it("preserves bootstrap ids from welcome lifecycle events", async () => {
    const { createWsNativeApi, onServerWelcome } = await import("./wsNativeApi");

    createWsNativeApi();
    const listener = vi.fn();
    onServerWelcome(listener);

    emitLifecycleEvent({
      version: 1,
      sequence: 1,
      type: "welcome",
      payload: {
        cwd: "/tmp/workspace",
        projectName: "t3-code",
        bootstrapProjectId: ProjectId.makeUnsafe("project-1"),
        bootstrapThreadId: ThreadId.makeUnsafe("thread-1"),
      },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/workspace",
        projectName: "t3-code",
        bootstrapProjectId: "project-1",
        bootstrapThreadId: "thread-1",
      }),
    );
  });

  it("delivers and caches current server config from the config stream snapshot", async () => {
    const { createWsNativeApi, onServerConfigUpdated } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    const listener = vi.fn();
    onServerConfigUpdated(listener);

    emitServerConfigEvent({
      version: 1,
      type: "snapshot",
      config: baseServerConfig,
    });

    await expect(api.server.getConfig()).resolves.toEqual(baseServerConfig);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      {
        issues: [],
        providers: defaultProviders,
        settings: DEFAULT_SERVER_SETTINGS,
      },
      "snapshot",
    );
  });

  it("falls back to server.getConfig before the stream cache is populated", async () => {
    requestMock.mockResolvedValueOnce(baseServerConfig);
    const { createWsNativeApi, onServerConfigUpdated } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    const listener = vi.fn();
    onServerConfigUpdated(listener);

    await expect(api.server.getConfig()).resolves.toEqual(baseServerConfig);
    expect(requestMock).toHaveBeenCalledWith(WS_METHODS.serverGetConfig, {});
    expect(listener).toHaveBeenCalledWith(
      {
        issues: [],
        providers: defaultProviders,
        settings: DEFAULT_SERVER_SETTINGS,
      },
      "snapshot",
    );
  });

  it("merges config stream updates into the cached server config", async () => {
    const { createWsNativeApi, onServerConfigUpdated, onServerProvidersUpdated } =
      await import("./wsNativeApi");

    const api = createWsNativeApi();
    const configListener = vi.fn();
    const providersListener = vi.fn();
    onServerConfigUpdated(configListener);
    onServerProvidersUpdated(providersListener);

    emitServerConfigEvent({
      version: 1,
      type: "snapshot",
      config: baseServerConfig,
    });
    emitServerConfigEvent({
      version: 1,
      type: "keybindingsUpdated",
      payload: {
        issues: [{ kind: "keybindings.malformed-config", message: "bad json" }],
      },
    });

    const nextProviders: ReadonlyArray<ServerProvider> = [
      {
        ...defaultProviders[0]!,
        status: "warning",
        checkedAt: "2026-01-02T00:00:00.000Z",
        message: "rate limited",
      },
    ];
    emitServerConfigEvent({
      version: 1,
      type: "providerStatuses",
      payload: {
        providers: nextProviders,
      },
    });
    emitServerConfigEvent({
      version: 1,
      type: "settingsUpdated",
      payload: {
        settings: {
          ...DEFAULT_SERVER_SETTINGS,
          enableAssistantStreaming: true,
        },
      },
    });

    await expect(api.server.getConfig()).resolves.toEqual({
      ...baseServerConfig,
      issues: [{ kind: "keybindings.malformed-config", message: "bad json" }],
      providers: nextProviders,
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        enableAssistantStreaming: true,
      },
    });
    expect(configListener).toHaveBeenNthCalledWith(
      1,
      {
        issues: [],
        providers: defaultProviders,
        settings: DEFAULT_SERVER_SETTINGS,
      },
      "snapshot",
    );
    expect(configListener).toHaveBeenNthCalledWith(
      2,
      {
        issues: [{ kind: "keybindings.malformed-config", message: "bad json" }],
        providers: defaultProviders,
        settings: DEFAULT_SERVER_SETTINGS,
      },
      "keybindingsUpdated",
    );
    expect(configListener).toHaveBeenNthCalledWith(
      3,
      {
        issues: [{ kind: "keybindings.malformed-config", message: "bad json" }],
        providers: nextProviders,
        settings: DEFAULT_SERVER_SETTINGS,
      },
      "providerStatuses",
    );
    expect(configListener).toHaveBeenLastCalledWith(
      {
        issues: [{ kind: "keybindings.malformed-config", message: "bad json" }],
        providers: nextProviders,
        settings: {
          ...DEFAULT_SERVER_SETTINGS,
          enableAssistantStreaming: true,
        },
      },
      "settingsUpdated",
    );
    expect(providersListener).toHaveBeenLastCalledWith({ providers: nextProviders });
  });

  it("forwards terminal, orchestration, and git progress stream events", async () => {
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    const onTerminalEvent = vi.fn();
    const onDomainEvent = vi.fn();
    const onActionProgress = vi.fn();

    api.terminal.onEvent(onTerminalEvent);
    api.orchestration.onDomainEvent(onDomainEvent);
    api.git.onActionProgress(onActionProgress);

    const terminalEvent = {
      threadId: "thread-1",
      terminalId: "terminal-1",
      createdAt: "2026-02-24T00:00:00.000Z",
      type: "output",
      data: "hello",
    } as const;
    emitStreamEvent(WS_METHODS.subscribeTerminalEvents, terminalEvent);

    const orchestrationEvent = {
      sequence: 1,
      eventId: EventId.makeUnsafe("event-1"),
      aggregateKind: "project",
      aggregateId: ProjectId.makeUnsafe("project-1"),
      occurredAt: "2026-02-24T00:00:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/workspace",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        scripts: [],
        createdAt: "2026-02-24T00:00:00.000Z",
        updatedAt: "2026-02-24T00:00:00.000Z",
      },
    } satisfies Extract<OrchestrationEvent, { type: "project.created" }>;
    emitStreamEvent(WS_METHODS.subscribeOrchestrationDomainEvents, orchestrationEvent);

    const progressEvent = {
      actionId: "action-1",
      cwd: "/repo",
      action: "commit",
      kind: "phase_started",
      phase: "commit",
      label: "Committing...",
    } as const;
    emitStreamEvent(WS_METHODS.subscribeGitActionProgress, progressEvent);

    expect(onTerminalEvent).toHaveBeenCalledWith(terminalEvent);
    expect(onDomainEvent).toHaveBeenCalledWith(orchestrationEvent);
    expect(onActionProgress).toHaveBeenCalledWith(progressEvent);
  });

  it("sends orchestration dispatch commands as the direct RPC payload", async () => {
    requestMock.mockResolvedValue({ sequence: 1 });
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    const command = {
      type: "project.create",
      commandId: CommandId.makeUnsafe("cmd-1"),
      projectId: ProjectId.makeUnsafe("project-1"),
      title: "Project",
      workspaceRoot: "/tmp/project",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      createdAt: "2026-02-24T00:00:00.000Z",
    } as const;
    await api.orchestration.dispatchCommand(command);

    expect(requestMock).toHaveBeenCalledWith(ORCHESTRATION_WS_METHODS.dispatchCommand, command);
  });

  it("forwards workspace file writes to the project RPC", async () => {
    requestMock.mockResolvedValue({ relativePath: "plan.md" });
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    await api.projects.writeFile({
      cwd: "/tmp/project",
      relativePath: "plan.md",
      contents: "# Plan\n",
    });

    expect(requestMock).toHaveBeenCalledWith(WS_METHODS.projectsWriteFile, {
      cwd: "/tmp/project",
      relativePath: "plan.md",
      contents: "# Plan\n",
    });
  });

  it("uses no client timeout for git.runStackedAction", async () => {
    requestMock.mockResolvedValue({
      action: "commit",
      branch: { status: "skipped_not_requested" },
      commit: { status: "created", commitSha: "abc1234", subject: "Test" },
      push: { status: "skipped_not_requested" },
      pr: { status: "skipped_not_requested" },
    });
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    await api.git.runStackedAction({
      actionId: "action-1",
      cwd: "/repo",
      action: "commit",
    });

    expect(requestMock).toHaveBeenCalledWith(
      WS_METHODS.gitRunStackedAction,
      {
        actionId: "action-1",
        cwd: "/repo",
        action: "commit",
      },
      { timeoutMs: null },
    );
  });

  it("forwards full-thread diff requests to the orchestration RPC", async () => {
    requestMock.mockResolvedValue({ diff: "patch" });
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    await api.orchestration.getFullThreadDiff({
      threadId: ThreadId.makeUnsafe("thread-1"),
      toTurnCount: 1,
    });

    expect(requestMock).toHaveBeenCalledWith(ORCHESTRATION_WS_METHODS.getFullThreadDiff, {
      threadId: "thread-1",
      toTurnCount: 1,
    });
  });

  it("refreshes providers and updates cached listeners", async () => {
    const nextProviders: ReadonlyArray<ServerProvider> = [
      {
        ...defaultProviders[0]!,
        checkedAt: "2026-01-03T00:00:00.000Z",
      },
    ];
    requestMock.mockResolvedValue({ providers: nextProviders });
    const { createWsNativeApi, onServerProvidersUpdated } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    emitServerConfigEvent({
      version: 1,
      type: "snapshot",
      config: baseServerConfig,
    });

    const listener = vi.fn();
    onServerProvidersUpdated(listener);

    await expect(api.server.refreshProviders()).resolves.toEqual({ providers: nextProviders });
    expect(requestMock).toHaveBeenCalledWith(WS_METHODS.serverRefreshProviders, {});
    expect(listener).toHaveBeenLastCalledWith({ providers: nextProviders });
    await expect(api.server.getConfig()).resolves.toEqual({
      ...baseServerConfig,
      providers: nextProviders,
    });
  });

  it("updates cached config when server settings are changed", async () => {
    const nextSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      enableAssistantStreaming: true,
    };
    requestMock.mockResolvedValue(nextSettings);
    const { createWsNativeApi, onServerConfigUpdated } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    emitServerConfigEvent({
      version: 1,
      type: "snapshot",
      config: baseServerConfig,
    });

    const listener = vi.fn();
    onServerConfigUpdated(listener);

    await expect(api.server.updateSettings({ enableAssistantStreaming: true })).resolves.toEqual(
      nextSettings,
    );
    expect(requestMock).toHaveBeenCalledWith(WS_METHODS.serverUpdateSettings, {
      patch: { enableAssistantStreaming: true },
    });
    await expect(api.server.getConfig()).resolves.toEqual({
      ...baseServerConfig,
      settings: nextSettings,
    });
    expect(listener).toHaveBeenLastCalledWith(
      {
        issues: [],
        providers: defaultProviders,
        settings: nextSettings,
      },
      "settingsUpdated",
    );
  });

  it("forwards context menu metadata to the desktop bridge", async () => {
    const showContextMenu = vi.fn().mockResolvedValue("delete");
    getWindowForTest().desktopBridge = makeDesktopBridge({ showContextMenu });

    const { createWsNativeApi } = await import("./wsNativeApi");
    const api = createWsNativeApi();
    const items = [{ id: "delete", label: "Delete" }] as const;

    await expect(api.contextMenu.show(items)).resolves.toBe("delete");
    expect(showContextMenu).toHaveBeenCalledWith(items, undefined);
  });

  it("falls back to the browser context menu helper when the desktop bridge is missing", async () => {
    showContextMenuFallbackMock.mockResolvedValue("rename");
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    const items = [{ id: "rename", label: "Rename" }] as const;

    await expect(api.contextMenu.show(items, { x: 4, y: 5 })).resolves.toBe("rename");
    expect(showContextMenuFallbackMock).toHaveBeenCalledWith(items, { x: 4, y: 5 });
  });
});
