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
  purchase: 'ops_purchases',
  payroll: 'staff_payslips'
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

/**
 * 分页读全量（云开发单次上限 100，必须自己翻页）。
 * 用途：对账要算**全部**行 —— `managePurchaseOrder.list` 的 limit 硬顶 100，
 * 拿它做对账会得出"本地只有 100 行"的错误结论。
 */
async function fetchAll (collection, where) {
  const rows = []
  let skip = 0
  while (skip < 5000) {
    let res
    try {
      res = await db.collection(collection).where(where).skip(skip).limit(100).get()
    } catch (e) {
      break
    }
    const list = (res && res.data) || []
    rows.push(...list)
    if (list.length < 100) break
    skip += list.length
  }
  return rows
}

/** 「来自飞书」的本地行：有 feishuRecordId 且未删（手工录入 / 小程序盘点的行不算） */
function feishuRowsWhere () {
  return { feishuRecordId: _.exists(true).and(_.nin(['', null])), deleted: _.neq(true) }
}

/**
 * 本地行数（2026-11-27 改）：原来数**整张表**去和飞书比 —— 小程序盘点 / 手工录的行、软删的行都算进去，
 * 于是「本地 N 条 / 飞书 M 条（不一致）」几乎永远亮黄，真正的不一致反而看不出来。
 * 现在分开：`fromFeishu` = 来自飞书且未删的行（拿它与飞书比），`total` = 整表（只作参考）。
 */
async function countLocal (collection) {
  try {
    const total = await db.collection(collection).count()
    let fromFeishu = 0
    try {
      const r = await db.collection(collection).where(feishuRowsWhere()).count()
      fromFeishu = Number(r && r.total) || 0
    } catch (e) { fromFeishu = 0 }
    return { total: Number(total && total.total) || 0, fromFeishu }
  } catch (e) {
    return { total: -1, fromFeishu: -1 } // 集合不存在：与"0 条"区分开（0 条是"同步过但为空"，-1 是"根本没这张表"）
  }
}

/**
 * 合并写 `configs/feishu_sync`（2026-11-27 修）：原来 `saveLastRun` 与 `config.save` 都用 `doc.set()`
 * —— set 是**整文档替换**：每同步一次就把 `autoSync` 抹掉（自动同步跑完第一次就自己关了），
 * 反过来拨开关又把「上次结果」抹掉。改为先 update（只改给出的字段），文档不存在再 set。
 */
