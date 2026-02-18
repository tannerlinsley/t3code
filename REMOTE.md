# Remote T3 Architecture (PoC)

## Summary
This PoC supports running `apps/server` on a remote machine and connecting both frontend clients to it:
- Browser web app (via env or runtime URL params)
- Electron desktop app (remote mode; no local backend spawn)

## Final Architecture
```mermaid
flowchart LR
  subgraph ClientMachine[Client Machine]
    Web[Web App\n(React/Vite)]
    Desktop[Desktop App\n(Electron Renderer)]
  end

  subgraph RemoteMachine[Remote Machine]
    Server[T3 Server\n(HTTP + WS RPC)]
    Codex[Codex App Server\n(JSON-RPC over stdio)]
  end

  Web -- "wss/ws + token auth" --> Server
  Desktop -- "wss/ws + token auth" --> Server
  Server -- "stdio JSON-RPC" --> Codex
```

## Connection Modes

### 1) SSH Tunnel (recommended for operator security)
Run remote server loopback-only:
```bash
T3CODE_HOST=127.0.0.1 T3CODE_PORT=3773 T3CODE_AUTH_TOKEN=<token> bun run start
```

From client machine, forward port:
```bash
ssh -L 3773:127.0.0.1:3773 <user>@<remote-host>
```

Then connect clients to `ws://127.0.0.1:3773` with the same token.

### 2) Direct Authenticated WS
Run remote server network-bound:
```bash
T3CODE_HOST=0.0.0.0 T3CODE_PORT=3773 T3CODE_AUTH_TOKEN=<token> bun run start
```

Use TLS termination/reverse proxy in front for production internet exposure.

## Client Configuration

### Web App
Supported config sources:
- Build/dev env: `VITE_WS_URL`, optional `VITE_WS_TOKEN`
- Runtime URL params: `t3WsUrl`, `t3Token`

Examples:
```text
https://web-host/?t3WsUrl=wss://api.example.com&t3Token=secret
https://api.example.com/?t3Token=secret
```

Notes:
- If `t3WsUrl` is `http://` or `https://`, it is normalized to `ws://` or `wss://`.
- If no URL is provided, web falls back to same-origin WS using page protocol.

### Desktop App
Set remote mode env vars before launch:
- `T3CODE_REMOTE_WS_URL` (required for remote mode)
- `T3CODE_REMOTE_WS_TOKEN` (optional if URL already includes `?token=`)

Example:
```bash
T3CODE_REMOTE_WS_URL=ws://127.0.0.1:3773 T3CODE_REMOTE_WS_TOKEN=secret bun run start:desktop
```

When `T3CODE_REMOTE_WS_URL` is set, desktop skips spawning the local server process.

## Auth Behavior
Server WS auth now accepts either:
- Query token: `?token=...` (browser-compatible)
- `Authorization: Bearer <token>` header (non-browser clients)

## New/Relevant Env Vars
- Server:
  - `T3CODE_HOST`
  - `T3CODE_PORT`
  - `T3CODE_AUTH_TOKEN`
- Web:
  - `VITE_WS_URL`
  - `VITE_WS_TOKEN`
- Desktop:
  - `T3CODE_REMOTE_WS_URL`
  - `T3CODE_REMOTE_WS_TOKEN`
