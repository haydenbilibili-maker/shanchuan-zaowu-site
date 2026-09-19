#!/usr/bin/env node
/**
 * 出货算价引擎守卫 —— `pricingEngine.js` 是**钱的计算层**，算错就是两家门店分错钱。
 *
 * 为什么需要（依据：`admin/docs/出货算价与工作室结算_Phase1_技术蓝图.md` §5/§10）：
 *   ① 算价引擎是**纯函数**，但纯函数「写完了没人测」= 迟早静默算错；
 *   ② 三条铁律必须被**机器**钉住，不能靠人记得：
 *      · 取不到价一律写 `null`，**绝不用 0 冒充合法价**（0 看起来像真价，看板分不出「没价」与「真的 0 元」）；
 *      · 金额全程「分」整数运算，且 **`单价 × 数量 === 总价` 必须精确成立**
 *        （若按整行一次性算手工费，4 件单会出现差 1 分，对账时说不清）；
 *      · 匹配**只取最长命中**、中间残余**不猜**（报红让人点一下，而不是猜一个）。
 *   ③ 产品负责人提供的 9.14 真实样本（21 行 / 65 件 / 15 行有包装 / 6 行裸名）是**验收基线**，
 *      它必须被固化成断言 —— 否则以后改匹配逻辑，没人知道「原来哪些行是能算出来的」。
 *
 * 本守卫**只做**静态可机械判定的那部分（先读后不重复造）：
 *   不校验价目表**数据**是否真实（那是云端数据，本地测不到）；
 *   不校验算价结果是否落库（那由 `test-studio-bill` 与单一账本守卫负责）；
 *   不校验 UI 是否把未匹配行染红（WXML 侧由 lint 与后续页面守卫覆盖）。
 *
 * 用法：
 *   node miniprogram/scripts/test-studio-pricing.mjs
 *   node miniprogram/scripts/test-studio-pricing.mjs --selftest
 * 退出码：断言失败 1；注入未被检出 1；全通过 0。
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const ENGINE_PATH = resolve(ROOT, 'miniprogram/cloudfunctions/manageStoreShipment/pricingEngine.js')

// ─────────────────────────── 断言收集 ───────────────────────────

let passes = 0
const failures = []

function ok(label, cond, detail) {
  if (cond) {
    passes += 1
  } else {
    failures.push(detail ? `${label} —— ${detail}` : label)
  }
}

function eq(label, got, want) {
  ok(label, got === want, `期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`)
}

function deepEq(label, got, want) {
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  ok(label, a === b, `期望 ${b}，实际 ${a}`)
}

// ─────────────────────────── 测试数据 ───────────────────────────

/** 真实样本涉及的材料（价格是占位值，本守卫不校验价格真实性） */
const MATERIALS = [
  { _id: 'm1', name: '独角仙展翅', unitPrice: 180, isDefaultGrade: true, status: 'active' },
  { _id: 'm2', name: '独角仙没展翅', unitPrice: 150, isDefaultGrade: true, status: 'active' },
  { _id: 'm3', name: '华艳色蟌', unitPrice: 120, isDefaultGrade: true, status: 'active' },
  { _id: 'm4', name: '蒲公英', unitPrice: 60, isDefaultGrade: true, status: 'active' },
  { _id: 'm5', name: '雅灰蝶', unitPrice: 80, isDefaultGrade: true, status: 'active' },
  { _id: 'm6', name: '翠蓝眼蛱蝶', unitPrice: 90, isDefaultGrade: true, status: 'active' },
  { _id: 'm7', name: '杂蝶', unitPrice: 40, isDefaultGrade: true, status: 'active' },
  { _id: 'm8', name: '爱神凤蝶', unitPrice: 200, isDefaultGrade: true, status: 'active' },
  { _id: 'm9', name: '天堂凤蝶', unitPrice: 260, isDefaultGrade: true, status: 'active' },
  { _id: 'm10', name: '大蓝闪蝶', unitPrice: 300, isDefaultGrade: true, status: 'active', aliases: ['大蓝闪'] },
  { _id: 'm11', name: '扩头深山锹甲', unitPrice: 140, isDefaultGrade: true, status: 'active' },
  { _id: 'm12', name: '印尼金锹', unitPrice: 110, isDefaultGrade: true, status: 'active' },
  { _id: 'm13', name: '黄裳眼蛱蝶', unitPrice: 95, isDefaultGrade: true, status: 'active' },
  { _id: 'm14', name: '熊蜂王', unitPrice: 130, isDefaultGrade: true, status: 'active', aliases: ['熊风王'] }
]

