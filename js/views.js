// Các màn hình và form của app.
import * as S from './store.js';
import { state } from './store.js';
import {
  ui, currentRange, reportRange, rangeFor, periodState, datePick, amountLine, toast, openSheet, periodBar, progress, empty, shareOrDownload, download, openCalendarFile, compressImage,
} from './ui.js';
import {
  esc, fmt, fmtNum, fmtCur, fmtSigned, fmtShort, fmtDate, fmtDayHeader, fmtDue, parseAmount, todayISO, addDays, diffDays,
  getRange, shiftAnchor, prevRange, elapsedDays, parseISO, nextDate, FREQ_LABEL, PERIOD_LABEL, splitTags, debounce, addMonths,
  fmtDM, vnDateISO, fmtTimeVN, fmtDateTimeVN,
} from './utils.js';
import { donut, bars } from './charts.js';
import { iconPickerHtml, bindIconPicker } from './icons.js';
import { buildAllDayICS, buildDailyICS } from './ics.js';
import { lockConfig, isDefaultPin, DEFAULT_PIN, checkPin, setPin, setLockEnabled, setLockDelay } from './lock.js';

export const actions = {};
const $ = (root, sel) => root.querySelector(sel);

// ================= Thành phần nhỏ =================
const UNKNOWN_CAT = { name: 'Không rõ', icon: '❔', color: '#888' };
const catIcon = (c) => `<span class="ci" style="--c:${esc((c || UNKNOWN_CAT).color)}">${esc((c || UNKNOWN_CAT).icon)}</span>`;
const accName = (id) => S.accById(id)?.name || '—';
const TYPE_LABEL = { expense: 'Chi', income: 'Thu', transfer: 'Chuyển khoản' };
const PAY_METHODS = ['Chuyển khoản qua app ngân hàng', 'Withdraw nợ tự động', 'Nộp tiền mặt tại quầy', 'Ví điện tử (MoMo, ZaloPay...)', 'Khác'];
const BANKS = ['Vietcombank', 'VietinBank', 'BIDV', 'Agribank', 'Techcombank', 'MB Bank', 'ACB', 'VPBank', 'TPBank', 'Sacombank',
  'HDBank', 'VIB', 'SHB', 'SeABank', 'OCB', 'MSB', 'LPBank', 'Eximbank', 'Nam A Bank', 'Bac A Bank', 'ABBANK', 'Shinhan Bank',
  'HSBC', 'Standard Chartered', 'UOB', 'Cake by VPBank', 'Timo', 'FE Credit', 'Home Credit', 'HD Saison', 'Mcredit', 'Mirae Asset'];

/**
 * Ngày giao dịch + giờ ghi nhận (giờ Việt Nam).
 * Ghi đúng ngày: "🕒 03/11/2026 · 08:35". Ghi bù ngày khác: "🕒 01/11/2026 · ghi lúc 08:35 03/11".
 */
function txWhen(t) {
  if (!t.createdAt) return `🕒 ${fmtDate(t.date)}`;
  const createdDay = vnDateISO(t.createdAt);
  const time = fmtTimeVN(t.createdAt);
  return createdDay === t.date
    ? `🕒 ${fmtDate(t.date)} · ${time}`
    : `🕒 ${fmtDate(t.date)} · ghi lúc ${time} ${fmtDM(createdDay)}${createdDay.slice(0, 4) !== t.date.slice(0, 4) ? '/' + createdDay.slice(0, 4) : ''}`;
}

/** Nhãn khoản Transfer/Withdraw theo góc nhìn của sổ đang xem. */
function gopLabel(g) {
  if (g.mode === 'trich') return g.dir === 'in' ? `Withdraw từ ${g.peerName}` : `Bị ${g.peerName} withdraw`;
  return g.dir === 'out' ? `Transfer cho ${g.peerName}` : `Nhận transfer từ ${g.peerName}`;
}

function txRow(t) {
  const parts = S.txParts(t);
  const isTr = t.type === 'transfer';
  const cat = isTr ? null : S.catById(parts[0].categoryId);
  const icon = isTr ? `<span class="ci" style="--c:#6f6e77">⇄</span>` : catIcon(cat);
  const catText = t.gop ? gopLabel(t.gop)
    : parts.length > 1 ? `${parts.length} danh mục` : (cat || UNKNOWN_CAT).name;
  const title = t.note || (isTr ? 'Chuyển tiền' : catText);
  const sub = [isTr ? `${accName(t.accountId)} → ${accName(t.toAccountId)}` : (t.note && t.note !== catText ? catText + ' · ' : '') + accName(t.accountId)];
  if (t.tags && t.tags.length) sub.push(t.tags.map((g) => '#' + g).join(' '));
  const flags = (t.photoIds && t.photoIds.length ? '📎' : '') + (t.recurringId ? '🔁' : '') + (t.debtId ? '🏦' : '') + (t.cardPay ? '💳' : '');
  const sign = t.type === 'income' ? 1 : t.type === 'expense' ? -1 : 0;
  const foreign = t.currency && t.currency !== 'VND' ? `<small>${esc(fmtCur(t.amount, t.currency))}</small>` : '';
  const inner = `${icon}
    <span class="grow"><b>${esc(title)}</b><small>${esc(sub.join(' · '))}</small><small class="when">${esc(txWhen(t))}</small></span>
    <span class="amt ${t.type}">${sign ? fmtSigned(sign * t.amountVnd) : fmt(t.amountVnd)}${foreign}<small>${flags}${t.settleOf ? '📈' : ''}</small></span>`;
  return `<button type="button" class="row tx" data-act="tx-edit" data-id="${t.id}">${inner}</button>`;
}

const sortTx = (list) => list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));

function groupedTx(list) {
  const groups = new Map();
  for (const t of sortTx(list)) {
    if (!groups.has(t.date)) groups.set(t.date, []);
    groups.get(t.date).push(t);
  }
  return [...groups.entries()].map(([d, items]) => {
    const net = items.reduce((s, t) => s + (t.type === 'income' ? t.amountVnd : t.type === 'expense' ? -t.amountVnd : 0), 0);
    return `<div class="day"><div class="day-h"><span>${fmtDayHeader(d)}</span><span class="${net >= 0 ? 'income' : 'expense'}">${fmtSigned(net)}</span></div>
      <div class="card list">${items.map(txRow).join('')}</div></div>`;
  }).join('');
}

const catOptions = (type, selected, extra = '') =>
  extra + S.catsOf(type).map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.icon + ' ' + c.name)}</option>`).join('');

/** Danh sách tài khoản cho ô chọn; withBalance = hiện số dư để chọn tài khoản trừ tiền. */
function accOptions(selected, withBalance = false) {
  const list = S.activeAccounts();
  const cur = S.accById(selected);
  if (cur && cur.archived) list.push(cur);
  return list.map((a) => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(a.icon + ' ' + a.name)}${withBalance ? ' — ' + fmt(S.accountBalance(a)) : ''}</option>`).join('');
}

/** Dòng phụ mô tả tài khoản ngân hàng: ngân hàng · STK · chủ TK. */
const accSub = (a) => [a.bank, a.number && 'STK ' + a.number, a.holder].filter(Boolean).join(' · ')
  || (a.kind === 'cash' ? 'Tiền mặt (bản cũ)' : 'Chưa có thông tin ngân hàng — bấm để bổ sung');

/**
 * Dòng "Khả dụng" dưới ô chọn tài khoản trừ tiền. Thiếu tiền hoặc mục đang khóa → chữ đỏ.
 * bookId: mục bị trừ tiền (để kiểm tra khóa); who: phần chữ thêm sau "Khả dụng" (vd " của Vợ · Ngân hàng").
 */
function balHint(el, { have, need, bookId, who = '' }) {
  if (!el) return;
  if (bookId && S.isLocked(bookId)) {
    el.textContent = `🔒 Mục${who ? who.replace(/^ của/, '') : ''} đang khóa — không thể chuyển tiền đi`;
    el.className = 'hint warn-red';
    return;
  }
  const short = need > have;
  el.textContent = `Khả dụng${who}: ${fmt(have)}` + (short ? ` — ⚠️ Số dư không đủ (thiếu ${fmt(need - have)})` : '');
  el.className = 'hint' + (short ? ' warn-red' : '');
}

/** Báo lỗi nếu tài khoản không đủ tiền; trả về true khi được phép chi. */
function checkFunds(accountId, amountVnd, ignoreTx = null) {
  const err = S.fundsError(accountId, amountVnd, ignoreTx);
  if (err) toast('⛔ ' + err, 4500);
  return !err;
}

const field = (label, inner, extra = '') => `<label class="field" ${extra}><span>${label}</span>${inner}</label>`;
const amountField = (id, value, label = 'Số tiền') =>
  field(label, `<div class="money-row"><input id="${id}" class="money" inputmode="decimal" autocomplete="off" placeholder="vd: 50k, 1tr2" value="${value ? fmtNum(value) : ''}"><div class="zero-sug" data-zero-for="${id}" hidden></div></div><em class="hint" data-hint-for="${id}"></em>`);

/** Gắn gợi ý đọc số tiền dưới ô nhập. */
function bindMoney(root, id) {
  const inp = $(root, '#' + id), hint = $(root, `[data-hint-for="${id}"]`);
  const upd = () => {
    const v = readMoney(inp.value);
    // Chỉ giải nghĩa khi gõ tắt (50k, 1tr2) hoặc báo lỗi; số thường đã có dấu chấm ngay trong ô.
    hint.textContent = !inp.value ? '' : !Number.isFinite(v) ? 'Chưa hiểu số tiền'
      : /[^\d.\-]/.test(inp.value) ? '= ' + fmt(v) : '';
  };
  inp.addEventListener('input', upd);
  upd();
  return inp;
}
/** Hỗ trợ cả số âm (vd: dư nợ thẻ tín dụng ban đầu). */
const readMoney = (s) => {
  const str = String(s || '').trim();
  const neg = str.startsWith('-');
  const v = parseAmount(neg ? str.slice(1) : str);
  return neg ? -v : v;
};

// ================= Người dùng =================
/** Avatar người dùng/thẻ: ảnh riêng (nếu có) hoặc icon. */
const avatar = (p, cls = 'ci') => (p.photo || !p.icon ? avatarFull({ ...p, icon: p.icon || S.BOOK_KINDS[p.kind]?.icon || '🧑' }, cls) : avatarFull(p, cls));
const avatarFull = (p, cls) => (p.photo
  ? `<span class="${cls} av" style="--c:${esc(p.color)}"><img src="${esc(p.photo)}" alt=""></span>`
  : `<span class="${cls}" style="--c:${esc(p.color)}">${esc(p.icon)}</span>`);

// --- Đầu trang: trái = User / Category, phải = mục đang mở (chỉ với User) ---
const kindOf = (b) => S.BOOK_KINDS[b.kind] || S.BOOK_KINDS.bank;
const isCategoryOwner = () => S.ownerType(S.currentUser()) === 'category';

function topBar(sub = '', right = '') {
  const u = S.currentUser(), b = S.currentProfile();
  // Category chỉ có 1 mục theo dõi → không có nút chọn mục bên phải.
  const bookChip = isCategoryOwner()
    ? '<button type="button" class="icon-btn cat-close" data-act="cat-close" aria-label="Đóng Category" title="Đóng, về Ngân hàng mặc định">✕</button>'
    : `<button type="button" class="profile-chip book-chip" data-act="books" style="--c:${esc(b.color)}" title="Chọn / tạo mục">
      <span class="chip-av">${esc(b.icon || kindOf(b).icon)}</span><span class="chip-name">${esc(kindOf(b).label)}</span> <i>▾</i></button>`;
  return `<header class="top topbar">
    <button type="button" class="profile-chip" data-act="users" style="--c:${esc(u.color)}" title="User / Category">
      ${avatar(u, 'chip-av')}<span class="chip-name">${esc(u.name)}</span> <i>▾</i></button>
    ${bookChip}
  </header>
  <div class="title-row"><div><h1>${esc(b.name)}${b.locked ? ' <span class="lock-badge" title="Mục đang khóa">🔒</span>' : ''}</h1>${sub ? `<small>${sub}</small>` : ''}</div>${right}</div>`;
}

function resetViewState() {
  ui.period = null;
  ui.reportPeriod = null;
  ui.cardPeriod = null;
  ui.txFilter = { type: 'all', q: '', categoryId: null, tag: null, accountId: null };
}

/** Mỗi lần chuyển mục / User / Category: luôn mở màn hình Tổng quan. */
const goHome = () => { if (location.hash !== '#/home') location.hash = '#/home'; };

async function switchTo(id) {
  if (id === S.currentProfile().id) return goHome();
  resetViewState();
  await S.switchProfile(id);
  await S.processRecurring();
  goHome();
  toast(`Đã mở mục ${S.bookLabel(S.currentProfile())}`);
}

async function switchToUser(userId) {
  if (userId === S.currentUser().id) return goHome();
  resetViewState();
  await S.switchUser(userId);
  await S.processRecurring();
  goHome();
  toast(`Đã chuyển sang ${S.currentUser().name}`);
}

actions['profile-switch'] = (el) => switchTo(el.dataset.id);
actions['book-lock'] = (el) => {
  const b = S.getProfiles().find((x) => x.id === el.dataset.id);
  if (!b) return;
  S.setLocked(b.id, !b.locked);
  toast(b.locked ? `🔓 Đã mở khóa ${S.bookLabel(b)}` : `🔒 Đã khóa ${S.bookLabel(b)} — không thể chuyển tiền đi`, 3000);
};
actions['user-switch'] = (el) => switchToUser(el.dataset.id);
/** Đóng Category: về mục Ngân hàng mặc định (thiết lập trong Cài đặt chung), không có thì Ngân hàng đầu tiên. */
actions['cat-close'] = () => {
  const bank = S.defaultBank();
  if (!bank) return toast('Chưa có mục Ngân hàng nào');
  switchTo(bank.id);
};
actions['default-bank'] = (el) => { S.setDefaultBank(el.value); toast('Đã đặt Ngân hàng mặc định'); };

/** Ô chọn (User / Category / mục): trái = avatar + tên; phải = số liệu (điền sau) + trạng thái. */
function tileHtml({ attr, id, color, av, name, on, sum, del }) {
  return `<div class="ptile ${on ? 'on is-current' : ''}" style="--c:${esc(color)}">
    <button type="button" class="ptile-main" data-${attr}="${esc(id)}">
      <span class="ptile-left">${av}<b>${esc(name)}</b></span>
      <span class="ptile-right">${sum}${on ? '<i class="ptile-on">✓ Đang dùng</i>' : '<i class="ptile-go">Xem ›</i>'}</span>
    </button>
    <button type="button" class="ptile-edit" data-edit="${esc(id)}" aria-label="Sửa">✎</button>
    ${del ? `<button type="button" class="ptile-del" data-del="${esc(id)}" aria-label="Xóa">🗑</button>` : ''}
  </div>`;
}

const STAT_LABEL = { day: 'hôm nay', week: 'tuần này', month: 'tháng này' };
const trackerSumHtml = (s) => (s.configured
  ? `<b class="${s.income - s.expense < 0 ? 'expense' : 'income'}">${fmtSigned(s.income - s.expense)}</b><small>Chênh lệch ${STAT_LABEL[s.period] || ''}</small><small>Thu ${fmtShort(s.income)} · Chi ${fmtShort(s.expense)}</small>`
  : '<small>Chưa thiết lập nguồn</small>');

/** Điền số liệu vào ô: [data-psum] = một mục; [data-usum] = User (tổng số dư) hoặc Category (chênh lệch theo kỳ). */
async function fillProfileSums(root) {
  for (const el of root.querySelectorAll('[data-psum]')) {
    const p = S.getProfiles().find((x) => x.id === el.dataset.psum);
    if (!p) continue;
    try {
      const s = await S.profileSummary(p);
      el.innerHTML = s.kind === 'card'
        ? `<b class="${s.unpaid ? 'expense' : 'income'}">${fmt(s.unpaid)}</b><small>${s.count ? `${s.count} khoản chưa TT` : 'Đã thanh toán hết'}</small>`
        : s.kind === 'tracker' ? trackerSumHtml(s)
          : `<b class="${s.balance < 0 ? 'expense' : ''}">${fmt(s.balance)}</b><small>Số dư</small>`;
    } catch { el.textContent = ''; }
  }
  for (const el of root.querySelectorAll('[data-usum]')) {
    const books = S.userBooks(el.dataset.usum);
    const owner = S.getUsers().find((u) => u.id === el.dataset.usum);
    try {
      if (S.ownerType(owner) === 'category') {
        el.innerHTML = books[0] ? trackerSumHtml(await S.profileSummary(books[0])) : '';
        continue;
      }
      let balance = 0, unpaid = 0;
      for (const b of books) {
        const s = await S.profileSummary(b);
        if (s.kind === 'card') unpaid += s.unpaid; else if (s.kind !== 'tracker') balance += s.balance;
      }
      el.innerHTML = `<b class="${balance < 0 ? 'expense' : ''}">${fmt(balance)}</b><small>Tổng số dư · ${books.length} mục</small>`
        + (unpaid ? `<small class="expense">Thẻ chưa TT: ${fmt(unpaid)}</small>` : '');
    } catch { el.textContent = ''; }
  }
}

// --- Danh sách User / Category (nút trái). Có nút ⚙️ Cài đặt chung ở góc phải tiêu đề. ---
actions.users = () => {
  const cur = S.currentUser().id;
  const group = (type) => {
    const t = S.OWNER_TYPES[type];
    const list = S.getUsers(type);
    const canDel = type === 'category' || list.length > 1;
    return `<h4 class="grp-h">${t.icon} ${t.label} <small>(${list.length}/${t.max})</small></h4>
      <div class="tile-grid one-col">${list.map((u) => tileHtml({
        attr: 'switch', id: u.id, color: u.color, av: avatar(u, 'ptile-av'), name: u.name, on: u.id === cur,
        sum: `<span class="psum" data-usum="${esc(u.id)}">…</span>`, del: canDel,
      })).join('')}
      ${list.length < t.max ? `<button type="button" class="ptile-add block" data-add="${type}">＋ ${t.label}</button>` : ''}</div>`;
  };
  openSheet({
    title: 'User / Category',
    headAction: '<button type="button" class="icon-btn head-gear" data-settings aria-label="Cài đặt chung">⚙️</button>',
    body: `${group('user')}${group('category')}
      <p class="muted small">👤 User: mục 🏦 Ngân hàng (3), 🐷 Tiết kiệm (3), 💳 Thẻ chi tiêu (2) — chọn/tạo ở nút góc phải trên cùng.<br>🗂️ Category: theo dõi 🔁 Transfer/Withdraw hoặc 📊 Thu/Chi, chọn là vào xem luôn.</p>`,
    onMount(sh, close) {
      sh.querySelector('[data-settings]').addEventListener('click', () => { close(); location.hash = '#/settings'; });
      fillProfileSums(sh);
      sh.addEventListener('click', async (e) => {
        const sw = e.target.closest('[data-switch]'), ed = e.target.closest('[data-edit]');
        const del = e.target.closest('[data-del]'), add = e.target.closest('[data-add]');
        if (del) {
          const u = S.getUsers().find((x) => x.id === del.dataset.del);
          if (u && await confirmDeleteUser(u)) { close(); refresh(); setTimeout(() => actions.users(), 260); }
        } else if (sw) { close(); await switchToUser(sw.dataset.switch); }
        else if (ed) { close(); userForm(S.getUsers().find((u) => u.id === ed.dataset.edit)); }
        else if (add) { close(); userForm(null, add.dataset.add); }
      });
    },
  });
};

// --- Danh sách mục của User hiện tại (nút phải): mỗi mục 1 dòng trải hết chiều ngang ---
actions.books = () => {
  const u = S.currentUser();
  if (S.ownerType(u) === 'category') return;
  const cur = S.currentProfile().id;
  const mine = S.userBooks(u.id);
  openSheet({
    title: `Mục của ${u.name}`,
    body: S.OWNER_TYPES.user.kinds.map((kind) => {
      const k = S.BOOK_KINDS[kind];
      const list = mine.filter((b) => (b.kind || 'bank') === kind);
      return `<h4 class="grp-h">${k.icon} ${k.label} <small>(${list.length}/${k.max})</small></h4>
        <div class="tile-grid one-col">${list.map((b) => tileHtml({
          attr: 'switch', id: b.id, color: b.color, av: avatar(b, 'ptile-av'), name: b.name + (b.locked ? ' 🔒' : ''), on: b.id === cur,
          sum: `<span class="psum" data-psum="${esc(b.id)}">…</span>`, del: mine.length > 1,
        })).join('')}
        ${list.length < k.max ? `<button type="button" class="ptile-add block" data-add="${kind}">＋ ${k.label}</button>` : ''}</div>`;
    }).join(''),
    onMount(sh, close) {
      fillProfileSums(sh);
      sh.addEventListener('click', async (e) => {
        const sw = e.target.closest('[data-switch]'), ed = e.target.closest('[data-edit]');
        const del = e.target.closest('[data-del]'), add = e.target.closest('[data-add]');
        if (del) {
          const b = S.getProfiles().find((x) => x.id === del.dataset.del);
          if (b && await confirmDeleteProfile(b)) { close(); refresh(); setTimeout(() => actions.books(), 260); }
        } else if (sw) { close(); await switchTo(sw.dataset.switch); }
        else if (ed) { close(); bookForm(S.getProfiles().find((b) => b.id === ed.dataset.edit)); }
        else if (add) { close(); bookForm(null, add.dataset.add); }
      });
    },
  });
};
actions.profiles = actions.books;

/** Xóa một mục (hỏi xác nhận 2 lần). */
async function confirmDeleteProfile(b) {
  if (!confirm(`Xóa mục "${S.bookLabel(b)}" và TOÀN BỘ dữ liệu của mục này? Không thể hoàn tác. Nên sao lưu trước!`)) return false;
  if (prompt('Gõ XOA để xác nhận') !== 'XOA') return false;
  resetViewState();
  try { await S.deleteProfile(b.id); } catch (err) { toast(err.message); return false; }
  toast('Đã xóa mục');
  return true;
}

/** Xóa User / Category cùng mọi mục của nó. */
async function confirmDeleteUser(u) {
  const n = S.userBooks(u.id).length;
  if (!confirm(`Xóa "${u.name}" cùng ${n} mục và TOÀN BỘ dữ liệu? Không thể hoàn tác. Nên sao lưu trước!`)) return false;
  if (prompt('Gõ XOA để xác nhận') !== 'XOA') return false;
  resetViewState();
  try { await S.deleteUser(u.id); } catch (err) { toast(err.message); return false; }
  goHome();
  toast('Đã xóa');
  return true;
}

/** Phần chọn ảnh / icon (có tìm kiếm) / màu dùng chung cho form User, Category và mục. */
function looksFields(f, withPhoto) {
  return `${withPhoto ? `<div class="field"><span>Ảnh đại diện</span>
      <div class="pf-photo"><span id="pf-preview">${avatar(f, 'ptile-av')}</span>
        <label class="btn ghost small">📷 Dùng ảnh của bạn<input type="file" accept="image/*" id="pf-file" hidden></label>
        <button type="button" class="btn ghost small" id="pf-nophoto" ${f.photo ? '' : 'hidden'}>✕ Bỏ ảnh</button></div></div>` : ''}
    <div class="field"><span>${withPhoto ? 'Hoặc chọn biểu tượng' : 'Biểu tượng'}</span>${iconPickerHtml('pf-icons', f.icon)}</div>
    <div class="field"><span>Màu</span><div class="colors">${S.PROFILE_COLORS.map((col) => `<button type="button" class="color ${col === f.color ? 'on' : ''}" data-color="${col}" style="--c:${col}" aria-label="${col}"></button>`).join('')}</div></div>`;
}

function bindLooks(sh, f) {
  const preview = () => {
    const pv = $(sh, '#pf-preview');
    if (pv) pv.innerHTML = avatar(f, 'ptile-av');
    const np = $(sh, '#pf-nophoto');
    if (np) np.hidden = !f.photo;
  };
  bindIconPicker($(sh, '#pf-icons'), (icon) => { f.icon = icon; f.photo = null; preview(); }, () => f.icon);
  // Ảnh riêng: nén còn ~160px để lưu gọn.
  $(sh, '#pf-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const blob = await compressImage(file, 160, 0.8);
      f.photo = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
      preview();
    } catch (err) { toast(err.message || 'Không đọc được ảnh'); }
  });
  $(sh, '#pf-nophoto')?.addEventListener('click', () => { f.photo = null; preview(); });
  $(sh, '.colors').addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    f.color = b.dataset.color;
    sh.querySelectorAll('.color').forEach((x) => x.classList.toggle('on', x === b));
    preview();
  });
}

