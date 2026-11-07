// Các màn hình và form của app.
import * as S from './store.js';
import { state } from './store.js';
import {
  ui, currentRange, reportRange, rangeFor, periodState, datePick, amountLine, moneyBox, isDark, toggleTheme, toast, openSheet, restorePageScroll, periodBar, progress, empty, shareOrDownload, download, openCalendarFile, compressImage,
} from './ui.js';
import {
  esc, fmt, fmtNum, fmtCur, fmtSigned, fmtShort, fmtDate, fmtDayHeader, fmtDue, parseAmount, todayISO, addDays, diffDays,
  getRange, shiftAnchor, prevRange, elapsedDays, parseISO, nextDate, FREQ_LABEL, PERIOD_LABEL, splitTags, debounce, addMonths,
  fmtDM, vnDateISO, fmtTimeVN, fmtDateTimeVN,
} from './utils.js';
import { donut, bars } from './charts.js';
import { iconPickerHtml, bindIconPicker, MONEY_PAIRS } from './icons.js';
import { buildAllDayICS, buildDailyICS } from './ics.js';
import { AUTO_FILE_NAME, canPickFile, saveStatus, markSaved, backupJson, pickBackupFile, saveToPickedFile } from './autosave.js';
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

/** Nhãn khoản Transfer/Get In theo góc nhìn của sổ đang xem. */
function gopLabel(g) {
  if (g.mode === 'pay') return g.dir === 'in' ? `Thanh toán từ ${g.peerName}` : `Thanh toán ${g.peerName}`;
  if (g.mode === 'trich') return g.dir === 'in' ? `Get In từ ${g.peerName}` : `Chuyển Get In cho ${g.peerName}`;
  return g.dir === 'out' ? `Transfer cho ${g.peerName}` : `Nhận transfer từ ${g.peerName}`;
}

