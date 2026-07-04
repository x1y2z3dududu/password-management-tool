/**
 * utils/categories.js - 分类标签管理层
 *
 * 提供统一的分类增删改查能力，所有页面通过本模块获取分类数据。
 * 用户自定义分类存储在 wx.Storage key 'custom_categories' 中。
 * 系统默认分类仅作为首次使用时的兜底。
 */

// 系统内置默认分类（仅首次或重置时使用）
const DEFAULT_CATEGORIES = [
  { key: 'social',        icon: '💬', label: '社交', color: '#534AB7' },
  { key: 'email',         icon: '📧', label: '邮箱', color: '#1D9E75' },
  { key: 'finance',       icon: '💰', label: '金融', color: '#EF9F27' },
  { key: 'work',          icon: '💼', label: '工作', color: '#3C7DD9' },
  { key: 'entertainment', icon: '🎮', label: '娱乐', color: '#E8608F' },
  { key: 'shopping',      icon: '🛒', label: '购物', color: '#F27D3B' },
  { key: 'other',         icon: '📌', label: '其他', color: '#888780' }
];

// 为新增分类准备的调色板（循环使用）
const COLOR_PALETTE = [
  '#534AB7', '#1D9E75', '#EF9F27', '#3C7DD9',
  '#E8608F', '#F27D3B', '#888780', '#6C5CE7',
  '#00B894', '#E17055', '#0984E3', '#D63031',
  '#FDCB6E', '#55BFC0', '#A29BFE', '#FF7675'
];

const STORAGE_KEY = 'custom_categories';

/**
 * 生成唯一 key（用户自定义的用 c_ 前缀避免与系统 key 冲突）
 */
function generateKey(label) {
  const timestamp = Date.now().toString(36).slice(-4);
  const random = Math.random().toString(36).slice(2, 5);
  return `c_${timestamp}${random}`;
}

/**
 * 分配颜色（基于已有数量，从调色板循环取）
 */
function assignColor(allCategories) {
  const usedCount = allCategories.length;
  return COLOR_PALETTE[usedCount % COLOR_PALETTE.length];
}

// ========== 读操作 ==========

/**
 * 获取全部分类（含「全部」占位）
 * @returns {Array<{key, icon, label, color}>}
 */
function getCategories() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) { /* 忽略解析错误 */ }

  // 兜底：返回默认分类
  return [...DEFAULT_CATEGORIES];
}

/**
 * 获取首页用的分类列表（含「全部」）
 */
function getCategoriesForIndex() {
  const cats = getCategories();
  return [{ key: 'all', icon: '📋', label: '全部', color: '' }, ...cats];
}

/**
 * 获取编辑页用的分类列表（不含「全部」）
 */
function getCategoriesForEdit() {
  return getCategories();
}

/**
 * 根据 key 获取标签名
 */
function getCategoryLabel(key) {
  const cats = getCategories();
  const found = cats.find(c => c.key === key);
  return found ? found.label : key || '其他';
}

/**
 * 根据 key 获取颜色
 */
function getCategoryColor(key) {
  const cats = getCategories();
  const found = cats.find(c => c.key === key);
  return found ? found.color : '#888780';
}

/**
 * 获取颜色映射表（兼容旧代码的 object 格式）
 */
function getCategoryColorMap() {
  const cats = getCategories();
  const map = {};
  cats.forEach(c => { map[c.key] = c.color; });
  return map;
}

// ========== 写操作 ==========

/**
 * 添加一个分类
 * @returns {{ success: boolean, error?: string }}
 */
function addCategory(label, icon, color) {
  if (!label || !label.trim()) {
    return { success: false, error: '分类名称不能为空' };
  }

  const trimmed = label.trim();
  if (trimmed.length > 6) {
    return { success: false, error: '分类名称不能超过6个字' };
  }

  const cats = getCategories();

  // 检查重名
  if (cats.some(c => c.label === trimmed)) {
    return { success: false, error: '分类名称已存在' };
  }

  const newCat = {
    key: generateKey(trimmed),
    icon: icon || '📌',
    label: trimmed,
    color: color || assignColor(cats)
  };

  cats.push(newCat);
  saveCategories(cats);
  return { success: true, category: newCat };
}

/**
 * 更新分类（可修改 label / icon / color）
 * @returns {{ success: boolean, error?: string }}
 */
function updateCategory(key, updates) {
  const cats = getCategories();
  const idx = cats.findIndex(c => c.key === key);
  if (idx === -1) {
    return { success: false, error: '分类不存在' };
  }

  // 检查 label 重名
  if (updates.label) {
    const label = updates.label.trim();
    if (label.length > 6) {
      return { success: false, error: '分类名称不能超过6个字' };
    }
    if (cats.some((c, i) => i !== idx && c.label === label)) {
      return { success: false, error: '分类名称已存在' };
    }
    updates.label = label;
  }

  cats[idx] = { ...cats[idx], ...updates };
  saveCategories(cats);

  // 同步更新引用此分类的所有凭证（保留 categoryKey，仅 label 可能变了不影响关联）
  return { success: true, category: cats[idx] };
}

/**
 * 删除分类（同时将引用此分类的凭证归入「其他」）
 * @returns {{ success: boolean, error?: string }}
 */
function deleteCategory(key) {
  const cats = getCategories();

  if (cats.length <= 1) {
    return { success: false, error: '至少保留一个分类' };
  }

  const idx = cats.findIndex(c => c.key === key);
  if (idx === -1) {
    return { success: false, error: '分类不存在' };
  }

  cats.splice(idx, 1);
  saveCategories(cats);

  // 批量迁移引用此分类的凭证到 other
  migrateCredentialsCategory(key, 'other');

  return { success: true };
}

/**
 * 恢复默认分类
 */
function resetToDefault() {
  saveCategories([...DEFAULT_CATEGORIES]);
  return DEFAULT_CATEGORIES;
}

/**
 * 迁移所有使用旧 categoryKey 的凭证到新 categoryKey
 */
function migrateCredentialsCategory(oldKey, newKey) {
  try {
    const raw = wx.getStorageSync('vault_data');
    if (!raw) return;

    const vault = JSON.parse(raw);
    if (!Array.isArray(vault)) return;

    const { decryptCredential, encryptCredential } = require('./crypto');
    const app = getApp();
    const keyHex = app.getMasterKey();
    if (!keyHex) return;

    // 解密 → 修改 category → 加密 → 存回
    const migrated = vault.map(item => {
      const decrypted = decryptCredential(item, keyHex);
      if (decrypted.category === oldKey) {
        decrypted.category = newKey;
        decrypted.updatedAt = Date.now();
        return encryptCredential(decrypted, keyHex);
      }
      return item;
    });

    wx.setStorageSync('vault_data', JSON.stringify(migrated));
    console.log(`分类迁移完成: ${oldKey} → ${newKey}`);
  } catch (e) {
    console.error('分类迁移失败:', e);
  }
}

// ========== 内部 ==========

function saveCategories(cats) {
  wx.setStorageSync(STORAGE_KEY, JSON.stringify(cats));
}

module.exports = {
  getCategories,
  getCategoriesForIndex,
  getCategoriesForEdit,
  getCategoryLabel,
  getCategoryColor,
  getCategoryColorMap,
  addCategory,
  updateCategory,
  deleteCategory,
  resetToDefault
};
