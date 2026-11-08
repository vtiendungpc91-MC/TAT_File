// File sao lưu tự động. Trình duyệt máy tính (Chrome/Edge) cho app ghi đè trực tiếp vào file đã chọn.
// iPhone/Android chưa có API này: mỗi lần lưu phải qua bảng Chia sẻ (views.js xử lý nhánh đó).
import { exportAll } from './store.js';

export const AUTO_FILE_NAME = 'sothuchi-tu-dong.json';
const STATUS_KEY = 'stc-autosave';
const META_DB = 'sothuchi_meta';

export const canPickFile = () => typeof window.showSaveFilePicker === 'function';

export function saveStatus() {
  try { return JSON.parse(localStorage.getItem(STATUS_KEY) || 'null'); } catch { return null; }
}
export function markSaved(name) {
  localStorage.setItem(STATUS_KEY, JSON.stringify({ name, at: Date.now() }));
}

function openMeta() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(META_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function metaTx(mode, fn) {
  const d = await openMeta();
  try {
    return await new Promise((resolve, reject) => {
      const t = d.transaction('kv', mode);
      const r = fn(t.objectStore('kv'));
      t.oncomplete = () => resolve(r.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally { d.close(); }
}
const loadHandle = () => metaTx('readonly', (os) => os.get('handle'));
const storeHandle = (h) => metaTx('readwrite', (os) => os.put(h, 'handle'));

export const backupJson = async () => JSON.stringify(await exportAll());

// ---------- Mã hóa file sao lưu bằng mật khẩu 4 số ----------
// PBKDF2-SHA256 sinh khóa từ mật khẩu, AES-GCM mã hóa nội dung. Sai mật khẩu thì AES-GCM báo lỗi, không ra dữ liệu.
const PBKDF2_ITER = 310000;
export const BACKUP_PIN_RE = /^\d{4}$/;
const toB64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function pinKey(pin, salt, iter) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export const isEncryptedBackup = (d) => !!d && d.app === 'sothuchi' && d.enc === 'aes-gcm';
/** Trả về nội dung file (JSON) đã mã hóa. */
export async function encryptBackup(json, pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await pinKey(pin, salt, PBKDF2_ITER);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(json));
  return JSON.stringify({ app: 'sothuchi', enc: 'aes-gcm', kdf: 'pbkdf2-sha256', iter: PBKDF2_ITER, exportedAt: new Date().toISOString(), salt: toB64(salt), iv: toB64(iv), data: toB64(data) });
}
/** Giải mã; sai mật khẩu thì báo lỗi. */
export async function decryptBackup(file, pin) {
  const key = await pinKey(pin, fromB64(file.salt), Number(file.iter) || PBKDF2_ITER);
  let plain;
  try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(file.iv) }, key, fromB64(file.data)); } catch { throw new Error('Sai mật khẩu'); }
  return JSON.parse(new TextDecoder().decode(plain));
}

async function writeTo(handle, json) {
  const w = await handle.createWritable();
  await w.write(json);
  await w.close();
  markSaved(handle.name);
}

/** Chọn nơi lưu và tạo ngay file sao lưu tại đó. Trả về tên file. */
export async function pickBackupFile(json) {
  const handle = await window.showSaveFilePicker({
    suggestedName: AUTO_FILE_NAME,
    types: [{ description: 'Sao lưu Sổ Thu Chi', accept: { 'application/json': ['.json'] } }],
  });
  await writeTo(handle, json);
  await storeHandle(handle);
  return handle.name;
}

/** Ghi đè vào file đã chọn. Trả về tên file, hoặc null nếu chưa chọn file. */
export async function saveToPickedFile(json) {
  const handle = await loadHandle();
  if (!handle) return null;
  const opts = { mode: 'readwrite' };
  if (await handle.queryPermission(opts) !== 'granted' && await handle.requestPermission(opts) !== 'granted') {
    throw new Error('Chưa được cấp quyền ghi vào file sao lưu');
  }
  await writeTo(handle, json);
  return handle.name;
}
