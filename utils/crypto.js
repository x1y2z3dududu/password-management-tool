/**
 * utils/crypto.js - 密锁核心加密模块
 *
 * 安全模型：
 *   主密码 → PBKDF2(10万次,随机盐) → 256位密钥
 *   数据密钥 → AES-256-CBC 加密 → 密文 + IV
 *
 * 注意：crypto-js 官方不内置 GCM 模式（需额外插件），微信小程序环境下
 *       GCM 会静默回退到 CBC 但解密时模式不一致导致乱码。
 *       因此统一使用 AES-256-CBC + 随机16字节IV，安全性完全够用。
 *
 * 依赖：CryptoJS（需在小程序中引入 crypto-js 库）
 * 安装：npm install crypto-js --save，然后在微信开发者工具中构建 npm
 */

// 如果未构建 npm，可使用下方纯 JS 实现的降级方案
// 生产环境强烈建议使用 crypto-js 库

const CryptoJS = (function () {
  // 检测 crypto-js 是否已构建
  try {
    return require('crypto-js');
  } catch (e) {
    // 降级：使用微信小程序内置的 ArrayBuffer 做基础加密
    // 注意：降级方案安全性较低，仅用于演示
    return null;
  }
})();

// PBKDF2 配置
const PBKDF2_CONFIG = {
  keySize: 256 / 32,    // 256位密钥
  iterations: 100000,   // 10万次迭代
  hasher: 'SHA256'
};

// AES 配置：使用 CBC 模式（crypto-js 官方完整支持，GCM 需要额外插件不可用）
const AES_CONFIG = {
  mode: 'CBC',
  padding: 'Pkcs7'
};

/**
 * 生成随机盐值
 * @returns {string} Hex 编码的 16 字节随机盐
 */
function generateSalt() {
  if (CryptoJS) {
    return CryptoJS.lib.WordArray.random(16).toString();
  }
  // 降级方案：纯 hex（微信小程序不支持 btoa）
  let hex = '';
  for (let i = 0; i < 32; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return hex;
}

/**
 * 从主密码派生加密密钥
 * @param {string} masterPassword - 用户主密码
 * @param {string} salt - 随机盐值（Base64）
 * @returns {Promise<string>} 派生密钥（Hex）
 */
async function deriveKey(masterPassword, salt) {
  if (CryptoJS) {
    // salt 是 Hex 格式，必须用 Hex.parse 而不是 Base64.parse
    const key = CryptoJS.PBKDF2(masterPassword, CryptoJS.enc.Hex.parse(salt), {
      keySize: PBKDF2_CONFIG.keySize,
      iterations: PBKDF2_CONFIG.iterations,
      hasher: CryptoJS.algo.SHA256
    });
    return key.toString();
  }
  // 降级：简单哈希（仅演示，生产环境必须用 crypto-js）
  let hash = masterPassword + salt;
  for (let i = 0; i < 1000; i++) {
    hash = simpleHash(hash);
  }
  return hash;
}

/**
 * 生成主密码的验证哈希
 * @param {string} masterPassword - 用户主密码
 * @param {string} salt - 盐值
 * @returns {Promise<string>} 验证哈希
 */
async function generateMasterHash(masterPassword, salt) {
  const key = await deriveKey(masterPassword, salt);
  if (CryptoJS) {
    return CryptoJS.SHA256(key + 'misuo_hash').toString();
  }
  return simpleHash(key + 'misuo_hash');
}

/**
 * 生成随机 IV（初始化向量）
 * @returns {string} Hex 编码的 16 字节 IV（CBC 模式要求 16 字节）
 */
function generateIV() {
  if (CryptoJS) {
    return CryptoJS.lib.WordArray.random(16).toString(); // CBC 需要 16 字节 IV
  }
  // 降级方案：纯 hex（微信小程序不支持 btoa）
  let hex = '';
  for (let i = 0; i < 32; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return hex;
}

/**
 * AES-256-CBC 加密
 * @param {string} plaintext - 明文字符串（支持中文、emoji 等任意 Unicode）
 * @param {string} keyHex - 密钥（Hex，32字节=64个hex字符）
 * @returns {{ ciphertext: string, iv: string }} 加密结果
 */
function encrypt(plaintext, keyHex) {
  // 确保输入是字符串（防御性处理）
  const text = (plaintext === null || plaintext === undefined) ? '' : String(plaintext);

  if (CryptoJS) {
    // CBC 模式需要 16 字节 IV
    const iv = CryptoJS.lib.WordArray.random(16);
    const key = CryptoJS.enc.Hex.parse(keyHex);

    // 将字符串（含中文、emoji等）先用 UTF-8 编码为 WordArray，再加密
    // crypto-js 的 CBC 模式原生支持此方式，不会乱码
    const encrypted = CryptoJS.AES.encrypt(text, key, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });

    return {
      ciphertext: encrypted.ciphertext.toString(CryptoJS.enc.Hex),
      iv: iv.toString(CryptoJS.enc.Hex)
    };
  }
  // 降级方案（仅演示）
  const iv = generateIV();
  const ciphertext = simpleXor(text, keyHex + iv);
  return { ciphertext, iv };
}

/**
 * AES-256-CBC 解密
 * @param {object} encrypted - { ciphertext: string(Hex), iv: string(Hex) }
 * @param {string} keyHex - 密钥（Hex）
 * @returns {string} 明文（含中文、emoji 等均正确还原）
 */
function decrypt(encrypted, keyHex) {
  if (CryptoJS) {
    const key = CryptoJS.enc.Hex.parse(keyHex);
    const iv  = CryptoJS.enc.Hex.parse(encrypted.iv);

    // 将 Hex 格式密文构造成 CipherParams 对象
    const ciphertextWordArray = CryptoJS.enc.Hex.parse(encrypted.ciphertext);
    const cipherParams = CryptoJS.lib.CipherParams.create({
      ciphertext: ciphertextWordArray
    });

    const decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });

    // toString(Utf8) 将 WordArray 还原为 UTF-8 字符串，中文、emoji 均正确
    const result = decrypted.toString(CryptoJS.enc.Utf8);

    // 空字符串是合法结果（空 URL/备注），只有解析失败才是 undefined
    if (result === undefined || result === null) {
      throw new Error('解密失败：密钥错误或数据已损坏');
    }
    return result;
  }
  // 降级方案（仅演示）
  const ct = (typeof encrypted === 'object') ? encrypted.ciphertext : encrypted;
  const iv = (typeof encrypted === 'object') ? (encrypted.iv || '') : '';
  return simpleXorDecrypt(ct, keyHex + iv);
}

