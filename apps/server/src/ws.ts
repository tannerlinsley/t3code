import { Effect, FileSystem, Layer, Path, Schema, Stream, PubSub } from "effect";
import {
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  ORCHESTRATION_WS_METHODS,
  ProjectSearchEntriesError,
  ProjectWriteFileError,
  OrchestrationReplayEventsError,
  type TerminalEvent,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { clamp } from "effect/Number";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery";
import { ServerConfig } from "./config";
import { GitCore } from "./git/Services/GitCore";
import { GitManager } from "./git/Services/GitManager";
import { Keybindings } from "./keybindings";
import { Open, resolveAvailableEditors } from "./open";
import { normalizeDispatchCommand } from "./orchestration/Normalizer";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import { ProviderHealth } from "./provider/Services/ProviderHealth";
import { TerminalManager } from "./terminal/Services/Manager";
import { resolveWorkspaceWritePath, searchWorkspaceEntries } from "./workspaceEntries";

const WsRpcLayer = WsRpcGroup.toLayer({
  [ORCHESTRATION_WS_METHODS.getSnapshot]: (_input) =>
    Effect.gen(function* () {
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
      return yield* projectionSnapshotQuery.getSnapshot();
    }).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationGetSnapshotError({
            message: "Failed to load orchestration snapshot",
            cause,
          }),
      ),
    ),
  [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
    Effect.gen(function* () {
      const orchestrationEngine = yield* OrchestrationEngineService;
      const normalizedCommand = yield* normalizeDispatchCommand(command);
      return yield* orchestrationEngine.dispatch(normalizedCommand);
    }).pipe(
      Effect.mapError((cause) =>
        Schema.is(OrchestrationDispatchCommandError)(cause)
          ? cause
          : new OrchestrationDispatchCommandError({
              message: "Failed to dispatch orchestration command",
              cause,
            }),
      ),
    ),
  [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
    Effect.gen(function* () {
      const checkpointDiffQuery = yield* CheckpointDiffQuery;
      return yield* checkpointDiffQuery.getTurnDiff(input);
    }).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationGetTurnDiffError({
            message: "Failed to load turn diff",
            cause,
          }),
      ),
    ),
  [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
    Effect.gen(function* () {
      const checkpointDiffQuery = yield* CheckpointDiffQuery;
      return yield* checkpointDiffQuery.getFullThreadDiff(input);
    }).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationGetFullThreadDiffError({
            message: "Failed to load full thread diff",
            cause,
          }),
      ),
    ),
  [ORCHESTRATION_WS_METHODS.replayEvents]: (input) =>
    Effect.gen(function* () {
      const orchestrationEngine = yield* OrchestrationEngineService;
      return yield* Stream.runCollect(
        orchestrationEngine.readEvents(
          clamp(input.fromSequenceExclusive, { maximum: Number.MAX_SAFE_INTEGER, minimum: 0 }),
        ),
      ).pipe(Effect.map((events) => Array.from(events)));
    }).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationReplayEventsError({
            message: "Failed to replay orchestration events",
            cause,
          }),
      ),
    ),
  [WS_METHODS.serverUpsertKeybinding]: (rule) =>
    Effect.gen(function* () {
      const keybindings = yield* Keybindings;
      const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
      return { keybindings: keybindingsConfig, issues: [] };
    }),
  [WS_METHODS.projectsSearchEntries]: (input) =>
    Effect.tryPromise({
      try: () => searchWorkspaceEntries(input),
      catch: (cause) =>
        new ProjectSearchEntriesError({
          message: "Failed to search workspace entries",
          cause,
        }),
    }),
  [WS_METHODS.projectsWriteFile]: (input) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const target = yield* resolveWorkspaceWritePath({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });
      yield* fileSystem.makeDirectory(path.dirname(target.absolutePath), { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new ProjectWriteFileError({
              message: "Failed to prepare workspace path",
              cause,
            }),
        ),
      );
      yield* fileSystem.writeFileString(target.absolutePath, input.contents).pipe(
        Effect.mapError(
          (cause) =>
            new ProjectWriteFileError({
              message: "Failed to write workspace file",
              cause,
            }),
        ),
      );
      return { relativePath: target.relativePath };
    }),
  [WS_METHODS.shellOpenInEditor]: (input) =>
    Effect.gen(function* () {
      const open = yield* Open;
      return yield* open.openInEditor(input);
    }),
  [WS_METHODS.gitStatus]: (input) =>
    Effect.gen(function* () {
      const gitManager = yield* GitManager;
      return yield* gitManager.status(input);
    }),
  [WS_METHODS.gitPull]: (input) =>
    Effect.gen(function* () {
      const git = yield* GitCore;
      return yield* git.pullCurrentBranch(input.cwd);
    }),
  [WS_METHODS.gitRunStackedAction]: (input) =>
    Effect.gen(function* () {
      const gitManager = yield* GitManager;
      return yield* gitManager.runStackedAction(input);
    }),
  [WS_METHODS.gitResolvePullRequest]: (input) =>
    Effect.gen(function* () {
      const gitManager = yield* GitManager;
      return yield* gitManager.resolvePullRequest(input);
    }),
  [WS_METHODS.gitPreparePullRequestThread]: (input) =>
    Effect.gen(function* () {
      const gitManager = yield* GitManager;
      return yield* gitManager.preparePullRequestThread(input);
    }),
  [WS_METHODS.gitListBranches]: (input) =>
    Effect.gen(function* () {
      const git = yield* GitCore;
      return yield* git.listBranches(input);
    }),
  [WS_METHODS.gitCreateWorktree]: (input) =>
    Effect.gen(function* () {
      const git = yield* GitCore;
      return yield* git.createWorktree(input);
    }),
  [WS_METHODS.gitRemoveWorktree]: (input) =>
    Effect.gen(function* () {
      const git = yield* GitCore;
      return yield* git.removeWorktree(input);
    }),
  [WS_METHODS.gitCreateBranch]: (input) =>
    Effect.gen(function* () {
      const git = yield* GitCore;
      return yield* git.createBranch(input);
    }),
  [WS_METHODS.gitCheckout]: (input) =>
    Effect.gen(function* () {
      const git = yield* GitCore;
      return yield* Effect.scoped(git.checkoutBranch(input));
    }),
  [WS_METHODS.gitInit]: (input) =>
    Effect.gen(function* () {
      const git = yield* GitCore;
      return yield* git.initRepo(input);
    }),
  [WS_METHODS.terminalOpen]: (input) =>
    Effect.gen(function* () {
      const terminalManager = yield* TerminalManager;
      return yield* terminalManager.open(input);
    }),
  [WS_METHODS.terminalWrite]: (input) =>
    Effect.gen(function* () {
      const terminalManager = yield* TerminalManager;
      return yield* terminalManager.write(input);
    }),
  [WS_METHODS.terminalResize]: (input) =>
    Effect.gen(function* () {
      const terminalManager = yield* TerminalManager;
      return yield* terminalManager.resize(input);
    }),
  [WS_METHODS.terminalClear]: (input) =>
    Effect.gen(function* () {
      const terminalManager = yield* TerminalManager;
      return yield* terminalManager.clear(input);
    }),
  [WS_METHODS.terminalRestart]: (input) =>
    Effect.gen(function* () {
      const terminalManager = yield* TerminalManager;
      return yield* terminalManager.restart(input);
    }),
  [WS_METHODS.terminalClose]: (input) =>
    Effect.gen(function* () {
      const terminalManager = yield* TerminalManager;
      return yield* terminalManager.close(input);
    }),
  [WS_METHODS.subscribeTerminalEvents]: (_input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const terminalManager = yield* TerminalManager;
        const pubsub = yield* PubSub.unbounded<TerminalEvent>();
        const unsubscribe = yield* terminalManager.subscribe((event) => {
          PubSub.publishUnsafe(pubsub, event);
        });
        return Stream.fromPubSub(pubsub).pipe(Stream.ensuring(Effect.sync(() => unsubscribe())));
      }),
    ),
  [WS_METHODS.subscribeServerConfig]: (_input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const keybindings = yield* Keybindings;
        const providerHealth = yield* ProviderHealth;
        const config = yield* ServerConfig;
        const keybindingsConfig = yield* keybindings.loadConfigState;
        const providers = yield* providerHealth.getStatuses;

        const keybindingsUpdates = keybindings.streamChanges.pipe(
          Stream.mapEffect((event) =>
            Effect.succeed({
              type: "keybindingsUpdated" as const,
              payload: {
                issues: event.issues,
              },
            }),
          ),
        );
        const providerStatuses = Stream.tick("10 seconds").pipe(
          Stream.mapEffect(() =>
            Effect.gen(function* () {
              const providers = yield* providerHealth.getStatuses;
              return {
                type: "providerStatuses" as const,
                payload: { providers },
              };
            }),
          ),
        );
        return Stream.concat(
          Stream.make({
            type: "snapshot" as const,
            config: {
              cwd: config.cwd,
              keybindingsConfigPath: config.keybindingsConfigPath,
              keybindings: keybindingsConfig.keybindings,
              issues: keybindingsConfig.issues,
              providers,
              availableEditors: resolveAvailableEditors(),
            },
          }),
          Stream.merge(keybindingsUpdates, providerStatuses),
        );
      }),
    ),
});

export const websocketRpcRouteLayer = RpcServer.layerHttp({
  group: WsRpcGroup,
  path: "/ws",
  protocol: "websocket",
}).pipe(Layer.provide(WsRpcLayer), Layer.provide(RpcSerialization.layerJson));
