// @vitest-environment node

import type {
  CheckInResponse,
  HeartbeatResponse,
} from "@live-check-in-demo/shared";
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api-client";

const checkInResponse: CheckInResponse = {
  sessionToken: "payload.signature",
  expiresAt: "2099-01-01T00:00:00.000Z",
  heartbeatIntervalMs: 3_000,
};

const heartbeatResponse: HeartbeatResponse = {
  ok: true,
  receivedAt: "2099-01-01T00:00:03.000Z",
  servedBy: "task-b",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function toRequest(input: RequestInfo | URL, init?: RequestInit): Request {
  return input instanceof Request ? input : new Request(input, init);
}

function requestCompatibleSignal(): AbortSignal {
  return new Request("http://localhost").signal;
}

describe("API client", () => {
  it("binds the browser native fetch receiver", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = function (
      this: typeof globalThis,
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(jsonResponse(checkInResponse));
    } as typeof fetch;

    try {
      const client = createApiClient();
      await expect(
        client.createCheckIn(requestCompatibleSignal()),
      ).resolves.toEqual(checkInResponse);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("parses a signed-token check-in response", async () => {
    const fetchImplementation = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(checkInResponse),
    );
    const client = createApiClient(fetchImplementation as typeof fetch);

    await expect(
      client.createCheckIn(requestCompatibleSignal()),
    ).resolves.toEqual(checkInResponse);

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const call = fetchImplementation.mock.calls[0];
    expect(call).toBeDefined();
    const request = toRequest(call?.[0] ?? "", call?.[1]);
    expect(request.url).toBe("http://localhost:8080/api/participations");
  });

  it("sends the token only in the heartbeat Authorization header", async () => {
    const fetchImplementation = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(heartbeatResponse),
    );
    const client = createApiClient(fetchImplementation as typeof fetch);

    await expect(
      client.sendHeartbeat(
        checkInResponse.sessionToken,
        requestCompatibleSignal(),
      ),
    ).resolves.toEqual(heartbeatResponse);

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const call = fetchImplementation.mock.calls[0];
    expect(call).toBeDefined();
    const request = toRequest(call?.[0] ?? "", call?.[1]);
    expect(request.url).toBe(
      "http://localhost:8080/api/participations/heartbeat",
    );
    expect(request.headers.get("authorization")).toBe(
      `Bearer ${checkInResponse.sessionToken}`,
    );
    expect(request.url).not.toContain(checkInResponse.sessionToken);
  });
  it("reports successful check-ins and heartbeats to Live Observation", async () => {
    const observationId = "22222222-2222-4222-8222-222222222222";
    const eventIds = [
      "11111111-1111-4111-8111-111111111111",
      "33333333-3333-4333-8333-333333333333",
    ];
    const observationUrl = `https://api.sketchcatch.example.com/api/live-observations/public/${observationId}`;
    const credential = `current.${"a".repeat(43)}`;
    const requests: Request[] = [];
    const fetchImplementation = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = toRequest(input, init);
        requests.push(request);
        if (request.url === "http://localhost:8080/api/participations") {
          return jsonResponse(checkInResponse);
        }
        if (
          request.url === "http://localhost:8080/api/participations/heartbeat"
        ) {
          return jsonResponse(heartbeatResponse);
        }
        if (request.url === `${observationUrl}/bootstrap`) {
          return jsonResponse({ credential });
        }
        if (request.url === `${observationUrl}/receipts`) {
          return new Response(
            JSON.stringify({ accepted: true, acceptedEventCount: 1 }),
            {
              status: 202,
              headers: { "content-type": "application/json" },
            },
          );
        }
        throw new Error(`Unexpected request: ${request.url}`);
      },
    );
    const createEventId = vi
      .fn()
      .mockReturnValueOnce(eventIds[0])
      .mockReturnValueOnce(eventIds[1]);
    const client = createApiClient(fetchImplementation as typeof fetch, {
      createEventId,
      locationHref: `https://audience.example.com/?sketchcatch_observation_url=${encodeURIComponent(observationUrl)}`,
    });

    await expect(
      client.createCheckIn(requestCompatibleSignal()),
    ).resolves.toEqual(checkInResponse);
    await vi.waitFor(() => {
      expect(requests).toHaveLength(3);
    });
    await expect(
      client.sendHeartbeat(
        checkInResponse.sessionToken,
        requestCompatibleSignal(),
      ),
    ).resolves.toEqual(heartbeatResponse);
    await vi.waitFor(() => {
      expect(requests).toHaveLength(5);
    });

    expect(requests.map((request) => request.url)).toEqual([
      "http://localhost:8080/api/participations",
      `${observationUrl}/bootstrap`,
      `${observationUrl}/receipts`,
      "http://localhost:8080/api/participations/heartbeat",
      `${observationUrl}/receipts`,
    ]);
    const receiptRequests = [requests[2], requests[4]];
    for (const receiptRequest of receiptRequests) {
      expect(receiptRequest).toBeDefined();
      expect(receiptRequest?.method).toBe("POST");
      expect(receiptRequest?.credentials).toBe("omit");
      expect(receiptRequest?.headers.get("authorization")).toBe(
        `LiveObservation ${credential}`,
      );
    }
    await expect(receiptRequests[0]?.json()).resolves.toEqual({
      eventId: eventIds[0],
    });
    await expect(receiptRequests[1]?.json()).resolves.toEqual({
      eventId: eventIds[1],
    });
  });

  it("keeps participation successful when Live Observation is unavailable", async () => {
    const observationUrl =
      "https://api.sketchcatch.example.com/api/live-observations/public/22222222-2222-4222-8222-222222222222";
    const requests: Request[] = [];
    const fetchImplementation = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = toRequest(input, init);
        requests.push(request);
        if (request.url === "http://localhost:8080/api/participations") {
          return jsonResponse(checkInResponse);
        }
        throw new Error("Live Observation unavailable");
      },
    );
    const client = createApiClient(fetchImplementation as typeof fetch, {
      locationHref: `https://audience.example.com/?sketchcatch_observation_url=${encodeURIComponent(observationUrl)}`,
    });

    await expect(
      client.createCheckIn(requestCompatibleSignal()),
    ).resolves.toEqual(checkInResponse);
    await vi.waitFor(() => {
      expect(requests.map((request) => request.url)).toEqual([
        "http://localhost:8080/api/participations",
        `${observationUrl}/bootstrap`,
      ]);
    });
  });
});
