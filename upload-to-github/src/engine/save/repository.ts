import type { KillaListing } from '../../state/store';

/** Storage boundary. V1 is local (IndexedDB); a CloudRepository can implement the same contract. */
export interface KillaRepository {
  list(): Promise<KillaListing[]>;
  load(id: string): Promise<Blob | null>;
  save(listing: KillaListing, file: Blob): Promise<void>;
  remove(id: string): Promise<void>;
}

const DB = 'majha-killa';
const FILES = 'files';
const LISTINGS = 'listings';

function openDb(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version ? indexedDB.open(DB, version) : indexedDB.open(DB);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
      if (!db.objectStoreNames.contains(LISTINGS)) db.createObjectStore(LISTINGS, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // A database that exists without our stores (e.g. created by something else) can't be used:
      // bump the version once so onupgradeneeded creates them.
      if (!db.objectStoreNames.contains(FILES) || !db.objectStoreNames.contains(LISTINGS)) {
        const next = db.version + 1;
        db.close();
        openDb(next).then(resolve, reject);
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Storage is busy in another tab — close other Majha Killa tabs and reload.'));
  });
}

function tx<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result: T | undefined;
    const req = fn(t);
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export class LocalRepository implements KillaRepository {
  private db: Promise<IDBDatabase> | null = null;
  private getDb() {
    if (!this.db) this.db = openDb();
    return this.db;
  }

  async list(): Promise<KillaListing[]> {
    const db = await this.getDb();
    const all = (await tx<KillaListing[]>(db, [LISTINGS], 'readonly', (t) => t.objectStore(LISTINGS).getAll())) ?? [];
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string): Promise<Blob | null> {
    const db = await this.getDb();
    return ((await tx<Blob>(db, [FILES], 'readonly', (t) => t.objectStore(FILES).get(id))) as Blob | undefined) ?? null;
  }

  async save(listing: KillaListing, file: Blob): Promise<void> {
    const db = await this.getDb();
    await tx(db, [FILES, LISTINGS], 'readwrite', (t) => {
      t.objectStore(FILES).put(file, listing.id);
      t.objectStore(LISTINGS).put(listing);
    });
  }

  async remove(id: string): Promise<void> {
    const db = await this.getDb();
    await tx(db, [FILES, LISTINGS], 'readwrite', (t) => {
      t.objectStore(FILES).delete(id);
      t.objectStore(LISTINGS).delete(id);
    });
  }
}

export const lastOpened = {
  get(): string | null {
    try { return localStorage.getItem('mk:last'); } catch { return null; }
  },
  set(id: string) {
    try { localStorage.setItem('mk:last', id); } catch { /* storage unavailable */ }
  },
};