/** Thêm/sửa User hoặc Category. Tạo Category: chọn kiểu theo dõi (Transfer/Withdraw hoặc Thu/Chi). */
function userForm(u, type = 'user') {
  if (u) type = S.ownerType(u);
  const t = S.OWNER_TYPES[type];
  const isCat = type === 'category';
  const users = S.getUsers();
  const book = u && isCat ? S.userBooks(u.id)[0] : null;
  const f = u ? { ...u } : { type, name: '', icon: isCat ? '🔁' : (users.length === 1 ? '👩' : '🧑'), color: S.PROFILE_COLORS[users.length % S.PROFILE_COLORS.length], statPeriod: 'day' };
  let trackKind = book ? book.kind : 'invest';
  const formId = 'uf-' + Date.now();
  const canDel = u && (isCat || S.getUsers('user').length > 1);
  openSheet({
    title: `${u ? 'Sửa' : 'Thêm'} ${t.label}`,
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">${u ? 'Lưu' : 'Tạo'}</button>`,
    body: `<form class="form" id="${formId}">
      ${isCat && !u ? `<div class="field"><span>Kiểu theo dõi</span><div class="seg" id="uf-kind">
        <button type="button" data-k="invest" class="on">🔁 Transfer / Withdraw</button><button type="button" data-k="track">📊 Thu / Chi</button></div>
        <small class="muted" id="uf-kind-hint">Lấy các khoản Transfer/Withdraw theo luồng từ mục → đến mục bạn chỉ định.</small></div>` : ''}
      ${isCat && u ? `<p class="muted small">Kiểu: <b>${esc(kindOf(book || {}).label)}</b></p>` : ''}
      ${field('Tên hiển thị', `<input id="pf-name" required maxlength="24" value="${esc(f.name)}" placeholder="${isCat ? 'vd: Đầu tư chứng khoán, Chi tiêu gia đình' : 'vd: Dũng, Vợ'}">`)}
      ${isCat ? field('Chênh lệch hiện trên thẻ theo', `<select id="uf-stat">${['day', 'week', 'month'].map((p) => `<option value="${p}" ${(f.statPeriod || 'day') === p ? 'selected' : ''}>${PERIOD_LABEL[p]}</option>`).join('')}</select>`) : ''}
      ${looksFields(f, true)}
      ${u ? '' : `<p class="muted small">${isCat ? 'Tạo xong sẽ mở phần thiết lập nguồn để chọn dữ liệu đưa vào.' : 'User mới có sẵn 1 mục 🏦 Ngân hàng.'}</p>`}
      ${canDel ? `<div class="actions"><button type="button" class="btn danger" data-del>Xóa ${t.label}</button></div>` : ''}
    </form>`,
    onMount(sh, close) {
      bindLooks(sh, f);
      $(sh, '#uf-kind')?.addEventListener('click', (e) => {
        const b = e.target.closest('[data-k]');
        if (!b) return;
        trackKind = b.dataset.k;
        sh.querySelectorAll('#uf-kind [data-k]').forEach((x) => x.classList.toggle('on', x === b));
        $(sh, '#uf-kind-hint').textContent = trackKind === 'track'
          ? 'Lấy các khoản Thu/Chi trong các mục bạn chọn, theo danh mục thu / chi chỉ định.'
          : 'Lấy các khoản Transfer/Withdraw theo luồng từ mục → đến mục bạn chỉ định.';
      });
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = $(sh, '#pf-name').value.trim();
        if (!name) return toast('Nhập tên');
        if (S.getUsers().some((x) => x.id !== f.id && x.name.toLowerCase() === name.toLowerCase())) return toast('Tên này đã có');
        const data = { ...f, name, statPeriod: $(sh, '#uf-stat')?.value || f.statPeriod };
        if (!u && isCat) data.trackKind = trackKind;
        let saved;
        try { saved = S.saveUser(data); } catch (err) { return toast(err.message); }
        // Category: mục theo dõi mang cùng tên / icon / màu.
        if (isCat && book) S.saveProfile({ id: book.id, name, icon: data.icon, color: data.color });
        close();
        if (u) { refresh(); toast('Đã lưu'); return; }
        await switchToUser(saved.id);
        if (isCat) setTimeout(() => trackerSourceForm(S.currentProfile()), 300);
      });
      $(sh, '[data-del]')?.addEventListener('click', async () => {
        if (await confirmDeleteUser(u)) { close(); refresh(); }
      });
    },
  });
}

/** Thêm/sửa mục (Ngân hàng / Tiết kiệm / Thẻ chi tiêu) của User hiện tại. */
function bookForm(b, kind = 'bank') {
  if (b) kind = b.kind || 'bank';
  const k = S.BOOK_KINDS[kind];
  const owner = b ? S.userOf(b) : S.currentUser();
  const f = b ? { ...b } : { name: '', kind, owner: owner.id, icon: k.icon, color: owner.color };
  const formId = 'bf-' + Date.now();
  const hint = {
    bank: 'Sổ thu/chi có 1 tài khoản ngân hàng và số dư.',
    card: 'Ghi các khoản chi (MoMo, ZaloPay…), sau đó Withdraw tiền từ Ngân hàng để thanh toán từng khoản.',
    saving: 'Như Ngân hàng nhưng chỉ nhận Transfer / bị Withdraw từ các mục Ngân hàng.',
  }[kind] || '';
  openSheet({
    title: `${b ? 'Sửa' : 'Thêm'} mục ${k.label}`,
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">${b ? 'Lưu' : 'Tạo'}</button>`,
    body: `<form class="form" id="${formId}">
      <p class="muted small">${k.icon} Mục của <b>${esc(owner.name)}</b>. ${hint}</p>
      ${field('Tên mục', `<input id="pf-name" required maxlength="24" value="${esc(f.name)}" placeholder="${{ card: 'vd: Thẻ MoMo, Đi chợ', saving: 'vd: Quỹ học phí, Tiết kiệm mua nhà' }[kind] || 'vd: Ngân hàng, Tiền nhà'}">`)}
      ${looksFields(f, false)}
      ${b && S.userBooks(owner.id).length > 1 ? '<div class="actions"><button type="button" class="btn danger" data-del>Xóa mục</button></div>' : ''}
    </form>`,
    onMount(sh, close) {
      bindLooks(sh, f);
      setTimeout(() => { if (!b) $(sh, '#pf-name').focus(); }, 250);
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = $(sh, '#pf-name').value.trim();
        if (!name) return toast('Nhập tên mục');
        if (S.userBooks(owner.id).some((x) => x.id !== f.id && x.name.toLowerCase() === name.toLowerCase())) return toast('Tên mục này đã có');
        let saved;
        try { saved = S.saveProfile({ ...f, name }); } catch (err) { return toast(err.message); }
        close();
        if (b) { refresh(); toast('Đã lưu'); return; }
        await switchTo(saved.id);
      });
      $(sh, '[data-del]')?.addEventListener('click', async () => {
        if (await confirmDeleteProfile(b)) { close(); refresh(); }
      });
    },
  });
}

// ================= Category: thiết lập nguồn =================
const trackerSourceForm = (book) => (book.kind === 'track' ? trackSourceForm(book) : investSourceForm(book));
const moneyBookList = () => S.getProfiles().filter((p) => ['bank', 'saving', 'neo', 'outflow'].includes(p.kind || 'bank'));

/** Kiểu Transfer/Withdraw: các luồng "từ mục → đến mục" + danh mục transfer/withdraw cần lấy. */
function investSourceForm(book) {
  const books = moneyBookList();
  if (books.length < 2) return toast('Cần ít nhất 2 mục có tài khoản để tạo luồng Transfer/Withdraw');
  const src = book.source || {};
  let rules = (src.rules || []).map((r) => ({ ...r }));
  if (!rules.length) rules = [{ from: books[0].id, to: books[1].id, as: 'expense' }];
  const picked = new Set(src.flowCats || []);
  const opts = (sel) => books.map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.icon + ' ' + S.bookLabel(p))}</option>`).join('');
  const formId = 'is-' + Date.now();
  openSheet({
    title: `⚙️ Nguồn của ${book.name}`,
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">Lưu</button>`,
    body: `<form class="form" id="${formId}">
      <p class="muted small">Chỉ lấy các khoản <b>Transfer / Withdraw</b> chuyển tiền <b>từ mục → đến mục</b> bạn chỉ định (Transfer từ A cho B, hoặc B Withdraw từ A đều tính là A → B). Xóa giao dịch thì ở đây cũng mất theo.</p>
      <div class="field"><span>🔁 Luồng tiền lấy vào</span><div id="is-rules"></div>
        <button type="button" class="btn ghost small" data-add-rule>＋ Thêm luồng</button></div>
      <div class="field"><span>🏷️ Danh mục Transfer/Withdraw lấy vào <small class="muted">(không chọn = lấy tất cả)</small></span>
        <div class="check-list" id="is-cats"></div>
        <button type="button" class="btn ghost small" data-add-cat>＋ Thêm danh mục</button></div>
    </form>`,
    onMount(sh, close) {
      const renderRules = () => {
        $(sh, '#is-rules').innerHTML = rules.map((r, i) => `<div class="rule-row" data-i="${i}">
          <select data-k="from">${opts(r.from)}</select><span class="rule-arrow">→</span><select data-k="to">${opts(r.to)}</select>
          <select data-k="as" class="rule-as"><option value="expense" ${r.as !== 'income' ? 'selected' : ''}>Tính là Chi</option><option value="income" ${r.as === 'income' ? 'selected' : ''}>Tính là Thu</option></select>
          ${rules.length > 1 ? '<button type="button" class="icon-btn" data-rm aria-label="Bỏ">✕</button>' : ''}</div>`).join('');
      };
      const renderCats = () => {
        $(sh, '#is-cats').innerHTML = S.flowCats().map((c) => `<label class="check"><input type="checkbox" value="${esc(c.id)}" ${picked.has(c.id) ? 'checked' : ''}> ${esc(c.icon + ' ' + c.name)}</label>`).join('');
      };
      renderRules(); renderCats();
      $(sh, '#is-rules').addEventListener('change', (e) => {
        const row = e.target.closest('.rule-row');
        if (row && e.target.dataset.k) rules[row.dataset.i][e.target.dataset.k] = e.target.value;
      });
      $(sh, '#is-rules').addEventListener('click', (e) => {
        if (!e.target.closest('[data-rm]')) return;
        rules.splice(Number(e.target.closest('.rule-row').dataset.i), 1);
        renderRules();
      });
      $(sh, '#is-cats').addEventListener('change', (e) => {
        if (e.target.checked) picked.add(e.target.value); else picked.delete(e.target.value);
      });
      $(sh, '[data-add-rule]').addEventListener('click', () => { rules.push({ from: books[0].id, to: books[1].id, as: 'expense' }); renderRules(); });
      $(sh, '[data-add-cat]').addEventListener('click', () => {
        const name = (prompt('Tên danh mục Transfer/Withdraw mới') || '').trim();
        if (!name) return;
        try { const c = S.addFlowCat(name); picked.add(c.id); renderCats(); } catch (err) { toast(err.message); }
      });
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (rules.some((r) => r.from === r.to)) return toast('Mục nguồn và mục đích phải khác nhau');
        S.saveProfile({ id: book.id, source: { rules, flowCats: [...picked] } });
        close();
        if (S.currentProfile().id === book.id) { await S.loadAll(); S.emit(); }
        toast('Đã lưu nguồn');
      });
    },
  });
}

/** Kiểu Thu/Chi: chọn các mục (Ngân hàng / Tiết kiệm) + danh mục thu, chi cần lấy (theo tên danh mục). */
function trackSourceForm(book) {
  const books = S.getProfiles().filter((p) => ['bank', 'saving'].includes(p.kind || 'bank'));
  const src = book.source || {};
  const pickedBooks = new Set(src.books && src.books.length ? src.books : books.map((b) => b.id));
  const inc = new Set(src.income || []), exp = new Set(src.expense || []);
  const formId = 'ts-' + Date.now();
  openSheet({
    title: `⚙️ Nguồn của ${book.name}`,
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">Lưu</button>`,
    body: `<form class="form" id="${formId}">
      <p class="muted small">Lấy các khoản <b>Thu / Chi</b> trong các mục bạn chọn, thuộc các danh mục bạn tích. Xóa giao dịch thì ở đây cũng mất theo.</p>
      <div class="field"><span>📒 Lấy từ các mục</span><div class="check-list one" id="ts-books">${books.map((b) =>
        `<label class="check"><input type="checkbox" value="${esc(b.id)}" ${pickedBooks.has(b.id) ? 'checked' : ''}> ${esc(b.icon + ' ' + S.bookLabel(b))}</label>`).join('')}</div></div>
      <div id="ts-cats"><p class="muted small">Đang tải danh mục…</p></div>
    </form>`,
    onMount(sh, close) {
      const load = async () => {
        const names = await S.categoryNamesOf([...pickedBooks]);
        const box = (type, title, set) => `<div class="field"><span>${title}</span><div class="check-list">${names[type].map(([n, ic]) =>
          `<label class="check"><input type="checkbox" data-t="${type}" value="${esc(n)}" ${set.has(n) ? 'checked' : ''}> ${esc(ic + ' ' + n)}</label>`).join('') || '<small class="muted">Không có</small>'}</div></div>`;
        $(sh, '#ts-cats').innerHTML = box('income', '💹 Danh mục THU lấy vào', inc) + box('expense', '💸 Danh mục CHI lấy vào', exp);
      };
      $(sh, '#ts-books').addEventListener('change', (e) => {
        if (e.target.checked) pickedBooks.add(e.target.value); else pickedBooks.delete(e.target.value);
        load();
      });
      $(sh, '#ts-cats').addEventListener('change', (e) => {
        const set = e.target.dataset.t === 'income' ? inc : exp;
        if (e.target.checked) set.add(e.target.value); else set.delete(e.target.value);
      });
      load();
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!pickedBooks.size) return toast('Chọn ít nhất 1 mục');
        if (!inc.size && !exp.size) return toast('Chọn ít nhất 1 danh mục thu hoặc chi');
        S.saveProfile({ id: book.id, source: { books: [...pickedBooks], income: [...inc], expense: [...exp] } });
        close();
        if (S.currentProfile().id === book.id) { await S.loadAll(); S.emit(); }
        toast('Đã lưu nguồn');
      });
    },
  });
}

function sectionTitle(text, actionHtml = '') {
  return `<div class="sec-h"><h2>${text}</h2>${actionHtml}</div>`;
}

// ================= Thẻ chi tiêu =================
const SOURCE_ICON = { MoMo: '🟪', ZaloPay: '🟦', ShopeePay: '🟧', VNPay: '🔴', 'Viettel Money': '🟥', 'Apple Pay': '🍎', 'Thẻ tín dụng': '💳', 'Khác': '🧾' };
const srcIcon = (s) => SOURCE_ICON[s] || '🧾';
const sumAmt = (list) => list.reduce((s, t) => s + t.amountVnd, 0);
const isDone = (t) => t.status === 'done';

