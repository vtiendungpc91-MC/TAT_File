// Tạo file lịch .ics để đưa nhắc hạn vào app Lịch của điện thoại.
// App Lịch sẽ tự báo chuông kể cả khi không mở Sổ Thu Chi và không có mạng.

const escText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const ymd = (iso) => iso.replace(/-/g, '');
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Gấp dòng dài theo chuẩn RFC 5545 (≤ 75 byte/dòng)
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ch; } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** Trigger: nhắc lúc `hour` giờ sáng, trước `daysBefore` ngày so với sự kiện cả ngày. */
function trigger(daysBefore, hour = 9) {
  const mins = daysBefore * 1440 - hour * 60;
  return mins > 0 ? `-PT${mins}M` : `PT${-mins}M`;
}

/**
 * events: [{ uid, date:'YYYY-MM-DD', title, description, remindDays, rrule }]
 */
export function buildAllDayICS(events) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SoThuChi//VI', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of events) {
    const next = new Date(e.date + 'T00:00:00');
    next.setDate(next.getDate() + 1);
    const end = `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, '0')}${String(next.getDate()).padStart(2, '0')}`;
    L.push('BEGIN:VEVENT', `UID:${e.uid}@sothuchi`, `DTSTAMP:${stamp()}`,
      `DTSTART;VALUE=DATE:${ymd(e.date)}`, `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${escText(e.title)}`, `DESCRIPTION:${escText(e.description)}`);
    if (e.rrule) L.push(`RRULE:${e.rrule}`);
    const alarms = new Set([e.remindDays || 0, 0]);
    for (const d of alarms) {
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escText(e.title)}`, `TRIGGER:${trigger(d, d ? 9 : 8)}`, 'END:VALARM');
    }
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n');
}

/** Nhắc ghi chép thu chi hằng ngày vào giờ cố định. */
export function buildDailyICS(time = '21:00', startISO) {
  const [h, m] = time.split(':');
  const start = `${ymd(startISO)}T${h}${m}00`;
  const endM = (Number(h) * 60 + Number(m) + 10) % 1440;
  const end = `${ymd(startISO)}T${String(Math.floor(endM / 60)).padStart(2, '0')}${String(endM % 60).padStart(2, '0')}00`;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SoThuChi//VI', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:daily-log@sothuchi`, `DTSTAMP:${stamp()}`, `DTSTART:${start}`, `DTEND:${end > start ? end : start}`,
    'RRULE:FREQ=DAILY', 'SUMMARY:📒 Ghi chép thu chi hôm nay', 'DESCRIPTION:Mở app Sổ Thu Chi để ghi lại các khoản thu chi trong ngày.',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Ghi chép thu chi', 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].map(fold).join('\r\n');
}
