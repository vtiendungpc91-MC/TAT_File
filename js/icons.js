// Thư viện biểu tượng có từ khóa (tiếng Việt không dấu + tiếng Anh) để tìm nhanh khi chọn icon.
const RAW = `
🧑 nguoi ban than person|👨 dan ong bo chong man|👩 phu nu me vo woman|👦 con trai be boy|👧 con gai be girl|👶 em be baby|👴 ong grandpa|👵 ba grandma|🧔 rau dan ong|👱‍♀️ toc vang co gai
🧑‍💼 cong so van phong|🧑‍💻 lap trinh it dev|🧑‍🍳 dau bep nau an|🧑‍🏫 giao vien thay co|🧑‍⚕️ bac si y te|🧑‍🚀 phi hanh gia|🧑‍🎓 sinh vien hoc|🧑‍🔧 tho sua chua|🥷 ninja|🦸 sieu anh hung
🧚 tien|🤴 hoang tu|👸 cong chua|👪 gia dinh family|💑 cap doi vo chong|👨‍👩‍👧 gia dinh con|🐱 meo cat|🐶 cho dog|🐼 gau truc panda|🐻 gau bear
🐰 tho rabbit|🦊 cao fox|🐯 ho tiger|🦁 su tu lion|🐸 ech frog|🐵 khi monkey|🐷 heo lon tiet kiem pig|🐨 koala|🐧 chim canh cut|🐥 ga con chick
🦄 ky lan unicorn|🐳 ca voi whale|🐙 bach tuoc|🦖 khung long|🐢 rua|🐝 ong bee|🦋 buom|🐟 ca fish|🐾 thu cung pet|🐴 ngua horse
😎 ngau cool|🤓 mot sach|🥰 yeu thuong love|😺 meo cuoi|👻 ma ghost|🤖 robot|😀 cuoi vui|🤑 tien money|😇 thien than|🥳 tiec party
🌸 hoa flower|🌻 huong duong|🌹 hoa hong rose|🌷 tulip|🌱 cay non mam|🌳 cay tree|🍀 co bon la may man|🌵 xuong rong|⭐ ngoi sao star|🌙 trang moon
☀️ mat troi sun|🌈 cau vong|🔥 lua fire|💧 nuoc water|⚡ dien sam|❄️ tuyet lanh|🌊 song bien|⛰️ nui|🏖️ bien du lich|🏕️ cam trai
🏦 ngan hang bank|💰 tui tien money|💵 tien mat cash|💴 tien yen|💶 euro|💷 bang anh|🪙 dong xu coin|💳 the card|🏧 atm rut tien|💸 tieu tien chi
🧾 hoa don bill|👛 vi wallet|💼 cong viec cap|📈 tang dau tu chung khoan stock|📉 giam lo|📊 bieu do thong ke|💹 ty gia lai|🥇 vang gold huy chuong|💎 kim cuong|🏆 cup
🎯 muc tieu goal|🔁 transfer luong chuyen|🔄 withdraw rut ve|📤 chuyen ra outflow|📥 nhan vao|🗂️ danh muc thu muc|📁 thu muc|🏷️ nhan tag|🔒 khoa|🔑 chia khoa
🍜 an uong pho bun|🍚 com|🍔 burger an vat|🍕 pizza|🍣 sushi|🍗 ga ran|🥗 rau salad|🍞 banh mi|🍰 banh ngot cake|🍩 donut
🍓 dau|🍎 tao|🍌 chuoi|🍉 dua hau|☕ ca phe coffee|🧋 tra sua|🍵 tra|🍺 bia beer|🍷 ruou vang|🥤 nuoc ngot
🛒 di cho sieu thi mua sam|🛍️ mua sam shopping|👗 quan ao|👕 ao|👟 giay|👜 tui xach|💄 my pham|💍 nhan cuoi|⌚ dong ho|🕶️ kinh
🏠 nha o house|🏡 nha vuon|🏢 toa nha cong ty|🏗️ xay dung|🛋️ noi that|🛏️ giuong ngu|🚿 tam|🧹 don dep|🔧 sua chua|💡 dien den
🔌 dien|📶 internet wifi|📱 dien thoai phone|💻 may tinh laptop|📺 tivi|🎮 game|🎧 tai nghe|📷 may anh|🖨️ may in|🔋 pin
🛵 xe may|🚗 o to xe hoi car|🚕 taxi grab|🚌 xe buyt bus|🚆 tau|✈️ may bay du lich|⛽ xang xang dau|🅿️ gui xe|🚲 xe dap|🛳️ tau thuy
🏥 benh vien suc khoe|💊 thuoc|🩺 kham benh|🦷 rang nha khoa|🏋️ gym the thao|⚽ bong da|🏸 cau long|🧘 yoga|💆 spa|💇 cat toc
📚 sach hoc giao duc|🎓 tot nghiep hoc phi|✏️ but|🏫 truong hoc|🧸 do choi tre em|🍼 sua be|🎒 cap sach|🎨 ve|🎵 am nhac|🎬 phim giai tri
🎁 qua tang gift|🎉 tiec le|🎂 sinh nhat|💐 hoa tang|🧧 li xi tet|🎄 noel|🕯️ nen|💌 thu|🤝 bat tay transfer|🙏 cam on tu thien
📦 khac hang hoa|🐕 cho|🛡️ bao hiem|📄 giay to hop dong|⚖️ phap ly|🧮 tinh toan|📅 lich|⏰ bao thuc|🗓️ ke hoach|✅ xong
`;

export const ICONS = RAW.split(/[|\n]/).map((s) => s.trim()).filter(Boolean).map((s) => {
  const i = s.indexOf(' ');
  return { icon: s.slice(0, i), kw: s.slice(i + 1).toLowerCase() };
});

/** Bỏ dấu tiếng Việt để tìm kiếm. */
export const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

export function searchIcons(q) {
  const k = plain(q).trim();
  if (!k) return ICONS;
  return ICONS.filter((x) => x.kw.includes(k) || x.icon === q.trim());
}

/** HTML bộ chọn icon: ô tìm kiếm + lưới icon. id dùng làm tiền tố. */
export function iconPickerHtml(id, selected) {
  return `<div class="icon-picker" id="${id}">
    <input type="search" class="ip-q" placeholder="🔍 Tìm biểu tượng: tiền, ăn, xe, nhà, mèo…" autocomplete="off">
    <div class="ip-grid">${gridHtml(ICONS, selected)}</div>
  </div>`;
}
const gridHtml = (list, selected) => list.map((x) => `<button type="button" class="chip icon-chip ${x.icon === selected ? 'on' : ''}" data-icon="${x.icon}" title="${x.kw}">${x.icon}</button>`).join('')
  || '<p class="muted small">Không tìm thấy — thử từ khác.</p>';

/** Gắn sự kiện: onPick(icon) khi chọn. */
export function bindIconPicker(root, onPick, getSelected) {
  const q = root.querySelector('.ip-q'), grid = root.querySelector('.ip-grid');
  q.addEventListener('input', () => { grid.innerHTML = gridHtml(searchIcons(q.value), getSelected()); });
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-icon]');
    if (!b) return;
    grid.querySelectorAll('[data-icon]').forEach((x) => x.classList.toggle('on', x === b));
    onPick(b.dataset.icon);
  });
}
