/**
 * 工作室预算池默认值（采购观测台用；与 getStudioDashboard 同源）
 * 运行时以 configs/studio_budget_pools 可覆写
 */
const BUDGET_POOLS = [
  {
    poolKey: 'total',
    name: '总预算池',
    category: '总预算',
    annualAmount: 200000,
    monthlyAmount: 32108
  },
  {
    poolKey: 'safety',
    name: '安全资金池',
    category: '安全资金',
    annualAmount: 60000,
    monthlyAmount: 20000
  },
  {
    poolKey: 'rent',
    name: '房租',
    category: '房租',
    annualAmount: 54200,
    monthlyAmount: 0
  },
  {
    poolKey: 'broadband',
    name: '宽带',
    category: '宽带',
    annualAmount: 1098,
    monthlyAmount: 91.5
  },
  {
    poolKey: 'purchasable',
    name: '可采购预算',
    category: '采购控制',
    annualAmount: 84852,
    monthlyAmount: 0
  },
  {
    poolKey: 'hardware',
    name: '基础硬件池',
    category: '基础硬件',
    annualAmount: 30000,
    monthlyAmount: 2500
  },
  {
    poolKey: 'specimen_materials',
    name: '标本原材料与耗材池',
    category: '标本原材料与耗材',
    annualAmount: 60000,
    monthlyAmount: 5000
  }
]

const HARDWARE_BUDGET_TYPES = ['工具采购', '基础硬件']
const SPECIMEN_BUDGET_TYPES = ['标本采购', '标本原材料与耗材']

module.exports = {
  BUDGET_POOLS,
  HARDWARE_BUDGET_TYPES,
  SPECIMEN_BUDGET_TYPES
}