/** Lý do không được xóa giao dịch: làm Thẻ tín dụng thành số dương hoặc Personal/Family bị âm. */
async function removeBlock(t) {
  return S.creditError(0, t) || S.pfRemoveError(t);
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
  if (t.pf && S.isSpecialBook(S.currentProfile())) sub.push(S.PF_LABEL[t.pf]);
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
/** Dòng nhỏ dưới Tổng số dư: tài khoản đang gắn với mục. */
const accLine = () => {
  const list = S.activeAccounts();
  const od = S.currentProfile().overdraft ? ` · Hạn mức ${fmt(S.currentProfile().limit)}` : '';
  return list.map((a) => a.icon + ' ' + [a.name, a.number && 'STK ' + a.number].filter(Boolean).join(' · ') + (list.length > 1 ? ' · ' + fmt(S.accountBalance(a)) : '')).join('  |  ') + od;
};
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
  if (S.getProfiles().some((b) => b.id === bookId && b.credit)) {
    const lim = Number(S.getProfiles().find((b) => b.id === bookId).limit) || 0;
    const over = lim && have - need < -lim;
    el.textContent = `Thẻ tín dụng · đang nợ ${fmt(Math.max(0, -have))}` + (lim ? ` · còn dùng được ${fmt(Math.max(0, lim + have))}` : '') + (over ? ' — ⚠️ vượt hạn mức' : '');
    el.className = 'hint' + (over ? ' warn-red' : '');
    return;
  }
  const od = S.getProfiles().find((b) => b.id === bookId && b.overdraft);
  if (od) {
    const over = need > od.limit || have - need < -od.limit;
    el.textContent = `Thấu chi · số dư ${fmt(have)} · hạn mức ${fmt(od.limit)}` + (over ? ' — ⚠️ vượt hạn mức' : '');
    el.className = 'hint' + (over ? ' warn-red' : '');
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
  field(label, `<div class="money-row">${moneyBox(`<input id="${id}" class="money" inputmode="decimal" autocomplete="off" placeholder="vd: 50k, 1tr2" value="${value ? fmtNum(value) : ''}">`)}</div><div class="zero-sug" data-zero-for="${id}" hidden></div><em class="hint" data-hint-for="${id}"></em>`);

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

// --- Đầu trang: trái = User (dưới là số thông báo), phải = mục đang mở (dưới là tổng tiền của nhóm mục) ---
const kindOf = (b) => (b.overdraft ? { label: 'Thấu chi', icon: '💳' } : S.BOOK_KINDS[b.kind] || S.BOOK_KINDS.bank);
/** Tiết kiệm chỉ có Transfer, không ghi thu/chi. */
const transferOnly = (b = S.currentProfile()) => b.kind === 'saving';

function topBar(sub = '', right = '') {
  const u = S.currentUser(), b = S.currentProfile();
  return `<header class="top topbar">
    <div class="chip-col">
      <button type="button" class="profile-chip" data-act="users" style="--c:${esc(u.color)}" title="User">
        ${avatar(u, 'chip-av')}<span class="chip-name">${esc(u.name)}</span>${u.special ? '<span class="chip-star" title="User đặc biệt">⭐</span>' : ''} <i>▾</i></button>
      <button type="button" class="chip-sub notif-count" data-act="users" data-notif-count hidden></button>
    </div>
    <div class="chip-col right">
      <button type="button" class="profile-chip book-chip" data-act="book-close" style="--c:${esc(b.color)}" title="Đóng, về Tổng quan">
        <span class="chip-name">Đóng</span> <i>✕</i></button>
      <small class="chip-sub" data-kind-total></small>
      <small class="chip-sub pf-p" data-pf-top="personal" hidden></small>
      <small class="chip-sub pf-f" data-pf-top="family" hidden></small>
    </div>
  </header>
  <div class="title-row"><div><h1>${esc(b.name)}${b.locked ? ' <span class="lock-badge" title="Mục đang khóa">🔒</span>' : ''}</h1>${sub ? `<small>${sub}</small>` : ''}</div>${right}</div>`;
}

// Các số phải đọc bất đồng bộ: hiện ngay giá trị lần trước rồi cập nhật, để không bị trống rồi hiện lại (chớp).
const fillCache = new Map();
const showCached = (el, key) => { const v = fillCache.get(key); if (v != null) el.innerHTML = v; };
const setCached = (el, key, html) => { fillCache.set(key, html); if (el.innerHTML !== html) el.innerHTML = html; };

function fillPfVals(root) {
  const els = root.querySelectorAll('[data-pf-val]');
  if (!els.length) return;
  const key = (el) => `pf:${el.dataset.pfVal}`;
  els.forEach((el) => showCached(el, key(el)));
  S.pfBalances().then((b) => { if (b) els.forEach((el) => setCached(el, key(el), fmt(b[el.dataset.pfVal]))); });
}

// Phần đầu màn hình: nhớ nội dung đã điền theo User và loại mục, vẽ lại thì dán ngay.
const TOP_FIELDS = '[data-kind-total],[data-notif-count],[data-over-ticker],[data-over-saving],[data-over-debt],[data-over-card],[data-pf-top]';
const topCache = new Map();
const topKey = () => `${S.currentUser().id}|${current.route === 'home' ? 'home' : S.kindOfBook(S.currentProfile())}`;
function saveTop(root) {
  if (!root.isConnected) return;
  topCache.set(topKey(), [...root.querySelectorAll(TOP_FIELDS)].map((el) => ({ html: el.innerHTML, hidden: el.hidden, style: el.style.cssText, row: el.parentElement.style.display })));
}
function restoreTop(root) {
  const saved = topCache.get(topKey());
  if (!saved) return;
  root.querySelectorAll(TOP_FIELDS).forEach((el, i) => {
    const s = saved[i];
    if (!s) return;
    el.innerHTML = s.html;
    el.hidden = s.hidden;
    el.style.cssText = s.style;
    el.parentElement.style.display = s.row;
  });
}

// Dòng thông báo chạy ở Tổng quan: mỗi thông báo 5 giây, xoay vòng liên tục.
const TICKER_MS = 5000;
let tickerTimer = null, tickerIdx = 0;
function tickerText(a) {
  const when = a.kind === 'budget' ? `${Math.round(a.ratio * 100)}%` : fmtDue(a.days);
  return `${NOTIF[a.kind].icon} ${when} · ${a.title}`;
}
function startTicker(el, alerts) {
  if (!el?.isConnected) return;
  clearInterval(tickerTimer);
  el.hidden = !alerts.length;
  if (!alerts.length) return;
  const show = () => {
    if (!el.isConnected) return clearInterval(tickerTimer);
    tickerIdx %= alerts.length;
    const text = tickerText(alerts[tickerIdx]);
    if (el.textContent === text) return; // Vẽ lại mà vẫn thông báo đó thì không chạy lại hiệu ứng.
    el.textContent = text;
    el.classList.remove('tick');
    void el.offsetWidth; // Chạy lại hiệu ứng hiện dần.
    el.classList.add('tick');
  };
  show();
  if (alerts.length > 1) tickerTimer = setInterval(() => { tickerIdx++; show(); }, TICKER_MS);
}

/** Điền số thông báo và tổng tiền dưới 2 nút đầu trang (đọc nhiều mục nên làm sau khi vẽ). */
async function fillTopBar(root) {
  fillPfVals(root);
  const count = root.querySelector('[data-notif-count]'), total = root.querySelector('[data-kind-total]');
  if (!count || !total) return;
  const onHome = current.route === 'home';
  const u = S.currentUser(), kind = onHome ? 'bank' : S.kindOfBook(S.currentProfile());
  const [alerts, sum] = await Promise.all([S.userAlerts(u.id), S.kindTotal(u.id, kind)]);
  count.hidden = !alerts.length;
  count.textContent = `🔔 ${alerts.length} thông báo`;
  startTicker(root.querySelector('[data-over-ticker]'), alerts);
  total.innerHTML = (kind === 'card' ? '<small>Chưa TT</small> ' : '') + fmt(sum);
  // Số tiền rất lớn hoặc màn hình hẹp: thu nhỏ vừa đủ để không đè lên nút + giữa màn hình.
  if (onHome) {
    const [saving, wallet] = await Promise.all([S.kindTotal(u.id, 'saving'), tabTotal(u.id, 'wallet')]);
    const savingEl = root.querySelector('[data-over-saving]'), cardEl = root.querySelector('[data-over-card]');
    const debtEl = root.querySelector('[data-over-debt]');
    if (!savingEl || !cardEl || !debtEl || !root.contains(total)) return; // Đã rời Tổng quan trong lúc đọc dữ liệu.
    const credits = tabBooks(u.id, 'credit');
    const debt = -(await tabTotal(u.id, 'credit'));
    debtEl.hidden = !credits.length;
    debtEl.textContent = `Nợ thẻ ${fmt(debt)}`;
    savingEl.textContent = `Tiết kiệm ${fmt(saving)}`;
    cardEl.parentElement.style.display = tabBooks(u.id, 'wallet').length ? '' : 'none';
    cardEl.textContent = `Ví điện tử ${fmt(wallet)}`;
  } else {
    const room = innerWidth / 2 - 44;
    total.style.fontSize = `${Math.min(15.4, room / (total.textContent.length * 0.515))}px`;
  }
  if (u.special && kind === 'bank') {
    const b = await S.pfBalances(u.id);
    root.querySelectorAll('[data-pf-top]').forEach((el) => {
      el.hidden = false;
      el.textContent = `${S.PF_LABEL[el.dataset.pfTop]} ${fmt(b[el.dataset.pfTop])}`;
    });
  }
  if (root.contains(total)) saveTop(root);
}

function resetViewState() {
  ui.period = null;
  ui.reportPeriod = null;
  ui.cardPeriod = null;
  ui.txFilter = { type: 'all', q: '', categoryIds: [], tag: null };
}

/** Mỗi lần chuyển mục / User: luôn mở màn hình Tổng quan. */
const goHome = () => { if (location.hash !== '#/home') location.hash = '#/home'; };

/** Mở màn hình của một mục (Giao dịch, Báo cáo, Kế hoạch, Cài đặt). */
async function openBook(id) {
  resetViewState();
  if (id !== S.currentProfile().id) {
    await S.switchProfile(id);
    await S.processRecurring();
  }
  if (location.hash === '#/tx') refresh(); else location.hash = '#/tx';
}
actions['book-open'] = (el) => openBook(el.dataset.id);
actions['book-close'] = () => { resetViewState(); goHome(); };
/** Thao tác từ Tổng quan trên một mục khác mục đang mở. */
const inBook = async (id) => { if (id && id !== S.currentProfile().id) await S.switchProfile(id); };

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

/** Ô chọn (User / mục): trái = avatar + tên; phải = số liệu (điền sau) + trạng thái. */
function tileHtml({ attr, id, color, av, name, on, sum, del, iconEdit = false }) {
  // iconEdit: bấm biểu tượng để sửa, bên phải chỉ còn nút xóa.
  const left = iconEdit ? `<span class="av-edit" data-edit="${esc(id)}" role="button" aria-label="Sửa">${av}<i>✎</i></span>` : av;
  const tag = iconEdit ? 'div' : 'button';
  return `<div class="ptile ${iconEdit ? 'icon-edit' : ''} ${on ? 'on is-current' : ''}" style="--c:${esc(color)}">
    <${tag} ${iconEdit ? 'role="button" tabindex="0"' : 'type="button"'} class="ptile-main" data-${attr}="${esc(id)}">
      <span class="ptile-left">${left}<b>${esc(name)}</b></span>
      <span class="ptile-right">${sum}${on ? '<i class="ptile-on">✓ Đang dùng</i>' : '<i class="ptile-go">Xem ›</i>'}</span>
    </${tag}>
    ${iconEdit ? '' : `<button type="button" class="ptile-edit" data-edit="${esc(id)}" aria-label="Sửa">✎</button>`}
    ${del ? `<button type="button" class="ptile-del" data-del="${esc(id)}" aria-label="Xóa">🗑</button>` : ''}
  </div>`;
}

/** Điền số liệu vào ô: [data-psum] = một mục; [data-usum] = tổng các mục của một User. */
async function fillProfileSums(root) {
  root.querySelectorAll('[data-psum]').forEach((el) => showCached(el, 'p:' + el.dataset.psum));
  root.querySelectorAll('[data-usum]').forEach((el) => showCached(el, 'u:' + el.dataset.usum));
  for (const el of root.querySelectorAll('[data-psum]')) {
    const p = S.getProfiles().find((x) => x.id === el.dataset.psum);
    if (!p) continue;
    try {
      const s = await S.profileSummary(p);
      setCached(el, 'p:' + p.id, s.credit
        ? `<b class="${s.balance < 0 ? 'expense' : ''}">${fmt(s.balance)}</b><small>${p.limit ? `Hạn mức ${fmtShort(p.limit)}` : S.CARD_TYPES.credit} · ${s.balance < 0 ? 'đang nợ' : 'hết nợ'}</small>`
        : s.kind === 'card'
        ? `<b class="${s.unpaid ? 'expense' : 'income'}">${fmt(s.unpaid)}</b><small>${p.cardType ? S.CARD_TYPES[p.cardType] + ' · ' : ''}${s.count ? `${s.count} khoản chưa TT` : 'Đã thanh toán hết'}</small>`
        : `<b class="${s.balance < 0 ? 'expense' : ''}">${fmt(s.balance)}</b><small>${p.overdraft ? `Thấu chi · hạn mức ${fmtShort(p.limit)}` : 'Số dư'}</small>`);
    } catch { el.textContent = ''; }
  }
  for (const el of root.querySelectorAll('[data-usum]')) {
    const books = S.userBooks(el.dataset.usum);
    try {
      let balance = 0, unpaid = 0;
      for (const b of books) {
        const s = await S.profileSummary(b);
        if (s.kind === 'card') unpaid += s.unpaid; else balance += s.balance;
      }
      setCached(el, 'u:' + el.dataset.usum, `<b class="${balance < 0 ? 'expense' : ''}">${fmt(balance)}</b><small>Tổng số dư · ${books.length} mục</small>`
        + (unpaid ? `<small class="expense">Thẻ chưa TT: ${fmt(unpaid)}</small>` : ''));
    } catch { el.textContent = ''; }
  }
}

// --- Thông báo của User đang chọn: nợ đến hạn, khoản định kỳ, ngân sách (của mọi mục trong User) ---
const NOTIF = {
  debt: { icon: '🏦', btn: 'Thanh toán' },
  pending: { icon: '⏳', btn: 'Xác nhận' },
  recurring: { icon: '🔁', btn: 'Xem' },
  budget: { icon: '⚠️', btn: 'Xem' },
  reminder: { icon: '🔔', btn: 'Done' },
  cardpay: { icon: '💳', btn: 'Trích trả' },
};
function notifRow(a) {
  const sub = a.kind === 'budget'
    ? `Đã dùng ${Math.round(a.ratio * 100)}% ngân sách (${fmtShort(a.amount)} / ${fmtShort(a.limit)})`
    : a.kind === 'pending'
      ? `${fmtShort(a.amount)} · kỳ ${fmtDate(a.date)}${a.noFunds ? ' · chưa ghi được vì thiếu số dư' : ' · chờ xác nhận'}`
      : a.kind === 'cardpay' ? `${a.count} khoản chưa thanh toán đến hết ${fmtDate(addDays(a.before, -1))} · ${fmt(a.amount)}`
      : a.kind === 'reminder' ? `${fmtDue(a.days)} · ${fmtDate(a.date)}${a.time ? ' ' + a.time : ''}${a.note ? ' · ' + a.note : ''}`
        : `${fmt(a.amount)} · ${fmtDue(a.days)} · ${fmtDate(a.date)}${a.time ? ' ' + a.time : ''}`;
  const tone = (a.kind === 'budget' ? a.level >= 100 : a.days < 0) ? 'over' : a.kind === 'recurring' ? '' : 'warn';
  return `<div class="notif-row ${tone}"><span class="n-ic">${NOTIF[a.kind].icon}</span>
    <span class="grow"><b>${esc(a.title)}</b><small>${esc(a.bookName)} · ${esc(sub)}</small></span>
    <button type="button" class="btn small n-btn" data-notif="${a.kind}" data-book="${esc(a.bookId)}" data-id="${esc(a.id)}">${NOTIF[a.kind].btn}</button></div>`;
}

async function fillNotifications(sh) {
  const key = 'n:' + S.currentUser().id;
  const n = sh.querySelector('[data-notif-n]'), list = sh.querySelector('[data-notif-list]');
  showCached(n, key + ':n'); showCached(list, key);
  const alerts = await S.userAlerts(S.currentUser().id);
  setCached(n, key + ':n', `(${alerts.length})`);
  setCached(list, key, alerts.length
    ? alerts.map(notifRow).join('') : '<p class="muted small center">Không có thông báo nào.</p>');
}

/** Mở đúng mục rồi thực hiện thao tác của thông báo. */
async function runNotif({ notif, book, id }) {
  if (notif === 'reminder') { S.doneReminder(S.currentUser().id, id); return toast('Đã Done'); }
  await switchTo(book);
  if (notif === 'debt') {
    const d = state.debts.find((x) => x.id === id);
    if (d) debtPay(d);
  } else if (notif === 'pending') actions['pending-open']({ dataset: { id } });
  else if (notif === 'recurring') actions['rec-open']({ dataset: { id } });
  else if (notif === 'cardpay') { const due = S.cardDue(); if (due?.items.length) cardPaySheet(due.items); }
  else actions['budget-goto']();
}

// --- Danh sách User (nút trái) + Notifications. Có nút ⚙️ Cài đặt chung ở góc phải tiêu đề. ---
actions.users = () => {
  const cur = S.currentUser();
  const users = S.getUsers();
  openSheet({
    title: 'User',
    headAction: '<button type="button" class="icon-btn head-gear" data-settings aria-label="Cài đặt chung">⚙️</button>',
    body: `<h4 class="grp-h">👤 User <small>(${users.length}/${S.MAX_USERS})</small></h4>
      <div class="tile-grid one-col">${users.map((u) => tileHtml({
        attr: 'switch', id: u.id, color: u.color, av: avatar(u, 'ptile-av'), name: u.name + (u.special ? ' ⭐' : ''), on: u.id === cur.id,
        sum: `<span class="psum" data-usum="${esc(u.id)}">…</span>`, del: users.length > 1,
      })).join('')}
      ${users.length < S.MAX_USERS ? '<button type="button" class="ptile-add block" data-add>＋ User</button>' : ''}</div>
      <h4 class="grp-h">🔔 Notifications của ${esc(cur.name)} <small data-notif-n></small></h4>
      <div class="notif-list" data-notif-list></div>
      <div class="quick-save"><button type="button" class="btn primary" data-quick-save>💾 Save</button><small class="muted" data-save-status>${esc(saveStatusText())}</small></div>`,
    onMount(sh, close) {
      sh.querySelector('[data-settings]').addEventListener('click', () => { close(); location.hash = '#/settings'; });
      sh.querySelector('[data-quick-save]').addEventListener('click', () => quickSave(sh));
      fillProfileSums(sh);
      fillNotifications(sh);
      sh.addEventListener('click', async (e) => {
        const sw = e.target.closest('[data-switch]'), ed = e.target.closest('[data-edit]');
        const del = e.target.closest('[data-del]'), add = e.target.closest('[data-add]'), nt = e.target.closest('[data-notif]');
        if (nt) { close(); await runNotif(nt.dataset); }
        else if (del) {
          const u = S.getUsers().find((x) => x.id === del.dataset.del);
          if (u && await confirmDeleteUser(u)) { refresh(); close(); actions.users(); }
        } else if (sw) { close(); await switchToUser(sw.dataset.switch); }
        else if (ed) { close(); userForm(S.getUsers().find((u) => u.id === ed.dataset.edit)); }
        else if (add) { close(); userForm(null); }
      });
    },
  });
};

// --- Danh sách mục của User hiện tại (nút phải): mỗi mục 1 dòng trải hết chiều ngang ---
actions.books = () => {
  const u = S.currentUser();
  const onHome = current.route === 'home';
  const cur = onHome ? null : S.currentProfile().id;
  const mine = S.userBooks(u.id);
  openSheet({
    title: `Mục của ${u.name}`,
    headAction: `<button type="button" class="icon-btn theme-btn" data-theme aria-label="Chuyển sáng/tối">${isDark() ? '☀️' : '🌙'}</button>`,
    body: `<div class="books-compact"><div class="ptile over-tile ${onHome ? 'on is-current' : ''}" style="--c:${esc(overColor(u))}">
        <div role="button" tabindex="0" class="over-main" data-over>
          <b><span class="over-ic" data-over-edit role="button" aria-label="Thiết lập">${esc(overIcon(u))}<i>✎</i></span> ${esc(overName(u))}</b>
          ${overTabs(u.id).map(([tab, label]) => `<span class="over-row"><span>${OVER_ICONS[tab]} ${label} <small>(${tabBooks(u.id, tab).length})</small></span><b data-over-sum="${tab}">…</b></span>`).join('')}
        </div>
      </div>` + overTabs(u.id).map(([tab, label]) => {
      const list = tabBooks(u.id, tab);
      const isMoney = tab === 'bank' || tab === 'od';
      const isCardTab = tab === 'credit' || tab === 'wallet';
      const max = isMoney ? S.moneyBookMax(u.id, tab === 'od') : S.BOOK_KINDS[isCardTab ? 'card' : tab].max;
      // Bank và Thấu chi của User đặc biệt tạo sẵn lúc thiết lập, không thêm tay.
      const room = list.length < max && !(u.special && isMoney) && tab !== 'wallet';
      // Nhóm trống mà hết chỗ tạo thêm thì không cần hiện.
      if (!list.length && !room) return '';
      const count = tab === 'wallet' ? `(${list.length})` : `(${list.length}/${max})`;
      const pfLine = u.special && tab === 'od'
        ? '<div class="pf-line"><span class="pf-p">Personal <b data-pf-val="personal">…</b></span><span class="pf-f">Family <b data-pf-val="family">…</b></span></div>' : '';
      return `<h4 class="grp-h"><span>${OVER_ICONS[tab]} ${label} <small>${count}</small></span></h4>
        <div class="tile-grid one-col">${list.map((b) => tileHtml({
          attr: 'switch', id: b.id, color: b.color, av: avatar(b, 'ptile-av'), name: b.name + (b.locked ? ' 🔒' : ''), on: b.id === cur,
          sum: `<span class="psum" data-psum="${esc(b.id)}">…</span>`, del: mine.length > 1 && !S.isSpecialBook(b), iconEdit: true,
        })).join('')}
        ${pfLine}
        ${room ? `<button type="button" class="ptile-add block" data-add="${tab}">＋ ${label}</button>` : ''}</div>`;
    }).join('') + reminderSection(u) + '</div>',
    onMount(sh, close) {
      fillProfileSums(sh);
      fillPfVals(sh);
      $(sh, '[data-theme]').addEventListener('click', (e) => {
        e.currentTarget.textContent = toggleTheme() ? '☀️' : '🌙';
      });
      sh.querySelectorAll('[data-over-sum]').forEach(async (el) => {
        const key = `o:${u.id}:${el.dataset.overSum}`;
        showCached(el, key);
        setCached(el, key, fmt(await tabTotal(u.id, el.dataset.overSum)));
      });
      sh.addEventListener('click', async (e) => {
        const sw = e.target.closest('[data-switch]'), ed = e.target.closest('[data-edit]');
        const del = e.target.closest('[data-del]'), add = e.target.closest('[data-add]'), rem = e.target.closest('[data-rem]');
        if (rem) { close(); reminderForm(S.remindersOf(u.id).find((x) => x.id === rem.dataset.rem) || null); }
        else if (e.target.closest('[data-over-edit]')) { close(); overNameForm(u); }
        else if (e.target.closest('[data-over]')) { close(); actions['book-close'](); }
        else if (del) {
          const b = S.getProfiles().find((x) => x.id === del.dataset.del);
          if (b && await confirmDeleteProfile(b)) { refresh(); close(); actions.books(); }
        } else if (ed) { close(); bookForm(S.getProfiles().find((b) => b.id === ed.dataset.edit)); }
        else if (sw) { close(); await openBook(sw.dataset.switch); }
        else if (add) {
          close();
          const v = add.dataset.add;
          if (v === 'od') bookForm(null, 'bank', true);
          else if (v === 'credit' || v === 'wallet') bookForm(null, 'card', false, v);
          else bookForm(null, v);
        }
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

/** Xóa User cùng mọi mục của User đó. */
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

/** Phần chọn ảnh / icon (có tìm kiếm) / màu dùng chung cho form User và mục. */
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

// ================= User đặc biệt: Personal / Family =================
/** Ô chọn Personal/Family trong form giao dịch; ẩn khi giao dịch không cần chọn. */
const pfField = () => `<div class="field pf-field" data-pf-wrap hidden><span>Ghi nhận vào</span><div class="seg pf-seg">
  <button type="button" data-pf="personal">Personal<small></small></button>
  <button type="button" data-pf="family">Family<small></small></button></div></div>`;
function bindPf(sh, value = null, needed = false) {
  const wrap = $(sh, '[data-pf-wrap]');
  let pf = value || 'personal', on = false;
  const paint = () => wrap.querySelectorAll('[data-pf]').forEach((b) => b.classList.toggle('on', b.dataset.pf === pf));
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pf]');
    if (b) { pf = b.dataset.pf; paint(); }
  });
  const setNeeded = async (v) => {
    on = v;
    wrap.hidden = !v;
    if (!v) return;
    const bal = await S.pfBalances();
    if (bal) wrap.querySelectorAll('[data-pf]').forEach((b) => { b.querySelector('small').textContent = fmt(bal[b.dataset.pf]); });
  };
  paint();
  setNeeded(needed);
  return {
    setNeeded,
    value: () => (on ? pf : null),
  };
}

/** Các ô nhập khi tạo User đặc biệt và khi Reset (cùng một quy trình). */
const specialFields = () => `
  ${amountField('sp-bank', 0, 'Số dư Ngân hàng hiện tại')}
  ${amountField('sp-limit', 0, 'Hạn mức Thấu chi')}
  ${amountField('sp-od', 0, 'Số dư Thấu chi hiện tại')}
  <label class="check"><input type="checkbox" id="sp-neg"> Số dư Thấu chi đang âm</label>
  <div class="kv"><span>Tổng Account + Thấu chi</span><b id="sp-total">0 ₫</b></div>
  ${amountField('sp-personal', 0, 'Phần Personal')}
  <div class="kv"><span>Phần Family (tự tính)</span><b id="sp-family">0 ₫</b></div>`;
function bindSpecialFields(sh) {
  const bank = bindMoney(sh, 'sp-bank'), limit = bindMoney(sh, 'sp-limit'), od = bindMoney(sh, 'sp-od'), personal = bindMoney(sh, 'sp-personal');
  const neg = $(sh, '#sp-neg');
  const num = (el) => Math.round(readMoney(el.value));
  const odVal = () => (neg.checked ? -Math.abs(num(od)) : num(od));
  const upd = () => {
    const total = (num(bank) || 0) + (odVal() || 0);
    $(sh, '#sp-total').textContent = fmt(total);
    $(sh, '#sp-family').textContent = fmt(total - (num(personal) || 0));
  };
  [bank, od, personal].forEach((el) => el.addEventListener('input', upd));
  neg.addEventListener('change', upd);
  return {
    /** Trả về số đã kiểm tra, hoặc null nếu còn sai. */
    read() {
      const b = num(bank), l = num(limit), o = odVal(), p = num(personal);
      if (!Number.isFinite(b) || b < 0) return toast('Nhập số dư Ngân hàng hiện tại'), null;
      if (!(l > 0)) return toast('Nhập hạn mức Thấu chi'), null;
      if (!Number.isFinite(o)) return toast('Nhập số dư Thấu chi hiện tại'), null;
      if (b + o < 0) return toast('Tổng Account + Thấu chi đang âm nên không chia được Personal / Family', 4000), null;
      if (!Number.isFinite(p) || p < 0) return toast('Nhập phần Personal'), null;
      if (p > b + o) return toast(`Personal không được lớn hơn tổng ${fmt(b + o)}`, 4000), null;
      const over = Math.abs(o) > l ? '\n⚠️ Số dư Thấu chi vượt hạn mức.' : '';
      if (!confirm(`Account: ${fmt(b)}\nThấu chi: ${fmt(o)} · hạn mức ${fmt(l)}\nPersonal: ${fmt(p)}\nFamily: ${fmt(b + o - p)}${over}\n\nSau này muốn đổi phải Reset. Đồng ý?`)) return null;
      return { bank: b, limit: l, overdraft: o, personal: p };
    },
  };
}

actions['pf-reset'] = () => {
  const u = S.specialUser();
  if (!u) return;
  const formId = 'sp-' + Date.now();
  openSheet({
    title: '🔄 Reset User đặc biệt',
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">Reset</button>`,
    body: `<form class="form" id="${formId}">
      <p class="muted small">Nhập lại toàn bộ thông số như lúc tạo <b>${esc(u.name)}</b>. Giao dịch cũ vẫn giữ trong lịch sử, số dư được đặt lại đúng theo số bạn nhập.</p>
      ${specialFields()}
    </form>`,
    onMount(sh, close) {
      const sp = bindSpecialFields(sh);
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const vals = sp.read();
        if (!vals) return;
        await S.setupSpecial(u.id, vals);
        close(); toast('Đã reset');
      });
    },
  });
};

actions['pf-convert'] = () => {
  const formId = 'pc-' + Date.now();
  let from = 'personal';
  openSheet({
    title: '⇄ Chuyển đổi Personal / Family',
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">Chuyển</button>`,
    body: `<form class="form" id="${formId}">
      <div class="kv"><span>Personal</span><b class="pf-p" data-pc="personal">…</b></div>
      <div class="kv"><span>Family</span><b class="pf-f" data-pc="family">…</b></div>
      <div class="seg" id="pc-dir"><button type="button" data-from="personal" class="on">Personal → Family</button><button type="button" data-from="family">Family → Personal</button></div>
      ${amountField('pc-amt', 0, 'Số tiền chuyển')}
      <p class="muted small">Chỉ đổi cách chia giữa 2 phần, số dư Account và Thấu chi không đổi.</p>
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'pc-amt');
      S.pfBalances().then((b) => sh.querySelectorAll('[data-pc]').forEach((el) => { el.textContent = fmt(b[el.dataset.pc]); }));
      $(sh, '#pc-dir').addEventListener('click', (e) => {
        const b = e.target.closest('[data-from]');
        if (!b) return;
        from = b.dataset.from;
        sh.querySelectorAll('#pc-dir [data-from]').forEach((x) => x.classList.toggle('on', x === b));
      });
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = Math.round(readMoney(amt.value));
        if (!(v > 0)) return toast('Nhập số tiền');
        try { await S.pfConvert(from, v); } catch (err) { return toast('⛔ ' + err.message, 4000); }
        close(); toast('Đã chuyển đổi');
      });
    },
  });
};

/** Phần Personal / Family trong Cài đặt của Bank và Thấu chi. */
const pfSettingsHtml = () => `${sectionTitle('⭐ Personal / Family')}
  <section class="card list">
    <div class="row"><span class="grow"><b class="pf-p">Personal</b></span><span class="amt pf-p" data-pf-val="personal">…</span></div>
    <div class="row"><span class="grow"><b class="pf-f">Family</b></span><span class="amt pf-f" data-pf-val="family">…</span></div>
    <button type="button" class="row" data-act="pf-convert"><span class="ci">⇄</span><span class="grow"><b>Chuyển đổi giữa 2 phần</b></span>›</button>
    <button type="button" class="row" data-act="pf-reset"><span class="ci">🔄</span><span class="grow"><b>Reset</b><small>Nhập lại số dư, hạn mức, Personal / Family</small></span>›</button>
  </section>`;

/** Thêm/sửa User. */
function userForm(u) {
  const users = S.getUsers();
  const f = u ? { ...u } : { name: '', icon: users.length === 1 ? '👩' : '🧑', color: S.PROFILE_COLORS[users.length % S.PROFILE_COLORS.length] };
  const formId = 'uf-' + Date.now();
  openSheet({
    title: `${u ? 'Sửa' : 'Thêm'} User`,
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">${u ? 'Lưu' : 'Tạo'}</button>`,
    body: `<form class="form" id="${formId}">
      ${field('Tên hiển thị', `<input id="pf-name" required maxlength="24" value="${esc(f.name)}" placeholder="vd: Dũng, Vợ">`)}
      ${looksFields(f, true)}
      ${u ? '' : '<p class="muted small">User mới có sẵn 1 mục 🏦 Ngân hàng.</p>'}
      ${!u && !S.specialUser() ? `<label class="check"><input type="checkbox" id="uf-special"> ⭐ User đặc biệt (có sẵn Account + Thấu chi, chia Personal / Family)</label>
        <div id="sp-box" hidden>${specialFields()}</div>` : ''}
      ${u?.special ? '<p class="muted small">⭐ User đặc biệt.</p><div class="actions"><button type="button" class="btn ghost" data-act="pf-reset">🔄 Reset số dư, hạn mức, Personal / Family</button></div>' : ''}
      ${u && users.length > 1 ? '<div class="actions"><button type="button" class="btn danger" data-del>Xóa User</button></div>' : ''}
    </form>`,
    onMount(sh, close) {
      bindLooks(sh, f);
      const spChk = $(sh, '#uf-special');
      const sp = spChk ? bindSpecialFields(sh) : null;
      spChk?.addEventListener('change', () => { $(sh, '#sp-box').hidden = !spChk.checked; });
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = $(sh, '#pf-name').value.trim();
        if (!name) return toast('Nhập tên');
        if (S.getUsers().some((x) => x.id !== f.id && x.name.toLowerCase() === name.toLowerCase())) return toast('Tên này đã có');
        const special = spChk?.checked ? sp.read() : null;
        if (spChk?.checked && !special) return;
        let saved;
        try { saved = S.saveUser({ ...f, name, ...(special ? { special: true } : {}) }); } catch (err) { return toast(err.message); }
        if (special) await S.setupSpecial(saved.id, special);
        close();
        if (u) { refresh(); toast('Đã lưu'); return; }
        await switchToUser(saved.id);
      });
      $(sh, '[data-del]')?.addEventListener('click', async () => {
        if (await confirmDeleteUser(u)) { close(); refresh(); }
      });
    },
  });
}

const CREDIT_HINT = 'Có Thu/Chi như một tài khoản, luôn hiện số âm là tiền đang nợ, hết nợ là 0. Nút Thanh toán trả một phần hoặc toàn bộ từ Account.';
const ODRAFT_HINT = 'Thu/Chi và Transfer như Account, số dư được âm và vẫn cộng vào tổng Ngân hàng. Tiền ra hoặc vào vượt hạn mức sẽ có cảnh báo.';

/** Thêm/sửa mục (Ngân hàng / Tiết kiệm / Thẻ trả trước) của User hiện tại. */
function bookForm(b, kind = 'bank', od = false, cardPreset = 'credit') {
  if (b) kind = b.kind || 'bank';
  const k = S.BOOK_KINDS[kind];
  const owner = b ? S.userOf(b) : S.currentUser();
  const f = b ? { ...b } : { name: '', kind, owner: owner.id, icon: od ? '💳' : kind === 'card' && cardPreset === 'wallet' ? '👛' : k.icon, color: owner.color, ...(kind === 'card' ? { cardType: cardPreset } : {}) };
  let isOd = !!f.overdraft || od;
  const formId = 'bf-' + Date.now();
  const hint = {
    bank: 'Sổ thu/chi có 1 tài khoản ngân hàng và số dư.',
    card: 'Ghi các khoản chi (MoMo, ZaloPay…), sau đó thanh toán từng khoản từ Ngân hàng.',
    saving: 'Chỉ Transfer với các mục Ngân hàng.',
  }[kind] || '';
  openSheet({
    title: `${b ? 'Sửa' : 'Thêm'} ${isOd ? 'Thấu chi' : kind === 'card' ? S.CARD_TYPES[f.cardType] || kindOf(f).label : 'mục ' + kindOf(f).label}`,
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">${b ? 'Lưu' : 'Tạo'}</button>`,
    body: `<form class="form" id="${formId}">
      ${kind === 'card' && b && !b.credit ? `<div class="field"><span>Loại thẻ</span><div class="seg" id="bf-card">${Object.entries(S.CARD_TYPES).map(([v, label]) =>
        `<button type="button" data-c="${v}" class="${v === (f.cardType || 'credit') ? 'on' : ''}">${label}</button>`).join('')}</div></div>` : ''}
      <p class="muted small">${k.icon} Mục của <b>${esc(owner.name)}</b>. <span id="bf-hint">${isOd ? ODRAFT_HINT : b?.credit || (kind === 'card' && !b && (f.cardType || 'credit') === 'credit') ? CREDIT_HINT : hint}</span></p>
      ${b?.credit ? amountField('bf-climit', b.limit || 0, 'Hạn mức âm tối đa có thể dùng') : ''}
      ${kind === 'card' && !b && f.cardType === 'credit' ? `<div id="bf-debt-box">${amountField('bf-climit', 0, 'Hạn mức âm tối đa có thể dùng')}${amountField('bf-debt', 0, 'Số dư đang nợ hiện tại')}<p class="muted small">⚠️ Sau khi tạo không sửa được số này, chỉ thay đổi qua Chi, Thu và Thanh toán.</p></div>` : ''}
      ${isOd && !b ? `<div id="bf-od">
        ${amountField('bf-limit', 0, 'Hạn mức thấu chi')}
        ${amountField('bf-init', 0, 'Số dư lúc đầu')}
        <label class="check"><input type="checkbox" id="bf-neg"> Số dư lúc đầu đang âm</label>
        <p class="muted small">⚠️ Sau khi tạo không sửa được số dư và hạn mức, chỉ có thể xóa mục rồi tạo lại.</p>
      </div>` : ''}
      ${b?.overdraft ? `<div class="kv"><span>Hạn mức</span><b>${fmt(b.limit)}</b></div>
        <div class="kv"><span>Số dư hiện tại</span><b data-od-bal>…</b></div>
        <p class="muted small">Không sửa được số dư và hạn mức. Muốn đổi: ${S.isSpecialBook(b) ? 'dùng Reset trong Cài đặt' : 'xóa mục này rồi tạo lại'}.</p>` : ''}
      ${field('Tên mục', `<input id="pf-name" required maxlength="24" value="${esc(f.name)}" placeholder="${{ card: 'vd: Thẻ MoMo, Đi chợ', saving: 'vd: Quỹ học phí, Tiết kiệm mua nhà' }[kind] || 'vd: Ngân hàng, Tiền nhà'}">`)}
      ${looksFields(f, false)}
      ${b && S.userBooks(owner.id).length > 1 && !S.isSpecialBook(b) ? '<div class="actions"><button type="button" class="btn danger" data-del>Xóa mục</button></div>' : ''}
    </form>`,
    onMount(sh, close) {
      bindLooks(sh, f);
      setTimeout(() => { if (!b) $(sh, '#pf-name').focus(); }, 250);
      let cardType = f.cardType || 'credit';
      const debtIn = kind === 'card' && !b && f.cardType === 'credit' ? bindMoney(sh, 'bf-debt') : null;
      const climIn = b?.credit || debtIn ? bindMoney(sh, 'bf-climit') : null;
      $(sh, '#bf-card')?.addEventListener('click', (e) => {
        const t = e.target.closest('[data-c]');
        if (!t) return;
        cardType = t.dataset.c;
        sh.querySelectorAll('#bf-card [data-c]').forEach((x) => x.classList.toggle('on', x === t));
      });
      const limitIn = isOd && !b ? bindMoney(sh, 'bf-limit') : null;
      const initIn = isOd && !b ? bindMoney(sh, 'bf-init') : null;
      if (b?.overdraft) S.peerAccounts(b.id).then(async (accs) => { $(sh, '[data-od-bal]').textContent = fmt(await S.peerBalance(b.id, accs[0].id)); });
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = $(sh, '#pf-name').value.trim();
        if (!name) return toast('Nhập tên mục');
        if (S.userBooks(owner.id).some((x) => x.id !== f.id && x.name.toLowerCase() === name.toLowerCase())) return toast('Tên mục này đã có');
        const data = { ...f, name };
        if (kind === 'card') data.cardType = cardType;
        let initial = 0;
        if (kind === 'card' && !b && cardType === 'credit') {
          data.credit = true;
          const debt = debtIn.value.trim() ? Math.round(readMoney(debtIn.value)) : 0;
          if (!Number.isFinite(debt) || debt < 0) return toast('Số nợ chưa đúng');
          const lim = Math.round(readMoney(climIn.value));
          if (!(lim > 0)) return toast('Nhập hạn mức âm tối đa');
          if (debt > lim) return toast(`Số nợ không được lớn hơn hạn mức ${fmt(lim)}`, 3500);
          data.limit = lim;
          initial = -debt;
        }
        if (b?.credit) {
          const lim = climIn.value.trim() ? Math.round(readMoney(climIn.value)) : 0;
          if (!Number.isFinite(lim) || lim < 0) return toast('Hạn mức chưa đúng');
          data.limit = lim;
        }
        if (isOd && !b) {
          data.overdraft = true;
          data.limit = Math.round(readMoney(limitIn.value));
          if (!(data.limit > 0)) return toast('Nhập hạn mức thấu chi');
          const raw = initIn.value.trim() ? readMoney(initIn.value) : 0;
          if (!Number.isFinite(raw)) return toast('Số dư lúc đầu chưa đúng');
          initial = Math.round($(sh, '#bf-neg').checked ? -Math.abs(raw) : raw);
          const over = Math.abs(initial) > data.limit ? '\n⚠️ Số dư lúc đầu vượt hạn mức.' : '';
          if (!confirm(`Tạo Thấu chi "${name}"?\nHạn mức: ${fmt(data.limit)}\nSố dư lúc đầu: ${fmt(initial)}${over}\n\nSau khi tạo không sửa được 2 số này.`)) return;
        }
        let saved;
        try { saved = S.saveProfile(data); } catch (err) { return toast(err.message); }
        if (initial) await S.setPeerBalance(saved.id, initial);
        close();
        if (b) { refresh(); toast('Đã lưu'); return; }
        await openBook(saved.id);
      });
      $(sh, '[data-del]')?.addEventListener('click', async () => {
        if (await confirmDeleteProfile(b)) { close(); refresh(); }
      });
    },
  });
}

