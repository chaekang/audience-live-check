import { describe, expect, it, vi } from "vitest";
import {
  DEMO_LOAD_PROFILES,
  isDemoLoadOperatorPage,
  runDemoLoad,
} from "./demo-load";

describe("demo load operator gate", () => {
  it("only enables controls for an explicit presenter URL", () => {
    expect(isDemoLoadOperatorPage(new URL("https://demo.test/"))).toBe(false);
    expect(
      isDemoLoadOperatorPage(
        new URL("https://demo.test/?sketchcatch_demo_load=presenter"),
      ),
    ).toBe(true);
  });
});

describe("runDemoLoad", () => {
  it("paces 24 real check-ins and records one observation receipt for each success", async () => {
    const createCheckIn = vi.fn(async () => ({
      expiresAt: "2026-07-22T00:01:00.000Z",
      heartbeatIntervalMs: 3_000,
      sessionToken: "payload.signature",
    }));
    const recordSuccessfulRequest = vi.fn(async () => true);
    const wait = vi.fn(async () => undefined);
    const progress: number[] = [];

    const result = await runDemoLoad({
      createCheckIn,
      recordSuccessfulRequest,
      profile: DEMO_LOAD_PROFILES.warning,
      signal: new AbortController().signal,
      wait,
      onProgress: (attempted) => progress.push(attempted),
    });

    expect(result).toEqual({
      attempted: 24,
      failed: 0,
      observed: 24,
      succeeded: 24,
    });
    expect(createCheckIn).toHaveBeenCalledTimes(24);
    expect(recordSuccessfulRequest).toHaveBeenCalledTimes(24);
    expect(wait).toHaveBeenCalledTimes(23);
    expect(progress).toEqual(
      Array.from({ length: 24 }, (_, index) => index + 1),
    );
  });

  it("stops immediately when the bounded load is cancelled", async () => {
    const controller = new AbortController();
    const createCheckIn = vi.fn(async () => {
      controller.abort();
      return {
        expiresAt: "2026-07-22T00:01:00.000Z",
        heartbeatIntervalMs: 3_000,
        sessionToken: "payload.signature",
      };
    });
    const recordSuccessfulRequest = vi.fn(async () => true);

    await expect(
      runDemoLoad({
        createCheckIn,
        recordSuccessfulRequest,
        profile: DEMO_LOAD_PROFILES.warning,
        signal: controller.signal,
        wait: vi.fn(async () => undefined),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(createCheckIn).toHaveBeenCalledTimes(1);
    expect(recordSuccessfulRequest).not.toHaveBeenCalled();
  });
});

it("caps the Fargate scale-out profile at 5 RPS for 900 requests", async () => {
  const createCheckIn = vi.fn(async () => ({
    expiresAt: "2026-07-22T00:01:00.000Z",
    heartbeatIntervalMs: 3_000,
    sessionToken: "payload.signature",
  }));
  const recordSuccessfulRequest = vi.fn(async () => true);
  const wait = vi.fn(async () => undefined);

  const result = await runDemoLoad({
    createCheckIn,
    profile: DEMO_LOAD_PROFILES.scaleOut,
    recordSuccessfulRequest,
    signal: new AbortController().signal,
    wait,
  });

  expect(result).toEqual({
    attempted: 900,
    failed: 0,
    observed: 900,
    succeeded: 900,
  });
  expect(createCheckIn).toHaveBeenCalledTimes(900);
  expect(recordSuccessfulRequest).toHaveBeenCalledTimes(900);
  expect(wait).toHaveBeenCalledTimes(899);
});

it("continues the bounded profile after an individual request failure", async () => {
  let attempt = 0;
  const createCheckIn = vi.fn(async () => {
    attempt += 1;
    if (attempt === 2) {
      throw new Error("temporary upstream failure");
    }
    return {
      expiresAt: "2026-07-22T00:01:00.000Z",
      heartbeatIntervalMs: 3_000,
      sessionToken: "payload.signature",
    };
  });
  const recordSuccessfulRequest = vi.fn(async () => true);

  const result = await runDemoLoad({
    createCheckIn,
    profile: DEMO_LOAD_PROFILES.warning,
    recordSuccessfulRequest,
    signal: new AbortController().signal,
    wait: vi.fn(async () => undefined),
  });

  expect(result).toEqual({
    attempted: 24,
    failed: 1,
    observed: 23,
    succeeded: 23,
  });
  expect(createCheckIn).toHaveBeenCalledTimes(24);
  expect(recordSuccessfulRequest).toHaveBeenCalledTimes(23);
});
