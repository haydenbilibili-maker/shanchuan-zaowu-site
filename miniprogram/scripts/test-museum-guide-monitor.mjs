#!/usr/bin/env node
/**
 * test:museum-guide-monitor —— 超管工作台「博物君」开关与监测（2026-11-23，产品负责人点名）
 *
 *   M1 报表聚合：按北京时间日补零、成功率分母不含额度满 / 闭馆 / 入参不合法、物种与去处只算已回答、单人当天最多、窗口外不算
 *   M2 配置入参：只认布尔开关与 5–200 整数额度；空 / 越界拒绝
 *   M3 云函数门禁与审计：非超管零读写；改设置先审计、审计失败即拒且不写配置；入参不合法不审计
 *   M4 视图：没有数据写「—」不编 0、按日新到旧、失败只列出现过的、去处 key 与博物君两端一致、界面无集合名与原生弹窗
 *   M5 开关落地：C 端 museumGuideOpen 是内容开关与开馆状态的 AND；museumGuideFlag 是内容开关原值；
 *      save 写原值、不改开馆配置。小程序端开关归一与「我的」入口跟随
 *   M6 接线：页面注册在超管分包 / 菜单键仅超管 / 磁贴与处理函数带 canSeeMenu / 页内 guardStaffPage('super_admin') /
 *      两个新集合三处同步 + serverOnly / 部署清单
 *
 *   node miniprogram/scripts/test-museum-guide-monitor.mjs [--selftest]
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCjsModule } from './lib/cjs-loader.mjs'

const MP = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = join(MP, '..')
const P = {
  fn: join(MP, 'cloudfunctions/museumGuideMonitor/index.js'),
  flagsFn: join(MP, 'cloudfunctions/getContentDisplayFlags/index.js'),
  knowledge: join(MP, 'cloudfunctions/askMuseumGuide/knowledge.js'),
  view: join(MP, 'subpackages/manager/museum-guide-monitor/monitorView.js'),
  page: join(MP, 'subpackages/manager/museum-guide-monitor/index.js'),
  wxml: join(MP, 'subpackages/manager/museum-guide-monitor/index.wxml'),
  flagsUtil: join(MP, 'utils/contentDisplayFlags.js'),
  erpFlags: join(ROOT, 'admin/src/components/ContentDisplayFlags.vue'),
  atlasWxml: join(MP, 'subpackages/feature/collection/detail/index.wxml'),
  atlasJs: join(MP, 'subpackages/feature/collection/detail/index.js'),
  identifyWxml: join(MP, 'subpackages/feature/identify/result/index.wxml'),
  identifyJs: join(MP, 'subpackages/feature/identify/result/index.js'),
  homeJs: join(MP, 'pages/index/index.js'),
  roles: join(MP, 'utils/workspaceRoles.js'),
  hubNav: join(MP, 'subpackages/manager/manager/hubNav.js'),
  mgrCfg: join(MP, 'subpackages/manager/manager/managerPageConfig.js'),
  mgrWxml: join(MP, 'subpackages/manager/manager/index.wxml'),
  subviews: join(MP, 'subpackages/manager/manager/workspace/_subviews.wxml'),
  userWxml: join(MP, 'pages/user/index.wxml'),
  userJs: join(MP, 'pages/user/index.js'),
  appJson: join(MP, 'app.json'),
  rc: join(MP, 'cloudbaserc.json'),
  cloudJs: join(ROOT, 'admin/src/cloud.js'),
  sensitive: join(ROOT, 'cloudbase/sensitive-collections.json')
}

let INJECT = null
const transform = (file, src) => {
  if (!INJECT || INJECT.file !== file) return src
  if (src.indexOf(INJECT.find) === -1) throw new Error(`注入锚点失效：${INJECT.name}`)
  return src.replace(INJECT.find, INJECT.replace)
}
const read = (f) => transform(f, readFileSync(f, 'utf8'))

/** 内存库：按集合存文档；记录每次读写（门禁 / 审计顺序用） */
function memDb(seed) {
  const docs = JSON.parse(JSON.stringify(seed || {}))
  const ops = []
  const q = (name) => {
    const chain = {
      where: () => chain, orderBy: () => chain, skip: () => chain, limit: () => chain, field: () => chain,
      get: async () => { ops.push(['get', name]); return { data: Object.values(docs[name] || {}) } }
    }
    return chain
  }
  const db = {
    collection: (name) => Object.assign(q(name), {
      doc: (id) => ({
        get: async () => { ops.push(['get', name, id]); const d = (docs[name] || {})[id]; if (!d) throw new Error('document not exist'); return { data: d } },
        update: async ({ data }) => { ops.push(['update', name, id]); if (db.failUpdate) throw new Error('update failed'); const d = (docs[name] || {})[id]; if (!d) return { stats: { updated: 0 } }; Object.assign(d, data); return { stats: { updated: 1 } } },
        set: async ({ data }) => { ops.push(['set', name, id]); (docs[name] = docs[name] || {})[id] = Object.assign({}, data) }
      }),
      add: async ({ data }) => {
        ops.push(['add', name])
        if (db.failAdd && db.failAdd === name) throw new Error('add failed')
        const id = 'a' + ops.length; (docs[name] = docs[name] || {})[id] = Object.assign({ _id: id }, data); return { _id: id }
      }
    }),
    command: { gte: () => ({}), inc: (n) => n },
    serverDate: () => 0,
    docs,
    ops
  }
  return db
}