function cardView() {
  const p = S.currentProfile();
  const items = sortTx([...state.transactions]);
  // Tổng chưa thanh toán luôn tính trên toàn bộ thời gian để không sót khoản cũ.
  const openAll = items.filter((t) => !isDone(t));
  const r = rangeFor('card');
  const inR = items.filter((t) => t.date >= r.start && t.date <= r.end);
  const open = inR.filter((t) => !isDone(t));
  const spent = sumAmt(inR);
  const paid = sumAmt(items.filter((t) => isDone(t) && t.paid && t.paid.date >= r.start && t.paid.date <= r.end));
  const filter = ui.cardFilter || 'open';
  const list = filter === 'open' ? open : filter === 'done' ? inR.filter(isDone) : inR;
  const groups = new Map();
  for (const t of list) { if (!groups.has(t.date)) groups.set(t.date, []); groups.get(t.date).push(t); }
  const olderOpen = openAll.length - open.length;
  return `
  ${topBar('💳 Thẻ chi tiêu', summaryBtn())}
  <section class="card hero">
    <div class="hero-net"><small>Đã chi, chưa thanh toán (tất cả) · ${openAll.length} khoản</small><strong class="expense">${fmt(sumAmt(openAll))}</strong></div>
    ${quickButtons()}
    ${openAll.length > 1 ? `<button type="button" class="btn primary block" data-act="card-pay-all">💸 Withdraw thanh toán tất cả (${fmt(sumAmt(openAll))})</button>` : ''}
  </section>
  ${periodBar('card')}
  <section class="card stats two-col">
    <div><small>Đã chi trong kỳ</small><b class="expense">${fmt(spent)}</b><em>${inR.length} khoản</em></div>
    <div><small>Đã thanh toán trong kỳ</small><b class="income">${fmt(paid)}</b><em>Chưa TT trong kỳ: ${fmt(sumAmt(open))}</em></div>
  </section>
  ${olderOpen > 0 && filter === 'open' ? `<p class="muted small center">Còn ${olderOpen} khoản chưa thanh toán ngoài kỳ đang xem.</p>` : ''}
  <div class="seg small">${[['open', `Chưa thanh toán (${open.length})`], ['done', 'Done'], ['all', 'Tất cả']].map(([k, l]) =>
    `<button type="button" data-act="card-filter" data-v="${k}" class="${filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
  ${list.length ? [...groups.entries()].map(([d, arr]) => `<div class="day"><div class="day-h"><span>${fmtDayHeader(d)}</span><span>${fmt(sumAmt(arr))}</span></div>
    <div class="card list">${arr.map(cardRow).join('')}</div></div>`).join('')
    : empty('💳', filter === 'open' ? 'Không có khoản chưa thanh toán trong kỳ này. Bấm <b>+</b> để ghi khoản chi mới.' : 'Chưa có khoản chi nào trong kỳ này.')}
  <button type="button" class="fab" data-act="card-add" aria-label="Thêm khoản chi">+</button>`;
}

// ================= Mục Đầu tư (chỉ đọc) =================
/** Thu/Chi lấy tự động từ 1 mục Ngân hàng theo danh mục đã thiết lập; không nhập tay. */
/** Màn hình Category: Transfer/Withdraw ('invest') hoặc Thu/Chi ('track'); chỉ đọc. */
function investView() {
  const p = S.currentProfile();
  const isTrack = p.kind === 'track';
  const m = state.mirror || { configured: false, txs: [] };
  const setup = `<button type="button" class="btn ghost small" data-act="invest-source">⚙️ Nguồn</button>`;
  if (!m.configured) {
    return `${topBar(isTrack ? '📊 Theo dõi Thu/Chi' : '🔁 Theo dõi Transfer/Withdraw', setup)}
    ${empty(isTrack ? '📊' : '🔁', isTrack
      ? 'Category này lấy các khoản <b>Thu / Chi</b> trong các mục bạn chọn, theo danh mục chỉ định.<br>Bấm <b>⚙️ Nguồn</b> để thiết lập.'
      : 'Category này lấy các khoản <b>Transfer / Withdraw</b> theo luồng <b>từ mục → đến mục</b> bạn chỉ định.<br>Bấm <b>⚙️ Nguồn</b> để thiết lập.')}
    <button type="button" class="btn primary block" data-act="invest-source">⚙️ Thiết lập nguồn</button>`;
  }
  const r = currentRange();
  const list = m.txs.filter((t) => t.date >= r.start && t.date <= r.end);
  const sum = (arr, type) => arr.filter((t) => t.type === type).reduce((s, t) => s + t.amountVnd, 0);
  const inc = sum(list, 'income'), exp = sum(list, 'expense');
  const total = sum(m.txs, 'income') - sum(m.txs, 'expense');
  const groups = new Map();
  for (const t of sortTx([...list])) { if (!groups.has(t.date)) groups.set(t.date, []); groups.get(t.date).push(t); }
  const row = (t) => {
    const sign = t.type === 'income' ? 1 : -1;
    if (isTrack) {
      return `<div class="row tx mirror-row"><span class="ci" style="--c:${esc(t.catColor)}">${esc(t.catIcon)}</span>
        <span class="grow"><b>${esc(t.note || t.catName)}</b><small>${esc([t.note ? t.catName : '', t.flowLabel].filter(Boolean).join(' · '))}</small><small class="when">${esc(txWhen(t))}</small></span>
        <span class="amt ${t.type}">${fmtSigned(sign * t.amountVnd)}</span></div>`;
    }
    const isW = t.gop.mode === 'trich';
    return `<div class="row tx mirror-row"><span class="ci" style="--c:${isW ? '#8e4ec6' : '#12a594'}">${isW ? '🔄' : '🔁'}</span>
      <span class="grow"><b>${esc(t.flowLabel)}</b><small>${esc([isW ? 'Withdraw' : 'Transfer', t.flowCatName, t.note].filter(Boolean).join(' · '))}</small><small class="when">${esc(txWhen(t))}</small></span>
      <span class="amt ${t.type}">${fmtSigned(sign * t.amountVnd)}</span></div>`;
  };
  const info = isTrack
    ? `<div class="card flow-rules"><div>📒 ${esc(m.books.map((id) => S.bookLabel(S.getProfiles().find((b) => b.id === id))).join(', '))}</div>
      <small class="muted">Thu: ${esc((p.source.income || []).join(', ') || '—')} · Chi: ${esc((p.source.expense || []).join(', ') || '—')}</small></div>`
    : `<div class="card flow-rules">${m.rules.map((x) => {
      const a = S.getProfiles().find((b) => b.id === x.from), b = S.getProfiles().find((q) => q.id === x.to);
      return `<div>${esc(a.icon)} ${esc(S.bookLabel(a))} → ${esc(b.icon)} ${esc(S.bookLabel(b))} <small class="${x.as === 'income' ? 'income' : 'expense'}">(${x.as === 'income' ? 'Thu' : 'Chi'})</small></div>`;
    }).join('')}<small class="muted">Danh mục: ${esc((p.source.flowCats || []).map((id) => S.flowCatById(id)?.name).filter(Boolean).join(', ') || 'tất cả')}</small></div>`;
  return `
  ${topBar(isTrack ? '📊 Theo dõi Thu/Chi' : `🔁 ${m.rules.length} luồng Transfer/Withdraw`, setup)}
  ${periodBar()}
  <section class="card hero">
    <div class="hero-row">
      <div><small>Thu</small><b class="income">${fmt(inc)}</b></div>
      <div><small>Chi</small><b class="expense">${fmt(exp)}</b></div>
    </div>
    <div class="hero-net"><small>Chênh lệch kỳ này</small><strong class="${inc - exp >= 0 ? 'income' : 'expense'}">${fmtSigned(inc - exp)}</strong></div>
    <div class="hero-bal"><span>Lũy kế (thu − chi)</span><b>${fmtSigned(total)}</b></div>
  </section>
  ${info}
  ${list.length ? [...groups.entries()].map(([d, arr]) => `<div class="day"><div class="day-h"><span>${fmtDayHeader(d)}</span></div>
    <div class="card list">${arr.map(row).join('')}</div></div>`).join('')
    : empty('📭', 'Không có giao dịch phù hợp trong kỳ này.')}`;
}
actions['invest-source'] = () => trackerSourceForm(S.currentProfile());
function cardRow(t) {
  const cat = S.catById(t.categoryId);
  return `<div class="row card-item ${isDone(t) ? 'done' : ''}">
    <button type="button" class="grow-btn" data-act="card-open" data-id="${t.id}">
      <span class="ci" style="--c:${esc((cat || UNKNOWN_CAT).color)}">${srcIcon(t.source)}</span>
      <span class="grow"><b>${esc(t.note || t.source)}</b><small>${esc(t.source)}${cat ? ' · ' + esc(cat.name) : ''}</small>
        <small class="when">${esc(txWhen(t))}</small>
        ${isDone(t) && t.paid ? `<small class="income">✅ ${esc(t.paid.profileName)} · ${esc(t.paid.accountName)} · ${fmtDate(t.paid.date)}</small>` : ''}</span>
      <span class="amt">${fmt(t.amountVnd)}<small class="badge ${isDone(t) ? 'done' : 'open'}">${isDone(t) ? 'Done' : 'Chưa TT'}</small></span>
    </button>
    ${isDone(t) ? '' : `<button type="button" class="btn primary small pay-btn" data-act="card-pay" data-id="${t.id}">💸 Withdraw</button>`}
  </div>`;
}

const cardItem = (id) => state.transactions.find((t) => t.id === id);
actions['card-filter'] = (el) => { ui.cardFilter = el.dataset.v; refresh(); };
actions['card-add'] = () => cardItemForm(null);
actions['card-pay'] = (el) => { const t = cardItem(el.dataset.id); if (t) cardPaySheet([t]); };
actions['card-pay-all'] = () => cardPaySheet(state.transactions.filter((t) => !isDone(t)));

actions['card-open'] = (el) => {
  const t = cardItem(el.dataset.id);
  if (!t) return;
  const cat = S.catById(t.categoryId);
  openSheet({
    title: 'Khoản chi của thẻ',
    body: `<div class="detail">
      <div class="big-ic">${srcIcon(t.source)}</div>
      <div class="kv"><span>Nội dung</span><b>${esc(t.note || '—')}</b></div>
      <div class="kv"><span>Số tiền</span><b class="expense">${fmt(t.amountVnd)}</b></div>
      <div class="kv"><span>Nguồn</span><b>${esc(t.source)}</b></div>
      <div class="kv"><span>Danh mục</span><b>${esc(cat?.name || '—')}</b></div>
      <div class="kv"><span>Ngày chi</span><b>${fmtDate(t.date)}</b></div>
      ${t.createdAt ? `<div class="kv"><span>Ghi nhận lúc</span><b>${fmtDateTimeVN(t.createdAt)}</b></div>` : ''}
      <div class="kv"><span>Trạng thái</span><b class="${isDone(t) ? 'income' : 'expense'}">${isDone(t) ? '✅ Done' : 'Chưa thanh toán'}</b></div>
      ${isDone(t) && t.paid ? `<div class="kv"><span>Thanh toán bởi</span><b>${esc(t.paid.profileName)} · ${esc(t.paid.accountName)}</b></div>
        <div class="kv"><span>Ngày thanh toán</span><b>${fmtDate(t.paid.date)}</b></div>` : ''}
      <div class="actions">${isDone(t)
        ? '<button type="button" class="btn ghost" data-unpay>↶ Hủy thanh toán</button>'
        : '<button type="button" class="btn primary" data-pay>💸 Withdraw thanh toán</button><button type="button" class="btn ghost" data-edit>Sửa</button>'}
        <button type="button" class="btn danger" data-del>Xóa</button></div>
      ${isDone(t) ? '<p class="muted small">Hủy thanh toán sẽ xóa khoản chi tương ứng trong sổ của người đã trả và đưa khoản này về "Chưa thanh toán".</p>' : ''}
    </div>`,
    onMount(sh, close) {
      $(sh, '[data-pay]')?.addEventListener('click', () => { close(); cardPaySheet([t]); });
      $(sh, '[data-edit]')?.addEventListener('click', () => { close(); cardItemForm(t); });
      $(sh, '[data-unpay]')?.addEventListener('click', async () => {
        if (!confirm(`Hủy thanh toán? Khoản chi ${fmt(t.amountVnd)} trong sổ của ${t.paid?.profileName || 'người trả'} sẽ bị xóa.`)) return;
        await S.unpayCardItem(t);
        close(); toast('Đã hủy thanh toán');
      });
      $(sh, '[data-del]').addEventListener('click', async () => {
        if (!confirm(isDone(t) ? 'Xóa khoản chi này? Khoản thanh toán bên sổ người trả cũng bị xóa.' : 'Xóa khoản chi này?')) return;
        if (isDone(t)) await S.unpayCardItem(t);
        await S.remove('transactions', t.id);
        close(); toast('Đã xóa');
      });
    },
  });
};

function cardItemForm(item) {
  const f = item ? { ...item } : { amountVnd: 0, source: state.settings.lastSource || 'MoMo', categoryId: state.settings.lastCat?.expense, date: todayISO(), note: '' };
  const cats = S.catsOf('expense').filter((c) => !/^(gop|trich)/.test(c.sys || ''));
  if (!cats.some((c) => c.id === f.categoryId)) f.categoryId = cats[0]?.id;
  const ciFormId = 'cif-' + Date.now();
  openSheet({
    title: item ? 'Sửa khoản chi' : 'Thêm khoản chi của thẻ',
    headAction: `<button type="submit" form="${ciFormId}" class="btn primary small head-save">Lưu</button>`,
    body: `<form class="form" id="${ciFormId}">
      ${amountLine({ dateId: 'ci-date', date: f.date, amtId: 'ci-amt', amount: f.amountVnd ? fmtNum(f.amountVnd) : '' })}
      <div class="amt-tools">
        <select id="ci-cat" class="cat-select" aria-label="Danh mục">${cats.map((c) => `<option value="${c.id}" ${c.id === f.categoryId ? 'selected' : ''}>${esc(c.icon + '  ' + c.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><span>Nguồn chi</span>
        <div class="chips" id="ci-src">${S.CARD_SOURCES.map((s) => `<button type="button" class="chip ${s === f.source ? 'on' : ''}" data-src="${esc(s)}">${srcIcon(s)} ${esc(s)}</button>`).join('')}</div>
        <input id="ci-src-other" placeholder="Nguồn khác (vd: Grab, Be, thẻ siêu thị…)" value="${S.CARD_SOURCES.includes(f.source) ? '' : esc(f.source)}"></div>
      ${field('Nội dung', `<input id="ci-note" value="${esc(f.note)}" placeholder="vd: Đổ xăng, đi chợ, nạp điện thoại">`)}
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'ci-amt');
      let source = S.CARD_SOURCES.includes(f.source) ? f.source : 'Khác';
      $(sh, '#ci-src').addEventListener('click', (e) => {
        const b = e.target.closest('[data-src]');
        if (!b) return;
        source = b.dataset.src;
        sh.querySelectorAll('[data-src]').forEach((x) => x.classList.toggle('on', x === b));
      });
      if (!item) setTimeout(() => amt.focus(), 250);
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = Math.round(readMoney(amt.value));
        if (!(v > 0)) return toast('Nhập số tiền');
        const locked = S.lockError(S.currentProfile().id);
        if (locked) return toast(locked, 4500);
        const other = $(sh, '#ci-src-other').value.trim();
        const src = other || source;
        const categoryId = $(sh, '#ci-cat').value;
        await S.put('transactions', {
          ...f, type: 'expense', amount: v, currency: 'VND', rate: 1, amountVnd: v, source: src, categoryId,
          note: $(sh, '#ci-note').value.trim(), date: $(sh, '#ci-date').value || todayISO(),
          accountId: null, tags: f.tags || [], splits: null, photoIds: f.photoIds || [], status: f.status || 'open',
          createdAt: f.createdAt || Date.now(),
        });
        await S.setSetting('lastSource', src, { silent: true });
        await S.setSetting('lastCat', { ...state.settings.lastCat, expense: categoryId }, { silent: true });
        close(); toast(`Đã ghi khoản chi ${fmt(v)} (${src})`);
      });
    },
  });
}

/** Withdraw thanh toán 1 hoặc nhiều khoản chi của thẻ từ tài khoản của một người dùng. */
function cardPaySheet(items) {
  const users = S.moneyBooks();
  const total = sumAmt(items);
  openSheet({
    title: items.length > 1 ? `Withdraw thanh toán ${items.length} khoản` : 'Withdraw thanh toán',
    body: `<form class="form">
      <div class="note-box">${items.length > 1 ? `${items.length} khoản chưa thanh toán` : esc(items[0].note || items[0].source) + ' · ' + esc(items[0].source)}<br><b class="expense big-amt">${fmt(total)}</b></div>
      <div class="field"><span>Người trả</span><div class="chips" id="cp-who">${users.map((p, i) => `<button type="button" class="chip ${i === 0 ? 'on' : ''}" data-who="${esc(p.id)}">${esc(p.icon)} ${esc(S.bookLabel(p))}${p.locked ? ' 🔒' : ''}</button>`).join('')}</div></div>
      ${field('Từ tài khoản', `<select id="cp-acc"><option>Đang tải…</option></select>`)}
      <em class="hint" id="cp-bal"></em>
      ${datePick('cp-date', todayISO(), 'Ngày thanh toán')}
      <p class="muted small">Sổ của người trả sẽ ghi ${items.length > 1 ? 'các' : 'một'} khoản chi tương ứng; khoản của thẻ chuyển sang ✅ Done.</p>
      <div class="actions"><button class="btn primary">💸 Withdraw ${fmt(total)}</button></div>
    </form>`,
    onMount(sh, close) {
      let whoId = users[0].id;
      const balances = new Map();
      const updBal = () => {
        const have = balances.get($(sh, '#cp-acc').value);
        if (have == null) return;
        balHint($(sh, '#cp-bal'), { have, need: total, bookId: whoId, who: ' của ' + S.bookLabel(users.find((x) => x.id === whoId)) });
      };
      const load = async () => {
        const all = await S.peerAccounts(whoId);
        const banks = all.filter((a) => a.kind !== 'cash');
        const accs = banks.length ? banks : all;
        balances.clear();
        for (const a of accs) balances.set(a.id, await S.peerBalance(whoId, a.id));
        $(sh, '#cp-acc').innerHTML = accs.map((a) => `<option value="${a.id}">${esc(a.icon + ' ' + a.name)} — ${fmt(balances.get(a.id))}</option>`).join('');
        updBal();
      };
      $(sh, '#cp-who').addEventListener('click', (e) => {
        const b = e.target.closest('[data-who]');
        if (!b) return;
        whoId = b.dataset.who;
        sh.querySelectorAll('[data-who]').forEach((x) => x.classList.toggle('on', x === b));
        load();
      });
      $(sh, '#cp-acc').addEventListener('change', updBal);
      load();
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const accountId = $(sh, '#cp-acc').value;
        const have = balances.get(accountId);
        if (have == null) return toast('Chọn tài khoản');
        const who = users.find((p) => p.id === whoId);
        if (total > have) return toast(`⛔ Số dư của ${S.bookLabel(who)} không đủ: còn ${fmt(have)}, cần ${fmt(total)}`, 4500);
        const date = $(sh, '#cp-date').value || todayISO();
        try {
          for (const it of items) await S.payCardItem(it, { profileId: whoId, accountId, date });
        } catch (err) { return toast('⛔ ' + err.message, 4500); }
        close();
        toast(`✅ Đã withdraw ${fmt(total)} từ ${S.bookLabel(who)}`);
      });
    },
  });
}

// ================= Tổng quan =================
function homeView() {
  const r = currentRange();
  const t = S.totals(r);
  const alerts = S.getAlerts();
  const today = todayISO();
  const recent = sortTx([...state.transactions]).slice(0, 6);
  const hour = Number(fmtTimeVN(Date.now()).slice(0, 2));
  const loggedToday = state.transactions.some((x) => x.date === today);
  const greet = hour < 11 ? '☀️ Chào buổi sáng' : hour < 14 ? '🍱 Chào buổi trưa' : hour < 18 ? '🌤️ Chào buổi chiều' : '🌙 Chào buổi tối';

  return `
  ${topBar(`${greet}, ${esc(S.currentUser().name)}! · ${fmtDayHeader(today)}`, summaryBtn())}
  ${periodBar()}
  <section class="card hero">
    <div class="hero-row">
      <div><small>Thu</small><b class="income">${fmt(t.income)}</b></div>
      <div><small>Chi</small><b class="expense">${fmt(t.expense)}</b></div>
    </div>
    <div class="hero-net"><small>Chênh lệch kỳ này</small><strong class="${t.net >= 0 ? 'income' : 'expense'}">${fmtSigned(t.net)}</strong></div>
    <div class="hero-bal"><span>Tổng số dư tài khoản</span><b>${fmt(S.totalBalance())}</b></div>
    ${quickButtons()}
  </section>

  ${!loggedToday && hour >= 18 ? `<button type="button" class="banner" data-act="add">✏️ Hôm nay bạn chưa ghi khoản nào. Ghi ngay?</button>` : ''}

  ${alerts.length ? `${sectionTitle('⚠️ Cảnh báo từ Kế hoạch')}<div class="card list">${alerts.map(alertRow).join('')}</div>` : ''}

  ${sectionTitle('Tài khoản ngân hàng', `<button type="button" class="link" data-act="accounts">Quản lý</button>`)}
  <div class="card list">${S.activeAccounts().map((a) => {
    const b = S.accountBalance(a);
    return `<button type="button" class="row" data-act="acc-edit" data-id="${a.id}"><span class="ci" style="--c:#3e63dd">${esc(a.icon)}</span><span class="grow"><b>${esc(a.name)}</b><small>${esc(accSub(a))}</small></span><span class="amt ${b < 0 ? 'expense' : ''}">${fmt(b)}</span></button>`;
  }).join('')}
  ${canAddAccount() ? `<button type="button" class="row add-row" data-act="acc-edit"><span class="ci">＋</span><span class="grow"><b>Thêm tài khoản ngân hàng</b></span></button>` : ''}</div>


  ${sectionTitle('Gần đây', `<a class="link" href="#/tx">Tất cả</a>`)}
  ${recent.length ? `<div class="card list">${recent.map(txRow).join('')}</div>` : empty('🪙', 'Chưa có giao dịch nào. Bấm nút <b>+</b> để ghi khoản đầu tiên.')}
  ${fab()}`;
}

function alertRow(a) {
  const map = {
    debt: ['🏦', 'debt-open', a.days < 0 ? 'over' : 'warn'],
    pending: ['⏳', 'pending-open', 'warn'],
    recurring: ['🔁', 'rec-open', ''],
    budget: ['⚠️', 'budget-goto', a.level >= 100 ? 'over' : 'warn'],
  }[a.kind];
  const sub = a.kind === 'budget'
    ? `Đã dùng ${Math.round(a.ratio * 100)}% ngân sách (${fmt(a.amount)} / ${fmt(a.limit)})`
    : a.kind === 'pending' ? (a.noFunds ? `Đến kỳ ${fmtDate(a.date)} — chưa ghi được vì không đủ số dư` : `Đến kỳ ${fmtDate(a.date)} — bấm để xác nhận số tiền`) : `${fmtDue(a.days)} · ${fmtDate(a.date)}`;
  return `<button type="button" class="row alert ${map[2]}" data-act="${map[1]}" data-id="${a.id}">
    <span class="ci">${map[0]}</span><span class="grow"><b>${esc(a.title)}</b><small>${esc(sub)}</small></span>
    ${a.kind !== 'budget' ? `<span class="amt">${fmt(a.amount)}</span>` : ''}</button>`;
}

const fab = () => `<button type="button" class="fab" data-act="add" aria-label="Thêm giao dịch">+</button>`;

// ================= Giao dịch =================
function filteredTx() {
  const f = ui.txFilter;
  const r = currentRange();
  const q = f.q.trim().toLowerCase();
  return S.txIn(r).filter((t) => {
    if (f.type !== 'all' && t.type !== f.type) return false;
    if (f.categoryId && !S.txParts(t).some((p) => p.categoryId === f.categoryId)) return false;
    if (f.tag && !(t.tags || []).includes(f.tag)) return false;
    if (f.accountId && t.accountId !== f.accountId && t.toAccountId !== f.accountId) return false;
    if (q) {
      const hay = [t.note, ...(t.tags || []), ...S.txParts(t).map((p) => S.catById(p.categoryId)?.name), accName(t.accountId), String(t.amountVnd)]
        .join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function txListHtml() {
  const list = filteredTx();
  let inc = 0, exp = 0;
  for (const t of list) { if (t.type === 'income') inc += t.amountVnd; else if (t.type === 'expense') exp += t.amountVnd; }
  return `<p class="muted center">${list.length} giao dịch · Thu <b class="income">${fmt(inc)}</b> · Chi <b class="expense">${fmt(exp)}</b></p>
    ${list.length ? groupedTx(list) : empty('🔍', 'Không có giao dịch phù hợp trong kỳ này.')}`;
}

function txView() {
  const f = ui.txFilter;
  if (f.type === 'transfer') f.type = 'all';
  const chips = [];
  if (f.categoryId) chips.push(['categoryId', (S.catById(f.categoryId) || UNKNOWN_CAT).name]);
  if (f.tag) chips.push(['tag', '#' + f.tag]);
  if (f.accountId) chips.push(['accountId', accName(f.accountId)]);
  const tags = S.allTags().slice(0, 12);
  return `
  ${topBar('📒 Giao dịch', '<button type="button" class="icon-btn" data-act="export-csv" title="Xuất CSV">⬇️</button>')}
  ${periodBar()}
  <div class="filters">
    <input id="tx-q" type="search" placeholder="Tìm ghi chú, danh mục, tag, số tiền…" value="${esc(f.q)}">
    <div class="seg small">${['all', 'expense', 'income'].map((t) =>
      `<button type="button" data-act="tx-type" data-v="${t}" class="${f.type === t ? 'on' : ''}">${t === 'all' ? 'Tất cả' : TYPE_LABEL[t]}</button>`).join('')}</div>
    <div class="chips">
      ${chips.map(([k, label]) => `<button type="button" class="chip on" data-act="tx-unfilter" data-v="${k}">${esc(label)} ✕</button>`).join('')}
      <select id="tx-acc" class="chip-select"><option value="">Mọi tài khoản</option>${S.activeAccounts().map((a) => `<option value="${a.id}" ${f.accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      ${tags.filter((g) => g !== f.tag).map((g) => `<button type="button" class="chip" data-act="tx-tag" data-v="${esc(g)}">#${esc(g)}</button>`).join('')}
    </div>
  </div>
  <div id="tx-list">${txListHtml()}</div>
  ${fab()}`;
}

function mountTx(root) {
  const q = $(root, '#tx-q');
  q.addEventListener('input', debounce(() => {
    ui.txFilter.q = q.value;
    $(root, '#tx-list').innerHTML = txListHtml();
  }, 150));
  $(root, '#tx-acc').addEventListener('change', (e) => { ui.txFilter.accountId = e.target.value || null; refresh(); });
}

actions['tx-type'] = (el) => { ui.txFilter.type = el.dataset.v; refresh(); };
actions['tx-tag'] = (el) => { ui.txFilter.tag = el.dataset.v; refresh(); };
actions['tx-unfilter'] = (el) => { ui.txFilter[el.dataset.v] = null; refresh(); };
actions['tx-edit'] = (el) => {
  const tx = state.transactions.find((t) => t.id === el.dataset.id);
  if (tx) (tx.gop ? gopDetail(tx) : tx.cardPay ? cardPayDetail(tx) : openTxForm({ tx }));
};

/** Khoản chi trong sổ người dùng được tạo khi withdraw thanh toán cho thẻ chi tiêu. */
function cardPayDetail(tx) {
  const cp = tx.cardPay;
  const cardExists = S.getProfiles().some((p) => p.id === cp.cardId);
  openSheet({
    title: 'Thanh toán thẻ chi tiêu',
    body: `<div class="detail">
      <div class="big-ic">💳</div>
      <div class="kv"><span>Thẻ</span><b>${esc(cp.cardName)}${cardExists ? '' : ' (đã xóa)'}</b></div>
      <div class="kv"><span>Nội dung</span><b>${esc(tx.note)}</b></div>
      <div class="kv"><span>Nguồn chi</span><b>${esc(cp.source || '—')}</b></div>
      <div class="kv"><span>Số tiền</span><b class="expense">${fmtSigned(-tx.amountVnd)}</b></div>
      <div class="kv"><span>Từ tài khoản</span><b>${esc(accName(tx.accountId))}</b></div>
      <div class="kv"><span>Ngày</span><b>${fmtDate(tx.date)}</b></div>
      <p class="muted small">Xóa khoản này thì khoản chi bên thẻ sẽ quay về "Chưa thanh toán".</p>
      <div class="actions"><button type="button" class="btn danger" data-del>Xóa khoản thanh toán</button></div>
    </div>`,
    onMount(sh, close) {
      $(sh, '[data-del]').addEventListener('click', async () => {
        if (!confirm('Xóa khoản thanh toán này? Khoản chi bên thẻ sẽ quay về "Chưa thanh toán".')) return;
        await S.deleteTx(tx);
        close(); toast('Đã xóa khoản thanh toán');
      });
    },
  });
}

// ================= Transfer tiền giữa các người dùng =================
// Người dùng khác (không tính thẻ chi tiêu) — dùng cho Transfer, Withdraw, chọn sổ để ghi.
// Đích Transfer / Withdraw tùy loại mục đang mở (Ngân hàng, Tiết kiệm, NEOBANK, Cash Outflow).
const otherProfiles = (mode = 'gop') => S.transferTargets(mode);

actions.gop = () => openGopForm();

/** Ô chọn danh mục Transfer/Withdraw (dùng chung mọi mục); chọn "＋ Thêm danh mục…" để tạo mới. */
function flowCatField(id, selected = state.settings.lastFlowCat || '') {
  return field('🏷️ Danh mục transfer/withdraw', `<select id="${id}" data-flowcat>${flowCatOptions(selected)}</select>`);
}
const flowCatOptions = (selected) => `<option value="">— Không phân loại —</option>`
  + S.flowCats().map((c) => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.icon + ' ' + c.name)}</option>`).join('')
  + '<option value="__new">＋ Thêm danh mục…</option>';

document.addEventListener('change', (e) => {
  const sel = e.target;
  if (!sel.matches || !sel.matches('select[data-flowcat]')) return;
  if (sel.value === '__new') {
    const name = (prompt('Tên danh mục Transfer/Withdraw mới') || '').trim();
    let pick = '';
    if (name) { try { pick = S.addFlowCat(name).id; toast('Đã thêm danh mục'); } catch (err) { toast(err.message); } }
    sel.innerHTML = flowCatOptions(pick);
  }
  if (sel.value) S.setSetting('lastFlowCat', sel.value, { silent: true });
});

function openGopForm() {
  const others = otherProfiles('gop');
  if (!others.length) {
    toast('Chưa có mục nào để transfer vào');
    return actions.profiles();
  }
  const me = S.currentProfile();
  const formId = 'gf-' + Date.now();
  openSheet({
    title: 'Transfer tiền cho người khác',
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">🤝 Transfer</button>`,
    body: `<form class="form" id="${formId}">
      <p class="muted small">Sổ của <b>${esc(S.bookLabel(me))}</b> ghi một khoản <b class="expense">chi</b>, sổ người nhận ghi một khoản <b class="income">thu</b>.</p>
      <div class="field"><span>Transfer cho</span><div class="chips" id="gf-to">${others.map((p, i) => `<button type="button" class="chip ${i === 0 ? 'on' : ''}" data-to="${esc(p.id)}">${esc(p.icon)} ${esc(S.bookLabel(p))}${p.locked ? ' 🔒' : ''}</button>`).join('')}</div></div>
      ${field('Từ tài khoản', `<select id="gf-from">${accOptions(state.settings.lastAccount, true)}</select>`)}
      <em class="hint" id="gf-bal"></em>
      ${amountLine({ dateId: 'gf-date', date: todayISO(), amtId: 'gf-amt' })}
      ${flowCatField('gf-fcat')}
      ${field('Vào tài khoản của <span id="gf-to-name"></span>', `<select id="gf-toacc"><option>Đang tải…</option></select>`)}
      ${field('Ghi chú (không bắt buộc)', `<input id="gf-note" placeholder="vd: Transfer tiền chợ tháng 11">`)}
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'gf-amt');
      const updBal = () => balHint($(sh, '#gf-bal'), {
        have: S.available($(sh, '#gf-from').value), need: Math.round(readMoney(amt.value) || 0), bookId: S.currentProfile().id,
      });
      amt.addEventListener('input', updBal);
      $(sh, '#gf-from').addEventListener('change', updBal);
      updBal();
      let toId = others[0].id;
      const loadPeer = async () => {
        const p = others.find((x) => x.id === toId);
        $(sh, '#gf-to-name').textContent = S.bookLabel(p);
        const all = await S.peerAccounts(toId);
        const banks = all.filter((a) => a.kind !== 'cash');
        const accs = banks.length ? banks : all;
        $(sh, '#gf-toacc').innerHTML = accs.map((a) => `<option value="${a.id}">${esc(a.icon + ' ' + a.name)}</option>`).join('');
      };
      $(sh, '#gf-to').addEventListener('click', (e) => {
        const b = e.target.closest('[data-to]');
        if (!b) return;
        toId = b.dataset.to;
        sh.querySelectorAll('[data-to]').forEach((x) => x.classList.toggle('on', x === b));
        loadPeer();
      });
      loadPeer();
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = Math.round(readMoney(amt.value));
        if (!(v > 0)) return toast('Nhập số tiền transfer');
        const toAccountId = $(sh, '#gf-toacc').value;
        if (!toAccountId) return toast('Chọn tài khoản nhận');
        if (!checkFunds($(sh, '#gf-from').value, v)) return;
        const to = others.find((x) => x.id === toId);
        await S.gop({
          toProfileId: toId, amount: v, fromAccountId: $(sh, '#gf-from').value, toAccountId,
          date: $(sh, '#gf-date').value || todayISO(), note: $(sh, '#gf-note').value.trim(), flowCat: $(sh, '#gf-fcat').value || null,
        });
        close();
        toast(`🤝 Đã transfer ${fmt(v)} cho ${S.bookLabel(to)}`);
      });
    },
  });
}

function gopDetail(tx) {
  const out = tx.gop.dir === 'out';
  const isTrich = tx.gop.mode === 'trich';
  const word = isTrich ? 'withdraw' : 'transfer';
  const peerExists = S.getProfiles().some((p) => p.id === tx.gop.peer);
  openSheet({
    title: isTrich ? (out ? 'Khoản bị withdraw' : 'Khoản withdraw') : (out ? 'Khoản transfer' : 'Khoản nhận transfer'),
    body: `<div class="detail">
      <div class="big-ic">${isTrich ? '🔄' : '🤝'}</div>
      <div class="kv"><span>Nội dung</span><b>${esc(gopLabel(tx.gop))}${peerExists ? '' : ' (người dùng đã xóa)'}</b></div>
      <div class="kv"><span>Số tiền</span><b class="${out ? 'expense' : 'income'}">${fmtSigned(out ? -tx.amountVnd : tx.amountVnd)}</b></div>
      ${tx.gop.flowCat ? `<div class="kv"><span>Danh mục</span><b>${esc((S.flowCatById(tx.gop.flowCat)?.icon || '') + ' ' + (S.flowCatById(tx.gop.flowCat)?.name || '—'))}</b></div>` : ''}
      <div class="kv"><span>${out ? 'Từ tài khoản' : 'Vào tài khoản'}</span><b>${esc(accName(tx.accountId))}</b></div>
      <div class="kv"><span>Ngày</span><b>${fmtDate(tx.date)}</b></div>
      ${tx.createdAt ? `<div class="kv"><span>Ghi nhận lúc</span><b>${fmtDateTimeVN(tx.createdAt)}</b></div>` : ''}
      ${tx.note ? `<div class="kv"><span>Ghi chú</span><b>${esc(tx.note)}</b></div>` : ''}
      <p class="muted small">Khoản ${word} được ghi ở cả 2 sổ. Muốn sửa số tiền: xóa khoản này rồi ${word} lại.</p>
      <div class="actions"><button type="button" class="btn danger" data-del>Xóa khoản ${word}${peerExists ? ' (cả 2 bên)' : ''}</button></div>
    </div>`,
    onMount(sh, close) {
      $(sh, '[data-del]').addEventListener('click', async () => {
        if (!confirm(`Xóa khoản ${word} này?${peerExists ? ` Giao dịch tương ứng trong sổ của ${tx.gop.peerName} cũng bị xóa.` : ''}`)) return;
        await S.deleteTx(tx);
        close(); toast(`Đã xóa khoản ${word}`);
      });
    },
  });
}

actions.trich = () => openTrichForm();

/** Withdraw: lấy tiền từ tài khoản của người khác về tài khoản của mình (ngược với Transfer). */
function openTrichForm() {
  const others = otherProfiles('trich');
  if (!others.length) {
    toast('Chưa có mục nào để withdraw tiền');
    return actions.profiles();
  }
  const me = S.currentProfile();
  const formId = 'tr-' + Date.now();
  openSheet({
    title: 'Withdraw tiền từ người khác',
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">🔄 Withdraw</button>`,
    body: `<form class="form" id="${formId}">
      <p class="muted small">Sổ người bị withdraw ghi một khoản <b class="expense">chi</b>, sổ của <b>${esc(S.bookLabel(me))}</b> ghi một khoản <b class="income">thu</b>. Người bị withdraw phải đủ số dư.</p>
      <div class="field"><span>Withdraw từ</span><div class="chips" id="tr-from">${others.map((p, i) => `<button type="button" class="chip ${i === 0 ? 'on' : ''}" data-from="${esc(p.id)}">${esc(p.icon)} ${esc(S.bookLabel(p))}${p.locked ? ' 🔒' : ''}</button>`).join('')}</div></div>
      ${field('Từ tài khoản của <span id="tr-from-name"></span>', `<select id="tr-facc"><option>Đang tải…</option></select>`)}
      <em class="hint" id="tr-bal"></em>
      ${amountLine({ dateId: 'tr-date', date: todayISO(), amtId: 'tr-amt' })}
      ${flowCatField('tr-fcat')}
      ${field('Vào tài khoản của ' + esc(S.bookLabel(me)), `<select id="tr-to">${accOptions(state.settings.lastAccount)}</select>`)}
      ${field('Ghi chú (không bắt buộc)', `<input id="tr-note" placeholder="vd: Withdraw tiền học cho con">`)}
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'tr-amt');
      let fromId = others[0].id;
      const balances = new Map();
      const updBal = () => {
        const have = balances.get($(sh, '#tr-facc').value);
        if (have == null) return;
        const need = Math.round(readMoney(amt.value) || 0);
        const from = others.find((x) => x.id === fromId);
        // Secrecy đang ẩn: không lộ số dư NEOBANK, chỉ báo khi không đủ tiền.
        if (from.owner === S.SECRECY && S.secrecyHidden()) {
          const el = $(sh, '#tr-bal');
          el.textContent = need > have ? '⚠️ Số dư không đủ' : '';
          el.className = 'hint' + (need > have ? ' warn-red' : '');
          return;
        }
        balHint($(sh, '#tr-bal'), { have, need, bookId: fromId, who: ' của ' + S.bookLabel(from) });
      };
      const loadPeer = async () => {
        $(sh, '#tr-from-name').textContent = S.bookLabel(others.find((x) => x.id === fromId));
        const all = await S.peerAccounts(fromId);
        const banks = all.filter((a) => a.kind !== 'cash');
        const accs = banks.length ? banks : all;
        balances.clear();
        for (const a of accs) balances.set(a.id, await S.peerBalance(fromId, a.id));
        const hideBal = others.find((x) => x.id === fromId)?.owner === S.SECRECY && S.secrecyHidden();
        $(sh, '#tr-facc').innerHTML = accs.map((a) => `<option value="${a.id}">${esc(a.icon + ' ' + a.name)}${hideBal ? '' : ' — ' + fmt(balances.get(a.id))}</option>`).join('');
        updBal();
      };
      $(sh, '#tr-from').addEventListener('click', (e) => {
        const b = e.target.closest('[data-from]');
        if (!b) return;
        fromId = b.dataset.from;
        sh.querySelectorAll('[data-from]').forEach((x) => x.classList.toggle('on', x === b));
        loadPeer();
      });
      $(sh, '#tr-facc').addEventListener('change', updBal);
      amt.addEventListener('input', updBal);
      loadPeer();
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = Math.round(readMoney(amt.value));
        if (!(v > 0)) return toast('Nhập số tiền withdraw');
        const fromAccountId = $(sh, '#tr-facc').value;
        if (!balances.has(fromAccountId)) return toast('Chọn tài khoản bị withdraw');
        const from = others.find((x) => x.id === fromId);
        try {
          await S.trich({
            fromProfileId: fromId, amount: v, fromAccountId, toAccountId: $(sh, '#tr-to').value,
            date: $(sh, '#tr-date').value || todayISO(), note: $(sh, '#tr-note').value.trim(), flowCat: $(sh, '#tr-fcat').value || null,
          });
        } catch (err) { return toast('⛔ ' + err.message, 4500); }
        close();
        toast(`🔄 Đã withdraw ${fmt(v)} từ ${S.bookLabel(from)}`);
      });
    },
  });
}
actions['report-cat'] = (el) => {
  ui.txFilter = { type: 'all', q: '', categoryId: el.dataset.id, tag: null, accountId: null };
  location.hash = '#/tx';
};

// ================= Báo cáo =================
/** Gom cột theo độ dài kỳ: ≤ 31 ngày → theo ngày; ≤ 120 ngày → theo tuần; dài hơn → theo tháng. */
function trendBuckets(r) {
  let buckets, idx;
  if (r.days <= 31) {
    buckets = Array.from({ length: r.days }, (_, i) => {
      const d = addDays(r.start, i);
      return { label: r.type === 'month' ? String(Number(d.slice(8))) : fmtDM(d), income: 0, expense: 0 };
    });
    idx = (d) => diffDays(r.start, d);
  } else if (r.days <= 120) {
    buckets = Array.from({ length: Math.ceil(r.days / 7) }, (_, i) => ({ label: fmtDM(addDays(r.start, i * 7)), income: 0, expense: 0 }));
    idx = (d) => Math.floor(diffDays(r.start, d) / 7);
  } else {
    const y0 = Number(r.start.slice(0, 4)), m0 = Number(r.start.slice(5, 7));
    const mIndex = (d) => (Number(d.slice(0, 4)) - y0) * 12 + Number(d.slice(5, 7)) - m0;
    const multiYear = r.start.slice(0, 4) !== r.end.slice(0, 4);
    buckets = Array.from({ length: mIndex(r.end) + 1 }, (_, i) => {
      const m = ((m0 - 1 + i) % 12) + 1, y = y0 + Math.floor((m0 - 1 + i) / 12);
      return { label: multiYear ? `${m}/${String(y).slice(2)}` : 'T' + m, income: 0, expense: 0 };
    });
    idx = mIndex;
  }
  for (const t of S.txIn(r)) {
    const b = buckets[idx(t.date)];
    if (!b) continue;
    if (t.type === 'income') b.income += t.amountVnd;
    else if (t.type === 'expense') b.expense += t.amountVnd;
  }
  return buckets;
}

function pctChange(cur, prev) {
  if (!prev) return cur ? 'kỳ trước chưa có dữ liệu' : '';
  const p = Math.round(((cur - prev) / prev) * 100);
  return p === 0 ? 'bằng kỳ trước' : `${p > 0 ? 'tăng' : 'giảm'} ${Math.abs(p)}% so với kỳ trước`;
}

function reportsView() {
  const r = reportRange();
  const t = S.totals(r);
  const pt = S.totals(prevRange(r, state.settings.weekStart));
  const type = ui.reportType;
  const cats = S.byCategory(r, type);
  const total = type === 'expense' ? t.expense : t.income;
  const elapsed = elapsedDays(r);
  const alloc = S.allocation(r);
  const tagMap = new Map();
  for (const x of S.txIn(r)) if (x.type === 'expense') for (const g of x.tags || []) tagMap.set(g, (tagMap.get(g) || 0) + x.amountVnd);
  const tags = [...tagMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  return `
  ${topBar('📊 Báo cáo')}
  ${periodBar('report')}
  <section class="card stats">
    <div><small>Thu</small><b class="income">${fmt(t.income)}</b><em>${pctChange(t.income, pt.income)}</em></div>
    <div><small>Chi</small><b class="expense">${fmt(t.expense)}</b><em>${pctChange(t.expense, pt.expense)}</em></div>
    <div><small>Chênh lệch</small><b class="${t.net >= 0 ? 'income' : 'expense'}">${fmtSigned(t.net)}</b>
      <em>${t.income > 0 ? `Tỷ lệ tiết kiệm ${Math.round((t.net / t.income) * 100)}%` : ''}</em></div>
    <div><small>Chi trung bình/ngày</small><b>${fmt(elapsed ? t.expense / elapsed : 0)}</b><em>${elapsed} ngày đã qua</em></div>
  </section>

  ${r.type === 'day' ? '' : `${sectionTitle('Theo thời gian')}
  <section class="card"><div class="legend-inline"><span><i class="dot b-in"></i>Thu</span><span><i class="dot b-ex"></i>Chi</span></div>${bars(trendBuckets(r))}</section>`}

  ${sectionTitle('Theo danh mục', `<div class="seg small">${['expense', 'income'].map((x) => `<button type="button" data-act="report-type" data-v="${x}" class="${type === x ? 'on' : ''}">${TYPE_LABEL[x]}</button>`).join('')}</div>`)}
  <section class="card">
    ${cats.length ? `<div class="donut-wrap">${donut(cats.map((c) => ({ value: c.amount, color: c.cat.color })), { label: type === 'expense' ? 'Tổng chi' : 'Tổng thu', value: fmtShort(total) })}</div>
    <div class="list">${cats.map((c) => `<button type="button" class="row" data-act="report-cat" data-id="${c.cat.id}">${catIcon(c.cat)}
      <span class="grow"><b>${esc(c.cat.name)}</b><small>${total ? ((c.amount / total) * 100).toFixed(1) : 0}%</small></span><span class="amt">${fmt(c.amount)}</span></button>`).join('')}</div>`
      : empty('📭', 'Chưa có dữ liệu trong kỳ này.')}
  </section>

  ${alloc ? allocationCard(alloc) : ''}

  ${tags.length ? `${sectionTitle('Chi theo tag')}<section class="card list">${tags.map(([g, v]) => `<button type="button" class="row" data-act="tx-tag-go" data-v="${esc(g)}"><span class="ci">#</span><span class="grow"><b>${esc(g)}</b></span><span class="amt">${fmt(v)}</span></button>`).join('')}</section>` : ''}
  `;
}

function allocationCard(a) {
  return `${sectionTitle('Phân bổ ' + esc(a.method.name), `<a class="link" href="#/settings">Đổi</a>`)}
  <section class="card">
    <p class="muted">Dựa trên ${a.usingExpected ? 'thu nhập dự kiến' : 'thu nhập thực tế'}: <b>${fmt(a.base)}</b>
      ${a.usingExpected && !a.base ? '<br>Hãy nhập "Thu nhập dự kiến/tháng" trong Cài đặt hoặc ghi khoản thu.' : ''}</p>
    ${a.groups.map((g) => `<div class="alloc"><div class="alloc-h"><b>${esc(g.name)}</b><span>${g.pct}%</span></div>
      ${progress(g.target ? g.spent / g.target : g.spent ? 1 : 0)}
      <small>Đã chi ${fmt(g.spent)} / mục tiêu ${fmt(g.target)}</small></div>`).join('')}
    ${a.unassigned ? `<p class="muted">Chưa gán nhóm: ${fmt(a.unassigned)} (sửa trong Cài đặt → Danh mục)</p>` : ''}
  </section>`;
}

actions['report-type'] = (el) => { ui.reportType = el.dataset.v; refresh(); };
actions['tx-tag-go'] = (el) => {
  ui.txFilter = { type: 'all', q: '', categoryId: null, tag: el.dataset.v, accountId: null };
  location.hash = '#/tx';
};

// ================= Kế hoạch =================
const PLAN_TABS = { budget: 'Ngân sách', goals: 'Mục tiêu', debts: 'Trả nợ', recurring: 'Định kỳ' };

function planView(sub) {
  if (sub && PLAN_TABS[sub]) ui.planTab = sub;
  const tab = ui.planTab;
  const body = { budget: budgetTab, goals: goalsTab, debts: debtsTab, recurring: recurringTab }[tab]();
  return `${topBar('🎯 Kế hoạch')}
  <div class="seg tabs">${Object.entries(PLAN_TABS).map(([k, v]) => `<a href="#/plan/${k}" class="${tab === k ? 'on' : ''}">${v}</a>`).join('')}</div>
  ${body}`;
}

// ----- Ngân sách -----
function budgetTab() {
  const today = todayISO();
  const list = state.budgets.map((b) => ({ b, st: S.budgetStatus(b) })).sort((x, y) => y.st.ratio - x.st.ratio);
  const alloc = S.allocation(getRange('month', today));
  return `
  <p class="muted">Đặt hạn mức chi theo tuần/tháng/năm. App cảnh báo khi dùng 80% và khi vượt 100%.</p>
  ${list.length ? `<div class="card list">${list.map(({ b, st }) => {
    const daysLeft = diffDays(today, st.range.end) + 1;
    const cat = b.categoryId === '__all' ? { icon: 'Σ', color: '#3e63dd' } : S.catById(b.categoryId);
    return `<button type="button" class="row col" data-act="budget-edit" data-id="${b.id}">
      <div class="row-top">${catIcon(cat)}<span class="grow"><b>${esc(S.budgetName(b))}</b><small>${PERIOD_LABEL[b.period || 'month']} này · ${esc(st.range.label)}</small></span>
      <span class="amt ${st.left < 0 ? 'expense' : ''}">${st.left < 0 ? 'Vượt ' + fmt(-st.left) : 'Còn ' + fmt(st.left)}</span></div>
      ${progress(st.ratio)}
      <small class="muted">Đã chi ${fmt(st.spent)} / ${fmt(b.amount)} (${Math.round(st.ratio * 100)}%)${st.left > 0 && daysLeft > 0 ? ` · nên chi ≤ ${fmt(st.left / daysLeft)}/ngày` : ''}</small>
    </button>`;
  }).join('')}</div>` : empty('💸', 'Chưa có ngân sách nào.')}
  <button type="button" class="btn primary block" data-act="budget-edit">+ Thêm ngân sách</button>
  ${alloc ? allocationCard(alloc) : `<p class="muted center">Muốn chia thu nhập theo <b>50/30/20</b> hoặc <b>6 chiếc lọ</b>? Bật trong <a href="#/settings">Cài đặt</a>.</p>`}`;
}

actions['budget-goto'] = () => {
  if (state.settings.showPlan === false) return toast('Mục Kế hoạch đang ẩn — bật lại trong Cài đặt → Hiển thị');
  ui.planTab = 'budget';
  location.hash = '#/plan/budget';
};
actions['budget-edit'] = (el) => {
  const b = state.budgets.find((x) => x.id === el.dataset.id);
  const f = b ? { ...b } : { categoryId: '__all', amount: 0, period: 'month' };
  openSheet({
    title: b ? 'Sửa ngân sách' : 'Thêm ngân sách',
    body: `<form class="form">
      ${field('Áp dụng cho', `<select id="bf-cat">${catOptions('expense', f.categoryId, `<option value="__all" ${f.categoryId === '__all' ? 'selected' : ''}>Σ Tổng chi tiêu</option>`)}</select>`)}
      ${amountField('bf-amt', f.amount, 'Hạn mức')}
      ${field('Chu kỳ', `<select id="bf-per">${['month', 'year'].map((p) => `<option value="${p}" ${f.period === p ? 'selected' : ''}>Mỗi ${PERIOD_LABEL[p].toLowerCase()}</option>`).join('')}</select>`)}
      <div class="actions">${b ? '<button type="button" class="btn danger" data-del>Xóa</button>' : ''}<button class="btn primary">Lưu</button></div>
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'bf-amt');
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = readMoney(amt.value);
        if (!(v > 0)) return toast('Nhập hạn mức hợp lệ');
        await S.put('budgets', { ...f, categoryId: $(sh, '#bf-cat').value, amount: Math.round(v), period: $(sh, '#bf-per').value });
        close(); toast('Đã lưu ngân sách');
      });
      $(sh, '[data-del]')?.addEventListener('click', async () => {
        if (!confirm('Xóa ngân sách này?')) return;
        await S.remove('budgets', b.id); close();
      });
    },
  });
};

// ----- Mục tiêu & quỹ dự phòng -----
function goalsTab() {
  const em = S.emergencyInfo();
  const goals = state.goals.filter((g) => !g.isEmergency);
  const eg = em.goal;
  return `
  <section class="card emergency">
    <div class="row-top"><span class="ci" style="--c:#e5484d">🛟</span><span class="grow"><b>Quỹ dự phòng khẩn cấp</b>
      <small>Nên bằng ${em.months} tháng chi tiêu</small></span></div>
    ${em.avg ? `<p>Chi tiêu trung bình: <b>${fmt(em.avg)}</b>/tháng → mục tiêu <b>${fmt(em.target)}</b></p>` : '<p class="muted">Chưa đủ dữ liệu chi tiêu để tính. Hãy ghi chép vài tuần.</p>'}
    ${eg ? `${progress(eg.target ? eg.saved / eg.target : 0, 'goal')}<small class="muted">Đã có ${fmt(eg.saved)} / ${fmt(eg.target)}</small>
      <div class="actions"><button type="button" class="btn ghost" data-act="goal-open" data-id="${eg.id}">Chi tiết</button>
      ${em.target && em.target !== eg.target ? `<button type="button" class="btn ghost" data-act="emergency-sync">Cập nhật mục tiêu = ${fmtShort(em.target)}</button>` : ''}</div>`
      : `<button type="button" class="btn primary block" data-act="emergency-create">Tạo quỹ dự phòng</button>`}
  </section>
  ${sectionTitle('Mục tiêu tiết kiệm')}
  ${goals.length ? `<div class="card list">${goals.map(goalRow).join('')}</div>` : empty('🎯', 'Chưa có mục tiêu. Ví dụ: mua xe, du lịch, quỹ học phí…')}
  <button type="button" class="btn primary block" data-act="goal-edit">+ Thêm mục tiêu</button>`;
}

function goalPlan(g) {
  const left = Math.max(0, g.target - g.saved);
  if (!g.deadline || !left) return '';
  const months = Math.max(1, Math.ceil(diffDays(todayISO(), g.deadline) / 30.4));
  return diffDays(todayISO(), g.deadline) < 0 ? 'Đã quá hạn' : `Cần ${fmt(left / months)}/tháng trong ${months} tháng`;
}

function goalRow(g) {
  const ratio = g.target ? g.saved / g.target : 0;
  return `<button type="button" class="row col" data-act="goal-open" data-id="${g.id}">
    <div class="row-top"><span class="ci" style="--c:#30a46c">${esc(g.icon || '🎯')}</span><span class="grow"><b>${esc(g.name)}</b>
      <small>${g.deadline ? 'Hạn ' + fmtDate(g.deadline) : 'Không đặt hạn'}${goalPlan(g) ? ' · ' + goalPlan(g) : ''}</small></span>
      <span class="amt">${Math.round(ratio * 100)}%</span></div>
    ${progress(ratio, 'goal')}<small class="muted">${fmt(g.saved)} / ${fmt(g.target)}</small></button>`;
}

actions['emergency-create'] = async () => {
  const em = S.emergencyInfo();
  await S.put('goals', { name: 'Quỹ dự phòng khẩn cấp', icon: '🛟', target: em.target || 0, saved: 0, deadline: null, isEmergency: true, contributions: [] });
  toast('Đã tạo quỹ dự phòng');
};
actions['emergency-sync'] = async () => {
  const em = S.emergencyInfo();
  if (em.goal) await S.put('goals', { ...em.goal, target: em.target });
};

actions['goal-edit'] = (el) => {
  const g = state.goals.find((x) => x.id === el.dataset.id);
  const f = g ? { ...g } : { name: '', icon: '🎯', target: 0, saved: 0, deadline: '', contributions: [] };
  openSheet({
    title: g ? 'Sửa mục tiêu' : 'Mục tiêu mới',
    body: `<form class="form">
      <div class="two">${field('Biểu tượng', `<input id="gf-icon" maxlength="4" value="${esc(f.icon)}" class="emoji">`)}
      ${field('Tên mục tiêu', `<input id="gf-name" required value="${esc(f.name)}" placeholder="vd: Mua xe máy">`, 'style="flex:3"')}</div>
      ${amountField('gf-target', f.target, 'Số tiền cần đạt')}
      ${g ? '' : amountField('gf-saved', 0, 'Đã có sẵn (không bắt buộc)')}
      ${datePick('gf-dl', f.deadline || '', 'Hạn hoàn thành')}
      <div class="actions">${g ? '<button type="button" class="btn danger" data-del>Xóa</button>' : ''}<button class="btn primary">Lưu</button></div>
    </form>`,
    onMount(sh, close) {
      const tgt = bindMoney(sh, 'gf-target');
      const sv = g ? null : bindMoney(sh, 'gf-saved');
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const target = readMoney(tgt.value);
        if (!(target > 0)) return toast('Nhập số tiền mục tiêu');
        const obj = { ...f, name: $(sh, '#gf-name').value.trim(), icon: $(sh, '#gf-icon').value.trim() || '🎯', target: Math.round(target), deadline: $(sh, '#gf-dl').value || null };
        if (sv) obj.saved = Math.round(readMoney(sv.value) || 0);
        await S.put('goals', obj);
        close(); toast('Đã lưu mục tiêu');
      });
      $(sh, '[data-del]')?.addEventListener('click', async () => {
        if (!confirm('Xóa mục tiêu này? (Các giao dịch đã ghi vẫn giữ nguyên)')) return;
        await S.remove('goals', g.id); close();
      });
    },
  });
};

