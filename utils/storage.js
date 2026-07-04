/**
 * utils/storage.js - 凭证存储与检索服务
 *
 * 存储结构：
 *   Storage Key: 'vault_data' → 加密后的凭证数组 JSON
 *   Storage Key: 'vault_meta' → { count, lastModified, searchIndex }
 *
 * 所有凭证在存储前已通过 crypto.js 加密，raw credentials 永不清除写入 Storage
 */

const { encryptCredential, decryptCredential } = require('./crypto');
const searchEngine = require('./search');

// 存储键名
const STORAGE_KEYS = {
  VAULT_DATA: 'vault_data',
  VAULT_META: 'vault_meta',
  USER_SETTINGS: 'user_settings'
};

/**
 * 获取当前加密密钥（从 App 全局状态）
 */
function getKey() {
  const app = getApp();
  const key = app.getMasterKey();
  if (!key) {
    throw new Error('NOT_UNLOCKED');
  }
  return key;
}

/**
 * 加载所有凭证（解密后返回）
 * @returns {Array} 凭证数组
 */
function loadCredentials() {
  const key = getKey();
  const encryptedData = wx.getStorageSync(STORAGE_KEYS.VAULT_DATA);

  if (!encryptedData || encryptedData.length === 0) {
    return [];
  }

  try {
    const vault = JSON.parse(encryptedData);
    return vault.map(item => decryptCredential(item, key));
  } catch (e) {
    console.error('加载凭证失败:', e);
    throw new Error('数据解密失败，请确认主密码正确');
  }
}

/**
 * 保存所有凭证（加密后存储）
 * @param {Array} credentials - 凭证数组
 */
function saveCredentials(credentials) {
  const key = getKey();

  const vault = credentials.map(cred => encryptCredential(cred, key));
  const encryptedData = JSON.stringify(vault);

  wx.setStorageSync(STORAGE_KEYS.VAULT_DATA, encryptedData);

  // 更新元数据
  updateMeta(credentials);
}

/**
 * 添加一个凭证
 * @param {object} credential - 新凭证对象
 * @returns {object} 添加后的凭证（含 ID）
 */
function addCredential(credential) {
  const credentials = loadCredentials();

  const newCred = {
    ...credential,
    id: require('./crypto').generateId(),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  credentials.push(newCred);
  saveCredentials(credentials);

  // 更新搜索索引
  searchEngine.indexCredential(newCred);

  return newCred;
}

/**
 * 更新一个凭证
 * @param {string} id - 凭证 ID
 * @param {object} updates - 要更新的字段
 * @returns {object|null} 更新后的凭证
 */
function updateCredential(id, updates) {
  const credentials = loadCredentials();
  const index = credentials.findIndex(c => c.id === id);

  if (index === -1) return null;

  const updated = {
    ...credentials[index],
    ...updates,
    id, // 保护 ID 不被覆盖
    updatedAt: Date.now()
  };

  credentials[index] = updated;
  saveCredentials(credentials);

  // 更新搜索索引
  searchEngine.indexCredential(updated);

  return updated;
}

/**
 * 删除一个凭证
 * @param {string} id - 凭证 ID
 * @returns {boolean} 是否删除成功
 */
function deleteCredential(id) {
  const credentials = loadCredentials();
  const index = credentials.findIndex(c => c.id === id);

  if (index === -1) return false;

  credentials.splice(index, 1);
  saveCredentials(credentials);

  // 从搜索索引移除
  searchEngine.removeCredential(id);

  return true;
}

/**
 * 根据 ID 获取单个凭证
 * @param {string} id
 * @returns {object|null}
 */
function getCredentialById(id) {
  const credentials = loadCredentials();
  return credentials.find(c => c.id === id) || null;
}

/**
 * 获取凭证总数
 */
function getCredentialCount() {
  try {
    const key = getKey();
    const encryptedData = wx.getStorageSync(STORAGE_KEYS.VAULT_DATA);
    if (!encryptedData) return 0;
    const vault = JSON.parse(encryptedData);
    return vault.length;
  } catch (e) {
    return 0;
  }
}

/**
 * 更新存储元数据
 */
function updateMeta(credentials) {
  const meta = {
    count: credentials.length,
    lastModified: Date.now()
  };
  wx.setStorageSync(STORAGE_KEYS.VAULT_META, meta);
}

/**
 * 获取存储元数据
 */
function getMeta() {
  return wx.getStorageSync(STORAGE_KEYS.VAULT_META) || { count: 0, lastModified: 0 };
}

/**
 * 导出加密的凭证数据（用于备份）
 * 包含 vault_data + custom_categories + user_settings，完整迁移
 * @returns {string} JSON 字符串
 */
function exportVault() {
  const encryptedData = wx.getStorageSync(STORAGE_KEYS.VAULT_DATA);
  const categories = wx.getStorageSync('custom_categories') || '';
  const userSettings = wx.getStorageSync(STORAGE_KEYS.USER_SETTINGS) || '';

  const meta = getMeta();
  return JSON.stringify({
    version: 2,
    app: 'misuo',
    exportedAt: Date.now(),
    meta: meta,
    data: encryptedData ? JSON.parse(encryptedData) : [],
    categories: categories,
    userSettings: userSettings
  });
}

/**
 * 导入加密的凭证数据（从备份恢复）
 * @param {string} jsonData - 导出的 JSON 字符串
 * @returns {{ success: boolean, count: number }}
 */
function importVault(jsonData) {
  try {
    const backup = JSON.parse(jsonData);

    // 支持 v1 和 v2 两种格式
    if (!backup.data) {
      throw new Error('无效的备份文件格式');
    }

    if (!Array.isArray(backup.data)) {
      throw new Error('备份数据格式不正确');
    }

    // 恢复凭证数据
    wx.setStorageSync(STORAGE_KEYS.VAULT_DATA, JSON.stringify(backup.data));

    // 恢复分类数据 (v2+)
    if (backup.categories) {
      wx.setStorageSync('custom_categories', backup.categories);
    }

    // 恢复用户设置 (v2+)
    if (backup.userSettings) {
      wx.setStorageSync(STORAGE_KEYS.USER_SETTINGS, backup.userSettings);
    }

    // 更新元数据
    const meta = {
      count: backup.data.length,
      lastModified: backup.exportedAt || Date.now()
    };
    wx.setStorageSync(STORAGE_KEYS.VAULT_META, meta);

    // 重建搜索索引
    const key = getKey();
    const decrypted = backup.data.map(item => {
      try {
        return require('./crypto').decryptCredential(item, key);
      } catch (e) {
        return { id: item.id, title: item.title || '(解密失败)', _decryptError: true };
      }
    });
    searchEngine.rebuildIndex(decrypted);

    return { success: true, count: backup.data.length };
  } catch (e) {
    throw new Error('导入失败：' + e.message);
  }
}

/**
 * 清空所有数据（危险操作）
 */
function clearAll() {
  wx.removeStorageSync(STORAGE_KEYS.VAULT_DATA);
  wx.removeStorageSync(STORAGE_KEYS.VAULT_META);
  searchEngine.clearIndex();
}

module.exports = {
  STORAGE_KEYS,
  loadCredentials,
  saveCredentials,
  addCredential,
  updateCredential,
  deleteCredential,
  getCredentialById,
  getCredentialCount,
  exportVault,
  importVault,
  clearAll,
  getMeta
};
