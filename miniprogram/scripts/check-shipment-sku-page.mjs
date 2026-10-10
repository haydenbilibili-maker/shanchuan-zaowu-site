#!/usr/bin/env node
/**
 * 出货中心守卫（settlement 域；脚本名沿用 check:shipment-sku-page，免动冻结的 package.json）
 *
 * 2026-09-28「出货单」与「出货开单」合并为出货中心（subpackages/extra/shipment-ops，四页签），
 * 旧 shipment-sku 路径改为重定向壳。蓝图：admin/docs/出货中心_融合_2026-09-28.md
 *
 * 钉死：
 *  A 合并结构
 *    1) shipment-sku 为重定向壳：redirectTo → shipment-ops ?tab=create，且不再调任何云函数
 *    2) 工作台只剩一枚「出货中心」磁贴（menu.shipmentOps），不再有「出货开单」磁贴；两份 staffAuth 一致，
 *       goShipmentSku 指向出货中心开单页签
 *    3) 出货中心页签：create / list / overview / library；资料页签店长可见（只读）；applyTab 回落无权页签
 *  B 已知坑不回退
 *    4) 底栏主按钮 .ss-cta：WXSS width:100% !important + 内联 width:100%（inline-flex 半宽坑）
 *    5) 页内每个 scroll-view scroll-y 都带内联 height（小程序硬要求）
 *    6) 写入后 revealAfterWrite → activeTab 'list' + created 乐观展示 + 原地高亮（防「写成功却报加载失败」）
 *  C 原开单契约
 *    7) SKU 开单仅超管（enterCreate 把非超管的 sku 降为 paste）；createFromSkus 行载荷不带单价/材料名
 *    8) 选 SKU 映射 hasScene/sceneCost；quoteSkus 喂造景成本
 *    9) 页内无原生 toast / modal；供应商 hub 不挂 shipment-sku / shipment-ops
 *  D 原材料 / 包装方式
 *   10) 单条补录可选带 material* / packaging*；详情明细显示 matLine
 *   11) 资料维护只用 priceBook.list / create / update / removeIfUnused（绝不调 priceBook.remove）
 *  E 2026-09-28 点名三项
 *   12) 店长只读：资料页签内每个写入口（新增/编辑/停用/排序/删除）都在 isSuper 门下；写方法首行拦非超管
 *   13) 选择器（出货中心 + shipment-edit）与资料列表都传 orderBy:'sort'
 *   14) 云函数运行时（隔离副本 + mock）：不传 orderBy 输出不变；传了按 sort 排且排除停用；
 *       removeIfUnused 有引用（按 id / 按名称+等级 / 已删出货单）必拒 IN_USE，无引用才软删；店长调用被拒
 *  F 2026-10-09 飞书首批 SKU 导入（needsReview / importBatch，见 miniprogram/docs/出货中心首批SKU导入_2026-10-09.md）
 *   15) 选 SKU 弹层：带 needsReview 的 SKU 显示「待复核」小标签；有「只看待复核」筛选（sku.list 传 reviewOnly）
 *   16) 云函数运行时：sku.list 透出 needsReview / importBatch / reviewCount，reviewOnly 只回待复核；
 *       sku.update（部分更新）不得把 needsReview 冲掉
 *  G 2026-10-09 飞书出货草稿箱 / 已结清历史备忘（旁路集合 ops_shipment_memos，同文档 §8–§9）
 *   17) 不进统计：除 manageStoreShipment/shipmentMemos.js 与 admin/src/cloud.js 外，任何云函数 / 小程序 / ERP 代码
 *       都不得引用 ops_shipment_memos；memo.* 仅超管；「单据」页签草稿箱 / 历史入口仅超管，带「草稿」「已结清·历史」标签
 *   18) 云函数运行时（manageStoreShipment 隔离副本 + 有状态 mock）：list / 编辑 / 删除只写备忘集合、绝不写 ops_shipments；
 *       历史不可改；待匹配不可转正式；**草稿转正式的金额与直接 createFromSkus 逐行一致**；并发双击只开一张；店长被拒
 *  H 2026-10-09 产品负责人拍板（同文档 §11）
 *   19) 历史备忘**只进营收 / 出货额类**统计：出货观测台（运行时）营收 / 金额分布含历史、笔数不含、草稿永不含；
 *       工作室仪表盘（静态）只读 kind:'history'，加进 revenueTotal / shippedAmount，**不进** computeSettlementKpis
 *       （已结清 / 未收款 / 待确认 / 真毛利）
 *   20) 导入批次（importBatch 以 feishu- 开头）的草稿转正式**不发通知**；手工草稿与直接开单照常通知；客户端入参关不掉通知
 */
import { readFileSync, existsSync, mkdtempSync, cpSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const selftest = process.argv.includes('--selftest')
const TAG = '[check:shipment-sku-page]'

const EXTRA = 'miniprogram/subpackages/extra'
const FILES = {
  shellJs: `${EXTRA}/shipment-sku/index.js`,
  opsJs: `${EXTRA}/shipment-ops/index.js`,
  opsWxml: `${EXTRA}/shipment-ops/index.wxml`,
  opsWxss: `${EXTRA}/shipment-ops/index.wxss`,
  skuWxss: `${EXTRA}/shipment-ops/sku.wxss`,
  createJs: `${EXTRA}/shipment-ops/parts/create.js`,
  libraryJs: `${EXTRA}/shipment-ops/parts/library.js`,
  sharedJs: `${EXTRA}/shipment-ops/parts/shared.js`,
  staffExtra: `${EXTRA}/utils/staffAuth.js`,
  staffManager: 'miniprogram/subpackages/manager/utils/staffAuth.js',
  hubWxml: 'miniprogram/subpackages/manager/manager/index.wxml',
  settle: 'miniprogram/cloudfunctions/manageStudioSettlement/index.js',
  refsJs: 'miniprogram/cloudfunctions/manageStudioSettlement/priceBookRefs.js',
  settleDefaults: 'miniprogram/cloudfunctions/manageStudioSettlement/settlementDefaults.js',
  editJs: `${EXTRA}/shipment-edit/index.js`,
  supplier: `${EXTRA}/supplier/index.js`,
  memosJs: `${EXTRA}/shipment-ops/parts/memos.js`,
  shipIndex: 'miniprogram/cloudfunctions/manageStoreShipment/index.js',
  studioDash: 'miniprogram/cloudfunctions/getStudioDashboard/index.js',
  studioKpis: 'miniprogram/cloudfunctions/getStudioDashboard/settlementKpis.js'
}

const MEMO_COLL = 'ops_shipment_memos'
const MEMO_ALLOWED = [
  'miniprogram/cloudfunctions/manageStoreShipment/shipmentMemos.js',
  'admin/src/cloud.js',
  // H19：工作室仪表盘只读 kind:'history' 进营收（判据见 collect）
  'miniprogram/cloudfunctions/getStudioDashboard/index.js'
]
/** 引用备忘集合名的代码文件（不含 node_modules / 文档 / 守卫脚本自身） */
function memoRefFiles() {
  const out = []
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue
      const p = join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (/\.(js|cjs|mjs|ts|vue|wxml|wxs)$/.test(ent.name) && readFileSync(p, 'utf8').includes(MEMO_COLL)) out.push(relative(ROOT, p))
    }
  }
  for (const d of ['miniprogram/cloudfunctions', 'miniprogram/pages', 'miniprogram/subpackages', 'miniprogram/utils', 'miniprogram/components', 'admin/src']) {
    if (existsSync(resolve(ROOT, d))) walk(resolve(ROOT, d))
  }
  return out.sort()
}

