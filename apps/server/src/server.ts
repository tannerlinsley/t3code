import * as Net from "node:net";
import * as Http from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { ServerConfig } from "./config";
import { attachmentsRouteLayer, healthRouteLayer, staticAndDevRouteLayer } from "./http";
import { fixPath } from "./os-jank";
import { BunPtyAdapterLive } from "./terminal/Layers/BunPTY";
import { TerminalManagerLive } from "./terminal/Layers/Manager";
import { NodePtyAdapterLive } from "./terminal/Layers/NodePTY";
import { websocketRpcRouteLayer } from "./ws";
import { ProviderHealthLive } from "./provider/Layers/ProviderHealth";
import { KeybindingsLive } from "./keybindings";

const terminalManagerLayer = TerminalManagerLive.pipe(
  Layer.provide(
    typeof Bun !== "undefined" && process.platform !== "win32"
      ? BunPtyAdapterLive
      : NodePtyAdapterLive,
  ),
);

const runtimeServicesLayer = Layer.mergeAll(
  terminalManagerLayer,
  ProviderHealthLive,
  KeybindingsLive,
  /// other runtime services
);

export const makeRoutesLayer = Layer.mergeAll(
  healthRouteLayer,
  attachmentsRouteLayer,
  staticAndDevRouteLayer,
  websocketRpcRouteLayer,
);

export const makeServerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const listenOptions: Net.ListenOptions = config.host
      ? { host: config.host, port: config.port }
      : { port: config.port };
    yield* Effect.sync(fixPath);
    return HttpRouter.serve(makeRoutesLayer, {
      disableLogger: !config.logWebSocketEvents,
    }).pipe(
      Layer.provide(runtimeServicesLayer),
      Layer.provide(NodeHttpServer.layer(Http.createServer, listenOptions)),
    );
  }),
);

export const runServer = Layer.launch(makeServerLayer);
