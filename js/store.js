// Trạng thái app + nghiệp vụ: số dư, tổng hợp, định kỳ, trả nợ, ngân sách, mục tiêu, sao lưu.
import { db, dbOf, STORES, useProfile, dropProfile } from './db.js';
import { uid, todayISO, addDays, addMonths, diffDays, getRange, nextDate, fmt, fmtTimeVN } from './utils.js';

const LIST = STORES.filter((s) => s !== 'settings' && s !== 'photos');

export const state = { accounts: [], categories: [], transactions: [], recurring: [], budgets: [], goals: [], debts: [], settings: {} };

export const DEFAULT_SETTINGS = {
  period: 'month',
  weekStart: 1,
  method: 'none',
  expectedIncome: 0,
  remindDays: 3,
  notify: false,
  emergencyMonths: 6,
  dailyTime: '21:00',
  currencies: [{ code: 'VND', rate: 1 }, { code: 'USD', rate: 26000 }],
  lastCat: {},
  lastAccount: null,
  notified: {},
};

export const PALETTE = ['#e5484d', '#f76b15', '#ffb224', '#30a46c', '#12a594', '#0091ff', '#3e63dd', '#8e4ec6', '#d6409f', '#978365', '#6f6e77', '#0d74ce', '#46a758', '#94ba2c', '#ab4aba', '#6e56cf', '#ad7f58', '#f5a524'];

export const METHODS = {
  '503020': {
    name: '50/30/20', field: 'rule',
    groups: [
      { key: 'needs', name: 'Thiết yếu', pct: 50 },
      { key: 'wants', name: 'Mong muốn', pct: 30 },
      { key: 'savings', name: 'Tiết kiệm & trả nợ', pct: 20 },
    ],
  },
  jars: {
    name: '6 chiếc lọ (JARS)', field: 'jar',
    groups: [
      { key: 'NEC', name: 'Thiết yếu (NEC)', pct: 55 },
      { key: 'FFA', name: 'Tự do tài chính (FFA)', pct: 10 },
      { key: 'LTSS', name: 'Tiết kiệm dài hạn (LTSS)', pct: 10 },
      { key: 'EDU', name: 'Giáo dục (EDU)', pct: 10 },
      { key: 'PLAY', name: 'Hưởng thụ (PLAY)', pct: 10 },
      { key: 'GIVE', name: 'Cho đi (GIVE)', pct: 5 },
    ],
  },
};

const SEED_EXPENSE = [
  ['Ăn uống', '🍜', 'needs', 'NEC'],
  ['Đi lại', '🛵', 'needs', 'NEC'],
  ['Nhà ở', '🏠', 'needs', 'NEC'],
  ['Điện nước & Internet', '💡', 'needs', 'NEC'],
  ['Sức khỏe', '💊', 'needs', 'NEC'],
  ['Gia đình & Con cái', '👨‍👩‍👧', 'needs', 'NEC'],
  ['Mua sắm', '🛍️', 'wants', 'PLAY'],
  ['Giải trí & Du lịch', '🎬', 'wants', 'PLAY'],
  ['Giáo dục', '📚', 'needs', 'EDU'],
  ['Hiếu hỉ & Quà tặng', '🎁', 'wants', 'GIVE'],
  ['Trả nợ ngân hàng', '🏦', 'savings', 'NEC', 'debt'],
  ['Tiết kiệm', '🐷', 'savings', 'LTSS', 'saving'],
  ['Đầu tư', '📈', 'savings', 'FFA'],
  ['Transfer cho người nhà', '🤝', 'needs', 'NEC', 'gop-out'],
  ['Khác', '📦', 'wants', 'PLAY'],
];
const SEED_INCOME = [
  ['Lương', '💰'], ['Thưởng', '🎉'], ['Kinh doanh', '💼'], ['Lãi tiết kiệm/Đầu tư', '📈'], ['Được tặng', '🎁'],
  ['Nhận transfer', '🤝', 'gop-in'], ['Thu khác', '➕'],
];
// Danh mục hệ thống cần có ở mọi sổ (kể cả sổ tạo từ bản cũ).
const SYS_CATS = {
  'gop-out': { type: 'expense', name: 'Transfer cho người nhà', icon: '🤝', rule: 'needs', jar: 'NEC', color: '#12a594' },
  'gop-in': { type: 'income', name: 'Nhận transfer', icon: '🤝', color: '#12a594' },
  'trich-in': { type: 'income', name: 'Get In', icon: '🔄', color: '#8e4ec6' },
  'trich-out': { type: 'expense', name: 'Chuyển Get In', icon: '🔄', rule: 'needs', jar: 'NEC', color: '#8e4ec6' },
};

function seedRows() {
  return {
    cats: [
      ...SEED_EXPENSE.map(([name, icon, rule, jar, sys], i) => ({ id: uid(), type: 'expense', name, icon, rule, jar, sys: sys || null, color: PALETTE[i % PALETTE.length], order: i })),
      ...SEED_INCOME.map(([name, icon, sys], i) => ({ id: uid(), type: 'income', name, icon, sys: sys || null, color: PALETTE[(i + 3) % PALETTE.length], order: i })),
    ],
    accs: [
      { id: uid(), name: 'Tài khoản chính', bank: '', number: '', holder: '', icon: '🏦', kind: 'bank', initial: 0, order: 0 },
    ],
  };
}

/** Bổ sung danh mục hệ thống còn thiếu vào danh sách `cats` của một sổ; trả về các danh mục mới tạo. */
function missingSysCats(cats) {
  return Object.entries(SYS_CATS)
    .filter(([sys]) => !cats.some((c) => c.sys === sys))
    .map(([sys, c]) => ({ id: uid(), ...c, sys, order: 99 }));
}

// ---------- Thông báo thay đổi ----------
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
export const emit = () => listeners.forEach((f) => f());

// ---------- Người dùng & mục ----------
// Người dùng (tối đa 3) lưu ở "stc-users". Mỗi người dùng có nhiều MỤC (sổ) thuộc 3 loại:
// Ngân hàng, Đầu tư (sổ thu/chi có tài khoản) và Thẻ trả trước. Danh sách mục lưu ở "stc-profiles";
// mỗi mục có database riêng. "Profile" trong code = một mục.
const PROFILES_KEY = 'stc-profiles';
const USERS_KEY = 'stc-users';
const CURRENT_KEY = 'stc-current';
// User (tối đa 3): Bank (3), Thấu chi (2), Tiết kiệm (2), Thẻ tín dụng (5). User đặc biệt: 1 Bank, 1 Thấu chi.
// Ngoài ra có nhóm "Secrecy" (owner = 'secrecy', quản lý trong Cài đặt chung): NEOBANK.
export const MAX_USERS = 3;
export const SECRECY = 'secrecy';
export const USER_KINDS = ['bank', 'saving', 'card'];
export const PROFILE_COLORS = [
  '#1f6feb', '#0d74ce', '#0091ff', '#12a594', '#30a46c', '#46a758', '#94ba2c', '#ffb224', '#f5a524', '#f76b15',
  '#e5484d', '#d6409f', '#ab4aba', '#8e4ec6', '#6e56cf', '#3e63dd', '#978365', '#ad7f58', '#6f6e77', '#1c2024',
];
export const BOOK_KINDS = {
  bank: { label: 'Ngân hàng', icon: '🏦', max: 3 },
  saving: { label: 'Tiết kiệm', icon: '🐷', max: 2 },
  card: { label: 'Thẻ tín dụng', icon: '💳', max: 5 },
  neo: { label: 'NEOBANK', icon: '🏧', max: 2 },

};
export const OVERDRAFT_MAX = 2;
/** Số mục tối đa của Bank hoặc Thấu chi: tính riêng từng loại, User đặc biệt mỗi loại 1. */
export function moneyBookMax(userId, overdraft) {
  if (getUsers().find((u) => u.id === userId)?.special) return 1;
  return overdraft ? OVERDRAFT_MAX : BOOK_KINDS.bank.max;
}
export const ownerType = (u) => (u && u.type === 'category' ? 'category' : 'user');

const readJSON = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const saveProfiles = (list) => localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
const saveUsers = (list) => localStorage.setItem(USERS_KEY, JSON.stringify(list));

/**
 * Chuyển dữ liệu bản cũ (mỗi hồ sơ là 1 người dùng, thẻ đứng riêng) sang mô hình người dùng → mục:
 * mỗi hồ sơ người dùng cũ thành 1 người dùng + mục "Ngân hàng" (giữ nguyên dữ liệu), thẻ cũ thuộc người dùng đầu tiên.
 */
function ensureModel() {
  let books = readJSON(PROFILES_KEY) || [];
  let users = readJSON(USERS_KEY);
  if (users && users.length && books.length) return;
  if (!books.length) books = [{ id: 'main', name: 'Tôi', icon: '🧑', color: PROFILE_COLORS[0] }];
  users = [];
  for (const b of books) {
    if (b.kind === 'card') continue;
    users.push({ id: b.id, name: b.name, icon: b.icon, color: b.color, photo: b.photo || null });
    Object.assign(b, { kind: 'bank', owner: b.id, name: BOOK_KINDS.bank.label, icon: BOOK_KINDS.bank.icon, photo: null });
  }
  if (!users.length) {
    const u = { id: 'main', name: 'Tôi', icon: '🧑', color: PROFILE_COLORS[0] };
    users.push(u);
    books.unshift({ id: 'main', name: BOOK_KINDS.bank.label, icon: BOOK_KINDS.bank.icon, color: u.color, kind: 'bank', owner: u.id });
  }
  for (const b of books) if (b.kind === 'card' && !b.owner) b.owner = users[0].id;
  saveUsers(users);
  saveProfiles(books);
}

/**
 * Bản 4: mục "Đầu tư" cũ (sổ thu/chi tự nhập, thuộc người dùng) đổi thành mục "Tiết kiệm" để giữ nguyên dữ liệu
 * và chuyển sang một Category tự tạo "Đầu tư & Tiết kiệm" (mục Đầu tư mới chỉ đọc giao dịch từ Ngân hàng).
 */
function migrateV4() {
  if (localStorage.getItem('stc-model') === '4') return;
  const books = readJSON(PROFILES_KEY) || [];
  const users = readJSON(USERS_KEY) || [];
  const old = books.filter((b) => b.kind === 'invest' && users.find((u) => u.id === b.owner && ownerType(u) === 'user'));
  if (old.length) {
    let cat = users.find((u) => ownerType(u) === 'category');
    if (!cat) {
      cat = { id: uid().replace(/-/g, '').slice(0, 12), type: 'category', name: 'Đầu tư & Tiết kiệm', icon: '🗂️', color: PROFILE_COLORS[2] };
      users.push(cat);
    }
    for (const b of old) Object.assign(b, { kind: 'saving', owner: cat.id, icon: b.icon === '📈' ? '🐷' : b.icon });
    saveUsers(users);
    saveProfiles(books);
  }
  localStorage.setItem('stc-model', '4');
}

/**
 * Bản 5: Tiết kiệm thuộc User (không còn trong Category); mỗi Category chỉ chứa đúng 1 mục theo dõi.
 * - Mục Tiết kiệm đang nằm trong Category → chuyển sang User đầu tiên (giữ nguyên dữ liệu).
 * - Category có nhiều mục theo dõi → mục thứ 2 trở đi tách thành Category riêng.
 * - Category không còn mục theo dõi nào → bỏ Category đó.
 */
