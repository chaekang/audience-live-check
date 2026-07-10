import { randomUUID } from "node:crypto";
import type { CheckInResponse } from "@live-check-in-demo/shared";

export const CHECK_IN_DURATION_MS = 60_000;
export const HEARTBEAT_INTERVAL_MS = 3_000;
export const MAX_ACTIVE_SESSIONS = 10_000;

export type Clock = {
  readonly now: () => number;
};

type SessionRecord = {
  readonly expiresAtMs: number;
};

export type CheckInSession = CheckInResponse;

export type HeartbeatResult =
  | { readonly ok: true; readonly receivedAt: string }
  | { readonly ok: false; readonly reason: "invalid" | "expired" };

const systemClock: Clock = { now: () => Date.now() };

export class SessionCapacityError extends Error {
  public constructor() {
    super("active session capacity reached");
    this.name = "SessionCapacityError";
  }
}

export class CheckInSessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  public constructor(
    private readonly clock: Clock = systemClock,
    private readonly maxSessions: number = MAX_ACTIVE_SESSIONS,
  ) {}

  public create(): CheckInSession {
    this.pruneExpired();
    if (this.sessions.size >= this.maxSessions) {
      throw new SessionCapacityError();
    }

    const sessionId = randomUUID();
    const expiresAtMs = this.clock.now() + CHECK_IN_DURATION_MS;
    this.sessions.set(sessionId, { expiresAtMs });
    const cleanupTimer = setTimeout(() => {
      const session = this.sessions.get(sessionId);
      if (session?.expiresAtMs === expiresAtMs) {
        this.sessions.delete(sessionId);
      }
    }, CHECK_IN_DURATION_MS);
    cleanupTimer.unref();

    return {
      sessionId,
      expiresAt: new Date(expiresAtMs).toISOString(),
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    };
  }

  public heartbeat(sessionId: string): HeartbeatResult {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return { ok: false, reason: "invalid" };
    }

    if (this.clock.now() >= session.expiresAtMs) {
      this.sessions.delete(sessionId);
      return { ok: false, reason: "expired" };
    }

    return { ok: true, receivedAt: new Date(this.clock.now()).toISOString() };
  }

  private pruneExpired(): void {
    const now = this.clock.now();
    for (const [sessionId, session] of this.sessions) {
      if (now >= session.expiresAtMs) {
        this.sessions.delete(sessionId);
      }
    }
  }
}
