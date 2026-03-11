# WebSocket RPC Port Plan

Incrementally migrate WebSocket request handling from `apps/server/src/wsServer.ts` switch-cases to Effect RPC routes in `apps/server/src/ws.ts` with shared contracts in `packages/contracts`.

## Porting Strategy (High Level)

1. **Contract-first**
   - Define each RPC in shared contracts (`packages/contracts`) so server and client use one schema source.
   - Keep endpoint names identical to `WS_METHODS` / orchestration method names to avoid client churn.

2. **Single endpoint slices**
   - Port one endpoint at a time into `WsRpcGroup` in `apps/server/src/ws.ts`.
   - Preserve current behavior and error semantics; avoid broad refactors in the same slice.

3. **Prove wiring with tests**
   - Add/extend integration tests in `apps/server/src/server.test.ts` (reference style: boot layer, connect WS RPC client, invoke method, assert result).
   - Prefer lightweight assertions that prove route wiring + core behavior.
     - Implementation details are often tested in each service's own tests. Server test only needs to prove high level behavior and error semantics.

4. **Keep old path as fallback until parity**
   - Leave legacy handler path in `wsServer.ts` for unmigrated methods.
   - After each endpoint is migrated and tested, remove only that endpoint branch from legacy switch.

5. **Quality gates per slice**
   - Run `bun run test` (targeted), then `bun fmt`, `bun lint`, `bun typecheck`.
   - Only proceed to next endpoint when checks are green.

## Ordered Endpoint Checklist

Legend: `[x]` done, `[ ]` not started.

### Phase 1: Server metadata (smallest surface)

- [x] `server.getConfig`
- [x] `server.upsertKeybinding`

### Phase 2: Project + editor read/write (small inputs, bounded side effects)

- [x] `projects.searchEntries`
- [x] `projects.writeFile`
- [x] `shell.openInEditor`

### Phase 3: Git operations (broader side effects)

- [x] `git.status`
- [x] `git.listBranches`
- [x] `git.pull`
- [x] `git.runStackedAction`
- [x] `git.resolvePullRequest`
- [x] `git.preparePullRequestThread`
- [x] `git.createWorktree`
- [x] `git.removeWorktree`
- [x] `git.createBranch`
- [x] `git.checkout`
- [x] `git.init`

### Phase 4: Terminal lifecycle + IO (stateful and streaming-adjacent)

- [x] `terminal.open`
- [x] `terminal.write`
- [x] `terminal.resize`
- [x] `terminal.clear`
- [x] `terminal.restart`
- [x] `terminal.close`

### Phase 5: Orchestration RPC methods (domain-critical path)

- [x] `orchestration.getSnapshot`
- [x] `orchestration.dispatchCommand`
- [x] `orchestration.getTurnDiff`
- [x] `orchestration.getFullThreadDiff`
- [x] `orchestration.replayEvents`

### Phase 6: Streaming subscriptions via RPC (replace push-channel bridge)

- [x] Define streaming RPC contracts for all server-driven event surfaces (reference pattern: `subscribeTodos`):
  - [ ] `subscribeOrchestrationDomainEvents`
  - [ ] `subscribeTerminalEvents`
  - [ ] `subscribeServerConfigUpdates`
  - [ ] `subscribeServerLifecycle` (welcome/readiness/bootstrap updates)
- [ ] Add stream payload schemas in `packages/contracts` with narrow tagged unions where needed.
  - [ ] Include explicit event versioning strategy (`version` or schema evolution note).
  - [ ] Ensure payload shape parity with existing `WS_CHANNELS` semantics.
- [ ] Implement streaming handlers in `apps/server/src/ws.ts` using `Effect.Stream`.
  - [ ] Wire each stream to the correct source service/event bus.
  - [ ] Preserve ordering guarantees where currently expected.
  - [ ] Preserve filtering/scoping rules (thread/session/worktree as applicable).
- [ ] Prove one full vertical slice first (recommended: terminal events), then fan out.
  - [ ] Contract + handler + client consumer.
  - [ ] Integration test: subscribe, receive at least one item, unsubscribe/interrupt cleanly.
- [ ] Subscription lifecycle semantics (must match or improve current behavior):
  - [ ] reconnect + resubscribe behavior
  - [ ] duplicate subscription protection on reconnect
  - [ ] cancellation/unsubscribe finalizers
  - [ ] cleanup when socket closes unexpectedly
- [ ] Reliability semantics:
  - [ ] document and enforce backpressure strategy (buffer cap, drop policy, or disconnect)
  - [ ] clarify delivery semantics (best-effort vs at-least-once) for each stream
  - [ ] add metrics/logging for dropped/failed deliveries
- [ ] Security/auth parity:
  - [ ] apply same auth gating as request/response RPC path
  - [ ] enforce per-stream permission checks
- [ ] After parity, remove legacy push-channel publish paths and old envelope code paths for migrated streams.

### Phase 7: Server startup/runtime side effects (move lifecycle out of legacy wsServer)

- [ ] Move startup orchestration from `wsServer.ts` into layer-based runtime composition.
  - [ ] keybindings startup + default sync behavior
  - [ ] orchestration reactor startup
  - [ ] terminal stream subscription lifecycle
  - [ ] orchestration stream subscription lifecycle
- [ ] Move startup UX/ops side effects:
  - [ ] open-in-browser behavior
  - [ ] startup heartbeat analytics
  - [ ] startup logs payload parity
  - [ ] optional auto-bootstrap project/thread from cwd
- [ ] Preserve readiness and failure semantics:
  - [ ] readiness gates for required subsystems
  - [ ] startup failure behavior and error messages
  - [ ] startup ordering guarantees and retry policy (if any)
- [ ] Preserve shutdown semantics:
  - [ ] finalizers/unsubscribe behavior
  - [ ] ws server close behavior
  - [ ] in-flight stream cancellation handling
- [ ] Add lifecycle-focused integration tests (startup happy path + failure path + shutdown cleanup).

### Phase 8: Client migration (full surface)

- [ ] Migrate web client transport in `apps/web/src/ws.ts` to consume RPC contracts directly.
  - [ ] Decide transport approach (custom adapter vs Effect `RpcClient`) and lock one path.
- [ ] Request/response parity migration:
  - [ ] replace legacy websocket envelope call helpers with typed RPC client calls
  - [ ] ensure domain-specific error decoding/parsing parity
- [ ] Streaming parity migration:
  - [ ] consume new streaming RPC subscriptions for all migrated channels
  - [ ] implement reconnect + resubscribe strategy
  - [ ] enforce unsubscribe on route/session teardown
- [ ] UX behavior parity:
  - [ ] loading/connected/disconnected state transitions
  - [ ] terminal/orchestration live updates timing and ordering
  - [ ] welcome/bootstrap/config update behavior
- [ ] Client tests:
  - [ ] integration coverage for request calls
  - [ ] subscription lifecycle tests (connect, receive, reconnect, teardown)

### Phase 9: Final cleanup + deprecation removal

- [ ] Delete legacy `wsServer.ts` transport path once server+client parity is proven.
- [ ] Remove old shared protocol artifacts no longer needed:
  - [ ] legacy `WS_CHANNELS` usage
  - [ ] legacy ws envelope request/response codecs where obsolete
  - [ ] dead helpers/services only used by legacy transport path
- [ ] Run parity audit checklist before deletion:
  - [ ] every old method mapped to RPC equivalent
  - [ ] every old push channel mapped to streaming RPC equivalent
  - [ ] auth/error/ordering semantics verified
- [ ] Add migration note/changelog entry for downstream consumers (if any).