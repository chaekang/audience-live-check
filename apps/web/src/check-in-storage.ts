import { z } from "zod";

const STORAGE_KEY = "live-check-in-session";

const memoryEntries = new Map<string, string>();
const memoryTombstones = new Set<string>();
const memoryStorage: Storage = {
  get length(): number {
    return memoryEntries.size;
  },
  clear(): void {
    memoryEntries.clear();
  },
  getItem(key: string): string | null {
    return memoryEntries.get(key) ?? null;
  },
  key(index: number): string | null {
    return Array.from(memoryEntries.keys())[index] ?? null;
  },
  removeItem(key: string): void {
    memoryEntries.delete(key);
  },
  setItem(key: string, value: string): void {
    memoryEntries.set(key, value);
  },
};

const storedSessionSchema = z.object({
  sessionToken: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
  heartbeatIntervalMs: z.number().int().positive(),
});

export type StoredSession = z.infer<typeof storedSessionSchema>;

function getLocalStorage(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function readStorageValue(key: string): string | null {
  const memoryValue = memoryStorage.getItem(key);
  if (memoryValue !== null) {
    return memoryValue;
  }
  if (memoryTombstones.has(key)) {
    return null;
  }

  const storage = getLocalStorage();
  if (storage === null) {
    memoryTombstones.add(key);
    return null;
  }

  try {
    return storage.getItem(key);
  } catch {
    memoryTombstones.add(key);
    return null;
  }
}

function writeStorageValue(key: string, value: string): void {
  const storage = getLocalStorage();
  if (storage === null) {
    memoryStorage.setItem(key, value);
    memoryTombstones.delete(key);
    return;
  }

  try {
    storage.setItem(key, value);
    memoryStorage.removeItem(key);
    memoryTombstones.delete(key);
  } catch {
    memoryStorage.setItem(key, value);
    memoryTombstones.delete(key);
  }
}

function removeStorageValue(key: string): void {
  memoryStorage.removeItem(key);
  const storage = getLocalStorage();
  if (storage === null) {
    memoryTombstones.add(key);
    return;
  }

  try {
    storage.removeItem(key);
    memoryTombstones.delete(key);
  } catch {
    memoryTombstones.add(key);
  }
}

export function readStoredSession(now = Date.now()): StoredSession | null {
  const raw = readStorageValue(STORAGE_KEY);
  if (raw === null) {
    return null;
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) {
      removeStorageValue(STORAGE_KEY);
      return null;
    }
    throw error;
  }

  const parsed = storedSessionSchema.safeParse(candidate);
  if (!parsed.success || Date.parse(parsed.data.expiresAt) <= now) {
    removeStorageValue(STORAGE_KEY);
    return null;
  }

  return parsed.data;
}

export function saveStoredSession(session: StoredSession): void {
  writeStorageValue(STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredSession(): void {
  removeStorageValue(STORAGE_KEY);
}
