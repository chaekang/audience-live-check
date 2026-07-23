import type { CheckInResponse } from "@live-check-in-demo/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { createCheckIn, sendHeartbeat } from "./api-client";
import {
  clearStoredSession,
  readStoredSession,
  type StoredSession,
  saveStoredSession,
} from "./check-in-storage";
import {
  DEMO_LOAD_PROFILES,
  type DemoLoadProfileName,
  isDemoLoadOperatorPage,
  runDemoLoad,
} from "./demo-load";
import {
  createObservationSignalClient,
  type ObservationSignalClient,
} from "./observation-signal-client";

const MAX_HEARTBEAT_RETRIES = 2;
const RETRY_DELAY_MS = 1_000;

export type CheckInStatus =
  | "idle"
  | "starting"
  | "active"
  | "completed"
  | "error";

type CheckInState = {
  readonly status: CheckInStatus;
  readonly message: string;
  readonly servedBy: string | null;
};

export type DemoLoadState = {
  readonly available: boolean;
  readonly attempted: number;
  readonly failed: number;
  readonly observed: number;
  readonly status: "idle" | "running" | "completed" | "partial" | "error";
  readonly succeeded: number;
  readonly target: number;
};

const INITIAL_DEMO_LOAD_STATE: DemoLoadState = {
  available: false,
  attempted: 0,
  failed: 0,
  observed: 0,
  status: "idle",
  succeeded: 0,
  target: DEMO_LOAD_PROFILES.warning.requestCount,
};

const INITIAL_STATE: CheckInState = {
  status: "idle",
  message: "발표 데모에 참여해 주세요.",
  servedBy: null,
};