const PACKAGINGS = [
  { _id: 'p1', name: '玻璃罩', size: '20*10', unitPrice: 45, isDefaultSize: true, status: 'active' },
  { _id: 'p2', name: '冰箱贴', unitPrice: 12, isDefaultSize: true, status: 'active' },
  { _id: 'p3', name: '框', unitPrice: 60, isDefaultSize: true, status: 'active', aliases: ['相框'] },
  { _id: 'p4', name: '造景', unitPrice: 80, isDefaultSize: true, status: 'active' }
]

/** 产品负责人提供的 9.14 真实出货单（21 行 / 65 件）—— 验收基线，逐字不改 */
const SAMPLE_TEXT = [
  '独角仙展翅玻璃罩-2',
  '独角仙没展翅玻璃罩-4',
  '华艳色蟌-2',
  '蒲公英玻璃罩-4',
  '雅灰蝶冰箱贴-3',
  '翠蓝眼蛱蝶-7',
  '杂蝶冰箱贴-8',
  '爱神凤蝶玻璃罩-2',
  '爱神凤蝶框-3',
  '爱神凤蝶造景-1',
  '天堂凤蝶造景-1',
  '爱神凤蝶玻璃罩-2',
  '大蓝闪玻璃罩-1',
  '扩头深山锹甲-2',
  '印尼金锹-2',
  '华艳色蟌-2',
  '黄裳眼蛱蝶造景-2',
  '翠蓝眼蛱蝶造景-2',
  '熊风王-2',
  '杂蝶冰箱贴-10',
  '雅灰蝶冰箱贴-3'
].join('\n')

function sampleLines() {
  return SAMPLE_TEXT.split('\n').map((l) => {
    const m = l.trim().match(/^(.+)-(\d+)$/)
    return { itemName: m[1], qty: Number(m[2]) }
  })
}

/** 真实样本里**没写包装**的 6 行，去重后命中的 5 个材料（注意 `熊风王` 是别名，解析后是 `熊蜂王`） */
const SAMPLE_BARE = ['华艳色蟌', '翠蓝眼蛱蝶', '扩头深山锹甲', '印尼金锹', '熊蜂王']

// ─────────────────────────── 正式断言 ───────────────────────────