// ================= Thống kê của mục Ngân hàng: thiết lập nguồn =================
const moneyBookList = () => S.getProfiles().filter((p) => ['bank', 'saving', 'neo'].includes(p.kind || 'bank'));

/** Thống kê Transfer/Get In: các luồng "từ mục → đến mục" + danh mục cần lấy. */
function statFlowForm(item = null) {
  const books = moneyBookList();
  if (books.length < 2) return toast('Cần ít nhất 2 mục có tài khoản để tạo luồng Transfer/Get In');
  const src = item || {};
  const has = (id) => books.some((b) => b.id === id);
  let rules = (src.rules || []).filter((r) => has(r.from) && has(r.to)).map((r) => ({ ...r }));
  if (!rules.length) rules = [{ from: books[0].id, to: books[1].id, as: 'expense' }];
  const picked = new Set(src.flowCats || []);
  const opts = (sel) => books.map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.icon + ' ' + S.bookLabel(p))}</option>`).join('');
  const formId = 'is-' + Date.now();
  openSheet({
    title: '🔁 Thống kê Transfer/Get In',
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">Lưu</button>`,
    body: `<form class="form" id="${formId}">
      ${field('Tên hiển thị ở Tổng quan', `<input id="st-name" maxlength="30" value="${esc(src.name || '')}" placeholder="vd: Đầu tư chứng khoán">`)}
      ${statIconField(src.icon || STATS.flow.icon)}
      <p class="muted small">Chỉ lấy các khoản <b>Transfer / Get In</b> chuyển tiền <b>từ mục → đến mục</b> bạn chỉ định (Transfer từ A cho B, hoặc B Get In từ A đều tính là A → B). Xóa giao dịch thì ở đây cũng mất theo.</p>
      <div class="field"><span>🔁 Luồng tiền lấy vào</span><div id="is-rules"></div>
        <button type="button" class="btn ghost small" data-add-rule>＋ Thêm luồng</button></div>
      <div class="field"><span>🏷️ Danh mục Transfer/Get In lấy vào <small class="muted">(không chọn = lấy tất cả)</small></span>
        <div class="check-list" id="is-cats"></div>
        <button type="button" class="btn ghost small" data-add-cat>＋ Thêm danh mục</button></div>
      ${statDelBtn(item)}
    </form>`,
    onMount(sh, close) {
      bindStatDel(sh, item, close);
      const getIcon = bindStatIcon(sh, src.icon || STATS.flow.icon);
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
      $(sh, '[data-add-cat]').addEventListener('click', () => flowCatSheet((c) => {
        if (c) { picked.add(c.id); renderCats(); }
      }));
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (rules.some((r) => r.from === r.to)) return toast('Mục nguồn và mục đích phải khác nhau');
        await saveStat(item, { type: 'flow', name: $(sh, '#st-name').value.trim(), icon: getIcon(), rules, flowCats: [...picked] });
        close();
        toast('Đã lưu thiết lập thống kê');
      });
    },
  });
}

/** Thống kê Thu/Chi: chọn các mục (Ngân hàng / Tiết kiệm) + danh mục thu, chi cần lấy (theo tên danh mục). */
function statTrackForm(item = null) {
  const books = S.getProfiles().filter((p) => ['bank', 'saving'].includes(p.kind || 'bank'));
  const src = item || {};
  const pickedBooks = new Set(src.books && src.books.length ? src.books : [S.currentProfile().id]);
  const inc = new Set(src.income || []), exp = new Set(src.expense || []);
  const formId = 'ts-' + Date.now();
  openSheet({
    title: '📊 Thống kê Thu/Chi',
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">Lưu</button>`,
    body: `<form class="form" id="${formId}">
      ${field('Tên hiển thị ở Tổng quan', `<input id="st-name" maxlength="30" value="${esc(src.name || '')}" placeholder="vd: Chi tiêu gia đình">`)}
      ${statIconField(src.icon || STATS.track.icon)}
      <p class="muted small">Lấy các khoản <b>Thu / Chi</b> trong các mục bạn chọn, thuộc các danh mục bạn tích. Xóa giao dịch thì ở đây cũng mất theo.</p>
      <div class="field"><span>📒 Lấy từ các mục</span><div class="check-list one" id="ts-books">${books.map((b) =>
        `<label class="check"><input type="checkbox" value="${esc(b.id)}" ${pickedBooks.has(b.id) ? 'checked' : ''}> ${esc(b.icon + ' ' + S.bookLabel(b))}</label>`).join('')}</div></div>
      <div id="ts-cats"><p class="muted small">Đang tải danh mục…</p></div>
      ${statDelBtn(item)}
    </form>`,
    onMount(sh, close) {
      bindStatDel(sh, item, close);
      const getIcon = bindStatIcon(sh, src.icon || STATS.track.icon);
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
        await saveStat(item, { type: 'track', name: $(sh, '#st-name').value.trim(), icon: getIcon(), books: [...pickedBooks], income: [...inc], expense: [...exp] });
        close();
        toast('Đã lưu thiết lập thống kê');
      });
    },
  });
}

function sectionTitle(text, actionHtml = '') {
  return `<div class="sec-h"><h2>${text}</h2>${actionHtml}</div>`;
}

// ================= Thẻ trả trước =================
/** Tên hiển thị của khoản chi thẻ: nội dung, không có thì lấy danh mục. */
const cardLabel = (t) => t.note || S.catById(t.categoryId)?.name || 'Khoản chi';
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
   ${topBar(`💳 ${S.CARD_TYPES[S.currentProfile().cardType] || S.BOOK_KINDS.card.label}`)}
  <section class="card hero">
    <div class="hero-net"><small>Đã chi, chưa thanh toán (tất cả) · ${openAll.length} khoản</small><strong class="expense">${fmt(sumAmt(openAll))}</strong></div>
    ${openAll.length > 1 ? `<button type="button" class="btn primary block" data-act="card-pay-all">💸 Thanh toán tất cả (${fmt(sumAmt(openAll))})</button>` : ''}
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

// ================= Thống kê Transfer/Get In và Thu/Chi ở Tổng quan =================
const STATS = {
  flow: { icon: '🔁', label: 'Transfer/Get In', load: S.loadFlowStats, form: (item) => statFlowForm(item) },
  track: { icon: '📊', label: 'Thu/Chi', load: S.loadTrackStats, form: (item) => statTrackForm(item) },
};
const statName = (st) => st.name || STATS[st.type].label;
const statIcon = (st) => st.icon || STATS[st.type].icon;
/** Ô chọn biểu tượng trong form thiết lập thống kê. */
const statIconField = (icon) => `<div class="field"><span>Biểu tượng <b id="st-icon-now">${esc(icon)}</b></span>${iconPickerHtml('st-icons', icon)}</div>`;
function bindStatIcon(sh, start) {
  let icon = start;
  bindIconPicker($(sh, '#st-icons'), (v) => { icon = v; $(sh, '#st-icon-now').textContent = v; }, () => icon);
  return () => icon;
}
const statDelBtn = (item) => (item ? '<div class="actions"><button type="button" class="btn danger" data-stat-del>Xóa thống kê</button></div>' : '');
function bindStatDel(sh, item, close) {
  $(sh, '[data-stat-del]')?.addEventListener('click', async () => {
    await S.setSetting('stats', S.statsOf().filter((x) => x.id !== item.id));
    close(); toast('Đã xóa thống kê');
  });
}
async function saveStat(item, data) {
  const list = S.statsOf();
  const row = { ...data, id: item?.id || 'st' + Date.now(), show: item?.show !== false };
  await S.setSetting('stats', item ? list.map((x) => (x.id === item.id ? row : x)) : [...list, row]);
}
const statSum = (list, type) => list.filter((t) => t.type === type).reduce((s, t) => s + t.amountVnd, 0);
const overRange = () => getRange(ui.overPeriod || 'day', todayISO());

function statRow(t) {
  const sign = t.type === 'income' ? 1 : -1;
  if (!t.gop) {
    return `<div class="row tx mirror-row"><span class="ci" style="--c:${esc(t.catColor)}">${esc(t.catIcon)}</span>
      <span class="grow"><b>${esc(t.note || t.catName)}</b><small>${esc([t.note ? t.catName : '', t.flowLabel].filter(Boolean).join(' · '))}</small><small class="when">${esc(txWhen(t))}</small></span>
      <span class="amt ${t.type}">${fmtSigned(sign * t.amountVnd)}</span></div>`;
  }
  const isW = t.gop.mode === 'trich';
  return `<div class="row tx mirror-row"><span class="ci" style="--c:${isW ? '#8e4ec6' : '#12a594'}">${isW ? '🔄' : '🔁'}</span>
    <span class="grow"><b>${esc(t.flowLabel)}</b><small>${esc([isW ? 'Get In' : 'Transfer', t.flowCatName, t.note].filter(Boolean).join(' · '))}</small><small class="when">${esc(txWhen(t))}</small></span>
    <span class="amt ${t.type}">${fmtSigned(sign * t.amountVnd)}</span></div>`;
}

/** Bấm dòng thống kê ở Tổng quan: xem chi tiết theo kỳ đang chọn. */
actions['stat-open'] = async (el) => {
  const { id, book } = el.dataset;
  await inBook(book);
  const st = S.statsOf().find((x) => x.id === id);
  if (!st) return;
  const m = await STATS[st.type].load(st);
  if (!m.configured) return STATS[st.type].form(st);
  const r = overRange();
  const list = sortTx(m.txs.filter((t) => t.date >= r.start && t.date <= r.end));
  const inc = statSum(list, 'income'), exp = statSum(list, 'expense');
  openSheet({
    title: `${statIcon(st)} ${statName(st)} · ${r.label}`,
    body: `<section class="card stats two-col"><div><small>Thu</small><b class="income">${fmt(inc)}</b></div><div><small>Chi</small><b class="expense">${fmt(exp)}</b></div></section>
      <p class="center"><small class="muted">Chênh lệch</small> <b class="${inc - exp >= 0 ? 'income' : 'expense'}">${fmtSigned(inc - exp)}</b></p>
      ${list.length ? `<div class="card list">${list.map(statRow).join('')}</div>` : empty('📭', 'Không có giao dịch phù hợp trong kỳ.')}`,
  });
};
actions['stat-setup'] = (el) => {
  const st = S.statsOf().find((x) => x.id === el.dataset.id);
  if (st) STATS[st.type].form(st);
};
actions['stat-new'] = () => {
  if (S.statsOf().length >= S.STAT_MAX) return toast(`Tối đa ${S.STAT_MAX} thống kê`);
  openSheet({
    title: 'Tạo thống kê',
    body: `<div class="card list">${Object.entries(STATS).map(([k, st]) => `<button type="button" class="row" data-new="${k}"><span class="ci">${st.icon}</span><span class="grow"><b>${st.label}</b></span>›</button>`).join('')}</div>`,
    onMount(sh, close) {
      sh.addEventListener('click', (e) => {
        const b = e.target.closest('[data-new]');
        if (b) { close(); STATS[b.dataset.new].form(null); }
      });
    },
  });
};

/** Phần Thống kê trong Cài đặt riêng của mục: công tắc ẩn/hiện, danh sách, nút tạo. */
function statSettingsHtml() {
  const list = S.statsOf();
  const open = state.settings.statListOpen !== false;
  return `${sectionTitle(`📊 Thống kê <small class="muted">(${list.length}/${S.STAT_MAX})</small>`, `<label class="switch" title="Mở/thu gọn danh sách"><input type="checkbox" data-list-toggle="statListOpen" ${open ? 'checked' : ''}><i></i></label>`)}
  ${open ? `<section class="card list">${list.map((st) => `<div class="row quick-row">
      <button type="button" class="grow-btn" data-act="stat-setup" data-id="${esc(st.id)}"><span class="ci">${esc(statIcon(st))}</span>
        <span class="grow"><b>${esc(statName(st))}</b><small>${STATS[st.type].label}</small></span><span>✎</span></button>
      <label class="switch" title="Hiện ở Tổng quan"><input type="checkbox" data-stat-show="${esc(st.id)}" ${st.show !== false ? 'checked' : ''}><i></i></label></div>`).join('')}
    ${list.length < S.STAT_MAX ? '<button type="button" class="row add-row" data-act="stat-new"><span class="ci">＋</span><span class="grow"><b>Tạo thống kê</b></span></button>' : ''}
  </section>` : ''}`;
}

function cardRow(t) {
  const cat = S.catById(t.categoryId);
  return `<div class="row card-item ${isDone(t) ? 'done' : ''}">
    <button type="button" class="grow-btn" data-act="card-open" data-id="${t.id}">
      ${catIcon(cat)}
      <span class="grow"><b>${esc(cardLabel(t))}</b><small>${esc((cat || UNKNOWN_CAT).name)}${t.createdAt ? ' · ' + fmtTimeVN(t.createdAt) : ''}${isDone(t) && t.paid ? ` · <span class="income">✅ ${esc(t.paid.profileName)}</span>` : ''}</small></span>
      <span class="amt">${fmt(t.amountVnd)}<small class="badge ${isDone(t) ? 'done' : 'open'}">${isDone(t) ? 'Done' : 'Chưa TT'}</small></span>
    </button>
    ${isDone(t) ? '' : `<button type="button" class="btn primary small pay-btn" data-act="card-pay" data-id="${t.id}" aria-label="Thanh toán" title="Thanh toán">💸</button>`}
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
      <div class="big-ic">${esc((cat || UNKNOWN_CAT).icon)}</div>
      <div class="kv"><span>Nội dung</span><b>${esc(t.note || '—')}</b></div>
      <div class="kv"><span>Số tiền</span><b class="expense">${fmt(t.amountVnd)}</b></div>

      <div class="kv"><span>Danh mục</span><b>${esc(cat?.name || '—')}</b></div>
      <div class="kv"><span>Ngày chi</span><b>${fmtDate(t.date)}</b></div>
      ${t.createdAt ? `<div class="kv"><span>Ghi nhận lúc</span><b>${fmtDateTimeVN(t.createdAt)}</b></div>` : ''}
      <div class="kv"><span>Trạng thái</span><b class="${isDone(t) ? 'income' : 'expense'}">${isDone(t) ? '✅ Done' : 'Chưa thanh toán'}</b></div>
      ${isDone(t) && t.paid ? `<div class="kv"><span>Thanh toán bởi</span><b>${esc(t.paid.profileName)} · ${esc(t.paid.accountName)}</b></div>
        <div class="kv"><span>Ngày thanh toán</span><b>${fmtDate(t.paid.date)}</b></div>` : ''}
      <div class="actions">${isDone(t)
        ? '<button type="button" class="btn ghost" data-unpay>↶ Hủy thanh toán</button>'
        : '<button type="button" class="btn primary" data-pay>💸 Thanh toán</button><button type="button" class="btn ghost" data-edit>Sửa</button>'}
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

function cardItemForm(item, pick = null) {
  const f = item ? { ...item } : { amountVnd: 0, categoryId: state.settings.lastCat?.expense, date: todayISO(), note: '' };
  const cats = S.catsOf('expense').filter((c) => !/^(gop|trich)/.test(c.sys || ''));
  if (!cats.some((c) => c.id === f.categoryId)) f.categoryId = cats[0]?.id;
  const ciFormId = 'cif-' + Date.now();
  openSheet({
    title: item ? 'Sửa khoản chi' : 'Thêm khoản chi của thẻ',
    headAction: `<button type="submit" form="${ciFormId}" class="btn primary small head-save">Lưu</button>`,
    body: `<form class="form" id="${ciFormId}">
      ${bookPick(pick)}
      ${amountLine({ dateId: 'ci-date', date: f.date, amtId: 'ci-amt', amount: f.amountVnd ? fmtNum(f.amountVnd) : '', editDate: !!item })}
      <div class="amt-tools">
        <select id="ci-cat" class="cat-select" aria-label="Danh mục">${cats.map((c) => `<option value="${c.id}" ${c.id === f.categoryId ? 'selected' : ''}>${esc(c.icon + '  ' + c.name)}</option>`).join('')}</select>
      </div>

      ${field('Nội dung', `<input id="ci-note" value="${esc(f.note)}" placeholder="vd: Đổ xăng, đi chợ, nạp điện thoại">`)}
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'ci-amt');
      bindBookPick(sh, close, 'ci-amt', () => openAddForm(pick));
      if (!item) setTimeout(() => amt.focus(), 250);
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = Math.round(readMoney(amt.value));
        if (!(v > 0)) return toast('Nhập số tiền');
        const locked = S.lockError(S.currentProfile().id);
        if (locked) return toast(locked, 4500);
        const categoryId = $(sh, '#ci-cat').value;
        await S.put('transactions', {
          ...f, type: 'expense', amount: v, currency: 'VND', rate: 1, amountVnd: v, categoryId,
          note: $(sh, '#ci-note').value.trim(), date: $(sh, '#ci-date').value || todayISO(),
          accountId: null, tags: f.tags || [], splits: null, photoIds: f.photoIds || [], status: f.status || 'open',
          createdAt: f.createdAt || Date.now(),
        });

        await S.setSetting('lastCat', { ...state.settings.lastCat, expense: categoryId }, { silent: true });
        close(); toast(`Đã ghi khoản chi ${fmt(v)}`);
      });
    },
  });
}

/** Thanh toán 1 hoặc nhiều khoản chi của thẻ từ tài khoản của một người dùng. */
function cardPaySheet(items) {
  const users = sortByUser(S.moneyBooks().filter((p) => S.canTransfer(S.currentProfile(), p)));
  const total = sumAmt(items);
  openSheet({
    title: items.length > 1 ? `Thanh toán ${items.length} khoản` : 'Thanh toán',
    body: `<form class="form">
      <div class="note-box">${items.length > 1 ? `${items.length} khoản chưa thanh toán` : esc(cardLabel(items[0]))}<br><b class="expense big-amt">${fmt(total)}</b></div>
      <div class="field"><span>Người trả</span>${userChips('cp-who', users, (p) => `<button type="button" class="chip ${p.id === users[0].id ? 'on' : ''}" data-who="${esc(p.id)}">${esc(p.icon)} ${esc(p.name)}${p.locked ? ' 🔒' : ''}</button>`)}</div>
      ${field('Từ tài khoản', `<select id="cp-acc" data-acc><option></option></select>`)}
      <em class="hint" id="cp-bal"></em>
      ${pfField()}
      ${datePick('cp-date', todayISO(), 'Ngày thanh toán', 'disabled')}
      <p class="muted small">Sổ của người trả sẽ ghi ${items.length > 1 ? 'các' : 'một'} khoản chi tương ứng; khoản của thẻ chuyển sang ✅ Done.</p>
      <div class="actions"><button class="btn primary">💸 Thanh toán ${fmt(total)}</button></div>
    </form>`,
    onMount(sh, close) {
      let whoId = users[0].id;
      const pfc = bindPf(sh, null, S.pfNeeded(whoId));
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
        pfc.setNeeded(S.pfNeeded(whoId));
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
        const pf = pfc.value();
        const pfErr = pf ? await S.pfCheck({ pf, delta: -total }) : null;
        if (pfErr) return toast('⛔ ' + pfErr, 4500);
        try {
          for (const it of items) await S.payCardItem(it, { profileId: whoId, accountId, date, pf });
        } catch (err) { return toast('⛔ ' + err.message, 4500); }
        close();
        toast(`✅ Đã thanh toán ${fmt(total)} từ ${S.bookLabel(who)}`);
      });
    },
  });
}

// ================= Tổng quan =================
/** Nút thanh toán trên thẻ ở Tổng quan. */
actions['over-pay'] = async (el) => {
  const id = el.dataset.id;
  await inBook(id);
  if (S.currentProfile().credit) return creditPaySheet();
  const open = state.transactions.filter((t) => !isDone(t));
  if (!open.length) return toast('Không có khoản nào cần thanh toán');
  cardPaySheet(open);
};
actions['credit-pay'] = () => creditPaySheet();