/**
 * 加密凭证对象（AES-256-CBC，支持中文/emoji 等任意 Unicode）
 * @param {object} credential - 凭证对象 { title, username, password, url, category, notes }
 * @param {string} keyHex - 加密密钥
 * @returns {object} 加密后的凭证
 *   title / category / icon / id / createdAt / updatedAt 明文存储（非敏感）
 *   username / password / url / notes 加密存储（敏感字段）
 */
function encryptCredential(credential, keyHex) {
  // 统一处理 null/undefined → 空字符串
  const s = (v) => (v == null ? '' : String(v));
  return {
    id:       credential.id || generateId(),
    title:    s(credential.title),          // ← 明文存储，避免乱码，标题非敏感
    username: encrypt(s(credential.username), keyHex),
    password: encrypt(s(credential.password), keyHex),
    url:      encrypt(s(credential.url),      keyHex),
    category: credential.category || 'other',
    notes:    encrypt(s(credential.notes),    keyHex),
    icon:     credential.icon || '🔒',
    createdAt: credential.createdAt || Date.now(),
    updatedAt: Date.now()
  };
}

/**
 * 解密凭证对象
 * @param {object} encryptedCred - 加密凭证
 * @param {string} keyHex - 解密密钥
 * @returns {object} 明文凭证
 */
