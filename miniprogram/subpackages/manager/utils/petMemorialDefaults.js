/**
 * 伴宠记忆工坊 — 默认配置
 */

const STEPS = [
  { id: 1, key: 'consent', label: '了解', title: '知情确认', desc: '了解工艺边界与服务流程，确认后再继续' },
  { id: 2, key: 'profile', label: '档案', title: '它的档案', desc: '名字、物种与参考照片，帮助标本师评估' },
  { id: 3, key: 'craft', label: '工艺', title: '选择工艺', desc: '浸液、剥制或骨骼，不同工艺周期与效果各异' },
  { id: 4, key: 'intake', label: '交接', title: '交接方式', desc: '到店或上门收运，约定期望交接日期' },
  { id: 5, key: 'submit', label: '提交', title: '联系与提交', desc: '留下联系方式，专员将在 1–2 个工作日内与您沟通' }
]

const CONSENT_VERSION = 'v2'

const SPECIES_OPTIONS = [
  { id: 'cat', label: '猫' },
  { id: 'dog', label: '犬' },
  { id: 'rabbit', label: '兔' },
  { id: 'reptile', label: '爬宠' },
  { id: 'bird', label: '鸟' },
  { id: 'other', label: '其他' }
]

const WEIGHT_RANGES = [
  { id: 'under1', label: '1kg 以下' },
  { id: '1-3', label: '1–3kg' },
  { id: '3-5', label: '3–5kg' },
  { id: '5-10', label: '5–10kg' },
  { id: '10-15', label: '10–15kg' },
  { id: 'over15', label: '15kg 以上' }
]

const STORAGE_OPTIONS = [
  { id: 'frozen', label: '冷冻保存' },
  { id: 'chilled', label: '冷藏（24h 内）' },
  { id: 'other', label: '其他 / 不确定' }
]

const POSE_OPTIONS = [
  { id: 'sleeping', label: '趴卧休息' },
  { id: 'sitting', label: '端坐' },
  { id: 'custom', label: '定制说明' }
]

const INTAKE_METHODS = [
  { id: 'store', label: '到店交接', desc: '按预约时间送至门店，标本师当面确认' },
  { id: 'pickup', label: '上门收运', desc: '同城范围内专员安排收运（需评估）' },
  { id: 'partner_clinic', label: '合作医院代交', desc: '由合作宠物医院代为交接' }
]

const RELATION_OPTIONS = [
  { id: 'owner', label: '主人' },
  { id: 'family', label: '家人' },
  { id: 'other', label: '其他' }
]

/** 旧单据可能存 relationLabel「本人」或误用中文作 id，展示时统一映射 */
const RELATION_LABEL_ALIASES = {
  本人: '主人',
  owner: '主人',
  family: '家人',
  other: '其他'
}

const DEFAULT_CRAFTS = [
  {
    craftId: 'fluid',
    name: '浸液标本',
    desc: '整体或局部浸于透明保存液，可长久观形态。适合小型犬猫与部分异宠。',
    estimatedWeeks: '约 4–8 周',
    craftTier: 'primary',
    sort: 1
  },
  {
    craftId: 'taxidermy',
    name: '剥制标本',
    desc: '还原生前姿态，保留真实毛发质感。制作周期较长，需标本师评估体量与姿态可行性。',
    estimatedWeeks: '约 8–16 周',
    craftTier: 'primary',
    sort: 2
  },
  {
    craftId: 'skeletal',
    name: '骨骼标本',
    desc: '清理并装裱骨骼，适合中大型犬或特殊纪念形式。',
    estimatedWeeks: '约 6–10 周',
    craftTier: 'primary',
    sort: 3
  }
]

/** M3 规划：装裱呈现（Layer B）— 详见 PRD §6.3 */
const DEFAULT_MOUNTINGS = [
  { configId: 'mount_glass_dome_s', type: 'mounting', name: '小型玻璃罩', applicableCrafts: ['taxidermy', 'composite'], sort: 1 },
  { configId: 'mount_glass_dome_l', type: 'mounting', name: '大型玻璃罩', applicableCrafts: ['taxidermy'], sort: 2 },
  { configId: 'mount_wood_pedestal', type: 'mounting', name: '胡桃木底座', applicableCrafts: ['taxidermy', 'skeletal', 'fluid', 'composite'], sort: 3 },
  { configId: 'mount_shadow_box', type: 'mounting', name: '深度纪念画框', applicableCrafts: ['skeletal', 'composite', 'fluid_partial'], sort: 4 },
  { configId: 'mount_wall_art', type: 'mounting', name: '壁挂装裱', applicableCrafts: ['skeletal'], sort: 5 },
  { configId: 'mount_fluid_vessel', type: 'mounting', name: '浸液专用器皿', applicableCrafts: ['fluid'], sort: 6 },
  { configId: 'mount_plaque_brass', type: 'mounting', name: '黄铜纪念牌', applicableCrafts: ['*'], sort: 7 }
]