function runTests(E) {
  const baseCtx = () => E.buildContext({ materials: MATERIALS, packagings: PACKAGINGS, laborRatePct: 30 })

  // ── A. 归一化：粘贴文本里的全角/空格/零宽/乘号必须都能对上 ──
  eq('A1 全角字母数字转半角', E.normalizeName('Ａ１'), 'A1')
  eq('A2 去掉所有空白', E.normalizeName('大蓝闪 蝶'), '大蓝闪蝶')
  eq('A3 去掉零宽字符', E.normalizeName('大蓝闪\u200b蝶'), '大蓝闪蝶')
  eq('A4 乘号统一为 *', E.normalizeName('20×10'), '20*10')
  eq('A5 全角乘号统一为 *', E.normalizeName('20＊10'), '20*10')
  eq('A6 拉丁字母统一大写', E.normalizeName('a1'), 'A1')
  eq('A7 全角空格被去掉', E.normalizeName('大蓝闪\u3000蝶'), '大蓝闪蝶')
  eq('A8 元转分四舍五入', E.toCents(19.995), 2000)
  eq('A9 空值归一化为空串', E.normalizeName(null), '')

  // ── B. 价目表完整性校验：脏数据不许进库 ──
  ok(
    'B1 正常价目表通过校验',
    E.validatePriceBook({ materials: MATERIALS, packagings: PACKAGINGS }).ok === true,
    JSON.stringify(E.validatePriceBook({ materials: MATERIALS, packagings: PACKAGINGS }).errors)
  )
  const codesOf = (book) => E.validatePriceBook(book).errors.map((e) => e.code)
  ok(
    'B2 同一材料两个默认行被拒',
    codesOf({ materials: MATERIALS.concat([{ name: '雅灰蝶', grade: 'A2', isDefaultGrade: true, unitPrice: 70 }]) }).includes(
      'MULTIPLE_DEFAULT'
    )
  )
  ok(
    'B3 同材料同等级重复行被拒',
    codesOf({ materials: MATERIALS.concat([{ name: '雅灰蝶', unitPrice: 70, isDefaultGrade: false }]) }).includes(
      'DUPLICATE_ROW'
    )
  )
  ok(
    'B4 别名跨材料冲突被拒',
    codesOf({ materials: MATERIALS.concat([{ name: '另一种蝶', unitPrice: 10, isDefaultGrade: true, aliases: ['大蓝闪'] }]) }).includes(
      'ALIAS_CONFLICT'
    )
  )
  ok(
    'B5 负单价被拒',
    codesOf({ materials: MATERIALS.concat([{ name: '负价料', unitPrice: -5, isDefaultGrade: true }]) }).includes('BAD_PRICE')
  )
  ok(
    'B6 缺默认行被拒（文本不写等级时取不到价）',
    codesOf({ materials: [{ name: '无默认料', grade: 'A1', unitPrice: 10, isDefaultGrade: false }] }).includes('NO_DEFAULT')
  )
  ok(
    'B7 qtyPerUnit 非正数被拒',
    codesOf({ materials: [{ name: '零用量料', unitPrice: 10, isDefaultGrade: true, qtyPerUnit: 0 }] }).includes(
      'BAD_QTY_PER_UNIT'
    )
  )
  ok(
    'B8 包装缺默认尺寸行被拒',
    codesOf({ packagings: [{ name: '无默认罩', size: '20*10', unitPrice: 10, isDefaultSize: false }] }).includes('NO_DEFAULT')
  )

  // ── C. 匹配：最长命中、别名、默认等级/尺寸、残余不猜 ──
  // 注意：qty 必须用「未传」表示默认 1，不能用 `qty || 1` —— 那会把 C26 要测的 `0` 变成 1，
  // 使「数量非法」这条断言永远恒真（本守卫第一次跑就是这么假绿的）。
  const one = (itemName, ctx, qty) =>
    E.resolveLine({ itemName, qty: qty === undefined ? 1 : qty }, ctx || baseCtx())

  eq('C1 材料+包装正常命中', one('爱神凤蝶玻璃罩').pricingStatus, 'priced')
  eq('C1b 命中的是正确材料', one('爱神凤蝶玻璃罩').materialName, '爱神凤蝶')
  eq('C1c 命中的是正确包装', one('爱神凤蝶玻璃罩').packagingName, '玻璃罩')
  eq('C2 别名「大蓝闪」命中「大蓝闪蝶」', one('大蓝闪玻璃罩').materialName, '大蓝闪蝶')
  eq('C3 别名「熊风王」命中「熊蜂王」', one('熊风王造景').materialName, '熊蜂王')
  eq('C4 别名「相框」命中包装「框」', one('爱神凤蝶相框').packagingName, '框')
  eq('C5 没写等级时落到默认等级行', one('爱神凤蝶玻璃罩').materialGrade, '')
  eq('C6 没写尺寸时落到默认尺寸行', one('爱神凤蝶玻璃罩').packagingSize, '20*10')

  // 最长命中：`杂` 是 `杂蝶` 的前缀，必须命中更长的 `杂蝶`（否则残余「蝶」会被误判）
  const trapCtx = E.buildContext({
    materials: [
      { _id: 't1', name: '杂', unitPrice: 10, isDefaultGrade: true, status: 'active' },
      { _id: 't2', name: '杂蝶', unitPrice: 40, isDefaultGrade: true, status: 'active' }
    ],
    packagings: PACKAGINGS,
    laborRatePct: 30
  })
  eq('C7 材料取最长命中（杂蝶 胜过 杂）', one('杂蝶冰箱贴', trapCtx).materialName, '杂蝶')
  const trapPkgCtx = E.buildContext({
    materials: MATERIALS,
    packagings: [
      { _id: 'tp1', name: '罩', unitPrice: 5, isDefaultSize: true, status: 'active' },
      { _id: 'tp2', name: '玻璃罩', unitPrice: 45, isDefaultSize: true, status: 'active' }
    ],
    laborRatePct: 30
  })
  eq('C8 包装取最长命中（玻璃罩 胜过 罩）', one('爱神凤蝶玻璃罩', trapPkgCtx).packagingName, '玻璃罩')

  // 尺寸：写在包装名后面 / 前面都要认出来
  const sizeCtx = E.buildContext({
    materials: MATERIALS,
    packagings: [
      { _id: 's1', name: '玻璃罩', size: '20*10', unitPrice: 45, isDefaultSize: true, status: 'active' },
      { _id: 's2', name: '玻璃罩', size: '15*8', unitPrice: 30, isDefaultSize: false, status: 'active' }
    ],
    laborRatePct: 30
  })
  eq('C9 尺寸写在包装名之后可识别', one('爱神凤蝶玻璃罩15*8', sizeCtx).packagingSize, '15*8')
  eq('C10 尺寸写在包装名之前可识别', one('爱神凤蝶15*8玻璃罩', sizeCtx).packagingSize, '15*8')
  eq('C11 没写尺寸仍取默认行', one('爱神凤蝶玻璃罩', sizeCtx).packagingSize, '20*10')

  // 等级：文本写了等级就用那一行，没写用默认行
  const gradeCtx = E.buildContext({
    materials: [
      { _id: 'g1', name: '大蓝闪蝶', grade: 'A1', unitPrice: 300, isDefaultGrade: false, status: 'active' },
      { _id: 'g2', name: '大蓝闪蝶', grade: 'A2', unitPrice: 200, isDefaultGrade: true, status: 'active' }
    ],
    packagings: PACKAGINGS,
    laborRatePct: 30
  })
  eq('C12 文本写了等级 A1 用 A1 行', one('大蓝闪蝶A1玻璃罩', gradeCtx).materialGrade, 'A1')
  eq('C13 文本没写等级用默认行 A2', one('大蓝闪蝶玻璃罩', gradeCtx).materialGrade, 'A2')
  ok(
    'C14 A1 与 A2 算出不同价',
    one('大蓝闪蝶A1玻璃罩', gradeCtx).unitPrice > one('大蓝闪蝶玻璃罩', gradeCtx).unitPrice
  )

  // 报红路径：裸名 / 材料不存在 / 包装不存在 / 残余未识别
  const bare = one('华艳色蟌')
  eq('C15 裸名报 unmatched', bare.pricingStatus, 'unmatched')
  ok('C16 裸名的原因明说是没写包装', /未写包装/.test(bare.pricingNote), bare.pricingNote)
  eq('C17 裸名不写 0 元单价（必须 null）', bare.unitPrice, null)
  eq('C18 裸名不写 0 分材料费（必须 null）', bare.materialCostCents, null)
  eq('C19 裸名保留已命中的材料信息（便于人工补包装）', bare.materialName, '华艳色蟌')
  eq('C20 材料不存在报 unmatched', one('不存在的蝶玻璃罩').pricingStatus, 'unmatched')
  ok('C21 材料不存在的文案', /未找到原材料/.test(one('不存在的蝶玻璃罩').pricingNote))
  eq('C22 包装不存在报 unmatched', one('爱神凤蝶不存在的罩').pricingStatus, 'unmatched')
  ok('C23 包装不存在的文案', /未找到包装方式/.test(one('爱神凤蝶不存在的罩').pricingNote))
  eq('C24 拆解残余报 ambiguous（不许猜）', one('爱神凤蝶框玻璃罩').pricingStatus, 'ambiguous')
  ok('C25 残余文案报出残余内容', /残留未识别/.test(one('爱神凤蝶框玻璃罩').pricingNote))
  eq('C26 数量非法报 unmatched', one('爱神凤蝶玻璃罩', baseCtx(), 0).pricingStatus, 'unmatched')
  eq('C27 品名为空报 unmatched', one('').pricingStatus, 'unmatched')

  // 停用行不参与匹配
  const inactiveCtx = E.buildContext({
    materials: [
      { _id: 'i1', name: '停用料', unitPrice: 10, isDefaultGrade: true, status: 'inactive' },
      { _id: 'i2', name: '爱神凤蝶', unitPrice: 200, isDefaultGrade: true, status: 'active' }
    ],
    packagings: PACKAGINGS,
    laborRatePct: 30
  })
  eq('C28 停用材料不参与匹配', one('停用料玻璃罩', inactiveCtx).pricingStatus, 'unmatched')

  // ── D. 金额：全程分整数、单价×数量=总价精确、手工费按件取整 ──
  const amt = E.computeAmounts({
    materialUnitPrice: 180,
    packagingUnitPrice: 45,
    qty: 2,
    laborRatePct: 30
  })
  eq('D1 材料费（分/件）', amt.materialCostCents, 18000)
  eq('D2 包装费（分/件）', amt.packagingCostCents, 4500)
  eq('D3 手工费 = (材料+包装)×30%（分/件）', amt.laborCostCents, 6750)
  eq('D4 单价（元）', amt.unitPrice, 292.5)
  eq('D5 总价（元）= 单价×数量', amt.totalPrice, 585)
  eq('D6 总价分', amt.totalCents, 58500)

  // 手工费出现「不足 1 分」时必须四舍五入，且不允许破坏 单价×数量=总价
  const odd = E.computeAmounts({ materialUnitPrice: 19.99, packagingUnitPrice: 0, qty: 3, laborRatePct: 30 })
  eq('D7 不足 1 分的手工费四舍五入（599.7 → 600）', odd.laborCostCents, 600)
  eq('D8 奇数单价×3 的总价精确（按件取整得到 77.97）', odd.totalPrice, 77.97)
  ok(
    'D9 单价×数量 === 总价（分，精确）',
    Math.round(odd.unitPrice * 100) * 3 === odd.totalCents,
    `unitPrice=${odd.unitPrice} totalCents=${odd.totalCents}`
  )

  // qtyPerUnit：默认 1；显式 >1 时按倍数算（蓝图裁决 19：字段留着，默认不启用）
  const multi = E.computeAmounts({
    materialUnitPrice: 100,
    materialQtyPerUnit: 3,
    packagingUnitPrice: 0,
    qty: 2,
    laborRatePct: 0
  })
  eq('D10 qtyPerUnit=3 时材料费按 3 倍', multi.materialCostCents, 30000)
  const noQty = E.computeAmounts({ materialUnitPrice: 100, packagingUnitPrice: 0, qty: 1, laborRatePct: 0 })
  eq('D11 qtyPerUnit 缺失时按 1', noQty.materialCostCents, 10000)
  eq('D12 费率 0 时没有手工费', noQty.laborCostCents, 0)

  // ── E. 整批：真实样本 21 行是验收基线 ──
  const quoted = E.quoteLines(sampleLines(), baseCtx())
  eq('E1 样本总行数 21', quoted.lineCount, 21)
  eq('E2 样本已核价行 15', quoted.pricedCount, 15)
  eq('E3 样本问题行 6', quoted.issueCount, 6)
  eq('E4 样本总件数 65（**全部行**，不是只算已核价行）', quoted.totalQty, 65)
  eq('E5 样本已核价件数 48', quoted.pricedQty, 48)
  eq('E6 有未核价行 → 单据标记 incomplete（阻塞结算）', quoted.pricingStatus, 'incomplete')
  ok(
    'E7 6 个问题行全部是「未写包装」',
    quoted.lines.filter((l) => l.pricingStatus !== 'priced').every((l) => /未写包装/.test(l.pricingNote))
  )
  ok(
    'E8 6 个问题行对应真实样本里的 5 个裸名材料（集合相等）',
    JSON.stringify(
      Array.from(new Set(quoted.lines.filter((l) => l.pricingStatus !== 'priced').map((l) => l.materialName))).sort()
    ) === JSON.stringify(SAMPLE_BARE.slice().sort()),
    JSON.stringify(quoted.lines.filter((l) => l.pricingStatus !== 'priced').map((l) => l.materialName))
  )
  ok(
    'E9 没有任何问题行被静默写成 0 元',
    quoted.lines.filter((l) => l.pricingStatus !== 'priced').every((l) => l.unitPrice === null)
  )
  ok(
    'E10 已核价行都有正数总价',
    quoted.lines.filter((l) => l.pricingStatus === 'priced').every((l) => l.totalPrice > 0)
  )
  ok(
    'E11 金额只累加已核价行（材料+包装+手工 = 合计）',
    quoted.materialCostCents + quoted.packagingCostCents + quoted.laborCostCents === quoted.totalCents,
    `${quoted.materialCostCents}+${quoted.packagingCostCents}+${quoted.laborCostCents} != ${quoted.totalCents}`
  )
  ok(
    'E12 单据合计（元）等于合计（分）÷100',
    quoted.totalAmount === Math.round(quoted.totalCents) / 100,
    `totalAmount=${quoted.totalAmount} totalCents=${quoted.totalCents}`
  )
  ok(
    'E13 每行 单价×数量 = 该行总分（逐行精确）',
    quoted.lines
      .filter((l) => l.pricingStatus === 'priced')
      .every((l) => Math.round(l.unitPrice * 100) * l.qty === l.totalCents)
  )
  eq('E14 别名行「大蓝闪玻璃罩」命中的是「大蓝闪蝶」', quoted.lines[12].materialName, '大蓝闪蝶')
  eq('E15 别名行「熊风王」命中的是「熊蜂王」', quoted.lines[18].materialName, '熊蜂王')
  eq('E16 同一材料配不同包装各自成价（爱神凤蝶 玻璃罩）', quoted.lines[7].packagingName, '玻璃罩')
  eq('E17 同一材料配不同包装各自成价（爱神凤蝶 框）', quoted.lines[8].packagingName, '框')
  eq('E18 同一材料配不同包装各自成价（爱神凤蝶 造景）', quoted.lines[9].packagingName, '造景')

  // ── F. 快照隔离：价目表改价后，用旧价快照算过的行不受影响 ──
  // 引擎本身不落库，这里证明「同一批输入 + 改价目表 → 结果变」，从而说明快照必须存在单据上。
  const before = E.quoteLines([{ itemName: '爱神凤蝶玻璃罩', qty: 1 }], baseCtx())
  const raised = E.buildContext({
    materials: MATERIALS.map((m) => (m.name === '爱神凤蝶' ? Object.assign({}, m, { unitPrice: 999 }) : m)),
    packagings: PACKAGINGS,
    laborRatePct: 30
  })
  const after = E.quoteLines([{ itemName: '爱神凤蝶玻璃罩', qty: 1 }], raised)
  ok('F1 改价目表会改变新算结果（故必须把定价快照落库）', before.totalCents !== after.totalCents)
}

