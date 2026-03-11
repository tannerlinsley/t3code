import * as Net from "node:net";
import * as Http from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { ServerConfig } from "./config";
import { attachmentsRouteLayer, healthRouteLayer, staticAndDevRouteLayer } from "./http";
import { fixPath } from "./os-jank";
import { websocketRpcRouteLayer } from "./ws";

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
    }).pipe(Layer.provide(NodeHttpServer.layer(Http.createServer, listenOptions)));
  }),
);

export const runServer = Layer.launch(makeServerLayer);
