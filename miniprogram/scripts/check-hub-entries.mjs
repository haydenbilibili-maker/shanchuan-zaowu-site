#!/usr/bin/env node
/**
 * 超管 / 店长工作台「功能入口清单」守卫（manager 域）
 *
 * 2026-09-30 产品负责人：工作台入口全局改版（七分区 + 待办条 + 合并磁贴二级面板）。
 * 合并与搬家最容易「顺手把一个功能弄丢」或「把权限条件写宽 / 写窄」，本守卫钉住：
 *   1) ORIGINAL 里改版前的 48 个磁贴/链接入口（会员调级 / 荣誉馆长 09-30 拆回后各算一个） + 首屏扫码主按钮，每个仍有一枚
 *      直达磁贴（bindtap + data-idx / data-tab 一致）—— 2026-10-10 起没有二级面板，不再接受「藏在面板里」；
 *   2) 权限条件不丢：直达磁贴的 wx:if 菜单键集合 = 改版前的集合；
 *   3) 无重复磁贴（同入口 / 同名各只能一枚）；
 *   4) 分区：每枚磁贴都在某个 hub-sec 内，分区 wx:if 用 hubSec.<id>，且 HUB_SECTIONS[id].keys = 区内磁贴菜单键之并；
 *   5) 行为（真跑 hubNav.js + workspaceRoles.js）：超管 / 店长 / 店员 各角色下，改版前可见的入口改版后仍可达，
 *      改版前不可见的入口改版后也不出现；sectionFlags 不藏掉有可见磁贴的分区；
 *   6) 入口 handler 在页面上真实存在；hub 入口层不弹原生 modal；可见文案无技术字段名；
 *   7) 统一清单 hubNav.HUB_ENTRIES ↔ index.wxml 分区磁贴逐枚一致（入口 / 名称 / 图标 / 权限键 / 分区），id 唯一；
 *   8) 「我的常用」：只含有权限入口、旧 id / 被合并 id 映射到现行 id、未知 id 过滤、上限 8 生效、各角色默认值存在且有效、
 *      点常用磁贴再判权限、保存前归一化、常用区按清单 wx:for 渲染；
 *   9) 2026-10-01 展示改版·方案 A（产品负责人点名，见 judgeLayout）：N1 不再有小金点 / 双圈 / 长按这类要解释的暗号、
 *      N2 每个入口都有一句大白话说明、N3 待处理横条包含所有带角标的入口（同一种红色数字）、N4「编辑」是常用的显式入口、
 *      N5 搜索只在入口 > 20 的角色出现、N6 每个分区单独一块卡片、入口全部直接可见（2026-10-10 撤回手风琴）；常用本地 key 不变；
 *  10) N7（2026-10-10 产品负责人「类似功能折叠的全部展开单独展示」）：全部功能里没有「点开再选」的折叠磁贴 / 二级面板残留（无 openHubGroup /
 *      data-group / › / 弹层）、原折叠的子功能都仍可达、**功能总数（独立入口 + 组合子功能）只许多不许少**、常用里的旧 id 平滑映射。
 *  11) K（2026-11-25 产品负责人「超管功能超过 52 个，合并同类项、大幅优化分类与数量」，方案见
 *      miniprogram/docs/超管工作台_功能归并_2026-11-25.md）：同类功能归并为「组合入口」——一枚磁贴（bindtap="openHubKitPage"
 *      data-kit="<id>"）→ 独立组合页 subpackages/manager/group/index?kit=<id>，页内逐条平铺子功能（不是弹层 / 二级面板，N7 仍成立）。
 *      钉住：组合磁贴权限键 = 子功能权限键之并（只并入口、不放宽权限）；每个子功能保留原入口 handler 与原权限键，
 *      改版前的入口经子功能仍可达、各角色可见性不变；子功能不得同时又是独立磁贴；组合页按权限过滤子功能并调原 handler；
 *      组合入口能被任一子功能的名称搜到；组合页已在 app.json 注册。
 *
 * 用法：node miniprogram/scripts/check-hub-entries.mjs [--selftest]
 * 自检全部在内存副本上注入，不写盘。
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const TAG = '[check:hub-entries]'
const MGR = 'miniprogram/subpackages/manager/manager'
const FILES = {
  wxml: `${MGR}/index.wxml`,
  hubNav: `${MGR}/hubNav.js`,
  hubWxss: `${MGR}/hubNav.wxss`,
  indexJs: `${MGR}/index.js`,
  config: `${MGR}/managerPageConfig.js`,
  roles: 'miniprogram/utils/workspaceRoles.js'
}
/** 可选文件：组合页（S2 起才有）与 app.json —— 不存在时按空串处理，由 K 规则在「有组合入口」时要求它们存在 */
const OPTIONAL_FILES = {
  groupJs: 'miniprogram/subpackages/manager/group/index.js',
  groupWxml: 'miniprogram/subpackages/manager/group/index.wxml',
  appJson: 'miniprogram/app.json'
}

/**
 * 改版前（2026-09-30 之前）工作台的全部入口。handlers = 可接受的等价入口名（goX 与 goXGuarded 是同一门禁）。
 * 这是「功能不能丢」的基线 —— 只许加，不许删（删功能请先经产品负责人点名并在此注明）。
 */
const ORIGINAL = [
  { name: '账本', handlers: ['switchTab'], idx: '8', keys: ['ledger'] },
  { name: '订单', handlers: ['onOrdersMenuTap'], idx: '2', keys: ['orders'] },
  { name: '藏品', handlers: ['switchTab'], idx: '1', keys: ['products'] },
  { name: '报表', handlers: ['switchTab'], idx: '13', keys: ['analytics'] },
  { name: '运费', handlers: ['switchTab'], idx: '15', keys: ['shipping'] },
  { name: '活动', handlers: ['switchTab'], idx: '7', keys: ['activities'] },
  { name: '装修', handlers: ['switchTab'], idx: '4', keys: ['decor'] },
  { name: '内容', handlers: ['switchTab'], idx: '9', keys: ['content'] },
  { name: '主播', handlers: ['goLiveStudio'], keys: ['live'] },
  { name: '门店', handlers: ['switchTab'], idx: '12', keys: ['stores'] },
  { name: '开关', handlers: ['switchTab'], idx: '16', keys: ['contentFlags'] },
  { name: '仪表盘', handlers: ['goStudioDashboard', 'goStudioDashboardGuarded'], keys: ['studioDashboard'] },
  { name: '供应商管理', handlers: ['goSupplierWorkbench', 'goSupplierWorkbenchGuarded'], keys: ['supplierWorkbench'] },
  { name: '飞书同步', handlers: ['goFeishuSyncGuarded'], keys: ['feishuSync'] },
  { name: '工作室账单', handlers: ['goStudioBillsGuarded'], keys: ['studioBills'] },
  { name: '物业', handlers: ['goPropertyCost', 'goPropertyCostGuarded'], keys: ['propertyCost'] },
  { name: '采购', handlers: ['goPurchaseOps', 'goPurchaseOpsGuarded'], keys: ['purchaseOps'] },
  { name: '出货中心', handlers: ['goShipmentOps', 'goShipmentOpsGuarded'], keys: ['shipmentOps'] },
  { name: '库存管理', handlers: ['goInventoryOps', 'goInventoryOpsGuarded'], keys: ['inventoryOps', 'rawInventoryOps'] },
  { name: '标本师管理', handlers: ['switchTab'], idx: '5', keys: ['framers'] },
  { name: '工单', handlers: ['switchTab'], idx: '10', keys: ['workOrders'] },
  { name: '合作申请', handlers: ['switchTab'], idx: '14', keys: ['framerRecruit'] },
  { name: '会员 CRM', handlers: ['goMemberCrm', 'goMemberCrmGuarded'], keys: ['memberCrm'] },
  { name: '权益', handlers: ['switchTab'], idx: '6', keys: ['vip'] },
  { name: '有信', handlers: ['switchTab'], idx: '11', keys: ['support'] },
  // 2026-09-30 产品负责人：「会员调级」「荣誉馆长」从合并入口重新拆开，恢复合并前各自的权限键
  { name: '会员调级', handlers: ['goMemberLevelAdjust', 'goMemberLevelAdjustGuarded'], keys: ['memberLevelAdjust'] },
  { name: '荣誉馆长', handlers: ['goHonoraryCurators', 'goHonoraryCuratorsGuarded'], keys: ['honoraryCurators'] },
  { name: 'AI 鉴定', handlers: ['goIdentifyMonitorGuarded'], keys: ['aiIdentifyMonitor'] },
  // 2026-11-23 产品负责人点名：超管「博物君」开关与监测（仅超管）
  { name: '博物君', handlers: ['goMuseumGuideMonitorGuarded'], keys: ['museumGuideMonitor'] },
  { name: '员工', handlers: ['goStaffDirectory', 'goStaffDirectoryGuarded'], keys: ['staffDirectory'] },
  { name: '权限配置', handlers: ['goStoreStaffPermissions', 'goStoreStaffPermissionsGuarded'], keys: ['staffPermissions'] },
  { name: '股东配置', handlers: ['goShareholderConfig', 'goShareholderConfigGuarded'], keys: ['shareholderConfig'] },
  { name: '核销验票', handlers: ['goStaffTab'], tab: 'verify', keys: ['verify'] },
  { name: '审批中心', handlers: ['goApprovals', 'goApprovalsGuarded'], keys: ['approvals'] },
  { name: '积分管理', handlers: ['goStorePoints', 'goStorePointsGuarded'], keys: ['points'] },
  { name: '工作微信通知', handlers: ['enableStaffOrderWxNotify'], keys: ['orders'] },
  { name: '发票管理', handlers: ['goInvoiceRequests', 'goInvoiceRequestsGuarded'], keys: ['invoice'] },
  { name: '礼赠履约', handlers: ['goGiftOps', 'goGiftOpsGuarded'], keys: ['giftOps'] },
  { name: '礼赠管理', handlers: ['goGiftManage', 'goGiftManageGuarded'], keys: ['giftManage'] },
  { name: '工资维护', handlers: ['goPayslipAdminGuarded'], keys: ['payslipAdmin'] },
  { name: '工资条明细', handlers: ['goMyPayslipGuarded'], keys: ['myPayslip'] },
  { name: '钱包配置', handlers: ['goWalletConfig', 'goWalletConfigGuarded'], keys: ['walletConfig'] },
  { name: '新会员礼包', handlers: ['goWelcomeGift', 'goWelcomeGiftGuarded'], keys: ['welcomeGift'] },
  { name: '生日礼包', handlers: ['goBirthdayGift', 'goBirthdayGiftGuarded'], keys: ['welcomeGift'] },
  { name: '售罄孤品定金', handlers: ['goDepositOps', 'goDepositOpsGuarded'], keys: ['depositOps'] },
  { name: '标本师提成', handlers: ['goArtisanCommission', 'goArtisanCommissionGuarded'], keys: ['artisanCommission'] },
  { name: '预约规则', handlers: ['goBookingRules', 'goBookingRulesGuarded'], keys: ['bookingRules'] },
  { name: '客服入口', handlers: ['goSupportConfig', 'goSupportConfigGuarded'], keys: ['supportConfig'] },
  { name: '店员工作台', handlers: ['goStaffHome'], keys: ['staffConsole'] }
]

/** 界面可见文案里不应出现的技术字段 / 集合名（小写比较） */
const TECH_WORDS = ['openid', 'unionid', '_id', 'collection', 'storeid', 'fileid', 'cloud://', 'staff_members', 'orders_', 'undefined', 'null']

function loadSrc() {
  const src = {}
  for (const [k, rel] of Object.entries(FILES)) {
    const p = resolve(ROOT, rel)
    if (!existsSync(p)) {
      console.error(TAG, '缺少', rel)
      process.exit(1)
    }
    src[k] = readFileSync(p, 'utf8')
  }
  for (const [k, rel] of Object.entries(OPTIONAL_FILES)) {
    const p = resolve(ROOT, rel)
    src[k] = existsSync(p) ? readFileSync(p, 'utf8') : ''
  }
  return src
}

function evalCjs(code) {
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, () => {
    throw new Error('hubNav.js / workspaceRoles.js 不应 require 其它模块（守卫按纯模块加载）')
  })
  return mod.exports
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name.replace(/[:]/g, '\\:')}="([^"]*)"`))
  return m ? m[1] : null
}
const setEq = (a, b) => a.length === b.length && a.every((x) => b.includes(x))
const uniq = (arr) => [...new Set(arr)]

function menuKeysOf(expr, errs, where) {
  const inner = String(expr || '').replace(/^\{\{|\}\}$/g, '').trim()
  if (!inner) return []
  const parts = inner.split('||').map((s) => s.trim())
  const keys = []
  for (const p of parts) {
    const m = p.match(/^menu\.(\w+)$/)
    if (!m) {
      errs.push(`${where}：wx:if 只能是 menu.<键> 用 || 连接（当前「${inner}」）—— 混入其它条件会让权限口径偏离菜单`)
      return keys
    }
    keys.push(m[1])
  }
  return uniq(keys)
}

/** 分区开标签（hub-grp 独立卡片；wx:if 与锚点 id 必须一致） */
const SEC_RE = /<view class="hub-grp[^"]*" wx:if="\{\{hubSec\.(\w+)\}\}" id="hub-sec-(\w+)">/g

function parseTiles(wxml, errs) {
  const secs = []
  let m
  const secRe = new RegExp(SEC_RE.source, 'g')
  while ((m = secRe.exec(wxml))) {
    if (m[1] !== m[2]) errs.push(`分区开标签 id 不一致：wx:if=${m[1]} / 锚点=${m[2]}（显隐与折叠会对不上）`)
    secs.push({ id: m[1], at: m.index })
  }
  const looseSecs = (wxml.match(/<view class="hub-grp[\s"]/g) || []).length
  if (looseSecs !== secs.length) errs.push(`有 ${looseSecs - secs.length} 个分区开标签不是「class="hub-grp…" wx:if="{{hubSec.<id>}}" id="hub-sec-<id>"」形态`)
  const tiles = []
  const tileRe = /<view class="hub-cell"[^>]*>/g
  while ((m = tileRe.exec(wxml))) {
    const tag = m[0]
    const after = wxml.slice(m.index + tag.length, m.index + tag.length + 900)
    const lm = after.match(/<text class="hub-cell-name">([^<]+)<\/text>/)
    const label = lm ? lm[1].trim() : ''
    const im = after.match(/<image class="hub-ico-img" src="([^"]+)"/)
    let sec = null
    for (const s of secs) if (s.at < m.index) sec = s.id
    const close = closeOf(wxml, m.index)
    const t = {
      tag,
      label,
      sec,
      body: close > 0 ? wxml.slice(m.index + tag.length, close) : '',
      sub: '',
      bindtap: attr(tag, 'bindtap'),
      idx: attr(tag, 'data-idx'),
      tab: attr(tag, 'data-tab'),
      dataGroup: attr(tag, 'data-group'),
      kit: attr(tag, 'data-kit'),
      fid: attr(tag, 'data-fid'),
      longpress: attr(tag, 'bindlongpress'),
      hover: attr(tag, 'hover-class'),
      wxif: attr(tag, 'wx:if'),
      icon: im ? im[1] : ''
    }
    const sb = t.body.match(/<text class="hub-cell-sub">([^<]*)<\/text>/)
    t.sub = sb ? sb[1].trim() : ''
    t.keys = menuKeysOf(t.wxif, errs, `磁贴「${label || tag.slice(0, 60)}」`)
    if (!t.wxif) errs.push(`磁贴「${label}」没有 wx:if 权限条件`)
    tiles.push(t)
  }
  return { tiles, secs }
}

