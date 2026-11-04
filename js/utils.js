// Tiện ích chung: định dạng tiền, ngày tháng, kỳ báo cáo, đọc số tiền gõ tắt.

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// ---------- Tiền ----------
const nfVi = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const nfVi2 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
export const fmtNum = (n) => nfVi.format(Math.round(n || 0));
export const fmt = (n) => fmtNum(n) + ' ₫';
export const fmtSigned = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtNum(Math.abs(n)) + ' ₫';
export const fmtCur = (amount, code) => (!code || code === 'VND' ? fmt(amount) : nfVi2.format(amount) + ' ' + code);

const oneDec = (x) => (Math.round(x * 10) / 10).toString().replace('.', ',');
export function fmtShort(n) {
  const a = Math.abs(n || 0), s = n < 0 ? '-' : '';
  if (a >= 1e9) return s + oneDec(a / 1e9) + ' tỷ';
  if (a >= 1e6) return s + oneDec(a / 1e6) + 'tr';
  if (a >= 1e3) return s + oneDec(a / 1e3) + 'k';
  return s + Math.round(a);
}

const UNITS = {
  k: 1e3, ng: 1e3, 'nghìn': 1e3, 'ngàn': 1e3, nghin: 1e3, ngan: 1e3,
  tr: 1e6, 'triệu': 1e6, trieu: 1e6, m: 1e6, 'củ': 1e6, cu: 1e6,
  'tỷ': 1e9, 'tỉ': 1e9, ty: 1e9, ti: 1e9, b: 1e9,
};

/**
 * Đọc số tiền người dùng gõ: "50k", "1tr2" (=1.200.000), "2,5tr", "1.000.000", "12.5" (USD).
 * Trả về NaN nếu không hiểu.
 */
export function parseAmount(input) {
  if (input == null) return NaN;
  const s = String(input).toLowerCase().replace(/\s+/g, '')
    .replace(/đồng|dong|vnd/g, '').replace(/[₫đ]/g, '');
  if (!s) return NaN;
  const m = s.match(/^(\d+(?:[.,]\d+)*)([a-zà-ỹ]+)?(\d+)?$/);
  if (!m) return NaN;
  const [, num, unit, rest] = m;
  if (unit) {
    const mult = UNITS[unit];
    if (!mult) return NaN;
    // Có đơn vị: dấu . hoặc , là phần thập phân ("2,5tr"); số sau đơn vị là phần lẻ ("1tr2").
    let v = parseFloat(num.replace(/[.,](?=.*[.,])/g, '').replace(',', '.'));
    if (rest) v += parseFloat('0.' + rest);
    return v * mult;
  }
  if (rest) return NaN;
  const seps = num.match(/[.,]/g) || [];
  // Không đơn vị: "1.000.000" hoặc "45.000" là phân cách hàng nghìn; "12.5" là thập phân.
  if (seps.length > 1 || /[.,]\d{3}$/.test(num)) return parseFloat(num.replace(/[.,]/g, ''));
  return parseFloat(num.replace(',', '.'));
}

// ---------- Ngày ----------
const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
// ---------- Giờ Việt Nam (UTC+7) ----------
// Ngày giao dịch và giờ ghi nhận luôn tính theo giờ Việt Nam, kể cả khi điện thoại đặt múi giờ khác.
const VN_TZ = 'Asia/Ho_Chi_Minh';
let vnFmt = null;
try {
  vnFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: VN_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
} catch { vnFmt = null; }

function vnParts(ts) {
  const d = new Date(ts);
  if (!vnFmt) {
    // Trình duyệt không hỗ trợ múi giờ: tự cộng UTC+7.
    const v = new Date(d.getTime() + 7 * 3600e3);
    return { year: v.getUTCFullYear(), month: pad(v.getUTCMonth() + 1), day: pad(v.getUTCDate()), hour: pad(v.getUTCHours()), minute: pad(v.getUTCMinutes()) };
  }
  const p = Object.fromEntries(vnFmt.formatToParts(d).map((x) => [x.type, x.value]));
  if (p.hour === '24') p.hour = '00';
  return p;
}
/** Ngày (YYYY-MM-DD) theo giờ Việt Nam của một thời điểm. */
export const vnDateISO = (ts = Date.now()) => { const p = vnParts(ts); return `${p.year}-${p.month}-${p.day}`; };
/** Giờ:phút theo giờ Việt Nam. */
export const fmtTimeVN = (ts) => { const p = vnParts(ts); return `${p.hour}:${p.minute}`; };
/** "08:35 · 03/11/2026" theo giờ Việt Nam. */
export const fmtDateTimeVN = (ts) => { const p = vnParts(ts); return `${p.hour}:${p.minute} · ${p.day}/${p.month}/${p.year}`; };