function decryptCredential(encryptedCred, keyHex) {
  // 安全解密单个字段：失败时返回占位符，不影响其他字段
  const safeDecrypt = (field, fallback) => {
    if (!field || !field.ciphertext || !field.iv) return fallback || '';
    try {
      const result = decrypt(field, keyHex);
      // 乱码检测：结果包含大量控制字符或私用区字符，说明是旧格式或密钥错误
      const totalLen = result.length;
      if (totalLen > 0) {
        const nonPrintable = (result.match(/[\x00-\x08\x0E-\x1F\x7F-\x9F\uE000-\uF8FF]/g) || []).length;
        if (nonPrintable / totalLen > 0.25) {
          return fallback || '[旧数据已损坏，请重新录入]';
        }
        // 旧 simpleXor 中文乱码特征：含有大量 Latin-1 扩展范围 (ÿ, Ç, Ò 等)
        // 同时不含任何正常 ASCII + CJK 字符的合理比例
        const latin1Extended = (result.match(/[\x80-\xFF]/g) || []).length;
        const normalChars = (result.match(/[\x20-\x7E\u4E00-\u9FFF\u3000-\u303F]/g) || []).length;
        if (latin1Extended > 0 && normalChars === 0 && latin1Extended / totalLen > 0.4) {
          return fallback || '[旧数据已损坏，请重新录入]';
        }
      }
      return result;
    } catch (e) {
      return fallback || '[解密失败]';
    }
  };

  // 兼容旧数据：title 字段可能是旧版加密对象 { ciphertext, iv }
  // 新版 title 是明文字符串，若检测到旧格式则尝试解密，失败则显示占位符
  const resolveTitle = (titleField) => {
    if (!titleField) return '';
    if (typeof titleField === 'string') return titleField;  // 新格式：直接返回
    // 旧格式：尝试解密
    return safeDecrypt(titleField, '(旧数据，请删除重新录入)');
  };

  try {
    return {
      id:       encryptedCred.id,
      title:    resolveTitle(encryptedCred.title),   // ← 兼容新旧格式
      username: safeDecrypt(encryptedCred.username, ''),
      password: safeDecrypt(encryptedCred.password, ''),
      url:      safeDecrypt(encryptedCred.url,      ''),
      category: encryptedCred.category,
      notes:    safeDecrypt(encryptedCred.notes,    ''),
      icon:     encryptedCred.icon,
      createdAt: encryptedCred.createdAt,
      updatedAt: encryptedCred.updatedAt,
      _decryptError: false
    };
  } catch (e) {
    // 兜底：返回带错误标记的占位凭证，不崩溃
    return {
      id:       encryptedCred.id,
      title:    (typeof encryptedCred.title === 'string' ? encryptedCred.title : '') || '(数据损坏，请删除重新录入)',
      username: '',
      password: '',
      url:      '',
      category: encryptedCred.category || 'other',
      notes:    '',
      icon:     '⚠️',
      createdAt: encryptedCred.createdAt,
      updatedAt: encryptedCred.updatedAt,
      _decryptError: true
    };
  }
}

/**
 * 生成唯一 ID
 */
function generateId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return timestamp + random;
}

// -- 降级方案辅助函数（仅演示用） --

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * 降级加密：先 encodeURIComponent 确保全部 ASCII，
 * 再对每个字节做 XOR，输出固定 2 位 hex。
 * 这样中文/emoji 均可正确加解密，不会出现乱码。
 */
function simpleXor(text, key) {
  // 先将文本编码为 UTF-8 percent-encoding（全 ASCII）
  const encoded = encodeURIComponent(text);
  let result = '';
  const keyBytes = uriToBytes(key);
  for (let i = 0; i < encoded.length; i++) {
    // charCode 范围 0-127（ASCII），XOR 结果范围 0-255，固定 2 位 hex
    const xored = encoded.charCodeAt(i) ^ (keyBytes[i % keyBytes.length]);
    result += (xored & 0xFF).toString(16).padStart(2, '0');
  }
  return result;
}

/**
 * 降级解密：与 simpleXor 配对，每次取 2 个 hex → 1 字节，XOR 还原，
 * 最后 decodeURIComponent 恢复原始字符串（含中文/emoji）
 */
function simpleXorDecrypt(hexStr, key) {
  const keyBytes = uriToBytes(key);
  let encoded = '';
  for (let i = 0; i < hexStr.length; i += 2) {
    const byte = parseInt(hexStr.substr(i, 2), 16);
    const keyByte = keyBytes[(i / 2) % keyBytes.length];
    encoded += String.fromCharCode(byte ^ keyByte);
  }
  try {
    return decodeURIComponent(encoded);
  } catch (e) {
    // 解码失败时原样返回（兼容旧数据）
    return encoded;
  }
}

/**
 * 把一个字符串转为字节数组（用于 XOR key），
 * 微信小程序不支持 TextEncoder，用 charCode 取低 8 位即可（key 是 hex 字符串，全 ASCII）
 */
function uriToBytes(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i) & 0xFF);
  }
  // 防止 key 为空
  if (bytes.length === 0) bytes.push(0x5A);
  return bytes;
}

module.exports = {
  generateSalt,
  deriveKey,
  generateMasterHash,
  generateIV,
  encrypt,
  decrypt,
  encryptCredential,
  decryptCredential,
  generateId
};
