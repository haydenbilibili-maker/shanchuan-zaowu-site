#!/usr/bin/env node
/**
 * 飞书同步**映射层**守卫（纯函数，不联网、不写库）
 *
 * 为什么需要：飞书同步的映射原先**只存在于 ERP 前端**（`admin/src/utils/feishuSync.js`）。
 * 服务端同步（`syncFeishuData`）必须复用同一套语义 —— 若两边对同一列的解析不同
 * （一个把空当 0、一个把空当 ''；一个把日期当毫秒、一个当文本），
 * 结果是**同一张飞书表同步出两种行**，而且不报错。
 * 本守卫钉住三件事：
 *   ① 默认表定义与 ERP `defaultFeishuConfig()` **逐字一致**（表 id 与关键列名）；
 *   ② 单元格解析规则（数字/日期/富文本/空）与 ERP 同口径；
 *   ③ 写库载荷的字段名与既有 `upsertFromFeishu` 端点**对齐**（改名会让写入静默丢字段）。
 *
 * 证不了什么：不校验飞书线上表结构（那要凭据+联网，属 `syncFeishuData --status` 的活）。
 *
 * 用法：
 *   node miniprogram/scripts/test-feishu-sync.mjs
 *   node miniprogram/scripts/test-feishu-sync.mjs --selftest
 */
import { createRequire } from 'node:module'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const SRC = join(ROOT, 'miniprogram/cloudfunctions/syncFeishuData/syncMapping.js')

let passes = 0
let failures = []
function ok (label, cond, detail) {
  if (cond) { passes += 1 } else { failures.push(`${label}${detail === undefined ? '' : ' —— ' + detail}`) }
}
function eq (label, got, want) {
  ok(label, JSON.stringify(got) === JSON.stringify(want), `期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`)
}

