/**
 * Minimal IndexedDB wrapper for storing draft video Blobs.
 *
 * Video blobs are too large for localStorage (5-10 MB+), so we use IndexedDB
 * which has generous storage limits. Keys follow the pattern:
 *   draftVideo:${sessionId}:${promptIndex}
 *
 * The module lazily opens a single database ("promptly-drafts", version 1)
 * with one object store ("videoBlobs").
 */

const DB_NAME = "promptly-drafts";
const DB_VERSION = 1;
const STORE_NAME = "videoBlobs";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

/** Build the canonical key for a draft video blob. */
export function draftVideoKey(sessionId: string, promptIndex: number): string {
  return `draftVideo:${sessionId}:${promptIndex}`;
}

/** Store a video Blob in IndexedDB. */
export async function saveDraftVideoBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Retrieve a video Blob from IndexedDB. Returns null if not found. */
export async function loadDraftVideoBlob(key: string): Promise<Blob | null> {
  const db = await openDB();
  return new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
    req.onerror = () => reject(req.error);
  });
}

/** Delete a draft video Blob from IndexedDB. */
export async function deleteDraftVideoBlob(key: string): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
