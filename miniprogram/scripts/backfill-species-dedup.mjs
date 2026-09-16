#!/usr/bin/env node
/**
 * 需求 1 存量回填：为历史鉴定记录补 `species_dedup_key`（同物种去重键）。
 *
 * 为什么需要：该键只在**建记录时**写入 → 存量记录没有它，同物种去重对旧数据不生效。
 *
 * 判定逻辑与线上**同源**（`cloudfunctions/identifySpecimen/speciesDedupKey.js`），
 * 由云函数侧执行，本脚本只做「分批驱动 + 汇总」，不重复实现规则。
 *
 * 用法（需 tcb CLI 可用）：
 *   node miniprogram/scripts/backfill-species-dedup.mjs                    # DRY-RUN（默认，不写库）
 *   node miniprogram/scripts/backfill-species-dedup.mjs --apply            # 真正写库
 *   node miniprogram/scripts/backfill-species-dedup.mjs --limit 100        # 每批条数（≤200）
 *   node miniprogram/scripts/backfill-species-dedup.mjs --selftest         # 自检脚本逻辑
 *
 * 运维口令：取 `ADMIN_OPS_KEY` 环境变量（与云函数一致）；未设置则拒绝执行。
 * 退出码：失败为 1。
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const ENV_ID = process.env.CLOUD_ENV || 'cloud1-8gnkty5bfff9f0bf'
const FN = 'identifySpecimen'

export function parseArgs(argv) {
  const get = (name, def) => {
    const i = argv.indexOf(`--${name}`)
    if (i === -1) return def
    const v = argv[i + 1]
    return v && !v.startsWith('--') ? v : true
  }
  const limitRaw = get('limit', '100')
  const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 100, 1), 200)
  return {
    apply: argv.includes('--apply'),
    selftest: argv.includes('--selftest'),
    limit,
    maxRounds: Math.max(1, parseInt(get('max-rounds', '200'), 10) || 200),
  }
}

const args = parseArgs(process.argv.slice(2))

function selftest() {
  const cases = [
    ['默认 dry-run', parseArgs([]).apply === false],
    ['--apply 开启写库', parseArgs(['--apply']).apply === true],
    ['默认每批 100', parseArgs([]).limit === 100],
    ['limit 上限夹到 200', parseArgs(['--limit', '999']).limit === 200],
    // 0 与非法值同策：视为未提供 → 回退默认 100（避免「0 条」静默什么也不做）
    ['limit 0 回退默认 100', parseArgs(['--limit', '0']).limit === 100],
    ['limit 非法回退 100', parseArgs(['--limit', 'abc']).limit === 100],
    ['--selftest 被识别', parseArgs(['--selftest']).selftest === true],
    // ★ 解析：这次 dry-run 直接崩在这里，必须有回归
    ['剥 ANSI 色码后能取到 JSON', extractJsonObject('\u001b[90m│\u001b[39m\n{"a":1}') !== null],
    ['能跳过 banner 行', extractJsonObject('CloudBase CLI 3.8.0\n- Loading data...\n{"ok":true}').ok === true],
    ['★ 嵌套对象取最外层（lastIndexOf 会切坏）',
      JSON.stringify(extractJsonObject('{"data":{"RetMsg":"{\\"success\\":true}","n":1}}')) ===
      JSON.stringify({ data: { RetMsg: '{"success":true}', n: 1 } })],
    ['字符串里的花括号不破坏配对', extractJsonObject('{"a":"}","b":2}').b === 2],
    ['转义引号不破坏配对', extractJsonObject('{"a":"\\"}\\""}').a === '"}"'],
    ['非 JSON 输出返回 null', extractJsonObject('boom') === null],
    ['解包 RetMsg 字符串', unwrapInvokeResult({ data: { RetMsg: '{"success":true,"n":2}' } }).n === 2],
    ['RetMsg 非法时不抛错而返回失败', unwrapInvokeResult({ data: { RetMsg: 'not-json' } }).success === false],
    ['无 RetMsg 时透出 ErrMsg', unwrapInvokeResult({ data: { ErrMsg: 'boom' } }).msg === 'boom'],
  ]
  let bad = 0
  for (const [n, ok] of cases) {
    if (!ok) bad++
    console.log(`${ok ? '✓' : '✗'} ${n}`)
  }
  if (bad) {
    console.error(`\n自检失败 ${bad} 项`)
    process.exit(1)
  }
  console.log('\n自检通过：参数解析与安全默认（默认不写库）正确')
  process.exit(0)
}

/**
 * 从 tcb CLI 的混合输出里取出**第一个完整的 JSON 对象**。
 *
 * 为什么不能图省事用 lastIndexOf('{')：那会取到**最内层**的花括号，
 * 切出来的是 `{"..."` 这种残缺片段 —— 这正是本脚本此前 dry-run 直接报
 * `Expected property name or '}' in JSON at position 1` 的原因。
 * tcb 输出里还混着 banner 行与 ANSI 色码，所以要先剥色再从第一个 `{` 起做**括号配对**扫描
 * （配对时跳过字符串内部与转义，避免被 `{"a":"}"}` 这类内容骗到）。
 */
