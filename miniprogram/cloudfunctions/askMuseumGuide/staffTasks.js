/**
 * AI 智能中心 · 一键任务（2026-11-23，第三轮）
 *
 * 任务 = 固定问题 + 固定角色，**提示词只在服务端**；客户端只传 taskId，防前端改任务内容。
 * 每个任务都要求模型先看「当前经营数据」，数据不足就说不足，不编。
 */
const TASKS = [
  {
    id: 'store_funnel',
    roleId: 'store_manager',
    title: '门店转化诊断',
    question: '基于当前经营数据，诊断门店转化漏斗最薄的一环，给出本周就能执行的 3 个动作，并说明各自看哪个指标验证。数据不够就说缺什么。'
  },
  {
    id: 'store_shift',
    roleId: 'store_manager',
    title: '高峰排班建议',
    question: '按当前订单与预约情况，给周末客流高峰排一份班（几点几个人、谁盯哪块），并列出 3 条接待话术要点。'
  },
  {
    id: 'buy_stock_risk',
    roleId: 'procurement',
    title: '库存风险扫描',
    question: '扫描当前在售与低库存情况，列出最可能断货/积压的门类，给出补货优先级与判断依据；没有库存数据就说明缺什么。'
  },
  {
    id: 'buy_cost',
    roleId: 'procurement',
    title: '采购成本优化',
    question: '从当前在售结构与订单量出发，给 3 条可落地的采购成本优化方向（比价、批量、替代、账期），每条写清验证方式。'
  },
  {
    id: 'creative_theme',
    roleId: 'creative_director',
    title: '陈列主题提案',
    question: '基于当前在售门类与订单情况，提一个本月陈列主题：一句主标、三件主推、动线与物料清单。'
  },
  {
    id: 'creative_event',
    roleId: 'creative_director',
    title: '门店活动创意',
    question: '给一个能与标本体验结合的门店活动创意：目标、流程、所需物料、如何衡量效果。'
  },
  {
    id: 'data_checkup',
    roleId: 'data_analyst',
    title: '经营数据体检',
    question: '用当前经营数据做一次体检：先说口径与样本量，再指出 2 个异常或风险、2 个可验证的假设，以及下一步取什么数验证。'
  },
  {
    id: 'data_repeat',
    roleId: 'data_analyst',
    title: '复购归因思路',
    question: '给出复购率归因的分析设计：分群、对比、需要的字段与时间窗；如果当前数据不足以归因，明确说缺哪些字段。'
  },
  {
    id: 'cfo_cash',
    roleId: 'cfo',
    title: '现金流体检',
    question: '基于当前订单与门店日账，给一份现金流体检：收入结构、退款占比、需要盯的 3 个风险点；金额都注明来源与时间窗。'
  },
  {
    id: 'cfo_breakeven',
    roleId: 'cfo',
    title: '盈亏平衡测算',
    question: '给一个盈亏平衡测算模板（固定成本 / 毛利率 / 保本营业额），用现有数据能填的填上，填不了的列出需要补的科目。'
  },
  {
    id: 'hr_cost',
    roleId: 'hr_manager',
    title: '人力成本体检',
    question: '基于本月工资条与在职人数，做一次人力成本体检：人均应发、扣款占比、需要关注的 3 个风险点；只谈合计与结构，不要列任何个人姓名或单人薪资。'
  },
  {
    id: 'hr_attendance',
    roleId: 'hr_manager',
    title: '考勤与排班风险',
    question: '基于本月打卡与待审批请假，指出考勤与排班的风险点（迟到早退集中时段、请假积压），给 3 条可执行改进，并说明需要补哪些数据。'
  },
  {
    id: 'mkt_topic',
    roleId: 'marketing',
    title: '内容选题 5 条',
    question: '结合当前在售与订单情况，给 5 条内容选题（标题 + 一句话切入点 + 适合的平台），贴合双 IP 调性。'
  },
  {
    id: 'mkt_recall',
    roleId: 'marketing',
    title: '老客回流方案',
    question: '设计一次老客回流：目标人群、触达方式、权益设计、节奏与衡量指标；不承诺无法验证的效果。'
  }
]

const TASK_IDS = TASKS.map((t) => t.id)

function taskById(id) {
  return TASKS.find((t) => t.id === id) || null
}

module.exports = { TASKS, TASK_IDS, taskById }