function migrateV5() {
  if (localStorage.getItem('stc-model5') === '1') return;
  const books = readJSON(PROFILES_KEY) || [];
  let users = readJSON(USERS_KEY) || [];
  const firstUser = users.find((u) => ownerType(u) === 'user');
  if (firstUser) {
    for (const cat of users.filter((u) => ownerType(u) === 'category')) {
      const mine = books.filter((b) => b.owner === cat.id);
      for (const b of mine.filter((x) => x.kind === 'saving')) b.owner = firstUser.id;
      const trackers = mine.filter((x) => x.kind === 'invest' || x.kind === 'track');
      trackers.slice(1).forEach((b) => {
        const nc = { id: uid().replace(/-/g, '').slice(0, 12), type: 'category', name: b.name, icon: b.icon || '🔁', color: b.color || cat.color };
        users.push(nc);
        b.owner = nc.id;
      });
      if (!trackers.length) users = users.filter((u) => u.id !== cat.id);
    }
    saveUsers(users);
    saveProfiles(books);
  }
  localStorage.setItem('stc-model5', '1');
}

/**
 * Bản 6: bỏ Category. Thống kê chuyển vào cài đặt của mục Ngân hàng, nên thiết lập nguồn của Category đầu tiên mỗi kiểu
 * được đưa sang mục Ngân hàng đầu tiên (loadAll ghi nốt vì cần database). Mục theo dõi không có giao dịch riêng nên xóa được.
 */
const V6_STASH_KEY = 'stc-v6-stash';
function migrateV6() {
  if (localStorage.getItem('stc-model6') === '1') return;
  const books = readJSON(PROFILES_KEY) || [];
  const users = readJSON(USERS_KEY) || [];
  const catIds = new Set(users.filter((u) => ownerType(u) === 'category').map((u) => u.id));
  if (catIds.size) {
    const old = books.filter((b) => catIds.has(b.owner));
    const flow = old.find((b) => b.kind === 'invest' && b.source?.rules?.length);
    const track = old.find((b) => b.kind === 'track' && b.source?.books?.length);
    localStorage.setItem(V6_STASH_KEY, JSON.stringify({ flow: flow?.source || null, track: track?.source || null, drop: old.map((b) => b.id) }));
    saveUsers(users.filter((u) => !catIds.has(u.id)));
    saveProfiles(books.filter((b) => !catIds.has(b.owner)));
  }
  localStorage.setItem('stc-model6', '1');
}
async function applyV6Stash() {
  const stash = readJSON(V6_STASH_KEY);
  if (!stash) return;
  const bank = moneyBooks()[0];
  if (bank) {
    const peer = dbOf(bank.id);
    if (stash.flow) await peer.put('settings', { key: 'statFlow', value: { ...stash.flow, show: true } });
    if (stash.track) await peer.put('settings', { key: 'statTrack', value: { ...stash.track, show: true } });
  }
  for (const id of stash.drop || []) await dropProfile(id);
  localStorage.removeItem(V6_STASH_KEY);
}

/** Danh sách mục (sổ) của mọi người dùng. */
export function getProfiles() {
  ensureModel();
  migrateV4();
  migrateV5();
  migrateV6();
  return readJSON(PROFILES_KEY);
}
export function getUsers() {
  ensureModel();
  migrateV4();
  migrateV5();
  migrateV6();
  return readJSON(USERS_KEY);
}

export function currentProfile() {
  const list = getProfiles().filter((p) => p.owner !== SECRECY);
  return list.find((p) => p.id === localStorage.getItem(CURRENT_KEY)) || list[0];
}
export function currentUser() {
  const users = getUsers();
  return users.find((u) => u.id === currentProfile().owner) || users[0];
}
export const userOf = (book) => getUsers().find((u) => u.id === book.owner);
export const userBooks = (userId) => getProfiles().filter((b) => b.owner === userId);
// ---------- Khóa mục ----------
// Mục bị khóa: không chuyển tiền đi được (chi, transfer, chuyển khoản, trả nợ, bị Get In, trả tiền thẻ; thẻ thì không ghi khoản chi mới).
// Tiền vào (thu, nhận transfer) vẫn được.
export const isLocked = (bookId) => !!getProfiles().find((b) => b.id === bookId)?.locked;
export function setLocked(bookId, locked) {
  saveProfile({ id: bookId, locked: !!locked });
  emit();
}
export function lockError(bookId) {
  const b = getProfiles().find((x) => x.id === bookId);
  if (!b || !b.locked) return null;
  return b.kind === 'card' ? `🔒 Mục "${bookLabel(b)}" đang khóa` : `🔒 Mục "${bookLabel(b)}" đang tắt trừ tiền — bật lại trong Cài đặt của mục`;
}

/** Nhãn đầy đủ của một mục: "Tôi · Ngân hàng". */
export const bookLabel = (b) => (b.owner === SECRECY ? `Secrecy · ${b.name}` : `${userOf(b)?.name || '?'} · ${b.name}`);

export async function switchProfile(id) {
  localStorage.setItem(CURRENT_KEY, id);
  // Nhớ mục dùng gần nhất của người dùng để lần sau chuyển người thì mở đúng mục đó.
  const book = getProfiles().find((b) => b.id === id);
  if (book) saveUsers(getUsers().map((u) => (u.id === book.owner ? { ...u, lastBook: id } : u)));
  await useProfile(id);
  await loadAll();
  emit();
}

/** Chuyển sang người dùng khác: mở mục dùng gần nhất của người đó. */
export async function switchUser(userId) {
  const u = getUsers().find((x) => x.id === userId);
  const books = userBooks(userId);
  if (!u || !books.length) return;
  await switchProfile((books.find((b) => b.id === u.lastBook) || books[0]).id);
}

/** Thêm/sửa User. Thêm mới kèm 1 mục Ngân hàng mặc định. */
export function saveUser(u) {
  const users = getUsers();
  if (!u.id) {
    if (users.length >= MAX_USERS) throw new Error(`Tối đa ${MAX_USERS} User`);
    if (u.special && users.some((x) => x.special)) throw new Error('Chỉ có 1 User đặc biệt');
    u.id = uid().replace(/-/g, '').slice(0, 12);
    u.color = u.color || PROFILE_COLORS[users.length % PROFILE_COLORS.length];
    users.push(u);
    saveUsers(users);
    saveProfile({ name: BOOK_KINDS.bank.label, icon: BOOK_KINDS.bank.icon, kind: 'bank', owner: u.id, color: u.color });
  } else {
    saveUsers(users.map((x) => (x.id === u.id ? { ...x, ...u } : x)));
  }
  return u;
}

/** Xóa người dùng cùng toàn bộ các mục (sổ) của người đó. */
export async function deleteUser(userId) {
  const users = getUsers().filter((u) => u.id !== userId);
  if (!users.length) throw new Error('Cần giữ ít nhất 1 User');
  const drop = userBooks(userId);
  saveUsers(users);
  saveProfiles(getProfiles().filter((b) => b.owner !== userId));
  if (drop.some((b) => b.id === localStorage.getItem(CURRENT_KEY))) await switchUser(users[0].id);
  for (const b of drop) await dropProfile(b.id);
}

export function saveProfile(p) {
  const list = getProfiles();
  if (!p.id) {
    const kind = BOOK_KINDS[p.kind || 'bank'];
    // Thẻ tín dụng và Ví điện tử giới hạn riêng từng loại.
    const isCreditCard = (b) => !!b.credit || b.cardType === 'credit';
    const same = list.filter((b) => b.owner === p.owner && (b.kind || 'bank') === (p.kind || 'bank')
      && (p.kind !== 'card' || isCreditCard(b) === isCreditCard(p))
      && ((p.kind || 'bank') !== 'bank' || !!b.overdraft === !!p.overdraft));
    const isMoney = (p.kind || 'bank') === 'bank';
    const max = isMoney && p.owner ? moneyBookMax(p.owner, p.overdraft) : kind.max;
    const label = isMoney ? (p.overdraft ? 'Thấu chi' : 'Account') : p.kind === 'card' ? CARD_TYPES[isCreditCard(p) ? 'credit' : 'wallet'] : kind.label;
    if (p.owner && same.length >= max) throw new Error(`Tối đa ${max} mục ${label}`);
    p.id = uid().replace(/-/g, '').slice(0, 12);
    p.color = p.color || PROFILE_COLORS[list.length % PROFILE_COLORS.length];
    list.push(p);
  } else {
    const i = list.findIndex((x) => x.id === p.id);
    if (i >= 0) list[i] = { ...list[i], ...p };
  }
  saveProfiles(list);
  return p;
}

/** Xóa một mục (sổ) và toàn bộ dữ liệu của mục đó. Mỗi người dùng phải còn ít nhất 1 mục. */
export async function deleteProfile(id) {
  const book = getProfiles().find((p) => p.id === id);
  if (!book) return;
  const siblings = userBooks(book.owner).filter((b) => b.id !== id);
  if (book.owner !== SECRECY && !siblings.length) throw new Error('Mỗi User cần ít nhất 1 mục');
  if (isSpecialBook(book)) throw new Error('Không xóa được Account và Thấu chi của User đặc biệt');
  saveProfiles(getProfiles().filter((p) => p.id !== id));
  if (localStorage.getItem(CURRENT_KEY) === id) await switchProfile(siblings[0].id);
  await dropProfile(id);
}

// ---------- Tải / ghi ----------
export async function loadAll() {
  await useProfile(currentProfile().id);
  await applyV6Stash();
  for (const s of LIST) state[s] = await db.getAll(s);
  const rows = await db.getAll('settings');
  state.settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) state.settings[r.key] = r.value;
  if (!state.categories.length) {
    const { cats, accs } = seedRows();
    await db.bulkPut('categories', cats);
    await db.bulkPut('accounts', accs);
    state.categories = cats;
    state.accounts = accs;
  }
  // Đổi tên danh mục hệ thống Get In cũ (giữ nguyên nếu người dùng đã tự đặt tên khác).
  const oldFlowNames = { 'trich-in': ['Withdraw từ người nhà', 'Get In'], 'trich-out': ['Bị withdraw cho người nhà', 'Chuyển Get In'] };
  for (const c of state.categories) {
    if (oldFlowNames[c.sys]?.includes(c.name)) {
      c.name = c.sys === 'trich-in' ? 'Get In' : 'Chuyển Get In';
      await db.put('categories', c);
    }
  }
  const extra = missingSysCats(state.categories);
  if (extra.length) {
    await db.bulkPut('categories', extra);
    state.categories.push(...extra);
  }
  await migrateCash();

}

/**
 * Bản cũ có ví "Tiền mặt": xóa nếu chưa dùng (chưa có giao dịch, số dư ban đầu 0) và
 * chuyển các khoản nợ/định kỳ đang trỏ tới nó sang tài khoản ngân hàng đầu tiên.
 * Ví tiền mặt đã có giao dịch được giữ lại để không lệch số dư.
 */
