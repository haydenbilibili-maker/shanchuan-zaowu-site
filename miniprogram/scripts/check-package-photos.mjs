#!/usr/bin/env node
/**
 * 发货包装图片（**可选附件**）行为守卫 —— `npm run check:package-photos`
 *
 * 需求（产品负责人原话）：
 *   「发货订单支持上传商品的包装图片，图片非必须，但是如果上传将会随着山海有信一起发送给用户。」
 * 拆成四条可验收判据：① 上传 1..N 张且**不传时行为完全一致**；② 随「山海有信」发出；
 * ③ 顾客侧能看到；④ **存量订单不受影响**。
 *
 * 为什么必须真跑源码 + 真渲染（而不是静态 grep）：
 *   · 「不传时行为完全一致」这句话，**只有把两次真实的落库对象摆在一起比 key 集合**才证得了；
 *     静态检查最多证明"源码里有个 if"。
 *   · 「顾客能不能看到图」是**渲染问题**：字段落库了但 WXML 不画，等于假交付。
 *     所以本守卫**真解析 detail/index.wxml 并渲染**，数出真实产出的 `<img>` 元素。
 *   · 「图片随信发出」横跨两个云函数（managerShipOrder → dispatchMessage），
 *     任一处漏传都表现为「静默没图」，故把两处调用点的载荷都读出来断言。
 *
 * 用法：
 *   node miniprogram/scripts/check-package-photos.mjs
 *   node miniprogram/scripts/check-package-photos.mjs --selftest   # 注入回归 → 必须被检出 → 还原
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, cpSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { renderWxml } from './lib/wxml-preview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const MP = resolve(ROOT, 'miniprogram')
const require = createRequire(import.meta.url)
/** 探针临时目录（不进版本库；每次自建，用完即删） */
const TMP_DIR = resolve(ROOT, 'miniprogram/scripts/.tmp')

let passed = 0
let failed = 0
const failures = []
function check(name, cond, extra) {
  if (cond) passed += 1
  else {
    failed += 1
    failures.push(`${name}${extra ? ' — ' + extra : ''}`)
  }
}
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')

/**
 * 小程序源码是 **CommonJS**，而本仓库 `package.json` 是 `"type": "module"`
 * —— 直接 `require()` 会被 Node 当成 ESM 报 `module is not defined`。
 * 故用与本仓 `test-message-products.mjs` **同一形态**的加载器（不另造一套）。
 */
function loadCjs(rel) {
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', read(rel))(mod, mod.exports)
  return mod.exports
}


/**
 * 真跑 `managerShipOrder/messageWrite.js` 的 `writeDirect`（用桩 db，只截获 `.add` 载荷）。
 *
 * 为什么必须跑**真模块**而不是切一段源码出来 eval（本守卫第一版这么做过，踩了两个坑）：
 *   ① 切片跑不到 `require('./orderSummary')` —— 于是「临时路径必须被丢弃」那条注入
 *      **打在真源上却完全不被检出**（错题本 E18-b：注入必须打到实现真源）；
 *   ② 切片把「块外变量按参数硬塞」变成假象，改坏真源码也未必红。
 * 现在这条路径与线上同源：`writeDirect` → `pickPackagePhotos`（真实现）。
 *
 * 实现：把真源**复制**到 `.tmp/` 下（真源一个字节都不动），只把 `wx-server-sdk`
 * 换成同目录的桩 —— 这样 `require('./orderSummary')` 仍然解析到**真副本**。
 */
