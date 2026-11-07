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

async function writeTo(handle) {
  const json = await backupJson();
  const w = await handle.createWritable();
  await w.write(json);
  await w.close();
  markSaved(handle.name);
}

/** Chọn nơi lưu và tạo ngay file sao lưu tại đó. Trả về tên file. */
export async function pickBackupFile() {
  const handle = await window.showSaveFilePicker({
    suggestedName: AUTO_FILE_NAME,
    types: [{ description: 'Sao lưu Sổ Thu Chi', accept: { 'application/json': ['.json'] } }],
  });
  await writeTo(handle);
  await storeHandle(handle);
  return handle.name;
}

/** Ghi đè vào file đã chọn. Trả về tên file, hoặc null nếu chưa chọn file. */
export async function saveToPickedFile() {
  const handle = await loadHandle();
  if (!handle) return null;
  const opts = { mode: 'readwrite' };
  if (await handle.queryPermission(opts) !== 'granted' && await handle.requestPermission(opts) !== 'granted') {
    throw new Error('Chưa được cấp quyền ghi vào file sao lưu');
  }
  await writeTo(handle);
  return handle.name;
}