async function migrateCash() {
  const used = new Set(state.transactions.flatMap((t) => [t.accountId, t.toAccountId]));
  const drop = state.accounts.filter((a) => a.kind === 'cash' && !used.has(a.id) && !Number(a.initial));
  if (!drop.length) return;
  for (const a of drop) await db.del('accounts', a.id);
  state.accounts = state.accounts.filter((a) => !drop.includes(a));
  if (!state.accounts.length) {
    const acc = seedRows().accs[0];
    await db.put('accounts', acc);
    state.accounts = [acc];
  }
  const target = state.accounts.find((a) => !a.archived) || state.accounts[0];
  const dropped = new Set(drop.map((a) => a.id));
  for (const d of state.debts) if (dropped.has(d.accountId)) { d.accountId = target.id; await db.put('debts', d); }
  for (const r of state.recurring) {
    if (dropped.has(r.template.accountId)) r.template.accountId = target.id;
    if (dropped.has(r.template.toAccountId)) r.template.toAccountId = null;
    await db.put('recurring', r);
  }
  if (dropped.has(state.settings.lastAccount)) await setSetting('lastAccount', target.id, { silent: true });
}

// ---------- Kiểm tra số dư ----------
/** Ảnh hưởng của một giao dịch lên số dư một tài khoản. */
function txEffect(t, accountId) {
  if (t.type === 'income') return t.accountId === accountId ? t.amountVnd : 0;
  if (t.type === 'expense') return t.accountId === accountId ? -t.amountVnd : 0;
  return (t.toAccountId === accountId ? t.amountVnd : 0) - (t.accountId === accountId ? t.amountVnd : 0);
}

/** Số dư khả dụng; khi sửa giao dịch thì bỏ qua ảnh hưởng của chính giao dịch đó. */
export function available(accountId, ignoreTx = null) {
  const acc = accById(accountId);
  if (!acc) return 0;
  return accountBalance(acc) - (ignoreTx ? txEffect(ignoreTx, accountId) : 0);
}

/** Trả về thông báo lỗi nếu tài khoản không đủ tiền cho khoản chi, ngược lại trả về null. */
export function fundsError(accountId, amountVnd, ignoreTx = null) {
  // Mục đang khóa thì không cho chuyển tiền đi (chi, transfer, trả nợ, chuyển khoản…).
  const locked = lockError(currentProfile().id);
  if (locked) return locked;
  if (currentProfile().overdraft || currentProfile().credit) return null; // Thấu chi, Thẻ tín dụng được âm số dư.
  const have = available(accountId, ignoreTx);
  if (amountVnd <= have) return null;
  return `Số dư "${accById(accountId)?.name || 'tài khoản'}" không đủ: còn ${fmt(have)}, cần ${fmt(amountVnd)}`;
}

// ---------- Transfer tiền giữa các người dùng ----------
/** Đọc sổ của người khác; nếu sổ chưa từng mở thì tạo dữ liệu mặc định. */
async function openPeerBook(profileId) {
  const peer = dbOf(profileId);
  let cats = await peer.getAll('categories');
  let accs = await peer.getAll('accounts');
  if (!cats.length) {
    const seedData = seedRows();
    cats = seedData.cats;
    accs = seedData.accs;
    await peer.bulkPut('categories', cats);
    await peer.bulkPut('accounts', accs);
  }
  const extra = missingSysCats(cats);
  if (extra.length) { await peer.bulkPut('categories', extra); cats = cats.concat(extra); }
  return { peer, cats, accs };
}