/** 从 <view 开标签位置配平找到它的 </view>（返回闭合标签起点；找不到 -1） */
function closeOf(wxml, at) {
  const re = /<view\b[^>]*?(\/?)>|<\/view>/g
  re.lastIndex = at
  let depth = 0
  let m
  while ((m = re.exec(wxml))) {
    if (m[0].startsWith('</')) {
      depth -= 1
      if (depth === 0) return m.index
    } else if (!m[1]) depth += 1
  }
  return -1
}

/** 极简 wxss 规则表：[{ sel, decls: { prop: value } }]（去注释；同选择器多次出现各算一条） */
function cssRules(css) {
  const out = []
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(src))) {
    const decls = {}
    m[2].split(';').forEach((d) => {
      const i = d.indexOf(':')
      if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim()
    })
    m[1].split(',').forEach((s) => out.push({ sel: s.trim().replace(/\s+/g, ' '), decls }))
  }
  return out
}

function hasMethod(code, name) {
  const re = new RegExp(`\\n\\s{2}(?:async\\s+)?${name}\\s*\\(|\\n\\s{2}${name}\\s*:\\s*(?:async\\s+)?function|\\n\\s{2}${name}\\s*,`)
  return re.test(code)
}

/** 磁贴 / 清单签名：入口 handler + tab 序号 + 深链 tab + 组合 id（组合磁贴共用 openHubKitPage，靠 data-kit 区分） */
const tileSig = (t) => `${t.bindtap}|${t.idx || ''}|${t.tab || ''}|${t.kit || ''}`
const entrySig = (e) => `${e.tap}|${e.idx != null ? String(e.idx) : ''}|${e.tab || ''}|${e.kit || ''}`
const KIT_TAP = 'openHubKitPage'
const KIT_ROUTE = '/subpackages/manager/group/index?kit='

const kitsOf = (nav) => (Array.isArray(nav.HUB_KITS) ? nav.HUB_KITS : [])
/** 子功能 id → 所在组合 id（独立入口原样返回）：断言里写原子功能 id，归并后自动换成组合入口 id */
function canonOf(nav) {
  const kits = kitsOf(nav)
  return (id) => {
    const k = kits.find((x) => (x.children || []).some((c) => c.id === id))
    return k ? k.id : id
  }
}
const canonList = (canon, ids) => uniq(ids.map(canon))

/** 改版前入口 o 在磁贴 t 上的落点：独立磁贴直达 → [{direct}]；组合磁贴 → 命中的子功能 */
function hitsOf(nav, o, t) {
  const same = (tap, idx, tab) => o.handlers.includes(tap) && (o.idx ? String(idx || '') === o.idx : true) && (o.tab ? tab === o.tab : true)
  if (t.kit) {
    const k = kitsOf(nav).find((x) => x.id === t.kit)
    return k ? (k.children || []).filter((c) => same(c.tap, c.idx, c.tab)).map((c) => ({ child: c, keys: uniq(c.keys || []) })) : []
  }
  return same(t.bindtap, t.idx, t.tab) ? [{ child: null, keys: t.keys }] : []
}

