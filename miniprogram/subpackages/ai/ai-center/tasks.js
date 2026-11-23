/**
 * 一键任务（客户端只放 id / 角色 / 标题；提示词在云端 staffTasks.js，改不了）
 * id 集合必须与云端一致，由 test:ai-center 的 A6 逐一比对。
 */
const TASKS = [
  { id: 'store_funnel', roleId: 'store_manager', title: '门店转化诊断' },
  { id: 'store_shift', roleId: 'store_manager', title: '高峰排班建议' },
  { id: 'buy_stock_risk', roleId: 'procurement', title: '库存风险扫描' },
  { id: 'buy_cost', roleId: 'procurement', title: '采购成本优化' },
  { id: 'creative_theme', roleId: 'creative_director', title: '陈列主题提案' },
  { id: 'creative_event', roleId: 'creative_director', title: '门店活动创意' },
  { id: 'data_checkup', roleId: 'data_analyst', title: '经营数据体检' },
  { id: 'data_repeat', roleId: 'data_analyst', title: '复购归因思路' },
  { id: 'cfo_cash', roleId: 'cfo', title: '现金流体检' },
  { id: 'cfo_breakeven', roleId: 'cfo', title: '盈亏平衡测算' },
  { id: 'hr_cost', roleId: 'hr_manager', title: '人力成本体检' },
  { id: 'hr_attendance', roleId: 'hr_manager', title: '考勤与排班风险' },
  { id: 'mkt_topic', roleId: 'marketing', title: '内容选题 5 条' },
  { id: 'mkt_recall', roleId: 'marketing', title: '老客回流方案' }
]

const tasksOf = (roleId) => TASKS.filter((t) => t.roleId === roleId)

module.exports = { TASKS, tasksOf }