function runOnce (file) {
  passes = 0
  failures = []
  delete require.cache[require.resolve(file)]
  const M = require(file)

  // ── A. 默认表定义与 ERP 一致（表 id + 关键列名）──
  eq('A1 采购表 id', M.DEFAULT_TABLES.purchase.tableId, 'tblMHhGXhpmGTiI5')
  eq('A2 成品库存表 id', M.DEFAULT_TABLES.inventory.tableId, 'tblh9wqtrQmZgRO5')
  eq('A3 原材料表 id', M.DEFAULT_TABLES.rawInventory.tableId, 'tblekBh0CRPMa7ie')
  eq('A4 采购：数量列名', M.DEFAULT_TABLES.purchase.fields.qty, '数量')
  eq('A5 原材料：当前库存列名', M.DEFAULT_TABLES.rawInventory.fields.qty, '当前库存')
  eq('A6 原材料：物品名称列名', M.DEFAULT_TABLES.rawInventory.fields.itemName, '物品名称')
  eq('A7 采购字段数（与 ERP 18 个对齐）', Object.keys(M.DEFAULT_TABLES.purchase.fields).length, 18)
  eq('A8 原材料字段数（12 个）', Object.keys(M.DEFAULT_TABLES.rawInventory.fields).length, 12)
  /**
   * A9–A11 **成品库存的列名必须与飞书表实际列一致**（2026-09-19 我在这里犯过错）：
   * 我照着 rawInventory 的形状"猜"了 `规格型号/当前库存/日期`，而飞书成品库存表的真实列是
   * `规格装裱/数量/盘点日期` —— 猜错的后果不是报错，而是**整列同步成空**（静默丢数据）。
   * 这三条断言就是钉住这个具体错误，代价只有三行。
   */
  eq('A9 成品：装裱列名（真实是「规格装裱」不是「规格型号」）', M.DEFAULT_TABLES.inventory.fields.framingSpec, '规格装裱')
  eq('A10 成品：数量列名（真实是「数量」不是「当前库存」）', M.DEFAULT_TABLES.inventory.fields.qty, '数量')
  eq('A11 成品：日期列名（真实是「盘点日期」不是「日期」）', M.DEFAULT_TABLES.inventory.fields.date, '盘点日期')

  // ── B. 单元格解析（与 ERP 同口径）──
  eq('B1 数字列带 ¥ 与千分位也能解析', M.cellNumber('¥1,234.5'), 1234.5)
  eq('B2 空值数字 → 0（不返回 null，否则会写进 undefined）', M.cellNumber(''), 0)
  eq('B3 非数字 → 0', M.cellNumber('面议'), 0)
  eq('B4 富文本数组 → 拼接文本', M.cellText([{ text: '爱神' }, { text: '凤蝶' }]), '爱神凤蝶')
  eq('B5 人员/关联对象 → 取 name', M.cellText({ name: '张三' }), '张三')
  eq('B6 毫秒时间戳 → YYYY-MM-DD', M.cellDate(1789813346891), '2026-09-19')
  // ⚠️ 10 位**秒**时间戳也必须对：飞书有的列返回秒、有的返回毫秒，
  //    只按毫秒算会得到 1970 年（静默写错日期）。第一版断言只测了毫秒 → 注入漏检。
  eq('B6b 秒时间戳（10 位）→ 同一天', M.cellDate(1789813346), '2026-09-19')
  eq('B7 文本日期 → 归一', M.cellDate('2026/9/1'), '2026-09-01')
  eq('B8 空日期 → 空串', M.cellDate(''), '')

  // ── C. 取列名：精确优先，宽松匹配只在唯一命中时用 ──
  eq('C1 精确命中', M.pickField({ 数量: 3 }, '数量'), 3)
  eq('C2 列名带空格也能命中', M.pickField({ ' 数量 ': 4 }, '数量'), 4)
  eq('C3 多个近似列时不猜（返回 undefined）', M.pickField({ '单价（元）': 1, '单价（分）': 2 }, '单价'), undefined)
  // ⚠️ 真正能触发「宽松分支」的是**trim 后相同但字面不同**的列（飞书列名带空格很常见）。
  //    第一版用了「单价（元）/单价（分）」，trim 后都不等于「单价」→ 宽松分支压根没走到 → 注入漏检。
  // 关键：两个键都**不是**精确命中，但 trim 后都等于目标 —— 这才真正走到宽松分支。
  // （写着「单价」的那一版会先被精确分支接走，宽松分支永远不执行 → 注入漏检）
  eq('C3b 两个列名只有空格差异且都不是精确命中 → 不猜', M.pickField({ ' 单价': 1, '单价 ': 2 }, '单价'), undefined)
  eq('C3c 只有一个空格变体 → 命中它', M.pickField({ ' 数量 ': 7 }, '数量'), 7)
  eq('C4 找不到就是 undefined', M.pickField({ 别的: 1 }, '数量'), undefined)

  // ── D. mapRecord 的键名与类型 ──
  const rec = { record_id: 'rec1', fields: { 物品名称: '爱神凤蝶', 当前库存: '12', 单价: '¥60', 存放位置: 'A柜' } }
  const mapped = M.mapRecord(rec, M.DEFAULT_TABLES.rawInventory.fields)
  eq('D1 名称取到', mapped.itemName, '爱神凤蝶')
  eq('D2 数量转成数字', mapped.qty, 12)
  eq('D3 单价去掉货币符号', mapped.unitPrice, 60)
  eq('D4 文本原样', mapped.locationText, 'A柜')

  // ── E. 写库载荷：字段名必须与既有 upsertFromFeishu 端点对齐 ──
  const rawItems = M.toRawInventoryItems([rec], M.DEFAULT_TABLES.rawInventory.fields)
  eq('E1 原材料行数', rawItems.length, 1)
  ;['feishuRecordId', 'inventoryNo', 'itemName', 'skuName', 'spec', 'category', 'qty', 'minQty', 'unitPrice', 'inboundTotal', 'outboundTotal', 'locationText', 'note']
    .forEach((k, i) => ok(`E1-${i} 原材料载荷含 ${k}`, Object.prototype.hasOwnProperty.call(rawItems[0], k)))
  eq('E2 feishuRecordId 用 record_id（去重靠它）', rawItems[0].feishuRecordId, 'rec1')

  const purItems = M.toPurchaseItems(
    [{ record_id: 'rec2', fields: { 物品名称: '闪蝶', 数量: '2', 归属: '工作室' } }],
    M.DEFAULT_TABLES.purchase.fields
  )
  ;['feishuRecordId', 'recordId', 'orderNo', 'itemName', 'skuName', 'qty', 'unitPrice', 'entityName', 'purchaseDate']
    .forEach((k, i) => ok(`E3-${i} 采购载荷含 ${k}`, Object.prototype.hasOwnProperty.call(purItems[0], k)))
  eq('E4 采购：归属列映射到 entityName', purItems[0].entityName, '工作室')
  eq('E5 采购：数量转数字', purItems[0].qty, 2)

  const invItems = M.toInventoryItems(
    [{ record_id: 'rec3', fields: { 物品名称: '成品A', 数量: '7', 规格装裱: '玻璃罩' } }],
    M.DEFAULT_TABLES.inventory.fields
  )
  ;['feishuRecordId', 'itemName', 'skuName', 'framingSpec', 'qty', 'date', 'note']
    .forEach((k, i) => ok(`E6-${i} 成品载荷含 ${k}`, Object.prototype.hasOwnProperty.call(invItems[0], k)))
  eq('E7 成品：数量转数字（真实列名「数量」）', invItems[0].qty, 7)
  eq('E7b 成品：装裱进 framingSpec', invItems[0].framingSpec, '玻璃罩')

  // ── F. 配置合并：ERP 保存的映射优先，缺的用默认补 ──
  const merged = M.resolveFieldMap('rawInventory', { qty: '库存数' })
  eq('F1 配置覆盖默认列名', merged.qty, '库存数')
  eq('F2 未配置的仍用默认', merged.itemName, '物品名称')
  eq('F3 空配置 = 全默认', M.resolveFieldMap('purchase', null).qty, '数量')
  eq('F4 表 id：配置优先', M.resolveTableId('purchase', 'tblCUSTOM'), 'tblCUSTOM')
  eq('F5 表 id：没配就用默认', M.resolveTableId('purchase', ''), 'tblMHhGXhpmGTiI5')

  // ── H. 写库前的安全体检（2026-09-19 加）──
  //   起因：实测发现两处映射写了**表里不存在的列**，若不处理，同步会把库里原有的
  //   好数据覆盖成空（采购的「归属」会被清空 370 条），或把**别的表的行**灌进台账
  //   （成品库存映射指向了「库存管理」= 205 条原材料）。
  const cols = ['物品名称', '规格装裱', '数量', '盘点日期', '备注']
  const f1 = M.filterMappingToColumns({ itemName: '物品名称', framingSpec: '规格装裱', unit: '单位' }, cols)
  eq('H1 存在的列保留', Object.keys(f1.kept).sort(), ['framingSpec', 'itemName'])
  eq('H2 不存在的列被裁掉并报告', f1.dropped.map((d) => d.column), ['单位'])

  // 表选对：只有个别列过期 → 允许同步（裁掉即可）
  const okAssess = M.assessMapping({ itemName: '物品名称', qty: '数量', note: '备注', unit: '单位' }, cols)
  eq('H3 只缺 1 列 → 不算选错表', okAssess.mismatch, false)

  // 签名列缺失 → 一定拒绝（比比例阈值可靠：实测 50% 的边界漏过一次）
  const sigMiss = M.assessMapping({ itemName: '物品名称', framingSpec: '规格装裱', qty: '数量' }, cols, ['物品名称', '采购编号'])
  eq('H3b 签名列缺失 → 判为选错表', sigMiss.mismatch, true)
  ok('H3c 判定里点名缺了哪个签名列', sigMiss.missingSignature.includes('采购编号'), JSON.stringify(sigMiss.missingSignature))
  const sigOk = M.assessMapping({ itemName: '物品名称', qty: '数量', unit: '单位' }, cols, ['物品名称', '数量'])
  eq('H3d 签名列齐全且只缺 1 列 → 允许同步（裁掉即可）', sigOk.mismatch, false)

  // 表选错：大片列不存在 → **拒绝同步**
  const badAssess = M.assessMapping(
    { itemName: '物品名称', framingSpec: '规格装裱', qty: '数量', date: '盘点日期' },
    ['库存编号', '物品名称', '分类', '规格型号', '当前库存', '单价']
  )
  eq('H4 缺一半以上且≥2 列 → 判为选错表（必须拒绝同步）', badAssess.mismatch, true)
  ok('H4b 判定里带上缺了哪些列（人要能据此改映射）', badAssess.dropped.length === 3, JSON.stringify(badAssess.dropped))

  // ── G. 目标表：加目标只改一处，但写入口名不能写错 ──
  /**
   * G1 —— **成品库存不再是同步目标**。产品负责人 2026-09-19：
   * 「成品库的库存以小程序-超管工作台-工作室-库存管理的数据为准」
   * ⇒ 成品库存真源是小程序里人工盘点的数据，**不由飞书同步**。
   */
  eq('G1 同步目标只有两个（成品库存已按口径移出）', Object.keys(M.TARGETS).sort(), ['purchase', 'rawInventory'])
  eq('G2 原材料写入口', M.TARGETS.rawInventory.fn, 'manageStudioRawInventory')
  ok('G3 成品库存不在同步目标里（不会被飞书覆盖）', M.TARGETS.inventory === undefined)
  eq('G4 采购写入口', M.TARGETS.purchase.fn, 'managePurchaseOrder')
  ok('G5 每个目标都有 items 构造器', Object.values(M.TARGETS).every((t) => typeof t.build === 'function'), JSON.stringify(Object.keys(M.TARGETS)))
  ok('G6 每个目标都声明签名列（表身份校验）', Object.values(M.TARGETS).every((t) => Array.isArray(t.signature) && t.signature.length >= 1), JSON.stringify(Object.keys(M.TARGETS)))

  return { passes, failures }
}

