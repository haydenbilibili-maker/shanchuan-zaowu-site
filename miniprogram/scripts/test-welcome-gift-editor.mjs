/**
 * 新会员礼包编辑页（超管工作台）守卫
 *
 * 四个真机反馈对应四类静默失效：
 *   ① 「启用中 · 点此停用」文字溢出按钮 —— 长文案塞进固定高的小按钮（无 nowrap）；
 *   ② **每编辑一个字母输入框就失焦、键盘重弹** —— `wx:key` 用了**可编辑的 id**，
 *      key 一变微信就重建整行节点；key 必须是不可编辑的 `_key`；
 *   ③ 券行顺序无法编辑、新增的券被追到末尾 —— 而顺序就是顾客在各处看到的顺序；
 *   ④ 编辑能力缺校验（重复 id 会破坏「已发券条款对齐」，保存前该拦）。
 *
 * 做法：顺序/稳定 key 抽成纯模块 `couponOrder.js` 直接跑真源码；页面接线做源级断言。
 *
 * 用法：
 *   node miniprogram/scripts/test-welcome-gift-editor.mjs
 *   node miniprogram/scripts/test-welcome-gift-editor.mjs --selftest
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const ORDER = 'miniprogram/subpackages/manager/welcome-gift/couponOrder.js'
const PAGE_JS = 'miniprogram/subpackages/manager/welcome-gift/index.js'
const PAGE_WXML = 'miniprogram/subpackages/manager/welcome-gift/index.wxml'
const PAGE_WXSS = 'miniprogram/subpackages/manager/welcome-gift/index.wxss'
const ERP_ORDER = 'admin/src/utils/couponOrder.js'
const ERP_VIEW = 'admin/src/components/WelcomeGiftConfig.vue'
const ERP_UTIL = 'admin/src/utils/welcomeGift.js'

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
function eq(name, got, want) {
  check(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}
const read = (f) => readFileSync(resolve(ROOT, f), 'utf8')
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
function loadCjs(file) {
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', read(file))(module, module.exports)
  return module.exports
}

const order = loadCjs(ORDER)
// ERP 是 ESM（Vite）→ 动态 import 真源码，做跨端同口径比对
const erpOrder = await import(pathToFileURL(resolve(ROOT, ERP_ORDER)).href)
const erpView = stripComments(read(ERP_VIEW))
const erpUtil = stripComments(read(ERP_UTIL))
const pageJs = stripComments(read(PAGE_JS))
const pageWxml = read(PAGE_WXML)
const pageWxss = stripComments(read(PAGE_WXSS))

const L = (list) => list.map((c) => `${c.id}(${c.minSpend})`).join(' → ')

/* ── 1) 稳定 key（② 的根因） ─────────────────────────────────────────────── */
{
  const rows = order.ensureCouponKeys([{ id: 'a' }, { id: 'b' }])
  eq('ensureCouponKeys 给每行补 _key', rows.every((r) => !!r._key), true)
  eq('_key 互不相同', new Set(rows.map((r) => r._key)).size, 2)
  eq('再次 ensure 保留原 _key（不抖动）', order.ensureCouponKeys(rows)[0]._key, rows[0]._key)
  const stripped = order.stripCouponKeys(rows)
  eq('stripCouponKeys 去掉 _key（不上行）', stripped.every((r) => !('_key' in r)), true)
  eq('stripCouponKeys 保留业务字段', stripped[0].id, 'a')
}

/* ── 2) 顺序（③） ────────────────────────────────────────────────────────── */
const LIVE = [
  { id: 'c5', minSpend: 49, value: 5 },
  { id: 'c30', minSpend: 299, value: 30 },
  { id: 'c50', minSpend: 499, value: 50 },
  { id: 'c100', minSpend: 999, value: 100 },
  { id: 'c10', minSpend: 99, value: 10 }
]
eq('★ 一键按门槛排序 = 满49→99→299→499→999',
  L(order.sortCouponsByThreshold(LIVE)), 'c5(49) → c10(99) → c30(299) → c50(499) → c100(999)')
eq('★ 新增的 99-10 恰好排在第二位',
  L(order.insertCouponByThreshold(LIVE.slice(0, 4), { id: 'c10', minSpend: 99, value: 10 })),
  'c5(49) → c10(99) → c30(299) → c50(499) → c100(999)')