/** M3 规划：组合加项（Layer C）— 详见 PRD §6.4.1 */
const DEFAULT_ADDONS = [
  { configId: 'addon_paw_clay', type: 'addon', name: '爪印（泥型）', requiresIntake: true, sort: 1 },
  { configId: 'addon_paw_ceramic', type: 'addon', name: '爪印（陶瓷）', requiresIntake: true, sort: 2 },
  { configId: 'addon_hair_vial', type: 'addon', name: '毛发纪念瓶', requiresIntake: true, sort: 3 },
  { configId: 'addon_photo_plate', type: 'addon', name: '照片纪念牌', requiresIntake: false, sort: 4 },
  { configId: 'addon_ritual_card', type: 'addon', name: '仪式手卡', requiresIntake: false, sort: 5 }
]

/** M3 规划：预设组合套餐 — 详见 PRD §6.4.2 */
const DEFAULT_BUNDLES = [
  {
    bundleId: 'bundle_trace',
    name: '痕迹留存',
    desc: '爪印、毛发与手卡，暂不制作全身藏品',
    craftId: 'composite',
    includes: ['addon_paw_clay', 'addon_hair_vial', 'addon_ritual_card'],
    estimatedWeeks: '约 2–3 周',
    sort: 1
  },
  {
    bundleId: 'bundle_shadow',
    name: '阴影盒纪念',
    desc: '爪印、照片与铜牌装入深度画框',
    craftId: 'composite',
    includes: ['addon_paw_clay', 'addon_photo_plate', 'mount_shadow_box', 'mount_plaque_brass'],
    estimatedWeeks: '约 2–4 周',
    sort: 2
  },
  {
    bundleId: 'bundle_cabinet_s',
    name: '小型罩柜套装',
    desc: '剥制 + 小型玻璃罩 + 木底座 + 铜牌',
    craftId: 'taxidermy',
    includes: ['mount_glass_dome_s', 'mount_wood_pedestal', 'mount_plaque_brass'],
    estimatedWeeks: '约 10–16 周',
    sort: 3
  },
  {
    bundleId: 'bundle_skeletal_art',
    name: '骨骼艺术套装',
    desc: '骨骼制作 + 壁挂或阴影盒 + 铜牌',
    craftId: 'skeletal',
    includes: ['mount_wall_art', 'mount_plaque_brass'],
    estimatedWeeks: '约 6–10 周',
    sort: 4
  }
]

const STATUS_LABELS = {
  pending_review: '待评估',
  need_info: '需补充信息',
  quoted: '已报价待确认',
  accepted: '已确认承接',
  awaiting_intake: '待交接',
  intake_done: '已交接',
  in_production: '制作中',
  quality_check: '质检确认',
  ready: '待取 / 待寄',
  completed: '已完成',
  cancelled: '已取消'
}

const SERVICE_NOTICE = [
  '伴宠记忆为高度定制服务，提交意向后由标本师评估是否承接，并非立即支付下单。',
  '工艺效果因个体体型、毛发与保存条件存在差异，最终以门店评估与沟通为准。',
  '标本师会在定制过程中通过视频等方式多次确认方案与进程。',
  '伴宠订单一经发出，不接受非物流原因的退款申请；成品以顺丰保价寄出。',
  '建议在离世后尽快冷冻保存，具体可处理时限以专员说明为准。',
  '我们不接受受保护野生动物及无合法来源的物种。'
]

module.exports = {
  STEPS,
  CONSENT_VERSION,
  SPECIES_OPTIONS,
  WEIGHT_RANGES,
  STORAGE_OPTIONS,
  POSE_OPTIONS,
  INTAKE_METHODS,
  RELATION_OPTIONS,
  RELATION_LABEL_ALIASES,
  DEFAULT_CRAFTS,
  DEFAULT_MOUNTINGS,
  DEFAULT_ADDONS,
  DEFAULT_BUNDLES,
  STATUS_LABELS,
  SERVICE_NOTICE
}
