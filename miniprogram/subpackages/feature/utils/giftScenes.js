/**
 * 礼赠人生时间点场景（与兴趣 tags 分离）
 * 与各云函数 giftScenes.js 及 Admin utils/giftScenes.js 保持一致
 */
const MAX_SCENES = 8

const GIFT_SCENES = [
  {
    key: 'housewarming',
    label: '乔迁',
    guide: '新居初启，选一件安静落桌的藏品。',
    noteHint:
      '新家的灯刚亮起来。柜中挑了一件想慢慢看的藏品——愿它落在你们的桌上，像一句不必催促的祝福。'
  },
  {
    key: 'wedding',
    label: '新婚',
    guide: '两个人的新章，用一件藏品轻轻落笔。',
    noteHint:
      '日子刚开始交叠。柜中挑了一件安静的藏品给你们——愿它落在新家里，像一句说不完的祝愿。'
  },
  {
    key: 'birthday',
    label: '生日',
    guide: '不必热闹，一件藏品也够郑重。',
    noteHint:
      '又一年，愿你把灯开得刚好。柜中挑了一件想让你慢慢看的藏品——物种的故事在铜牌上，余下的交给时间。'
  },
  {
    key: 'anniversary',
    label: '纪念日',
    guide: '把值得记得的一天，留一件可触的纪念。',
    noteHint:
      '这一天值得被记得。柜中挑了一件安静的藏品——愿它落在手边，像我们之间那些不必说满的话。'
  },
  {
    key: 'enrollment',
    label: '升学',
    guide: '新的起点，放一件踏实的伴手礼。',
    noteHint:
      '新的一程启了。柜中挑了一件踏实的藏品给你——放在桌上，像一句不催促的加油。'
  },
  {
    key: 'graduation',
    label: '毕业',
    guide: '一段路程走完，选一件可以带走的安静。',
    noteHint:
      '这一段路走完了。柜中挑了一件可以带走的藏品——愿它陪你打开下一扇门。'
  },
  {
    key: 'new_job',
    label: '新工作',
    guide: '新工位、新节奏，一件不吵闹的开场。',
    noteHint:
      '新的工位，新的节奏。柜中挑了一件不吵闹的藏品——愿它落在你桌上时，也像一次稳稳的开场。'
  },
  {
    key: 'gratitude',
    label: '致谢',
    guide: '一句谢谢，用藏品说得更慢一点。',
    noteHint:
      '承蒙这段日子里的照应。柜中挑了一件安静的藏品——愿它落在你处时，也像一句不急着说完的谢谢。'
  }
]

const GIFT_SCENE_KEYS = GIFT_SCENES.map((s) => s.key)
const SCENE_MAP = GIFT_SCENES.reduce((acc, s) => {
  acc[s.key] = s
  return acc
}, {})

function sanitizeGiftScenes(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input || '').split(/[,，、;；\s]+/)
  const seen = new Set()
  const out = []
  for (const item of raw) {
    const key = String(item || '')
      .trim()
      .toLowerCase()
      .replace(/[\u0000-\u001F\u007F]/g, '')
    if (!key || !SCENE_MAP[key]) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
    if (out.length >= MAX_SCENES) break
  }
  return out
}

function getSceneByKey(key) {
  const k = String(key || '')
    .trim()
    .toLowerCase()
  return SCENE_MAP[k] || null
}

function labelForScene(key) {
  const s = getSceneByKey(key)
  return s ? s.label : ''
}

function readGiftScenes(row) {
  return sanitizeGiftScenes(row && row.giftScenes)
}

module.exports = {
  MAX_SCENES,
  GIFT_SCENES,
  GIFT_SCENE_KEYS,
  sanitizeGiftScenes,
  getSceneByKey,
  labelForScene,
  readGiftScenes
}