actions['goal-open'] = (el) => {
  const g = state.goals.find((x) => x.id === el.dataset.id);
  if (!g) return;
  const hist = [...(g.contributions || [])].reverse();
  openSheet({
    title: g.name,
    body: `<div class="goal-detail">
      <div class="big-ic">${esc(g.icon || '🎯')}</div>
      ${progress(g.target ? g.saved / g.target : 0, 'goal')}
      <p class="center"><b>${fmt(g.saved)}</b> / ${fmt(g.target)}<br><small class="muted">${goalPlan(g) || (g.saved >= g.target ? '🎉 Đã hoàn thành!' : '')}</small></p>
      <div class="actions"><button type="button" class="btn primary" data-c="1">+ Nạp tiền</button><button type="button" class="btn ghost" data-c="-1">− Rút ra</button></div>
      ${hist.length ? `<h4>Lịch sử</h4><div class="list">${hist.map((c) => `<div class="row"><span class="grow">${fmtDate(c.date)}${c.note ? ' · ' + esc(c.note) : ''}</span><span class="amt ${c.amount > 0 ? 'income' : 'expense'}">${fmtSigned(c.amount)}</span></div>`).join('')}</div>` : ''}
      <div class="actions"><button type="button" class="btn ghost" data-edit>Sửa mục tiêu</button></div>
    </div>`,
    onMount(sh, close) {
      sh.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { close(); goalContribute(g, Number(b.dataset.c)); }));
      $(sh, '[data-edit]').addEventListener('click', () => { close(); actions['goal-edit']({ dataset: { id: g.id } }); });
    },
  });
};

