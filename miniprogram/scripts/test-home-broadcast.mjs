#!/usr/bin/env node
/**
 * test:home-broadcast —— 首页「博物君口播」（2026-11-23，产品负责人点名：原馆员问候行升级为博物君口播）
 *
 *   H1 纯函数：问候带昵称（过长截断、占位名当没有）/ 访客「欢迎来馆」；顺序 通知 → 开馆 → 一知 ×2 → 提示；
 *      闭馆不播通知、不带去博物君的问题；一知按日期轮换、同日两条不同；每条文案 ≤ 22 字（首页单行，第二版）
 *   H2 超管写入：口播通知去空白 / 去空串 / ≤ 3 条 / 每条 ≤ 22 字 / 非数组拒绝；首次写配置不丢已存通知
 *   H3 只读带出：getContentDisplayFlags 开馆带出通知、闭馆与没配置为空、save 不写它；小程序端归一丢掉非字符串
 *   H4 接线：首页口播叠在头图顶部（第三版；无头图退回独立一条）、挂在原问候位、回到首页重排、门店 / 开关到了重排、点按只预填不自动提问、from=home 三端登记、
 *      超管页有编辑框与保存
 *
 *   node miniprogram/scripts/test-home-broadcast.mjs [--selftest]
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCjsModule } from './lib/cjs-loader.mjs'

const MP = join(dirname(fileURLToPath(import.meta.url)), '..')
const P = {
  cast: join(MP, 'pages/index/guideBroadcast.js'),
  greet: join(MP, 'pages/index/homeGreeting.js'),
  homeJs: join(MP, 'pages/index/index.js'),
  homeWxml: join(MP, 'pages/index/index.wxml'),
  homeWxss: join(MP, 'pages/index/index.wxss'),
  avatar: join(MP, 'utils/guideAvatar.js'),
  monFn: join(MP, 'cloudfunctions/museumGuideMonitor/index.js'),
  flagsFn: join(MP, 'cloudfunctions/getContentDisplayFlags/index.js'),
  flagsUtil: join(MP, 'utils/contentDisplayFlags.js'),
  askFn: join(MP, 'cloudfunctions/askMuseumGuide/index.js'),
  guidePage: join(MP, 'subpackages/feature/museum-guide/index.js'),
  monView: join(MP, 'subpackages/manager/museum-guide-monitor/monitorView.js'),
  monPage: join(MP, 'subpackages/manager/museum-guide-monitor/index.js'),
  monWxml: join(MP, 'subpackages/manager/museum-guide-monitor/index.wxml')
}

let INJECT = null
const transform = (file, src) => {
  if (!INJECT || INJECT.file !== file) return src
  if (src.indexOf(INJECT.find) === -1) throw new Error(`注入锚点失效：${INJECT.name}`)
  return src.replace(INJECT.find, INJECT.replace)
}
const read = (f) => transform(f, readFileSync(f, 'utf8'))
const quiet = { console: { warn() {}, log() {}, error() {} } }

function memDb(seed) {
  const docs = JSON.parse(JSON.stringify(seed || {}))
  const chain = (name) => {
    const c = { where: () => c, orderBy: () => c, skip: () => c, limit: () => c, field: () => c, get: async () => ({ data: Object.values(docs[name] || {}) }) }
    return c
  }
  return {
    docs,
    command: { gte: () => ({}), neq: () => ({}) },
    serverDate: () => 0,
    collection: (name) => Object.assign(chain(name), {
      doc: (id) => ({
        get: async () => { const d = (docs[name] || {})[id]; if (!d) throw new Error('document not exist'); return { data: d } },
        update: async ({ data }) => { const d = (docs[name] || {})[id]; if (!d) return { stats: { updated: 0 } }; Object.assign(d, data); return { stats: { updated: 1 } } },
        set: async ({ data }) => { (docs[name] = docs[name] || {})[id] = Object.assign({}, data) }
      }),
      add: async ({ data }) => { const id = 'a' + Math.random(); (docs[name] = docs[name] || {})[id] = data; return { _id: id } }
    })
  }
}

async function runChecks() {
  const fails = []
  const ok = (name, cond) => { if (!cond) fails.push(name) }

  /* ---------------- H1 纯函数 ---------------- */
  const C = loadCjsModule(P.cast, { transform })
  const at = (m, d, h) => new Date(2026, m, d, h, 0)
  const store = { line: '主店营业中，开到 22:00' }
  const full = C.buildBroadcast({ nick: '蛋炒饭', now: at(10, 23, 20), greeting: store, notices: [' 周六有标本课 ', '', '新到一批鹦鹉螺'], guideOpen: true })
  ok('H1 问候带昵称（时段问候 + 昵称）', full.hello === '晚上好，蛋炒饭')
  ok('H1 访客 / 占位名 → 欢迎来馆', C.buildBroadcast({ now: at(10, 23, 9) }).hello === '早上好，欢迎来馆' &&
    C.buildBroadcast({ nick: '微信用户', now: at(10, 23, 9) }).hello === '早上好，欢迎来馆')
  ok('H1 长昵称截断', C.buildBroadcast({ nick: '一二三四五六七八九十', now: at(10, 23, 9) }).hello === '早上好，一二三四五六七八…')
  ok('H1 顺序：通知 → 开馆 → 一知 ×2 → 提示（空通知丢掉、去空白）',
    full.items.map((i) => i.kind).join(',') === 'notice,notice,store,fact,fact,tip' && full.items[0].text === '周六有标本课')
  ok('H1 key 唯一', new Set(full.items.map((i) => i.key)).size === full.items.length)
  ok('H1 开馆条可点去门店、通知只读、一知带问题', full.items[2].store === true && !full.items[0].q && !full.items[0].store && !!full.items[3].q)
  const closed = C.buildBroadcast({ nick: 'a', now: at(10, 23, 20), greeting: store, notices: ['x'], guideOpen: false })
  ok('H1 闭馆：不播通知、不带去博物君的问题（开馆条仍可点）', !closed.items.some((i) => i.kind === 'notice') && closed.items.every((i) => !i.q) && closed.items.some((i) => i.store))
  ok('H1 没有门店状态 → 不出开馆条', !C.buildBroadcast({ now: at(10, 23, 20) }).items.some((i) => i.kind === 'store'))
  const d1 = C.buildBroadcast({ now: at(10, 23, 15) }).items.filter((i) => i.kind === 'fact')
  const d2 = C.buildBroadcast({ now: at(10, 24, 15) }).items.filter((i) => i.kind === 'fact')
  ok('H1 一知按日期轮换、同日两条不同', d1[0].text !== d2[0].text && d1[0].text !== d1[1].text)
  const tipAt = (h) => C.buildBroadcast({ now: at(10, 23, h) }).items.find((i) => i.kind === 'tip').text
  ok('H1 提示按时段分组（早 / 午 / 夜 不同组）', C.TIPS.morning.some((t) => t.t === tipAt(8)) && C.TIPS.day.some((t) => t.t === tipAt(15)) && C.TIPS.night.some((t) => t.t === tipAt(23)))
  const all = C.FACTS.concat(C.TIPS.morning, C.TIPS.day, C.TIPS.night)
  ok('H1 每条文案 ≤ 22 字（首页单行放得下，不折行）', C.LINE_MAX === 22 && all.every((x) => x.t && x.t.length <= C.LINE_MAX))
  ok('H1 每条一知都带问题', C.FACTS.every((x) => x.q && x.q.length <= 40))
  // 2026-11-25 产品负责人：博物一知要多一些内容 → 至少 20 条（棘轮：只许增不许减）
  ok('H1 博物一知至少 100 条，且每条文案不超长', C.FACTS.length >= 100 && C.FACTS.every((x) => x.t && x.t.length <= 40))
  ok('H1 去博物君只预填（from=home，不带 auto=1）', C.guideUrl('为什么？') === '/subpackages/feature/museum-guide/index?from=home&q=' + encodeURIComponent('为什么？'))
  const castSrc = read(P.cast)
  ok('H1 纯函数：不碰 wx', !/\bwx\./.test(castSrc))

  /* ---------------- H2 超管写入 ---------------- */
  const loadMon = (db) => loadCjsModule(P.monFn, {
    transform,
    stubs: { 'wx-server-sdk': { init() {}, DYNAMIC_CURRENT_ENV: 'x', database: () => db, getWXContext: () => ({ OPENID: 'admin1' }) }, './staffGuard': { assertStaff: async () => ({ ok: true, actor: { openid: 'admin1', name: '超管' } }) } },
    globals: quiet
  })
  const T = loadMon(memDb())._test
  const n = (v) => T.normalizeNotices(v)
  ok('H2 去空白 / 去空串', JSON.stringify(n([' a  b ', '', '  ', 'c'])) === JSON.stringify({ notices: ['a b', 'c'] }))
  ok('H2 超过 3 条拒绝', !!n(['1', '2', '3', '4']).error)
  ok('H2 单条超过 22 字拒绝（与首页单行同口径）', !!n(['字'.repeat(23)]).error && !n(['字'.repeat(22)]).error && T.NOTICE_LEN === 22)
  ok('H2 非数组拒绝、空数组 = 清空', !!n('abc').error && JSON.stringify(n([])) === JSON.stringify({ notices: [] }))
  ok('H2 配置入参带上通知', JSON.stringify(T.normalizeConfigInput({ notices: ['x'] })) === JSON.stringify({ patch: { notices: ['x'] } }) && !!T.normalizeConfigInput({ notices: ['1', '2', '3', '4'] }).error)
  ok('H2 视图带出通知（脏数据截断）', JSON.stringify(T.viewConfig({ notices: ['a', 'b', 'c', 'd'] }).notices) === JSON.stringify(['a', 'b', 'c']) && JSON.stringify(T.viewConfig(null).notices) === '[]')
  // 首次写（文档不存在）不丢已存通知：先只有 notices 的文档被删掉的情形无从谈起，这里验「改额度时文档不存在」→ 写入后通知为空且开关保留
  const db1 = memDb({ admin_operation_logs: {} })
  const r1 = await loadMon(db1).main({ action: 'setConfig', notices: ['周六有课'] })
  const r2 = await loadMon(db1).main({ action: 'setConfig', dailyLimit: 20 })
  ok('H2 先存通知再改额度：通知还在', r1.success && r2.success && JSON.stringify(db1.docs.museum_guide_config.main.notices) === JSON.stringify(['周六有课']) && db1.docs.museum_guide_config.main.dailyLimit === 20)
  const monSrc = read(P.monFn)
  ok('H2 首次写配置把已存通知带上（keep）', /if \(before\.notices\.length\) keep\.notices = before\.notices/.test(monSrc))
  ok('H2 审计记录改前的通知', /before: \{ enabled: before\.enabled, dailyLimit: before\.dailyLimit, notices: before\.notices \}/.test(monSrc))

  /* ---------------- H3 只读带出 ---------------- */
  const flagDb = (cfg) => memDb(Object.assign({ content_display_flags: { f1: { status: 'active', priority: 100 } } }, cfg ? { museum_guide_config: { main: cfg } } : {}))
  const loadFlags = (db) => loadCjsModule(P.flagsFn, {
    transform,
    stubs: { 'wx-server-sdk': { init() {}, DYNAMIC_CURRENT_ENV: 'x', database: () => db, getWXContext: () => ({ OPENID: 'u1' }), serverDate: () => 0 }, './staffGuard': { assertStaff: async () => ({ ok: true, actor: { openid: 'm' } }), ROLE_MANAGER: 'manager' } },
    globals: quiet
  })
  const fOn = await loadFlags(flagDb({ notices: ['周六有课', '', 3, '字'.repeat(50), 'd', 'e'] })).main({})
  const fOff = await loadFlags(flagDb({ enabled: false, notices: ['周六有课'] })).main({})
  const fNone = await loadFlags(flagDb(null)).main({})
  ok('H3 开馆带出通知（去空、截断 22 字、最多 3 条）', JSON.stringify(fOn.flags.museumGuideNotices) === JSON.stringify(['周六有课', '3', '字'.repeat(22)]))
  ok('H3 闭馆 / 没配置 → 空', JSON.stringify(fOff.flags.museumGuideNotices) === '[]' && JSON.stringify(fNone.flags.museumGuideNotices) === '[]')
  const saveDb = flagDb({ notices: ['x'] })
  await loadFlags(saveDb).main({ action: 'save', flags: { museumGuideNotices: ['被写进来'] } })
  ok('H3 save 不写通知', !Object.values(saveDb.docs.content_display_flags || {}).some((d) => 'museumGuideNotices' in d))
  const U = loadCjsModule(P.flagsUtil, { transform, stubs: {}, globals: Object.assign({ wx: { getStorageSync: () => null, setStorageSync() {} }, getApp: () => ({ globalData: {} }) }, quiet) })
  const normalize = U.normalizeContentDisplayFlags
  ok('H3 小程序端归一：只留非空字符串、最多 3 条、缺省空数组',
    typeof normalize === 'function' &&
    JSON.stringify(normalize({ museumGuideNotices: [' a ', 1, '', 'b', 'c', 'd'] }).museumGuideNotices) === JSON.stringify(['a', 'b', 'c']) &&
    JSON.stringify(normalize({}).museumGuideNotices) === '[]')

  /* ---------------- H4 接线 ---------------- */
  const js = read(P.homeJs)
  const wxml = read(P.homeWxml)
  const wxss = read(P.homeWxss)
  // 第三版（2026-11-23）：有头图时叠在头图顶部；头图不出时才退回独立口播带（条件与头图互斥，不会两条同时出）
  const heroCond = 'showBanners || (showLive && liveSession && liveSession.pullUrl)'
  const heroAt = wxml.indexOf('class="hero-section')
  const heroEnd = wxml.indexOf('class="dots-row"', heroAt)
  const onLine = wxml.indexOf('<view class="hero-cast-line" wx:if="{{cast.hello}}">')
  // 2026-11-25 第四版：问候移到头图**上方**，只有轮播那一行压在图顶（解决顶部拥挤）
  ok('H4 问候与轮播拆开：问候在头图上方、轮播行仍在头图内（点位之前）并带顶部压暗',
    /<view class="home-cast is-above" wx:if="\{\{cast\.hello && \(showBanners/.test(wxml) &&
    /<view class="hero-cast-line" wx:if="\{\{cast\.hello\}\}">/.test(wxml) &&
    onLine > heroAt && onLine < heroEnd &&
    /<view class="hero-cast-scrim" wx:if="\{\{cast\.hello\}\}"><\/view>/.test(wxml) && !/class="home-greet"/.test(wxml))
  ok('H4 无头图时退回独立口播带（与头图条件互斥）',
    wxml.includes(`<view class="home-cast" wx:if="{{cast.hello && !(${heroCond})}}">`) && wxml.includes(`<view class="hero-section {{cast.hello ? 'has-cast' : ''}}" wx:if="{{${heroCond}}}">`))
  ok('H4 两段结构各自复用：问候 greet 两处（上方 / 无头图带）、轮播 line 两处（头图内 / 无头图带）',
    (wxml.match(/<template is="home-cast-greet" data="\{\{cast\}\}" \/>/g) || []).length === 2 &&
    (wxml.match(/<template is="home-cast-line" data="\{\{cast\}\}" \/>/g) || []).length === 2 &&
    /<template name="home-cast-greet">/.test(wxml) && /<template name="home-cast-line">/.test(wxml))
  ok('H4 轮播层必须是块级（swiper 无内在宽度，放进 flex 会被压成 0 宽 → 整行消失）',
    /\.hero-cast-line \{[^}]*display: block;/.test(wxss) && !/\.hero-cast-line \{[^}]*display: flex;/.test(wxss))
  ok('H4 叠层不拦头图点击（只有可点那一行接手）', /\.hero-cast-line \{[^}]*pointer-events: none;/.test(wxss) && /\.hero-cast-line \.home-cast-item \{ pointer-events: auto; \}/.test(wxss))
  ok('H4 头图加高、口播带取消后头部更省', /\.hero-section\.has-cast \{ height: 560rpx; \}/.test(wxss))
  // 2026-11-25 产品负责人：口播这一个类型不够，升级成「信号灯」（不同颜色代表不同性质）
  const G2 = loadCjsModule(P.cast, { transform })
  const b2 = G2.buildBroadcast({ nick: '阿', greeting: { line: '营业中' }, notices: ['公告'] })
  const toneOf = (kind) => (b2.items.find((x) => x.kind === kind) || {}).tone
  ok('H6 信号灯：条目带 tone（开馆=open / 通知=notice / 博物=fact / 提示=tip），signalOf 给对应短标',
    toneOf('store') === 'open' && toneOf('notice') === 'notice' && toneOf('fact') === 'fact' && toneOf('tip') === 'tip' &&
    G2.signalOf(b2.items, 0).label === G2.TONE_META[G2.signalOf(b2.items, 0).tone].label &&
    G2.signalOf([], 0).tone === 'idle' && G2.signalOf([], 0).label === '口播')
  ok('H6 信号灯接线：胶囊绑 castSignal、轮播切换更新、关闭时复位；样式按 tone 分色',
    /class="home-cast-live is-\{\{cast\.signal\.tone\}\}"/.test(wxml) && /\{\{cast\.signal\.label\}\}/.test(wxml) &&
    /bindchange="onCastSwiperChange"/.test(wxml) && /signalOf\(this\.data\.cast && this\.data\.cast\.items, i\)/.test(js) &&
    /signal: \{ tone: 'idle', label: '口播' \}/.test(js) &&
    /\.home-cast-live\.is-open \.home-cast-dot[^}]*#7FA97A/.test(wxss) && /\.home-cast-live\.is-notice \.home-cast-dot[^}]*#D9A05B/.test(wxss))
  ok('H4 点头像进博物君（开关关闭时不出、也不跳）',
    /<view class="home-cast-seal is-link" bindtap="onCastSealTap"/.test(wxml) &&
    /onCastSealTap\(\) \{[\s\S]{0,220}museumGuideOpen === false\) return/.test(js) &&
    /museum-guide\/index\?from=home/.test(js))
  ok('H4 点按走 onCastTap、可点条目带 ›', /bindtap="onCastTap"/.test(wxml) && /class="home-cast-go" wx:if="\{\{item\.q \|\| item\.store\}\}"/.test(wxml))
  ok('H4 回到首页重排（昵称 / 时段）', /onShow\(\) \{[\s\S]{0,400}this\.refreshCast\(\);/.test(js))
  ok('H4 门店状态到了重排', /homeGreeting: buildHomeGreeting\(store\),[\s\S]{0,120}this\.refreshCast\(\);/.test(js))
  ok('H4 开关到了重排（带通知与开馆状态）', /this\._castFlags = flags;\s*this\.refreshCast\(\);/.test(js) && /notices: flags\.museumGuideNotices,/.test(js) && /guideOpen: flags\.museumGuideOpen !== false/.test(js))
  ok('H4 内容没变不 setData（不让轮播跳回第一条）', /if \(sig === this\._castSig\) return;/.test(js))
  ok('H4 昵称来自 resolvePrefillNickName', /nick: resolvePrefillNickName\(getApp\(\)\)/.test(js))
  ok('H4 开馆条走 goToBooking（门店开关在那里判）', /if \(item\.store\) \{ this\.goToBooking\(\); return; \}/.test(js))
  const castT = wxss.slice(wxss.indexOf('.home-cast-t {'), wxss.indexOf('}', wxss.indexOf('.home-cast-t {')))
  ok('H4 单行定高、不折行（轮播不跳）', /\.home-cast-swiper \{ height: 40rpx;/.test(wxss) && /white-space: nowrap;/.test(castT) && /text-overflow: ellipsis;/.test(castT))
  ok('H4 无框口播带：不再套卡片底色 / 实心红印', !/#8E3B2E/.test(wxss) && !/\.home-cast \{[^}]*background:/.test(wxss))
  ok('H4 小程序端 / 超管页通知截断与云端同口径（22 字）', /\.slice\(0, 22\)\)\.slice\(0, 3\)/.test(read(P.flagsUtil)) && /const NOTICE_LEN = 22/.test(read(P.monView)))
  ok('H4 from=home 三端登记（页面白名单 / 云函数入口 / 超管报表标签）',
    /'workshop', 'home'\]\.indexOf\(options && options\.from\)/.test(read(P.guidePage)) &&
    /const ENTRY_SOURCES = \[[^\]]*'home'/.test(read(P.askFn)) && /home: '首页口播'/.test(read(P.monView)))
  const monWxml = read(P.monWxml)
  const monPage = read(P.monPage)
  ok('H4 超管页有口播编辑框与保存', /bindinput="onNoticeInput"/.test(monWxml) && /bindtap="onSaveNotices"/.test(monWxml) && /maxlength="\{\{noticeLen\}\}"/.test(monWxml))
  ok('H4 保存只提交非空条目、没改不提交', /if \(this\.data\.saving \|\| !this\.data\.noticeDirty\) return/.test(monPage) && /\.filter\(Boolean\) \}\)/.test(monPage))
  const avatarMod = loadCjsModule(P.avatar)
  const brassAvatar = avatarMod.avatarOf('#E0CFA3')
  ok('H5 口播印章用「科学家」头像（不是「博」字），颜色随印章铜金',
    /<view class="home-cast-seal[^"]*"[^>]*><image class="home-cast-seal-icon" src="\{\{cast\.avatar\}\}"/.test(read(P.homeWxml)) &&
    /castAvatar: avatarOf\('#E0CFA3'\)/.test(read(P.homeJs)) && /cast\.avatar = this\.data\.castAvatar;/.test(read(P.homeJs)) &&
    /\.home-cast-seal-icon \{[^}]*width: 36rpx;/.test(read(P.homeWxss)) &&
    /^data:image\/svg\+xml/.test(brassAvatar) && decodeURIComponent(brassAvatar.split(',')[1] || '').includes('fill="#E0CFA3"') &&
    !/<view class="home-cast-seal[^"]*"[^>]*><text>博<\/text>/.test(read(P.homeWxml)))
  ok('H4 刷新报表不冲掉正在编辑的草稿', /if \(!this\.data\.noticeDirty\) patch\.noticeDrafts/.test(monPage))
  return fails
}