eq('门槛最小 → 插到最前', L(order.insertCouponByThreshold(LIVE.slice(0, 4), { id: 'x', minSpend: 1 }))[0], 'x')
eq('门槛最大 → 追加到最后',
  L(order.insertCouponByThreshold(LIVE.slice(0, 4), { id: 'z', minSpend: 9999 })).endsWith('z(9999)'), true)
eq('排序稳定：同门槛按面额升序',
  L(order.sortCouponsByThreshold([{ id: 'a', minSpend: 99, value: 30 }, { id: 'b', minSpend: 99, value: 10 }])),
  'b(99) → a(99)')
eq('上移一行', L(order.moveCoupon(LIVE, 2, 1)).split(' → ')[1], 'c50(499)')
eq('下移一行', L(order.moveCoupon(LIVE, 0, 1)).split(' → ')[0], 'c30(299)')
eq('越界原样（上移第一行）', L(order.moveCoupon(LIVE, 0, -1)), L(LIVE))
eq('越界原样（下移最后一行）', L(order.moveCoupon(LIVE, 4, 5)), L(LIVE))
eq('原数组不被就地修改', LIVE.map((c) => c.id).join(','), 'c5,c30,c50,c100,c10')

/* ── 3) 页面接线 ─────────────────────────────────────────────────────────── */
check('★ wx:key 用不可编辑的 _key（不是可编辑的 id）',
  /wx:key="_key"/.test(pageWxml) && !/wx:key="id"/.test(pageWxml),
  'key 用了可编辑字段 → 改一个字符整行重建、输入框失焦、键盘重弹')
