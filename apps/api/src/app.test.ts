import {
  checkInResponseSchema,
  healthResponseSchema,
  heartbeatResponseSchema,
} from "@live-check-in-demo/shared";
import pino from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { CheckInSessionStore } from "./session-store.js";

const config = {
  port: 8080,
  webOrigin: "http://localhost:5173",
  instanceId: "test-api",
} as const;

function createTestApp(store?: CheckInSessionStore) {
  return createApp({
    config,
    logger: pino({ enabled: false }),
    ...(store === undefined ? {} : { store }),
  });
}

describe("check-in API", () => {
  it("returns the health contract", async () => {
    const response = await request(createTestApp()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "live-check-in-api",
      version: "1.0.0",
    });
    expect(() => healthResponseSchema.parse(response.body)).not.toThrow();
  });

  it("creates a session and accepts a heartbeat", async () => {
    const app = createTestApp();
    const checkIn = await request(app).post("/api/check-ins");
    const sessionId = String(checkIn.body.sessionId);

    const heartbeat = await request(app).post(
      `/api/check-ins/${sessionId}/heartbeat`,
    );

    expect(checkIn.status).toBe(201);
    expect(checkIn.body.heartbeatIntervalMs).toBe(3000);
    expect(() => checkInResponseSchema.parse(checkIn.body)).not.toThrow();
    expect(heartbeat.status).toBe(200);
    expect(heartbeat.body).toMatchObject({ ok: true, servedBy: "test-api" });
    expect(() => heartbeatResponseSchema.parse(heartbeat.body)).not.toThrow();
  });

  it("rejects invalid and unknown sessions with the same client error", async () => {
    const app = createTestApp();
    const malformed = await request(app).post(
      "/api/check-ins/not-a-uuid/heartbeat",
    );
    const unknown = await request(app).post(
      "/api/check-ins/00000000-0000-4000-8000-000000000000/heartbeat",
    );

    expect(malformed.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(malformed.body.error).toBe("invalid_session");
    expect(unknown.body.error).toBe("invalid_session");
  });

  it("returns a consistent JSON 404 and CORS header", async () => {
    const response = await request(createTestApp())
      .get("/unknown")
      .set("Origin", config.webOrigin);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("not_found");
    expect(response.headers["access-control-allow-origin"]).toBe(
      config.webOrigin,
    );
  });

  it("returns a consistent JSON 400 for malformed JSON", async () => {
    const response = await request(createTestApp())
      .post("/api/check-ins")
      .set("content-type", "application/json")
      .send("{");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "invalid_json",
      message: "요청 본문 JSON이 올바르지 않습니다.",
    });
  });

  it("loads the default port and supports environment overrides", () => {
    expect(loadConfig({}).port).toBe(8080);
    expect(
      loadConfig({
        PORT: "9090",
        WEB_ORIGIN: "http://localhost:4173",
        INSTANCE_ID: "qa-api",
      }),
    ).toEqual({
      port: 9090,
      webOrigin: "http://localhost:4173",
      instanceId: "qa-api",
    });
  });
});

describe("check-in session store", () => {
  it("expires sessions after the configured duration", () => {
    let now = 10_000;
    const store = new CheckInSessionStore({ now: () => now });
    const session = store.create();

    now += 60_000;

    expect(store.heartbeat(session.sessionId)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("prunes expired sessions before enforcing the active-session cap", () => {
    let now = 10_000;
    const store = new CheckInSessionStore({ now: () => now }, 1);
    store.create();

    expect(() => store.create()).toThrow("active session capacity reached");

    now += 60_000;

    expect(() => store.create()).not.toThrow();
  });

  it("returns a capacity response when the active-session cap is reached", async () => {
    const store = new CheckInSessionStore(undefined, 1);
    const app = createTestApp(store);
    await request(app).post("/api/check-ins");

    const response = await request(app).post("/api/check-ins");

    expect(response.status).toBe(503);
    expect(response.body.error).toBe("capacity_reached");
  });
});
