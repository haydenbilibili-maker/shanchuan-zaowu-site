/**
 * 工作室预算池默认值 — 来自飞书「预算池配置」样例（标本工作室采购库存管理系统.base）
 * 运行时以 configs/studio_budget_pools 可覆写；仪表盘勿写死假业务数据，仅用此作预算池基准。
 */
const BUDGET_POOLS = [
  {
    poolKey: 'total',
    name: '总预算池',
    category: '总预算',
    annualAmount: 200000,
    monthlyAmount: 32108,
    note: '总预算200000元。扣除：安全储备60000；月度基础运营20000（薪酬15000+基础运营5000）'
  },
  {
    poolKey: 'safety',
    name: '安全资金池',
    category: '安全资金',
    annualAmount: 60000,
    monthlyAmount: 20000,
    note: '3个月基础运营安全资金：3×20000=60000（不可随意动用）'
  },
  {
    poolKey: 'rent',
    name: '房租',
    category: '房租',
    annualAmount: 54200,
    monthlyAmount: 0,
    note: '全年房租已一次性缴纳'
  },
  {
    poolKey: 'broadband',
    name: '宽带',
    category: '宽带',
    annualAmount: 1098,
    monthlyAmount: 91.5,
    note: '电信宽带'
  },
  {
    poolKey: 'purchasable',
    name: '可采购预算',
    category: '采购控制',
    annualAmount: 84852,
    monthlyAmount: 0,
    note: '可采购预算 = 总预算 - 安全储备 - 房租 - 宽带已付'
  },
  {
    poolKey: 'hardware',
    name: '基础硬件池',
    category: '基础硬件',
    annualAmount: 30000,
    monthlyAmount: 2500,
    note: '设备+工具；含基础硬件与工具采购类'
  },
  {
    poolKey: 'specimen_materials',
    name: '标本原材料与耗材池',
    category: '标本原材料与耗材',
    annualAmount: 60000,
    monthlyAmount: 5000,
    note: '展示包装+制作耗材+标本采购'
  },
  {
    poolKey: 'salary',
    name: '员工薪酬池',
    category: '员工薪酬',
    annualAmount: 180000,
    monthlyAmount: 15000,
    note: '月薪约15000'
  },
  {
    poolKey: 'ops',
    name: '基础运营成本池',
    category: '基础运营',
    annualAmount: 240000,
    monthlyAmount: 20000,
    note: '每月固定扣除20000（薪酬15000+基础运营5000）'
  },
  {
    poolKey: 'utilities',
    name: '水电杂费',
    category: '水电杂费',
    annualAmount: 12000,
    monthlyAmount: 1000,
    note: '水电杂费每月预留1000'
  }
]

const HARDWARE_BUDGET_TYPES = ['工具采购', '基础硬件']
const SPECIMEN_BUDGET_TYPES = ['标本采购', '标本原材料与耗材']

module.exports = {
  BUDGET_POOLS,
  HARDWARE_BUDGET_TYPES,
  SPECIMEN_BUDGET_TYPES
}
