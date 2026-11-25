#!/usr/bin/env node
/**
 * test:museum-guide —— 博物君（2026-11-23，蓝图 miniprogram/docs/博物君_AI馆员_蓝图_2026-11-23.md）
 *
 *   A 页面纯函数：历史只带正常问答且 ≤ 6 条 / 问题清洗 / 去处白名单 / 回复映射 / 本机存储 / 未部署识别
 *   B 云函数纯函数：入参清洗 / 回复解析（JSON、代码块、非 JSON 兜底、去处白名单）/ 北京时间切日 / 额度
 *   C 云函数不变量：问题与回答都过内容安全且问题在调模型之前 / 密钥只读环境变量 / 计数集合不存对话内容 / openapi 权限
 *   D 知识：去处 key 两端一致 / 图鉴摘要不过期 / 物种匹配长名优先 / 公益口径与「我的捐赠」同源
 *   E 接线：页面注册 / 「我的」宫格入口与路由 / 新集合三处同步 + serverOnly
 *   F 页面行为：提问成功（追问 / 去处 / 额度 / 本机存储）、云函数未部署 → 「还在布展」
 *
 *   node miniprogram/scripts/test-museum-guide.mjs [--selftest]
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCjsModule } from './lib/cjs-loader.mjs'
import { buildAtlasDigest, OUT as DIGEST } from './build-museum-guide-atlas.mjs'

const MP = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = join(MP, '..')
const P = {
  chat: join(MP, 'subpackages/feature/museum-guide/guideChat.js'),
  page: join(MP, 'subpackages/feature/museum-guide/index.js'),
  wxml: join(MP, 'subpackages/feature/museum-guide/index.wxml'),
  avatar: join(MP, 'utils/guideAvatar.js'),
  cloudrc: join(MP, 'cloudbaserc.json'),
  fn: join(MP, 'cloudfunctions/askMuseumGuide/index.js'),
  knowledge: join(MP, 'cloudfunctions/askMuseumGuide/knowledge.js'),
  persona: join(MP, 'cloudfunctions/askMuseumGuide/persona.js'),
  fnConfig: join(MP, 'cloudfunctions/askMuseumGuide/config.json'),
  appJson: join(MP, 'app.json'),
  userWxml: join(MP, 'pages/user/index.wxml'),
  userJs: join(MP, 'pages/user/index.js'),
  naturalist: join(MP, 'subpackages/feature/museum-guide/naturalist.js'),
  dailyWxml: join(MP, 'subpackages/feature/museum-guide/daily/index.wxml'),
  quizWxml: join(MP, 'subpackages/feature/museum-guide/quiz/index.wxml'),
  quizJs: join(MP, 'subpackages/feature/museum-guide/quiz/index.js'),
  workshop: join(MP, 'subpackages/feature/museum-guide/workshopKit.js'),
  wsJs: join(MP, 'subpackages/feature/museum-guide/workshop/index.js'),
  wsWxml: join(MP, 'subpackages/feature/museum-guide/workshop/index.wxml'),
  wsJson: join(MP, 'subpackages/feature/museum-guide/workshop/index.json'),
  atlasWxml: join(MP, 'subpackages/feature/collection/detail/index.wxml'),
  atlasJs: join(MP, 'subpackages/feature/collection/detail/index.js'),
  idWxml: join(MP, 'subpackages/feature/identify/result/index.wxml'),
  idJs: join(MP, 'subpackages/feature/identify/result/index.js'),
  donation: join(MP, 'subpackages/business/donations/donationCopy.js'),
  cloudJs: join(ROOT, 'admin/src/cloud.js'),
  rule: join(ROOT, 'cloudbase/rules/museum_guide_usage.json'),
  schema: join(ROOT, 'cloudbase/schema/museum_guide_usage.md'),
  sensitive: join(ROOT, 'cloudbase/sensitive-collections.json')
}

let INJECT = null
const transform = (file, src) => {
  if (!INJECT || INJECT.file !== file) return src
  if (src.indexOf(INJECT.find) === -1) throw new Error(`注入锚点失效：${INJECT.name}`)
  return src.replace(INJECT.find, INJECT.replace)
}
const read = (f) => transform(f, readFileSync(f, 'utf8'))

async function runChecks() {
  const fails = []
  const ok = (name, cond) => { if (!cond) fails.push(name) }

  /* ---------------- A 页面纯函数 ---------------- */
  const G = loadCjsModule(P.chat, { transform })
  const msgs = [
    G.makeMessage('guide', G.WELCOME, { isWelcome: true }),
    ...Array.from({ length: 5 }, (_, i) => [G.makeMessage('user', 'q' + i), G.makeMessage('guide', 'a' + i)]).flat(),
    G.makeMessage('guide', '出错了', { isError: true })
  ]
  const h = G.historyForRequest(msgs)
  ok('A1 历史只带正常问答（无欢迎语 / 错误气泡），最近 6 条，guide → assistant',
    h.length === 6 && h[0].content === 'q2' && h[5].content === 'a4' && h[5].role === 'assistant' && h.every((x) => x.content !== G.WELCOME && x.content !== '出错了'))
  ok('A2 问题清洗：压空白、空与超长报错', G.cleanQuestion('  蝴蝶  为什么 ').question === '蝴蝶 为什么' && !!G.cleanQuestion('   ').error && !!G.cleanQuestion('x'.repeat(G.QUESTION_MAX + 1)).error)
  const btns = G.actionButtons(['atlas', 'evil', 'atlas', 'shop', 'care'])
  ok('A3 去处只认白名单、去重、最多 2 个；tab 页标 tab', btns.map((b) => b.key).join() === 'atlas,shop' && btns[1].tab === true && btns[0].tab === false)
  const good = G.replyToMessage({ success: true, answer: '答', followUps: ['甲', '乙', '丙', '丁'], actions: ['care'], quota: { left: 9, cap: 30 } })
  const bad = G.replyToMessage({ success: false, error_type: 'quota', quota: { left: 0, cap: 30 } })
  ok('A4 回复映射：成功带追问(≤3)/去处/额度；失败成错误气泡并用对应文案',
    good.message.text === '答' && good.message.followUps.length === 3 && good.message.actions[0].key === 'care' && good.quota.left === 9 &&
    bad.message.isError === true && bad.message.text === G.ERROR_COPY.quota && bad.quota.left === 0)
  const stored = G.toStored(msgs.concat(good.message, G.makeMessage('guide', '', { pending: true })))
  ok('A5 本机存储：去掉欢迎语与「翻书中」、只最后一条留追问', !stored.some((m) => m.isWelcome || m.pending) && stored[stored.length - 1].followUps.length === 3 &&
    stored.slice(0, -1).every((m) => !(m.followUps && m.followUps.length)) && stored.length <= G.STORE_MAX)
  ok('A6 云函数未部署识别', G.isNotDeployed({ errMsg: 'cloud.callFunction:fail -501000 FUNCTION_NOT_FOUND' }) && !G.isNotDeployed({ errMsg: 'timeout' }))
  const sl = G.speciesLinks([{ no: '001', zh: '大蓝闪蝶' }, { no: '../x', zh: '坏' }, { no: '024', zh: '尖翅蓝闪蝶' }, { no: '030', zh: '多' }])
  ok('A8 图鉴物种链接：编号只认三位数字、最多 2 个', sl.map((x) => x.no).join() === '001,024')
  ok('A9 入口问题：解码、清洗；坏编码 / 空 / 超长按无', G.entryQuestion({ q: encodeURIComponent(' 大蓝闪蝶 有什么 ') }) === '大蓝闪蝶 有什么' &&
    G.entryQuestion({ q: '%E0%A4%A' }) === '' && G.entryQuestion({}) === '' && G.entryQuestion({ q: encodeURIComponent('x'.repeat(G.QUESTION_MAX + 1)) }) === '')
  const d0 = Date.UTC(2026, 10, 23, 4); const d1 = d0 + 86400000
  const st0 = G.startersFor(d0); const st1 = G.startersFor(d1)
  const pools = ['brand', 'giving', 'nature', 'care', 'visit']
  ok('A10 开场问题：每类一个共 5 个、同一天固定、隔天会换', st0.length === 5 && st0.every((q, i) => G.STARTER_POOL[pools[i]].includes(q)) &&
    G.startersFor(d0 + 3600000).join() === st0.join() && st1.join() !== st0.join())
  const rs = G.revealSteps(300); const rs1 = G.revealSteps(5)
  ok('A11 逐字显示：单调递增、最后一拍写完、长回答也在 1.6 秒内（≤ 40 拍）、短回答不磨', rs[rs.length - 1] === 300 && rs.every((v, i) => i === 0 || v > rs[i - 1]) &&
    rs.length <= 40 && rs1[rs1.length - 1] === 5 && rs1.length <= 2 && G.revealSteps(0).length === 0)
  ok('A12 回答去 Markdown：粗体 / 标题号 / 代码号去掉、列表换「· 」', G.plainAnswer('## 结构色\n**蓝**来自`鳞片`\n- 一\n* 二\n\n\n\n尾') === '结构色\n蓝来自鳞片\n· 一\n· 二\n\n尾')
  const st = G.toStored([G.makeMessage('guide', '整段', { shown: '整', revealing: true })])
  ok('A13 存储不带逐字中间态、读回时旧记录也去 Markdown', st[0].text === '整段' && !('shown' in st[0]) && !('revealing' in st[0]) &&
    G.fromStored([{ role: 'guide', text: '**粗**', shown: 'x', revealing: true }])[0].text === '粗' && !('revealing' in G.fromStored([{ role: 'guide', text: 'a', revealing: true }])[0]))
  const sv1 = G.statusView({ success: true, enabled: false, msg: '闭馆了', quota: { left: 3, cap: 12 } })
  const sv2 = G.statusView(null)
  ok('A14 进页状态：闭馆带说明与额度；读不到当开着（不把人挡在门外）', sv1.closed === true && sv1.closedText === '闭馆了' && sv1.quota.cap === 12 && sv2.closed === false && sv2.quota === null)
  const withLog = G.replyToMessage({ success: true, answer: '答', logId: 'L9' })
  const badLog = G.replyToMessage({ success: true, answer: '答', logId: { $ne: 1 } })
  ok('A15 回答带日志号（只收 ≤64 字的字符串）', withLog.message.logId === 'L9' && badLog.message.logId === '')
  ok('A7 额度文案', G.quotaText({ left: 3, cap: 30 }) === '今日还可问 3 次' && G.quotaText({ left: 0, cap: 30 }) === '今日次数已用完' && G.quotaText(null) === '')

  /* ---------------- B 云函数纯函数 ---------------- */
  const secCalls = []
  let modelCalls = 0
  // 按集合分的内存库：config / usage 文档、日志 add 记下来（2026-11-23 超管开关与监测）
  const dbStore = { museum_guide_config: {}, museum_guide_usage: {} }
  const logs = []
  let usageWrites = 0
  const fakeDb = {
    collection: (name) => ({
      doc: (id) => ({
        get: async () => { const d = (dbStore[name] || {})[id]; if (!d) throw new Error('document not exist'); return { data: d } },
        update: async ({ data }) => { usageWrites++; const d = dbStore[name] && dbStore[name][id]; if (d && name === 'museum_guide_logs') Object.assign(d, data); return { stats: { updated: d ? 1 : 0 } } },
        set: async ({ data }) => { usageWrites++; (dbStore[name] = dbStore[name] || {})[id] = data }
      }),
      add: async ({ data }) => { if (name === 'museum_guide_logs') { logs.push(data); (dbStore[name] = dbStore[name] || {})['l' + logs.length] = data } return { _id: 'l' + logs.length } }
    }),
    command: { inc: (n) => n },
    serverDate: () => 0
  }
  const fn = loadCjsModule(P.fn, {
    transform,
    stubs: {
      'wx-server-sdk': { init() {}, DYNAMIC_CURRENT_ENV: 'x', database: () => fakeDb, getWXContext: () => ({ OPENID: 'o1' }) },
      https: { request: () => { modelCalls++; throw new Error('no network in test') } },
      './contentSecurity': { checkText: async (o, text) => { secCalls.push(text); return /炸药/.test(text) ? { ok: false, reason: 'risky' } : { ok: true } } }
    },
    globals: { process: { env: {} }, console: { warn() {}, log() {}, error() {} }, Buffer }
  })
  const T = fn._test
  const si = T.sanitizeInput({ question: '  蝴蝶 ', history: [...Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(700) })), { role: 'system', content: '越权' }] })
  ok('B1 入参清洗：丢 system 角色、最近 6 条、每条截 600、问题去空白', si.question === '蝴蝶' && si.history.length === 6 && si.history.every((x) => x.role !== 'system' && x.content.length === 600) &&
    !!T.sanitizeInput({ question: '' }).error && !!T.sanitizeInput({ question: 'x'.repeat(T.QUESTION_MAX + 1) }).error)
  const r1 = T.parseReply('```json\n{"answer":"答","follow_ups":["一","二","三","四"],"actions":["atlas","hack","atlas"]}\n```')
  const r2 = T.parseReply('就是一段话')
  ok('B2 回复解析：剥代码块、追问 ≤ 3、去处白名单去重；非 JSON 整段当回答', r1.answer === '答' && r1.followUps.length === 3 && r1.actions.join() === 'atlas' && r2.answer === '就是一段话' && !r2.actions.length)
  // 2026-11-23 真机截图：模型没按 JSON 回，正文后面另起几行写 follow_ups / actions，原样露在气泡里
  const leak = '萤火虫发光是生物荧光。\n\nfollow_ups: ["萤火虫的光有几种颜色？", "为什么不发热？"]\nactions: ["atlas", "hack"]'
  const r3 = T.parseReply(leak)
  ok('B6 非 JSON 回答：摘掉 follow_ups / actions 字段行，条目捞回（去处仍过白名单）',
    r3.answer === '萤火虫发光是生物荧光。' && JSON.stringify(r3.followUps) === JSON.stringify(['萤火虫的光有几种颜色？', '为什么不发热？']) && JSON.stringify(r3.actions) === JSON.stringify(['atlas']))
  ok('B7b 模型把 content / answer 给成数字 → 不当回答、也不把 JSON 原文当正文',
    T.extractText({ output: { choices: [{ message: { content: -1.5642379800000002 } }] } }) === '' &&
    T.parseReply('{"answer": -1.5642379800000002, "follow_ups": []}').answer === '' &&
    T.extractText({ output: { choices: [{ message: { content: '好' } }] } }) === '好' && T.extractText({ output: { text: '好' } }) === '好')
  ok('B7 纯数字不当作回答（真机：萤火虫为什么发光 → -1.5642379800000002）',
    T.parseReply('-1.5642379800000002').answer === '' && T.parseReply('42').answer === '' && T.parseReply('-1.5e-7').answer === '' &&
    T.parseReply('萤火虫发光靠荧光素酶。').answer !== '' && T.usableAnswer('萤火虫发光靠荧光素酶。') === true && T.usableAnswer('-1.56') === false)
  const r4 = T.parseReply('数组 [1,2] 写在正文里不受影响。\n"追问"：[“它吃什么？”]')
  ok('B6 中文键名 / 全角冒号 / 中文引号也认；正文里的方括号不误伤', r4.answer === '数组 [1,2] 写在正文里不受影响。' && JSON.stringify(r4.followUps) === JSON.stringify(['它吃什么？']))
  ok('B6 提示词：除拉丁学名外不夹英文单词', /除拉丁学名外不要夹带英文单词/.test(read(P.persona)))
  const old = G.replyToMessage({ success: true, answer: leak })
  ok('B6 页面兜底（旧版云函数）：气泡不露字段行、追问还原成按钮、去处过白名单',
    old.message.text === '萤火虫发光是生物荧光。' && old.message.followUps.length === 2 && old.message.actions.map((a) => a.key).join() === 'atlas' &&
    G.plainAnswer('旧记录\nactions: ["atlas"]') === '旧记录')
  ok('B5 云端回答也去 Markdown（与页面同口径）', T.parseReply('{"answer":"**蓝**\\n- 甲"}').answer === '蓝\n· 甲' && T.plainAnswer('### 题') === '题')
  ok('B3 北京时间切日（UTC 16:30 = 次日 00:30）', T.dayKey(Date.UTC(2026, 10, 23, 16, 30)) === '20261124' && T.dayKey(Date.UTC(2026, 10, 23, 15, 59)) === '20261123')
  ok('B4 额度：环境变量可改、非法回落 30；模型链环境变量在前且去重', T.dailyLimit('50') === 50 && T.dailyLimit('x') === 30 && T.modelChain('qwen-max, qwen-plus').join() === 'qwen-max,qwen-plus,qwen-flash')

  /* ---------------- C 云函数不变量（行为 + 源码） ---------------- */
  const risky = await fn.main({ question: '怎么做炸药' })
  ok('C1 risky 问题：拒答且不调模型', risky.success === false && risky.error_type === 'risky' && modelCalls === 0)
  const noKey = await fn.main({ question: '大蓝闪蝶为什么是蓝色的' })
  ok('C2 未配密钥：ai_service，不调模型', noKey.success === false && noKey.error_type === 'ai_service' && modelCalls === 0)
  const src = read(P.fn)
  const iSec = src.indexOf('await checkText(OPENID, input.question')
  const iModel = src.indexOf('await askModel(')
  ok('C3 问题在调模型之前过内容安全；回答也过一次，有风险换固定回复', iSec > 0 && iModel > iSec && /await checkText\(OPENID, reply\.answer/.test(src) && /reply = \{ answer: SAFE_ANSWER/.test(src))
  ok('C4 密钥只从环境变量读、源码无明文 key', /process\.env\.DASHSCOPE_API_KEY/.test(src) && !/sk-[A-Za-z0-9]{12,}/.test(src + read(P.knowledge) + read(P.persona)))
  const setBlock = (src.match(/\.set\(\{ data: \{([^}]*)\}/) || [])[1] || ''
  const LOG_KEYS = 'a_len,actions,created_at,day,duration_ms,entry,history_len,model,openid,q_len,species,status'
  const fakeLog = T.buildLog({ openid: 'o1', dayText: '2026-11-23', status: 'ok', question: '原文问题', answer: '原文回答', species: [{ no: '001', zh: '大蓝闪蝶' }], actions: ['atlas'], qLen: 4, aLen: 4, entry: 'evil', now: 1 })
  ok('C5 计数集合只记 openid / day / count / updatedAt；运营日志字段白名单、不存问题与回答原文、入口只认白名单',
    /openid/.test(setBlock) && /count/.test(setBlock) && !/question|answer|history|content/.test(setBlock) &&
    Object.keys(fakeLog).sort().join() === LOG_KEYS && !/原文/.test(JSON.stringify(fakeLog)) && fakeLog.entry === 'direct' &&
    logs.length === 2 && logs.every((l) => Object.keys(l).sort().join() === LOG_KEYS && !/炸药|蓝色/.test(JSON.stringify(l))) &&
    logs[0].status === 'risky' && logs[1].status === 'ai_service')
  // C7 进页状态：不计次、不记日志；C8 闭馆：提问不过内容安全、不调模型、记 off；额度取超管配置
  const logN = logs.length; const uw = usageWrites; const secN = secCalls.length
  const stA = await fn.main({ action: 'status' })
  ok('C7 status：开着、给今日额度；不计次、不记日志', stA.success && stA.enabled === true && stA.quota.cap === 30 && stA.quota.left === 30 && logs.length === logN && usageWrites === uw)
  dbStore.museum_guide_config.main = { enabled: false, dailyLimit: 12 }
  const off = await fn.main({ question: '蝴蝶是什么', from: 'atlas' })
  const stB = await fn.main({ action: 'status' })
  ok('C8 闭馆：error_type off、不过内容安全不调模型、日志记 off 与入口；status 报闭馆且额度取超管配置',
    off.success === false && off.error_type === 'off' && secCalls.length === secN && modelCalls === 0 && logs[logs.length - 1].status === 'off' && logs[logs.length - 1].entry === 'atlas' &&
    stB.enabled === false && stB.quota.cap === 12)
  dbStore.museum_guide_config.main = undefined
  // C10 回答反馈：只认本人、只记一次、只认两种票；日志号只随真正的回答返回
  dbStore.museum_guide_logs = Object.assign(dbStore.museum_guide_logs || {}, { L1: { openid: 'o1', status: 'ok' }, L2: { openid: 'someone-else', status: 'ok' } })
  const fb1 = await fn.main({ action: 'feedback', logId: 'L1', vote: 'up' })
  const fb2 = await fn.main({ action: 'feedback', logId: 'L1', vote: 'down' })
  const fb3 = await fn.main({ action: 'feedback', logId: 'L2', vote: 'down' })
  const fb4 = await fn.main({ action: 'feedback', logId: 'L1', vote: 'meh' })
  ok('C10 反馈：本人一次有效、重复不改票、别人的回答与非法票拒绝；只有成功回答才带日志号',
    fb1.success && dbStore.museum_guide_logs.L1.vote === 'up' && fb2.already === true && dbStore.museum_guide_logs.L1.vote === 'up' &&
    fb3.success === false && !dbStore.museum_guide_logs.L2.vote && fb4.success === false &&
    /if \(out && out\.success && logId\) out\.logId = logId/.test(src))
  // C11 物种匹配（2026-11-23 修）：问题里点名的优先；没点名才看上一个访客问题；不看博物君自己的回答
  const sf1 = T.speciesFor('大蓝闪蝶有什么有意思的地方？', [{ role: 'user', content: '凤蝶为什么那么大' }, { role: 'assistant', content: '巴黎翠凤蝶、天堂凤蝶都属于凤蝶科……' }])
  const sf2 = T.speciesFor('它现在还活着吗？', [{ role: 'user', content: '鹦鹉螺是活化石吗' }, { role: 'assistant', content: '是的，和大蓝闪蝶不同……' }])
  ok('C11 物种匹配：问题点名的优先（不被上一条回答里的长名字顶掉）；追问用上一个访客问题、不看回答', sf1.length >= 1 && sf1[0].zh === '大蓝闪蝶' && !sf1.some((x) => /凤蝶/.test(x.zh)) &&
    sf2.length === 1 && sf2[0].zh === '鹦鹉螺')
  ok('C9 生效配置：额度 5–200 才认、否则回落环境变量；读不到配置 = 开启', T.effectiveConfig({ dailyLimit: 3 }, '40').cap === 40 && T.effectiveConfig({ dailyLimit: 50 }, '40').cap === 50 &&
    T.effectiveConfig(null, '').enabled === true && T.effectiveConfig({ enabled: false }, '').enabled === false)
  ok('C6 config.json 声明 msgSecCheck 权限', /security\.msgSecCheck/.test(readFileSync(P.fnConfig, 'utf8')))

  /* ---------------- D 知识 ---------------- */
  const K = loadCjsModule(P.knowledge, { transform })
  ok('D1 去处 key：页面白名单 = 云函数 PLACES', Object.keys(G.ACTIONS).sort().join() === K.PLACE_KEYS.slice().sort().join())
  ok('D2 图鉴摘要与 manageAtlas/catalog.js 一致（过期就重跑 build-museum-guide-atlas.mjs）', existsSync(DIGEST) && readFileSync(DIGEST, 'utf8') === buildAtlasDigest())
  const m = K.matchSpecies('大蓝闪蝶为什么是蓝色的？', 3)
  const m2 = K.matchSpecies('樱花押花怎么保存？', 3)
  ok('D3 物种匹配：命中大蓝闪蝶；长名优先（「樱花押花」压过只命中「押花」的）；无关问题不命中',
    m.length >= 1 && m[0].zh === '大蓝闪蝶' && m2[0].zh === '樱花押花' && K.matchSpecies('今天天气怎么样', 3).length === 0)
  const kt = K.knowledgeText()
  const dc = loadCjsModule(P.donation, {})
  ok('D4 公益口径与「我的捐赠」同源：基金名 + 四个去向', K.FUND_NAME === dc.FUND_NAME && dc.DIRECTIONS.every((d) => kt.indexOf(d.title) >= 0) && /1%/.test(kt))
  const persona = read(P.persona)
  ok('D5 人设边界：不编造馆方事实 / 个人业务指向订单与客服 / 野生动植物合法来源 / 只输出 JSON', /不要编/.test(persona) && /我的订单/.test(persona) && /合法来源/.test(persona) && /只输出一个 JSON/.test(persona))

  /* ---------------- E 接线 ---------------- */
  const app = JSON.parse(readFileSync(P.appJson, 'utf8'))
  const feature = app.subpackages.find((s) => /subpackages\/feature\/?$/.test(s.root))
  ok('E1 页面注册在 feature 分包', !!feature && feature.pages.includes('museum-guide/index'))
  const userWxml = read(P.userWxml)
  ok('E2 「我的 · 馆藏与内容」有博物君入口（用「科学家」图标）且路由到页面',
    /data-path="museumGuide"[\s\S]{0,200}<text class="svc-cn">博物君<\/text>/.test(userWxml) &&
    /data-path="museumGuide"[^>]*>\s*<image class="m-img" src="\/assets\/icons\/museum-guide\.png"/.test(userWxml) &&
    existsSync(join(MP, 'assets/icons/museum-guide.png')) &&
    /case 'museumGuide':\s*\n\s*go\('\/subpackages\/feature\/museum-guide\/index/.test(read(P.userJs)))
  const rule = JSON.parse(readFileSync(P.rule, 'utf8'))
  const sens = JSON.parse(readFileSync(P.sensitive, 'utf8'))
  ok('E3 集合 museum_guide_usage 三处同步 + serverOnly', rule.read === false && rule.write === false && existsSync(P.schema) &&
    /MUSEUM_GUIDE_USAGE: 'museum_guide_usage'/.test(readFileSync(P.cloudJs, 'utf8')) && sens.serverOnly.includes('museum_guide_usage') && /'museum_guide_usage'/.test(src))
  const atlasWxml = read(P.atlasWxml)
  const lockedElse = atlasWxml.indexOf('<block wx:else>', atlasWxml.indexOf('class="collect-dock dual" wx:if="{{locked}}"'))
  const askAt = atlasWxml.indexOf('bindtap="askGuide"')
  ok('E5 入口：图鉴页「问问博物君」只在已翻开分支、带名自动发问；AI 鉴定结果页识别出物种才出',
    lockedElse > 0 && askAt > lockedElse && /if \(this\.data\.locked \|\| !card\.nameZh\) return/.test(read(P.atlasJs)) && /museum-guide\/index\?from=atlas&auto=1&q=\$\{encodeURIComponent\(q\)\}/.test(read(P.atlasJs)) &&
    /<view class="tool" wx:if="\{\{guideOpen && speciesInfo\.species_name_zh && speciesInfo\.is_specimen !== false\}\}" bindtap="onAskGuide"/.test(read(P.idWxml)) && /museum-guide\/index\?from=identify&auto=1/.test(read(P.idJs)) &&
    /wx:if="\{\{guideOpen\}\}"[^>]*bindtap="askGuide"/.test(atlasWxml) && /museumGuideOpen !== false/.test(read(P.atlasJs)))
  const avatar = loadCjsModule(P.avatar).GUIDE_AVATAR || ''
  const avatarSvg = decodeURIComponent(avatar.split(',')[1] || '')
  ok('E6 博物君头像 = 附件「科学家」icon（方印内是内联 svg，两处入口都换，不是「博」字）',
    /<view class="mg-seal"[^>]*><image class="mg-seal-icon" src="\{\{guideAvatar\}\}" mode="aspectFit"><\/image><\/view>/.test(read(P.wxml)) &&
    /<image class="ask-guide-seal-icon" src="\{\{guideAvatar\}\}" mode="aspectFit"/.test(read(P.atlasWxml)) &&
    /^data:image\/svg\+xml/.test(avatar) && avatarSvg.includes('viewBox="0 0 1024 1024"') && avatarSvg.includes('fill="#F3E7D3"') &&
    !/<view class="mg-seal"[^>]*><text>博<\/text>/.test(read(P.wxml)))
  ok('E7 askMuseumGuide 已登记 cloudbaserc（否则 tcb / deploy-drifted 永远不会部署它）',
    /"name":\s*"askMuseumGuide"/.test(read(P.cloudrc)))
  ok('E4 页脚写明 AI 生成仅供参考、对话只存本机', /由 AI 生成，仅供参考/.test(read(P.wxml)) && /只存在这台手机上/.test(read(P.wxml)))

  /* ---------------- F 页面行为 ---------------- */
  let cfg = null
  const store = {}
  let reply = { result: { success: true, answer: '因为结构色。', followUps: ['还有哪些结构色？'], actions: ['atlas'], quota: { left: 29, cap: 30 } } }
  const wxStub = {
    getStorageSync: (k) => store[k], setStorageSync: (k, v) => { store[k] = v }, removeStorageSync: (k) => { delete store[k] },
    cloud: { callFunction: async () => { if (reply instanceof Error) throw reply; return reply } },
    navigateTo() {}, switchTab() {}
  }
  loadCjsModule(P.page, {
    transform,
    stubs: { '../../../utils/appModal': { openAppModal() {} } },
    globals: { getApp: () => ({ globalData: { openid: 'o1' } }), Page: (c) => { cfg = c }, wx: wxStub }
  })
  const page = Object.assign({}, cfg, { data: JSON.parse(JSON.stringify(cfg.data)), setData(p, cb) { Object.assign(this.data, p); if (cb) cb() } })
  page.onLoad({})
  ok('F1 首屏：欢迎语 + 开场问题', page.data.messages.length === 1 && page.data.messages[0].isWelcome && page.data.hasAsked === false && page.data.starters.length === 5)
  await page.ask('大蓝闪蝶为什么是蓝色的')
  const last = page.data.messages[page.data.messages.length - 1]
  ok('F2 提问成功：访客 + 博物君两条、带追问与去处、额度文案、存进本机', page.data.messages.length === 3 && last.text === '因为结构色。' && last.followUps.length === 1 &&
    last.actions[0].key === 'atlas' && page.data.quotaText === '今日还可问 29 次' && page.data.sending === false && Array.isArray(store[G.storeKey('o1')]) && store[G.storeKey('o1')].length === 2)
  reply = Object.assign(new Error('cloud.callFunction:fail -501000 FUNCTION_NOT_FOUND'), { errCode: -501000 })
  await page.ask('第二个问题')
  const last2 = page.data.messages[page.data.messages.length - 1]
  ok('F3 云函数未部署 → 「还在布展」错误气泡，不进下一次历史；上一条的追问收起', last2.isError && last2.text === G.ERROR_COPY.not_deployed &&
    !G.historyForRequest(page.data.messages).some((x) => x.content === G.ERROR_COPY.not_deployed) && !page.data.messages[2].followUps.length)
  // F5 逐字显示：新回答先 revealing，点气泡立刻写完；写完前不出追问 / 去处 / 图鉴链接
  const lastIdx = page.data.messages.length - 1
  const pg = Object.assign({}, cfg, { data: JSON.parse(JSON.stringify(cfg.data)), setData(p, cb) { for (const k of Object.keys(p)) { const m = k.match(/^messages\[(\d+)\]\.(\w+)$/); if (m) this.data.messages[+m[1]][m[2]] = p[k]; else this.data[k] = p[k] } if (cb) cb() } })
  reply = { result: { success: true, answer: '一段比较长的回答，用来看逐字显示。', followUps: ['追问'], quota: { left: 27, cap: 30 } } }
  wxStub.cloud.callFunction = async () => reply
  pg.onLoad({})
  await pg.ask('问')
  const li = pg.data.messages.length - 1
  const w1 = pg.data.messages[li].revealing === true && pg.data.messages[li].shown !== pg.data.messages[li].text
  pg.onTapBubble({ currentTarget: { dataset: { index: li } } })
  const w2 = pg.data.messages[li].revealing === false && pg.data.messages[li].shown === pg.data.messages[li].text
  pg.onUnload()
  const mgWxml = read(P.wxml)
  ok('F5 逐字显示：新回答先写、点气泡写完；写完前追问 / 去处 / 图鉴链接不出', w1 && w2 && lastIdx >= 0 &&
    /class="mg-strip-box" wx:if="\{\{\(item\.species\.length \|\| item\.actions\.length\) && !item\.revealing\}\}"/.test(mgWxml) &&
    /class="mg-strip-box" wx:if="\{\{item\.followUps\.length && !sending && !item\.revealing\}\}"/.test(mgWxml) &&
    /class="mg-fb" wx:if="\{\{!item\.isError && !item\.isWelcome && !item\.pending && !item\.revealing && item\.text\}\}"/.test(mgWxml))
  // F8 回答区重排（2026-11-23 产品负责人截图）：签脚贴在回答底边；延伸 / 接着问各一行横滑（不再竖着叠一屏按钮）
  const mgWxss = readFileSync(P.wxml.replace(/\.wxml$/, '.wxss'), 'utf8')
  // 2026-11-25 产品负责人：下针动画太快（40ms×4% 一趟 1 秒）→ 现在约 2.4 秒一趟 + 两端缓动停顿
  const wsJs = read(P.wsJs)
  const GRAPHIC_HEX_INK = '#1B1916'
  // 2026-11-25 产品负责人：作品卡要有图形展示（内联 SVG，衬底取 backdrop、外框取 craft）
  const WK = loadCjsModule(P.workshop)
  const demoWork = WK.buildWork({ no: '042', nameZh: '大帛斑蝶', nameLatin: 'Idea leuconoe' }, [{ score: 20 }, { score: 20 }, { score: 14 }, { score: 13 }, { score: 20 }], 'frame', 'ink', Date.now())
  const gFrame = decodeURIComponent(WK.workGraphic(demoWork).split(',')[1] || '')
  const gCloche = decodeURIComponent(WK.workGraphic(Object.assign({}, demoWork, { craft: WK.CRAFTS.find((c) => c.key === 'cloche') })).split(',')[1] || '')
  ok('E10 作品卡图形：内联 SVG（无位图）、衬底随 backdrop、外框随 craft、始终有一只蝶',
    /^data:image\/svg\+xml/.test(WK.workGraphic(demoWork)) && gFrame.includes(GRAPHIC_HEX_INK) &&
    gFrame.includes('<rect x="26" y="22"') && gCloche.includes('<rect x="46"') &&
    gFrame.includes('<ellipse') && gFrame !== gCloche &&
    /class="ws-work-graphic"/.test(read(P.wsWxml)) && /workGraphic = W\.workGraphic\(work\)/.test(read(P.wsJs)) && /workGraphic, work \}/.test(read(P.wsJs)))
  ok('E9 下针动画够慢：一趟 ≥ 2 秒，且用缓动（两端放慢），不再是一秒扫一个来回',
    /TICK_MS = 4[0-9]/.test(wsJs) && /TICKS_PER_PASS = 50/.test(wsJs) && /Math\.cos\(Math\.PI \* tri\)/.test(wsJs) &&
    !/pos \+= dir \* 4/.test(wsJs))
  ok('E8 底部输入条抬到安全区之上（真机曾被 Home 指示条遮住）',
    /\.mg-bar \{[^}]*padding-bottom: calc\(20rpx \+ env\(safe-area-inset-bottom/.test(mgWxss))
  const strips = (mgWxml.match(/<scroll-view class="mg-strip" scroll-x/g) || []).length
  ok('F8 回答区：签脚贴底（回答签底角取直 + 签脚同色纸面）；延伸与接着问各一行横滑、单行不换行',
    strips === 3 && /\.mg-bubble\.is-guide\.has-foot \{[^}]*border-bottom-left-radius: 0;/.test(mgWxss) && /\.mg-fb \{[^}]*background: #E6DBC4;/.test(mgWxss) &&
    /\.mg-strip \{[^}]*white-space: nowrap;/.test(mgWxss) && /\.mg-strip-row \{[^}]*display: inline-flex;/.test(mgWxss) && !/class="mg-follow"|class="mg-species"/.test(mgWxml))
  // F10 第六轮（2026-11-23）：回答分段 + 学名斜体；「馆里有这件」只读馆藏、查不到不出、不进存储；JSON 模式降级
  const rp = G.richParas('大蓝闪蝶（Morpho menelaus）分布于南美。\n\n它的蓝来自 Morpho 鳞片。')
  ok('F10 回答分段：空行分段、拉丁双名单独成段文字、单个英文词不当学名',
    rp.length === 2 && rp[0].segs.map((x) => x.latin).join() === 'false,true,false' && rp[0].segs[1].t === 'Morpho menelaus' && rp[1].segs.length === 1 && !rp[1].segs[0].latin)
  ok('F10 馆藏查询：只用第一种物种中文名，只要商品；没有物种不查',
    JSON.stringify(G.goodsQuery([{ no: '001', zh: '大蓝闪蝶' }, { no: '024', zh: '尖翅蓝闪蝶' }])) === JSON.stringify({ keyword: '大蓝闪蝶', contentLimit: 0, productLimit: 6 }) && G.goodsQuery([]) === null)
  const gc = G.goodsCards([{ _id: 'a', title: '甲', price: 10, soldOut: true }, { _id: 'b', title: '乙', price: 20, displayImage: 'u' }, { _id: 'b', title: '乙' }, { _id: 'c' }, { _id: 'd', title: '丁' }, { _id: 'e', title: '戊' }], (u) => 'T' + u)
  ok('F10 馆藏小卡：去重、无名丢掉、有货在前、最多 3 件、无图不拼坏地址',
    gc.map((x) => x.id).join() === 'b,d,e' && gc[0].image === 'Tu' && gc[1].image === '' && gc[0].price === '¥20' && G.GOODS_MAX === 3)
  const stored10 = G.toStored([G.makeMessage('guide', '答', { paras: [{ key: 'p0', segs: [] }], goods: [{ id: 'x' }] })])
  const back = G.fromStored([{ role: 'guide', text: '甲\n\n乙', goods: [{ id: 'x' }] }])
  ok('F10 分段与馆藏推荐不进本机存储；读回时重算分段、不带推荐',
    !('paras' in stored10[0]) && !('goods' in stored10[0]) && back[0].paras.length === 2 && !('goods' in back[0]))
  ok('F10 页面：写完才换分段版、馆藏推荐在写完后只读既有接口、点卡进详情',
    /wx:if="\{\{!item\.revealing && item\.paras && item\.paras\.length\}\}"/.test(mgWxml) && /class="\{\{seg\.latin \? 'mg-latin' : ''\}\}"/.test(mgWxml) &&
    /class="mg-goods" wx:if="\{\{item\.goods && item\.goods\.length && !item\.revealing\}\}"/.test(mgWxml) &&
    /this\.loadGoods\(index\)/.test(read(P.page)) && /name: 'getEncyclopediaFeed', data: q/.test(read(P.page)) && /\/subpackages\/feature\/detail\/index\?id=/.test(read(P.page)))
  ok('F10 推荐回来时这条回答已换掉就不贴（防串到别的回答上）', /if \(!goods\.length \|\| !cur \|\| cur\.id !== msg\.id\) return/.test(read(P.page)))
  ok('F10 云端 JSON 模式：带 response_format，参数不被接受（400）时同模型去掉再试',
    JSON.stringify(T.modelParams(true).response_format) === JSON.stringify({ type: 'json_object' }) && !('response_format' in T.modelParams(false)) &&
    /for \(const jsonMode of \[true, false\]\)/.test(src) && /if \(!\(jsonMode && e\.statusCode === 400\)\) break/.test(src))
  // F9 页面优化（2026-11-23）：开场问题卡两列带门类、科普置顶；问过之后卷首收紧；往上翻远了出「回到最新」，滚动时状态不变不 setData
  const cards = G.starterCards(Date.UTC(2026, 10, 23, 4))
  const pj = Object.assign({}, cfg, { data: JSON.parse(JSON.stringify(cfg.data)), setData(p, cb) { this._sets = (this._sets || 0) + 1; Object.assign(this.data, p); if (cb) cb() } })
  pj._winH = 700
  pj.onScroll({ detail: { scrollTop: 0, scrollHeight: 3000 } })
  const s1 = pj.data.showJump; const n1 = pj._sets
  pj.onScroll({ detail: { scrollTop: 10, scrollHeight: 3000 } })
  const n2 = pj._sets
  pj.onScroll({ detail: { scrollTop: 2250, scrollHeight: 3000 } })
  const s3 = pj.data.showJump
  ok('F9 开场卡五类各一、科普置顶；问过之后说明行收起；「回到最新」离底一屏以上才出、状态不变不重复 setData',
    cards.length === 5 && cards[0].key === 'nature' && new Set(cards.map((c) => c.kind)).size === 5 && cards.every((c) => c.q) &&
    s1 === true && n2 === n1 && s3 === false && /<text class="mg-desc" wx:if="\{\{!hasAsked\}\}">/.test(mgWxml) && /bindscroll="onScroll"/.test(mgWxml) &&
    /class="mg-jump[^"]*" wx:if="\{\{showJump\}\}" bindtap="onJump"/.test(mgWxml))
  // F6 闭馆：进页 status 报闭馆 → 输入条与开场问题收起，ask 不发云调用
  let askCalls = 0
  wxStub.cloud.callFunction = async (o) => { if (o && o.data && o.data.action === 'status') return { result: { success: true, enabled: false, msg: '闭馆整理中', quota: { left: 30, cap: 30 } } }; askCalls++; return reply }
  const pc = Object.assign({}, cfg, { data: JSON.parse(JSON.stringify(cfg.data)), setData(p, cb) { Object.assign(this.data, p); if (cb) cb() } })
  pc.onLoad({})
  await new Promise((r) => setTimeout(r, 0))
  await pc.ask('还能问吗')
  const mgW = read(P.wxml)
  ok('F6 闭馆：页面收起输入条与开场问题、提问不发云调用', pc.data.closed === true && pc.data.closedText === '闭馆整理中' && askCalls === 0 &&
    /<view class="mg-bar safe-area" wx:if="\{\{!closed\}\}">/.test(mgW) && /class="mg-starters" wx:if="\{\{!hasAsked && !closed\}\}"/.test(mgW))
  // F7 反馈：投一次就记在本机、只发一次；没有日志号的回答不出票（只留复制）
  let fbCalls = 0
  wxStub.cloud.callFunction = async (o) => { if (o && o.data && o.data.action === 'feedback') fbCalls++; return { result: { success: true } } }
  const pv = Object.assign({}, cfg, { data: JSON.parse(JSON.stringify(cfg.data)), setData(p, cb) { for (const k of Object.keys(p)) { const m = k.match(/^messages\[(\d+)\]\.(\w+)$/); if (m) this.data.messages[+m[1]][m[2]] = p[k]; else this.data[k] = p[k] } if (cb) cb() } })
  pv.onLoad({})
  pv.setData({ messages: pv.data.messages.concat(G.makeMessage('guide', '答', { logId: 'L7' })) })
  const vi = pv.data.messages.length - 1
  await pv.onVote({ currentTarget: { dataset: { index: vi, vote: 'down' } } })
  await pv.onVote({ currentTarget: { dataset: { index: vi, vote: 'up' } } })
  pv.onUnload()
  ok('F7 反馈只投一次并存本机；无日志号不出票', pv.data.messages[vi].vote === 'down' && fbCalls === 1 &&
    (store[G.storeKey('o1')] || []).some((m) => m.logId === 'L7' && m.vote === 'down') &&
    /<block wx:if="\{\{item\.logId\}\}">/.test(read(P.wxml)))
  // F4 带着问题进来：auto=1 直接发问并带回图鉴物种链接；不带 auto 只预填
  let calls = 0
  reply = { result: { success: true, answer: '闪蝶的蓝来自鳞片。', species: [{ no: '001', zh: '大蓝闪蝶' }], quota: { left: 28, cap: 30 } } }
  wxStub.cloud.callFunction = async (o) => { if (!(o && o.data && o.data.action === 'status')) calls++; return reply }
  const p2 = Object.assign({}, cfg, { data: JSON.parse(JSON.stringify(cfg.data)), setData(p, cb) { Object.assign(this.data, p); if (cb) cb() } })
  p2.onLoad({ from: 'atlas', auto: '1', q: encodeURIComponent('大蓝闪蝶有什么有意思的地方？') })
  await new Promise((r) => setTimeout(r, 0))
  const l2 = p2.data.messages[p2.data.messages.length - 1]
  const p3 = Object.assign({}, cfg, { data: JSON.parse(JSON.stringify(cfg.data)), setData(p, cb) { Object.assign(this.data, p); if (cb) cb() } })
  p3.onLoad({ q: encodeURIComponent('只预填') })
  ok('F4 auto=1 自动发问并带图鉴链接；不带 auto 只预填不发', calls === 1 && l2.species && l2.species[0].no === '001' && p3.data.draft === '只预填' && calls === 1)
  /* ---------------- N 对话之外：今日一物 / 博物小测 / 博物笔记（2026-11-23） ---------------- */
  const NT = loadCjsModule(P.naturalist, { transform })
  const CAT = loadCjsModule(join(MP, 'subpackages/feature/config/atlasCatalog.js'), {})
  const SP = CAT.ATLAS_SPECIES
  const SE = CAT.ATLAS_SERIES
  const t0 = Date.UTC(2026, 10, 23, 4)
  const dayMs = 86400000
  const n_c1 = NT.dailyCard(SP, SE, t0)
  const n_c2 = NT.dailyCard(SP, SE, t0 + 3600000)
  const cycleStart = (Math.floor(NT.dayIndex(t0) / SP.length) * SP.length) * dayMs - 8 * 3600000 + 1
  const inCycle = new Set(Array.from({ length: SP.length }, (_, i) => NT.dailySpecies(SP, cycleStart + i * dayMs).no))
  const real = SP.find((x) => x.no === n_c1.no)
  ok('N1 今日一物：同一天人人同一件；一轮 80 天每种恰好一次；字段取自图鉴；不出图版', n_c1.no === n_c2.no && inCycle.size === SP.length &&
    n_c1.nameZh === real.nameZh && n_c1.essay === real.essay && n_c1.origin === real.origin && !('plate' in n_c1) && !('ghost' in n_c1) &&
    NT.pastDaily(SP, t0, 6).length === 6 && NT.pastDaily(SP, t0, 6)[0].no !== n_c1.no)
  const n_qz = NT.buildQuiz(SP, SE, t0)
  const qz2 = NT.buildQuiz(SP, SE, t0 + 3600000)
  const qzTomorrow = NT.buildQuiz(SP, SE, t0 + dayMs)
  const names = new Set(SP.map((x) => x.nameZh))
  const cats = new Set(SP.map((x) => x.category))
  const chapters = new Set(SE.map((x) => x.name))
  const factOk = n_qz.every((q) => {
    const sp = SP.find((x) => x.no === q.no)
    const right = q.options[q.answer]
    if (new Set(q.options).size !== q.options.length || q.options.length !== 4) return false
    if (q.kind === 'category') return right === sp.category && q.options.every((o) => cats.has(o))
    if (q.kind === 'chapter') return (sp.seriesIds || []).some((id) => (SE.find((x) => x.id === id) || {}).name === right) && q.options.every((o) => chapters.has(o))
    return right === sp.nameZh && q.options.every((o) => names.has(o))
  })
  ok('N2 博物小测：5 题、物种不重复、正确项与图鉴事实一致、选项全是图鉴里真有的（不编）、同一天同一组、隔天换', n_qz.length === 5 &&
    new Set(n_qz.map((q) => q.no)).size === 5 && factOk && JSON.stringify(n_qz) === JSON.stringify(qz2) && n_qz.map((q) => q.no).join() !== qzTomorrow.map((q) => q.no).join() &&
    ['category', 'origin', 'latin', 'habit'].every((k) => n_qz.some((q) => q.kind === k)))
  const n_d0 = NT.dayIndex(t0)
  const allRight = n_qz.map((q) => q.answer)
  let n_st = NT.recordQuiz(null, n_d0, allRight, n_qz)
  const stSame = NT.recordQuiz(n_st, n_d0, allRight, n_qz)
  const stNext = NT.recordQuiz(n_st, n_d0 + 1, [0, 0, 0, 0, 0], n_qz)
  const stGap = NT.recordQuiz(stNext, n_d0 + 3, allRight, n_qz)
  ok('N3 小测记分：全对 5 分；同一天重记不加连续；隔天 +1；断一天从 1 开始；最好成绩取最高；断了的连续今天显示 0',
    n_st.score === 5 && n_st.streak === 1 && stSame.streak === 1 && stNext.streak === 2 && NT.recordQuiz(stNext, n_d0 + 1, allRight, n_qz).streak === 2 && stGap.streak === 1 && stGap.best === 5 &&
    NT.liveStreak(stNext, t0 + dayMs) === 2 && NT.liveStreak(stNext, t0 + 5 * dayMs) === 0)
  let n_nb = []
  for (let i = 0; i < 60; i++) n_nb = NT.addNote(n_nb, { q: 'q' + i, a: 'a' + i }, 1000 + i)
  const nbDup = NT.addNote(n_nb, { q: 'x', a: 'a59' }, 9999)
  ok('N4 博物笔记：最多 50、新的在前、同一段不重复、可删', n_nb.length === 50 && n_nb[0].a === 'a59' && nbDup.length === 50 && nbDup.filter((x) => x.a === 'a59').length === 1 &&
    NT.removeNote(n_nb, n_nb[0].id).length === 49 && NT.hasNote(n_nb, 'a40') && !NT.hasNote(n_nb, 'a1'))
  const appJ = JSON.parse(readFileSync(P.appJson, 'utf8'))
  const feat = appJ.subpackages.find((x) => /subpackages\/feature\/?$/.test(x.root))
  const dailyW = read(P.dailyWxml)
  const quizW = read(P.quizWxml)
  const chatW = read(P.wxml)
  const chatJ = read(P.page)
  ok('N5 接线：三页注册；今日一物 / 小测页不出图版；问答页有三件工具与「收藏」；入口来源三端一致（页面 / 云函数 / 超管报表）',
    ['museum-guide/daily/index', 'museum-guide/quiz/index', 'museum-guide/notes/index'].every((x) => feat.pages.includes(x)) &&
    !/plate|ghost|<image/.test(dailyW + quizW) && /bindtap="onTool"/.test(chatW) && /bindtap="onSave"/.test(chatW) &&
    ['daily', 'quiz', 'notes'].every((k) => chatJ.indexOf(`'${k}'`) >= 0 && src.indexOf(`'${k}'`) >= 0) &&
    ['daily', 'quiz', 'notes'].every((k) => new RegExp(`${k}: '`).test(readFileSync(join(MP, 'subpackages/manager/museum-guide-monitor/monitorView.js'), 'utf8'))))
  // N6 小测页：今天答过 → 直接出结果、不能再答（同一组题不能刷分）
  let qcfg = null
  const qStore = {}
  const qWx = { getStorageSync: (k) => qStore[k], setStorageSync: (k, v) => { qStore[k] = v }, navigateTo() {}, redirectTo() {} }
  loadCjsModule(P.quizJs, { transform, globals: { getApp: () => ({ globalData: { openid: 'o1' } }), Page: (c) => { qcfg = c }, wx: qWx } })
  const mkQ = () => Object.assign({}, qcfg, { data: JSON.parse(JSON.stringify(qcfg.data)), setData(p) { Object.assign(this.data, p) } })
  const qp = mkQ(); qp.onLoad()
  const qs = qp.data.quiz
  qs.forEach((q, i) => { qp.onPick({ currentTarget: { dataset: { i: q.answer } } }); qp.onNext() })
  const qp2 = mkQ(); qp2.onLoad()
  qp2.onPick({ currentTarget: { dataset: { i: 0 } } })
  ok('N6 小测页：答完记分存本机；今天再进直接看结果、不能再答', qp.data.done && qp.data.result.score === qs.length && qp2.data.done && qp2.data.result.fresh === false && qp2.data.picked === -1 &&
    !!qStore.museum_guide_quiz_v1_o1)
  /* ---------------- W 标本工坊：制作 / 陈列 / 灵感 → 馆里真的在卖的藏品（2026-11-23） ---------------- */
  const WS = loadCjsModule(P.workshop, { transform })
  const TAX = loadCjsModule(join(MP, 'config/productTaxonomy.js'), {})
  const craftKeys = new Set(TAX.CRAFT_TYPE_OPTIONS.map((o) => o.value))
  const procKeys = new Set(TAX.CRAFT_PROCESS_OPTIONS.map((o) => o.value))
  ok('W1 装裱 / 工艺的 key 都是商品库里真有的（推荐能按它筛到真藏品）',
    WS.CRAFTS.every((c) => craftKeys.has(c.key)) && WS.PROCESSES.every((p) => procKeys.has(p.key)) && WS.SPACES.every((x) => x.crafts.every((k) => craftKeys.has(k))))
  ok('W2 判分边界：回软 1.8–2.6 秒 / 展翅 90° / 下针正中 / 干燥 7–14 天满分；越界降档；装裱选了就满分', WS.scoreRelax(2000).score === 20 && WS.scoreRelax(1500).score === 14 && WS.scoreRelax(300).score === 6 &&
    WS.scoreSpread(90).score === 20 && WS.scoreSpread(100).score === 10 && WS.scoreSpread(60).score === 4 && WS.scorePin(52).score === 20 && WS.scorePin(62).score === 14 && WS.scorePin(5).score === 6 &&
    WS.scoreDry(10).score === 20 && WS.scoreDry(5).score === 13 && WS.scoreDry(1).score === 5 && WS.scoreFrame('frame').score === 20 && WS.scoreFrame('x').score === 0)
  const mk = WS.makeableSpecies(SP)
  ok('W3 能做的只有图鉴里的蝶 / 蛾（展翅这套步骤只对鳞翅目成立）', mk.length >= 10 && mk.every((x) => x.category === '昆虫' && /蝶|蛾/.test(x.nameZh)))
  const work = WS.buildWork(mk[0], [{ score: 20 }, { score: 20 }, { score: 20 }, { score: 20 }, { score: 15 }], 'cloche', 'ink', t0)
  const plan = WS.buildDisplayPlan('gift', 'ancient', 'b2')
  ok('W4 作品卡：总分 / 等级 / 推荐意图带物种与所选装裱；陈列方案：装裱取空间首选、价格取预算、关键词取气质', work.total === 95 && work.grade.label === '馆藏级' &&
    work.intent.keyword === mk[0].nameZh && work.intent.craftType === 'cloche' && WS.gradeOf(70).label === '陈列级' && WS.gradeOf(69).label === '习作级' &&
    plan.intent.craftType === 'cloche_round' && plan.intent.priceMin === 300 && plan.intent.priceMax === 1000 && plan.intent.keyword === '石' && WS.buildDisplayPlan('x', 'calm') === null)
  let seq = 0
  const rnd = () => [0.99, 0.1][seq++ % 2]
  const mineral = SP.filter((x) => x.category === '矿石')
  const insM = WS.drawInspiration(mineral, () => 0)
  const insAll = Array.from({ length: 40 }, (_, i) => WS.drawInspiration(SP, ((k) => () => ((k * 7 + 3) % 97) / 97)(i)))
  const forCat = (c) => WS.PROCESSES.filter((p) => p.cats.indexOf(c) >= 0).map((p) => p.key).sort().join()
  ok('W5 灵感签：工艺只配适用的门类（昆虫：针插 / 包埋；植物：压制 / 包埋；海洋：包埋 / 浸制）；矿石用「原石陈列」', insM.process === '原石陈列' &&
    forCat('昆虫') === 'pinned,resin_embed' && forCat('植物') === 'pressed,resin_embed' && forCat('海洋') === 'immersion,resin_embed' && forCat('矿石') === '' &&
    insAll.every((x) => x.process === '原石陈列' || WS.PROCESSES.find((p) => p.label === x.process).cats.indexOf(x.category) >= 0) && rnd() > 0)
  const qs1 = WS.productQueries(work.intent)
  const qs2 = WS.productQueries(plan.intent)
  ok('W6 推荐查询逐级放宽：先「物种 + 装裱」再「物种」再备用词；只查藏品（contentLimit 0）；价格区间带上；不重复',
    qs1[0].keyword === mk[0].nameZh && qs1[0].craftType === 'cloche' && qs1[1].keyword === mk[0].nameZh && !qs1[1].craftType && qs1.every((q) => q.contentLimit === 0) &&
    new Set(qs1.map((q) => JSON.stringify(q))).size === qs1.length && qs2.every((q) => q.priceMin === 300 && q.priceMax === 1000))
  const merged = WS.mergeProducts([[{ _id: 'a', soldOut: true, displayImage: 'x' }, { _id: 'b' }], [{ _id: 'b' }, { _id: 'c' }, { _id: 'd' }, { _id: 'e' }]], (u) => 'T:' + u)
  ok('W7 合并推荐：去重、有货在前、最多 4 件、图片走缩略图', merged.length === 4 && merged.map((x) => x._id).join() === 'b,c,d,e' && merged[0].httpImage === '' &&
    WS.mergeProducts([[{ _id: 'a', soldOut: true, displayImage: 'x' }]], (u) => 'T:' + u)[0].httpImage === 'T:x')
  // W8 工坊页：一局走完 → 作品卡 + 推荐真藏品；点藏品进详情页（原购买链路）；只调既有 getEncyclopediaFeed
  let wcfg = null
  const wCalls = []
  const wNav = []
  const wWx = {
    cloud: { callFunction: async (o) => { wCalls.push(o); return { result: { orphanProducts: [{ _id: 'p' + wCalls.length, title: '藏品', price: 100, displayImage: 'cloud://x/y.jpg' }, { _id: 'q' + wCalls.length }] } } } },
    navigateTo: (o) => wNav.push(o.url), switchTab: (o) => wNav.push(o.url)
  }
  loadCjsModule(P.wsJs, { transform, stubs: { '../../../../utils/imageUrl': { thumbUrl: (u) => 'thumb:' + u } }, globals: { Page: (c) => { wcfg = c }, wx: wWx, setInterval: () => 1, clearInterval: () => {} } })
  const wp = Object.assign({}, wcfg, { data: JSON.parse(JSON.stringify(wcfg.data)), setData(p, cb) { Object.assign(this.data, p); if (cb) cb() } })
  wp.onLoad({})
  wp.onPickSpecies({ currentTarget: { dataset: { no: wp.data.choices[0].no } } })
  wp.onHoldStart(); wp._holdAt = Date.now() - 2000; wp.onHoldEnd(); wp.onNextStep()
  wp.onSpread({ detail: { value: 90 } }); wp.onSpreadDone(); wp.onNextStep()
  wp.setData({ pinPos: 50 }); wp.onPinTap(); wp.onNextStep()
  wp.onDry({ detail: { value: 10 } }); wp.onDryDone(); wp.onNextStep()
  wp.onCraft({ currentTarget: { dataset: { key: 'frame' } } }); wp.onFrameDone(); wp.onNextStep()
  await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
  wp.onProductTap({ detail: { id: wp.data.products[0] && wp.data.products[0]._id } })
  ok('W8 工坊页一局走完：五步满分出「馆藏级」作品卡；推荐只调 getEncyclopediaFeed、带物种与装裱；藏品图走缩略图；点藏品进商品详情',
    wp.data.phase === 'done' && wp.data.work.total === 100 && wp.data.work.grade.label === '馆藏级' && wCalls.length >= 1 && wCalls.every((c) => c.name === 'getEncyclopediaFeed') &&
    wCalls[0].data.craftType === 'frame' && wCalls[0].data.keyword === wp.data.species.nameZh && wp.data.products.length === 4 && wp.data.products[0].httpImage === 'thumb:cloud://x/y.jpg' &&
    /^\/subpackages\/feature\/detail\/index\?id=p1$/.test(wNav[0] || ''))
  const wsW = read(P.wsWxml)
  ok('W9 接线：工坊页注册且声明商品卡；问答页有工坊入口；来源 workshop 三端一致；查不到藏品明说、不编',
    feat.pages.includes('museum-guide/workshop/index') && /"product-card": "\/components\/ProductCard\/index"/.test(readFileSync(P.wsJson, 'utf8')) &&
    /data-url="\/subpackages\/feature\/museum-guide\/workshop\/index"/.test(chatW) && chatJ.indexOf("'workshop'") >= 0 && src.indexOf("'workshop'") >= 0 &&
    /workshop: '标本工坊'/.test(readFileSync(join(MP, 'subpackages/manager/museum-guide-monitor/monitorView.js'), 'utf8')) && /馆里暂时没有对得上的藏品/.test(wsW))
  return fails
}

const INJECTIONS = [
  { name: '历史带上错误气泡', file: P.chat, find: "(m.role === 'guide' && !m.isError && !m.isWelcome)", replace: "(m.role === 'guide')" },
  { name: '去处不过白名单', file: P.chat, find: '.filter((k, i, arr) => ACTIONS[k] && arr.indexOf(k) === i)', replace: '.filter((k) => ACTIONS[k] || true)' },
  { name: '存储留着欢迎语', file: P.chat, find: '.filter((m) => m && !m.isWelcome && !m.pending)', replace: '.filter((m) => m && !m.pending)' },
  { name: '云函数放行 system 角色', file: P.fn, find: ".filter((h) => h && (h.role === 'user' || h.role === 'assistant')", replace: '.filter((h) => h' },
  { name: '去处不过白名单（云端）', file: P.fn, find: 'PLACE_KEYS.indexOf(a) >= 0 && ', replace: '' },
  { name: '切日用 UTC', file: P.fn, find: 'new Date((now || Date.now()) + 8 * 3600 * 1000)', replace: 'new Date(now || Date.now())' },
  { name: '风险问题照样问模型', file: P.fn, find: '  if (!sec.ok) {\n', replace: '  if (false) {\n' },
  { name: '回答不复检', file: P.fn, find: '  const outSec = await checkText(OPENID, reply.answer, 2)\n', replace: '  const outSec = { ok: true }\n' },
  { name: '计数集合存了问题', file: P.fn, find: '{ data: { openid, day, count: delta,', replace: '{ data: { openid, day, question: "", count: delta,' },
  { name: '物种匹配不分长短', file: P.knowledge, find: '  hits.sort((a, b) => b.best - a.best)\n', replace: '' },
  { name: '人设丢了「不要编」', file: P.persona, find: '不要编', replace: '尽量回答' },
  { name: '未部署当成网络错误', file: P.page, find: "G.isNotDeployed(err) ? 'not_deployed' : 'network'", replace: "'network'" },
  { name: '页面不存本机', file: P.page, find: '    this.persist(messages)\n', replace: '' },
  { name: '物种编号不校验', file: P.chat, find: ".filter((s) => s && /^\\d{3}$/.test(String(s.no || '')) && s.zh)", replace: ".filter((s) => s && s.zh)" },
  { name: '带问题进来不自动发', file: P.page, find: "if (q && options.auto === '1') this.ask(q)", replace: "if (false) this.ask(q)" },
  { name: '未翻开的页也出问问博物君', file: P.atlasJs, find: 'if (this.data.locked || !card.nameZh) return', replace: 'if (!card.nameZh) return' },
  { name: '开场问题不轮换', file: P.chat, find: 'return pool[(d + i * 3) % pool.length]', replace: 'return pool[0]' },
  { name: '逐字显示太慢', file: P.chat, find: 'Math.min(Math.ceil(n / 3), Math.floor(REVEAL_MAX_MS / REVEAL_TICK_MS))', replace: 'Math.ceil(n / 3)' },
  { name: '页面不去 Markdown', file: P.chat, find: ".replace(/\\*\\*([^*\\n]+)\\*\\*/g, '$1')", replace: '' },
  { name: '存储带着逐字中间态', file: P.chat, find: '    delete base.shown\n', replace: '' },
  { name: '云端不去 Markdown', file: P.fn, find: 'const answer = plainAnswer(obj ? obj.answer : loose.answer)', replace: 'const answer = String(obj ? obj.answer : loose.answer).trim()' },
  { name: '非 JSON 回答不摘字段行', file: P.fn, find: '  const loose = obj ? null : salvageFields(t)', replace: "  const loose = obj ? null : { answer: t, followUps: [], actions: [] }" },
  { name: '字段行里的去处不过白名单', file: P.fn, find: "    .map((a) => String(a || '').trim()).filter((a, i, arr) => PLACE_KEYS.indexOf(a) >= 0 && arr.indexOf(a) === i).slice(0, 2)", replace: "    .map((a) => String(a || '').trim()).slice(0, 2)" },
  { name: '页面不清字段行', file: P.chat, find: "  return stripFieldLines(text)\n", replace: "  return String(text || '')\n" },
  { name: '页面不还原追问按钮', file: P.chat, find: ': lost.followUps).filter(', replace: ': []).filter(' },
  { name: '单个英文词当学名', file: P.chat, find: 'const LATIN_RE = /\\b[A-Z][a-z]{2,}(?: [a-z]{3,}){1,2}\\b/g', replace: 'const LATIN_RE = /\\b[A-Z][a-z]{2,}(?: [a-z]{3,}){0,2}\\b/g' },
  { name: '售罄排在前面', file: P.chat, find: 'return all.filter((p) => !p.soldOut).concat(all.filter((p) => p.soldOut)).slice(0, GOODS_MAX)', replace: 'return all.slice(0, GOODS_MAX)' },
  { name: '馆藏推荐进了存储', file: P.chat, find: '    delete base.goods\n', replace: '' },
  { name: '推荐串到别的回答', file: P.page, find: 'if (!goods.length || !cur || cur.id !== msg.id) return', replace: 'if (!goods.length) return' },
  { name: '不开 JSON 模式', file: P.fn, find: "  if (jsonMode) p.response_format = { type: 'json_object' }\n", replace: '' },
  { name: '超时也同模型重试', file: P.fn, find: '        if (!(jsonMode && e.statusCode === 400)) break', replace: '        if (!jsonMode) break' },
  { name: '提示词不禁英文单词', file: P.persona, find: '；除拉丁学名外不要夹带英文单词。', replace: '。' },
  { name: '点气泡不跳过', file: P.page, find: '    if (cur && cur.revealing) this.finishReveal(index)', replace: '' },
  { name: '页脚丢了 AI 声明', file: P.wxml, find: '由 AI 生成，仅供参考', replace: '仅供参考' },
  { name: '宫格博物君图标退回旧图', file: P.userWxml, find: 'src="/assets/icons/museum-guide.png"', replace: 'src="/assets/icons/knowledge.png"' },
  { name: 'askMuseumGuide 漏登记 cloudbaserc', file: P.cloudrc, find: '"name": "askMuseumGuide"', replace: '"name": "askMuseumGuideX"' },
  { name: '博物君头像退回「博」字', file: P.wxml, find: '<image class="mg-seal-icon" src="{{guideAvatar}}" mode="aspectFit"></image>', replace: '<text>博</text>' },
  { name: '日志记了问题原文', file: P.fn, find: '    q_len: o.qLen | 0,', replace: '    q_len: o.qLen | 0,\n    question: o.question,' },
  { name: '闭馆照样回答', file: P.fn, find: "  if (!cfg.enabled) return finish('off'", replace: "  if (false) return finish('off'" },
  { name: 'status 也计次', file: P.fn, find: "  if (event && event.action === 'status') {\n", replace: "  if (event && event.action === 'status') {\n    await bumpUsage(usageId, OPENID, day, 1)\n" },
  { name: '超管额度不设上下限', file: P.fn, find: 'Number.isFinite(n) && n >= 5 && n <= 200 ? n : dailyLimit(envLimit)', replace: 'Number.isFinite(n) && n > 0 ? n : dailyLimit(envLimit)' },
  { name: '读不到状态就当闭馆', file: P.chat, find: "  if (!r.success) return { closed: false, closedText: '', quota: null }", replace: "  if (!r.success) return { closed: true, closedText: '', quota: null }" },
  { name: '闭馆还能提问', file: P.page, find: '    if (this.data.sending || this.data.closed) return', replace: '    if (this.data.sending) return' },
  { name: '反馈不认本人', file: P.fn, find: "if (!doc || doc.openid !== openid) return", replace: "if (!doc) return" },
  { name: '反馈可以改票', file: P.fn, find: "  if (doc.vote) return { success: true, already: true, vote: doc.vote }\n", replace: '' },
  { name: '失败也带日志号', file: P.fn, find: 'if (out && out.success && logId) out.logId = logId', replace: 'if (out && logId) out.logId = logId' },
  { name: '页面可以重复投票', file: P.page, find: '    if (!msg || !msg.logId || msg.vote) return', replace: '    if (!msg || !msg.logId) return' },
  { name: '今日一物不按天轮换', file: P.naturalist, find: '  return list[cycleOrder(n, Math.floor(day / n))[day % n]]', replace: '  return list[day % 3]' },
  { name: '小测正确项编了一个', file: P.naturalist, find: "makeQ('latin', `学名「${s3.nameLatin}」是哪一种？`, s3.nameZh,", replace: "makeQ('latin', `学名「${s3.nameLatin}」是哪一种？`, s3.nameZh + '蝶'," },
  { name: '同一天重记也加连续', file: P.naturalist, find: '  if (!already) streak = ', replace: '  streak = ' },
  { name: '笔记不去重', file: P.naturalist, find: '  if (list.some((n) => n.a === a)) return list\n', replace: '' },
  { name: '今天答过还能重答', file: P.quizJs, find: '    if (today) this.showResult(today.answers, state, false)', replace: '' },
  { name: '今日一物露出图版', file: P.dailyWxml, find: '<text class="dl-name">{{card.nameZh}}</text>', replace: '<image class="dl-plate" src="{{card.plate}}" /><text class="dl-name">{{card.nameZh}}</text>' },
  { name: '装裱 key 写成商品库没有的', file: P.workshop, find: "{ key: 'cloche_round', label: '圆形玻璃罩'", replace: "{ key: 'round_dome', label: '圆形玻璃罩'" },
  { name: '昆虫配了压制工艺', file: P.workshop, find: "{ key: 'pressed', label: '压制', desc: '把植物压平脱水，做成可以长久保存的腊叶标本。', cats: ['植物'] }", replace: "{ key: 'pressed', label: '压制', desc: '把植物压平脱水，做成可以长久保存的腊叶标本。', cats: ['植物', '昆虫'] }" },
  { name: '推荐不按装裱筛', file: P.workshop, find: "    crafts.forEach((c) => push(Object.assign({}, base, { keyword: kw, craftType: c })))\n", replace: '' },
  { name: '售罄排在前面', file: P.workshop, find: '  return inStock.concat(sold).slice(0, 4)', replace: '  return all.slice(0, 4)' },
  { name: '工坊推荐改调别的云函数', file: P.wsJs, find: "wx.cloud.callFunction({ name: 'getEncyclopediaFeed', data: q })", replace: "wx.cloud.callFunction({ name: 'getRecommendations', data: q })" },
  { name: '点藏品不进详情', file: P.wsJs, find: "    if (id) wx.navigateTo({ url: `/subpackages/feature/detail/index?id=${encodeURIComponent(id)}` })", replace: '' },
  { name: '非字符串 content 也 String 成回答', file: P.fn, find: "  if (msg) return typeof msg.content === 'string' ? msg.content : ''", replace: "  if (msg) return String(msg.content || '')" },
  { name: '数字 answer 又回落成 JSON 原文', file: P.fn, find: '  if (obj && typeof obj.answer !== \'string\') return { answer: \'\', followUps: [], actions: [] }', replace: "  if (obj && typeof obj.answer !== 'string') obj = null" },
  { name: '纯数字也当回答', file: P.fn, find: '  if (PURE_NUM.test(s)) return false', replace: '  if (false) return false' },
  { name: '物种又拿历史与回答一起排', file: P.fn, find: '  const fromQ = matchSpecies(question, 3)\n  if (fromQ.length) return fromQ\n', replace: "  const fromQ = matchSpecies(question + '\\n' + (history || []).map((h) => h.content).join('\\n'), 3)\n  if (fromQ.length) return fromQ\n" },
  { name: '追问又竖着叠', file: P.wxml, find: '<scroll-view class="mg-strip" scroll-x enhanced show-scrollbar="{{false}}">\n                  <view class="mg-strip-row">\n                    <text class="mg-chip"', replace: '<view class="mg-strip">\n                  <view class="mg-strip-row">\n                    <text class="mg-chip"' },
  { name: '滚一下就 setData', file: P.page, find: '    if (far !== this.data.showJump) this.setData({ showJump: far })', replace: '    this.setData({ showJump: far })' },
  { name: '下针又变成一秒扫完', file: P.wsJs, find: 'TICKS_PER_PASS = 50', replace: 'TICKS_PER_PASS = 5' },
  { name: '作品卡丢了图形', file: P.wsWxml, find: '<image class="ws-work-graphic"', replace: '<image class="ws-work-graphic-x"' },
  { name: '开场卡科普不置顶', file: P.chat, find: "  return cards.filter((c) => c.key === 'nature').concat(cards.filter((c) => c.key !== 'nature'))", replace: '  return cards' },
]

if (process.argv.includes('--selftest')) {
  const base = await runChecks()
  if (base.length) { console.error('✗ 自检前提：真源须先通过\n  - ' + base.join('\n  - ')); process.exit(1) }
  let bad = 0
  for (const inj of INJECTIONS) {
    INJECT = inj
    let res
    try { res = await runChecks() } catch (e) { res = ['抛错：' + e.message] }
    INJECT = null
    // 锚点失效 ≠ 检出（同 test:wish-labels 的教训）
    if (res.length && /注入锚点失效/.test(res[0])) { bad++; console.log(`✗ 注入「${inj.name}」→ 锚点失效（注入未发生）`) }
    else if (res.length) console.log(`✓ 注入「${inj.name}」→ 检出（${res[0]}）`)
    else { bad++; console.log(`✗ 注入「${inj.name}」→ 未检出`) }
  }
  if (bad) { console.error(`\n✗ test:museum-guide 自检失败 ${bad} 项`); process.exit(1) }
  console.log(`✓ test:museum-guide 自检通过（${INJECTIONS.length} 条内存注入全部检出，未写盘）`)
} else {
  const fails = await runChecks()
  if (fails.length) { console.error('✗ 博物君不合格：\n  - ' + fails.join('\n  - ')); process.exit(1) }
  console.log('✓ test:museum-guide：页面纯函数 / 云函数清洗与解析 / 内容安全双检 / 密钥与隐私 / 知识同源 / 接线 / 页面行为 全部通过')
}