/** Thanh toán Thẻ tín dụng: một phần hoặc toàn bộ số đang nợ. */
function creditPaySheet() {
  const card = S.currentProfile();
  const debt = -S.accountBalance(S.activeAccounts()[0]);
  if (debt <= 0) return toast('Thẻ không còn nợ');
  const users = sortByUser(S.moneyBooks().filter((p) => S.canTransfer(card, p)));
  if (!users.length) return toast('Chưa có mục Account để thanh toán');
  const formId = 'cr-' + Date.now();
  openSheet({
    title: 'Thanh toán thẻ',
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">💸 Trả</button>`,
    body: `<form class="form" id="${formId}">
      <div class="note-box">${esc(S.bookLabel(card))} · đang nợ<br><b class="expense big-amt">${fmt(debt)}</b></div>
      <div class="field"><span>Trả từ</span>${userChips('cr-who', users, (p) => `<button type="button" class="chip ${p.id === users[0].id ? 'on' : ''}" data-who="${esc(p.id)}">${esc(p.icon)} ${esc(p.name)}${p.locked ? ' 🔒' : ''}</button>`)}</div>
      ${field('Từ tài khoản', '<select id="cr-acc" data-acc><option></option></select>')}
      <em class="hint" id="cr-bal"></em>
      ${amountLine({ dateId: 'cr-date', date: todayISO(), amtId: 'cr-amt', amount: fmtNum(debt), label: 'Ngày', after: pfField() })}
      <button type="button" class="btn ghost small" data-full>Trả toàn bộ ${fmt(debt)}</button>
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'cr-amt');
      let whoId = users[0].id;
      const pfc = bindPf(sh, null, S.pfNeeded(whoId));
      const balances = new Map();
      const updBal = () => {
        const have = balances.get($(sh, '#cr-acc').value);
        if (have != null) balHint($(sh, '#cr-bal'), { have, need: Math.round(readMoney(amt.value) || 0), bookId: whoId, who: ' của ' + S.bookLabel(users.find((x) => x.id === whoId)) });
      };
      const load = async () => {
        const accs = await S.peerAccounts(whoId);
        balances.clear();
        for (const a of accs) balances.set(a.id, await S.peerBalance(whoId, a.id));
        $(sh, '#cr-acc').innerHTML = accs.map((a) => `<option value="${a.id}">${esc(a.icon + ' ' + a.name)} — ${fmt(balances.get(a.id))}</option>`).join('');
        updBal();
      };
      $(sh, '#cr-who').addEventListener('click', (e) => {
        const b = e.target.closest('[data-who]');
        if (!b) return;
        whoId = b.dataset.who;
        sh.querySelectorAll('[data-who]').forEach((x) => x.classList.toggle('on', x === b));
        pfc.setNeeded(S.pfNeeded(whoId));
        load();
      });
      $(sh, '#cr-acc').addEventListener('change', updBal);
      amt.addEventListener('input', updBal);
      $(sh, '[data-full]').addEventListener('click', () => { amt.value = fmtNum(debt); amt.dispatchEvent(new Event('input', { bubbles: true })); });
      load();
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = Math.round(readMoney(amt.value));
        if (!(v > 0)) return toast('Nhập số tiền thanh toán');
        if (v > debt) return toast(`Chỉ đang nợ ${fmt(debt)}`, 3500);
        try {
          await S.payCredit({ payerId: whoId, amount: v, fromAccountId: $(sh, '#cr-acc').value, date: $(sh, '#cr-date').value || todayISO(), pf: pfc.value() });
        } catch (err) { return toast('⛔ ' + err.message, 4500); }
        close();
        toast(`✅ Đã thanh toán ${fmt(v)}${v < debt ? `, còn nợ ${fmt(debt - v)}` : ', đã hết nợ'}`);
      });
    },
  });
}

const overName = (u) => u.overName || 'Tổng quan';
const overIcon = (u) => u.overIcon || '📊';
const overColor = (u) => u.overColor || u.color;
const OVER_TABS = [['bank', 'Account'], ['od', 'Thấu chi'], ['saving', 'Tiết Kiệm'], ['credit', 'Thẻ tín dụng'], ['wallet', 'Ví điện tử']];
const OVER_ICONS = { bank: '🏦', od: '🏧', saving: '🐷', credit: '💳', wallet: '👛' };
/** Ví điện tử đã bỏ: thẻ này chỉ còn hiện cho User đang có ví từ trước, để thanh toán và xóa dần. */
const overTabs = (userId) => OVER_TABS.filter(([tab]) => tab !== 'wallet' || tabBooks(userId, 'wallet').length);
const overKindNow = () => (overTabs(S.currentUser().id).some(([tab]) => tab === ui.overKind) ? ui.overKind : 'bank');
/** Các mục của một thẻ ở Tổng quan: Bank và Thấu chi tách riêng. */
const tabBooks = (userId, tab) => S.userBooks(userId).filter((b) => {
  if (tab === 'bank') return S.kindOfBook(b) === 'bank' && !b.overdraft;
  if (tab === 'od') return !!b.overdraft;
  if (tab === 'credit') return b.kind === 'card' && (b.credit || b.cardType === 'credit');
  if (tab === 'wallet') return b.kind === 'card' && !(b.credit || b.cardType === 'credit');
  return S.kindOfBook(b) === tab;
});
async function tabTotal(userId, tab) {
  let total = 0;
  for (const b of tabBooks(userId, tab)) {
    const s = await S.profileSummary(b);
    total += s.kind === 'card' ? s.unpaid : s.balance;
  }
  return total;
}
const overCache = new Map();
let overToken = 0;
let overExpiry = Infinity;

function overNameForm(u) {
  const f = { icon: overIcon(u), color: overColor(u) };
  const formId = 'ov-' + Date.now();
  openSheet({
    title: 'Thiết lập thẻ Tổng quan',
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">Lưu</button>`,
    body: `<form class="form" id="${formId}">${field('Tên hiển thị', `<input id="ov-name" maxlength="24" value="${esc(u.overName || '')}" placeholder="Tổng quan">`)}${looksFields(f, false)}</form>`,
    onMount(sh, close) {
      bindLooks(sh, f);
      $(sh, 'form').addEventListener('submit', (e) => {
        e.preventDefault();
        S.saveUser({ id: u.id, overName: $(sh, '#ov-name').value.trim(), overIcon: f.icon, overColor: f.color });
        close(); refresh(); toast('Đã lưu');
      });
    },
  });
}

function homeView() {
  const u = S.currentUser();
  const kind = overKindNow();
  return `<header class="top topbar">
    <div class="chip-col">
      <button type="button" class="profile-chip" data-act="users" style="--c:${esc(u.color)}" title="User">
        ${avatar(u, 'chip-av')}<span class="chip-name">${esc(u.name)}</span>${u.special ? '<span class="chip-star" title="User đặc biệt">⭐</span>' : ''} <i>▾</i></button>
      <button type="button" class="chip-sub notif-count" data-act="users" data-notif-count hidden></button>
    </div>
    <div class="chip-col right">
      <button type="button" class="profile-chip book-chip" data-act="books" style="--c:${esc(overColor(u))}" title="Chọn / tạo mục">
        <span class="chip-av">${esc(overIcon(u))}</span><span class="chip-name">${esc(overName(u))}</span> <i>▾</i></button>
    </div>
  </header>
  <div class="over-lines">
    <div><button type="button" class="over-ticker" data-act="users" data-over-ticker hidden></button><small class="chip-sub over-r" data-kind-total></small></div>
    <div><small class="chip-sub over-saving" data-over-saving></small><small class="chip-sub over-r pf-p" data-pf-top="personal" hidden></small></div>
    <div><small class="chip-sub over-debt" data-over-debt hidden></small><small class="chip-sub over-r pf-f" data-pf-top="family" hidden></small></div>
    <div style="display:none"><small class="chip-sub over-card" data-over-card></small></div>
  </div>
  <div class="title-row over-title"><div><h1>${esc(overName(u))}</h1></div></div>
  <div class="over-date"><small>📅 ${fmtDayHeader(todayISO())}</small>
    <select id="over-period" class="chip-select" aria-label="Kỳ xem số liệu">${[['day', 'Ngày'], ['week', 'Tuần'], ['month', 'Tháng']].map(([k, l]) => `<option value="${k}" ${(ui.overPeriod || 'day') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
  <div class="seg tabs">${overTabs(u.id).map(([k, label]) => `<button type="button" data-act="over-tab" data-v="${k}" class="${kind === k ? 'on' : ''}">${label}</button>`).join('')}</div>
  <div data-over-list>${overCache.get(`${u.id}:${kind}:${ui.overPeriod || 'day'}`) ?? ['day', 'week', 'month'].map((p) => overCache.get(`${u.id}:${kind}:${p}`)).find(Boolean) ?? ''}</div>
  ${fab(kind)}`;
}
actions['over-tab'] = (el) => { ui.overKind = el.dataset.v; window.scrollTo(0, 0); refresh(); };

/** Nút nhanh: chia đều, mỗi dòng tối đa 3 nút, tối đa 2 dòng. */
function quickRows(list, bookId) {
  if (!list.length) return '';
  const first = list.length > 3 ? Math.ceil(list.length / 2) : list.length;
  const btn = (q) => `<button type="button" class="btn quick-btn qk-btn q-${q.type}" data-act="quick-run" data-id="${esc(q.id)}" data-book="${esc(bookId)}" title="${esc(q.name)}"><span>${QUICK_KINDS[q.type].icon}</span><span class="qk-name">${esc(q.name)}</span></button>`;
  const row = (arr) => (arr.length ? `<div class="qk-row">${arr.map(btn).join('')}</div>` : '');
  const types = [...new Set(list.map((q) => q.type))];
  return `<div class="qk-legend">${types.map((t) => `<span>${QUICK_KINDS[t].icon} ${QUICK_KINDS[t].label}</span>`).join('')}</div>
    ${row(list.slice(0, first))}${row(list.slice(first))}`;
}

/** Còn được Recall không: mới ghi trong 10 phút, chưa thanh toán (thẻ), không phải khoản trả nợ (có Hoàn tác riêng). */
const canRecall = (t) => Date.now() - (t.createdAt || 0) < S.RECALL_MS && t.status !== 'done' && !t.debtId;
const txTypeKey = (t) => (t.gop ? (t.gop.mode === 'trich' ? 'trich' : 'gop') : t.type === 'income' ? 'income' : 'expense');
const txRowName = (t) => t.quick?.name || t.note || t.catName || (t.gop ? gopLabel(t.gop) : 'Giao dịch');
/** 5 giao dịch gần nhất: khoản mới trong 10 phút có nút Recall; có nút ẩn/hiện. */
function recentRows(list, b) {
  if (!list.length) return '';
  const today = todayISO();
  const rows = list.map((t) => {
    const sign = t.type === 'income' ? 1 : t.type === 'expense' ? -1 : 0;
    const when = `${t.date === today ? '' : fmtDM(t.date) + ' '}${t.createdAt && t.date === today ? fmtTimeVN(t.createdAt) : ''}`.trim();
    return `<div class="rc-row"><span class="rc-name">${QUICK_KINDS[txTypeKey(t)].icon} ${esc(txRowName(t))} <small>${esc(when)}</small></span>
      <span class="rc-amt ${t.type}">${sign ? fmtSigned(sign * t.amountVnd) : fmt(t.amountVnd)}</span>
      ${canRecall(t) ? `<button type="button" class="btn small ghost rc-btn" data-act="quick-recall" data-id="${esc(t.id)}" data-book="${esc(b.id)}">↩ Recall</button>` : ''}</div>`;
  }).join('');
  return `<div class="rc-box">
    <div class="rc-head"><small>Giao dịch gần đây</small><button type="button" class="link rc-toggle" data-act="recent-toggle" data-id="${esc(b.id)}">${b.hideRecent ? 'Hiện' : 'Ẩn'}</button></div>
    ${b.hideRecent ? '' : rows}
  </div>`;
}
actions['recent-toggle'] = (el) => {
  const b = S.getProfiles().find((x) => x.id === el.dataset.id);
  if (!b) return;
  S.saveProfile({ id: b.id, hideRecent: !b.hideRecent });
  refresh();
};
actions['quick-recall'] = async (el) => {
  const { id, book } = el.dataset;
  await inBook(book);
  const t = state.transactions.find((x) => x.id === id);
  if (!t) return refresh();
  if (!canRecall(t)) { toast('Đã quá 10 phút, muốn xóa hãy vào Giao dịch'); return refresh(); }
  const pfErr = await removeBlock(t);
  if (pfErr) return toast('⛔ ' + pfErr, 4500);
  if (!confirm(`Hủy khoản ${fmt(t.amountVnd)} "${txRowName({ ...t, catName: S.catById(t.categoryId)?.name })}"?${t.gop ? ' Giao dịch ở mục bên kia cũng bị xóa.' : ''}`)) return;
  await S.deleteTx(t);
  toast('Đã hủy giao dịch');
};

let recallTimer = null;
async function overCard(b) {
  const r = overRange();
  const o = await S.bookOverview(b, r);
  overExpiry = Math.min(overExpiry, ...o.recent.filter(canRecall).map((t) => t.createdAt + S.RECALL_MS));
  const isCard = b.kind === 'card' && !b.credit;
  const st = o.settings;
  const quicks = sortQuicks(S.quicksOf(st).filter((q) => q.show !== false && S.quickTypesFor(b).includes(q.type))).slice(0, S.QUICK_MAX[S.kindOfBook(b)]);
  let stats = '';
  if (!isCard) {
    for (const x of S.statsOf(st).filter((y) => y.show !== false).slice(0, S.STAT_MAX)) {
      const m = await STATS[x.type].load(x);
      const list = m.txs.filter((t) => t.date >= r.start && t.date <= r.end);
      const inc = statSum(list, 'income'), exp = statSum(list, 'expense');
      stats += `<button type="button" class="stat-line" data-act="stat-open" data-id="${esc(x.id)}" data-book="${esc(b.id)}">
        <span class="grow"><b>${esc(statIcon(x))} ${esc(statName(x))}</b><small>${m.configured ? `Thu ${fmtShort(inc)} · Chi ${fmtShort(exp)}` : 'Chưa thiết lập nguồn'}</small></span>
        ${m.configured ? `<strong class="${inc - exp >= 0 ? 'income' : 'expense'}">${fmtSigned(inc - exp)}</strong>` : ''}<i>›</i></button>`;
    }
  }
  const sub = b.kind === 'card' ? (b.credit && b.limit ? `Hạn mức ${fmtShort(b.limit)}` : S.CARD_TYPES[b.cardType] || '')
    : [o.number && `STK ${o.number}`, b.overdraft && `Hạn mức ${fmtShort(b.limit)}`].filter(Boolean).join(' · ');
  return `<section class="card over-acc" style="--c:${esc(b.color)}">
    <div class="over-head" role="button" tabindex="0" data-act="book-open" data-id="${esc(b.id)}">
      <span class="ol"><b>${esc(b.icon || kindOf(b).icon)} ${esc(b.name)}${b.locked ? ' 🔒' : ''}</b><span class="ol-right"><b class="ol-bal ${isCard ? 'expense' : o.balance < 0 ? 'expense' : ''}">${fmt(o.balance)}</b>${b.kind === 'card' ? `<button type="button" class="over-pay" data-act="over-pay" data-id="${esc(b.id)}" aria-label="Thanh toán" title="Thanh toán">💸</button>` : ''}</span></span>
      <span class="ol ol-sm"><small>${esc(sub)}</small><span class="${o.net >= 0 ? 'income' : 'expense'}">${fmtSigned(o.net)}</span></span>
      <span class="ol ol-sm"><span class="income">${isCard ? 'Đã TT' : 'Thu'} ${fmt(o.income)}</span><span class="expense">Chi ${fmt(o.expense)}</span></span>
    </div>
    ${quickRows(quicks, b.id)}
    ${recentRows(o.recent, b)}
    ${stats ? `<div class="home-stats">${stats}</div>` : ''}
  </section>`;
}

/** Vẽ các thẻ tài khoản của tab đang chọn (đọc từ nhiều sổ nên làm sau khi vẽ khung). */
async function fillOverview(root) {
  const box = root.querySelector('[data-over-list]');
  if (!box) return;
  root.querySelector('#over-period')?.addEventListener('change', (e) => { ui.overPeriod = e.target.value; refresh(); });
  const token = ++overToken;
  overExpiry = Infinity;
  const u = S.currentUser();
  const kind = overKindNow();
  const key = `${u.id}:${kind}:${ui.overPeriod || 'day'}`;
  const painted = box.innerHTML;
  try {
    const html = await overTabHtml(u, kind);
    if (token !== overToken || !box.isConnected) return;
    // Vẫn đúng nội dung đang hiện thì không đụng vào, tránh vẽ lại vô ích.
    if (overCache.get(key) !== html || !painted) box.innerHTML = html;
    overCache.set(key, html);
    // Dòng Recall tự biến mất đúng lúc hết 10 phút.
    clearTimeout(recallTimer);
    if (overExpiry !== Infinity) {
      recallTimer = setTimeout(() => { if (current.route === 'home') refresh(); }, Math.max(1000, overExpiry - Date.now() + 500));
    }
    // Chuẩn bị sẵn các thẻ khác để lần đầu bấm sang là có ngay.
    for (const [tab] of overTabs(u.id)) {
      const k = `${u.id}:${tab}:${ui.overPeriod || 'day'}`;
      if (overCache.has(k)) continue;
      const other = await overTabHtml(u, tab);
      if (token !== overToken) return;
      overCache.set(k, other);
    }
  } catch (err) { console.warn(err); }
}
async function overTabHtml(u, tab) {
  const books = tabBooks(u.id, tab);
  if (!books.length) return empty('🗂️', 'Chưa có mục nào. Bấm nút góc phải để tạo.');
  let html = '';
  for (const b of books) html += await overCard(b);
  return html;
}

/** Thẻ của một mục, để nút + mang màu của thẻ đó. */
const tabOfBook = (b) => (b.overdraft ? 'od' : b.kind === 'saving' ? 'saving' : b.kind !== 'card' ? 'bank' : b.credit || b.cardType === 'credit' ? 'credit' : 'wallet');
const fab = (tab = tabOfBook(S.currentProfile())) => `<button type="button" class="fab" data-act="add" data-tab="${tab}" aria-label="Thêm giao dịch">+</button>`;

// ================= Giao dịch =================
function filteredTx() {
  const f = ui.txFilter;
  const r = currentRange();
  const q = f.q.trim().toLowerCase();
  return S.txIn(r).filter((t) => {
    if (f.type !== 'all' && t.type !== f.type) return false;
    if (f.categoryIds.length && !S.txParts(t).some((p) => f.categoryIds.includes(p.categoryId))) return false;
    if (f.tag && !(t.tags || []).includes(f.tag)) return false;
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

/** Các danh mục đã xuất hiện trong lịch sử giao dịch của mục đang mở. */
function txHistoryCats() {
  const ids = new Set();
  for (const t of state.transactions) for (const p of S.txParts(t)) if (p.categoryId) ids.add(p.categoryId);
  return [...ids].map((id) => S.catById(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

const catFilterLabel = () => (ui.txFilter.categoryIds.length ? `${ui.txFilter.categoryIds.length} danh mục đã chọn` : 'Mọi danh mục');

function txView() {
  const f = ui.txFilter;
  if (f.type === 'transfer') f.type = 'all';
  const chips = [];
  const usedCats = txHistoryCats();
  f.categoryIds = f.categoryIds.filter((id) => usedCats.some((c) => c.id === id));
  if (f.tag) chips.push(['tag', '#' + f.tag]);
  const tags = S.allTags().slice(0, 12);
  return `
  ${topBar(`📒 Giao dịch · Số dư ${fmt(S.totalBalance())}`, `<div class="title-acts">${S.currentProfile().credit ? '<button type="button" class="btn primary small" data-act="credit-pay">💸 Thanh toán</button>' : ''}<button type="button" class="icon-btn" data-act="export-csv" title="Xuất CSV">⬇️</button></div>`)}
  ${periodBar()}
  <div class="filters">
    <input id="tx-q" type="search" placeholder="Tìm ghi chú, danh mục, tag, số tiền…" value="${esc(f.q)}">
    <div class="seg small">${['all', 'expense', 'income'].map((t) =>
      `<button type="button" data-act="tx-type" data-v="${t}" class="${f.type === t ? 'on' : ''}">${t === 'all' ? 'Tất cả' : TYPE_LABEL[t]}</button>`).join('')}</div>
    <div class="chips">
      ${chips.map(([k, label]) => `<button type="button" class="chip on" data-act="tx-unfilter" data-v="${k}">${esc(label)} ✕</button>`).join('')}
      ${tags.filter((g) => g !== f.tag).map((g) => `<button type="button" class="chip" data-act="tx-tag" data-v="${esc(g)}">#${esc(g)}</button>`).join('')}
    </div>
    <details class="cat-filter" id="tx-cat-box" ${ui.txCatOpen ? 'open' : ''}>
      <summary class="chip-select">🏷️ <span id="tx-cat-n">${catFilterLabel()}</span></summary>
      <div class="check-list" id="tx-cats">${usedCats.map((c) => `<label class="check"><input type="checkbox" value="${c.id}" ${f.categoryIds.includes(c.id) ? 'checked' : ''}> ${esc(c.icon + ' ' + c.name)}</label>`).join('') || '<small class="muted">Chưa có giao dịch nào</small>'}</div>
    </details>
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
  $(root, '#tx-cat-box').addEventListener('toggle', (e) => { ui.txCatOpen = e.target.open; });
  $(root, '#tx-cats').addEventListener('change', () => {
    ui.txFilter.categoryIds = [...root.querySelectorAll('#tx-cats input:checked')].map((x) => x.value);
    $(root, '#tx-cat-n').textContent = catFilterLabel();
    $(root, '#tx-list').innerHTML = txListHtml();
  });
}

actions['tx-type'] = (el) => { ui.txFilter.type = el.dataset.v; refresh(); };
actions['tx-tag'] = (el) => { ui.txFilter.tag = el.dataset.v; refresh(); };
actions['tx-unfilter'] = (el) => { ui.txFilter[el.dataset.v] = null; refresh(); };
actions['tx-edit'] = (el) => {
  const tx = state.transactions.find((t) => t.id === el.dataset.id);
  if (tx) (tx.gop ? gopDetail(tx) : tx.cardPay ? cardPayDetail(tx) : openTxForm({ tx }));
};

/** Khoản chi trong sổ người dùng được tạo khi thanh toán cho thẻ trả trước. */
function cardPayDetail(tx) {
  const cp = tx.cardPay;
  const cardExists = S.getProfiles().some((p) => p.id === cp.cardId);
  openSheet({
    title: 'Thanh toán thẻ trả trước',
    body: `<div class="detail">
      <div class="big-ic">💳</div>
      <div class="kv"><span>Thẻ</span><b>${esc(cp.cardName)}${cardExists ? '' : ' (đã xóa)'}</b></div>
      <div class="kv"><span>Nội dung</span><b>${esc(tx.note)}</b></div>

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
// Người dùng khác (không tính thẻ trả trước) — dùng cho Transfer, Get In, chọn sổ để ghi.
// Đích Transfer / Get In tùy loại mục đang mở (Ngân hàng, Tiết kiệm, NEOBANK, Cash Outflow).
const otherProfiles = (mode = 'gop') => sortByUser(S.transferTargets(mode));

/** Gom các mục theo User (Secrecy ở cuối), giữ thứ tự mục trong từng User. */
function byUser(books) {
  const groups = S.getUsers().map((u) => ({ label: `${u.icon || '🧑'} ${u.name}`, books: books.filter((b) => b.owner === u.id) }));
  groups.push({ label: '🔐 Secrecy', books: books.filter((b) => !S.getUsers().some((u) => u.id === b.owner)) });
  return groups.filter((g) => g.books.length);
}
const sortByUser = (books) => byUser(books).flatMap((g) => g.books);
/** Các nút chọn mục, chia nhóm theo User. chip(b) trả về HTML một nút. */
const userChips = (id, books, chip) => `<div class="user-groups" id="${id}">${byUser(books).map((g) =>
  `<div class="user-group"><small>${esc(g.label)}</small><div class="chips">${g.books.map(chip).join('')}</div></div>`).join('')}</div>`;

actions.gop = () => openGopForm();

/** Ô chọn danh mục Transfer/Get In (dùng chung mọi mục); chọn "＋ Thêm danh mục…" để tạo mới. */
function flowCatField(id, selected = state.settings.lastFlowCat || '') {
  return field('🏷️ Danh mục transfer/Get In', `<select id="${id}" data-flowcat>${flowCatOptions(selected)}</select>`);
}
const flowCatOptions = (selected) => `<option value="">— Không phân loại —</option>`
  + S.flowCats().map((c) => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.icon + ' ' + c.name)}</option>`).join('')
  + '<option value="__new">＋ Thêm danh mục…</option>';

document.addEventListener('change', (e) => {
  const sel = e.target;
  if (!sel.matches || !sel.matches('select[data-flowcat]')) return;
  if (sel.value === '__new') {
    flowCatSheet((c) => {
      sel.innerHTML = flowCatOptions(c ? c.id : '');
      if (c) S.setSetting('lastFlowCat', c.id, { silent: true });
    });
    return;
  }
  if (sel.value) S.setSetting('lastFlowCat', sel.value, { silent: true });
});

/** Thêm danh mục Transfer/Get In: nhập tên, chọn biểu tượng. onDone nhận danh mục mới, hoặc null nếu hủy. */
function flowCatSheet(onDone) {
  let icon = '🏷️', made = null;
  const formId = 'fc-' + Date.now();
  openSheet({
    title: 'Thêm danh mục Transfer/Get In',
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">Lưu</button>`,
    body: `<form class="form" id="${formId}">
      ${field('Tên danh mục', '<input id="fc-name" required maxlength="30" placeholder="vd: Đầu tư, Học phí">')}
      <div class="field"><span>Biểu tượng <b id="fc-now">${icon}</b></span>${iconPickerHtml('fc-icons', icon)}</div>
    </form>`,
    onClose() { onDone(made); },
    onMount(sh, close) {
      bindIconPicker($(sh, '#fc-icons'), (v) => { icon = v; $(sh, '#fc-now').textContent = v; }, () => icon);
      setTimeout(() => $(sh, '#fc-name').focus(), 250);
      $(sh, 'form').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = $(sh, '#fc-name').value.trim();
        if (!name) return toast('Nhập tên danh mục');
        try { made = S.addFlowCat(name, icon); } catch (err) { return toast(err.message); }
        close();
        toast('Đã thêm danh mục');
      });
    },
  });
}

/** Thu/Chi ở mục Thấu chi: tiền ra hoặc vào vượt hạn mức thì cảnh báo. */
function confirmOdTx(type, accountId, amount) {
  const me = S.currentProfile();
  if (!me.overdraft) return true;
  return confirmOverdraft(type === 'income' ? { toId: me.id, toAccountId: accountId, amount } : { fromId: me.id, fromAccountId: accountId, amount });
}

/** Vượt hạn mức Thấu chi: cảnh báo, người dùng chọn tiếp tục hay không. */
async function confirmOverdraft(args) {
  const msgs = await S.overdraftWarnings(args);
  return !msgs.length || confirm(`⚠️ ${msgs.join('\n')}\n\nVẫn tiếp tục?`);
}

/** Dòng cho biết Thẻ tín dụng đang nợ bao nhiêu khi Transfer vào hoặc Get In; cảnh báo nếu nhập vượt số nợ. */
const debtHintEl = '<em class="hint debt-hint" data-debt hidden></em>';
function bindDebtHint(sh, amt, getBook) {
  const el = $(sh, '[data-debt]');
  let debt = null, book = null;
  const need = () => Math.round(readMoney(amt.value) || 0);
  const paint = () => {
    el.hidden = debt == null;
    if (debt == null) return;
    const over = need() > debt;
    el.textContent = debt > 0 ? `💳 ${book.name} đang nợ ${fmt(debt)}${over ? ' — ⚠️ vượt số nợ' : ''}` : `💳 ${book.name} không còn nợ`;
    el.className = 'hint debt-hint' + (over || debt <= 0 ? ' warn-red' : '');
  };
  const load = async () => {
    book = getBook();
    debt = null;
    if (book?.credit) {
      const acc = (await S.peerAccounts(book.id))[0];
      debt = Math.max(0, -(await S.peerBalance(book.id, acc.id)));
    }
    paint();
  };
  amt.addEventListener('input', paint);
  load();
  return {
    load,
    /** Trả về thông báo nếu số tiền vượt số nợ. */
    error: () => (debt != null && need() > debt ? `${book.name} chỉ đang nợ ${fmt(debt)}, không được chuyển vượt số nợ` : null),
  };
}

function openGopForm(pick = null) {
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
      ${bookPick(pick)}
      <p class="muted small">Sổ của <b>${esc(S.bookLabel(me))}</b> ghi một khoản <b class="expense">chi</b>, sổ người nhận ghi một khoản <b class="income">thu</b>.</p>
      <div class="field"><span>Transfer cho</span>${userChips('gf-to', others, (p) => `<button type="button" class="chip ${p.id === others[0].id ? 'on' : ''}" data-to="${esc(p.id)}">${esc(p.icon)} ${esc(p.name)}${p.locked ? ' 🔒' : ''}</button>`)}</div>
      ${field('Từ tài khoản', `<select id="gf-from" data-acc>${accOptions(state.settings.lastAccount, true)}</select>`)}
      <em class="hint" id="gf-bal"></em>
      ${amountLine({ dateId: 'gf-date', date: todayISO(), amtId: 'gf-amt', after: debtHintEl + pfField() })}
      ${flowCatField('gf-fcat')}
      ${field('Vào tài khoản của <span id="gf-to-name"></span>', `<select id="gf-toacc" data-acc><option></option></select>`)}
      ${field('Ghi chú (không bắt buộc)', `<input id="gf-note" placeholder="vd: Transfer tiền chợ tháng 11">`)}
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'gf-amt');
      bindBookPick(sh, close, 'gf-amt', () => (otherProfiles('gop').length ? openGopForm(pick) : openAddForm(pick)));
      const updBal = () => balHint($(sh, '#gf-bal'), {
        have: S.available($(sh, '#gf-from').value), need: Math.round(readMoney(amt.value) || 0), bookId: S.currentProfile().id,
      });
      amt.addEventListener('input', updBal);
      $(sh, '#gf-from').addEventListener('change', updBal);
      updBal();
      let toId = others[0].id;
      const pfc = bindPf(sh, null, S.pfNeeded(me.id, toId));
      const debtH = bindDebtHint(sh, amt, () => others.find((x) => x.id === toId));
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
        pfc.setNeeded(S.pfNeeded(me.id, toId));
        debtH.load();
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
        if (debtH.error()) return toast('⛔ ' + debtH.error(), 4500);
        const to = others.find((x) => x.id === toId);
        if (!await confirmOverdraft({ fromId: me.id, fromAccountId: $(sh, '#gf-from').value, toId, toAccountId, amount: v })) return;
        try {
          await S.gop({
            toProfileId: toId, amount: v, fromAccountId: $(sh, '#gf-from').value, toAccountId,
            date: $(sh, '#gf-date').value || todayISO(), note: $(sh, '#gf-note').value.trim(), flowCat: $(sh, '#gf-fcat').value || null, pf: pfc.value(),
          });
        } catch (err) { return toast('⛔ ' + err.message, 4500); }
        close();
        toast(`🤝 Đã transfer ${fmt(v)} cho ${S.bookLabel(to)}`);
      });
    },
  });
}

