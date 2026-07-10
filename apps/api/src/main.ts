import type { Server } from "node:http";
import { createApp } from "./app.js";
import { type ApiConfig, loadConfig } from "./config.js";

export function startServer(config: ApiConfig = loadConfig()): Server {
  const app = createApp({ config });
  const server = app.listen(config.port, () => {
    console.info(
      JSON.stringify({
        event: "server_started",
        port: config.port,
        instanceId: config.instanceId,
      }),
    );
  });

  const shutdown = (signal: string): void => {
    console.info(JSON.stringify({ event: "server_shutdown", signal }));
    server.close((error) => {
      if (error instanceof Error) {
        console.error(
          JSON.stringify({
            event: "server_shutdown_error",
            message: error.message,
          }),
        );
        process.exitCode = 1;
      }
    });
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  return server;
}

startServer();
