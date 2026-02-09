import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { WebSocketServer, type WebSocket } from "ws";

import {
  EDITORS,
  DEFAULT_MODEL,
  type AppBootstrapResult,
  type ProviderSession,
  type WsClientMessage,
  type WsResponseMessage,
  WS_EVENT_CHANNELS,
  agentConfigSchema,
  agentSessionIdSchema,
  newTodoInputSchema,
  todoIdSchema,
  providerInterruptTurnInputSchema,
  providerRespondToRequestInputSchema,
  providerSendTurnInputSchema,
  providerSessionStartInputSchema,
  providerStopSessionInputSchema,
  terminalCommandInputSchema,
  wsClientMessageSchema,
} from "@acme/contracts";
import * as processManagerModule from "../../desktop/src/processManager";
import * as providerManagerModule from "../../desktop/src/providerManager";
import * as todoStoreModule from "../../desktop/src/todoStore";

function resolveModuleExport<TValue>(
  moduleRecord: Record<string, unknown>,
  namedExport: string,
): TValue {
  const named = moduleRecord[namedExport];
  if (named) {
    return named as TValue;
  }

  const defaultExport = moduleRecord.default;
  if (defaultExport && typeof defaultExport === "object") {
    const nestedNamed = (defaultExport as Record<string, unknown>)[namedExport];
    if (nestedNamed) {
      return nestedNamed as TValue;
    }
  }

  if (defaultExport) {
    return defaultExport as TValue;
  }

  throw new Error(`Could not resolve export '${namedExport}' from module.`);
}

const ProcessManager = resolveModuleExport<typeof processManagerModule.ProcessManager>(
  processManagerModule as Record<string, unknown>,
  "ProcessManager",
);
const ProviderManager = resolveModuleExport<typeof providerManagerModule.ProviderManager>(
  providerManagerModule as Record<string, unknown>,
  "ProviderManager",
);
const TodoStore = resolveModuleExport<typeof todoStoreModule.TodoStore>(
  todoStoreModule as Record<string, unknown>,
  "TodoStore",
);

const agentWriteInputSchema = z.object({
  sessionId: z.string().min(1),
  data: z.string(),
});

interface RuntimeApiServerOptions {
  port: number;
  launchCwd: string;
}

interface RuntimeApiServer {
  wsUrl: string;
  close: () => Promise<void>;
}

interface JsonRpcErrorResult {
  code: string;
  message: string;
}

function responseSuccess(id: string, result: unknown): WsResponseMessage {
  return {
    type: "response",
    id,
    ok: true,
    result,
  };
}

function responseError(id: string, error: JsonRpcErrorResult): WsResponseMessage {
  return {
    type: "response",
    id,
    ok: false,
    error,
  };
}

function sendMessage(socket: WebSocket, message: unknown): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(message));
}

function openPathInFileManager(targetPath: string): void {
  const command =
    process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";

  const child = spawn(command, [targetPath], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => {
    // Best-effort shell handoff.
  });
  child.unref();
}

async function tryCommand(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "ignore"],
    });

    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.on("error", () => {
      resolve(null);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }

      const trimmed = output.trim();
      resolve(trimmed.length > 0 ? trimmed : null);
    });
  });
}

async function pickFolder(): Promise<string | null> {
  if (process.platform === "darwin") {
    const script =
      'try\nset selectedFolder to POSIX path of (choose folder with prompt "Choose a project folder")\nreturn selectedFolder\non error\nreturn ""\nend try';
    const result = await tryCommand("osascript", ["-e", script]);
    return result && result.length > 0 ? result : null;
  }

  if (process.platform === "win32") {
    const powershellScript = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      '$dialog.Description = "Choose a project folder"',
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  Write-Output $dialog.SelectedPath",
      "}",
    ].join("; ");
    const result = await tryCommand("powershell", ["-NoProfile", "-Command", powershellScript]);
    return result && result.length > 0 ? result : null;
  }

  const zenity = await tryCommand("zenity", ["--file-selection", "--directory"]);
  if (zenity) {
    return zenity;
  }

  const kdialog = await tryCommand("kdialog", ["--getexistingdirectory"]);
  if (kdialog) {
    return kdialog;
  }

  return null;
}

async function runTerminalCommand(parsed: z.infer<typeof terminalCommandInputSchema>) {
  const shellPath =
    process.platform === "win32"
      ? (process.env.ComSpec ?? "cmd.exe")
      : (process.env.SHELL ?? "/bin/sh");
  const args =
    process.platform === "win32" ? ["/d", "/s", "/c", parsed.command] : ["-lc", parsed.command];

  return new Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
    signal: string | null;
    timedOut: boolean;
  }>((resolve, reject) => {
    const child = spawn(shellPath, args, {
      cwd: parsed.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 1_000).unref();
    }, parsed.timeoutMs ?? 30_000);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({
        stdout,
        stderr,
        code: code ?? null,
        signal: signal ?? null,
        timedOut,
      });
    });
  });
}