const INJECTIONS = [
  { name: '口播印章退回「博」字', file: P.homeWxml, find: '<image class="home-cast-seal-icon" src="{{cast.avatar}}" mode="aspectFit"></image>', replace: '<text>博</text>' },
  { name: '访客问候露出空昵称', file: P.cast, find: "${nick || '欢迎来馆'}", replace: '${nick}' },
  { name: '昵称不截断', file: P.cast, find: "return s.length > NICK_MAX ? s.slice(0, NICK_MAX) + '…' : s;", replace: 'return s;' },
  { name: '闭馆仍播通知', file: P.cast, find: '  if (open) {\n    (Array.isArray', replace: '  if (true) {\n    (Array.isArray' },
  { name: '闭馆仍带问题', file: P.cast, find: 'q: open && q ? q : \'\'', replace: "q: q || ''" },
  { name: '一知条数回落到 99', file: P.cast, find: "  { t: '蝌蚪用鳃呼吸，长成蛙后改用肺和皮肤', q: '青蛙小时候为什么生活在水里？' }\n", replace: '' },
  { name: '同日两条一知相同', file: P.cast, find: 'FACTS[(di + 5) % FACTS.length]', replace: 'FACTS[di % FACTS.length]' },
  { name: '点口播直接提问', file: P.cast, find: '?from=home&q=${encodeURIComponent(q)}', replace: '?from=home&auto=1&q=${encodeURIComponent(q)}' },
  { name: '一知写超长（会折行）', file: P.cast, find: "{ t: '大蓝闪蝶的蓝来自鳞片结构，不是色素'", replace: "{ t: '大蓝闪蝶的蓝来自鳞片上的微结构对光的干涉，不是色素'" },
  { name: '通知不设条数上限', file: P.monFn, find: '  if (out.length > NOTICE_MAX) return', replace: '  if (false) return' },
  { name: '首次写丢了通知', file: P.monFn, find: '    if (before.notices.length) keep.notices = before.notices\n', replace: '' },
  { name: '闭馆仍带出通知', file: P.flagsFn, find: '  if (!open || !doc || !Array.isArray(doc.notices)) return []', replace: '  if (!doc || !Array.isArray(doc.notices)) return []' },
  { name: '小程序端不归一通知', file: P.flagsUtil, find: ".filter((t) => typeof t === 'string' && t.trim())", replace: '' },
  { name: '回到首页不重排', file: P.homeJs, find: '    // 口播每次回到首页重排一次：昵称（刚登录 / 刚改名）与时段问候跟着变\n    this.refreshCast();\n', replace: '' },
  { name: '每次都 setData', file: P.homeJs, find: 'if (sig === this._castSig) return;', replace: '' },
  { name: '开馆灯变提示色', file: P.cast, find: "const TONE_OF_KIND = { store: 'open'", replace: "const TONE_OF_KIND = { store: 'tip'" },
  { name: '胶囊写死口播', file: P.homeWxml, find: '<text>{{cast.signal.label}}</text>', replace: '<text>口播</text>' },
  { name: '头像不可点', file: P.homeWxml, find: 'class="home-cast-seal is-link" bindtap="onCastSealTap"', replace: 'class="home-cast-seal"' },
  { name: '轮播层改回 flex', file: P.homeWxss, find: '  display: block;\n  /* 口播层不拦头图点击', replace: '  display: flex;\n  /* 口播层不拦头图点击' },
  { name: '旧问候行回来', file: P.homeWxml, find: '<view class="home-cast is-above" wx:if="{{cast.hello && (showBanners', replace: '<view class="home-greet" wx:if="{{homeGreeting.word}}"></view>\n    <view class="home-cast is-above" wx:if="{{cast.hello && (showBanners' },
  { name: '有头图时独立口播带也出（两条重复）', file: P.homeWxml, find: '<view class="home-cast" wx:if="{{cast.hello && !(showBanners || (showLive && liveSession && liveSession.pullUrl))}}">', replace: '<view class="home-cast" wx:if="{{cast.hello}}">' },
  { name: '叠层拦住头图点击', file: P.homeWxss, find: '  /* 口播层不拦头图点击：只有可点的那一行接手 */\n  pointer-events: none;\n', replace: '' },
  { name: '口播不叠在头图上', file: P.homeWxml, find: '      <view class="hero-cast-line" wx:if="{{cast.hello}}">\n        <template is="home-cast-line" data="{{cast}}" />\n      </view>\n', replace: '' },
  { name: '口播文案折行', file: P.homeWxss, find: '  overflow: hidden;\n  white-space: nowrap;\n  text-overflow: ellipsis;\n}\n.home-cast-go', replace: '  overflow: hidden;\n}\n.home-cast-go' },
  { name: '口播套回卡片底色', file: P.homeWxss, find: '  margin: 0 32rpx 20rpx;\n  padding: 10rpx 0 18rpx;\n}', replace: '  margin: 0 32rpx 20rpx;\n  padding: 10rpx 0 18rpx;\n  background: rgba(196, 167, 108, 0.1);\n}' },
  { name: '通知放宽到 36 字', file: P.monFn, find: 'const NOTICE_LEN = 22', replace: 'const NOTICE_LEN = 36' },
  { name: '入口没登记 home', file: P.askFn, find: "'workshop', 'home', 'direct'", replace: "'workshop', 'direct'" },
  { name: '刷新冲掉草稿', file: P.monPage, find: 'if (!this.data.noticeDirty) patch.noticeDrafts', replace: 'patch.noticeDrafts' }
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
    if (res.length && /注入锚点失效/.test(res[0])) { bad++; console.log(`✗ 注入「${inj.name}」→ 锚点失效（注入未发生）`) }
    else if (res.length) console.log(`✓ 注入「${inj.name}」→ 检出（${res[0]}）`)
    else { bad++; console.log(`✗ 注入「${inj.name}」→ 未检出`) }
  }
  if (bad) { console.error(`✗ 自检失败：${bad} 条注入未检出 / 锚点失效`); process.exit(1) }
  console.log(`✓ 自检通过：${INJECTIONS.length} 条注入全部检出（内存副本，不写盘）`)
} else {
  const fails = await runChecks()
  if (fails.length) { console.error('✗ test:home-broadcast 失败：\n  - ' + fails.join('\n  - ')); process.exit(1) }
  console.log('✓ test:home-broadcast：首页博物君口播通过（纯函数 / 超管写入 / 只读带出 / 接线）')
}
