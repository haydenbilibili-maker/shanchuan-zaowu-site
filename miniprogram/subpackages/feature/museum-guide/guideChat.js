/**
 * 博物君 · 对话纯函数（2026-11-23，无 wx / 无网络，守卫 test:museum-guide 直接 require）
 * 蓝图：miniprogram/docs/博物君_AI馆员_蓝图_2026-11-23.md
 */

/** 本机对话存储（每个 openid 一份；只存本机，可清空） */
const STORE_KEY = 'museum_guide_chat_v1'
const STORE_MAX = 40
/** 发给云函数的历史条数（与云函数 HISTORY_MAX 一致） */
const HISTORY_SEND = 6
const QUESTION_MAX = 300

const WELCOME = '你好，我是博物君，山海造物标本馆的馆员。关于蝴蝶、贝壳、矿物与化石，关于标本怎么保存，关于山海造物这座馆，都可以问我。'

/** 开场问题：品牌 / 公益 / 科普 / 养护 / 到馆 各一（首日的样子；之后按天从问题池轮换） */
const STARTERS = [
  '山海造物是一座怎样的馆？',
  '1% 公益是怎么回事？',
  '大蓝闪蝶为什么是蓝色的？',
  '蝴蝶标本怎么防潮防虫？',
  '怎么预约到馆参观？'
]

/**
 * 开场问题池（2026-11-23）：每天每类取一个，回访的人看到的不总是同五个。
 * 只放博物君答得了的问题：品牌与公益用馆方事实，科普只问通识，物种只选图鉴里有的。
 */
const STARTER_POOL = {
  brand: ['山海造物是一座怎样的馆？', '「把山海带回家」是什么意思？', '馆里的标本都从哪里来？', '山海图鉴怎么一页页翻开？'],
  giving: ['1% 公益是怎么回事？', '1% 的捐赠会用在哪里？', '我怎么知道捐赠真的发生了？'],
  nature: ['大蓝闪蝶为什么是蓝色的？', '鹦鹉螺为什么被叫作活化石？', '虎斑宝贝的壳为什么那么光亮？', '蝴蝶和蛾子怎么区分？', '银杏为什么被叫作植物界的大熊猫？', '甲虫为什么是种类最多的动物？', '贝壳上的花纹是怎么长出来的？'],
  care: ['蝴蝶标本怎么防潮防虫？', '标本放在哪里不容易褪色？', '矿物标本可以用水洗吗？', '押花标本会变色吗？'],
  visit: ['怎么预约到馆参观？', '到馆参观可以看到什么？', '馆里有适合孩子的自然课吗？']
}

/** 北京时间的日序号（按天轮换开场问题用） */
function dayIndex(now) {
  return Math.floor(((now || Date.now()) + 8 * 3600 * 1000) / 86400000)
}

/** 今天的五个开场问题：每类一个，按日序号轮换 */
function startersFor(now) {
  const d = dayIndex(now)
  return ['brand', 'giving', 'nature', 'care', 'visit'].map((k, i) => {
    const pool = STARTER_POOL[k]
    return pool[(d + i * 3) % pool.length]
  })
}

/**
 * 回答去 Markdown（与云函数 plainAnswer 同口径；本机旧记录与旧版云函数的回答也走一遍）。
 */
function plainAnswer(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '· ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 逐字显示（2026-11-23）：新回答「边想边说」地出来。每拍多少字随长度变 —— 不论多长都在约 1.6 秒内写完，
 * 短回答不至于一个字一个字地磨。返回每一拍显示到第几个字。
 */
const REVEAL_TICK_MS = 40
const REVEAL_MAX_MS = 1600
function revealSteps(len) {
  const n = Math.max(0, len | 0)
  if (!n) return []
  const ticks = Math.max(1, Math.min(Math.ceil(n / 3), Math.floor(REVEAL_MAX_MS / REVEAL_TICK_MS)))
  const per = Math.ceil(n / ticks)
  const out = []
  for (let i = per; i < n; i += per) out.push(i)
  out.push(n)
  return out
}

/**
 * 馆内去处白名单（key 与云函数 knowledge.PLACES 一一对应）。
 * tab = 是否 tabBar 页（switchTab）。
 */
const ACTIONS = {
  atlas: { label: '翻山海图鉴', url: '/subpackages/feature/collection/index' },
  identify: { label: '去 AI 鉴定', url: '/subpackages/feature/identify/index' },
  care: { label: '看标本养护', url: '/subpackages/feature/care/index?from=museum_guide' },
  booking: { label: '预约参观', url: '/subpackages/business/booking/index?from=museum_guide' },
  donations: { label: '我的捐赠', url: '/subpackages/business/donations/index' },
  achievements: { label: '我的成就', url: '/subpackages/extra/user/achievements/index' },
  shop: { label: '逛馆藏', url: '/pages/category/index', tab: true }
}

/** 云函数失败时给用户看的话（error_type → 文案）；服务端 msg 优先 */
const ERROR_COPY = {
  invalid: '这个问题博物君没看明白，换个说法试试',
  risky: '这个问题博物君没法回答，换一个吧',
  quota: '今天问得够多啦，明天再来找博物君',
  ai_service: '博物君一时没翻到答案，请稍后再试',
  not_deployed: '博物君还在布展，过几天再来',
  off: '博物君暂时闭馆整理，过些日子再来',
  network: '网络不太稳，没能把问题送到博物君那里'
}

function storeKey(openid) {
  return openid ? `${STORE_KEY}_${openid}` : STORE_KEY
}

let seq = 0
function newId(prefix) {
  seq += 1
  return `${prefix || 'm'}${Date.now().toString(36)}${seq}`
}

/** 一条消息：role = user | guide；guide 可带 followUps / actions（已映射成按钮） */
function makeMessage(role, text, extra) {
  return Object.assign({ id: newId(role === 'user' ? 'u' : 'g'), role, text: String(text || '') }, extra || {})
}

/** 把云函数给的 action key 映射成按钮；不在白名单的丢掉 */
function actionButtons(keys) {
  return (keys || []).filter((k, i, arr) => ACTIONS[k] && arr.indexOf(k) === i).slice(0, 2)
    .map((k) => ({ key: k, label: ACTIONS[k].label, url: ACTIONS[k].url, tab: !!ACTIONS[k].tab }))
}

/** 云函数返回的图鉴物种（{ no, zh }）→ 链接；编号只认三位数字，最多 2 个 */
function speciesLinks(list) {
  return (Array.isArray(list) ? list : [])
    .filter((s) => s && /^\d{3}$/.test(String(s.no || '')) && s.zh)
    .slice(0, 2)
    .map((s) => ({ no: String(s.no), zh: String(s.zh) }))
}

/** 入口带来的问题（?q=，已 encode）：解码失败 / 空 / 超长都按无 */
function entryQuestion(options) {
  if (!options || !options.q) return ''
  let q = ''
  try { q = decodeURIComponent(options.q) } catch (e) { return '' }
  const c = cleanQuestion(q)
  return c.error ? '' : c.question
}

/**
 * 发给云函数的历史：只取正常的问答（失败提示 / 欢迎语不算），最近 6 条，guide → assistant。
 */
function historyForRequest(messages) {
  return (messages || [])
    .filter((m) => m && (m.role === 'user' || (m.role === 'guide' && !m.isError && !m.isWelcome)) && m.text)
    .slice(-HISTORY_SEND)
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }))
}