// ─────────────────────────── 注入自检 ───────────────────────────

/** 每条注入都必须让至少一条断言失败 —— 否则那条断言是恒真的假保护 */
const INJECTIONS = [
  [
    '裸名不再报红（关闭 requirePackaging）',
    (src) => src.replace('const requirePackaging = !(ctx && ctx.requirePackaging === false)', 'const requirePackaging = false')
  ],
  ['未匹配改回写 0 元（0 冒充合法价）', (src) => src.replace('      unitPrice: null,', '      unitPrice: 0,')],
  ['别名不再参与匹配', (src) => src.replace('.map((a) => normalizeName(a)).filter(Boolean)', '.map(() => "").filter(Boolean)')],
  [
    '前缀改成「最先命中」而不是最长命中',
    (src) => src.replace('if (!best || k.key.length > best.key.length) best = k', 'if (!best) best = k')
  ],
  ['手工费恒为 0（费率被忽略）', (src) => src.replace('const perUnitLabor = Math.round(((perUnitMaterial + perUnitPackaging) * rate) / 100)', 'const perUnitLabor = 0')],
  [
    '默认等级行被忽略（改用第一行）',
    (src) => src.replace('let materialRow = grade ? matGroup.byOption[grade] : matGroup.defaultRow', 'let materialRow = matGroup.rows[0]')
  ],
  ['停用行仍参与匹配', (src) => src.replace("if (row.status && row.status !== 'active') continue", 'if (false) continue')],
  ['材料费不再按分四舍五入（floor）', (src) => src.replace('return Math.round(n * CENTS)', 'return Math.floor(n * CENTS)')],
  ['单价与总价脱钩（总价按整行另算）', (src) => src.replace('totalPrice: toYuan(perUnitTotal * unitQty)', 'totalPrice: toYuan(perUnitTotal * unitQty) + 0.01')],
  ['总件数只统计已核价行（单据件数变少）', (src) => src.replace('totalQty += isPositiveInt(r.qty) ? r.qty : 0', 'totalQty += r.pricingStatus === PRICING_STATUS.PRICED && isPositiveInt(r.qty) ? r.qty : 0')]
]

