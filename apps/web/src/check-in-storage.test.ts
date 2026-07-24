import { afterEach, describe, expect, it } from "vitest";
import {
  clearStoredSession,
  readStoredSession,
  type StoredSession,
  saveStoredSession,
} from "./check-in-storage";

const session: StoredSession = {
  sessionToken: "payload.signature",
  expiresAt: "2099-01-01T00:00:00.000Z",
  heartbeatIntervalMs: 3_000,
};

const originalStorageDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "localStorage",
);

function installStorageThatThrows(
  operation: "getItem" | "setItem" | "removeItem",
  initialEntries: Readonly<Record<string, string>> = {},
  error: Error = new DOMException("Storage access is blocked", "SecurityError"),
): void {
  const entries = new Map(Object.entries(initialEntries));
  const storage: Storage = {
    get length(): number {
      return entries.size;
    },
    clear(): void {
      entries.clear();
    },
    getItem(key: string): string | null {
      if (operation === "getItem") {
        throw error;
      }
      return entries.get(key) ?? null;
    },
    key(index: number): string | null {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      if (operation === "removeItem") {
        throw error;
      }
      entries.delete(key);
    },
    setItem(key: string, value: string): void {
      if (operation === "setItem") {
        throw error;
      }
      entries.set(key, value);
    },
  };

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
}

afterEach(() => {
  if (originalStorageDescriptor !== undefined) {
    Object.defineProperty(window, "localStorage", originalStorageDescriptor);
  }
  clearStoredSession();
  window.localStorage.clear();
});

describe("check-in session storage", () => {
  it("restores a valid signed-token session", () => {
    saveStoredSession(session);

    expect(readStoredSession(0)).toEqual(session);
  });

  it("deletes a session immediately when it expires", () => {
    const expiringSession: StoredSession = {
      ...session,
      expiresAt: "1970-01-01T00:00:01.000Z",
    };
    saveStoredSession(expiringSession);

    expect(readStoredSession(1_000)).toBeNull();
    expect(window.localStorage.getItem("live-check-in-session")).toBeNull();
  });

  it.each([
    "not-json",
    JSON.stringify({
      sessionId: "8f6c5f2a-9fd4-4c37-9b1f-2d7b5c4e9a10",
      expiresAt: "2099-01-01T00:00:00.000Z",
      heartbeatIntervalMs: 3_000,
    }),
  ])("deletes malformed or legacy storage: %s", (raw) => {
    window.localStorage.setItem("live-check-in-session", raw);

    expect(readStoredSession(0)).toBeNull();
    expect(window.localStorage.getItem("live-check-in-session")).toBeNull();
  });

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

  it("keeps a session in memory when localStorage rejects a write", () => {
    installStorageThatThrows("setItem");

    expect(() => saveStoredSession(session)).not.toThrow();
    expect(readStoredSession(0)).toEqual(session);
  });

  it("keeps a session in memory when the browser wraps a storage failure", () => {
    installStorageThatThrows("setItem", {}, new Error("Storage unavailable"));

    expect(() => saveStoredSession(session)).not.toThrow();
    expect(readStoredSession(0)).toEqual(session);
  });

  it("treats a blocked localStorage read as an empty in-memory store", () => {
    installStorageThatThrows("getItem");

    expect(() => readStoredSession(0)).not.toThrow();
    expect(readStoredSession(0)).toBeNull();
  });

  it("ignores a blocked localStorage removal", () => {
    installStorageThatThrows("removeItem", {
      "live-check-in-session": "not-json",
    });

    expect(() => readStoredSession(0)).not.toThrow();
    expect(readStoredSession(0)).toBeNull();
  });

  it("does not restore a cleared session when localStorage rejects removal", () => {
    installStorageThatThrows("removeItem", {
      "live-check-in-session": JSON.stringify(session),
    });

    clearStoredSession();

    expect(readStoredSession(0)).toBeNull();
  });
});
