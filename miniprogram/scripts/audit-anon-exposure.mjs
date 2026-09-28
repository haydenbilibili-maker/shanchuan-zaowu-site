#!/usr/bin/env node
/**
 * audit:anon-exposure —— 公网匿名读 / 写探针（手动跑，需联网；不在 check:admin 清单内）
 *
 * 模拟公网任何人：Web 匿名登录（不带 Origin，安全域名白名单对非浏览器无效）→
 *   读：对每个敏感集合 countDocument；
 *   写：对每个写保护集合（collections ∪ writeProtectedExtra）updateDocument / deleteDocument 一个**随机不存在的 _id**
 *       （upsert:false）—— 放行时 updated/deleted=0、被拒时 PERMISSION_DENIED，两种结果都不改任何数据。不改规则。
 *
 * 判定（清单 cloudbase/sensitive-collections.json）：
 *   · 对照组先行：读 probeControls.readable 可读 / denied 被拒；写 probeControls.writable 可写 / denied 被拒，
 *     否则探针失效（exit 2，不出结论）
 *   · pendingR1 外的敏感集合匿名可读、pendingWrite 外的写保护集合匿名可写（update 或 delete 任一放行）→ 暴露（exit 1）
 *   · pending 内的仍放行 → 列为「待收紧」（预期内）；已被拒 → 提示从 pending 移除
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

/** wresults: { [collection]: 'writable' | 'denied' | 'error' } */
export function judgeWrite(list, wresults) {
  const { writable, denied } = list.probeControls
  if (wresults[writable] !== 'writable' || wresults[denied] !== 'denied') {
    return {
      code: 2,
      lines: [`写探针失效：对照组 ${writable}=${wresults[writable]}（应 writable）、${denied}=${wresults[denied]}（应 denied），不出结论`],
    }
  }
  const targets = writeTargets(list)
  const pending = new Set(list.pendingWrite || [])
  const exposed = []
  const awaiting = []
  const stale = []
  const errors = []
  for (const c of targets) {
    const r = wresults[c]
    if (r === 'error') errors.push(c)
    else if (r === 'writable') (pending.has(c) ? awaiting : exposed).push(c)
    else if (pending.has(c)) stale.push(c)
  }
  const lines = []
  if (exposed.length) lines.push(`✗ 公网匿名可写（不应放行）：${exposed.join(', ')}`)
  if (errors.length) lines.push(`✗ 写探测出错（未能判定）：${errors.join(', ')}`)
  if (awaiting.length) lines.push(`· 写待收紧（新版 ERP 上线后应用 staged，预期内）：${awaiting.join(', ')}`)
  if (stale.length) lines.push(`· 写已被拒但仍挂在 pendingWrite：${stale.join(', ')}（线上已收紧 → 更新仓库规则与清单）`)
  lines.push(`✓ 匿名写被拒：${targets.filter((c) => wresults[c] === 'denied').length} / ${targets.length}`)
  return { code: exposed.length || errors.length ? 1 : 0, lines }
}

function writeTargets(list) {
  return [...new Set([...list.collections, ...(list.writeProtectedExtra || [])])]
}

async function signIn() {
  const sign = await fetch(`${API}/auth/v1/signin/anonymously`, { method: 'POST', headers: HEADERS, body: '{}' })
  const s = await sign.json()
  if (!s.access_token) throw new Error(`匿名登录失败：${JSON.stringify(s).slice(0, 200)}`)
  return s.access_token
}

async function probeWrite(list, token) {
  const ghost = `zz_anon_probe_nonexistent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const call = async (action, collectionName, extra) => {
    const res = await fetch(`${API}/web?env=${ENV}`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        action,
        dataVersion: '2020-01-10',
        env: ENV,
        access_token: token,
        collectionName,
        queryType: 'DOC',
        query: { _id: ghost },
        multi: false,
        ...extra,
      }),
    })
    const j = await res.json()
    if (/PERMISSION_DENIED/i.test(String(j.code || ''))) return 'denied'
    if (!j.code && j.data) return 'allowed'
    return 'error'
  }
  const targets = [...writeTargets(list), list.probeControls.writable, list.probeControls.denied]
  const results = {}
  for (const c of targets) {
    try {
      const up = await call('database.updateDocument', c, { data: { $set: { __anonProbe: 1 } }, merge: true, upsert: false })
      const del = await call('database.deleteDocument', c, {})
      if (up === 'allowed' || del === 'allowed') results[c] = 'writable'
      else if (up === 'denied' && del === 'denied') results[c] = 'denied'
      else results[c] = 'error'
    } catch {
      results[c] = 'error'
    }
  }
  return results
}

async function probe(list, token) {
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
          access_token: token,
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
  const wc = list.probeControls
  const wbase = {
    ...Object.fromEntries(writeTargets(list).map((c) => [c, list.pendingWrite.includes(c) ? 'writable' : 'denied'])),
    [wc.writable]: 'writable',
    [wc.denied]: 'denied',
  }
  const wApplied = writeTargets(list).find((c) => !list.pendingWrite.includes(c))
  const wcases = [
    ['已收紧写的集合重新可写', { ...wbase, [wApplied]: 'writable' }, 1],
    ['admin_users 匿名可写（提权）', { ...wbase, admin_users: 'writable' }, 1],
    ['写对照组可写表被拒（探针失效）', { ...wbase, [wc.writable]: 'denied' }, 2],
    ['写对照组拒写表可写（探针失效）', { ...wbase, [wc.denied]: 'writable' }, 2],
    ['写探测出错不得当成通过', { ...wbase, [wApplied]: 'error' }, 1],
  ]
  let ok = judge(list, base).code === 0 && judgeWrite(list, wbase).code === 0
  console.log(`${ok ? '✓' : '✗'} 基线（当前清单预期结果）读 / 写判定均为通过`)
  const run = (fn, list2, name, results, expected) => {
    const got = fn(list2, results).code
    const hit = got === expected
    console.log(`${hit ? '✓' : '✗'} 自检注入「${name}」→ exit ${got}（期望 ${expected}）`)
    if (!hit) ok = false
  }
  for (const [name, results, expected] of cases) run(judge, list, name, results, expected)
  for (const [name, results, expected] of wcases) run(judgeWrite, list, name, results, expected)
  process.exit(ok ? 0 : 1)
}

const token = await signIn()
const verdict = judge(list, await probe(list, token))
const wverdict = judgeWrite(list, await probeWrite(list, token))
console.log('── 读 ──')
verdict.lines.forEach((l) => console.log(l))
console.log('── 写（仅打随机不存在的 _id，不改数据）──')
wverdict.lines.forEach((l) => console.log(l))
process.exit(Math.max(verdict.code, wverdict.code))
