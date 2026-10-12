#!/usr/bin/env node
/**
 * test:wish-labels —— 「马上有 · 心愿签」（2026-10-13 祈福墙前台重做）守卫
 * 蓝图：miniprogram/docs/马上有心愿签_重设计蓝图_2026-10-13.md
 *
 * 真跑页面真源（stub 只替换网络 / 会话 / 埋点），钉住：
 *   A 纯函数：编号取 _id 末 4 位、本地条目无编号、日期北京时间、空时间不出占位、两列交替、
 *     公开行只用 echoCount（无 openid 字段进视图）
 *   B 闸门：未开放 / 读失败**不发任何云调用**；开放后才 list + mine
 *   C 写签：游客 → 注册弹层且**不 post**；post 失败 → 不落签、草稿保留；成功 → 新签置顶、额度 −1、弹层收起
 *   D 我也想要：自己的签 / 本地条目不调用；成功后按钮态与计数更新并本地记住
 *   E 版式（产品负责人拍板）：首屏不显示统计数字；实心金只给「写一张心愿签 / 别上墙」；
 *     不再有木鱼 / 点灯 / 功德 / 弹幕等旧仪式；不用原生 toast；分享不传 cloud:// 封面
 *   F 云函数：echo 幂等键稳定且不含明文 openid；公开行只多回 echoCount
 *
 * 用法：node miniprogram/scripts/test-wish-labels.mjs [--selftest]
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const PAGE = join(MP, 'subpackages/feature/wish-labels/index')
const LABELS = join(MP, 'subpackages/feature/wish-labels/labels.js')
const FN = join(MP, 'cloudfunctions/manageWishWall/index.js')

let INJECT = null
const read = (p) => {
  const src = readFileSync(p, 'utf8')
  if (!INJECT || INJECT.file !== p) return src
  if (!src.includes(INJECT.find)) throw new Error(`注入锚点失效：${INJECT.name}`)
  return src.split(INJECT.find).join(INJECT.replace)
}

/** 极简 CJS 加载：相对路径按文件解析，命中 stubs（按路径尾匹配）即替换 */
function loadCjs(file, stubs, cache = new Map()) {
  const abs = file.endsWith('.js') ? file : file + '.js'
  if (cache.has(abs)) return cache.get(abs).exports
  const mod = { exports: {} }
  cache.set(abs, mod)
  const req = (name) => {
    for (const [tail, val] of Object.entries(stubs)) if (name.endsWith(tail)) return val
    if (!name.startsWith('.')) throw new Error('unexpected require ' + name)
    return loadCjs(resolve(dirname(abs), name), stubs, cache)
  }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', read(abs))(mod, mod.exports, req)
  return mod.exports
}