export function useCheckIn(): CheckInState & {
  readonly demoLoad: DemoLoadState;
  readonly start: () => void;
  readonly startDemoLoad: (profileName: DemoLoadProfileName) => void;
  readonly stopDemoLoad: () => void;
} {
  const [state, setState] = useState<CheckInState>(INITIAL_STATE);
  const [demoLoad, setDemoLoad] = useState<DemoLoadState>(
    INITIAL_DEMO_LOAD_STATE,
  );
  const controllerRef = useRef<AbortController | null>(null);
  const demoLoadControllerRef = useRef<AbortController | null>(null);
  const lastServedByRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const observationSignalRef = useRef<ObservationSignalClient | null>(null);

  const updateState = useCallback((next: CheckInState): void => {
    if (mountedRef.current) {
      setState(next);
    }
  }, []);

  const wait = useCallback(
    (durationMs: number, signal: AbortSignal): Promise<void> => {
      return new Promise((resolve, reject) => {
        let timer: number | undefined;
        const abort = (): void => {
          if (timer !== undefined) {
            window.clearTimeout(timer);
          }
          signal.removeEventListener("abort", abort);
          reject(new DOMException("Heartbeat cancelled", "AbortError"));
        };
        timer = window.setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, durationMs);
        signal.addEventListener("abort", abort, { once: true });
      });
    },
    [],
  );

  const runHeartbeatLoop = useCallback(
    async (
      session: StoredSession,
      controller: AbortController,
    ): Promise<void> => {
      const expiresAtMs = Date.parse(session.expiresAt);
      let retryCount = 0;

      while (Date.now() < expiresAtMs && !controller.signal.aborted) {
        try {
          const heartbeat = await sendHeartbeat(
            session.sessionToken,
            controller.signal,
          );
          void observationSignalRef.current?.recordSuccessfulRequest();
          lastServedByRef.current = heartbeat.servedBy;
          updateState({
            status: "active",
            message: "이제 발표 화면을 확인해 주세요.",
            servedBy: heartbeat.servedBy,
          });
        } catch (error) {
          if (
            controller.signal.aborted ||
            (error instanceof DOMException && error.name === "AbortError")
          ) {
            return;
          }
          if (retryCount >= MAX_HEARTBEAT_RETRIES) {
            clearStoredSession();
            controllerRef.current = null;
            updateState({
              status: "error",
              message: "연결을 확인하지 못했습니다. 다시 참여해 주세요.",
              servedBy: lastServedByRef.current,
            });
            return;
          }
          retryCount += 1;
          if (Date.now() + RETRY_DELAY_MS >= expiresAtMs) {
            clearStoredSession();
            controllerRef.current = null;
            updateState({
              status: "error",
              message: "연결을 확인하지 못했습니다. 다시 참여해 주세요.",
              servedBy: lastServedByRef.current,
            });
            return;
          }
          await wait(RETRY_DELAY_MS, controller.signal);
          continue;
        }

        const remainingMs = expiresAtMs - Date.now();
        if (remainingMs <= 0) {
          break;
        }
        await wait(
          Math.min(session.heartbeatIntervalMs, remainingMs),
          controller.signal,
        );
      }

      if (!controller.signal.aborted) {
        clearStoredSession();
        controllerRef.current = null;
        updateState({
          status: "completed",
          message: "발표 화면을 확인해 주세요.",
          servedBy: lastServedByRef.current,
        });
      }
    },
    [updateState, wait],
  );

  const beginSession = useCallback(
    (session: CheckInResponse, controller: AbortController): void => {
      if (controller.signal.aborted || !mountedRef.current) {
        return;
      }
      void observationSignalRef.current?.recordSuccessfulRequest();
      saveStoredSession(session);
      lastServedByRef.current = null;
      updateState({
        status: "active",
        message: "이제 발표 화면을 확인해 주세요.",
        servedBy: null,
      });
      void runHeartbeatLoop(session, controller).catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        clearStoredSession();
        controllerRef.current = null;
        updateState({
          status: "error",
          message: "연결을 확인하지 못했습니다. 다시 참여해 주세요.",
          servedBy: lastServedByRef.current,
        });
      });
    },
    [runHeartbeatLoop, updateState],
  );

  const start = useCallback((): void => {
    controllerRef.current?.abort();
    clearStoredSession();

    lastServedByRef.current = null;
    updateState({
      status: "starting",
      message: "참여를 시작하고 있습니다.",
      servedBy: null,
    });
    const controller = new AbortController();
    controllerRef.current = controller;
    void createCheckIn(controller.signal)
      .then((session) => beginSession(session, controller))
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        console.error("Audience check-in failed", error);
        controllerRef.current = null;
        updateState({
          status: "error",
          message: "참여를 시작하지 못했습니다. 다시 시도해 주세요.",
          servedBy: null,
        });
      });
  }, [beginSession, updateState]);

  useEffect(() => {
    const client = createObservationSignalClient();
    observationSignalRef.current = client;
    setDemoLoad((current) => ({
      ...current,
      available: client !== null && isDemoLoadOperatorPage(),
    }));

    return () => {
      demoLoadControllerRef.current?.abort();
      demoLoadControllerRef.current = null;
      client?.dispose();
      if (observationSignalRef.current === client) {
        observationSignalRef.current = null;
      }
    };
  }, []);

  const stopDemoLoad = useCallback((): void => {
    demoLoadControllerRef.current?.abort();
    demoLoadControllerRef.current = null;
    setDemoLoad((current) => ({
      ...current,
      status: "idle",
    }));
  }, []);

  const startDemoLoad = useCallback(
    (profileName: DemoLoadProfileName): void => {
      const profile = DEMO_LOAD_PROFILES[profileName];
      const signalClient = observationSignalRef.current;

      if (signalClient === null) {
        setDemoLoad((current) => ({ ...current, status: "error" }));
        return;
      }

      demoLoadControllerRef.current?.abort();
      const controller = new AbortController();
      demoLoadControllerRef.current = controller;
      setDemoLoad((current) => ({
        ...current,
        attempted: 0,
        failed: 0,
        observed: 0,
        succeeded: 0,
        status: "running",
        target: profile.requestCount,
      }));

      void runDemoLoad({
        profile,
        createCheckIn,
        onProgress: (attempted) => {
          if (
            mountedRef.current &&
            !controller.signal.aborted &&
            demoLoadControllerRef.current === controller
          ) {
            setDemoLoad((current) => ({ ...current, attempted }));
          }
        },
        recordSuccessfulRequest: () => signalClient.recordSuccessfulRequest(),
        signal: controller.signal,
      }).then(
        (result) => {
          if (
            !mountedRef.current ||
            controller.signal.aborted ||
            demoLoadControllerRef.current !== controller
          ) {
            return;
          }
          demoLoadControllerRef.current = null;
          setDemoLoad((current) => ({
            ...current,
            attempted: result.attempted,
            failed: result.failed,
            observed: result.observed,
            status:
              result.succeeded === 0
                ? "error"
                : result.failed === 0 && result.observed === result.succeeded
                  ? "completed"
                  : "partial",
            succeeded: result.succeeded,
          }));
        },
        (error: unknown) => {
          if (
            controller.signal.aborted ||
            (error instanceof DOMException && error.name === "AbortError")
          ) {
            return;
          }
          if (demoLoadControllerRef.current !== controller) {
            return;
          }
          demoLoadControllerRef.current = null;
          if (mountedRef.current) {
            setDemoLoad((current) => ({ ...current, status: "error" }));
          }
        },
      );
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    const storedSession = readStoredSession();
    if (storedSession !== null && controllerRef.current === null) {
      const controller = new AbortController();
      controllerRef.current = controller;
      lastServedByRef.current = null;
      updateState({
        status: "active",
        message: "이제 발표 화면을 확인해 주세요.",
        servedBy: null,
      });
      queueMicrotask(() => {
        if (controller.signal.aborted) {
          return;
        }
        void runHeartbeatLoop(storedSession, controller).catch(
          (error: unknown) => {
            if (
              controller.signal.aborted ||
              (error instanceof DOMException && error.name === "AbortError")
            ) {
              return;
            }
            clearStoredSession();
            controllerRef.current = null;
            updateState({
              status: "error",
              message: "연결을 확인하지 못했습니다. 다시 참여해 주세요.",
              servedBy: lastServedByRef.current,
            });
          },
        );
      });
    }

    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [runHeartbeatLoop, updateState]);

  return { ...state, demoLoad, start, startDemoLoad, stopDemoLoad };
}