function goalContribute(g, dir) {
  const savingCat = S.sysCat('saving');
  openSheet({
    title: dir > 0 ? `Nạp vào "${g.name}"` : `Rút từ "${g.name}"`,
    body: `<form class="form">
      ${amountField('gc-amt', 0)}
      ${field(dir > 0 ? 'Lấy từ tài khoản' : 'Đưa về tài khoản', `<select id="gc-acc">${accOptions(state.settings.lastAccount, dir > 0)}</select>`)}
      ${datePick('gc-date', todayISO())}
      <label class="check"><input type="checkbox" id="gc-tx" ${dir > 0 ? 'checked' : ''}> ${dir > 0
        ? `Ghi thành khoản chi "${esc(savingCat?.name || 'Tiết kiệm')}" (trừ số dư tài khoản)`
        : 'Ghi thành khoản thu vào tài khoản'}</label>
      <div class="actions"><button class="btn primary">Xác nhận</button></div>
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'gc-amt');
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = Math.round(readMoney(amt.value));
        if (!(v > 0)) return toast('Nhập số tiền');
        const date = $(sh, '#gc-date').value || todayISO();
        let txId = null;
        if (dir > 0 && $(sh, '#gc-tx').checked && !checkFunds($(sh, '#gc-acc').value, v)) return;
        if ($(sh, '#gc-tx').checked) {
          const incomeCat = S.catsOf('income').find((c) => c.name === 'Thu khác') || S.catsOf('income')[0];
          const tx = await S.put('transactions', {
            type: dir > 0 ? 'expense' : 'income', amount: v, currency: 'VND', rate: 1, amountVnd: v, date,
            categoryId: dir > 0 ? savingCat?.id : incomeCat?.id, accountId: $(sh, '#gc-acc').value,
            note: (dir > 0 ? 'Tiết kiệm: ' : 'Rút từ mục tiêu: ') + g.name, tags: [], splits: null, photoIds: [], createdAt: Date.now(),
          }, { silent: true });
          txId = tx.id;
        }
        g.saved = Math.max(0, (g.saved || 0) + dir * v);
        g.contributions = [...(g.contributions || []), { date, amount: dir * v, txId }];
        await S.put('goals', g);
        close();
        toast(g.saved >= g.target && dir > 0 ? '🎉 Chúc mừng! Bạn đã đạt mục tiêu' : 'Đã cập nhật mục tiêu');
      });
    },
  });
}

// ----- Trả nợ ngân hàng -----
function debtsTab() {
  const today = todayISO();
  const m = getRange('month', today);
  const active = state.debts.filter((d) => !d.done).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const done = state.debts.filter((d) => d.done);
  const dueThisMonth = active.filter((d) => d.dueDate <= m.end).reduce((s, d) => s + d.amount, 0);
  const paidThisMonth = state.debts.flatMap((d) => d.history || []).filter((h) => h.paidDate >= m.start && h.paidDate <= m.end).reduce((s, h) => s + h.amount, 0);
  return `
  <section class="card stats two-col">
    <div><small>Còn phải trả đến hết ${m.label.toLowerCase()}</small><b class="expense">${fmt(dueThisMonth)}</b></div>
    <div><small>Đã trả trong tháng</small><b class="income">${fmt(paidThisMonth)}</b></div>
  </section>
  ${active.length ? `<div class="card list">${active.map((d) => {
    const days = diffDays(today, d.dueDate);
    const tone = days < 0 ? 'over' : days <= (d.remindDays ?? state.settings.remindDays) ? 'warn' : '';
    return `<button type="button" class="row alert ${tone}" data-act="debt-open" data-id="${d.id}">
      <span class="ci" style="--c:#0d74ce">🏦</span>
      <span class="grow"><b>${esc(S.debtName(d))}</b><small>${fmtDate(d.dueDate)} · ${fmtDue(days)}${d.repeat === 'monthly' ? ` · hằng tháng${d.periodsLeft != null ? `, còn ${d.periodsLeft} kỳ` : ''}` : ''}</small>
      ${d.method ? `<small>💳 ${esc(d.method)}</small>` : ''}</span>
      <span class="amt">${fmt(d.amount)}</span></button>`;
  }).join('')}</div>` : empty('🏦', 'Chưa có khoản trả nợ nào.')}
  <button type="button" class="btn primary block" data-act="debt-edit">+ Thêm khoản trả nợ</button>
  ${active.length ? `<button type="button" class="btn ghost block" data-act="debt-ics-all">📅 Thêm tất cả hạn trả nợ vào Lịch điện thoại</button>` : ''}
  ${done.length ? `<details class="card"><summary>Đã hoàn tất (${done.length})</summary><div class="list">${done.map((d) =>
    `<button type="button" class="row" data-act="debt-open" data-id="${d.id}"><span class="ci">✅</span><span class="grow"><b>${esc(S.debtName(d))}</b><small>${(d.history || []).length} lần trả</small></span><span class="amt">${fmt((d.history || []).reduce((s, h) => s + h.amount, 0))}</span></button>`).join('')}</div></details>` : ''}`;
}

actions['debt-edit'] = (el) => {
  const d = state.debts.find((x) => x.id === el.dataset.id);
  const f = d ? { ...d } : { bank: '', title: '', amount: 0, dueDate: todayISO(), repeat: 'monthly', periodsLeft: null, method: PAY_METHODS[0], note: '', accountId: state.settings.lastAccount, remindDays: Number(state.settings.remindDays) };
  const methodIsPreset = PAY_METHODS.includes(f.method);
  openSheet({
    title: d ? 'Sửa khoản trả nợ' : 'Thêm khoản trả nợ',
    body: `<form class="form">
      ${field('Ngân hàng / Công ty tài chính', `<input id="df-bank" list="bank-list" required value="${esc(f.bank)}" placeholder="vd: Vietcombank"><datalist id="bank-list">${BANKS.map((b) => `<option value="${esc(b)}">`).join('')}</datalist>`)}
      ${field('Nội dung khoản nợ', `<input id="df-title" value="${esc(f.title)}" placeholder="vd: Vay mua xe, Thẻ tín dụng, Trả transfer iPhone">`)}
      ${amountField('df-amt', f.amount, 'Số tiền mỗi kỳ')}
      <div class="two">${datePick('df-date', f.dueDate, 'Ngày đến hạn')}
      ${field('Nhắc trước (ngày)', `<input type="number" id="df-rem" min="0" max="30" value="${esc(f.remindDays ?? 3)}">`)}</div>
      <div class="two">${field('Lặp lại', `<select id="df-rep"><option value="monthly" ${f.repeat === 'monthly' ? 'selected' : ''}>Hằng tháng</option><option value="none" ${f.repeat === 'none' ? 'selected' : ''}>Một lần</option></select>`)}
      ${field('Số kỳ còn lại', `<input type="number" id="df-left" min="1" placeholder="Không giới hạn" value="${f.periodsLeft ?? ''}">`, 'data-left')}</div>
      ${field('Cách thức thanh toán', `<select id="df-method">${PAY_METHODS.map((m) => `<option ${m === f.method || (!methodIsPreset && m === 'Khác') ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>`)}
      ${field('Ghi chú thanh toán', `<textarea id="df-note" rows="3" placeholder="vd: CK tới STK 0123456789 – Nguyễn Văn A, nội dung: HD123 thang 11. Hoặc: withdraw tự động từ TK lương, nhớ để đủ tiền trước ngày 25.">${esc(f.note || (!methodIsPreset ? f.method : ''))}</textarea>`)}
      ${field('Trả từ tài khoản (khi đánh dấu đã trả)', `<select id="df-acc">${accOptions(f.accountId)}</select>`)}
      <div class="actions">${d ? '<button type="button" class="btn danger" data-del>Xóa</button>' : ''}<button class="btn primary">Lưu</button></div>
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'df-amt');
      const rep = $(sh, '#df-rep'), leftF = $(sh, '[data-left]');
      const updRep = () => { leftF.hidden = rep.value !== 'monthly'; };
      rep.addEventListener('change', updRep); updRep();
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = readMoney(amt.value);
        if (!(v > 0)) return toast('Nhập số tiền mỗi kỳ');
        const dueDate = $(sh, '#df-date').value;
        if (!dueDate) return toast('Chọn ngày đến hạn');
        const left = $(sh, '#df-left').value;
        await S.put('debts', {
          ...f, bank: $(sh, '#df-bank').value.trim(), title: $(sh, '#df-title').value.trim(), amount: Math.round(v),
          dueDate, dueDay: Number(dueDate.slice(8)), repeat: rep.value, periodsLeft: rep.value === 'monthly' && left ? Math.max(1, Number(left)) : null,
          method: $(sh, '#df-method').value, note: $(sh, '#df-note').value.trim(), accountId: $(sh, '#df-acc').value,
          remindDays: Number($(sh, '#df-rem').value) || 0, done: d ? d.done && dueDate === d.dueDate : false, history: f.history || [],
        });
        close(); toast('Đã lưu khoản trả nợ');
      });
      $(sh, '[data-del]')?.addEventListener('click', async () => {
        if (!confirm('Xóa khoản này? Các giao dịch trả nợ đã ghi vẫn được giữ.')) return;
        await S.remove('debts', d.id); close();
      });
    },
  });
};

actions['debt-open'] = (el) => {
  const d = state.debts.find((x) => x.id === el.dataset.id);
  if (!d) return;
  const days = diffDays(todayISO(), d.dueDate);
  const hist = [...(d.history || [])].reverse();
  openSheet({
    title: S.debtName(d),
    body: `<div class="detail">
      <div class="kv"><span>Số tiền mỗi kỳ</span><b>${fmt(d.amount)}</b></div>
      ${d.done ? '<div class="kv"><span>Trạng thái</span><b class="income">Đã hoàn tất</b></div>'
        : `<div class="kv"><span>Hạn kỳ tới</span><b class="${days < 0 ? 'expense' : ''}">${fmtDate(d.dueDate)} (${fmtDue(days)})</b></div>`}
      <div class="kv"><span>Lặp lại</span><b>${d.repeat === 'monthly' ? 'Hằng tháng' + (d.periodsLeft != null ? ` · còn ${d.periodsLeft} kỳ` : '') : 'Một lần'}</b></div>
      <div class="kv"><span>Cách thanh toán</span><b>${esc(d.method || '—')}</b></div>
      ${d.note ? `<div class="note-box">${esc(d.note).replace(/\n/g, '<br>')}</div>` : ''}
      ${d.note ? '<button type="button" class="btn ghost small" data-copy>📋 Sao chép ghi chú</button>' : ''}
      <div class="actions">
        ${d.done ? '' : '<button type="button" class="btn primary" data-pay>✓ Đánh dấu đã trả</button>'}
        <button type="button" class="btn ghost" data-ics>📅 Thêm vào Lịch</button>
      </div>
      ${hist.length ? `<h4>Lịch sử trả</h4><div class="list">${hist.map((h) => `<div class="row"><span class="grow">Kỳ ${fmtDate(h.dueDate)}<small>Trả ngày ${fmtDate(h.paidDate)}</small></span><span class="amt">${fmt(h.amount)}</span></div>`).join('')}</div>
        <button type="button" class="btn ghost small" data-undo>↶ Hoàn tác lần trả gần nhất</button>` : ''}
      <div class="actions"><button type="button" class="btn ghost" data-edit>Sửa</button></div>
    </div>`,
    onMount(sh, close) {
      $(sh, '[data-pay]')?.addEventListener('click', () => { close(); debtPay(d); });
      $(sh, '[data-ics]').addEventListener('click', () => calendarSheet(`tra-no-${d.bank}.ics`, buildAllDayICS([debtEvent(d)])));
      $(sh, '[data-edit]').addEventListener('click', () => { close(); actions['debt-edit']({ dataset: { id: d.id } }); });
      $(sh, '[data-copy]')?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(d.note); toast('Đã sao chép'); } catch { toast('Không sao chép được'); }
      });
      $(sh, '[data-undo]')?.addEventListener('click', async () => {
        if (!confirm('Hoàn tác lần trả gần nhất? Giao dịch chi tương ứng sẽ bị xóa.')) return;
        await S.undoDebtPayment(d); close(); toast('Đã hoàn tác');
      });
    },
  });
};

function debtPay(d) {
  openSheet({
    title: 'Xác nhận đã trả',
    body: `<form class="form">
      <p class="muted">${esc(S.debtName(d))} · kỳ ${fmtDate(d.dueDate)}</p>
      ${amountField('dp-amt', d.amount, 'Số tiền đã trả')}
      ${field('Trả từ tài khoản', `<select id="dp-acc">${accOptions(d.accountId || state.settings.lastAccount, true)}</select>`)}
      ${datePick('dp-date', todayISO(), 'Ngày trả')}
      <p class="muted">App sẽ ghi một khoản chi "Trả nợ ngân hàng"${d.repeat === 'monthly' ? ' và chuyển sang kỳ tháng sau' : ''}.</p>
      <div class="actions"><button class="btn primary">Xác nhận</button></div>
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'dp-amt');
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = readMoney(amt.value);
        if (!(v > 0)) return toast('Nhập số tiền');
        if (!checkFunds($(sh, '#dp-acc').value, Math.round(v))) return;
        await S.payDebt(d, { amount: Math.round(v), accountId: $(sh, '#dp-acc').value, date: $(sh, '#dp-date').value || todayISO() });
        close(); toast(d.done ? '🎉 Đã trả xong khoản nợ!' : 'Đã ghi nhận. Kỳ tới: ' + fmtDate(d.dueDate));
      });
    },
  });
}

function debtEvent(d) {
  const rrule = d.repeat === 'monthly' ? `FREQ=MONTHLY${d.periodsLeft != null ? ';COUNT=' + d.periodsLeft : ''}` : null;
  return {
    uid: 'debt-' + d.id, date: d.dueDate, rrule, remindDays: d.remindDays ?? state.settings.remindDays,
    title: `🏦 Trả nợ ${S.debtName(d)}: ${fmt(d.amount)}`,
    description: `Cách thanh toán: ${d.method || ''}\n${d.note || ''}`,
  };
}

actions['debt-ics-all'] = () => {
  const evs = state.debts.filter((d) => !d.done).map(debtEvent);
  calendarSheet('lich-tra-no.ics', buildAllDayICS(evs));
};

function calendarSheet(filename, ics) {
  openSheet({
    title: 'Thêm vào Lịch điện thoại',
    body: `<p>App Lịch của điện thoại sẽ <b>tự báo chuông</b> trước hạn, kể cả khi bạn không mở Sổ Thu Chi.</p>
      <div class="actions col"><button type="button" class="btn primary" data-open>📅 Mở bằng app Lịch</button>
      <button type="button" class="btn ghost" data-share>📤 Chia sẻ / Lưu file .ics</button></div>
      <p class="muted small">Nếu nút đầu không mở được Lịch, hãy dùng "Chia sẻ", chọn Lịch hoặc lưu file rồi mở file đó.</p>`,
    onMount(sh) {
      $(sh, '[data-open]').addEventListener('click', () => openCalendarFile(filename, ics));
      $(sh, '[data-share]').addEventListener('click', () => shareOrDownload(filename, ics, 'text/calendar'));
    },
  });
}

// ----- Giao dịch định kỳ -----
function recurringTab() {
  const list = [...state.recurring].sort((a, b) => (b.active - a.active) || (a.nextDate < b.nextDate ? -1 : 1));
  return `
  <p class="muted">Lương, tiền nhà, điện nước, Netflix… Chọn <b>tự động ghi</b> khi đến ngày, hoặc <b>chờ xác nhận</b> nếu số tiền thay đổi mỗi kỳ.</p>
  ${list.length ? `<div class="card list">${list.map((r) => {
    const t = r.template;
    const cat = S.catById(t.categoryId);
    return `<button type="button" class="row ${r.active ? '' : 'off'}" data-act="rec-open" data-id="${r.id}">
      ${t.type === 'transfer' ? '<span class="ci">⇄</span>' : catIcon(cat)}
      <span class="grow"><b>${esc(t.note || cat?.name || TYPE_LABEL[t.type])}</b>
      <small>${FREQ_LABEL[r.freq]}${r.interval > 1 ? ` (mỗi ${r.interval})` : ''} · ${r.active ? 'kỳ tới ' + fmtDate(r.nextDate) : 'đã tắt'} · ${r.autoAdd ? 'tự động' : 'chờ xác nhận'}</small></span>
      <span class="amt ${t.type}">${fmtCur(t.amount, t.currency)}</span></button>`;
  }).join('')}</div>` : empty('🔁', 'Chưa có khoản định kỳ. Khi thêm giao dịch, chọn "Lặp lại" để tạo.')}
  <button type="button" class="btn primary block" data-act="add" data-repeat="month">+ Thêm khoản định kỳ</button>`;
}

