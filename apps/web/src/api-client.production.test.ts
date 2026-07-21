// @vitest-environment node

import type { CheckInResponse } from "@live-check-in-demo/shared";
import { afterEach, expect, it, vi } from "vitest";

const checkInResponse: CheckInResponse = {
  sessionToken: "payload.signature",
  expiresAt: "2099-01-01T00:00:00.000Z",
  heartbeatIntervalMs: 3_000,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("uses the deployed site origin when the API base is the site root", async () => {
  vi.stubEnv("VITE_API_BASE_URL", "/");
  vi.stubGlobal("location", new URL("https://audience.example/"));
  const { createApiClient } = await import("./api-client");
  const fetchImplementation = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(checkInResponse),
  );
  const client = createApiClient(fetchImplementation as typeof fetch);

  await expect(
    client.createCheckIn(new Request("http://localhost").signal),
  ).resolves.toEqual(checkInResponse);

  const request = fetchImplementation.mock.calls[0]?.[0];
  expect(request).toBeInstanceOf(Request);
  expect((request as Request).url).toBe(`${location.origin}/api/check-ins`);
});
