#!/usr/bin/env node
/**
 * 订单状态枚举守卫（契约 C3 §6.2「守卫 1」，2026-09-19 新立）
 *
 * 为什么需要（契约 C3 §6.1 实测结论）：
 *   现有 3 条 order 域守卫（check:order-summary / test:pickup-pass / test:checkout-addon）
 *   对 `orders.status` **状态机零覆盖** —— 它们分别钉「站内信渲染粒度」「自取轮询收口」「加购定价」。
 *   没有这条守卫，「幽灵状态删对了且没删漏」无法被证明（错题本 E7 / E16）。
 *
 * 判据（每条都有对应的 --selftest 注入；判据全部来自契约 C3 + 源码，无自造）：
 *   A. **唯一事实源双向对账**：`miniprogram/cloudfunctions/**` 里所有写入 `orders.status` 的字面量
 *      必须与 `lib/orderStatusAllowed.json` 的 `in_use` **互为子集**。写入形状覆盖三种（契约 §1.0）：
 *         ① `status: 'x'`；② `const v = ... ? 'x' : 'y'` + `status: v`（`ready_pickup` 就是这种）；
 *         ③ `data: someObj` 动态载荷 + `someObj.status = 'x'` 赋值（`aftersales` / 工坊推进是这种）。
 *        A1 写入值 ⊆ in_use（新造/漂移值 → 红）
 *        A2 in_use ⊆ 写入值（声明在用却**零写入方** → 它其实是幽灵 → 红）
 *   B. **幽灵不得被写入**：`ghosts` / `suspected_ghosts` / `typo_relics` 出现在写载荷 → 红。
 *      （契约 §5① 裁决 `refund_rejected` 不是合法取值；§8.2 Q1 对 cancelled/closed/signed 未拍板
 *       → 本守卫只钉「不得写入」，不替产品负责人决定读分支去留。）
 *   C. **枚举副本逐例比对**（契约 §6.2 判据 2「有副本就逐例比对」）：
 *        C1 4 份 `orderStatus.js` 的枚举内容（ORDER_STATUS / ORDER_STATUS_LABEL 键集 / GMV_STATUSES）必须一致；
 *        C2 3 份 `segmentation.js` 的 `VALID_ORDER_STATUS` 必须一致；
 *        C3 各副本（客户端 4 文件、云函数具名状态集、orders 链 where 条件、CRM 状态标签、幽灵邻接白名单）
 *           里的每个值必须落在「全域」= in_use ∪ ghosts ∪ suspected_ghosts ∪ typo_relics 内。
 *   D. **客户端零直写**：`miniprogram/**`（cloudfunctions 之外）不得出现 orders 的 add/update/set/remove
 *      —— 这是「枚举写入方只能来自服务端」的前提（契约 §1.4 实测）。
 *   E. **覆盖面上报（E16）**：打印 云函数目录数 / js 文件数 / orders 写调用点数 / 命中字面量数，
 *      并断言扫描范围 = 云函数下**全部** js 文件（不是只有 index.js），且 `ready_pickup` 必须由
 *      **变量式形状**命中（它只在两个 `fulfillOrder.js` 的 `nextStatus` 三元里赋值）
 *      —— 这条直接钉死「只扫 index.js」的漏扫（契约 §6.2 注入 I3）。
 *   F. **幽灵出现处棘轮**：幽灵/拼写残留值在**订单域枚举位置**的出现次数**只许减不许增**
 *      （清理动作见契约 §4.2 M1–M13；M1–M3 需集成官裁决、M12/M13 属 erp 流 → 当前冻结既存）。
 *   G. **判据覆盖不到 → exit 2**：出现守卫不认识的写载荷形状、或事实源/声明副本缺失 → `exit 2`（E16：
 *      无法判定**不是**通过）。
 *
 * 用法：
 *   node miniprogram/scripts/check-order-status-enum.mjs
 *   node miniprogram/scripts/check-order-status-enum.mjs --selftest
 *   node miniprogram/scripts/check-order-status-enum.mjs --report                  # 只打印事实表，不判定
 *   node miniprogram/scripts/check-order-status-enum.mjs --print-ghost-baseline    # 重算棘轮基线
 * 退出码：0 通过；1 判据不成立；2 无法判定（非 0 —— 不会被汇总表当成 ✓）。
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HERE, '..', '..')
export const MP = join(ROOT, 'miniprogram')
export const CF = join(MP, 'cloudfunctions')
export const MANIFEST_PATH = join(HERE, 'lib', 'orderStatusAllowed.json')

const REL = (p) => relative(ROOT, p).replace(/\\/g, '/')
export { REL }
const SKIP_DIRS = new Set(['node_modules', 'miniprogram_npm', '.git', 'dist'])
const isJs = (p) => p.endsWith('.js')

// ── 源码读取：注释置空但**保留换行**，行号与源文件一致 ───────────────────────
export function blankComments(src) {
  let out = ''
  let i = 0
  const n = src.length
  let state = 'code'
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; out += '  '; i += 2; continue }
      if (c === '/' && d === '*') { state = 'block'; out += '  '; i += 2; continue }
      if (c === '"' || c === "'" || c === '`') { state = c; out += c; i += 1; continue }
      out += c; i += 1; continue
    }
    if (state === 'line') { if (c === '\n') { state = 'code'; out += c } else out += ' '; i += 1; continue }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; out += '  '; i += 2; continue }
      out += c === '\n' ? '\n' : ' '
      i += 1
      continue
    }
    if (c === '\\') { out += c + (d || ''); i += 2; continue }
    if (c === state) state = 'code'
    out += c
    i += 1
  }
  return out
}

export const lineAt = (s, i) => s.slice(0, i).split('\n').length
export const skipWs = (s, i) => { while (i < s.length && /\s/.test(s[i])) i += 1; return i }

/** 从开括号下标返回其配对括号之后的下标；-1 表示没配平 */
export function matchBracket(src, openIdx) {
  const open = src[openIdx]
  const close = open === '(' ? ')' : open === '{' ? '}' : ']'
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j += 1; j += 1 }
      i = j
      continue
    }
    if (c === open) depth += 1
    else if (c === close) { depth -= 1; if (depth === 0) return i + 1 }
  }
  return -1
}

