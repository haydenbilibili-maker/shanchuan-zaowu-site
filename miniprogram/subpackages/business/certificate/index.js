// pages/certificate/index.js
const app = getApp();
const db = wx.cloud.database();
const { ensureOpenId, isOrderOwnedBy, denyOrderAccess } = require('../../../utils/orderScope');
const { buildGuideUrl, normalizeCategory } = require('../../../utils/careDefaults');
const { resolveCareContext } = require('../utils/careHelper');

Page({
  data: {
    statusBarHeight: 20,
    isMinting: true,
    showCert: false,
    tempFilePath: '',
    order: null,
    orderId: '',
    careGuideUrl: ''
  },

  onLoad(options) {
    const { statusBarHeight } = wx.getSystemInfoSync();
    this.setData({ statusBarHeight, orderId: options.id || '' });
    if (options.id) {
      this.startMinting(options.id);
      return;
    }
    wx.redirectTo({ url: '/pages/user/certificates/index' });
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

      if (!isOrderOwnedBy(order, openid)) {
        wx.showToast({ title: '无权查看此证书', icon: 'none' });
        this.setData({ isMinting: false });
        setTimeout(() => wx.navigateBack(), 1500);
        return;
      }

      this.setData({ order })
      const careContext = await resolveCareContext(order)
      if (careContext.showCare && careContext.guideUrl) {
        this.setData({ careGuideUrl: careContext.guideUrl })
      } else if (order.products && order.products[0]) {
        const cat = normalizeCategory(order.products[0].category)
        this.setData({
          careGuideUrl: buildGuideUrl({
            category: cat,
            orderId,
            productId: order.products[0].id || order.products[0].productId || '',
            from: 'certificate'
          })
        })
      }
      
      let userName = 'COLLECTOR';
      let levelName = 'MEMBER';
      if (app.globalData.openid) {
         try {
           const userRes = await db.collection('users').where({ _openid: app.globalData.openid }).get();
           if(userRes.data.length > 0) {
             userName = userRes.data[0].nickName || 'COLLECTOR';
             const lvMap = ['见习收藏家', '初级收藏家', '资深收藏家', '金牌收藏家', '荣誉理事', '终身荣誉馆长'];
             levelName = lvMap[userRes.data[0].level] || '见习收藏家';
           }
         } catch(e) {}
      }

      const certData = {
          orderNo: order.orderNo,
          date: new Date().toLocaleDateString().replace(/\//g, '.'), 
          product: order.products && order.products.length > 0 ? order.products[0] : { title: '未知藏品', latin: '' },
          user: userName,
          level: levelName
      };

      const query = wx.createSelectorQuery();
      await new Promise((resolve) => setTimeout(resolve, 80));
      query.select('#certCanvas').fields({ node: true, size: true }).exec(async (res) => {
          if (!res[0]) {
            console.error('certCanvas 未就绪');
            wx.showToast({ title: '证书渲染失败', icon: 'none' });
            this.setData({ isMinting: false });
            return;
          }
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const dpr = wx.getSystemInfoSync().pixelRatio;
          canvas.width = res[0].width * dpr;
          canvas.height = res[0].height * dpr;
          ctx.scale(dpr, dpr);

          await this.drawPerfectCert(ctx, res[0].width, res[0].height, certData, canvas);
          
          setTimeout(() => {
             this.setData({ isMinting: false, showCert: true });
             wx.vibrateLong(); 
          }, 1500);
      });

    } catch (err) {
      console.error(err);
      wx.showToast({ title: '铸造中断', icon: 'none' });
      this.setData({ isMinting: false });
    }
  },

  async getImagePath(src) {
    if (!src) return '';
    if (src.startsWith('cloud://')) {
      const res = await wx.cloud.getTempFileURL({ fileList: [src] });
      if (res.fileList && res.fileList[0].tempFileURL) return res.fileList[0].tempFileURL;
    }
    return src;
  },

  // 🟢 黄金比例终极版绘制
  async drawPerfectCert(ctx, w, h, data, canvas) {
    // 1. 背景
    ctx.fillStyle = '#1F1D1A';
    ctx.fillRect(0, 0, w, h);
    
    // 2. 边框 (Art Deco)
    const p = 20;
    ctx.strokeStyle = '#C4A76C'; ctx.lineWidth = 1;
    ctx.strokeRect(p, p, w - p*2, h - p*2);
    ctx.strokeStyle = 'rgba(196, 167, 108, 0.3)'; 
    ctx.strokeRect(p+4, p+4, w - (p+4)*2, h - (p+4)*2);
    
    // 3. 头部 (上移)
    let y = 55;
    ctx.textAlign = 'center';
    
    ctx.fillStyle = '#666'; ctx.font = '9px sans-serif'; ctx.letterSpacing = '2px';
    ctx.fillText("BRING NATURE HOME", w / 2, y);
    
    y += 20;
    ctx.fillStyle = '#C4A76C'; ctx.font = 'bold 15px serif'; 
    ctx.fillText('山海造物 · 珍藏证书', w / 2, y);
    
    y += 35;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 20px serif';
    ctx.letterSpacing = '4px';
    ctx.fillText('永久藏品·独一无二', w / 2, y);
    
    y += 25;
    ctx.fillStyle = '#bfa15f'; ctx.font = '10px sans-serif'; ctx.letterSpacing = '1px';
    ctx.fillText('CERTIFICATE OF HONOR', w / 2, y);

    // 4. 图片 (进一步缩小，腾出黄金空间)
    const imgUrl = await this.getImagePath(data.product.image);
    
    y += 25;
    const imgSize = 150; // 🟢 缩小至 150 (原170)
    
    if (imgUrl) {
        const img = canvas.createImage();
        img.src = imgUrl;
        await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; });

        const imgX = (w - imgSize) / 2;
        ctx.strokeStyle = 'rgba(196, 167, 108, 0.6)'; ctx.lineWidth = 1;
        ctx.strokeRect(imgX - 5, y - 5, imgSize + 10, imgSize + 10);

        const sSize = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - sSize)/2, (img.height - sSize)/2, sSize, sSize, imgX, y, imgSize, imgSize);
        
        // 图片下小字
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = 'italic 9px serif';
        ctx.fillText('Exhibited Specimen', w/2, y + imgSize + 14);
        
        y += imgSize + 40; 
    } else {
        y += 200;
    }

    // 5. 授予文案区 (核心)
    ctx.fillStyle = '#888'; ctx.font = '10px sans-serif'; ctx.letterSpacing = '2px';
    ctx.fillText('兹授予 / Hereby Grants', w / 2, y);
    
    y += 30;
    // 用户名 (金光闪闪)
    ctx.fillStyle = '#C4A76C'; ctx.font = 'bold 30px serif'; 
    ctx.fillText(data.user, w / 2, y);
    
    y += 20;
    // 荣誉称号
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif';
    ctx.fillText(`「 ${data.level} 」`, w / 2, y);

    y += 30;
    // 表彰内容
    ctx.fillStyle = '#aaa'; ctx.font = '10px serif'; ctx.letterSpacing = '1px';
    ctx.fillText('以表彰其对以下自然瑰宝的永久珍藏：', w / 2, y);
    
    y += 30;
    // 藏品名称 (确保显示完整)
    ctx.fillStyle = '#fff'; ctx.font = 'bold 24px serif';
    ctx.fillText(`《 ${data.product.title} 》`, w / 2, y);
    
    y += 16;
    ctx.fillStyle = '#C4A76C'; ctx.font = 'italic 10px serif';
    ctx.fillText(data.product.latin || '', w / 2, y);

    // 6. 底部签名 & 编号 (确保在画布内)
    const footerY = h - 40; // 绝对底部
    
    // 编号
    ctx.fillStyle = '#444'; ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`NO.${data.orderNo}`, 30, footerY);
    // 日期
    ctx.textAlign = 'right';
    ctx.fillText(data.date, w - 30, footerY);

    // 签名
    const signY = footerY - 30;
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(w/2 - 60, signY); ctx.lineTo(w/2 + 60, signY); ctx.stroke();
    ctx.fillStyle = '#666'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('山海造物 · 签发', w / 2, signY + 14);

    // 7. 印章 (右下角，位置精调)
    this.drawSeal(ctx, w - 80, h - 100);

    wx.canvasToTempFilePath({
      canvas: canvas,
      width: w, height: h, destWidth: w * 3, destHeight: h * 3,
      success: (res) => this.setData({ tempFilePath: res.tempFilePath })
    });
  },

  drawSeal(ctx, x, y) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-15 * Math.PI / 180);
    const color = 'rgba(180, 40, 40, 0.9)'; 
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, 2 * Math.PI); ctx.stroke(); 
    ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 26, 0, 2 * Math.PI); ctx.stroke(); 
    
    ctx.fillStyle = color;
    ctx.font = 'bold 10px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('山海造物', 0, -8);
    ctx.font = '8px sans-serif'; ctx.fillText('CERTIFIED', 0, 8);
    ctx.font = '14px serif'; ctx.fillText('★', 0, 22);
    ctx.restore();
  },

  saveImage() {
    wx.saveImageToPhotosAlbum({
      filePath: this.data.tempFilePath,
      success: () => wx.showToast({ title: '已保存', icon: 'success' }),
      fail: () => wx.showModal({ title: '提示', content: '需相册权限', showCancel:false })
    });
  },
  goToCare() {
    const url = this.data.careGuideUrl
    if (!url) {
      wx.navigateTo({ url: '/pages/care/index?from=certificate' })
      return
    }
    wx.navigateTo({ url })
  },
  goBack() { wx.navigateBack(); },
  onShareAppMessage() { return { title: '我的博物收藏证书', imageUrl: this.data.tempFilePath } }
});