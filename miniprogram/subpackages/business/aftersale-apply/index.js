const app = getApp();
const db = wx.cloud.database();
const { ensureOpenId, isOrderOwnedBy, denyOrderAccess } = require('../../../utils/orderScope');
const { openAppModal } = require('../../../utils/appModal')
const {
  getPolicy,
  canUserRequestRefund,
  needsUnboxEvidence,
  calcRefundSplit,
  formatYuan
} = require('../utils/refundPolicy');

const MAX_IMAGES = 6;
const VIDEO_MAX_DURATION = 60;

Page({
  data: {
    loading: true,
    ready: false,
    orderId: '',
    orderNo: '',
    needsEvidence: false,
    /** 门店自取逆向：需将藏品送回领取门店，门店确认收回后退款 */
    isStoreReturn: false,
    pageTitle: '申请退款',
    pageDesc: '',
    policyLabel: '',
    refundHint: '',
    note: '',
    videoLocalPath: '',
    imageLocalPaths: [],
    maxImages: MAX_IMAGES,
    submitting: false,
    submitLabel: '提交申请'
  },

  onLoad(options) {
    const orderId = String((options && (options.id || options.orderId)) || '').trim();
    if (!orderId) {
      wx.showToast({ title: '缺少订单', icon: 'none' });
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 400);
      return;
    }
    this.setData({ orderId });
    this.loadOrder(orderId);
  },

  async loadOrder(orderId) {
    this.setData({ loading: true, ready: false });
    try {
      await ensureOpenId(app);
      const res = await db.collection('orders').doc(orderId).get();
      const order = res.data;
      const openid = (app.globalData && app.globalData.openid) || '';
      if (!order || !isOrderOwnedBy(order, openid)) {
        denyOrderAccess();
        return;
      }
      const check = canUserRequestRefund(order);
      if (!check.ok) {
        openAppModal({
          title: '无法申请',
          content: check.reason || '当前不可申请',
          showCancel: false,
          confirmColor: '#C4A76C',
          success: () => wx.navigateBack({ fail: () => {} })
        }, this);
        return;
      }
      // 门店自取：当面交接、无物流开箱环节；逆向流程 = 送回领取门店，门店确认收回后退款
      const isStorePickup = !!(
        !order.giftMeta &&
        order.source !== 'gift' &&
        (order.storePickup || order.fulfillmentType === 'store_pickup')
      );
      const claimedPickup = isStorePickup && order.pickupStatus === 'claimed';
      const storeReturn = isStorePickup && (needsUnboxEvidence(order) || claimedPickup);
      const needsEvidence = !isStorePickup && !!(check.needsEvidence || needsUnboxEvidence(order));
      const policy = check.policy || getPolicy(order);
      const split = calcRefundSplit(order.totalPrice, policy.deductRate);
      let refundHint = '';
      if (policy.deductRate > 0) {
        refundHint = `退回 ¥${formatYuan(split.refund)}（扣损耗 ¥${formatYuan(split.deduct)}）`;
      } else if (storeReturn) {
        refundHint = `门店确认收回后退回 ¥${formatYuan(split.refund)}`;
      } else if (needsEvidence) {
        refundHint = '按售后约定审核后处理';
      } else {
        refundHint = `退回 ¥${formatYuan(split.refund)}`;
      }
      this.setData({
        loading: false,
        ready: true,
        orderNo: order.orderNo || orderId.slice(-8),
        needsEvidence,
        isStoreReturn: storeReturn,
        pageTitle: needsEvidence || storeReturn ? '申请售后' : '申请退款',
        pageDesc: storeReturn
          ? '请将藏品送回领取门店，门店确认收回后原路退款。可上传照片说明问题，便于门店核对。'
          : needsEvidence
            ? '到柜请录制开箱影像。无开箱影像将难以受理售后；蝶类触须不在包损之列。'
            : '发货前可申请退款，提交后由门店审核，通过后原路退回。',
        policyLabel: policy.shortLabel || policy.label || '',
        refundHint,
        note: policy.shortLabel || '',
        submitLabel: needsEvidence || storeReturn ? '提交售后申请' : '提交退款申请'
      });
      wx.setNavigationBarTitle({ title: needsEvidence || storeReturn ? '售后申请' : '退款申请' });
    } catch (err) {
      console.error('aftersale-apply load', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onNoteInput(e) {
    this.setData({ note: String((e.detail && e.detail.value) || '').slice(0, 200) });
  },

  chooseVideo() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album', 'camera'],
      maxDuration: VIDEO_MAX_DURATION,
      camera: 'back',
      success: (res) => {
        const file = (res.tempFiles || [])[0];
        if (!file || !file.tempFilePath) {
          wx.showToast({ title: '未选择视频', icon: 'none' });
          return;
        }
        const sizeMb = (Number(file.size) || 0) / (1024 * 1024);
        if (sizeMb > 80) {
          wx.showToast({ title: '视频请控制在 80MB 内', icon: 'none' });
          return;
        }
        this.setData({ videoLocalPath: file.tempFilePath });
      }
    });
  },

  clearVideo() {
    this.setData({ videoLocalPath: '' });
  },

  chooseImages() {
    const remain = MAX_IMAGES - (this.data.imageLocalPaths || []).length;
    if (remain <= 0) return;
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath).filter(Boolean);
        this.setData({
          imageLocalPaths: (this.data.imageLocalPaths || []).concat(paths).slice(0, MAX_IMAGES)
        });
      }
    });
  },

  removeImage(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10);
    if (!Number.isFinite(idx)) return;
    const list = (this.data.imageLocalPaths || []).slice();
    list.splice(idx, 1);
    this.setData({ imageLocalPaths: list });
  },

  previewImage(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10) || 0;
    const urls = this.data.imageLocalPaths || [];
    if (!urls.length) return;
    wx.previewImage({ current: urls[idx], urls });
  },

  async uploadVideo() {
    const local = this.data.videoLocalPath;
    if (!local) return '';
    const openid = await ensureOpenId(app);
    const oid = String(openid || 'guest').slice(-8);
    const extMatch = /\.(\w+)(\?|$)/.exec(local);
    const ext = (extMatch && extMatch[1]) || 'mp4';
    const cloudPath = `aftersale/${oid}/${Date.now()}_unbox.${ext}`;
    const up = await wx.cloud.uploadFile({ cloudPath, filePath: local });
    if (!up || !up.fileID) throw new Error('开箱视频上传失败');
    return up.fileID;
  },

  async uploadImages() {
    const locals = this.data.imageLocalPaths || [];
    if (!locals.length) return [];
    const openid = await ensureOpenId(app);
    const oid = String(openid || 'guest').slice(-8);
    const fileIds = [];
    for (let i = 0; i < locals.length; i += 1) {
      const cloudPath = `aftersale/${oid}/${Date.now()}_${i}.jpg`;
      const up = await wx.cloud.uploadFile({ cloudPath, filePath: locals[i] });
      if (!up || !up.fileID) throw new Error('图片上传失败');
      fileIds.push(up.fileID);
    }
    return fileIds;
  },

  async submit() {
    if (this.data.submitting || !this.data.ready) return;
    const needsEvidence = this.data.needsEvidence;
    if (needsEvidence && !this.data.videoLocalPath) {
      wx.showToast({ title: '请上传开箱视频', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: needsEvidence ? '上传中…' : '提交中…', mask: true });
    try {
      let unboxVideoFileId = '';
      let evidenceImageFileIds = [];
      if (needsEvidence) {
        unboxVideoFileId = await this.uploadVideo();
        wx.showLoading({ title: '上传图片…', mask: true });
        evidenceImageFileIds = await this.uploadImages();
        wx.showLoading({ title: '提交中…', mask: true });
      } else if (this.data.isStoreReturn && (this.data.imageLocalPaths || []).length) {
        // 门店自取逆向：图片举证选填
        wx.showLoading({ title: '上传图片…', mask: true });
        evidenceImageFileIds = await this.uploadImages();
        wx.showLoading({ title: '提交中…', mask: true });
      }
      const call = await wx.cloud.callFunction({
        name: 'refundOrder',
        data: {
          action: 'request',
          orderId: this.data.orderId,
          note: this.data.note || '',
          unboxVideoFileId,
          evidenceImageFileIds
        }
      });
      wx.hideLoading();
      this.setData({ submitting: false });
      const result = (call && call.result) || {};
      if (!result.success) {
        wx.showToast({ title: result.msg || '提交失败', icon: 'none' });
        return;
      }
      wx.showToast({ title: result.msg || '已提交', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack({
          fail: () => {
            wx.redirectTo({
              url: `/subpackages/business/order-detail/index?id=${this.data.orderId}`
            });
          }
        });
      }, 500);
    } catch (err) {
      console.error('aftersale submit', err);
      wx.hideLoading();
      this.setData({ submitting: false });
      const m = String((err && err.message) || '');
      wx.showToast({ title: /上传失败$/.test(m) ? `${m}，请重试` : '提交没成功，请检查网络后再试', icon: 'none' });
    }
  }
});