function loadRealMessageWrite() {
  const srcDir = resolve(MP, 'cloudfunctions/managerShipOrder')
  /* ⚠️ 2026-09-21 集成官修复：`TMP_DIR`（miniprogram/scripts/.tmp）**在 gitignore 里**，
   * 新克隆 / CI / 隔离 worktree 里都不存在 —— 原来直接 `mkdtempSync` 会
   * `ENOENT: mkdtemp ... /.tmp/pkgphotos-XXXXXX`，**守卫自身报错（exit 1）**，
   * 于是 `check:admin` 在 CI 上会红，而且看起来像"代码有问题"。
   * 先递归创建父目录即可（幂等）。 */
  mkdirSync(TMP_DIR, { recursive: true })
  const work = mkdtempSync(join(TMP_DIR, 'pkgphotos-'))
  for (const f of ['messageWrite.js', 'orderSummary.js']) {
    cpSync(join(srcDir, f), join(work, f))
  }
  writeFileSync(
    join(work, 'package.json'),
    JSON.stringify({ name: 'pkgphotos-probe', private: true, type: 'commonjs' })
  )
  // 把 cloud SDK 换成内联桩：真源一个字节都不改，只改**副本**的这一行。
  // 用 createRequire 按绝对路径加载副本 —— 于是副本里的 `require('./orderSummary')`
  // 解析到**同目录的真副本**（注入打上去就会被跑到；这正是第一版切片做不到的事）。
  const patched = read('miniprogram/cloudfunctions/managerShipOrder/messageWrite.js').replace(
    "const cloud = require('wx-server-sdk')",
    [
      'const cloud = {',
      '  init() {},',
      '  database: () => ({ serverDate: () => "SERVER_DATE", collection: () => ({}) }),',
      '  callFunction: async () => ({ result: { success: false, msg: "stub" } })',
      '}'
    ].join('\n')
  )
  writeFileSync(join(work, 'messageWrite.js'), patched)
  return { mod: require(join(work, 'messageWrite.js')), work }
}

