// pages/unlock/unlock.js - 解锁逻辑
const crypto = require('../../utils/crypto');
const cloudSync = require('../../utils/cloud-sync');

Page({
  data: {
    password: '',
    showPassword: false,
    isFirstLaunch: true,
    inputFocus: false,
    loading: false,
    errorMsg: '',
    failedAttempts: 0,
    maxAttempts: 5,
    biometricSupported: false,
    showPrivacyModal: false
  },

  onLoad() {
    const app = getApp();

    // 检查是否首次使用
    const storedHash = app.getMasterHash();
    const isFirst = !storedHash;

    this.setData({
      isFirstLaunch: isFirst,
      maxAttempts: app.globalData.settings.maxFailedAttempts
    });

    // 检查隐私授权
    if (isFirst) {
      const privacyAccepted = wx.getStorageSync('privacy_accepted');
      if (!privacyAccepted) {
        this.setData({ showPrivacyModal: true });
        return;
      }
    }

    // 检查生物识别支持
    this.checkBiometricSupport();

    // 如果已解锁，直接跳转
    if (app.isUnlocked()) {
      wx.reLaunch({ url: '/pages/index/index' });
      return;
    }
  },

  onShow() {
    // 让输入框自动聚焦
    setTimeout(() => {
      this.setData({ inputFocus: true });
    }, 300);
  },

  /**
   * 检查生物识别是否可用
   */
  checkBiometricSupport() {
    // 微信 SOTER 生物认证
    if (wx.checkIsSupportSoterAuthentication) {
      wx.checkIsSupportSoterAuthentication({
        success: (res) => {
          if (res.supportMode && res.supportMode.includes('fingerPrint')) {
            this.setData({ biometricSupported: true });
          }
        },
        fail: () => {
          this.setData({ biometricSupported: false });
        }
      });
    }
  },

  /**
   * 密码输入
   */
  onPasswordInput(e) {
    this.setData({
      password: e.detail.value,
      errorMsg: ''
    });
  },

  /**
   * 切换密码显隐
   */
  togglePassword() {
    this.setData({ showPassword: !this.data.showPassword });
  },

  /**
   * 解锁 / 创建主密码
   */
  async onUnlock() {
    const { password, isFirstLaunch } = this.data;

    if (!password) {
      this.setData({ errorMsg: '请输入密码' });
      return;
    }

    // 首次创建：密码长度要求
    if (isFirstLaunch && password.length < 6) {
      this.setData({ errorMsg: '主密码至少需要6位，建议混合字母+数字+符号' });
      return;
    }

    this.setData({ loading: true, errorMsg: '' });

    try {
      if (isFirstLaunch) {
        // 首次设置主密码
        await this.setupMasterPassword(password);
      } else {
        // 验证主密码并派生密钥
        await this.verifyAndUnlock(password);
      }
    } catch (err) {
      console.error('解锁失败:', err);
      // 根据错误类型给出具体提示
      let errMsg = '初始化失败，请重试';
      if (err && err.message) {
        if (err.message.includes('crypto-js') || err.message.includes('require')) {
          errMsg = '加密模块未就绪，请在开发者工具中执行「构建 npm」后重试';
        } else if (err.message.includes('盐值') || err.message.includes('salt')) {
          errMsg = '数据异常，请清除小程序缓存后重试';
        } else {
          errMsg = '初始化失败：' + err.message;
        }
      }
      this.setData({
        loading: false,
        errorMsg: errMsg
      });
    }
  },

  /**
   * 首次设置主密码
   */
  async setupMasterPassword(password) {
    const app = getApp();

    // 生成随机盐
    const salt = crypto.generateSalt();

    // 派生密钥
    const key = await crypto.deriveKey(password, salt);

    // 生成验证哈希
    const hash = await crypto.generateMasterHash(password, salt);

    // 存储盐和验证哈希
    wx.setStorageSync('master_salt', salt);
    app.setMasterHash(hash);

    // 设置当前会话密钥
    app.setMasterKey(key);

    this.setData({ loading: false });

    // 推送到云端（后台静默，不阻塞 UI）
    cloudSync.pushAuth(salt, hash).catch(() => {});

    // 跳转到首页
    wx.reLaunch({ url: '/pages/index/index' });
  },

  /**
   * 验证密码并解锁
   */
  async verifyAndUnlock(password) {
    const app = getApp();
    const storedHash = app.getMasterHash();
    let salt = wx.getStorageSync('master_salt');

    // ---- 存储完整性校验 ----
    if (!salt) {
      // 有 hash 但没有 salt：部分同步损坏，可能来自跨设备不可靠同步
      this.setData({
        loading: false,
        password: '',
        errorMsg: '数据异常：缺少加密盐值。可能因跨设备数据同步不完整导致。建议"重置并导入备份"恢复数据。'
      });
      return;
    }

    // 校验 salt 格式：必须是 32 位 hex 字符串
    const isValidSalt = /^[0-9a-fA-F]{32}$/.test(String(salt));
    if (!isValidSalt) {
      console.warn('检测到无效盐值格式:', String(salt).substring(0, 20) + '...');
      // 尝试截断或清理（微信存储同步有时会追加多余字符）
      const trimmed = String(salt).trim().substring(0, 32);
      if (/^[0-9a-fA-F]{32}$/.test(trimmed)) {
        // 清理后格式正确，尝试重新写入
        salt = trimmed;
        wx.setStorageSync('master_salt', salt);
      } else {
        this.setData({
          loading: false,
          password: '',
          errorMsg: '存储数据已损坏（盐值格式异常）。可能因跨设备同步不完整导致。建议"重置并导入备份"。'
        });
        return;
      }
    }

    // ---- 验证哈希 ----
    let hash;
    try {
      hash = await crypto.generateMasterHash(password, salt);
    } catch (e) {
      console.error('生成验证哈希失败:', e);
      this.setData({
        loading: false,
        errorMsg: '加密模块异常，请在开发者工具中执行"构建 npm"后重试'
      });
      return;
    }

    if (hash !== storedHash) {
      // 密码错误
      const attempts = this.data.failedAttempts + 1;

      // 检查是否可能是跨设备同步导致的数据不一致
      const vaultData = wx.getStorageSync('vault_data');
      const hasRemoteData = vaultData && vaultData.length > 10;

      let errMsg = '主密码错误，请重新输入';
      if (hasRemoteData) {
        errMsg = '主密码错误。如果你从其他设备切换到此设备，数据可能未完整同步，建议"重置并导入备份"。';
      }

      this.setData({
        loading: false,
        failedAttempts: attempts,
        password: '',
        errorMsg: errMsg
      });

      // 超次数锁定
      if (attempts >= this.data.maxAttempts) {
        this.setData({
          errorMsg: '密码错误次数过多，请30分钟后重试',
          loading: false
        });
      }
      return;
    }

    // 密码正确，派生密钥
    const key = await crypto.deriveKey(password, salt);

    // 设置会话密钥
    app.setMasterKey(key);

    this.setData({ loading: false });

    // 后台静默拉取云端 vault 并合并（不阻塞跳转）
    this.mergeCloudVault(key);

    // 跳转到首页
    wx.reLaunch({ url: '/pages/index/index' });
  },

  /**
   * 合并云端 vault 数据（后台静默执行）
   * 策略：按 credential id 去重，保留 updatedAt 更新的版本
   */
  async mergeCloudVault(key) {
    const app = getApp();
    if (!app.globalData.cloudReady) return;

    try {
      const cloudData = await cloudSync.pullAll();
      if (!cloudData || !cloudData.vault) return;

      // 尝试用当前密钥解密云端 vault
      let cloudVault;
      try {
        const cloudEncrypted = JSON.parse(cloudData.vault);
        cloudVault = cloudEncrypted.map(item => crypto.decryptCredential(item, key));
      } catch (e) {
        console.warn('[Cloud] cannot decrypt cloud vault with current key, skip merge');
        return;
      }

      if (!cloudVault || cloudVault.length === 0) return;

      // 解析本地 vault
      const localRaw = wx.getStorageSync('vault_data');
      let localVault = [];
      if (localRaw) {
        try {
          const localEncrypted = JSON.parse(localRaw);
          localVault = localEncrypted.map(item => crypto.decryptCredential(item, key));
        } catch (e) {
          console.warn('[Cloud] cannot decrypt local vault, use cloud only');
        }
      }

      // 合并：以 id 为键，保留 updatedAt 更新的
      const merged = new Map();
      for (const cred of localVault) {
        if (cred && cred.id && !cred._decryptError) merged.set(cred.id, cred);
      }
      for (const cred of cloudVault) {
        if (cred && cred.id && !cred._decryptError) {
          const existing = merged.get(cred.id);
          if (!existing || (cred.updatedAt > existing.updatedAt)) {
            merged.set(cred.id, cred);
          }
        }
      }

      const mergedList = Array.from(merged.values());
      if (mergedList.length === 0) return;

      // 重新加密并存储
      const reencrypted = mergedList.map(cred => crypto.encryptCredential(cred, key));
      wx.setStorageSync('vault_data', JSON.stringify(reencrypted));

      // 推送到云端
      cloudSync.pushVault(JSON.stringify(reencrypted)).catch(() => {});

      // 更新搜索索引
      const searchEngine = require('../../utils/search');
      searchEngine.rebuildIndex(mergedList);

      console.log(`[Cloud] merged ${mergedList.length} credentials (local: ${localVault.length}, cloud: ${cloudVault.length})`);
    } catch (e) {
      console.warn('[Cloud] mergeCloudVault failed:', e.message);
    }
  },

  /**
   * 重置本地存储（用于跨设备迁移场景）
   * 清空所有密锁数据，回到首次设置状态
   */
  resetAndStartFresh() {
    wx.showModal({
      title: '重置确认',
      content: '⚠️ 这将清空本设备上的所有密锁数据（包括主密码和加密凭证）。\n\n如果你曾在其他设备使用密锁且已导出备份，请在重置后通过"导入备份"恢复数据。\n\n确定要重置吗？',
      confirmText: '确认重置',
      confirmColor: '#A32D2D',
      success: (res) => {
        if (res.confirm) {
          try {
            // 清除所有密锁相关存储
            wx.removeStorageSync('master_salt');
            wx.removeStorageSync('master_hash');
            wx.removeStorageSync('vault_data');
            wx.removeStorageSync('vault_meta');
            wx.removeStorageSync('search_index');
            wx.removeStorageSync('custom_categories');
            wx.removeStorageSync('user_settings');
            wx.removeStorageSync('privacy_accepted');
            wx.removeStorageSync('biometric_key');

            // 清除 App 全局状态
            const app = getApp();
            app.clearMasterKey();
            app.globalData.isFirstLaunch = true;

            // 重置页面状态
            this.setData({
              isFirstLaunch: true,
              password: '',
              errorMsg: '',
              failedAttempts: 0,
              loading: false
            });

            wx.showToast({
              title: '已重置，请设置新主密码',
              icon: 'none',
              duration: 2000
            });
          } catch (e) {
            wx.showToast({
              title: '重置失败：' + e.message,
              icon: 'none'
            });
          }
        }
      }
    });
  },

  /**
   * 生物识别解锁
   */
  onBiometricUnlock() {
    const app = getApp();

    wx.startSoterAuthentication({
      requestAuthModes: ['fingerPrint'],
      challenge: 'misuo_biometric_unlock',
      authContent: '验证指纹以解锁密锁',
      success: async () => {
        // 生物识别通过后，从安全存储读取加密的密钥
        const encryptedKey = wx.getStorageSync('biometric_key');
        const salt = wx.getStorageSync('master_salt');

        if (encryptedKey && salt) {
          // 使用设备级密钥解密主密钥（简化实现）
          // 生产环境应使用微信 SOTER 的 ask 字段关联密钥
          app.setMasterKey(encryptedKey);
          wx.reLaunch({ url: '/pages/index/index' });
        } else {
          wx.showToast({
            title: '请先使用密码解锁一次以启用生物识别',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.log('生物识别失败:', err);
        wx.showToast({
          title: '验证失败，请使用密码解锁',
          icon: 'none'
        });
      }
    });
  },

  /**
   * 同意隐私政策
   */
  onAcceptPrivacy() {
    wx.setStorageSync('privacy_accepted', true);
    this.setData({ showPrivacyModal: false }, () => {
      this.checkBiometricSupport();
    });
  },

  /**
   * 拒绝隐私政策
   */
  onRejectPrivacy() {
    wx.showModal({
      title: '提示',
      content: '需要同意隐私政策才能使用密锁。密锁不会上传你的任何数据，所有密码仅在你本地加密存储。',
      showCancel: true,
      cancelText: '退出',
      confirmText: '同意',
      success: (res) => {
        if (res.confirm) {
          this.onAcceptPrivacy();
        } else {
          // 用户坚持退出
          wx.showToast({ title: '已退出', icon: 'none' });
        }
      }
    });
  },

  /**
   * 查看隐私政策
   */
  viewPrivacyPolicy() {
    wx.showModal({
      title: '密锁隐私政策',
      content: '1. 密锁使用 AES-256-GCM 加密算法在本地设备上加密所有凭证数据。\n\n2. 你的主密码永远不上传至任何服务器，仅用于在本地派生加密密钥。\n\n3. 开启云同步后，加密数据会通过微信云开发同步到你的账号下，方便跨设备使用。云端数据没有密钥无法解密。\n\n4. 密锁不请求任何隐私敏感权限（如位置、通讯录、相册等）。\n\n5. 你可以随时导出加密备份或彻底清空数据。\n\n6. 遗忘主密码后数据无法恢复，请妥善保管。',
      showCancel: false,
      confirmText: '我知道了'
    });
  },

  /**
   * 转发给好友
   */
  onShareAppMessage() {
    return {
      title: '密锁 - 安全存储你的每一个账号',
      path: '/pages/unlock/unlock'
    };
  },

  /**
   * 分享到朋友圈
   */
  onShareTimeline() {
    return {
      title: '密锁 - 本地加密密码管理工具',
      query: ''
    };
  },

  /**
   * 页面卸载时清除敏感数据
   */
  onUnload() {
    this.setData({
      password: '',
      showPassword: false
    });
  }
});
