const OBSERVATION_URL_PARAM = "sketchcatch_observation_url";
const OBSERVATION_PATH_PATTERN =
  /\/api\/live-observations\/public\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{43}$/;

type ObservationSignalClientOptions = {
  readonly createEventId?: (() => string) | undefined;
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly pageUrl?: URL | undefined;
};

export type ObservationSignalClient = {
  readonly dispose: () => void;
  readonly recordSuccessfulRequest: () => Promise<boolean>;
};

export function createObservationSignalClient(
  options: ObservationSignalClientOptions = {},
): ObservationSignalClient | null {
  const pageUrl = options.pageUrl ?? new URL(window.location.href);
  const observationUrl = parseObservationUrl(
    pageUrl.searchParams.get(OBSERVATION_URL_PARAM),
  );

  if (observationUrl === null) {
    return null;
  }

  const fetchRequest = options.fetch ?? globalThis.fetch;
  const createEventId = options.createEventId ?? (() => crypto.randomUUID());
  const controller = new AbortController();
  let credential: string | null = null;
  let bootstrapPromise: Promise<string | null> | null = null;
  let disposed = false;

  async function bootstrap(): Promise<string | null> {
    if (credential !== null) {
      return credential;
    }
    if (bootstrapPromise !== null) {
      return bootstrapPromise;
    }

    bootstrapPromise = (async () => {
      try {
        const response = await fetchRequest(`${observationUrl}/bootstrap`, {
          credentials: "omit",
          headers: { accept: "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        if (!response.ok) {
          return null;
        }
        const body: unknown = await response.json();
        if (!isBootstrapResponse(body)) {
          return null;
        }
        credential = body.credential;
        return credential;
      } catch {
        return null;
      } finally {
        bootstrapPromise = null;
      }
    })();

    return bootstrapPromise;
  }

  return Object.freeze({
    dispose(): void {
      disposed = true;
      credential = null;
      controller.abort();
    },

    async recordSuccessfulRequest(): Promise<boolean> {
      if (disposed) {
        return false;
      }

      const activeCredential = await bootstrap();
      if (activeCredential === null || disposed) {
        return false;
      }

      try {
        const response = await fetchRequest(`${observationUrl}/receipts`, {
          body: JSON.stringify({ eventId: createEventId() }),
          credentials: "omit",
          headers: {
            accept: "application/json",
            authorization: `LiveObservation ${activeCredential}`,
            "content-type": "application/json",
          },
          method: "POST",
          signal: controller.signal,
        });
        if (response.status === 401) {
          credential = null;
        }
        return response.ok;
      } catch {
        return false;
      }
    },
  });
}

function parseObservationUrl(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      !OBSERVATION_PATH_PATTERN.test(url.pathname)
    ) {
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isBootstrapResponse(value: unknown): value is { credential: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "credential" in value &&
    typeof value.credential === "string" &&
    CAPABILITY_PATTERN.test(value.credential)
  );
}
