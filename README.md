# CodeThing (`t3`: Node + WebSocket + Browser)

CodeThing now runs as a local Node.js runtime that serves a browser UI and exposes a local WebSocket API.

Current implementation is:

1. Codex-first: connects to `codex app-server` and streams turn/item events.
2. Provider-ready: renderer speaks a provider abstraction so Claude Code can plug in later.
3. Typed end-to-end: contracts validate payloads across the WebSocket boundary.

## Quickstart

```bash
npx t3
```

On launch, `t3`:

1. starts a local WebSocket runtime (`127.0.0.1`),
2. serves the web UI in your browser,
3. auto-connects to your current working directory as the default project.

Optional environment variables:

- `T3_NO_OPEN=1` — start runtime without auto-opening a browser window.
- `T3_BACKEND_PORT` — override local WebSocket runtime port (default `4317`).
- `T3_WEB_PORT` — override local web UI port (default `4318`).

## Workspace layout

- `/apps/t3`: CLI launcher + local WebSocket runtime server.
- `/apps/desktop`: Runtime internals used by `t3` (no Electron app shell).
- `/apps/renderer`: React + Vite UI for session control, conversation, and protocol event stream.
- `/packages/contracts`: shared Zod schemas + TypeScript types for WS protocol, provider events, and API contracts.

## Codex prerequisites

- Install Codex CLI so `codex` is on your PATH.
- Authenticate Codex before running CodeThing (for example via API key or ChatGPT auth supported by Codex).
- CodeThing starts the server via `codex app-server` per session.

## Runtime boundary model

- `t3` starts a localhost-only WebSocket server.
- Browser renderer talks through a typed `NativeApi` adapter over that WebSocket.
- Runtime validates request payloads with shared Zod contracts.
- Codex execution sandbox policy (`read-only`, `workspace-write`, `danger-full-access`) is still selected per session startup options.

## Runtime modes

CodeThing has a global runtime mode switch in the sidebar:

- `Full access` (default): starts new sessions with `approvalPolicy: never` and `sandboxMode: danger-full-access`.
- `Approval required`: starts new sessions with `approvalPolicy: on-request` and `sandboxMode: workspace-write`, then prompts in-app for command/file approvals.

Mode changes apply across all threads. Existing live sessions are restarted so old and new threads use the selected mode.

## Scripts

- `bun run dev`: builds contracts, starts `t3` runtime, opens browser UI.
- `bun run build`: builds contracts, renderer static assets, and `t3` CLI bundle.
- `bun run typecheck`: strict TypeScript checks for all packages.
- `bun run test`: runs workspace tests.
- `bun run --cwd apps/t3 dev`: run the CLI directly in dev mode.

## Provider architecture

The renderer depends on `nativeApi.providers.*`:

1. `startSession`
2. `sendTurn`
3. `interruptTurn`
4. `respondToRequest`
5. `stopSession`
6. `listSessions`
7. `onEvent`

Codex is the only implemented provider right now. `claudeCode` is reserved in contracts/UI but returns a not-implemented error in main-process dispatch.