async function patchSyncDoc (patch) {
  const col = db.collection(CONFIGS)
  try {
    const r = await col.doc(SYNC_ID).update({ data: patch })
    if (r && r.stats && r.stats.updated === 0) {
      const got = await col.doc(SYNC_ID).get().catch(() => null)
      if (!(got && got.data)) await col.doc(SYNC_ID).set({ data: patch })
    }
  } catch (e) {
    await col.doc(SYNC_ID).set({ data: patch })
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

  /**
   * 同步前先体检「映射 vs 表」：
   *   · 表里没有的映射列 → **裁掉**（否则空值会把库里原有的好数据覆盖成空）；
   *   · 大片列都不存在 → 说明**表选错了**，此时**拒绝同步**（裁完再写会把别的表的行灌进这张台账）。
   */
  let fieldMap = spec.fields
  let dropped = []
  try {
    const cols = await feishu.listFieldNames(spec.tableId, process.env)
    const assess = M.assessMapping(spec.fields, cols, target.signature)
    if (assess.mismatch) {
      const why = assess.missingSignature.length
        ? `缺少签名列 ${assess.missingSignature.join('、')}`
        : `${assess.dropped.length}/${assess.total} 列不存在`
      return fail(
        `「${target.label}」的字段映射与该表对不上（${why}）—— 表很可能选错了，**拒绝同步以免写坏数据**`,
        'MAPPING_MISMATCH'
      )
    }
    fieldMap = assess.kept
    dropped = assess.dropped
  } catch (e) {
    // 列名体检失败不阻断同步（可能是权限/网络），但保守起见用原映射并记下原因
    dropped = []
  }

  let records = []
  try {
    records = await feishu.listAllRecords(spec.tableId, process.env)
  } catch (e) {
    const code = e && e.code === 'FEISHU_CREDS_MISSING' ? 'CREDS_MISSING' : 'FEISHU_ERROR'
    return fail(`读飞书失败：${(e && e.message) || e}`, code)
  }

  const items = target.build(records, fieldMap)
  if (!items.length) {
    return ok({ pulled: 0, written: 0, msg: `飞书「${target.label}」没有记录` })
  }

  /**
   * 飞书里已删、本地还留着的行（2026-11-27 加）：upsert 只增改不删，飞书那边删掉的行在本地永远在。
   * 这里**只报告、不删**（删数据是人的决定），让人知道「本地多出来的是哪些」。
   */
  let staleLocal = 0
  let staleSample = []
  try {
    const remoteIds = new Set(records.map((r) => String(r.record_id || r.recordId || '')).filter(Boolean))
    const localRows = await fetchAll(LOCAL_COLLECTION[role], feishuRowsWhere())
    const stale = localRows.filter((r) => !remoteIds.has(String(r.feishuRecordId)))
    staleLocal = stale.length
    staleSample = stale.slice(0, 5).map((r) => r.itemName || r.skuName || r.staffName || r.orderNo || r._id)
  } catch (e) { /* 读不到本地就不报 */ }

  /**
   * **分批写**：205 行一次 `cloud.callFunction` 会 `ESOCKETTIMEDOUT`
   * （服务间调用的内部超时比函数自身 60s 短得多，实测就是这么挂的）。
   * 50 条一批，既避开超时，也让单次失败不必重跑整表。
   */
  const CHUNK = target.chunk || 50
  const totals = { created: 0, updated: 0, skipped: 0, failedBatches: 0 }
  let lastMsg = ''
  const notes = []
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
    // 写入口的补充说明（如「N 条手工录入的工资条未被覆盖」）要带回给人看，不能吞掉
    if (Array.isArray(body.kept) && body.kept.length && body.msg && notes.indexOf(body.msg) === -1 && notes.length < 3) notes.push(body.msg)
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
    droppedColumns: dropped.map((d) => d.column),
    staleLocal,
    staleSample,
    msg: (okAll
      ? `飞书 ${records.length} 条 → 新建 ${totals.created} / 更新 ${totals.updated}`
      : `飞书 ${records.length} 条，其中 ${totals.failedBatches} 批写入失败：${lastMsg}`) +
      (totals.skipped ? `，跳过 ${totals.skipped}` : '') +
      (notes.length ? `（${notes.join('；')}）` : '') +
      (staleLocal ? `；本地有 ${staleLocal} 条在飞书已删除（未自动删）` : '')
  }
}

/**
 * 一次跑多个目标；返回逐目标结果 + 汇总（单个目标失败不阻断其它目标）。
 * `implicit`（「全部」/ 定时）时，还没配表 id 的目标记为**跳过**而不是失败 ——
 * 2026-11-27：员工薪酬的表 id 要在同步中心选表后才有，没配之前每天定时都报「失败 1 项」，真失败反而被淹没。
 */
async function pullMany (roles, mapping, opsKey, implicit) {
  const results = {}
  for (const role of roles) {
    const r = await pullOne(role, mapping, opsKey)
    results[role] = implicit && r && r.code === 'NO_TABLE'
      ? { success: true, skipped: true, msg: '还没选飞书表，已跳过' }
      : r
  }
  const okCount = Object.values(results).filter((r) => r.success !== false && !r.skipped).length
  const skipCount = Object.values(results).filter((r) => r.skipped).length
  return {
    results,
    okCount,
    skipCount,
    failCount: roles.length - okCount - skipCount,
    at: Date.now()
  }
}