/** Danh sách tài khoản (chưa ẩn) của một người dùng khác. */
export async function peerAccounts(profileId) {
  const { accs } = await openPeerBook(profileId);
  return accs.filter((a) => !a.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Transfer tiền: sổ người transfer ghi khoản CHI "Transfer cho …", sổ người nhận ghi khoản THU "Nhận transfer từ …".
 * Hai giao dịch liên kết qua gop.id để xóa đồng bộ.
 */
export async function gop({ toProfileId, amount, fromAccountId, toAccountId, date, note, flowCat = null, pf = null, quick = null }) {
  const me = currentProfile();
  const to = getProfiles().find((p) => p.id === toProfileId);
  if (!to || to.id === me.id) throw new Error('Chọn người nhận khác');
  if (!canTransfer(me, to)) throw new Error(CLOSED_MSG);
  if (!featureOn(me, 'gop')) throw new Error('Mục này đang tắt tính năng Transfer');
  if (!transferTargets('gop', me, { includeHidden: true }).some((p) => p.id === to.id)) throw new Error('Mục này không Transfer được đến mục đã chọn');
  const err = fundsError(fromAccountId, amount);
  if (err) throw new Error(err);
  if (to.credit) {
    const debt = Math.max(0, -(await peerBalance(to.id, toAccountId)));
    if (amount > debt) throw new Error(`${bookLabel(to)} chỉ đang nợ ${fmt(debt)}, không được chuyển vượt số nợ`);
  }
  const mark = await pfMark(me, to, pf, isSpecialBook(me) ? -amount : amount);
  const gid = uid();
  const base = { amount, currency: 'VND', rate: 1, amountVnd: amount, date, tags: [], splits: null, photoIds: [], createdAt: Date.now() };
  const { peer, cats } = await openPeerBook(to.id);
  await peer.put('transactions', {
    ...base, id: uid(), type: 'income', categoryId: cats.find((c) => c.sys === 'gop-in').id, accountId: toAccountId,
    note: note || `Nhận transfer từ ${bookLabel(me)}`, gop: { id: gid, dir: 'in', peer: me.id, peerName: bookLabel(me), flowCat }, updatedAt: Date.now(), ...mark,
  });
  return put('transactions', {
    ...base, type: 'expense', categoryId: sysCat('gop-out').id, accountId: fromAccountId,
    note: note || `Transfer cho ${bookLabel(to)}`, gop: { id: gid, dir: 'out', peer: to.id, peerName: bookLabel(to), flowCat }, ...mark, ...(quick ? { quick } : {}),
  });
}

/** Số dư hiện tại của một tài khoản trong sổ người khác. */
export async function peerBalance(profileId, accountId) {
  const peer = dbOf(profileId);
  const acc = (await peer.getAll('accounts')).find((a) => a.id === accountId);
  if (!acc) return 0;
  let b = Number(acc.initial) || 0;
  for (const t of await peer.getAll('transactions')) b += txEffect(t, accountId);
  return b;
}

/**
 * Get In tiền (ngược với Transfer): lấy tiền từ tài khoản của người khác về tài khoản của mình.
 * Sổ mình ghi khoản THU "Get In từ …", sổ người kia ghi khoản CHI "Chuyển Get In cho …". Người kia phải đủ số dư.
 */
export async function trich({ fromProfileId, amount, fromAccountId, toAccountId, date, note, flowCat = null, pf = null, quick = null }) {
  const me = currentProfile();
  const from = getProfiles().find((p) => p.id === fromProfileId);
  if (!from || from.id === me.id) throw new Error('Chọn nguồn Get In');
  if (!transferTargets('trich', me, { includeHidden: true }).some((p) => p.id === from.id)) throw new Error('Mục này không được Get In từ nguồn đã chọn');
  if (!canTransfer(me, from)) throw new Error(CLOSED_MSG);
  const { peer, cats, accs } = await openPeerBook(from.id);
  const locked = lockError(from.id);
  if (locked) throw new Error(locked);
  const overDebt = creditError(amount);
  if (overDebt) throw new Error(overDebt);
  const have = await peerBalance(from.id, fromAccountId);
  if (!from.overdraft && amount > have) {
    const acc = accs.find((a) => a.id === fromAccountId);
    throw new Error(`Số dư "${acc?.name || 'tài khoản'}" của ${bookLabel(from)} không đủ: còn ${fmt(have)}, cần ${fmt(amount)}`);
  }
  const mark = await pfMark(me, from, pf, isSpecialBook(me) ? amount : -amount);
  const gid = uid();
  const base = { amount, currency: 'VND', rate: 1, amountVnd: amount, date, tags: [], splits: null, photoIds: [], createdAt: Date.now() };
  await peer.put('transactions', {
    ...base, id: uid(), type: 'expense', categoryId: cats.find((c) => c.sys === 'trich-out').id, accountId: fromAccountId,
    note: note || `Chuyển Get In cho ${bookLabel(me)}`, gop: { id: gid, mode: 'trich', dir: 'out', peer: me.id, peerName: bookLabel(me), flowCat }, updatedAt: Date.now(), ...mark,
  });
  return put('transactions', {
    ...base, type: 'income', categoryId: sysCat('trich-in').id, accountId: toAccountId,
    note: note || `Get In từ ${bookLabel(from)}`, gop: { id: gid, mode: 'trich', dir: 'in', peer: from.id, peerName: bookLabel(from), flowCat }, ...mark, ...(quick ? { quick } : {}),
  });
}

/**
 * Cảnh báo Thấu chi: chuyển đi / nhận về vượt hạn mức (số tiền của lần này, hoặc số dư sau giao dịch).
 * Chỉ cảnh báo, người dùng vẫn có thể tiếp tục.
 */
export async function overdraftWarnings({ fromId, fromAccountId, toId, toAccountId, amount }) {
  const out = [];
  const from = getProfiles().find((p) => p.id === fromId), to = getProfiles().find((p) => p.id === toId);
  if (from?.overdraft) {
    const after = (await peerBalance(fromId, fromAccountId)) - amount;
    if (amount > from.limit || after < -from.limit) out.push(`Thấu chi "${from.name}" chuyển đi ${fmt(amount)}, số dư sau ${fmt(after)}: vượt hạn mức ${fmt(from.limit)}.`);
  }
  if (to?.overdraft) {
    const after = (await peerBalance(toId, toAccountId)) + amount;
    if (amount > to.limit || after > to.limit) out.push(`Thấu chi "${to.name}" nhận về ${fmt(amount)}, số dư sau ${fmt(after)}: vượt hạn mức ${fmt(to.limit)}.`);
  }
  return out;
}

/** Sửa ngày của khoản Transfer/Get In ở cả 2 sổ. */
export async function setGopDate(tx, date) {
  if (tx.gop && getProfiles().some((p) => p.id === tx.gop.peer)) {
    const peer = dbOf(tx.gop.peer);
    const twin = (await peer.getAll('transactions')).find((t) => t.gop && t.gop.id === tx.gop.id);
    if (twin) await peer.put('transactions', { ...twin, date, updatedAt: Date.now() });
  }
  await put('transactions', { ...tx, date });
}

/** Thẻ tín dụng luôn ≤ 0: báo lỗi nếu thay đổi làm số dư thành dương (trả/thu vượt số đang nợ). */
export function creditError(delta, ignoreTx = null) {
  if (!currentProfile().credit) return null;
  const acc = activeAccounts()[0];
  const base = available(acc.id, ignoreTx);
  if (base + delta > 0) return `Thẻ chỉ đang nợ ${fmt(Math.max(0, -base))}, không được vượt quá số nợ`;
  const limit = Number(currentProfile().limit) || 0;
  if (limit && delta < 0 && base + delta < -limit) return `Vượt hạn mức ${fmt(limit)}: đang nợ ${fmt(Math.max(0, -base))}, chỉ còn dùng được ${fmt(Math.max(0, limit + base))}`;
  return null;
}

/** Thanh toán Thẻ tín dụng (đang mở thẻ) một phần hoặc toàn bộ từ tài khoản của một mục khác. */
export async function payCredit({ payerId, amount, fromAccountId, date, pf = null }) {
  const card = currentProfile();
  const payer = getProfiles().find((p) => p.id === payerId);
  if (!card.credit || !payer) throw new Error('Chọn mục trả tiền');
  if (!canTransfer(card, payer)) throw new Error(CLOSED_MSG);
  const locked = lockError(payer.id);
  if (locked) throw new Error(locked);
  const err = creditError(amount);
  if (err) throw new Error(err);
  const { peer, cats } = await openPeerBook(payer.id);
  const have = await peerBalance(payer.id, fromAccountId);
  if (!payer.overdraft && amount > have) throw new Error(`Số dư của ${bookLabel(payer)} không đủ: còn ${fmt(have)}, cần ${fmt(amount)}`);
  const mark = await pfMark(payer, card, pf, -amount);
  const gid = uid();
  const base = { amount, currency: 'VND', rate: 1, amountVnd: amount, date, tags: [], splits: null, photoIds: [], createdAt: Date.now() };
  await peer.put('transactions', {
    ...base, id: uid(), type: 'expense', categoryId: cats.find((c) => c.sys === 'gop-out').id, accountId: fromAccountId,
    note: `Thanh toán ${bookLabel(card)}`, gop: { id: gid, mode: 'pay', dir: 'out', peer: card.id, peerName: bookLabel(card), flowCat: null }, updatedAt: Date.now(), ...mark,
  });
  return put('transactions', {
    ...base, type: 'income', categoryId: sysCat('gop-in').id, accountId: activeAccounts()[0].id,
    note: `Thanh toán từ ${bookLabel(payer)}`, gop: { id: gid, mode: 'pay', dir: 'in', peer: payer.id, peerName: bookLabel(payer), flowCat: null }, ...mark,
  });
}

/** Xóa giao dịch tương ứng trong sổ của người kia (nếu người đó còn tồn tại). */
async function deleteGopPeer(tx) {
  if (!tx.gop || !getProfiles().some((p) => p.id === tx.gop.peer)) return;
  const peer = dbOf(tx.gop.peer);
  const twin = (await peer.getAll('transactions')).find((t) => t.gop && t.gop.id === tx.gop.id);
  if (twin) await peer.del('transactions', twin.id);
}

export async function put(store, obj, { silent = false } = {}) {
  if (!obj.id) obj.id = uid();
  obj.updatedAt = Date.now();
  await db.put(store, obj);
  const arr = state[store];
  const i = arr.findIndex((x) => x.id === obj.id);
  if (i >= 0) arr[i] = obj; else arr.push(obj);
  if (!silent) emit();
  return obj;
}

export async function remove(store, id, { silent = false } = {}) {
  await db.del(store, id);
  state[store] = state[store].filter((x) => x.id !== id);
  if (!silent) emit();
}

export async function setSetting(key, value, { silent = false } = {}) {
  state.settings[key] = value;
  await db.put('settings', { key, value });
  if (!silent) emit();
}

// ---------- Tra cứu ----------
export const catById = (id) => state.categories.find((c) => c.id === id);
export const accById = (id) => state.accounts.find((a) => a.id === id);
export const sysCat = (sys) => state.categories.find((c) => c.sys === sys);
export const catsOf = (type) => state.categories.filter((c) => c.type === type && !c.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
export const activeAccounts = () => state.accounts.filter((a) => !a.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
export const rateOf = (code) => (state.settings.currencies.find((c) => c.code === code) || { rate: 1 }).rate;

/** Một giao dịch có thể chia nhiều danh mục; trả về các phần (danh mục, số tiền VND). */
export const txParts = (tx) =>
  tx.splits && tx.splits.length ? tx.splits : [{ categoryId: tx.categoryId, amountVnd: tx.amountVnd }];

export const txIn = (range) => state.transactions.filter((t) => t.date >= range.start && t.date <= range.end);

export function totals(range) {
  let income = 0, expense = 0;
  for (const t of txIn(range)) {
    if (t.type === 'income') income += t.amountVnd;
    else if (t.type === 'expense') expense += t.amountVnd;
  }
  return { income, expense, net: income - expense };
}

export function byCategory(range, type) {
  const map = new Map();
  for (const t of txIn(range)) {
    if (t.type !== type) continue;
    for (const p of txParts(t)) map.set(p.categoryId, (map.get(p.categoryId) || 0) + p.amountVnd);
  }
  return [...map.entries()]
    .map(([id, amount]) => ({ cat: catById(id) || { id, name: 'Không rõ', icon: '❔', color: '#888' }, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function catSpent(categoryId, range) {
  let s = 0;
  for (const t of txIn(range)) {
    if (t.type !== 'expense') continue;
    for (const p of txParts(t)) if (p.categoryId === categoryId) s += p.amountVnd;
  }
  return s;
}

export function accountBalance(acc) {
  let b = Number(acc.initial) || 0;
  for (const t of state.transactions) {
    if (t.type === 'income' && t.accountId === acc.id) b += t.amountVnd;
    else if (t.type === 'expense' && t.accountId === acc.id) b -= t.amountVnd;
    else if (t.type === 'transfer') {
      if (t.accountId === acc.id) b -= t.amountVnd;
      if (t.toAccountId === acc.id) b += t.amountVnd;
    }
  }
  return b;
}
export const totalBalance = () => activeAccounts().reduce((s, a) => s + accountBalance(a), 0);

export function allTags() {
  const count = new Map();
  for (const t of state.transactions) for (const g of t.tags || []) count.set(g, (count.get(g) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
}

/** Danh mục hay dùng nhất (để gợi ý nhập nhanh). */
export function topCategories(type, n = 6) {
  const count = new Map();
  for (const t of state.transactions.slice(-300)) if (t.type === type) count.set(t.categoryId, (count.get(t.categoryId) || 0) + 1);
  return catsOf(type).sort((a, b) => (count.get(b.id) || 0) - (count.get(a.id) || 0)).slice(0, n);
}

// ---------- Giao dịch ----------
export async function deleteTx(tx) {
  for (const pid of tx.photoIds || []) await db.del('photos', pid);
  await deleteGopPeer(tx);
  await reopenCardItem(tx);
  await remove('transactions', tx.id);
}

// ---------- Thẻ trả trước ----------
// Thẻ trả trước là một "sổ" (hồ sơ kind = 'card') không có số dư: chỉ ghi các khoản chi (nguồn MoMo, ZaloPay…).
// Mỗi khoản chi có trạng thái open/done; "Get In thanh toán" ghi một khoản chi vào sổ người dùng trả tiền.
export const CARD_TYPES = { credit: 'Thẻ Tín Dụng', wallet: 'Ví điện tử' };
export const isCard = (p = currentProfile()) => p && p.kind === 'card' && !p.credit;
/** Các mục Ngân hàng của mọi User — dùng cho "Ghi vào sổ của", trả tiền thẻ. */
export const moneyBooks = () => getProfiles().filter((p) => (p.kind || 'bank') === 'bank' && !p.overdraft);
/** Các mục ghi được Thu/Chi: Bank và Thấu chi của mọi User. */
export const txBooks = () => getProfiles().filter((p) => (p.kind || 'bank') === 'bank' && (featureOn(p, 'expense') || featureOn(p, 'income')));
/** Tính năng giao dịch của Bank/Thấu chi: mặc định bật, tắt riêng trong Cài đặt của mục. */
export const TX_FEATURES = ['expense', 'income', 'gop', 'trich'];
export const featureOn = (b, f) => (b.kind || 'bank') !== 'bank' || b.features?.[f] !== false;
export function setFeature(bookId, f, on) {
  const b = getProfiles().find((x) => x.id === bookId);
  saveProfile({ id: bookId, features: { ...(b.features || {}), [f]: on } });
  emit();
}
export const kindOfBook = (p) => p.kind || 'bank';
/**
 * Đích Transfer / Get In theo loại mục đang mở:
 * - Ngân hàng: với Ngân hàng khác, Tiết kiệm, NEOBANK.
 * - Tiết kiệm: chỉ với các mục Ngân hàng.
 * - Thẻ trả trước: không transfer/Get In.
 */
export function transferTargets(mode, from = currentProfile(), { includeHidden = false } = {}) {
  const k = kindOfBook(from);
  if (!featureOn(from, mode === 'trich' ? 'trich' : 'gop')) return [];
  // Thẻ tín dụng: nhận Transfer từ Bank/Thấu chi và Get In từ Bank/Thấu chi; không chuyển tiền ra, không bị Get In.
  const allowed = mode === 'trich'
    ? (k === 'bank' ? ['bank', 'neo'] : k === 'saving' || from.credit ? ['bank'] : [])
    : k === 'bank' ? ['bank', 'saving', 'neo', 'card'] : k === 'saving' ? ['bank'] : [];
  // Secrecy đang ẩn thì không hiện trong form; mẫu nhanh đã thiết lập gọi thẳng gop/trich nên vẫn chạy.
  const hide = !includeHidden && secrecyHidden();
  return getProfiles().filter((p) => p.id !== from.id && allowed.includes(kindOfBook(p)) && (kindOfBook(p) !== 'card' || p.credit) && !(hide && p.owner === SECRECY) && canTransfer(from, p));
}

// ---------- Secrecy: NEOBANK & Cash Outflow ----------
const SECRECY_HIDE_KEY = 'stc-secrecy-hidden';
export const secrecyHidden = () => localStorage.getItem(SECRECY_HIDE_KEY) === '1';
export function setSecrecyHidden(v) { localStorage.setItem(SECRECY_HIDE_KEY, v ? '1' : '0'); emit(); }
export const secrecyBooks = (kind) => getProfiles().filter((p) => p.owner === SECRECY && (!kind || p.kind === kind));

/** Tạo NEOBANK / Cash Outflow kèm 1 tài khoản (NEOBANK có số dư ban đầu). */
export async function createSecrecy(kind, name, balance = 0) {
  const k = BOOK_KINDS[kind];
  const p = saveProfile({ name: name || k.label, icon: k.icon, kind, owner: SECRECY });
  const { peer, accs } = await openPeerBook(p.id);
  await peer.put('accounts', { ...accs[0], name: name || k.label, bank: k.label, initial: Math.round(balance) || 0 });
  emit();
  return p;
}
/** Điều chỉnh số dư hiện tại của mục Secrecy (sửa "số dư ban đầu" cho khớp). */
export async function setPeerBalance(bookId, value) {
  const { peer, accs } = await openPeerBook(bookId);
  const acc = accs[0];
  const cur = await peerBalance(bookId, acc.id);
  await peer.put('accounts', { ...acc, initial: Math.round((Number(acc.initial) || 0) + (value - cur)) });
  emit();
}

/** Danh mục của một mục khác (để chọn nguồn cho mục Đầu tư). */
export async function peerCategories(bookId) {
  const { cats } = await openPeerBook(bookId);
  return { cats };
}

// ---------- Đầu tư: đọc giao dịch từ 1 mục Ngân hàng theo danh mục đã chọn ----------
// ---------- Danh mục Transfer / Get In (dùng chung mọi mục, cho phép thêm) ----------
const FLOW_CATS_KEY = 'stc-flow-cats';
const DEFAULT_FLOW_CATS = [
  { id: 'fc-invest', name: 'Đầu tư', icon: '📈' },
  { id: 'fc-saving', name: 'Tiết kiệm', icon: '🐷' },
  { id: 'fc-family', name: 'Gia đình', icon: '👨‍👩‍👧' },
  { id: 'fc-gift', name: 'Biếu tặng', icon: '🎁' },
  { id: 'fc-other', name: 'Khác', icon: '📦' },
];
export function flowCats() {
  const list = readJSON(FLOW_CATS_KEY);
  if (Array.isArray(list) && list.length) return list;
  localStorage.setItem(FLOW_CATS_KEY, JSON.stringify(DEFAULT_FLOW_CATS));
  return DEFAULT_FLOW_CATS;
}
export function addFlowCat(name, icon = '🏷️') {
  const list = flowCats();
  if (list.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new Error('Danh mục này đã có');
  const c = { id: 'fc-' + uid().slice(0, 8), name, icon };
  localStorage.setItem(FLOW_CATS_KEY, JSON.stringify([...list, c]));
  return c;
}
export const flowCatById = (id) => flowCats().find((c) => c.id === id);

// ---------- Icon của 4 loại giao dịch (cài đặt chung, dùng cho các nút nhanh) ----------
const TX_ICONS_KEY = 'stc-tx-icons';
export const TX_ICON_DEFAULTS = { expense: '💸', income: '💰', gop: '🤝', trich: '🔄' };
export const txIcons = () => ({ ...TX_ICON_DEFAULTS, ...(readJSON(TX_ICONS_KEY) || {}) });
export function setTxIcon(type, icon) {
  localStorage.setItem(TX_ICONS_KEY, JSON.stringify({ ...txIcons(), [type]: icon }));
  emit();
}

// ---------- Đầu tư: chỉ lấy dòng tiền Transfer/Get In theo luồng "từ mục → đến mục" ----------
/**
 * source = { rules: [{ from, to, as: 'income'|'expense' }], flowCats: [id] }.
 * Mỗi khoản Transfer/Get In được ghi ở mục nguồn (from) là một khoản "ra" có gop.peer = mục đích (to).
 * Đọc trực tiếp từ mục nguồn nên khi xóa giao dịch transfer/Get In, mục Đầu tư cũng mất theo.
 * flowCats rỗng = lấy mọi danh mục transfer/Get In.
 */
export async function loadFlowStats(src) {
  const live = (id) => getProfiles().some((p) => p.id === id && p.kind !== 'outflow');
  const rules = ((src && src.rules) || []).filter((r) => live(r.from) && live(r.to));
  if (!rules.length) return { configured: false, txs: [], cats: [] };
  const want = new Set((src.flowCats || []));
  const txs = [];
  const cache = new Map();
  for (const r of rules) {
    if (!cache.has(r.from)) {
      const peer = dbOf(r.from);
      cache.set(r.from, { txs: await peer.getAll('transactions'), accs: await peer.getAll('accounts') });
    }
    const { txs: list, accs } = cache.get(r.from);
    const fromB = getProfiles().find((p) => p.id === r.from), toB = getProfiles().find((p) => p.id === r.to);
    for (const t of list) {
      if (!t.gop || t.gop.dir !== 'out' || t.gop.peer !== r.to) continue;
      if (want.size && !want.has(t.gop.flowCat)) continue;
      txs.push({
        ...t, type: r.as === 'income' ? 'income' : 'expense', splits: null, mirror: true,
        flowLabel: `${bookLabel(fromB)} → ${bookLabel(toB)}`, flowCatName: flowCatById(t.gop.flowCat)?.name || '',
        accName: accs.find((a) => a.id === t.accountId)?.name || '',
      });
    }
  }
  return { configured: true, rules, txs, cats: [] };
}
export const cardBooks = (userId) => getProfiles().filter((p) => p.kind === 'card' && (!userId || p.owner === userId));

/**
 * Nhắc trích trả nợ thẻ: mỗi tháng đến ngày giờ đã đặt thì nhắc các khoản chưa thanh toán của những tháng trước.
 * Khoản của tháng hiện tại không tính. Trước ngày nhắc của tháng này, các khoản đã quá kỳ nhắc trước vẫn còn hiện.
 */
export function cardDue() {
  const cfg = state.settings.cardRemind;
  if (!cfg?.day) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const today = todayISO();
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
  const remindOn = (yy, mm) => `${yy}-${pad(mm)}-${pad(Math.min(cfg.day, new Date(yy, mm, 0).getDate()))}`;
  const time = cfg.time || ALERT_TIME;
  const thisRemind = remindOn(y, m);
  const reached = today > thisRemind || (today === thisRemind && fmtTimeVN(Date.now()) >= time);
  const before = reached ? `${y}-${pad(m)}-01` : `${py}-${pad(pm)}-01`;
  const items = state.transactions.filter((t) => t.status !== 'done' && t.date < before);
  return { items, before, time, date: reached ? thisRemind : remindOn(py, pm) };
}

/** Get In thanh toán một khoản chi của thẻ (đang mở thẻ) từ tài khoản của một người dùng. */
export async function payCardItem(item, { profileId, accountId, date, pf = null }) {
  const card = currentProfile();
  const payer = getProfiles().find((p) => p.id === profileId);
  if (!payer || payer.kind === 'card') throw new Error('Chọn người dùng trả tiền');
  const locked = lockError(profileId);
  if (locked) throw new Error(locked);
  const { peer, cats, accs } = await openPeerBook(profileId);
  const acc = accs.find((a) => a.id === accountId);
  const have = await peerBalance(profileId, accountId);
  if (item.amountVnd > have) {
    throw new Error(`Số dư "${acc?.name || 'tài khoản'}" của ${bookLabel(payer)} không đủ: còn ${fmt(have)}, cần ${fmt(item.amountVnd)}`);
  }
  // Danh mục bên sổ người trả: cùng tên với danh mục của khoản chi, không có thì "Khác".
  const catName = catById(item.categoryId)?.name;
  const expCats = cats.filter((c) => c.type === 'expense' && !c.archived);
  const cat = expCats.find((c) => c.name === catName) || expCats.find((c) => c.name === 'Khác') || expCats[0];
  const txId = uid();
  await peer.put('transactions', {
    id: txId, type: 'expense', amount: item.amountVnd, currency: 'VND', rate: 1, amountVnd: item.amountVnd, date,
    categoryId: cat.id, accountId, note: `${bookLabel(card)}: ${item.note || catName || 'Khoản chi'}`, tags: [], splits: null, photoIds: [],
    createdAt: Date.now(), updatedAt: Date.now(), ...(pf ? { pf } : {}),
    cardPay: { cardId: card.id, cardName: bookLabel(card), itemId: item.id, source: item.source || '' },
  });
  item.status = 'done';
  item.paid = { profileId, profileName: bookLabel(payer), accountId, accountName: acc?.name || '', txId, date, at: Date.now() };
  return put('transactions', item);
}

/** Hủy thanh toán: xóa khoản chi bên sổ người trả, đưa khoản chi của thẻ về "chưa thanh toán". */
export async function unpayCardItem(item) {
  if (item.paid && getProfiles().some((p) => p.id === item.paid.profileId)) {
    await dbOf(item.paid.profileId).del('transactions', item.paid.txId);
  }
  item.status = 'open';
  item.paid = null;
  return put('transactions', item);
}

/** Người trả xóa khoản thanh toán trong sổ của họ → khoản chi bên thẻ mở lại. */
async function reopenCardItem(tx) {
  if (!tx.cardPay || !getProfiles().some((p) => p.id === tx.cardPay.cardId)) return;
  const cardDb = dbOf(tx.cardPay.cardId);
  const item = (await cardDb.getAll('transactions')).find((t) => t.id === tx.cardPay.itemId);
  if (item && item.paid && item.paid.txId === tx.id) {
    item.status = 'open';
    item.paid = null;
    item.updatedAt = Date.now();
    await cardDb.put('transactions', item);
  }
}


/**
 * Theo dõi Thu/Chi: source = { books: [bookId], income: [tên danh mục], expense: [tên danh mục] }.
 * Lọc theo TÊN danh mục để dùng chung được cho nhiều mục Ngân hàng / Tiết kiệm. Đọc trực tiếp nên xóa giao dịch là mất theo.
 */
export async function loadTrackStats(src = {}) {
  const ids = (src.books || []).filter((id) => getProfiles().some((p) => p.id === id));
  if (!ids.length || (!(src.income || []).length && !(src.expense || []).length)) return { configured: false, txs: [] };
  const inc = new Set(src.income || []), exp = new Set(src.expense || []);
  const txs = [];
  for (const id of ids) {
    const peer = dbOf(id);
    const cats = await peer.getAll('categories');
    const accs = await peer.getAll('accounts');
    const nameOf = (cid) => cats.find((c) => c.id === cid)?.name;
    const b = getProfiles().find((p) => p.id === id);
    for (const t of await peer.getAll('transactions')) {
      if (t.gop || (t.type !== 'income' && t.type !== 'expense')) continue;
      const want = t.type === 'income' ? inc : exp;
      const parts = t.splits && t.splits.length ? t.splits : [{ categoryId: t.categoryId, amountVnd: t.amountVnd }];
      const hit = parts.filter((p) => want.has(nameOf(p.categoryId)));
      if (!hit.length) continue;
      const cat = cats.find((c) => c.id === hit[0].categoryId);
      txs.push({
        ...t, amountVnd: hit.reduce((s, p) => s + p.amountVnd, 0), splits: null, mirror: true,
        catName: cat?.name || '', catIcon: cat?.icon || '🏷️', catColor: cat?.color || '#888',
        flowLabel: bookLabel(b), accName: accs.find((a) => a.id === t.accountId)?.name || '',
      });
    }
  }
  return { configured: true, txs, books: ids };
}

/** Tên danh mục thu / chi (gộp từ các mục đã chọn) để thiết lập theo dõi Thu/Chi. */
export async function categoryNamesOf(bookIds) {
  const out = { income: new Map(), expense: new Map() };
  for (const id of bookIds) {
    const { cats } = await openPeerBook(id);
    for (const c of cats) {
      if (c.archived || /^(gop|trich)/.test(c.sys || '') || !out[c.type]) continue;
      if (!out[c.type].has(c.name)) out[c.type].set(c.name, c.icon);
    }
  }
  return { income: [...out.income], expense: [...out.expense] };
}

/** Tóm tắt để hiện trong danh sách chọn: người dùng → tổng số dư; thẻ → số tiền đã chi chưa thanh toán. */
export async function profileSummary(p) {
  const isCur = p.id === currentProfile().id;
  const txs = isCur ? state.transactions : await dbOf(p.id).getAll('transactions');
  if (p.kind === 'card' && !p.credit) {
    const open = txs.filter((t) => t.status !== 'done');
    return { kind: 'card', unpaid: open.reduce((s, t) => s + t.amountVnd, 0), count: open.length };
  }
  const accs = (isCur ? state.accounts : await dbOf(p.id).getAll('accounts')).filter((a) => !a.archived);
  let balance = 0;
  for (const a of accs) {
    let b = Number(a.initial) || 0;
    for (const t of txs) b += txEffect(t, a.id);
    balance += b;
  }
  // Thẻ tín dụng: số dư âm là tiền đang nợ, tính vào nhóm Thẻ.
  if (p.credit) return { kind: 'card', credit: true, balance, unpaid: -balance, count: 0 };
  return { kind: 'user', balance };
}

export const savePhoto = (blob) => {
  const id = uid();
  return db.put('photos', { id, blob, createdAt: Date.now() }).then(() => id);
};
export const getPhoto = (id) => db.get('photos', id);
export const deletePhoto = (id) => db.del('photos', id);

// ---------- Giao dịch định kỳ ----------
export function txFromTemplate(r, date) {
  const t = r.template;
  const rate = rateOf(t.currency || 'VND');
  return {
    id: uid(), type: t.type, amount: t.amount, currency: t.currency || 'VND', rate,
    amountVnd: Math.round(t.amount * rate), date, categoryId: t.categoryId, accountId: t.accountId,
    toAccountId: t.toAccountId || null, note: t.note || '', tags: t.tags || [],
    splits: t.splits ? t.splits.map((s) => ({ ...s })) : null, photoIds: [], recurringId: r.id, createdAt: Date.now(), ...(t.pf ? { pf: t.pf } : {}),
  };
}

export const advanceRecurring = (r) => {
  r.nextDate = nextDate(r.nextDate, r.freq, r.interval || 1, r.anchorDay);
  if (r.endDate && r.nextDate > r.endDate) r.active = false;
};

/** Tự ghi các giao dịch định kỳ (loại "tự động") đã đến hạn. */
export async function processRecurring() {
  const today = todayISO();
  let added = 0;
  for (const r of state.recurring) {
    if (!r.active || !r.autoAdd) continue;
    let guard = 0;
    while (r.active && r.nextDate <= today && guard++ < 400) {
      const tx = txFromTemplate(r, r.nextDate);
      // Khoản chi/chuyển khoản không đủ số dư: không tự ghi, để lại thành mục "cần xử lý".
      if (tx.type !== 'income' && fundsError(tx.accountId, tx.amountVnd)) break;
      if (creditError(pfDelta(tx))) break;
      // User đặc biệt: chưa chọn Personal/Family hoặc phần đó không đủ tiền thì cũng để lại cho người dùng xử lý.
      if (isSpecialBook(currentProfile())) {
        if (!tx.pf || await pfCheck({ pf: tx.pf, delta: pfDelta(tx) })) break;
      }
      await put('transactions', tx, { silent: true });
      advanceRecurring(r);
      added++;
    }
    if (guard) await put('recurring', r, { silent: true });
  }
  if (added) emit();
  return added;
}

// ---------- Trả nợ ----------
export const debtName = (d) => d.bank + (d.title ? ' – ' + d.title : '');

export async function payDebt(debt, { amount, accountId, date, pf = null }) {
  const err = fundsError(accountId, Math.round(amount));
  if (err) throw new Error(err);
  const mark = await pfMark(currentProfile(), null, pf, -Math.round(amount));
  const cat = sysCat('debt');
  const tx = await put('transactions', {
    type: 'expense', amount, currency: 'VND', rate: 1, amountVnd: Math.round(amount), date,
    categoryId: cat ? cat.id : null, accountId, note: 'Trả nợ ' + debtName(debt), tags: [], splits: null,
    photoIds: [], debtId: debt.id, createdAt: Date.now(), ...mark,
  }, { silent: true });
  debt.history = [...(debt.history || []), { dueDate: debt.dueDate, paidDate: date, amount, txId: tx.id, periodsLeft: debt.periodsLeft }];
  const more = debt.repeat === 'monthly' && (debt.periodsLeft == null || debt.periodsLeft > 1);
  if (more) {
    debt.dueDate = addMonths(debt.dueDate, 1, debt.dueDay);
    if (debt.periodsLeft != null) debt.periodsLeft--;
  } else {
    debt.done = true;
    if (debt.periodsLeft != null) debt.periodsLeft = 0;
  }
  await put('debts', debt);
}

export async function undoDebtPayment(debt) {
  const last = (debt.history || []).slice(-1)[0];
  if (!last) return;
  const tx = state.transactions.find((t) => t.id === last.txId);
  if (tx) await remove('transactions', tx.id, { silent: true });
  debt.history = debt.history.slice(0, -1);
  debt.dueDate = last.dueDate;
  debt.periodsLeft = last.periodsLeft ?? debt.periodsLeft;
  debt.done = false;
  await put('debts', debt);
}

// ---------- Ngân sách ----------
export function budgetStatus(b, refDate = todayISO()) {
  const range = getRange(b.period || 'month', refDate, state.settings.weekStart);
  const spent = b.categoryId === '__all' ? totals(range).expense : catSpent(b.categoryId, range);
  return { range, spent, ratio: b.amount > 0 ? spent / b.amount : 0, left: b.amount - spent };
}
export const budgetName = (b) => (b.categoryId === '__all' ? 'Tổng chi tiêu' : catById(b.categoryId)?.name || 'Danh mục đã xóa');

// ---------- Phân bổ 50/30/20 hoặc JARS ----------
export function allocation(range) {
  const m = METHODS[state.settings.method];
  if (!m) return null;
  const t = totals(range);
  const exp = Number(state.settings.expectedIncome) || 0;
  // Thu nhập dự kiến là theo tháng → quy đổi theo độ dài kỳ (ngày, quý, năm, khoảng tự chọn).
  const scale = range.type === 'month' ? 1 : range.type === 'year' ? 12 : range.type === 'quarter' ? 3 : range.days / 30.44;
  const base = t.income > 0 ? t.income : Math.round(exp * scale);
  const spentBy = new Map();
  for (const tx of txIn(range)) {
    if (tx.type !== 'expense') continue;
    for (const p of txParts(tx)) {
      const g = catById(p.categoryId)?.[m.field] || '';
      spentBy.set(g, (spentBy.get(g) || 0) + p.amountVnd);
    }
  }
  return {
    method: m, base, usingExpected: !(t.income > 0),
    groups: m.groups.map((g) => ({ ...g, target: Math.round((base * g.pct) / 100), spent: spentBy.get(g.key) || 0 })),
    unassigned: spentBy.get('') || 0,
  };
}

// ---------- Quỹ dự phòng ----------
export function emergencyInfo() {
  const today = todayISO();
  let total = 0, monthsWithData = 0;
  for (let i = 1; i <= 3; i++) {
    const e = totals(getRange('month', addMonths(today, -i, 1))).expense;
    if (e > 0) { total += e; monthsWithData++; }
  }
  if (!monthsWithData) {
    const cur = getRange('month', today);
    const e = totals(cur).expense;
    const passed = Math.max(1, diffDays(cur.start, today) + 1);
    total = Math.round((e / passed) * 30);
    monthsWithData = total > 0 ? 1 : 0;
  }
  const avg = monthsWithData ? Math.round(total / monthsWithData) : 0;
  const months = Number(state.settings.emergencyMonths) || 6;
  return { avg, months, target: avg * months, goal: state.goals.find((g) => g.isEmergency) };
}

// ---------- Nhắc nhở ----------
/**
 * Giai đoạn báo của khoản có giờ hẹn: null = chưa đến lúc; 'pre' = nhắc trước; 'due' = đến hạn.
 * Báo từ đúng giờ đã chọn của ngày nhắc đầu tiên, và báo lại đúng giờ đó trong ngày đến hạn.
 */
export const ALERT_TIME = '08:00'; // Khoản chưa đặt giờ thì thông báo lúc này.
function alertStage(days, remind, time) {
  if (days > remind) return null;
  const reached = fmtTimeVN(Date.now()) >= (time || ALERT_TIME);
  if (days === remind && !reached) return null;
  return days < 0 || (days === 0 && reached) ? 'due' : 'pre';
}


export function getAlerts() {
  const today = todayISO();
  const def = Number(state.settings.remindDays) || 0;
  const out = [];
  for (const d of state.debts) {
    if (d.done) continue;
    const days = diffDays(today, d.dueDate);
    const stage = alertStage(days, d.remindDays ?? def, d.time);
    if (stage) {
      out.push({ key: `debt:${d.id}:${d.dueDate}:${stage}`, kind: 'debt', id: d.id, days, title: debtName(d), amount: d.amount, date: d.dueDate, time: d.time || ALERT_TIME });
    }
  }
  for (const r of state.recurring) {
    if (!r.active) continue;
    const days = diffDays(today, r.nextDate);
    const title = r.template.note || catById(r.template.categoryId)?.name || 'Giao dịch định kỳ';
    if (days <= 0) {
      // Chờ xác nhận, hoặc khoản tự động bị dừng vì không đủ số dư.
      out.push({ key: `pending:${r.id}:${r.nextDate}`, kind: 'pending', id: r.id, days, noFunds: !!r.autoAdd, title, amount: Math.round(r.template.amount * rateOf(r.template.currency)), date: r.nextDate });
    } else if (r.template.type === 'expense' && days > 0 && days <= (r.remindDays ?? def)) {
      out.push({ key: `rec:${r.id}:${r.nextDate}`, kind: 'recurring', id: r.id, days, title, amount: Math.round(r.template.amount * rateOf(r.template.currency)), date: r.nextDate });
    }
  }
  for (const b of state.budgets) {
    const st = budgetStatus(b);
    if (st.ratio >= 0.8) {
      const level = st.ratio >= 1 ? 100 : 80;
      out.push({ key: `budget:${b.id}:${st.range.start}:${level}`, kind: 'budget', id: b.id, days: 999, level, title: budgetName(b), amount: st.spent, limit: b.amount, ratio: st.ratio });
    }
  }
  const due = cardDue();
  if (due?.items.length) {
    out.push({ key: `cardpay:${due.before}`, kind: 'cardpay', id: 'cardpay', days: diffDays(today, due.date), title: 'Trích trả nợ thẻ', count: due.items.length, before: due.before, amount: due.items.reduce((s, t) => s + t.amountVnd, 0), date: due.date, time: due.time });
  }
  return out.sort((a, b) => a.days - b.days);
}

// ---------- Nhắc nhở của User: lưu trong hồ sơ User, tối đa 9 ----------
export const REMINDER_MAX = 9;
export const REPEAT_UNITS = { day: 'ngày', week: 'tuần', month: 'tháng' };
export const remindersOf = (userId) => getUsers().find((u) => u.id === userId)?.reminders || [];
const setReminders = (userId, list) => saveUsers(getUsers().map((u) => (u.id === userId ? { ...u, reminders: list } : u)));

export function saveReminder(userId, r) {
  const list = remindersOf(userId);
  if (!r.id && list.length >= REMINDER_MAX) throw new Error(`Tối đa ${REMINDER_MAX} nhắc nhở`);
  const item = r.id ? r : { ...r, id: uid() };
  setReminders(userId, r.id ? list.map((x) => (x.id === r.id ? item : x)) : [...list, item]);
  emit();
  return item;
}
export function deleteReminder(userId, id) {
  setReminders(userId, remindersOf(userId).filter((x) => x.id !== id));
  emit();
}
/**
 * Done: nhắc một lần thì bỏ. Nhắc lặp lại thì sang kỳ kế tiếp, các kỳ đã trôi qua tính là đã hết;
 * periodsLeft là số kỳ còn lại kể cả kỳ đang nhắc (null = không giới hạn), dùng hết thì bỏ.
 */
export function doneReminder(userId, id) {
  const r = remindersOf(userId).find((x) => x.id === id);
  if (!r) return;
  if (!REPEAT_UNITS[r.repeat]) return deleteReminder(userId, id);
  const today = todayISO();
  let date = r.date, left = r.periodsLeft ?? null;
  do {
    if (left != null && --left <= 0) return deleteReminder(userId, id);
    date = nextDate(date, r.repeat, 1, Number(r.day) || undefined);
  } while (date < today);
  saveReminder(userId, { ...r, date, periodsLeft: left });
}
export function reminderAlerts(userId) {
  const today = todayISO();
  const out = [];
  for (const r of remindersOf(userId)) {
    const days = diffDays(today, r.date);
    const stage = alertStage(days, r.remindDays || 0, r.time);
    if (stage) out.push({ key: `rem:${r.id}:${r.date}:${stage}`, kind: 'reminder', id: r.id, days, title: r.title, note: r.note, amount: 0, date: r.date, time: r.time || ALERT_TIME, bookId: '', bookName: 'Nhắc nhở', bookIcon: '🔔' });
  }
  return out;
}
// ---------- Nhắc sao lưu: quá 7 ngày chưa sao lưu (hoặc chưa sao lưu lần nào) thì hiện trong thông báo ----------
const LAST_BACKUP_KEY = 'stc-last-backup';
export const BACKUP_REMIND_DAYS = 7;
export const markBackup = () => localStorage.setItem(LAST_BACKUP_KEY, todayISO());
export const lastBackupDate = () => localStorage.getItem(LAST_BACKUP_KEY) || state.settings.lastBackup || null;
export function backupAlerts() {
  const today = todayISO();
  const last = lastBackupDate();
  const days = last ? diffDays(last, today) : null;
  if (last && days < BACKUP_REMIND_DAYS) return [];
  return [{ key: `backup:${today}`, kind: 'backup', id: 'backup', days: 0, title: last ? `${days} ngày chưa sao lưu` : 'Chưa sao lưu lần nào', amount: 0, date: today, bookId: '', bookName: 'Sao lưu', bookIcon: '💾' }];
}

/**
 * Tổng tài sản của User ở cuối mỗi tháng (tháng hiện tại tính đến hôm nay): số dư Account, Thấu chi, Tiết kiệm và
 * Thẻ tín dụng (số âm = nợ). Ví cũ không có số dư nên không tính. Chỉ đọc dữ liệu, không ghi gì.
 */
export async function netWorthSeries(userId, months = 12) {
  const today = todayISO();
  const ends = [];
  for (let i = months - 1; i >= 0; i--) {
    const first = addMonths(today.slice(0, 8) + '01', -i);
    const end = i === 0 ? today : addDays(addMonths(first, 1), -1);
    ends.push({ end, label: `T${Number(first.slice(5, 7))}`, year: first.slice(0, 4), value: 0 });
  }
  const cur = currentProfile().id;
  for (const b of userBooks(userId)) {
    if (b.kind === 'card' && !b.credit) continue;
    const txs = b.id === cur ? state.transactions : await dbOf(b.id).getAll('transactions');
    const accs = (b.id === cur ? state.accounts : await dbOf(b.id).getAll('accounts')).filter((a) => !a.archived);
    for (const a of accs) {
      const effects = txs.map((t) => [t.date, txEffect(t, a.id)]).filter(([, v]) => v);
      for (const p of ends) p.value += (Number(a.initial) || 0) + effects.reduce((s, [d, v]) => (d <= p.end ? s + v : s), 0);
    }
  }
  return ends;
}

/** Nhắc nhở bản cũ nằm trong từng mục: chuyển lên User rồi mới xóa khỏi mục, không tính vào lần kiểm tra giới hạn. */
async function adoptOldReminders(userId, bookId, old) {
  const mine = remindersOf(userId);
  setReminders(userId, [...mine, ...old.filter((r) => !mine.some((m) => m.id === r.id))]);
  await dbOf(bookId).put('settings', { key: 'reminders', value: [] });
  if (bookId === currentProfile().id) state.settings.reminders = [];
}

/**
 * Thông báo của mọi mục thuộc một User. Mục khác đang mở được đọc từ database rồi tạm gán vào state
 * để dùng chung getAlerts(); đoạn gán - tính - trả lại chạy đồng bộ nên không xen với thao tác khác.
 */
export async function userAlerts(userId) {
  const out = [];
  const cur = currentProfile().id;
  for (const b of userBooks(userId)) {
    let list, oldReminders = b.id === cur ? state.settings.reminders : null;
    if (b.id === cur) list = getAlerts();
    else {
      const peer = dbOf(b.id);
      const data = { settings: { ...DEFAULT_SETTINGS } };
      for (const s of LIST) data[s] = await peer.getAll(s);
      for (const r of await peer.getAll('settings')) data.settings[r.key] = r.value;
      const saved = {};
      for (const k of Object.keys(data)) saved[k] = state[k];
      Object.assign(state, data);
      try { list = getAlerts(); } finally { Object.assign(state, saved); }
      oldReminders = data.settings.reminders;
    }
    if (oldReminders?.length) await adoptOldReminders(userId, b.id, oldReminders);
    out.push(...list.map((a) => ({ ...a, bookId: b.id, bookName: b.name, bookIcon: b.icon })));
  }
  out.push(...reminderAlerts(userId), ...backupAlerts());
  return out.sort((a, b) => a.days - b.days);
}

/** Tổng tiền của một nhóm mục trong User: Ngân hàng/Tiết kiệm = số dư; Thẻ = tiền chưa thanh toán. */
export async function kindTotal(userId, kind) {
  let total = 0;
  for (const b of userBooks(userId).filter((x) => kindOfBook(x) === kind)) {
    const s = await profileSummary(b);
    total += s.kind === 'card' ? s.unpaid : s.balance;
  }
  return total;
}

// ---------- Màn hình Tổng quan chung: nút nhanh, thống kê, số liệu trong ngày của từng mục ----------
export const QUICK_MAX = { bank: 6, saving: 3, card: 6 };
/** Bank (không gồm Thấu chi) của User đặc biệt: 12 nút nhanh (4 dòng × 3 nút ở Tổng quan). */
export const QUICK_MAX_SPECIAL = 12;
export const quickMax = (b) => (kindOfBook(b) === 'bank' && !b.overdraft && userOf(b)?.special ? QUICK_MAX_SPECIAL : QUICK_MAX[kindOfBook(b)]);
export const STAT_MAX = 3;
/** Tổng quan luôn hiện 5 giao dịch gần nhất; khoản mới trong 10 phút được hủy (Recall). */
export const RECALL_MS = 10 * 60 * 1000;
export const RECALL_LINES = 5;
/** Loại nút nhanh mỗi mục được tạo. */
export function quickTypesFor(b) {
  const k = kindOfBook(b);
  if (k === 'card') return b.credit ? ['expense', 'income', 'trich'] : ['card'];
  if (k === 'saving') return ['gop', 'trich'];
  return TX_FEATURES.filter((f) => featureOn(b, f));
}
/** Danh sách nút nhanh; dữ liệu kiểu cũ (mỗi loại 1 mẫu) được đọc thành danh sách. */
export function quicksOf(st = state.settings) {
  if (Array.isArray(st.quicks)) return st.quicks;
  return Object.entries(st.quick || {}).filter(([, q]) => q)
    .map(([k, q]) => ({ ...q, id: k, type: /^card/.test(k) ? 'card' : k, name: String(q.name || '').slice(0, 12) }));
}
/** Danh sách thống kê; dữ liệu kiểu cũ (statFlow, statTrack) được đọc thành danh sách. */
export function statsOf(st = state.settings) {
  if (Array.isArray(st.stats)) return st.stats;
  const out = [];
  if (st.statFlow) out.push({ ...st.statFlow, id: 'flow', type: 'flow' });
  if (st.statTrack) out.push({ ...st.statTrack, id: 'track', type: 'track' });
  return out;
}

/** Số liệu trong kỳ của một mục (đọc trực tiếp từ sổ của mục đó). */
export async function bookOverview(b, range) {
  const { peer, accs, cats } = await openPeerBook(b.id);
  const txs = await peer.getAll('transactions');
  const settings = { ...DEFAULT_SETTINGS };
  for (const r of await peer.getAll('settings')) settings[r.key] = r.value;
  const inRange = (d) => !!d && d >= range.start && d <= range.end;
  const active = accs.filter((a) => !a.archived).sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
  let balance = 0, income = 0, expense = 0;
  if (kindOfBook(b) === 'card' && !b.credit) {
    for (const t of txs) {
      if (t.status !== 'done') balance += t.amountVnd;
      if (inRange(t.date)) expense += t.amountVnd;
      if (inRange(t.paid?.date)) income += t.amountVnd;
    }
  } else {
    for (const a of active) {
      balance += Number(a.initial) || 0;
      for (const t of txs) balance += txEffect(t, a.id);
    }
    for (const t of txs) {
      if (!inRange(t.date)) continue;
      if (t.type === 'income') income += t.amountVnd;
      else if (t.type === 'expense') expense += t.amountVnd;
    }
  }
  const recent = [...txs].sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : (y.createdAt || 0) - (x.createdAt || 0)))
    .slice(0, RECALL_LINES).map((t) => ({ ...t, catName: cats.find((c) => c.id === t.categoryId)?.name || '' }));
  return { book: b, number: active[0]?.number || '', balance, income, expense, net: income - expense, settings, recent };
}

// ---------- User đặc biệt: Personal / Family ----------
// Personal = pfBase + các giao dịch gắn nhãn personal trong Bank và Thấu chi của User.
// Family = tổng số dư Bank + Thấu chi − Personal, nên tổng 2 phần luôn bằng số dư.
export const PF_LABEL = { personal: 'Personal', family: 'Family' };
const CLOSED_MSG = 'Không giao dịch được: Secrecy chỉ dành cho Account của User đặc biệt; Thấu chi, Tiết kiệm, Thẻ của User đặc biệt chỉ giao dịch trong cùng User';
export const specialUser = () => getUsers().find((u) => u.special);
export function isSpecialBook(b) { return !!b && kindOfBook(b) === 'bank' && !!userOf(b)?.special; }
const closedBook = (b) => !!userOf(b)?.special && !(kindOfBook(b) === 'bank' && !b.overdraft);
/** Chỉ Bank của User đặc biệt mới giao dịch được với User khác. */
export function canTransfer(a, b) {
  // Ngân hàng trong Secrecy chỉ giao dịch với Bank của User đặc biệt.
  const neoA = kindOfBook(a) === 'neo', neoB = kindOfBook(b) === 'neo';
  if (neoA || neoB) {
    const other = neoA ? b : a;
    return !!userOf(other)?.special && kindOfBook(other) === 'bank' && !other.overdraft;
  }
  return a.owner === b.owner || (!closedBook(a) && !closedBook(b));
}
/** Cần chọn Personal/Family khi tiền đi vào/ra khỏi nhóm Bank + Thấu chi (giữa Bank và Thấu chi thì không). */
export function pfNeeded(aId, bId = null) {
  const find = (id) => getProfiles().find((p) => p.id === id);
  return isSpecialBook(find(aId)) !== isSpecialBook(find(bId));
}
export const pfDelta = (t) => (t.type === 'income' ? t.amountVnd : t.type === 'expense' ? -t.amountVnd : 0);

export async function pfBalances(userId = specialUser()?.id) {
  const u = getUsers().find((x) => x.id === userId);
  if (!u?.special) return null;
  let personal = Number(u.pfBase) || 0;
  for (const b of userBooks(u.id).filter((x) => kindOfBook(x) === 'bank')) {
    for (const t of await dbOf(b.id).getAll('transactions')) if (t.pf === 'personal') personal += pfDelta(t);
  }
  const total = await kindTotal(u.id, 'bank');
  return { personal, family: total - personal, total };
}

/** Lỗi nếu thay đổi làm Personal hoặc Family bị âm; oldPf/oldDelta là phần của giao dịch cũ (khi sửa, xóa). */
export async function pfCheck({ oldPf = null, oldDelta = 0, pf = null, delta = 0 }) {
  const b = await pfBalances();
  if (!b) return null;
  const next = { personal: b.personal, family: b.family };
  if (oldPf) next[oldPf] -= oldDelta;
  if (pf) next[pf] += delta;
  for (const k of ['personal', 'family']) {
    if (next[k] < 0 && next[k] < b[k]) return `${PF_LABEL[k]} không đủ: hiện có ${fmt(b[k])}, sau giao dịch sẽ âm ${fmt(-next[k])}`;
  }
  return null;
}

/** Kiểm tra nhãn Personal/Family của Transfer, Get In, trả nợ; trả về phần cần ghi thêm vào giao dịch. */
async function pfMark(a, b, pf, delta) {
  if (!pfNeeded(a.id, b ? b.id : null)) return {};
  if (!pf) throw new Error('Chọn Personal hoặc Family');
  const err = await pfCheck({ pf, delta });
  if (err) throw new Error(err);
  return { pf };
}

/** Xóa giao dịch có làm Personal/Family bị âm không (tx có thể nằm ở sổ của User khác). */
export function pfRemoveError(tx) {
  if (!tx.pf) return Promise.resolve(null);
  const delta = isSpecialBook(currentProfile()) ? pfDelta(tx) : -pfDelta(tx);
  return pfCheck({ oldPf: tx.pf, oldDelta: delta });
}

/** Thiết lập lần đầu hoặc Reset: đặt số dư Bank, Thấu chi, hạn mức và phần Personal. */
export async function setupSpecial(userId, { bank, limit, overdraft, personal }) {
  const u = getUsers().find((x) => x.id === userId);
  const books = userBooks(userId).filter((x) => kindOfBook(x) === 'bank');
  const bankBook = books.find((x) => !x.overdraft);
  let od = books.find((x) => x.overdraft);
  if (od) saveProfile({ id: od.id, limit });
  else od = saveProfile({ name: 'Thấu chi', icon: '💳', kind: 'bank', owner: userId, color: u.color, overdraft: true, limit });
  await setPeerBalance(bankBook.id, bank);
  await setPeerBalance(od.id, overdraft);
  await loadAll(); // Mục đang mở có thể là Bank hoặc Thấu chi: nạp lại số dư mới.
  const cur = await pfBalances(userId);
  saveUsers(getUsers().map((x) => (x.id === userId ? { ...x, pfBase: (Number(x.pfBase) || 0) + personal - cur.personal } : x)));
  emit();
}

/** Chuyển tiền giữa Personal và Family (số dư ngân hàng không đổi). */
export async function pfConvert(from, amount) {
  const b = await pfBalances();
  if (!b) throw new Error('Chưa có User đặc biệt');
  if (amount > b[from]) throw new Error(`${PF_LABEL[from]} chỉ còn ${fmt(b[from])}`);
  const change = from === 'family' ? amount : -amount;
  saveUsers(getUsers().map((x) => (x.special ? { ...x, pfBase: (Number(x.pfBase) || 0) + change } : x)));
  emit();
}

// ---------- Sao lưu ----------
const blobToDataURL = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
const dataURLToBlob = async (url) => (await fetch(url)).blob();

export async function exportData({ withPhotos = true } = {}) {
  const out = { app: 'sothuchi', version: 1, exportedAt: new Date().toISOString(), settings: state.settings };
  for (const s of LIST) out[s] = state[s];
  out.photos = [];
  if (withPhotos) {
    for (const p of await db.getAll('photos')) out.photos.push({ id: p.id, data: await blobToDataURL(p.blob) });
  }
  return out;
}

/** Đọc toàn bộ một sổ (người dùng hoặc thẻ) để sao lưu. */
async function exportBook(profileId) {
  const book = dbOf(profileId);
  const out = { settings: {} };
  for (const s of LIST) out[s] = await book.getAll(s);
  for (const r of await book.getAll('settings')) out.settings[r.key] = r.value;
  out.photos = [];
  for (const p of await book.getAll('photos')) out.photos.push({ id: p.id, data: await blobToDataURL(p.blob) });
  return out;
}

/** Sao lưu TẤT CẢ người dùng và thẻ trả trước vào một file. */
export async function exportAll() {
  const profiles = getProfiles();
  const books = {};
  for (const p of profiles) books[p.id] = await exportBook(p.id);
  return { app: 'sothuchi', version: 3, all: true, exportedAt: new Date().toISOString(), current: currentProfile().id, users: getUsers(), profiles, books, flowCats: flowCats(), txIcons: txIcons() };
}

/**
 * Khôi phục. File mới (all: true) → thay toàn bộ người dùng, thẻ và giao dịch.
 * File cũ (chỉ một sổ) → khôi phục vào sổ đang chọn như trước.
 */
export async function importAny(data) {
  if (!data || data.app !== 'sothuchi') throw new Error('File không phải bản sao lưu của Sổ Thu Chi');
  if (!data.all) return importData(data);
  if (!Array.isArray(data.profiles) || !data.profiles.length || !data.books) throw new Error('File sao lưu không đầy đủ');
  const oldIds = getProfiles().map((p) => p.id);
  for (const p of data.profiles) {
    const b = data.books[p.id] || {};
    const book = dbOf(p.id);
    for (const s of STORES) await book.clear(s);
    for (const s of LIST) await book.bulkPut(s, b[s] || []);
    for (const ph of b.photos || []) await book.put('photos', { id: ph.id, blob: await dataURLToBlob(ph.data), createdAt: Date.now() });
    await book.bulkPut('settings', Object.entries(b.settings || {}).map(([key, value]) => ({ key, value })));
  }
  saveProfiles(data.profiles);
  // Bản sao lưu cũ chưa có danh sách người dùng → để ensureModel() chuyển đổi lại từ danh sách mục.
  if (Array.isArray(data.users) && data.users.length) saveUsers(data.users);
  else localStorage.removeItem(USERS_KEY);
  if (Array.isArray(data.flowCats) && data.flowCats.length) localStorage.setItem(FLOW_CATS_KEY, JSON.stringify(data.flowCats));
  if (data.txIcons) localStorage.setItem(TX_ICONS_KEY, JSON.stringify(data.txIcons));
  // Bản sao lưu cũ có thể còn Category: cho chạy lại các bước chuyển dữ liệu.
  for (const k of ['stc-model', 'stc-model5', 'stc-model6']) localStorage.removeItem(k);
  const target = data.profiles.some((p) => p.id === data.current) ? data.current : getProfiles()[0].id;
  await switchProfile(target);
  // Xóa các sổ trên máy không có trong bản sao lưu.
  for (const id of oldIds) if (!data.profiles.some((p) => p.id === id)) await dropProfile(id);
  return data.profiles.length;
}

export async function importData(data) {
  if (!data || data.app !== 'sothuchi') throw new Error('File không phải bản sao lưu của Sổ Thu Chi');
  for (const s of STORES) await db.clear(s);
  for (const s of LIST) await db.bulkPut(s, data[s] || []);
  for (const p of data.photos || []) await db.put('photos', { id: p.id, blob: await dataURLToBlob(p.data), createdAt: Date.now() });
  for (const [key, value] of Object.entries(data.settings || {})) await db.put('settings', { key, value });
  await loadAll();
  emit();
}

/** Nạp dữ liệu mẫu để xem thử app (chỉ dùng khi chưa có giao dịch). */
export async function seedDemo() {
  if (state.transactions.length) return false;
  const today = todayISO();
  const c = (n) => state.categories.find((x) => x.name === n)?.id;
  const bank = await put('accounts', { ...state.accounts[0], name: 'VCB lương', bank: 'Vietcombank', number: '0123456789', holder: 'NGUYEN VAN A', initial: 8000000 }, { silent: true });
  const cash = await put('accounts', { name: 'Techcombank chi tiêu', bank: 'Techcombank', number: '19034567891011', holder: 'NGUYEN VAN A', icon: '💳', kind: 'bank', initial: 500000, order: 1 }, { silent: true });
  // Ngày lùi n ngày nhưng giữ trong tháng hiện tại để báo cáo tháng có đủ dữ liệu.
  const monthStart = today.slice(0, 8) + '01';
  const day = (n) => { const d = addDays(today, -n); return d < monthStart ? monthStart : d; };
  const tx = (type, amt, cat, d, note, tags = [], acc = bank) => put('transactions', {
    type, amount: amt, currency: 'VND', rate: 1, amountVnd: amt, date: day(d), categoryId: c(cat), accountId: acc.id,
    note, tags, splits: null, photoIds: [], createdAt: Date.now() - d * 1000,
  }, { silent: true });
  await tx('income', 18000000, 'Lương', 10, 'Lương tháng');
  await tx('expense', 3500000, 'Nhà ở', 9, 'Tiền thuê nhà');
  await tx('expense', 420000, 'Điện nước & Internet', 8, 'Tiền điện');
  await tx('expense', 650000, 'Mua sắm', 6, 'Áo khoác', ['mùa đông']);
  await tx('expense', 1200000, 'Giải trí & Du lịch', 4, 'Xem phim + ăn tối', ['cuối tuần']);
  await tx('expense', 80000, 'Đi lại', 1, 'Đổ xăng', [], cash);
  await tx('expense', 45000, 'Ăn uống', 0, 'Ăn trưa', [], cash);
  await tx('expense', 35000, 'Ăn uống', 0, 'Cà phê sáng', [], cash);
  await put('debts', {
    bank: 'Vietcombank', title: 'Vay mua xe', amount: 5200000, dueDate: addDays(today, 2), dueDay: Number(addDays(today, 2).slice(8)),
    repeat: 'monthly', periodsLeft: 24, method: 'Withdraw nợ tự động', note: 'Để đủ tiền trong TK lương trước ngày đến hạn',
    accountId: bank.id, remindDays: 3, history: [],
  }, { silent: true });
  await put('debts', {
    bank: 'Techcombank', title: 'Thẻ tín dụng', amount: 3150000, dueDate: addDays(today, 12), dueDay: Number(addDays(today, 12).slice(8)),
    repeat: 'monthly', periodsLeft: null, method: 'Chuyển khoản qua app ngân hàng', note: 'CK tới thẻ 4xxx, nội dung: THANH TOAN THE',
    accountId: bank.id, remindDays: 3, history: [],
  }, { silent: true });
  await put('budgets', { categoryId: c('Ăn uống'), amount: 1500000, period: 'month' }, { silent: true });
  await put('budgets', { categoryId: '__all', amount: 12000000, period: 'month' }, { silent: true });
  await put('goals', { name: 'Du lịch Nhật Bản', icon: '🗾', target: 40000000, saved: 12000000, deadline: addMonths(today, 8), contributions: [] }, { silent: true });
  await put('recurring', {
    template: { type: 'expense', amount: 260000, currency: 'VND', categoryId: c('Giải trí & Du lịch'), accountId: bank.id, note: 'Netflix', tags: [] },
    freq: 'month', interval: 1, anchorDay: Number(addDays(today, 3).slice(8)), nextDate: addDays(today, 3), autoAdd: true, remindDays: 3, active: true,
  }, { silent: true });
  await setSetting('method', '503020', { silent: true });
  emit();
  return true;
}

export async function wipeAll() {
  for (const s of STORES) await db.clear(s);
  await loadAll();
  emit();
}
