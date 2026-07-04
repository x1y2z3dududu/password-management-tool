// utils/cloud-sync.js — 微信云开发跨设备同步
// 数据流向：本地 ↔ wx.Storage ↔ CloudBase
// 安全：云端仅存储加密 vault + salt + hash，永远不上传明文密码

const DB_COLLECTION = 'user_data';
let _db = null;

function getDB() {
  if (!_db) _db = wx.cloud.database();
  return _db;
}

/**
 * 获取当前用户的云文档（每个用户只有一条记录）
 * @returns {Object|null}
 */
async function getCloudDoc() {
  try {
    const db = getDB();
    const res = await db.collection(DB_COLLECTION).limit(1).get();
    return (res.data && res.data.length > 0) ? res.data[0] : null;
  } catch (e) {
    console.warn('[CloudSync] pull failed:', e.message);
    return null;
  }
}

/**
 * 拉取云端 salt + hash（新设备冷启动用）
 * @returns {{salt: string, hash: string}|null}
 */
async function pullAuthData() {
  const doc = await getCloudDoc();
  if (!doc) return null;
  return {
    salt: doc.master_salt || null,
    hash: doc.master_hash || null
  };
}

/**
 * 拉取所有云端数据
 * @returns {Object|null}
 */
async function pullAll() {
  const doc = await getCloudDoc();
  if (!doc) return null;
  return {
    salt: doc.master_salt || null,
    hash: doc.master_hash || null,
    vault: doc.vault_data || null,
    settings: doc.user_settings || null,
    categories: doc.custom_categories || null,
    updatedAt: doc.updatedAt || 0
  };
}

/**
 * 推送数据到云端（upsert：有则更新，无则创建）
 * @param {Object} data - key-value 要推送的字段
 * @returns {Promise<boolean>}
 */
async function pushData(data) {
  const payload = { ...data, updatedAt: Date.now() };
  try {
    const db = getDB();
    const existing = await db.collection(DB_COLLECTION).limit(1).get();
    if (existing.data && existing.data.length > 0) {
      await db.collection(DB_COLLECTION).doc(existing.data[0]._id).update({ data: payload });
    } else {
      await db.collection(DB_COLLECTION).add({ data: payload });
    }
    console.log('[CloudSync] push OK');
    return true;
  } catch (e) {
    console.warn('[CloudSync] push failed:', e.message);
    return false;
  }
}

/**
 * 推送认证数据（仅 salt + hash）
 */
async function pushAuth(salt, hash) {
  return pushData({ master_salt: salt, master_hash: hash });
}

/**
 * 推送 vault 数据
 */
async function pushVault(vaultData) {
  return pushData({ vault_data: vaultData });
}

/**
 * 全量推送
 */
async function pushAll({ salt, hash, vault, settings, categories }) {
  const data = {};
  if (salt !== undefined) data.master_salt = salt;
  if (hash !== undefined) data.master_hash = hash;
  if (vault !== undefined) data.vault_data = vault;
  if (settings !== undefined) data.user_settings = settings;
  if (categories !== undefined) data.custom_categories = categories;
  return pushData(data);
}

module.exports = {
  getCloudDoc,
  pullAuthData,
  pullAll,
  pushData,
  pushVault,
  pushAuth,
  pushAll
};
