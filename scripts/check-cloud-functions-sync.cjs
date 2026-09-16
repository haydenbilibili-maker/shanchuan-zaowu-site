#!/usr/bin/env node
/**
 * 云函数一致性巡检：线上部署的代码 vs 仓库。
 *
 * 为什么需要（真实教训）：本项目曾出现 **129 个云函数里 30 个跑的是旧代码**——
 * 因为历次改动都是「改完即部署我改的那个函数」，从没做过全量比对。漏部署的包括：
 *   - 29 个函数的 staffGuard.js 缺少股东角色与观测台只读门禁（授权控制落后）
 *   - 1 个函数的图标指向已删除路径（真实破图）
 *   - 1 个券折扣规则缺修复（选券反而更贵）
 *   - upsertUserProfile 是 fail-closed 旧版（会导致昵称/头像完全改不了）
 *
 * 用法：
 *   node scripts/check-cloud-functions-sync.cjs                # 全量比对
 *   node scripts/check-cloud-functions-sync.cjs grantStorePoints refundOrder
 *   node scripts/check-cloud-functions-sync.cjs --json         # 机器可读
 *
 * 凭证：admin/.env 或 admin/.env.local 的 TCB_SECRET_ID / TCB_SECRET_KEY
 * 退出码：存在不一致为 1。（本脚本**只读**，不会修改线上任何东西。）
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.join(__dirname, '..')
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const LOCAL = path.join(ROOT, 'miniprogram', 'cloudfunctions')
// ⚠️ 必须**每次运行一个唯一目录**：此前是固定路径 `<tmp>/dsh-fn-drift`，
// 两个进程并发跑（例如部署脚本与自己手动核对、或与并行工作流同时跑）会互相
// rmSync 对方正在下载的目录 → 报 `ENOTEMPTY: directory not empty, rmdir ...`。
// 这个失败看起来像「巡检坏了」，实际是被自己/对方踩掉了。mkdtemp 原子地给出唯一目录。
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dsh-fn-drift-'))

/** 云端会重写/与部署无关的文件，不参与比对 */
const IGNORE = new Set(['package.json', 'package-lock.json', 'config.json', '.DS_Store', '.gitignore'])

function readEnv(file) {
  const out = {}
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch (e) { /* 忽略缺失 */ }
  return out
}

const sha = (p) => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 10)

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || IGNORE.has(e.name)) return []
    const fp = path.join(dir, e.name)
    return e.isDirectory() ? listFiles(fp, base) : [path.relative(base, fp)]
  })
}

async function main() {
  const asJson = process.argv.includes('--json')
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'))

  const env = { ...readEnv(path.join(ROOT, 'admin/.env')), ...readEnv(path.join(ROOT, 'admin/.env.local')) }
  if (!env.TCB_SECRET_ID || !env.TCB_SECRET_KEY) {
    console.error('缺少 TCB_SECRET_ID / TCB_SECRET_KEY（admin/.env 或 admin/.env.local）')
    process.exit(2)
  }
  let CB
  for (const c of [path.join(ROOT, 'node_modules/@cloudbase/manager-node'), path.join(ROOT, 'admin/node_modules/@cloudbase/manager-node')]) {
    try { CB = require(c); break } catch (e) { /* 试下一个 */ }
  }
  if (!CB) {
    console.error('找不到 @cloudbase/manager-node，请在仓库根目录 npm install 后重试')
    process.exit(2)
  }
  const app = CB.init({ secretId: env.TCB_SECRET_ID, secretKey: env.TCB_SECRET_KEY, envId: ENV_ID })

  const names = wanted.length
    ? wanted
    : fs.readdirSync(LOCAL).filter((n) => fs.existsSync(path.join(LOCAL, n, 'index.js')))

  const rows = []
  for (const name of names) {
    const ldir = path.join(LOCAL, name)
    if (!fs.existsSync(ldir)) {
      rows.push({ name, status: '仓库无此函数' })
      continue
    }
    const dest = path.join(TMP, name)
    fs.rmSync(dest, { recursive: true, force: true })
    fs.mkdirSync(dest, { recursive: true })
    try {
      await app.functions.downloadFunctionCode({ destPath: dest, envId: ENV_ID, functionName: name })
    } catch (e) {
      rows.push({ name, status: '下载失败', detail: String((e && e.message) || e).slice(0, 80) })
      continue
    }
    const lf = listFiles(ldir)
    const cf = listFiles(dest)
    const changed = lf.filter((f) => cf.includes(f) && sha(path.join(ldir, f)) !== sha(path.join(dest, f)))
    const onlyLocal = lf.filter((f) => !cf.includes(f))
    const onlyCloud = cf.filter((f) => !lf.includes(f))
    rows.push({
      name,
      status: (changed.length || onlyLocal.length || onlyCloud.length) ? '不一致' : '一致',
      changed, onlyLocal, onlyCloud,
    })
  }
  // 清理失败绝不能影响巡检结论（并发下偶发 ENOTEMPTY 是正常的）
  try {
    fs.rmSync(TMP, { recursive: true, force: true })
  } catch (e) {
    /* 忽略：临时目录残留无害 */
  }

  const bad = rows.filter((r) => r.status !== '一致')
  if (asJson) {
    console.log(JSON.stringify({ total: rows.length, inconsistent: bad }, null, 2))
    return bad.length ? 1 : 0
  }

  for (const b of bad) {
    console.log(`❌ ${b.name} — ${b.status}`)
    if (b.detail) console.log(`     ${b.detail}`)
    if (b.changed && b.changed.length) console.log(`     内容不同: ${b.changed.join(', ')}`)
    if (b.onlyLocal && b.onlyLocal.length) console.log(`     仓库多出: ${b.onlyLocal.slice(0, 8).join(', ')}`)
    if (b.onlyCloud && b.onlyCloud.length) console.log(`     线上多出: ${b.onlyCloud.slice(0, 8).join(', ')}`)
  }
  console.log(`\n检查 ${rows.length} 个函数：一致 ${rows.length - bad.length}，不一致/异常 ${bad.length}`)
  if (!bad.length) {
    console.log('✓ 线上与仓库完全一致')
  } else {
    console.log('\n提示：判方向后再部署。差异可能是「仓库较新未部署」，也可能是「线上有仓库没有的改动」，')
    console.log('      盲目覆盖会丢线上逻辑——先看 内容不同 的文件再决定。')
  }
  return bad.length ? 1 : 0
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error('巡检失败:', String((e && e.message) || e))
  process.exit(2)
})
