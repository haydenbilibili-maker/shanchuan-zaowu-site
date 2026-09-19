/**
 * 飞书 ↔ 小程序/云库 **服务端同步**（超管工作台入口）
 *
 * 产品负责人 2026-09-19：「在超管工作台新增飞书信息同步……如目前的工作室仪表盘数据仍然是老数据没有保持更新」。
 *
 * ## 为什么必须新开一个云函数
 *
 * 在此之前，飞书的**读取与字段映射只存在于 ERP 前端**（`admin/src/utils/feishuSync.js`）：
 * 浏览器读飞书 → 前端映射 → 调各云函数的 `upsertFromFeishu` 写库。
 * 四个云函数里**一个 FEISHU 凭据都没有**。所以：
 *   · 小程序里加「同步」按钮是不可能的（小程序没有那套前端映射，也不该有）；
 *   · 仪表盘会一直显示老数据 —— **除非有人正好打开 ERP 点一下**。
 * 本函数把「读飞书 → 映射 → 写库」搬到服务端，于是**手动（小程序/ERP）+ 定时**两条路都通了。
 *
 * ## 三条设计约束
 *
 * 1. **不重写写库逻辑**：映射完成后调用既有的 `upsertFromFeishu` 端点（四个函数各有一个），
 *    用 `adminOpsKey` 做服务间鉴权。这样归一化/去重/日志与 ERP 手动同步**完全同一条路径**。
 * 2. **不重写映射**（尽量）：默认表定义与字段映射逐字对齐 ERP 的 `defaultFeishuConfig()`，
 *    并且**优先读 ERP 已保存的 `configs/feishu_bitable`** —— 人在 ERP 改过映射，这里立刻生效。
 * 3. **不写任何直接的集合写入**：本函数只读 `configs` 与三个台账做计数，写一律经过目标云函数。
 *
 * ## 开关
 *
 * `configs/feishu_sync.autoSync` **默认关**。定时器即使触发，开关关着就什么都不做并留一条日志
 * —— 「自动改数据」这种事必须由超管显式打开（与 `enabled`/`showXxx` 同先例）。
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const { assertStaff, ROLE_MANAGER } = require('./staffGuard')
const feishu = require('./feishuClient')
const M = require('./syncMapping')

const CONFIGS = 'configs'
const MAPPING_ID = 'feishu_bitable'
const SYNC_ID = 'feishu_sync'

/** 同步目标 → 本地台账集合（只用于「飞书有多少 / 本地有多少」的对比展示） */
const LOCAL_COLLECTION = {
  rawInventory: 'studio_raw_inventory',
  inventory: 'studio_inventory',
  purchase: 'ops_purchases'
}

function ok (data) {
  return Object.assign({ success: true }, data || {})
}
function fail (msg, code) {
  return { success: false, msg: msg || '操作失败', code: code || 'ERROR' }
}

/** 只读单文档，缺失/集合不存在一律返回 null（不自动建集合 —— 那是写） */
async function readDoc (id) {
  try {
    const res = await db.collection(CONFIGS).doc(id).get()
    return (res && res.data) || null
  } catch (e) {
    return null
  }
}

async function countLocal (collection) {
  try {
    const res = await db.collection(collection).count()
    return Number(res && res.total) || 0
  } catch (e) {
    return -1 // 集合不存在：与"0 条"区分开（0 条是"同步过但为空"，-1 是"根本没这张表"）
  }
}

/** 超管校验：本函数是**能改数据**的入口，一律要求超管 */
async function requireSuper (event, openid) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { ok: false, res: fail(guard.msg, guard.code) }
  if (!guard.actor || guard.actor.superAdmin !== true) {
    return { ok: false, res: fail('只有超管可以触发飞书同步', 'NOT_SUPER') }
  }
  return { ok: true, actor: guard.actor }
}

/** 读映射配置：优先 ERP 已保存的，缺的用内置默认补 */
async function loadMapping () {
  const doc = await readDoc(MAPPING_ID)
  const tables = (doc && doc.tables) || {}
  const out = {}
  for (const role of Object.keys(M.TARGETS)) {
    const spec = tables[role] || {}
    out[role] = {
      tableId: M.resolveTableId(role, spec.tableId),
      fields: M.resolveFieldMap(role, spec.fields),
      fromSavedConfig: !!(spec && spec.tableId)
    }
  }
  return out
}

