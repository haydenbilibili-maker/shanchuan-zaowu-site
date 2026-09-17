/**
 * 藏家档案 — 常量与等级权益（与 getUserStats 对齐）
 */

const INTEREST_OPTIONS = [
  { key: 'INSECTA', label: '蝴蝶昆虫', color: '#52B788' },
  { key: 'ANIMALIA', label: '动物世界', color: '#8B6F47' },
  { key: 'PLANTAE', label: '植物果实', color: '#6DA34D' },
  { key: 'MARINE', label: '海洋标本', color: '#5B8FB9' },
  { key: 'MINERALS', label: '矿石馆', color: '#7B68AE' },
  { key: 'FRAMING', label: '装裱艺术', color: '#C4A76C' },
  { key: 'CUSTOM', label: '标本定制', color: '#C4A76C' },
  { key: 'COURSE', label: '自然课程', color: '#A09A90' },
  { key: 'COLLECTING', label: '收藏鉴赏', color: '#8B6F47' }
]

const GENDER_OPTIONS = [
  { key: 'male', label: '男' },
  { key: 'female', label: '女' },
  { key: 'other', label: '其他' },
  { key: 'prefer_not', label: '不愿透露' }
]

const MBTI_OPTIONS = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP',
  'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ',
  'ISTP', 'ISFP', 'ESTP', 'ESFP'
]

const ZODIAC_OPTIONS = [
  { key: 'capricorn', label: '摩羯座' },
  { key: 'aquarius', label: '水瓶座' },
  { key: 'pisces', label: '双鱼座' },
  { key: 'aries', label: '白羊座' },
  { key: 'taurus', label: '金牛座' },
  { key: 'gemini', label: '双子座' },
  { key: 'cancer', label: '巨蟹座' },
  { key: 'leo', label: '狮子座' },
  { key: 'virgo', label: '处女座' },
  { key: 'libra', label: '天秤座' },
  { key: 'scorpio', label: '天蝎座' },
  { key: 'sagittarius', label: '射手座' }
]

const LEVEL_BENEFITS = [
  {
    level: 1,
    name: '原木·见习者',
    threshold: 100,
    discount: 0.98,
    perks: [
      { title: '基础权益', label: '基础权益', desc: '开通藏家档案，浏览收藏与参与活动', icon: '/assets/icons/user.png' },
      { title: '藏品 9.8 折', label: '九八折', desc: '指定藏品结算时自动享受会员折扣', icon: '/assets/icons/discount.png' }
    ]
  },
  {
    level: 2,
    name: '秘银·采集家',
    threshold: 1000,
    discount: 0.95,
    perks: [
      { title: '藏品 9.5 折', label: '九五折', desc: '指定藏品结算时自动享受会员折扣', icon: '/assets/icons/discount.png' },
      { title: '优先预约', label: '优先预约', desc: '课程与活动名额紧张时优先保留', icon: '/assets/icons/calendar_gold.png' },
      { title: '生日礼券', label: '生日礼券', desc: '生日当天获积分与满减礼券（以门店规则为准）', icon: '/assets/icons/gift.png' }
    ]
  },
  {
    level: 3,
    name: '流金·研究员',
    threshold: 2000,
    discount: 0.9,
    perks: [
      { title: '藏品 9 折', label: '九折', desc: '指定藏品结算时自动享受会员折扣', icon: '/assets/icons/discount.png' },
      { title: '专属客服', label: '专属客服', desc: '专属顾问通道，优先响应咨询', icon: '/assets/icons/user.png' },
      { title: '优先预约', label: '优先预约', desc: '课程与活动名额紧张时优先保留', icon: '/assets/icons/calendar_gold.png' },
      { title: '生日礼券', label: '生日礼券', desc: '生日当天获积分与满减礼券（以门店规则为准）', icon: '/assets/icons/gift.png' }
    ]
  },
  {
    level: 4,
    name: '曜石·策展人',
    threshold: 10000,
    discount: 0.85,
    perks: [
      { title: '藏品 8.5 折', label: '八五折', desc: '指定藏品结算时自动享受会员折扣', icon: '/assets/icons/discount.png' },
      { title: '专属活动', label: '专属活动', desc: '受邀参与闭门策展与限量藏品预览', icon: '/assets/icons/star.png' },
      { title: '生日礼券', label: '生日礼券', desc: '生日当天获积分与满减礼券（以门店规则为准）', icon: '/assets/icons/gift.png' }
    ]
  },
  {
    level: 5,
    name: '星陨·守护者',
    threshold: 30000,
    discount: 0.8,
    perks: [
      { title: '藏品 8 折', label: '八折', desc: '指定藏品结算时自动享受会员折扣', icon: '/assets/icons/discount.png' },
      { title: '定制服务', label: '定制服务', desc: '可预约专属定制与策展咨询', icon: '/assets/icons/star.png' },
      { title: '生日礼券', label: '生日礼券', desc: '生日当天获积分与满减礼券（以门店规则为准）', icon: '/assets/icons/gift.png' }
    ]
  },
  {
    level: 6,
    name: '星耀·博物官',
    threshold: 100000,
    discount: 0.7,
    perks: [
      { title: '藏品 7 折', label: '七折', desc: '指定藏品结算时自动享受会员折扣', icon: '/assets/icons/discount.png' },
      { title: '私人鉴赏预约', label: '私人鉴赏', desc: '可预约门店私人导览与藏品鉴赏时段', icon: '/assets/icons/calendar_gold.png' },
      { title: '限量编号优先购', label: '编号优先', desc: '限量编号藏品开售时享优先购名额', icon: '/assets/icons/medal_gold.png' }
    ]
  },
  {
    level: 99,
    name: '荣誉馆长',
    threshold: 0,
    discount: 0.7,
    perks: [
      { title: '荣誉身份', label: '荣誉身份', desc: '荣誉馆长铭牌，享全等级权益', icon: '/assets/icons/medal_gold.png' },
      { title: '全等级权益', label: '全档权益', desc: '折扣、预约与生日礼券一并生效', icon: '/assets/icons/done.png' }
    ]
  }
]

/**
 * 完成注册礼包展示兜底（权威在云库 member_welcome_gift / manageWelcomeGift preview）
 * 与线上「超管工作台-新会员礼包」逐字对齐：无积分 + 满49减5 / 满99减10 / 满299减30 / 满499减50 / 满999减100
 * 网络失败时注册页会退回这份数据，务必随配置页同步，否则断网即显示错误门槛
 */
const REGISTER_GIFT = {
  points: 0,
  coupons: [
    { value: 5, minSpend: 49 },
    { value: 10, minSpend: 99 },
    { value: 30, minSpend: 299 },
    { value: 50, minSpend: 499 },
    { value: 100, minSpend: 999 }
  ],
  expireDays: 90,
  stackable: false
}
/** 完善资料奖励（与云函数 upsertUserProfile 对齐；默认 0，注册净入账仅礼包） */
const PROFILE_REWARD = { points: 0, growthBonus: 0 }

module.exports = {
  INTEREST_OPTIONS,
  GENDER_OPTIONS,
  MBTI_OPTIONS,
  ZODIAC_OPTIONS,
  LEVEL_BENEFITS,
  REGISTER_GIFT,
  PROFILE_REWARD
}
