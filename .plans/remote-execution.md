# Plan: Remote Execution for T3 Server + Web/Desktop Frontends

## Goal
Enable a remote `t3` backend to run on another machine while both frontend clients (browser web app and Electron desktop app) connect to it reliably.

## Constraints From Current Codebase
- Transport is a single WebSocket RPC channel plus push events.
- Desktop currently assumes local backend process ownership.
- Browser clients cannot set arbitrary WebSocket headers.
- Existing auth support was token-in-query only (`?token=...`).

## Core Design Choices Explored

### 1) Network Topology
Option A: SSH tunnel to remote loopback (`ssh -L`)  
- Pros: no public WS exposure, strong default security model.  
- Cons: requires SSH session lifecycle and tunnel setup per user/session.

Option B: Direct authenticated WebSocket endpoint (typically behind TLS/reverse proxy)  
- Pros: simplest UX for multi-client access, no tunnel required.  
- Cons: needs auth hardening and TLS termination in deployment.

Decision: Support both operationally, but implement direct authenticated WS as the primary PoC path, with SSH as a first-class secure deployment mode.

### 2) WS Authentication Mechanism
Option A: Query token (`wss://.../?token=...`)  
- Pros: works in browser and Electron renderer immediately.  
- Cons: token can leak via logs/history if mishandled.

Option B: `Authorization: Bearer ...` header  
- Pros: cleaner for non-browser clients and service integrations.  
- Cons: not settable by normal browser WebSocket API.

Option C: mTLS-only  
- Pros: strongest transport auth.  
- Cons: high setup complexity for a PoC.

Decision: Keep query token as browser-compatible baseline, add bearer-header support on server for non-browser clients.

### 3) Frontend Remote Endpoint Configuration
Option A: Build-time env only (`VITE_WS_URL`)  
- Pros: simple in CI/deploy pipelines.  
- Cons: rigid for ad-hoc remote switching.

Option B: Runtime URL params (e.g. `?t3WsUrl=...&t3Token=...`)  
- Pros: no rebuild needed; easy operator workflow for PoC.  
- Cons: requires token hygiene.

Option C: In-app settings UI  
- Pros: best UX long-term.  
- Cons: more product and persistence work.

Decision: Implement A + B (env + runtime URL params) for web app PoC.

### 4) Desktop Backend Ownership Model
Option A: Always spawn local backend (current)  
- Pros: existing stable behavior.  
- Cons: cannot target remote backend.

Option B: Configurable remote mode (skip local spawn; renderer connects remote WS)  
- Pros: minimal invasive change; preserves existing desktop UX shell.  
- Cons: some desktop-only assumptions may need future guardrails.

Decision: Implement B via env (`T3CODE_REMOTE_WS_URL`, optional `T3CODE_REMOTE_WS_TOKEN`).

### 5) Server Bind Strategy
Option A: hardcoded mode-based bind (current desktop loopback / web default)  
- Pros: simple.  
- Cons: remote deployment lacks explicit operator control.

Option B: explicit `T3CODE_HOST` override  
- Pros: supports secure loopback-for-SSH and public bind use cases.

Decision: Implement B.

## Implemented PoC Changes
- `apps/server/src/index.ts`
  - Added `T3CODE_HOST` support for explicit bind control.
- `apps/server/src/wsServer.ts`
  - WS auth now accepts bearer token from `Authorization` header in addition to `?token=`.
- `apps/server/src/wsServer.test.ts`
  - Added test coverage for bearer auth header path.
- `apps/web/src/wsTransport.ts`
  - Added runtime remote config via URL params: `t3WsUrl`, `t3Token`.
  - Added protocol normalization (`http(s)` -> `ws(s)`) and token attachment logic.
  - Default same-origin fallback now respects page protocol (`wss` on https).
- `apps/web/vite.config.ts`
  - Added `VITE_WS_TOKEN` injection for build/dev env usage.
- `apps/desktop/src/main.ts`
  - Added remote backend mode (`T3CODE_REMOTE_WS_URL`, `T3CODE_REMOTE_WS_TOKEN`) that skips local backend spawn.

## Chosen Architecture (for this PoC)
- Remote `t3` server is the single source of truth and execution node.
- Web and desktop renderers are pure clients over authenticated WebSocket.
- Deployment can be:
  - SSH tunnel + loopback bind (`T3CODE_HOST=127.0.0.1`), or
  - direct authenticated WS endpoint (prefer TLS/reverse proxy).

## Follow-ups After PoC
- Move token auth from query param to short-lived session token bootstrap for browser UX/security.
- Add explicit origin allowlist + rate limiting for internet-exposed deployments.
- Add in-app connection settings UI for runtime endpoint switching.
- Add reconnect telemetry and health/status endpoint for remote ops.