function gopDetail(tx) {
  const out = tx.gop.dir === 'out';
  const isTrich = tx.gop.mode === 'trich';
  const word = tx.gop.mode === 'pay' ? 'thanh toán' : isTrich ? 'Get In' : 'transfer';
  const peerExists = S.getProfiles().some((p) => p.id === tx.gop.peer);
  openSheet({
    title: tx.gop.mode === 'pay' ? 'Khoản thanh toán thẻ' : isTrich ? (out ? 'Khoản chuyển Get In' : 'Khoản Get In') : (out ? 'Khoản transfer' : 'Khoản nhận transfer'),
    body: `<div class="detail">
      <div class="big-ic">${isTrich ? '🔄' : '🤝'}</div>
      <div class="kv"><span>Nội dung</span><b>${esc(gopLabel(tx.gop))}${peerExists ? '' : ' (người dùng đã xóa)'}</b></div>
      <div class="kv"><span>Số tiền</span><b class="${out ? 'expense' : 'income'}">${fmtSigned(out ? -tx.amountVnd : tx.amountVnd)}</b></div>
      ${tx.gop.flowCat ? `<div class="kv"><span>Danh mục</span><b>${esc((S.flowCatById(tx.gop.flowCat)?.icon || '') + ' ' + (S.flowCatById(tx.gop.flowCat)?.name || '—'))}</b></div>` : ''}
      <div class="kv"><span>${out ? 'Từ tài khoản' : 'Vào tài khoản'}</span><b>${esc(accName(tx.accountId))}</b></div>
      ${tx.pf ? `<div class="kv"><span>Ghi nhận vào</span><b>${S.PF_LABEL[tx.pf]}</b></div>` : ''}
      <div class="kv"><span>Ngày</span>${datePick('gd-date', tx.date)}</div>
      ${tx.createdAt ? `<div class="kv"><span>Ghi nhận lúc</span><b>${fmtDateTimeVN(tx.createdAt)}</b></div>` : ''}
      ${tx.note ? `<div class="kv"><span>Ghi chú</span><b>${esc(tx.note)}</b></div>` : ''}
      <p class="muted small">Khoản ${word} được ghi ở cả 2 sổ, sửa ngày sẽ áp dụng cả 2 bên. Muốn sửa số tiền: xóa khoản này rồi ${word} lại.</p>
      <div class="actions"><button type="button" class="btn danger" data-del>Xóa khoản ${word}${peerExists ? ' (cả 2 bên)' : ''}</button></div>
    </div>`,
    onMount(sh, close) {
      $(sh, '#gd-date').addEventListener('change', async (e) => {
        if (!e.target.value) return;
        await S.setGopDate(tx, e.target.value);
        tx.date = e.target.value;
        toast('Đã đổi ngày');
      });
      $(sh, '[data-del]').addEventListener('click', async () => {
        const pfErr = await removeBlock(tx);
        if (pfErr) return toast('⛔ ' + pfErr, 4500);
        if (!confirm(`Xóa khoản ${word} này?${peerExists ? ` Giao dịch tương ứng trong sổ của ${tx.gop.peerName} cũng bị xóa.` : ''}`)) return;
        await S.deleteTx(tx);
        close(); toast(`Đã xóa khoản ${word}`);
      });
    },
  });
}

actions.trich = () => openTrichForm();

/** Get In: lấy tiền từ tài khoản của người khác về tài khoản của mình (ngược với Transfer). */
function openTrichForm(pick = null) {
  const others = otherProfiles('trich');
  if (!others.length) {
    toast('Chưa có mục nào để Get In');
    return actions.profiles();
  }
  const me = S.currentProfile();
  const formId = 'tr-' + Date.now();
  openSheet({
    title: 'Get In',
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">🔄 Get In</button>`,
    body: `<form class="form" id="${formId}">
      ${bookPick(pick)}
      <p class="muted small">Rút tiền từ mục khác về <b>${esc(S.bookLabel(me))}</b>: sổ nguồn ghi một khoản <b class="expense">chi</b>, sổ này ghi một khoản <b class="income">thu</b>. Nguồn phải đủ số dư (riêng Thấu chi được âm, vượt hạn mức sẽ cảnh báo).</p>
      <div class="field"><span>Get In từ</span>${userChips('tr-from', others, (p) => `<button type="button" class="chip ${p.id === others[0].id ? 'on' : ''}" data-from="${esc(p.id)}">${esc(p.icon)} ${esc(p.name)}${p.locked ? ' 🔒' : ''}</button>`)}</div>
      ${field('Từ tài khoản của <span id="tr-from-name"></span>', `<select id="tr-facc" data-acc><option></option></select>`)}
      <em class="hint" id="tr-bal"></em>
      ${amountLine({ dateId: 'tr-date', date: todayISO(), amtId: 'tr-amt', after: debtHintEl + pfField() })}
      ${flowCatField('tr-fcat')}
      ${field('Vào tài khoản của ' + esc(S.bookLabel(me)), `<select id="tr-to" data-acc>${accOptions(state.settings.lastAccount)}</select>`)}
      ${field('Ghi chú (không bắt buộc)', `<input id="tr-note" placeholder="vd: Get In tháng 11">`)}
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'tr-amt');
      bindBookPick(sh, close, 'tr-amt', () => (otherProfiles('trich').length ? openTrichForm(pick) : openAddForm(pick)));
      let fromId = others[0].id;
      const pfc = bindPf(sh, null, S.pfNeeded(me.id, fromId));
      const debtH = bindDebtHint(sh, amt, () => me);
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
        pfc.setNeeded(S.pfNeeded(me.id, fromId));
        loadPeer();
      });
      $(sh, '#tr-facc').addEventListener('change', updBal);
      amt.addEventListener('input', updBal);
      loadPeer();
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = Math.round(readMoney(amt.value));
        if (!(v > 0)) return toast('Nhập số tiền Get In');
        const fromAccountId = $(sh, '#tr-facc').value;
        if (!balances.has(fromAccountId)) return toast('Chọn tài khoản nguồn');
        if (debtH.error()) return toast('⛔ ' + debtH.error(), 4500);
        const from = others.find((x) => x.id === fromId);
        if (!await confirmOverdraft({ fromId, fromAccountId, toId: me.id, toAccountId: $(sh, '#tr-to').value, amount: v })) return;
        try {
          await S.trich({
            fromProfileId: fromId, amount: v, fromAccountId, toAccountId: $(sh, '#tr-to').value,
            date: $(sh, '#tr-date').value || todayISO(), note: $(sh, '#tr-note').value.trim(), flowCat: $(sh, '#tr-fcat').value || null, pf: pfc.value(),
          });
        } catch (err) { return toast('⛔ ' + err.message, 4500); }
        close();
        toast(`🔄 Đã Get In ${fmt(v)} từ ${S.bookLabel(from)}`);
      });
    },
  });
}
actions['report-cat'] = (el) => {
  ui.txFilter = { type: 'all', q: '', categoryIds: [el.dataset.id], tag: null };
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
  ui.txFilter = { type: 'all', q: '', categoryIds: [], tag: el.dataset.v };
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
      ${pfField()}
      ${field(dir > 0 ? 'Lấy từ tài khoản' : 'Đưa về tài khoản', `<select id="gc-acc" data-acc>${accOptions(state.settings.lastAccount, dir > 0)}</select>`)}
      ${datePick('gc-date', todayISO(), 'Ngày', 'disabled')}
      <label class="check"><input type="checkbox" id="gc-tx" ${dir > 0 ? 'checked' : ''}> ${dir > 0
        ? `Ghi thành khoản chi "${esc(savingCat?.name || 'Tiết kiệm')}" (trừ số dư tài khoản)`
        : 'Ghi thành khoản thu vào tài khoản'}</label>
      <div class="actions"><button class="btn primary">Xác nhận</button></div>
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'gc-amt');
      const special = S.isSpecialBook(S.currentProfile());
      const pfc = bindPf(sh, null, special && $(sh, '#gc-tx').checked);
      $(sh, '#gc-tx').addEventListener('change', (e) => pfc.setNeeded(special && e.target.checked));
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = Math.round(readMoney(amt.value));
        if (!(v > 0)) return toast('Nhập số tiền');
        const date = $(sh, '#gc-date').value || todayISO();
        let txId = null;
        if (dir > 0 && $(sh, '#gc-tx').checked && !checkFunds($(sh, '#gc-acc').value, v)) return;
        const pf = pfc.value();
        const pfErr = pf ? await S.pfCheck({ pf, delta: dir * v }) : null;
        if (pfErr) return toast('⛔ ' + pfErr, 4500);
        if ($(sh, '#gc-tx').checked) {
          const incomeCat = S.catsOf('income').find((c) => c.name === 'Thu khác') || S.catsOf('income')[0];
          const tx = await S.put('transactions', {
            type: dir > 0 ? 'expense' : 'income', amount: v, currency: 'VND', rate: 1, amountVnd: v, date,
            categoryId: dir > 0 ? savingCat?.id : incomeCat?.id, accountId: $(sh, '#gc-acc').value,
            note: (dir > 0 ? 'Tiết kiệm: ' : 'Rút từ mục tiêu: ') + g.name, tags: [], splits: null, photoIds: [], createdAt: Date.now(), ...(pf ? { pf } : {}),
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
      <span class="grow"><b>${esc(S.debtName(d))}</b><small>${fmtDate(d.dueDate)} · 🔔 ${d.time || S.ALERT_TIME} · ${fmtDue(days)}${d.repeat === 'monthly' ? ` · hằng tháng${d.periodsLeft != null ? `, còn ${d.periodsLeft} kỳ` : ''}` : ''}</small>
      ${d.method ? `<small>💳 ${esc(d.method)}</small>` : ''}</span>
      <span class="amt">${fmt(d.amount)}</span></button>`;
  }).join('')}</div>` : empty('🏦', 'Chưa có khoản trả nợ nào.')}
  <button type="button" class="btn primary block" data-act="debt-edit">+ Thêm khoản trả nợ</button>
  ${active.length ? `<button type="button" class="btn ghost block" data-act="debt-ics-all">📅 Thêm tất cả hạn trả nợ vào Lịch điện thoại</button>` : ''}
  ${done.length ? `<details class="card"><summary>Đã hoàn tất (${done.length})</summary><div class="list">${done.map((d) =>
    `<button type="button" class="row" data-act="debt-open" data-id="${d.id}"><span class="ci">✅</span><span class="grow"><b>${esc(S.debtName(d))}</b><small>${(d.history || []).length} lần trả</small></span><span class="amt">${fmt((d.history || []).reduce((s, h) => s + h.amount, 0))}</span></button>`).join('')}</div></details>` : ''}`;
}

const alertTimeField = (id, time) => field('Giờ thông báo', `<input type="time" id="${id}" value="${esc(time || S.ALERT_TIME)}">`);
/** Dòng cho biết khi nào thông báo sẽ hiện, cập nhật theo ngày, số ngày nhắc trước và giờ đang chọn. */
function bindAlertPreview(sh, { dateId, remId, timeId, outId, until }) {
  const upd = () => {
    const date = $(sh, '#' + dateId).value;
    if (!date) { $(sh, '#' + outId).textContent = ''; return; }
    const time = $(sh, '#' + timeId).value || S.ALERT_TIME;
    const at = addDays(date, -(Number($(sh, '#' + remId).value) || 0));
    $(sh, '#' + outId).textContent = `🔔 Hiện trong Notifications từ ${time} ngày ${fmtDate(at)}, đến khi ${until}.`;
  };
  for (const id of [dateId, remId, timeId]) for (const ev of ['input', 'change']) $(sh, '#' + id).addEventListener(ev, upd);
  upd();
}

