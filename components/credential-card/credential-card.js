/**
 * components/credential-card - 凭证卡片组件
 *
 * Properties:
 *   credential {Object} - 凭证数据 { id, title, username, icon, category, updatedAt }
 *
 * Events:
 *   detail - 点击卡片，detail = { id }
 *   copy   - 点击复制密码，detail = { password }
 *   edit   - 点击编辑，detail = { id }
 */

const storage = require('../../utils/storage');
const catMgr = require('../../utils/categories');

Component({
  properties: {
    credential: {
      type: Object,
      value: {}
    }
  },

  data: {
    categoryLabel: '',
    categoryColor: '',
    timeAgo: ''
  },

  observers: {
    'credential': function (cred) {
      if (!cred || !cred.category) return;

      this.setData({
        categoryLabel: catMgr.getCategoryLabel(cred.category),
        categoryColor: catMgr.getCategoryColor(cred.category),
        timeAgo: this.getTimeAgo(cred.updatedAt)
      });
    }
  },

  methods: {
    /**
     * 点击卡片 → 进入详情
     */
    onTapCard() {
      this.triggerEvent('detail', { id: this.data.credential.id });
    },

    /**
     * 点击复制密码（阻止事件冒泡）
     */
    onCopyPassword(e) {
      // 需要先解密获取密码明文
      try {
        const id = this.data.credential.id;
        const cred = storage.getCredentialById(id);
        if (cred) {
          this.triggerEvent('copy', { password: cred.password });
        }
      } catch (err) {
        wx.showToast({ title: '复制失败', icon: 'none' });
      }
    },

    /**
     * 点击编辑
     */
    onEdit(e) {
      this.triggerEvent('edit', { id: this.data.credential.id });
    },

    /**
     * 获取相对时间
     */
    getTimeAgo(timestamp) {
      if (!timestamp) return '';
      const now = Date.now();
      const diff = now - timestamp;

      const minutes = Math.floor(diff / 60000);
      if (minutes < 1) return '刚刚';
      if (minutes < 60) return `${minutes}分钟前`;

      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}小时前`;

      const days = Math.floor(hours / 24);
      if (days < 30) return `${days}天前`;

      const months = Math.floor(days / 30);
      return `${months}月前`;
    }
  }
});
