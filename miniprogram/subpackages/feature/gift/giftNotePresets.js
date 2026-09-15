/**
 * 礼笺按关系默认候选文案（一关系一文案）
 * 字数均 ≤200；语气：朋友式、克制、轻点标本意象
 */
const GIFT_NOTE_PRESETS = [
  {
    id: 'lover',
    label: '爱人',
    body: '日子里许多寻常的瞬间，都因你在而显得安静又珍贵。柜中挑了一件想让你慢慢看的藏品——愿它落在我们的桌上，像一句不必说完的惦念。'
  },
  {
    id: 'wife',
    label: '妻子',
    body: '谢谢你把家里的光调得刚好。挑了一件安静的藏品给你——铜牌上是物种的故事，余下的，留给我们慢慢聊。'
  },
  {
    id: 'colleague',
    label: '同事',
    body: '一起扛过不少节点。柜中挑了一件不吵闹的藏品，希望它落在你桌上时，也像一句不急着说完的谢谢。'
  },
  {
    id: 'bestie',
    label: '闺蜜',
    body: '有些话不用说满，你也懂。挑了一件想让你慢慢看的藏品——愿它陪你把灯打开的那些夜晚。'
  },
  {
    id: 'brother',
    label: '兄弟',
    body: '不多说场面话。柜里挑了一件踏实的藏品给你——放在手边，像我们之间那些不用说破的仗义。'
  },
  {
    id: 'client',
    label: '客户',
    body: '合作一路走来，承蒙信任。柜中挑了一件安静的藏品，愿它落在你处时，也像一次不急不躁的问候。'
  },
  {
    id: 'parents',
    label: '父母',
    body: '你们总把最好的留给我。这次换我挑一件安静的藏品——愿它落在家里，像一句不必催促的惦念。'
  },
  {
    id: 'self',
    label: '犒劳自己',
    body: '这段日子也辛苦了。给自己留一件会慢慢看的藏品——物种的故事在铜牌上，余下的交给时间。'
  }
]

function getPresetById(id) {
  const key = String(id || '').trim()
  if (!key) return null
  return GIFT_NOTE_PRESETS.find((p) => p.id === key) || null
}

module.exports = {
  GIFT_NOTE_PRESETS,
  getPresetById
}