function loadMonitor(db, isSuper) {
  return loadCjsModule(P.fn, {
    transform,
    stubs: {
      'wx-server-sdk': { init() {}, DYNAMIC_CURRENT_ENV: 'x', database: () => db, getWXContext: () => ({ OPENID: 'admin1' }) },
      './staffGuard': { assertStaff: async (d, openid, opts) => (opts && opts.requireSuperAdmin && isSuper ? { ok: true, actor: { openid, name: '馆长' } } : { ok: false, code: 'FORBIDDEN', msg: '仅超管可查看' }) }
    },
    globals: { console: { warn() {}, log() {}, error() {} } }
  })
}

async function runChecks() {
  const fails = []
  const ok = (name, cond) => { if (!cond) fails.push(name) }

  /* ---------------- M1 报表聚合 ---------------- */
  const T = loadMonitor(memDb(), true)._test
  const now = Date.UTC(2026, 10, 23, 4) // 北京时间 11-23 12:00
  const row = (day, openid, status, extra) => Object.assign({ day, openid, status, duration_ms: 1000, species: [], actions: [], entry: 'user', model: 'qwen-plus' }, extra || {})
  const rows = [
    row('2026-11-23', 'a', 'ok', { duration_ms: 2000, species: [{ no: '001', zh: '大蓝闪蝶' }], actions: ['atlas'], vote: 'up' }),
    row('2026-11-23', 'a', 'ok', { duration_ms: 4000, species: [{ no: '001', zh: '大蓝闪蝶' }], vote: 'down' }),
    row('2026-11-23', 'a', 'quota'),
    row('2026-11-23', 'b', 'ai_service', { species: [{ no: '033', zh: '鹦鹉螺' }], vote: 'down' }),
    row('2026-11-21', 'c', 'answer_risky', { entry: 'atlas', vote: 'up' }),
    row('2026-11-21', 'c', 'off'),
    row('2026-11-10', 'z', 'ok')
  ]
  const s = T.summarize(rows, now, 7)
  const today = s.series[s.series.length - 1]
  ok('M1 按日补零（7 行、最后一行是今天）、窗口外不算', s.series.length === 7 && today.day === '2026-11-23' && s.series[0].day === '2026-11-17' && s.totals.asks === 6)
  ok('M1 今日：问 4 · 人 2 · 回答 2 · 单人最多 3', today.asks === 4 && today.users === 2 && today.ok === 2 && today.maxPerUser === 3 && today.failed === 1 && today.quota === 1)
  ok('M1 成功率分母只算问到模型那一步的（3/4 = 75%，不含额度满与闭馆）', s.totals.successRate === 75 && s.totals.answered === 3)
  ok('M1 物种 / 去处只算已回答（出错那条的鹦鹉螺不算）', s.topSpecies.length === 1 && s.topSpecies[0].no === '001' && s.topSpecies[0].n === 2 && s.actions[0].key === 'atlas')
  ok('M1 满意度：只算已回答里的票（出错那条的票不算）2/3', s.votes.up === 2 && s.votes.down === 1 && s.votes.rate === 66.7)
  ok('M1 耗时：平均 / 九成只算已回答', s.totals.avgMs === 2333 && s.totals.p90Ms === 4000)
  ok('M1 失败分布与 30 天窗口', s.fails.quota === 1 && s.fails.off === 1 && s.fails.answer_risky === 1 && s.fails.ai_service === 1 && T.summarize(rows, now, 30).series.length === 30 && T.summarize(rows, now, 30).totals.asks === 7)

  /* ---------------- M2 配置入参 ---------------- */
  ok('M2 配置入参：布尔开关、5–200 整数额度；空 / 越界 / 非整数 / 字符串开关拒绝',
    T.normalizeConfigInput({ enabled: false }).patch.enabled === false && T.normalizeConfigInput({ dailyLimit: 50 }).patch.dailyLimit === 50 &&
    !!T.normalizeConfigInput({}).error && !!T.normalizeConfigInput({ dailyLimit: 4 }).error && !!T.normalizeConfigInput({ dailyLimit: 201 }).error &&
    !!T.normalizeConfigInput({ dailyLimit: 2.5 }).error && !!T.normalizeConfigInput({ enabled: 'false' }).error)

  /* ---------------- M3 门禁与审计 ---------------- */
  const db1 = memDb()
  const denied = await loadMonitor(db1, false).main({ action: 'setConfig', enabled: false })
  const denied2 = await loadMonitor(db1, false).main({ action: 'overview' })
  ok('M3 非超管：拒绝且零读写', denied.success === false && denied.code === 'FORBIDDEN' && denied2.success === false && db1.ops.length === 0)
  const db2 = memDb()
  const set1 = await loadMonitor(db2, true).main({ action: 'setConfig', enabled: false })
  const iAudit = db2.ops.findIndex((o) => o[0] === 'add' && o[1] === 'admin_operation_logs')
  const iWrite = db2.ops.findIndex((o) => (o[0] === 'set' || o[0] === 'update') && o[1] === 'museum_guide_config')
  ok('M3 改设置：先审计后写配置；首次写带默认额度不丢开关', set1.success && set1.data.enabled === false && iAudit >= 0 && iWrite > iAudit &&
    db2.docs.museum_guide_config.main.enabled === false)
  const set2 = await loadMonitor(db2, true).main({ action: 'setConfig', dailyLimit: 20 })
  ok('M3 第二次只改额度：开关仍是闭馆', set2.success && set2.data.dailyLimit === 20 && set2.data.enabled === false)
  const dbK = memDb({ museum_guide_config: { main: { enabled: false, dailyLimit: 50 } } })
  dbK.failUpdate = true
  const setK = await loadMonitor(dbK, true).main({ action: 'setConfig', dailyLimit: 20 })
  ok('M3 更新失败走整份写：保留原来的闭馆状态', setK.success && dbK.docs.museum_guide_config.main.enabled === false && dbK.docs.museum_guide_config.main.dailyLimit === 20)
  const db3 = memDb()
  db3.failAdd = 'admin_operation_logs'
  const set3 = await loadMonitor(db3, true).main({ action: 'setConfig', enabled: false })
  ok('M3 审计写失败：拒绝且不写配置', set3.success === false && set3.code === 'AUDIT_FAILED' && !db3.ops.some((o) => o[1] === 'museum_guide_config' && o[0] !== 'get'))
  const db4 = memDb()
  const set4 = await loadMonitor(db4, true).main({ action: 'setConfig', dailyLimit: 999 })
  ok('M3 入参不合法：拒绝、不审计不写', set4.success === false && set4.code === 'BAD_INPUT' && !db4.ops.some((o) => o[0] !== 'get'))
  const db5 = memDb({ museum_guide_logs: { l1: row('2026-11-23', 'a', 'ok') } })
  const ov = await loadMonitor(db5, true).main({ action: 'overview', days: 30 })
  ok('M3 overview：只读（零写入）、带当前配置', ov.success && ov.data.days === 30 && ov.data.config.enabled === true && !db5.ops.some((o) => o[0] !== 'get'))

  /* ---------------- M4 视图 ---------------- */
  const V = loadCjsModule(P.view, { transform })
  const empty = V.buildView({ days: 7, series: [{ day: '2026-11-22', asks: 0, users: 0 }, { day: '2026-11-23', asks: 0, users: 0 }], totals: {}, today: {}, fails: {}, config: { enabled: true, defaultLimit: 30 } })
  ok('M4 没有数据写「—」不编 0（成功率 / 耗时 / 单人最多 / 满意度）', /满意度 —/.test(empty.satisfactionText) && /满意度 66\.7%（有帮助 2 · 没帮助 1）/.test(V.buildView(s).satisfactionText) && empty.kpis[2].v === '—' && empty.kpis[3].v === '—' && empty.kpis[4].v === '—' && empty.kpis[5].v === '—' && empty.bars.every((b) => b.width === 0))
  const full = V.buildView(Object.assign({}, s, { config: { enabled: false, dailyLimit: 20, defaultLimit: 30 } }))
  ok('M4 按日新到旧、最大一天 100%、失败只列出现过的、闭馆状态与额度文案',
    full.bars[0].day === '2026-11-23' && full.bars[0].width === 100 && full.fails.every((f) => f.n > 0) && full.fails.length === 4 &&
    full.config.stateText === '闭馆中' && /20 问/.test(full.config.limitText) && full.kpis[5].v === '3 / 20')
  const notDeployed = V.friendlyError({ errMsg: 'cloud.callFunction:fail Error: errCode: -505005 | errMsg: FunctionName parameter could not be found. 更多错误信息请访问：https://docs.cloudbase.net/error-code/basic/FUNCTIONS_NOT_FOUND' })
  const timeoutErr = V.friendlyError({ errMsg: 'Error: task timeout' })
  const businessErr = Object.assign(new Error('只读模式'), { business: true })
  ok('M7 取数失败只给一句话（不渲染 errMsg / 堆栈 / 文档链接）；未部署 / 超时 / 业务错误分开',
    notDeployed === V.ERROR_NOT_DEPLOYED && !/errCode|docs\.cloudbase|callFunction/i.test(notDeployed) &&
    /超时/.test(timeoutErr) && V.friendlyError(businessErr) === '只读模式' &&
    /loadError: V\.friendlyError\(e\)/.test(read(P.page)) && !/没能取回报表/.test(read(P.page)))
  const K = loadCjsModule(P.knowledge, {})
  ok('M4 去处 key 与博物君云函数一致', Object.keys(V.PLACE_LABELS).sort().join() === K.PLACE_KEYS.slice().sort().join())
  const wxml = read(P.wxml)
  const pageJs = read(P.page)
  ok('M4 界面无集合名 / 字段名、页面无原生弹窗、页内说明不记原文', !/museum_guide|openid|_id\b|created_at/.test(wxml) && !/wx\.show(Modal|Toast)/.test(pageJs) && /不记录问题与回答原文/.test(wxml))
  ok('M4 开关两步确认（第一下只亮出确认）', /if \(!this\.data\.confirmToggle\) \{/.test(pageJs) && /再点一次确认闭馆/.test(wxml))

  /* ---------------- M5 开关落地 ---------------- */
  const flagDb = (cfg, patch) => memDb(Object.assign({ content_display_flags: { f1: Object.assign({ _id: 'f1', status: 'active', priority: 100, showAiIdentify: true }, patch || {}) } }, cfg ? { museum_guide_config: { main: cfg } } : {}))
  const loadFlags = (db) => loadCjsModule(P.flagsFn, {
    transform,
    stubs: { 'wx-server-sdk': { init() {}, DYNAMIC_CURRENT_ENV: 'x', database: () => db, getWXContext: () => ({ OPENID: 'u1' }), serverDate: () => 0 }, './staffGuard': { assertStaff: async () => ({ ok: true, actor: { openid: 'm' } }), ROLE_MANAGER: 'manager' } },
    globals: { console: { warn() {}, log() {}, error() {} } }
  })
  const fOff = await loadFlags(flagDb({ enabled: false })).main({})
  const fNone = await loadFlags(flagDb(null)).main({})
  const fFlagOff = await loadFlags(flagDb({ enabled: true }, { museumGuideOpen: false })).main({})
  const fBoth = await loadFlags(flagDb({ enabled: true }, { museumGuideOpen: true })).main({})
  const saveDb = flagDb({ enabled: false }, { museumGuideOpen: true })
  const saveRes = await loadFlags(saveDb).main({ action: 'save', flags: { showAiIdentify: true, museumGuideOpen: true } })
  const roundDb = flagDb({ enabled: false }, { museumGuideOpen: true, showGift: false })
  const roundView = await loadFlags(roundDb).main({})
  await loadFlags(roundDb).main({ action: 'save', flags: { showGift: true, museumGuideOpen: roundView.flags.museumGuideFlag, showAiIdentify: true } })
  ok('M5 两把开关取 AND 给 C 端，原值在 museumGuideFlag；保存写原值、不改开馆配置',
    fOff.flags.museumGuideOpen === false && fOff.flags.museumGuideFlag === true &&
    fNone.flags.museumGuideOpen === true && fNone.flags.museumGuideFlag === true &&
    fFlagOff.flags.museumGuideOpen === false && fFlagOff.flags.museumGuideFlag === false &&
    fBoth.flags.museumGuideOpen === true && fBoth.flags.museumGuideFlag === true &&
    fOff.flags.showAiIdentify === true &&
    saveDb.docs.museum_guide_config.main.enabled === false &&
    saveRes.flags.museumGuideOpen === true &&
    saveDb.docs.content_display_flags.f1.museumGuideOpen === true &&
    roundView.flags.museumGuideOpen === false && roundView.flags.museumGuideFlag === true &&
    roundDb.docs.content_display_flags.f1.museumGuideOpen === true &&
    roundDb.docs.content_display_flags.f1.showGift === true)
  ok('M5 ERP「商品内容-开关」有博物君开关（读 / 写 / 默认三处齐全）',
    /v-model="form\.museumGuideOpen"/.test(read(P.erpFlags)) && /form\.museumGuideOpen = raw\.museumGuideOpen !== false/.test(read(P.erpFlags)) &&
    /museumGuideOpen: form\.museumGuideOpen !== false/.test(read(P.erpFlags)) && /museumGuideOpen: true/.test(read(P.erpFlags)))
  ok('M5 关闭后 C 端不残留 AI 入口：图鉴详情 / 识别结果都按 guideOpen 隐藏，并各自拉取开关',
    /wx:if="\{\{guideOpen\}\}"[^>]*bindtap="askGuide"/.test(read(P.atlasWxml)) &&
    /loadGuideOpen\(\)/.test(read(P.atlasJs)) && /museumGuideOpen !== false/.test(read(P.atlasJs)) &&
    /wx:if="\{\{guideOpen && speciesInfo\.species_name_zh/.test(read(P.identifyWxml)) &&
    /loadGuideOpen\(\)/.test(read(P.identifyJs)) && /museumGuideOpen !== false/.test(read(P.identifyJs)))
  ok('M5 关闭后首页口播整条清空（不留任何 AI 内容）',
    /if \(flags\.museumGuideOpen === false\)/.test(read(P.homeJs)) && /cast: \{ hello: '', items: \[\]/.test(read(P.homeJs)))
  ok('M5 小程序端开关归一（缺省开启）与「我的」入口跟随', /museumGuideOpen: src\.museumGuideOpen !== false/.test(read(P.flagsUtil)) &&
    /data-path="museumGuide" wx:if="\{\{museumGuideOpen\}\}"/.test(read(P.userWxml)) && /museumGuideOpen: flags\.museumGuideOpen !== false/.test(read(P.userJs)))

  // M7（2026-11-25 产品负责人）：内容开关面板同步博物君开关 + 跳转管理详情
  const mgrCfg = read(P.mgrCfg)
  const mgrWxml = read(P.mgrWxml)
  const subviews = read(P.subviews)
  ok('M7 内容开关页：博物君开关 + 「博物君管理详情」入口，保存带上该字段，面板读原值不读 AND',
    /data-field="museumGuideOpen"/.test(subviews) && /(?:bind|catch)tap="goMuseumGuideMonitorGuarded"/.test(subviews) &&
    /museumGuideOpen: typeof flags\.museumGuideFlag === 'boolean'[\s\S]{0,120}flags\.museumGuideFlag[\s\S]{0,80}flags\.museumGuideOpen !== false/.test(mgrCfg) &&
    /museumGuideOpen: true/.test(mgrCfg) &&
    /museumGuideOpen: incoming\.museumGuideOpen/.test(read(P.flagsFn)) &&
    /museumGuideFlag: storedGuideOpen/.test(read(P.flagsFn)))
  /* ---------------- M6 接线 ---------------- */
  const app = JSON.parse(readFileSync(P.appJson, 'utf8'))
  const mgr = app.subpackages.find((x) => /subpackages\/manager\/?$/.test(x.root))
  ok('M6 页面在超管分包', !!mgr && mgr.pages.includes('museum-guide-monitor/index'))
  const roles = read(P.roles)
  ok('M6 菜单键只在超管（不进任何角色分组）', /MUSEUM_GUIDE_MONITOR: 'museumGuideMonitor'/.test(roles) && (roles.match(/MENU_KEYS\.MUSEUM_GUIDE_MONITOR/g) || []).length === 0)
  // 2026-11-26 超管工作台归并：博物君可为系统分区组合「AI 监测」的子功能 —— keys / tap 不变，组合磁贴按同一菜单键显示
  const navSrc = read(P.hubNav)
  const kitBlock = (navSrc.match(/\n  \{\n    id: '\w+',[^\n]*sec: 'system',\n    children: \[[\s\S]*?\n    \]\n  \}/g) || []).find((b) => /\{ id: 'museumGuide',[^\n]*keys: \['museumGuideMonitor'\], tap: 'goMuseumGuideMonitorGuarded'/.test(b))
  const kitId = kitBlock && (kitBlock.match(/id: '(\w+)'/) || [])[1]
  const kitTile = kitId && new RegExp(`data-fid="${kitId}" wx:if="\\{\\{([^}]*)\\}\\}" bindtap="openHubKitPage" data-kit="${kitId}"`).exec(read(P.mgrWxml))
  const viaKit = !!kitTile && kitTile[1].split('||').map((x) => x.trim()).includes('menu.museumGuideMonitor')
  ok('M6 磁贴：系统监测分区 + 处理函数先 canSeeMenu + 跳超管页；wxml 磁贴按菜单显隐（独立磁贴，或系统分区组合的子功能）',
    (viaKit || (/id: 'museumGuide'[^\n]*sec: 'system', keys: \['museumGuideMonitor'\], tap: 'goMuseumGuideMonitorGuarded'/.test(navSrc) &&
      /wx:if="\{\{menu\.museumGuideMonitor\}\}" bindtap="goMuseumGuideMonitorGuarded"/.test(read(P.mgrWxml)))) &&
    /goMuseumGuideMonitorGuarded\(\) \{\s*\n\s*if \(!canSeeMenu\(this\.data\.workspaceRole, MENU_KEYS\.MUSEUM_GUIDE_MONITOR\)\) return;/.test(read(P.mgrCfg)))
  ok('M6 页内 guardStaffPage(super_admin)、云函数 requireSuperAdmin', /await guardStaffPage\('super_admin'\)/.test(pageJs) && /assertStaff\(db, openid, \{ requireSuperAdmin: true \}\)/.test(read(P.fn)))
  const sens = JSON.parse(readFileSync(P.sensitive, 'utf8'))
  const cloudJs = readFileSync(P.cloudJs, 'utf8')
  ok('M6 两个新集合：规则全拒 + schema + COLLECTIONS + serverOnly',
    ['museum_guide_logs', 'museum_guide_config'].every((c) => {
      const rule = join(ROOT, `cloudbase/rules/${c}.json`)
      if (!existsSync(rule)) return false
      const r = JSON.parse(readFileSync(rule, 'utf8'))
      return r.read === false && r.write === false && existsSync(join(ROOT, `cloudbase/schema/${c}.md`)) && cloudJs.indexOf(`'${c}'`) >= 0 && sens.serverOnly.includes(c)
    }))
  const rc = JSON.parse(readFileSync(P.rc, 'utf8'))
  const fnNames = (rc.functions || []).map((f) => f.name)
  ok('M6 部署清单含 askMuseumGuide / museumGuideMonitor', fnNames.includes('askMuseumGuide') && fnNames.includes('museumGuideMonitor'))
  return fails
}

const INJECTIONS = [
  { name: '成功率分母含额度满', file: P.fn, find: "const COUNTED = ['ok', 'answer_risky', 'ai_service', 'risky']", replace: "const COUNTED = ['ok', 'answer_risky', 'ai_service', 'risky', 'quota', 'off']" },
  { name: '出错的也算物种', file: P.fn, find: "      ;(r.species || []).forEach((sp) => {", replace: "    }\n    {\n      ;(r.species || []).forEach((sp) => {" },
  { name: '额度不设上限', file: P.fn, find: 'n < LIMIT_MIN || n > LIMIT_MAX', replace: 'n < LIMIT_MIN' },
  { name: '审计失败照写配置', file: P.fn, find: "    return fail('AUDIT_FAILED', `修改须先记审计日志，写入失败：${(e && e.message) || e}`)", replace: '    console.warn(e)' },
  { name: '首次写丢了开关', file: P.fn, find: '    const keep = { enabled: before.enabled }', replace: '    const keep = { enabled: true }' },
  { name: '非超管也放行', file: P.fn, find: 'if (!guard.ok) return fail(', replace: 'if (false) return fail(' },
  { name: '出错的票也算满意度', file: P.fn, find: "    if (r.status === 'ai_service') d.failed += 1", replace: "    if (r.status === 'ai_service' && r.vote) votes[r.vote] += 1\n    if (r.status === 'ai_service') d.failed += 1" },
  { name: '没数据编 0', file: P.view, find: "  return typeof r === 'number' ? `${r}%` : '—'", replace: "  return `${r || 0}%`" },
  { name: '开关一下就改', file: P.page, find: '    if (!this.data.confirmToggle) {', replace: '    if (false) {' },
  { name: '内容开关读不到就关', file: P.flagsFn, find: '  } catch (e) {\n    return true\n  }', replace: '  } catch (e) {\n    return false\n  }' },
  { name: '内容开关不带出博物君', file: P.flagsFn, find: 'flags: Object.assign({}, res.flags, { museumGuideOpen, museumGuideFlag: storedGuideOpen })', replace: 'flags: res.flags' },
  { name: '内容开关面板把闭馆结果写回原值', file: P.mgrCfg, find: 'museumGuideOpen: typeof flags.museumGuideFlag === \'boolean\'\n            ? flags.museumGuideFlag\n            : flags.museumGuideOpen !== false,', replace: 'museumGuideOpen: flags.museumGuideOpen !== false,' },
  { name: '小程序端缺省关闭', file: P.flagsUtil, find: 'museumGuideOpen: src.museumGuideOpen !== false', replace: 'museumGuideOpen: src.museumGuideOpen === true' },
  { name: '错误原文又渲染给超管', file: P.page, find: 'loadError: V.friendlyError(e)', replace: 'loadError: `没能取回报表：${(e && e.message) || e}`' },
  { name: '内容开关漏了博物君字段（保存会把它重置）', file: P.flagsFn, find: '    museumGuideOpen: incoming.museumGuideOpen,\n', replace: '' },
  { name: '内容开关页丢了博物君开关', file: P.subviews, find: 'data-field="museumGuideOpen"', replace: 'data-field="museumGuideOpenX"' },
  { name: '磁贴处理函数不判权限', file: P.mgrCfg, find: '    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.MUSEUM_GUIDE_MONITOR)) return;\n', replace: '' }
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
  if (bad) { console.error(`\n✗ test:museum-guide-monitor 自检失败 ${bad} 项`); process.exit(1) }
  console.log(`✓ test:museum-guide-monitor 自检通过（${INJECTIONS.length} 条内存注入全部检出，未写盘）`)
} else {
  const fails = await runChecks()
  if (fails.length) { console.error('✗ 博物君超管开关与监测不合格：\n  - ' + fails.join('\n  - ')); process.exit(1) }
  console.log('✓ test:museum-guide-monitor：报表聚合 / 配置入参 / 门禁与审计先行 / 视图不编 0 / 开关落地且不被内容开关保存冲掉 / 接线 全部通过')
}
