import os from "node:os";
import { z } from "zod";

const environmentSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  INSTANCE_ID: z.string().trim().min(1).optional(),
});

export type ApiConfig = {
  readonly port: number;
  readonly webOrigin: string;
  readonly instanceId: string;
};

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const parsed = environmentSchema.parse({
    PORT: environment["PORT"],
    WEB_ORIGIN: environment["WEB_ORIGIN"],
    INSTANCE_ID: environment["INSTANCE_ID"],
  });

  return {
    port: parsed.PORT,
    webOrigin: parsed.WEB_ORIGIN,
    instanceId: (parsed.INSTANCE_ID ?? os.hostname()) || "local-api",
  };
}
