/**
 * 出货算价内核（纯函数 · 零 db 依赖）—— **共享模块的唯一真源**
 * SSOT：admin/docs/出货算价与工作室结算_Phase1_技术蓝图.md §5
 *
 * 本文件是共享家族 `pricingCore.js` 的 canonical；逐字节副本由 `check:shared-modules` 守。
 * 两个消费方：
 *   · `manageStoreShipment` —— **算价**（预览与落库共用同一实现），经门面 `pricingEngine.js` 暴露
 *   · `manageStudioSettlement` —— **价目表写入**（算 `normName`、校验完整性、搜索）
 *   ⚠️ 改了本文件**必须同步副本**，否则守卫红。
 *
 * 为什么必须是纯函数、且只有一份实现：
 *   ① 「预览价」与「落库价」必须**同源** —— 两处各写一遍，早晚漂移；
 *   ② 两个云函数对「同一材料」的判定必须同口径（否则一边把 `大蓝闪 蝶` 与 `大蓝闪蝶`
 *      当两个材料、另一边当一个）；
 *   ③ 纯函数可以直接被守卫单测 require，不需要起云环境（照抄 test-wish-wall 对纯函数的测法）。
 *
 * 铁律（违反即为交付失败）：
 *   · 取不到价一律写 `null`，**绝不用 0 冒充合法价**（0 看起来像真价，看板分不出「没价」和「真的 0 元」）；
 *   · 金额全程用**分**做整数运算，最后才转元 —— 浮点累加会产生 0.01 级误差，两家门店分钱场景不可接受；
 *   · 手工费**按「件」计算并取整到分**再乘数量，保证 `unitPrice × qty === totalPrice` 精确成立；
 *   · 匹配**只取最长命中**，中间残余**不猜**（宁可报红让人点一下）。
 */

/** 取价状态：priced 已取到价 / unmatched 取不到 / ambiguous 有歧义（残余或多义） */
const PRICING_STATUS = {
  PRICED: 'priced',
  UNMATCHED: 'unmatched',
  AMBIGUOUS: 'ambiguous',
  MANUAL: 'manual'
}

/** 单据级：只要有非 priced 行，整单就是 incomplete，必须阻塞结算 */
const SHIPMENT_PRICING_STATUS = {
  PRICED: 'priced',
  INCOMPLETE: 'incomplete'
}

/** 默认等级/尺寸的占位值（价目表里 grade/size 留空时落这个） */
const DEFAULT_GRADE = '默认'
const DEFAULT_SIZE = '默认'

const CENTS = 100

/** 零宽字符：粘贴文本里极常见，会让「看起来一样」的两个名字匹配不上 */
const ZERO_WIDTH_RE = /[\u200b-\u200c\u200d\u2060\ufeff]/g
/** 各种「乘号」统一成 *，避免 20×10 / 20✕10 与 20*10 对不上 */
const MULTIPLY_RE = /[×✕✖⨯＊]/g

/**
 * 归一化：匹配键的统一形式。
 * 全角→半角、去所有空白与零宽字符、乘号统一、拉丁字母统一大写。
 * 中文不受大写影响；同一材料含大写字母（如 A1 等级）时大小写混写也能命中。
 */
function normalizeName(raw) {
  let s = String(raw == null ? '' : raw)
  s = s.replace(ZERO_WIDTH_RE, '')
  s = s.replace(MULTIPLY_RE, '*')
  // 全角 ASCII（！-～ = U+FF01..U+FF5E）→ 半角
  s = s.replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
  s = s.replace(/\u3000/g, ' ')
  s = s.replace(/\s+/g, '')
  return s.toUpperCase()
}

/** 元 → 分（整数）。四舍五入到分，避免 19.99*100 = 1998.9999 这类浮点坑 */
function toCents(yuan) {
  const n = Number(yuan)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * CENTS)
}

/** 分 → 元（保留 2 位） */
function toYuan(cents) {
  const n = Number(cents)
  if (!Number.isFinite(n)) return 0
  return Math.round(n) / CENTS
}

function isPositiveInt(n) {
  const v = Number(n)
  return Number.isFinite(v) && v > 0 && Math.floor(v) === v
}

/** qtyPerUnit（一件成品用几只材料/几个包装）归一：非法或缺失一律按 1 —— 蓝图裁决 19「默认 1、不启用」 */
function normalizeQtyPerUnit(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return 1
  return n
}