export function extractJsonObject(text) {
  const clean = String(text == null ? '' : text)
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/g, '')
  for (let i = clean.indexOf('{'); i !== -1; i = clean.indexOf('{', i + 1)) {
    let depth = 0
    let inStr = false
    let esc = false
    for (let j = i; j < clean.length; j += 1) {
      const ch = clean[j]
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) {
          const slice = clean.slice(i, j + 1)
          try {
            return JSON.parse(slice)
          } catch (e) {
            break // 这一段不是合法 JSON，继续找下一个 `{`
          }
        }
      }
    }
  }
  return null
}

/**
 * tcb CLI 把云函数返回值包在 `{ data: { RetMsg, ErrMsg, Log, ... } }` 里，
 * 而 `RetMsg` 又是一段**字符串化的 JSON**（云函数 return 的对象）。
 * 调用方只关心云函数自己的返回体，所以这里统一解包。
 */
export function unwrapInvokeResult(parsed) {
  if (!parsed) return null
  const data = parsed.data || parsed
  const retMsg = data && data.RetMsg
  if (typeof retMsg === 'string' && retMsg.trim()) {
    try {
      return JSON.parse(retMsg)
    } catch (e) {
      return { success: false, msg: `RetMsg 不是合法 JSON：${retMsg.slice(0, 200)}` }
    }
  }
  if (retMsg && typeof retMsg === 'object') return retMsg
  if (data && data.ErrMsg) return { success: false, msg: String(data.ErrMsg) }
  return data
}

function invoke(payload) {
  const res = spawnSync(
    'npx',
    ['tcb', 'fn', 'invoke', FN, '-e', ENV_ID, '--json', '--params', JSON.stringify(payload)],
    { cwd: ROOT, encoding: 'utf8', timeout: 180000 },
  )
  const out = `${res.stdout || ''}\n${res.stderr || ''}`
  const parsed = extractJsonObject(out)
  if (!parsed) {
    throw new Error(`无法解析云函数返回（exit ${res.status}）：${out.slice(-500)}`)
  }
  return unwrapInvokeResult(parsed)
}

async function main() {
  if (args.selftest) return selftest()

  const opsKey = String(process.env.ADMIN_OPS_KEY || '').trim()
  if (!opsKey) {
    console.error('✗ 缺少 ADMIN_OPS_KEY（与云函数环境变量同值）。拒绝执行。')
    process.exit(1)
  }

  console.log(`模式：${args.apply ? 'APPLY（会写库）' : 'DRY-RUN（只统计，不写库）'} · 每批 ${args.limit} 条`)
  let cursor = ''
  let round = 0
  let scanned = 0
  let updated = 0
  let skipped = 0
  let keyed = 0
  let unkeyable = 0

  while (round < args.maxRounds) {
    round += 1
    const payload = { action: 'backfill_species_dedup', adminOpsKey: opsKey, limit: args.limit, apply: args.apply }
    if (cursor) payload.cursor = cursor
    let r
    try {
      r = invoke(payload)
    } catch (e) {
      console.error(`✗ 第 ${round} 批调用失败：${e.message}`)
      process.exit(1)
    }
    if (!r || r.success === false) {
      console.error(`✗ 第 ${round} 批返回失败：${(r && r.msg) || '未知'}`)
      process.exit(1)
    }

    scanned += r.scanned || 0
    updated += r.updated || 0
    skipped += r.skipped || 0
    keyed += r.keyed || 0
    unkeyable += r.unkeyable || 0

    if (round === 1 && Array.isArray(r.samples) && r.samples.length) {
      console.log('\n首批抽样（判断键是否正确）：')
      r.samples.forEach((s) => {
        console.log(`  ${s._id}  key=${JSON.stringify(s.key)}  ${s.zh || ''} ${s.latin || ''} ${s.reason || ''}`)
      })
      console.log('')
    }
    console.log(`  第 ${round} 批：扫描 ${r.scanned || 0} · 可补键 ${r.keyed || 0} · 已写 ${r.updated || 0} · 跳过 ${r.skipped || 0} · 不可去重 ${r.unkeyable || 0}`)

    if (!r.hasMore || !r.nextCursor) break
    cursor = r.nextCursor
  }

  console.log(`\n合计：扫描 ${scanned} 条 · 可补键 ${keyed} 条 · ${args.apply ? '已写' : '待写'} ${args.apply ? updated : keyed} 条 · 已有键跳过 ${skipped} 条 · 不可去重 ${unkeyable} 条`)
  if (!args.apply) console.log('这是 DRY-RUN。确认无误后加 --apply 执行。')
}

main()
