#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startRuntimeApiServer } from "./runtimeApiServer";

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function openBrowser(url: string): void {
  if (process.env.T3_NO_OPEN === "1") {
    return;
  }

  const command =
    process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => {
    // Best-effort browser launch; keep runtime alive even when opener is unavailable.
  });
  child.unref();
}

function ensureRendererBuild(rendererRoot: string): void {
  const distPath = path.join(rendererRoot, "dist", "index.html");
  if (fs.existsSync(distPath)) {
    return;
  }

  const bunPath = process.env.BUN_BIN ?? "bun";
  const build = spawnSync(bunPath, ["run", "--cwd", rendererRoot, "build"], {
    stdio: "inherit",
    env: {
      ...process.env,
      PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
    },
  });
  if (build.status !== 0) {
    throw new Error("Failed to build renderer assets.");
  }
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".woff2")) return "font/woff2";
  if (filePath.endsWith(".woff")) return "font/woff";
  return "application/octet-stream";
}

function startStaticWebServer(distRoot: string, port: number) {
  const server = createServer((request, response) => {
    const requestPath = request.url ? request.url.split("?")[0] : "/";
    const normalized =
      requestPath === "/" ? "index.html" : (requestPath ?? "/").replace(/^\/+/, "");
    const safePath = path.normalize(normalized).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(distRoot, safePath);

    if (!filePath.startsWith(distRoot)) {
      response.statusCode = 403;
      response.end("Forbidden");
      return;
    }

    const exists = fs.existsSync(filePath);
    const targetPath = exists ? filePath : path.join(distRoot, "index.html");
    fs.readFile(targetPath, (error, content) => {
      if (error) {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }

      response.statusCode = 200;
      response.setHeader("Content-Type", contentTypeFor(targetPath));
      response.end(content);
    });
  });

  return new Promise<{
    close: () => Promise<void>;
  }>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({
        close: async () => {
          await new Promise<void>((closeResolve) => {
            server.close(() => closeResolve());
          });
        },
      });
    });
  });
}

async function main() {
  const backendPort = parsePort(process.env.T3_BACKEND_PORT, 4317);
  const webPort = parsePort(process.env.T3_WEB_PORT, 4318);
  const launchCwd = process.cwd();

  const runtimeServer = await startRuntimeApiServer({
    port: backendPort,
    launchCwd,
  });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rendererRoot = path.resolve(__dirname, "../../renderer");
  ensureRendererBuild(rendererRoot);
  const staticServer = await startStaticWebServer(path.join(rendererRoot, "dist"), webPort);

  const wsParam = encodeURIComponent(runtimeServer.wsUrl);
  const appUrl = `http://127.0.0.1:${webPort}?ws=${wsParam}`;
  openBrowser(appUrl);

  process.stdout.write(`CodeThing is running at ${appUrl}\n`);

  const shutdown = async () => {
    await Promise.all([staticServer.close(), runtimeServer.close()]);
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void main();
