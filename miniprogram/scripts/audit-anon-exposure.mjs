#!/usr/bin/env node
/**
 * audit:anon-exposure —— 公网匿名读取探针（手动跑，需联网；不在 check:admin 清单内）
 *
 * 模拟公网任何人：Web 匿名登录（不带 Origin，安全域名白名单对非浏览器无效）→ 对每个敏感集合 countDocument。
 * 只读：不写任何集合、不改规则。
 *
 * 判定（清单 cloudbase/sensitive-collections.json）：
 *   · 对照组先行：probeControls.readable 必须可读、probeControls.denied 必须被拒，否则探针失效（exit 2，不出结论）
 *   · pendingR1 外的敏感集合匿名可读 → 暴露（exit 1）
 *   · pendingR1 内的集合匿名可读 → 列为「待收紧」（预期内）；已被拒 → 提示从 pendingR1 移除
 *
 * 用法：
 *   node miniprogram/scripts/audit-anon-exposure.mjs              # 探测线上
 *   node miniprogram/scripts/audit-anon-exposure.mjs --selftest   # 离线：判定逻辑注入自检
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ENV = 'cloud1-8gnkty5bfff9f0bf'
const API = `https://${ENV}.ap-shanghai.tcb-api.tencentcloudapi.com`
const HEADERS = { 'content-type': 'application/json;charset=UTF-8', 'x-device-id': 'anon-exposure-probe' }

/** results: { [collection]: 'readable' | 'denied' | 'error' } */
export function judge(list, results) {
  const { readable, denied } = list.probeControls
  if (results[readable] !== 'readable' || results[denied] !== 'denied') {
    return {
      code: 2,
      lines: [`探针失效：对照组 ${readable}=${results[readable]}（应 readable）、${denied}=${results[denied]}（应 denied），不出结论`],
    }
  }
  const pending = new Set(list.pendingR1 || [])
  const exposed = []
  const awaiting = []
  const stale = []
  const errors = []
  for (const c of list.collections) {
    const r = results[c]
    if (r === 'error') errors.push(c)
    else if (r === 'readable') (pending.has(c) ? awaiting : exposed).push(c)
    else if (pending.has(c)) stale.push(c)
  }
  const lines = []
  if (exposed.length) lines.push(`✗ 公网匿名可读（不应暴露）：${exposed.join(', ')}`)
  if (errors.length) lines.push(`✗ 探测出错（未能判定）：${errors.join(', ')}`)
  if (awaiting.length) lines.push(`· 待收紧（ERP 上线后应用 R1，预期内）：${awaiting.join(', ')}`)
  if (stale.length) lines.push(`· 已被拒但仍挂在 pendingR1：${stale.join(', ')}（线上已收紧 → 更新仓库规则与清单）`)
  const blocked = list.collections.filter((c) => results[c] === 'denied')
  lines.push(`✓ 匿名被拒：${blocked.length} / ${list.collections.length}`)
  return { code: exposed.length || errors.length ? 1 : 0, lines }
}

async function probe(list) {
  const sign = await fetch(`${API}/auth/v1/signin/anonymously`, { method: 'POST', headers: HEADERS, body: '{}' })
  const s = await sign.json()
  if (!s.access_token) throw new Error(`匿名登录失败：${JSON.stringify(s).slice(0, 200)}`)
  const targets = [...list.collections, list.probeControls.readable, list.probeControls.denied]
  const results = {}
  for (const c of targets) {
    try {
      const res = await fetch(`${API}/web?env=${ENV}`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          action: 'database.countDocument',
          dataVersion: '2020-01-10',
          env: ENV,
          access_token: s.access_token,
          collectionName: c,
          queryType: 'WHERE',
          query: {},
        }),
      })
      const j = await res.json()
      if (!j.code && j.data && typeof j.data.total === 'number') results[c] = 'readable'
      else if (/PERMISSION_DENIED/i.test(String(j.code || ''))) results[c] = 'denied'
      else results[c] = 'error'
    } catch {
      results[c] = 'error'
    }
  }
  return results
}

const list = JSON.parse(readFileSync(resolve(ROOT, 'cloudbase/sensitive-collections.json'), 'utf8'))

if (process.argv.includes('--selftest')) {
  const { readable, denied } = list.probeControls
  const allDenied = Object.fromEntries(list.collections.map((c) => [c, list.pendingR1.includes(c) ? 'readable' : 'denied']))
  const base = { ...allDenied, [readable]: 'readable', [denied]: 'denied' }
  const applied = list.collections.find((c) => !list.pendingR1.includes(c))
  const cases = [
    ['已收紧集合重新暴露', { ...base, [applied]: 'readable' }, 1],
    ['对照组可读表被拒（探针失效）', { ...base, [readable]: 'denied' }, 2],
    ['对照组拒读表可读（探针失效 / 全部放行）', { ...base, [denied]: 'readable' }, 2],
    ['探测出错不得当成通过', { ...base, [applied]: 'error' }, 1],
  ]
  let ok = judge(list, base).code === 0
  console.log(`${ok ? '✓' : '✗'} 基线（当前清单预期结果）判定为通过`)
  for (const [name, results, expected] of cases) {
    const got = judge(list, results).code
    const hit = got === expected
    console.log(`${hit ? '✓' : '✗'} 自检注入「${name}」→ exit ${got}（期望 ${expected}）`)
    if (!hit) ok = false
  }
  process.exit(ok ? 0 : 1)
}

const results = await probe(list)
const verdict = judge(list, results)
verdict.lines.forEach((l) => console.log(l))
process.exit(verdict.code)
