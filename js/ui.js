// Thành phần giao diện dùng chung: toast, bottom sheet, thanh chọn kỳ, chia sẻ/tải file.
import { esc, getRange, customRange, todayISO, addDays, fmtDate, PERIOD_LABEL } from './utils.js';

/**
 * Ô chọn ngày hiển thị dạng "Ngày: dd/mm/yyyy" (không phụ thuộc định dạng ngày của điện thoại).
 * Ô date thật nằm ẩn phía trên chữ, chạm vào sẽ mở lịch chọn ngày.
 */
export function datePick(id, value, label = 'Ngày', attrs = '') {
  return `<label class="date-pick${/disabled/.test(attrs) ? ' fixed' : ''}"><span class="dp-text" data-label="${esc(label)}">${esc(label)}: <b>${value ? fmtDate(value) : 'chưa chọn'}</b></span>
    <span class="dp-ic">📅</span><input type="date" ${id ? `id="${id}"` : ''} value="${esc(value || '')}" aria-label="${esc(label)}" ${attrs}></label>`;
}
export function syncDatePick(inp) {
  const t = inp.closest('.date-pick')?.querySelector('.dp-text');
  if (!t) return;
  const d = inp.value ? fmtDate(inp.value) : 'chưa chọn';
  t.innerHTML = t.dataset.mini ? `<small>${esc(t.dataset.label)}</small><b>${d}</b>` : `${esc(t.dataset.label)}: <b>${d}</b>`;
}

/** Ô tiền kèm nút +000 nằm bên phải, ngoài ô nhập. */
export const moneyBox = (input) => `<div class="money-box">${input}<button type="button" class="plus000" data-plus000 tabindex="-1" aria-label="Thêm 000">+000</button></div>`;

/**
 * Hàng nhập tiền dùng chung: [Ngày 30%] [Ô số tiền], đề xuất số tiền ở dưới.
 * Ghi mới thì ngày cố định; chỉ sửa ngày được khi sửa giao dịch (editDate = true).
 */
