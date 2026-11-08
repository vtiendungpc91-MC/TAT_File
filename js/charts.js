// Biểu đồ SVG tự vẽ (không dùng thư viện ngoài để chạy offline và nhẹ).
import { esc, fmtShort } from './utils.js';

/** items: [{ value, color }] */
export function donut(items, { size = 180, thickness = 26, label = '', value = '' } = {}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const c = size / 2, r = (size - thickness) / 2, C = 2 * Math.PI * r;
  let off = 0;
  const segs = total > 0
    ? items.map((i) => {
      const len = (i.value / total) * C;
      const gap = items.length > 1 ? Math.min(1.5, len / 3) : 0;
      const s = `<circle r="${r}" cx="${c}" cy="${c}" fill="none" stroke="${i.color}" stroke-width="${thickness}"
        stroke-dasharray="${Math.max(0, len - gap)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 ${c} ${c})"/>`;
      off += len;
      return s;
    }).join('')
    : `<circle r="${r}" cx="${c}" cy="${c}" fill="none" stroke="var(--line)" stroke-width="${thickness}"/>`;
  return `<svg class="donut" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label)}">${segs}
    <text x="${c}" y="${c - 6}" text-anchor="middle" class="donut-l">${esc(label)}</text>
    <text x="${c}" y="${c + 16}" text-anchor="middle" class="donut-v">${esc(value)}</text></svg>`;
}

/** buckets: [{ label, income, expense }] — cột thu/chi theo thời gian. */
export function bars(buckets, { height = 170 } = {}) {
  const W = 340, top = 14, bottom = 20, left = 2;
  const ch = height - top - bottom;
  const max = Math.max(1, ...buckets.flatMap((b) => [b.income, b.expense]));
  const n = buckets.length, bw = (W - left) / n;
  const w = Math.max(1.5, bw * 0.36);
  const every = n > 12 ? Math.ceil(n / 8) : 1;
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const y = top + (ch * i) / 2;
    parts.push(`<line x1="0" x2="${W}" y1="${y}" y2="${y}" class="grid"/>`);
  }
  parts.push(`<text x="${W}" y="10" text-anchor="end" class="axis">${esc(fmtShort(max))}</text>`);
  buckets.forEach((b, i) => {
    const x = left + i * bw + bw / 2;
    const hi = (b.income / max) * ch, he = (b.expense / max) * ch;
    if (hi > 0) parts.push(`<rect x="${x - w - 0.5}" y="${top + ch - hi}" width="${w}" height="${hi}" rx="1.5" class="b-in"><title>${esc(b.label)}: thu ${esc(fmtShort(b.income))}</title></rect>`);
    if (he > 0) parts.push(`<rect x="${x + 0.5}" y="${top + ch - he}" width="${w}" height="${he}" rx="1.5" class="b-ex"><title>${esc(b.label)}: chi ${esc(fmtShort(b.expense))}</title></rect>`);
    if (i % every === 0) parts.push(`<text x="${x}" y="${height - 5}" text-anchor="middle" class="axis">${esc(b.label)}</text>`);
  });
  return `<svg class="bars" viewBox="0 0 ${W} ${height}" preserveAspectRatio="none" role="img" aria-label="Biểu đồ thu chi">${parts.join('')}</svg>`;
}

/** points: [{ label, value }] — đường tổng tài sản theo tháng, có vạch 0 nếu có tháng âm. */
export function lineChart(points, { height = 160 } = {}) {
  const W = 340, top = 20, bottom = 22, left = 6, right = 6;
  const ch = height - top - bottom;
  const vals = points.map((p) => p.value);
  // Trục luôn tính từ 0 để không phóng đại thay đổi nhỏ.
  let min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  if (max === min) max = min + 1;
  const n = points.length;
  const x = (i) => left + (n > 1 ? (i * (W - left - right)) / (n - 1) : (W - left - right) / 2);
  const y = (v) => top + ((max - v) / (max - min)) * ch;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const base = y(Math.max(min, Math.min(max, 0)));
  const parts = [`<path d="${line} L${x(n - 1).toFixed(1)},${base.toFixed(1)} L${x(0).toFixed(1)},${base.toFixed(1)} Z" class="nw-area"/>`];
  if (min < 0 && max > 0) parts.push(`<line x1="0" x2="${W}" y1="${base}" y2="${base}" class="grid"/>`);
  parts.push(`<path d="${line}" class="nw-line"/>`);
  const every = n > 8 ? 2 : 1;
  points.forEach((p, i) => {
    parts.push(`<circle cx="${x(i)}" cy="${y(p.value)}" r="${i === n - 1 ? 3.5 : 2.2}" class="nw-dot${p.value < 0 ? ' neg' : ''}"><title>${esc(p.label)}: ${esc(fmtShort(p.value))}</title></circle>`);
    if (i % every === (n - 1) % every) parts.push(`<text x="${x(i)}" y="${height - 5}" text-anchor="middle" class="axis">${esc(p.label)}</text>`);
  });
  parts.push(`<text x="${W}" y="11" text-anchor="end" class="axis">cao nhất ${esc(fmtShort(Math.max(...vals)))}</text>`);
  return `<svg class="bars nw" viewBox="0 0 ${W} ${height}" preserveAspectRatio="none" role="img" aria-label="Tổng tài sản theo tháng">${parts.join('')}</svg>`;
}