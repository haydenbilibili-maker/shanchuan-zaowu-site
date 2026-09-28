/**
 * B2B 工作台 Hub · 采购商可交付终版
 * 主路径：选购 → 确认下单 → 支付结果
 * 供货方区默认折叠（避免误导采购商）；禁止工作室机密页。
 */
const { guardManagerPage } = require('../../../utils/managerAuth')
const { guardSupplierWorkspace } = require('./utils/supplierGate')
const { readDemoOn, writeDemoOn, resetDemoState } = require('./utils/demoStore')
const { cartCount, readCart } = require('./utils/buyerCart')

const PATHS = {
  catalog: '/subpackages/extra/supplier/catalog/index',
  'buyer-orders': '/subpackages/extra/supplier/buyer-orders/index',
  orders: '/subpackages/extra/supplier/orders/index',
  ship: '/subpackages/extra/supplier/ship/index',
  settlement: '/subpackages/extra/supplier/settlement/index',
  statement: '/subpackages/b2bdesk/statement/index'
}

/** 模块 → 功能项（staff_members.b2bDesk.features，由超管在「供应商管理 → 伙伴」配置） */
const MODULE_FEATURE = {
  catalog: 'catalog',
  'buyer-orders': 'order',
  orders: 'demand',
  ship: 'ship',
  statement: 'statement'
}

function featureOn(features, key) {
  const f = MODULE_FEATURE[key]
  return !f || !features || features[f] !== false
}

Page({
  data: {
    ready: false,
    staffName: '',
    modeLabel: '',
    roleHint: '',
    isPreview: false,
    isBuyer: false,
    isSupplier: false,
    demoOn: false,
    cartCount: 0,
    features: null,
    supplierOpen: false,
    showSupplierSection: false,
    buyerModules: [],
    visibleSupplierModules: [],
    supplierModules: [
      {
        key: 'orders',
        title: '发给我的采购需求',
        desc: '待确认 → 待发货 → 已发货（非工作室账本）',
        icon: '/assets/icons/cart.png'
      },
      {
        key: 'ship',
        title: '发货回传',
        desc: '填写快递与运单号',
        icon: '/assets/icons/ship.png'
      },
      {
        key: 'settlement',
        title: '对我的结算',
        desc: '应付与已付摘要',
        icon: '/assets/icons/pay.png'
      }
    ]
  },

  onLoad() {
    this.bootstrap()
  },

  onShow() {
    if (!this.data.ready) return
    this.refreshHubMeta()
  },

  refreshHubMeta() {
    const count = cartCount(readCart())
    const demoOn = this.data.isPreview ? readDemoOn() : false
    const buyerModules = [
      {
        key: 'catalog',
        title: '供货价目选购',
        desc: count > 0 ? `采购车 ${count} 件 · 继续选或去下单` : '图文价目 · 选 SKU 与数量',
        icon: '/assets/icons/box.png',
        badge: count > 0 ? String(count) : ''
      },
      {
        key: 'buyer-orders',
        title: '我的采购单',
        desc: '支付 · 待对公 · 履约进度',
        icon: '/assets/icons/cart.png',
        badge: ''
      }
    ]
    const features = this.data.features
    if (features && features.statement) {
      buyerModules.push({
        key: 'statement',
        title: '对账与物流',
        desc: '货款、账龄、运单号与进度时间线',
        icon: '/assets/icons/pay.png',
        badge: ''
      })
    }
    this.setData({
      cartCount: count,
      demoOn,
      buyerModules: buyerModules.filter((m) => featureOn(features, m.key)),
      visibleSupplierModules: this.data.supplierModules.filter((m) => featureOn(features, m.key))
    })
  },

  /** 服务端功能项（manageSupplierDesk.myAccess）；未部署 / 失败时按旧行为全部显示 */
  loadAccess() {
    if (!wx.cloud) return
    wx.cloud
      .callFunction({ name: 'manageSupplierDesk', data: { action: 'myAccess' } })
      .then((res) => {
        const r = (res && res.result) || {}
        if (!r.success || !r.features) return
        this.setData({ features: r.features })
        this.refreshHubMeta()
      })
      .catch(() => {})
  },

  async bootstrap() {
    try {
      if (!guardManagerPage()) return
      const role = await guardSupplierWorkspace()
      if (!role) return
      const deskKind = role.deskKind || role.supplierMode || ''
      const isPreview = deskKind === 'preview'
      const isBuyer = deskKind === 'buyer'
      const isSupplier = deskKind === 'supplier'
      // 采购商默认不展开供货方区；供货方默认展开；预览默认收起（避免误点演示当生产）
      const supplierOpen = isSupplier
      const showSupplierSection = isPreview || isSupplier
      let modeLabel = 'B2B'
      let roleHint = '按供货价向总部下单付款。不进入工作室内部账本。'
      if (isPreview) {
        modeLabel = '超管预览'
        roleHint =
          '总部预览：上方采购路径写真实订货单；下方供货方区可开本地演示（与采购支付无关）。'
      } else if (isBuyer) {
        modeLabel = '采购商'
        roleHint = '欢迎下单：选品 → 确认 → 微信支付或登记待对公。'
      } else if (isSupplier) {
        modeLabel = '供货方'
        roleHint =
          '您为第三方供货方。下方处理发给您的需求；上方采购区为同包过渡能力。'
      }
      this.setData({
        ready: true,
        staffName: String(role.name || role.staffName || '').trim(),
        isPreview,
        isBuyer,
        isSupplier,
        modeLabel,
        roleHint,
        supplierOpen,
        showSupplierSection,
        demoOn: isPreview ? readDemoOn() : false
      })
      this.refreshHubMeta()
      this.loadAccess()
    } catch (e) {
      console.warn('supplier hub bootstrap', e)
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
    }
  },

  toggleSupplier() {
    if (!this.data.showSupplierSection) return
    this.setData({ supplierOpen: !this.data.supplierOpen })
  },

  toggleDemo() {
    if (!this.data.isPreview) return
    const next = !this.data.demoOn
    writeDemoOn(next)
    if (next) {
      resetDemoState()
      this.setData({ demoOn: next, supplierOpen: true })
    } else {
      this.setData({ demoOn: next })
    }
  },

  resetDemo() {
    if (!this.data.isPreview || !this.data.demoOn) return
    resetDemoState()
    this.setData({
      roleHint: '演示流已重置。路径：采购需求确认 → 发货回传 → 我的结算（均为本地假数据）。'
    })
  },

  onModuleTap(e) {
    const key = String((e.currentTarget.dataset || {}).key || '').trim()
    // 真实账号的「对我的结算」走服务端对账页；演示模式仍看本地假数据
    const url = key === 'settlement' && !this.data.demoOn && this.data.features && this.data.features.statement ? PATHS.statement : PATHS[key]
    if (!url) return
    wx.navigateTo({ url })
  },

  onFlowCart() {
    const count = cartCount(readCart())
    if (count > 0) {
      wx.navigateTo({ url: '/subpackages/extra/supplier/buyer-cart/index' })
      return
    }
    wx.navigateTo({ url: PATHS.catalog })
  }
})
