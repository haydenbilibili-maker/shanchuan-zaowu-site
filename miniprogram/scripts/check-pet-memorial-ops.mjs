#!/usr/bin/env node
/**
 * 工作台「工单 → 伴宠」操作守卫（manager 域；2026-10-01 产品负责人点名：按钮主次 / 新增拒绝 / 操作经山海有信通知顾客）
 * 说明：miniprogram/docs/细节雕刻_C流_2026-10.md「伴宠工单：按钮主次 + 拒绝 + 山海有信通知」一节
 *
 * 真跑页面方法（petMemorialActions.js + petMemorialNotice.js，假 wx / 假 manageStoreContent），钉住：
 *   ① 需补充 / 填写报价 / 直接承接 / 拒绝 —— 写工单后各恰好 1 次 dispatchMessage（山海有信），文案带工单号与关键内容；
 *      复制工单不发消息；旧的「按状态直发」入口（need_info / accepted）不得回到卡片上（否则重复发送）；
 *   ② 拒绝理由 / 需补充内容必填，去空白后 ≥ 4 字、≤ 上限，不合格零写入零发送；
 *   ③ 通知失败不阻断：工单照写、提示「已处理，通知发送失败」、失败原因推进 notifyFailures；
 *   ④ 按钮文字不折行：.pm-btn nowrap + 统一高度 / 圆角，行内 flex 等分 + min-width 换行；按压态走 tap-press；
 *   ⑤ 已婉拒：四份 STATUS_LABELS 同口径，列表无任何操作按钮且沉底，顾客进度页显示理由；承接后推进按钮与改前一致。
 *
 * 用法：node miniprogram/scripts/check-pet-memorial-ops.mjs [--selftest]
 *   --selftest 只在内存里改源码副本再跑，不写盘。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MP = 'miniprogram/'
const NOTICE = `${MP}subpackages/manager/utils/petMemorialNotice.js`
const ACTIONS = `${MP}subpackages/manager/manager/petMemorialActions.js`
const CFG = `${MP}subpackages/manager/manager/managerPageConfig.js`
const CARDS = `${MP}subpackages/manager/manager/workspace/petMemorialCards.wxml`
const SHEET = `${MP}subpackages/manager/manager/workspace/petMemorialSheet.wxml`
const SUB = `${MP}subpackages/manager/manager/workspace/_subviews.wxml`
const WSS = `${MP}subpackages/manager/manager/workspace/index.wxss`
const PMSS = `${MP}subpackages/manager/manager/workspace/petMemorial.wxss`
const STATUS_WXML = `${MP}subpackages/feature/custom/pet/status/index.wxml`
const STATUS_JS = `${MP}subpackages/feature/custom/pet/status/index.js`
const DEFAULTS = ['business', 'extra', 'feature', 'manager'].map((p) => `${MP}subpackages/${p}/utils/petMemorialDefaults.js`)
const ERP_PET = 'admin/src/components/PetMemorial.vue'

/**
 * 状态表一致性（通用）：小程序侧状态字典的**每个键**都必须出现在 ERP 的状态表里，
 * 否则 ERP 会把新状态显示成英文原值。以后新增一对「小程序状态字典 ↔ ERP 状态表」就在这里加一行。
 *   mp：小程序模块（全部副本，键集合必须相同）+ 导出名；erp：.vue 文件 + `const <名> = { ... }` 的常量名
 */
const STATUS_PARITY = [
  { name: '伴宠工单', mp: DEFAULTS, mpExport: 'STATUS_LABELS', erp: ERP_PET, erpConst: 'STATUS' }
]

/** 取 .vue / .js 源码里 `const NAME = { ... }` 顶层键（按花括号配平截取，不数逗号） */
function constObjectKeys(src, name) {
  const at = src.search(new RegExp(`const\\s+${name}\\s*=\\s*\\{`))
  if (at < 0) return null
  const open = src.indexOf('{', at)
  let depth = 0
  let end = -1
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i; break } }
  }
  if (end < 0) return null
  const body = src.slice(open + 1, end).replace(/\/\/[^\n]*/g, '')
  const keys = []
  let d = 0
  for (const line of body.split('\n')) {
    if (d === 0) {
      const m = /^\s*['"]?([A-Za-z_][\w]*)['"]?\s*:/.exec(line)
      if (m) keys.push(m[1])
    }
    d += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
  }
  return keys
}

