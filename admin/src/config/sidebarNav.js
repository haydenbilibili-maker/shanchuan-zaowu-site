/**
 * 侧栏导航结构（单一数据源，App.vue 渲染用）
 * 排序按日常使用频率与业务链路组织
 */
export const SIDEBAR_NAV = {
  overview: {
    key: 'overview',
    title: '总览决策',
    items: [
      { id: '0', icon: 'Odometer', label: '经营驾驶舱' },
      { id: '25', icon: 'Trophy', label: '运营决策中心' },
      { id: '26', icon: 'Monitor', label: '实时监控大屏 · 告警' },
      { id: '49', icon: 'DataBoard', label: '经营数据大屏 · 看板' },
    ],
  },
  business: {
    key: 'grp-business',
    title: '业务运营',
    icon: 'Shop',
    groups: [
      {
        title: '交易履约',
        items: [
          { id: '3', icon: 'List', label: '全渠道订单' },
          { id: '52', icon: 'ShoppingCart', label: '订货履约' },
          { id: '57', icon: 'Ticket', label: '报价单配置' },
          { id: '42', icon: 'Refresh', label: '退款审核' },
          { id: '60', icon: 'Connection', label: '订单绑定审核' },
        ],
      },
      {
        title: '商品资产',
        items: [
          { id: '1', icon: 'Box', label: '藏品档案库' },
          { id: '43', icon: 'Menu', label: '分类管理' },
        ],
      },
      {
        title: '体验营销',
        items: [
          { id: '37', icon: 'Stamp', label: '预约与核销' },
          { id: '5', icon: 'Calendar', label: '活动与排期' },
          { id: '6', icon: 'Ticket', label: '权益与营销' },
        ],
      },
      {
        title: '门店场域',
        items: [
          { id: '30', icon: 'Shop', label: '店铺管理' },
          { id: '55', icon: 'Shop', label: 'C端门店展区' },
          { id: '34', icon: 'Brush', label: '门店设计中心' },
          { id: '35', icon: 'Promotion', label: '加盟商管理' },
          { id: '48', icon: 'House', label: '物业合作测算' },
        ],
      },
      {
        title: '定制工坊',
        items: [
          { id: '38', icon: 'Brush', label: '标本定制工单' },
          { id: '39', icon: 'Avatar', label: '伴宠记忆订单' },
        ],
      },
    ],
  },
  customer: {
    key: 'grp-customer',
    title: '客户经营',
    icon: 'UserFilled',
    groups: [
      {
        title: '会员洞察',
        items: [
          { id: '4', icon: 'UserFilled', label: '会员管理' },
          { id: '45', icon: 'MagicStick', label: '用户画像' },
          { id: '46', icon: 'Promotion', label: '人群包' },
          { id: '47', icon: 'DataBoard', label: '人群对比' },
        ],
      },
      {
        title: '互动服务',
        items: [
          { id: '44', icon: 'DataAnalysis', label: '用户行为看板' },
          { id: '40', icon: 'Message', label: '山海有信' },
          { id: '41', icon: 'ChatDotRound', label: '评论审核' },
          { id: '59', icon: 'Document', label: '开票申请台' },
        ],
      },
      {
        title: '内容营销',
        items: [
          { id: '51', icon: 'VideoCamera', label: '内容工厂' },
        ],
      },
    ],
  },
  miniapp: {
    key: 'grp-miniapp',
    title: '小程序配置',
    icon: 'Iphone',
    groups: [
      {
        title: '内容与首页',
        items: [
          { id: '8', icon: 'Picture', label: '首页轮播' },
          { id: '13', icon: 'Setting', label: '首页配置' },
          { id: '9', icon: 'Collection', label: '内容管理' },
          { id: '54', icon: 'Notebook', label: '养护指南' },
          { id: '56', icon: 'Phone', label: '客服入口配置' },
        ],
      },
      {
        title: '会员与营销',
        items: [
          { id: '14', icon: 'UserFilled', label: '会员等级体系' },
          { id: '15', icon: 'Ticket', label: '积分规则配置' },
          { id: '22', icon: 'Trophy', label: '成就系统配置' },
          { id: '20', icon: 'Ticket', label: '活动营销规则' },
        ],
      },
      {
        title: '系统与权限',
        items: [
          { id: '16', icon: 'Calendar', label: '预约规则配置' },
          { id: '19', icon: 'MagicStick', label: '推荐算法配置' },
          { id: '18', icon: 'Search', label: '搜索关键词管理' },
          { id: '24', icon: 'ChatDotRound', label: '通知消息配置' },
          { id: '23', icon: 'DataAnalysis', label: '用户行为追踪' },
          { id: '21', icon: 'DataAnalysis', label: '数据报表增强' },
          { id: '17', icon: 'Lock', label: '权限管理系统' },
        ],
      },
    ],
  },
  governance: {
    key: 'grp-governance',
    title: '组织治理',
    icon: 'OfficeBuilding',
    groups: [
      {
        title: '财务资本',
        items: [
          { id: '2', icon: 'Money', label: '财务核算系统' },
          { id: '36', icon: 'DataBoard', label: '资本架构沙盘' },
          { id: '50', icon: 'TrendCharts', label: '工作室启动成本' },
          { id: '27', icon: 'DocumentCopy', label: '合伙人命理中心' },
        ],
      },
      {
        title: '人才组织',
        items: [
          { id: '7', icon: 'Brush', label: '标本师管理' },
          { id: '32', icon: 'User', label: '员工花名册' },
          { id: '31', icon: 'Wallet', label: '员工薪酬管理' },
        ],
      },
      {
        title: '治理合规',
        items: [
          { id: '33', icon: 'OfficeBuilding', label: '公司治理' },
          { id: '28', icon: 'Lock', label: '合规专栏' },
        ],
      },
    ],
  },
  intelligence: {
    key: 'intelligence',
    title: '战略与知识',
    items: [
      { id: '12', icon: 'MagicStick', label: '智能中心' },
      { id: '10', icon: 'DataAnalysis', label: '战略调研看板' },
      { id: '29', icon: 'Notebook', label: '经营手册' },
    ],
  },
}

/** 扁平 id → label，供侧栏以外引用 */
export const NAV_LABEL_BY_ID = Object.values(SIDEBAR_NAV).reduce((map, section) => {
  if (section.items) {
    section.items.forEach((item) => { map[item.id] = item.label })
  }
  if (section.groups) {
    section.groups.forEach((g) => g.items.forEach((item) => { map[item.id] = item.label }))
  }
  return map
}, {})
