#!/usr/bin/env node
/**
 * 工作室结算 / 价目表 —— 地基 provision（幂等）
 * 环境 cloud1-8gnkty5bfff9f0bf；密钥取 shanchuanzaowu/admin/.env 的 TCB_SECRET_*
 *
 * 做四件事（可单独跑，都有幂等保护）：
 *   ① 补 `manageStudioSettlement` 的 `ADMIN_OPS_KEY` 环境变量 —— **新函数默认没有**，
 *      而 ERP 走 `adminOpsKey` 鉴权，缺它则 Admin 侧一切读写都报
 *      `ADMIN_OPS_KEY_MISSING`（"云函数未配置 ADMIN_OPS_KEY"）。
 *      值**从既有函数拉取**（`tcb fn env pull`），保证与 ERP 用的是同一把，且**绝不打印**。
 *   ② 建 4 个集合（不存在才建）+ 仅在**新建**时套 `cloudbase/rules/<name>.json` 的 ACL
 *      （`{"read":false,"write":false}` —— 客户端不得直连，只能走云函数）。
 *   ③ 建索引（只建代码真查询用到的键；量小，索引是给规模留的，不是正确性依赖）。
 *   ④ `--import`：把 `admin/docs/原材料价目表_飞书交叉核对_第2轮_可导入.md` 里
 *      三个块**通过已部署的云函数** `priceBook.bulkUpsert` 导入（先 dryRun 再真写）。
 *      **不自己写库**：走生产校验（`validateBooks`），否则等于绕过唯一的完整性闸门。
 *
 * 用法：
 *   node miniprogram/scripts/provision-studio-settlement.cjs            # 只做 ①②③
 *   node miniprogram/scripts/provision-studio-settlement.cjs --import   # 追加 ④
 *   node miniprogram/scripts/provision-studio-settlement.cjs --check    # 只读：报告现状
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '../..')
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const ADMIN_ENV = path.join(ROOT, 'admin/.env')
const MANAGER_NODE = path.join(ROOT, 'node_modules/@cloudbase/manager-node')
const RULES_DIR = path.join(ROOT, 'cloudbase/rules')
const DOC = path.join(ROOT, 'admin/docs/原材料价目表_飞书交叉核对_第2轮_可导入.md')
const FN = 'manageStudioSettlement'
const TMP = path.join(ROOT, 'miniprogram/scripts/.tmp/envpull')

/** 四个集合：只有前两个是价目表（要导入），后两个是单据/目录（只建表） */
const COLLECTIONS = [
  { name: 'studio_material_prices', indexes: [{ Name: 'deleted_1_normName_1', Keys: [{ Name: 'deleted', Direction: '1' }, { Name: 'normName', Direction: '1' }] }] },
  { name: 'studio_packaging_prices', indexes: [{ Name: 'deleted_1_normName_1', Keys: [{ Name: 'deleted', Direction: '1' }, { Name: 'normName', Direction: '1' }] }] },
  { name: 'studio_shipment_skus', indexes: [{ Name: 'deleted_1_skuKey_1', Keys: [{ Name: 'deleted', Direction: '1' }, { Name: 'skuKey', Direction: '1' }] }] },
  { name: 'ops_settlement_bills', indexes: [
    { Name: 'deleted_1_status_1', Keys: [{ Name: 'deleted', Direction: '1' }, { Name: 'status', Direction: '1' }] },
    { Name: 'billNo_1', Keys: [{ Name: 'billNo', Direction: '1' }] }
  ] }
]

/** 文档里的三个代码块 → 云函数 bulkUpsert 的 kind（顺序 = §1.1/§1.2/§1.3） */
const BLOCK_KINDS = ['material', 'packaging', 'material']

