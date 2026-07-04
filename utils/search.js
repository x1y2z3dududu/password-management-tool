/**
 * utils/search.js - 全局搜索引擎
 *
 * 策略：
 *   1. 内存倒排索引（启动后从解密凭证构建）
 *   2. 匹配优先级：精确匹配 > 前缀匹配 > 包含匹配 > 拼音首字母 > 模糊匹配
 *   3. 支持多字段：标题、用户名、域名、分类、标签
 */

// 搜索索引（内存中）
let searchIndex = {
  // credentialId → { tokens: Set, category: string }
  entries: {},
  // token → Set<credentialId>
  invertedIndex: {}
};

// 分类中英文映射（用于搜索时的分类匹配）
const CATEGORY_LABELS = {
  'social': '社交',
  'email': '邮箱',
  'finance': '金融',
  'work': '工作',
  'entertainment': '娱乐',
  'shopping': '购物',
  'other': '其他'
};

/**
 * 对文本进行分词
 * @param {string} text
 * @returns {string[]} token 数组
 */
function tokenize(text) {
  if (!text) return [];

  const tokens = new Set();

  // 转小写
  const lower = text.toLowerCase();

  // 全词
  tokens.add(lower);

  // 按分隔符拆分
  const parts = lower.split(/[\s\-_.,@:/\\]+/).filter(Boolean);
  parts.forEach(p => {
    tokens.add(p);
    // 前缀（>= 2字符）
    for (let i = 2; i <= p.length; i++) {
      tokens.add(p.substring(0, i));
    }
  });

  // 提取拼音首字母（简单策略：提取所有大写字母和数字）
  const alphanumeric = text.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '');
  if (alphanumeric.length >= 2) {
    // 对于中文，添加每个字符
    for (const char of alphanumeric) {
      tokens.add(char.toLowerCase());
    }
    // 对于英文，添加首字母组合
    const initials = alphanumeric.replace(/[a-z]/g, '').toLowerCase();
    if (initials.length >= 2) {
      tokens.add(initials);
    }
  }

  return [...tokens];
}

/**
 * 将凭证加入搜索索引
 * @param {object} credential - 解密后的凭证
 */
function indexCredential(credential) {
  const { id, title, username, url, category, notes } = credential;

  // 收集所有可搜索文本
  const searchTexts = [
    title, username, url, notes,
    CATEGORY_LABELS[category] || category
  ].filter(Boolean);

  // 分词
  const allTokens = new Set();
  searchTexts.forEach(text => {
    tokenize(text).forEach(t => allTokens.add(t));
  });

  // 移除此凭证的旧索引
  removeCredential(id);

  // 写入新索引
  searchIndex.entries[id] = {
    tokens: allTokens,
    category: category
  };

  // 更新倒排索引
  allTokens.forEach(token => {
    if (!searchIndex.invertedIndex[token]) {
      searchIndex.invertedIndex[token] = new Set();
    }
    searchIndex.invertedIndex[token].add(id);
  });
}

/**
 * 从索引中移除凭证
 * @param {string} id
 */
function removeCredential(id) {
  const entry = searchIndex.entries[id];
  if (!entry) return;

  // 从倒排索引中移除
  if (entry.tokens) {
    entry.tokens.forEach(token => {
      const set = searchIndex.invertedIndex[token];
      if (set) {
        set.delete(id);
        if (set.size === 0) {
          delete searchIndex.invertedIndex[token];
        }
      }
    });
  }

  delete searchIndex.entries[id];
}

/**
 * 搜索凭证 ID
 * @param {string} query - 搜索关键词
 * @param {object} options - { category?, limit? }
 * @returns {string[]} 匹配的凭证 ID 数组，按相关度排序
 */
function search(query, options = {}) {
  if (!query || query.trim().length === 0) {
    return Object.keys(searchIndex.entries);
  }

  const q = query.toLowerCase().trim();
  const tokens = tokenize(q);

  // 评分：每个匹配 token 计分
  const scores = {};

  tokens.forEach(token => {
    // 精确匹配
    const exactSet = searchIndex.invertedIndex[token];
    if (exactSet) {
      exactSet.forEach(id => {
        scores[id] = (scores[id] || 0) + 10;
      });
    }

    // 前缀/包含匹配
    Object.keys(searchIndex.invertedIndex).forEach(indexToken => {
      if (indexToken.startsWith(token) || indexToken.includes(token)) {
        const set = searchIndex.invertedIndex[indexToken];
        set.forEach(id => {
          scores[id] = (scores[id] || 0) + 3;
        });
      }
    });
  });

  // 按分数降序排列
  let results = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  // 分类过滤
  if (options.category && options.category !== 'all') {
    results = results.filter(id => {
      const entry = searchIndex.entries[id];
      return entry && entry.category === options.category;
    });
  }

  // 限制数量
  if (options.limit && options.limit > 0) {
    results = results.slice(0, options.limit);
  }

  return results;
}

/**
 * 从完整凭证列表中搜索并返回凭证对象
 * @param {string} query
 * @param {Array} credentials - 解密后的完整凭证列表
 * @param {object} options
 * @returns {Array} 匹配的凭证对象
 */
function searchCredentials(query, credentials, options = {}) {
  const matchedIds = search(query, options);
  const idSet = new Set(matchedIds);

  return credentials.filter(cred => idSet.has(cred.id));
}

/**
 * 重建整个搜索索引
 */
function rebuildIndex(credentials) {
  clearIndex();
  if (credentials) {
    credentials.forEach(cred => indexCredential(cred));
  }
}

/**
 * 清空搜索索引
 */
function clearIndex() {
  searchIndex = {
    entries: {},
    invertedIndex: {}
  };
}

/**
 * 获取索引统计
 */
function getIndexStats() {
  return {
    entries: Object.keys(searchIndex.entries).length,
    tokens: Object.keys(searchIndex.invertedIndex).length
  };
}

module.exports = {
  indexCredential,
  removeCredential,
  search,
  searchCredentials,
  rebuildIndex,
  clearIndex,
  getIndexStats,
  CATEGORY_LABELS
};