async function loadSyncConfig () {
  const doc = await readDoc(SYNC_ID)
  return {
    // 缺字段默认**关**：自动改数据必须显式打开
    autoSync: !!(doc && doc.autoSync === true),
    autoSyncAt: (doc && doc.autoSyncAt) || 0,
    lastRun: (doc && doc.lastRun) || null
  }
}

/**
 * 同步一个目标：读飞书 → 映射 → 调既有 `upsertFromFeishu` 写库。
 * `adminOpsKey` 由本函数的**环境变量**提供（服务间调用），不经过客户端。
 */
async function pullOne (role, mapping, opsKey) {
  const target = M.TARGETS[role]
  if (!target) return fail(`未知同步目标：${role}`, 'BAD_TARGET')
  const spec = mapping[role]
  if (!spec || !spec.tableId) return fail(`「${target.label}」还没配飞书表 id`, 'NO_TABLE')

  let records = []
  try {
    records = await feishu.listAllRecords(spec.tableId, process.env)
  } catch (e) {
    const code = e && e.code === 'FEISHU_CREDS_MISSING' ? 'CREDS_MISSING' : 'FEISHU_ERROR'
    return fail(`读飞书失败：${(e && e.message) || e}`, code)
  }

  const items = target.build(records, spec.fields)
  if (!items.length) {
    return ok({ pulled: 0, written: 0, msg: `飞书「${target.label}」没有记录` })
  }

  /**
   * **分批写**：205 行一次 `cloud.callFunction` 会 `ESOCKETTIMEDOUT`
   * （服务间调用的内部超时比函数自身 60s 短得多，实测就是这么挂的）。
   * 50 条一批，既避开超时，也让单次失败不必重跑整表。
   */
  const CHUNK = 50
  const totals = { created: 0, updated: 0, skipped: 0, failedBatches: 0 }
  let lastMsg = ''
  for (let i = 0; i < items.length; i += CHUNK) {
    const part = items.slice(i, i + CHUNK)
    let res
    try {
      res = await cloud.callFunction({
        name: target.fn,
        data: Object.assign({ action: 'upsertFromFeishu', items: part, adminOpsKey: opsKey }, target.extra || {})
      })
    } catch (e) {
      totals.failedBatches += 1
      lastMsg = `第 ${Math.floor(i / CHUNK) + 1} 批失败：${(e && e.message) || e}`
      continue
    }
    // cloud.callFunction 的返回值在 result 里，可能是字符串（云函数返回 JSON 串）
    let body = res && res.result
    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch (e) { body = null }
    }
    if (!body || body.success === false) {
      totals.failedBatches += 1
      lastMsg = (body && body.msg) || `${target.fn} 返回异常`
      continue
    }
    const st = body.stats || {}
    totals.created += st.created || 0
    totals.updated += st.updated || 0
    totals.skipped += st.skipped || 0
  }

  const okAll = totals.failedBatches === 0
  return {
    success: okAll,
    pulled: records.length,
    written: totals.created + totals.updated,
    created: totals.created,
    updated: totals.updated,
    skipped: totals.skipped,
    failedBatches: totals.failedBatches,
    msg: okAll
      ? `飞书 ${records.length} 条 → 新建 ${totals.created} / 更新 ${totals.updated}`
      : `飞书 ${records.length} 条，其中 ${totals.failedBatches} 批写入失败：${lastMsg}`
  }
}

/** 一次跑多个目标；返回逐目标结果 + 汇总（单个目标失败不阻断其它目标） */
async function pullMany (roles, mapping, opsKey) {
  const results = {}
  for (const role of roles) {
    results[role] = await pullOne(role, mapping, opsKey)
  }
  const okCount = Object.values(results).filter((r) => r.success !== false).length
  return {
    results,
    okCount,
    failCount: roles.length - okCount,
    at: Date.now()
  }
}

