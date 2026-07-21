import {
  type CheckInResponse,
  checkInResponseSchema,
  type HeartbeatResponse,
  heartbeatResponseSchema,
} from "@live-check-in-demo/shared";
import ky from "ky";
import { createLiveObservationReceiptReporter } from "./live-observation-receipt";

const configuredBaseUrl = import.meta.env["VITE_API_BASE_URL"];
const apiBaseUrl = configuredBaseUrl ?? "http://localhost:8080";

export type ApiClient = {
  readonly createCheckIn: (signal: AbortSignal) => Promise<CheckInResponse>;
  readonly sendHeartbeat: (
    sessionToken: string,
    signal: AbortSignal,
  ) => Promise<HeartbeatResponse>;
};

export type ApiClientOptions = Readonly<{
  createEventId?: (() => string) | undefined;
  locationHref?: string | undefined;
}>;

export function createApiClient(
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch.bind(
    globalThis,
  ),
  options: ApiClientOptions = {},
): ApiClient {
  const api = ky.create({
    prefixUrl: apiBaseUrl.replace(/\/$/, ""),
    timeout: 10_000,
    retry: 0,
    headers: { "content-type": "application/json" },
    fetch: fetchImplementation,
  });
  const receiptReporter = createLiveObservationReceiptReporter({
    createEventId: options.createEventId,
    fetch: fetchImplementation,
    locationHref:
      options.locationHref ??
      (typeof globalThis.location === "undefined"
        ? undefined
        : globalThis.location.href),
  });

  return {
    async createCheckIn(signal): Promise<CheckInResponse> {
      const payload: unknown = await api
        .post("api/participations", { signal })
        .json();
      const response = checkInResponseSchema.parse(payload);
      receiptReporter.record();
      return response;
    },

    async sendHeartbeat(sessionToken, signal): Promise<HeartbeatResponse> {
      const payload: unknown = await api
        .post("api/participations/heartbeat", {
          signal,
          headers: { authorization: `Bearer ${sessionToken}` },
        })
        .json();
      const response = heartbeatResponseSchema.parse(payload);
      receiptReporter.record();
      return response;
    },
  };
}

const defaultClient = createApiClient();

export const createCheckIn = defaultClient.createCheckIn;
export const sendHeartbeat = defaultClient.sendHeartbeat;