actions['debt-edit'] = (el) => {
  const d = state.debts.find((x) => x.id === el.dataset.id);
  const f = d ? { ...d } : { bank: '', title: '', amount: 0, dueDate: todayISO(), repeat: 'monthly', periodsLeft: null, method: PAY_METHODS[0], note: '', accountId: state.settings.lastAccount, remindDays: Number(state.settings.remindDays), time: S.ALERT_TIME };
  const methodIsPreset = PAY_METHODS.includes(f.method);
  openSheet({
    title: d ? 'Sửa khoản trả nợ' : 'Thêm khoản trả nợ',
    body: `<form class="form">
      ${field('Ngân hàng / Công ty tài chính', `<input id="df-bank" list="bank-list" required value="${esc(f.bank)}" placeholder="vd: Vietcombank"><datalist id="bank-list">${BANKS.map((b) => `<option value="${esc(b)}">`).join('')}</datalist>`)}
      ${field('Nội dung khoản nợ', `<input id="df-title" value="${esc(f.title)}" placeholder="vd: Vay mua xe, Thẻ tín dụng, Trả transfer iPhone">`)}
      ${amountField('df-amt', f.amount, 'Số tiền mỗi kỳ')}
      ${datePick('df-date', f.dueDate, 'Ngày đến hạn')}
      <div class="two">${field('Nhắc trước (ngày)', `<input type="number" id="df-rem" min="0" max="30" value="${esc(f.remindDays ?? 3)}">`)}
      ${alertTimeField('df-time', f.time)}</div>
      <p class="muted small" id="df-when"></p>
      <div class="two">${field('Lặp lại', `<select id="df-rep"><option value="monthly" ${f.repeat === 'monthly' ? 'selected' : ''}>Hằng tháng</option><option value="none" ${f.repeat === 'none' ? 'selected' : ''}>Một lần</option></select>`)}
      ${field('Số kỳ còn lại', `<input type="number" id="df-left" min="1" placeholder="Không giới hạn" value="${f.periodsLeft ?? ''}">`, 'data-left')}</div>
      ${field('Cách thức thanh toán', `<select id="df-method">${PAY_METHODS.map((m) => `<option ${m === f.method || (!methodIsPreset && m === 'Khác') ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>`)}
      ${field('Ghi chú thanh toán', `<textarea id="df-note" rows="3" placeholder="vd: CK tới STK 0123456789 – Nguyễn Văn A, nội dung: HD123 thang 11. Hoặc: withdraw tự động từ TK lương, nhớ để đủ tiền trước ngày 25.">${esc(f.note || (!methodIsPreset ? f.method : ''))}</textarea>`)}
      ${field('Trả từ tài khoản (khi đánh dấu đã trả)', `<select id="df-acc" data-acc>${accOptions(f.accountId)}</select>`)}
      <div class="actions">${d ? '<button type="button" class="btn danger" data-del>Xóa</button>' : ''}<button class="btn primary">Lưu</button></div>
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'df-amt');
      const rep = $(sh, '#df-rep'), leftF = $(sh, '[data-left]');
      const updRep = () => { leftF.hidden = rep.value !== 'monthly'; };
      rep.addEventListener('change', updRep); updRep();
      bindAlertPreview(sh, { dateId: 'df-date', remId: 'df-rem', timeId: 'df-time', outId: 'df-when', until: 'bạn thanh toán' });
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
          time: $(sh, '#df-time').value || S.ALERT_TIME, remindDays: Number($(sh, '#df-rem').value) || 0, done: d ? d.done && dueDate === d.dueDate : false, history: f.history || [],
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
      <p class="muted small">Đã điền sẵn số tiền thiết lập. Kỳ này có chênh lệch thì sửa lại, các kỳ sau vẫn theo số thiết lập.</p>
      ${pfField()}
      ${field('Trả từ tài khoản', `<select id="dp-acc" data-acc>${accOptions(d.accountId || state.settings.lastAccount, true)}</select>`)}
      ${datePick('dp-date', todayISO(), 'Ngày trả', 'disabled')}
      <p class="muted">App sẽ ghi một khoản chi "Trả nợ ngân hàng"${d.repeat === 'monthly' ? ' và chuyển sang kỳ tháng sau' : ''}.</p>
      <div class="actions"><button class="btn primary">Xác nhận</button></div>
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'dp-amt');
      const pfc = bindPf(sh, null, S.isSpecialBook(S.currentProfile()));
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = readMoney(amt.value);
        if (!(v > 0)) return toast('Nhập số tiền');
        if (!checkFunds($(sh, '#dp-acc').value, Math.round(v))) return;
        try {
          await S.payDebt(d, { amount: Math.round(v), accountId: $(sh, '#dp-acc').value, date: $(sh, '#dp-date').value || todayISO(), pf: pfc.value() });
        } catch (err) { return toast('⛔ ' + err.message, 4500); }
        close(); toast(d.done ? '🎉 Đã trả xong khoản nợ!' : 'Đã ghi nhận. Kỳ tới: ' + fmtDate(d.dueDate));
      });
    },
  });
}

