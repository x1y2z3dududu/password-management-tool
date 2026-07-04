// app.js - 密锁小程序入口
const crypto = require('./utils/crypto');
const cloudSync = require('./utils/cloud-sync');

App({
  globalData: {
    // 主密码的 PBKDF2 派生密钥（仅在解锁后存在于内存）
    masterKey: null,
    // 用户设置（解锁后加载）
    settings: {
      autoLockTimeout: 60,     // 自动锁定秒数，默认60秒
      maxFailedAttempts: 5,    // 最大错误密码尝试次数
      biometricEnabled: false, // 生物识别是否开启
      darkMode: false          // 暗色模式（v1.2）
    },
    // 锁定计时器
    lockTimer: null,
    // 云同步状态
    cloudReady: false
  },

  onLaunch() {
    // 初始化云环境
    this.initCloud();

    // 检查是否首次启动（无主密码哈希）
    const storedHash = wx.getStorageSync('master_hash');
    this.globalData.isFirstLaunch = !storedHash;

    // 如果本地无数据，尝试从云端拉取 salt + hash
    if (this.globalData.isFirstLaunch) {
      this.pullAuthFromCloud();
    }

    // 设置全局未捕获错误处理
    if (typeof this.onUnhandledRejection === 'function') {
      this.onUnhandledRejection = (reason, promise) => {
        console.error('Unhandled Rejection:', reason);
      };
    }
  },

  /**
   * 初始化微信云开发
   */
  initCloud() {
    if (!wx.cloud) {
      console.warn('[Cloud] wx.cloud not available, skip init');
      this.globalData.cloudReady = false;
      return;
    }
    try {
      wx.cloud.init({
        env: 'cloudbase-d8gpv3xmn0e84b4d2',
        traceUser: true
      });
      this.globalData.cloudReady = true;
      console.log('[Cloud] init OK');
    } catch (e) {
      console.warn('[Cloud] init failed:', e.message);
      this.globalData.cloudReady = false;
    }
  },

  /**
   * 从云端拉取 salt + hash（冷启动 / 新设备）
   */
  async pullAuthFromCloud() {
    if (!this.globalData.cloudReady) return;
    try {
      const auth = await cloudSync.pullAuthData();
      if (auth && auth.salt && auth.hash) {
        wx.setStorageSync('master_salt', auth.salt);
        wx.setStorageSync('master_hash', auth.hash);
        this.globalData.isFirstLaunch = false;
        console.log('[Cloud] pulled auth data from cloud');
      }
    } catch (e) {
      console.warn('[Cloud] pullAuthFromCloud failed:', e.message);
    }
  },

  /**
   * 推送 vault 到云端（每次修改数据后调用）
   */
  async syncVaultToCloud() {
    if (!this.globalData.cloudReady) return;
    try {
      const vaultData = wx.getStorageSync('vault_data');
      if (!vaultData) return;
      await cloudSync.pushVault(vaultData);
    } catch (e) {
      console.warn('[Cloud] syncVaultToCloud failed:', e.message);
    }
  },

  /**
   * 推送 salt + hash + vault 到云端（首次设置 / 修改主密码后）
   */
  async syncAuthToCloud() {
    if (!this.globalData.cloudReady) return;
    try {
      const salt = wx.getStorageSync('master_salt');
      const hash = wx.getStorageSync('master_hash');
      const vault = wx.getStorageSync('vault_data');
      if (!salt || !hash) return;
      await cloudSync.pushAll({ salt, hash, vault });
    } catch (e) {
      console.warn('[Cloud] syncAuthToCloud failed:', e.message);
    }
  },

  /**
   * 全量同步（vault + categories + settings）
   * 每次凭证/分类/设置变更后调用
   */
  async syncAllToCloud() {
    if (!this.globalData.cloudReady) return;
    try {
      const salt = wx.getStorageSync('master_salt');
      const hash = wx.getStorageSync('master_hash');
      const vault = wx.getStorageSync('vault_data');
      const categories = wx.getStorageSync('custom_categories');
      const settings = wx.getStorageSync('user_settings');
      await cloudSync.pushAll({ salt, hash, vault, categories, settings });
    } catch (e) {
      console.warn('[Cloud] syncAllToCloud failed:', e.message);
    }
  },

  onShow() {
    // 从后台恢复时，密钥已被 onHide 清除，直接跳转解锁页
    if (this.getMasterHash() && !this.isUnlocked()) {
      wx.reLaunch({ url: '/pages/unlock/unlock' });
      return;
    }
    // 理论上不会走到这里（因为 onHide 已清除密钥），保留作为防御
    if (this.isUnlocked()) {
      this.resetLockTimer();
    }
  },

  onHide() {
    // 安全策略：进入后台立即清除密钥，每次回到前台都必须重新验证密码
    this.clearMasterKey();
  },

  /**
   * 存储主密码哈希（用于验证，非密钥本身）
   */
  setMasterHash(hash) {
    wx.setStorageSync('master_hash', hash);
    this.globalData.isFirstLaunch = false;
  },

  /**
   * 获取主密码哈希
   */
  getMasterHash() {
    return wx.getStorageSync('master_hash') || null;
  },

  /**
   * 设置当前会话的加密密钥
   */
  setMasterKey(key) {
    this.globalData.masterKey = key;
    this.resetLockTimer();
  },

  /**
   * 获取当前加密密钥
   */
  getMasterKey() {
    return this.globalData.masterKey;
  },

  /**
   * 清除内存中的密钥（锁定）
   */
  clearMasterKey() {
    this.globalData.masterKey = null;
    if (this.globalData.lockTimer) {
      clearTimeout(this.globalData.lockTimer);
      this.globalData.lockTimer = null;
    }
  },

  /**
   * 重置自动锁定计时器（用户操作时调用，延迟锁定）
   */
  resetLockTimer() {
    if (this.globalData.lockTimer) {
      clearTimeout(this.globalData.lockTimer);
      this.globalData.lockTimer = null;
    }
    const timeout = this.globalData.settings.autoLockTimeout;
    if (timeout > 0) {
      this.globalData.lockTimer = setTimeout(() => {
        this.clearMasterKey();
        wx.reLaunch({ url: '/pages/unlock/unlock' });
      }, timeout * 1000);
    }
  },

  /**
   * 检查是否已解锁
   */
  isUnlocked() {
    return !!this.globalData.masterKey;
  },

  /**
   * 验证当前主密码（不修改任何数据）
   * @param {string} password - 要验证的密码
   * @returns {Promise<boolean>}
   */
  async verifyMasterPassword(password) {
    const storedHash = this.getMasterHash();
    const salt = wx.getStorageSync('master_salt');
    if (!salt || !storedHash) {
      throw new Error('未设置主密码');
    }
    const hash = await crypto.generateMasterHash(password, salt);
    return hash === storedHash;
  },

  /**
   * 修改主密码 —— 用新密码重新加密所有数据
   * @param {string} currentPassword - 当前密码
   * @param {string} newPassword - 新密码
   * @returns {Promise<boolean>}
   */
  async changeMasterPassword(currentPassword, newPassword) {
    const cryptoModule = require('./utils/crypto');

    // 1. 验证当前密码
    const isCorrect = await this.verifyMasterPassword(currentPassword);
    if (!isCorrect) {
      throw new Error('当前密码不正确');
    }

    const oldSalt = wx.getStorageSync('master_salt');
    const oldKey = this.getMasterKey();
    if (!oldKey) {
      throw new Error('会话已过期，请重新解锁后再试');
    }

    // 2. 派生新密钥
    const newSalt = cryptoModule.generateSalt();
    const newKey = await cryptoModule.deriveKey(newPassword, newSalt);
    const newHash = await cryptoModule.generateMasterHash(newPassword, newSalt);

    // 3. 重新加密所有凭证数据
    const encryptedData = wx.getStorageSync('vault_data');
    if (encryptedData) {
      try {
        const vault = JSON.parse(encryptedData);
        const decrypted = vault.map(item => cryptoModule.decryptCredential(item, oldKey));
        const reencrypted = decrypted.map(item => cryptoModule.encryptCredential(item, newKey));
        wx.setStorageSync('vault_data', JSON.stringify(reencrypted));
      } catch (e) {
        throw new Error('重新加密数据失败：' + e.message);
      }
    }

    // 4. 更新盐值和哈希
    wx.setStorageSync('master_salt', newSalt);
    this.setMasterHash(newHash);

    // 5. 更新当前会话密钥
    this.setMasterKey(newKey);

    // 6. 同步到云端（新的 salt + hash + 加密 vault）
    this.syncAuthToCloud();

    return true;
  }
});
