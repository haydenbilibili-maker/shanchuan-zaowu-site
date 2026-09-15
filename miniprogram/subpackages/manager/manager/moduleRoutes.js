/** 看板 hub 内嵌模块 → 独立 workspace 页（系统导航栏） */
const WORKSPACE_PATH = '/subpackages/manager/manager/workspace/index'

const TAB_TITLES = {
  1: '藏品库',
  2: '订单管理',
  3: '预约管理',
  4: '店铺装修',
  5: '标本师管理',
  6: '权益会员',
  7: '活动课程',
  8: '营收账本',
  9: '内容管理',
  10: '工单',
  11: '山海有信',
  12: '门店管理',
  13: '数据报表',
  14: '标本师合作',
  15: '运费规则',
  16: '内容开关'
}

function buildWorkspaceQuery(tabIdx, title, extra = '') {
  const t = TAB_TITLES[tabIdx] || title || '管理'
  const q = [`tab=${encodeURIComponent(String(tabIdx))}`, `title=${encodeURIComponent(t)}`]
  const tail = String(extra || '').trim().replace(/^\?/, '')
  if (tail) q.push(tail)
  return q.join('&')
}

function goManagerModule(tabIdx, title, extraQuery) {
  const idx = parseInt(tabIdx, 10)
  if (!Number.isFinite(idx) || idx <= 0) return
  wx.navigateTo({
    url: `${WORKSPACE_PATH}?${buildWorkspaceQuery(idx, title, extraQuery)}`,
    fail: () => wx.showToast({ title: '功能暂不可用', icon: 'none' })
  })
}

module.exports = {
  WORKSPACE_PATH,
  TAB_TITLES,
  buildWorkspaceQuery,
  goManagerModule
}