actions['rec-open'] = (el) => {
  const r = state.recurring.find((x) => x.id === el.dataset.id);
  if (!r) return;
  const t = r.template;
  const curOpts = state.settings.currencies.map((c) => `<option ${c.code === (t.currency || 'VND') ? 'selected' : ''}>${esc(c.code)}</option>`).join('');
  openSheet({
    title: 'Khoản định kỳ',
    body: `<form class="form">
      <p class="muted">${TYPE_LABEL[t.type]}</p>
      <div class="two">${amountField('rf-amt', t.amount)}${t.currency && t.currency !== 'VND' ? field('Tiền tệ', `<select id="rf-cur">${curOpts}</select>`, 'style="flex:0 0 96px"') : ''}</div>
      ${t.type !== 'transfer' ? field('Danh mục', `<select id="rf-cat">${catOptions(t.type, t.categoryId)}</select>`) : ''}
      ${field('Tài khoản', `<select id="rf-acc">${accOptions(t.accountId)}</select>`)}
      ${field('Ghi chú', `<input id="rf-note" value="${esc(t.note || '')}">`)}
      <div class="two">${field('Lặp lại', `<select id="rf-freq">${Object.entries(FREQ_LABEL).map(([k, v]) => `<option value="${k}" ${r.freq === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
      ${datePick('rf-next', r.nextDate, 'Kỳ tới')}</div>
      <div class="two">${field('Nhắc trước (ngày)', `<input type="number" id="rf-rem" min="0" max="30" value="${esc(r.remindDays ?? 0)}">`)}
      ${datePick('rf-end', r.endDate || '', 'Kết thúc')}</div>
      <label class="check"><input type="checkbox" id="rf-auto" ${r.autoAdd ? 'checked' : ''}> Tự động ghi khi đến ngày</label>
      <label class="check"><input type="checkbox" id="rf-active" ${r.active ? 'checked' : ''}> Đang hoạt động</label>
      <div class="actions"><button type="button" class="btn danger" data-del>Xóa</button><button type="button" class="btn ghost" data-ics>📅 Lịch</button><button class="btn primary">Lưu</button></div>
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'rf-amt');
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = readMoney(amt.value);
        if (!(v > 0)) return toast('Nhập số tiền');
        const nd = $(sh, '#rf-next').value;
        r.template = { ...t, amount: v, currency: $(sh, '#rf-cur')?.value || t.currency || 'VND', categoryId: $(sh, '#rf-cat')?.value || t.categoryId, accountId: $(sh, '#rf-acc').value, note: $(sh, '#rf-note').value.trim(), splits: null };
        r.freq = $(sh, '#rf-freq').value;
        if (nd && nd !== r.nextDate) { r.nextDate = nd; r.anchorDay = Number(nd.slice(8)); }
        r.remindDays = Number($(sh, '#rf-rem').value) || 0;
        r.endDate = $(sh, '#rf-end').value || null;
        r.autoAdd = $(sh, '#rf-auto').checked;
        r.active = $(sh, '#rf-active').checked;
        await S.put('recurring', r);
        await S.processRecurring();
        close(); toast('Đã lưu');
      });
      $(sh, '[data-del]').addEventListener('click', async () => {
        if (!confirm('Xóa khoản định kỳ? Các giao dịch đã ghi vẫn được giữ.')) return;
        await S.remove('recurring', r.id); close();
      });
      $(sh, '[data-ics]').addEventListener('click', () => {
        const rr = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[r.freq];
        calendarSheet('dinh-ky.ics', buildAllDayICS([{
          uid: 'rec-' + r.id, date: r.nextDate, rrule: `FREQ=${rr};INTERVAL=${r.interval || 1}${r.endDate ? ';UNTIL=' + r.endDate.replace(/-/g, '') : ''}`,
          remindDays: r.remindDays || 0, title: `🔁 ${t.note || S.catById(t.categoryId)?.name || 'Định kỳ'}: ${fmtCur(t.amount, t.currency)}`, description: 'Khoản định kỳ trong Sổ Thu Chi',
        }]));
      });
    },
  });
};

actions['pending-open'] = (el) => {
  const r = state.recurring.find((x) => x.id === el.dataset.id);
  if (!r) return;
  const tx = S.txFromTemplate(r, r.nextDate);
  openTxForm({ preset: { ...tx, id: undefined }, fromRecurring: r });
};

// ================= Form giao dịch =================
/**
 * returnTo: hồ sơ cần quay về sau khi đóng form (khi đang ghi hộ vào sổ người khác).
 * catName: giữ danh mục theo tên khi chuyển sang sổ người khác (mỗi sổ có id danh mục riêng).
 */
export function openTxForm({ tx = null, type = 'expense', preset = null, fromRecurring = null, repeat = 'none', returnTo = null, catName = null } = {}) {
  const st = state.settings;
  const isEdit = !!tx;
  const f = tx ? JSON.parse(JSON.stringify(tx)) : {
    type, amount: null, currency: 'VND', date: todayISO(), categoryId: st.lastCat?.[type] || null,
    accountId: st.lastAccount, toAccountId: null, note: '', tags: [], splits: null, photoIds: [], ...(preset || {}),
  };
  const accs = S.activeAccounts();
  if (!S.accById(f.accountId)) f.accountId = accs[0]?.id;
  if (f.type === 'transfer' && !f.toAccountId) f.toAccountId = accs.find((a) => a.id !== f.accountId)?.id;
  const ensureCat = () => { if (f.type !== 'transfer' && !S.catsOf(f.type).some((c) => c.id === f.categoryId)) f.categoryId = st.lastCat?.[f.type] && S.catById(st.lastCat[f.type]) ? st.lastCat[f.type] : S.catsOf(f.type)[0]?.id; };
  if (catName) {
    const same = S.catsOf(f.type).find((c) => c.name === catName);
    if (same) f.categoryId = same.id;
  }
  ensureCat();
  // Chọn người dùng để ghi vào đúng sổ (chỉ khi thêm mới và có từ 2 người dùng).
  const origin = returnTo || S.currentProfile().id;
  const showWho = !isEdit && !fromRecurring && S.moneyBooks().length > 1;
  let switching = false;
  const rate0 = f.rate || S.rateOf(f.currency);
  let splitRows = f.splits && f.splits.length ? f.splits.map((p) => ({ categoryId: p.categoryId, amount: fmtNum(p.amountVnd / rate0) })) : [];
  // Bỏ chọn tiền tệ khi nhập; chỉ hiện lại khi sửa một giao dịch cũ đang là ngoại tệ.
  const multiCur = isEdit && f.currency && f.currency !== 'VND';

  // id riêng cho mỗi lần mở để nút Lưu trên thanh tiêu đề trỏ đúng form (khi đổi người, form cũ còn đang đóng dần).
  const formId = 'txf-' + Date.now();
  openSheet({
    title: isEdit ? 'Sửa giao dịch' : fromRecurring ? 'Xác nhận khoản định kỳ' : 'Thêm giao dịch',
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">Lưu</button>`,
    body: `<form class="form txf" id="${formId}" autocomplete="off">
      ${showWho ? `<div class="who-pick"><span>Ghi vào sổ của</span><div class="chips" id="tf-who">${S.moneyBooks().map((p) =>
        `<button type="button" class="chip ${p.id === S.currentProfile().id ? 'on' : ''}" data-who="${esc(p.id)}" style="--c:${esc(p.color)}">${esc(p.icon)} ${esc(S.bookLabel(p))}${p.locked ? ' 🔒' : ''}</button>`).join('')}</div></div>` : ''}
      ${isEdit && tx.createdAt ? `<p class="muted small center">🕒 Ghi nhận lúc ${fmtDateTimeVN(tx.createdAt)}${tx.updatedAt && tx.updatedAt - tx.createdAt > 60000 ? ` · sửa lúc ${fmtDateTimeVN(tx.updatedAt)}` : ''} (giờ VN)</p>` : ''}
      <div class="seg seg-3" id="tf-type">${(isEdit && tx.type === 'transfer' ? ['expense', 'income', 'transfer'] : ['expense', 'income']).map((t) => `<button type="button" data-v="${t}">${{ expense: '💸 ', income: '💰 ', transfer: '⇄ ' }[t] || ''}${TYPE_LABEL[t]}</button>`).join('')}
        ${!isEdit && !fromRecurring && S.transferTargets('gop').length ? '<button type="button" class="seg-gop" id="tf-gop">🤝 Transfer</button>' : ''}
        ${!isEdit && !fromRecurring && S.transferTargets('trich').length ? '<button type="button" class="seg-trich" id="tf-trich">🔄 Withdraw</button>' : ''}</div>
      ${field('<span id="tf-acc-l">Tài khoản</span>', `<select id="tf-acc">${accOptions(f.accountId, true)}</select>`)}
      <em class="hint" id="tf-bal"></em>
      ${amountLine({ dateId: 'tf-date', date: f.date, amtId: 'tf-amt', amount: f.amount ? fmtNum(f.amount) : '', big: true })}
      ${multiCur ? `<div class="cur-row"><select id="tf-cur" class="cur">${st.currencies.map((c) => `<option ${c.code === f.currency ? 'selected' : ''}>${esc(c.code)}</option>`).join('')}</select></div>` : ''}
      <em class="hint center" id="tf-hint"></em>
      <div class="amt-tools">
        <select id="tf-cat" class="cat-select" aria-label="Danh mục"></select>
      </div>
      <label class="check" id="tf-split-wrap"><input type="checkbox" id="tf-split" ${splitRows.length ? 'checked' : ''}> Chia thành nhiều danh mục</label>
      <div id="tf-splits"></div>
      ${field('Đến tài khoản', `<select id="tf-to">${accOptions(f.toAccountId)}</select>`, 'id="tf-to-wrap"')}
      ${field('Ghi chú', `<input id="tf-note" value="${esc(f.note)}" placeholder="vd: Ăn trưa với đồng nghiệp">`)}
      ${isEdit || fromRecurring ? '' : `<div class="two">${field('Lặp lại', `<select id="tf-rep"><option value="none">Không</option>${Object.entries(FREQ_LABEL).map(([k, v]) => `<option value="${k}" ${repeat === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
        <label class="check" id="tf-auto-wrap"><input type="checkbox" id="tf-auto" checked> Tự động ghi khi đến kỳ</label></div>`}
      ${isEdit || fromRecurring ? `<div class="actions">
        ${isEdit ? '<button type="button" class="btn danger" id="tf-del">Xóa</button><button type="button" class="btn ghost" id="tf-dup">Nhân bản</button>' : ''}
        ${fromRecurring ? '<button type="button" class="btn ghost" id="tf-skip">Bỏ qua kỳ này</button>' : ''}
      </div>` : ''}
    </form>`,
    onClose() {
      // Ghi hộ xong (hoặc hủy) → quay lại sổ đang xem trước đó.
      if (!switching && origin !== S.currentProfile().id) S.switchProfile(origin);
    },
    onMount(sh, close) {
      const amtIn = $(sh, '#tf-amt'), hint = $(sh, '#tf-hint');

      // Đổi người dùng: mở lại form trong sổ của người đó, giữ nguyên số tiền, ngày, ghi chú, tag, danh mục (theo tên).
      $(sh, '#tf-who')?.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-who]');
        if (!b || b.dataset.who === S.currentProfile().id) return;
        const keep = {
          amount: parseAmount(amtIn.value) || null, date: $(sh, '#tf-date').value || todayISO(),
          note: $(sh, '#tf-note').value.trim(), tags: f.tags || [],
        };
        const keepCat = S.catById(f.categoryId)?.name || null;
        const keepType = f.type;
        switching = true;
        close();
        await S.switchProfile(b.dataset.who);
        openTxForm({ type: keepType, preset: keep, returnTo: origin, catName: keepCat });
      });
      const curSel = $(sh, '#tf-cur');
      const curCode = () => (curSel ? curSel.value : 'VND');

      // Chỉ hiện dòng giải nghĩa khi gõ tắt (50k, 1tr2), ngoại tệ, hoặc nhập sai; số thường đã có dấu chấm trong ô.
      const updHint = () => {
        const v = parseAmount(amtIn.value);
        const c = curCode();
        if (!amtIn.value) hint.textContent = '';
        else if (!Number.isFinite(v)) hint.textContent = 'Chưa hiểu số tiền';
        else if (c !== 'VND') hint.textContent = `= ${fmtCur(v, c)} ≈ ${fmt(v * S.rateOf(c))}`;
        else hint.textContent = /[^\d.]/.test(amtIn.value) ? '= ' + fmt(v) : '';
        renderSplitInfo();
      };
      amtIn.addEventListener('input', updHint);
      curSel?.addEventListener('change', updHint);

      // Số dư khả dụng của tài khoản trừ tiền, cảnh báo ngay khi nhập quá số dư.
      function updBal() {
        const el = $(sh, '#tf-bal');
        if (f.type === 'income') { el.textContent = ''; return; }
        const have = S.available($(sh, '#tf-acc').value, isEdit ? tx : null);
        const need = Math.round((parseAmount(amtIn.value) || 0) * S.rateOf(curCode()));
        balHint(el, { have, need, bookId: S.currentProfile().id });
      }
      $(sh, '#tf-acc').addEventListener('change', updBal);
      amtIn.addEventListener('input', updBal);
      curSel?.addEventListener('change', updBal);

      // --- loại giao dịch ---
      const typeBtns = sh.querySelectorAll('#tf-type button[data-v]');
      $(sh, '#tf-gop')?.addEventListener('click', () => { close(); openGopForm(); });
      $(sh, '#tf-trich')?.addEventListener('click', () => { close(); openTrichForm(); });
      const updType = () => {
        typeBtns.forEach((b) => b.classList.toggle('on', b.dataset.v === f.type));
        const tr = f.type === 'transfer';
        $(sh, '#tf-cat').hidden = tr;
        $(sh, '#tf-split-wrap').hidden = tr;
        $(sh, '#tf-to-wrap').hidden = !tr;
        $(sh, '#tf-acc-l').textContent = tr ? 'Từ tài khoản' : 'Tài khoản';
        updBal();
        if (tr) $(sh, '#tf-split').checked = false;
        renderCats(); renderSplits();
      };
      typeBtns.forEach((b) => b.addEventListener('click', () => {
        if (f.type === b.dataset.v) return;
        f.type = b.dataset.v; ensureCat(); splitRows = []; $(sh, '#tf-split').checked = false;
        updType();
      }));

      // --- danh mục ---
      // Danh mục dạng danh sách thả xuống (danh mục Transfer/Withdraw chỉ tạo qua chức năng riêng nên không hiện ở đây).
      function renderCats() {
        if (f.type === 'transfer') return;
        $(sh, '#tf-cat').innerHTML = S.catsOf(f.type).filter((c) => !/^(gop|trich)/.test(c.sys || '')).map((c) =>
          `<option value="${c.id}" ${c.id === f.categoryId ? 'selected' : ''}>${esc(c.icon + '  ' + c.name)}</option>`).join('');
        f.categoryId = $(sh, '#tf-cat').value;
      }
      $(sh, '#tf-cat').addEventListener('change', (e) => { f.categoryId = e.target.value; });

      // --- chia danh mục ---
      const splitBox = $(sh, '#tf-splits');
      function renderSplits() {
        const on = $(sh, '#tf-split').checked && f.type !== 'transfer';
        $(sh, '#tf-cat').hidden = on || f.type === 'transfer';
        if (!on) { splitBox.innerHTML = ''; return; }
        if (!splitRows.length) splitRows = [{ categoryId: f.categoryId, amount: amtIn.value }, { categoryId: S.catsOf(f.type)[1]?.id, amount: '' }];
        splitBox.innerHTML = splitRows.map((r, i) => `<div class="split-row" data-i="${i}">
          <select data-k="categoryId">${catOptions(f.type, r.categoryId)}</select>
          <input data-k="amount" inputmode="decimal" placeholder="Số tiền" value="${esc(r.amount)}">
          <button type="button" class="icon-btn" data-rm aria-label="Bỏ">✕</button></div>`).join('')
          + `<div class="split-foot"><button type="button" class="btn ghost small" data-add>+ Thêm dòng</button><em id="tf-split-info"></em></div>`;
        renderSplitInfo();
      }
      function renderSplitInfo() {
        const el = $(sh, '#tf-split-info');
        if (!el) return;
        const total = parseAmount(amtIn.value) || 0;
        const sum = splitRows.reduce((s, r) => s + (parseAmount(r.amount) || 0), 0);
        const diff = total - sum;
        el.textContent = Math.abs(diff) < 0.5 ? '✓ Khớp tổng' : diff > 0 ? `Còn thiếu ${fmtCur(diff, curCode())}` : `Dư ${fmtCur(-diff, curCode())}`;
        el.className = Math.abs(diff) < 0.5 ? 'income' : 'expense';
      }
      $(sh, '#tf-split').addEventListener('change', renderSplits);
      splitBox.addEventListener('input', (e) => {
        const row = e.target.closest('.split-row');
        if (!row) return;
        splitRows[row.dataset.i][e.target.dataset.k] = e.target.value;
        renderSplitInfo();
      });
      splitBox.addEventListener('change', (e) => {
        const row = e.target.closest('.split-row');
        if (row && e.target.dataset.k) splitRows[row.dataset.i][e.target.dataset.k] = e.target.value;
      });
      splitBox.addEventListener('click', (e) => {
        if (e.target.closest('[data-add]')) {
          const total = parseAmount(amtIn.value) || 0;
          const sum = splitRows.reduce((s, r) => s + (parseAmount(r.amount) || 0), 0);
          splitRows.push({ categoryId: S.catsOf(f.type)[0]?.id, amount: total > sum ? fmtNum(total - sum) : '' });
          renderSplits();
        } else if (e.target.closest('[data-rm]')) {
          splitRows.splice(Number(e.target.closest('.split-row').dataset.i), 1);
          if (splitRows.length < 2) { $(sh, '#tf-split').checked = false; splitRows = []; }
          renderSplits();
        }
      });

      // --- lặp lại ---
      const rep = $(sh, '#tf-rep');
      if (rep) {
        const upd = () => { $(sh, '#tf-auto-wrap').hidden = rep.value === 'none'; };
        rep.addEventListener('change', upd); upd();
      }

      // --- lưu ---
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const amount = parseAmount(amtIn.value);
        if (!(amount > 0)) { amtIn.focus(); return toast('Nhập số tiền hợp lệ'); }
        const currency = curCode();
        const rate = S.rateOf(currency);
        const amountVnd = Math.round(amount * rate);
        const accountId = $(sh, '#tf-acc').value;
        const toAccountId = f.type === 'transfer' ? $(sh, '#tf-to').value : null;
        if (f.type === 'transfer' && accountId === toAccountId) return toast('Tài khoản nguồn và tài khoản đích phải khác nhau');
        if (f.type !== 'income' && !checkFunds(accountId, amountVnd, isEdit ? tx : null)) return;
        let splits = null;
        if (f.type !== 'transfer' && $(sh, '#tf-split').checked) {
          splits = splitRows.map((r) => ({ categoryId: r.categoryId, amountVnd: Math.round((parseAmount(r.amount) || 0) * rate) })).filter((r) => r.amountVnd > 0);
          const sum = splits.reduce((s, r) => s + r.amountVnd, 0);
          if (Math.abs(sum - amountVnd) > splits.length) return toast('Tổng các dòng phải bằng số tiền giao dịch');
          if (splits.length < 2) splits = null;
          else splits[splits.length - 1].amountVnd += amountVnd - sum; // bù sai số làm tròn
        }
        if (f.type !== 'transfer' && !splits && !f.categoryId) return toast('Chọn danh mục');

        // Tag và ảnh không còn nhập trong form; giữ nguyên dữ liệu cũ nếu giao dịch đã có.
        const photoIds = f.photoIds || [];

        const date = $(sh, '#tf-date').value || todayISO();
        const obj = {
          ...f, amount, currency, rate, amountVnd, date, accountId, toAccountId,
          categoryId: f.type === 'transfer' ? null : splits ? splits[0].categoryId : f.categoryId,
          splits, note: $(sh, '#tf-note').value.trim(), tags: f.tags || [], photoIds,
          createdAt: f.createdAt || Date.now(),
        };
        if (fromRecurring) obj.recurringId = fromRecurring.id;

        const repVal = rep ? rep.value : 'none';
        if (repVal !== 'none') {
          const r = {
            template: { type: obj.type, amount, currency, categoryId: obj.categoryId, accountId, toAccountId, note: obj.note, tags: obj.tags, splits },
            freq: repVal, interval: 1, anchorDay: Number(date.slice(8)), startDate: date,
            nextDate: nextDate(date, repVal, 1, Number(date.slice(8))), endDate: null,
            autoAdd: $(sh, '#tf-auto').checked, remindDays: obj.type === 'expense' ? Number(st.remindDays) || 0 : 0, active: true,
          };
          await S.put('recurring', r, { silent: true });
          obj.recurringId = r.id;
        }
        await S.put('transactions', obj, { silent: true });
        if (fromRecurring) { S.advanceRecurring(fromRecurring); await S.put('recurring', fromRecurring, { silent: true }); }
        if (obj.type !== 'transfer') await S.setSetting('lastCat', { ...st.lastCat, [obj.type]: f.categoryId }, { silent: true });
        await S.setSetting('lastAccount', accountId, { silent: true });
        if (repVal !== 'none') await S.processRecurring();
        S.emit();
        const owner = S.currentProfile();
        if (obj.type === 'expense') budgetWarn(obj);
        close();
        toast(isEdit ? 'Đã cập nhật' : 'Đã lưu ' + (obj.type === 'expense' ? 'khoản chi ' : obj.type === 'income' ? 'khoản thu ' : '') + fmt(amountVnd)
          + (owner.id !== origin ? ` vào ${S.bookLabel(owner)}` : ''), 3000);
      });

      $(sh, '#tf-del')?.addEventListener('click', async () => {
        if (!confirm('Xóa giao dịch này?')) return;
        await S.deleteTx(tx);
        close(); toast('Đã xóa');
      });
      $(sh, '#tf-dup')?.addEventListener('click', () => {
        close();
        const { id, photoIds, recurringId, debtId, createdAt, updatedAt, ...rest } = tx;
        openTxForm({ preset: { ...rest, date: todayISO(), photoIds: [] }, type: tx.type });
      });
      $(sh, '#tf-skip')?.addEventListener('click', async () => {
        S.advanceRecurring(fromRecurring);
        await S.put('recurring', fromRecurring);
        close(); toast('Đã bỏ qua kỳ này');
      });

      updType();
      updHint();
      if (!isEdit && !f.amount) setTimeout(() => amtIn.focus(), 250);
    },
  });
}

function budgetWarn(tx) {
  const cats = new Set(S.txParts(tx).map((p) => p.categoryId));
  for (const b of state.budgets) {
    if (b.categoryId !== '__all' && !cats.has(b.categoryId)) continue;
    const st = S.budgetStatus(b, tx.date);
    if (tx.date < st.range.start || tx.date > st.range.end) continue;
    if (st.ratio >= 1) return setTimeout(() => toast(`⛔ Vượt ngân sách "${S.budgetName(b)}" ${fmt(-st.left)}`, 3500), 2500);
    if (st.ratio >= 0.8) return setTimeout(() => toast(`⚠️ "${S.budgetName(b)}" đã dùng ${Math.round(st.ratio * 100)}%`, 3500), 2500);
  }
}

function viewImage(src) {
  openSheet({ title: 'Ảnh hóa đơn', body: `<img src="${src}" class="full-img" alt="">`, wide: true });
}

// ================= Tóm tắt (mỗi người dùng / thẻ chi tiêu) =================
const summaryBtn = () => `<button type="button" class="btn ghost small" data-act="summary">📊 Tóm tắt</button>`;

function userSummary(r) {
  const p = S.currentProfile();
  const t = S.totals(r);
  const pt = S.totals(prevRange(r, state.settings.weekStart));
  const lines = [
    `📊 Tóm tắt ${S.bookLabel(p)} – ${r.label}`,
    `• Thu: ${fmt(t.income)}`,
    `• Chi: ${fmt(t.expense)}${pt.expense ? ` (${pctChange(t.expense, pt.expense)})` : ''}`,
    `• Chênh lệch: ${fmtSigned(t.net)}`,
    `• Tổng số dư tài khoản: ${fmt(S.totalBalance())}`,
  ];
  const accs = S.activeAccounts();
  if (accs.length > 1) accs.forEach((a) => lines.push(`   – ${a.name}: ${fmt(S.accountBalance(a))}`));
  const top = S.byCategory(r, 'expense').slice(0, 5);
  if (top.length) {
    lines.push('', 'Chi nhiều nhất:');
    top.forEach((x, i) => lines.push(`${i + 1}. ${x.cat.icon} ${x.cat.name}: ${fmt(x.amount)}`));
  }
  const over = state.budgets.map((b) => ({ b, st: S.budgetStatus(b) })).filter((x) => x.st.ratio >= 1);
  if (over.length) {
    lines.push('', 'Vượt ngân sách:');
    over.forEach(({ b, st }) => lines.push(`⛔ ${S.budgetName(b)}: ${fmt(st.spent)} / ${fmt(b.amount)}`));
  }
  const debts = state.debts.filter((d) => !d.done && diffDays(todayISO(), d.dueDate) <= 14);
  if (debts.length) {
    lines.push('', 'Sắp đến hạn trả nợ:');
    debts.forEach((d) => lines.push(`🏦 ${S.debtName(d)}: ${fmt(d.amount)} – ${fmtDate(d.dueDate)}`));
  }
  return lines.join('\n');
}

function cardSummary() {
  const p = S.currentProfile();
  const items = sortTx([...state.transactions]);
  const open = items.filter((t) => !isDone(t));
  const m = getRange('month', todayISO());
  const inMonth = items.filter((t) => t.date >= m.start && t.date <= m.end);
  const paidMonth = items.filter((t) => isDone(t) && t.paid && t.paid.date >= m.start && t.paid.date <= m.end);
  const lines = [
    `💳 Tóm tắt thẻ ${S.bookLabel(p)}`,
    `• Chưa thanh toán: ${fmt(sumAmt(open))} (${open.length} khoản)`,
    `• Đã chi ${m.label.toLowerCase()}: ${fmt(sumAmt(inMonth))} (${inMonth.length} khoản)`,
    `• Đã thanh toán ${m.label.toLowerCase()}: ${fmt(sumAmt(paidMonth))}`,
  ];
  const bySrc = new Map();
  for (const t of inMonth) bySrc.set(t.source, (bySrc.get(t.source) || 0) + t.amountVnd);
  if (bySrc.size) {
    lines.push('', `Theo nguồn (${m.label.toLowerCase()}):`);
    [...bySrc.entries()].sort((a, b) => b[1] - a[1]).forEach(([s, v]) => lines.push(`${srcIcon(s)} ${s}: ${fmt(v)}`));
  }
  const byPayer = new Map();
  for (const t of paidMonth) byPayer.set(t.paid.profileName, (byPayer.get(t.paid.profileName) || 0) + t.amountVnd);
  if (byPayer.size) {
    lines.push('', 'Người đã thanh toán:');
    [...byPayer.entries()].forEach(([n, v]) => lines.push(`✅ ${n}: ${fmt(v)}`));
  }
  if (open.length) {
    lines.push('', 'Các khoản chưa thanh toán:');
    open.slice(0, 15).forEach((t) => lines.push(`• ${fmtDate(t.date)} ${t.note || t.source} (${t.source}): ${fmt(t.amountVnd)}`));
    if (open.length > 15) lines.push(`… và ${open.length - 15} khoản khác`);
  }
  return lines.join('\n');
}

actions.summary = () => {
  const card = S.isCard();
  const text = card ? cardSummary() : userSummary(currentRange());
  openSheet({
    title: card ? 'Tóm tắt thẻ chi tiêu' : 'Tóm tắt ' + currentRange().label,
    body: `<pre class="summary">${esc(text)}</pre>
      <div class="actions"><button type="button" class="btn ghost" data-copy>📋 Sao chép</button><button type="button" class="btn primary" data-share>📤 Chia sẻ</button></div>
      <p class="muted small">${card ? '' : 'Tóm tắt theo kỳ đang xem (Ngày/Tháng) ở Tổng quan. '}Chia sẻ qua Zalo, Messenger, Email… hoặc lưu vào Ghi chú.</p>`,
    onMount(sh) {
      $(sh, '[data-copy]').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(text); toast('Đã sao chép'); } catch { toast('Không sao chép được'); }
      });
      $(sh, '[data-share]').addEventListener('click', async () => {
        if (navigator.share) { try { await navigator.share({ title: 'Tóm tắt thu chi', text }); } catch { /* người dùng hủy */ } }
        else { try { await navigator.clipboard.writeText(text); toast('Thiết bị không hỗ trợ chia sẻ – đã sao chép'); } catch { toast('Không chia sẻ được'); } }
      });
    },
  });
};

/** Nút + (giữa trên cùng): Ngân hàng mở form Chi/Thu (có thêm Transfer/Withdraw); Tiết kiệm chỉ có Transfer/Withdraw. */
actions.add = (el) => {
  if (S.currentProfile().kind === 'saving') return gopTrichChooser();
  openTxForm({ type: el.dataset.type || 'expense', repeat: el.dataset.repeat || 'none' });
};

function gopTrichChooser() {
  const g = S.transferTargets('gop').length, t = S.transferTargets('trich').length;
  if (!g && !t) return toast('Chưa có mục Ngân hàng nào để transfer/withdraw');
  openSheet({
    title: 'Chọn thao tác',
    body: `<div class="actions col">
      ${g ? '<button type="button" class="btn primary" data-x="gop">🤝 Transfer cho mục khác</button>' : ''}
      ${t ? '<button type="button" class="btn ghost" data-x="trich">🔄 Withdraw từ mục khác</button>' : ''}</div>`,
    onMount(sh, close) {
      sh.addEventListener('click', (e) => {
        const b = e.target.closest('[data-x]');
        if (!b) return;
        close();
        (b.dataset.x === 'gop' ? openGopForm : openTrichForm)();
      });
    },
  });
}

// ================= Mẫu nhập nhanh =================
// Mỗi mục Ngân hàng/Đầu tư có 4 mẫu (Chi, Thu, Transfer, Withdraw); thẻ chi tiêu có 1 mẫu.
// Thiết lập trong Cài đặt; bật "Hiện" thì có nút ⚡ ở Tổng quan, bấm vào chỉ cần nhập số tiền rồi OK.
const QUICK_KINDS = {
  expense: { icon: '💸', label: 'Mẫu Chi nhanh', def: 'Chi nhanh' },
  income: { icon: '💰', label: 'Mẫu Thu nhanh', def: 'Thu nhanh' },
  gop: { icon: '🤝', label: 'Mẫu Transfer nhanh', def: 'Transfer nhanh' },
  trich: { icon: '🔄', label: 'Mẫu Withdraw nhanh', def: 'Withdraw nhanh' },
  card: { icon: '💳', label: 'Mẫu chi thẻ nhanh 1', def: 'Chi thẻ nhanh 1' },
  card2: { icon: '💳', label: 'Mẫu chi thẻ nhanh 2', def: 'Chi thẻ nhanh 2' },
  card3: { icon: '💳', label: 'Mẫu chi thẻ nhanh 3', def: 'Chi thẻ nhanh 3' },
};
// Chữ ngắn trên nút ⚡ ở Tổng quan (tên đầy đủ của mẫu hiện khi bấm vào).
const QUICK_SHORT = { expense: 'Chi', income: 'Thu', gop: 'Transfer', trich: 'Withdraw', card: 'Chi', card2: 'Chi', card3: 'Chi' };
// Thẻ chi tiêu có 3 mẫu chi nhanh: card, card2, card3.
const isCardK = (k) => /^card\d?$/.test(k);
const quickKindsFor = () => ({ card: ['card', 'card2', 'card3'], invest: [], track: [], saving: ['gop', 'trich'] }[S.currentProfile().kind] || ['expense', 'income', 'gop', 'trich']);
const quickOf = (k) => (state.settings.quick || {})[k] || null;
const saveQuick = (k, q) => S.setSetting('quick', { ...(state.settings.quick || {}), [k]: q });
const myAccount = () => S.activeAccounts()[0];
const peerOf = (q) => q && q.peerId && S.getProfiles().find((p) => p.id === q.peerId);

function quickDesc(k, q) {
  if (!q) return 'Chưa thiết lập';
  const cat = q.categoryId && S.catById(q.categoryId);
  const peer = peerOf(q);
  if (k === 'gop') return peer ? `Transfer cho ${S.bookLabel(peer)}` : 'Chưa chọn người nhận';
  if (k === 'trich') return peer ? `Withdraw từ ${S.bookLabel(peer)}` : 'Chưa chọn người bị withdraw';
  return [isCardK(k) ? q.source : '', cat ? `${cat.icon} ${cat.name}` : 'Chưa chọn danh mục', q.note].filter(Boolean).join(' · ');
}

function quickButtons() {
  const list = quickKindsFor().map((k) => [k, quickOf(k)]).filter(([, q]) => q && q.show);
  if (!list.length) return '';
  // Thẻ chi tiêu: mỗi mẫu 1 dòng, ghi rõ tên + danh mục (+ nguồn).
  if (S.isCard()) {
    return `<div class="quick-rows">${list.map(([k, q]) => {
      const cat = q.categoryId && S.catById(q.categoryId);
      return `<button type="button" class="btn quick-row-btn" data-act="quick-run" data-k="${k}">
        <span class="qr-ic">${cat ? esc(cat.icon) : '⚡'}</span>
        <span class="qr-txt"><b>⚡ ${esc(q.name || QUICK_KINDS[k].def)}</b><small>${esc([cat ? cat.name : 'Chưa chọn danh mục', q.source].filter(Boolean).join(' · '))}</small></span>
        <span class="qr-go">›</span></button>`;
    }).join('')}</div>`;
  }
  return `<div class="quick-btns">${list.map(([k, q]) =>
    `<button type="button" class="btn quick-btn q-${k}" data-act="quick-run" data-k="${k}" title="${esc(q.name || QUICK_KINDS[k].def)}">⚡ ${QUICK_SHORT[k]}</button>`).join('')}</div>`;
}