function run(overrides = {}) {
  const read = (rel) => (Object.prototype.hasOwnProperty.call(overrides, rel) ? overrides[rel] : readFileSync(join(ROOT, rel), 'utf8'))
  const failures = []
  const queue = []
  // 页面方法共用一个假 wx，异步用例必须串行跑，否则调用记录会串到别的用例里
  const t = (name, fn) => queue.push([name, fn])

  let wxImpl = null
  const wxProxy = { cloud: { callFunction: (o) => wxImpl(o) } }
  const loadCjs = (rel, cache = new Map()) => {
    if (cache.has(rel)) return cache.get(rel).exports
    const mod = { exports: {} }
    cache.set(rel, mod)
    const req = (id) => loadCjs(join(dirname(rel), id).replace(/\.js$/, '') + '.js', cache)
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', 'wx', 'console', read(rel))(mod, mod.exports, req, wxProxy, { warn() {}, log() {}, error() {} })
    return mod.exports
  }

  const N = loadCjs(NOTICE)
  const { createPetMemorialActions } = loadCjs(ACTIONS)
  const helper = loadCjs(`${MP}subpackages/manager/utils/petMemorialHelper.js`)

  const ORDER = {
    _id: 'pm_1', _openid: 'oCustomer', orderNo: 'PM20261001000001', status: 'pending_review',
    pet: { name: '团子' }, intake: { method: 'store' }
  }

  function makePage({ order = ORDER, dispatch = () => ({ result: { success: true, messageId: 'm1' } }), modal = { confirm: true } } = {}) {
    const store = []
    const calls = []
    const tips = []
    wxImpl = async (o) => { calls.push(o); return dispatch(o) }
    const callStoreContent = async (p) => { store.push(JSON.parse(JSON.stringify(p))); return { success: true } }
    const page = {
      data: { petMemorialOrders: [{ ...order }], petSheet: { show: false }, tempPetQuote: {} },
      setData(patch) {
        Object.keys(patch).forEach((k) => {
          const parts = k.split('.')
          let o = this.data
          while (parts.length > 1) { const p = parts.shift(); o[p] = o[p] || {}; o = o[p] }
          o[parts[0]] = patch[k]
        })
      },
      showHubTip(msg, tone) { tips.push({ msg, tone }) },
      loadPetMemorialOrders() {},
      selectComponent() { return { open: async () => modal } },
      ...createPetMemorialActions({ callStoreContent })
    }
    const dispatches = () => calls.filter((c) => c.name === 'dispatchMessage' && c.data && c.data.action === 'dispatch')
    return { page, store, calls, tips, dispatches }
  }
  const ev = (dataset) => ({ currentTarget: { dataset }, detail: {} })

  async function sheetFlow(mode, text, opts) {
    const ctx = makePage(opts)
    ctx.page.openPetSheet(ev({ id: 'pm_1', mode }))
    ctx.page.onPetSheetInput({ detail: { value: text } })
    await ctx.page.submitPetSheet()
    return ctx
  }

  // ① 四个操作都经山海有信、恰好一次、文案带工单号与关键内容
  t('需补充：写 need_info + needInfo.note，且恰好 1 次山海有信（带工单号与补充内容）', async () => {
    const { store, dispatches, tips } = await sheetFlow('need_info', '几张清晰的正面照片')
    const d = dispatches()
    return store.length === 1 && store[0].data.status === 'need_info' && store[0].data.needInfo.note === '几张清晰的正面照片' &&
      d.length === 1 && d[0].data.eventType === 'pet_memorial_need_info' && d[0].data.openid === 'oCustomer' &&
      d[0].data.content.includes('PM20261001000001') && d[0].data.content.includes('几张清晰的正面照片') &&
      d[0].data.category === 'custom' && d[0].data.actionUrl.includes('id=pm_1') && tips.some((x) => x.msg.includes('已通知顾客'))
  })
  t('拒绝：写 declined + decline.reason，且恰好 1 次山海有信（带工单号与理由）', async () => {
    const { store, dispatches } = await sheetFlow('decline', '遗体保存状况不适合制作')
    const d = dispatches()
    return store.length === 1 && store[0].data.status === 'declined' && store[0].data.decline.reason === '遗体保存状况不适合制作' &&
      store[0].pushFields.productionLog[0].status === 'declined' &&
      d.length === 1 && d[0].data.eventType === 'pet_memorial_declined' && d[0].data.title &&
      d[0].data.content.includes('PM20261001000001') && d[0].data.content.includes('遗体保存状况不适合制作') && d[0].data.actionUrl.includes('id=pm_1')
  })
  t('直接承接：确认后写 accepted，且恰好 1 次山海有信（带工单号与下一步，按交接方式区分）', async () => {
    const a = makePage()
    await a.page.confirmPetAccept(ev({ id: 'pm_1' }))
    const b = makePage({ order: { ...ORDER, intake: { method: 'pickup' } } })
    await b.page.confirmPetAccept(ev({ id: 'pm_1' }))
    const da = a.dispatches()
    const db = b.dispatches()
    return a.store.length === 1 && a.store[0].data.status === 'accepted' && da.length === 1 &&
      da[0].data.eventType === 'pet_memorial_accepted' && da[0].data.content.includes('PM20261001000001') &&
      da[0].data.content.includes('下一步') && da[0].data.content.includes('到店') &&
      db.length === 1 && db[0].data.content.includes('上门收运')
  })
  t('直接承接：弹层取消则零写入零发送', async () => {
    const c = makePage({ modal: { confirm: false } })
    await c.page.confirmPetAccept(ev({ id: 'pm_1' }))
    return c.store.length === 0 && c.calls.length === 0
  })
  t('填写报价：写 quoted，且恰好 1 次山海有信（带工单号、金额、说明）', async () => {
    const c = makePage()
    c.page.data.tempPetQuote = { orderId: 'pm_1', amount: '5800', note: '浸液整体，约 6 周', validUntil: '2026-10-15' }
    await c.page.submitPetQuote()
    const d = c.dispatches()
    return c.store.length === 1 && c.store[0].data.status === 'quoted' && d.length === 1 &&
      d[0].data.eventType === 'pet_memorial_quoted' && d[0].data.content.includes('PM20261001000001') &&
      d[0].data.content.includes(helper.formatQuoteAmount(5800)) && d[0].data.content.includes('浸液整体，约 6 周')
  })
  t('需补充 / 拒绝的山海有信不吃 24h 去重的只有需补充（同单可多次要资料）', () => {
    return N.buildPetNotice('need_info', ORDER, { note: 'x' }).skipDedupe === true &&
      N.buildPetNotice('declined', ORDER, { reason: 'x' }).skipDedupe === false
  })
  t('复制工单只复制、不发消息；卡片上不得再有按状态直发的 need_info / accepted 入口（防重复发送）', () => {
    const cards = read(CARDS)
    const cfg = read(CFG)
    const m = /copyPetMemorialText\(e\)\s*\{([\s\S]*?)\n {2}\},/.exec(cfg)
    return !!m && !/callFunction|dispatch/.test(m[1]) && /bindtap="copyPetMemorialText"/.test(cards) &&
      ![cards, read(SUB)].some((w) => /bindtap="updatePetMemorialStatus"[^>]*data-status="(need_info|accepted)"/.test(w)) &&
      /bindtap="openPetSheet"[^>]*data-mode="need_info"/.test(cards) && /bindtap="openPetSheet"[^>]*data-mode="decline"/.test(cards) &&
      /bindtap="confirmPetAccept"/.test(cards) && /bindtap="openPetQuoteModal"/.test(cards)
  })

  // ② 理由必填
  t('拒绝理由为空 / 全空白 / 不足 4 字 / 超上限：零写入零发送并提示', async () => {
    const cases = ['', '   \n ', '不行。', '理'.repeat(N.DECLINE_REASON_MAX + 1)]
    for (const text of cases) {
      const c = await sheetFlow('decline', text)
      if (c.store.length || c.calls.length || !c.page.data.petSheet.error) return false
    }
    return /拒绝理由/.test((await sheetFlow('decline', '')).page.data.petSheet.error)
  })
  t('需补充内容同样必填', async () => {
    const c = await sheetFlow('need_info', '  ')
    return c.store.length === 0 && c.calls.length === 0 && !!c.page.data.petSheet.error
  })
  t('validateNote 口径：去首尾空白计字、emoji 按 1 字、上限内通过', () => {
    const ok = N.validateNote('decline', '  排期已满，抱歉  ')
    return ok.ok && ok.value === '排期已满，抱歉' && N.charLen('🐰🐰') === 2 &&
      N.validateNote('decline', '理'.repeat(N.DECLINE_REASON_MAX)).ok && !N.validateNote('decline', '理'.repeat(N.DECLINE_REASON_MAX + 1)).ok
  })
  t('弹层输入框按上限截断、有计数与错误位', () => {
    const s = read(SHEET)
    return /maxlength="\{\{petSheet\.max\}\}"/.test(s) && /petSheet\.len/.test(s) && /petSheet\.error/.test(s) && /bindtap="pickPetSheetChip"/.test(s)
  })
  t('快选叠加不重复、不超上限', () => {
    const a = N.mergeQuickPick('', '排期已满', 10)
    const b = N.mergeQuickPick(a, '排期已满', 10)
    const c = N.mergeQuickPick(a, '这一条很长很长很长', 10)
    return a === '排期已满' && b === a && c === a
  })

  // ③ 通知失败不阻断
  for (const [label, dispatch] of [
    ['返回失败', () => ({ result: { success: false, msg: '模板缺失' } })],
    ['调用抛错', () => { throw new Error('cloud down') }]
  ]) {
    t(`山海有信${label}：工单照写、提示「已处理，通知发送失败」、原因推进 notifyFailures`, async () => {
      const c = await sheetFlow('decline', '近期排期已满，没法按时完成', { dispatch })
      const fail = c.store[1]
      const tipOk = c.tips.some((x) => x.msg === '已处理，通知发送失败' && x.tone === 'warn')
      const reason = label === '返回失败' ? '模板缺失' : 'cloud down'
      return c.store.length === 2 && c.store[0].data.status === 'declined' && tipOk &&
        fail.pushFields && fail.pushFields.notifyFailures && fail.pushFields.notifyFailures[0].reason.includes(reason) &&
        fail.pushFields.notifyFailures[0].op === 'declined' && c.page.data.petSheet.show === false
    })
  }
  t('写工单失败：不发消息', async () => {
    const c = makePage()
    c.page.openPetSheet(ev({ id: 'pm_1', mode: 'decline' }))
    c.page.onPetSheetInput({ detail: { value: '多次联系不上，信息无法确认' } })
    const actions = createPetMemorialActions({ callStoreContent: async () => { throw new Error('denied') } })
    Object.assign(c.page, actions)
    await c.page.submitPetSheet()
    return c.calls.length === 0 && c.tips.some((x) => x.tone === 'warn')
  })

  // ④ 样式：不折行 / 统一尺寸 / 按压态
  const rule = (css, sel) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(css)
    return m ? m[1] : ''
  }
  t('.pm-btn：white-space: nowrap + 高 76rpx + 圆角 16rpx + 居中', () => {
    const r = rule(read(PMSS), '.pm-btn')
    return /white-space:\s*nowrap/.test(r) && /height:\s*76rpx/.test(r) && /border-radius:\s*16rpx/.test(r) && /justify-content:\s*center/.test(r)
  })
  t('按钮行：flex-wrap 换行 + 16rpx 间距；行内按钮 flex 等分且有 min-width（放不下整颗换行，不压窄）', () => {
    const css = read(PMSS)
    const row = rule(css, '.pm-act-row')
    const btn = rule(css, '.pm-act-row .pm-btn')
    return /flex-wrap:\s*wrap/.test(row) && /gap:\s*16rpx/.test(row) && /flex:\s*1 1 0/.test(btn) && /min-width:\s*\d+rpx/.test(btn)
  })
  t('主次：每张卡最多一个 .pm-btn.main（推进行的主操作为最后一颗）；复制工单为文字按钮', () => {
    const cards = read(CARDS)
    const reviewBlock = /wx:if="\{\{item\.canReview\}\}">([\s\S]*?)<\/view>\s*<view class="pm-actions" wx:elif/.exec(cards)
    return !!reviewBlock && (reviewBlock[1].match(/pm-btn main/g) || []).length === 1 &&
      /class="pm-tool"[^>]*bindtap="copyPetMemorialText"/.test(cards) && !/class="btn (ship|verify)"/.test(cards)
  })
  t('样式经 workspace/index.wxss @import 可达', () => /@import\s+['"]\.\/petMemorial\.wxss['"]/.test(read(WSS)))
  t('两份新 wxml 的可点元素都有 hover-class tap-press / tap-press-soft', () => {
    for (const rel of [CARDS, SHEET]) {
      const tags = read(rel).match(/<view\b[^>]*bindtap="(?!closePetSheet"[^>]*class="modal-mask)[^"]+"[^>]*>/g) || []
      for (const tag of tags) {
        if (/class="modal-mask/.test(tag)) continue
        if (!/hover-class="tap-press(-soft)?"/.test(tag)) return false
      }
    }
    return true
  })
  t('说明文字不低于 secondary：新样式不用 muted 色', () => !/--color-text-muted|--text-muted|#6B6560|#666\b|#444\b|#555\b/i.test(read(PMSS)))
  t('新文件不新增 wx.showModal', () => [ACTIONS, CARDS, SHEET].every((rel) => !/wx\.showModal/.test(read(rel))))
  t('_subviews 引入卡片与弹层、伴宠循环只在卡片文件里', () => {
    const sub = read(SUB)
    return /<include src="petMemorialCards\.wxml"\s*\/>/.test(sub) && /<include src="petMemorialSheet\.wxml"\s*\/>/.test(sub) &&
      !/wx:for="\{\{petMemorialOrders\}\}"/.test(sub)
  })

  // ⑤ 已婉拒 + 状态机
  for (const pair of STATUS_PARITY) {
    t(`状态表一致性（${pair.name}）：小程序 ${pair.mpExport} 各副本键集合相同，且全部出现在 ERP ${pair.erpConst}`, () => {
      const sets = pair.mp.map((rel) => Object.keys(loadCjs(rel)[pair.mpExport] || {}).sort().join(','))
      if (!sets[0] || sets.some((x) => x !== sets[0])) throw new Error('小程序副本键集合不一致')
      const erpKeys = constObjectKeys(read(pair.erp), pair.erpConst)
      if (!erpKeys || !erpKeys.length) throw new Error(`ERP 找不到 const ${pair.erpConst}`)
      const missing = sets[0].split(',').filter((k) => erpKeys.indexOf(k) === -1)
      if (missing.length) throw new Error(`ERP 缺：${missing.join(', ')}`)
      return true
    })
  }
  t('ERP 伴宠页：已婉拒为已结束色调（info）、筛选有已婉拒、卡片与详情显示拒绝理由和时间', () => {
    const v = read(ERP_PET)
    return /declined:\s*\{\s*text:\s*'已婉拒',\s*type:\s*'info'\s*\}/.test(v) && /<el-radio-button label="declined">已婉拒<\/el-radio-button>/.test(v) &&
      /row\.decline\.reason/.test(v) && /row\.decline\.declinedAt/.test(v) &&
      /currentRow\.decline\?\.reason/.test(v) && /currentRow\.decline\?\.declinedAt/.test(v)
  })
  t('四份 STATUS_LABELS：declined = 已婉拒', () => DEFAULTS.every((rel) => /\bdeclined:\s*'已婉拒'/.test(read(rel))))
  t('已婉拒：列表无任何操作按钮、显示理由、沉底在「已结束」之后', () => {
    const fmt = { getStatusLabel: (s) => s, formatQuoteAmount: String }
    const d = N.decoratePetOrder({ ...ORDER, status: 'declined', decline: { reason: '排期已满' } }, fmt)
    const p = N.decoratePetOrder({ ...ORDER, _id: 'p' }, fmt)
    const sorted = N.sortPetOrders([d, p])
    return !d.canReview && !d.canDecline && !d.canCopy && d.stageActions.length === 0 && d.declineReason === '排期已满' &&
      sorted[0]._id === 'p' && sorted[1].firstClosed === true
  })
  t('可拒绝范围：待评估 / 需补充 / 已报价；承接之后不可拒绝', () => {
    const fmt = { getStatusLabel: (s) => s, formatQuoteAmount: String }
    const can = (status) => N.decoratePetOrder({ ...ORDER, status }, fmt).canDecline
    return can('pending_review') && can('need_info') && can('quoted') && !can('accepted') && !can('in_production') && !can('declined')
  })
  t('承接后的推进按钮与改前一致', () => JSON.stringify(N.STAGE_ACTIONS) === JSON.stringify({
    accepted: [{ status: 'awaiting_intake', label: '待交接' }],
    awaiting_intake: [{ status: 'intake_done', label: '已交接' }, { status: 'in_production', label: '开始制作' }],
    intake_done: [{ status: 'in_production', label: '开始制作' }],
    in_production: [{ status: 'completed', label: '已完成' }]
  }))
  t('顾客进度页：已婉拒有说明与理由、需补充显示要补充的内容', () => {
    const w = read(STATUS_WXML)
    const j = read(STATUS_JS)
    return /order\.status === 'declined'/.test(w) && /declineReason/.test(w) && /needInfoNote/.test(w) &&
      /order\.decline/.test(j) && /order\.needInfo/.test(j)
  })

  return (async () => {
    for (const [name, fn] of queue) {
      try {
        if ((await fn()) !== true) failures.push(name)
      } catch (e) {
        failures.push(`${name}（${e.message}）`)
      }
    }
    return failures
  })()
}

const INJECTIONS = [
  { name: '发送改成别的云函数（四个操作都不走山海有信）', rel: ACTIONS, from: "name: 'dispatchMessage'", to: "name: 'noopMessage'" },
  { name: '拒绝理由不校验', rel: ACTIONS, from: 'if (!check.ok) {', to: 'if (false) {' },
  { name: '理由最少字数放宽为 0', rel: NOTICE, from: 'const DECLINE_REASON_MIN = 4', to: 'const DECLINE_REASON_MIN = 0' },
  { name: '按钮文字允许折行', rel: PMSS, from: 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;', to: 'white-space: normal; overflow: hidden;' },
  { name: '按钮行不换行', rel: PMSS, from: '.pm-act-row { display: flex; flex-wrap: wrap;', to: '.pm-act-row { display: flex; flex-wrap: nowrap;' },
  { name: '通知失败提示被吞成成功', rel: ACTIONS, from: "else this.showHubTip('已处理，通知发送失败', 'warn')", to: "else this.showHubTip('已处理', 'info')" },
  { name: '通知失败不留痕', rel: ACTIONS, from: 'pushFields: { notifyFailures:', to: 'pushFields: { notifyFailuresX:' },
  { name: '承接后不发通知', rel: ACTIONS, from: "const notice = await this.sendPetNotice('accepted', order, {})", to: 'const notice = { ok: true }' },
  { name: '报价后不发通知', rel: ACTIONS, from: "const notice = await this.sendPetNotice('quoted',", to: "const notice = { ok: true } || ('quoted'," },
  { name: '需补充文案丢掉补充内容', rel: NOTICE, from: '还需要你补充：\\n${trimText(extra.note)}', to: '还需要你补充：\\n' },
  { name: '拒绝文案丢掉工单号', rel: NOTICE, from: '「${name}」的纪念工单${noPart}这次我们没能承接', to: '「${name}」的纪念工单这次我们没能承接' },
  { name: '卡片恢复按状态直发 need_info（重复发送）', rel: CARDS, from: 'bindtap="openPetSheet" data-id="{{item._id}}" data-mode="need_info"', to: 'bindtap="updatePetMemorialStatus" data-id="{{item._id}}" data-status="need_info"' },
  { name: '顾客端 STATUS_LABELS 丢 declined', rel: DEFAULTS[2], from: "declined: '已婉拒'", to: "declinedX: '已婉拒'" },
  { name: '已婉拒仍出拒绝按钮', rel: NOTICE, from: "const DECLINABLE_STATUSES = ['pending_review', 'need_info', 'quoted']", to: "const DECLINABLE_STATUSES = ['pending_review', 'need_info', 'quoted', 'declined']" },
  { name: '推进按钮被改', rel: NOTICE, from: "intake_done: [{ status: 'in_production', label: '开始制作' }]", to: "intake_done: [{ status: 'completed', label: '已完成' }]" },
  { name: '主操作按钮丢按压态', rel: CARDS, from: 'class="pm-btn main" hover-class="tap-press"', to: 'class="pm-btn main"' },
  { name: '顾客进度页不显示婉拒理由', rel: STATUS_WXML, from: "wx:elif=\"{{order.status === 'declined'}}\"", to: "wx:elif=\"{{order.status === 'declinedX'}}\"" },
  { name: 'ERP 状态表漏 declined', rel: ERP_PET, from: "  declined: { text: '已婉拒', type: 'info' }\n", to: '' },
  { name: '小程序四份同时新增状态但 ERP 没跟上', rels: DEFAULTS, expect: /ERP 缺：paused/, from: "  declined: '已婉拒'\n}", to: "  declined: '已婉拒',\n  paused: '已暂停'\n}" },
  { name: '小程序四份副本键集合不一致', rel: DEFAULTS[3], from: "  ready: '待取 / 待寄',\n", to: '' },
  { name: 'ERP 筛选丢已婉拒', rel: ERP_PET, from: '<el-radio-button label="declined">已婉拒</el-radio-button>', to: '' },
  { name: 'ERP 详情不显示拒绝时间', rel: ERP_PET, from: "currentRow.decline?.declinedAt ? fmt(currentRow.decline.declinedAt)", to: "false ? 0" },
  { name: '复制工单顺手发消息', rel: CFG, from: "      data: buildStaffCopyText(item),", to: "      data: buildStaffCopyText(item), x: wx.cloud.callFunction({ name: 'dispatchMessage' })," }
]

async function selftest() {
  const base = await run()
  if (base.length) {
    console.error('✗ 自检前置：真源码本身未通过\n  - ' + base.join('\n  - '))
    process.exit(1)
  }
  let bad = 0
  for (const inj of INJECTIONS) {
    const overrides = {}
    let anchored = true
    for (const rel of inj.rels || [inj.rel]) {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      if (!src.includes(inj.from)) anchored = false
      overrides[rel] = src.replace(inj.from, inj.to)
    }
    if (!anchored) {
      console.error(`✗ 注入锚点失效：${inj.name}`)
      bad += 1
      continue
    }
    const fails = await run(overrides)
    if (inj.expect && !fails.some((f) => inj.expect.test(f))) { console.error(`✗ 注入「${inj.name}」未按预期原因检出：${fails.join('；')}`); bad += 1 }
    else if (fails.length) console.log(`✓ 注入「${inj.name}」被检出（${fails.length} 条）`)
    else { console.error(`✗ 注入「${inj.name}」未被检出`); bad += 1 }
  }
  console.log(bad ? `✗ 自检失败 ${bad}/${INJECTIONS.length}` : `✓ 自检通过：${INJECTIONS.length} 个内存注入全部检出（未写盘）`)
  process.exitCode = bad ? 1 : 0
}

if (process.argv.includes('--selftest')) {
  await selftest()
} else {
  const fails = await run()
  if (fails.length) {
    console.error(`✗ check:pet-memorial-ops 失败 ${fails.length} 条\n  - ${fails.join('\n  - ')}`)
    process.exitCode = 1
  } else {
    console.log('✓ check:pet-memorial-ops 通过（四个操作经山海有信 / 理由必填 / 失败不阻断 / 按钮不折行 / 已婉拒）')
  }
}
process.exit()