/** 问题清洗：压空白；空 / 超长返回 error */
function cleanQuestion(raw) {
  const q = String(raw || '').replace(/\s+/g, ' ').trim()
  if (!q) return { error: '先写下想问的问题' }
  if (q.length > QUESTION_MAX) return { error: `问题请控制在 ${QUESTION_MAX} 字以内` }
  return { question: q }
}

/** 云函数没部署 / 名字不对（真机 errCode -501000 / FUNCTION_NOT_FOUND） */
function isNotDeployed(err) {
  const s = String((err && (err.errMsg || err.message)) || err || '')
  const code = err && (err.errCode || err.code)
  return /FUNCTION_NOT_FOUND|FunctionName parameter could not be found|function not found/i.test(s) || String(code) === '-501000'
}

/**
 * 进页状态（askMuseumGuide action: 'status'）→ { closed, closedText, quota }。
 * 读不到 / 没部署 / 旧版云函数没有 status：当作开着、额度未知（不因为状态读失败把人挡在门外）。
 */
function statusView(result) {
  const r = result || {}
  if (!r.success) return { closed: false, closedText: '', quota: null }
  const quota = r.quota && typeof r.quota.left === 'number' ? { left: r.quota.left, cap: r.quota.cap } : null
  return { closed: r.enabled === false, closedText: r.enabled === false ? (r.msg || ERROR_COPY.off) : '', quota }
}

/**
 * 云函数结果 → 一条博物君消息 + 额度。
 * 成功：回答 + 追问 + 去处；失败：错误气泡（isError，不进历史）。
 */
function replyToMessage(result) {
  const r = result || {}
  const quota = r.quota && typeof r.quota.left === 'number' ? { left: r.quota.left, cap: r.quota.cap } : null
  if (r.success && r.answer) {
    return {
      message: makeMessage('guide', plainAnswer(r.answer), {
        followUps: (r.followUps || []).filter(Boolean).slice(0, 3),
        actions: actionButtons(r.actions),
        species: speciesLinks(r.species)
      }),
      quota
    }
  }
  const type = r.error_type && ERROR_COPY[r.error_type] ? r.error_type : 'ai_service'
  return { message: makeMessage('guide', r.msg || ERROR_COPY[type], { isError: true, errorType: type }), quota }
}

/** 存本机：去掉欢迎语、只留最近 40 条；追问 / 去处只保留在最后一条上 */
function toStored(messages) {
  const list = (messages || []).filter((m) => m && !m.isWelcome && !m.pending).slice(-STORE_MAX)
  return list.map((m, i) => {
    // 逐字显示的中间态不进存储：存的永远是整段回答
    const base = Object.assign({}, m)
    delete base.shown
    delete base.revealing
    return i === list.length - 1 ? base : Object.assign(base, { followUps: [], actions: [] })
  })
}

/** 读本机：坏数据丢掉 */
function fromStored(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'guide') && typeof m.text === 'string' && m.text)
    .slice(-STORE_MAX)
    .map((m) => {
      const out = Object.assign({}, m)
      delete out.shown
      delete out.revealing
      if (out.role === 'guide') out.text = plainAnswer(out.text)
      return out
    })
}

function quotaText(quota) {
  if (!quota) return ''
  if (quota.left <= 0) return '今日次数已用完'
  return `今日还可问 ${quota.left} 次`
}

module.exports = {
  STORE_KEY,
  STORE_MAX,
  HISTORY_SEND,
  QUESTION_MAX,
  WELCOME,
  STARTERS,
  STARTER_POOL,
  REVEAL_TICK_MS,
  startersFor,
  plainAnswer,
  revealSteps,
  ACTIONS,
  ERROR_COPY,
  storeKey,
  makeMessage,
  actionButtons,
  speciesLinks,
  entryQuestion,
  historyForRequest,
  cleanQuestion,
  isNotDeployed,
  replyToMessage,
  statusView,
  toStored,
  fromStored,
  quotaText
}
