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
