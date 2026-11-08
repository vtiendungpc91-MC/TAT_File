// Khóa ứng dụng bằng mật khẩu số. Mật khẩu chỉ lưu dạng băm (SHA-256 + salt) trong localStorage.
// Lưu ý: đây là lớp khóa giao diện, giúp người khác cầm máy không xem được; dữ liệu trong máy không bị mã hóa.

const KEY = 'stc-lock';
export const DEFAULT_PIN = '2024';
const MAX_TRIES = 5;
const WAIT_SECONDS = 30;

export function lockConfig() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { c = {}; }
  return { enabled: true, delay: 60, ...c };
}
const saveConfig = (patch) => localStorage.setItem(KEY, JSON.stringify({ ...lockConfig(), ...patch }));

export const isDefaultPin = () => !lockConfig().hash;
export const pinLength = () => lockConfig().len || DEFAULT_PIN.length;
export const setLockEnabled = (enabled) => saveConfig({ enabled });
export const setLockDelay = (delay) => saveConfig({ delay });

async function hash(text) {
  if (crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Trình duyệt không có crypto.subtle (trang không HTTPS): dùng băm đơn giản.
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 'f' + (h >>> 0).toString(16);
}

export async function checkPin(pin) {
  const c = lockConfig();
  if (!c.hash) return pin === DEFAULT_PIN;
  return (await hash(c.salt + pin)) === c.hash;
}

export async function setPin(pin) {
  const salt = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
  saveConfig({ salt, hash: await hash(salt + pin), len: pin.length });
}

// ---------- Mở khóa bằng Face ID / Touch ID (WebAuthn, khóa trên máy) ----------
// App không có máy chủ: chỉ cần iPhone xác nhận đúng khuôn mặt/vân tay là mở, mật khẩu số vẫn luôn dùng được.
const BIO_KEY = 'stc-bio';
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const bioEnabled = () => !!localStorage.getItem(BIO_KEY);
export async function bioAvailable() {
  try {
    return !!(window.PublicKeyCredential && navigator.credentials?.create)
      && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}
export async function enableBio() {
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Sổ Thu Chi' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'so-thu-chi', displayName: 'Sổ Thu Chi' },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
    },
  });
  if (!cred) throw new Error('Chưa tạo được');
  localStorage.setItem(BIO_KEY, b64(cred.rawId));
}
export const disableBio = () => localStorage.removeItem(BIO_KEY);
async function bioCheck() {
  const id = localStorage.getItem(BIO_KEY);
  const res = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: unb64(id), transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  if (!res) throw new Error('Không xác thực được');
}

let unlocking = null;

/** Hiện màn hình khóa; trả về Promise hoàn tất khi nhập đúng mật khẩu. */
export function showLock() {
  if (unlocking) return unlocking;
  document.body.classList.remove('privacy');
  unlocking = new Promise((resolve) => {
    const len = pinLength();
    let pin = '';
    let tries = 0;
    let waitUntil = 0;
    const el = document.createElement('div');
    el.className = 'lock';
    el.innerHTML = `
      <div class="lock-box">
        <div class="lock-ic">🔒</div>
        <h2>Sổ Thu Chi</h2>
        <p class="lock-msg">Nhập mật khẩu để mở</p>
        <div class="dots">${'<i></i>'.repeat(len)}</div>
        <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join('')}
          <span></span><button type="button" data-k="0">0</button><button type="button" data-k="del" aria-label="Xóa">⌫</button></div>
        ${bioEnabled() ? '<button type="button" class="bio-btn" data-bio>🙂 Mở bằng Face ID / Touch ID</button>' : ''}
      </div>`;
    document.body.appendChild(el);
    document.body.classList.add('is-locked');
    const dots = el.querySelectorAll('.dots i');
    const msg = el.querySelector('.lock-msg');
    const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));

    const finish = () => {
      el.remove();
      document.body.classList.remove('is-locked');
      document.removeEventListener('keydown', onKey);
      unlocking = null;
      resolve();
    };

    async function press(k) {
      if (Date.now() < waitUntil) return;
      if (k === 'del') pin = pin.slice(0, -1);
      else if (pin.length < len) pin += k;
      paint();
      if (pin.length < len) return;
      if (await checkPin(pin)) return finish();
      tries++;
      pin = '';
      el.querySelector('.dots').classList.add('shake');
      setTimeout(() => { el.querySelector('.dots').classList.remove('shake'); paint(); }, 400);
      if (tries >= MAX_TRIES) {
        tries = 0;
        waitUntil = Date.now() + WAIT_SECONDS * 1000;
        const tick = () => {
          const left = Math.ceil((waitUntil - Date.now()) / 1000);
          if (left <= 0) { msg.textContent = 'Nhập mật khẩu để mở'; return; }
          msg.textContent = `Sai quá nhiều lần. Thử lại sau ${left} giây`;
          setTimeout(tick, 500);
        };
        tick();
      } else {
        msg.textContent = `Sai mật khẩu (còn ${MAX_TRIES - tries} lần thử)`;
      }
    }

    // Bấm phím bằng pointerdown (nhanh, không trễ) và chặn mọi cử chỉ phóng to trên màn khóa.
    let lastPointer = 0;
    el.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      e.preventDefault();
      lastPointer = Date.now();
      press(b.dataset.k);
    });
    el.querySelector('[data-bio]')?.addEventListener('click', async () => {
      if (Date.now() < waitUntil) return;
      try { await bioCheck(); finish(); } catch { msg.textContent = 'Không xác thực được, hãy nhập mật khẩu'; }
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (b && Date.now() - lastPointer > 600) press(b.dataset.k); // dự phòng khi không có pointer event
    });
    for (const ev of ['dblclick', 'gesturestart', 'gesturechange', 'touchend']) {
      el.addEventListener(ev, (e) => { if (ev !== 'touchend' || e.target.closest('[data-k]')) e.preventDefault(); }, { passive: false });
    }
    function onKey(e) {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
    }
    document.addEventListener('keydown', onKey);
  });
  return unlocking;
}

/** Tự khóa khi rời app quá `delay` giây; che nội dung khi app chạy nền (ảnh xem trước đa nhiệm). */
export function initAutoLock() {
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    const c = lockConfig();
    if (!c.enabled) return;
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      document.body.classList.add('privacy');
    } else {
      if (hiddenAt && Date.now() - hiddenAt >= c.delay * 1000) showLock();
      else document.body.classList.remove('privacy');
    }
  });
}
