// Khởi động app: tải dữ liệu, điều hướng theo hash, xử lý định kỳ, nhắc nhở, service worker.
import * as S from './store.js';
import { state } from './store.js';
import { actions, render, refresh, openTxForm } from './views.js';
import { toast, syncDatePick } from './ui.js';
import { lockConfig, showLock, initAutoLock } from './lock.js';
import { fmt, fmtDue } from './utils.js';

function parseHash() {
  const [route = 'home', sub = null] = location.hash.replace(/^#\/?/, '').split('/');
  return { route: route || 'home', sub };
}

function route() {
  const { route: r, sub } = parseHash();
  if (r === 'demo') {
    history.replaceState(null, '', '#/home');
    S.seedDemo().then((ok) => {
      render('home');
      toast(ok ? 'Đã nạp dữ liệu mẫu để xem thử' : 'Đã có dữ liệu — không nạp mẫu');
    });
    return;
  }
  if (r === 'add') {
    history.replaceState(null, '', '#/home');
    render('home');
    openTxForm({ type: sub === 'income' ? 'income' : 'expense' });
    return;
  }
  render(r, sub);
}

// Gom nhiều thay đổi liên tiếp thành 1 lần vẽ lại.
let pending = false;
S.onChange(() => {
  if (pending) return;
  pending = true;
  queueMicrotask(() => { pending = false; refresh(); });
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !actions[el.dataset.act]) return;
  e.preventDefault();
  Promise.resolve(actions[el.dataset.act](el, e)).catch((err) => {
    console.error(err);
    toast('Có lỗi: ' + err.message, 4000);
  });
});

// Chọn ngày ở thanh kỳ (ô date ẩn đè lên nhãn kỳ).
// Ô chọn ngày dạng "Ngày: dd/mm/yyyy": cập nhật chữ khi đổi ngày.
for (const ev of ['input', 'change']) {
  document.addEventListener(ev, (e) => { if (e.target.matches('.date-pick input[type=date]')) syncDatePick(e.target); });
}

document.addEventListener('change', (e) => {
  if (e.target.matches('[data-period-date], [data-range]')) actions['period-date'](e.target);
});

/** Gửi thông báo hệ thống cho các mục cần chú ý (mỗi mục 1 lần). */
async function notifyAlerts() {
  if (!state.settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker?.getRegistration();
  const sent = { ...(state.settings.notified || {}) };
  let changed = false;
  // Nhắc nhở thuộc User, không thuộc mục: nhớ riêng để đổi mục không báo lại.
  let remSent = {};
  try { remSent = JSON.parse(localStorage.getItem('stc-rem-notified')) || {}; } catch {}
  for (const a of [...S.getAlerts(), ...S.reminderAlerts(S.currentUser().id)]) {
    const log = a.kind === 'reminder' ? remSent : sent;
    if (log[a.key]) continue;
    const body = a.kind === 'budget'
      ? `Đã dùng ${Math.round(a.ratio * 100)}% ngân sách`
      : a.kind === 'reminder' ? fmtDue(a.days)
        : a.kind === 'cardpay' ? `${a.count} khoản chưa thanh toán · ${fmt(a.amount)}` : `${fmt(a.amount)} · ${fmtDue(a.days)}`;
    const title = { debt: '🏦 Trả nợ: ', pending: '⏳ Cần xác nhận: ', recurring: '🔁 Sắp đến hạn: ', budget: '⚠️ Ngân sách: ', reminder: '🔔 Nhắc nhở: ', cardpay: '💳 ' }[a.kind] + a.title;
    try {
      if (reg) await reg.showNotification(title, { body, tag: a.key, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: './#/home' } });
      else new Notification(title, { body, tag: a.key });
      log[a.key] = Date.now();
      changed = true;
    } catch (err) { console.warn(err); }
  }
  if (changed) {
    localStorage.setItem('stc-rem-notified', JSON.stringify(Object.fromEntries(Object.entries(remSent).sort((a, b) => b[1] - a[1]).slice(0, 100))));
    const keys = Object.entries(sent).sort((a, b) => b[1] - a[1]).slice(0, 300);
    await S.setSetting('notified', Object.fromEntries(keys), { silent: true });
  }
}

async function onResume() {
  const n = await S.processRecurring();
  if (n) toast(`Đã tự ghi ${n} giao dịch định kỳ`);
  refresh();
  notifyAlerts();
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Đã có bản cập nhật mới — đóng và mở lại app để dùng', 5000);
        }
      });
    });
  }).catch((err) => console.warn('SW lỗi', err));
}

async function start() {
  registerSW();
  initAutoLock();
  // Khóa trước khi vẽ dữ liệu để không lộ số liệu.
  if (lockConfig().enabled) await showLock();
  try {
    await S.loadAll();
  } catch (err) {
    document.getElementById('main').innerHTML = `<div class="empty"><div class="empty-i">⚠️</div><p>Không mở được bộ nhớ của trình duyệt.<br>${err.message}<br>Nếu đang ở chế độ ẩn danh, hãy mở ở chế độ thường.</p></div>`;
    return;
  }
  // Xin trình duyệt giữ dữ liệu lâu dài (không tự xóa khi máy đầy bộ nhớ).
  navigator.storage?.persist?.().catch(() => {});
  await S.processRecurring();
  window.addEventListener('hashchange', route);
  route();
  notifyAlerts();
  // App đang mở: đến giờ hẹn thì cập nhật số thông báo và gửi thông báo.
  let lastKeys = null;
  setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    const keys = (await S.userAlerts(S.currentUser().id)).map((a) => a.key).join();
    if (lastKeys !== null && keys !== lastKeys) { refresh(); notifyAlerts(); }
    lastKeys = keys;
  }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onResume();
  });
}

start();