/** Bấm nút ⚡: chỉ nhập số tiền (và ngày nếu cần) rồi OK. */
actions['quick-run'] = (el) => {
  const k = el.dataset.k;
  const q = quickOf(k);
  if (!q) return;
  const acc = myAccount();
  const peer = peerOf(q);
  if ((k === 'gop' || k === 'trich') && !peer) return toast('Mẫu chưa chọn người — sửa trong Cài đặt');
  if (!isCardK(k) && !acc) return toast('Mục này chưa có tài khoản ngân hàng');
  const outgoing = k === 'expense' || k === 'gop';
  const formId = 'qr-' + Date.now();
  openSheet({
    title: `⚡ ${q.name || QUICK_KINDS[k].def}`,
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">OK</button>`,
    body: `<form class="form" id="${formId}">
      <p class="quick-info">${esc(quickDesc(k, q))}${!isCardK(k) ? `<br><small>${outgoing ? 'Từ' : 'Vào'} tài khoản: ${esc(acc.name)}</small>` : ''}</p>
      ${amountLine({ dateId: 'qr-date', date: todayISO(), amtId: 'qr-amt', big: true })}
      <em class="hint" id="qr-bal"></em>
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'qr-amt');
      setTimeout(() => amt.focus(), 250);
      const upd = () => {
        if (outgoing) balHint($(sh, '#qr-bal'), { have: S.available(acc.id), need: Math.round(readMoney(amt.value) || 0), bookId: S.currentProfile().id });
      };
      amt.addEventListener('input', upd);
      upd();
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = Math.round(readMoney(amt.value));
        if (!(v > 0)) return toast('Nhập số tiền');
        const date = $(sh, '#qr-date').value || todayISO();
        const base = { amount: v, currency: 'VND', rate: 1, amountVnd: v, date, tags: [], splits: null, photoIds: [], createdAt: Date.now() };
        try {
          if (k === 'expense' || k === 'income') {
            if (k === 'expense' && !checkFunds(acc.id, v)) return;
            const cat = S.catById(q.categoryId) || S.catsOf(k)[0];
            await S.put('transactions', { ...base, type: k, categoryId: cat?.id, accountId: acc.id, toAccountId: null, note: q.note || '' });
          } else if (k === 'gop') {
            const toAcc = q.peerAccountId || (await S.peerAccounts(peer.id))[0]?.id;
            await S.gop({ toProfileId: peer.id, amount: v, fromAccountId: acc.id, toAccountId: toAcc, date, note: q.note || '', flowCat: q.flowCat || null });
          } else if (k === 'trich') {
            const fromAcc = q.peerAccountId || (await S.peerAccounts(peer.id))[0]?.id;
            await S.trich({ fromProfileId: peer.id, amount: v, fromAccountId: fromAcc, toAccountId: acc.id, date, note: q.note || '', flowCat: q.flowCat || null });
          } else {
            const locked = S.lockError(S.currentProfile().id);
            if (locked) return toast(locked, 4500);
            await S.put('transactions', { ...base, type: 'expense', source: q.source || 'Khác', categoryId: q.categoryId, accountId: null, note: q.note || q.name || '', status: 'open' });
          }
        } catch (err) { return toast('⛔ ' + err.message, 4500); }
        close();
        toast(`⚡ Đã ghi ${fmt(v)} · ${q.name || QUICK_KINDS[k].def}`);
      });
    },
  });
};

/** Danh sách mẫu trong Cài đặt: sửa + bật/tắt hiện ở Tổng quan. */
function quickSettingsHtml() {
  return `${sectionTitle('⚡ Mẫu nhập nhanh')}
  <section class="card list">${quickKindsFor().map((k) => {
    const q = quickOf(k);
    return `<div class="row quick-row">
      <button type="button" class="grow-btn" data-act="quick-edit" data-k="${k}"><span class="ci">${QUICK_KINDS[k].icon}</span>
        <span class="grow"><b>${esc(q?.name || QUICK_KINDS[k].label)}</b><small>${esc(quickDesc(k, q))}</small></span><span>✎</span></button>
      <label class="switch" title="Hiện ở Tổng quan"><input type="checkbox" data-quick-show="${k}" ${q?.show ? 'checked' : ''} ${q ? '' : 'disabled'}><i></i></label>
    </div>`;
  }).join('')}</section>
  <p class="muted small">Bật công tắc để hiện nút ⚡ ở màn hình Tổng quan. Bấm nút chỉ cần nhập số tiền rồi OK, app tự ghi theo mẫu.</p>`;
}

actions['quick-edit'] = (el) => {
  const k = el.dataset.k;
  const q = { ...(quickOf(k) || { name: QUICK_KINDS[k].def, show: true }) };
  const isPeer = k === 'gop' || k === 'trich';
  const others = isPeer ? otherProfiles(k) : [];
  if (isPeer && !others.length) return toast('Cần có thêm người dùng / mục khác để thiết lập mẫu này');
  const catType = k === 'income' ? 'income' : 'expense';
  const cats = S.catsOf(catType).filter((c) => !/^(gop|trich)/.test(c.sys || ''));
  const formId = 'qe-' + Date.now();
  openSheet({
    title: QUICK_KINDS[k].label,
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">Lưu</button>`,
    body: `<form class="form" id="${formId}">
      ${field('Tên nút', `<input id="qe-name" maxlength="24" value="${esc(q.name || '')}" placeholder="vd: Ăn trưa, Lương, Transfer tiền chợ">`)}
      ${isPeer ? `${field(k === 'gop' ? 'Transfer cho' : 'Withdraw từ', `<select id="qe-peer">${others.map((p) => `<option value="${esc(p.id)}" ${p.id === q.peerId ? 'selected' : ''}>${esc(p.icon + ' ' + S.bookLabel(p))}</option>`).join('')}</select>`)}
        ${field(k === 'gop' ? 'Vào tài khoản của người nhận' : 'Từ tài khoản của người bị withdraw', '<select id="qe-pacc"><option>Đang tải…</option></select>')}
        ${flowCatField('qe-fcat', q.flowCat || '')}`
        : field('Danh mục', `<select id="qe-cat" class="cat-select">${cats.map((c) => `<option value="${c.id}" ${c.id === q.categoryId ? 'selected' : ''}>${esc(c.icon + '  ' + c.name)}</option>`).join('')}</select>`)}
      ${isCardK(k) ? field('Nguồn chi', `<select id="qe-src">${S.CARD_SOURCES.map((s) => `<option ${s === (q.source || 'MoMo') ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>`) : ''}
      ${field('Ghi chú (không bắt buộc)', `<input id="qe-note" value="${esc(q.note || '')}" placeholder="Ghi chú tự điền vào giao dịch">`)}
      ${!isCardK(k) && myAccount() ? `<p class="muted small">Tài khoản của mục này: <b>${esc(myAccount().name)}</b></p>` : ''}
      <label class="check"><input type="checkbox" id="qe-show" ${q.show ? 'checked' : ''}> Hiện nút ⚡ ở Tổng quan</label>
      ${quickOf(k) ? '<div class="actions"><button type="button" class="btn danger" data-del>Xóa mẫu</button></div>' : ''}
    </form>`,
    onMount(sh, close) {
      const loadPeerAcc = async () => {
        const sel = $(sh, '#qe-pacc');
        if (!sel) return;
        const accs = await S.peerAccounts($(sh, '#qe-peer').value);
        sel.innerHTML = accs.map((a) => `<option value="${a.id}" ${a.id === q.peerAccountId ? 'selected' : ''}>${esc(a.icon + ' ' + a.name)}</option>`).join('');
      };
      $(sh, '#qe-peer')?.addEventListener('change', loadPeerAcc);
      loadPeerAcc();
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const out = {
          name: $(sh, '#qe-name').value.trim() || QUICK_KINDS[k].def,
          note: $(sh, '#qe-note').value.trim(),
          show: $(sh, '#qe-show').checked,
        };
        if (isPeer) { out.peerId = $(sh, '#qe-peer').value; out.peerAccountId = $(sh, '#qe-pacc').value || null; out.flowCat = $(sh, '#qe-fcat').value || null; }
        else out.categoryId = $(sh, '#qe-cat').value;
        if (isCardK(k)) out.source = $(sh, '#qe-src').value;
        await saveQuick(k, out);
        close(); toast('Đã lưu mẫu');
      });
      $(sh, '[data-del]')?.addEventListener('click', async () => {
        await saveQuick(k, null);
        close(); toast('Đã xóa mẫu');
      });
    },
  });
};

// ================= Secrecy: NEOBANK & Cash Outflow =================
// NEOBANK: tài khoản ảo có số dư chỉnh tay, các mục Ngân hàng có thể Withdraw tiền về.
// Cash Outflow: nơi nhận tiền Transfer từ các mục Ngân hàng. Ẩn thì không hiện thông tin, nhưng Transfer/Withdraw vẫn dùng được.
function secrecyHtml() {
  const hidden = S.secrecyHidden();
  const head = sectionTitle('🔐 Secrecy', `<label class="switch" title="Hiện mục Secrecy"><input type="checkbox" data-secrecy-toggle ${hidden ? '' : 'checked'}><i></i></label>`);
  if (hidden) return `${head}<p class="muted small">Đang ẩn. Transfer vào Cash Outflow và Withdraw từ NEOBANK vẫn dùng được. Bật công tắc để xem.</p>`;
  return `${head}${['neo', 'outflow'].map((kind) => {
    const k = S.BOOK_KINDS[kind];
    const list = S.secrecyBooks(kind);
    return `<h4 class="grp-h">${k.icon} ${k.label} <small>(${list.length}/${k.max})</small></h4>
    <section class="card list">${list.map((b) => `
      <div class="row book-row">
        <button type="button" class="grow-btn" data-act="secrecy-edit" data-id="${esc(b.id)}">${avatar(b)}
          <span class="grow"><b>${esc(b.name)}</b><small>${kind === 'neo' ? 'Bấm để chỉnh số dư' : 'Tổng tiền đã nhận transfer'}</small></span>
          <span class="psum" data-psum="${esc(b.id)}">…</span></button>
        <button type="button" class="icon-btn" data-act="secrecy-del" data-id="${esc(b.id)}" aria-label="Xóa">🗑</button>
      </div>`).join('') || `<p class="muted small" style="padding:8px 14px">${kind === 'neo' ? 'Chưa có NEOBANK.' : 'Chưa có Cash Outflow.'}</p>`}
      ${list.length < k.max ? `<button type="button" class="row add-row" data-act="secrecy-add" data-kind="${kind}"><span class="ci">＋</span><span class="grow"><b>Thêm ${k.label}</b></span></button>` : ''}
    </section>`;
  }).join('')}
  <p class="muted small">🏧 NEOBANK: các mục Ngân hàng <b>Transfer cho</b> để gửi tiền vào, <b>Withdraw từ</b> để lấy tiền về. 📤 Cash Outflow: các mục Ngân hàng dùng <b>Transfer cho</b> để chuyển tiền ra.</p>`;
}

actions['secrecy-add'] = (el) => secrecyForm(null, el.dataset.kind);
actions['secrecy-edit'] = (el) => secrecyForm(S.getProfiles().find((b) => b.id === el.dataset.id));
actions['secrecy-del'] = async (el) => {
  const b = S.getProfiles().find((x) => x.id === el.dataset.id);
  if (b && await confirmDeleteProfile(b)) refresh();
};

async function secrecyForm(b, kind) {
  if (b) kind = b.kind;
  const k = S.BOOK_KINDS[kind];
  const neo = kind === 'neo';
  const cur = b ? (await S.profileSummary(b)).balance : 0;
  const formId = 'sc-' + Date.now();
  openSheet({
    title: `${b ? 'Sửa' : 'Thêm'} ${k.label}`,
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">${b ? 'Lưu' : 'Tạo'}</button>`,
    body: `<form class="form" id="${formId}">
      ${field('Tên', `<input id="sc-name" required maxlength="24" value="${esc(b ? b.name : '')}" placeholder="${neo ? 'vd: Cake, Timo, Ví ảo' : 'vd: Biếu bố mẹ, Chi ngoài'}">`)}
      ${neo ? amountField('sc-bal', cur, 'Số dư hiện tại') : b ? `<p class="muted">Đã nhận transfer: <b>${fmt(cur)}</b></p>` : ''}
      <p class="muted small">${neo ? 'Số dư chỉnh tay bất kỳ lúc nào. Các mục Ngân hàng transfer vào sẽ cộng, withdraw về sẽ trừ vào số dư này.' : 'Nhận tiền Transfer từ các mục Ngân hàng, không có chức năng khác.'}</p>
    </form>`,
    onMount(sh, close) {
      const bal = neo ? bindMoney(sh, 'sc-bal') : null;
      if (bal && !b) bal.value = '';
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = $(sh, '#sc-name').value.trim();
        if (!name) return toast('Nhập tên');
        const v = bal && bal.value.trim() ? Math.round(readMoney(bal.value)) : 0;
        if (bal && (!Number.isFinite(v) || v < 0)) return toast('Số dư phải là số không âm');
        try {
          if (!b) await S.createSecrecy(kind, name, v);
          else {
            S.saveProfile({ id: b.id, name });
            if (neo && v !== cur) await S.setPeerBalance(b.id, v);
          }
        } catch (err) { return toast(err.message); }
        close(); refresh(); toast('Đã lưu');
      });
    },
  });
}

// ================= Cài đặt =================
/** Người dùng đang được chọn để xem danh sách mục trong Cài đặt (mặc định: người đang dùng). */
/** User đang chọn xem trong Cài đặt chung (Cài đặt chung chỉ liệt kê User, không có Category). */
function settingsUser() {
  const users = S.getUsers('user');
  return users.find((u) => u.id === ui.settingsUserId) || users.find((u) => u.id === S.currentUser().id) || users[0];
}
actions['settings-user'] = (el) => { ui.settingsUserId = el.dataset.id; refresh(); };

function settingsView() {
  const s = state.settings;
  const notifState = !('Notification' in window) ? 'unsupported' : Notification.permission;
  return `
  <header class="top settings-head"><h1>⚙️ Cài đặt chung</h1><button type="button" class="icon-btn close-settings" data-act="close-settings" aria-label="Đóng cài đặt">✕</button></header>
  <p class="muted small">Cài đặt riêng của từng mục (hiển thị, mẫu nhập nhanh, tài khoản, danh mục, phân bổ…) nằm ở tab <b>⚙️ Cài đặt</b> ở thanh dưới cùng của mục đó.</p>

  ${sectionTitle(`User`, `<button type="button" class="link" data-act="users">Quản lý</button>`)}
  <section class="card list">${S.getUsers('user').map((u) => `
    <button type="button" class="row user-pick ${u.id === settingsUser().id ? 'picked' : ''} ${u.id === S.currentUser().id ? 'is-current' : ''}" data-act="settings-user" data-id="${esc(u.id)}" style="--c:${esc(u.color)}">
      ${avatar(u)}<span class="grow"><b>${esc(u.name)}</b>
      <small>${u.id === S.currentUser().id ? 'Đang dùng' : 'Bấm để xem các mục'}</small></span>
      <span class="psum" data-usum="${esc(u.id)}">…</span>${u.id === settingsUser().id ? '<span class="pick-dot">●</span>' : '›'}</button>`).join('')}
  </section>
  <p class="muted small">Chọn User để xem và khóa các mục của người đó ở phần bên dưới.</p>
  <section class="card form">
    ${field('🏦 Ngân hàng mặc định (mở khi đóng Category)', `<select data-default-bank>${S.moneyBooks().map((b) => `<option value="${esc(b.id)}" ${b.id === S.defaultBank()?.id ? 'selected' : ''}>${esc(b.icon + ' ' + S.bookLabel(b))}</option>`).join('')}</select>`)}
  </section>

  ${sectionTitle(`Các mục & khóa của ${esc(settingsUser().name)}`, `<button type="button" class="link" data-act="books">Quản lý</button>`)}
  ${[settingsUser()].map((u) => `
  <section class="card list">${S.userBooks(u.id).map((p) => `
    <div class="row book-row ${p.locked ? 'is-locked' : ''} ${p.id === S.currentProfile().id ? 'is-current' : ''}">
      <button type="button" class="grow-btn" data-act="profile-switch" data-id="${esc(p.id)}">
        ${avatar(p)}<span class="grow"><b>${esc(p.name)}${p.locked ? ' 🔒' : ''}</b>
        <small>${esc(kindOf(p).label)} · ${p.id === S.currentProfile().id ? 'Đang mở' : 'Bấm để mở'}</small></span>
        <span class="psum" data-psum="${esc(p.id)}">…</span></button>
      <button type="button" class="lock-btn ${p.locked ? 'on' : ''}" data-act="book-lock" data-id="${esc(p.id)}"
        aria-label="${p.locked ? 'Mở khóa' : 'Khóa'}">${p.locked ? '🔒<small>Đang khóa</small>' : '🔓<small>Mở</small>'}</button>
    </div>`).join('')}
  </section>`).join('')}
  <p class="muted small">🔒 Mục bị khóa không thể chuyển tiền đi: chi, transfer, chuyển khoản, trả nợ, bị người khác withdraw, trả tiền thẻ (thẻ bị khóa thì không ghi khoản chi mới). Tiền vào vẫn nhận bình thường. Bấm lần nữa để mở khóa.</p>

  ${secrecyHtml()}

  ${sectionTitle('Bảo mật')}
  <section class="card form">
    <div class="row-between"><span>Khóa app bằng mật khẩu<br><small class="${lockConfig().enabled && isDefaultPin() ? 'expense' : 'muted'}">${!lockConfig().enabled ? 'Đang tắt' : isDefaultPin() ? `Đang dùng mật khẩu mặc định ${DEFAULT_PIN} — nên đổi` : 'Đang bật'}</small></span>
      <label class="switch"><input type="checkbox" data-lock-toggle ${lockConfig().enabled ? 'checked' : ''}><i></i></label></div>
    ${lockConfig().enabled ? `${field('Tự khóa khi rời app', `<select data-lock-delay>${[[0, 'Ngay lập tức'], [60, 'Sau 1 phút'], [300, 'Sau 5 phút'], [900, 'Sau 15 phút']].map(([v, l]) => `<option value="${v}" ${Number(lockConfig().delay) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
    <button type="button" class="btn ghost" data-act="pin-change">🔑 Đổi mật khẩu</button>` : ''}
    <p class="muted small">Mật khẩu dùng chung cho mọi người dùng trên máy này. Quên mật khẩu sẽ không mở được app, hãy ghi nhớ kỹ và sao lưu dữ liệu định kỳ.</p>
  </section>

  ${S.isCard() || S.isTracker() ? '' : `${sectionTitle('Nhắc nhở')}
  <section class="card form">
    ${field('Nhắc trước hạn trả nợ / hóa đơn (ngày)', `<input type="number" min="0" max="30" data-set="remindDays" data-num value="${esc(s.remindDays)}">`)}
    <div class="row-between"><span>Thông báo khi mở app<br><small class="muted">${notifState === 'unsupported' ? 'Thiết bị/trình duyệt chưa hỗ trợ. Trên iPhone cần iOS 16.4+ và mở app từ màn hình chính.' : notifState === 'granted' ? 'Đã cho phép' : notifState === 'denied' ? 'Đã bị chặn – bật lại trong Cài đặt của điện thoại' : 'Chưa cấp quyền'}</small></span>
      ${notifState === 'unsupported' ? '' : `<label class="switch"><input type="checkbox" data-act-change="notify" ${s.notify && notifState === 'granted' ? 'checked' : ''}><i></i></label>`}</div>
    <div class="two">${field('Nhắc ghi chép hằng ngày lúc', `<input type="time" data-set="dailyTime" value="${esc(s.dailyTime)}">`)}
      <button type="button" class="btn ghost" data-act="daily-ics" style="align-self:end">📅 Thêm vào Lịch</button></div>
    <p class="muted small">💡 Web app không tự đặt chuông khi đang đóng. Để nhắc chắc chắn, hãy thêm hạn trả nợ và nhắc ghi chép vào <b>app Lịch</b> của điện thoại. App Lịch sẽ báo cả khi offline.</p>
  </section>`}

  ${sectionTitle('Sao lưu & dữ liệu')}
  <section class="card list">
    <button type="button" class="row" data-act="backup"><span class="ci">💾</span><span class="grow"><b>Sao lưu tất cả (file .json)</b><small>Mọi người dùng + thẻ chi tiêu · ${s.lastBackup ? 'lần cuối ' + fmtDate(s.lastBackup) : 'chưa sao lưu lần nào'}</small></span>›</button>
    <label class="row"><span class="ci">♻️</span><span class="grow"><b>Khôi phục từ bản sao lưu</b><small>Thay thế toàn bộ người dùng, thẻ và giao dịch</small></span>›<input type="file" accept=".json,application/json" data-act-change="restore" hidden></label>
    <button type="button" class="row" data-act="export-csv-all"><span class="ci">📄</span><span class="grow"><b>Xuất Excel (CSV) toàn bộ giao dịch</b></span>›</button>
    <button type="button" class="row danger" data-act="wipe"><span class="ci">🗑️</span><span class="grow"><b>Xóa toàn bộ dữ liệu của ${esc(S.bookLabel(S.currentProfile()))}</b><small>Sổ của người khác giữ nguyên</small></span></button>
  </section>
  ${s.lastBackup && diffDays(s.lastBackup, todayISO()) < 30 ? '' : '<p class="muted small center">⚠️ Dữ liệu chỉ nằm trên máy này. Nên sao lưu định kỳ (lưu vào iCloud Drive / Google Drive / Zalo "Cloud của tôi").</p>'}
  <p class="muted small center" id="storage-info"></p>
  <p class="muted small center">Sổ Thu Chi · chạy offline · dữ liệu không rời khỏi điện thoại của bạn</p>`;
}

// ================= Cài đặt riêng của mục (tab ⚙️ ở thanh dưới) =================
function bookSettingsView() {
  const s = state.settings;
  const p = S.currentProfile();
  const u = S.currentUser();
  let body;
  if (S.isTracker()) {
    const m = state.mirror;
    body = `${sectionTitle('Category')}
    <section class="card list">
      <button type="button" class="row" data-act="invest-source"><span class="ci">⚙️</span><span class="grow"><b>Thiết lập nguồn</b>
        <small>${m?.configured ? (p.kind === 'track' ? `${m.books.length} mục · Thu/Chi` : `${m.rules.length} luồng Transfer/Withdraw`) : 'Chưa thiết lập'}</small></span>›</button>
      <button type="button" class="row" data-act="cat-owner-edit"><span class="ci">✎</span><span class="grow"><b>Tên, biểu tượng, màu</b><small>${esc(u.name)}</small></span>›</button>
    </section>
    <section class="card form">
      ${field('Chênh lệch hiện trên thẻ Category theo', `<select data-stat-period>${['day', 'week', 'month'].map((x) => `<option value="${x}" ${(u.statPeriod || 'day') === x ? 'selected' : ''}>${PERIOD_LABEL[x]}</option>`).join('')}</select>`)}
      <p class="muted small">Số chênh lệch (thu − chi) theo kỳ này hiện trên thẻ Category trong danh sách User / Category.</p>
    </section>`;
  } else if (S.isCard()) {
    body = `${sectionTitle('Danh mục của thẻ')}
    <section class="card list">
      <button type="button" class="row" data-act="categories"><span class="ci">🗂️</span><span class="grow"><b>Danh mục chi</b><small>${state.categories.filter((c) => !c.archived && c.type === 'expense').length} danh mục</small></span>›</button>
    </section>
    ${quickSettingsHtml()}`;
  } else {
    body = `${sectionTitle('Hiển thị')}
    <section class="card form">
      ${[['showReports', '📊 Hiện mục Báo cáo'], ['showPlan', '🎯 Hiện mục Kế hoạch']].map(([k, label]) => `
      <div class="row-between"><span>${label}</span>
        <label class="switch"><input type="checkbox" data-tab-toggle="${k}" ${s[k] !== false ? 'checked' : ''}><i></i></label></div>`).join('')}
      <p class="muted small">Tắt để ẩn khỏi thanh dưới cùng của mục này. Dữ liệu ngân sách, mục tiêu, trả nợ vẫn được giữ. Khi mở mục, app luôn xem mặc định theo <b>Ngày</b>.</p>
    </section>

    ${quickSettingsHtml()}

    ${sectionTitle('Dữ liệu nền')}
    <section class="card list">
      <button type="button" class="row" data-act="accounts"><span class="ci">🏦</span><span class="grow"><b>Tài khoản ngân hàng</b><small>${S.activeAccounts().length} tài khoản</small></span>›</button>
      <button type="button" class="row" data-act="categories"><span class="ci">🗂️</span><span class="grow"><b>Danh mục thu chi</b><small>${state.categories.filter((c) => !c.archived).length} danh mục</small></span>›</button>
    </section>

    ${sectionTitle('Phân bổ thu nhập & quỹ dự phòng')}
    <section class="card form">
      ${field('Phương pháp', `<select data-set="method"><option value="none" ${s.method === 'none' ? 'selected' : ''}>Không dùng</option>${Object.entries(S.METHODS).map(([k, m]) => `<option value="${k}" ${s.method === k ? 'selected' : ''}>${m.name}</option>`).join('')}</select>`)}
      ${field('Thu nhập dự kiến/tháng (dùng khi chưa ghi khoản thu)', `<input class="money" inputmode="decimal" data-set="expectedIncome" data-money value="${s.expectedIncome ? fmtNum(s.expectedIncome) : ''}" placeholder="vd: 15tr">`)}
      ${field('Quỹ dự phòng = số tháng chi tiêu', `<select data-set="emergencyMonths" data-num>${[3, 4, 6, 9, 12].map((n) => `<option value="${n}" ${Number(s.emergencyMonths) === n ? 'selected' : ''}>${n} tháng</option>`).join('')}</select>`)}
      <p class="muted small">Gán nhóm 50/30/20 hoặc lọ JARS cho từng danh mục trong "Danh mục thu chi".</p>
    </section>`;
  }
  return `${topBar(`⚙️ Cài đặt riêng của ${esc(kindOf(p).label)}`)}${body}`;
}

actions['close-settings'] = () => { location.hash = '#/home'; };
actions['cat-owner-edit'] = () => userForm(S.currentUser());

const pinInput = (id, label) => field(label, `<input id="${id}" type="password" inputmode="numeric" autocomplete="off" maxlength="12" pattern="[0-9]*" class="pin-input">`);

/** Hỏi mật khẩu hiện tại; trả về Promise<boolean>. */
function verifyPin(title) {
  return new Promise((resolve) => {
    let ok = false;
    openSheet({
      title,
      body: `<form class="form">${pinInput('vp-pin', 'Mật khẩu hiện tại')}<div class="actions"><button class="btn primary">Xác nhận</button></div></form>`,
      onClose: () => resolve(ok),
      onMount(sh, close) {
        setTimeout(() => $(sh, '#vp-pin').focus(), 250);
        $(sh, 'form').addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!(await checkPin($(sh, '#vp-pin').value))) { $(sh, '#vp-pin').value = ''; return toast('Sai mật khẩu'); }
          ok = true;
          close();
        });
      },
    });
  });
}

