// subpackages/feature/collection-detail/index.js
const app = getApp();
const db = wx.cloud.database();
const { navigateToProductDetail } = require('../../../utils/productDetailNav');

Page({
  data: {
    // 页面状态
    statusBarHeight: 20, // 状态栏高度
    navBarHeight: 44,    // 导航栏内容高度 (胶囊高度)
    isLoading: true,
    /** 加载失败态：此前失败只会把 isLoading 置 false（wxml 未引用）→ 永久停在「加载中…」白屏 */
    loadError: false,
    errorMsg: '',

    // 视差滚动相关
    headerOpacity: 0,    // 导航栏背景透明度
    parallaxStyle: '',   // 头部图片的样式 (transform)

    // 数据实体
    wiki: {
      _id: '',
      cn_name: '加载中…',
      latin_name: '',
      main_image: '',
      tags: [],
      stats: { views: 0, likes: 0 }
    },
    
    // 富文本内容
    articleContent: '',
    // 🟢 定义标签样式 (Dark Mode 适配)
    tagStyle: {
      p: 'margin-bottom: 1em; text-align: justify;',
      h1: 'font-size: 20px; font-weight: bold; color: #C4A76C; margin: 20px 0 10px;',
      h2: 'font-size: 18px; font-weight: bold; color: #eee; margin: 16px 0 8px; border-left: 4px solid #C4A76C; padding-left: 10px;',
      img: 'border-radius: 8px; margin: 10px 0; box-shadow: 0 4px 10px rgba(0,0,0,0.3);',
      blockquote: 'background: rgba(255,255,255,0.05); border-left: 4px solid #666; padding: 10px; color: #999; font-style: italic;',
      strong: 'color: #C4A76C;'
    },
    
    // 组件数据
    galleryImages: [],   // 画廊图片数组
    relatedProducts: []  // 关联商品数组
  },

  onLoad(options) {
    // 1. 获取系统信息用于导航栏适配
    const sys = wx.getSystemInfoSync();
    const menu = wx.getMenuButtonBoundingClientRect();
    const navHeight = (menu.top - sys.statusBarHeight) * 2 + menu.height;
    
    this.setData({
      statusBarHeight: sys.statusBarHeight,
      navBarHeight: navHeight
    });

    // 2. 获取详情数据
    if (options.id) {
      this.fetchDetail(options.id);
    } else {
      this.setData({ isLoading: false });
      wx.showToast({ title: '内容不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
    }
  },

  // 🟢 核心：页面滚动监听 (实现视差与渐变)
  onPageScroll(e) {
    const scrollTop = e.scrollTop;
    
    // A. 导航栏渐变逻辑
    // 当滚动超过 200px 时，透明度达到 1 (完全不透明)
    let opacity = scrollTop / 200;
    if (opacity > 1) opacity = 1;
    if (opacity < 0) opacity = 0;

    // B. 头部图片视差逻辑
    // 图片移动速度比页面慢一半 (0.5)，产生视差感
    // 只有当 scrollTop > 0 时才移动，防止下拉刷新时图片跳动
    let translateY = 0;
    if (scrollTop > 0) {
      translateY = scrollTop * 0.5;
    }

    this.setData({
      headerOpacity: opacity,
      parallaxStyle: `transform: translateY(${translateY}px) scale(1.05);` // 略微放大防止边缘露白
    });
  },

  // 🟢 从 cms-wikis 数据库加载专题详情
  async fetchDetail(id) {
    wx.showLoading({ title: '加载中…', mask: true });
    
    try {
      // 1. 优先从云函数获取专题数据
      const res = await wx.cloud.callFunction({
        name: 'getWikiData',
        data: { action: 'get_detail', wikiId: id }
      });

      if (res.result && res.result.success && res.result.data) {
        const data = res.result.data;
        
        // 处理封面图片
        let mainImage = data.coverImage || data.cover || data.image || data.mainImage || '';
        
        // 格式化数据
        const wikiData = {
          _id: data._id,
          cn_name: data.commonName || data.title || '专题展览',
          latin_name: data.latinName || '',
          main_image: mainImage,
          tags: Array.isArray(data.tags) ? data.tags : (data.tags ? [data.tags] : []),
          stats: data.stats || { views: 0, likes: 0 }
        };

        // 处理画廊图片
        let galleryImages = [];
        if (data.gallery && Array.isArray(data.gallery) && data.gallery.length > 0) {
          galleryImages = data.gallery;
        } else if (mainImage) {
          galleryImages = [mainImage];
        }

        this.setData({
          wiki: wikiData,
          articleContent: data.content || `<p>${data.brief || data.description || '暂无详细内容'}</p>`,
          galleryImages: galleryImages,
          // 需求 11：补 sensitiveEnabled（关联藏品此前封面直出）
          relatedProducts: require('../../../utils/sensitiveBlurCard')
            .attachSensitiveFlags(res.result.relatedProducts || []),
          isLoading: false
        })
        wx.setNavigationBarTitle({ title: wikiData.cn_name || '图鉴详情' })
      } else {
        // 降级：直接从 curated_collections 集合查询
        const docRes = await db.collection('curated_collections').doc(id).get();
        
        if (docRes.data) {
          const item = docRes.data;
          
          // 处理封面图片
          let mainImage = item.coverImage || item.cover || item.image || item.mainImage || '';
          
          // 处理画廊
          let galleryImages = [];
          if (item.gallery && Array.isArray(item.gallery) && item.gallery.length > 0) {
            galleryImages = item.gallery;
          } else if (mainImage) {
            galleryImages = [mainImage];
          }
          
          const cnName = item.title || item.name || item.cn_name || '专题展览'
          this.setData({
            wiki: {
              _id: item._id,
              cn_name: cnName,
              latin_name: item.latinName || item.latin_name || '',
              main_image: mainImage,
              tags: Array.isArray(item.tags) ? item.tags : (item.tags ? [item.tags] : []),
              stats: { views: 0, likes: 0 }
            },
            articleContent: item.content || item.description || `<p>${item.brief || item.summary || '暂无详细内容'}</p>`,
            galleryImages: galleryImages,
            relatedProducts: [],
            isLoading: false
          })
          wx.setNavigationBarTitle({ title: cnName })
        } else {
          throw new Error('未找到专题数据');
        }
      }
    } catch (e) {
      console.error('加载专题详情失败', e);
      this.setData({
        isLoading: false,
        loadError: true,
        errorMsg: (e && e.message) || '加载失败，请检查网络后重试'
      });
    } finally {
      wx.hideLoading();
    }
  },

  /** 失败重试：重置状态后重新加载 */
  retryLoad() {
    this.setData({ isLoading: true, loadError: false, errorMsg: '', wiki: { _id: '', cn_name: '加载中…', latin_name: '', main_image: '', tags: [], stats: { views: 0, likes: 0 } }, articleContent: '', galleryImages: [], relatedProducts: [] })
    this.loadDetail ? this.loadDetail() : (this.onLoad && this.onLoad(this.options || {}))
  },

  goBack() {
    wx.navigateBack();
  },

  // 预览画廊大图
  previewGallery(e) {
    const current = e.currentTarget.dataset.src;
    wx.previewImage({
      current: current,
      urls: this.data.galleryImages
    });
  },

  // 跳转商品详情
  goToProduct(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      wx.showToast({ title: '藏品不存在', icon: 'none' });
      return;
    }
    const seed = (this.data.products || this.data.relatedProducts || []).find(
      (p) => p && p._id === id
    );
    navigateToProductDetail(id, {
      seed: seed || { _id: id },
      failToast: '无法打开藏品'
    });
  }
});