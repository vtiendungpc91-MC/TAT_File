// Nhập giao dịch bằng giọng nói (Web Speech API). Cần mạng trên đa số máy; nút sẽ ẩn nếu không hỗ trợ.
import { parseAmount } from './utils.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = () => !!SR;

export function listen() {
  return new Promise((resolve, reject) => {
    const r = new SR();
    r.lang = 'vi-VN';
    r.interimResults = false;
    r.maxAlternatives = 1;
    let done = false;
    r.onresult = (e) => { done = true; resolve(e.results[0][0].transcript); };
    r.onerror = (e) => { if (!done) { done = true; reject(new Error(e.error)); } };
    r.onend = () => { if (!done) resolve(''); };
    r.start();
  });
}

const UNIT_RE = '(nghìn|ngàn|nghin|ngan|triệu|trieu|tỷ|tỉ|củ|tr|k|đồng|đ)';
const KEYWORDS = {
  'Ăn uống': ['ăn', 'uống', 'cà phê', 'cafe', 'cơm', 'phở', 'bún', 'trà sữa', 'bia', 'nhậu', 'bữa', 'đồ ăn', 'food'],
  'Đi lại': ['xăng', 'grab', 'taxi', 'gửi xe', 'vé xe', 'xe buýt', 'be ', 'gojek', 'sửa xe', 'rửa xe'],
  'Nhà ở': ['tiền nhà', 'thuê nhà', 'phòng trọ', 'tiền trọ'],
  'Điện nước & Internet': ['điện', 'nước', 'internet', 'wifi', 'mạng', 'cước', 'nạp điện thoại', '4g'],
  'Sức khỏe': ['thuốc', 'khám', 'bệnh viện', 'gym', 'nha khoa'],
  'Mua sắm': ['mua', 'quần', 'áo', 'giày', 'shopee', 'lazada', 'tiki', 'siêu thị'],
  'Giải trí & Du lịch': ['phim', 'game', 'du lịch', 'karaoke', 'netflix', 'spotify', 'khách sạn'],
  'Giáo dục': ['học', 'sách', 'khóa'],
  'Hiếu hỉ & Quà tặng': ['đám cưới', 'đám', 'quà', 'sinh nhật', 'mừng', 'phúng'],
  'Trả nợ ngân hàng': ['trả nợ', 'trả góp', 'thẻ tín dụng', 'khoản vay'],
  'Tiết kiệm': ['tiết kiệm', 'gửi tiết kiệm'],
  'Lương': ['lương'],
  'Thưởng': ['thưởng'],
  'Kinh doanh': ['bán hàng', 'doanh thu'],
};
const INCOME_RE = /(lương|thưởng|nhận|được cho|được tặng|thu nhập|bán được|doanh thu|tiền lãi)/;

/** "ăn trưa 45 nghìn" → { type, amount, note, categoryName } */
export function parseSpeech(text) {
  const raw = String(text || '').trim();
  const t = raw.toLowerCase();
  const re = new RegExp(`(\\d+(?:[.,]\\d+)*)\\s*${UNIT_RE}?`, 'gi');
  const found = [];
  let m;
  while ((m = re.exec(t))) found.push({ start: m.index, end: m.index + m[0].length, num: m[1], unit: (m[2] || '').toLowerCase() });

  // Gộp cụm liền nhau sau một đơn vị: "1 triệu 200 nghìn", "1 triệu 2". Số đứng trước không có đơn vị
  // (vd "tháng 11") không được cộng vào.
  const groups = [];
  let g = null, prevMult = 0;
  for (const f of found) {
    const scale = f.unit && f.unit !== 'đồng' && f.unit !== 'đ' ? parseAmount('1' + f.unit) : 0;
    const joined = g && prevMult > 0 && t.slice(g.end, f.start).trim() === '';
    let v;
    if (joined && !f.unit && prevMult >= 1e6) v = parseFloat('0.' + f.num.replace(/\D/g, '')) * prevMult;
    else v = scale ? parseAmount(f.num + f.unit) : parseAmount(f.num);
    if (!Number.isFinite(v)) continue;
    if (joined) { g.amount += v; g.end = f.end; g.hasUnit = g.hasUnit || !!f.unit; }
    else { g = { start: f.start, end: f.end, amount: v, hasUnit: !!f.unit }; groups.push(g); }
    prevMult = scale;
  }
  // Ưu tiên cụm có đơn vị (cụm cuối cùng), nếu không có thì lấy số lớn nhất.
  const withUnit = groups.filter((x) => x.hasUnit);
  const best = withUnit.length ? withUnit[withUnit.length - 1] : groups.sort((a, b) => b.amount - a.amount)[0];
  const span = best || null;
  let amount = best ? best.amount : 0;
  if (amount > 0 && amount < 1000) amount *= 1000; // "ăn trưa 45" → 45.000
  let note = span ? (raw.slice(0, span.start) + ' ' + raw.slice(span.end)).replace(/\s+/g, ' ').trim() : raw;
  note = note.replace(/^(chi|tiêu|thu)\s+/i, '');
  if (note) note = note[0].toUpperCase() + note.slice(1);

  const type = INCOME_RE.test(t) ? 'income' : 'expense';
  // So khớp nguyên từ (tránh "xăng" bị hiểu là "ăn").
  const padded = ` ${t.replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  let categoryName = null;
  for (const [name, words] of Object.entries(KEYWORDS)) {
    if (words.some((w) => padded.includes(` ${w.trim()} `))) { categoryName = name; break; }
  }
  return { type, amount: Math.round(amount), note, categoryName };
}