actions['pin-change'] = () => {
  openSheet({
    title: 'Đổi mật khẩu',
    body: `<form class="form">
      ${pinInput('pc-old', 'Mật khẩu hiện tại' + (isDefaultPin() ? ` (mặc định ${DEFAULT_PIN})` : ''))}
      ${pinInput('pc-new', 'Mật khẩu mới (4–12 chữ số)')}
      ${pinInput('pc-new2', 'Nhập lại mật khẩu mới')}
      <div class="actions"><button class="btn primary">Lưu mật khẩu</button></div>
    </form>`,
    onMount(sh, close) {
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const oldPin = $(sh, '#pc-old').value, p1 = $(sh, '#pc-new').value, p2 = $(sh, '#pc-new2').value;
        if (!(await checkPin(oldPin))) return toast('Mật khẩu hiện tại không đúng');
        if (!/^\d{4,12}$/.test(p1)) return toast('Mật khẩu mới phải gồm 4–12 chữ số');
        if (p1 !== p2) return toast('Hai lần nhập mật khẩu mới không khớp');
        await setPin(p1);
        close(); refresh(); toast('🔑 Đã đổi mật khẩu');
      });
    },
  });
};

async function mountSettings(root) {
  fillProfileSums(root);
  root.querySelector('[data-secrecy-toggle]')?.addEventListener('change', (e) => {
    S.setSecrecyHidden(!e.target.checked);
    toast(e.target.checked ? 'Đã hiện mục Secrecy' : 'Đã ẩn mục Secrecy');
  });
  root.querySelectorAll('[data-quick-show]').forEach((el) => el.addEventListener('change', async () => {
    const k = el.dataset.quickShow;
    const q = quickOf(k);
    if (!q) return;
    await saveQuick(k, { ...q, show: el.checked });
    toast(el.checked ? 'Đã hiện nút ⚡ ở Tổng quan' : 'Đã ẩn nút ⚡');
  }));
  root.querySelectorAll('[data-tab-toggle]').forEach((el) => el.addEventListener('change', async () => {
    await S.setSetting(el.dataset.tabToggle, el.checked);
    toast(el.checked ? 'Đã hiện mục' : 'Đã ẩn mục');
  }));
  root.querySelector('[data-default-bank]')?.addEventListener('change', (e) => actions['default-bank'](e.target));
  root.querySelector('[data-stat-period]')?.addEventListener('change', (e) => {
    S.saveUser({ id: S.currentUser().id, statPeriod: e.target.value });
    toast('Đã lưu');
  });
  root.querySelector('[data-lock-toggle]')?.addEventListener('change', async (e) => {
    if (e.target.checked) {
      setLockEnabled(true);
      toast(isDefaultPin() ? `Đã bật khóa. Mật khẩu: ${DEFAULT_PIN}` : 'Đã bật khóa');
    } else if (await verifyPin('Tắt khóa app')) {
      setLockEnabled(false);
      toast('Đã tắt khóa app');
    }
    refresh();
  });
  root.querySelector('[data-lock-delay]')?.addEventListener('change', (e) => { setLockDelay(Number(e.target.value)); toast('Đã lưu'); });
  root.querySelectorAll('[data-set]').forEach((el) => {
    el.addEventListener('change', async () => {
      let v = el.value;
      if (el.hasAttribute('data-num')) v = Number(v);
      if (el.hasAttribute('data-money')) {
        v = el.value.trim() ? Math.round(parseAmount(el.value)) : 0;
        if (!Number.isFinite(v)) return toast('Số tiền chưa hợp lệ');
      }
      await S.setSetting(el.dataset.set, v);
      if (el.dataset.set === 'period' && ui.period) ui.period.type = v;
      toast('Đã lưu');
    });
  });
  root.querySelector('[data-act-change="notify"]')?.addEventListener('change', async (e) => {
    if (e.target.checked) {
      const p = await Notification.requestPermission();
      await S.setSetting('notify', p === 'granted');
      if (p !== 'granted') toast('Bạn chưa cho phép thông báo');
    } else await S.setSetting('notify', false);
  });
  root.querySelector('[data-act-change="restore"]')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { return toast('File không đọc được (không phải JSON)', 4000); }
    const msg = data && data.all
      ? `Khôi phục sẽ THAY THẾ TOÀN BỘ người dùng, thẻ chi tiêu và giao dịch trên máy này bằng bản sao lưu ngày ${fmtDate(String(data.exportedAt || '').slice(0, 10))} (${(data.profiles || []).length} người dùng/thẻ). Tiếp tục?`
      : `Đây là bản sao lưu kiểu cũ (một sổ). Khôi phục sẽ THAY THẾ dữ liệu trong sổ của "${S.bookLabel(S.currentProfile())}". Tiếp tục?`;
    if (!confirm(msg)) return;
    try {
      ui.period = null;
      ui.reportPeriod = null;
      const n = await S.importAny(data);
      toast(n ? `Đã khôi phục ${n} người dùng/thẻ` : 'Đã khôi phục dữ liệu', 3500);
    } catch (err) { toast('Lỗi: ' + err.message, 4000); }
  });
  if (navigator.storage?.estimate) {
    const { usage } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const el = root.querySelector('#storage-info');
    if (el) el.textContent = `Dung lượng đang dùng: ${(usage / 1048576).toFixed(1)} MB${persisted ? ' · lưu trữ bền vững ✓' : ''}`;
  }
}

actions['daily-ics'] = () => calendarSheet('nhac-ghi-chep.ics', buildDailyICS(state.settings.dailyTime || '21:00', todayISO()));

actions.backup = async () => {
  const data = await S.exportAll();
  await shareOrDownload(`sothuchi-tat-ca-${todayISO()}.json`, JSON.stringify(data), 'application/json');
  await S.setSetting('lastBackup', todayISO());
};

function csvOf(list) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Ngày', 'Loại', 'Số tiền (VND)', 'Tiền tệ', 'Số tiền gốc', 'Danh mục', 'Tài khoản', 'Đến tài khoản', 'Ghi chú', 'Tag'];
  const rows = sortTx([...list]).reverse().map((t) => [
    t.date, TYPE_LABEL[t.type], t.type === 'expense' ? -t.amountVnd : t.amountVnd, t.currency || 'VND', t.amount,
    S.txParts(t).map((p) => (S.catById(p.categoryId)?.name || '') + (S.txParts(t).length > 1 ? ` (${p.amountVnd})` : '')).join(' + '),
    accName(t.accountId), t.toAccountId ? accName(t.toAccountId) : '', t.note, (t.tags || []).join(', '),
  ]);
  return '﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
}
actions['export-csv'] = () => shareOrDownload(`giao-dich-${currentRange().start}.csv`, csvOf(filteredTx()), 'text/csv');
actions['export-csv-all'] = () => shareOrDownload(`giao-dich-tat-ca-${todayISO()}.csv`, csvOf(state.transactions), 'text/csv');

actions.wipe = async () => {
  if (!confirm(`Xóa TOÀN BỘ dữ liệu trong sổ của "${S.bookLabel(S.currentProfile())}"? Không thể hoàn tác. Hãy sao lưu trước!`)) return;
  if (prompt('Gõ XOA để xác nhận') !== 'XOA') return;
  await S.wipeAll();
  ui.period = null;
  toast('Đã xóa toàn bộ dữ liệu');
};

// ----- Tài khoản ngân hàng -----
actions['acc-edit'] = (el) => accountForm(state.accounts.find((a) => a.id === el.dataset.id));

actions.accounts = () => {
  const render = () => `<div class="list">${state.accounts.sort((a, b) => (!!a.archived - !!b.archived) || (a.order ?? 0) - (b.order ?? 0)).map((a) => `
    <button type="button" class="row ${a.archived ? 'off' : ''}" data-acc="${a.id}"><span class="ci">${esc(a.icon)}</span>
    <span class="grow"><b>${esc(a.name)}</b><small>${esc(accSub(a))}${a.archived ? ' · đã ẩn' : ''}</small></span><span class="amt">${fmt(S.accountBalance(a))}</span></button>`).join('')}</div>
    ${canAddAccount() ? '<button type="button" class="btn primary block" data-acc="">+ Thêm tài khoản ngân hàng</button>' : '<p class="muted small center">Mỗi mục Ngân hàng / Đầu tư chỉ gắn 1 tài khoản ngân hàng.</p>'}`;
  openSheet({
    title: 'Tài khoản ngân hàng', body: render(),
    onMount(sh, close) {
      sh.addEventListener('click', (e) => {
        const b = e.target.closest('[data-acc]');
        if (b) { close(); accountForm(state.accounts.find((a) => a.id === b.dataset.acc)); }
      });
    },
  });
};

/** Mỗi mục Ngân hàng / Đầu tư chỉ gắn 1 tài khoản ngân hàng. */
const canAddAccount = () => S.activeAccounts().length < 1;

function accountForm(a) {
  if (!a && !canAddAccount()) return toast('Mỗi mục chỉ gắn 1 tài khoản ngân hàng. Muốn thêm tài khoản khác, hãy tạo mục Ngân hàng mới.', 4000);
  const f = a ? { ...a } : { name: '', bank: '', number: '', holder: '', icon: '🏦', kind: 'bank', initial: 0, order: state.accounts.length };
  const used = a && state.transactions.some((t) => t.accountId === a.id || t.toAccountId === a.id);
  const curBal = a ? S.accountBalance(a) : 0;
  openSheet({
    title: a ? 'Tài khoản ngân hàng' : 'Thêm tài khoản ngân hàng',
    body: `<form class="form">
      ${field('Ngân hàng', `<input id="af-bank" list="af-banks" required value="${esc(f.bank || '')}" placeholder="vd: Vietcombank"><datalist id="af-banks">${BANKS.map((b) => `<option value="${esc(b)}">`).join('')}</datalist>`)}
      <div class="two">
        ${field('Số tài khoản', `<input id="af-num" inputmode="numeric" autocomplete="off" value="${esc(f.number || '')}" placeholder="vd: 0123456789">`)}
        ${a && f.number ? '<button type="button" class="btn ghost small" data-copy style="align-self:end">📋 Chép STK</button>' : ''}
      </div>
      ${field('Chủ tài khoản', `<input id="af-holder" autocomplete="off" style="text-transform:uppercase" value="${esc(f.holder || '')}" placeholder="vd: NGUYEN VAN A">`)}
      <div class="two">${field('Biểu tượng', `<input id="af-icon" maxlength="4" class="emoji" value="${esc(f.icon)}">`)}
      ${field('Tên gợi nhớ (không bắt buộc)', `<input id="af-name" value="${esc(a ? f.name : '')}" placeholder="vd: TK lương, TK chi tiêu">`, 'style="flex:3"')}</div>
      ${amountField('af-bal', curBal, a ? 'Số dư hiện tại (sửa nếu lệch với app ngân hàng)' : 'Số dư hiện tại')}
      <div class="actions">${a ? `<button type="button" class="btn danger" data-del>${used ? (a.archived ? 'Hiện lại' : 'Ẩn tài khoản') : 'Xóa'}</button>` : ''}<button class="btn primary">Lưu</button></div>
    </form>`,
    onMount(sh, close) {
      const bal = bindMoney(sh, 'af-bal');
      if (!a) bal.value = '';
      $(sh, '[data-copy]')?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(f.number.replace(/\s/g, '')); toast('Đã chép số tài khoản'); } catch { toast('Không sao chép được'); }
      });
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const bank = $(sh, '#af-bank').value.trim();
        if (!bank) return toast('Nhập tên ngân hàng');
        const number = $(sh, '#af-num').value.replace(/[^\d\s]/g, '').trim();
        const v = bal.value.trim() ? readMoney(bal.value) : 0;
        if (!Number.isFinite(v) || v < 0) return toast('Số dư phải là số không âm');
        const digits = number.replace(/\s/g, '');
        const name = $(sh, '#af-name').value.trim() || (digits ? `${bank} ••${digits.slice(-4)}` : bank);
        // Số dư = ban đầu + các giao dịch → chỉnh "ban đầu" để số dư hiện tại khớp số nhập.
        const initial = Math.round((Number(f.initial) || 0) + (v - curBal));
        await S.put('accounts', {
          ...f, kind: 'bank', bank, number, holder: $(sh, '#af-holder').value.trim().toUpperCase(),
          name, icon: $(sh, '#af-icon').value.trim() || '🏦', initial,
        });
        close(); toast('Đã lưu tài khoản');
      });
      $(sh, '[data-del]')?.addEventListener('click', async () => {
        if (used) { await S.put('accounts', { ...a, archived: !a.archived }); close(); return; }
        if (S.activeAccounts().length <= 1) return toast('Cần giữ ít nhất 1 tài khoản');
        if (!confirm('Xóa tài khoản này?')) return;
        await S.remove('accounts', a.id); close();
      });
    },
  });
}

// ----- Danh mục -----
actions.categories = () => {
  let tab = 'expense';
  const render = () => `<div class="seg small">${['expense', 'income'].map((t) => `<button type="button" data-tab="${t}" class="${tab === t ? 'on' : ''}">${TYPE_LABEL[t]}</button>`).join('')}</div>
    <div class="list">${state.categories.filter((c) => c.type === tab && (S.currentProfile().kind !== 'invest' || c.invest)).sort((a, b) => (!!a.archived - !!b.archived) || (a.order ?? 0) - (b.order ?? 0)).map((c) => {
      const m = S.METHODS[state.settings.method];
      const grp = m && tab === 'expense' ? m.groups.find((g) => g.key === c[m.field])?.name || 'Chưa gán nhóm' : '';
      return `<button type="button" class="row ${c.archived ? 'off' : ''}" data-cat="${c.id}">${catIcon(c)}<span class="grow"><b>${esc(c.name)}</b><small>${esc(grp)}${c.archived ? ' · đã ẩn' : ''}</small></span>›</button>`;
    }).join('')}</div>
    <button type="button" class="btn primary block" data-cat="">+ Thêm danh mục</button>`;
  openSheet({
    title: 'Danh mục', body: `<div id="cat-mgr">${render()}</div>`,
    onMount(sh, close) {
      const box = $(sh, '#cat-mgr');
      box.addEventListener('click', (e) => {
        const t = e.target.closest('[data-tab]');
        if (t) { tab = t.dataset.tab; box.innerHTML = render(); return; }
        const b = e.target.closest('[data-cat]');
        if (b) { close(); categoryForm(state.categories.find((c) => c.id === b.dataset.cat), tab); }
      });
    },
  });
};

function categoryForm(c, type) {
  const f = c ? { ...c } : { type, name: '', icon: '🏷️', color: S.PALETTE[state.categories.length % S.PALETTE.length], rule: 'wants', jar: 'PLAY', order: state.categories.length };
  const used = c && state.transactions.some((t) => S.txParts(t).some((p) => p.categoryId === c.id));
  const grpSelect = (m, key, val) => `<select id="cf-${key}">${S.METHODS[m].groups.map((g) => `<option value="${g.key}" ${val === g.key ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>`;
  openSheet({
    title: c ? 'Sửa danh mục' : 'Thêm danh mục',
    body: `<form class="form">
      ${field('Tên', `<input id="cf-name" required value="${esc(f.name)}">`)}
      <div class="field"><span>Biểu tượng <b id="cf-icon-now">${esc(f.icon)}</b></span>${iconPickerHtml('cf-icons', f.icon)}</div>
      <div class="field"><span>Màu</span><div class="colors">${S.PROFILE_COLORS.map((col) => `<button type="button" class="color ${col === f.color ? 'on' : ''}" data-color="${col}" style="--c:${col}" aria-label="${col}"></button>`).join('')}</div></div>
      ${f.type === 'expense' ? `<div class="two">${field('Nhóm 50/30/20', grpSelect('503020', 'rule', f.rule))}${field('Lọ JARS', grpSelect('jars', 'jar', f.jar))}</div>` : ''}
      <div class="actions">${c && !c.sys ? `<button type="button" class="btn danger" data-del>${used ? (c.archived ? 'Hiện lại' : 'Ẩn') : 'Xóa'}</button>` : ''}<button class="btn primary">Lưu</button></div>
    </form>`,
    onMount(sh, close) {
      bindIconPicker($(sh, '#cf-icons'), (icon) => { f.icon = icon; $(sh, '#cf-icon-now').textContent = icon; }, () => f.icon);
      $(sh, '.colors').addEventListener('click', (e) => {
        const b = e.target.closest('[data-color]');
        if (!b) return;
        f.color = b.dataset.color;
        sh.querySelectorAll('.color').forEach((x) => x.classList.toggle('on', x === b));
      });
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await S.put('categories', { ...f, ...(S.currentProfile().kind === 'invest' && !f.invest ? { invest: 'custom-' + Date.now() } : {}), name: $(sh, '#cf-name').value.trim(), icon: f.icon || '🏷️', rule: $(sh, '#cf-rule')?.value || f.rule, jar: $(sh, '#cf-jar')?.value || f.jar });
        close(); toast('Đã lưu danh mục');
      });
      $(sh, '[data-del]')?.addEventListener('click', async () => {
        if (used) { await S.put('categories', { ...c, archived: !c.archived }); close(); return; }
        if (!confirm('Xóa danh mục này?')) return;
        await S.remove('categories', c.id); close();
      });
    },
  });
}

// ----- Tiền tệ -----
actions.currencies = () => {
  const list = state.settings.currencies.map((c) => ({ ...c }));
  const render = () => list.map((c, i) => `<div class="split-row"><input value="${esc(c.code)}" data-i="${i}" data-k="code" maxlength="5" ${c.code === 'VND' ? 'disabled' : ''} style="flex:0 0 80px">
    <input inputmode="decimal" value="${c.code === 'VND' ? 1 : fmtNum(c.rate)}" data-i="${i}" data-k="rate" ${c.code === 'VND' ? 'disabled' : ''} placeholder="Tỷ giá ra VND">
    ${c.code === 'VND' ? '<span class="icon-btn"></span>' : `<button type="button" class="icon-btn" data-rm="${i}">✕</button>`}</div>`).join('');
  openSheet({
    title: 'Tiền tệ & tỷ giá',
    body: `<form class="form"><p class="muted small">Tỷ giá tự nhập (1 đơn vị = ? VND). App chạy offline nên không tự cập nhật tỷ giá. Giao dịch cũ giữ tỷ giá lúc ghi.</p>
      <div id="cur-list">${render()}</div>
      <button type="button" class="btn ghost small" data-add>+ Thêm tiền tệ</button>
      <div class="actions"><button class="btn primary">Lưu</button></div></form>`,
    onMount(sh, close) {
      const box = $(sh, '#cur-list');
      box.addEventListener('input', (e) => {
        const i = e.target.dataset.i;
        if (i == null) return;
        if (e.target.dataset.k === 'code') list[i].code = e.target.value.toUpperCase().trim();
        else list[i].rate = parseAmount(e.target.value);
      });
      box.addEventListener('click', (e) => {
        if (e.target.dataset.rm != null) { list.splice(Number(e.target.dataset.rm), 1); box.innerHTML = render(); }
      });
      $(sh, '[data-add]').addEventListener('click', () => { list.push({ code: '', rate: 0 }); box.innerHTML = render(); });
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const clean = list.filter((c) => c.code && c.rate > 0);
        if (!clean.some((c) => c.code === 'VND')) clean.unshift({ code: 'VND', rate: 1 });
        await S.setSetting('currencies', clean);
        close(); toast('Đã lưu tỷ giá');
      });
    },
  });
};

// ================= Điều hướng chung =================
// data-p="main" (Tổng quan/Giao dịch) hoặc "report" (Báo cáo)
const pKey = (el) => (['report', 'card'].includes(el.dataset.p) ? el.dataset.p : 'main');
const pOf = (el) => periodState(pKey(el));

actions['period-type'] = (el) => {
  const p = pOf(el);
  const r = rangeFor(pKey(el));
  const today = todayISO();
  // Chuyển sang xem theo ngày khi đang ở kỳ hiện tại → mở luôn ngày hôm nay.
  if (el.dataset.v === 'day' && today >= r.start && today <= r.end) p.anchor = today;
  // Chuyển sang "Khoảng": lấy luôn kỳ đang xem làm khoảng mặc định.
  if (el.dataset.v === 'custom' && p.type !== 'custom') { p.from = r.start; p.to = r.end; }
  if (p.type === 'custom' && el.dataset.v !== 'custom') p.anchor = p.to;
  p.type = el.dataset.v;
  refresh();
};
actions['period-shift'] = (el) => { const p = pOf(el); p.anchor = shiftAnchor(p.type, p.anchor, Number(el.dataset.v)); refresh(); };
actions['period-date'] = (el) => {
  if (!el.value) return;
  const p = pOf(el);
  if (el.dataset.range) p[el.dataset.range] = el.value;
  else p.anchor = el.value;
  refresh();
};
actions['period-today'] = (el) => { pOf(el).anchor = todayISO(); refresh(); };

const VIEWS = {
  home: { html: () => (S.isCard() ? cardView() : S.isTracker() ? investView() : homeView()) },
  tx: { html: txView, mount: mountTx },
  reports: { html: reportsView },
  plan: { html: planView },
  settings: { html: settingsView, mount: mountSettings },
  bookset: { html: bookSettingsView, mount: mountSettings },
};

let current = { route: 'home', sub: null };

/** Mục bị ẩn theo cài đặt của người dùng hiện tại. */
const hiddenTabs = () => {
  const s = state.settings;
  // Thẻ chi tiêu và Category: chỉ Tổng quan + ⚙️ Cài đặt riêng.
  if (S.isCard() || S.isTracker()) return new Set(['tx', 'reports', 'plan']);
  return new Set([s.showReports === false && 'reports', s.showPlan === false && 'plan'].filter(Boolean));
};

export function render(route, sub) {
  const hidden = hiddenTabs();
  if (hidden.has(route)) {
    route = 'home';
    sub = null;
    if (location.hash !== '#/home') history.replaceState(null, '', '#/home');
  }
  const tabs = [...document.querySelectorAll('#tabbar a')];
  tabs.forEach((a) => { a.hidden = hidden.has(a.dataset.tab); });
  // Chỉ còn 1 mục (vd: thẻ chi tiêu) thì ẩn luôn thanh dưới.
  // Cài đặt chung (mở từ danh sách User/Category) có nút đóng riêng → ẩn thanh dưới.
  document.body.classList.toggle('no-tabbar', route === 'settings' || tabs.filter((a) => !a.hidden).length <= 1);
  const sameView = current.route === route && current.sub === sub;
  current = { route: VIEWS[route] ? route : 'home', sub };
  const v = VIEWS[current.route];
  const main = document.getElementById('main');
  const y = window.scrollY;
  main.innerHTML = v.html(sub);
  v.mount && v.mount(main);
  window.scrollTo(0, sameView ? y : 0);
  document.querySelectorAll('#tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === current.route));
}

export function refresh() {
  render(current.route, current.sub);
}
