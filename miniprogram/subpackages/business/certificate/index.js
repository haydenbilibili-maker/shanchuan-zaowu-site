// pages/certificate/index.js
const app = getApp();
const db = wx.cloud.database();
const { ensureOpenId, canAccessOrder, denyOrderAccess } = require('../../../utils/orderScope');
const { buildGuideUrl, resolveCareCategory } = require('../utils/careDefaults');
const { resolveCareContext } = require('../utils/careHelper');
const { isGiftOrder, resolveCertRole, giftCertInfo, certSerial, receiverOf, certIssuedAt } = require('../utils/giftHolder');
const { drawCertificate } = require('./certDraw');

function formatCertDay(ms) {
  const d = ms ? new Date(ms) : new Date();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 已固化证书图的版本签名：签名一致即直接展示已生成的证书，不再重绘。
 * 收藏证书只认签发日（持有人信息以首次签发为准，像实体证书一样不随改名变）；
 * 赠予凭证另含对方状态与称呼（TA 签收 / 领取后凭证文字会变，需重新签发一次）。
 */
function certSig(kind, data) {
  const parts = [kind, data.date, 'v2'];
  if (kind === 'gift_voucher' && data.gift) parts.push(data.gift.statusLabel || '', data.gift.recipientName || '');
  return parts.join('|');
}

/** 礼赠证书未签发时的说明（持有人未定 / 礼赠已结束） */
const CERT_STATE_COPY = {
  pending: {
    giver: ['赠予凭证待签发', 'TA 签收或到店领取后，这里会签发你的赠予凭证。'],
    holder: ['收藏证书待签发', '藏品到你手中后，将以你为持有人签发收藏证书。']
  },
  void: {
    giver: ['这份礼赠已结束', '礼赠已退款或取消，不签发证书。'],
    holder: ['这份礼赠已结束', '礼赠已退款或取消，不签发证书。']
  }
};

Page({
  data: {
    statusBarHeight: 20,
    isMinting: true,
    showCert: false,
    missingId: false,
    tempFilePath: '',
    certImageUrl: '',
    order: null,
    orderId: '',
    careGuideUrl: '',
    certKind: 'holder',
    certState: '',
    certStateTitle: '',
    certStateDesc: ''
  },

  onLoad(options) {
    const { statusBarHeight } = wx.getSystemInfoSync();
    this.setData({ statusBarHeight, orderId: options.id || '' });
    if (options.id) {
      this.startMinting(options.id);
    } else {
      this.setData({ isMinting: false, missingId: true });
      wx.showToast({ title: '证书不存在', icon: 'none' });
    }
  },

  async startMinting(orderId) {
    wx.vibrateShort({ type: 'heavy' });
    
    try {
      const openid = await ensureOpenId(app);
      if (!openid) {
        wx.showToast({ title: '请先登录', icon: 'none' });
        this.setData({ isMinting: false });
        return;
      }

      const orderRes = await db.collection('orders').doc(orderId).get();
      const order = orderRes.data;

      if (!canAccessOrder(order, openid)) {
        wx.showToast({ title: '无权查看此证书', icon: 'none' });
        this.setData({ isMinting: false });
        setTimeout(() => wx.navigateBack(), 1500);
        return;
      }

      const gift = isGiftOrder(order);
      const role = resolveCertRole(order, openid);
      if (gift && (role === 'pending' || role === 'void')) {
        const viewer = receiverOf(order) === openid ? 'holder' : 'giver';
        const copy = CERT_STATE_COPY[role][viewer];
        this.setData({ order, isMinting: false, certState: role, certStateTitle: copy[0], certStateDesc: copy[1] });
        return;
      }
      const certKind = !gift ? 'holder' : (role === 'giver' ? 'gift_voucher' : 'gift_holder');
      this.setData({ order, certKind })
      // 赠予凭证：送礼人不是持有人，不承接养护入口
      const careContext = certKind === 'gift_voucher' ? null : await resolveCareContext(order)
      if (careContext && careContext.showCare && careContext.guideUrl) {
        this.setData({ careGuideUrl: careContext.guideUrl })
      } else if (careContext && order.products && order.products[0]) {
        const cat = resolveCareCategory(order.products[0])
        this.setData({
          careGuideUrl: buildGuideUrl({
            category: cat,
            orderId,
            productId: order.products[0].id || order.products[0].productId || '',
            from: 'certificate'
          })
        })
      }
      
      const certData = {
          kind: certKind,
          orderNo: order.orderNo,
          date: formatCertDay(certIssuedAt(order)),
          product: order.products && order.products.length > 0 ? order.products[0] : { title: '未知藏品', latin: '' },
          user: 'COLLECTOR',
          level: 'MEMBER'
      };
      if (gift) {
        const info = giftCertInfo(order);
        const meta = order.giftMeta || {};
        certData.serial = certSerial(order, role);
        certData.gift = {
          ...info,
          statusLabel: !receiverOf(order) ? '已送达' : (meta.deliveryType === 'store_pickup' ? 'TA 已到店领取' : 'TA 已签收')
        };
      }
      const sig = certSig(certKind, certData);
      this._mint = { orderId, certKind, certData, sig };

      // 已签发过：直接展示当时生成的证书
      const saved = (order.certMeta || {})[certKind];
      if (saved && saved.fileID && saved.openid === openid && saved.sig === sig) {
        const url = await this.getImagePath(saved.fileID).catch(() => '');
        if (url && url !== saved.fileID) {
          this.setData({ certImageUrl: url, isMinting: false, showCert: true });
          return;
        }
      }
      await this.mintFresh();
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '铸造中断', icon: 'none' });
      this.setData({ isMinting: false });
    }
  },

  /** 首次签发：画证书 → 展示 → 上传固化（失败只影响下次是否重绘，不影响本次展示） */
  async mintFresh() {
    const { certData } = this._mint;
    if (app.globalData.openid) {
      try {
        const userRes = await db.collection('users').where({ _openid: app.globalData.openid }).get();
        if (userRes.data && userRes.data.length > 0) {
          certData.user = userRes.data[0].nickName || 'COLLECTOR';
          const lvMap = {
            1: '原木·见习者',
            2: '秘银·采集家',
            3: '流金·研究员',
            4: '曜石·策展人',
            5: '星陨·守护者',
            6: '星耀·博物官',
            99: '荣誉馆长'
          };
          const lv = userRes.data[0].level;
          certData.level = lvMap[lv] || userRes.data[0].levelName || '原木·见习者';
        }
      } catch(e) {}
    }

    const query = wx.createSelectorQuery();
    query.select('#certCanvas').fields({ node: true, size: true }).exec(async (res) => {
        if (!res || !res[0] || !res[0].node) {
          this.setData({ isMinting: false });
          wx.showToast({ title: '证书画布加载失败', icon: 'none' });
          return;
        }
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getSystemInfoSync().pixelRatio;
        canvas.width = res[0].width * dpr;
        canvas.height = res[0].height * dpr;
        ctx.scale(dpr, dpr);

        const w = res[0].width;
        const h = res[0].height;
        await drawCertificate(ctx, w, h, certData, canvas, (src) => this.getImagePath(src));
        wx.canvasToTempFilePath({
          canvas: canvas,
          width: w, height: h, destWidth: w * 3, destHeight: h * 3,
          success: (r) => {
            this.setData({ tempFilePath: r.tempFilePath });
            this.persistCert(r.tempFilePath);
          }
        });

        setTimeout(() => {
           this.setData({ isMinting: false, showCert: true });
           wx.vibrateLong();
        }, 1500);
    });
  },

  async persistCert(filePath) {
    const { orderId, certKind, sig } = this._mint || {};
    if (!orderId || !filePath) return;
    try {
      const up = await wx.cloud.uploadFile({ cloudPath: `certificates/${orderId}/${certKind}-${Date.now()}.png`, filePath });
      await wx.cloud.callFunction({
        name: 'getCareSpecimens',
        data: { action: 'saveCertificate', orderId, kind: certKind, fileID: up.fileID, sig }
      });
    } catch (e) {
      console.warn('persistCert failed', e);
    }
  },

  /** 已固化的证书图加载失败 → 退回现场绘制 */
  onCertImageError() {
    if (!this._mint || !this.data.certImageUrl) return;
    this.setData({ certImageUrl: '', isMinting: true, showCert: false });
    this.mintFresh();
  },

  async getImagePath(src) {
    if (!src) return '';
    if (src.startsWith('cloud://')) {
      const res = await wx.cloud.getTempFileURL({ fileList: [src] });
      const file = res.fileList && res.fileList[0];
      if (file && file.tempFileURL) return file.tempFileURL;
    }
    return src;
  },

  async saveImage() {
    let filePath = this.data.tempFilePath;
    if (!filePath && this.data.certImageUrl) {
      filePath = await new Promise((resolve) => wx.downloadFile({
        url: this.data.certImageUrl,
        success: (r) => resolve(r.statusCode === 200 ? r.tempFilePath : ''),
        fail: () => resolve('')
      }));
      if (filePath) this.setData({ tempFilePath: filePath });
    }
    if (!filePath) {
      wx.showToast({ title: '证书尚未生成', icon: 'none' });
      return;
    }
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => wx.showToast({ title: '已保存', icon: 'success' }),
      fail: () => wx.showModal({ title: '提示', content: '需相册权限', showCancel:false })
    });
  },
  goToCare() {
    const url = this.data.careGuideUrl
    if (!url) {
      wx.navigateTo({ url: '/subpackages/feature/care/index?from=certificate' })
      return
    }
    wx.navigateTo({ url })
  },
  goBack() {
    wx.navigateBack({
      fail: () => wx.redirectTo({
        url: '/subpackages/extra/user/certificates/index',
        fail: () => wx.switchTab({ url: '/pages/user/index' })
      })
    });
  },
  onShareAppMessage() {
    const titles = { gift_voucher: '我赠出的一份山海 · 赠予凭证', gift_holder: '我收到的一份山海 · 收藏证书' };
    return { title: titles[this.data.certKind] || '我的博物收藏证书', imageUrl: this.data.tempFilePath || this.data.certImageUrl }
  }
});