export const todayISO = () => vnDateISO();
export const addDays = (s, n) => {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
/** Cộng tháng, giữ "ngày neo" (vd: hạn ngày 31 → 28/2 → 31/3). */
export function addMonths(s, n, anchorDay) {
  const d = parseISO(s);
  const day = anchorDay || d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return toISO(t);
}
export const diffDays = (from, to) => Math.round((parseISO(to) - parseISO(from)) / 864e5);

const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
export const fmtDM = (s) => s.slice(8, 10) + '/' + s.slice(5, 7);
export const fmtDate = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
export function fmtDayHeader(s) {
  const t = todayISO();
  const rel = s === t ? 'Hôm nay' : s === addDays(t, -1) ? 'Hôm qua' : WD[parseISO(s).getDay()];
  return `${rel}, ${fmtDate(s)}`;
}
export function fmtDue(days) {
  if (days < 0) return `Quá hạn ${-days} ngày`;
  if (days === 0) return 'Hôm nay';
  if (days === 1) return 'Ngày mai';
  return `Còn ${days} ngày`;
}

export const FREQ_LABEL = { day: 'Hằng ngày', week: 'Hằng tuần', month: 'Hằng tháng', year: 'Hằng năm' };
export function nextDate(date, freq, interval = 1, anchorDay) {
  switch (freq) {
    case 'day': return addDays(date, interval);
    case 'week': return addDays(date, 7 * interval);
    case 'year': return addMonths(date, 12 * interval, anchorDay);
    default: return addMonths(date, interval, anchorDay);
  }
}

// ---------- Kỳ báo cáo ----------
export const PERIOD_LABEL = { day: 'Ngày', week: 'Tuần', month: 'Tháng', quarter: 'Quý', year: 'Năm', custom: 'Khoảng' };

/** Kỳ tự chọn từ ngày → đến ngày. */
export function customRange(from, to) {
  if (from > to) [from, to] = [to, from];
  return { type: 'custom', start: from, end: to, days: diffDays(from, to) + 1, label: `${fmtDate(from)} – ${fmtDate(to)}` };
}

export function getRange(type, anchor, weekStart = 1) {
  const d = parseISO(anchor);
  if (type === 'day') return { type, start: anchor, end: anchor, days: 1, label: fmtDayHeader(anchor) };
  if (type === 'quarter') {
    const y = d.getFullYear(), q = Math.floor(d.getMonth() / 3);
    const start = toISO(new Date(y, q * 3, 1)), end = toISO(new Date(y, q * 3 + 3, 0));
    return { type, start, end, days: diffDays(start, end) + 1, label: `Quý ${q + 1}/${y}` };
  }
  if (type === 'week') {
    const off = (d.getDay() - weekStart + 7) % 7;
    const start = addDays(anchor, -off);
    const end = addDays(start, 6);
    return { type, start, end, days: 7, label: `${fmtDM(start)} – ${fmtDM(end)}/${end.slice(0, 4)}` };
  }
  if (type === 'year') {
    const y = d.getFullYear();
    return { type, start: `${y}-01-01`, end: `${y}-12-31`, days: diffDays(`${y}-01-01`, `${y}-12-31`) + 1, label: `Năm ${y}` };
  }
  const y = d.getFullYear(), m = d.getMonth();
  const start = toISO(new Date(y, m, 1)), end = toISO(new Date(y, m + 1, 0));
  return { type: 'month', start, end, days: Number(end.slice(8)), label: `Tháng ${m + 1}/${y}` };
}

export function shiftAnchor(type, anchor, dir) {
  if (type === 'day') return addDays(anchor, dir);
  if (type === 'week') return addDays(anchor, 7 * dir);
  if (type === 'year') return `${parseISO(anchor).getFullYear() + dir}-01-01`;
  if (type === 'quarter') return addMonths(anchor, 3 * dir, 1);
  return addMonths(anchor, dir, 1);
}

/** Kỳ liền trước để so sánh (khoảng tự chọn: cùng số ngày ngay trước đó). */
export function prevRange(r, weekStart = 1) {
  if (r.type === 'custom') return customRange(addDays(r.start, -r.days), addDays(r.start, -1));
  return getRange(r.type, shiftAnchor(r.type, r.start, -1), weekStart);
}

/** Số ngày đã trôi qua của kỳ tính đến hôm nay (để tính trung bình/ngày). */
export function elapsedDays(range) {
  const t = todayISO();
  if (t < range.start) return 0;
  if (t > range.end) return range.days;
  return diffDays(range.start, t) + 1;
}

export const debounce = (fn, ms = 200) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

export const splitTags = (s) =>
  [...new Set(String(s || '').split(/[,;]/).map((x) => x.trim().replace(/^#/, '')).filter(Boolean))];