/** K：组合入口（一枚磁贴 → 组合页平铺子功能） */
function judgeKits(src, nav, roles, tiles, errs) {
  const kits = kitsOf(nav)
  const entries = nav.HUB_ENTRIES || []
  const pageCode = `${src.config}\n${src.indexJs}`
  const kitIds = kits.map((k) => k.id)
  if (uniq(kitIds).length !== kitIds.length) errs.push('K HUB_KITS 的 id 有重复')
  for (const t of tiles) {
    if (t.bindtap === KIT_TAP && !t.kit) errs.push(`K 磁贴「${t.label}」走组合页（${KIT_TAP}）却没有 data-kit —— 组合页不知道该列哪些功能`)
    if (t.kit && t.bindtap !== KIT_TAP) errs.push(`K 磁贴「${t.label}」带 data-kit 却不走 ${KIT_TAP}`)
    if (t.kit && !kitIds.includes(t.kit)) errs.push(`K 磁贴「${t.label}」的 data-kit="${t.kit}" 在 HUB_KITS 里没有定义`)
  }
  const childIds = []
  for (const k of kits) {
    const kids = k.children || []
    if (kids.length < 2) errs.push(`K 组合「${k.label}」只有 ${kids.length} 个子功能 —— 组合至少两项，否则直接用独立磁贴`)
    const e = entries.find((x) => x.id === k.id)
    if (!e) errs.push(`K 组合「${k.label}」在 HUB_ENTRIES 里没有入口（id 须同为 ${k.id}）`)
    else {
      if (e.tap !== KIT_TAP || e.kit !== k.id) errs.push(`K 组合入口 ${k.id} 须 tap: '${KIT_TAP}', kit: '${k.id}'`)
      if (!setEq(uniq(e.keys), uniq(kids.flatMap((c) => c.keys || [])))) errs.push(`K 组合入口 ${k.id} 的权限键 [${e.keys}] 须 = 子功能权限键之并 [${uniq(kids.flatMap((c) => c.keys || []))}]（只并入口，不放宽也不收紧）`)
      if (e.sec !== k.sec || e.label !== k.label || e.icon !== k.icon) errs.push(`K 组合入口 ${k.id} 的名称 / 图标 / 分区须与 HUB_KITS 一致`)
    }
    const kt = tiles.filter((t) => t.kit === k.id)
    if (kt.length !== 1) errs.push(`K 组合「${k.label}」在全部功能里应恰好一枚磁贴，实际 ${kt.length}`)
    else if (!setEq(kt[0].keys, uniq(kids.flatMap((c) => c.keys || [])))) errs.push(`K 组合「${k.label}」磁贴权限键 [${kt[0].keys}] ≠ 子功能权限键之并 —— 只并入口，不放宽也不收紧`)
    for (const c of kids) {
      const where = `组合「${k.label}」子功能「${c.label || c.id}」`
      childIds.push(c.id)
      if (!c.id || !c.label || !c.tap || !(c.keys || []).length) { errs.push(`K ${where} 缺 id / label / tap / keys`); continue }
      if (!hasMethod(pageCode, c.tap)) errs.push(`K ${where}的入口 ${c.tap} 在页面上不存在`)
      if (c.tap === KIT_TAP) errs.push(`K ${where}又指向组合页（组合不嵌套）`)
      const d = String(c.desc || '')
      if (!d.trim() || d.length > 16 || /[A-Za-z]|云函数|接口|字段|集合|数据库|参数|缓存|配置项|权限键|同步率/.test(d)) errs.push(`K ${where}须有 ≤16 字、无技术词的大白话说明（当前「${d}」）`)
      if (entries.some((x) => x.id === c.id)) errs.push(`K ${where}同时还是独立入口 ${c.id} —— 归并后只留组合一个入口`)
      if (tiles.some((t) => t.fid === c.id)) errs.push(`K ${where}同时还是独立磁贴 —— 归并后只留组合一个入口`)
    }
  }
  if (uniq(childIds).length !== childIds.length) errs.push('K 同一个子功能出现在多个组合里')
  if (!kits.length) return
  // 旧常用里存的是子功能 id（归并前的独立入口）：须平滑落到它所在的组合，不变空位
  try {
    const sm = menuOf(roles, roles.WORKSPACE_SUPER_ADMIN)
    for (const k of kits) {
      for (const c of k.children || []) {
        if (!(c.keys || []).some((x) => sm[x])) continue
        const got = nav.normalizeFavs([c.id], sm)
        if (JSON.stringify(got) !== JSON.stringify([k.id])) errs.push(`K 常用里的旧入口「${c.label}」（${c.id}）须映射到组合「${k.label}」，实际 [${got}] —— 否则归并后旧收藏变空位`)
      }
    }
  } catch (e) {
    errs.push(`K 旧常用映射实跑失败：${e.message}`)
  }
  // 搜索：任一子功能的名称都能搜到它所在的组合（超管）
  try {
    const sm = menuOf(roles, roles.WORKSPACE_SUPER_ADMIN)
    for (const k of kits) {
      for (const c of k.children || []) {
        if (!(c.keys || []).some((x) => sm[x])) continue
        if (!nav.searchEntries(c.label, { menu: sm }).some((x) => x.id === k.id)) errs.push(`K 超管搜「${c.label}」找不到组合「${k.label}」—— 组合入口的 alias 须含子功能名称`)
      }
    }
  } catch (e) {
    errs.push(`K 组合搜索实跑失败：${e.message}`)
  }
  // 组合角标随计数刷新：进页（buildHubView）与每次角标变化（refreshOpsSignals）都要重算
  try {
    if (!('hubKitBadge' in nav.buildHubView([], { menu: {} }))) errs.push('K buildHubView 须带上组合角标 hubKitBadge')
  } catch (e) { errs.push(`K buildHubView 执行失败：${e.message}`) }
  if (!/refreshOpsSignals\(\) \{[\s\S]{0,500}hubKitBadge: hubNav\.buildKitBadges\(this\.data\)/.test(src.indexJs)) errs.push('K 角标变化后须刷新组合磁贴角标（refreshOpsSignals → hubKitBadge: hubNav.buildKitBadges(this.data)）')
  // 工作台 → 组合页
  const open = (src.indexJs.match(new RegExp(`\\n  ${KIT_TAP}\\(e\\) \\{([\\s\\S]*?)\\n  \\},`)) || [])[1] || ''
  if (!open.includes(KIT_ROUTE.replace('?kit=', '')) || !/dataset/.test(open)) errs.push(`K index.js 须有 ${KIT_TAP}(e)：取 dataset.kit → navigateTo('${KIT_ROUTE}' + kit)`)
  // 组合页：按权限过滤子功能、调工作台页上的原 handler（权限 / 订阅弹窗等原逻辑一并保留）
  if (!src.groupJs) errs.push('K 有组合入口，但组合页 subpackages/manager/group/index.js 不存在')
  else {
    if (!/hubNav\.findKit\(/.test(src.groupJs)) errs.push('K 组合页须用 hubNav.findKit 取组合定义（与工作台同一份清单）')
    if (!/children\.filter\(\(c\) => c\.keys\.some\(/.test(src.groupJs)) errs.push('K 组合页须按权限过滤子功能（child.keys 对工作台 menu）—— 组合页不得放宽权限')
    if (!/hubNav\.invokeItem\(/.test(src.groupJs)) errs.push('K 组合页点子功能须经 hubNav.invokeItem 调工作台页上的原 handler（不另写跳转，原门禁不丢）')
    if (/wx\.showModal\s*\(/.test(src.groupJs)) errs.push('K 组合页不新增原生弹窗')
  }
  if (src.appJson) {
    let ok = false
    try {
      const app = JSON.parse(src.appJson)
      ok = (app.subpackages || []).some((p) => p.root === 'subpackages/manager' && (p.pages || []).includes('group/index'))
    } catch (e) { ok = false }
    if (!ok) errs.push('K 组合页未在 app.json 注册（subpackages/manager → group/index）')
  }
}

function judge(src) {
  const errs = []
  let nav
  let roles
  try {
    nav = evalCjs(src.hubNav)
  } catch (e) {
    return [`hubNav.js 加载失败：${e.message}`]
  }
  try {
    roles = evalCjs(src.roles)
  } catch (e) {
    return [`workspaceRoles.js 加载失败：${e.message}`]
  }
  const { tiles, secs } = parseTiles(src.wxml, errs)
  const pageCode = `${src.config}\n${src.indexJs}`
  const sections = nav.HUB_SECTIONS || []

  // 3) 无重复磁贴
  const sigs = new Map()
  const labels = new Map()
  for (const t of tiles) {
    const sig = tileSig(t)
    if (sigs.has(sig)) errs.push(`重复磁贴：「${t.label}」与「${sigs.get(sig)}」指向同一入口（${sig}）`)
    else sigs.set(sig, t.label)
    if (labels.has(t.label)) errs.push(`重复磁贴：名称「${t.label}」出现不止一次`)
    else labels.set(t.label, true)
  }

  for (const t of tiles) {
    if (!hasMethod(pageCode, t.bindtap)) {
      errs.push(`磁贴「${t.label}」的入口 ${t.bindtap} 在页面上不存在`)
    }
  }

  // 1) + 2) 原有入口可达（独立磁贴直达，或组合磁贴里的子功能）、权限不丢、不重复
  const placesOf = (o) => tiles.flatMap((t) => hitsOf(nav, o, t).map((h) => ({ t, ...h })))
  for (const o of ORIGINAL) {
    const places = placesOf(o)
    if (!places.length) {
      errs.push(`入口丢失：改版前的「${o.name}」在全部功能里没有直达磁贴，也不在任何组合里`)
      continue
    }
    if (places.length > 1) errs.push(`入口重复：「${o.name}」出现在 ${places.length} 处（${places.map((p) => p.t.label).join(' / ')}）—— 归并后只留一处`)
    for (const p of places) {
      if (!setEq(p.keys, o.keys)) errs.push(`权限条件变化：「${o.name}」${p.child ? `组合「${p.t.label}」子功能` : '磁贴'} 权限=[${p.keys}]，改版前=[${o.keys}]`)
      if (p.child && !o.keys.every((k) => p.t.keys.includes(k))) errs.push(`权限条件变化：组合「${p.t.label}」磁贴权限 [${p.t.keys}] 没覆盖子功能「${o.name}」的 [${o.keys}]（有权限的人会看不到入口）`)
    }
  }
  // 扫码主按钮
  if (!/<view class="hub-scan-cta" wx:if="\{\{menu\.verify \|\| menu\.grantPoints \|\| menu\.staffConsole\}\}">[\s\S]{0,200}bindtap="goScanMember"/.test(src.wxml)) {
    errs.push('入口丢失：首屏「扫顾客会员码」主按钮（menu.verify || menu.grantPoints || menu.staffConsole → goScanMember）')
  }

  // 4) 分区
  const secIds = sections.map((s) => s.id)
  for (const s of secs) if (!secIds.includes(s.id)) errs.push(`分区 hubSec.${s.id} 在 HUB_SECTIONS 里没有定义`)
  for (const s of sections) {
    if (!secs.some((x) => x.id === s.id)) {
      errs.push(`HUB_SECTIONS.${s.id}（${s.title}）在 index.wxml 里没有分区块`)
      continue
    }
    const union = uniq(tiles.filter((t) => t.sec === s.id).flatMap((t) => t.keys))
    if (!setEq(uniq(s.keys), union)) {
      errs.push(`分区「${s.title}」keys=[${s.keys}] 与区内磁贴菜单键之并=[${union}] 不一致 —— 分区可能被错误隐藏或空显示`)
    }
  }
  for (const t of tiles) if (!t.sec) errs.push(`磁贴「${t.label}」不在任何 hub-grp 分区内`)

  // 5) 行为：各角色下「改版前可见 ⇔ 改版后可达」
  const roleIds = [roles.WORKSPACE_SUPER_ADMIN, roles.WORKSPACE_STORE_MANAGER, roles.WORKSPACE_STORE_STAFF, roles.WORKSPACE_SPECIMEN_ARTISAN]
  for (const role of roleIds) {
    const menu = {}
    Object.values(roles.MENU_KEYS).forEach((k) => { menu[k] = roles.canSeeMenu(role, k) })
    let flags
    try {
      flags = nav.sectionFlags(menu)
    } catch (e) {
      errs.push(`sectionFlags 执行失败：${e.message}`)
      break
    }
    for (const o of ORIGINAL) {
      const before = o.keys.some((k) => menu[k])
      // 组合子功能按子功能自己的键判（组合页按它过滤），且组合磁贴本身可见
      const after = placesOf(o).some((p) => p.keys.some((k) => menu[k]) && p.t.keys.some((k) => menu[k]) && flags[p.t.sec] === true)
      if (before && !after) errs.push(`角色 ${role}：「${o.name}」改版前可见，改版后不可达`)
      if (!before && after) errs.push(`角色 ${role}：「${o.name}」改版前不可见，改版后却能进入（权限被放宽）`)
    }
  }
  // 6) 入口层不弹原生 modal；可见文案无技术字段
  for (const [k, code] of [['hubNav.js', src.hubNav], ['index.js', src.indexJs]]) {
    if (/wx\.showModal\s*\(/.test(code)) errs.push(`${k} 出现 wx.showModal —— 入口层不新增原生弹窗`)
  }
  const texts = []
  // 入口区：搜索 → 待办 → 扫码 → 常用（金卡 / 经营信号在其上方，不进本扫描）+ 全部功能列表
  const hubTop = (src.wxml.match(/<!-- 功能搜索[\s\S]*?<!-- 瀑布流布局容器/) || [''])[0]
  if (!hubTop) errs.push('找不到首屏入口块（功能搜索 → 瀑布流布局容器之间；守卫锚点需要同步更新）')
  const hubBlock = hubTop + ((src.wxml.match(/<view class="grid-item full-width hub-nav">[\s\S]*?<!-- 数据图表/) || [''])[0])
  if (!/hub-nav/.test(hubBlock)) errs.push('找不到 hub-nav 入口块（守卫锚点需要同步更新）')
  hubBlock.replace(/<!--[\s\S]*?-->/g, '').replace(/>([^<>{}]+)</g, (_, t) => { if (t.trim()) texts.push(t.trim()); return '' })
  for (const e of nav.HUB_ENTRIES || []) texts.push(e.label, e.desc, e.sub)
  for (const t of nav.HUB_TODOS || []) texts.push(t.label)
  for (const s of sections) texts.push(s.title)
  for (const t of texts) {
    const low = String(t || '').toLowerCase()
    const hit = TECH_WORDS.find((w) => low.includes(w))
    if (hit) errs.push(`可见文案含技术字段「${hit}」：${t}`)
  }
  for (const t of nav.HUB_TODOS || []) {
    if (!hasMethod(pageCode, t.tap)) errs.push(`待办条「${t.label}」的入口 ${t.tap} 在页面上不存在`)
  }
  // 7) 统一清单 ↔ 分区磁贴
  const entries = nav.HUB_ENTRIES || []
  const ids = entries.map((e) => e.id)
  if (uniq(ids).length !== ids.length) errs.push('HUB_ENTRIES 的 id 有重复')
  for (const e of entries) {
    const hit = tiles.filter((t) => tileSig(t) === entrySig(e))
    if (hit.length !== 1) {
      errs.push(`清单入口 ${e.id}（${e.label}）在分区磁贴里应恰好一枚，实际 ${hit.length}`)
      continue
    }
    const t = hit[0]
    if (t.label !== e.label) errs.push(`清单与磁贴名称不一致：${e.id} 清单「${e.label}」磁贴「${t.label}」`)
    if (t.icon !== e.icon) errs.push(`清单与磁贴图标不一致：${e.id}`)
    if (!setEq(t.keys, uniq(e.keys))) errs.push(`清单与磁贴权限键不一致：${e.id} 清单=[${e.keys}] 磁贴=[${t.keys}]`)
    if (t.sec !== e.sec) errs.push(`清单与磁贴分区不一致：${e.id} 清单=${e.sec} 磁贴=${t.sec}`)
  }
  if (tiles.length !== entries.length) errs.push(`分区磁贴 ${tiles.length} 枚 ≠ 清单 ${entries.length} 条（有磁贴没进清单，常用区就挑不到它）`)

  // 8) 我的常用
  try {
    const superMenu = {}
    const mgrMenu = {}
    Object.values(roles.MENU_KEYS).forEach((k) => {
      superMenu[k] = roles.canSeeMenu(roles.WORKSPACE_SUPER_ADMIN, k)
      mgrMenu[k] = roles.canSeeMenu(roles.WORKSPACE_STORE_MANAGER, k)
    })
    if (nav.FAV_MAX !== 8) errs.push(`常用上限应为 8（当前 ${nav.FAV_MAX}）`)
    const allIds = entries.map((e) => e.id)
    const capped = nav.normalizeFavs(allIds, superMenu)
    if (capped.length > 8) errs.push(`常用上限未生效：超管全选后仍有 ${capped.length} 个`)
    const mgrOnly = nav.normalizeFavs(['memberCrm', 'feishu', 'orders', 'aiIdentify'], mgrMenu)
    if (JSON.stringify(mgrOnly) !== JSON.stringify([canonOf(nav)('orders')])) {
      errs.push(`常用区只含有权限入口：店长配置 [memberCrm, feishu, orders, aiIdentify] 应只剩 [orders]，实际 [${mgrOnly}]`)
    }
    const canon = canonOf(nav)
    const mapped = nav.normalizeFavs(['gift', 'memberCurator', 'honoraryCurators', 'shipmentSku', 'giftManage', 'no_such_entry'], superMenu)
    const want = canonList(canon, ['giftOps', 'memberLevel', 'curators', 'shipment', 'giftManage'])
    if (JSON.stringify(mapped) !== JSON.stringify(want)) {
      errs.push(`失效 id 映射 / 过滤不对：[gift, memberCurator, honoraryCurators, shipmentSku, giftManage, no_such_entry] 应得 [${want}]，实际 [${mapped}]`)
    }
    for (const [from, to] of Object.entries(nav.FAV_ID_ALIASES || {})) {
      for (const id of [].concat(to)) if (!nav.findEntry(id)) errs.push(`常用映射 ${from} → ${id} 指向不存在的入口`)
    }
    for (const [role, list] of Object.entries(nav.FAV_DEFAULTS || {})) {
      for (const id of list) if (!nav.findEntry(id)) errs.push(`默认常用 ${role} 含不存在的入口 ${id}`)
    }
    for (const [role, menu] of [[roles.WORKSPACE_SUPER_ADMIN, superMenu], [roles.WORKSPACE_STORE_MANAGER, mgrMenu]]) {
      const d = nav.defaultFavs(role, menu)
      if (!d.length) errs.push(`角色 ${role} 没有默认常用`)
      if (d.length > 8) errs.push(`角色 ${role} 默认常用超过上限`)
    }
    const full = allIds.slice(0, 8)
    if (nav.toggleFav(full, allIds[9]).length !== 8) errs.push('常用已满 8 个时 toggleFav 仍能加入')
    const view = nav.buildFavView(['orders', 'support'], { menu: superMenu, orders: [1, 2], supportTickets: [] })
    if (!view[0] || view[0].badge !== '2' || view[1].badge !== '') errs.push('常用区角标与分区磁贴口径不一致（订单 2 / 有信 0）')
  } catch (e) {
    errs.push(`常用区逻辑执行失败：${e.message}`)
  }
  if (!/<view\s+class="hub-tile hub-fav-tile"\s+wx:for="\{\{hubFav\}\}"[\s\S]{0,120}bindtap="onHubFav"/.test(src.wxml)) {
    errs.push('常用区须按清单 wx:for="{{hubFav}}" 渲染并绑 onHubFav')
  }
  if (!/bindtap="openFavEditor"/.test(src.wxml) || !/bindtap="onFavSave"/.test(src.wxml)) errs.push('常用区缺「编辑」入口或编辑面板的保存')
  const favTap = (src.indexJs.match(/\n  onHubFav\(e\) \{([\s\S]*?)\n  \},/) || [])[1] || ''
  if (!/entry\.keys\.some\(/.test(favTap)) errs.push('onHubFav 须在进入前再判一次权限（常用可能来自旧配置）')
  // 保存：编辑面板经 persistFavs —— 先归一化再按角色写回同一 key，其它角色的保存值原样保留（旧数据不丢）
  const persist = (src.indexJs.match(/\nfunction persistFavs\(page, ids\) \{([\s\S]*?)\n\}/) || [])[1] || ''
  if (!/hubNav\.normalizeFavs\(/.test(persist) || !/setStorageSync\(hubNav\.FAV_STORAGE_KEY, store\)/.test(persist) ||
    !/const store = readFavStore\(\)/.test(persist) || !/store\[page\.data\.workspaceRole \|\| 'unknown'\] = /.test(persist)) {
    errs.push('onFavSave 须先归一化（映射 / 权限 / 上限）再写本地 storage：persistFavs 须 normalizeFavs → 读整份 store → 只改本角色 → 写回 FAV_STORAGE_KEY')
  }
  const favSave = (src.indexJs.match(/\n  onFavSave\(\) \{([\s\S]*?)\n  \},/) || [])[1] || ''
  if (!/persistFavs\(this, /.test(favSave)) errs.push('onFavSave 须先归一化（映射 / 权限 / 上限）再写本地 storage（经 persistFavs）')
  if (!/function loadFavIds[\s\S]{0,300}hubNav\.normalizeFavs\([\s\S]{0,120}hubNav\.defaultFavs\(/.test(src.indexJs)) {
    errs.push('loadFavIds 须对已保存值归一化、未配置时用角色默认')
  }
  if (nav.FAV_STORAGE_KEY !== 'manager_hub_favs_v1') errs.push(`常用本地 key 须保持 manager_hub_favs_v1（当前 ${nav.FAV_STORAGE_KEY}）—— 换 key 等于把已有收藏全部弄丢`)
  judgeLayout(src, nav, roles, tiles, secs, errs)
  judgeSplit(src, nav, roles, tiles, errs)
  judgeKits(src, nav, roles, tiles, errs)
  return errs
}

/**
 * 2026-10-01 展示改版·方案 A（产品负责人点名）：
 *   N1 不再有需要解释的暗号 —— 无常用小金点（hub-pin / hubPinned）、无双圈（is-group / is-stack）、无长按手势，
 *      可见文案里也不再出现「长按」「双圈」之类的说明；磁贴内部只有「图标（右上角红色数字角标）/ 名称 / 可选短说明」；
 *   N2 每个入口都有一句大白话说明 —— 清单 desc 非空、≤ 16 字、无英文字母与技术词（搜索结果显示）；磁贴短说明 sub 可选、≤ 8 字，
 *      且与磁贴上的小字逐字一致；
 *   N3 待处理横条包含所有带角标的入口 —— 每个入口角标的数据源都映射到 HUB_TODOS（badge / merged），权限键一致；
 *      三角色计数全 > 0 时实跑；新单未读合并在待发订单数里；横条用同一枚 hub-badge 红色数字；
 *      首屏顺序 信息流 → 搜索（超管）→ 待处理 → 金卡 → 经营信号 → 扫码 → 常用 → 全部功能；
 *   N4「编辑」是常用的显式入口（常用区右上角，tap-press，打开编辑面板），全工作台没有长按加入；
 *   N5 搜索只在入口 > 20 的角色出现（超管有、店长 / 店员没有），按名称 / 别名 / 分组名找，只在有权限的入口里找；
 *   N6（2026-10-10 产品负责人点名回到 09-30 首版宫格）按大分类的扁平 4 列宫格、分类标题行点按收起 / 展开、默认全部展开、
 *      收起记录存本机 manager_hub_collapsed_v1、收起时标题行显示入口数与红点合计、有「全部展开 / 全部收起」；入口全部在宫格里。
 *   另：磁贴同一规格（class 只许 hub-cell、tap-press 80ms、data-fid = 清单 id）。
 */
function menuOf(roles, role) {
  const menu = {}
  Object.values(roles.MENU_KEYS).forEach((k) => { menu[k] = roles.canSeeMenu(role, k) })
  return menu
}

const DESC_MAX = 16
const DESC_TECH = /[A-Za-z]|云函数|接口|字段|集合|数据库|参数|缓存|配置项|权限键|同步率/

function judgeLayout(src, nav, roles, tiles, secs, errs) {
  const wx = src.wxml.replace(/<!--[\s\S]*?-->/g, '')
  const css = src.hubWxss.replace(/\/\*[\s\S]*?\*\//g, '')
  const entries = nav.HUB_ENTRIES || []
  const pageCode = `${src.config}\n${src.indexJs}`
  const sigOf = tileSig
  const SUPER = roles.WORKSPACE_SUPER_ADMIN
  const MGR = roles.WORKSPACE_STORE_MANAGER
  const STAFF = roles.WORKSPACE_STORE_STAFF
  const ROLES3 = [[SUPER, '超管'], [MGR, '店长'], [STAFF, '店员']]

  // ── N1 暗号清零 ──
  for (const [re, what] of [
    [/hub-pin\b|hubPinned/, '常用小金点（hub-pin / hubPinned）'],
    [/is-group|is-stack/, '双圈 / 合并标记（is-group / is-stack）'],
    [/bindlongpress/, '长按手势（bindlongpress）'],
    [/hub-tile-sub/, '磁贴副标题（hub-tile-sub）']
  ]) {
    if (re.test(wx)) errs.push(`N1 工作台又出现${what} —— 需要靠说明文字解释的暗号已按产品负责人口径去掉`)
  }
  for (const [re, what] of [[/\.hub-pin\b/, '.hub-pin'], [/\.is-group|\.is-stack/, '.is-group / .is-stack'], [/::?after/, '::after 角标 / 折角'], [/\.hub-dot|\.dotr/, '额外的点状标记']]) {
    if (re.test(css)) errs.push(`N1 hubNav.wxss 又出现 ${what} 样式（只保留红色数字角标一种标记）`)
  }
  if (/\n  onHubPin\(|pinToggle/.test(src.indexJs) || /pinToggle/.test(src.hubNav)) errs.push('N1 长按加常用（onHubPin / pinToggle）应已移除 —— 常用只经「编辑」管理')
  const hubTop = (src.wxml.match(/<!-- 功能搜索[\s\S]*?<!-- 瀑布流布局容器/) || [''])[0]
  const hubCat = (src.wxml.match(/<view class="grid-item full-width hub-nav">[\s\S]*?<!-- 数据图表/) || [''])[0]
  const visible = [hubTop, hubCat].map((b) => b.replace(/<!--[\s\S]*?(-->|$)/g, '')).join('\n')
  for (const w of ['长按', '双圈', '金点']) {
    if (visible.includes(w)) errs.push(`N1 可见文案里出现「${w}」—— 要靠说明解释的交互就是失败的交互`)
  }
  for (const t of tiles) {
    const cls = (t.tag.match(/class="([^"]*)"/) || [])[1]
    if (cls !== 'hub-cell') errs.push(`N1 入口「${t.label}」class="${cls}" —— 磁贴只许 hub-cell 一种`)
    if (t.hover !== 'tap-press' || attr(t.tag, 'hover-stay-time') !== '80') errs.push(`N1 入口「${t.label}」按压态须 hover-class="tap-press" hover-stay-time="80"`)
    const e = entries.find((x) => entrySig(x) === sigOf(t))
    if (!e || t.fid !== e.id) errs.push(`N1 入口「${t.label}」须 data-fid="${e ? e.id : '?'}"（= 清单 id）`)
    const body = t.body.replace(/<!--[\s\S]*?-->/g, '')
    const shape = /^\s*<view class="hub-ico">\s*<image class="hub-ico-img" [^>]*\/>\s*((?:<view class="hub-badge( hub-badge--live)?" wx:(?:el)?if="[^"]+">[^<]*<\/view>\s*)*)<\/view>\s*<text class="hub-cell-name">[^<]+<\/text>\s*(<text class="hub-cell-sub">[^<]+<\/text>\s*)?$/.exec(body)
    if (!shape) errs.push(`N1 入口「${t.label}」内部须只有「图标（角标在图标里）/ 名称 / 可选短说明」，不得再加点、圈、› 或别的标记`)
  }

  // ── N2 每个入口都有说明 ──
  for (const e of entries) {
    const d = String(e.desc || '')
    if (!d.trim()) { errs.push(`N2 入口「${e.label}」没有说明（每个入口都要一句大白话）`); continue }
    if (d.length > DESC_MAX) errs.push(`N2 入口「${e.label}」说明 ${d.length} 字，超过 ${DESC_MAX} 字（一行放不下）：${d}`)
    const tech = d.match(DESC_TECH)
    if (tech) errs.push(`N2 入口「${e.label}」说明里有技术词 / 英文「${tech[0]}」：${d}`)
    const sub = String(e.sub || '')
    if (sub.length > 8) errs.push(`N2 入口「${e.label}」磁贴小字 ${sub.length} 字，超过 8 字（宫格里一行放不下）：${sub}`)
    const subTech = sub.match(DESC_TECH)
    if (subTech) errs.push(`N2 入口「${e.label}」磁贴小字里有技术词 / 英文「${subTech[0]}」：${sub}`)
    const t = tiles.find((x) => sigOf(x) === entrySig(e))
    if (t && t.sub !== sub) errs.push(`N2 入口「${e.label}」磁贴小字「${t.sub}」与清单 sub「${sub}」不一致`)
  }

  // ── N3 待处理横条包含所有带角标的入口 ──
  const todos = nav.HUB_TODOS || []
  const sourceOf = (expr) => (expr.replace(/menu\.\w+ &&/, '').match(/([A-Za-z_]\w*)(?:\.length)? > 0/) || [])[1]
  const todoOf = (v) => todos.find((x) => x.badge === v || x.merged === v)
  const kitOfBadge = (expr) => {
    const m = String(expr || '').trim().match(/^hubKitBadge\.(\w+)$/)
    return m ? kitsOf(nav).find((k) => k.id === m[1]) || { id: m[1], children: [], missing: true } : null
  }
  for (const t of tiles) {
    const badges = t.body.match(/<view class="hub-badge"[^>]*?wx:(?:el)?if="\{\{([^}]*)\}\}"/g) || []
    const kitHasBadge = t.kit && kitsOf(nav).some((k) => k.id === t.kit && (k.children || []).some((c) => c.badge))
    if (t.kit && kitHasBadge !== badges.some((b) => b.includes(`hubKitBadge.${t.kit}`))) {
      errs.push(`N3 组合「${t.label}」${kitHasBadge ? '有带角标的子功能，磁贴却没有 hubKitBadge 角标' : '没有带角标的子功能，磁贴不该挂角标'}`)
    }
    for (const b of badges) {
      const expr = b.match(/wx:(?:el)?if="\{\{([^}]*)\}\}"/)[1]
      const kb = kitOfBadge(expr)
      if (kb) {
        if (kb.missing || kb.id !== t.kit) { errs.push(`N3 入口「${t.label}」的组合角标 hubKitBadge.${kb.id} 与磁贴的 data-kit 不一致`); continue }
        for (const c of kb.children.filter((x) => x.badge)) {
          const td = todoOf(c.badge)
          if (!td) { errs.push(`N3 待处理横条缺组合「${t.label}」子功能「${c.label}」的角标（数据源 ${c.badge}）`); continue }
          if (!setEq(uniq(td.keys), uniq(c.keys))) errs.push(`N3 待办「${td.label}」权限键 [${td.keys}] 与组合「${t.label}」子功能「${c.label}」[${c.keys}] 不一致`)
          if (!hasMethod(pageCode, td.tap)) errs.push(`N3 待办「${td.label}」入口 ${td.tap} 不存在`)
        }
        continue
      }
      const gate = (expr.match(/menu\.(\w+) &&/) || [])[1]
      const v = sourceOf(expr)
      if (!v) { errs.push(`N3 入口「${t.label}」角标条件「${expr}」读不出数据源`); continue }
      const td = todoOf(v)
      if (!td) { errs.push(`N3 待处理横条缺「${t.label}」的角标（数据源 ${v}）—— 带角标的入口都要汇总到顶部`); continue }
      const want = gate ? [gate] : t.keys
      if (!setEq(uniq(td.keys), want)) errs.push(`N3 待办「${td.label}」权限键 [${td.keys}] 与入口「${t.label}」角标口径 [${want}] 不一致`)
      if (!hasMethod(pageCode, td.tap)) errs.push(`N3 待办「${td.label}」入口 ${td.tap} 不存在`)
    }
  }
  const allCounts = {
    orders: [1, 2], newOrderUnreadCount: 3, customOrders: [1], supportTickets: [1], framerRecruitApps: [1],
    approvalPendingCount: 2, invoicePendingCount: 1, giftTodoCount: 4
  }
  for (const [role, label] of ROLES3) {
    const menu = menuOf(roles, role)
    let todo
    try {
      todo = nav.buildTodos({ ...allCounts, menu })
    } catch (e) {
      errs.push(`N3 buildTodos 执行失败：${e.message}`)
      break
    }
    for (const t of tiles) {
      if (!/class="hub-badge"/.test(t.body) || !t.keys.some((k) => menu[k])) continue
      const expr = (t.body.match(/<view class="hub-badge"[^>]*?wx:(?:el)?if="\{\{([^}]*)\}\}"/) || [])[1] || ''
      const kb = kitOfBadge(expr)
      if (kb) {
        let kitTxt = ''
        try { kitTxt = (nav.buildKitBadges({ ...allCounts, menu }) || {})[kb.id] } catch (e) { errs.push(`N3 buildKitBadges 执行失败：${e.message}`) }
        const want = kb.children.filter((c) => c.badge && c.keys.some((k) => menu[k])).reduce((n, c) => {
          const v = allCounts[c.badge]
          return n + (Array.isArray(v) ? v.length : Number(v) || 0)
        }, 0)
        if (String(kitTxt || '') !== (want > 0 ? String(want) : '')) errs.push(`N3 ${label}：组合「${t.label}」角标 ${kitTxt || '（空）'} ≠ 有权限的子功能角标之和 ${want}`)
        for (const c of kb.children.filter((x) => x.badge && x.keys.some((k) => menu[k]))) {
          const td = todoOf(c.badge)
          if (td && !todo.items.some((it) => it.id === td.id)) errs.push(`N3 ${label}：组合「${t.label}」子功能「${c.label}」有角标，待处理横条却没有「${td.label}」`)
        }
        continue
      }
      const gate = (expr.match(/menu\.(\w+) &&/) || [])[1]
      if (gate && !menu[gate]) continue
      const td = todoOf(sourceOf(expr))
      if (td && !todo.items.some((it) => it.id === td.id)) errs.push(`N3 ${label}：入口「${t.label}」有角标，待处理横条却没有「${td.label}」`)
    }
    if (menu.orders) {
      const only = nav.buildTodos({ menu, orders: [], newOrderUnreadCount: 3 }).items.find((it) => it.id === 'orders')
      if (!only || only.count !== '3') errs.push(`N3 ${label}：只有新单未读（3）时待发订单没算进去 —— 新单未读合并在待发订单数里`)
    }
  }
  if (!/<view\s+class="hub-todo-chip"\s+wx:for="\{\{hubTodo\.items\}\}"[\s\S]{0,120}bindtap="onHubTodo"[\s\S]{0,80}hover-class="tap-press"[\s\S]{0,200}<text class="hub-badge">\{\{item\.count\}\}<\/text>/.test(src.wxml)) {
    errs.push('N3 待处理横条须按 hubTodo.items 渲染、绑 onHubTodo、tap-press，计数用同一枚 hub-badge 红色数字')
  }
  const at = (re) => { const m = re.exec(src.wxml); return m ? m.index : -1 }
  const feedAt = at(/<!-- 信息流跑马灯/)
  const searchAt = at(/<view class="hub-search" wx:if="\{\{hubCat\.search\}\}">/)
  const todoAt = at(/<view class="hub-todo" wx:if="\{\{hubTodo\.items\.length\}\}">/)
  const kpiAt = at(/<view class="kpi-card gold-card"/)
  const signalAt = at(/<view class="ops-signal-board/)
  const ctaAt = at(/<view class="hub-scan-cta"/)
  const favAt = at(/<view class="hub-fav">/)
  const catAt = at(/<view class="grid-item full-width hub-nav">/)
  if ([feedAt, searchAt, todoAt, kpiAt, signalAt, ctaAt, favAt, catAt].some((x) => x < 0)
    || !(searchAt < feedAt && feedAt < todoAt && todoAt < kpiAt && kpiAt < signalAt && signalAt < ctaAt && ctaAt < favAt && favAt < catAt)) {
    // 2026-11-22 屏效改版（产品负责人「顶部搜索、处理动态等效率较低」）：搜索收进标题行，信息流与待处理合成一张状态条
    errs.push('N3 首屏顺序须为「搜索（超管，标题行）→ 状态条（信息流）→ 待处理横条 → 金卡 → 经营信号 → 扫码主按钮 → 我的常用 → 全部功能」')
  }

  // ── N4「编辑」是常用的显式入口 ──
  const favBlock = (src.wxml.match(/<view class="hub-fav">[\s\S]*?<!-- 瀑布流布局容器/) || [''])[0]
  if (!/<view class="hub-fav-head">[\s\S]{0,300}<view class="hub-fav-edit" bindtap="openFavEditor" hover-class="tap-press" hover-stay-time="80">编辑<\/view>/.test(favBlock)) {
    errs.push('N4 常用区右上角须有「编辑」按钮（hub-fav-edit → openFavEditor，tap-press）—— 加入常用要有显式入口')
  }
  if (!hasMethod(src.indexJs, 'openFavEditor')) errs.push('N4 openFavEditor 不存在')
  if (!/还没有常用入口[^<]*「编辑」/.test(favBlock)) errs.push('N4 常用为空时须指向「编辑」')

  // ── N5 搜索只在入口 > 20 的角色出现 ──
  if (!/<view class="hub-search" wx:if="\{\{hubCat\.search\}\}">[\s\S]{0,400}<input [^>]*bindinput="onHubSearch"/.test(src.wxml)) errs.push('N5 搜索框须 wx:if="{{hubCat.search}}" 并绑 onHubSearch')
  if (!/<view\s+class="hub-row"\s+wx:for="\{\{hubFound\}\}"[\s\S]{0,120}bindtap="onHubFav"/.test(src.wxml)) errs.push('N5 搜索结果须按 hubFound 渲染、点按走 onHubFav（进入前再判权限）')
  if (!/\n  onHubSearch\(e\) \{[\s\S]{0,300}hubNav\.searchEntries\(/.test(src.indexJs)) errs.push('N5 onHubSearch 须经 hubNav.searchEntries')
  for (const [role, label] of ROLES3) {
    const menu = menuOf(roles, role)
    let cat
    try { cat = nav.buildCatalog(menu) } catch (e) { errs.push(`N5 buildCatalog 执行失败：${e.message}`); return }
    const n = entries.filter((e) => e.keys.some((k) => menu[k])).length
    if (cat.hubCat.total !== n) errs.push(`N5 ${label}：全部功能计数 ${cat.hubCat.total} ≠ 可见入口 ${n}`)
    if (cat.hubCat.search !== (n > 20)) errs.push(`N5 ${label}：可见入口 ${n} 个，搜索框应${n > 20 ? '显示' : '隐藏'}（hubCat.search=${cat.hubCat.search}）`)
  }
  if (nav.buildCatalog(menuOf(roles, SUPER)).hubCat.search !== true) errs.push('N5 超管须有搜索框')
  if (nav.buildCatalog(menuOf(roles, MGR)).hubCat.search !== false) errs.push('N5 店长不应出搜索框（入口 ≤ 20）')
  try {
    const sm = { menu: menuOf(roles, SUPER) }
    const first = (q) => (nav.searchEntries(q, sm)[0] || {}).id
    const canon = canonOf(nav)
    if (first('审批') !== canon('approvals')) errs.push('N5 超管搜「审批」首条须为审批（按名称）')
    if (first('运费') !== canon('shipping')) errs.push('N5 超管搜「运费」首条须为运费规则')
    if (first('包邮') !== canon('shipping')) errs.push('N5 超管搜「包邮」须找到运费规则（按别名）')
    if (first('出货') !== canon('shipment')) errs.push('N5 超管搜「出货」首条须为出货中心')
    for (const q of ['SKU', 'sku', '商品', '价目']) {
      if (!nav.searchEntries(q, sm).some((x) => x.id === canon('skuMaintain'))) errs.push(`N5 超管搜「${q}」须找到「SKU 维护」`)
    }
    if (nav.searchEntries('SKU', { menu: menuOf(roles, MGR) }).some((x) => x.id === canon('skuMaintain'))) errs.push('N5「SKU 维护」仅超管：店长不得搜到')
    const studio = nav.searchEntries('工作室', sm).map((x) => x.id)
    if (!canonList(canon, ['studioDashboard', 'purchase', 'inventory']).every((id) => studio.includes(id))) errs.push('N5 超管搜分组名「工作室」须列出该组入口')
    if (nav.searchEntries('CRM', { menu: menuOf(roles, MGR) }).length) errs.push('N5 搜索须只在有权限的入口里找（店长搜到了会员 CRM）')
    if (nav.searchEntries('  ', sm).length) errs.push('N5 空白搜索词不应出结果')
  } catch (e) {
    errs.push(`N5 searchEntries 执行失败：${e.message}`)
  }

  // ── N6 按大分类的扁平宫格、可收起、默认展开、入口全部在（2026-10-10 回到 09-30 首版宫格） ──
  const catBlock = (src.wxml.match(/<view class="hub-cat" id="hub-cat">[\s\S]*?<!-- 数据图表/) || [''])[0]
  if (!/<view class="hub-cat-head">\s*<view class="hub-titles">\s*<text class="hub-en">ALL FUNCTIONS<\/text>\s*<text class="hub-cn">全部功能<\/text>/.test(catBlock)) {
    errs.push('N6 全部功能标题须为英文小标题 + 中文主标两行（hub-titles / ALL FUNCTIONS / 全部功能）')
  }
  if (!/<view class="hub-cat-toggle" bindtap="onHubCollapseAll" hover-class="tap-press-soft" hover-stay-time="80">\{\{hubAllCollapsed \? '全部展开' : '全部收起'\}\}<\/view>/.test(catBlock)) {
    errs.push('N6 「全部功能」标题右侧须有「全部展开 / 全部收起」开关（onHubCollapseAll，tap-press-soft）')
  }
  for (const s of secs) {
    const close = closeOf(src.wxml, s.at)
    const body = close > 0 ? src.wxml.slice(s.at, close) : ''
    const id = s.id
    if (!/^<view class="hub-grp" wx:if=/.test(body)) errs.push(`N6 分区 ${id} 开标签须只用 class="hub-grp"`)
    const head = (body.match(/<view class="hub-grp-head"[^>]*>/) || [''])[0]
    if (head !== `<view class="hub-grp-head" bindtap="onHubCollapse" data-sec="${id}" hover-class="tap-press-soft" hover-stay-time="80">`) {
      errs.push(`N6 分区 ${id} 标题行须点按收起 / 展开（bindtap="onHubCollapse" data-sec="${id}"，tap-press-soft 80ms）`)
    }
    const headBody = head ? body.slice(body.indexOf(head), closeOf(body, body.indexOf(head))) : ''
    if (!new RegExp(`<view class="hub-grp-fold" wx:if="\\{\\{hubCollapsed\\.${id}\\}\\}">[\\s\\S]*?\\{\\{hubSecMeta\\.${id}\\.n\\}\\} 项[\\s\\S]*?<view class="hub-badge" wx:if="\\{\\{hubSecMeta\\.${id}\\.badge\\}\\}">`).test(headBody)) {
      errs.push(`N6 分区 ${id} 收起时标题行须显示入口数（hubSecMeta.${id}.n）与红点合计（hubSecMeta.${id}.badge）`)
    }
    if (!headBody.includes(`<view class="hub-grp-arrow {{hubCollapsed.${id} ? 'is-collapsed' : ''}}"></view>`)) errs.push(`N6 分区 ${id} 标题行右侧须有随收起翻转的箭头`)
    const grids = body.match(/<view class="hub-grid--cat"[^>]*>/g) || []
    if (grids.length !== 1 || grids[0] !== `<view class="hub-grid--cat" wx:if="{{!hubCollapsed.${id}}}">`) {
      errs.push(`N6 分区 ${id} 须恰好一个宫格，且只在未收起时显示（<view class="hub-grid--cat" wx:if="{{!hubCollapsed.${id}}}">）`)
    } else {
      const gAt = s.at + body.indexOf(grids[0])
      const gEnd = closeOf(src.wxml, gAt)
      const outside = tiles.filter((t) => t.sec === id && !(src.wxml.indexOf(t.tag) > gAt && src.wxml.indexOf(t.tag) < gEnd))
      if (outside.length) errs.push(`N6 分区 ${id} 的入口「${outside.map((t) => t.label)}」不在宫格里`)
    }
  }
  if (/<view class="hub-cat-body"|<view class="hub-list"/.test(catBlock)) errs.push('N6 全部功能又出现整块面板 / 列表行容器（hub-cat-body / hub-list）—— 须为分类宫格')
  for (const [code, file] of [[wx, 'index.wxml'], [src.indexJs, 'index.js'], [src.hubNav, 'hubNav.js']]) {
    const m = code.match(/hubFold|hubPeek|onHubFold/)
    if (m) errs.push(`N6 ${file} 仍有旧手风琴残留「${m[0]}」`)
  }
  const rules = cssRules(src.hubWxss)
  const decl = (sel, prop) => (rules.filter((r) => r.sel === sel).map((r) => r.decls[prop]).filter(Boolean).pop() || '')
  if (decl('.hub-grid--cat', 'grid-template-columns').replace(/\s+/g, '') !== 'repeat(4,minmax(0,1fr))') errs.push('N6 宫格须 4 列（grid-template-columns: repeat(4, minmax(0, 1fr))）')
  if (decl('.hub-cell .hub-badge', 'position') !== 'absolute') errs.push('N6 磁贴红色数字角标须贴在图标右上角（.hub-cell .hub-badge 绝对定位）')
  if (decl('.hub-cell .hub-ico', 'border-radius') !== '50%') errs.push('N6 磁贴图标底须是圆形（.hub-cell .hub-ico border-radius: 50%）')
  if (!/\.hub-grid--cat \{[^}]*animation:[^;]*0\.\d+s/.test(css)) errs.push('N6 宫格展开须有轻量动画（.hub-grid--cat animation，< 1s）')

  // 收起状态：本机记住、默认全部展开、只认已知分区、一键全部
  if (nav.COLLAPSE_STORAGE_KEY !== 'manager_hub_collapsed_v1') errs.push(`N6 分类收起记录的本机 key 须为 manager_hub_collapsed_v1（当前 ${nav.COLLAPSE_STORAGE_KEY}）`)
  try {
    const none = nav.normalizeCollapsed(undefined)
    if (Object.keys(none).length) errs.push('N6 没有收起记录时须全部展开（normalizeCollapsed(undefined) 应为空）')
    const mixed = nav.normalizeCollapsed({ orders: true, biz: 1, nope: true, goods: false })
    if (JSON.stringify(mixed) !== '{"orders":true}') errs.push(`N6 收起记录只认已知分区且值为 true（当前 ${JSON.stringify(mixed)}）`)
    for (const [role, label] of ROLES3) {
      const flags = nav.sectionFlags(menuOf(roles, role))
      const vis = Object.keys(flags).filter((k) => flags[k])
      const folded = nav.toggleAllCollapsed({}, flags)
      if (!vis.every((k) => folded[k] === true) || !nav.allCollapsed(folded, flags)) errs.push(`N6 ${label}：「全部收起」须收起全部可见分类`)
      const opened = nav.toggleAllCollapsed(folded, flags)
      if (Object.keys(opened).some((k) => vis.includes(k)) || nav.allCollapsed(opened, flags)) errs.push(`N6 ${label}：全部收起后再点须全部展开`)
      if (nav.allCollapsed({}, flags)) errs.push(`N6 ${label}：默认（无记录）不应判为全部收起`)
    }
    const sm = menuOf(roles, SUPER)
    const hotData = { menu: sm, orders: [1, 2], newOrderUnreadCount: 3, customOrders: [1], supportTickets: [1], framerRecruitApps: [1], approvalPendingCount: 2, invoicePendingCount: 1, giftTodoCount: 4 }
    const meta = nav.buildSecMeta(hotData)
    for (const sec of nav.HUB_SECTIONS || []) {
      const es = entries.filter((e) => e.sec === sec.id && e.keys.some((k) => sm[k]))
      if (!es.length) continue
      const m = meta[sec.id] || {}
      if (m.n !== es.length) errs.push(`N6 超管：分类「${sec.title}」收起时入口数 ${m.n} ≠ 可见入口 ${es.length}`)
    }
    // 订单 3（有新单未读时显示未读数）+ 工单 1 + 礼赠 4 + 发票 1 + 审批 2
    if (!meta.orders || meta.orders.badge !== '11') errs.push(`N6 超管：订单履约收起时红点合计须为各入口角标之和 11（当前 ${meta.orders && meta.orders.badge}）`)
    if (nav.buildSecMeta({ menu: sm }).orders.badge !== '') errs.push('N6 无待办时收起的标题行不应出红点')
  } catch (e) {
    errs.push(`N6 收起逻辑实跑失败：${e.message}`)
  }
  if (!/\n  onHubCollapse\(e\) \{[\s\S]{0,400}persistCollapsed\(this, next\)/.test(src.indexJs)) errs.push('N6 onHubCollapse 须切换该分类并写回本机（persistCollapsed）')
  if (!/\n  onHubCollapseAll\(\) \{[\s\S]{0,200}hubNav\.toggleAllCollapsed\(/.test(src.indexJs)) errs.push('N6 onHubCollapseAll 须经 hubNav.toggleAllCollapsed')
  if (!/function persistCollapsed[\s\S]{0,300}wx\.setStorageSync\(hubNav\.COLLAPSE_STORAGE_KEY, clean\)/.test(src.indexJs)) errs.push('N6 收起状态须写本机（wx.setStorageSync(hubNav.COLLAPSE_STORAGE_KEY, …)）')
  if (!/function readCollapsed[\s\S]{0,200}hubNav\.normalizeCollapsed\(wx\.getStorageSync\(hubNav\.COLLAPSE_STORAGE_KEY\)\)/.test(src.indexJs)) errs.push('N6 进页须读回本机收起记录并归一化')
  if (!/applyWorkspaceRole\(role\) \{[\s\S]{0,500}readCollapsed\(\)/.test(src.indexJs)) errs.push('N6 切换角色 / 进页时须应用本机收起记录')
  if (!/refreshOpsSignals\(\) \{[\s\S]{0,400}hubSecMeta: hubNav\.buildSecMeta\(this\.data\)/.test(src.indexJs)) errs.push('N6 角标变化后须刷新收起标题行的红点合计（hubSecMeta）')

  // 图标：素材必须存在；不许用实心圆素材（经金色单色滤镜后是一块实心圆，看不出图形）
  const SOLID_ICONS = ['checkin.png', 'atlas.png']
  for (const e of entries) {
    const rel = String(e.icon || '').replace(/^\//, '')
    if (!rel || !existsSync(resolve(ROOT, 'miniprogram', rel))) errs.push(`N6 入口「${e.label}」图标文件不存在：${e.icon}`)
    if (SOLID_ICONS.some((f) => rel.endsWith(`/${f}`))) errs.push(`N6 入口「${e.label}」用了实心素材 ${e.icon}（滤镜后是一块实心圆 / 方块，看不出图形）`)
  }
}

/**
 * N7（2026-10-10 产品负责人「类似功能折叠的全部展开单独展示」）：原「点开再选」的折叠磁贴 → 拆开后的子入口（清单 id）。
 * 父 id 只许留在常用映射里（旧收藏平滑过渡），不许再是磁贴。
 */
const SPLIT = {
  gift: ['giftOps', 'giftManage'],
  perks: ['welcomeGift', 'birthdayGift', 'walletConfig'],
  artisan: ['framers', 'framerRecruit', 'artisanCommission'],
  org: ['staffDirectory', 'staffPermissions', 'shareholderConfig'],
  payslip: ['myPayslip', 'payslipAdmin'],
  rules: ['shipping', 'bookingRules', 'supportConfig']
}
/**
 * 功能总数棘轮：独立入口 + 组合子功能，只许多不许少（拆分后 48；2026-10-10 加「SKU 维护」→ 49；2026-11-23 加「博物君」→ 50；
 * 2026-11-25 加「评价」「审核」→ 52）。2026-11-25 起同类功能归并成组合入口，**磁贴数会变少，功能数不许少**；删功能须产品负责人点名并在此改数。
 */
const MIN_FUNCTIONS = 52

function judgeSplit(src, nav, roles, tiles, errs) {
  const entries = nav.HUB_ENTRIES || []
  const wx = src.wxml.replace(/<!--[\s\S]*?-->/g, '')
  // 没有折叠磁贴 / 二级面板残留
  const kits = kitsOf(nav)
  const kitOf = (id) => kits.find((k) => k.id === id) || null
  const inKit = (id) => kits.some((k) => (k.children || []).some((c) => c.id === id))
  for (const t of tiles) {
    if (t.bindtap === 'openHubGroup' || t.dataGroup != null) errs.push(`N7 磁贴「${t.label}」又是「点开再选」的折叠磁贴（openHubGroup / data-group）—— 每个功能单独一枚磁贴`)
  }
  if (/hub-cell-go/.test(wx)) errs.push('N7 磁贴又出现右上角 ›（hub-cell-go）—— 已没有点开再选的磁贴')
  for (const [code, file] of [[wx, 'index.wxml'], [src.indexJs, 'index.js'], [src.hubNav, 'hubNav.js']]) {
    const m = code.match(/openHubGroup|onHubGroupItem|closeHubGroup|hubSheet|HUB_GROUPS|buildSheet|visibleItems/)
    if (m) errs.push(`N7 ${file} 仍有二级面板残留「${m[0]}」`)
  }
  if (nav.HUB_GROUPS) errs.push('N7 hubNav 仍导出 HUB_GROUPS（二级面板已删除）')
  for (const e of entries) {
    if (e.group || e.tap === 'openHubGroup') errs.push(`N7 清单入口「${e.label}」又是折叠入口（group / openHubGroup）`)
  }
  // 原折叠的子功能仍可达：独立入口（清单一条 + 磁贴一枚）或组合子功能；父 id 只能以「组合入口」身份回到清单
  const fav = nav.FAV_ID_ALIASES || {}
  for (const [parent, kids] of Object.entries(SPLIT)) {
    const back = entries.find((e) => e.id === parent)
    if (back && !(back.tap === KIT_TAP && kitOf(parent))) errs.push(`N7 被拆开的折叠入口「${parent}」又回到清单里（只能以组合入口 + 组合页的形式回来，不能是点开再选）`)
    for (const id of kids) {
      if (inKit(id)) continue
      const e = entries.find((x) => x.id === id)
      if (!e) { errs.push(`N7 子功能 ${id} 不再可达（既不是独立入口，也不在任何组合里）`); continue }
      if (tiles.filter((t) => t.fid === id).length !== 1) errs.push(`N7 子功能「${e.label}」在全部功能里须恰好一枚独立磁贴`)
    }
    const targets = [].concat(fav[parent] || [])
    const covers = (k) => targets.includes(k) || targets.some((x) => ((kitOf(x) || {}).children || []).some((c) => c.id === k))
    if (!kids.every(covers)) errs.push(`N7 常用里的旧折叠 id「${parent}」须映射到它的子功能 [${kids}] 或其所在组合（当前 ${JSON.stringify(fav[parent])}）—— 否则旧收藏会变空位`)
  }
  const sm = menuOf(roles, roles.WORKSPACE_SUPER_ADMIN)
  const mm = menuOf(roles, roles.WORKSPACE_STORE_MANAGER)
  const leaves = (menu) => entries.flatMap((e) => (e.kit && kitOf(e.kit) ? kitOf(e.kit).children || [] : [e]))
    .filter((x) => !menu || (x.keys || []).some((k) => menu[k]))
  const total = leaves(null).length
  if (total < MIN_FUNCTIONS) errs.push(`N7 功能总数 ${total} < ${MIN_FUNCTIONS} —— 功能（独立入口 + 组合子功能）只许多不许少`)
  const superN = leaves(sm).length
  if (superN < MIN_FUNCTIONS) errs.push(`N7 超管可用功能 ${superN} < ${MIN_FUNCTIONS}`)
  // 常用里的旧折叠 id：映射到当前角色第一个有权限的子入口；一个都没权限就丢掉（不留空位）
  try {
    const canon = canonOf(nav)
    const sup = nav.normalizeFavs(['org', 'payslip', 'rules', 'artisan', 'perks'], sm)
    const wantSup = canonList(canon, ['staffDirectory', 'myPayslip', 'shipping', 'framers', 'welcomeGift'])
    if (JSON.stringify(sup) !== JSON.stringify(wantSup)) errs.push(`N7 超管旧折叠常用 [org, payslip, rules, artisan, perks] 应映射为 [${wantSup}]，实际 [${sup}]`)
    const mgr = nav.normalizeFavs(['payslip', 'gift', 'org'], mm)
    const wantMgr = canonList(canon, ['myPayslip', 'giftOps'])
    if (JSON.stringify(mgr) !== JSON.stringify(wantMgr)) errs.push(`N7 店长旧折叠常用 [payslip, gift, org] 应映射为 [${wantMgr}]（组织无权限须丢掉，不留空位），实际 [${mgr}]`)
    // 只有部分子功能权限：旧折叠 id 须落到第一个**有权限**的去处（礼包只给了钱包配置、组织只给了股东）
    const partial = nav.normalizeFavs(['perks', 'org'], { walletConfig: true, shareholderConfig: true })
    const wantPartial = canonList(canon, ['walletConfig', 'shareholderConfig'])
    if (JSON.stringify(partial) !== JSON.stringify(wantPartial)) errs.push(`N7 只有部分子功能权限时，旧折叠常用须映射到第一个有权限的子入口：[perks, org] 应得 [${wantPartial}]，实际 [${partial}]`)
    const view = nav.buildFavView(['gift', 'payslip'], { menu: mm, giftTodoCount: 3 })
    if (!view.length || view.some((v) => !v.id || !v.label || !nav.findEntry(v.id))) errs.push('N7 旧折叠常用渲染出空位（常用磁贴缺 id / 名称）')
    else if ((view.find((v) => v.id === canon('giftOps')) || {}).badge !== '3') errs.push(`N7 旧「礼赠」常用映射后须带上礼赠待办红点 3（当前「${(view.find((v) => v.id === canon('giftOps')) || {}).badge}」）`)
  } catch (e) {
    errs.push(`N7 旧折叠常用映射实跑失败：${e.message}`)
  }
}

function loadNavEntries(src) {
  try { return evalCjs(src.hubNav).HUB_ENTRIES || [] } catch (e) { return [] }
}

function run(src) {
  const errs = judge(src)
  return { ok: errs.length === 0, errs }
}

const selftest = process.argv.includes('--selftest')
const base = loadSrc()

if (!selftest) {
  const { ok, errs } = run(base)
  if (!ok) {
    console.error(`${TAG} ✗ ${errs.length} 处问题：`)
    errs.forEach((e) => console.error('  -', e))
    process.exitCode = 1
  } else {
    const nav0 = evalCjs(base.hubNav)
    console.log(`${TAG} ✓ 改版前 ${ORIGINAL.length} 个入口均可达（独立磁贴或组合子功能）、权限条件未变、无重复、分区口径一致、无折叠磁贴 / 二级面板、组合入口 ${kitsOf(nav0).length} 个（权限 = 子功能之并、组合页按权限过滤并调原入口）、清单 ↔ 磁贴 ${(loadNavEntries(base)).length} 枚逐枚一致、常用区权限 / 映射 / 上限 / 默认值成立（超管 / 店长 / 店员 / 标本师四角色实跑）；无暗号标记、每个入口有大白话说明、待处理横条含全部角标入口、「编辑」显式管理常用、搜索只给入口 > 20 的角色、按大分类宫格且可收起 / 默认展开 / 本机记住（三角色实跑）`)
  }
} else {
  const rep = (key, from, to) => (s) => {
    if (!s[key].includes(from)) throw new Error(`注入锚点失效：${key} 里找不到 ${from.slice(0, 60)}`)
    return { ...s, [key]: s[key].replace(from, to) }
  }
  // 组合入口样本：把「孤品定金」「股东」并成组合 sampleKit（S2 起的真组合与此同构）
  const SAMPLE_SHAREHOLDER_TILE = '            <view class="hub-cell" hover-class="tap-press" hover-stay-time="80" data-fid="shareholderConfig" wx:if="{{menu.shareholderConfig}}" bindtap="goShareholderConfig">\n              <view class="hub-ico"><image class="hub-ico-img" src="/assets/icons/coin_gold.png" mode="aspectFit" /></view>\n              <text class="hub-cell-name">股东</text>\n            </view>'
  function kitSample(b) {
    const cut = (wxml, fid, label) => {
      const m = wxml.match(new RegExp(`\\n\\s*<view class="hub-cell" hover-class="tap-press" hover-stay-time="80" data-fid="${fid}"[\\s\\S]*?<text class="hub-cell-name">${label}<\\/text>\\s*<\\/view>`))
      if (!m) throw new Error(`注入锚点失效：${label}磁贴`)
      return wxml.replace(m[0], '')
    }
    let wxml = cut(cut(b.wxml, 'deposit', '孤品定金'), 'shareholderConfig', '股东')
    const tile = '\n            <view class="hub-cell" hover-class="tap-press" hover-stay-time="80" data-fid="sampleKit" wx:if="{{menu.depositOps || menu.shareholderConfig}}" bindtap="openHubKitPage" data-kit="sampleKit">\n              <view class="hub-ico"><image class="hub-ico-img" src="/assets/icons/discount.png" mode="aspectFit" /></view>\n              <text class="hub-cell-name">样本组合</text>\n              <text class="hub-cell-sub">定金·股东</text>\n            </view>'
    const grid = '<view class="hub-grid--cat" wx:if="{{!hubCollapsed.orders}}">'
    if (!wxml.includes(grid)) throw new Error('注入锚点失效：订单分区宫格')
    wxml = wxml.replace(grid, grid + tile)
    let hubNav = b.hubNav
    const cutLine = (code, id) => {
      const m = code.match(new RegExp(`\\n  \\{ id: '${id}',[^\\n]*`))
      if (!m) throw new Error(`注入锚点失效：清单 ${id}`)
      return code.replace(m[0], '')
    }
    hubNav = cutLine(cutLine(hubNav, 'deposit'), 'shareholderConfig')
    hubNav = hubNav.replace("const HUB_ENTRIES = [", "const HUB_ENTRIES = [\n  { id: 'sampleKit', label: '样本组合', sub: '定金·股东', desc: '定金和股东，一页切换', alias: ['孤品定金', '股东', '订金', '占股'], icon: ICON + 'discount.png', sec: 'orders', keys: ['depositOps', 'shareholderConfig'], tap: 'openHubKitPage', kit: 'sampleKit' },")
    const sampleKit = "  { id: 'sampleKit', label: '样本组合', icon: ICON + 'discount.png', sec: 'orders', children: [\n    { id: 'deposit', label: '孤品定金', desc: '卖完的孤品，顾客交的订金', keys: ['depositOps'], tap: 'goDepositOps' },\n    { id: 'shareholderConfig', label: '股东', desc: '门店占股和回本前后分成', keys: ['shareholderConfig'], tap: 'goShareholderConfig', kitChild: 1 }\n  ] }"
    const hadKits = hubNav.includes('const HUB_KITS = [')
    hubNav = hadKits
      ? hubNav.replace('const HUB_KITS = [', `const HUB_KITS = [\n${sampleKit},`)
      : hubNav.replace("/* ── 我的常用 ── */", `const HUB_KITS = [\n${sampleKit}\n]\nfunction findKit(id) { return HUB_KITS.find((k) => k.id === id) || null }\n\n/* ── 我的常用 ── */`)
    hubNav = hubNav.replace("depositOps: 'deposit',", "depositOps: 'sampleKit', deposit: 'sampleKit', shareholderConfig: 'sampleKit',")
    hubNav = hubNav.replace(/(\n  org: [^\n]*)'shareholderConfig'/, "$1'sampleKit'")
    if (!hadKits) hubNav = hubNav.replace("module.exports = {", "module.exports = {\n  HUB_KITS,\n  findKit,")
    // 分区 keys：股东从组织区移到订单区（组合磁贴落在订单区）
    hubNav = hubNav.replace("'staffPermissions', 'shareholderConfig', 'payslipAdmin'", "'staffPermissions', 'payslipAdmin'").replace("'approvals', 'depositOps'] }", "'approvals', 'depositOps', 'shareholderConfig'] }")
    const indexJs = /\n  openHubKitPage\(e\) \{/.test(b.indexJs) ? b.indexJs : b.indexJs.replace('  onHubSearchClear() {', "  openHubKitPage(e) {\n    const kit = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.kit) || '')\n    if (kit) wx.navigateTo({ url: '/subpackages/manager/group/index?kit=' + kit })\n  },\n\n  onHubSearchClear() {")
    const groupJs = "const hubNav = require('../manager/hubNav')\nPage({\n  onLoad(q) {\n    const kit = hubNav.findKit(q.kit)\n    const host = getCurrentPages().slice(-2)[0]\n    const menu = (host && host.data && host.data.menu) || {}\n    this.setData({ rows: kit ? kit.children.filter((c) => c.keys.some((k) => menu[k] === true)) : [] })\n  },\n  onRow(e) {\n    const host = getCurrentPages().slice(-2)[0]\n    hubNav.invokeItem(host, this.data.rows[e.currentTarget.dataset.i])\n  }\n})\n"
    const app = JSON.parse(b.appJson)
    app.subpackages.forEach((p) => { if (p.root === 'subpackages/manager' && !p.pages.includes('group/index')) p.pages.splice(1, 0, 'group/index') })
    // 真组合页已存在（S2 起）就用真的，只在没有时给一个同构桩
    return { ...b, wxml, hubNav, indexJs, groupJs: b.groupJs || groupJs, groupWxml: b.groupWxml || '<view></view>', appJson: JSON.stringify(app, null, 2) }
  }
  const cases = [
    // 不误报对照：清单与磁贴同步改名、入口与权限仍在 → 必须仍通过
    ['荣誉馆长同步改名', (s) => rep('hubNav', "{ id: 'curators', label: '荣誉馆长'", "{ id: 'curators', label: '馆长'")(rep('wxml', '<text class="hub-cell-name">荣誉馆长</text>', '<text class="hub-cell-name">馆长</text>')(s)), null],
    ['直达磁贴整枚删除', (s) => {
      const m = s.wxml.match(/\n\s*<view class="hub-cell" hover-class="tap-press" hover-stay-time="80" data-fid="curators"[\s\S]*?<text class="hub-cell-name">荣誉馆长<\/text>\s*<\/view>/)
      if (!m) throw new Error('注入锚点失效：荣誉馆长磁贴')
      return { ...s, wxml: s.wxml.replace(m[0], '') }
    }, /入口丢失：改版前的「荣誉馆长」/],
    ['股东磁贴被删', (s) => {
      const m = s.wxml.match(/\n\s*<view class="hub-cell" hover-class="tap-press" hover-stay-time="80" data-fid="shareholderConfig"[\s\S]*?<text class="hub-cell-name">股东<\/text>\s*<\/view>/)
      if (!m) throw new Error('注入锚点失效：股东磁贴')
      return { ...s, wxml: s.wxml.replace(m[0], '') }
    }, /入口丢失：改版前的「股东配置」/],
    ['重复磁贴（账本复制一枚）', (s) => {
      const m = s.wxml.match(/<view class="hub-cell"[^>]*data-idx="8"[^>]*>[\s\S]*?<text class="hub-cell-name">账本<\/text>\s*<\/view>/)
      if (!m) throw new Error('注入锚点失效：账本磁贴')
      return { ...s, wxml: s.wxml.replace(m[0], `${m[0]}\n${m[0]}`) }
    }, /重复磁贴/],
    ['直达磁贴权限被换', rep('wxml', 'wx:if="{{menu.depositOps}}"', 'wx:if="{{menu.orders}}"'), /权限条件变化：「售罄孤品定金」/],
    ['店员工作台权限被放宽', rep('wxml', 'data-fid="staffConsole" wx:if="{{menu.staffConsole}}"', 'data-fid="staffConsole" wx:if="{{menu.staffConsole || menu.verify}}"'), /权限条件变化：「店员工作台」|权限被放宽/],
    ['分区 keys 漏一个', rep('hubNav', "'approvals', 'depositOps'] }", "'approvals'] }"), /分区「订单与履约」/],
    ['sectionFlags 恒 false', rep('hubNav', 'out[s.id] = s.keys.some((k) => m[k] === true)', 'out[s.id] = false'), /改版后不可达/],
    ['入口 handler 写错', rep('wxml', 'bindtap="goDepositOps"', 'bindtap="goDepositOpsX"'), /goDepositOpsX 在页面上不存在/],
    ['磁贴移出分区', rep('wxml', '<view class="hub-todo" wx:if="{{hubTodo.items.length}}">', '<view class="hub-cell" hover-class="tap-press" hover-stay-time="80" wx:if="{{menu.ledger}}" bindtap="goLedgerX"><text class="hub-cell-name">散落</text></view>\n      <view class="hub-todo" wx:if="{{hubTodo.items.length}}">'), /不在任何 hub-grp 分区内/],
    ['入口层新增原生弹窗', (s) => ({ ...s, indexJs: s.indexJs.replace('  onHubSearchClear() {', '  onHubSearchClear() {\n    wx.showModal({ title: "x" })') }), /wx\.showModal/],
    ['技术文案回流', rep('hubNav', "label: '有信待回'", "label: '有信待回 openid'"), /技术字段「openid」/],
    ['扫码主按钮丢失', rep('wxml', 'bindtap="goScanMember"', 'bindtap="goScanMemberOff"'), /扫顾客会员码/],
    ['清单名称与磁贴漂移', rep('hubNav', "{ id: 'ledger', label: '账本'", "{ id: 'ledger', label: '营收'"), /清单与磁贴名称不一致/],
    ['常用不按权限过滤', rep('hubNav', 'if (!entryVisible(findEntry(id), menu)) return', 'if (!findEntry(id)) return'), /常用区只含有权限入口/],
    ['旧折叠 id 映射丢失', rep('hubNav', "  gift: 'gift', giftOps: 'gift', giftManage: 'gift',\n", ''), /失效 id 映射|N7 常用里的旧折叠 id「gift」/],
    ['旧合并入口 memberCurator 映射丢失', rep('hubNav', "memberCurator: 'memberLevelKit', ", ''), /失效 id 映射/],
    ['常用上限失效', rep('hubNav', 'return out.slice(0, FAV_MAX)', 'return out'), /常用上限未生效/],
    ['店长默认常用被清空', rep('hubNav', "store_manager: ['orders', 'ledger', 'verify', 'approvalsKit', 'workOrders', 'gift', 'products', 'points'],", 'store_manager: [],'), /没有默认常用/],
    ['点常用不再判权限', rep('indexJs', 'if (!entry || !entry.keys.some((k) => this.data.menu && this.data.menu[k])) {', 'if (!entry) {'), /onHubFav 须在进入前再判一次权限/],
    ['保存不归一化', rep('indexJs', 'const clean = hubNav.normalizeFavs(ids, page.data.menu)', 'const clean = ids'), /onFavSave 须先归一化/],
    ['保存覆盖其它角色的常用', rep('indexJs', '  const store = readFavStore()\n  store[page.data.workspaceRole', '  const store = {}\n  store[page.data.workspaceRole'), /onFavSave 须先归一化/],
    ['常用本地 key 被换掉', rep('hubNav', "const FAV_STORAGE_KEY = 'manager_hub_favs_v1'", "const FAV_STORAGE_KEY = 'manager_hub_favs_v2'"), /manager_hub_favs_v1/],
    ['常用编辑新增原生弹窗', (s) => ({ ...s, indexJs: s.indexJs.replace('  onFavReset() {', '  onFavReset() {\n    wx.showModal({ title: "恢复默认？" })') }), /wx\.showModal/],
    // N1 不再有要解释的暗号
    ['N1 常用小金点复活', rep('wxml', '<text class="hub-cell-name">账本</text>', '<text class="hub-cell-name">账本</text>\n              <view class="hub-pin" wx:if="{{hubPinned.orders}}"></view>'), /N1 工作台又出现常用小金点/],
    ['N1 双圈复活（常用区）', rep('wxml', '        <view class="hub-ico">\n          <image class="hub-ico-img" src="{{item.icon}}"', "        <view class=\"hub-ico {{item.group ? 'is-stack' : ''}}\">\n          <image class=\"hub-ico-img\" src=\"{{item.icon}}\""), /N1 工作台又出现双圈/],
    ['N1 双圈样式复活', (s) => ({ ...s, hubWxss: `${s.hubWxss}\n.hub-ico.is-stack { border: 2rpx solid #C4A76C; }\n` }), /N1 hubNav\.wxss 又出现 \.is-group/],
    ['N1 长按加常用复活', rep('wxml', 'data-fid="deposit" wx:if', 'data-fid="deposit" bindlongpress="onHubPin" wx:if'), /N1 工作台又出现长按手势/],
    ['N1 说明行又靠文字解释暗号', rep('wxml', '<text class="hub-cat-count">{{hubCat.total}} 项</text>', '<text class="hub-cat-count">{{hubCat.total}} 项 · 长按加入常用</text>'), /N1 可见文案里出现「长按」/],
    ['N1 磁贴多一个红点', rep('wxml', '<text class="hub-cell-name">账本</text>', '<text class="hub-cell-name">账本</text><view class="hub-dot"></view>'), /N1 入口「账本」内部须只有/],
    ['N1 磁贴又加 ›', rep('wxml', '<text class="hub-cell-name">账本</text>', '<text class="hub-cell-name">账本</text>\n              <text class="hub-cell-go">›</text>'), /N1 入口「账本」内部须只有/],
    ['N1 角标挪出图标', rep('wxml', "                <view class=\"hub-badge\" wx:if=\"{{customOrders.length > 0}}\">{{customOrders.length > 99 ? '99+' : customOrders.length}}</view>\n              </view>\n              <text class=\"hub-cell-name\">工单</text>", "              </view>\n              <text class=\"hub-cell-name\">工单</text>\n              <view class=\"hub-badge\" wx:if=\"{{customOrders.length > 0}}\">{{customOrders.length > 99 ? '99+' : customOrders.length}}</view>"), /N1 入口「工单」内部须只有/],
    ['N1 入口按压退回本地类', rep('wxml', 'hover-class="tap-press" hover-stay-time="80" data-fid="ledger"', 'hover-class="hub-press" hover-stay-time="80" data-fid="ledger"'), /N1 入口「账本」按压态/],
    // N2 每个入口都有说明
    ['N2 入口说明被清空', rep('hubNav', "desc: '卖完的孤品，顾客交的订金'", "desc: ''"), /N2 入口「孤品定金」没有说明/],
    ['N2 说明里混进技术词', rep('hubNav', "desc: '工作室打包发货'", "desc: '工作室发货 SKU'"), /N2 入口「出货中心」说明里有技术词|K 组合「货品」子功能「出货中心」须有/],
    ['N2 说明太长一行放不下', rep('hubNav', "desc: '定制和装裱的活儿，进度一目了然'", "desc: '定制和装裱的活儿，进度在这里一目了然'"), /N2 入口「工单」说明 \d+ 字/],
    ['N2 磁贴小字与清单漂移', rep('wxml', '<text class="hub-cell-sub">审核·回复</text>', '<text class="hub-cell-sub">回复</text>'), /N2 入口「评价」磁贴小字「回复」与清单/],
    ['N2 磁贴小字太长', (s) => rep('hubNav', "sub: '审核·回复'", "sub: '评价审核置顶与回复'")(rep('wxml', '<text class="hub-cell-sub">审核·回复</text>', '<text class="hub-cell-sub">评价审核置顶与回复</text>')(s)), /N2 入口「评价」磁贴小字 \d+ 字/],
    // N3 待处理横条包含所有带角标的入口
    ['N3 待办漏掉发票', rep('hubNav', "  { id: 'invoice', label: '发票', keys: ['invoice'], badge: 'invoicePendingCount', tap: 'goInvoiceRequests' },\n", ''), /N3 待处理横条缺(组合「[^」]+」子功能)?「发票」的角标/],
    ['N3 新单未读不再合并进待发', rep('hubNav', " merged: 'newOrderUnreadCount',", ''), /N3 待处理横条缺「订单」的角标（数据源 newOrderUnreadCount）|新单未读合并/],
    ['N3 待办权限键写宽', rep('hubNav', "{ id: 'recruit', label: '合作申请', keys: ['framerRecruit']", "{ id: 'recruit', label: '合作申请', keys: ['framers', 'framerRecruit']"), /N3 待办「合作申请」权限键/],
    ['N3 计数为 1 的项被吞', rep('hubNav', '    if (n <= 0) return\n', '    if (n <= 1) return\n'), /N3 .*待处理横条却没有/],
    ['N3 横条计数换成另一种标记', rep('wxml', '<text class="hub-badge">{{item.count}}</text>', '<text class="hub-todo-num">{{item.count}}</text>'), /N3 待处理横条须按 hubTodo\.items 渲染/],
    ['N3 搜索待办挪到金卡之后', (s) => {
      const m = s.wxml.match(/  <!-- 功能搜索[\s\S]*?\n  <!-- 核心指标卡片/)
      if (!m) throw new Error('注入锚点失效：搜索+待办块')
      const block = m[0].replace(/\n  <!-- 核心指标卡片$/, '\n')
      // 把搜索+待办挪到经营信号之后，破坏「信息流 → 搜索 → 待处理 → 金卡」顺序
      return { ...s, wxml: s.wxml.replace(m[0], '\n  <!-- 核心指标卡片').replace('  <!-- 首屏主 CTA', `${block}  <!-- 首屏主 CTA`) }
    }, /N3 首屏顺序须为/],
    // N4「编辑」入口
    ['N4 编辑按钮被删', rep('wxml', '<view class="hub-fav-edit" bindtap="openFavEditor" hover-class="tap-press" hover-stay-time="80">编辑</view>', ''), /N4 常用区右上角须有「编辑」按钮/],
    ['N4 空态不再指向编辑', rep('wxml', '<text>还没有常用入口，点右上角「编辑」挑选</text>', '<text>还没有常用入口</text>'), /N4 常用为空时须指向「编辑」/],
    // N5 搜索只在入口 > 20 的角色出现
    ['N5 搜索给所有角色', rep('hubNav', 'return { hubCat: { total: vis.length, search: vis.length > MANY_ENTRIES } }', 'return { hubCat: { total: vis.length, search: true } }'), /N5 店长：可见入口 \d+ 个，搜索框应隐藏/],
    ['N5 搜索框不再受开关控制', rep('wxml', '<view class="hub-search" wx:if="{{hubCat.search}}">', '<view class="hub-search">'), /N5 搜索框须 wx:if/],
    ['N5 搜索不按权限过滤', rep('hubNav', '  visibleEntries(d.menu).forEach((e, i) => {', '  HUB_ENTRIES.forEach((e, i) => {'), /N5 搜索须只在有权限的入口里找/],
    ['N5 搜索不认别名', rep('hubNav', 'return [e.label, ...alias, sec.title, sec.short]', 'return [e.label, sec.title, sec.short]'), /N5 超管搜「包邮」/],
    ['N5 搜索不认分组名', rep('hubNav', 'return [e.label, ...alias, sec.title, sec.short]', 'return [e.label, ...alias]'), /N5 超管搜分组名「工作室」/],
    // N6 分类宫格 + 可收起 + 默认展开 + 入口全部在
    ['N6 宫格不随收起隐藏', rep('wxml', '<view class="hub-grid--cat" wx:if="{{!hubCollapsed.biz}}">', '<view class="hub-grid--cat">'), /N6 分区 biz 须恰好一个宫格/],
    ['N6 标题行不能点', rep('wxml', 'bindtap="onHubCollapse" data-sec="studio" ', ''), /N6 分区 studio 标题行须点按收起/],
    ['N6 收起时不显示红点合计', rep('wxml', '              <view class="hub-badge" wx:if="{{hubSecMeta.studio.badge}}">{{hubSecMeta.studio.badge}}</view>\n', ''), /N6 分区 studio 收起时标题行须显示入口数/],
    ['N6 箭头不随收起翻转', rep('wxml', "<view class=\"hub-grp-arrow {{hubCollapsed.goods ? 'is-collapsed' : ''}}\"></view>", '<view class="hub-grp-arrow"></view>'), /N6 分区 goods 标题行右侧须有随收起翻转的箭头/],
    ['N6 入口挪出宫格', (s) => {
      const m = s.wxml.match(/\n {12}<view class="hub-cell" hover-class="tap-press" hover-stay-time="80" data-fid="stores"[\s\S]*?<text class="hub-cell-name">门店<\/text>\n {12}<\/view>/)
      if (!m) throw new Error('注入锚点失效：门店磁贴')
      return { ...s, wxml: s.wxml.replace(m[0], '').replace('<view class="hub-grid--cat" wx:if="{{!hubCollapsed.biz}}">', `<view class="hub-grid--cat" wx:if="{{!hubCollapsed.biz}}">\n          </view>${m[0]}\n          <view>`) }
    }, /N6 分区 biz 的入口「[^」]*门店[^」]*」不在宫格里/],
    ['N6 默认就收起', rep('hubNav', '  HUB_SECTIONS.forEach((s) => { if (src[s.id] === true) out[s.id] = true })', '  HUB_SECTIONS.forEach((s) => { out[s.id] = true })'), /N6 没有收起记录时须全部展开/],
    ['N6 收起记录 key 被换', rep('hubNav', "const COLLAPSE_STORAGE_KEY = 'manager_hub_collapsed_v1'", "const COLLAPSE_STORAGE_KEY = 'manager_hub_favs_v1'"), /N6 分类收起记录的本机 key 须为 manager_hub_collapsed_v1/],
    ['N6 收起不写本机', rep('indexJs', '    wx.setStorageSync(hubNav.COLLAPSE_STORAGE_KEY, clean)\n', ''), /N6 收起状态须写本机/],
    ['N6 进页不读本机记录', rep('indexJs', '    const collapsed = readCollapsed()\n', '    const collapsed = {}\n'), /N6 切换角色 \/ 进页时须应用本机收起记录/],
    ['N6 红点合计不算数', rep('hubNav', '    const n = entries.reduce((sum, e) => sum + entryBadgeNum(e, d), 0)\n', '    const n = 0\n'), /N6 超管：订单履约收起时红点合计/],
    ['N6 入口数算错', rep('hubNav', "    out[s.id] = { n: entries.length, badge:", "    out[s.id] = { n: entries.length - 1, badge:"), /N6 超管：分类「.*」收起时入口数/],
    ['N6 全部收起不收', rep('hubNav', '    if (fold) out[s.id] = true\n', ''), /N6 .*「全部收起」须收起全部可见分类/],
    ['N6 全部展开开关被删', rep('wxml', "            <view class=\"hub-cat-toggle\" bindtap=\"onHubCollapseAll\" hover-class=\"tap-press-soft\" hover-stay-time=\"80\">{{hubAllCollapsed ? '全部展开' : '全部收起'}}</view>\n", ''), /N6 「全部功能」标题右侧须有「全部展开 \/ 全部收起」开关/],
    ['N6 角标不再刷新到标题行', rep('indexJs', ', hubSecMeta: hubNav.buildSecMeta(this.data),', ','), /N6 角标变化后须刷新收起标题行的红点合计/],
    ['N6 宫格改成 3 列', rep('hubWxss', 'grid-template-columns: repeat(4, minmax(0, 1fr));\n  gap: 14rpx 12rpx;\n  padding-bottom: 18rpx;', 'grid-template-columns: repeat(3, minmax(0, 1fr));\n  gap: 14rpx 12rpx;\n  padding-bottom: 18rpx;'), /N6 宫格须 4 列/],
    ['N6 角标不贴图标', rep('hubWxss', '.hub-cell .hub-badge {\n  position: absolute;', '.hub-cell .hub-badge {\n  position: static;'), /N6 磁贴红色数字角标须贴在图标右上角/],
    ['N6 又包回列表行', rep('wxml', '<view class="hub-grid--cat" wx:if="{{!hubCollapsed.system}}">', '<view class="hub-grid--cat" wx:if="{{!hubCollapsed.system}}">\n            <view class="hub-list"></view>'), /N6 全部功能又出现整块面板 \/ 列表行容器/],
    ['N6 店员工作台换回实心圆素材', (s) => rep('hubNav', "icon: ICON + 'tab-user.png'", "icon: ICON + 'checkin.png'")(rep('wxml', 'src="/assets/icons/tab-user.png"', 'src="/assets/icons/checkin.png"')(s)), /N6 入口「店员工作台」用了实心素材/],
    ['N6 图标文件不存在', (s) => rep('hubNav', "icon: ICON + 'discount.png', sec: 'orders'", "icon: ICON + 'discount-x.png', sec: 'orders'")(rep('wxml', 'src="/assets/icons/discount.png" mode="aspectFit" /></view>\n              <text class="hub-cell-name">孤品定金', 'src="/assets/icons/discount-x.png" mode="aspectFit" /></view>\n              <text class="hub-cell-name">孤品定金')(s)), /N6 入口「孤品定金」图标文件不存在/],
    ['N6 荣誉馆长换回实心方块素材', (s) => rep('hubNav', "icon: ICON + 'tab-collection.png', sec: 'members'", "icon: ICON + 'atlas.png', sec: 'members'")(rep('wxml', 'src="/assets/icons/tab-collection.png" mode="aspectFit" /></view>\n              <text class="hub-cell-name">荣誉馆长', 'src="/assets/icons/atlas.png" mode="aspectFit" /></view>\n              <text class="hub-cell-name">荣誉馆长')(s)), /N6 入口「荣誉馆长」用了实心素材/],
    ['N6 中英标题并成一行', rep('wxml', '<view class="hub-titles">\n            <text class="hub-en">ALL FUNCTIONS</text>\n            <text class="hub-cn">全部功能</text>\n          </view>', '<text class="hub-cn">全部功能 ALL FUNCTIONS</text>'), /N6 全部功能标题须为英文小标题/],
    // N7 没有折叠磁贴、每个子功能独立、入口只增不减、旧折叠常用平滑映射
    ['N7 磁贴又改回点开再选', rep('wxml', 'data-fid="deposit" wx:if="{{menu.depositOps}}" bindtap="goDepositOps"', 'data-fid="deposit" wx:if="{{menu.depositOps}}" bindtap="openHubGroup" data-group="orders"'), /N7 磁贴「孤品定金」又是「点开再选」的折叠磁贴/],
    ['N7 清单又出现折叠入口', rep('hubNav', "tap: 'goDepositOps' }", "tap: 'goDepositOps', group: 'orders' }"), /N7 清单入口「孤品定金」又是折叠入口/],
    ['N7 二级面板代码复活', rep('indexJs', '  onHubSearchClear() {', '  openHubGroup(e) {\n    this.setData({ hubSheet: {} })\n  },\n\n  onHubSearchClear() {'), /N7 index\.js 仍有二级面板残留/],
    ['N7 子功能被并没了（股东磁贴与清单同删）', (s) => {
      const m = s.wxml.match(/\n\s*<view class="hub-cell" hover-class="tap-press" hover-stay-time="80" data-fid="shareholderConfig"[\s\S]*?<text class="hub-cell-name">股东<\/text>\s*<\/view>/)
      if (!m) throw new Error('注入锚点失效：股东磁贴')
      return rep('hubNav', "  { id: 'shareholderConfig',", "  // { id: 'shareholderConfig',")({ ...s, wxml: s.wxml.replace(m[0], '') })
    }, /N7 子功能 shareholderConfig 不再可达/],
    ['N7 父入口以点开再选回到清单', rep('hubNav', "  { id: 'deposit',", "  { id: 'perks', label: '礼包', desc: '礼包', icon: ICON + 'gift.png', sec: 'orders', keys: ['welcomeGift'], tap: 'goWelcomeGiftGuarded' },\n  { id: 'deposit',"), /N7 被拆开的折叠入口「perks」又回到清单里/],
    ['N7 功能总数减少', (s) => {
      const m = s.wxml.match(/\n\s*<view class="hub-cell" hover-class="tap-press" hover-stay-time="80" data-fid="deposit"[\s\S]*?<text class="hub-cell-name">孤品定金<\/text>\s*<\/view>/)
      if (!m) throw new Error('注入锚点失效：孤品定金磁贴')
      return rep('hubNav', "  { id: 'deposit',", "  // { id: 'deposit',")({ ...s, wxml: s.wxml.replace(m[0], '') })
    }, /N7 功能总数 \d+ < \d+/],
    ['N5 SKU 维护搜不到', rep('hubNav', "alias: ['SKU', '商品', '价目', '出货 SKU', '定价']", "alias: ['出货 SKU']"), /N5 超管搜「商品」须找到「SKU 维护」/],
    ['N7 旧折叠常用映射到无权限子入口', rep('hubNav', 'Array.isArray(to) ? to.find((x) => entryVisible(findEntry(x), menu)) : to', 'Array.isArray(to) ? to[0] : to'), /N7 只有部分子功能权限时/],
    ['N7 子入口丢了角标', rep('hubNav', "tap: 'goGiftOps', badge: 'giftTodoCount' }", "tap: 'goGiftOps' }"), /N7 旧「礼赠」常用映射后须带上礼赠待办红点/],
    ['N7 磁贴右上角 › 复活', rep('wxml', '<text class="hub-cell-name">孤品定金</text>', '<text class="hub-cell-name">孤品定金</text>\n              <text class="hub-cell-go">›</text>'), /N7 磁贴又出现右上角 ›/],
    // K 组合入口（样本：在内存里把「孤品定金 + 股东」并成一个组合 —— 两者都不在归并计划里，归并推进时样本不失效）
    ['K 组合样本：合法组合（不误报对照）', (s) => kitSample(s), null],
    ['K 子功能丢 handler', (s) => rep('hubNav', "tap: 'goShareholderConfig', kitChild: 1", "tap: 'goShareholderConfigX', kitChild: 1")(kitSample(s)), /K 组合「样本组合」子功能「股东」的入口 goShareholderConfigX 在页面上不存在/],
    ['K 子功能权限写宽', rep('hubNav', "keys: ['shareholderConfig'], tap: 'goShareholderConfig', kitChild: 1", "keys: ['shareholderConfig', 'depositOps'], tap: 'goShareholderConfig', kitChild: 1"), /权限条件变化：「股东配置」/, true],
    ['K 组合磁贴丢 data-kit', rep('wxml', ' bindtap="openHubKitPage" data-kit="sampleKit"', ' bindtap="openHubKitPage"'), /K 磁贴「样本组合」走组合页（openHubKitPage）却没有 data-kit/, true],
    ['K 组合入口名称漂移', rep('hubNav', "{ id: 'sampleKit', label: '样本组合', sub", "{ id: 'sampleKit', label: '样本合集', sub"), /清单与磁贴名称不一致：sampleKit|K 组合入口 sampleKit 的名称/, true],
    ['K 组合磁贴权限键少一个子功能', rep('wxml', 'wx:if="{{menu.depositOps || menu.shareholderConfig}}" bindtap="openHubKitPage"', 'wx:if="{{menu.depositOps}}" bindtap="openHubKitPage"'), /K 组合「样本组合」磁贴权限键|改版前可见，改版后不可达/, true],
    ['K 子功能同时还是独立磁贴', (s) => {
      const k = kitSample(s)
      const grid = '<view class="hub-grid--cat" wx:if="{{!hubCollapsed.studio}}">'
      if (!k.wxml.includes(grid)) throw new Error('注入锚点失效：工作室与门店宫格')
      return { ...k, wxml: k.wxml.replace(grid, `${grid}\n${SAMPLE_SHAREHOLDER_TILE}`) }
    }, /入口重复：「股东配置」|K 组合「样本组合」子功能「股东」同时还是独立磁贴/],
    ['K 组合页不按权限过滤', rep('groupJs', '.filter((c) => c.keys.some(', '.filter((c) => c.keys.every('), /K 组合页须按权限过滤子功能/, true],
    ['K 组合页另写跳转（不调原 handler）', rep('groupJs', 'hubNav.invokeItem(', 'wx.navigateTo('), /K 组合页点子功能须经 hubNav\.invokeItem/, true],
    ['K 组合页未注册', rep('appJson', '"group/index",', ''), /K 组合页未在 app\.json 注册/, true],
    ['K 组合搜索按看不到的子功能命中（店长搜 SKU 搜到货品）', rep('hubNav', "    ;(kit ? kit.children : []).filter((c) => c.keys.some((k) => m[k] === true)).forEach(", "    ;(kit ? kit.children : []).forEach("), /N5「SKU 维护」仅超管：店长不得搜到/],
    ['K 旧常用落到看不见该子功能的组合（店长的飞书同步变成设置）', rep('hubNav', '      if (child && !child.keys.some((k) => m[k] === true)) return\n', ''), /常用区只含有权限入口：店长配置/],
    ['K 组合搜索不认子功能名称', rep('hubNav', 'alias.push(c.label, ...(c.alias || []))', 'alias.push(...(c.alias || []))'), /K 超管搜「股东」找不到组合「样本组合」/, true],
    // S2 真组合：角标 = 有权限子功能之和、随计数刷新、挂在该挂的组合上
    ['K 组合角标不再求和', rep('hubNav', '.reduce((sum, c) => sum + badgeValue(c.badge, d), 0)', '.reduce(() => 0, 0)'), /N3 超管：组合「审批与发票」角标/],
    ['K 组合角标计入无权限子功能', rep('hubNav', "return (kit ? kit.children : []).filter((c) => c.badge && c.keys.some((k) => m[k] === true))", "return (kit ? kit.children : []).filter((c) => c.badge)"), /N3 (店长|店员)：组合「[^」]+」角标/],
    ['K 礼赠组合丢了角标', (s) => {
      const m = s.wxml.match(/\n *<view class="hub-badge" wx:if="\{\{hubKitBadge\.gift\}\}">\{\{hubKitBadge\.gift\}\}<\/view>/)
      if (!m) throw new Error('注入锚点失效：礼赠组合角标')
      return { ...s, wxml: s.wxml.replace(m[0], '') }
    }, /N3 组合「礼赠」有带角标的子功能，磁贴却没有 hubKitBadge 角标/],
    ['K 角标变化不刷新组合', rep('indexJs', ', hubKitBadge: hubNav.buildKitBadges(this.data) }', ' }'), /K 角标变化后须刷新组合磁贴角标/],
    ['K 审批与发票的发票子功能被删', rep('hubNav', "      { id: 'invoice', label: '发票',", "      // { id: 'invoice', label: '发票',"), /入口丢失：改版前的「发票管理」/],
    ['K 常用里的旧「审批」不再落到组合', rep('hubNav', "approvals: 'approvalsKit', invoice: 'approvalsKit',", ''), /K 常用里的旧入口「审批」（approvals）须映射到组合「审批与发票」/]
  ]
  let bad = 0
  const baseline = run(base)
  if (!baseline.ok) {
    console.error(`${TAG} selftest ✗ 基线本身不通过：`, baseline.errs)
    process.exit(1)
  }
  for (const [name, mutRaw, expect, onKit] of cases) {
    const mut = onKit ? (b) => mutRaw(kitSample(b)) : mutRaw
    let s
    try {
      s = mut(base)
    } catch (e) {
      console.error(`${TAG} selftest ✗ ${name}：${e.message}`)
      bad += 1
      continue
    }
    const r = run(s)
    if (expect === null) {
      if (r.ok) console.log(`${TAG} selftest ✓ 不误报：${name}`)
      else { console.error(`${TAG} selftest ✗ 误报：${name} → ${r.errs[0]}`); bad += 1 }
      continue
    }
    const hit = !r.ok && r.errs.some((e) => expect.test(e))
    if (hit) console.log(`${TAG} selftest ✓ 检出：${name}`)
    else {
      console.error(`${TAG} selftest ✗ 未检出：${name}${r.errs.length ? ` → ${r.errs[0]}` : '（守卫仍通过）'}`)
      bad += 1
    }
  }
  if (bad) {
    console.error(`${TAG} selftest ✗ ${bad} 条注入未按预期`)
    process.exitCode = 1
  } else {
    const n0 = cases.filter((c) => c[2] === null).length
    console.log(`${TAG} selftest ✓ ${cases.length - n0} 个回归注入全部检出 + ${n0} 个不误报对照（含合法组合入口样本；内存副本，不写盘）`)
  }
}