export function walkFiles(dir, filter, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
    const p = join(dir, name)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walkFiles(p, filter, out)
    else if (filter(p)) out.push(p)
  }
  return out
}

export const allCloudFnJs = () => walkFiles(CF, isJs).sort()

// ── 链式调用 walk：`db.collection('orders')` → 跳过 .doc/.where/... → 写动词 ──
const SKIP_VERBS = new Set(['doc', 'where', 'orderBy', 'limit', 'skip', 'field', 'aggregate', 'groupBy'])
const READ_VERBS = new Set(['get', 'count', 'watch'])
const WRITE_VERBS = new Set(['add', 'update', 'set', 'remove'])

export function chainCalls(blanked, startIdx) {
  const calls = []
  let i = startIdx
  for (let guard = 0; guard < 16; guard++) {
    i = skipWs(blanked, i)
    if (blanked[i] !== '.') return calls
    i += 1
    const m = /^[A-Za-z_$][\w$]*/.exec(blanked.slice(i, i + 32))
    if (!m) return calls
    const verb = m[0]
    i += verb.length
    i = skipWs(blanked, i)
    if (blanked[i] !== '(') return calls
    const end = matchBracket(blanked, i)
    if (end < 0) return calls
    calls.push({ verb, args: blanked.slice(i + 1, end - 1), argStart: i + 1 })
    if (WRITE_VERBS.has(verb) || READ_VERBS.has(verb) || !SKIP_VERBS.has(verb)) return calls
    i = end
  }
  return calls
}

// ── `const NAME = <init>` 的解引用 ─────────────────────────────────────────
const CONTINUE_NEXT = /^[?:.,+\-*/&|=)\]}]/
export function resolveInit(blanked, name) {
  const re = new RegExp(`(?:const|let|var)\\s+${name}\\s*=`, 'g')
  const m = re.exec(blanked)
  if (!m) return null
  const start = skipWs(blanked, m.index + m[0].length)
  if (blanked[start] === '{') {
    const end = matchBracket(blanked, start)
    return { text: blanked.slice(start, end < 0 ? blanked.length : end), start }
  }
  let i = start
  let depth = 0
  let end = -1
  while (i < blanked.length) {
    const c = blanked[i]
    if (c === '"' || c === "'" || c === '`') {
      i += 1
      while (i < blanked.length && blanked[i] !== c) { if (blanked[i] === '\\') i += 1; i += 1 }
      i += 1
      continue
    }
    if ('([{'.includes(c)) depth += 1
    else if (')]}'.includes(c)) { if (depth === 0) { end = i; break } depth -= 1 } else if (c === ';' && depth === 0) { end = i; break } else if (c === '\n' && depth === 0) {
      const j = skipWs(blanked, i)
      if (CONTINUE_NEXT.test(blanked.slice(j, j + 1))) { i += 1; continue }
      end = i
      break
    }
    i += 1
  }
  if (end < 0) end = blanked.length
  return { text: blanked.slice(start, end), start }
}

/**
 * 状态值表达式里的字面量。丢掉**比较运算的操作数** ——
 * `const status = type === 'goods' ? 'paid' : 'unverified'` 里的 `'goods'` 是类型不是状态（E7 假失败防线）。
 */
export function valueLiterals(expr) {
  const out = []
  for (const m of expr.matchAll(/'([^']*)'|"([^"]*)"/g)) {
    const v = m[1] != null ? m[1] : m[2]
    if (!/^[a-z_]+$/.test(v)) continue
    const before = expr.slice(Math.max(0, m.index - 6), m.index)
    const after = expr.slice(m.index + m[0].length, m.index + m[0].length + 6)
    if (/(===|!==|==|!=)\s*$/.test(before)) continue
    if (/^\s*(===|!==|==|!=)/.test(after)) continue
    out.push({ value: v, idx: m.index })
  }
  return out
}