export function amountLine({ dateId, date, amtId, amount = '', label = 'Ngày', big = false, editDate = false, after = '' }) {
  return `<div class="amt-line">
    <label class="date-pick mini${editDate ? '' : ' fixed'}"><span class="dp-text" data-label="${esc(label)}" data-mini="1"><small>${esc(label)}</small><b>${date ? fmtDate(date) : 'chưa chọn'}</b></span>
      <input type="date" id="${dateId}" value="${esc(date || '')}" aria-label="${esc(label)}" ${editDate ? '' : 'disabled'}></label>
    ${moneyBox(`<input id="${amtId}" class="${big ? 'amount-input' : 'money'}" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(amount)}" aria-label="Số tiền">`)}
  </div><div class="zero-sug" data-zero-for="${amtId}" hidden></div>${after}<em class="hint center" data-hint-for="${amtId}"></em>`;
}
import { state } from './store.js';

/** Trạng thái giao diện (không lưu vào DB). */
export const ui = {
  period: null, // Tổng quan + Giao dịch: { type: day|month, anchor }
  reportPeriod: null, // Báo cáo: { type: day|month|quarter|year|custom, anchor, from, to }
  txFilter: { type: 'all', q: '', categoryIds: [], tag: null },
  reportType: 'expense',
  planTab: 'budget',
};

/** Các loại kỳ cho từng nơi: "main" = Tổng quan/Giao dịch, "report" = Báo cáo. */
export const PERIOD_TYPES = { main: ['day', 'week', 'month', 'custom'], report: ['day', 'month', 'quarter', 'year', 'custom'], card: ['day', 'week', 'month', 'custom'] };

export function periodState(key = 'main') {
  if (key === 'report' || key === 'card') {
    const prop = key === 'report' ? 'reportPeriod' : 'cardPeriod';
    if (!ui[prop]) {
      const t = todayISO();
      // Mặc định xem theo ngày mỗi khi mở một mục.
      ui[prop] = { type: 'day', anchor: t, from: addDays(t, -6), to: t };
    }
    return ui[prop];
  }
  if (!ui.period) { const t = todayISO(); ui.period = { type: 'day', anchor: t, from: addDays(t, -6), to: t }; }
  return ui.period;
}

function rangeOf(p) {
  return p.type === 'custom' ? customRange(p.from, p.to) : getRange(p.type, p.anchor, state.settings.weekStart);
}
export const currentRange = () => rangeOf(periodState('main'));
export const reportRange = () => rangeOf(periodState('report'));
export const rangeFor = (key) => rangeOf(periodState(key));

// ---------- Ô nhập số tiền: phân cách hàng nghìn + gợi ý thêm 000 ----------
// Áp dụng cho mọi ô tiền (class money, amount-input hoặc có data-money).
// Đề xuất số tiền theo số chữ số đã gõ (x10 mũ): 1 số → 4,5,6; 2 số → 3,4,5; 3 số → 2,3,4; 4 số → 2,3; từ 5 số không đề xuất.
// Gõ tắt "1tr2", "50k" vẫn dùng được.
const SUGGEST_POWERS = { 1: [4, 5, 6], 2: [3, 4, 5], 3: [2, 3, 4], 4: [2, 3] };
const MONEY_SEL = 'input.money, input.amount-input, input[data-money]';
export const groupDigits = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Ô đang nhập ngoại tệ (USD…) thì không tự chèn dấu chấm để còn gõ số thập phân. */
function isVndInput(inp) {
  const cur = inp.form && inp.form.querySelector('#tf-cur');
  return !cur || cur.value === 'VND';
}

function reformatMoney(inp) {
  const v = inp.value;
  // Chỉ định dạng khi toàn chữ số/dấu chấm; có chữ (k, tr) hoặc dấu phẩy thì để nguyên cho cách gõ tắt.
  if (!/^[\d.]+$/.test(v) || v.endsWith('.')) return;
  const digits = v.replace(/\./g, '').replace(/^0+(?=\d)/, '');
  const nv = groupDigits(digits);
  if (nv !== v) {
    inp.value = nv;
    try { inp.setSelectionRange(nv.length, nv.length); } catch { /* một số ô không hỗ trợ */ }
  }
}

function zeroSuggest(inp) {
  let box = inp._zeroBox;
  if (!box || !box.isConnected) {
    // Form có chỗ đặt sẵn (cạnh ô Danh mục) thì dùng chỗ đó, không thì chèn ngay dưới ô tiền.
    box = (inp.form && inp.id && inp.form.querySelector(`[data-zero-for="${inp.id}"]`)) || null;
    if (!box) {
      box = document.createElement('div');
      box.className = 'zero-sug';
      (inp.closest('.split-row') || inp.closest('.money-box') || inp).insertAdjacentElement('afterend', box);
    }
    inp._zeroBox = box;
    // Giữ bàn phím khi bấm gợi ý.
    box.addEventListener('pointerdown', (e) => e.preventDefault());
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-val]');
      if (!b) return;
      inp.value = groupDigits(b.dataset.val);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      inp.focus();
    });
  }
  const digits = inp.value.replace(/\./g, '');
  const powers = SUGGEST_POWERS[digits.length];
  if (isVndInput(inp) && powers && /^\d+$/.test(digits) && Number(digits) > 0) {
    box.innerHTML = powers.map((p) => {
      const v = String(Number(digits) * 10 ** p);
      return `<button type="button" class="chip" data-val="${v}">${groupDigits(v)}</button>`;
    }).join('');
    box.hidden = false;
  } else {
    box.hidden = true;
  }
}

document.addEventListener('input', (e) => {
  const inp = e.target;
  if (!inp.matches || !inp.matches(MONEY_SEL)) return;
  if (isVndInput(inp)) reformatMoney(inp);
  zeroSuggest(inp);
});

// Nút +000 trong ô tiền: giữ bàn phím khi bấm, chỉ thêm khi ô đang là số (bỏ qua ô trống và cách gõ tắt 1tr2, 50k).
document.addEventListener('pointerdown', (e) => { if (e.target.closest?.('[data-plus000]')) e.preventDefault(); });
document.addEventListener('mousedown', (e) => { if (e.target.closest?.('[data-plus000]')) e.preventDefault(); });
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-plus000]');
  if (!b) return;
  const inp = b.parentElement.querySelector('input');
  if (/^\d[\d.]*$/.test(inp.value)) {
    inp.value = `${inp.value.replace(/\./g, '')}000`;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }
  inp.focus();
});

// ---------- Chế độ sáng / tối ----------
export const isDark = () => document.documentElement.classList.contains('dark');
export function toggleTheme() {
  const dark = !isDark();
  document.documentElement.classList.toggle('dark', dark);
  document.getElementById('theme-color').content = dark ? '#0d1117' : '#1f6feb';
  localStorage.setItem('stc-theme', dark ? 'dark' : 'light');
  return dark;
}

let toastTimer;
export function toast(msg, ms = 2400) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- Khóa màn hình phía sau khi đang mở bottom sheet ----------
// Safari trên iPhone bỏ qua overflow:hidden của body, nên phải ghim body lại và nhớ vị trí cuộn.
let pageLocked = false, lockedY = 0;
// --lock-y giữ phần đầu cố định của màn hình đứng đúng chỗ trong lúc trang bị ghim.
function setLockedTop(y) {
  document.body.style.top = `-${y}px`;
  document.body.style.setProperty('--lock-y', `${y}px`);
}
function lockPage() {
  if (pageLocked) return;
  pageLocked = true;
  lockedY = window.scrollY;
  setLockedTop(lockedY);
  document.body.classList.add('noscroll');
}
function unlockPage() {
  if (!pageLocked) return;
  pageLocked = false;
  document.body.classList.remove('noscroll');
  document.body.style.top = '';
  document.body.style.removeProperty('--lock-y');
  window.scrollTo(0, lockedY);
}
/** Vẽ lại màn hình phía sau: giữ vị trí nếu cùng màn hình, về đầu nếu đã chuyển màn hình. */
export function restorePageScroll(sameView, y) {
  if (pageLocked) {
    if (!sameView) { lockedY = 0; setLockedTop(0); }
    return;
  }
  window.scrollTo(0, sameView ? y : 0);
}
/** Vuốt trong sheet: chỉ cho vùng còn cuộn được chạy; hết chỗ cuộn hoặc vuốt vào vùng ngoài thì chặn, tránh cả trang bị kéo theo. */
function guardSheetTouch(wrap) {
  let lastX = 0, lastY = 0;
  wrap.addEventListener('touchstart', (e) => { lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; }, { passive: true });
  wrap.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) return;
    const dx = e.touches[0].clientX - lastX, dy = e.touches[0].clientY - lastY;
    lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
    if (Math.abs(dx) > Math.abs(dy)) return; // Vuốt ngang: dải nút cuộn ngang.
    for (let el = e.target; el && el !== wrap; el = el.parentElement) {
      if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY) || el.scrollHeight <= el.clientHeight + 1) continue;
      const atTop = el.scrollTop <= 0, atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if ((dy > 0 && !atTop) || (dy < 0 && !atEnd) || dy === 0) return;
    }
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  // Bàn phím iPhone đóng lại có thể để lệch trang, làm chỗ bấm không khớp chỗ hiển thị.
  wrap.addEventListener('focusout', () => {
    setTimeout(() => {
      if (pageLocked && !document.activeElement?.matches?.('input, select, textarea')) window.scrollTo(0, 0);
    }, 100);
  });
}

// Sheet vừa đóng trong cùng lượt xử lý: sheet mở ngay sau đó thay thế tức thì, không trượt xuống rồi trượt lên.
let justClosed = null;

/** Mở bottom sheet. onMount(sheetEl, close) để gắn sự kiện cho form. */
/** headAction: HTML đặt ở góc phải thanh tiêu đề (vd: nút Lưu của form). */
export function openSheet({ title, body, onMount, onClose, wide = false, headAction = '' }) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-bg"></div>
    <div class="sheet${wide ? ' wide' : ''}" role="dialog" aria-modal="true">
      <div class="sheet-head">
        <button type="button" class="icon-btn" data-close aria-label="Đóng">✕</button>
        <h3>${esc(title)}</h3>${headAction || '<span class="sp"></span>'}
      </div>
      <div class="sheet-body">${body}</div>
    </div>`;
  document.body.appendChild(wrap);
  lockPage();
  guardSheetTouch(wrap);
  if (justClosed) {
    justClosed.remove();
    justClosed = null;
    wrap.classList.add('no-anim', 'open');
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.remove('no-anim')));
  } else {
    requestAnimationFrame(() => wrap.classList.add('open'));
  }
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.classList.remove('open');
    justClosed = wrap;
    queueMicrotask(() => { if (justClosed === wrap) justClosed = null; });
    setTimeout(() => {
      wrap.remove();
      if (!document.querySelector('.sheet-wrap')) unlockPage();
    }, 220);
    onClose && onClose();
  };
  wrap.querySelector('.sheet-bg').addEventListener('click', close);
  wrap.querySelector('[data-close]').addEventListener('click', close);
  const sheet = wrap.querySelector('.sheet');
  onMount && onMount(sheet, close);
  // Mỗi mục chỉ có 1 tài khoản: ô tài khoản chỉ để xem, không bấm chọn được.
  const lockAccounts = () => sheet.querySelectorAll('select[data-acc]').forEach((s) => { s.disabled = s.options.length <= 1; });
  lockAccounts();
  new MutationObserver(lockAccounts).observe(sheet, { childList: true, subtree: true });
  return close;
}