function collect(s) {
  const errs = []
  const pageJs = s.opsJs + '\n' + s.createJs + '\n' + s.libraryJs + '\n' + s.sharedJs

  // A1 重定向壳
  if (!/wx\.redirectTo\(/.test(s.shellJs) || !/shipment-ops\/index\?tab=create/.test(s.shellJs)) {
    errs.push('shipment-sku 须为重定向壳：redirectTo 出货中心 ?tab=create')
  }
  if (/callFunction|manageStoreShipment|manageStudioSettlement/.test(s.shellJs)) {
    errs.push('shipment-sku 重定向壳不得再调云函数（逻辑已并入出货中心）')
  }
  // A2 单一磁贴 + staffAuth 同步
  const tiles = s.hubWxml.match(/<text(?: class="hub-cell-name")?>出货中心<\/text>/g) || []
  if (tiles.length !== 1) errs.push(`工作台须恰好一枚「出货中心」磁贴（现 ${tiles.length}）`)
  if (/<text(?: class="hub-cell-name")?>(?:出货开单|出货单)<\/text>/.test(s.hubWxml)) {
    errs.push('工作台不得再有独立「出货开单」/「出货单」磁贴')
  }
  if (!/wx:if="\{\{menu\.shipmentOps\}\}"\s+bindtap="goShipmentOps">[\s\S]{0,200}出货中心/.test(s.hubWxml)) {
    errs.push('「出货中心」磁贴须按 menu.shipmentOps 显示并绑 goShipmentOps')
  }
  if (s.staffExtra !== s.staffManager) errs.push('extra / manager 两份 staffAuth.js 须逐字一致')
  if (!/function goShipmentSku\(\)\s*\{\s*wx\.navigateTo\(\{\s*url:\s*`\$\{SHIPMENT_OPS_PATH\}\?tab=create&mode=sku`/.test(s.staffExtra)) {
    errs.push('goShipmentSku 须指向出货中心 ?tab=create&mode=sku')
  }
  // A3 页签
  if (!/key:\s*'create'/.test(s.opsJs) || !/key:\s*'list'/.test(s.opsJs) || !/key:\s*'overview'/.test(s.opsJs) || !/key:\s*'library'/.test(s.opsJs)) {
    errs.push('出货中心须有 create / list / overview / library 四页签')
  }
  if (!/tabs\.push\([^)]*key: 'library'/.test(s.opsJs) || /isSuper\)\s*tabs\.push\([^)]*key: 'library'/.test(s.opsJs)) {
    errs.push('资料页签须对店长可见（只读），不得再按 isSuper 隐藏')
  }
  if (!/applyTab\(want[\s\S]{0,160}visibleTabs\(\)\.some/.test(s.opsJs)) {
    errs.push('applyTab 须校验页签可见性（无权回落单据）')
  }
  // B4 满宽 CTA
  if (!/\.ss-cta\s*\{[^}]*[\s;{]width:\s*100%\s*!important/.test(s.skuWxss)) {
    errs.push('.ss-cta 须 width:100% !important（防 inline-flex 半宽）')
  }
  const ctas = s.opsWxml.match(/<view[^>]*class="ss-cta[^"]*"[^>]*>/g) || []
  if (!ctas.length) errs.push('出货中心须有 .ss-cta 主按钮')
  ctas.forEach((tag) => {
    if (!/style="[^"]*width:100%/.test(tag)) errs.push('每个 .ss-cta 须内联 width:100% 兜底：' + tag.slice(0, 60))
  })
  // B5 scroll-view 明确高度
  const scrolls = s.opsWxml.match(/<scroll-view[^>]*>/g) || []
  scrolls.forEach((tag) => {
    if (/scroll-y/.test(tag) && !/style="[^"]*height:\s*\{\{\s*sheetBodyPx\s*\}\}px/.test(tag)) {
      errs.push('scroll-view scroll-y 须内联 height:{{sheetBodyPx}}px：' + tag.slice(0, 60))
    }
  })
  if (!/sheetBodyPx:\s*sheetBodyPx\(\)/.test(s.opsJs)) errs.push('onLoad 须写入 sheetBodyPx')
  // B6 写入后收口
  if (!/revealAfterWrite\(opts\)/.test(s.opsJs)) {
    errs.push('写入成功须走 revealAfterWrite')
  } else {
    const body = s.opsJs.slice(s.opsJs.indexOf('revealAfterWrite(opts)'), s.opsJs.indexOf('revealAfterWrite(opts)') + 2400)
    if (!/const created = Array\.isArray\(o\.created\)/.test(body)) errs.push('revealAfterWrite 须接收 created 以便乐观展示')
    if (!/activeTab:\s*'list'/.test(body)) errs.push('revealAfterWrite 须切到单据页签（activeTab list）')
    if (!/highlightIds/.test(body)) errs.push('revealAfterWrite 须原地高亮新单（highlightIds）')
  }
  if (!/highlightIds\[item\._id\]/.test(s.opsWxml)) errs.push('单据卡须按 highlightIds 高亮')
  for (const fn of ['onSaveSku', 'confirmPaste', 'confirmSingle', 'consumeEditReturn']) {
    const at = s.createJs.indexOf(`${fn}(`)
    if (at < 0 || !/revealAfterWrite\(/.test(s.createJs.slice(at, at + 3200))) {
      errs.push(`${fn} 成功后须调 revealAfterWrite`)
    }
  }
  // C7 SKU 仅超管 + 载荷
  if (!/next === 'sku' && !this\.data\.isSuper \? 'paste'/.test(s.createJs)) {
    errs.push('enterCreate 须把非超管的 sku 方式降为 paste（SKU 开单仅超管）')
  }
  if (!/wx:if="\{\{isSuper\}\}" data-mode="sku"/.test(s.opsWxml)) errs.push('「选 SKU」方式须 wx:if isSuper')
  if (!/action:\s*'createFromSkus'/.test(s.createJs)) errs.push('SKU 保存须走 createFromSkus')
  const at = s.createJs.indexOf("action: 'createFromSkus'")
  const linesMap = at >= 0 ? s.createJs.slice(at, at + 700).match(/lines:\s*lines\.map\(\(l\)\s*=>\s*\{([\s\S]*?)return out\s*\n\s*\}\)/) : null
  if (!linesMap) errs.push('找不到 createFromSkus 的 lines.map')
  else if (/unitPrice|totalAmount|materialName/.test(linesMap[1])) errs.push('createFromSkus 行载荷不得带单价/材料名')
  // C8
  if (!/function mapSkuForPicker/.test(s.createJs) || !/hasScene/.test(s.createJs) || !/sceneCost/.test(s.createJs)) {
    errs.push('选 SKU 须 mapSkuForPicker + hasScene/sceneCost')
  }
  if (!/sceneCost:\s*k\.hasScene === true/.test(s.settle)) errs.push('quoteSkus 须把造景成本喂给引擎')
  // C9
  if (/wx\.showToast\s*\(|wx\.showModal\s*\(/.test(pageJs + s.shellJs)) errs.push('出货中心 / 重定向壳不得使用原生 toast/modal')
  if (/shipment-sku|shipment-ops/.test(s.supplier)) errs.push('供应商工作台不得挂接 shipment-sku / shipment-ops')
  // D10 原材料 / 包装
  const single = s.createJs.slice(s.createJs.indexOf('async confirmSingle('))
  if (!/line\.materialName\s*=/.test(single) || !/line\.packagingName\s*=/.test(single)) {
    errs.push('单条补录须可选带原材料 / 包装方式（line.material* / line.packaging*）')
  }
  if (!/data-target="single"/.test(s.opsWxml)) errs.push('单条补录须有原材料 / 包装选择入口（data-target="single"）')
  if (!/item\.matLine/.test(s.opsWxml) || !/matLine:\s*materialLine\(/.test(s.opsJs)) errs.push('详情明细须显示原材料 / 包装（matLine）')
  // D11 资料维护
  const libActions = (s.libraryJs.match(/action:\s*'([\w.]+)'/g) || []).map((m) => m.replace(/action:\s*'|'/g, ''))
  const allowed = ['priceBook.list', 'priceBook.create', 'priceBook.update', 'priceBook.removeIfUnused', 'meta']
  libActions.filter((a) => allowed.indexOf(a) === -1).forEach((a) => errs.push(`资料维护不得调用 ${a}（删除只能走 removeIfUnused）`))
  if (!libActions.includes('priceBook.update') || !libActions.includes('priceBook.create')) errs.push('资料维护须支持新增与编辑（priceBook.create / update）')
  if (!libActions.includes('priceBook.removeIfUnused')) errs.push('资料删除须走 priceBook.removeIfUnused（服务端引用检查）')
  if (!/moveLibRow/.test(s.libraryJs) || !/toggleLibStatus/.test(s.libraryJs)) errs.push('资料维护须支持排序（moveLibRow）与停用（toggleLibStatus）')
  // E12 店长只读
  const libStart = s.opsWxml.indexOf(`wx:if="{{activeTab === 'library'}}"`)
  if (libStart < 0) errs.push("资料页签块须为 wx:if=\"{{activeTab === 'library'}}\"（店长可见，不再要求 isSuper）")
  else ungatedWrites(s.opsWxml.slice(s.opsWxml.lastIndexOf('<', libStart))).forEach((t) => errs.push('资料页签写入口须在 isSuper 门下（店长只读）：' + t))
  for (const fn of WRITE_TAPS) {
    const at = s.libraryJs.search(new RegExp(`\\n\\s*(async )?${fn}\\(e?\\) \\{`))
    const head = at < 0 ? '' : s.libraryJs.slice(at, at + 260)
    if (fn !== 'deactivateBlocked' && !/if \(!this\.data\.isSuper\b/.test(head)) errs.push(`${fn} 须首行拦截非超管（if (!this.data.isSuper …) return）`)
  }
  // E13 排序参数
  if (!/action: 'searchPriceBook'[^}]*orderBy: 'sort'/.test(s.createJs)) errs.push("出货中心选择器 searchPriceBook 须传 orderBy: 'sort'")
  if (!/action: 'searchPriceBook'[^}]*orderBy: 'sort'/.test(s.editJs)) errs.push("shipment-edit 选择器 searchPriceBook 须传 orderBy: 'sort'")
  if (!/action: 'priceBook\.list'[^}]*orderBy: 'sort'/.test(s.libraryJs)) errs.push("资料列表 priceBook.list 须传 orderBy: 'sort'")
  if (!/'priceBook\.removeIfUnused':\s*1/.test(s.settle.slice(s.settle.indexOf('SUPER_ONLY_ACTIONS'), s.settle.indexOf('SUPER_ONLY_ACTIONS') + 600))) {
    errs.push('priceBook.removeIfUnused 须在 SUPER_ONLY_ACTIONS（仅超管可删）')
  }
  // F15 待复核标记
  if (!/needsReview:\s*d\.needsReview === true/.test(s.settleDefaults)) errs.push('mapSku 须透出 needsReview（待复核标记）')
  if (!/needsReview:\s*s\.needsReview === true/.test(s.createJs.slice(s.createJs.indexOf('function mapSkuForPicker'), s.createJs.indexOf('function skuLineFrom')))) {
    errs.push('mapSkuForPicker 须映射 needsReview（待复核标记）')
  }
  if (!/action: 'sku\.list'[^}]*reviewOnly/.test(s.createJs)) errs.push('选 SKU 的 sku.list 须传 reviewOnly（只看待复核筛选）')
  const pickerAt = s.opsWxml.indexOf('<!-- 选已有 SKU -->')
  const picker = pickerAt < 0 ? '' : s.opsWxml.slice(pickerAt, s.opsWxml.indexOf('<!-- 现场新建 SKU -->'))
  if (!/<text class="ss-review-tag" wx:if="\{\{item\.needsReview\}\}">待复核<\/text>/.test(picker)) errs.push('选 SKU 弹层须对 needsReview 显示「待复核」标签')
  if (!/bindtap="toggleSkuReviewOnly"/.test(picker)) errs.push('选 SKU 弹层须有「只看待复核」筛选（toggleSkuReviewOnly）')
  // G17 草稿箱 / 历史备忘：不进统计 + 仅超管 + 标签
  const strays = (s.memoRefs || []).filter((f) => !MEMO_ALLOWED.includes(f))
  if (strays.length) errs.push(`${MEMO_COLL} 不得被统计 / 其它代码引用（草稿与历史不进任何统计），越界：${strays.join('、')}`)
  if (!/hasOwnProperty\.call\(memoHandlers, action\)\) \{\s*const auth = await requireSuperAdmin\(/.test(s.shipIndex)) errs.push('manageStoreShipment 的 memo.* 须仅超管（requireSuperAdmin）')
  if (!/<view class="mm-entry-row" wx:if="\{\{isSuper\}\}">[\s\S]*?data-kind="draft" bindtap="openMemoBox"[\s\S]*?data-kind="history" bindtap="openMemoBox"/.test(s.opsWxml)) {
    errs.push('「单据」页签须有仅超管可见的「草稿箱」「历史」入口（mm-entry-row wx:if isSuper → openMemoBox）')
  }
  if (!s.opsWxml.includes("item.kind === 'history' ? '已结清·历史' : '草稿'")) errs.push('草稿箱 / 历史列表须带「草稿」「已结清·历史」标签')
  if (!/if \(this\.data\.skuPicker\.target === 'memo'\) return this\.onMemoSkuPicked\(id\)/.test(s.createJs)) errs.push('选 SKU 弹层在草稿编辑时须回到 onMemoSkuPicked（否则会把 SKU 加进开单行）')
  if (!/memosPart\.methods/.test(s.opsJs)) errs.push('出货中心页须组装 parts/memos.js（memosPart.methods）')
  if (!/action: 'memo\.confirmDraft'/.test(s.memosJs)) errs.push('草稿转正式须走 memo.confirmDraft（服务端复用正式开单）')
  // H19 工作室仪表盘：历史备忘只进营收 / 出货额，不进结算口径；草稿不读
  if (!/fetchAll\(OPS_SHIPMENT_MEMOS, \{ kind: 'history', deleted: _\.neq\(true\) \}/.test(s.studioDash)) errs.push("工作室仪表盘读备忘只能读 kind:'history'（草稿不进任何统计）")
  if (!/\.filter\(\(m\) => m && m\.kind === 'history' && m\.deleted !== true\)/.test(s.studioKpis)) errs.push("historyRevenueRows 须只取 kind:'history'（草稿不进任何统计）")
  if (!/const revenueTotal = roundMoney\(shipments\.reduce\([^\n]*\+ historyRevenue\)/.test(s.studioDash)) errs.push('工作室仪表盘营收（revenueTotal）须含历史备忘')
  if (!/shippedAmount: roundMoney\(settlement\.shippedAmount \+ historyRevenue\)/.test(s.studioDash)) errs.push('工作室仪表盘出货额（shippedAmount）须含历史备忘')
  const kpiCalls = s.studioDash.match(/computeSettlementKpis\([^)]*\)/g) || []
  if (kpiCalls.length !== 1 || kpiCalls[0] !== 'computeSettlementKpis(shipments)') errs.push(`历史备忘不得进结算口径（已结清 / 未收款 / 待确认 / 真毛利）：computeSettlementKpis 只能吃正式单（现 ${kpiCalls.join('、') || '无'}）`)
  return errs
}

const WRITE_TAPS = ['openLibForm', 'toggleLibStatus', 'moveLibRow', 'askRemoveLib', 'confirmRemoveLib', 'deactivateBlocked']

/** 按标签栈求「写入口是否处于某个 wx:if 含 isSuper 的祖先（或自身）之下」；只扫到资料块闭合为止 */
function ungatedWrites(block) {
  const out = []
  const stack = []
  const re = /<(\/?)([\w-]+)((?:[^>"]|"[^"]*")*?)(\/?)>/g
  let m
  while ((m = re.exec(block))) {
    const [tag, close, , attrs, selfClose] = m
    if (close) {
      stack.pop()
      if (!stack.length) break
      continue
    }
    const gated = (stack.length && stack[stack.length - 1]) || /wx:if="[^"]*isSuper/.test(attrs)
    const tap = (attrs.match(/(?:bind|catch)tap="(\w+)"/) || [])[1]
    if (tap && WRITE_TAPS.includes(tap) && !gated) out.push(tag.slice(0, 80))
    if (!selfClose) stack.push(gated)
  }
  return out
}

/* ---------- E14 云函数运行时（隔离 tmp 副本，mock wx-server-sdk / staffGuard；注入只改副本） ---------- */
const PRICE_ROWS = () => [
  { _id: 'm1', name: '大蓝闪蝶', grade: 'A1', isDefaultGrade: true, status: 'active', sort: 30, unitPrice: 60 },
  { _id: 'm2', name: '大蓝闪蝶', grade: 'A2', status: 'active', sort: 10, unitPrice: 45 },
  { _id: 'm3', name: '光明女神', grade: '默认', isDefaultGrade: true, status: 'active', sort: 5, unitPrice: 88 },
  { _id: 'm4', name: '枯叶蛱蝶', grade: '默认', isDefaultGrade: true, status: 'inactive', sort: 1, unitPrice: 20 },
  { _id: 'm5', name: '金斑喙凤蝶', grade: '默认', isDefaultGrade: true, status: 'active', sort: 20, unitPrice: 99 }
]
const SHIPMENTS = () => [
  { _id: 's1', items: [{ materialId: 'm1', materialName: '大蓝闪蝶', materialGrade: 'A1' }] },
  { _id: 's2', items: [{ materialName: '光明女神', materialGrade: '' }] },
  { _id: 's3', deleted: true, items: [{ materialId: '', materialName: '大蓝闪蝶', materialGrade: 'A2' }] },
  { _id: 's4', items: [{ materialId: 'mX', materialName: '金斑喙凤蝶', materialGrade: '' }] }
]
const SKUS = () => [{ _id: 'k1', deleted: true, materialId: 'm5', materialName: '金斑喙凤蝶' }]

const SDK_MOCK = `
const M = global.__SS_MOCK
function q(name, list) {
  let skip = 0, lim = 1e9
  const api = {
    where() { return api }, orderBy() { return api }, field() { return api },
    skip(n) { skip = n; return api }, limit(n) { lim = n; return api },
    get: async () => ({ data: list().slice(skip, skip + lim).map((d) => JSON.parse(JSON.stringify(d))) }),
    count: async () => ({ total: list().length })
  }
  return api
}
module.exports = {
  DYNAMIC_CURRENT_ENV: 'x', init() {},
  getWXContext: () => ({ OPENID: 'o-test' }),
  database: () => ({
    command: { neq: (v) => ({ neq: v }), in: (a) => ({ in: a }), or: (a) => ({ or: a }), eq: (v) => ({ eq: v }) },
    serverDate: () => new Date(0),
    collection(name) {
      const list = () => (M.db[name] || [])
      return Object.assign(q(name, list), {
        doc: (id) => ({
          get: async () => { const d = list().find((r) => r._id === id); if (!d) throw new Error('not found'); return { data: JSON.parse(JSON.stringify(d)) } },
          update: async ({ data }) => { M.updates.push({ name, id, data }); return { stats: { updated: 1 } } }
        }),
        add: async () => ({ _id: 'new' })
      })
    }
  })
}`
const GUARD_MOCK = `
const M = global.__SS_MOCK
module.exports = {
  ROLE_MANAGER: 'manager', STORED_ROLE_SUPER: 'super', SUPER_ADMIN_OPENIDS: [],
  hasRole: () => true,
  assertStaff: async (db, openid, opts) => (M.role === 'manager' && opts && opts.permission)
    ? { ok: false, msg: '仅超管', code: 'FORBIDDEN' }
    : { ok: true, actor: { openid, name: 't', role: M.role } }
}`

async function serverErrs(mutateFiles) {
  const errs = []
  const fnDir = resolve(ROOT, 'miniprogram/cloudfunctions/manageStudioSettlement')
  const tmp = mkdtempSync(join(tmpdir(), 'ss-guard-'))
  try {
    cpSync(fnDir, tmp, { recursive: true, filter: (p) => !/node_modules/.test(p) })
    writeFileSync(join(tmp, 'package.json'), '{"type":"commonjs"}')
    mkdirSync(join(tmp, 'node_modules/wx-server-sdk'), { recursive: true })
    writeFileSync(join(tmp, 'node_modules/wx-server-sdk/index.js'), SDK_MOCK)
    writeFileSync(join(tmp, 'staffGuard.js'), GUARD_MOCK)
    for (const [f, fn] of Object.entries(mutateFiles || {})) {
      const p = join(tmp, f)
      writeFileSync(p, fn(readFileSync(p, 'utf8')))
    }
    const M = (global.__SS_MOCK = { role: 'super', updates: [], db: {} })
    const reset = () => {
      M.role = 'super'
      M.updates = []
      M.db = { studio_material_prices: PRICE_ROWS(), ops_shipments: SHIPMENTS(), studio_shipment_skus: SKUS() }
    }
    reset()
    const req = createRequire(join(tmp, 'index.js'))
    const fn = req(join(tmp, 'index.js'))
    const call = (ev) => fn.main(ev, {})

    // 不传 orderBy：输出形状与顺序同旧版（默认项在前，无 sort 字段，停用不出）
    const legacy = await call({ action: 'searchPriceBook', kind: 'material', keyword: '', limit: 30 })
    const lg = legacy.list || []
    const lgNames = lg.map((g) => g.name).join('/')
    if (!legacy.success || lgNames !== '大蓝闪蝶/光明女神/金斑喙凤蝶') errs.push(`不传 orderBy 时顺序须与旧版一致（现 ${lgNames}）`)
    if (JSON.stringify(lg).includes('"sort"')) errs.push('不传 orderBy 时输出不得新增 sort 字段（行为须完全不变）')
    if (lgNames.includes('枯叶蛱蝶')) errs.push('searchPriceBook 不得返回停用项')
    // 传 orderBy:'sort'
    const sorted = await call({ action: 'searchPriceBook', kind: 'material', keyword: '', limit: 30, orderBy: 'sort' })
    const sg = sorted.list || []
    const sNames = sg.map((g) => g.name).join('/')
    if (sNames !== '光明女神/大蓝闪蝶/金斑喙凤蝶') errs.push(`orderBy:'sort' 须按资料排序（现 ${sNames}）`)
    const blue = sg.find((g) => g.name === '大蓝闪蝶')
    const opts = blue ? (blue.options || []).map((o) => o.option).join('/') : ''
    if (opts !== 'A2/A1') errs.push(`orderBy:'sort' 组内选项须按 sort（现 ${opts}）`)
    if (sNames.includes('枯叶蛱蝶')) errs.push("orderBy:'sort' 也不得返回停用项")

    // removeIfUnused：有引用必拒
    for (const [id, why, key] of [['m1', '按 id 引用', 'shipments'], ['m3', '按名称（默认等级）引用', 'shipments'], ['m2', '已删出货单按名称+等级引用', 'deletedShipments']]) {
      reset()
      const r = await call({ action: 'priceBook.removeIfUnused', kind: 'material', id })
      if (r.success || r.code !== 'IN_USE' || !r.refs || !(r.refs[key] > 0)) errs.push(`删除有引用必拒：${id}（${why}）须 IN_USE 且 refs.${key}>0（现 ${JSON.stringify({ success: r.success, code: r.code, refs: r.refs })}）`)
      if (M.updates.length) errs.push(`删除被拒时不得写库：${id}`)
    }
    // 无引用（id 指向别行的同名行 / 仅已删 SKU 引用）→ 软删
    for (const id of ['m5', 'm4']) {
      reset()
      const r = await call({ action: 'priceBook.removeIfUnused', kind: 'material', id })
      const u = M.updates.find((x) => x.id === id)
      if (!r.success || !u || u.data.deleted !== true) errs.push(`无引用须软删成功：${id}（现 ${JSON.stringify({ success: r.success, msg: r.msg })}）`)
    }
    // 店长不能删
    reset()
    M.role = 'manager'
    const mr = await call({ action: 'priceBook.removeIfUnused', kind: 'material', id: 'm5' })
    if (mr.success || M.updates.length) errs.push('店长调用 removeIfUnused 须被拒（仅超管）')
    // 店长可读
    const ml = await call({ action: 'searchPriceBook', kind: 'material', keyword: '', orderBy: 'sort' })
    if (!ml.success) errs.push('店长须可读 searchPriceBook（资料只读 / 开单选择器）')
    // F16 待复核标记：透出 / 筛选 / 部分更新不冲掉
    reset()
    M.db.studio_shipment_skus = [
      { _id: 'k2', materialId: 'm3', materialName: '光明女神', packagingName: '玻璃罩', status: 'active', needsReview: true, importBatch: 'feishu-2026-10-09' },
      { _id: 'k3', materialId: 'm5', materialName: '金斑喙凤蝶', packagingName: '玻璃罩', status: 'active' }
    ]
    const all = await call({ action: 'sku.list', status: 'active' })
    const flags = (all.list || []).map((k) => `${k._id}:${k.needsReview}:${k.importBatch}`).join(',')
    if (!all.success || flags !== 'k2:true:feishu-2026-10-09,k3:false:') errs.push(`sku.list 须透出 needsReview / importBatch（现 ${flags || JSON.stringify(all.msg)}）`)
    if (all.reviewCount !== 1) errs.push(`sku.list 须回 reviewCount（现 ${all.reviewCount}）`)
    const only = await call({ action: 'sku.list', status: 'active', reviewOnly: true })
    const onlyIds = (only.list || []).map((k) => k._id).join(',')
    if (onlyIds !== 'k2') errs.push(`sku.list reviewOnly 须只回待复核 SKU（现 ${onlyIds}）`)
    const noFilter = await call({ action: 'sku.list', status: 'active', reviewOnly: 'yes' })
    if ((noFilter.list || []).length !== 2) errs.push('reviewOnly 只认布尔 true，其它值不得筛选（入参兼容）')
    M.db.studio_packaging_prices = [{ _id: 'p1', name: '玻璃罩', size: '默认', isDefaultSize: true, status: 'active', unitPrice: 8 }]
    await call({ action: 'sku.update', id: 'k2', item: { status: 'inactive' } })
    const up = M.updates.find((x) => x.id === 'k2')
    if (!up) errs.push('sku.update 部分更新未执行（待复核断言无意义）')
    else if (Object.prototype.hasOwnProperty.call(up.data, 'needsReview') || Object.prototype.hasOwnProperty.call(up.data, 'importBatch')) {
      errs.push('sku.update 部分更新不得改写 needsReview / importBatch（会冲掉待复核标记）')
    }
  } catch (e) {
    errs.push('云函数运行时测试异常：' + ((e && e.stack) || e))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    delete global.__SS_MOCK
  }
  return errs
}

/* ---------- G18 manageStoreShipment 运行时（有状态 mock：where 真过滤、update 真回写） ---------- */
const MEMO_SDK_MOCK = `
const M = global.__SM_MOCK
const clone = (d) => JSON.parse(JSON.stringify(d))
function hit(doc, cond) {
  return Object.entries(cond || {}).every(([k, v]) => {
    const x = doc[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('neq' in v) return x !== v.neq
      if ('in' in v) return v.in.includes(x)
      if ('eq' in v) return x === v.eq
      return true
    }
    return x === v
  })
}
function q(name, cond) {
  let skip = 0, lim = 1e9
  const rows = () => (M.db[name] || []).filter((d) => hit(d, cond))
  const api = {
    where(c) { return q(name, Object.assign({}, cond, c)) }, orderBy() { return api }, field() { return api },
    skip(n) { skip = n; return api }, limit(n) { lim = n; return api },
    get: async () => ({ data: rows().slice(skip, skip + lim).map(clone) }),
    count: async () => ({ total: rows().length }),
    update: async ({ data }) => { const r = rows(); r.forEach((d) => Object.assign(d, clone(data))); M.writes.push({ op: 'update', name, where: cond, data }); return { stats: { updated: r.length } } }
  }
  return api
}
module.exports = {
  DYNAMIC_CURRENT_ENV: 'x', init() {},
  callFunction: async () => ({ result: { success: true } }),
  getWXContext: () => ({ OPENID: 'o-test' }),
  database: () => ({
    command: { neq: (v) => ({ neq: v }), in: (a) => ({ in: a }), or: (a) => ({ or: a }), eq: (v) => ({ eq: v }) },
    serverDate: () => new Date(0),
    collection(name) {
      const list = () => (M.db[name] = M.db[name] || [])
      return Object.assign(q(name, {}), {
        doc: (id) => ({
          get: async () => { const d = list().find((r) => r._id === id); if (!d) throw new Error('not found'); return { data: clone(d) } },
          update: async ({ data }) => { const d = list().find((r) => r._id === id); if (d) Object.assign(d, clone(data)); M.writes.push({ op: 'update', name, id, data }); return { stats: { updated: d ? 1 : 0 } } }
        }),
        add: async ({ data }) => { const _id = 'new' + (++M.seq); list().push(Object.assign({ _id }, clone(data))); M.writes.push({ op: 'add', name, id: _id, data }); return { _id } }
      })
    }
  })
}`
const MEMO_GUARD_MOCK = `
const M = global.__SM_MOCK
module.exports = {
  ROLE_MANAGER: 'manager', STORED_ROLE_SUPER: 'super', SUPER_ADMIN_OPENIDS: [],
  hasRole: () => true,
  assertStaff: async (db, openid, opts) => (M.role === 'manager' && opts && (opts.requireSuperAdmin || opts.permission))
    ? { ok: false, msg: '仅超管', code: 'FORBIDDEN' }
    : { ok: true, actor: { openid, name: 't', role: M.role } }
}`
const MEMO_SKU = { _id: 'sku1', skuName: '爱神凤蝶 · 玻璃罩 15x22 · 造景', materialId: 'm1', materialName: '爱神凤蝶', materialGrade: '默认', packagingId: 'p1', packagingName: '玻璃罩', packagingSize: '15x22', hasScene: true, sceneCost: 10, laborRatePct: null, status: 'active' }
const MEMO_DB = () => ({
  studio_shipment_skus: [MEMO_SKU],
  studio_material_prices: [{ _id: 'm1', name: '爱神凤蝶', grade: '默认', isDefaultGrade: true, unitPrice: 60, status: 'active' }],
  studio_packaging_prices: [{ _id: 'p1', name: '玻璃罩', size: '15x22', isDefaultSize: true, unitPrice: 24, status: 'active' }],
  configs: [{ _id: 'studio_settlement', enabled: true, laborRatePct: 20, requirePackaging: true }],
  ops_shipments: [],
  [MEMO_COLL]: [
    { _id: 'd1', kind: 'draft', status: 'draft', storeId: 'store_shanhaizaowu', storeName: '山川造物', storeMatched: true, shipmentDate: '2026-10-08', deleted: false,
      lines: [{ key: 'r1', rawName: '爱神造景玻璃罩', qty: 2, feishuAmount: 200, match: 'none' }, { key: 'r2', rawName: '小贝壳表', qty: 2, feishuAmount: 292, match: 'none' }] },
    { _id: 'd2', kind: 'draft', status: 'draft', importBatch: 'feishu-drafts-2026-10-09', storeId: 'store_xingchen', storeName: '星宸标本', storeMatched: true, shipmentDate: '2026-10-01', deleted: false,
      lines: [{ key: 'q1', rawName: '爱神造景玻璃罩', qty: 1, feishuAmount: 999, match: 'sku', skuId: 'sku1' }] },
    { _id: 'h1', kind: 'history', status: 'history', historical: true, settled: true, storeId: 'store_shanhaizaowu', storeName: '山川造物', storeMatched: true, shipmentDate: '2026-09-19', deleted: false,
      lines: [{ key: 'x1', rawName: '熊蜂王玻璃罩', qty: 1, feishuAmount: 30, match: 'none' }, { key: 'x2', rawName: '已删行', qty: 1, feishuAmount: 7, match: 'none', removed: true }] }
  ]
})
const amountsOf = (data) => JSON.stringify({ total: data.totalAmount, items: (data.items || []).map((it) => [it.skuId, it.qty, it.unitPrice, it.totalPrice]) })

async function memoErrs(mutateFiles) {
  const errs = []
  const fnDir = resolve(ROOT, 'miniprogram/cloudfunctions/manageStoreShipment')
  const tmp = mkdtempSync(join(tmpdir(), 'sm-guard-'))
  try {
    cpSync(fnDir, tmp, { recursive: true, filter: (p) => !/node_modules/.test(p) })
    writeFileSync(join(tmp, 'package.json'), '{"type":"commonjs"}')
    mkdirSync(join(tmp, 'node_modules/wx-server-sdk'), { recursive: true })
    writeFileSync(join(tmp, 'node_modules/wx-server-sdk/index.js'), MEMO_SDK_MOCK)
    writeFileSync(join(tmp, 'staffGuard.js'), MEMO_GUARD_MOCK)
    for (const [f, fn] of Object.entries(mutateFiles || {})) {
      const p = join(tmp, f)
      writeFileSync(p, fn(readFileSync(p, 'utf8')))
    }
    const M = (global.__SM_MOCK = { role: 'super', writes: [], seq: 0, db: MEMO_DB() })
    const fn = createRequire(join(tmp, 'index.js'))(join(tmp, 'index.js'))
    const call = (ev) => fn.main(ev, {})
    const shipWrites = () => M.writes.filter((w) => w.name !== MEMO_COLL)
    const memo = (id) => M.db[MEMO_COLL].find((d) => d._id === id)

    const ld = await call({ action: 'memo.list', kind: 'draft' })
    const lh = await call({ action: 'memo.list', kind: 'history' })
    if (!ld.success || (ld.list || []).map((m) => m._id).join() !== 'd1,d2' || !lh.success || (lh.list || []).map((m) => m._id).join() !== 'h1') {
      errs.push(`memo.list 须按 kind 分开回草稿 / 历史（现 ${JSON.stringify({ d: ld.list && ld.list.map((m) => m._id), h: lh.list && lh.list.map((m) => m._id), msg: ld.msg || lh.msg })}）`)
    }
    if (M.writes.length) errs.push(`memo.list 不得写库（现写了 ${M.writes.map((w) => w.name).join('、')}）`)

    M.writes = []
    let r = await call({ action: 'memo.confirmDraft', id: 'd1' })
    if (r.success || r.code !== 'PENDING_MATCH' || shipWrites().length || memo('d1').status !== 'draft') errs.push(`有待匹配行的草稿不得转正式（须 PENDING_MATCH 且零写 ops_shipments，现 ${JSON.stringify({ success: r.success, code: r.code })}）`)

    M.writes = []
    r = await call({ action: 'memo.updateDraft', id: 'h1', patch: { lines: [{ key: 'x1', skuId: 'sku1' }] } })
    if (r.success || M.writes.length) errs.push('已结清历史备忘须只读（memo.updateDraft 须拒且零写入）')
    r = await call({ action: 'memo.removeDraft', id: 'h1' })
    if (r.success || M.writes.length) errs.push('已结清历史备忘不可删除（memo.removeDraft 须拒且零写入）')

    M.writes = []
    r = await call({ action: 'memo.updateDraft', id: 'd1', patch: { lines: [{ key: 'r1', skuId: 'sku1' }, { key: 'r2', removed: true }] } })
    if (!r.success || !r.item || r.item.pendingCount !== 0) errs.push(`草稿选 SKU / 删行后须无待匹配（现 ${JSON.stringify(r.item ? { pendingCount: r.item.pendingCount } : { msg: r.msg })}）`)
    if (shipWrites().length) errs.push('草稿编辑不得写 ops_shipments（草稿不进统计）')

    // H19 出货观测台：历史只进金额、不进笔数；草稿永不进（此刻库里还没有正式单）
    M.db.ops_shipments = [{ _id: 's0', storeId: 'store_shanhaizaowu', storeName: '山川造物', customerName: '山川造物', shipmentDate: '2026-09-19', status: 'confirmed', totalAmount: 100, items: [] }]
    const dash = await call({ action: 'dashboard' })
    const dk = (dash && dash.kpis) || {}
    if (!dash.success) errs.push(`出货观测台调用失败（${dash.msg}）`)
    else {
      if (dk.revenueTotal !== 130 || dk.historyRevenue !== 30) errs.push(`观测台营收须含历史备忘（飞书金额，删行不计）：期望 130 / 历史 30，现 ${dk.revenueTotal} / ${dk.historyRevenue}`)
      if (dk.revenueTotal > 130) errs.push('草稿不得进营收（观测台）')
      const counted = ((dash.charts && dash.charts.byStore) || []).reduce((n, x) => n + x.count, 0)
      if (dk.shipmentCount !== 1 || counted !== 1) errs.push(`历史备忘不得计入笔数（观测台 shipmentCount ${dk.shipmentCount}、门店分布笔数 ${counted}，应为 1）`)
    }
    M.db.ops_shipments = []

    const direct = await call({ action: 'createFromSkus', storeId: 'store_shanhaizaowu', shipmentDate: '2026-10-08', lines: [{ skuId: 'sku1', qty: 2 }], silentNotify: true })
    if (direct.success && direct.notify && direct.notify.skipped === 'IMPORTED_DRAFT') errs.push('客户端入参不得关闭通知（silentNotify 只能由服务端内部传）')
    const directAdd = M.writes.find((w) => w.op === 'add' && w.name === 'ops_shipments')
    if (!direct.success || !directAdd) errs.push(`直接开单基线失败（${direct.msg}）`)
    const r1 = (r.item && r.item.lines || []).find((l) => l.key === 'r1') || {}
    if (directAdd && Number(r1.refAmount) !== Number(directAdd.data.totalAmount)) errs.push(`草稿参考金额须与直接开单一致（参考 ${r1.refAmount}，直接 ${directAdd.data.totalAmount}）`)

    M.writes = []
    const both = await Promise.all([call({ action: 'memo.confirmDraft', id: 'd1' }), call({ action: 'memo.confirmDraft', id: 'd1' })])
    const adds = M.writes.filter((w) => w.op === 'add')
    if (both.filter((x) => x.success).length !== 1 || adds.length !== 1 || adds[0].name !== 'ops_shipments') {
      errs.push(`草稿转正式须且只开一张 ops_shipments（并发双击也只开一张；现成功 ${both.filter((x) => x.success).length} 次、写 ${adds.map((w) => w.name).join('、') || '无'}；${both.map((x) => x.msg).join(' / ')}）`)
    } else {
      const won = both.find((x) => x.success)
      if (won.notify && won.notify.skipped === 'IMPORTED_DRAFT') errs.push('手工草稿转正式须照常通知（只有 feishu- 导入批次静默）')
      if (directAdd && amountsOf(adds[0].data) !== amountsOf(directAdd.data)) errs.push(`草稿转正式的金额须与直接开单一致：转正式 ${amountsOf(adds[0].data)}，直接 ${amountsOf(directAdd.data)}`)
      const d1 = memo('d1')
      if (d1.status !== 'confirmed' || d1.confirmedShipmentId !== adds[0].id) errs.push(`转正式后草稿须标 confirmed 并记 confirmedShipmentId（现 ${d1.status} / ${d1.confirmedShipmentId}）`)
    }
    M.writes = []
    const imp = await call({ action: 'memo.confirmDraft', id: 'd2' })
    if (!imp.success) errs.push(`导入草稿转正式失败（${imp.msg}）`)
    else if (!imp.notify || imp.notify.skipped !== 'IMPORTED_DRAFT' || memo('d2').notifySuppressed !== true) errs.push(`导入批次（feishu-）草稿转正式不得通知门店（现 notify=${JSON.stringify(imp.notify)}）`)
    const after = await call({ action: 'memo.list', kind: 'draft' })
    if ((after.list || []).length) errs.push('已转正式的草稿不得再出现在草稿箱')

    M.role = 'manager'
    M.writes = []
    r = await call({ action: 'memo.list', kind: 'draft' })
    if (r.success) errs.push('店长调用 memo.* 须被拒（仅超管）')
  } catch (e) {
    errs.push('草稿箱运行时测试异常：' + ((e && e.stack) || e))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    delete global.__SM_MOCK
  }
  return errs
}

const src = {}
for (const [k, rel] of Object.entries(FILES)) {
  const p = resolve(ROOT, rel)
  if (!existsSync(p)) {
    console.error(TAG, '缺少', rel)
    process.exit(1)
  }
  src[k] = readFileSync(p, 'utf8')
}
src.memoRefs = memoRefFiles()

if (selftest) {
  // 每条注入只改内存副本，不碰源文件；任何一条没被检出即失败
  const cases = [
    ['非超管可进 SKU', (s) => ({ ...s, createJs: s.createJs.replace("next === 'sku' && !this.data.isSuper ? 'paste'", "next === 'sku' && false ? 'paste'") }), /SKU 开单仅超管/],
    ['CTA 半宽回退', (s) => ({ ...s, skuWxss: s.skuWxss.replace(/(\.ss-cta\s*\{[^}]*?[\s;{])width:\s*100%\s*!important/, '$1width: auto') }), /ss-cta 须 width/],
    ['scroll-view 缺高度', (s) => ({ ...s, opsWxml: s.opsWxml.replace('scroll-y style="height: {{sheetBodyPx}}px;"', 'scroll-y') }), /scroll-view scroll-y 须内联/],
    ['写入后不切单据', (s) => ({ ...s, opsJs: s.opsJs.replace(/(revealAfterWrite\(opts\)[\s\S]*?)activeTab:\s*'list'/, "$1activeTab: 'create'") }), /activeTab list/],
    ['旧开单磁贴复活', (s) => ({ ...s, hubWxml: s.hubWxml + '\n<view><text>出货开单</text></view>' }), /不得再有独立/],
    ['重定向壳复活逻辑', (s) => ({ ...s, shellJs: s.shellJs + "\nwx.cloud.callFunction({ name: 'manageStoreShipment' })" }), /不得再调云函数/],
    ['资料暴露删除', (s) => ({ ...s, libraryJs: s.libraryJs + "\nconst x = { action: 'priceBook.remove' }" }), /priceBook\.remove/],
    ['单条丢原材料', (s) => ({ ...s, createJs: s.createJs.replace(/line\.materialName\s*=/g, 'line.matX =') }), /单条补录须可选带/],
    ['SKU 载荷带单价', (s) => ({ ...s, createJs: s.createJs.replace('const out = { skuId: l.skuId,', 'const out = { unitPrice: l.unitPrice, skuId: l.skuId,') }), /不得带单价/],
    ['staffAuth 漂移', (s) => ({ ...s, staffManager: s.staffManager + '\n// drift' }), /逐字一致/],
    ['原生 toast', (s) => ({ ...s, libraryJs: s.libraryJs + "\nwx.showToast({ title: 'x' })" }), /原生 toast/],
    ['资料页签对店长隐藏', (s) => ({ ...s, opsJs: s.opsJs.replace(", { key: 'library', label: '资料' })", ")\n    if (this.data.isSuper) tabs.push({ key: 'library', label: '资料' })") }), /须对店长可见/],
    ['店长看见删除', (s) => ({ ...s, opsWxml: s.opsWxml.replace(/<view class="sc-lib-actions" wx:if="\{\{isSuper\}\}"/, '<view class="sc-lib-actions"') }), /isSuper 门下/],
    ['店长看见新增', (s) => ({ ...s, opsWxml: s.opsWxml.replace(/ wx:if="\{\{isSuper\}\}"([^>]*bindtap="openLibForm")/, '$1') }), /isSuper 门下/],
    ['写方法不拦店长', (s) => ({ ...s, libraryJs: s.libraryJs.replace("if (!this.data.isSuper || !row || this.data.libBusy) return\n    const label", "if (!row || this.data.libBusy) return\n    const label") }), /confirmRemoveLib 须首行拦截/],
    ['选择器丢排序参数', (s) => ({ ...s, createJs: s.createJs.replace(", orderBy: 'sort' })", ' })') }), /出货中心选择器/],
    ['编辑页丢排序参数', (s) => ({ ...s, editJs: s.editJs.replace(", orderBy: 'sort' }", ' }') }), /shipment-edit 选择器/],
    ['删除绕过引用检查', (s) => ({ ...s, libraryJs: s.libraryJs.replace("'priceBook.removeIfUnused'", "'priceBook.remove'") }), /priceBook\.remove/],
    ['店长可删（服务端）', (s) => ({ ...s, settle: s.settle.replace("'priceBook.removeIfUnused': 1", "'priceBook.removeIfUnusedX': 1") }), /SUPER_ONLY_ACTIONS/],
    ['待复核标签被删', (s) => ({ ...s, opsWxml: s.opsWxml.replace('wx:if="{{item.needsReview}}">待复核', 'wx:if="{{false}}">待复核') }), /待复核」标签/],
    ['待复核筛选被删', (s) => ({ ...s, opsWxml: s.opsWxml.replace('bindtap="toggleSkuReviewOnly"', '') }), /只看待复核/],
    ['选择器丢待复核映射', (s) => ({ ...s, createJs: s.createJs.replace('needsReview: s.needsReview === true', 'needsReviewX: false') }), /mapSkuForPicker 须映射 needsReview/],
    ['选择器丢 reviewOnly', (s) => ({ ...s, createJs: s.createJs.replace("limit: 100, reviewOnly }", 'limit: 100 }') }), /须传 reviewOnly/],
    ['统计读到草稿集合', (s) => ({ ...s, memoRefs: s.memoRefs.concat('miniprogram/cloudfunctions/manageStoreShipment/shipmentDashboard.js') }), /不得被统计/],
    ['备忘对店长开放（静态）', (s) => ({ ...s, shipIndex: s.shipIndex.replace(/(hasOwnProperty\.call\(memoHandlers, action\)\) \{\s*const auth = await )requireSuperAdmin/, '$1requireWriter') }), /memo\.\* 须仅超管/],
    ['入口不限超管', (s) => ({ ...s, opsWxml: s.opsWxml.replace('<view class="mm-entry-row" wx:if="{{isSuper}}">', '<view class="mm-entry-row">') }), /仅超管可见的「草稿箱」/],
    ['草稿标签被删', (s) => ({ ...s, opsWxml: s.opsWxml.split("item.kind === 'history' ? '已结清·历史' : '草稿'").join("item.kind") }), /已结清·历史」标签/],
    ['选 SKU 不回草稿', (s) => ({ ...s, createJs: s.createJs.replace("if (this.data.skuPicker.target === 'memo') return this.onMemoSkuPicked(id)\n", '') }), /onMemoSkuPicked/],
    ['仪表盘读草稿', (s) => ({ ...s, studioDash: s.studioDash.replace("{ kind: 'history', deleted: _.neq(true) }", '{ deleted: _.neq(true) }') }), /只能读 kind:'history'/],
    ['仪表盘映射吃草稿', (s) => ({ ...s, studioKpis: s.studioKpis.replace("m && m.kind === 'history' && m.deleted !== true", 'm && m.deleted !== true') }), /historyRevenueRows 须只取/],
    ['仪表盘营收漏历史', (s) => ({ ...s, studioDash: s.studioDash.replace(' + historyRevenue)\n    const shipmentCount', ')\n    const shipmentCount') }), /revenueTotal）须含历史/],
    ['仪表盘出货额漏历史', (s) => ({ ...s, studioDash: s.studioDash.replace('roundMoney(settlement.shippedAmount + historyRevenue)', 'settlement.shippedAmount') }), /shippedAmount）须含历史/],
    ['历史进结算口径', (s) => ({ ...s, studioDash: s.studioDash.replace('computeSettlementKpis(shipments)', 'computeSettlementKpis(shipments.concat(historyRows))') }), /不得进结算口径/]
  ]
  // 运行时注入：只改 tmp 副本里的云函数源码
  const serverCases = [
    ['引用检查失效', { 'priceBookRefs.js': (t) => t.replace(/function refMatcher\(book, row\) \{/, 'function refMatcher(book, row) {\n  return () => false') }, /删除有引用必拒/],
    ['按名称引用漏检', { 'priceBookRefs.js': (t) => t.replace(/function refMatcher\(book, row\) \{/, "function refMatcher(book, row) {\n  return (it) => !!it && it[REF_FIELDS[book.kind].id] === row._id") }, /按名称/],
    ['不传参也带 sort', { 'index.js': (t) => t.replace('if (bySort) opt.sort =', 'opt.sort =') }, /不得新增 sort 字段/],
    ['不传参也重排', { 'index.js': (t) => t.replace('if (bySort) orderGroupsBySort(groups)', 'orderGroupsBySort(groups)') }, /顺序须与旧版一致|不得新增 sort 字段/],
    ['传参不重排', { 'index.js': (t) => t.replace('if (bySort) orderGroupsBySort(groups)', '') }, /须按资料排序/],
    ['停用项进选择器', { 'index.js': (t) => t.replace(/if \(r\.status !== ['"]active['"]\) continue/, '') }, /不得返回停用项/],
    ['店长可删（运行时）', { 'index.js': (t) => t.replace("'priceBook.removeIfUnused': 1,", '').replace("'priceBook.removeIfUnused': 1", '') }, /店长调用 removeIfUnused 须被拒/],
    ['mapSku 不透出待复核', { 'settlementDefaults.js': (t) => t.replace('needsReview: d.needsReview === true,', '') }, /须透出 needsReview/],
    ['reviewOnly 不筛选', { 'index.js': (t) => t.replace('if (event.reviewOnly === true) rows = rows.filter((r) => r.needsReview === true)', '') }, /reviewOnly 须只回待复核/],
    ['reviewOnly 宽松判真', { 'index.js': (t) => t.replace('if (event.reviewOnly === true)', 'if (event.reviewOnly)') }, /只认布尔 true/],
    ['部分更新冲掉待复核', { 'settlementDefaults.js': (t) => t.replace("note: String(src.note == null ? '' : src.note).trim(),\n    deleted: false", "note: String(src.note == null ? '' : src.note).trim(),\n    needsReview: false,\n    deleted: false") }, /不得改写 needsReview/]
  ]
  // G18 运行时注入：只改 manageStoreShipment 的 tmp 副本
  const memoCases = [
    ['列表写进出货单', { 'shipmentMemos.js': (t) => t.replace('return ok({ kind, list: visible.map(mapMemo), total: visible.length })', "await db.collection('ops_shipments').add({ data: { x: 1 } })\n    return ok({ kind, list: visible.map(mapMemo), total: visible.length })") }, /memo\.list 不得写库/],
    ['转正式另算金额', { 'shipmentMemos.js': (t) => t.replace('lines: lines.map((l) => ({ skuId: l.skuId, qty: l.qty })),', 'lines: lines.map((l) => ({ skuId: l.skuId, qty: l.qty, sceneCost: 0 })),') }, /金额须与直接开单一致/],
    ['待匹配也能转正式', { 'shipmentMemos.js': (t) => t.replace(/if \(s\.pendingLines\) return fail\([^\n]*\n/, '') }, /待匹配行的草稿不得转正式/],
    ['历史可编辑', { 'shipmentMemos.js': (t) => t.replace("if (doc.kind !== KIND.DRAFT || doc.status !== MEMO_STATUS.DRAFT) return fail('只有未转正式的草稿可以修改'", "if (false) return fail('只有未转正式的草稿可以修改'") }, /历史备忘须只读/],
    ['并发双击开两张', { 'shipmentMemos.js': (t) => t.replace("if (!claim || !claim.stats || claim.stats.updated !== 1)", 'if (false)') }, /只开一张/],
    ['删除的行仍进正式单', { 'shipmentMemos.js': (t) => t.replace('const lines = (doc.lines || []).filter((l) => !l.removed)', 'const lines = doc.lines || []') }, /只开一张|金额须与直接开单一致/],
    ['观测台漏历史营收', { 'shipmentDashboard.js': (t) => t.replace('    revenueTotal = roundMoney(revenueTotal + amt)\n    const mk = shipmentMonthKey(row)\n    if (mk === todayYm) monthAmount', '    const mk = shipmentMonthKey(row)\n    if (mk === todayYm) monthAmount') }, /观测台营收须含历史/],
    ['草稿进营收', { 'shipmentMemos.js': (t) => t.replace('.filter((m) => m && m.kind === KIND.HISTORY && m.deleted !== true)', '.filter((m) => m && m.deleted !== true)').replace('const where = { kind: KIND.HISTORY, deleted: _.neq(true) }', 'const where = { deleted: _.neq(true) }') }, /草稿不得进营收|观测台营收须含历史/],
    ['历史计入笔数', { 'shipmentDashboard.js': (t) => t.replace('    if (!r.historical) map[key].count += 1\n  })\n  return Object.keys(map)', '    map[key].count += 1\n  })\n  return Object.keys(map)') }, /不得计入笔数/],
    ['导入草稿照常通知', { 'shipmentMemos.js': (t) => t.replace('const silentNotify = /^feishu-/', 'const silentNotify = false && /^feishu-/') }, /导入批次（feishu-）草稿转正式不得通知/],
    ['手工草稿也静默', { 'shipmentMemos.js': (t) => t.replace('const silentNotify = /^feishu-/', 'const silentNotify = true || /^feishu-/') }, /手工草稿转正式须照常通知/],
    ['客户端可关通知', { 'index.js': (t) => t.replace('opts && opts.silentNotify === true', '((opts && opts.silentNotify === true) || event.silentNotify === true)') }, /客户端入参不得关闭通知/],
    ['备忘对店长开放（运行时）', { 'index.js': (t) => t.replace(/(hasOwnProperty\.call\(memoHandlers, action\)\) \{\s*const auth = await )requireSuperAdmin/, '$1requireWriter') }, /店长调用 memo/]
  ]
  const base = collect(src).concat(await serverErrs(), await memoErrs())
  if (base.length) {
    base.forEach((e) => console.error(TAG, '基线不绿，selftest 无意义：', e))
    process.exit(1)
  }
  let bad = 0
  for (const [name, mutate, expect] of cases) {
    const mutated = mutate(src)
    const changed = Object.keys(src).some((k) => mutated[k] !== src[k])
    const errs = collect(mutated)
    if (!changed || !errs.some((e) => expect.test(e))) {
      console.error(TAG, `selftest 失败：「${name}」${changed ? '未被检出' : '注入未生效（锚点失配）'}`)
      bad++
    }
  }
  for (const [name, files, expect] of serverCases) {
    const errs = await serverErrs(files)
    if (!errs.some((e) => expect.test(e))) {
      console.error(TAG, `selftest 失败：「${name}」未被检出`, errs.slice(0, 2))
      bad++
    }
  }
  for (const [name, files, expect] of memoCases) {
    const errs = await memoErrs(files)
    if (!errs.some((e) => expect.test(e))) {
      console.error(TAG, `selftest 失败：「${name}」未被检出`, errs.slice(0, 2))
      bad++
    }
  }
  if (bad) process.exit(1)
  console.log(TAG, `selftest ok（${cases.length + serverCases.length + memoCases.length} 条注入全部检出）`)
  process.exit(0)
}

const errs = collect(src).concat(await serverErrs(), await memoErrs())
if (errs.length) {
  errs.forEach((e) => console.error(TAG, e))
  process.exit(1)
}
console.log(TAG, 'pass')
