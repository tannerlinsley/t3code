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
- [ ] `server.upsertKeybinding`

### Phase 2: Project + editor read/write (small inputs, bounded side effects)

- [ ] `projects.searchEntries`
- [ ] `projects.writeFile`
- [ ] `shell.openInEditor`

### Phase 3: Git operations (broader side effects)

- [ ] `git.status`
- [ ] `git.listBranches`
- [ ] `git.pull`
- [ ] `git.runStackedAction`
- [ ] `git.resolvePullRequest`
- [ ] `git.preparePullRequestThread`
- [ ] `git.createWorktree`
- [ ] `git.removeWorktree`
- [ ] `git.createBranch`
- [ ] `git.checkout`
- [ ] `git.init`

### Phase 4: Terminal lifecycle + IO (stateful and streaming-adjacent)

- [ ] `terminal.open`
- [ ] `terminal.write`
- [ ] `terminal.resize`
- [ ] `terminal.clear`
- [ ] `terminal.restart`
- [ ] `terminal.close`

### Phase 5: Orchestration RPC methods (domain-critical path)

- [ ] `orchestration.getSnapshot`
- [ ] `orchestration.dispatchCommand`
- [ ] `orchestration.getTurnDiff`
- [ ] `orchestration.getFullThreadDiff`
- [ ] `orchestration.replayEvents`

## Notes

- This plan tracks request/response RPC methods only.
- Push/event channels (`terminal.event`, `server.welcome`, `server.configUpdated`, `orchestration.domainEvent`) stay in the existing event pipeline until a dedicated push-channel migration plan is created.
