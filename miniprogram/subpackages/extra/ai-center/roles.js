/**
 * AI 智能中心 · 虚拟员工（客户端只放展示元数据；人设与边界在云函数 askMuseumGuide/staffPersonas.js）
 */
const ROLES = [
  { id: 'store_manager', name: '门店运营经理', emoji: '🏪', desc: '门店运营 · 客流转化', starters: ['诊断当前门店转化漏斗并给本周可执行动作', '设计周末客流高峰的排班与接待话术'] },
  { id: 'procurement', name: '采购专家', emoji: '📦', desc: '供应链 · 成本与库存', starters: ['针对易碎品列出降低损耗的采购方案', '给一份本月采购比价与交期检查清单'] },
  { id: 'creative_director', name: '创意总监', emoji: '🎨', desc: '品牌 · 视觉与体验', starters: ['为新一批标本画想一个陈列主题', '给门店秋季活动一个可落地的创意'] },
  { id: 'data_analyst', name: '数据分析师', emoji: '📊', desc: '经营数据 · 归因', starters: ['本月复购率下降，怎么定位原因？', '设计一张门店经营日报的指标表'] },
  { id: 'cfo', name: '财务总监', emoji: '💰', desc: '成本 · 现金流', starters: ['算一下新增一名店员的盈亏平衡点', '给一份本月现金流风险清单'] },
  { id: 'hr_manager', name: '人事经理', emoji: '🧑‍💼', desc: '招聘 · 薪酬 · 考勤', starters: ['按当前人效看，还缺哪个岗位？', '给一份本月人力成本与考勤体检'] },
  { id: 'marketing', name: '市场总监', emoji: '📣', desc: '增长 · 内容与投放', starters: ['下周内容选题给 5 个方向', '设计一次老客回流活动'] }
]

const byId = (id) => ROLES.find((r) => r.id === id) || ROLES[0]

module.exports = { ROLES, byId }
