type ReceiptReporterOptions = Readonly<{
  createEventId?: (() => string) | undefined;
  fetch: typeof globalThis.fetch;
  locationHref?: string | undefined;
}>;

export type LiveObservationReceiptReporter = Readonly<{
  record(): void;
}>;

const OBSERVATION_URL_PARAMETER = "sketchcatch_observation_url";
const OBSERVATION_PATH_PATTERN =
  /^\/api\/live-observations\/public\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{43}$/;
const EVENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function createLiveObservationReceiptReporter(
  options: ReceiptReporterOptions,
): LiveObservationReceiptReporter {
  const observationUrl = readObservationUrl(options.locationHref);
  const createEventId = options.createEventId ?? createUuid;
  let credentialPromise: Promise<string | null> | null = null;

  async function readCredential(): Promise<string | null> {
    if (!observationUrl) {
      return null;
    }
    credentialPromise ??= bootstrap(options.fetch, observationUrl);
    const credential = await credentialPromise;
    if (!credential) {
      credentialPromise = null;
    }
    return credential;
  }

  return Object.freeze({
    record(): void {
      if (!observationUrl) {
        return;
      }
      void (async () => {
        try {
          const credential = await readCredential();
          if (!credential) {
            return;
          }
          const eventId = createEventId();
          if (!EVENT_ID_PATTERN.test(eventId)) {
            return;
          }
          await options.fetch(`${observationUrl}/receipts`, {
            body: JSON.stringify({ eventId }),
            credentials: "omit",
            headers: {
              Accept: "application/json",
              Authorization: `LiveObservation ${credential}`,
              "Content-Type": "application/json",
            },
            method: "POST",
          });
        } catch {
          // Live Observation reporting is best-effort and must not break participation.
        }
      })();
    },
  });
}

function readObservationUrl(locationHref: string | undefined): string | null {
  if (!locationHref) {
    return null;
  }
  try {
    const candidate = new URL(locationHref).searchParams.get(
      OBSERVATION_URL_PARAMETER,
    );
    if (!candidate) {
      return null;
    }
    const observationUrl = new URL(candidate);
    if (
      observationUrl.protocol !== "https:" ||
      observationUrl.username !== "" ||
      observationUrl.password !== "" ||
      observationUrl.search !== "" ||
      observationUrl.hash !== "" ||
      !OBSERVATION_PATH_PATTERN.test(observationUrl.pathname)
    ) {
      return null;
    }
    return observationUrl.toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
}

async function bootstrap(
  fetchImplementation: typeof globalThis.fetch,
  observationUrl: string,
): Promise<string | null> {
  try {
    const response = await fetchImplementation(`${observationUrl}/bootstrap`, {
      credentials: "omit",
      headers: { Accept: "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      return null;
    }
    const body: unknown = await response.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("credential" in body) ||
      typeof body.credential !== "string" ||
      !CREDENTIAL_PATTERN.test(body.credential)
    ) {
      return null;
    }
    return body.credential;
  } catch {
    return null;
  }
}

function createUuid(): string {
  return globalThis.crypto.randomUUID();
}
