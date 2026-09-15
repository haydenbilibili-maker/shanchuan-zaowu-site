/**
 * 循环调用 manageProducts.backfillTags，直到扫完 products。
 * 用法：node scripts/backfill-product-tags.js
 */
const { spawnSync } = require('child_process')
const path = require('path')

const ENV = process.env.CLOUD_ENV || 'cloud1-8gnkty5bfff9f0bf'
const ROOT = path.resolve(__dirname, '..')
const BATCH = Math.max(1, parseInt(process.env.BACKFILL_LIMIT, 10) || 5)
const MAX_ROUNDS = Math.max(1, parseInt(process.env.BACKFILL_MAX_ROUNDS, 10) || 80)

function invoke(payload) {
  const args = [
    'tcb', 'fn', 'invoke', 'manageProducts',
    '-e', ENV,
    '--json',
    '--params', JSON.stringify(payload)
  ]
  const res = spawnSync('npx', args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180000
  })
  const out = `${res.stdout || ''}\n${res.stderr || ''}`
  if (res.status !== 0 && !out.includes('{')) {
    throw new Error(`invoke 失败 (exit ${res.status}): ${out.slice(-800)}`)
  }
  let parsed
  try {
    parsed = JSON.parse((res.stdout || '').trim())
  } catch (e) {
    const start = out.lastIndexOf('{')
    const end = out.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) {
      throw new Error(`无法解析云函数返回: ${out.slice(-800)}`)
    }
    parsed = JSON.parse(out.slice(start, end + 1))
  }
  const retMsg = parsed && parsed.data && parsed.data.RetMsg
  if (typeof retMsg === 'string' && retMsg.trim()) {
    try {
      return JSON.parse(retMsg)
    } catch (e) {
      /* fall through */
    }
  }
  return (parsed && (parsed.result || parsed.data)) || parsed
}

function main() {
  console.log(`[backfill] env=${ENV} batch=${BATCH}`)
  const scan = invoke({ action: 'backfillTags', scanOnly: true })
  if (!scan.success) throw new Error(scan.msg || 'scanOnly 失败')
  console.log(`[backfill] 扫描 总数=${scan.total} 待补=${scan.missing} 已有标签跳过=${scan.skipped}`)

  const summary = {
    total: scan.total || 0,
    missingAtStart: scan.missing || 0,
    skipped: 0,
    filled: 0,
    failed: 0,
    scanned: 0,
    failures: [],
    samples: []
  }

  let offset = 0
  let rounds = 0
  while (rounds < MAX_ROUNDS) {
    rounds += 1
    let batch
    let attempt = 0
    while (attempt < 3) {
      attempt += 1
      try {
        batch = invoke({ action: 'backfillTags', limit: BATCH, offset })
        if (batch && batch.success) break
        throw new Error((batch && batch.msg) || `第 ${rounds} 批失败`)
      } catch (e) {
        if (attempt >= 3) throw e
        console.log(`[backfill] 第${rounds}批重试 ${attempt}/3：${e.message}`)
      }
    }
    summary.scanned += batch.scanned || 0
    summary.skipped += batch.skipped || 0
    summary.filled += batch.filled || 0
    summary.failed += batch.failed || 0
    if (Array.isArray(batch.failures)) {
      summary.failures.push(...batch.failures)
    }
    if (Array.isArray(batch.samples)) {
      summary.samples.push(...batch.samples.slice(0, 2))
    }
    console.log(
      `[backfill] 第${rounds}批 offset=${offset} scanned=${batch.scanned} filled=${batch.filled} skipped=${batch.skipped} failed=${batch.failed} next=${batch.nextOffset} more=${batch.hasMore}`
    )
    if (batch.samples && batch.samples.length) {
      batch.samples.slice(0, 2).forEach((s) => {
        console.log(`  - ${s.title} → ${(s.tags || []).join('、')} (${s.source})`)
      })
    }
    offset = Number(batch.nextOffset) || (offset + (batch.scanned || 0))
    if (!batch.hasMore) break
    if ((batch.scanned || 0) === 0 && (batch.processed || 0) === 0) break
  }

  console.log(JSON.stringify({
    ok: true,
    rounds,
    total: summary.total,
    missingAtStart: summary.missingAtStart,
    scanned: summary.scanned,
    skipped: summary.skipped,
    filled: summary.filled,
    failed: summary.failed,
    failures: summary.failures.slice(0, 20),
    samples: summary.samples.slice(0, 8)
  }, null, 2))
}

main()