// ─────────────────────────── 自检 ───────────────────────────
const INJECTIONS = [
  [
    '成品库存列名猜错（照原材料形状套 → 整列同步成空，静默丢数据）',
    (s2) => s2.replace("      framingSpec: '规格装裱',\n      qty: '数量',\n      date: '盘点日期',", "      framingSpec: '规格型号',\n      qty: '当前库存',\n      date: '日期',")
  ],
  [
    '映射裁剪失效：表里没有的列照样拿去读（空值覆盖库里的好数据）',
    (s2) => s2.replace("    if (col && cols.has(col)) kept[key] = fieldMap[key]\n    else dropped.push({ key, column: col })", "    kept[key] = fieldMap[key]")
  ],
  [
    // 锚点随 2026-09-19「加签名列判定」更新
    '表选错的判定被放宽（把别的表的行灌进台账）',
    (s2) => s2.replace('  const mismatch = missingSignature.length > 0 || (dropped.length >= 2 && missRatio >= 0.5)', '  const mismatch = false')
  ],
  [
    '签名列不再参与判定（只靠缺列比例 —— 实测 50% 边界漏过一次）',
    (s2) => s2.replace('  const mismatch = missingSignature.length > 0 || (dropped.length >= 2 && missRatio >= 0.5)', '  const mismatch = dropped.length >= 2 && missRatio >= 0.5')
  ],
  ['数字解析把空当 null（写库会写进 undefined）', (s) => s.replace("  if (!t) return 0", "  if (!t) return null")],
  ['日期不再区分秒/毫秒（10 位秒被当毫秒 → 1970 年）', (s) => s.replace('const d = new Date(ms < 1e12 ? ms * 1000 : ms)', 'const d = new Date(ms)')],
  ['宽松列名匹配改成"第一个像的就用"（近名列会互相抢）', (s) => s.replace('  if (loose.length === 1) return f[loose[0]]', '  if (loose.length) return f[loose[0]]')],
  ['写库载荷漏掉 feishuRecordId（去重失效 → 每次同步都新增）', (s) => s.replace("      feishuRecordId: rec.record_id || rec.recordId || '',\n      inventoryNo:", "      inventoryNo:")],
  ['配置不再覆盖默认列名（ERP 改过的映射不生效）', (s) => s.replace('  return Object.assign({}, base, cfg)', '  return Object.assign({}, base)')],
  [
    // 锚点随 TARGETS 改成多行后更新
    '原材料写入口指错函数（同步写到别的台账）',
    (s2) => s2.replace("    fn: 'manageStudioRawInventory',", "    fn: 'manageStudioInventory',")
  ],
  ['表 id 配置优先被反转（ERP 换表后仍读旧表）', (s) => s.replace('  if (t) return t', '  if (false) return t')]
]