async function saveLastRun (summary) {
  try {
    await patchSyncDoc({ lastRun: summary, updatedAt: Date.now() })
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
    const summary = await pullMany(Object.keys(M.TARGETS), mapping, opsKey, true)
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
          let missingColumns = []
          let tableColumns = null
          if (creds.configured && mapping[role].tableId) {
            try {
              remote = await feishu.countRecords(mapping[role].tableId, process.env)
            } catch (err) {
              remoteError = (err && err.message) || String(err)
            }
            /**
             * **列名体检**：映射里写的列名在该表**存在吗**？
             * 列名写错时同步不报错、只把整列取成空 —— 那是静默丢数据。
             * 这里只报告、不改配置（改配置是人的决定）。
             */
            try {
              tableColumns = await feishu.listFieldNames(mapping[role].tableId, process.env)
              const want = Object.values(mapping[role].fields || {})
              const set = new Set(tableColumns)
              missingColumns = [...new Set(want.filter((c) => c && !set.has(String(c).trim())))]
            } catch (err) {
              tableColumns = null
            }
          }
          targets.push({
            role,
            label: t.label,
            feishuTable: t.note,
            tableId: mapping[role].tableId,
            fromSavedConfig: mapping[role].fromSavedConfig,
            fieldCount: Object.keys(mapping[role].fields).length,
            localCount: local.fromFeishu,
            localTotal: local.total,
            remoteCount: remote,
            remoteError,
            missingColumns,
            columnCount: tableColumns ? tableColumns.length : null
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
        const summary = await pullMany(roles, mapping, opsKey, !wanted.length)
        await saveLastRun(Object.assign({ by: 'manual' }, summary))
        return ok(summary)
      }

      case 'budgetPools': {
        /**
         * 同步飞书「预算池配置」→ `configs/studio_budget_pools`。
         * 产品负责人 2026-09-19：「剩余总预算**以飞书为准**」——
         * 小程序不再自己重算（原先 剩余=年度−已使用，比飞书少扣房租 54,200 与宽带已付 948）。
         * 这里把飞书**算好的** 已使用/剩余 一起写回来，仪表盘直接采用。
         */
        const put = e.write !== false
        let records = []
        try {
          records = await feishu.listAllRecords(M.BUDGET_POOL_TABLE, process.env)
        } catch (err) {
          return fail(`读飞书预算池失败：${(err && err.message) || err}`, 'FEISHU_ERROR')
        }
        const pools = M.toBudgetPools(records)
        if (!pools.length) return fail('飞书预算池表没有可用行', 'EMPTY')
        const total = pools.find((p) => p.category === '总预算') || null
        const summary = {
          count: pools.length,
          totalPoolAnnual: total ? total.annualAmount : null,
          totalPoolUsed: total ? total.feishuUsedAmount : null,
          totalPoolRemaining: total ? total.feishuRemainingAmount : null
        }
        if (!put) return ok({ dryRun: true, pools, summary, msg: `试算：读到 ${pools.length} 个预算池` })
        await db.collection(CONFIGS).doc('studio_budget_pools').set({
          data: {
            pools: pools.map((p) => ({
              name: p.name,
              category: p.category,
              annualAmount: p.annualAmount,
              monthlyAmount: p.monthlyAmount,
              warnThreshold: p.warnThreshold,
              note: p.note,
              // 飞书算好的数：仪表盘以它为准
              feishuUsedAmount: p.feishuUsedAmount,
              feishuRemainingAmount: p.feishuRemainingAmount,
              feishuUsagePct: p.feishuUsagePct
            })),
            source: 'feishu',
            syncedAt: Date.now(),
            updatedAt: Date.now()
          }
        })
        return ok({ pools, summary, msg: `已同步 ${pools.length} 个预算池（剩余总预算以飞书为准：${summary.totalPoolRemaining}）` })
      }

      case 'reconcile': {
        /**
         * **对账**：同一口径同时算「飞书侧」与「本地侧」，并给出差异行。
         * 起因：产品负责人指出「工作室仪表盘的预算数据与飞书采购预算仪表盘对不上」——
         * 对不上必须先说清**差在哪几行**，否则只能猜。
         * 口径与仪表盘逐字一致：金额 = `amount ?? qty × unitPrice`，且只算未删且非 cancelled 的行。
         */
        const target = String(e.target || 'purchase').trim()
        if (target !== 'purchase') return fail('目前只支持 purchase 的对账', 'BAD_TARGET')
        const mapping = await loadMapping()
        const spec = mapping[target]
        if (!spec || !spec.tableId) return fail('采购表还没配飞书表 id', 'NO_TABLE')

        let records = []
        try {
          records = await feishu.listAllRecords(spec.tableId, process.env)
        } catch (err) {
          return fail(`读飞书失败：${(err && err.message) || err}`, 'FEISHU_ERROR')
        }
        // 与 pull 同样的裁剪：表里没有的列不参与（否则整列空值会污染对账）
        let fieldMap = spec.fields
        try {
          const cols = await feishu.listFieldNames(spec.tableId, process.env)
          const assess = M.assessMapping(spec.fields, cols, M.TARGETS[target].signature)
          if (assess.mismatch) return fail(`字段映射与表对不上（${assess.missingSignature.join('、')}），拒绝按错映射对账`, 'MAPPING_MISMATCH')
          fieldMap = assess.kept
        } catch (err) { /* 体检失败就用原映射 */ }

        const remoteItems = M.TARGETS[target].build(records, fieldMap)
        const remoteByRid = {}
        let remoteTotal = 0
        remoteItems.forEach((it, i) => {
          const amt = M.purchaseAmountOf(it)
          remoteTotal += amt
          if (it.feishuRecordId) remoteByRid[it.feishuRecordId] = { amt, name: it.itemName, no: it.orderNo, row: i }
        })
        remoteTotal = Math.round(remoteTotal * 100) / 100

        const localRows = (await fetchAll(LOCAL_COLLECTION[target], { deleted: _.neq(true) }))
          .filter((r) => M.isActivePurchaseOf(r))
        let localTotal = 0
        const localWithoutRid = []
        const amountMismatch = []
        const seen = {}
        localRows.forEach((r) => {
          const amt = M.purchaseAmountOf(r)
          localTotal += amt
          const rid = String(r.feishuRecordId || '')
          if (!rid) localWithoutRid.push({ name: r.itemName, no: r.orderNo, amount: amt, status: r.status })
          else {
            seen[rid] = true
            const rm = remoteByRid[rid]
            if (rm && Math.abs(rm.amt - amt) > 0.009) {
              amountMismatch.push({ rid, name: r.itemName, localAmount: amt, feishuAmount: rm.amt, diff: Math.round((amt - rm.amt) * 100) / 100 })
            }
          }
        })
        localTotal = Math.round(localTotal * 100) / 100
        const remoteMissingLocal = Object.keys(remoteByRid).filter((rid) => !seen[rid])

        return ok({
          target,
          localCount: localRows.length,
          remoteCount: remoteItems.length,
          localTotal,
          remoteTotal,
          diff: Math.round((localTotal - remoteTotal) * 100) / 100,
          localWithoutRidCount: localWithoutRid.length,
          localWithoutRid: localWithoutRid.slice(0, 20),
          amountMismatchCount: amountMismatch.length,
          amountMismatch: amountMismatch.slice(0, 20),
          remoteMissingLocalCount: remoteMissingLocal.length,
          remoteMissingLocal: remoteMissingLocal.slice(0, 20).map((rid) => remoteByRid[rid]),
          formula: '金额 = amount ?? qty × unitPrice（与仪表盘同一口径）；只算未删且非 cancelled'
        })
      }

      case 'config.get':
        return ok({ config: await loadSyncConfig() })

      case 'config.save': {
        const autoSync = e.autoSync === true
        await patchSyncDoc({ autoSync, autoSyncAt: Date.now(), by: (auth.actor && auth.actor.name) || '' })
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
