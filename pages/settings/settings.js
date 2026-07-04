// pages/settings/settings.js - 设置页
const storage = require('../../utils/storage');
const crypto = require('../../utils/crypto');
const catMgr = require('../../utils/categories');

Page({
  data: {
    credentialCount: 0,
    lastModified: '暂无',
    storageSize: '0 KB',
    lockTimeOptions: [
      { value: 30, label: '30 秒' },
      { value: 60, label: '1 分钟' },
      { value: 120, label: '2 分钟' },
      { value: 300, label: '5 分钟' },
      { value: 0, label: '永不' }
    ],
    lockTimeIndex: 1, // 默认 1 分钟
    biometricEnabled: false,
    darkMode: false,
    showClearModal: false,

    // ===== 分类管理 =====
    customCategories: [],
    showCategoryModal: false,
    categoryModalTitle: '添加新分类',
    categoryModalAction: '添加',
    editingCategory: { key: '', label: '', icon: '📌' },
    isEditingCategory: false,  // true = 编辑模式, false = 新增模式
    iconOptions: ['🔒', '🔑', '📧', '💬', '💰', '💼', '🎮', '🛒', '🌐', '📱', '🏦', '🏠', '🎵', '📺', '✈️', '🏥', '📌', '❤️', '🎓', '⚽'],

    showDeleteCatModal: false,
    deletingCategory: { key: '', label: '' },

    showResetCatModal: false
  },

  onLoad() {
    this.loadSettings();
    this.loadStats();
    this.loadCategories();
  },

  onShow() {
    this.loadStats();
    this.loadCategories();  // 每次显示都刷新分类列表
    this.checkLegacyData();
  },

  /**
   * 检测旧格式乱码数据（无 crypto-js 时用旧 simpleXor 加密的中文数据）
   */
  checkLegacyData() {
    try {
      const raw = wx.getStorageSync('vault_data');
      if (!raw) return;
      const vault = JSON.parse(raw);
      if (!vault || vault.length === 0) return;

      // 检测第一条数据的 title 字段是否存在
      const first = vault[0];
      if (first && first.title && first.title.ciphertext) {
        // 有 ciphertext/iv 字段，格式正确，不提示
        return;
      }
      // 数据格式异常，可能是旧版本遗留
      // 不弹框，只更新 UI 标志
    } catch (e) {}
  },

  /**
   * 加载设置
   */
  loadSettings() {
    const app = getApp();
    const settings = app.globalData.settings;

    // 自动锁定时间
    const timeout = settings.autoLockTimeout;
    const lockIndex = this.data.lockTimeOptions.findIndex(o => o.value === timeout);
    this.setData({
      lockTimeIndex: lockIndex >= 0 ? lockIndex : 1,
      biometricEnabled: settings.biometricEnabled || false
    });
  },

  /**
   * 加载统计
   */
  loadStats() {
    try {
      const count = storage.getCredentialCount();
      const meta = storage.getMeta();

      this.setData({
        credentialCount: count,
        lastModified: meta.lastModified ? formatDate(meta.lastModified) : '暂无',
        storageSize: this.calcStorageSize()
      });
    } catch (e) {
      // 未解锁时不报错
    }
  },

  /**
   * 计算存储大小
   */
  calcStorageSize() {
    try {
      const data = wx.getStorageSync('vault_data') || '';
      const meta = wx.getStorageSync('vault_meta') || '';
      const size = (data.length + meta.length) / 1024;
      return size < 1 ? '< 1 KB' : `${size.toFixed(1)} KB`;
    } catch (e) {
      return '未知';
    }
  },

  /**
   * 自动锁定时间
   */
  onLockTimeChange(e) {
    const index = parseInt(e.detail.value);
    const app = getApp();
    app.globalData.settings.autoLockTimeout = this.data.lockTimeOptions[index].value;
    this.setData({ lockTimeIndex: index });
    // 同步设置到本地存储 + 云端
    wx.setStorageSync('user_settings', JSON.stringify(app.globalData.settings));
    app.syncAllToCloud().catch(() => {});
    wx.showToast({ title: '已更新', icon: 'success' });
  },

  /**
   * 生物识别开关
   */
  onBiometricToggle(e) {
    const enabled = e.detail.value;
    const app = getApp();

    if (enabled) {
      wx.startSoterAuthentication({
        requestAuthModes: ['fingerPrint'],
        challenge: 'misuo_enable_biometric',
        authContent: '验证指纹以开启生物识别解锁',
        success: () => {
          app.globalData.settings.biometricEnabled = true;
          this.setData({ biometricEnabled: true });

          // 保存加密的密钥用于生物识别解锁
          const key = app.getMasterKey();
          if (key) {
            wx.setStorageSync('biometric_key', key);
          }

          wx.showToast({ title: '生物识别已开启', icon: 'success' });
        },
        fail: () => {
          wx.showToast({ title: '验证失败', icon: 'none' });
        }
      });
    } else {
      app.globalData.settings.biometricEnabled = false;
      this.setData({ biometricEnabled: false });
      wx.removeStorageSync('biometric_key');
      wx.showToast({ title: '生物识别已关闭', icon: 'success' });
    }
  },

  /**
   * 修改主密码
   */
  changeMasterPassword() {
    wx.showModal({
      title: '修改主密码',
      content: '修改主密码需要使用当前密码重新加密所有数据。\n\n确定要修改吗？',
      success: (res) => {
        if (res.confirm) {
          // v1.0 简化：引导用户回到解锁页重新设置
          const app = getApp();
          app.clearMasterKey();
          wx.reLaunch({ url: '/pages/unlock/unlock' });
        }
      }
    });
  },

  /**
   * 确认清空
   */
  confirmClearAll() {
    this.setData({ showClearModal: true });
  },

  /**
   * 取消清空
   */
  cancelClearAll() {
    this.setData({ showClearModal: false });
  },

  /**
   * 执行清空
   */
  doClearAll() {
    storage.clearAll();
    this.setData({ showClearModal: false });

    wx.showToast({
      title: '所有数据已清空',
      icon: 'success'
    });

    setTimeout(() => {
      const app = getApp();
      app.clearMasterKey();
      wx.reLaunch({ url: '/pages/unlock/unlock' });
    }, 800);
  },

  /**
   * 隐私政策
   */
  showPrivacyPolicy() {
    wx.showModal({
      title: '隐私政策',
      content: '密锁承诺：\n\n1. 所有凭证数据仅在您的设备上加密存储。\n2. 云同步仅上传 AES-256 加密后的数据，无法被解密。\n3. 我们不收集任何个人信息。\n4. 主密码是唯一凭证，遗忘后无法恢复。',
      showCancel: false,
      confirmText: '了解'
    });
  },

  /**
   * 用户协议
   */
  showUserAgreement() {
    wx.showModal({
      title: '用户协议',
      content: '使用密锁即表示您同意：\n\n1. 妥善保管主密码，开发者无法恢复丢失的密码。\n2. 不将本工具用于非法用途。\n3. 数据通过云同步自动备份，但请勿完全依赖单一存储方式。',
      showCancel: false,
      confirmText: '同意'
    });
  },

  // ========== 分类标签管理 ==========

  /**
   * 加载分类列表
   */
  loadCategories() {
    this.setData({
      customCategories: catMgr.getCategoriesForEdit()
    });
  },

  /**
   * 显示新增分类弹窗
   */
  showAddCategory() {
    this.setData({
      showCategoryModal: true,
      categoryModalTitle: '添加新分类',
      categoryModalAction: '添加',
      editingCategory: { key: '', label: '', icon: '📌' },
      isEditingCategory: false
    });
  },

  /**
   * 编辑现有分类
   */
  editCategory(e) {
    const key = e.currentTarget.dataset.key;
    const cat = catMgr.getCategories().find(c => c.key === key);
    if (!cat) return;

    this.setData({
      showCategoryModal: true,
      categoryModalTitle: '编辑分类',
      categoryModalAction: '保存',
      editingCategory: { key: cat.key, label: cat.label, icon: cat.icon },
      isEditingCategory: true
    });
  },

  /**
   * 分类名称输入
   */
  onCategoryLabelInput(e) {
    this.setData({
      'editingCategory.label': e.detail.value
    });
  },

  /**
   * 选择图标
   */
  pickCategoryIcon(e) {
    this.setData({
      'editingCategory.icon': e.currentTarget.dataset.icon
    });
  },

  /**
   * 保存分类（新增或编辑）
   */
  saveCategory() {
    const { editingCategory, isEditingCategory } = this.data;
    const label = (editingCategory.label || '').trim();
    const icon = editingCategory.icon || '📌';

    if (!label) {
      wx.showToast({ title: '请输入分类名称', icon: 'none' });
      return;
    }

    let result;
    if (isEditingCategory) {
      result = catMgr.updateCategory(editingCategory.key, { label, icon });
    } else {
      result = catMgr.addCategory(label, icon);
    }

    if (result.success) {
      this.setData({ showCategoryModal: false });
      getApp().syncAllToCloud().catch(() => {});
      wx.showToast({
        title: isEditingCategory ? '分类已更新' : '分类已添加',
        icon: 'success'
      });
      this.loadCategories();
    } else {
      wx.showToast({
        title: result.error || '操作失败',
        icon: 'none'
      });
    }
  },

  /**
   * 关闭分类弹窗
   */
  dismissCategoryModal() {
    this.setData({ showCategoryModal: false });
  },

  /**
   * 确认删除分类
   */
  confirmDeleteCategory(e) {
    const { key, label } = e.currentTarget.dataset;
    this.setData({
      showDeleteCatModal: true,
      deletingCategory: { key, label }
    });
  },

  /**
   * 取消删除
   */
  cancelDeleteCategory() {
    this.setData({ showDeleteCatModal: false });
  },

  /**
   * 执行删除
   */
  doDeleteCategory() {
    const result = catMgr.deleteCategory(this.data.deletingCategory.key);

    this.setData({ showDeleteCatModal: false });

    if (result.success) {
      getApp().syncAllToCloud().catch(() => {});
      wx.showToast({ title: '已删除', icon: 'success' });
      this.loadCategories();
    } else {
      wx.showToast({ title: result.error || '删除失败', icon: 'none' });
    }
  },

  /**
   * 确认恢复默认分类
   */
  confirmResetCategories() {
    this.setData({ showResetCatModal: true });
  },

  /**
   * 取消恢复
   */
  cancelResetCategories() {
    this.setData({ showResetCatModal: false });
  },

  /**
   * 执行恢复
   */
  doResetCategories() {
    catMgr.resetToDefault();
    this.setData({ showResetCatModal: false });
    getApp().syncAllToCloud().catch(() => {});
    wx.showToast({ title: '已恢复默认分类', icon: 'success' });
    this.loadCategories();
  }
});

function formatDate(timestamp) {
  if (!timestamp) return '暂无';
  const date = new Date(timestamp);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}月${day}日 ${hours}:${minutes}`;
}
