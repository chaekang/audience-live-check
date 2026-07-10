import { afterEach, describe, expect, it } from "vitest";
import {
  clearStoredSession,
  readStoredSession,
  type StoredSession,
  saveStoredSession,
} from "./check-in-storage";

const session: StoredSession = {
  sessionId: "8f6c5f2a-9fd4-4c37-9b1f-2d7b5c4e9a10",
  expiresAt: "2099-01-01T00:00:00.000Z",
  heartbeatIntervalMs: 3_000,
};

const originalStorageDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "localStorage",
);

afterEach(() => {
  if (originalStorageDescriptor !== undefined) {
    Object.defineProperty(window, "localStorage", originalStorageDescriptor);
  }
});

describe("check-in session storage", () => {
  it("uses an in-memory fallback when localStorage is unavailable", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: undefined,
    });

    saveStoredSession(session);
    expect(readStoredSession(0)).toEqual(session);

    clearStoredSession();
    expect(readStoredSession(0)).toBeNull();
  });
});
