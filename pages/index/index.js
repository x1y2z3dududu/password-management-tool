// pages/index/index.js - 首页凭证列表 + 搜索
const storage = require('../../utils/storage');
const searchEngine = require('../../utils/search');
const catMgr = require('../../utils/categories');

Page({
  data: {
    // 状态栏高度
    statusBarHeight: 20,

    // 搜索
    searchQuery: '',

    // 分类（动态加载）
    categories: [],
    activeCategory: 'all',

    // 凭证数据
    allCredentials: [],
    filteredList: [],
    loading: true,
    refreshing: false,
    hasCorruptedData: false,  // 是否存在旧格式乱码数据

    // ===== 分类管理弹窗 =====
    showCatManager: false,
    customCategories: [],
    showCatEditModal: false,
    catEditTitle: '添加新分类',
    catEditAction: '添加',
    catEditLabel: '',
    catEditIcon: '📌',
    catEditKey: '',
    catEditMode: 'add',  // 'add' | 'edit'
    iconOptions: ['🔒', '🔑', '📧', '💬', '💰', '💼', '🎮', '🛒', '🌐', '📱', '🏦', '🏠', '🎵', '📺', '✈️', '🏥', '📌', '❤️', '🎓', '⚽'],

    // ===== 修改主密码弹窗 =====
    showPwdChange: false,
    pwdCurrent: '',
    pwdNew: '',
    pwdConfirm: '',
    showPwdCurrent: false,
    showPwdNew: false,
    showPwdConfirm: false,
    pwdCurrentErr: '',
    pwdNewErr: '',
    pwdConfirmErr: '',
    pwdChanging: false
  },

  onLoad() {
    // 检查解锁状态
    const app = getApp();
    if (!app.isUnlocked()) {
      wx.reLaunch({ url: '/pages/unlock/unlock' });
      return;
    }

    // 获取状态栏高度
    const sysInfo = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: sysInfo.statusBarHeight });

    // 加载分类
    this.setData({ categories: catMgr.getCategoriesForIndex() });
  },

  onShow() {
    const app = getApp();

    // 检查解锁状态
    if (!app.isUnlocked()) {
      wx.reLaunch({ url: '/pages/unlock/unlock' });
      return;
    }

    // 重置自动锁定计时器
    app.resetLockTimer();

    // 刷新分类（用户可能在设置页修改后返回）
    this.setData({ categories: catMgr.getCategoriesForIndex() });

    // 加载凭证数据
    this.loadData();

    // 如果从详情页返回，刷新列表
    if (this.data.allCredentials.length > 0) {
      this.loadData();
    }
  },

  /**
   * 加载凭证数据
   */
  loadData() {
    try {
      const credentials = storage.loadCredentials();

      // 按更新时间倒序排列
      credentials.sort((a, b) => b.updatedAt - a.updatedAt);

      // 添加日期标签
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const processed = credentials.map((cred, index) => {
        const date = new Date(cred.updatedAt);
        let dateLabel = '';
        let showDate = false;

        // 与前一条比较日期
        const prev = index > 0 ? new Date(credentials[index - 1].updatedAt) : null;
        if (!prev || !isSameDay(date, prev)) {
          showDate = true;
          if (isSameDay(date, today)) {
            dateLabel = '今天';
          } else if (isSameDay(date, yesterday)) {
            dateLabel = '昨天';
          } else {
            dateLabel = formatDate(date);
          }
        }

        return {
          ...cred,
          dateLabel,
          showDate
        };
      });

      // 检测是否存在数据损坏条目（_decryptError 标记）
      const hasCorrupted = processed.some(c => c._decryptError === true);

      this.setData({
        allCredentials: processed,
        loading: false,
        refreshing: false,
        hasCorruptedData: hasCorrupted
      });

      // 重建搜索索引
      searchEngine.rebuildIndex(credentials);

      // 应用当前过滤
      this.applyFilters();

    } catch (err) {
      console.error('加载凭证失败:', err);
      this.setData({ loading: false });

      if (err.message === 'NOT_UNLOCKED') {
        wx.reLaunch({ url: '/pages/unlock/unlock' });
      } else {
        wx.showToast({
          title: '数据加载失败',
          icon: 'none'
        });
      }
    }
  },

  /**
   * 应用搜索和分类过滤
   */
  applyFilters() {
    const { searchQuery, activeCategory, allCredentials } = this.data;

    let result = allCredentials;

    // 分类过滤
    if (activeCategory !== 'all') {
      result = result.filter(cred => cred.category === activeCategory);
    }

    // 搜索过滤
    if (searchQuery.trim()) {
      result = searchEngine.searchCredentials(searchQuery, allCredentials, {
        category: activeCategory !== 'all' ? activeCategory : undefined
      });
    }

    this.setData({ filteredList: result });
  },

  /**
   * 搜索输入
   */
  onSearchInput(e) {
    this.setData({ searchQuery: e.detail.value });
    this.applyFilters();
  },

  /**
   * 搜索确认
   */
  onSearchConfirm() {
    this.applyFilters();
  },

  /**
   * 清除搜索
   */
  clearSearch() {
    this.setData({ searchQuery: '' });
    this.applyFilters();
  },

  /**
   * 切换分类
   */
  switchCategory(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ activeCategory: key });
    this.applyFilters();
  },

  /**
   * 下拉刷新
   */
  onRefresh() {
    this.setData({ refreshing: true });
    this.loadData();
  },

  /**
   * 前往详情页
   */
  goToDetail(e) {
    const { id } = e.detail;
    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`
    });
  },

  /**
   * 一键复制密码
   */
  onCopyPassword(e) {
    const { password } = e.detail;

    wx.setClipboardData({
      data: password,
      success: () => {
        wx.showToast({
          title: '密码已复制 ✓',
          icon: 'success',
          duration: 1500
        });

        // 30 秒后自动清空剪贴板
        setTimeout(() => {
          wx.setClipboardData({
            data: '',
            success: () => {}
          });
        }, 30000);
      }
    });
  },

  /**
   * 前往编辑页
   */
  goToEdit(e) {
    const { id } = e.detail;
    wx.navigateTo({
      url: `/pages/edit/edit?id=${id}`
    });
  },

  /**
   * 前往新增页
   */
  goToAdd() {
    wx.navigateTo({
      url: '/pages/edit/edit'
    });
  },

  /**
   * 前往设置页
   */
  goToSettings() {
    wx.navigateTo({
      url: '/pages/settings/settings'
    });
  },

  /**
   * 页面分享
   */
  onShareAppMessage() {
    return {
      title: '密锁 - 安全存储你的每一个账号',
      path: '/pages/unlock/unlock'
    };
  },

  // ========== 分类管理（首页弹窗） ==========

  /**
   * 展开分类管理面板
   */
  showCatManager() {
    this.setData({
      showCatManager: true,
      customCategories: catMgr.getCategoriesForEdit()
    });
  },

  /**
   * 收起分类管理面板
   */
  hideCatManager() {
    this.setData({ showCatManager: false });
  },

  /**
   * 从首页打开添加分类弹窗
   */
  addCatFromHome() {
    this.setData({
      showCatEditModal: true,
      catEditTitle: '添加新分类',
      catEditAction: '添加',
      catEditLabel: '',
      catEditIcon: '📌',
      catEditKey: '',
      catEditMode: 'add'
    });
  },

  /**
   * 从首页编辑分类
   */
  editCatFromHome(e) {
    const key = e.currentTarget.dataset.key;
    const cat = catMgr.getCategories().find(c => c.key === key);
    if (!cat) return;

    this.setData({
      showCatEditModal: true,
      catEditTitle: '编辑分类',
      catEditAction: '保存',
      catEditLabel: cat.label,
      catEditIcon: cat.icon,
      catEditKey: cat.key,
      catEditMode: 'edit'
    });
  },

  /**
   * 分类名称输入
   */
  onCatEditInput(e) {
    this.setData({ catEditLabel: e.detail.value });
  },

  /**
   * 选择图标
   */
  pickCatIcon(e) {
    this.setData({ catEditIcon: e.currentTarget.dataset.icon });
  },

  /**
   * 保存分类（新增/编辑）
   */
  saveCatEdit() {
    const { catEditMode, catEditKey, catEditLabel, catEditIcon } = this.data;
    const label = (catEditLabel || '').trim();

    if (!label) {
      wx.showToast({ title: '请输入分类名称', icon: 'none' });
      return;
    }

    let result;
    if (catEditMode === 'edit') {
      result = catMgr.updateCategory(catEditKey, { label, icon: catEditIcon });
    } else {
      result = catMgr.addCategory(label, catEditIcon);
    }

    if (result.success) {
      this.setData({ showCatEditModal: false });
      // 刷新分类列表（面板内 + 顶部标签栏）
      this.setData({
        customCategories: catMgr.getCategoriesForEdit(),
        categories: catMgr.getCategoriesForIndex()
      });
      // 推送到云端
      getApp().syncAllToCloud().catch(() => {});
      wx.showToast({ title: catEditMode === 'edit' ? '已更新' : '已添加', icon: 'success' });
    } else {
      wx.showToast({ title: result.error || '操作失败', icon: 'none' });
    }
  },

  /**
   * 关闭编辑弹窗
   */
  dismissCatEdit() {
    this.setData({ showCatEditModal: false });
  },

  /**
   * 删除分类（带确认）
   */
  deleteCatFromHome(e) {
    const { key, label } = e.currentTarget.dataset;
    const that = this;
    wx.showModal({
      title: '删除分类',
      content: `确定删除「${label}」？已使用此分类的凭证将归入「其他」。`,
      success(res) {
        if (res.confirm) {
          const result = catMgr.deleteCategory(key);
          if (result.success) {
            that.setData({
              customCategories: catMgr.getCategoriesForEdit(),
              categories: catMgr.getCategoriesForIndex()
            });
            getApp().syncAllToCloud().catch(() => {});
            wx.showToast({ title: '已删除', icon: 'success' });
          } else {
            wx.showToast({ title: result.error || '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  /**
   * 恢复默认分类
   */
  resetCatFromHome() {
    const that = this;
    wx.showModal({
      title: '恢复默认',
      content: '将删除所有自定义分类，恢复系统默认设置。',
      success(res) {
        if (res.confirm) {
          catMgr.resetToDefault();
          that.setData({
            customCategories: catMgr.getCategoriesForEdit(),
            categories: catMgr.getCategoriesForIndex()
          });
          getApp().syncAllToCloud().catch(() => {});
          wx.showToast({ title: '已恢复', icon: 'success' });
        }
      }
    });
  },

  // ========== 修改主密码 ==========

  /**
   * 展开修改主密码弹窗
   */
  showPwdChangeDialog() {
    this.setData({
      showPwdChange: true,
      pwdCurrent: '',
      pwdNew: '',
      pwdConfirm: '',
      showPwdCurrent: false,
      showPwdNew: false,
      showPwdConfirm: false,
      pwdCurrentErr: '',
      pwdNewErr: '',
      pwdConfirmErr: '',
      pwdChanging: false
    });
  },

  /**
   * 关闭修改主密码弹窗
   */
  dismissPwdChange() {
    this.setData({ showPwdChange: false });
  },

  onPwdCurrentInput(e) {
    this.setData({ pwdCurrent: e.detail.value, pwdCurrentErr: '' });
  },
  onPwdNewInput(e) {
    this.setData({ pwdNew: e.detail.value, pwdNewErr: '' });
  },
  onPwdConfirmInput(e) {
    this.setData({ pwdConfirm: e.detail.value, pwdConfirmErr: '' });
  },

  togglePwdCurrent() { this.setData({ showPwdCurrent: !this.data.showPwdCurrent }); },
  togglePwdNew() { this.setData({ showPwdNew: !this.data.showPwdNew }); },
  togglePwdConfirm() { this.setData({ showPwdConfirm: !this.data.showPwdConfirm }); },

  /**
   * 执行修改主密码
   */
  async doChangePassword() {
    const { pwdCurrent, pwdNew, pwdConfirm } = this.data;

    // 前端校验
    if (!pwdCurrent) {
      this.setData({ pwdCurrentErr: '请输入当前密码' });
      return;
    }
    if (!pwdNew || pwdNew.length < 6) {
      this.setData({ pwdNewErr: '新密码至少6位，建议混合字母+数字+符号' });
      return;
    }
    if (pwdNew !== pwdConfirm) {
      this.setData({ pwdConfirmErr: '两次输入的密码不一致' });
      return;
    }
    if (pwdNew === pwdCurrent) {
      this.setData({ pwdNewErr: '新密码不能与当前密码相同' });
      return;
    }

    this.setData({ pwdChanging: true });

    try {
      const app = getApp();
      await app.changeMasterPassword(pwdCurrent, pwdNew);

      this.setData({
        showPwdChange: false,
        pwdChanging: false
      });

      // 关闭管理面板
      this.setData({ showCatManager: false });

      wx.showToast({ title: '主密码已修改 ✓', icon: 'success', duration: 2000 });

      // 重新加载数据（用新密钥解密）
      setTimeout(() => {
        this.loadData();
      }, 500);

    } catch (err) {
      const msg = err.message || '修改失败';
      if (msg.includes('当前密码不正确')) {
        this.setData({ pwdCurrentErr: msg, pwdChanging: false });
      } else {
        this.setData({ pwdChanging: false });
        wx.showModal({
          title: '修改失败',
          content: msg,
          showCancel: false
        });
      }
    }
  },

});

// ===== 辅助函数 =====

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

function formatDate(date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekDay = weekDays[date.getDay()];
  return `${month}月${day}日 ${weekDay}`;
}
