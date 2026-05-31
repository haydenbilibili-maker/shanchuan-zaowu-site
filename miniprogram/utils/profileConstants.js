/**
 * 藏家档案 — 常量与等级权益（与 getUserStats 对齐）
 */

const INTEREST_OPTIONS = [
  { key: 'INSECTA', label: '神奇昆虫', color: '#52B788' },
  { key: 'MINERALS', label: '群山回响', color: '#7B68AE' },
  { key: 'PLANTAE', label: '植物探微', color: '#6DA34D' },
  { key: 'MARINE', label: '无尽海洋', color: '#5B8FB9' },
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
  { level: 1, name: '原木·见习者', threshold: 0, discount: 1.0, perks: ['基础会员身份', '每日签到积分'] },
  { level: 2, name: '秘银·采集家', threshold: 500, discount: 0.98, perks: ['藏品 9.8 折', '门店免费饮品'] },
  { level: 3, name: '流金·研究员', threshold: 3000, discount: 0.95, perks: ['藏品 9.5 折', '优先预约名额'] },
  { level: 4, name: '曜石·策展人', threshold: 10000, discount: 0.9, perks: ['藏品 9 折', '生日礼遇'] },
  { level: 5, name: '星陨·守护者', threshold: 30000, discount: 0.85, perks: ['藏品 8.5 折', '专属策展活动'] },
  { level: 99, name: '荣誉馆长', threshold: 0, discount: 0.85, perks: ['荣誉身份', '全等级权益'] }
]

const PROFILE_REWARD = { points: 50, growthBonus: 20 }

module.exports = {
  INTEREST_OPTIONS,
  GENDER_OPTIONS,
  MBTI_OPTIONS,
  ZODIAC_OPTIONS,
  LEVEL_BENEFITS,
  PROFILE_REWARD
}