function loadEngine(enginePath) {
  const resolved = require.resolve(enginePath)
  delete require.cache[resolved]
  return require(enginePath)
}

function runOnce(enginePath) {
  passes = 0
  failures.length = 0
  let E
  try {
    E = loadEngine(enginePath)
  } catch (e) {
    failures.push(`加载引擎失败：${e.message}`)
    return { failed: failures.length, failures: failures.slice() }
  }
  try {
    runTests(E)
  } catch (e) {
    failures.push(`断言执行抛异常：${e.message}`)
  }
  return { failed: failures.length, failures: failures.slice() }
}

function runSelfTest() {
  console.log('自检：确认「实现被破坏」时断言确实会失败\n')
  const original = readFileSync(ENGINE_PATH, 'utf8')
  let allDetected = true

  for (const [label, mutate] of INJECTIONS) {
    const dir = mkdtempSync(join(tmpdir(), 'studio-pricing-selftest-'))
    const target = join(dir, 'pricingEngine.js')
    const mutated = mutate(original)
    if (mutated === original) {
      console.log(`✗ ${label} → 【注入锚点失效】（源码未改变，无法判定）`)
      allDetected = false
      rmSync(dir, { recursive: true, force: true })
      continue
    }
    writeFileSync(target, mutated, 'utf8')
    copyFileSync(ENGINE_PATH, join(dir, '.orig'))
    const res = runOnce(target)
    const detected = res.failed > 0
    allDetected = allDetected && detected
    console.log(`${detected ? '✓' : '✗'} 注入 ${label} → ${detected ? '已检出' : '【漏检】'}${detected ? `（${res.failed} 项失败）` : ''}`)
    if (detected) res.failures.slice(0, 2).forEach((f) => console.log(`    · ${f}`))
    rmSync(dir, { recursive: true, force: true })
  }

  // 反向：不注入时必须全绿（证明没有假阳性）
  const clean = runOnce(ENGINE_PATH)
  console.log(`\n${clean.failed === 0 ? '✓' : '✗'} 未注入时通过（${clean.failed === 0 ? '无假阳性' : '有假阳性' }）`)
  if (clean.failed > 0) clean.failures.slice(0, 5).forEach((f) => console.log(`    · ${f}`))

  if (!allDetected || clean.failed > 0) {
    console.log('\n✗ 自检失败')
    process.exit(1)
  }
  console.log(`\n✓ selftest 通过：${INJECTIONS.length} 个注入全部被检出，且无假阳性`)
}

// ─────────────────────────── 入口 ───────────────────────────

if (process.argv.includes('--selftest')) {
  runSelfTest()
} else {
  const res = runOnce(ENGINE_PATH)
  console.log(`出货算价引擎：通过 ${passes} / ${passes + res.failed}`)
  if (res.failed > 0) {
    console.log('')
    res.failures.forEach((f) => console.log(`  ✗ ${f}`))
    console.log(`\n✗ ${res.failed} 项失败`)
    process.exit(1)
  }
  console.log('✓ 算价引擎断言全部通过（归一化 / 完整性 / 最长命中 / 别名 / 默认等级尺寸 / 残余不猜 / 分整数金额 / 单价×数量=总价 / 真实样本 21 行基线）')
}