export async function startRuntimeApiServer(
  options: RuntimeApiServerOptions,
): Promise<RuntimeApiServer> {
  const launchCwd = path.resolve(options.launchCwd);
  const providerManager = new ProviderManager();
  const processManager = new ProcessManager();
  const todoStore = new TodoStore(path.join(os.homedir(), ".t3", "todos.json"));
  await todoStore.init();

  let activeClient: WebSocket | null = null;

  const emitEvent = (channel: string, payload: unknown) => {
    if (!activeClient) {
      return;
    }

    sendMessage(activeClient, {
      type: "event",
      channel,
      payload,
    });
  };

  processManager.on("output", (chunk) => {
    emitEvent(WS_EVENT_CHANNELS.agentOutput, chunk);
  });
  processManager.on("exit", (payload) => {
    emitEvent(WS_EVENT_CHANNELS.agentExit, payload);
  });
  providerManager.on("event", (payload) => {
    emitEvent(WS_EVENT_CHANNELS.providerEvent, payload);
  });

  const createBootstrapErrorSession = (message: string): ProviderSession => {
    const timestamp = new Date().toISOString();
    return {
      sessionId: `bootstrap-error-${Date.now()}`,
      provider: "codex",
      status: "error",
      cwd: launchCwd,
      model: DEFAULT_MODEL,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastError: message,
    };
  };

  const ensureLaunchSession = async () => {
    const existingSession = providerManager
      .listSessions()
      .find((session) => session.cwd === launchCwd && session.status !== "closed");
    if (existingSession) {
      return {
        session: existingSession,
        bootstrapError: undefined,
      };
    }

    try {
      const startedSession = await providerManager.startSession({
        provider: "codex",
        cwd: launchCwd,
        model: DEFAULT_MODEL,
        approvalPolicy: "never",
        sandboxMode: "danger-full-access",
      });
      return {
        session: startedSession,
        bootstrapError: undefined,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to initialize Codex launch session.";
      return {
        session: createBootstrapErrorSession(message),
        bootstrapError: message,
      };
    }
  };

  const wss = new WebSocketServer({
    host: "127.0.0.1",
    port: options.port,
  });

  const resolveMethod = async (method: string, params: unknown) => {
    if (method === "app.bootstrap") {
      const bootstrap = await ensureLaunchSession();
      const payload: AppBootstrapResult = {
        launchCwd,
        projectName: path.basename(launchCwd) || launchCwd,
        provider: "codex",
        model: bootstrap.session.model ?? DEFAULT_MODEL,
        session: bootstrap.session,
        ...(bootstrap.bootstrapError
          ? { bootstrapError: bootstrap.bootstrapError }
          : {}),
      };
      return payload;
    }

    if (method === "todos.list") return todoStore.list();
    if (method === "todos.add") return todoStore.add(newTodoInputSchema.parse(params));
    if (method === "todos.toggle") return todoStore.toggle(todoIdSchema.parse(params));
    if (method === "todos.remove") return todoStore.remove(todoIdSchema.parse(params));

    if (method === "dialogs.pickFolder") return pickFolder();
    if (method === "terminal.run") {
      return runTerminalCommand(terminalCommandInputSchema.parse(params));
    }

    if (method === "agent.spawn") return processManager.spawn(agentConfigSchema.parse(params));
    if (method === "agent.kill") {
      processManager.kill(agentSessionIdSchema.parse(params));
      return null;
    }
    if (method === "agent.write") {
      const parsed = agentWriteInputSchema.parse(params);
      processManager.write(parsed.sessionId, parsed.data);
      return null;
    }

    if (method === "providers.startSession") {
      return providerManager.startSession(providerSessionStartInputSchema.parse(params));
    }
    if (method === "providers.sendTurn") {
      return providerManager.sendTurn(providerSendTurnInputSchema.parse(params));
    }
    if (method === "providers.interruptTurn") {
      await providerManager.interruptTurn(providerInterruptTurnInputSchema.parse(params));
      return null;
    }
    if (method === "providers.respondToRequest") {
      await providerManager.respondToRequest(providerRespondToRequestInputSchema.parse(params));
      return null;
    }
    if (method === "providers.stopSession") {
      providerManager.stopSession(providerStopSessionInputSchema.parse(params));
      return null;
    }
    if (method === "providers.listSessions") return providerManager.listSessions();

    if (method === "shell.openInEditor") {
      const schema = z.object({
        cwd: z.string().min(1),
        editor: z.enum(EDITORS.map((entry) => entry.id) as [string, ...string[]]),
      });
      const parsed = schema.parse(params);
      const editor = EDITORS.find((entry) => entry.id === parsed.editor);
      if (!editor) {
        throw new Error(`Unknown editor: ${parsed.editor}`);
      }

      if (!editor.command) {
        openPathInFileManager(parsed.cwd);
        return null;
      }

      const child = spawn(editor.command, [parsed.cwd], {
        detached: true,
        stdio: "ignore",
      });
      child.on("error", () => {
        // Best-effort editor launch.
      });
      child.unref();
      return null;
    }

    throw new Error(`Unknown API method: ${method}`);
  };

  wss.on("connection", (socket) => {
    if (activeClient && activeClient !== socket) {
      activeClient.close(4000, "replaced-by-new-client");
    }

    activeClient = socket;
    sendMessage(socket, {
      type: "hello",
      version: 1,
      launchCwd,
    });

    socket.on("message", async (raw) => {
      const maybeParsed = (() => {
        try {
          return JSON.parse(raw.toString()) as unknown;
        } catch {
          return null;
        }
      })();

      if (!maybeParsed) {
        return;
      }

      const parsed = wsClientMessageSchema.safeParse(maybeParsed);
      if (!parsed.success) {
        return;
      }

      const message = parsed.data as WsClientMessage;
      try {
        const result = await resolveMethod(message.method, message.params);
        sendMessage(socket, responseSuccess(message.id, result));
      } catch (error) {
        sendMessage(
          socket,
          responseError(message.id, {
            code: "request_failed",
            message: error instanceof Error ? error.message : "Request failed",
          }),
        );
      }
    });

    socket.on("close", () => {
      if (activeClient === socket) {
        activeClient = null;
      }
    });
  });

  return {
    wsUrl: `ws://127.0.0.1:${options.port}`,
    async close() {
      processManager.killAll();
      providerManager.stopAll();
      providerManager.dispose();
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    },
  };
}
