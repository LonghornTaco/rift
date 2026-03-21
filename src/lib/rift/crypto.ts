/**
 * Client-side credential encryption using Web Crypto API + IndexedDB.
 *
 * - A non-extractable AES-GCM key is generated once and stored in IndexedDB.
 * - Sensitive strings (e.g., clientSecret) are encrypted before writing to localStorage.
 * - The key cannot be read as raw bytes by JavaScript, only used for encrypt/decrypt operations.
 */

const DB_NAME = 'rift-keystore';
const DB_VERSION = 1;
const STORE_NAME = 'keys';
const KEY_ID = 'master';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt']
  );
}

async function storeKey(key: CryptoKey): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(key, KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadKey(): Promise<CryptoKey | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(KEY_ID);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  cachedKey = await loadKey();
  if (cachedKey) return cachedKey;

  cachedKey = await generateKey();
  await storeKey(cachedKey);
  return cachedKey;
}

export interface EncryptedValue {
  ct: string; // base64 ciphertext
  iv: string; // base64 IV
}

export async function encrypt(plaintext: string): Promise<EncryptedValue> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  return {
    ct: btoa(String.fromCharCode(...new Uint8Array(cipherBuffer))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

export async function decrypt(encrypted: EncryptedValue): Promise<string> {
  const key = await getKey();
  const iv = Uint8Array.from(atob(encrypted.iv), (c) => c.charCodeAt(0));
  const cipherBytes = Uint8Array.from(atob(encrypted.ct), (c) => c.charCodeAt(0));

  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    cipherBytes
  );

  return new TextDecoder().decode(plainBuffer);
}

/**
 * Check if a value is an encrypted object (has ct and iv fields)
 * vs. a plaintext string (for backward compatibility with existing data).
 */
export function isEncrypted(value: unknown): value is EncryptedValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ct' in value &&
    'iv' in value
  );
}
