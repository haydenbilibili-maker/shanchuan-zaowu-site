/**
 * 侧栏导航（瘦身版）：一级只保留驾驶舱 + 各业务域导航大屏。
 * 具体功能在 AdminNavHub 全页入口中进入；Ops Hub（门店/权益等）仍为功能内 Tab。
 */
export const SIDEBAR_NAV = {
  home: {
    key: 'home',
    title: 'HOME',
    items: [
      { id: '0', icon: 'Odometer', label: '经营驾驶舱' },
    ],
  },
  domains: {
    key: 'domains',
    title: 'DOMAINS',
    items: [
      { id: 'nav-overview', icon: 'Monitor', label: '总览决策' },
      { id: 'nav-business', icon: 'Shop', label: '业务运营' },
      { id: 'nav-customer', icon: 'UserFilled', label: '客户经营' },
      { id: 'nav-miniapp', icon: 'Iphone', label: '小程序配置' },
      { id: 'nav-governance', icon: 'OfficeBuilding', label: '组织治理' },
      { id: 'nav-intelligence', icon: 'MagicStick', label: '战略与知识' },
    ],
  },
}

/** 扁平 id → label */
export const NAV_LABEL_BY_ID = Object.values(SIDEBAR_NAV).reduce((map, section) => {
  if (section.items) {
    section.items.forEach((item) => { map[item.id] = item.label })
  }
  if (section.groups) {
    section.groups.forEach((g) => g.items.forEach((item) => { map[item.id] = item.label }))
  }
  return map
}, {})