function debtEvent(d) {
  const rrule = d.repeat === 'monthly' ? `FREQ=MONTHLY${d.periodsLeft != null ? ';COUNT=' + d.periodsLeft : ''}` : null;
  return {
    uid: 'debt-' + d.id, date: d.dueDate, rrule, remindDays: d.remindDays ?? state.settings.remindDays, time: d.time || S.ALERT_TIME,
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
// ----- Nhắc nhở của User: tạo ở màn hình nút góc phải Tổng quan, tối đa 9 -----
function reminderSub(r) {
  const unit = S.REPEAT_UNITS[r.repeat];
  return `${fmtDate(r.date)} · 🔔 ${r.time || S.ALERT_TIME}${r.remindDays ? ` · trước ${r.remindDays} ngày` : ''}${unit ? ` · lặp mỗi ${unit}${r.periodsLeft != null ? ` · còn ${r.periodsLeft} kì` : ''}` : ''}`;
}
function reminderSection(u) {
  const list = [...S.remindersOf(u.id)].sort((a, b) => (a.date < b.date ? -1 : 1));
  return `<h4 class="grp-h"><span>🔔 Nhắc nhở <small>(${list.length}/${S.REMINDER_MAX})</small></span></h4>
    <div class="notif-list">${list.map((r) => `<button type="button" class="notif-row rem-row" data-rem="${esc(r.id)}"><span class="n-ic">🔔</span>
      <span class="grow"><b>${esc(r.title)}</b><small>${esc(reminderSub(r))}</small></span>›</button>`).join('')}</div>
    ${list.length < S.REMINDER_MAX ? '<button type="button" class="ptile-add block" data-rem="">＋ Nhắc nhở</button>' : ''}`;
}

function reminderForm(r) {
  const u = S.currentUser();
  const f = r ? { ...r } : { title: '', date: todayISO(), remindDays: 0, repeat: 'none', time: S.ALERT_TIME, periodsLeft: null };
  const repeats = !!S.REPEAT_UNITS[f.repeat];
  let unit = repeats ? f.repeat : 'month';
  const formId = 'rm-' + Date.now();
  openSheet({
    title: r ? 'Sửa nhắc nhở' : 'Tạo nhắc nhở',
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">Lưu</button>`,
    onClose() { actions.books(); },
    body: `<form class="form" id="${formId}">
      ${field('Tên nhắc nhở', `<input id="rm-title" required maxlength="60" value="${esc(f.title)}" placeholder="vd: Đóng học phí, gia hạn bảo hiểm">`)}
      ${datePick('rm-date', f.date, 'Ngày đến hạn')}
      <div class="two">${field('Giờ nhắc', `<input type="time" id="rm-time" value="${esc(f.time || S.ALERT_TIME)}">`)}
      ${field('Nhắc trước (ngày)', `<input type="number" id="rm-before" min="0" max="30" value="${esc(f.remindDays || 0)}">`)}</div>
      <p class="muted small" id="rm-when"></p>
      <label class="check"><input type="checkbox" id="rm-rep" ${repeats ? 'checked' : ''}> Lặp lại</label>
      <div class="rep-box" id="rm-rep-box" ${repeats ? '' : 'hidden'}>
        <div class="field"><span>Lặp theo</span><div class="seg" id="rm-unit">${Object.entries(S.REPEAT_UNITS).map(([k, v]) => `<button type="button" data-u="${k}" class="${k === unit ? 'on' : ''}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></div>
        ${field('Số kì lặp', `<input type="number" id="rm-count" min="1" max="999" inputmode="numeric" value="${esc(f.periodsLeft ?? '')}" placeholder="Để trống: không giới hạn">`)}
      </div>
      ${r ? '<div class="actions"><button type="button" class="btn danger" data-del>Xóa nhắc nhở</button><button type="button" class="btn ghost" data-ics>📅 Thêm vào Lịch</button></div>' : ''}
    </form>`,
    onMount(sh, close) {
      bindAlertPreview(sh, { dateId: 'rm-date', remId: 'rm-before', timeId: 'rm-time', outId: 'rm-when', until: 'bạn bấm Done' });
      const rep = $(sh, '#rm-rep');
      rep.addEventListener('change', () => { $(sh, '#rm-rep-box').hidden = !rep.checked; });
      $(sh, '#rm-unit').addEventListener('click', (e) => {
        const b = e.target.closest('[data-u]');
        if (!b) return;
        unit = b.dataset.u;
        sh.querySelectorAll('#rm-unit [data-u]').forEach((x) => x.classList.toggle('on', x === b));
      });
      $(sh, 'form').addEventListener('submit', (e) => {
        e.preventDefault();
        const title = $(sh, '#rm-title').value.trim();
        const date = $(sh, '#rm-date').value;
        if (!title) return toast('Nhập tên nhắc nhở');
        if (!date) return toast('Chọn ngày đến hạn');
        const count = $(sh, '#rm-count').value.trim();
        const periodsLeft = rep.checked && count ? Math.floor(Number(count)) : null;
        if (periodsLeft != null && !(periodsLeft >= 1)) return toast('Số kì lặp phải từ 1 trở lên');
        try {
          S.saveReminder(u.id, { ...f, title, date, day: Number(date.slice(8)), time: $(sh, '#rm-time').value || S.ALERT_TIME, remindDays: Number($(sh, '#rm-before').value) || 0, repeat: rep.checked ? unit : 'none', periodsLeft });
        } catch (err) { return toast(err.message); }
        close(); toast('Đã lưu nhắc nhở');
      });
      $(sh, '[data-del]')?.addEventListener('click', () => {
        if (!confirm(`Xóa nhắc nhở "${r.title}"?`)) return;
        S.deleteReminder(u.id, r.id); close(); toast('Đã xóa');
      });
      $(sh, '[data-ics]')?.addEventListener('click', () => {
        const freq = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY' }[r.repeat];
        calendarSheet('nhac-nho.ics', buildAllDayICS([{
          uid: 'rem-' + r.id, date: r.date, rrule: freq ? `FREQ=${freq}${r.periodsLeft != null ? ';COUNT=' + r.periodsLeft : ''}` : null, remindDays: r.remindDays || 0, time: r.time || S.ALERT_TIME,
          title: `🔔 ${r.title}`, description: r.note || '',
        }]));
      });
    },
  });
}

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
      ${pfField()}
      ${t.type !== 'transfer' ? field('Danh mục', `<select id="rf-cat">${catOptions(t.type, t.categoryId)}</select>`) : ''}
      ${field('Tài khoản', `<select id="rf-acc" data-acc>${accOptions(t.accountId)}</select>`)}
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
      const pfc = bindPf(sh, t.pf || null, S.isSpecialBook(S.currentProfile()) && t.type !== 'transfer');
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = readMoney(amt.value);
        if (!(v > 0)) return toast('Nhập số tiền');
        const nd = $(sh, '#rf-next').value;
        r.template = { ...t, amount: v, currency: $(sh, '#rf-cur')?.value || t.currency || 'VND', categoryId: $(sh, '#rf-cat')?.value || t.categoryId, accountId: $(sh, '#rf-acc').value, note: $(sh, '#rf-note').value.trim(), splits: null, pf: pfc.value() };
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
export function openTxForm({ tx = null, type = 'expense', preset = null, fromRecurring = null, repeat = 'none', returnTo = null, catName = null, pick = null } = {}) {
  const st = state.settings;
  const isEdit = !!tx;
  const f = tx ? JSON.parse(JSON.stringify(tx)) : {
    type, amount: null, currency: 'VND', date: todayISO(), categoryId: st.lastCat?.[type] || null,
    accountId: st.lastAccount, toAccountId: null, note: '', tags: [], splits: null, photoIds: [], ...(preset || {}),
  };
  const typeAllowed = (t) => isEdit || fromRecurring || t === 'transfer' || S.featureOn(S.currentProfile(), t);
  if (!typeAllowed(f.type)) f.type = f.type === 'expense' ? 'income' : 'expense';
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
  const showWho = !pick && !isEdit && !fromRecurring && S.txBooks().length > 1 && !S.currentProfile().credit;
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
      ${showWho ? `<div class="who-pick"><span>Ghi vào sổ của</span>${userChips('tf-who', S.txBooks(), (p) =>
        `<button type="button" class="chip ${p.id === S.currentProfile().id ? 'on' : ''}" data-who="${esc(p.id)}" style="--c:${esc(p.color)}">${esc(p.icon)} ${esc(p.name)}${p.locked ? ' 🔒' : ''}</button>`)}</div>` : ''}
      ${bookPick(pick, 'tf-who', 'data-who')}
      ${isEdit && tx.createdAt ? `<p class="muted small center">🕒 Ghi nhận lúc ${fmtDateTimeVN(tx.createdAt)}${tx.updatedAt && tx.updatedAt - tx.createdAt > 60000 ? ` · sửa lúc ${fmtDateTimeVN(tx.updatedAt)}` : ''} (giờ VN)</p>` : ''}
      <div class="seg seg-3" id="tf-type">${(isEdit && tx.type === 'transfer' ? ['expense', 'income', 'transfer'] : ['expense', 'income']).filter(typeAllowed).map((t) => `<button type="button" data-v="${t}">${{ expense: '💸 ', income: '💰 ', transfer: '⇄ ' }[t] || ''}${TYPE_LABEL[t]}</button>`).join('')}
        ${!isEdit && !fromRecurring && S.transferTargets('gop').length ? '<button type="button" class="seg-gop" id="tf-gop">🤝 Transfer</button>' : ''}
        ${!isEdit && !fromRecurring && S.transferTargets('trich').length ? '<button type="button" class="seg-trich" id="tf-trich">🔄 Get In</button>' : ''}</div>
      ${field('<span id="tf-acc-l">Tài khoản</span>', `<select id="tf-acc" data-acc>${accOptions(f.accountId, true)}</select>`)}
      <em class="hint" id="tf-bal"></em>
      ${amountLine({ dateId: 'tf-date', date: f.date, amtId: 'tf-amt', amount: f.amount ? fmtNum(f.amount) : '', big: true, editDate: isEdit, after: pfField() })}
      ${multiCur ? `<div class="cur-row"><select id="tf-cur" class="cur">${st.currencies.map((c) => `<option ${c.code === f.currency ? 'selected' : ''}>${esc(c.code)}</option>`).join('')}</select></div>` : ''}
      <em class="hint center" id="tf-hint"></em>
      <div class="amt-tools">
        <select id="tf-cat" class="cat-select" aria-label="Danh mục"></select>
      </div>
      <label class="check" id="tf-split-wrap"><input type="checkbox" id="tf-split" ${splitRows.length ? 'checked' : ''}> Chia thành nhiều danh mục</label>
      <div id="tf-splits"></div>
      ${field('Đến tài khoản', `<select id="tf-to" data-acc>${accOptions(f.toAccountId)}</select>`, 'id="tf-to-wrap"')}
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
      if (!switching && !pick && origin !== S.currentProfile().id) S.switchProfile(origin);
    },
    onMount(sh, close) {
      const amtIn = $(sh, '#tf-amt'), hint = $(sh, '#tf-hint');
      const pfc = bindPf(sh, f.pf || null, S.isSpecialBook(S.currentProfile()));

      // Đổi người dùng: mở lại form trong sổ của người đó, giữ nguyên số tiền, ngày, ghi chú, tag, danh mục (theo tên).
      $(sh, '#tf-who')?.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-who]');
        if (!b || b.dataset.who === S.currentProfile().id) return;
        const keep = {
          amount: parseAmount(amtIn.value) || null, date: $(sh, '#tf-date').value || todayISO(),
          note: $(sh, '#tf-note').value.trim(), tags: f.tags || [], pf: pfc.value(),
        };
        const keepCat = S.catById(f.categoryId)?.name || null;
        const keepType = f.type;
        if (pickBusy) return;
        switching = true;
        pickBusy = true;
        try { await S.switchProfile(b.dataset.who); } finally { pickBusy = false; }
        close();
        const now = S.currentProfile();
        if (pick && (S.isCard() || (!S.featureOn(now, 'expense') && !S.featureOn(now, 'income')))) return openAddForm(pick);
        openTxForm({ type: keepType, preset: keep, returnTo: origin, catName: keepCat, pick });
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
      $(sh, '#tf-gop')?.addEventListener('click', () => { close(); openGopForm(pick); });
      $(sh, '#tf-trich')?.addEventListener('click', () => { close(); openTrichForm(pick); });
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
      // Danh mục dạng danh sách thả xuống (danh mục Transfer/Get In chỉ tạo qua chức năng riêng nên không hiện ở đây).
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
          ${moneyBox(`<input data-k="amount" class="money" inputmode="decimal" placeholder="Số tiền" value="${esc(r.amount)}">`)}
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
        if (!isEdit && !await confirmOdTx(f.type, accountId, amountVnd)) return;
        const crErr = S.creditError((f.type === 'income' ? 1 : -1) * amountVnd, isEdit ? tx : null);
        if (crErr) return toast('⛔ ' + crErr, 4500);
        const pf = pfc.value();
        if (pf) {
          const pfErr = await S.pfCheck({ oldPf: isEdit ? tx.pf : null, oldDelta: isEdit ? S.pfDelta(tx) : 0, pf, delta: (f.type === 'income' ? 1 : -1) * amountVnd });
          if (pfErr) return toast('⛔ ' + pfErr, 4500);
        }
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
          createdAt: f.createdAt || Date.now(), pf: pf || undefined,
        };
        if (fromRecurring) obj.recurringId = fromRecurring.id;

        const repVal = rep ? rep.value : 'none';
        if (repVal !== 'none') {
          const r = {
            template: { type: obj.type, amount, currency, categoryId: obj.categoryId, accountId, toAccountId, note: obj.note, tags: obj.tags, splits, pf },
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
        const pfErr = await removeBlock(tx);
        if (pfErr) return toast('⛔ ' + pfErr, 4500);
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

/** Nút + (giữa trên cùng): Ngân hàng mở form Chi/Thu (có thêm Transfer/Get In); Tiết kiệm chỉ có Transfer/Get In. */
actions.add = async (el) => {
  let pick = null;
  if (current.route === 'home') {
    const kind = overKindNow();
    const books = tabBooks(S.currentUser().id, kind);
    if (!books.length) return toast('Chưa có mục nào. Bấm nút góc phải để tạo.');
    if (!books.some((b) => b.id === S.currentProfile().id)) await S.switchProfile(books[0].id);
    pick = books;
  }
  openAddForm(pick, { type: el.dataset.type, repeat: el.dataset.repeat });
};

/** Mở form phù hợp với mục đang chọn. pick: các tài khoản cùng thẻ ở Tổng quan để chọn ngay trong form. */
function openAddForm(pick, { type = 'expense', repeat = 'none' } = {}) {
  const cur = S.currentProfile();
  if (pick && S.isCard()) return cardItemForm(null, pick);
  if (transferOnly() || (!S.featureOn(cur, 'expense') && !S.featureOn(cur, 'income'))) return gopTrichChooser(pick);
  openTxForm({ type, repeat, pick });
}

/** Dòng chọn tài khoản giao dịch, chỉ hiện khi thẻ đó có từ 2 tài khoản. */
const bookPick = (pick, id = '', attr = 'data-pick') => (pick?.length > 1 ? `<div class="who-pick book-pick" ${id ? `id="${id}"` : 'data-book-pick'}><span>Tài khoản giao dịch</span><div class="chips">${pick.map((p) =>
  `<button type="button" class="chip ${p.id === S.currentProfile().id ? 'on' : ''}" ${attr}="${esc(p.id)}" style="--c:${esc(p.color)}">${esc(p.icon)} ${esc(p.name)}${p.locked ? ' 🔒' : ''}</button>`).join('')}</div></div>` : '');
let pickBusy = false;
/** Đổi tài khoản: mở lại form của tài khoản đó, giữ số tiền đang nhập. */
function bindBookPick(sh, close, amtId, reopen) {
  $(sh, '[data-book-pick]')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b || pickBusy || b.dataset.pick === S.currentProfile().id) return;
    const amount = amtId ? $(sh, '#' + amtId)?.value : '';
    pickBusy = true;
    try { await S.switchProfile(b.dataset.pick); } finally { pickBusy = false; }
    close();
    reopen();
    const input = amount && [...document.querySelectorAll('.sheet')].pop()?.querySelector('#' + amtId);
    if (input) { input.value = amount; input.dispatchEvent(new Event('input', { bubbles: true })); }
  });
}

function gopTrichChooser(pick = null) {
  const g = S.transferTargets('gop').length, t = S.transferTargets('trich').length;
  if (!g && !t) return toast('Mục này không có giao dịch nào đang bật hoặc chưa có mục để chuyển');
  if (g && !t) return openGopForm(pick);
  openSheet({
    title: 'Chọn thao tác',
    body: `${bookPick(pick)}<div class="actions col">
      ${g ? '<button type="button" class="btn primary" data-x="gop">🤝 Transfer cho mục khác</button>' : ''}
      ${t ? '<button type="button" class="btn ghost" data-x="trich">🔄 Get In</button>' : ''}</div>`,
    onMount(sh, close) {
      bindBookPick(sh, close, '', () => gopTrichChooser(pick));
      sh.addEventListener('click', (e) => {
        const b = e.target.closest('[data-x]');
        if (!b) return;
        close();
        (b.dataset.x === 'gop' ? openGopForm : openTrichForm)(pick);
      });
    },
  });
}

// ================= Mẫu nhập nhanh =================
// Mỗi mục Ngân hàng/Đầu tư có 4 mẫu (Chi, Thu, Transfer, Get In); thẻ trả trước có 1 mẫu.
// Thiết lập trong Cài đặt; bật "Hiện" thì có nút ⚡ ở Tổng quan, bấm vào chỉ cần nhập số tiền rồi OK.
const QUICK_KINDS = {
  expense: { get icon() { return S.txIcons().expense; }, label: 'Chi' },
  income: { get icon() { return S.txIcons().income; }, label: 'Thu' },
  gop: { get icon() { return S.txIcons().gop; }, label: 'Transfer' },
  trich: { get icon() { return S.txIcons().trich; }, label: 'Get In' },
  card: { get icon() { return S.txIcons().expense; }, label: 'Chi' },
};
/** Cài đặt chung: mỗi loại giao dịch một icon, tên chức năng cố định. */
const TX_ICON_ROWS = ['expense', 'income', 'gop', 'trich'];
function txIconSettingsHtml() {
  return `${sectionTitle('Icon giao dịch')}
  <section class="card list">${TX_ICON_ROWS.map((t) => `<button type="button" class="row" data-act="tx-icon" data-t="${t}"><span class="ci">${esc(S.txIcons()[t])}</span><span class="grow"><b>${QUICK_KINDS[t].label}</b></span><span>✎</span></button>`).join('')}</section>
  <p class="muted small">Icon này hiển thị trên các nút nhanh của mọi mục. Tên chức năng không đổi được.</p>`;
}
actions['tx-icon'] = (el) => {
  const t = el.dataset.t;
  let icon = S.txIcons()[t];
  const formId = 'ti-' + Date.now();
  openSheet({
    title: `Icon ${QUICK_KINDS[t].label}`,
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">Lưu</button>`,
    body: `<form class="form" id="${formId}">
      <div class="field"><span>Biểu tượng đang chọn <b id="ti-now">${esc(icon)}</b></span>${iconPickerHtml('ti-icons', icon, { pairs: MONEY_PAIRS })}</div>
      ${icon !== S.TX_ICON_DEFAULTS[t] ? `<div class="actions"><button type="button" class="btn ghost" data-reset>Về mặc định ${S.TX_ICON_DEFAULTS[t]}</button></div>` : ''}
    </form>`,
    onMount(sh, close) {
      bindIconPicker($(sh, '#ti-icons'), (v) => { icon = v; $(sh, '#ti-now').textContent = v; }, () => icon);
      $(sh, 'form').addEventListener('submit', (e) => {
        e.preventDefault();
        S.setTxIcon(t, icon);
        close(); toast('Đã đổi icon');
      });
      $(sh, '[data-reset]')?.addEventListener('click', () => {
        S.setTxIcon(t, S.TX_ICON_DEFAULTS[t]);
        close(); toast('Đã về icon mặc định');
      });
    },
  });
};
const saveQuicks = (list) => S.setSetting('quicks', list);
/** Nút nhanh luôn xếp theo Chi, Thu, Transfer, Get In; cùng loại giữ thứ tự tạo. */
const QUICK_ORDER = ['expense', 'card', 'income', 'gop', 'trich'];
const sortQuicks = (list) => [...list].sort((a, b) => QUICK_ORDER.indexOf(a.type) - QUICK_ORDER.indexOf(b.type));
const myAccount = () => S.activeAccounts()[0];
const peerOf = (q) => q && q.peerId && S.getProfiles().find((p) => p.id === q.peerId && p.kind !== 'outflow');

function quickDesc(k, q) {
  if (!q) return 'Chưa thiết lập';
  const cat = q.categoryId && S.catById(q.categoryId);
  const peer = peerOf(q);
  if (k === 'gop') return peer ? `Transfer cho ${S.bookLabel(peer)}` : 'Chưa chọn người nhận';
  if (k === 'trich') return peer ? `Get In từ ${S.bookLabel(peer)}` : 'Chưa chọn nguồn';
  return [cat ? `${cat.icon} ${cat.name}` : 'Chưa chọn danh mục', q.note].filter(Boolean).join(' · ');
}

/** Bấm nút ⚡: chỉ nhập số tiền (và ngày nếu cần) rồi OK. */
actions['quick-run'] = async (el) => {
  const { id, book } = el.dataset;
  await inBook(book);
  const q = S.quicksOf().find((x) => x.id === id);
  if (!q) return;
  const k = q.type;
  const acc = myAccount();
  const peer = peerOf(q);
  if ((k === 'gop' || k === 'trich') && !peer) return toast('Mẫu chưa chọn người — sửa trong Cài đặt');
  if (k !== 'card' && !acc) return toast('Mục này chưa có tài khoản ngân hàng');
  const outgoing = k === 'expense' || k === 'gop';
  const formId = 'qr-' + Date.now();
  openSheet({
    title: `${QUICK_KINDS[k].icon} ${q.name}`,
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">OK</button>`,
    body: `<form class="form" id="${formId}">
      <p class="quick-info">${esc(quickDesc(k, q))}${k !== 'card' ? `<br><small>${outgoing ? 'Từ' : 'Vào'} tài khoản: ${esc(acc.name)}</small>` : ''}</p>
      ${amountLine({ dateId: 'qr-date', date: todayISO(), amtId: 'qr-amt', big: true, after: debtHintEl + pfField() })}
      <em class="hint" id="qr-bal"></em>
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'qr-amt');
      setTimeout(() => amt.focus(), 250);
      const curId = S.currentProfile().id;
      const pfc = bindPf(sh, q.pf || null, k !== 'card' && S.pfNeeded(curId, peer ? peer.id : null));
      const debtH = bindDebtHint(sh, amt, () => (k === 'gop' ? peer : k === 'trich' ? S.currentProfile() : null));
      // Số dư của tài khoản bị trừ tiền: mục này (Chi, Transfer) hoặc mục nguồn (Get In).
      let sourceHave = null;
      const upd = () => {
        const el = $(sh, '#qr-bal'), need = Math.round(readMoney(amt.value) || 0);
        if (outgoing) return balHint(el, { have: S.available(acc.id), need, bookId: S.currentProfile().id });
        if (k !== 'trich' || sourceHave == null) return;
        // Secrecy đang ẩn: không lộ số dư, chỉ báo khi không đủ tiền.
        if (peer.owner === S.SECRECY && S.secrecyHidden()) {
          el.textContent = need > sourceHave ? '⚠️ Số dư không đủ' : '';
          el.className = 'hint' + (need > sourceHave ? ' warn-red' : '');
          return;
        }
        balHint(el, { have: sourceHave, need, bookId: peer.id, who: ' của ' + S.bookLabel(peer) });
      };
      amt.addEventListener('input', upd);
      upd();
      if (k === 'trich') {
        S.peerAccounts(peer.id).then(async (accs) => {
          const from = q.peerAccountId || accs[0]?.id;
          sourceHave = await S.peerBalance(peer.id, from);
          upd();
        });
      }
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = Math.round(readMoney(amt.value));
        if (!(v > 0)) return toast('Nhập số tiền');
        if (debtH.error()) return toast('⛔ ' + debtH.error(), 4500);
        const pf = pfc.value();
        const date = $(sh, '#qr-date').value || todayISO();
        const base = { amount: v, currency: 'VND', rate: 1, amountVnd: v, date, tags: [], splits: null, photoIds: [], createdAt: Date.now(), quick: { id: q.id, name: q.name, type: k } };
        try {
          if (k === 'expense' || k === 'income') {
            if (k === 'expense' && !checkFunds(acc.id, v)) return;
            if (!await confirmOdTx(k, acc.id, v)) return;
            const crErr = S.creditError(k === 'income' ? v : -v);
            if (crErr) return toast('⛔ ' + crErr, 4500);
            const pfErr = pf ? await S.pfCheck({ pf, delta: k === 'income' ? v : -v }) : null;
            if (pfErr) return toast('⛔ ' + pfErr, 4500);
            const cat = S.catById(q.categoryId) || S.catsOf(k)[0];
            await S.put('transactions', { ...base, type: k, categoryId: cat?.id, accountId: acc.id, toAccountId: null, note: q.note || '', ...(pf ? { pf } : {}) });
          } else if (k === 'gop') {
            const toAcc = q.peerAccountId || (await S.peerAccounts(peer.id))[0]?.id;
            if (!await confirmOverdraft({ fromId: S.currentProfile().id, fromAccountId: acc.id, toId: peer.id, toAccountId: toAcc, amount: v })) return;
            await S.gop({ toProfileId: peer.id, amount: v, fromAccountId: acc.id, toAccountId: toAcc, date, note: q.note || '', flowCat: q.flowCat || null, pf, quick: base.quick });
          } else if (k === 'trich') {
            const fromAcc = q.peerAccountId || (await S.peerAccounts(peer.id))[0]?.id;
            if (!await confirmOverdraft({ fromId: peer.id, fromAccountId: fromAcc, toId: S.currentProfile().id, toAccountId: acc.id, amount: v })) return;
            await S.trich({ fromProfileId: peer.id, amount: v, fromAccountId: fromAcc, toAccountId: acc.id, date, note: q.note || '', flowCat: q.flowCat || null, pf, quick: base.quick });
          } else {
            const locked = S.lockError(S.currentProfile().id);
            if (locked) return toast(locked, 4500);
            await S.put('transactions', { ...base, type: 'expense', categoryId: q.categoryId, accountId: null, note: q.note || q.name || '', status: 'open' });
          }
        } catch (err) { return toast('⛔ ' + err.message, 4500); }
        close();
        toast(`${QUICK_KINDS[k].icon} Đã ghi ${fmt(v)} · ${q.name}`);
      });
    },
  });
};

/** Phần nút nhanh trong Cài đặt: công tắc ẩn/hiện, danh sách, nút tạo. */
function quickSettingsHtml() {
  const b = S.currentProfile();
  const max = S.QUICK_MAX[S.kindOfBook(b)];
  const list = sortQuicks(S.quicksOf().filter((q) => S.quickTypesFor(b).includes(q.type)));
  const open = state.settings.quickListOpen !== false;
  return `${sectionTitle(`⚡ Mẫu nhập nhanh <small class="muted">(${list.length}/${max})</small>`, `<label class="switch" title="Mở/thu gọn danh sách"><input type="checkbox" data-list-toggle="quickListOpen" ${open ? 'checked' : ''}><i></i></label>`)}
  ${open ? `<section class="card list">${list.map((q) => `<div class="row quick-row">
      <button type="button" class="grow-btn" data-act="quick-edit" data-id="${esc(q.id)}"><span class="ci">${QUICK_KINDS[q.type].icon}</span>
        <span class="grow"><b>${esc(q.name)}</b><small>${QUICK_KINDS[q.type].label} · ${esc(quickDesc(q.type, q))}</small></span><span>✎</span></button>
      <label class="switch" title="Hiện ở Tổng quan"><input type="checkbox" data-quick-show="${esc(q.id)}" ${q.show !== false ? 'checked' : ''}><i></i></label></div>`).join('')}
    ${list.length < max ? '<button type="button" class="row add-row" data-act="quick-new"><span class="ci">＋</span><span class="grow"><b>Tạo nút nhanh</b></span></button>' : ''}
  </section>` : ''}`;
}

actions['quick-new'] = () => {
  const b = S.currentProfile();
  const types = S.quickTypesFor(b);
  if (S.quicksOf().filter((q) => types.includes(q.type)).length >= S.QUICK_MAX[S.kindOfBook(b)]) return toast('Đã đủ số nút nhanh tối đa');
  if (types.length === 1) return actions['quick-edit']({ dataset: { type: types[0] } });
  openSheet({
    title: 'Tạo nút nhanh',
    body: `<div class="card list">${types.map((t) => `<button type="button" class="row" data-new="${t}"><span class="ci">${QUICK_KINDS[t].icon}</span><span class="grow"><b>${QUICK_KINDS[t].label}</b></span>›</button>`).join('')}</div>`,
    onMount(sh, close) {
      sh.addEventListener('click', (e) => {
        const x = e.target.closest('[data-new]');
        if (x) { close(); actions['quick-edit']({ dataset: { type: x.dataset.new } }); }
      });
    },
  });
};

actions['quick-edit'] = (el) => {
  const existing = S.quicksOf().find((x) => x.id === el.dataset.id);
  const q = existing ? { ...existing } : { type: el.dataset.type, name: '' };
  const k = q.type;
  const isPeer = k === 'gop' || k === 'trich';
  // Secrecy đang ẩn thì không hiện để chọn mới, nhưng giữ mục mẫu đã chọn trước đó.
  const others = isPeer ? otherProfiles(k) : [];
  if (isPeer && peerOf(q) && !others.some((p) => p.id === q.peerId)) others.push(peerOf(q));
  if (isPeer && !others.length) return toast('Cần có thêm mục khác để thiết lập nút này');
  const catType = k === 'income' ? 'income' : 'expense';
  const cats = S.catsOf(catType).filter((c) => !/^(gop|trich)/.test(c.sys || ''));
  const formId = 'qe-' + Date.now();
  openSheet({
    title: `${QUICK_KINDS[k].icon} Nút nhanh ${QUICK_KINDS[k].label}`,
    headAction: `<button type="submit" form="${formId}" class="btn primary small head-save">Lưu</button>`,
    body: `<form class="form" id="${formId}">
      ${field('Tên nút (tối đa 12 ký tự)', `<input id="qe-name" required maxlength="12" value="${esc(q.name || '')}" placeholder="vd: Ăn trưa">`)}
      ${isPeer ? `${field(k === 'gop' ? 'Transfer cho' : 'Get In từ', `<select id="qe-peer">${byUser(others).map((g) => `<optgroup label="${esc(g.label)}">${g.books.map((p) => `<option value="${esc(p.id)}" ${p.id === q.peerId ? 'selected' : ''}>${esc(p.icon + ' ' + p.name)}</option>`).join('')}</optgroup>`).join('')}</select>`)}
        ${field(k === 'gop' ? 'Vào tài khoản của người nhận' : 'Từ tài khoản nguồn', '<select id="qe-pacc" data-acc><option></option></select>')}
        ${flowCatField('qe-fcat', q.flowCat || '')}`
        : field('Danh mục', `<select id="qe-cat" class="cat-select">${cats.map((c) => `<option value="${c.id}" ${c.id === q.categoryId ? 'selected' : ''}>${esc(c.icon + '  ' + c.name)}</option>`).join('')}</select>`)}
      ${pfField()}
      ${field('Ghi chú (không bắt buộc)', `<input id="qe-note" value="${esc(q.note || '')}" placeholder="Ghi chú tự điền vào giao dịch">`)}
      ${k !== 'card' && myAccount() ? `<p class="muted small">Tài khoản của mục này: <b>${esc(myAccount().name)}</b></p>` : ''}
      ${existing ? '<div class="actions"><button type="button" class="btn danger" data-del>Xóa nút</button></div>' : ''}
    </form>`,
    onMount(sh, close) {
      const loadPeerAcc = async () => {
        const sel = $(sh, '#qe-pacc');
        if (!sel) return;
        const accs = await S.peerAccounts($(sh, '#qe-peer').value);
        sel.innerHTML = accs.map((a) => `<option value="${a.id}" ${a.id === q.peerAccountId ? 'selected' : ''}>${esc(a.icon + ' ' + a.name)}</option>`).join('');
      };
      const curId = S.currentProfile().id;
      const pfNeed = () => k !== 'card' && S.pfNeeded(curId, isPeer ? $(sh, '#qe-peer').value : null);
      const pfc = bindPf(sh, q.pf || null, pfNeed());
      $(sh, '#qe-peer')?.addEventListener('change', () => { pfc.setNeeded(pfNeed()); loadPeerAcc(); });
      loadPeerAcc();
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = $(sh, '#qe-name').value.trim();
        if (!name) return toast('Nhập tên nút');
        const out = { id: q.id || 'q' + Date.now(), type: k, pf: pfc.value(), name, note: $(sh, '#qe-note').value.trim(), show: q.show !== false };
        if (isPeer) { out.peerId = $(sh, '#qe-peer').value; out.peerAccountId = $(sh, '#qe-pacc').value || null; out.flowCat = $(sh, '#qe-fcat').value || null; }
        else out.categoryId = $(sh, '#qe-cat').value;
        const list = S.quicksOf();
        await saveQuicks(existing ? list.map((x) => (x.id === out.id ? out : x)) : [...list, out]);
        close(); toast('Đã lưu nút nhanh');
      });
      $(sh, '[data-del]')?.addEventListener('click', async () => {
        await saveQuicks(S.quicksOf().filter((x) => x.id !== q.id));
        close(); toast('Đã xóa nút');
      });
    },
  });
};

// ================= Secrecy: NEOBANK & Cash Outflow =================
// NEOBANK: tài khoản ảo có số dư chỉnh tay, các mục Ngân hàng có thể Get In tiền về.
// Cash Outflow: nơi nhận tiền Transfer từ các mục Ngân hàng. Ẩn thì không hiện thông tin, nhưng Transfer/Get In vẫn dùng được.
function secrecyHtml() {
  const hidden = S.secrecyHidden();
  const head = sectionTitle('🔐 Secrecy', `<label class="switch" title="Hiện mục Secrecy"><input type="checkbox" data-secrecy-toggle ${hidden ? '' : 'checked'}><i></i></label>`);
  if (hidden) return `${head}<p class="muted small">Đang ẩn: không hiện ở đây và trong form Transfer/Get In. Các mẫu nhanh đã thiết lập với NEOBANK vẫn hoạt động. Bật công tắc để xem.</p>`;
  return `${head}${['neo'].map((kind) => {
    const k = S.BOOK_KINDS[kind];
    const list = S.secrecyBooks(kind);
    return `<h4 class="grp-h">${k.icon} ${k.label} <small>(${list.length}/${k.max})</small></h4>
    <section class="card list">${list.map((b) => `
      <div class="row book-row">
        <button type="button" class="grow-btn" data-act="secrecy-edit" data-id="${esc(b.id)}">${avatar(b)}
          <span class="grow"><b>${esc(b.name)}</b><small>${kind === 'neo' ? 'Bấm để chỉnh số dư' : 'Tổng tiền đã nhận transfer'}</small></span>
          <span class="psum" data-psum="${esc(b.id)}">…</span></button>
        <button type="button" class="icon-btn" data-act="secrecy-del" data-id="${esc(b.id)}" aria-label="Xóa">🗑</button>
      </div>`).join('') || `<p class="muted small" style="padding:8px 14px">Chưa có NEOBANK.</p>`}
      ${list.length < k.max ? `<button type="button" class="row add-row" data-act="secrecy-add" data-kind="${kind}"><span class="ci">＋</span><span class="grow"><b>Thêm ${k.label}</b></span></button>` : ''}
    </section>`;
  }).join('')}
  <p class="muted small">🏧 NEOBANK: chỉ Account của User đặc biệt giao dịch được, dùng <b>Transfer</b> để gửi tiền vào và <b>Get In</b> để lấy tiền về.</p>`;
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
      <p class="muted small">${neo ? 'Số dư chỉnh tay bất kỳ lúc nào. Account của User đặc biệt transfer vào sẽ cộng, Get In về sẽ trừ vào số dư này.' : 'Nhận tiền Transfer từ các mục Ngân hàng, không có chức năng khác.'}</p>
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
/** User đang chọn xem trong Cài đặt chung. */
function settingsUser() {
  const users = S.getUsers();
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
  <section class="card list">${S.getUsers().map((u) => `
    <button type="button" class="row user-pick ${u.id === settingsUser().id ? 'picked' : ''} ${u.id === S.currentUser().id ? 'is-current' : ''}" data-act="settings-user" data-id="${esc(u.id)}" style="--c:${esc(u.color)}">
      ${avatar(u)}<span class="grow"><b>${esc(u.name)}</b>
      <small>${u.id === S.currentUser().id ? 'Đang dùng' : 'Bấm để xem các mục'}</small></span>
      <span class="psum" data-usum="${esc(u.id)}">…</span>${u.id === settingsUser().id ? '<span class="pick-dot">●</span>' : '›'}</button>`).join('')}
  </section>
  <p class="muted small">Chọn User để xem các mục của người đó ở phần bên dưới.</p>

  ${sectionTitle(`Các mục của ${esc(settingsUser().name)}`, `<button type="button" class="link" data-act="books">Quản lý</button>`)}
  ${[settingsUser()].map((u) => `
  <section class="card list">${S.userBooks(u.id).map((p) => `
    <div class="row book-row ${p.locked ? 'is-locked' : ''} ${p.id === S.currentProfile().id ? 'is-current' : ''}">
      <button type="button" class="grow-btn" data-act="profile-switch" data-id="${esc(p.id)}">
        ${avatar(p)}<span class="grow"><b>${esc(p.name)}${p.locked ? ' 🔒' : ''}</b>
        <small>${esc(kindOf(p).label)} · ${p.id === S.currentProfile().id ? 'Đang mở' : 'Bấm để mở'}</small></span>
        <span class="psum" data-psum="${esc(p.id)}">…</span></button>
      ${p.kind === 'card' ? `<button type="button" class="lock-btn ${p.locked ? 'on' : ''}" data-act="book-lock" data-id="${esc(p.id)}"
        aria-label="${p.locked ? 'Mở khóa' : 'Khóa'}">${p.locked ? '🔒<small>Đang khóa</small>' : '🔓<small>Mở</small>'}</button>` : ''}
    </div>`).join('')}
  </section>`).join('')}
  <p class="muted small">Thẻ trả trước bị khóa thì không ghi khoản chi mới.</p>

  ${txIconSettingsHtml()}

  ${secrecyHtml()}

  ${sectionTitle('Bảo mật')}
  <section class="card form">
    <div class="row-between"><span>Khóa app bằng mật khẩu<br><small class="${lockConfig().enabled && isDefaultPin() ? 'expense' : 'muted'}">${!lockConfig().enabled ? 'Đang tắt' : isDefaultPin() ? `Đang dùng mật khẩu mặc định ${DEFAULT_PIN} — nên đổi` : 'Đang bật'}</small></span>
      <label class="switch"><input type="checkbox" data-lock-toggle ${lockConfig().enabled ? 'checked' : ''}><i></i></label></div>
    ${lockConfig().enabled ? `${field('Tự khóa khi rời app', `<select data-lock-delay>${[[0, 'Ngay lập tức'], [60, 'Sau 1 phút'], [300, 'Sau 5 phút'], [900, 'Sau 15 phút']].map(([v, l]) => `<option value="${v}" ${Number(lockConfig().delay) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
    <button type="button" class="btn ghost" data-act="pin-change">🔑 Đổi mật khẩu</button>` : ''}
    <p class="muted small">Mật khẩu dùng chung cho mọi người dùng trên máy này. Quên mật khẩu sẽ không mở được app, hãy ghi nhớ kỹ và sao lưu dữ liệu định kỳ.</p>
  </section>

  ${S.isCard() ? '' : `${sectionTitle('Nhắc nhở')}
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
    <button type="button" class="row" data-act="backup-pick"><span class="ci">📁</span><span class="grow"><b>Nơi lưu file sao lưu tự động</b><small data-save-status>${esc(saveStatusText())}</small></span>›</button>
    <button type="button" class="row" data-act="backup"><span class="ci">💾</span><span class="grow"><b>Sao lưu tất cả (file .json)</b><small>Mọi người dùng + thẻ trả trước · ${s.lastBackup ? 'lần cuối ' + fmtDate(s.lastBackup) : 'chưa sao lưu lần nào'}</small></span>›</button>
    <label class="row"><span class="ci">♻️</span><span class="grow"><b>Khôi phục từ bản sao lưu</b><small>Thay thế toàn bộ người dùng, thẻ và giao dịch</small></span>›<input type="file" accept=".json,application/json" data-act-change="restore" hidden></label>
    <button type="button" class="row" data-act="export-csv-all"><span class="ci">📄</span><span class="grow"><b>Xuất Excel (CSV) toàn bộ giao dịch</b></span>›</button>
    <button type="button" class="row danger" data-act="wipe"><span class="ci">🗑️</span><span class="grow"><b>Xóa toàn bộ dữ liệu của ${esc(S.bookLabel(S.currentProfile()))}</b><small>Sổ của người khác giữ nguyên</small></span></button>
  </section>
  ${s.lastBackup && diffDays(s.lastBackup, todayISO()) < 30 ? '' : '<p class="muted small center">⚠️ Dữ liệu chỉ nằm trên máy này. Nên sao lưu định kỳ (lưu vào iCloud Drive / Google Drive / Zalo "Cloud của tôi").</p>'}
  <p class="muted small center" id="storage-info"></p>
  <p class="muted small center">Sổ Thu Chi · chạy offline · dữ liệu không rời khỏi điện thoại của bạn</p>`;
}

// ================= Cài đặt riêng của mục (tab ⚙️ ở thanh dưới) =================
actions['card-remind-save'] = async () => {
  const raw = document.querySelector('#cr-day').value.trim();
  const time = document.querySelector('#cr-time').value || S.ALERT_TIME;
  if (!raw) { await S.setSetting('cardRemind', null); return toast('Đã tắt nhắc trích trả nợ'); }
  const day = Number(raw);
  if (!Number.isInteger(day) || day < 1 || day > 31) return toast('Ngày phải từ 1 đến 31');
  await S.setSetting('cardRemind', { day, time });
  toast(`Sẽ nhắc lúc ${time} ngày ${day} hằng tháng`);
};

/** Cài đặt riêng: bật/tắt 4 tính năng (Bank, Thấu chi) và cho phép trừ tiền (Bank, Thấu chi, Tiết kiệm). */
function txPermHtml(p) {
  if (p.credit) return '';
  const features = S.kindOfBook(p) === 'bank' ? `${sectionTitle('Tính năng giao dịch')}
  <section class="card form">${S.TX_FEATURES.map((f) => `<div class="row-between"><span>${QUICK_KINDS[f].icon} ${QUICK_KINDS[f].label}</span>
      <label class="switch"><input type="checkbox" data-feature="${f}" ${S.featureOn(p, f) ? 'checked' : ''}><i></i></label></div>`).join('')}
    <p class="muted small">Tắt thì mục này không tạo được giao dịch loại đó, nút nhanh cùng loại cũng ẩn. Giao dịch đã có vẫn giữ.</p>
  </section>` : '';
  return `${features}${sectionTitle('Tiền ra')}
  <section class="card form">
    <div class="row-between"><span>Cho phép trừ tiền khỏi tài khoản</span>
      <label class="switch"><input type="checkbox" data-allow-out ${p.locked ? '' : 'checked'}><i></i></label></div>
    <p class="muted small">Tắt thì không chi, transfer, trả nợ, trả thẻ hay bị Get In từ mục này được. Tiền vào vẫn nhận bình thường.</p>
  </section>`;
}

function bookSettingsView() {
  const s = state.settings;
  const p = S.currentProfile();
  let body;
  if (S.isCard()) {    body = `${sectionTitle('Danh mục của thẻ')}
    <section class="card list">
      <button type="button" class="row" data-act="categories"><span class="ci">🗂️</span><span class="grow"><b>Danh mục chi</b><small>${state.categories.filter((c) => !c.archived && c.type === 'expense').length} danh mục</small></span>›</button>
    </section>
    ${sectionTitle('🔔 Nhắc trích trả nợ')}
    <section class="card form">
      <div class="two">${field('Ngày trong tháng', `<input type="number" id="cr-day" min="1" max="31" inputmode="numeric" placeholder="Đang tắt" value="${esc(s.cardRemind?.day || '')}">`)}
      ${alertTimeField('cr-time', s.cardRemind?.time)}</div>
      <button type="button" class="btn primary" data-act="card-remind-save">Lưu</button>
      <p class="muted small">Đến ngày giờ này mỗi tháng, Notifications nhắc trích trả các khoản chưa thanh toán của <b>các tháng trước</b>, không tính tháng hiện tại, đến khi trả hết. Tháng không đủ ngày thì nhắc vào ngày cuối tháng. Để trống ngày là tắt.</p>
    </section>
    ${quickSettingsHtml()}`;
  } else {
    body = `${txPermHtml(p)}${sectionTitle('Hiển thị')}
    <section class="card form">
      ${[['showReports', '📊 Hiện mục Báo cáo'], ['showPlan', '🎯 Hiện mục Kế hoạch']].map(([k, label]) => `
      <div class="row-between"><span>${label}</span>
        <label class="switch"><input type="checkbox" data-tab-toggle="${k}" ${s[k] !== false ? 'checked' : ''}><i></i></label></div>`).join('')}
      <p class="muted small">Tắt để ẩn khỏi thanh dưới cùng của mục này. Dữ liệu ngân sách, mục tiêu, trả nợ vẫn được giữ. Khi mở mục, app luôn xem mặc định theo <b>Ngày</b>.</p>
    </section>

    ${quickSettingsHtml()}

    ${S.isSpecialBook(p) ? pfSettingsHtml() : ''}
    ${statSettingsHtml()}

    ${sectionTitle('Tài khoản ngân hàng')}
    <section class="card list">${S.activeAccounts().map((a) => {
      const b = S.accountBalance(a);
      return `<button type="button" class="row" data-act="acc-edit" data-id="${a.id}"><span class="ci" style="--c:#3e63dd">${esc(a.icon)}</span><span class="grow"><b>${esc(a.name)}</b><small>${esc(accSub(a))}</small></span><span class="amt ${b < 0 ? 'expense' : ''}">${fmt(b)}</span></button>`;
    }).join('')}
    ${canAddAccount() ? `<button type="button" class="row add-row" data-act="acc-edit"><span class="ci">＋</span><span class="grow"><b>Thêm tài khoản ngân hàng</b></span></button>` : ''}</section>

    ${sectionTitle('Dữ liệu nền')}
    <section class="card list">
      <button type="button" class="row" data-act="categories"><span class="ci">🗂️</span><span class="grow"><b>Danh mục thu chi</b><small>${state.categories.filter((c) => !c.archived).length} danh mục</small></span>›</button>
    </section>

    ${sectionTitle('Phân bổ thu nhập & quỹ dự phòng')}
    <section class="card form">
      ${field('Phương pháp', `<select data-set="method"><option value="none" ${s.method === 'none' ? 'selected' : ''}>Không dùng</option>${Object.entries(S.METHODS).map(([k, m]) => `<option value="${k}" ${s.method === k ? 'selected' : ''}>${m.name}</option>`).join('')}</select>`)}
      ${field('Thu nhập dự kiến/tháng (dùng khi chưa ghi khoản thu)', moneyBox(`<input class="money" inputmode="decimal" data-set="expectedIncome" data-money value="${s.expectedIncome ? fmtNum(s.expectedIncome) : ''}" placeholder="vd: 15tr">`))}
      ${field('Quỹ dự phòng = số tháng chi tiêu', `<select data-set="emergencyMonths" data-num>${[3, 4, 6, 9, 12].map((n) => `<option value="${n}" ${Number(s.emergencyMonths) === n ? 'selected' : ''}>${n} tháng</option>`).join('')}</select>`)}
      <p class="muted small">Gán nhóm 50/30/20 hoặc lọ JARS cho từng danh mục trong "Danh mục thu chi".</p>
    </section>`;
  }
  return `${topBar(`⚙️ Cài đặt riêng của ${esc(kindOf(p).label)}`)}${body}`;
}

actions['close-settings'] = () => { location.hash = '#/home'; };

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
  root.querySelectorAll('[data-feature]').forEach((el) => el.addEventListener('change', () => {
    S.setFeature(S.currentProfile().id, el.dataset.feature, el.checked);
  }));
  root.querySelector('[data-allow-out]')?.addEventListener('change', (e) => {
    S.setLocked(S.currentProfile().id, !e.target.checked);
    toast(e.target.checked ? 'Đã cho phép trừ tiền' : 'Đã tắt trừ tiền khỏi tài khoản này');
  });
  root.querySelectorAll('[data-list-toggle]').forEach((el) => el.addEventListener('change', () => S.setSetting(el.dataset.listToggle, el.checked)));
  root.querySelectorAll('[data-quick-show]').forEach((el) => el.addEventListener('change', async () => {
    await S.setSetting('quicks', S.quicksOf().map((q) => (q.id === el.dataset.quickShow ? { ...q, show: el.checked } : q)));
    toast(el.checked ? 'Đã hiện nút ở Tổng quan' : 'Đã ẩn nút khỏi Tổng quan');
  }));
  root.querySelectorAll('[data-tab-toggle]').forEach((el) => el.addEventListener('change', async () => {
    await S.setSetting(el.dataset.tabToggle, el.checked);
    toast(el.checked ? 'Đã hiện mục' : 'Đã ẩn mục');
  }));
  root.querySelectorAll('[data-stat-show]').forEach((el) => el.addEventListener('change', async () => {
    await S.setSetting('stats', S.statsOf().map((x) => (x.id === el.dataset.statShow ? { ...x, show: el.checked } : x)));
    toast(el.checked ? 'Đã hiện ở Tổng quan' : 'Đã ẩn khỏi Tổng quan');
  }));
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
      ? `Khôi phục sẽ THAY THẾ TOÀN BỘ người dùng, thẻ trả trước và giao dịch trên máy này bằng bản sao lưu ngày ${fmtDate(String(data.exportedAt || '').slice(0, 10))} (${(data.profiles || []).length} người dùng/thẻ). Tiếp tục?`
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

// ----- File sao lưu tự động + nút Save nhanh -----
const saveStatusText = () => {
  const st = saveStatus();
  return st ? `${st.name} · lưu lúc ${fmtDateTimeVN(st.at)}` : `Chưa lưu · file ${AUTO_FILE_NAME}`;
};
const showSaveStatus = (root) => root.querySelectorAll('[data-save-status]').forEach((el) => { el.textContent = saveStatusText(); });
const fail = (err) => { if (err.name !== 'AbortError') toast('⛔ Không lưu được: ' + err.message, 4500); };

/** iPhone/Android: chuẩn bị xong mới hiện nút, vì iOS chỉ mở bảng Chia sẻ ngay sau một lần chạm. */
async function shareBackupSheet(root) {
  const file = new File([await backupJson()], AUTO_FILE_NAME, { type: 'application/json' });
  openSheet({
    title: '💾 Lưu file sao lưu',
    body: `<p>Điện thoại không cho app tự ghi vào file. Bấm nút dưới, chọn <b>Lưu vào Tệp</b>, chọn thư mục rồi bấm <b>Thay thế</b> nếu đã có file ${AUTO_FILE_NAME}.</p>
      <div class="actions"><button type="button" class="btn primary" data-go>📤 Lưu file</button></div>`,
    onMount(sh, close) {
      $(sh, '[data-go]').addEventListener('click', async () => {
        try {
          if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: AUTO_FILE_NAME });
          else download(AUTO_FILE_NAME, file);
          markSaved(AUTO_FILE_NAME);
          showSaveStatus(root);
          close(); toast('💾 Đã gửi file sao lưu');
        } catch (err) { fail(err); }
      });
    },
  });
}

actions['backup-pick'] = async (el) => {
  const root = el.closest('#main') || document;
  if (!canPickFile()) return shareBackupSheet(root);
  try {
    const name = await pickBackupFile();
    showSaveStatus(root);
    toast('💾 Đã tạo file sao lưu: ' + name);
  } catch (err) { fail(err); }
};

async function quickSave(root) {
  if (!canPickFile()) return shareBackupSheet(root);
  try {
    const name = await saveToPickedFile() || await pickBackupFile();
    showSaveStatus(root);
    toast('💾 Đã lưu vào ' + name);
  } catch (err) { fail(err); }
}

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

/** Mỗi mục Ngân hàng / Đầu tư chỉ gắn 1 tài khoản ngân hàng. */
const canAddAccount = () => S.activeAccounts().length < 1;

function accountForm(a) {
  if (!a && !canAddAccount()) return toast('Mỗi mục chỉ gắn 1 tài khoản ngân hàng. Muốn thêm tài khoản khác, hãy tạo mục Ngân hàng mới.', 4000);
  const f = a ? { ...a } : { name: '', bank: '', number: '', holder: '', icon: '🏦', kind: 'bank', initial: 0, order: state.accounts.length };
  const used = a && state.transactions.some((t) => t.accountId === a.id || t.toAccountId === a.id);
  const curBal = a ? S.accountBalance(a) : 0;
  const od = !!S.currentProfile().overdraft || S.isSpecialBook(S.currentProfile()) || !!S.currentProfile().credit;
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
      ${od ? `<div class="kv"><span>Số dư hiện tại</span><b>${fmt(curBal)}</b></div><p class="muted small">Không sửa được số dư ở đây. Muốn đổi: ${S.isSpecialBook(S.currentProfile()) ? 'dùng Reset trong Cài đặt' : 'xóa mục này rồi tạo lại'}.</p>`
        : amountField('af-bal', curBal, a ? 'Số dư hiện tại (sửa nếu lệch với app ngân hàng)' : 'Số dư hiện tại')}
      <div class="actions">${a && !od ? `<button type="button" class="btn danger" data-del>${used ? (a.archived ? 'Hiện lại' : 'Ẩn tài khoản') : 'Xóa'}</button>` : ''}<button class="btn primary">Lưu</button></div>
    </form>`,
    onMount(sh, close) {
      const bal = od ? null : bindMoney(sh, 'af-bal');
      if (!a && bal) bal.value = '';
      $(sh, '[data-copy]')?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(f.number.replace(/\s/g, '')); toast('Đã chép số tài khoản'); } catch { toast('Không sao chép được'); }
      });
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const bank = $(sh, '#af-bank').value.trim();
        if (!bank) return toast('Nhập tên ngân hàng');
        const number = $(sh, '#af-num').value.replace(/[^\d\s]/g, '').trim();
        const v = od ? curBal : bal.value.trim() ? readMoney(bal.value) : 0;
        if (!Number.isFinite(v) || (v < 0 && !od)) return toast('Số dư phải là số không âm');
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
    <div class="list">${state.categories.filter((c) => c.type === tab).sort((a, b) => (!!a.archived - !!b.archived) || (a.order ?? 0) - (b.order ?? 0)).map((c) => {
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
        await S.put('categories', { ...f, name: $(sh, '#cf-name').value.trim(), icon: f.icon || '🏷️', rule: $(sh, '#cf-rule')?.value || f.rule, jar: $(sh, '#cf-jar')?.value || f.jar });
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
  home: { html: homeView, mount: fillOverview },
  tx: { html: () => (S.isCard() ? cardView() : txView()), mount: (root) => { if (!S.isCard()) mountTx(root); } },
  reports: { html: reportsView },
  plan: { html: planView },
  settings: { html: settingsView, mount: mountSettings },
  bookset: { html: bookSettingsView, mount: mountSettings },
};

let current = { route: 'home', sub: null };

// Phần đầu đứng yên khi cuộn, tính đến hết phần tử đánh dấu của từng màn hình.
const PIN_END = { home: '.seg.tabs', tx: '.period > .seg', reports: '.period > .seg', plan: '.seg.tabs' };
function splitPinned(box, route) {
  const moveUntil = (stop) => {
    const out = [];
    while (box.firstChild && box.firstChild !== stop) { out.push(box.firstChild); box.firstChild.remove(); }
    return out;
  };
  // Cài đặt của mục: giữ đến ngay trên tiêu đề nhóm đầu tiên (Tính năng giao dịch).
  if (route === 'bookset') {
    const first = box.querySelector(':scope > .sec-h');
    return first ? moveUntil(first) : null;
  }
  const end = PIN_END[route] && box.querySelector(PIN_END[route]);
  if (!end) return null;
  if (end.parentElement === box) return moveUntil(end.nextSibling);
  // Dòng Ngày/Tuần/Tháng nằm đầu thanh kỳ: đưa riêng dòng đó lên, phần chọn ngày cuộn theo nội dung.
  const nodes = moveUntil(end.parentElement);
  end.classList.add('period-seg');
  nodes.push(end);
  return nodes;
}
/** Thay nội dung màn hình; khung phần đầu được giữ lại giữa các lần vẽ để không chớp trên iPhone. */
function paintMain(main, html, route) {
  const box = document.createElement('div');
  box.innerHTML = html;
  const pinned = splitPinned(box, route);
  let head = main.querySelector(':scope > .pin-head');
  if (pinned) {
    if (!head) { head = document.createElement('div'); head.className = 'pin-head'; main.prepend(head); }
    head.replaceChildren(...pinned);
  } else if (head) { head.remove(); head = null; }
  [...main.childNodes].forEach((n) => { if (n !== head) n.remove(); });
  main.append(...box.childNodes);
}

/** Mục bị ẩn theo cài đặt của người dùng hiện tại. */
const hiddenTabs = () => {
  const s = state.settings;
  // Thẻ trả trước: chỉ Giao dịch + ⚙️ Cài đặt riêng.
  if (S.isCard()) return new Set(['reports', 'plan']);
  if (S.currentProfile().credit) return new Set(['plan']);
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
  // Tổng quan và Cài đặt chung không dùng thanh dưới; thanh dưới là của màn hình từng mục.
  document.body.classList.toggle('no-tabbar', route === 'home' || route === 'settings' || !VIEWS[route]);
  const sameView = current.route === route && current.sub === sub;
  current = { route: VIEWS[route] ? route : 'home', sub };
  const v = VIEWS[current.route];
  const main = document.getElementById('main');
  const y = window.scrollY;
  paintMain(main, v.html(sub), current.route);
  restoreTop(main);
  v.mount && v.mount(main);
  fillTopBar(main).catch((err) => console.warn(err));
  restorePageScroll(sameView, y);
  document.querySelectorAll('#tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === current.route));
}

export function refresh() {
  render(current.route, current.sub);
}