function normalizeRate(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

function normGrade(v) {
  const s = String(v == null ? '' : v).trim()
  return s || DEFAULT_GRADE
}

function normSize(v) {
  const s = String(v == null ? '' : v).trim()
  return s || DEFAULT_SIZE
}

/**
 * 建价目表索引。
 *
 * 关键设计：**按 name 分组**，而不是一行一个键。
 * 因为「大蓝闪蝶 A1」和「大蓝闪蝶 A2」是同一个材料的两个等级行，
 * 它们**不是歧义**，而是「同组不同等级」；只有**不同组**的键等长命中才算歧义。
 *
 * @param {Array} rows           价目表行（材料或包装）
 * @param {Object} opts
 * @param {string} opts.keyField        用于分组与匹配的字段名（材料/包装都是 name）
 * @param {string} opts.defaultFlagKey  默认行标记字段（isDefaultGrade / isDefaultSize）
 * @param {string} opts.optionField     等级/尺寸字段名（grade / size）
 * @returns {{groups:Object, keys:Array, errors:Array}}
 */
function buildPriceIndex(rows, opts) {
  const list = Array.isArray(rows) ? rows : []
  const keyField = (opts && opts.keyField) || 'name'
  const defaultFlagKey = (opts && opts.defaultFlagKey) || 'isDefault'
  const optionField = (opts && opts.optionField) || 'grade'

  const groups = {}
  const errors = []
  /** 键 → 组：同时登记正名与全部别名 */
  const keyOwner = {}

  for (let i = 0; i < list.length; i += 1) {
    const row = list[i] || {}
    // 停用行不参与匹配（历史单靠快照不受影响）
    if (row.status && row.status !== 'active') continue

    const rawName = String(row[keyField] || '').trim()
    if (!rawName) {
      errors.push({ code: 'EMPTY_NAME', row: i, msg: `第 ${i + 1} 行缺少名称` })
      continue
    }
    const nk = row.normName ? normalizeName(row.normName) : normalizeName(rawName)
    if (!nk) {
      errors.push({ code: 'EMPTY_NORM_NAME', row: i, name: rawName, msg: `「${rawName}」归一化后为空` })
      continue
    }

    const option = normalizeName(optionField === 'size' ? normSize(row[optionField]) : normGrade(row[optionField]))
    if (!groups[nk]) {
      groups[nk] = {
        normName: nk,
        displayName: String(row.displayName || rawName),
        optionField,
        rows: [],
        byOption: {}
      }
    }
    // 同组内「等级 + 尺寸」不得重复（价目表完整性由 validatePriceBook 负责报错，这里只防覆盖）
    if (groups[nk].byOption[option]) {
      errors.push({
        code: 'DUPLICATE_OPTION',
        name: rawName,
        option: row[optionField],
        msg: `「${rawName}」的 ${optionField}=${row[optionField] || DEFAULT_GRADE} 有重复行`
      })
      continue
    }
    groups[nk].rows.push(row)
    groups[nk].byOption[option] = row
    if (row[defaultFlagKey] === true) {
      if (groups[nk].defaultRow) {
        errors.push({
          code: 'MULTIPLE_DEFAULT',
          name: rawName,
          msg: `「${rawName}」有多个默认行（只能有一个）`
        })
      } else {
        groups[nk].defaultRow = row
      }
    }

    // 正名与别名都进 keyOwner
    const allKeys = [nk].concat(
      (Array.isArray(row.aliases) ? row.aliases : []).map((a) => normalizeName(a)).filter(Boolean)
    )
    for (const k of allKeys) {
      if (keyOwner[k] && keyOwner[k] !== nk) {
        errors.push({
          code: 'ALIAS_CONFLICT',
          name: rawName,
          key: k,
          msg: `「${k}」同时指向「${keyOwner[k]}」与「${nk}」，别名不得跨材料重复`
        })
        continue
      }
      keyOwner[k] = nk
    }
  }

  // 每组必须有默认行，否则「没写等级/尺寸」时无法取值
  for (const nk of Object.keys(groups)) {
    if (!groups[nk].defaultRow) {
      errors.push({
        code: 'NO_DEFAULT',
        name: groups[nk].displayName,
        msg: `「${groups[nk].displayName}」没有默认行，文本没写${optionField === 'size' ? '尺寸' : '等级'}时取不到价`
      })
    }
  }

  const keys = Object.keys(keyOwner).map((k) => ({ key: k, normName: keyOwner[k] }))
  return { groups, keys, errors }
}

/**
 * 最长前缀命中。返回命中的键条目，未命中返回 `null`。
 *
 * **为什么没有「等长多义」分支**（别再加回来）：
 *   两个**不同的**字符串不可能同时是一个输入的**前缀**（同理后缀），
 *   所以「等长且都命中」在结构上不可能发生 —— 加了也是永不触发的死分支。
 *   真正的多义只有两个来源，分别由别处负责：
 *     ① **别名跨材料冲突**（同一个键指向两个材料）→ `validatePriceBook` 报 `ALIAS_CONFLICT`，
 *        且 `buildPriceIndex` 只让**第一个**登记成功，匹配结果因此是确定的；
 *     ② **拆解残余无法识别**（如 `框玻璃罩` 里多出一个 `框`）→ `resolveLine` 报 `ambiguous`。
 */
function longestPrefix(input, keys) {
  let best = null
  for (const k of keys) {
    if (!k.key || !input.startsWith(k.key)) continue
    if (!best || k.key.length > best.key.length) best = k
  }
  return best
}

/** 最长后缀命中。语义与「为什么没有等长多义分支」同 longestPrefix。 */
function longestSuffix(input, keys) {
  let best = null
  for (const k of keys) {
    if (!k.key || !input.endsWith(k.key)) continue
    if (!best || k.key.length > best.key.length) best = k
  }
  return best
}

/** 在一段文本里识别该组的等级/尺寸选项（返回命中的 option 原文，未命中返回 ''） */
function matchOption(text, group) {
  if (!text || !group) return ''
  const opts = Object.keys(group.byOption || {})
  let best = ''
  for (const opt of opts) {
    // 默认行的 option 归一化后可能等于 DEFAULT_GRADE/DEFAULT_SIZE 的归一化值，
    // 那不是「文本里写了等级」，必须排除，否则任何输入都会误命中默认行
    if (!opt) continue
    if (opt === normalizeName(DEFAULT_GRADE) || opt === normalizeName(DEFAULT_SIZE)) continue
    if (text.includes(opt) && opt.length > best.length) best = opt
  }
  return best
}

/**
 * 单行算价结果。
 *
 * **单位约定（字段名自带单位，防混用；违反即为交付失败）**：
 *   · 一切 `*Cents` = **分**（整数，审计精确）；
 *   · `unit*Cents` = **分 / 件**（`unitMaterialCostCents` = 单件材料费）；
 *   · `lineTotalCents` = **分 / 行**（= 单件合计 × 数量）；
 *   · `unitPrice` = **元 / 件**、`totalPrice` = **元 / 行** —— 只有这两个沿用 `ops_shipments` 既有语义。
 *
 * ⚠️ 为什么必须把单位写进名字：原先叫 `materialCostCents`（每件）与 `totalCents`（整行）——
 *    两个名字看起来同级，实际单位不同。汇总时若对两者都乘 `qty`，总额会**正好翻倍**，
 *    而且不报错、类型也对，只有对账时才发现。本仓库已真实踩过一次（2026-09-19 P0-3 冒烟）。
 *
 * @returns {Object} 永远返回结构完整的对象；取不到价时 `unitPrice=null`（**不是 0**）
 */
function emptyLine(status, note, extra) {
  return Object.assign(
    {
      pricingStatus: status,
      pricingNote: note || '',
      materialId: '',
      materialName: '',
      materialGrade: '',
      packagingId: '',
      packagingName: '',
      packagingSize: '',
      unitMaterialCostCents: null,
      unitPackagingCostCents: null,
      unitLaborCostCents: null,
      unitTotalCents: null,
      lineTotalCents: null,
      unitPrice: null,
      totalPrice: null,
      laborRatePct: null,
      laborRateSource: '',
      qty: 0,
      itemName: ''
    },
    extra || {}
  )
}

/**
 * 解析并计算一行。
 *
 * @param {Object} line  { itemName, qty, gradeHint?, sizeHint? }
 * @param {Object} ctx   { materialIndex, packagingIndex, laborRatePct, requirePackaging }
 */
/**
 * 按**显式选择**找组（编辑页让人手选时用，蓝图裁决 24）。
 *
 * 为什么不能只靠文本匹配：编辑页允许人给 `华艳色蟌` 这行**手选**包装 `玻璃罩` ——
 * 原文里根本没有「玻璃罩」这三个字。若仍走文本匹配，用户选完还是报「未写包装」。
 * 所以显式选择必须能**绕过文本**：按 `_id` 或名称/别名精确命中。
 *
 * @returns {Object|null} 命中的组；找不到返回 null（调用方要报"不在价目表里"，不能静默当没选）
 */
function findExplicitGroup(index, ref) {
  const id = String((ref && ref.id) || '').trim()
  const groups = (index && index.groups) || {}
  if (id) {
    for (const nk of Object.keys(groups)) {
      if ((groups[nk].rows || []).some((r) => String(r._id || '') === id)) return groups[nk]
    }
  }
  const name = normalizeName((ref && ref.name) || '')
  if (name) {
    for (const k of (index && index.keys) || []) {
      if (k.key === name) return groups[k.normName]
    }
  }
  return null
}

/** 该组自身登记的全部匹配键（正名 + 别名），用于在原文里把材料段去掉 */
function ownKeysOf(group) {
  if (!group) return []
  const keys = [group.normName]
  for (const row of group.rows || []) {
    for (const a of Array.isArray(row.aliases) ? row.aliases : []) {
      const nk = normalizeName(a)
      if (nk) keys.push(nk)
    }
  }
  return keys.map((k) => ({ key: k, normName: group.normName }))
}

function resolveLine(line, ctx) {
  const src = line || {}
  const itemName = String(src.itemName || '').trim()
  const qty = Number(src.qty)
  const materialIndex = (ctx && ctx.materialIndex) || { groups: {}, keys: [] }
  const packagingIndex = (ctx && ctx.packagingIndex) || { groups: {}, keys: [] }
  const requirePackaging = !(ctx && ctx.requirePackaging === false)

  /**
   * 手工费率的取值优先级（蓝图裁决 8 + v1.2 追加）：
   *   ① 行级 `line.laborRatePct`（**显式传了就用它，包括显式传 0**）
   *   ② 单据级 `ctx.laborRatePct`（页面上的「本单手工费率」，默认带出全局配置值）
   *
   * ⚠️ 这里**不能用真值判断**（`src.laborRatePct ? … : …`）：
   *    `0` 是合法费率（这一行不收手工费），用真值判断会把它当成「没传」而回落到单据级，
   *    于是「免手工费的行」被静默加价。守卫 `test:studio-pricing` 的 G5 钉住这一点。
   */
  const hasLineRate =
    src.laborRatePct !== undefined && src.laborRatePct !== null && src.laborRatePct !== ''
  const laborRatePct = normalizeRate(hasLineRate ? src.laborRatePct : ctx && ctx.laborRatePct)
  const laborRateSource = hasLineRate ? 'line' : 'shipment'

  if (!itemName) return emptyLine(PRICING_STATUS.UNMATCHED, '品名为空', { qty: 0 })
  if (!isPositiveInt(qty)) {
    return emptyLine(PRICING_STATUS.UNMATCHED, `数量非法：${src.qty}`, { itemName, qty: 0 })
  }

  const input = normalizeName(itemName)

  /**
   * ① 材料：**显式选择优先**，其次才是文本最长前缀命中。
   *
   * 编辑页（裁决 24）允许人手选材料。显式选择必须能绕过文本：
   * 否则「原文只有 `华艳色蟌`、人给它选了包装」这种情况永远算不出价。
   */
  const wantMaterialId = String(src.materialId || '').trim()
  const wantMaterialName = String(src.materialName || '').trim()
  let matGroup = null
  let matKey = ''
  if (wantMaterialId || wantMaterialName) {
    matGroup = findExplicitGroup(materialIndex, { id: wantMaterialId, name: wantMaterialName })
    if (!matGroup) {
      return emptyLine(
        PRICING_STATUS.UNMATCHED,
        `指定的原材料不在价目表里（可能已停用）：${wantMaterialName || wantMaterialId}`,
        { itemName, qty }
      )
    }
    // 原文里若还带着这个材料名（或其别名），去掉它，好让后面的包装/尺寸文本仍能用
    const own = longestPrefix(input, ownKeysOf(matGroup))
    matKey = own ? own.key : ''
  } else {
    const matHit = longestPrefix(input, materialIndex.keys)
    if (!matHit) {
      return emptyLine(PRICING_STATUS.UNMATCHED, '未找到原材料', { itemName, qty })
    }
    matGroup = materialIndex.groups[matHit.normName]
    matKey = matHit.key
  }
  let residual = matKey ? input.slice(matKey.length) : input

  // ② 等级：先看文本里写了没有；没写就用**显式等级或默认行**（蓝图裁决 2/15）
  let grade = ''
  const gradeInText = matchOption(residual, matGroup)
  if (gradeInText) {
    grade = gradeInText
    residual = residual.replace(gradeInText, '')
  } else if (src.gradeHint || src.materialGrade) {
    grade = normalizeName(normGrade(src.gradeHint || src.materialGrade))
  }
  /**
   * 显式等级若不在该材料已配等级里，**报红而不是静默用默认行**。
   *
   * ⚠️ 这里原先写的是 `if (!materialRow) materialRow = matGroup.defaultRow` ——
   * 于是「显式选了 A2、但价目表里没有 A2」会**静默按默认等级的价算钱**。
   * 同一段代码在**尺寸**那边（步骤 ④）明确拒绝这种静默回落，注释原话：
   *   「显式尺寸若不在该包装已配规格里，报红而不是静默用默认行 —— 否则用户以为选了 15*8，实际按 20*10 算钱」。
   * 等级与尺寸是同一件事（都是"这一行的区分维度"，蓝图裁决 31），**两边必须同一态度**。
   *
   * 未写等级（`grade === ''`）仍走默认行 —— 那是默认行存在的唯一理由。
   */
  let materialRow = null
  if (grade) {
    materialRow = matGroup.byOption[grade]
    if (!materialRow) {
      return emptyLine(PRICING_STATUS.UNMATCHED, `「${matGroup.displayName}」没有等级 ${grade}`, {
        itemName,
        qty
      })
    }
  } else {
    materialRow = matGroup.defaultRow
  }
  if (!materialRow) {
    return emptyLine(PRICING_STATUS.UNMATCHED, `「${matGroup.displayName}」没有可用等级行`, {
      itemName,
      qty
    })
  }

  // ③ 包装：**显式选择优先**；否则在剩余串里取最长命中。
  //    真实文本里尺寸可能写在包装名**前**或**后**，所以前缀/后缀两种都试。
  let packagingRow = null
  let pkgGroup = null
  let sizeInText = ''
  let leftover = residual
  let packagingFromText = false

  const wantPackagingId = String(src.packagingId || '').trim()
  const wantPackagingName = String(src.packagingName || '').trim()

  if (wantPackagingId || wantPackagingName) {
    pkgGroup = findExplicitGroup(packagingIndex, { id: wantPackagingId, name: wantPackagingName })
    if (!pkgGroup) {
      return emptyLine(
        PRICING_STATUS.UNMATCHED,
        `指定的包装方式不在价目表里（可能已停用）：${wantPackagingName || wantPackagingId}`,
        {
          itemName,
          qty,
          materialId: materialRow._id || '',
          materialName: matGroup.displayName,
          materialGrade: materialRow[matGroup.optionField] || ''
        }
      )
    }
    // 原文里若也写了包装名，先去掉（剩下的才是尺寸文本）
    const own = longestPrefix(leftover, ownKeysOf(pkgGroup)) || longestSuffix(leftover, ownKeysOf(pkgGroup))
    if (own) {
      leftover = own.key.length && leftover.startsWith(own.key)
        ? leftover.slice(own.key.length)
        : leftover.slice(0, Math.max(0, leftover.length - own.key.length))
    }
  } else if (!residual) {
    if (requirePackaging) {
      return emptyLine(PRICING_STATUS.UNMATCHED, `未写包装方式（原文「${itemName}」只剩材料名）`, {
        itemName,
        qty,
        materialId: materialRow._id || '',
        materialName: matGroup.displayName,
        materialGrade: materialRow[matGroup.optionField] || ''
      })
    }
  } else {
    const pkgPre = longestPrefix(residual, packagingIndex.keys)
    const pkgSuf = longestSuffix(residual, packagingIndex.keys)
    const candidates = []
    if (pkgPre) candidates.push({ hit: pkgPre, side: 'pre' })
    if (pkgSuf) candidates.push({ hit: pkgSuf, side: 'suf' })
    if (!candidates.length) {
      return emptyLine(PRICING_STATUS.UNMATCHED, `未找到包装方式（残留「${residual}」）`, {
        itemName,
        qty,
        materialId: materialRow._id || '',
        materialName: matGroup.displayName,
        materialGrade: materialRow[matGroup.optionField] || ''
      })
    }
    // 取最长；前后缀命中同一个键时优先后缀（「玻璃罩20*10」把尺寸写在包装名后面更常见）
    candidates.sort((a, b) => {
      if (b.hit.key.length !== a.hit.key.length) return b.hit.key.length - a.hit.key.length
      return a.side === 'suf' ? -1 : 1
    })
    const chosen = candidates[0]
    pkgGroup = packagingIndex.groups[chosen.hit.normName]
    packagingFromText = true
    leftover =
      chosen.side === 'pre'
        ? residual.slice(chosen.hit.key.length)
        : residual.slice(0, residual.length - chosen.hit.key.length)
  }

  if (pkgGroup) {
    // ④ 尺寸：包装名之外剩下的就是尺寸文本（没写就用显式尺寸或默认行）
    sizeInText =
      matchOption(leftover, pkgGroup) ||
      (src.sizeHint || src.packagingSize ? normalizeName(normSize(src.sizeHint || src.packagingSize)) : '')
    const unresolved = sizeInText ? leftover.replace(sizeInText, '') : leftover
    /**
     * 残余校验**只在包装来自文本匹配时**做。
     * 若包装是用户显式选的，说明他已经决定了这一行怎么包 —— 此时原文里的残留文字
     * 不该再被判成「残留未识别」而把用户的决定顶回去（裁决 24）。
     */
    if (unresolved && packagingFromText) {
      return emptyLine(PRICING_STATUS.AMBIGUOUS, `残留未识别：${unresolved}`, {
        itemName,
        qty,
        materialId: materialRow._id || '',
        materialName: matGroup.displayName,
        materialGrade: materialRow[matGroup.optionField] || '',
        packagingName: pkgGroup.displayName
      })
    }
    // 显式尺寸若不在该包装已配规格里，报红而不是静默用默认行 —— 否则用户以为选了 15*8，实际按 20*10 算钱
    if (sizeInText && !pkgGroup.byOption[sizeInText]) {
      return emptyLine(PRICING_STATUS.UNMATCHED, `「${pkgGroup.displayName}」没有规格 ${sizeInText}`, {
        itemName,
        qty,
        materialId: materialRow._id || '',
        materialName: matGroup.displayName,
        materialGrade: materialRow[matGroup.optionField] || '',
        packagingName: pkgGroup.displayName
      })
    }
    packagingRow = sizeInText ? pkgGroup.byOption[sizeInText] : pkgGroup.defaultRow
    if (!packagingRow) packagingRow = pkgGroup.defaultRow
    if (!packagingRow) {
      return emptyLine(PRICING_STATUS.UNMATCHED, `「${pkgGroup.displayName}」没有可用尺寸行`, {
        itemName,
        qty,
        materialId: materialRow._id || '',
        materialName: matGroup.displayName,
        materialGrade: materialRow[matGroup.optionField] || ''
      })
    }
  } else if (requirePackaging) {
    // 走不到这里（上面 residual 为空已提前返回）；保留兜底以免将来改逻辑漏掉
    return emptyLine(PRICING_STATUS.UNMATCHED, '未写包装方式', { itemName, qty })
  }

  // ⑤ 算钱：全程「分」整数运算
  const amounts = computeAmounts({
    materialUnitPrice: materialRow.unitPrice,
    materialQtyPerUnit: materialRow.qtyPerUnit,
    packagingUnitPrice: packagingRow ? packagingRow.unitPrice : 0,
    packagingQtyPerUnit: packagingRow ? packagingRow.qtyPerUnit : 0,
    qty,
    laborRatePct
  })

  return {
    pricingStatus: PRICING_STATUS.PRICED,
    pricingNote: '',
    itemName,
    qty,
    materialId: materialRow._id || '',
    materialName: matGroup.displayName,
    materialGrade: materialRow[matGroup.optionField] || '',
    packagingId: packagingRow ? packagingRow._id || '' : '',
    packagingName: pkgGroup ? pkgGroup.displayName : '',
    packagingSize: packagingRow ? packagingRow[pkgGroup.optionField] || '' : '',
    unitMaterialCostCents: amounts.unitMaterialCostCents,
    unitPackagingCostCents: amounts.unitPackagingCostCents,
    unitLaborCostCents: amounts.unitLaborCostCents,
    unitTotalCents: amounts.unitTotalCents,
    lineTotalCents: amounts.lineTotalCents,
    unitPrice: amounts.unitPrice,
    totalPrice: amounts.totalPrice,
    // 本行**实际生效**的费率与来源 —— 落库留痕用，账单对账时要能说清这一行按几个点算的
    laborRatePct,
    laborRateSource
  }
}

/**
 * 金额计算（**全部以分为单位的整数**）。
 *
 * 口径（蓝图 §5.4，产品负责人确认）：
 *   · 先算**单件**成本并取整到分，再乘数量 → 保证 `unitPrice × qty === totalPrice` 精确成立；
 *   · 手工费 = （单件材料费 + 单件包装费）× 费率，按件取整；
 *   · 若按整行一次性算，4 件单会出现「单价 × 4 ≠ 总价」差 1 分，对账时说不清。
 *
 * @returns {{unitMaterialCostCents:number, unitPackagingCostCents:number, unitLaborCostCents:number,
 *            unitTotalCents:number, lineTotalCents:number, unitPrice:number, totalPrice:number}}
 *          `unit*Cents` 为**分/件**；`lineTotalCents` 为**分/行**（= unitTotalCents × qty）；
 *          `unitPrice`/`totalPrice` 为**元**（沿用既有字段语义）。
 */
function computeAmounts(input) {
  const src = input || {}
  const qty = Number(src.qty)
  const unitQty = isPositiveInt(qty) ? qty : 0
  const rate = normalizeRate(src.laborRatePct)

  const perUnitMaterial = toCents(src.materialUnitPrice) * normalizeQtyPerUnit(src.materialQtyPerUnit)
  const perUnitPackaging = toCents(src.packagingUnitPrice) * normalizeQtyPerUnit(src.packagingQtyPerUnit)
  const perUnitLabor = Math.round(((perUnitMaterial + perUnitPackaging) * rate) / 100)
  const perUnitTotal = perUnitMaterial + perUnitPackaging + perUnitLabor

  return {
    // 分/件
    unitMaterialCostCents: perUnitMaterial,
    unitPackagingCostCents: perUnitPackaging,
    unitLaborCostCents: perUnitLabor,
    unitTotalCents: perUnitTotal,
    // 分/行
    lineTotalCents: perUnitTotal * unitQty,
    // 元/件（整数分除 100 必然精确到分，不会出现浮点尾数）
    unitPrice: toYuan(perUnitTotal),
    // 元/行
    totalPrice: toYuan(perUnitTotal * unitQty)
  }
}

/**
 * 整批算价。返回逐行结果 + 单据级汇总。
 *
 * 两条重要口径：
 *   · **金额只累加已核价行**（未核价行没有价，不能当 0 参与合计）；
 *   · 但 **`totalQty` 统计全部行** —— 单据的「件数」是实际发了多少件，
 *     与「算得出来多少钱」是两件事（蓝图 §5.6）。已核价件数另给 `pricedQty`。
 *   · 只要有非 priced 行就标记 `incomplete`（蓝图裁决 5 → 阻塞结算）。
 *
 * 单位：`*Cents` 全为**分**；`totalAmount` 为**元**（沿用 `ops_shipments.totalAmount` 既有语义）。
 */
function quoteLines(lines, ctx) {
  const list = Array.isArray(lines) ? lines : []
  const out = []
  let materialCents = 0
  let packagingCents = 0
  let laborCents = 0
  let totalCents = 0
  let totalQty = 0
  let pricedQty = 0
  let pricedCount = 0
  let issueCount = 0
  let laborRateOverrideLines = 0

  for (const line of list) {
    const r = resolveLine(line, ctx)
    out.push(r)
    totalQty += isPositiveInt(r.qty) ? r.qty : 0
    if (r.pricingStatus === PRICING_STATUS.PRICED) {
      pricedCount += 1
      if (r.laborRateSource === 'line') laborRateOverrideLines += 1
      pricedQty += r.qty
      // ⚠️ unit* 是「分/件」要乘数量；lineTotalCents 已是「分/行」**不能再乘**（乘了就正好翻倍）
      materialCents += r.unitMaterialCostCents * r.qty
      packagingCents += r.unitPackagingCostCents * r.qty
      laborCents += r.unitLaborCostCents * r.qty
      totalCents += r.lineTotalCents
    } else {
      issueCount += 1
    }
  }

  return {
    lines: out,
    pricingStatus: issueCount > 0 ? SHIPMENT_PRICING_STATUS.INCOMPLETE : SHIPMENT_PRICING_STATUS.PRICED,
    // 分（审计精确）
    materialCostCents: materialCents,
    packagingCostCents: packagingCents,
    laborCostCents: laborCents,
    totalCents,
    // 元（落库/展示，与既有字段同单位）
    totalAmount: toYuan(totalCents),
    // 本单生效的费率与「有几行单独覆盖过」—— 账单页要能一眼看出这单的手工费不是一个统一比例
    laborRatePct: normalizeRate(ctx && ctx.laborRatePct),
    laborRateOverrideLines,
    lineCount: out.length,
    pricedCount,
    issueCount,
    totalQty,
    pricedQty
  }
}

/**
 * 「重算历史单」的可重算判定（纯函数，裁决 16 + 蓝图 §5.5）。
 *
 * ⚠️ 这是**钱的安全边界**，四条禁止都必须是硬拒绝而不是"顺手也算了"：
 *   · **已结清**的单永不重算 —— 钱已经确认收过，事后改金额等于改账；
 *   · **已入账单**的单不许重算 —— 它的金额已经被汇总进账单总额，
 *     单独改一张会让账单总额与明细对不上（要改先作废/撤回那张账单）；
 *   · **已取消**的单跳过（业务上不成立）；
 *   · **已删除**的单跳过。
 *
 * @returns {{eligible:Array, skipped:Array<{_id:string,shipmentNo:string,code:string,msg:string}>}}
 */
function buildRepricePlan(rows) {
  const list = Array.isArray(rows) ? rows : []
  const eligible = []
  const skipped = []
  const skip = (row, code, msg) =>
    skipped.push({ _id: (row && row._id) || '', shipmentNo: (row && row.shipmentNo) || '', code, msg })

  for (const row of list) {
    if (!row || !row._id) {
      skip(row, 'NO_ID', '缺少 id')
      continue
    }
    if (row.deleted === true) {
      skip(row, 'DELETED', '已删除')
      continue
    }
    if (String(row.status || '') === 'cancelled') {
      skip(row, 'CANCELLED', '已取消')
      continue
    }
    if (String(row.settleStatus || '') === 'settled') {
      skip(row, 'SETTLED', '已结清，永不重算')
      continue
    }
    if (String(row.billId || '')) {
      skip(row, 'IN_BILL', '已入账单，需先作废该账单再重算')
      continue
    }
    eligible.push(row)
  }
  return { eligible, skipped }
}

/**
 * 价目表完整性校验。
 * 既给守卫 `check-price-book-integrity` 用，也在云函数保存前跑一遍 —— 脏数据不许进库。
 */
function validatePriceBook(input) {
  const src = input || {}
  const errors = []
  const materials = Array.isArray(src.materials) ? src.materials : []
  const packagings = Array.isArray(src.packagings) ? src.packagings : []

  const check = (rows, opts, label) => {
    const idx = buildPriceIndex(rows, opts)
    idx.errors.forEach((e) => errors.push(Object.assign({ book: label }, e)))

    const seen = {}
    rows.forEach((row, i) => {
      const name = String(row[opts.keyField] || '').trim()
      if (!name) return
      const nk = normalizeName(row.normName || name)
      const opt = normalizeName(
        opts.optionField === 'size' ? normSize(row[opts.optionField]) : normGrade(row[opts.optionField])
      )
      const dupKey = `${nk}|${opt}`
      if (seen[dupKey]) {
        errors.push({
          book: label,
          code: 'DUPLICATE_ROW',
          name,
          msg: `「${name}」+ ${opts.optionField}=${row[opts.optionField] || '默认'} 重复（第 ${seen[dupKey]} 行与第 ${i + 1} 行）`
        })
      } else {
        seen[dupKey] = i + 1
      }
      const price = Number(row.unitPrice)
      if (!Number.isFinite(price) || price < 0) {
        errors.push({ book: label, code: 'BAD_PRICE', name, msg: `「${name}」单价非法：${row.unitPrice}` })
      }
      if (row.qtyPerUnit != null && !(Number(row.qtyPerUnit) > 0)) {
        errors.push({ book: label, code: 'BAD_QTY_PER_UNIT', name, msg: `「${name}」qtyPerUnit 必须 > 0` })
      }
    })
  }

  check(materials, { keyField: 'name', defaultFlagKey: 'isDefaultGrade', optionField: 'grade' }, 'material')
  check(packagings, { keyField: 'name', defaultFlagKey: 'isDefaultSize', optionField: 'size' }, 'packaging')

  return { ok: errors.length === 0, errors }
}

/** 建一个可复用的算价上下文（云函数里一次请求建一次，多行复用） */
function buildContext(input) {
  const src = input || {}
  return {
    materialIndex: buildPriceIndex(src.materials, {
      keyField: 'name',
      defaultFlagKey: 'isDefaultGrade',
      optionField: 'grade'
    }),
    packagingIndex: buildPriceIndex(src.packagings, {
      keyField: 'name',
      defaultFlagKey: 'isDefaultSize',
      optionField: 'size'
    }),
    laborRatePct: src.laborRatePct,
    requirePackaging: src.requirePackaging !== false
  }
}

module.exports = {
  PRICING_STATUS,
  SHIPMENT_PRICING_STATUS,
  DEFAULT_GRADE,
  DEFAULT_SIZE,
  normalizeName,
  normGrade,
  normSize,
  toCents,
  toYuan,
  normalizeQtyPerUnit,
  buildPriceIndex,
  longestPrefix,
  longestSuffix,
  matchOption,
  resolveLine,
  computeAmounts,
  quoteLines,
  validatePriceBook,
  buildRepricePlan,
  buildContext
}
