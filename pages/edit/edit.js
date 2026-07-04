// pages/edit/edit.js - 新增/编辑凭证
const storage = require('../../utils/storage');
const catMgr = require('../../utils/categories');

Page({
  data: {
    isEdit: false,
    editId: null,

    // 表单
    form: {
      title: '',
      username: '',
      password: '',
      url: '',
      category: 'other',
      icon: '🔒',
      notes: ''
    },

    showPassword: false,

    // 密码强度
    passwordStrength: 0,
    strengthColor: '',
    strengthLabel: '',

    // 按钮可用
    canSave: false,

    // 分类列表（动态加载）
    categories: [],
    categoryColors: {},

    // 候选图标
    icons: ['🔒', '🔑', '📧', '💬', '💰', '💼', '🎮', '🛒', '🌐', '📱', '🏦', '🏠', '🎵', '📺', '✈️', '🏥']
  },

  onLoad(options) {
    this.refreshCategories();

    if (options.id) {
      this.setData({ isEdit: true, editId: options.id });
      this.loadCredential(options.id);
    }
  },

  onShow() {
    // 每次进入刷新分类（用户可能在设置页修改后返回）
    this.refreshCategories();
  },

  /**
   * 重新加载分类数据
   */
  refreshCategories() {
    this.setData({
      categories: catMgr.getCategoriesForEdit(),
      categoryColors: catMgr.getCategoryColorMap()
    });
  },

  /**
   * 加载要编辑的凭证
   */
  loadCredential(id) {
    try {
      const cred = storage.getCredentialById(id);
      if (!cred) {
        wx.showToast({ title: '凭证不存在', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 500);
        return;
      }

      this.setData({
        form: {
          title: cred.title || '',
          username: cred.username || '',
          password: cred.password || '',
          url: cred.url || '',
          category: cred.category || 'other',
          icon: cred.icon || '🔒',
          notes: cred.notes || ''
        }
      });

      this.checkCanSave();
      this.evaluatePassword();
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  /**
   * 表单字段变化
   */
  onFieldChange(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;

    this.setData({
      [`form.${field}`]: value
    });

    // 密码字段变化时评估强度
    if (field === 'password') {
      this.evaluatePassword();
    }

    this.checkCanSave();
  },

  /**
   * 切换密码显隐
   */
  togglePassword() {
    this.setData({ showPassword: !this.data.showPassword });
  },

  /**
   * 随机生成强密码
   */
  generatePassword() {
    const length = 16;
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';
    const symbols = '!@#$%^&*_-+=';
    const all = upper + lower + digits + symbols;

    // 保证每种字符至少一个
    let password = '';
    password += upper[Math.floor(Math.random() * upper.length)];
    password += lower[Math.floor(Math.random() * lower.length)];
    password += digits[Math.floor(Math.random() * digits.length)];
    password += symbols[Math.floor(Math.random() * symbols.length)];

    // 填充剩余
    for (let i = password.length; i < length; i++) {
      password += all[Math.floor(Math.random() * all.length)];
    }

    // 打乱顺序
    password = password.split('').sort(() => Math.random() - 0.5).join('');

    this.setData({
      'form.password': password,
      showPassword: true
    });

    this.evaluatePassword();
    this.checkCanSave();

    // 提示用户
    wx.showToast({
      title: '强密码已生成 ✓',
      icon: 'success',
      duration: 1500
    });
  },

  /**
   * 评估密码强度
   */
  evaluatePassword() {
    const pwd = this.data.form.password || '';
    let score = 0;

    if (pwd.length === 0) {
      this.setData({
        passwordStrength: 0,
        strengthColor: '#E8E6DF',
        strengthLabel: ''
      });
      return;
    }

    // 长度评分
    if (pwd.length >= 8) score += 1;
    if (pwd.length >= 12) score += 1;
    if (pwd.length >= 16) score += 1;

    // 复杂度评分
    if (/[a-z]/.test(pwd)) score += 1;
    if (/[A-Z]/.test(pwd)) score += 1;
    if (/[0-9]/.test(pwd)) score += 1;
    if (/[^a-zA-Z0-9]/.test(pwd)) score += 1;

    // 映射到 0-4 级别
    let level, color, label;
    if (score <= 2) {
      level = 1; color = '#A32D2D'; label = '弱';
    } else if (score <= 3) {
      level = 2; color = '#EF9F27'; label = '一般';
    } else if (score <= 5) {
      level = 3; color = '#534AB7'; label = '强';
    } else {
      level = 4; color = '#1D9E75'; label = '很强';
    }

    this.setData({
      passwordStrength: level,
      strengthColor: color,
      strengthLabel: label
    });
  },

  /**
   * 选择分类
   */
  selectCategory(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ 'form.category': key });
  },

  /**
   * 选择图标
   */
  selectIcon(e) {
    const icon = e.currentTarget.dataset.icon;
    this.setData({ 'form.icon': icon });
  },

  /**
   * 检查是否可以保存
   */
  checkCanSave() {
    const { title, username, password } = this.data.form;
    this.setData({
      canSave: !!(title && username && password)
    });
  },

  /**
   * 保存凭证
   */
  onSave() {
    const { form, isEdit, editId } = this.data;

    // 验证必填项
    if (!form.title.trim()) {
      wx.showToast({ title: '请输入标题', icon: 'none' });
      return;
    }
    if (!form.username.trim()) {
      wx.showToast({ title: '请输入账号名', icon: 'none' });
      return;
    }
    if (!form.password) {
      wx.showToast({ title: '请输入密码', icon: 'none' });
      return;
    }

    // URL 字段：非阻断校验（可选字段，填"无"/"暂无"等也合法，不强制 http 格式）
    // 仅当用户填写了内容且明显不是网址时，给一个非阻断的温馨提示
    const urlVal = (form.url || '').trim();
    if (urlVal && urlVal.length > 0 && !/^https?:\/\//i.test(urlVal) && urlVal !== '无' && urlVal.length < 3) {
      // 极短的非 URL 字符不做拦截，正常存储
    }

    try {
      if (isEdit) {
        storage.updateCredential(editId, form);
        wx.showToast({ title: '已更新 ✓', icon: 'success' });
      } else {
        storage.addCredential(form);
        wx.showToast({ title: '已添加 ✓', icon: 'success' });
      }

      // 后台推送到云端
      getApp().syncAllToCloud().catch(() => {});

      setTimeout(() => wx.navigateBack(), 800);

    } catch (err) {
      console.error('保存凭证失败:', err);

      // 根据错误类型给出具体提示
      let errMsg = '保存失败，请重试';
      if (err && err.message) {
        if (err.message === 'NOT_UNLOCKED') {
          errMsg = '会话已超时，请重新解锁';
          setTimeout(() => {
            wx.reLaunch({ url: '/pages/unlock/unlock' });
          }, 1500);
        } else if (err.message.includes('crypto') || err.message.includes('加密')) {
          errMsg = '加密失败，请确认 npm 已构建（工具→构建npm）';
        } else {
          errMsg = '保存失败：' + err.message;
        }
      }

      wx.showModal({
        title: '保存失败',
        content: errMsg,
        showCancel: false,
        confirmText: '知道了'
      });
    }
  },

  /**
   * 取消编辑
   */
  onCancel() {
    wx.navigateBack();
  }
});
