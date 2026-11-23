/**
 * 博物君 · 对话之外的能力（2026-11-23，产品负责人「继续全面升级博物君，提供除了对话之外的其他能力和创新功能」）
 * 纯函数（无 wx / 无网络），守卫 test:museum-guide 直接 require。
 *
 *   今日一物：按天从山海图鉴 80 种里取一种（每 80 天一轮、一轮里每种恰好一次；人人同一天看到同一件），做成一张标本签
 *   博物小测：每天 5 题，全部由图鉴馆藏事实生成（门类 / 产地 / 学名 / 习性 / 图鉴章节），同一天人人同一组
 *   博物笔记：在问答里收藏的回答，存本机
 *
 * 不剧透：图鉴的刻版线描是「翻开那一页」的奖励 —— 这里只用文字，从不出图版。
 * 不编：题目与解释只用图鉴里写好的字段；干扰项从图鉴里取真实存在的其它物种 / 门类 / 章节。
 */

const DAY_MS = 86400000
const BJ_OFFSET = 8 * 3600 * 1000
const QUIZ_SIZE = 5
const NOTES_MAX = 50
const QUIZ_KEEP_DAYS = 14

/** 北京时间的日序号（自 1970-01-01） */
function dayIndex(now) {
  return Math.floor(((now || Date.now()) + BJ_OFFSET) / DAY_MS)
}

/** 日序号 → 「11.23」「2026-11-23」 */
function dayText(day) {
  const d = new Date(day * DAY_MS)
  const m = d.getUTCMonth() + 1
  const dd = d.getUTCDate()
  return { short: `${m}.${dd < 10 ? '0' + dd : dd}`, full: `${d.getUTCFullYear()}-${m < 10 ? '0' + m : m}-${dd < 10 ? '0' + dd : dd}` }
}

/** 可复现的伪随机（mulberry32）：同一个种子人人得到同一串 */
function rng(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled(list, rand) {
  const a = list.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const t = a[i]; a[i] = a[j]; a[j] = t
  }
  return a
}

/** 第 cycle 轮的出场顺序（每 N 天一轮，一轮里每种恰好一次） */
function cycleOrder(n, cycle) {
  return shuffled(Array.from({ length: n }, (_, i) => i), rng(0x51A7 + cycle * 7919))
}

/** 今日一物：第 day 天的那一种 */
function dailySpecies(species, now) {
  const list = species || []
  if (!list.length) return null
  const day = dayIndex(now)
  const n = list.length
  return list[cycleOrder(n, Math.floor(day / n))[day % n]]
}

/** 最近 k 天（不含今天）的今日一物，新到旧 */
function pastDaily(species, now, k) {
  const out = []
  const today = dayIndex(now)
  for (let i = 1; i <= (k || 6); i++) {
    const d = today - i
    const sp = dailySpecies(species, d * DAY_MS - BJ_OFFSET + 1)
    if (sp) out.push({ day: d, dayText: dayText(d).short, no: sp.no, nameZh: sp.nameZh, category: sp.category })
  }
  return out
}

/** 一张今日一物卡（只用文字字段，不出图版） */
function dailyCard(species, series, now) {
  const sp = dailySpecies(species, now)
  if (!sp) return null
  const names = (sp.seriesIds || []).map((id) => (series || []).find((s) => s.id === id)).filter(Boolean).map((s) => s.name)
  const day = dayIndex(now)
  return {
    day,
    dayText: dayText(day).short,
    no: sp.no,
    nameZh: sp.nameZh,
    nameLatin: sp.nameLatin || '',
    category: sp.category || '',
    chapter: names.join('、'),
    origin: sp.origin || '',
    habit: sp.habit || '',
    essay: sp.essay || '',
    askQ: `${sp.nameZh}有什么有意思的地方？`
  }
}

/* ------------------------------ 博物小测 ------------------------------ */

function pickDistinct(pool, k, rand, exclude) {
  const seen = new Set(exclude || [])
  const out = []
  shuffled(pool, rand).forEach((x) => { if (out.length < k && !seen.has(x)) { seen.add(x); out.push(x) } })
  return out
}

/** 一道题：选项打乱后记住正确项的位置 */
function makeQ(kind, prompt, correct, distractors, rand, sp, explain) {
  const options = shuffled([correct].concat(distractors), rand)
  return {
    kind,
    prompt,
    options,
    answer: options.indexOf(correct),
    no: sp.no,
    nameZh: sp.nameZh,
    explain,
    askQ: `${sp.nameZh}有什么有意思的地方？`
  }
}

/** 同门类的其它物种名（干扰项更像、题更有意思）；不够时用全馆 */
function namePool(species, sp) {
  const same = species.filter((x) => x.no !== sp.no && x.category === sp.category).map((x) => x.nameZh)
  return same.length >= 3 ? same : species.filter((x) => x.no !== sp.no).map((x) => x.nameZh)
}

function clip(s, n) {
  const t = String(s || '')
  return t.length > n ? t.slice(0, n) + '…' : t
}

/**
 * 第 day 天的 5 道题：门类 / 产地 / 学名 / 习性 / 章节 各一（物种不重复）。
 * 同一天人人同一组；题干与解释只用图鉴字段。
 */