/** 对象字面量载荷里的 status 条目（含 `status: <ident>` 解引用 / 三目 / 简写 `status,`） */
export function objectStatusEntries(text, blanked, baseIdx) {
  const out = []
  for (const m of text.matchAll(/(?:[{,]|^\s*)\s*status\s*:\s*/gm)) {
    const vStart = m.index + m[0].length
    let i = vStart
    let depth = 0
    while (i < text.length) {
      const c = text[i]
      if (c === '"' || c === "'" || c === '`') {
        i += 1
        while (i < text.length && text[i] !== c) { if (text[i] === '\\') i += 1; i += 1 }
        i += 1
        continue
      }
      if ('([{'.includes(c)) depth += 1
      else if (')]}'.includes(c)) { if (depth === 0 && c === '}') break; depth -= 1 }
      if (depth === 0 && (c === ',' || c === '}')) break
      i += 1
    }
    const expr = text.slice(vStart, i)
    const abs = baseIdx + vStart
    const trimmed = expr.trim()
    if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
      const init = resolveInit(blanked, trimmed)
      if (init) {
        for (const l of valueLiterals(init.text)) out.push({ value: l.value, line: lineAt(blanked, init.start + l.idx), via: trimmed })
      } else {
        out.push({ value: null, ident: trimmed, line: lineAt(blanked, abs), via: 'unresolved-ident' })
      }
    } else {
      const lits = valueLiterals(expr)
      if (lits.length) for (const l of lits) out.push({ value: l.value, line: lineAt(blanked, abs + l.idx), via: 'expr' })
      else out.push({ value: null, ident: trimmed.slice(0, 40), line: lineAt(blanked, abs), via: 'unresolved-expr' })
    }
  }
  for (const m of text.matchAll(/(?:[{,])\s*status\s*[,}]/g)) {
    const init = resolveInit(blanked, 'status')
    if (init) for (const l of valueLiterals(init.text)) out.push({ value: l.value, line: lineAt(blanked, init.start + l.idx), via: 'shorthand' })
    else out.push({ value: null, ident: 'status', line: lineAt(blanked, baseIdx + m.index), via: 'unresolved-shorthand' })
  }
  return out
}

/** `IDENT.status = 'x'` 赋值（`managerShipOrder.advanceProduction` 是这种形状） */
export function statusAssignments(blanked, ident) {
  const out = []
  const re = new RegExp(`${ident}\\.status\\s*=\\s*('([a-z_]+)'|"([a-z_]+)")`, 'g')
  for (const m of blanked.matchAll(re)) out.push({ value: m[2] || m[3], line: lineAt(blanked, m.index), via: `${ident}.status=` })
  return out
}

