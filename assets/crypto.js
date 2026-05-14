/**
 * 天意小说阅读器 · 加密模块
 * 算法：AES-256-GCM（Web Crypto API 原生实现）
 * 密钥派生：PBKDF2（SHA-256, 100000 次迭代）
 * 用途：前端解密，密钥不存服务器，只在用户内存中
 */

const TianYiCrypto = (() => {
  'use strict';

  const SALT_LEN = 16;
  const IV_LEN   = 12;
  const TAG_LEN  = 16;
  const ITER     = 100000;
  const KEY_BITS = 256;

  // 从密码派生 AES 密钥（PBKDF2）
  async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: KEY_BITS },
      false, ['encrypt', 'decrypt']
    );
  }

  // 加密（Node.js 环境，由 sync 脚本调用逻辑一致）
  // 格式：base64( salt[16] + iv[12] + ciphertext + tag[16] )
  async function encrypt(plaintext, password) {
    const enc  = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const iv   = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const key  = await deriveKey(password, salt);
    const ct   = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: TAG_LEN * 8 },
      key, enc.encode(plaintext)
    );
    const result = new Uint8Array(SALT_LEN + IV_LEN + ct.byteLength);
    result.set(salt, 0);
    result.set(iv, SALT_LEN);
    result.set(new Uint8Array(ct), SALT_LEN + IV_LEN);
    return btoa(String.fromCharCode(...result));
  }

  // 解密
  async function decrypt(cipherB64, password) {
    const raw  = Uint8Array.from(atob(cipherB64), c => c.charCodeAt(0));
    const salt = raw.slice(0, SALT_LEN);
    const iv   = raw.slice(SALT_LEN, SALT_LEN + IV_LEN);
    const ct   = raw.slice(SALT_LEN + IV_LEN);
    const key  = await deriveKey(password, salt);
    try {
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, tagLength: TAG_LEN * 8 },
        key, ct
      );
      return new TextDecoder().decode(pt);
    } catch {
      return null; // 密钥错误
    }
  }

  // 验证密钥（尝试解密 sentinel 文件）
  async function verifyPassword(password) {
    try {
      const res = await fetch('data/sentinel.enc?' + Date.now());
      if (!res.ok) return false;
      const enc = await res.text();
      const pt  = await decrypt(enc.trim(), password);
      return pt !== null && pt.startsWith('TIANYI_OK');
    } catch {
      return false;
    }
  }

  // 解密 JSON 文件
  async function fetchDecrypted(url, password) {
    const res = await fetch(url + '?' + Date.now());
    if (!res.ok) throw new Error('fetch failed: ' + url);
    const enc = await res.text();
    const pt  = await decrypt(enc.trim(), password);
    if (pt === null) throw new Error('decrypt failed');
    return JSON.parse(pt);
  }

  return { encrypt, decrypt, verifyPassword, fetchDecrypted };
})();

// 全局密码会话存储（内存，页面关闭即清除）
window._sessionKey = null;