function buildQuiz(species, series, now) {
  const list = species || []
  if (list.length < 8) return []
  const day = dayIndex(now)
  const rand = rng(0xC0FFEE + day * 104729)
  const order = shuffled(list, rand)
  const used = new Set()
  const take = (pred) => {
    const sp = order.find((x) => !used.has(x.no) && (!pred || pred(x)))
    if (sp) used.add(sp.no)
    return sp
  }
  const cats = Array.from(new Set(list.map((x) => x.category).filter(Boolean)))
  const qs = []

  const s1 = take()
  if (s1) qs.push(makeQ('category', `「${s1.nameZh}」在山海图鉴里归哪一类？`, s1.category, pickDistinct(cats, 3, rand, [s1.category]), rand, s1,
    `${s1.nameZh}（${s1.nameLatin}）属于「${s1.category}」。${clip(s1.essay, 40)}`))

  const s2 = take((x) => x.origin)
  if (s2) qs.push(makeQ('origin', `哪一种来自「${clip(s2.origin, 24)}」？`, s2.nameZh, pickDistinct(namePool(list, s2), 3, rand, [s2.nameZh]), rand, s2,
    `${s2.nameZh}的产地：${s2.origin}。`))

  const s3 = take((x) => x.nameLatin)
  if (s3) qs.push(makeQ('latin', `学名「${s3.nameLatin}」是哪一种？`, s3.nameZh, pickDistinct(namePool(list, s3), 3, rand, [s3.nameZh]), rand, s3,
    `${s3.nameLatin} 就是${s3.nameZh}。学名用拉丁文写成，全世界的博物馆都认这一个名字。`))

  const s4 = take((x) => x.habit)
  if (s4) qs.push(makeQ('habit', `「${clip(s4.habit, 26)}」说的是哪一种？`, s4.nameZh, pickDistinct(namePool(list, s4), 3, rand, [s4.nameZh]), rand, s4,
    `这是${s4.nameZh}：${s4.habit}。`))

  const seriesOf = (x) => (x.seriesIds || []).map((id) => (series || []).find((s) => s.id === id)).filter(Boolean)
  const s5 = (series || []).length >= 4 ? take((x) => seriesOf(x).length === 1) : null
  if (s5) {
    const ch = seriesOf(s5)[0]
    qs.push(makeQ('chapter', `「${s5.nameZh}」收在山海图鉴的哪一章？`, ch.name, pickDistinct(series.map((s) => s.name), 3, rand, [ch.name]), rand, s5,
      `${s5.nameZh}在「${ch.name}」这一章。${ch.blurb || ''}`))
  } else {
    const s6 = take((x) => x.origin)
    if (s6) qs.push(makeQ('origin', `哪一种来自「${clip(s6.origin, 24)}」？`, s6.nameZh, pickDistinct(namePool(list, s6), 3, rand, [s6.nameZh]), rand, s6,
      `${s6.nameZh}的产地：${s6.origin}。`))
  }
  return qs.slice(0, QUIZ_SIZE)
}

/**
 * 记一次答完：分数、最好成绩、连续天数（昨天也答完 → +1，否则从 1 开始；同一天重复记不加）。
 * 只留最近 14 天的明细。
 */
function recordQuiz(state, day, answers, quiz) {
  const s = Object.assign({ results: {}, best: 0, streak: 0, lastDoneDay: null }, state || {})
  const results = Object.assign({}, s.results)
  const score = (quiz || []).reduce((n, q, i) => n + (answers[i] === q.answer ? 1 : 0), 0)
  const already = !!results[day]
  results[day] = { answers: answers.slice(0, QUIZ_SIZE), score }
  Object.keys(results).forEach((k) => { if (Number(k) < day - QUIZ_KEEP_DAYS) delete results[k] })
  let streak = s.streak
  if (!already) streak = s.lastDoneDay === day - 1 ? s.streak + 1 : 1
  return { results, best: Math.max(s.best || 0, score), streak, lastDoneDay: day, score }
}

/** 今天看到的连续天数：断了（最后一次早于昨天）就显示 0 */
function liveStreak(state, now) {
  const s = state || {}
  const day = dayIndex(now)
  if (s.lastDoneDay === day || s.lastDoneDay === day - 1) return s.streak || 0
  return 0
}

/** 分数 → 一句话（不浮夸） */
function scoreLine(score, total) {
  if (score === total) return '全对。这几件你都认得。'
  if (score >= total - 1) return '只差一点，再看一眼解释就记住了。'
  if (score >= Math.ceil(total / 2)) return '答对一半以上，图鉴里还有很多值得翻。'
  return '不要紧，翻图鉴、问博物君，明天再来。'
}

/* ------------------------------ 博物笔记 ------------------------------ */

/** 收藏一条回答：同一段回答不重复；新的在前；最多 50 条 */
function addNote(notes, item, now) {
  const list = Array.isArray(notes) ? notes : []
  const a = String((item && item.a) || '').trim()
  if (!a) return list
  if (list.some((n) => n.a === a)) return list
  const note = { id: `n${(now || Date.now()).toString(36)}${list.length}`, q: String((item && item.q) || '').trim().slice(0, 300), a: a.slice(0, 2000), at: now || Date.now() }
  return [note].concat(list).slice(0, NOTES_MAX)
}

function removeNote(notes, id) {
  return (Array.isArray(notes) ? notes : []).filter((n) => n.id !== id)
}

function hasNote(notes, a) {
  const t = String(a || '').trim()
  return !!t && (Array.isArray(notes) ? notes : []).some((n) => n.a === t)
}

module.exports = {
  QUIZ_SIZE,
  NOTES_MAX,
  dayIndex,
  dayText,
  rng,
  dailySpecies,
  pastDaily,
  dailyCard,
  buildQuiz,
  recordQuiz,
  liveStreak,
  scoreLine,
  addNote,
  removeNote,
  hasNote
}