/** ① 可选：不传时**不写 photos 键**，与改造前逐字节一致（需求 1 + 需求 4） */
async function assertOptionalContract() {
  const { mod: mw, work } = loadRealMessageWrite()
  try {
    check('messageWrite 导出了 writeDirect（真实现，不是切片）', typeof mw.writeDirect === 'function')

    const captured = []
    const makeDb = () => ({
      serverDate: () => 'SERVER_DATE',
      collection: (name) => ({
        where: () => ({ limit: () => ({ get: async () => ({ data: [] }) }) }),
        add: async ({ data }) => {
          captured.push({ name, data: JSON.parse(JSON.stringify(data)) })
          return { _id: 'generated-id' }
        }
      })
    })
    const basePayload = {
      eventType: 'order_shipped',
      openid: 'openid-x',
      relatedId: 'order-1',
      title: '标本已启程',
      content: '正文',
      category: 'order',
      actionUrl: 'subpackages/business/order-detail/index?id=order-1',
      products: []
    }

    captured.length = 0
    const noPhotoRes = await mw.writeDirect(makeDb(), { ...basePayload })
    const withoutRow = captured.find((c) => c.name === 'user_messages')
    check('真跑 writeDirect（不传图）确实写出了消息', !!withoutRow && noPhotoRes.success === true)

    captured.length = 0
    await mw.writeDirect(makeDb(), {
      ...basePayload,
      // 混入本机临时路径与重复项：这一行跑的就是真源码里的 pickPackagePhotos
      photos: [PHOTO_A, PHOTO_B, 'wxfile://tmp/local.png', 'http://tmp/another.jpg', PHOTO_A]
    })
    const withRow = captured.find((c) => c.name === 'user_messages')
    check('真跑 writeDirect（传图）确实写出了消息', !!withRow)

    const without = withoutRow.data
    const withPhotos = withRow.data

    check('不传包装图时**没有任何** photos 键', !('photos' in without), `keys=${Object.keys(without)}`)
    check('传了包装图时才有 photos 键', 'photos' in withPhotos, JSON.stringify(withPhotos.photos))
    eq('落库前真收敛一次：临时路径丢掉、重复去掉 → 2 张', (withPhotos.photos || []).length, 2)
    check(
      '落库内容里没有任何本机临时路径（注入 keep-local-temp-path 在此被检出）',
      (withPhotos.photos || []).every((u) => !/^wxfile:\/\/|^https?:\/\/tmp\//i.test(u)),
      JSON.stringify(withPhotos.photos)
    )

    const baseKeys = Object.keys(without).sort()
    const withKeys = Object.keys(withPhotos).sort()
    eq(
      '传图相对不传图**只多** photos 一个键',
      JSON.stringify(withKeys.filter((k) => !baseKeys.includes(k))),
      JSON.stringify(['photos'])
    )
    eq('传图不会少任何已有键', JSON.stringify(baseKeys.filter((k) => !withKeys.includes(k))), '[]')
    const diffs = baseKeys.filter((k) => JSON.stringify(without[k]) !== JSON.stringify(withPhotos[k]))
    eq('除 photos 外两种情形逐字段相同', JSON.stringify(diffs), '[]')
    check(
      '不传图时 content 与传图时逐字节相同（图不进正文）',
      without.content === withPhotos.content,
      `${without.content.length} vs ${withPhotos.content.length}`
    )
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/* ── 判据 ─────────────────────────────────────────────────────────────────── */

const PHOTO_A = 'cloud://env.abc/ship-pack/a.png'
const PHOTO_B = 'cloud://env.abc/ship-pack/b.png'

/** 读常量数值声明（`const X = 6`）—— 用于钉住四个消费点的上限一致 */
function readConstNumber(src, name) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)`).exec(src)
  return m ? Number(m[1]) : NaN
}

/**
 * 从真源码里切出「带某个 class 的那个元素」的完整标签块（按标签配平扫描）。
 * 用途：把渲染断言收窄到本次改动的那一块，同时**不引入手抄件**
 * （手抄件会静默漂移 —— 错题本 E3 / lib/wxml-preview.mjs 的头注）。
 */
function extractElementByClass(src, className) {
  const at = src.indexOf(className)
  if (at < 0) return ''
  const open = src.lastIndexOf('<', at)
  if (open < 0) return ''
  const tagMatch = /^<([a-zA-Z-]+)/.exec(src.slice(open))
  if (!tagMatch) return ''
  const tag = tagMatch[1]
  const openEnd = src.indexOf('>', at)
  if (openEnd < 0) return ''
  if (src.slice(open, openEnd + 1).endsWith('/>')) return src.slice(open, openEnd + 1)
  const re = new RegExp(`<${tag}\\b|</${tag}>`, 'g')
  re.lastIndex = open
  let depth = 0
  let m
  while ((m = re.exec(src))) {
    if (m[0][1] === '/') {
      depth -= 1
      if (depth === 0) return src.slice(open, m.index + m[0].length)
    } else {
      depth += 1
    }
  }
  return ''
}

/** ② 归一化口径：上限/去重/丢本机临时路径（两侧同一份口径） */
function assertNormalizerParity() {
  const normalizer = loadCjs('miniprogram/cloudfunctions/dispatchMessage/orderSummary.js')
  const helper = loadCjs('miniprogram/utils/messageHelper.js')
  // 渲染态转换的真源（前端 messageHelper 内部用的就是它）
  const helperImageUrl = loadCjs('miniprogram/utils/imageUrl.js')

  const dirty = [
    PHOTO_A,
    { url: 'https://cdn.example.com/b.jpg' },
    { fileID: PHOTO_B },
    'wxfile://tmp/local.png',
    'http://tmp/local2.png',
    'https://tmp/should-also-be-dropped.png',
    '/local/abs.png',
    PHOTO_A,
    null,
    {}
  ]
  const cloud = normalizer.pickPackagePhotos(dirty)
  const front = helper.normalizePackagePhotos(dirty)
  eq('云端归一化：脏输入 → 3 张', cloud.length, 3)
  eq('前端归一化：脏输入 → 3 张', front.length, 3)
  // 两侧口径必须一致：**同序同项**，前端只多做一步渲染态转换（cloud fileID → https）。
  // 为什么不能直接比字符串：`<image src="cloud://…">` 真机**渲染不出来**（见 utils/imageUrl.js），
  // 所以渲染态必然与落库态不同形 —— 但**顺序与项数**必须一致，否则就是两条口径。
  check(
    '内联的 cloudIdToHttps 与 utils/imageUrl 的同名实现同口径（防两份漂移）',
    [PHOTO_A, 'https://cdn.example.com/x.png', '', null, 'cloud://broken', 'wxfile://t.png']
      .every((u) => helper.cloudFileIdToHttps(u) === helperImageUrl.cloudIdToHttps(u)),
    JSON.stringify([PHOTO_A, 'cloud://broken'].map((u) => [helper.cloudFileIdToHttps(u), helperImageUrl.cloudIdToHttps(u)]))
  )
  const expectFront = cloud.map((u) => helperImageUrl.cloudIdToHttps(u))
  eq('前端 = 云端归一化结果逐项做渲染态转换（同序同项）', JSON.stringify(front), JSON.stringify(expectFront))
  check(
    '渲染态里**没有** cloud:// 残留（真机上会渲染成空白）',
    front.every((u) => u.indexOf('cloud://') !== 0) && front.length > 0,
    JSON.stringify(front)
  )
  check(
    'cloud fileID 真的被换成了 https（不是原样返回）',
    front.every((u) => /^https:\/\//.test(u)),
    JSON.stringify(front)
  )
  eq('本机临时路径被丢弃（含 https://tmp/ 这种"看着合法"的）', cloud.filter((u) => /tmp|wxfile/.test(u)).length, 0)
  eq('空输入 → 空数组（前端据此零渲染）', normalizer.pickPackagePhotos(undefined).length, 0)

  const many = Array.from({ length: 6 + 4 }, (_, i) => `cloud://env.abc/p${i}.png`)
  eq('超过上限被截断', normalizer.pickPackagePhotos(many).length, 6)
  eq('前端上限与云端一致', helper.MAX_PACKAGE_PHOTOS, 6)
  eq('canonical 导出的上限常量', normalizer.DEFAULT_MAX_PHOTOS, 6)
}

/** ③ 上限常量在四个消费点必须一致（防「前端让选 6 张、云端只留 3 张」的静默缩水） */
function assertMaxParity() {
  const cfg = read('miniprogram/subpackages/manager/manager/managerPageConfig.js')
  const erp = read('admin/src/components/Orders.vue')
  const canonical = read('miniprogram/cloudfunctions/dispatchMessage/orderSummary.js')
  const helper = read('miniprogram/utils/messageHelper.js')

  const values = {
    'orderSummary.DEFAULT_MAX_PHOTOS': readConstNumber(canonical, 'DEFAULT_MAX_PHOTOS'),
    'messageHelper.MAX_PACKAGE_PHOTOS': readConstNumber(helper, 'MAX_PACKAGE_PHOTOS'),
    'managerPageConfig.SHIP_PHOTO_MAX': readConstNumber(cfg, 'SHIP_PHOTO_MAX'),
    'Orders.vue.SHIP_PHOTO_MAX': readConstNumber(erp, 'SHIP_PHOTO_MAX')
  }
  const uniq = Array.from(new Set(Object.values(values)))
  eq('四处上限常量取值一致', uniq.length, 1)
  eq('上限 = 6', uniq[0], 6)
}

/** ④ 随信发出：两个云函数的调用点都必须真的带上图片 */
function assertCarriedIntoMessage() {
  const ship = read('miniprogram/cloudfunctions/managerShipOrder/index.js')
  const mw = read('miniprogram/cloudfunctions/managerShipOrder/messageWrite.js')
  const core = read('miniprogram/cloudfunctions/dispatchMessage/core.js')
  const dmIndex = read('miniprogram/cloudfunctions/dispatchMessage/index.js')

  check('发货侧归一化 packagePhotos', /const photos = pickPackagePhotos\(packagePhotos\)/.test(ship))
  check('发货侧把 photos 放进信件 vars', /photos\s*\n?\s*\}/.test(ship) || ship.includes('photos'))
  eq('发货侧 dispatchInAppMessage 传 photos 的次数（买家 + 受赠人）', (ship.match(/^\s+photos,$/gm) || []).length, 2)
  check('messageWrite 主路径把 photos 交给 dispatchMessage', /photos: vars\.photos/.test(mw))
  check('messageWrite 顶层透传 photos', /action: 'dispatch'[\s\S]{0,400}photos/.test(mw))
  check(
    'dispatchMessage index 把 photos 传进 dispatch',
    /campaignId,[\s\S]{0,200}?photos\s*\n\s*\}\)/.test(dmIndex)
  )
  check('dispatch 归一化并落库 photos', /const messagePhotos = pickPackagePhotos/.test(core) && /photos: messagePhotos/.test(core))

  // 敏感发货 → 审批流：payload 必须带上图片，执行侧必须回传
  const approvals = read('miniprogram/cloudfunctions/manageApprovals/index.js')
  check('审批 payload 带上 packagePhotos', /packagePhotos: photos/.test(ship))
  check('审批执行侧回传 packagePhotos', /packagePhotos: payload\.packagePhotos/.test(approvals))
}

