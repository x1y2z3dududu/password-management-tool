// pages/detail/detail.js - 凭证详情页
const storage = require('../../utils/storage');
const catMgr = require('../../utils/categories');

Page({
  data: {
    credential: null,
    showUsername: true,       // 用户名显隐
    showPassword: false,      // 密码显隐（默认掩码）
    passwordVisible: true,    // 掩码动画状态
    clipboardTimer: 0,        // 剪贴板清空倒计时
    showDeleteModal: false,
    categoryLabel: '',
    categoryColor: '',
    createTime: '',
    updateTime: ''
  },

  // 剪贴板定时器
  _clipboardInterval: null,
  _credentialId: null,

  onLoad(options) {
    if (!options.id) {
      wx.showToast({ title: '参数缺失', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 500);
      return;
    }

    this._credentialId = options.id;
    this.loadCredential();
  },

  onUnload() {
    // 清除定时器
    if (this._clipboardInterval) {
      clearInterval(this._clipboardInterval);
      this._clipboardInterval = null;
    }

    // 清除敏感数据
    this.setData({
      credential: null,
      showPassword: false
    });
  },

  /**
   * 加载凭证详情
   */
  loadCredential() {
    try {
      const cred = storage.getCredentialById(this._credentialId);
      if (!cred) {
        wx.showToast({ title: '凭证不存在', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 500);
        return;
      }

      this.setData({
        credential: cred,
        categoryLabel: catMgr.getCategoryLabel(cred.category),
        categoryColor: catMgr.getCategoryColor(cred.category),
        createTime: formatTime(cred.createdAt),
        updateTime: formatTime(cred.updatedAt)
      });
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  /**
   * 切换字段显隐
   */
  toggleField(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [field]: !this.data[field]
    });
  },

  /**
   * 复制字段到剪贴板
   */
  copyField(e) {
    const { value } = e.currentTarget.dataset;

    if (!value) return;

    wx.setClipboardData({
      data: value,
      success: () => {
        // 显示成功提示
        wx.showToast({
          title: '已复制 ✓',
          icon: 'success',
          duration: 1500
        });

        // 启动 30 秒倒计时
        this.startClipboardTimer();
      },
      fail: () => {
        wx.showToast({
          title: '复制失败',
          icon: 'none'
        });
      }
    });
  },

  /**
   * 启动剪贴板自动清空倒计时
   */
  startClipboardTimer() {
    // 清除旧定时器
    if (this._clipboardInterval) {
      clearInterval(this._clipboardInterval);
    }

    this.setData({ clipboardTimer: 30 });

    this._clipboardInterval = setInterval(() => {
      const timer = this.data.clipboardTimer - 1;
      if (timer <= 0) {
        clearInterval(this._clipboardInterval);
        this._clipboardInterval = null;
        this.setData({ clipboardTimer: 0 });

        // 清空剪贴板
        wx.setClipboardData({
          data: '',
          success: () => {}
        });
      } else {
        this.setData({ clipboardTimer: timer });
      }
    }, 1000);
  },

  /**
   * 打开网址
   */
  openUrl() {
    const url = this.data.credential?.url;
    if (!url) return;

    // 在小程序中无法直接打开外部链接，复制到剪贴板
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showToast({
          title: '网址已复制，请在浏览器打开',
          icon: 'none',
          duration: 2000
        });
      }
    });
  },

  /**
   * 遮罩密码文本
   */
  maskText(text) {
    if (!text) return '●●●●';
    return '●'.repeat(Math.min(text.length, 16));
  },

  /**
   * 前往编辑页
   */
  goToEdit() {
    wx.navigateTo({
      url: `/pages/edit/edit?id=${this._credentialId}`
    });
  },

  /**
   * 显示删除确认弹窗
   */
  confirmDelete() {
    this.setData({ showDeleteModal: true });
  },

  /**
   * 取消删除
   */
  cancelDelete() {
    this.setData({ showDeleteModal: false });
  },

  /**
   * 确认删除
   */
  doDelete() {
    const success = storage.deleteCredential(this._credentialId);
    this.setData({ showDeleteModal: false });

    if (success) {
      // 后台推送到云端
      getApp().syncAllToCloud().catch(() => {});

      wx.showToast({
        title: '已删除',
        icon: 'success'
      });
      setTimeout(() => wx.navigateBack(), 800);
    } else {
      wx.showToast({
        title: '删除失败',
        icon: 'none'
      });
    }
  }
});

// ===== 辅助函数 =====

function formatTime(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