async function saveLastRun (summary) {
  try {
    await db.collection(CONFIGS).doc(SYNC_ID).set({ data: { lastRun: summary, updatedAt: Date.now() } })
  } catch (e) {
    // 配置集合一定存在（configs 是全站通用），写失败只影响"上次结果"的展示，不该让同步本身失败
    console.error('[syncFeishuData] 写 lastRun 失败', e && e.message)
  }
}

exports.main = async (event, context) => {
  const e = event || {}
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''

  // ── 定时触发：开关关着就什么都不做（并留日志，便于排查"为什么没自动同步"）──
  const isTimer = String(e.Type || e.type || '') === 'Timer' || !!e.triggerName
  if (isTimer) {
    const cfg = await loadSyncConfig()
    if (!cfg.autoSync) {
      console.log('[syncFeishuData] 定时触发但 autoSync 未开启，跳过')
      return ok({ skipped: true, reason: 'autoSync 未开启' })
    }
    const opsKey = process.env.ADMIN_OPS_KEY || ''
    if (!opsKey) return fail('云函数未配置 ADMIN_OPS_KEY，无法服务间写库', 'NO_OPS_KEY')
    const mapping = await loadMapping()
    const summary = await pullMany(Object.keys(M.TARGETS), mapping, opsKey)
    await saveLastRun(Object.assign({ by: 'timer' }, summary))
    return ok(summary)
  }

  const action = String(e.action || '').trim()
  try {
    const auth = await requireSuper(e, openid)
    if (!auth.ok) return auth.res

    switch (action) {
      case 'status': {
        const mapping = await loadMapping()
        const cfg = await loadSyncConfig()
        const creds = feishu.credsStatus(process.env)
        const targets = []
        for (const role of Object.keys(M.TARGETS)) {
          const t = M.TARGETS[role]
          const local = await countLocal(LOCAL_COLLECTION[role])
          let remote = null
          let remoteError = ''
          if (creds.configured && mapping[role].tableId) {
            try {
              remote = await feishu.countRecords(mapping[role].tableId, process.env)
            } catch (err) {
              remoteError = (err && err.message) || String(err)
            }
          }
          targets.push({
            role,
            label: t.label,
            feishuTable: t.note,
            tableId: mapping[role].tableId,
            fromSavedConfig: mapping[role].fromSavedConfig,
            fieldCount: Object.keys(mapping[role].fields).length,
            localCount: local,
            remoteCount: remote,
            remoteError
          })
        }
        return ok({ creds, autoSync: cfg.autoSync, lastRun: cfg.lastRun, targets })
      }

      case 'pull': {
        const opsKey = process.env.ADMIN_OPS_KEY || ''
        if (!opsKey) return fail('云函数未配置 ADMIN_OPS_KEY，无法服务间写库', 'NO_OPS_KEY')
        const mapping = await loadMapping()
        const wanted = Array.isArray(e.targets) && e.targets.length ? e.targets : (e.target ? [e.target] : [])
        const roles = wanted.length ? wanted : Object.keys(M.TARGETS)
        const bad = roles.filter((r) => !M.TARGETS[r])
        if (bad.length) return fail(`未知同步目标：${bad.join('、')}`, 'BAD_TARGET')
        const summary = await pullMany(roles, mapping, opsKey)
        await saveLastRun(Object.assign({ by: 'manual' }, summary))
        return ok(summary)
      }

      case 'config.get':
        return ok({ config: await loadSyncConfig() })

      case 'config.save': {
        const autoSync = e.autoSync === true
        await db.collection(CONFIGS).doc(SYNC_ID).set({
          data: { autoSync, autoSyncAt: Date.now(), by: (auth.actor && auth.actor.name) || '' }
        })
        return ok({ config: await loadSyncConfig(), msg: autoSync ? '已开启自动同步（每天一次）' : '已关闭自动同步' })
      }

      default:
        return fail('未知 action', 'BAD_ACTION')
    }
  } catch (err) {
    console.error('[syncFeishuData]', action, err)
    return fail((err && err.message) || '服务异常', 'INTERNAL')
  }
}
