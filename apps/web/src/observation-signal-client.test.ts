// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createObservationSignalClient } from "./observation-signal-client";

describe("observation signal client", () => {
  it("bootstraps a capability and records a successful audience request", async () => {
    const credential = `current.${"a".repeat(43)}`;
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ credential }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ accepted: true, acceptedEventCount: 1 }),
          {
            headers: { "content-type": "application/json" },
            status: 202,
          },
        ),
      );
    const observationUrl =
      "https://sketchcatch.example.com/api/live-observations/public/11111111-1111-4111-8111-111111111111";
    const pageUrl = new URL("https://audience.example.com/");
    pageUrl.searchParams.set("sketchcatch_observation_url", observationUrl);
    const client = createObservationSignalClient({
      createEventId: () => "22222222-2222-4222-8222-222222222222",
      fetch: fetchImplementation,
      pageUrl,
    });

    expect(client).not.toBeNull();
    await expect(client?.recordSuccessfulRequest()).resolves.toBe(true);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);

    const bootstrap = new Request(
      fetchImplementation.mock.calls[0]?.[0] ?? "",
      fetchImplementation.mock.calls[0]?.[1],
    );
    expect(bootstrap.url).toBe(`${observationUrl}/bootstrap`);
    expect(bootstrap.method).toBe("POST");

    const request = new Request(
      fetchImplementation.mock.calls[1]?.[0] ?? "",
      fetchImplementation.mock.calls[1]?.[1],
    );
    expect(request.url).toBe(`${observationUrl}/receipts`);
    expect(request.headers.get("authorization")).toBe(
      `LiveObservation ${credential}`,
    );
    await expect(request.json()).resolves.toEqual({
      eventId: "22222222-2222-4222-8222-222222222222",
    });
  });
});