check('★ 加载配置时给券行补稳定 key', /coupons: ensureCouponKeys\(/.test(pageJs))
check('★ 保存前剥掉 _key（不上行）', /coupons: stripCouponKeys\(this\.data\.form\.coupons\)/.test(pageJs))
check('★ 有上移/下移与一键排序（顺序可编辑）',
  /moveCouponUp\(e\)/.test(pageJs) && /moveCouponDown\(e\)/.test(pageJs) && /sortCoupons\(\)/.test(pageJs)
  && /bindtap="moveCouponUp"/.test(pageWxml) && /bindtap="moveCouponDown"/.test(pageWxml)
  && /bindtap="sortCoupons"/.test(pageWxml))
check('★ 新增券按门槛插位（不再一律追加到末尾）',
  /insertCouponByThreshold\(this\.data\.form\.coupons, row\)/.test(pageJs))
check('★ 启用开关改 switch（长文案按钮会溢出）',
  /class="field switch-field"/.test(pageWxml) && /<switch[^>]*bindchange="onCouponEnable"/.test(pageWxml))
check('★ 溢出按钮的长文案已消失', !/点此停用|点此启用/.test(pageWxml + pageJs),
  '「启用中 · 点此停用」又回来了 → 文字会溢出按钮')
check('★ 开关读 e.detail.value（而不是取反）', /onCouponEnable\(e\)[\s\S]{0,120}e\.detail && e\.detail\.value/.test(pageJs))
check('★ 保存前拦重复 id（会破坏已发券条款对齐）', /券 id「\$\{dupIds\}」重复/.test(read(PAGE_JS)),
  '缺少重复 id 拦截')
// 地板：按**行为**测（纯函数），源码层只确认页面调的是它
eq('★ 满49减5 合规', order.findFloorViolations([{ minSpend: 49, value: 5 }]).length, 0)
eq('★ 满99减10 合规', order.findFloorViolations([{ minSpend: 99, value: 10 }]).length, 0)
eq('★ 满30减10 违规且给出所需门槛',
  JSON.stringify(order.findFloorViolations([{ minSpend: 30, value: 10 }]).map((v) => v.need)), '[40]')
eq('停用行不参与拦截', order.findFloorViolations([{ minSpend: 1, value: 10, enabled: false }]).length, 0)
eq('零面额行不参与拦截', order.findFloorViolations([{ minSpend: 0, value: 0 }]).length, 0)
eq('多行时给出正确行号',
  JSON.stringify(order.findFloorViolations([{ minSpend: 49, value: 5 }, { minSpend: 10, value: 30 }]).map((v) => v.index)),
  '[1]')
check('★ 页面保存前调用共享地板检测并指出行号',
  /findFloorViolations\(this\.data\.form\.coupons, 0\.25\)/.test(pageJs) && /门槛过低（满/.test(read(PAGE_JS)),
  '缺少地板前置拦截 → 运营只会看到「保存失败」')
check('地板口径与云函数同源（0.25）',
  /0\.25/.test(read('miniprogram/cloudfunctions/manageWelcomeGift/couponDiscountRules.js')),
  '云函数侧地板常量不是 0.25？请核对 check:coupon-floor')
check('★ 会溢出的 .toggle 死样式已清', !/\.toggle\b/.test(pageWxss))
check('顾客视角预览存在（与发放/预览同口径）', /class="coupon-preview"/.test(pageWxml))

/* ── 4) ERP 端（同一套规则，两边必须同口径） ─────────────────────────────── */
{
  const a = order.sortCouponsByThreshold(LIVE).map((c) => c.id).join(',')
  const b = erpOrder.sortCouponsByThreshold(LIVE).map((c) => c.id).join(',')
  eq('★ ERP ↔ 小程序：按门槛排序结果一致', b, a)
  eq('★ ERP ↔ 小程序：新增插位结果一致',
    erpOrder.insertCouponByThreshold(LIVE.slice(0, 4), { id: 'c10', minSpend: 99, value: 10 }).map((c) => c.id).join(','),
    order.insertCouponByThreshold(LIVE.slice(0, 4), { id: 'c10', minSpend: 99, value: 10 }).map((c) => c.id).join(','))
  eq('★ ERP ↔ 小程序：上移结果一致',
    erpOrder.moveCoupon(LIVE, 2, 1).map((c) => c.id).join(','), order.moveCoupon(LIVE, 2, 1).map((c) => c.id).join(','))
  eq('ERP ↔ 小程序：越界行为一致',
    erpOrder.moveCoupon(LIVE, 4, 5).map((c) => c.id).join(','), order.moveCoupon(LIVE, 4, 5).map((c) => c.id).join(','))
  const erpKeys = erpOrder.ensureCouponKeys([{ id: 'a' }, { id: 'b' }])
  eq('ERP：_key 唯一', new Set(erpKeys.map((r) => r._key)).size, 2)
  eq('ERP：strip 后不含 _key', erpOrder.stripCouponKeys(erpKeys).every((r) => !('_key' in r)), true)

  check('★ ERP 表格用 row-key="_key"（顺序可编辑需要稳定 key）',
    /row-key="_key"/.test(erpView), 'ERP 表格没有稳定 row-key → 重排后行会串')
  check('★ ERP 有上移/下移/按门槛排序（顺序可编辑）',
    /moveCouponUp\(index\)/.test(erpView) && /moveCouponDown\(index\)/.test(erpView) && /sortCoupons\(\)/.test(erpView)
    && /@click="moveCouponUp\(\$index\)"/.test(erpView) && /@click="sortCoupons"/.test(erpView))
  check('★ ERP 新增券按门槛插位（不再一律 push 到末尾）',
    /insertCouponByThreshold\(form\.coupons, row\)/.test(erpView) && !/form\.coupons\.push\(/.test(erpView))
  check('★ ERP 保存前剥掉 _key', /coupons: stripCouponKeys\(form\.coupons\)/.test(erpView))
  check('★ ERP 保存前拦重复 id（并指出行号）', /与前面重复/.test(read(ERP_VIEW)))
  check('★ ERP 地板校验带行号（单一出处仍是 welcomeGift.js）',
    /index: i, value, minSpend/.test(erpUtil) && /couponCheck\.index/.test(erpView),
    '地板校验没带行号 → 两端提示口径不一致')
  check('ERP 有顾客视角预览列', /class="coupon-preview"/.test(erpView))
  check('ERP 订单顺序说明存在', /class="coupon-order-hint"/.test(erpView))
}

/* ── 输出 / 自检 ─────────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  selftest()
} else if (failed) {
  console.log('✗ 新会员礼包编辑页检查失败：')
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`✗ ${failed} 项失败 / ${passed} 项通过`)
  process.exit(1)
} else {
  console.log(`✓ 新会员礼包编辑页：${passed} 项通过（稳定 key 防失焦 / 顺序可编辑且 99-10 第二位 / 开关不再溢出 / 重复 id 拦截）`)
}

function selftest() {
  const injections = [
    {
      name: 'wx:key 退回可编辑的 id（输入框又会失焦）',
      file: PAGE_WXML,
      from: 'wx:key="_key"',
      to: 'wx:key="id"'
    },
    {
      name: '排序改成不动（顺序无法整理）',
      file: ORDER,
      from: '    .map((c, i) => ({ c, i }))\n    .sort((a, b) => {',
      to: '    .map((c, i) => ({ c, i }))\n    .sort(() => 0) || [].concat(\n    (a, b) => {'
    },
    {
      name: '新增券退回「一律追加到末尾」',
      file: ORDER,
      from: '  let at = list.length\n  for (let i = 0; i < list.length; i += 1) {',
      to: '  let at = list.length\n  for (let i = 0; i < 0; i += 1) {'
    },
    {
      name: '保存时不再剥 _key（脏字段上行）',
      file: PAGE_JS,
      from: '          coupons: stripCouponKeys(this.data.form.coupons)',
      to: '          coupons: this.data.form.coupons'
    },
    {
      name: '溢出按钮的长文案又回来',
      file: PAGE_WXML,
      from: '            <text class="field-label">启用</text>',
      to: '            <text class="field-label">启用中 · 点此停用</text>'
    },
    {
      name: '地板检测永远返回空（违规也不再拦）',
      file: ORDER,
      from: '  const out = []\n  ;(coupons || []).forEach((row, index) => {',
      to: '  const out = []\n  if (out) return out\n  ;(coupons || []).forEach((row, index) => {'
    },
    {
      name: '页面不再调用共享地板检测',
      file: PAGE_JS,
      from: '    const floorBad = findFloorViolations(this.data.form.coupons, 0.25)',
      to: '    const floorBad = []'
    },
    {
      name: 'ERP 表格丢掉稳定 row-key',
      file: ERP_VIEW,
      from: '            row-key="_key"\n',
      to: ''
    },
    {
      name: 'ERP 又退回「一律 push 到末尾」',
      file: ERP_VIEW,
      from: '  form.coupons = insertCouponByThreshold(form.coupons, row)',
      to: '  form.coupons.push(row)'
    },
    {
      name: 'ERP 保存时不再剥 _key',
      file: ERP_VIEW,
      from: '      config: { ...form, coupons: stripCouponKeys(form.coupons) }',
      to: '      config: { ...form }'
    },
    {
      name: 'ERP 地板校验丢掉行号',
      file: ERP_UTIL,
      from: '    if (!check.ok) return { ...check, index: i, value, minSpend }',
      to: '    if (!check.ok) return check'
    },
    {
      name: '重复 id 拦截被摘掉',
      file: PAGE_JS,
      from: "      wx.showToast({ title: `券 id「${dupIds}」重复：请改成唯一值（已发券靠它对齐条款）`, icon: 'none', duration: 3200 })",
      to: "      void dupIds"
    }
  ]
  let bad = 0
  for (const inj of injections) {
    const abs = resolve(ROOT, inj.file)
    const orig = readFileSync(abs, 'utf8')
    const hits = orig.split(inj.from).length - 1
    if (hits !== 1) {
      console.log(`✗ 锚点不唯一（命中 ${hits} 次）：${inj.name}`)
      bad += 1
      continue
    }
    writeFileSync(abs, orig.replace(inj.from, inj.to))
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
    writeFileSync(abs, orig)
    if (readFileSync(abs, 'utf8') !== orig) {
      console.log(`✗ 未能逐字还原：${inj.file}`)
      bad += 1
      continue
    }
    if (r.status === 0) {
      console.log(`✗ 注入回归未被检出：${inj.name}`)
      bad += 1
    } else {
      console.log(`  ✓ 已检出：${inj.name}`)
    }
  }
  if (bad) {
    console.log(`✗ 自检失败：${bad} 项`)
    process.exit(1)
  }
  console.log(`✓ 自检通过：${injections.length} 条注入全部被检出、源文件逐字还原`)
}
