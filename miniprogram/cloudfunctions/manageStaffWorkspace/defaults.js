/** 早晚班门店清单默认项（可按门店扩展，当前代码内置） */
const MORNING_ITEMS = [
  { id: 'lights', label: '开灯与展厅照明检查' },
  { id: 'display', label: '标本陈列与价签核对' },
  { id: 'cashier', label: '收银/POS 开机与备用金清点' },
  { id: 'clean', label: '地面与展柜清洁' },
  { id: 'temp', label: '温湿度与安防主机状态' }
]

const EVENING_ITEMS = [
  { id: 'cash_close', label: '收银日结与小票归档' },
  { id: 'display_lock', label: '贵重标本上锁/罩板' },
  { id: 'lights_off', label: '闭店关灯（保留必要安防照明）' },
  { id: 'security', label: '门窗与安防布防确认' },
  { id: 'handover', label: '当班异常与待办交接记录' }
]

/** 上班打卡：09:30 前为准时 */
const CLOCK_IN_DEADLINE = { hour: 9, minute: 30 }
/** 下班打卡：21:00 及以后为准时 */
const CLOCK_OUT_EARLIEST = { hour: 21, minute: 0 }

const REIMBURSE_CATEGORIES = [
  '交通差旅',
  '门店物料',
  '快递物流',
  '客情接待',
  '其他'
]

/** 请假类型（key 入库，label 展示） */
const LEAVE_TYPES = [
  { key: 'personal', label: '事假' },
  { key: 'sick', label: '病假' },
  { key: 'annual', label: '年假' },
  { key: 'comp', label: '调休' },
  { key: 'other', label: '其他' }
]

module.exports = {
  MORNING_ITEMS,
  EVENING_ITEMS,
  CLOCK_IN_DEADLINE,
  CLOCK_OUT_EARLIEST,
  REIMBURSE_CATEGORIES,
  LEAVE_TYPES
}