// ── 扫描 1：orders 写载荷 → status 值 ──────────────────────────────────────
const ORDERS_RE = /\.collection\(\s*['"]orders['"]\s*\)/g
const ORDERS_RE2 = () => new RegExp(ORDERS_RE.source, 'g')

export function collectOrdersWrites(files = allCloudFnJs()) {
  const writes = []
  const unresolved = []
  for (const abs of files) {
    let raw
    try { raw = readFileSync(abs, 'utf8') } catch { continue }
    const b = blankComments(raw)
    const rel = REL(abs)
    for (const cm of b.matchAll(ORDERS_RE2())) {
      const calls = chainCalls(b, cm.index + cm[0].length)
      const write = calls[calls.length - 1]
      if (!write || !WRITE_VERBS.has(write.verb)) continue
      const collectionLine = lineAt(b, cm.index)
      const entries = []
      const dm = /(?:^|[{,])\s*data\s*:\s*/.exec(write.args)
      if (dm) {
        const vStart = dm.index + dm[0].length
        if (write.args[vStart] === '{') {
          const end = matchBracket(write.args, vStart)
          entries.push(...objectStatusEntries(write.args.slice(vStart, end - 1), b, write.argStart + vStart))
        } else {
          const m2 = /^([A-Za-z_$][\w$]*)/.exec(write.args.slice(vStart))
          if (!m2) {
            unresolved.push({ file: rel, line: collectionLine, reason: 'data 载荷既不是对象字面量也不是标识符' })
          } else {
            const init = resolveInit(b, m2[1])
            if (init && init.text.trimStart().startsWith('{')) {
              entries.push(...objectStatusEntries(init.text, b, init.start))
              entries.push(...statusAssignments(b, m2[1]))
            } else if (init) {
              unresolved.push({ file: rel, line: collectionLine, reason: `data 载荷 \`${m2[1]}\` 的解引用不是对象字面量` })
            } else {
              unresolved.push({ file: rel, line: collectionLine, reason: `data 载荷 \`${m2[1]}\` 找不到 const/let/var 声明` })
            }
          }
        }
      }
      for (const e of entries) {
        if (e.value == null) unresolved.push({ file: rel, line: e.line, reason: `status 值形状无法解引用（${e.via}${e.ident ? ':' + e.ident : ''}）` })
      }
      writes.push({ file: rel, collectionLine, verb: write.verb, statuses: entries.filter((e) => e.value != null) })
    }
  }
  const dirs = new Set(files.map((f) => REL(f).split('/').slice(0, 3).join('/')))
  return {
    writes,
    unresolved,
    stats: {
      dirs: dirs.size,
      files: files.length,
      callSites: writes.length,
      writesWithStatus: writes.filter((w) => w.statuses.length).length,
      statusLiterals: writes.reduce((n, w) => n + w.statuses.length, 0)
    }
  }
}

/** 扫描 2：orders 链的 where/写载荷里的状态副本（读侧白名单） */
export function collectOrdersQueryStatuses(files = allCloudFnJs()) {
  const out = []
  for (const abs of files) {
    let raw
    try { raw = readFileSync(abs, 'utf8') } catch { continue }
    const b = blankComments(raw)
    const rel = REL(abs)
    for (const cm of b.matchAll(ORDERS_RE2())) {
      for (const call of chainCalls(b, cm.index + cm[0].length)) {
        if (!WRITE_VERBS.has(call.verb) && call.verb !== 'where') continue
        for (const m of call.args.matchAll(/(?:^|[{,])\s*status\s*:\s*(?:'([a-z_]+)'|_\.(?:in|nin)\(\s*\[([^\]]*)\]|_\.(?:neq|eq)\(\s*'([a-z_]+)')/g)) {
          const line = lineAt(b, call.argStart + m.index)
          if (m[1]) out.push({ value: m[1], file: rel, line, ctx: `${call.verb}(status)` })
          else if (m[2] != null) for (const s of m[2].matchAll(/'([a-z_]+)'/g)) out.push({ value: s[1], file: rel, line, ctx: `${call.verb}(status _.in[])` })
          else if (m[3]) out.push({ value: m[3], file: rel, line, ctx: `${call.verb}(status _.neq)` })
        }
      }
    }
  }
  return out
}

// ── 扫描 3：客户端/纯文件的状态字面量（这些文件里 `status` 只可能是订单状态）──
export function clientStatusLiterals(relPath) {
  const b = blankComments(readFileSync(join(ROOT, relPath), 'utf8'))
  const out = []
  for (const m of b.matchAll(/(?:[\w$.]*\bstatus\b)\s*(?:===|!==|==|!=)\s*'([a-z_]+)'/g)) out.push({ value: m[1], file: relPath, line: lineAt(b, m.index), ctx: 'status ===' })
  for (const m of b.matchAll(/'([a-z_]+)'\s*(?:===|!==|==|!=)\s*(?:[\w$.]*\bstatus\b)/g)) out.push({ value: m[1], file: relPath, line: lineAt(b, m.index), ctx: '=== status' })
  for (const m of b.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:new\s+Set\s*\(\s*)?\[/g)) {
    if (!/status/i.test(m[1])) continue
    const open = b.indexOf('[', m.index + m[0].length - 1)
    const end = matchBracket(b, open)
    for (const s of b.slice(open, end < 0 ? b.length : end).matchAll(/'([a-z_]+)'/g)) out.push({ value: s[1], file: relPath, line: lineAt(b, open + s.index), ctx: `${m[1]}[]` })
  }
  for (const m of b.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g)) {
    if (!/status/i.test(m[1])) continue
    const open = b.indexOf('{', m.index + m[0].length - 1)
    const end = matchBracket(b, open)
    for (const s of b.slice(open, end < 0 ? b.length : end).matchAll(/(?:^|[{,]\s*)'?([a-z_]+)'?\s*:/g)) out.push({ value: s[1], file: relPath, line: lineAt(b, open + s.index), ctx: `${m[1]}{}` })
  }
  for (const m of b.matchAll(/switch\s*\(\s*[\w$.]*\bstatus\b\s*\)\s*\{/g)) {
    const open = m.index + m[0].length - 1
    const end = matchBracket(b, open)
    for (const s of b.slice(open, end < 0 ? b.length : end).matchAll(/\bcase\s+'([a-z_]+)'\s*:/g)) out.push({ value: s[1], file: relPath, line: lineAt(b, open + s.index), ctx: 'switch(status) case' })
  }
  return out
}

/** 具名状态容器（`const NAME = [...]` / `new Set([...])`，NAME 含 status 或为白名单名） */
export function namedStatusContainers(relPath) {
  const b = blankComments(readFileSync(join(ROOT, relPath), 'utf8'))
  const out = []
  for (const m of b.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:new\s+Set\s*\(\s*)?\[/g)) {
    const allowed = /status/i.test(m[1]) || ['allowFrom', 'allowList', 'allowed'].includes(m[1])
    if (!allowed) continue
    const open = b.indexOf('[', m.index + m[0].length - 1)
    const end = matchBracket(b, open)
    for (const s of b.slice(open, end < 0 ? b.length : end).matchAll(/'([a-z_]+)'/g)) out.push({ value: s[1], file: relPath, line: lineAt(b, open + s.index), ctx: `${m[1]}[]` })
  }
  return out
}

/**
 * 幽灵邻接数组：**只**取「含幽灵/残留值的数组字面量」。这是为了精确抓到
 * `refundOrder` 里 `['refunding','aftersales','refund_approved'].includes(...)` 这类
 * **内联白名单**（它们没有名字，无法用具名容器抽取；而通用「含任意状态值的数组」抽取
 * 会把采购单/发货单的 status 数组当成订单状态 → 假失败，E7 实测过）。
 */
export function ghostAdjacentArrays(files, ghostTokens) {
  const out = []
  for (const abs of files) {
    let raw
    try { raw = readFileSync(abs, 'utf8') } catch { continue }
    const b = blankComments(raw)
    const rel = REL(abs)
    for (const m of b.matchAll(/\[/g)) {
      const prev = b.slice(0, m.index).replace(/\s+$/, '').slice(-1)
      // 数组**字面量**的前一个非空白字符不可能是标识符/`)`/`]`（那是下标访问）
      if (prev && /[\w$)\]]/.test(prev)) continue
      const end = matchBracket(b, m.index)
      if (end < 0) continue
      const body = b.slice(m.index, end)
      if (body.length > 1200) continue
      const lits = [...body.matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
      if (!lits.some((v) => ghostTokens.has(v))) continue
      out.push({ file: rel, line: lineAt(b, m.index), members: lits, ctx: 'inline[]' })
    }
  }
  return out
}

// ── 结构化副本 ──────────────────────────────────────────────────────────────
function extractObjectKeys(src, varName) {
  const b = blankComments(src)
  const m = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*\\{`).exec(b)
  if (!m) return null
  const open = b.indexOf('{', m.index + m[0].length - 1)
  const end = matchBracket(b, open)
  return [...b.slice(open, end < 0 ? b.length : end).matchAll(/(?:^|[{,]\s*)'?([a-z_]+)'?\s*:/g)].map((s) => s[1])
}

function extractStringArray(src, varName) {
  const b = blankComments(src)
  const m = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*\\[`).exec(b)
  if (!m) return null
  const open = b.indexOf('[', m.index + m[0].length - 1)
  const end = matchBracket(b, open)
  return [...b.slice(open, end < 0 ? b.length : end).matchAll(/'([a-z_]+)'/g)].map((s) => s[1])
}

function extractSetMembers(src, varName) {
  const b = blankComments(src)
  const m = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*new\\s+Set\\(\\s*\\[`).exec(b)
  if (!m) return null
  const open = b.indexOf('[', m.index + m[0].length - 1)
  const end = matchBracket(b, open)
  return [...b.slice(open, end < 0 ? b.length : end).matchAll(/'([a-z_]+)'/g)].map((s) => s[1])
}

// ── 扫描入口 ────────────────────────────────────────────────────────────────
export function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) return null
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
}

export function scanAll(opts = {}) {
  const manifest = loadManifest()
  const files = opts.files || allCloudFnJs()
  const writeScan = collectOrdersWrites(files)
  const queryStatuses = collectOrdersQueryStatuses(files)
  const clientFiles = manifest ? manifest.client_status_enum_files || [] : []
  const clientLits = clientFiles.flatMap((f) => (existsSync(join(ROOT, f)) ? clientStatusLiterals(f) : []))
  const containerLits = (manifest ? manifest.named_status_containers || [] : [])
    .filter((f) => existsSync(join(ROOT, f)))
    .flatMap((f) => namedStatusContainers(f))
  const moduleCopies = (manifest ? manifest.order_status_module_copies || [] : []).map((f) => {
    const src = existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : ''
    return {
      file: f,
      exists: !!src,
      ORDER_STATUS: src ? extractObjectKeys(src, 'ORDER_STATUS') : null,
      ORDER_STATUS_LABEL: src ? extractObjectKeys(src, 'ORDER_STATUS_LABEL') : null,
      GMV_STATUSES: src ? extractStringArray(src, 'GMV_STATUSES') : null
    }
  })
  const validStatusCopies = (manifest ? manifest.valid_order_status_copies || [] : []).map((f) => ({
    file: f,
    members: existsSync(join(ROOT, f)) ? extractSetMembers(readFileSync(join(ROOT, f), 'utf8'), 'VALID_ORDER_STATUS') : null
  }))
  const ghostTokens = new Set(manifest ? [...manifest.ghosts, ...manifest.suspected_ghosts, ...manifest.typo_relics] : [])
  // 幽灵邻接数组只在**订单域文件**里找：定义 = 真的触碰过 `db.collection('orders')` 的云函数文件。
  // （否则采购单/发货单的 cancelled/closed 数组会被算进来，他流改自己域就会把我的棘轮弄红 —— E7 假失败）
  const orderDomainRels = new Set([...writeScan.writes.map((w) => w.file), ...queryStatuses.map((q) => q.file)])
  const inlineGhostArrays = ghostAdjacentArrays(files.filter((f) => orderDomainRels.has(REL(f))), ghostTokens)
  return { manifest, files, writeScan, queryStatuses, clientLits, containerLits, moduleCopies, validStatusCopies, inlineGhostArrays, ghostTokens }
}

/** 幽灵出现处（棘轮口径：只数**订单域枚举位置**，不数异域同名 status，如采购单/发货单） */
export function ghostRefs(scan) {
  const counts = {}
  const add = (value, file) => {
    counts[value] = counts[value] || {}
    counts[value][file] = (counts[value][file] || 0) + 1
  }
  for (const s of scan.queryStatuses) if (scan.ghostTokens.has(s.value)) add(s.value, s.file)
  for (const s of scan.clientLits) if (scan.ghostTokens.has(s.value)) add(s.value, s.file)
  for (const s of scan.containerLits) if (scan.ghostTokens.has(s.value)) add(s.value, s.file)
  for (const c of scan.moduleCopies) {
    if (!c.exists) continue
    for (const k of [...(c.ORDER_STATUS || []), ...(c.ORDER_STATUS_LABEL || []), ...(c.GMV_STATUSES || [])]) {
      if (scan.ghostTokens.has(k)) add(k, c.file)
    }
  }
  for (const a of scan.inlineGhostArrays) for (const v of a.members) if (scan.ghostTokens.has(v)) add(v, a.file)
  return counts
}

// ── 判定 ────────────────────────────────────────────────────────────────────
export function runChecks(opts = {}) {
  const scan = scanAll(opts)
  const m = scan.manifest
  const problems = []
  const undecidable = []
  const notes = []
  if (!m) {
    undecidable.push(`缺事实源 ${REL(MANIFEST_PATH)} —— 没有白名单就无法判定「哪些值是合法状态」`)
    return { problems, undecidable, notes, scan }
  }
  const inUse = new Set(m.in_use)
  const forbidden = new Set([...m.ghosts, ...m.suspected_ghosts, ...m.typo_relics])
  const universe = new Set([...inUse, ...forbidden])

  // G. 判据覆盖不到 → 无法判定（E16）
  for (const u of scan.writeScan.unresolved) undecidable.push(`${u.file}:${u.line} 出现守卫不认识的 orders.status 写载荷形状 —— ${u.reason}`)

  // A / B. 双向对账 + 幽灵零写入
  const written = new Map()
  for (const w of scan.writeScan.writes) {
    for (const st of w.statuses) {
      if (!written.has(st.value)) written.set(st.value, [])
      written.get(st.value).push(`${w.file}:${st.line} .${w.verb}(${st.via})`)
    }
  }
  for (const [v, sites] of written) {
    if (forbidden.has(v)) problems.push(`B. 幽灵/残留状态「${v}」被服务端写入（应为 0 写入方）→ ${sites.join(' , ')}`)
    else if (!inUse.has(v)) problems.push(`A1. 服务端写出「${v}」不在 in_use 白名单里 → ${sites.join(' , ')}（新造值或契约漂移，须先裁决再改白名单）`)
  }
  for (const v of [...inUse].sort()) {
    if (!written.has(v)) problems.push(`A2. in_use 声称「在用」但服务端**零写入方** → ${v}（它其实是幽灵：删白名单，或给出真实写入方）`)
  }

  // C1. orderStatus.js 家族
  const fam = scan.moduleCopies
  if (fam.length < 2) undecidable.push(`orderStatus.js 副本家族只找到 ${fam.length} 份`)
  for (const c of fam) if (!c.exists) undecidable.push(`事实源声明的副本不存在：${c.file}`)
  const live = fam.filter((c) => c.exists)
  const base = live[0]
  if (base) {
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    for (const c of live.slice(1)) {
      if (!eq(c.ORDER_STATUS, base.ORDER_STATUS)) problems.push(`C1. orderStatus.js 副本漂移：${c.file} 的 ORDER_STATUS 与 ${base.file} 不一致`)
      if (!eq(c.ORDER_STATUS_LABEL, base.ORDER_STATUS_LABEL)) problems.push(`C1. orderStatus.js 副本漂移：${c.file} 的 ORDER_STATUS_LABEL 键集与 ${base.file} 不一致`)
      if (!eq(c.GMV_STATUSES, base.GMV_STATUSES)) problems.push(`C1. orderStatus.js 副本漂移：${c.file} 的 GMV_STATUSES 与 ${base.file} 不一致`)
    }
    for (const c of live) {
      for (const k of [...(c.ORDER_STATUS || []), ...(c.ORDER_STATUS_LABEL || []), ...(c.GMV_STATUSES || [])]) {
        if (!universe.has(k)) problems.push(`C3. ${c.file} 出现不在全域内的状态值「${k}」`)
      }
    }
  }

  // C2. segmentation.js 家族
  const seg = scan.validStatusCopies.filter((c) => c.members)
  for (const c of scan.validStatusCopies) if (!c.members) undecidable.push(`VALID_ORDER_STATUS 抽不出来：${c.file}`)
  for (const c of seg.slice(1)) {
    if (JSON.stringify(c.members) !== JSON.stringify(seg[0].members)) {
      problems.push(`C2. VALID_ORDER_STATUS 副本漂移：${c.file}=${JSON.stringify(c.members)} ≠ ${seg[0].file}=${JSON.stringify(seg[0].members)}`)
    }
  }

  // C3. 各副本不得自造值
  for (const lit of scan.clientLits) if (!universe.has(lit.value)) problems.push(`C3. ${lit.file}:${lit.line} 状态字面量「${lit.value}」不在全域内（[${lit.ctx}]）`)
  for (const lit of scan.queryStatuses) if (!universe.has(lit.value)) problems.push(`C3. ${lit.file}:${lit.line} orders 读条件用了未知状态「${lit.value}」（[${lit.ctx}]）`)
  for (const lit of scan.containerLits) if (!universe.has(lit.value)) problems.push(`C3. ${lit.file}:${lit.line} 具名状态集出现未知值「${lit.value}」（[${lit.ctx}]）`)
  for (const a of scan.inlineGhostArrays) {
    for (const v of a.members) if (!universe.has(v)) problems.push(`C3. ${a.file}:${a.line} 内联白名单出现未知值「${v}」（同数组：${a.members.join(',')}）`)
  }
  const crmPath = 'miniprogram/cloudfunctions/manageMemberCrm/index.js'
  if (existsSync(join(ROOT, crmPath))) {
    for (const k of extractObjectKeys(readFileSync(join(ROOT, crmPath), 'utf8'), 'ORDER_STATUS_LABEL') || []) {
      if (!universe.has(k)) problems.push(`C3. ${crmPath} 的 ORDER_STATUS_LABEL 出现不在全域内的键「${k}」`)
    }
  } else undecidable.push(`事实源声明的副本不存在：${crmPath}`)

  // D. 客户端零直写
  const clientWrites = []
  for (const abs of walkFiles(MP, isJs)) {
    const rel = REL(abs)
    if (rel.startsWith('miniprogram/cloudfunctions/')) continue
    const b = blankComments(readFileSync(abs, 'utf8'))
    for (const cm of b.matchAll(ORDERS_RE2())) {
      const calls = chainCalls(b, cm.index + cm[0].length)
      const w = calls[calls.length - 1]
      if (w && WRITE_VERBS.has(w.verb)) clientWrites.push(`${rel}:${lineAt(b, cm.index)} .${w.verb}()`)
    }
  }
  if (clientWrites.length) problems.push(`D. 小程序客户端出现 ${clientWrites.length} 处 orders 直写（orders 线上 write:false；枚举写入方只能来自服务端）→ ${clientWrites.join(' , ')}`)

  // E. 覆盖面（E16）
  const allJs = allCloudFnJs()
  const covered = new Set(scan.files.map((f) => REL(f)))
  const missing = allJs.map(REL).filter((f) => !covered.has(f))
  if (missing.length) problems.push(`E. 扫描范围不是「云函数下全部 js」：漏了 ${missing.length} 个（例：${missing.slice(0, 3).join(' , ')}）—— 只扫 index.js 会漏掉 fulfillOrder.js 的变量式写入`)
  const readySites = written.get('ready_pickup') || []
  if (!readySites.length) problems.push('E. 扫描没命中 ready_pickup —— 变量式写入形状（nextStatus 三元）未被覆盖')
  else if (!readySites.some((x) => !x.includes('(expr)'))) problems.push("E. ready_pickup 只由 `status: 'x'` 同行形状命中 —— 变量式写入形状没被覆盖（它只在 fulfillOrder.js 的三元里赋值）")

  // F. 幽灵出现处棘轮
  const ratchet = (m.ghost_reference_ratchet && m.ghost_reference_ratchet.by_value) || {}
  const actualGhosts = ghostRefs(scan)
  for (const [value, byFile] of Object.entries(actualGhosts)) {
    for (const [file, n] of Object.entries(byFile)) {
      const allowed = (ratchet[value] && ratchet[value][file]) || 0
      if (n > allowed) {
        problems.push(`F. 幽灵/残留状态「${value}」出现次数增加：${file} = ${n} > 基线 ${allowed}（契约 §4.2 的清理只许减少；新增出现处等于把幽灵写回代码。清理后用 --print-ghost-baseline 抬低基线）`)
      }
    }
  }

  return { problems, undecidable, notes, scan, written, universe, actualGhosts }
}

// ── 输出 ────────────────────────────────────────────────────────────────────
export function reportLines(scan, written) {
  const st = scan.writeScan.stats
  const L = []
  L.push(`扫描：${st.dirs} 个云函数目录 / ${st.files} 个 js 文件 / ${st.callSites} 个 orders 写调用点（其中 ${st.writesWithStatus} 个含 status）/ 命中 ${st.statusLiterals} 个状态字面量`)
  L.push(`orders 读条件状态副本 ${scan.queryStatuses.length} 个 · 客户端状态字面量 ${scan.clientLits.length} 个 · 具名状态集成员 ${scan.containerLits.length} 个 · 幽灵邻接内联白名单 ${scan.inlineGhostArrays.length} 个`)
  L.push('')
  L.push('orders.status 服务端写入方（文件:行号 → 按值分组）：')
  for (const [v, sites] of [...written].sort()) L.push(`  ${v.padEnd(22)} ${String(sites.length).padStart(2)} 处  ${sites.join(' , ')}`)
  return L
}

function main() {
  const argv = process.argv.slice(2)
  const scan = scanAll()
  if (argv.includes('--print-ghost-baseline')) {
    console.log(JSON.stringify(ghostRefs(scan), null, 2))
    process.exit(0)
  }
  const res = runChecks()
  if (argv.includes('--report')) {
    reportLines(res.scan, res.written || new Map()).forEach((l) => console.log(l))
    process.exit(0)
  }
  for (const n of res.notes) console.log(`ⓘ ${n}`)
  for (const u of res.undecidable) console.error(`⚠ 无法判定：${u}`)
  for (const p of res.problems) console.error(`✗ ${p}`)
  if (!res.problems.length && !res.undecidable.length) {
    reportLines(res.scan, res.written).forEach((l) => console.log(l))
    console.log('\n✓ 订单状态枚举不变量通过：唯一事实源双向对账 + 幽灵零写入 + 副本逐例一致 + 客户端零直写 + 覆盖面完整')
    process.exit(0)
  }
  if (res.problems.length) {
    console.error(`\n订单状态枚举不变量未通过：${res.problems.length} 处`)
    process.exit(1)
  }
  console.error(`\n无法判定 ${res.undecidable.length} 处 —— 按错题本 E16 以 exit 2 结束（**不是通过**）`)
  process.exit(2)
}

// ── 自检：注入回归 → 必须检出 → 逐字节还原 ─────────────────────────────────
export function selftest() {
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
  let bad = 0
  let probes = 0
  const ok = (name) => console.log(`  ✓ ${name}`)
  const no = (name) => { bad += 1; console.error(`  ✗ ${name}`) }

  const base = runChecks()
  if (base.problems.length || base.undecidable.length) {
    console.error('✗ 基线就有问题，先修再谈自检：')
    base.problems.forEach((p) => console.error('  - ' + p))
    base.undecidable.forEach((p) => console.error('  - ⚠ ' + p))
    process.exit(1)
  }
  ok('基线：枚举不变量全部成立（写入方双向对账 + 副本一致 + 客户端零直写）')

  /** 注入 → 必须命中 want → 逐字节还原 */
  const inject = (name, relPath, mutate, want, expectRed = true) => {
    probes += 1
    const abs = join(ROOT, relPath)
    const before = readFileSync(abs)
    const digest = sha(abs)
    let hit = null
    try {
      const mutated = mutate(before.toString('utf8'))
      if (mutated === before.toString('utf8')) { no(`${name}（注入锚点没匹配上 → 自检本身失效）`); return }
      writeFileSync(abs, mutated)
      const r = runChecks()
      hit = [...r.problems, ...r.undecidable].find((p) => want.test(p)) || null
    } finally {
      writeFileSync(abs, before)
    }
    if (sha(abs) !== digest) { no(`${name}（还原后字节不一致）`); return }
    if (expectRed) {
      if (hit) ok(`${name}\n      → ${hit.slice(0, 160)}`)
      else no(name)
    } else {
      if (hit) no(`${name} —— 反例不该被判红，命中了：${hit.slice(0, 120)}`)
      else ok(`${name}（确认不产生假失败）`)
    }
  }

  // I1：幽灵被写入
  inject('★ I1 幽灵状态被写入被检出（refund_rejected 写进 orders）',
    'miniprogram/cloudfunctions/refundOrder/index.js',
    (s) => s.replace('  const walletPendingReconcile =',
      "  await db.collection('orders').doc(orderId).update({ data: { status: 'refund_rejected' } })\n  const walletPendingReconcile ="),
    /幽灵\/残留状态「refund_rejected」被服务端写入/)

  // I2：变量式写入里出现新造值
  inject('★ I2 变量式写入里出现新造值被检出（ready_pickup → pending_pickup）',
    'miniprogram/cloudfunctions/confirmPayment/fulfillOrder.js',
    (s) => s.replace(": (isRegularStorePickup ? 'ready_pickup' : 'paid')", ": (isRegularStorePickup ? 'pending_pickup' : 'paid')"),
    /「pending_pickup」不在 in_use 白名单/)

  // I3：扫描范围退化到只扫 index.js
  {
    probes += 1
    const r = runChecks({ files: allCloudFnJs().filter((f) => f.endsWith('/index.js')) })
    const hit = [...r.problems, ...r.undecidable].find((p) => /ready_pickup|扫描范围/.test(p))
    if (hit) ok(`★ I3 扫描范围退化到只扫 index.js 被检出\n      → ${hit.slice(0, 160)}`)
    else no('★ I3 扫描范围退化到只扫 index.js 未被检出')
  }

  // I4（反例）：只改注释里的状态名
  inject('☆ I4 反例：只改注释里的状态名 → 必须保持绿',
    'miniprogram/cloudfunctions/cancelOrder/index.js',
    (s) => s.replace('// 先原子 void，再释放钱包/库存/券，避免与支付履约竞态', '// 先原子 refund_rejected，再释放钱包/库存/券'),
    /refund_rejected/,
    false)

  // I5：副本漂移（只改其中一份）
  inject('★ I5 orderStatus.js 副本漂移被检出（只改 manager 那一份）',
    'miniprogram/subpackages/manager/utils/orderStatus.js',
    (s) => s.replace("  refunded: 'refunded',", "  refunded: 'refunded',\n  pending_pickup: 'pending_pickup',"),
    /副本漂移|不在全域内/)

  // I6：客户端状态集自造值
  inject('★ I6 客户端状态集自造值被检出（pickupPass 加 pending_pickup）',
    'miniprogram/subpackages/business/utils/pickupPass.js',
    (s) => s.replace("'expired_refunding', 'refund_reject'])", "'expired_refunding', 'refund_reject', 'pending_pickup'])"),
    /不在全域内/)

  // I7：客户端直写 orders
  inject('★ I7 客户端直写 orders.status 被检出',
    'miniprogram/subpackages/business/utils/refundPolicy.js',
    (s) => s + "\n// selftest\nasync function _probe(db) { await db.collection('orders').doc(1).update({ data: { status: 'refunded' } }) }\n",
    /客户端出现 \d+ 处 orders 直写/)

  // I8：in_use 里的值失去全部写入方（删一个写入点 → A2）
  inject('★ I8 in_use 值失去全部写入方被检出（删掉 refunded 的唯一写入）',
    'miniprogram/cloudfunctions/refundOrder/index.js',
    (s) => s.replace("      status: 'refunded',\n", "      status: 'refundedX',\n"),
    /零写入方|不在 in_use 白名单/)

  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log(`\n自检通过：${probes} 个注入（幽灵写入 / 新造值 / 漏扫范围 / 副本漂移 / 客户端自造值 / 客户端直写 / 写入方丢失）都能被检出，且还原字节一致；1 个反例不假红`)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  if (process.argv.includes('--selftest')) selftest()
  else main()
}