export function periodBar(key = 'main') {
  const p = periodState(key);
  const r = rangeOf(p);
  const k = `data-p="${key}"`;
  const nav = p.type === 'custom'
    ? `<div class="range-pick">
        ${datePick('', p.from, 'Từ ngày', `${k} data-range="from"`)}
        ${datePick('', p.to, 'Đến ngày', `${k} data-range="to"`)}
      </div><p class="muted small center">${esc(r.label)} · ${r.days} ngày</p>`
    : `<div class="period-nav">
        <button type="button" class="icon-btn" data-act="period-shift" ${k} data-v="-1" aria-label="Kỳ trước">‹</button>
        <label class="period-label" title="Chọn ngày">${esc(r.label)} <span class="cal">📅</span>
          <input type="date" ${k} data-period-date value="${esc(p.anchor)}" aria-label="Chọn ngày"></label>
        <button type="button" class="icon-btn" data-act="period-shift" ${k} data-v="1" aria-label="Kỳ sau">›</button>
      </div>
      ${todayISO() < r.start || todayISO() > r.end ? `<button type="button" class="link center" data-act="period-today" ${k}>↺ Về ${p.type === 'day' ? 'hôm nay' : 'kỳ hiện tại'}</button>` : ''}`;
  return `
  <div class="period">
    <div class="seg${PERIOD_TYPES[key].length > 3 ? ' small' : ''}">${PERIOD_TYPES[key].map((t) =>
      `<button type="button" data-act="period-type" ${k} data-v="${t}" class="${p.type === t ? 'on' : ''}">${PERIOD_LABEL[t]}</button>`).join('')}
    </div>
    ${nav}
  </div>`;
}

