/**
 * 天意小说阅读器 · 加密模块 v2
 * 算法：AES-256-GCM  密钥派生：PBKDF2-SHA256(100000)
 * 密钥持久化：Web Crypto + localStorage（加密存储）
 */
const TianYiCrypto = (() => {
  'use strict';

  const SALT_LEN = 16, IV_LEN = 12, TAG_BITS = 128, ITER = 100000;
  const LS_KEY   = 'tianyi_saved_key_v2';        // localStorage key
  const DEVICE_SALT_KEY = 'tianyi_device_salt';   // 设备固定 salt

  // --- 基础加密 ---
  async function _deriveKey(password, salt) {
    const raw = await crypto.subtle.importKey('raw', new TextEncoder().encode(password),
      { name: 'PBKDF2' }, false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
      raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  async function decrypt(cipherB64, password) {
    try {
      const raw  = Uint8Array.from(atob(cipherB64), c => c.charCodeAt(0));
      const key  = await _deriveKey(password, raw.slice(0, SALT_LEN));
      const pt   = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: raw.slice(SALT_LEN, SALT_LEN + IV_LEN), tagLength: TAG_BITS },
        key, raw.slice(SALT_LEN + IV_LEN)
      );
      return new TextDecoder().decode(pt);
    } catch { return null; }
  }

  async function encrypt(plaintext, password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const iv   = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const key  = await _deriveKey(password, salt);
    const ct   = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: TAG_BITS }, key,
      new TextEncoder().encode(plaintext)
    );
    const out = new Uint8Array(SALT_LEN + IV_LEN + ct.byteLength);
    out.set(salt); out.set(iv, SALT_LEN); out.set(new Uint8Array(ct), SALT_LEN + IV_LEN);
    return btoa(String.fromCharCode(...out));
  }

  // --- 验证密钥 ---
  // 优先解密 sentinel；sentinel 不存在时降级用 books.json 间接验证（直接 JSON.parse 成功即可）
  async function verifyPassword(password) {
    try {
      // 1. 先试 sentinel.enc（轻量，含明文标记）
      const res = await fetch('/tianyi-novel-viewer/data/sentinel.enc?' + Date.now());
      if (res.ok) {
        const pt = await decrypt((await res.text()).trim(), password);
        if (pt !== null) return pt.startsWith('TIANYI_OK');
        return false; // sentinel 存在但解密失败 → 密码错
      }
      // 2. sentinel 不存在 → 试解 books.json（不加密，直接可读）作为存在性检验，
      //    再试 sentinel 解密一次最新 enc 文件
      const booksRes = await fetch('/tianyi-novel-viewer/data/books.json?' + Date.now());
      if (!booksRes.ok) return false;
      const books = await booksRes.json();
      if (!books.length) return false;
      // 用第一本书 index.enc 验证密码
      const bid = encodeURIComponent(books[0].book_id);
      const encRes = await fetch(`/tianyi-novel-viewer/data/${bid}/index.enc?` + Date.now());
      if (!encRes.ok) return false;
      const pt2 = await decrypt((await encRes.text()).trim(), password);
      return pt2 !== null;
    } catch { return false; }
  }

  // --- 解密 JSON 文件 ---
  async function fetchDecrypted(url, password) {
    const res = await fetch(url + '?' + Date.now());
    if (!res.ok) throw new Error('fetch failed: ' + url);
    const pt = await decrypt((await res.text()).trim(), password);
    if (pt === null) throw new Error('decrypt failed');
    return JSON.parse(pt);
  }

  // --- 密钥本地持久化 ---
  // 用设备指纹（随机生成后固定）作为二次加密的 password，防止明文存储
  function _getDeviceSalt() {
    let s = localStorage.getItem(DEVICE_SALT_KEY);
    if (!s) {
      s = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
      localStorage.setItem(DEVICE_SALT_KEY, s);
    }
    return s;
  }

  async function saveKey(password) {
    const deviceSalt = _getDeviceSalt();
    const enc = await encrypt(password, 'device:' + deviceSalt);
    localStorage.setItem(LS_KEY, enc);
  }

  async function loadKey() {
    const enc = localStorage.getItem(LS_KEY);
    if (!enc) return null;
    const deviceSalt = _getDeviceSalt();
    return await decrypt(enc, 'device:' + deviceSalt);
  }

  function clearKey() {
    localStorage.removeItem(LS_KEY);
  }

  function hasSavedKey() {
    return !!localStorage.getItem(LS_KEY);
  }

  return { encrypt, decrypt, verifyPassword, fetchDecrypted, saveKey, loadKey, clearKey, hasSavedKey };
})();

window._sessionKey = null;