function loadDotEnv () {
  if (!fs.existsSync(ADMIN_ENV)) throw new Error('缺少 ' + ADMIN_ENV)
  for (const line of fs.readFileSync(ADMIN_ENV, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}

/** 抽出文档里的围栏代码块（与 check-price-import-blocks 同规则：必须恰好 3 个） */
function extractBlocks (md) {
  const out = []
  let cur = null
  for (const l of String(md).split('\n')) {
    if (/^\s*```/.test(l)) {
      if (cur === null) cur = []
      else { out.push(cur.join('\n')); cur = null }
      continue
    }
    if (cur !== null) cur.push(l)
  }
  if (cur !== null) out.push(cur.join('\n'))
  return out
}

/** 从既有函数拉 ADMIN_OPS_KEY（返回长度，不返回值本身以外的东西） */
function pullOpsKey () {
  fs.mkdirSync(TMP, { recursive: true })
  const out = path.join(TMP, 'ref.env')
  execFileSync('tcb', ['fn', 'env', 'pull', 'manageProducts', '--output-file', out, '--env-id', ENV_ID], {
    cwd: path.join(ROOT, 'miniprogram'), stdio: 'pipe'
  })
  const line = fs.readFileSync(out, 'utf8').split('\n').find((l) => l.startsWith('ADMIN_OPS_KEY='))
  if (!line) throw new Error('既有函数里没有 ADMIN_OPS_KEY，无法对齐')
  const v = line.slice('ADMIN_OPS_KEY='.length).trim()
  if (!v) throw new Error('ADMIN_OPS_KEY 为空')
  return v
}

/**
 * 调已部署的云函数：走 `tcb fn invoke -d @file`。
 * 为什么不用 manager-node 的 `invokeFunction`：它把 payload 塞进 `ClientContext`，
 * 不保证进 `event`（我实测会拿不到 action）；CLI 是官方调用路径。
 * 为什么用 `@file`：payload 含 `adminOpsKey`，写文件（0600）比放进命令行参数安全
 * （后者会出现在 `ps` 里）。用完即删。
 */
function invokeFn (payload) {
  fs.mkdirSync(TMP, { recursive: true })
  const f = path.join(TMP, 'invoke-payload.json')
  fs.writeFileSync(f, JSON.stringify(payload), { mode: 0o600 })
  try {
    const out = execFileSync('tcb', ['fn', 'invoke', FN, '-d', '@' + f, '--json'], {
      cwd: path.join(ROOT, 'miniprogram'), stdio: 'pipe', maxBuffer: 32 * 1024 * 1024
    }).toString()
    const start = out.indexOf('{')
    if (start === -1) throw new Error('云函数返回非 JSON：' + out.slice(0, 200))
    const parsed = JSON.parse(out.slice(start))
    /**
     * ⚠️ `tcb fn invoke --json` 的外层不是函数返回值：真实返回值是
     * `data.RetMsg` 里的一个 **JSON 字符串**（`{success, dryRun, parsedRows, ...}`）。
     * 第一版直接读 `data.parsedRows` → 全是 `undefined`、读回显示 0 行，
     * 看起来像"导入没生效"。必须再 JSON.parse 一层。
     */
    const ret = parsed && parsed.data && parsed.data.RetMsg
    if (typeof ret === 'string' && ret) return JSON.parse(ret)
    if (ret && typeof ret === 'object') return ret
    return parsed.result || parsed
  } finally {
    try { fs.unlinkSync(f) } catch (_) {}
  }
}

async function main () {
  const doImport = process.argv.includes('--import')
  const checkOnly = process.argv.includes('--check')
  loadDotEnv()
  const { TCB_SECRET_ID: secretId, TCB_SECRET_KEY: secretKey } = process.env
  if (!secretId || !secretKey) throw new Error('缺少 TCB_SECRET_ID / TCB_SECRET_KEY')

  const CB = require(MANAGER_NODE)
  const app = CB.init({ secretId, secretKey, envId: ENV_ID })
  const { database, permission, functions } = app
  const rows = []
  const row = (n, op, r, note) => rows.push({ name: n, op, result: r, note: String(note || '').slice(0, 140) })

  console.log('env =', ENV_ID)

  // ── ① 函数环境变量 ─────────────────────────────────────────
  let opsKey = ''
  try {
    const cfg = await functions.getFunctionDetail(FN)
    const curVars = ((cfg && cfg.Environment && cfg.Environment.Variables) || [])
    const cur = {}
    for (const v of curVars) if (v && v.Key) cur[v.Key] = v.Value
    const has = !!cur.ADMIN_OPS_KEY
    row(FN + '.ADMIN_OPS_KEY', '读函数配置', has ? 'exists' : 'missing', has ? '已配置' : '**新函数默认没有** —— Admin 侧会报 ADMIN_OPS_KEY_MISSING')
    if (!has && !checkOnly) {
      opsKey = pullOpsKey()
      await functions.updateFunctionConfig({ name: FN, envVariables: { ADMIN_OPS_KEY: opsKey } })
      row(FN + '.ADMIN_OPS_KEY', '补配', 'updated', '值取自 manageProducts（长度 ' + opsKey.length + '，不回显）')
      const after = await functions.getFunctionDetail(FN)
      const afterVars = ((after && after.Environment && after.Environment.Variables) || [])
      const nowHas = afterVars.some((v) => v && v.Key === 'ADMIN_OPS_KEY' && v.Value)
      row(FN + '.ADMIN_OPS_KEY', '补配后复核', nowHas ? 'ok' : 'fail', nowHas ? '已生效' : '仍未生效')
    }
  } catch (e) {
    row(FN + '.ADMIN_OPS_KEY', '读函数配置', 'fail', e.message || String(e))
  }

  // ── ② 建集合 + ACL（仅新建） ───────────────────────────────
  for (const spec of COLLECTIONS) {
    let existed = false
    try { await database.describeCollection(spec.name); existed = true } catch (_) { existed = false }
    if (existed) {
      row(spec.name, '建集合', 'exists', '已存在；**不改 ACL**（不碰既有权限）')
    } else if (checkOnly) {
      row(spec.name, '建集合', 'missing', '--check：未创建')
    } else {
      try {
        await database.createCollectionIfNotExists(spec.name)
        row(spec.name, '建集合', 'created', 'createCollectionIfNotExists')
        const ruleFile = path.join(RULES_DIR, spec.name + '.json')
        if (fs.existsSync(ruleFile)) {
          const rule = JSON.parse(fs.readFileSync(ruleFile, 'utf8'))
          await permission.modifyResourcePermission({
            resourceType: 'collection',
            resource: spec.name,
            permission: 'CUSTOM',
            securityRule: JSON.stringify(rule)
          })
          row(spec.name + ' ACL', '设权限', 'ok', 'CUSTOM ' + JSON.stringify(rule) + '（仅新建时设）')
        } else {
          row(spec.name + ' ACL', '设权限', 'skip', '没有 ' + path.basename(ruleFile))
        }
      } catch (e) {
        row(spec.name, '建集合', 'fail', e.message || String(e))
      }
    }
  }

  // ── ③ 索引 ─────────────────────────────────────────────────
  if (!checkOnly) {
    for (const spec of COLLECTIONS) {
      try {
        const desc = await database.describeCollection(spec.name)
        const have = new Set(((desc && desc.Indexes) || []).map((i) => i.Name))
        const toCreate = (spec.indexes || []).filter((i) => !have.has(i.Name))
        if (!toCreate.length) { row(spec.name + ' 索引', '建索引', 'exists', (spec.indexes || []).length + ' 个已存在'); continue }
        await database.updateCollection(spec.name, {
          CreateIndexes: toCreate.map((i) => ({ IndexName: i.Name, MgoKeySchema: { MgoIsUnique: false, MgoIndexKeys: i.Keys.map((k) => ({ Name: k.Name, Direction: String(k.Direction) })) } }))
        })
        row(spec.name + ' 索引', '建索引', 'created', toCreate.map((i) => i.Name).join(','))
      } catch (e) {
        row(spec.name + ' 索引', '建索引', 'fail', e.message || String(e))
      }
    }
  }

  // ── ④ 导入价目表（走云函数，不自己写库） ────────────────────
  if (doImport && !checkOnly) {
    if (!opsKey) { try { opsKey = pullOpsKey() } catch (e) { row('导入', '取 opsKey', 'fail', e.message) } }
    const blocks = extractBlocks(fs.readFileSync(DOC, 'utf8'))
    row('导入块', '抽取', blocks.length === 3 ? 'ok' : 'fail', blocks.length + ' 个代码块（期望 3）')
    if (blocks.length === 3 && opsKey) {
      for (let i = 0; i < 3; i += 1) {
        const kind = BLOCK_KINDS[i]
        const label = ['1.1 材料', '1.2 包装', '1.3 辅料'][i]
        for (const dryRun of [true, false]) {
          let body
          try {
            body = invokeFn({ action: 'priceBook.bulkUpsert', kind, text: blocks[i], dryRun, adminOpsKey: opsKey })
          } catch (e) {
            row(label, dryRun ? '试算' : '写入', 'fail', e.message || String(e)); break
          }
          const data = body.data || body
          if (body.success === false || body.ok === false) {
            row(label, dryRun ? '试算' : '写入', 'fail', JSON.stringify(body).slice(0, 200)); break
          }
          if (dryRun) {
            const errs = (data.errors || []).length
            row(label, '试算', errs ? 'fail' : 'ok', '可入库 ' + data.parsedRows + ' 行（新增 ' + data.created + '/覆盖 ' + data.updated + '），解析错 ' + errs + '；' + (data.msg || ''))
            if (errs) break
          } else {
            row(label, '写入', data.failed ? 'partial' : 'ok', '已导入 ' + data.written + ' 行（新增 ' + data.created + '/覆盖 ' + data.updated + '），失败 ' + (data.failed || 0) + '；' + (data.msg || ''))
          }
        }
      }
    }
  }

  // ── 复核：读回服务端实际状态 ───────────────────────────────
  for (const kind of ['material', 'packaging']) {
    try {
      const body = invokeFn({ action: 'priceBook.list', kind, adminOpsKey: opsKey || undefined, limit: 500 })
      const data = body.data || body
      const n = (data.rows || data.list || []).length
      row('复核 ' + kind, '读回价目表', n ? 'ok' : 'empty', '云函数返回 ' + n + ' 行')
    } catch (e) {
      row('复核 ' + kind, '读回价目表', 'fail', e.message || String(e))
    }
  }

  console.log('\n| 对象 | 操作 | 结果 | 备注 |')
  console.log('| --- | --- | --- | --- |')
  for (const r of rows) console.log(`| \`${r.name}\` | ${r.op} | ${r.result} | ${r.note} |`)

  const bad = rows.filter((r) => ['fail'].includes(r.result))
  if (bad.length) { console.log('\n✗ 有 ' + bad.length + ' 项失败'); process.exit(1) }
  console.log('\n✓ provision 完成')
}

main().catch((e) => { console.error(e); process.exit(1) })