/** ⑤ 两个发货面都能上传（小程序超管工作台 + ERP），且不新增原生弹窗 */
function assertShipSurfaces() {
  const cfg = read('miniprogram/subpackages/manager/manager/managerPageConfig.js')
  const view = read('miniprogram/subpackages/manager/manager/workspace/_subviews.wxml')
  const erp = read('admin/src/components/Orders.vue')

  check('小程序端有选图入口', /chooseShipPhotos\(\)/.test(cfg) && /catchtap="chooseShipPhotos"/.test(view))
  check('小程序端有移除入口', /removeShipPhoto\(e\)/.test(cfg) && /catchtap="removeShipPhoto"/.test(view))
  check('小程序端提交时才上传（不在选图时占云存储）', /async uploadShipPhotos\(\)/.test(cfg))
  // 上传失败必须**落到可见状态**（错题本 E14：失败只重试不报错 = 界面静默空白）。
  // 判据用「赋值锚点 + 该行有中文错误文案」，不整串比对文案 ——
  // 文案随时会被润色，整串比对会让守卫在无害改动下假红（错题本 E7）。
  const assignAt = cfg.indexOf("'tempShip.packagePhotoError': '")
  const assignLine = assignAt < 0 ? '' : cfg.slice(assignAt, cfg.indexOf('\n', assignAt))
  check('小程序端上传失败落到内联错误文案', assignAt >= 0 && /[\u4e00-\u9fa5]/.test(assignLine), assignLine.trim())
  check(
    '该内联提示不靠新增原生弹窗（棘轮只许降不许涨）',
    !/wx\.showModal\(/.test(cfg.slice(Math.max(0, assignAt - 400), assignAt + 200))
  )
  check('上传失败不会继续发货（防止静默丢图）', /if \(packagePhotos\.length\) shipPayload\.packagePhotos/.test(cfg))
  check(
    '没选图时不带 packagePhotos 字段（只在有图时才挂字段）',
    /if \(packagePhotos\.length\) shipPayload\.packagePhotos = packagePhotos;\n\s*const res = await wx\.cloud\.callFunction/.test(cfg)
  )
  check('ERP 端有上传入口', /handleShipPhotoUpload/.test(erp) && /shipForm\.packagePhotos/.test(erp))
  check('ERP 上传走统一的 uploadAdminBinary（不另造上传实现）', /uploadAdminBinary\(opt\.file, 'ship-pack'\)/.test(erp))
  check('ERP 没图时也不带 packagePhotos 字段', /if \(photoIds\.length\) payload\.packagePhotos = photoIds/.test(erp))
}

/** ⑥ 顾客侧真渲染：**真解析 detail/index.wxml**，数出真实产出的图片元素 */
function assertCustomerCanSeePhotos() {
  const wxml = read('miniprogram/subpackages/extra/user/messages/detail/index.wxml')
  const helper = loadCjs('miniprogram/utils/messageHelper.js')
  const messageHelperImageUrl = loadCjs('miniprogram/utils/imageUrl.js')

  const base = {
    _id: 'm1',
    type: 'order_shipped',
    category: 'order',
    title: '标本已启程',
    content: '这件标本已启程。',
    products: [],
    actionUrl: 'subpackages/business/order-detail/index?id=order-1',
    read: true,
    createTime: new Date('2026-09-21T10:00:00Z')
  }

  const withPhotos = helper.enrichMessage({ ...base, photos: [PHOTO_A, PHOTO_B] })
  const withoutPhotos = helper.enrichMessage({ ...base })
  const legacy = helper.enrichMessage({ ...base, photos: undefined }) // 存量消息：没有这个键

  eq('传图 → hasPackagePhotos = true', withPhotos.hasPackagePhotos, true)
  eq('不传图 → hasPackagePhotos = false', withoutPhotos.hasPackagePhotos, false)
  eq('存量消息（无该键）→ hasPackagePhotos = false', legacy.hasPackagePhotos, false)

  // 页面级字段要齐（`digestView` 由 index.js 的 data 提供默认 null）：
  // 渲染器会求值 `wx:if` 为假的分支里的插值，缺字段会**抛错**（它的既有行为）。
  const detailData = (msg) => ({
    selectedMessage: msg,
    scrollStyle: '',
    entered: true,
    loadError: false,
    digestView: null
  })
  const renderWith = renderWxml(wxml, detailData(withPhotos))
  const renderWithout = renderWxml(wxml, detailData(withoutPhotos))
  const renderLegacy = renderWxml(wxml, detailData(legacy))

  const countImgs = (html) => (html.match(/<img\b/g) || []).length
  const nWith = countImgs(renderWith)
  const nWithout = countImgs(renderWithout)

  check('真渲染：传 2 张 → 信里出现 2 个图片元素', nWith === 2, `实际 ${nWith}`)
  // 断言渲染态是 **https**（不是 cloud://）—— 这正是「真机上图片不会空白」的那条判据；
  // 断言原 fileID 会假红（前端已按 utils/imageUrl 把它换成 https 了）。
  const httpsA = messageHelperImageUrl.cloudIdToHttps(PHOTO_A)
  const httpsB = messageHelperImageUrl.cloudIdToHttps(PHOTO_B)
  check('真渲染：两张图都以 https 地址出现在信里（真机可渲染）', renderWith.includes(httpsA) && renderWith.includes(httpsB),
    `httpsA=${httpsA}`)
  check('真渲染：渲染态里没有 cloud:// 残留（真机空白图的根因）', !renderWith.includes('cloud://'))
  check('真渲染：不传图 → 一个图片元素都没有', nWithout === 0, `实际 ${nWithout}`)
  check('真渲染：存量消息渲染结果与「不传图」逐字节相同', renderWithout === renderLegacy)
  check('真渲染：没图时连「包装实拍」标题都不出现', !renderWithout.includes('包装实拍') && !renderLegacy.includes('包装实拍'))

  // 列表页也给线索：不然顾客不会点进信里看图。
  // ⚠️ 这里**只渲染「照片线索」那一块**，不是整页 —— 整页要 20+ 个列表级字段
  // （unreadCount / activeQueue / tabs…），任何一条与本需求无关的模板改动都会让守卫假红。
  // 切出真源码里的那一块仍是**真源码**（不是手抄件），只是把断言面收窄到本次改动。
  const listWxml = read('miniprogram/subpackages/extra/user/messages/index.wxml')
  const hintBlock = extractElementByClass(listWxml, 'message-photos-hint')
  check('列表页存在照片线索元素（真源码）', !!hintBlock)
  const listWith = renderWxml(hintBlock, { item: withPhotos })
  check('真渲染：列表页出现「随信附包装实拍」线索', listWith.includes('随信附包装实拍'))
  const listWithout = renderWxml(hintBlock, { item: withoutPhotos })
  const listLegacy = renderWxml(hintBlock, { item: legacy })
  check('真渲染：列表页没图时不出现该线索', !listWithout.includes('随信附包装实拍'))
  check('真渲染：列表页存量消息与没图逐字节相同', listWithout === listLegacy)

  // 图能点开放大（细节是包装实拍的全部价值）
  const detailJs = read('miniprogram/subpackages/extra/user/messages/detail/index.js')
  check('点击图片走 wx.previewImage 放大', /previewPackagePhoto\(e\)/.test(detailJs) && /wx\.previewImage\(\{/.test(detailJs))
}

/** ⑦ 订单文档：只在真的传了图时才落字段（需求 4） */
/**
 * 订单详情页也要能看到包装实拍（蓝图 §7 登记为「未做，待集成官收口补」——已补）。
 * ⚠️ 关键不是"页面上有这一块"，而是**图片经过 https 转换**：
 *    订单文档里存的是 `cloud://` fileID，真机 `<image>` 渲染不出来（空白图）。
 */
function assertOrderDetailShowsPhotos() {
  const wxml = read('miniprogram/subpackages/business/order-detail/index.wxml')
  const js = read('miniprogram/subpackages/business/order-detail/index.js')
  check('订单详情页画了包装实拍（order.packagePhotos）',
    /order\.packagePhotos/.test(wxml) && /pack-section/.test(wxml))
  check('订单详情页把 fileID 换成了 https（不然真机是空白图）',
    /cloudIdToHttps/.test(js) && /packagePhotos/.test(js) && /cloudIdToHttps\(String\(u/.test(js))
  check('订单详情页的图片可放大（previewImage）',
    /previewPackagePhoto/.test(wxml) && /wx\.previewImage/.test(js))
}

function assertOrderFieldConditional() {
  const ship = read('miniprogram/cloudfunctions/managerShipOrder/index.js')
  check('订单文档只在有图时写 packagePhotos', /if \(photos\.length\) shipPatch\.packagePhotos = photos/.test(ship))
  check('订单写入在发货 patch 里（与 status=shipped 同一次写）', /shipPatch = \{[\s\S]{0,200}status: 'shipped'/.test(ship))
}

/** ⑧ 字段登记：orders.packagePhotos 已写进 schema 文档 */
function assertSchemaRegistered() {
  const schema = read('cloudbase/schema/orders.md')
  check('orders schema 登记了 packagePhotos', /packagePhotos/.test(schema))
  const collections = read('docs/cloudbase-collections.md')
  check('集合文档登记了 user_messages.photos', /photos: string\[\]/.test(collections))
}

async function runAll() {
  await assertOptionalContract()
  assertNormalizerParity()
  assertMaxParity()
  assertCarriedIntoMessage()
  assertShipSurfaces()
  assertCustomerCanSeePhotos()
  assertOrderDetailShowsPhotos()
  assertOrderFieldConditional()
  assertSchemaRegistered()
}

/* ── --selftest：每条注入都是一处**真实可能写错**的改动 ──────────────────── */
const INJECTIONS = [
  {
    // 订单详情页退回"只渲染 fileID"（真机就是空白图 —— 这条正是本任务最容易犯的假交付）
    label: 'order-detail-raw-fileid',
    file: 'miniprogram/subpackages/business/order-detail/index.js',
    from: "        .map((u) => cloudIdToHttps(String(u || '')))",
    to: "        .map((u) => String(u || ''))"
  },
  {
    // 需求 1 的反面：不传图也落一个空 photos 字段 → 存量消息与「没传图」在文档层面不再等价
    label: 'photos-always-written',
    file: 'miniprogram/cloudfunctions/managerShipOrder/messageWrite.js',
    from: '  const safePhotos = pickPackagePhotos(photos)\n  if (safePhotos.length) data.photos = safePhotos',
    to: '  const safePhotos = pickPackagePhotos(photos)\n  data.photos = safePhotos'
  },
  {
    // 「不传时行为完全一致」的反面：往正文里塞一行图片说明 → content 变了
    label: 'content-drifts-with-photos',
    file: 'miniprogram/cloudfunctions/managerShipOrder/messageWrite.js',
    from: "    content: content || '',\n    relatedId: relatedId || '',",
    to: "    content: (content || '') + (safePhotos.length ? '\\n附包装图' : ''),\n    relatedId: relatedId || '',"
  },
  {
    // 假交付的典型形态：字段落库了，但页面**根本不画**
    label: 'not-rendered-in-letter',
    file: 'miniprogram/subpackages/extra/user/messages/detail/index.wxml',
    from: 'class="letter-photos" wx:if="{{selectedMessage.hasPackagePhotos}}"',
    to: 'class="letter-photos" wx:if="{{false}}"'
  },
  {
    // 需求 4 的反面：存量消息被凭空当成「有图」（渲染出空壳区块）
    label: 'legacy-treated-as-having-photos',
    file: 'miniprogram/utils/messageHelper.js',
    from: '    hasPackagePhotos: packagePhotos.length > 0,',
    to: '    hasPackagePhotos: true,'
  },
  {
    // 本地路径不再被识别 → `wxfile://` / `http://tmp/…` 会**原样落库**，
    // 别的设备打开全是破图。判据必须能红（第一版这里因为测试数据构造不当而假绿）。
    label: 'keep-local-temp-path',
    file: 'miniprogram/cloudfunctions/dispatchMessage/orderSummary.js',
    // 这是**唯一**里外都成立的落点：`isRenderablePhotoUrl` 末尾的
    // `return s.indexOf('https://') === 0` 顺手也会挡掉 `http://`，
    // 所以只有 `https://tmp/…` 这种「看着合法、其实换设备就失效」的地址
    // 才真正依赖本机路径判定 —— 测试数据必须含它，否则这条注入永远假绿。
    from: "  if (isLocalTempPhotoPath(s)) return false",
    to: '  if (false) return false'
  },
  {
    // 少做「cloud fileID → https」这一步 → 字段/接口/守卫全绿，
    // 但真机上 `<image src="cloud://…">` 是**六个空白方块**（最典型的假交付）
    label: 'no-cloudid-to-https',
    file: 'miniprogram/utils/messageHelper.js',
    from: '    const renderable = cloudFileIdToHttps(url)',
    to: '    const renderable = url'
  },
  {
    // 前端上限与云端脱钩 → 店长选 6 张、云端静默截成 3 张
    label: 'max-out-of-sync',
    file: 'miniprogram/subpackages/manager/manager/managerPageConfig.js',
    from: 'const SHIP_PHOTO_MAX = 6;',
    to: 'const SHIP_PHOTO_MAX = 3;'
  },
  {
    // 图片没随信发出（只落了订单，信里没有）
    label: 'not-carried-into-message',
    file: 'miniprogram/cloudfunctions/managerShipOrder/index.js',
    from: '      // 顶层显式传图片：图片是**附件**不是模板变量（模板里没有 {{photo}} 可渲染）\n      photos,',
    to: '      // 顶层显式传图片：图片是**附件**不是模板变量（模板里没有 {{photo}} 可渲染）'
  },
  {
    // 敏感发货走审批时丢图
    label: 'approval-drops-photos',
    file: 'miniprogram/cloudfunctions/manageApprovals/index.js',
    from: '      packagePhotos: payload.packagePhotos,',
    to: '      packagePhotos: [],'
  },
  {
    // 没传图也写订单字段 → 破坏需求 4 的「文档层面可区分」
    label: 'order-field-unconditional',
    file: 'miniprogram/cloudfunctions/managerShipOrder/index.js',
    from: '    if (photos.length) shipPatch.packagePhotos = photos',
    to: '    shipPatch.packagePhotos = photos'
  },
  {
    // 小程序端没选图也带字段 → 云端会写空数组
    label: 'client-sends-empty',
    file: 'miniprogram/subpackages/manager/manager/managerPageConfig.js',
    from: '      if (packagePhotos.length) shipPayload.packagePhotos = packagePhotos;',
    to: '      shipPayload.packagePhotos = packagePhotos;'
  }
]

async function runSelftest() {
  let bad = 0
  for (const inj of INJECTIONS) {
    const abs = resolve(ROOT, inj.file)
    if (!existsSync(abs)) {
      console.error(`  ✗ 注入 ${inj.label}：文件不存在 ${inj.file}`)
      bad += 1
      continue
    }
    const original = readFileSync(abs, 'utf8')
    if (!original.includes(inj.from)) {
      // 锚点失效 = 这条注入**什么都证明不了**（错题本 E18-b），必须判失败
      console.error(`  ✗ 注入 ${inj.label}：锚点失效（源码已变，注入打空）`)
      bad += 1
      continue
    }
    writeFileSync(abs, original.replace(inj.from, inj.to))
    passed = 0
    failed = 0
    failures.length = 0
    let detected = false
    try {
      await runAll()
      detected = failed > 0
    } catch (e) {
      detected = true // 抛错也算检出
    } finally {
      writeFileSync(abs, original)
    }
    if (detected) console.log(`  ✓ 注入 ${inj.label} 被检出`)
    else {
      console.error(`  ✗ 注入 ${inj.label} **未被检出**（判据不会失败 = 守卫无效）`)
      bad += 1
    }
  }
  passed = 0
  failed = 0
  failures.length = 0
  await runAll()
  if (failed > 0) {
    console.error(`  ✗ 未注入时本应通过，实际失败 ${failed} 项：`)
    failures.forEach((f) => console.error(`     · ${f}`))
    bad += 1
  } else {
    console.log(`  ✓ 未注入时通过（${passed} 条判据，无假阳性）`)
  }
  if (bad) {
    console.error(`✗ check:package-photos selftest 失败 ${bad} 项`)
    process.exit(1)
  }
  console.log(`✓ selftest 通过：${INJECTIONS.length} 个回归注入全部被检出，且无假阳性`)
}

if (process.argv.includes('--selftest')) {
  await runSelftest()
  process.exit(0)
}

await runAll()
if (failed) {
  console.error(`✗ check:package-photos 失败 ${failed} 项：`)
  failures.forEach((f) => console.error(`   · ${f}`))
  process.exit(1)
}
console.log(`✓ check:package-photos 通过（${passed} 条判据）`)