function runSelfTest () {
  const dir = mkdtempSync(join(tmpdir(), 'feishu-sync-selftest-'))
  let allDetected = true
  try {
    const base = readFileSync(SRC, 'utf8')
    const target = join(dir, 'syncMapping.js')

    // 基线：必须全绿（否则守卫本身不可信）
    writeFileSync(target, base)
    const clean = runOnce(target)
    console.log(`${clean.failures.length === 0 ? '✓' : '✗'} 基线：未注入时全绿（${clean.passes} 项）`)
    if (clean.failures.length) { clean.failures.slice(0, 5).forEach((f) => console.log('    · ' + f)); allDetected = false }

    console.log('')
    for (const [label, mutate] of INJECTIONS) {
      const mutated = mutate(base)
      if (mutated === base) {
        // 锚点失效 = 注入没造成缺陷（E18-b 那类假绿）→ 判失败
        console.log(`✗ 注入「${label}」→【注入锚点失效】（源码未改变，无法判定）`)
        allDetected = false
        continue
      }
      writeFileSync(target, mutated)
      const res = runOnce(target)
      const hit = res.failures.length > 0
      console.log(`${hit ? '✓' : '✗'} 注入检出：${label}${hit ? `（${res.failures.length} 项失败）` : ' →【漏检】'}`)
      if (!hit) allDetected = false
      else res.failures.slice(0, 2).forEach((f) => console.log('    · ' + f))
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  const clean = runOnce(SRC)
  console.log(`\n${clean.failures.length === 0 ? '✓' : '✗'} 还原后恢复通过（${clean.passes} 项）`)
  if (clean.failures.length) { clean.failures.slice(0, 5).forEach((f) => console.log('    · ' + f)); allDetected = false }

  if (!allDetected) { console.log('\n✗ 自检失败 —— 守卫不可信'); process.exit(1) }
  console.log(`\n✓ selftest 通过：${INJECTIONS.length} 个注入全部被检出，且无假阳性`)
}

if (process.argv.includes('--selftest')) {
  runSelfTest()
} else {
  const res = runOnce(SRC)
  console.log(`飞书同步映射：通过 ${res.passes} / ${res.passes + res.failures.length}`)
  if (res.failures.length) {
    res.failures.forEach((f) => console.log('  ✗ ' + f))
    console.log(`\n✗ ${res.failures.length} 项失败`)
    process.exit(1)
  }
  console.log('✓ 映射层断言全部通过（表定义与 ERP 一致 / 单元格解析 / 列名匹配 / 写库载荷字段名 / 配置合并 / 目标入口）')
}