async function runChecks() {
  const fails = []
  const ok = (name, cond) => { if (!cond) fails.push(name) }

  /* ---------------- A 纯函数 ---------------- */
  const L = loadCjs(LABELS, {})
  ok('A1 编号取 _id 末 4 位大写', L.labelNo('7794572a6a11c6b0abcd') === 'No.ABCD')
  ok('A2 本地乐观条目 / 空 id 无编号（不编流水号）', L.labelNo('local-123') === '' && L.labelNo('') === '')
  ok('A3 日期按北京时间（UTC 16:30 = 次日）', L.labelDate(Date.UTC(2026, 9, 12, 16, 30)) === '2026.10.13')
  ok('A4 无时间不出占位', L.labelDate(null) === '' && L.labelDate('') === '')
  const lab = L.toLabel({ _id: 'x1', text: ' 马上有  光 ', nickname: '', source: 'seed', echoCount: '3', _openid: 'o1', openid: 'o1' }, Date.now(), new Set(['x1']))
  ok('A5 公开行 → 标签：文案归一、匿名兜底、馆方标记、计数、已点', lab.text === '马上有 光' && lab.author === '匿名藏家' && lab.official && lab.echoCount === 3 && lab.echoed)
  ok('A6 视图不携带 openid', !('openid' in lab) && !('_openid' in lab))
  const cols = L.splitColumns([1, 2, 3, 4, 5].map((i) => ({ _id: String(i) })))
  ok('A7 两列交替入列', cols[0].map((x) => x._id).join() === '1,3,5' && cols[1].map((x) => x._id).join() === '2,4')

  /* ---------------- 页面加载 ---------------- */
  const calls = []
  const deleted = []
  let lastPost = null
  const store = {}
  let flags = { showMaShangYou: true }
  let flagsThrow = false
  let guest = false
  let postResult = { success: true, _id: 'srv0001', nickname: '小满' }
  let echoResult = { success: true, echoCount: 4 }
  let mineList = []
  const prevWx = globalThis.wx
  globalThis.wx = {
    getStorageSync: (k) => store[k],
    setStorageSync: (k, v) => { store[k] = v },
    showToast: () => { fails.push('E 页面调用了原生 wx.showToast') },
    vibrateShort: () => {},
    pageScrollTo: () => {},
    navigateTo: () => {},
    stopPullDownRefresh: () => {},
    cloud: {
      uploadFile: async () => ({ fileID: 'cloud://env.x/wish-voice/1_a.mp3' }),
      deleteFile: async ({ fileList }) => { deleted.push(...fileList); return {} },
      callFunction: async ({ data }) => {
        lastPost = data.action === 'post' ? data : lastPost
        calls.push(data.action)
        if (data.action === 'list') return { result: { success: true, list: [{ _id: 'w0000aaaa', text: '马上有钱', nickname: '藏家', createTime: Date.now() - 60000, echoCount: 2 }, { _id: 'w0000bbbb', text: '马上有晴', source: 'seed' }], inspiration: ['马上有闲', '马上有缘'] } }
        if (data.action === 'mine') return { result: { success: true, list: mineList } }
        if (data.action === 'post') return { result: postResult }
        if (data.action === 'echo') return { result: echoResult }
        return { result: {} }
      }
    }
  }
  const stubs = {
    '/utils/customNav': { getCustomNavLayout: () => ({ statusBarHeight: 20, navBarHeight: 44 }) },
    '/utils/trackBehavior': { trackBehavior: () => {} },
    '/utils/contentDisplayFlags': {
      fetchContentDisplayFlags: async () => { if (flagsThrow) throw new Error('net'); return { flags } },
      toastWishWallClosed: () => {}
    },
    '/utils/userSession': { ensureSession: async () => ({ authState: guest ? 'guest' : 'member', user: { nickName: '小满' } }), refreshSessionAfterAuth: async () => {} },
    '/utils/profileHelper': { resolveAuthState: () => (guest ? 'guest' : 'member') }
  }
  let cfg = null
  const prevPage = globalThis.Page
  globalThis.Page = (c) => { cfg = c }
  const sharedStubs = Object.assign({}, stubs)
  // 页面里 userSession / profileHelper 是函数内 require：同一 stubs 表兜住
  loadCjs(PAGE, sharedStubs)
  globalThis.Page = prevPage
  const mk = () => {
    const p = Object.assign(Object.create(null), cfg)
    p.data = JSON.parse(JSON.stringify(cfg.data))
    p.setData = function (patch) { Object.assign(this.data, patch) }
    return p
  }
  const tick = () => new Promise((r) => setTimeout(r, 0))

  /* ---------------- B 闸门 ---------------- */
  flags = { showMaShangYou: false }
  const closed = mk(); closed.onLoad({}); await tick(); await tick()
  ok('B1 未开放：不发任何云调用、显示未开放', calls.length === 0 && closed.data.allowed === false && closed.data.flagChecked === true && closed.data.gateError === false)
  flagsThrow = true
  const broken = mk(); broken.onLoad({}); await tick(); await tick()
  ok('B2 开关读失败：gateError（与「未开放」分开），不发云调用', calls.length === 0 && broken.data.gateError === true)
  flagsThrow = false
  flags = { showMaShangYou: true }
  const page = mk(); page.onLoad({ scene: 'from=store_qr&k=mashangyou' }); await tick(); await tick(); await tick()
  ok('B3 开放后 list + mine，来源记 store_qr', calls.join() === 'list,mine' && page.data.entryFrom === 'store_qr')
  ok('B4 首屏露角 ≤ 3 张，墙两列', page.data.peek.length === 2 && page.data.columns[0].length === 1)

  /* ---------------- C 写签 ---------------- */
  guest = true
  page.setData({ draft: '马上有底气' })
  calls.length = 0
  const r1 = await page.submitWish()
  ok('C1 游客：弹注册且不 post，待续文案记住', r1 === false && page.data.showRegisterDialog === true && !calls.includes('post') && page._pendingWish === '马上有底气')
  guest = false
  page.setData({ showRegisterDialog: false })
  postResult = { success: false, msg: '这条心愿没能通过检测，换句话说说看' }
  const before = page.data.columns[0].length + page.data.columns[1].length
  const r2 = await page.submitWish()
  ok('C2 post 失败：不落签、草稿保留、给出原因', r2 === false && page.data.draft === '马上有底气' && page.data.columns[0].length + page.data.columns[1].length === before && page.data.toastTitle === '这条心愿没能通过检测，换句话说说看')
  postResult = { success: true, _id: 'srv0001', nickname: '小满' }
  page.setData({ composeOpen: true })
  const left0 = page.data.quota.left
  const r3 = await page.submitWish()
  const first = page.data.columns[0][0]
  ok('C3 成功：新签置顶并标「刚别上」、额度 −1、弹层收起、草稿清空', r3 === true && first && first._id === 'srv0001' && first.fresh === true && first.isMine === true && page.data.quota.left === left0 - 1 && page.data.composeOpen === false && page.data.draft === '')
  // 语音：失败要删掉刚传的文件；成功带上 fileID 与时长，新签对作者标「声音审核中」
  postResult = { success: false, msg: '慢一点' }
  page.setData({ draft: '马上有回音', voicePath: '/tmp/v.mp3', voiceSec: 8, quota: { used: 1, left: 4, cap: 5, exhausted: false } })
  await page.submitWish()
  ok('C5 带声音但 post 失败：删掉刚上传的声音、录音保留', deleted.includes('cloud://env.x/wish-voice/1_a.mp3') && page.data.voicePath === '/tmp/v.mp3')
  postResult = { success: true, _id: 'srv0002', nickname: '小满' }
  await page.submitWish()
  const vfresh = page._wall[0]
  ok('C6 带声音成功：post 带 fileID + 时长；新签作者可听、标声音审核中；录音清空', lastPost && lastPost.voiceFileID === 'cloud://env.x/wish-voice/1_a.mp3' && lastPost.voiceDuration === 8 && vfresh._id === 'srv0002' && vfresh.voiceTag === '声音审核中' && vfresh.voiceUrl === '/tmp/v.mp3' && page.data.voicePath === '')
  page.setData({ quota: { used: 5, left: 0, cap: 5, exhausted: true }, draft: '马上有光' })
  calls.length = 0
  const r4 = await page.submitWish()
  ok('C4 额度用完：不 post', r4 === false && !calls.includes('post'))

  /* ---------------- D 我也想要 ---------------- */
  calls.length = 0
  page.setData({ card: Object.assign({}, first) })
  await page.toggleEcho()
  ok('D1 自己的签不调用 echo', !calls.includes('echo'))
  const other = page._wall.find((l) => l._id === 'w0000aaaa')
  page.setData({ card: Object.assign({}, other) })
  await page.toggleEcho()
  ok('D2 成功：按钮态已点、计数取服务端、本地记住', calls.includes('echo') && page.data.card.echoed === true && page.data.card.echoCount === 4 && (store.wish_labels_echoed_v1 || []).includes('w0000aaaa'))
  calls.length = 0
  await page.toggleEcho()
  ok('D3 已点过不再调用', !calls.includes('echo'))
  page.setData({ card: { _id: 'local-1', isMine: false, echoed: false, echoCount: 0 } })
  await page.toggleEcho()
  ok('D4 本地乐观条目不调用', !calls.includes('echo'))
  const share = page.onShareAppMessage()
  ok('E1 分享：不传封面（cloud:// 分享卡不认），路径指新页', !('imageUrl' in share) && /wish-labels\/index\?productKey=/.test(share.path))
  page.onUnload()
  ok('D5 离页取消滚墙定时器', !page._wallTimer)
  globalThis.wx = prevWx

  /* ---------------- E 版式 ---------------- */
  const wxml = read(PAGE + '.wxml')
  const wxss = read(PAGE + '.wxss')
  const js = read(PAGE + '.js')
  ok('E2 首屏不显示统计数字（产品负责人拍板）', !/(\d|\}\})\s*(<\/text>)?\s*张心愿签|今日新签|位写签人|wl-stats/.test(wxml))
  ok('E3 实心金只给主操作：wl-primary 仅「写一张心愿签」与「别上墙」两处（不同屏）', (wxml.match(/class="wl-primary/g) || []).length === 2 && /写一张心愿签/.test(wxml) && /别上墙/.test(wxml))
  ok('E4 今日一签是文字链（非实心钮）', /class="wl-link"[^>]*bindtap="goQian"/.test(wxml))
  ok('E5 旧仪式不再出现（木鱼 / 点灯 / 功德 / 弹幕 / 音效）', !/木鱼|点灯|功德|danmaku|弹幕|音效/.test(wxml + js))
  ok('E6 不用原生 toast / modal', !/wx\.show(Toast|Modal)\(/.test(js))
  ok('E7 展品文案只取出处配置（exhibit.*），不在页里写死人设句', /\{\{exhibit\.line\}\}/.test(wxml) && !/站在店里|展柜旁/.test(wxml))
  ok('E8 墙标题走全站分区口径', /<text class="mu-en">THE WALL<\/text><text class="mu-cn">心愿签墙<\/text>/.test(wxml))
  ok('E9 实拍渐隐接页面底色', /\.wl-hero-shade\s*\{[^}]*#151412 100%/.test(wxss))

  /* ---------------- F 云函数 ---------------- */
  const fnSrc = read(FN)
  ok('F1 echo 走独立集合、按主键判重、首次写入才 +1', /const ECHO_COLLECTION = 'wish_wall_echoes'/.test(fnSrc) && /if \(!already\) await db\.collection\(COLLECTION\)\.doc\(id\)\.update\(\{ data: \{ echoCount: _\.inc\(1\) \} \}\)/.test(fnSrc))
  ok('F2 自己的签 / 被收起的签不能点', /doc\._openid === openid/.test(fnSrc) && /doc\.status === STATUS_HIDDEN/.test(fnSrc))
  const fnReq = createRequire(FN)
  let fn = null
  try {
    const realCloud = { init: () => {}, DYNAMIC_CURRENT_ENV: 'x', database: () => ({ command: { inc: (n) => n }, collection: () => ({}) }), getWXContext: () => ({}) }
    fn = loadCjs(FN, { 'wx-server-sdk': realCloud, crypto: fnReq('crypto'), './staffGuard': {}, './qwenText': {} , './wishSeeds': new Proxy({}, { get: () => () => [] }) })
  } catch (e) {
    fails.push('F 云函数加载失败：' + e.message)
  }
  if (fn) {
    const k1 = fn.echoKey('m1', 'openid-AAA')
    ok('F3 幂等键稳定、含签 id、不含明文 openid', k1 === fn.echoKey('m1', 'openid-AAA') && k1.startsWith('m1_') && !k1.includes('openid-AAA') && k1 !== fn.echoKey('m1', 'openid-BBB'))
    const pub = fn.mapPublicItem({ _id: 'a', text: 't', _openid: 'o', openid: 'o', status: 'visible', echoCount: 5 })
    ok('F4 公开行只多回 echoCount，不回 openid / status', pub.echoCount === 5 && !('openid' in pub) && !('_openid' in pub) && !('status' in pub))
  }
  if (fn) {
    ok('F6 语音入参：只收 wish-voice/ 下、1–15 秒，新签一律待试听', fn.parseVoice({ voiceFileID: 'cloud://e/wish-voice/a.mp3', voiceDuration: 8 }).voiceStatus === 'pending' &&
      !!fn.parseVoice({ voiceFileID: 'cloud://e/gift/voice/a.mp3', voiceDuration: 8 }).error &&
      !!fn.parseVoice({ voiceFileID: 'cloud://e/wish-voice/a.mp3', voiceDuration: 16 }).error && fn.parseVoice({}) === null)
    const pend = fn.mapPublicItem({ _id: 'a', text: 't', voiceFileID: 'cloud://e/wish-voice/a.mp3', voiceDuration: 8, voiceStatus: 'pending' })
    const appr = fn.mapPublicItem({ _id: 'a', text: 't', voiceFileID: 'cloud://e/wish-voice/a.mp3', voiceDuration: 8, voiceStatus: 'approved' })
    ok('F7 公开行：待试听的声音不露、通过的只给时长不给 fileID', pend.voiceDuration === 0 && appr.voiceDuration === 8 && !('voiceFileID' in appr))
  }
  ok('F8 试听结论条件更新（只改 pending）、驳回删文件', /where\(\{ _id: id, voiceStatus: VOICE_PENDING \}\)\.update/.test(fnSrc) && /cloud\.deleteFile\(\{ fileList: \[doc\.voiceFileID\] \}\)/.test(fnSrc))
  ok('F9 公开列表只给已通过的声音换链接', /attachVoiceUrls\(composed\.map\(mapPublicItem\), composed, \(d\) => d\.voiceStatus === VOICE_APPROVED\)/.test(fnSrc))
  const rules = JSON.parse(readFileSync(join(MP, '../cloudbase/rules/wish_wall_echoes.json'), 'utf8'))
  ok('F5 echo 集合客户端不可读写', rules.read === false && rules.write === false)
  return fails
}

const INJECTIONS = [
  { name: '编号改成流水号', file: LABELS, find: "return 'No.' + s.slice(-4).toUpperCase()", replace: "return 'No.0001'" },
  { name: '闸门关闭仍拉列表', file: PAGE + '.js', find: '    if (!allowed) return\n    void this.resolveExhibit()', replace: '    void this.refresh()\n    if (!allowed) return\n    void this.resolveExhibit()' },
  { name: '游客直接 post', file: PAGE + '.js', find: "    if (!resuming && await this.isGuestUser()) {", replace: '    if (false) {' },
  { name: '失败也落签', file: PAGE + '.js', find: "    if (!result || !result.success) {\n      this.setData({ posting: false })", replace: "    if (false) {\n      this.setData({ posting: false })" },
  { name: '自己的签也能点', file: PAGE + '.js', find: '    if (!card || card.echoed || card.isMine || this.data.echoBusy) return', replace: '    if (!card || card.echoed || this.data.echoBusy) return' },
  { name: '首屏加回统计数字', file: PAGE + '.wxml', find: '  <!-- 最新三张露角，点即看墙 -->', replace: '  <view class="wl-stats"><text>57</text>张心愿签</view>\n  <!-- 最新三张露角，点即看墙 -->' },
  { name: '今日一签改实心钮', file: PAGE + '.wxml', find: '<text class="wl-link" bindtap="goQian"', replace: '<view class="wl-primary" bindtap="goQianX"></view><text class="wl-link" bindtap="goQian"' },
  { name: '分享带 cloud:// 封面', file: PAGE + '.js', find: "    return { title: (ex && ex.line) || '马上有 · 心愿签', path }", replace: "    return { title: (ex && ex.line) || '马上有 · 心愿签', path, imageUrl: this.data.cover }" },
  { name: '每次都加计数（不判重）', file: FN, find: '  if (!already) await db.collection(COLLECTION)', replace: '  if (true) await db.collection(COLLECTION)' },
  { name: '语音路径不校验', file: FN, find: "fileID.indexOf(VOICE_DIR) === -1", replace: 'false' },
  { name: '公开行露出待试听的声音', file: FN, find: 'voiceDuration: doc.voiceStatus === VOICE_APPROVED && doc.voiceFileID ?', replace: 'voiceDuration: doc.voiceFileID ?' },
  { name: '发布失败不删声音', file: PAGE + '.js', find: '      if (voiceFileID) deleteCloudVoice(voiceFileID)\n', replace: '' },
  { name: '公开领链接不看试听状态', file: FN, find: "composed, (d) => d.voiceStatus === VOICE_APPROVED)", replace: 'composed, () => true)' },
  { name: '公开行回 openid', file: FN, find: '    echoCount: Math.max(0, parseInt(doc.echoCount, 10) || 0)\n  }', replace: '    echoCount: Math.max(0, parseInt(doc.echoCount, 10) || 0),\n    openid: doc.openid\n  }' }
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
    if (res.length) console.log(`✓ 注入「${inj.name}」→ 检出（${res[0]}）`)
    else { bad++; console.log(`✗ 注入「${inj.name}」→ 未检出`) }
  }
  if (bad) { console.error(`\n✗ test:wish-labels 自检失败 ${bad} 项`); process.exit(1) }
  console.log(`✓ test:wish-labels 自检通过（${INJECTIONS.length} 条内存注入全部检出，未写盘）`)
} else {
  const fails = await runChecks()
  if (fails.length) { console.error('✗ 心愿签不合格：\n  - ' + fails.join('\n  - ')); process.exit(1) }
  console.log('✓ test:wish-labels：纯函数 / 闸门不越权 / 写签（游客·失败·成功·额度）/ 我也想要（幂等·本人不可点）/ 版式拍板项 / 云函数最小暴露 全部通过')
}
