// SPDX-License-Identifier: GPL-2.0-or-later
// The extension's secrets (WS-E2 B10): the browser token and a pending
// pairing's device code. They live in the extension origin's IndexedDB,
// which a content script (running in a page's origin) cannot open --
// unlike chrome.storage, which content scripts can read and observe.

const DB = "downloadpulse";
const STORE = "secrets";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = act(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

/**
 * ``token``: an earlier build's single token slot, read only to move it (connection.ts).
 * ``identity@<server>``: that server proves its identity for its token (identity.ts, 1.0.8).
 */
export type SecretName = "token" | `token@${string}` | `identity@${string}` | "device";

export async function secret(name: SecretName): Promise<string | null> {
  const value = await run("readonly", (store) => store.get(name) as IDBRequest<unknown>);
  return typeof value === "string" && value ? value : null;
}

export async function setSecret(name: SecretName, value: string | null): Promise<void> {
  await run("readwrite", (store) => (value === null ? store.delete(name) : store.put(value, name)) as IDBRequest<unknown>);
}
