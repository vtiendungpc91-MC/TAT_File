// Thành phần giao diện dùng chung: toast, bottom sheet, thanh chọn kỳ, chia sẻ/tải file.
import { esc, getRange, customRange, todayISO, addDays, fmtDate, PERIOD_LABEL } from './utils.js';

/**
 * Ô chọn ngày hiển thị dạng "Ngày: dd/mm/yyyy" (không phụ thuộc định dạng ngày của điện thoại).
 * Ô date thật nằm ẩn phía trên chữ, chạm vào sẽ mở lịch chọn ngày.
 */
export function datePick(id, value, label = 'Ngày', attrs = '') {
  return `<label class="date-pick"><span class="dp-text" data-label="${esc(label)}">${esc(label)}: <b>${value ? fmtDate(value) : 'chưa chọn'}</b></span>
    <span class="dp-ic">📅</span><input type="date" ${id ? `id="${id}"` : ''} value="${esc(value || '')}" aria-label="${esc(label)}" ${attrs}></label>`;
}
export function syncDatePick(inp) {
  const t = inp.closest('.date-pick')?.querySelector('.dp-text');
  if (!t) return;
  const d = inp.value ? fmtDate(inp.value) : 'chưa chọn';
  t.innerHTML = t.dataset.mini ? `<small>${esc(t.dataset.label)}</small><b>${d}</b>` : `${esc(t.dataset.label)}: <b>${d}</b>`;
}

/**
 * Hàng nhập tiền dùng chung cho Thu/Chi, Góp, Trích, Thẻ chi tiêu:
 * [Ngày 20%] [Ô số tiền 60%] [+000 20%].
 */
export function amountLine({ dateId, date, amtId, amount = '', label = 'Ngày', big = false }) {
  return `<div class="amt-line">
    <label class="date-pick mini"><span class="dp-text" data-label="${esc(label)}" data-mini="1"><small>${esc(label)}</small><b>${date ? fmtDate(date) : 'chưa chọn'}</b></span>
      <input type="date" id="${dateId}" value="${esc(date || '')}" aria-label="${esc(label)}"></label>
    <input id="${amtId}" class="${big ? 'amount-input' : 'money'}" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(amount)}" aria-label="Số tiền">
    <div class="zero-cell"><div class="zero-sug" data-zero-for="${amtId}" hidden></div></div>
  </div><em class="hint center" data-hint-for="${amtId}"></em>`;
}
import { state } from './store.js';

/** Trạng thái giao diện (không lưu vào DB). */
export const ui = {
  period: null, // Tổng quan + Giao dịch: { type: day|month, anchor }
  reportPeriod: null, // Báo cáo: { type: day|month|quarter|year|custom, anchor, from, to }
  txFilter: { type: 'all', q: '', categoryId: null, tag: null, accountId: null },
  reportType: 'expense',
  planTab: 'budget',
};

/** Các loại kỳ cho từng nơi: "main" = Tổng quan/Giao dịch, "report" = Báo cáo. */
export const PERIOD_TYPES = { main: ['day', 'month'], report: ['day', 'month', 'quarter', 'year', 'custom'], card: ['day', 'week', 'month', 'custom'] };
/** Mục Đầu tư và Tiết kiệm xem theo Ngày / Tuần / Tháng / Khoảng. */
const FUND_TYPES = ['day', 'week', 'month', 'custom'];
const typesFor = (key) => (key === 'main' && ['invest', 'saving'].includes(state.profileKind) ? FUND_TYPES : PERIOD_TYPES[key]);

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
// Gõ "45" → gợi ý nút [+000] → "45.000"; gõ tắt "1tr2", "50k" vẫn dùng được.
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
      (inp.closest('.amount-row') || inp).insertAdjacentElement('afterend', box);
    }
    inp._zeroBox = box;
    // Giữ bàn phím khi bấm gợi ý.
    box.addEventListener('pointerdown', (e) => e.preventDefault());
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-zero]');
      if (!b) return;
      inp.value = groupDigits(inp.value.replace(/\./g, '') + b.dataset.zero);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.focus();
    });
  }
  const digits = inp.value.replace(/\./g, '');
  if (isVndInput(inp) && /^\d{1,7}$/.test(digits) && Number(digits) > 0) {
    box.innerHTML = '<button type="button" class="chip" data-zero="000">+000</button>';
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

let toastTimer;
export function toast(msg, ms = 2400) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

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
  document.body.classList.add('noscroll');
  requestAnimationFrame(() => wrap.classList.add('open'));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.classList.remove('open');
    setTimeout(() => {
      wrap.remove();
      if (!document.querySelector('.sheet-wrap')) document.body.classList.remove('noscroll');
    }, 220);
    onClose && onClose();
  };
  wrap.querySelector('.sheet-bg').addEventListener('click', close);
  wrap.querySelector('[data-close]').addEventListener('click', close);
  const sheet = wrap.querySelector('.sheet');
  onMount && onMount(sheet, close);
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
    <div class="seg${typesFor(key).length > 3 ? ' small' : ''}">${typesFor(key).map((t) =>
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
