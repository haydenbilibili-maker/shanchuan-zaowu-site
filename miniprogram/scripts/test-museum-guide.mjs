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
  avatar: join(MP, 'subpackages/feature/utils/guideAvatar.js'),
  cloudrc: join(MP, 'cloudbaserc.json'),
  fn: join(MP, 'cloudfunctions/askMuseumGuide/index.js'),
  knowledge: join(MP, 'cloudfunctions/askMuseumGuide/knowledge.js'),
  persona: join(MP, 'cloudfunctions/askMuseumGuide/persona.js'),
  fnConfig: join(MP, 'cloudfunctions/askMuseumGuide/config.json'),
  appJson: join(MP, 'app.json'),
  userWxml: join(MP, 'pages/user/index.wxml'),
  userJs: join(MP, 'pages/user/index.js'),
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
  ok('A7 额度文案', G.quotaText({ left: 3, cap: 30 }) === '今日还可问 3 次' && G.quotaText({ left: 0, cap: 30 }) === '今日次数已用完' && G.quotaText(null) === '')

  /* ---------------- B 云函数纯函数 ---------------- */
  const secCalls = []
  let modelCalls = 0
  const fakeDb = { collection: () => ({ doc: () => ({ get: async () => ({ data: { count: 0 } }), update: async () => ({ stats: { updated: 1 } }), set: async () => ({}) }) }), command: { inc: (n) => n }, serverDate: () => 0 }
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
  ok('C5 计数集合只记 openid / day / count / updatedAt，不存问题与回答', /openid/.test(setBlock) && /count/.test(setBlock) && !/question|answer|history|content/.test(setBlock) && !/collection\([^)]*\)\.add\(/.test(src))
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
    /data-path="museumGuide">\s*<image class="m-img" src="\/assets\/icons\/museum-guide\.png"/.test(userWxml) &&
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
    /wx:if="\{\{speciesInfo\.species_name_zh && speciesInfo\.is_specimen !== false\}\}">\s*<text class="meta-link" bindtap="onAskGuide"/.test(read(P.idWxml)) && /museum-guide\/index\?from=identify&auto=1/.test(read(P.idJs)))
  const avatar = loadCjsModule(P.avatar).GUIDE_AVATAR || ''
  const avatarSvg = decodeURIComponent(avatar.split(',')[1] || '')
  ok('E6 博物君头像 = 附件「科学家」icon（方印内是内联 svg，两处入口都换，不是「博」字）',
    /<view class="mg-seal"[^>]*><image class="mg-seal-icon" src="\{\{guideAvatar\}\}" mode="aspectFit"><\/image><\/view>/.test(read(P.wxml)) &&
    /<image class="ask-guide-seal" src="\{\{guideAvatar\}\}" mode="aspectFit"/.test(read(P.atlasWxml)) &&
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
    /class="mg-species" wx:if="\{\{item\.species\.length && !item\.revealing\}\}"/.test(mgWxml) && /class="mg-acts" wx:if="\{\{item\.actions\.length && !item\.revealing\}\}"/.test(mgWxml) &&
    /class="mg-follow" wx:if="\{\{item\.followUps\.length && !sending && !item\.revealing\}\}"/.test(mgWxml))
  // F4 带着问题进来：auto=1 直接发问并带回图鉴物种链接；不带 auto 只预填
  let calls = 0
  reply = { result: { success: true, answer: '闪蝶的蓝来自鳞片。', species: [{ no: '001', zh: '大蓝闪蝶' }], quota: { left: 28, cap: 30 } } }
  wxStub.cloud.callFunction = async () => { calls++; return reply }
  const p2 = Object.assign({}, cfg, { data: JSON.parse(JSON.stringify(cfg.data)), setData(p, cb) { Object.assign(this.data, p); if (cb) cb() } })
  p2.onLoad({ from: 'atlas', auto: '1', q: encodeURIComponent('大蓝闪蝶有什么有意思的地方？') })
  await new Promise((r) => setTimeout(r, 0))
  const l2 = p2.data.messages[p2.data.messages.length - 1]
  const p3 = Object.assign({}, cfg, { data: JSON.parse(JSON.stringify(cfg.data)), setData(p, cb) { Object.assign(this.data, p); if (cb) cb() } })
  p3.onLoad({ q: encodeURIComponent('只预填') })
  ok('F4 auto=1 自动发问并带图鉴链接；不带 auto 只预填不发', calls === 1 && l2.species && l2.species[0].no === '001' && p3.data.draft === '只预填' && calls === 1)
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
  { name: '云端不去 Markdown', file: P.fn, find: "const answer = plainAnswer((obj && obj.answer) || (obj ? '' : t))", replace: "const answer = String((obj && obj.answer) || (obj ? '' : t)).trim()" },
  { name: '点气泡不跳过', file: P.page, find: '    if (cur && cur.revealing) this.finishReveal(index)', replace: '' },
  { name: '页脚丢了 AI 声明', file: P.wxml, find: '由 AI 生成，仅供参考', replace: '仅供参考' },
  { name: '宫格博物君图标退回旧图', file: P.userWxml, find: 'src="/assets/icons/museum-guide.png"', replace: 'src="/assets/icons/knowledge.png"' },
  { name: 'askMuseumGuide 漏登记 cloudbaserc', file: P.cloudrc, find: '"name": "askMuseumGuide"', replace: '"name": "askMuseumGuideX"' },
  { name: '博物君头像退回「博」字', file: P.wxml, find: '<image class="mg-seal-icon" src="{{guideAvatar}}" mode="aspectFit"></image>', replace: '<text>博</text>' }
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
