import type { CheckInResponse } from "@live-check-in-demo/shared";

export const DEMO_LOAD_PROFILES = {
  warning: {
    intervalMs: 100,
    requestCount: 24,
  },
  scaleOut: {
    intervalMs: 200,
    requestCount: 900,
  },
} as const;

export type DemoLoadProfile =
  (typeof DEMO_LOAD_PROFILES)[keyof typeof DEMO_LOAD_PROFILES];
export type DemoLoadProfileName = keyof typeof DEMO_LOAD_PROFILES;

type DemoLoadDependencies = {
  readonly createCheckIn: (signal: AbortSignal) => Promise<CheckInResponse>;
  readonly onProgress?: ((attempted: number) => void) | undefined;
  readonly recordSuccessfulRequest: () => Promise<boolean>;
  readonly signal: AbortSignal;
  readonly wait?:
    | ((durationMs: number, signal: AbortSignal) => Promise<void>)
    | undefined;
  readonly profile: DemoLoadProfile;
};

export type DemoLoadResult = {
  readonly attempted: number;
  readonly failed: number;
  readonly observed: number;
  readonly succeeded: number;
};

export function isDemoLoadOperatorPage(
  pageUrl = new URL(window.location.href),
): boolean {
  return pageUrl.searchParams.get("sketchcatch_demo_load") === "presenter";
}

export async function runDemoLoad({
  createCheckIn,
  onProgress,
  recordSuccessfulRequest,
  signal,
  wait = waitForInterval,
  profile,
}: DemoLoadDependencies): Promise<DemoLoadResult> {
  let attempted = 0;
  let observed = 0;
  let succeeded = 0;

  while (attempted < profile.requestCount) {
    throwIfAborted(signal);
    try {
      await createCheckIn(signal);
      throwIfAborted(signal);
      succeeded += 1;
      try {
        if (await recordSuccessfulRequest()) {
          observed += 1;
        }
      } catch (error) {
        if (
          signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          throw error;
        }
      }
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        throw error;
      }
    }
    attempted += 1;
    onProgress?.(attempted);

    if (attempted < profile.requestCount) {
      await wait(profile.intervalMs, signal);
    }
  }

  return {
    attempted,
    failed: attempted - succeeded,
    observed,
    succeeded,
  };
}

function waitForInterval(
  durationMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(
      new DOMException("Demo load cancelled", "AbortError"),
    );
  }

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, durationMs);
    const abort = (): void => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Demo load cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Demo load cancelled", "AbortError");
  }
}