export const progress = (ratio, cls = '') => {
  const pct = Math.max(0, Math.min(100, ratio * 100));
  const tone = ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok';
  return `<div class="bar ${cls}"><i class="${tone}" style="width:${pct.toFixed(1)}%"></i></div>`;
};

export const empty = (icon, text) => `<div class="empty"><div class="empty-i">${icon}</div><p>${text}</p></div>`;

/** Chia sẻ file (iOS/Android share sheet), nếu không được thì tải về. */
export async function shareOrDownload(filename, content, mime) {
  const file = new File([content], filename, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  download(filename, file);
}

export function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Mở file lịch .ics: trên iOS Safari sẽ hiện "Thêm vào Lịch", Android mở bằng app Lịch. */
export function openCalendarFile(filename, ics) {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) {
    // iOS: mở trực tiếp data URL để hệ thống hỏi thêm vào Lịch.
    const reader = new FileReader();
    reader.onload = () => { window.location.href = reader.result; };
    reader.readAsDataURL(blob);
    return;
  }
  shareOrDownload(filename, ics, 'text/calendar');
}

/** Nén ảnh hóa đơn trước khi lưu để tiết kiệm bộ nhớ. */
export function compressImage(file, max = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Không nén được ảnh'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được ảnh')); };
    img.src = url;
  });
}
