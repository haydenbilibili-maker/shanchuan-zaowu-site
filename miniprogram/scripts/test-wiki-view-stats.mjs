#!/usr/bin/env node
/**
 * 专题档案页阅读计数 · `test:wiki-view-stats`（A 流第 5 轮，新增旁路 wikiViewStats）
 *
 * 行为（内存 db 模拟「单文档条件更新原子 + 主键冲突」，与 CloudBase 语义一致）：
 *   首次打开计数；同一用户窗口内重复打开不计；窗口外再计；换用户计；同一用户并发两次只计一次；
 *   不存在的专题 / 非法 id / 无 openid 不写任何文档；降级来源 curated_collections 也能计；get 只读。
 * 接线（静态）：页面两条加载路径都调 wikiViewStats.view；阅读 / 收藏各自为 0 不画；
 *   三处同步（COLLECTIONS / rules 仅云函数 / schema）+ cloudbaserc 登记；getWikiData 契约未动（stats 仍是占位 0）。
 *
 * 用法：node miniprogram/scripts/test-wiki-view-stats.mjs [--selftest]
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const ROOT = resolve(MP, '..')
const rd = (p) => readFileSync(join(ROOT, p), 'utf8')
const SRC = {
  core: rd('miniprogram/cloudfunctions/wikiViewStats/viewStatsCore.js'),
  pageJs: rd('miniprogram/subpackages/content/collection-detail/index.js'),
  pageWxml: rd('miniprogram/subpackages/content/collection-detail/index.wxml'),
  cloudJs: rd('admin/src/cloud.js'),
  rc: rd('miniprogram/cloudbaserc.json'),
  wikiFn: rd('miniprogram/cloudfunctions/getWikiData/index.js')
}

function loadCore(src) {
  const module = { exports: {} }
  Function('module', 'exports', 'require', src)(module, module.exports, () => ({}))
  return module.exports
}

function fakeDb() {
  const store = {
    cms_wikis: new Map([['w1', { _id: 'w1' }]]),
    curated_collections: new Map([['c1', { _id: 'c1' }]]),
    wiki_stats: new Map(),
    wiki_view_marks: new Map()
  }
  const tick = () => new Promise((r) => setImmediate(r))
  const _ = { lt: (v) => ({ $lt: v }), inc: (n) => ({ $inc: n }) }
  const apply = (doc, data) => { for (const [k, v] of Object.entries(data)) doc[k] = v && v.$inc != null ? (doc[k] || 0) + v.$inc : v }
  const match = (doc, w) => Object.entries(w).every(([k, v]) => (v && v.$lt != null ? doc[k] < v.$lt : doc[k] === v))
  const db = {
    collection(name) {
      const m = store[name] || (store[name] = new Map())
      return {
        doc: (id) => ({
          async get() { await tick(); if (!m.has(id)) throw new Error('document not exists'); return { data: { ...m.get(id) } } },
          async update({ data }) { await tick(); if (!m.has(id)) return { stats: { updated: 0 } }; apply(m.get(id), data); return { stats: { updated: 1 } } }
        }),
        where: (w) => ({
          async update({ data }) { await tick(); let n = 0; for (const d of m.values()) if (match(d, w)) { apply(d, data); n += 1 } return { stats: { updated: n } } }
        }),
        async add({ data }) { await tick(); if (m.has(data._id)) throw new Error('duplicate key'); m.set(data._id, { ...data }); return { _id: data._id } }
      }
    }
  }
  return { db, _, store }
}

async function behaviour(core) {
  const out = []
  const add = (name, ok) => out.push({ name, ok: !!ok })
  const { db, _, store } = fakeDb()
  const T0 = 1_800_000_000_000
  const ctx = (openid, now) => ({ db, _, openid, now, serverDate: new Date(now) })
  const view = (wikiId, openid, now) => core.handle({ action: 'view', wikiId }, ctx(openid, now))

  const r1 = await view('w1', 'oA', T0)
  add('首次打开计数（views=1）', r1.success && r1.counted === true && r1.views === 1)
  const r2 = await view('w1', 'oA', T0 + 60_000)
  add('同一用户 1 分钟后重复打开不计', r2.success && r2.counted === false && r2.views === 1)
  const r3 = await view('w1', 'oA', T0 + core.WINDOW_MS - 1)
  add('窗口内最后一刻仍不计', r3.counted === false && r3.views === 1)
  const r4 = await view('w1', 'oA', T0 + core.WINDOW_MS + 1)
  add('窗口外再次打开计数（views=2）', r4.counted === true && r4.views === 2)
  const r5 = await view('w1', 'oB', T0 + 1000)
  add('另一用户计数（views=3）', r5.counted === true && r5.views === 3)
  const [c1, c2] = await Promise.all([view('w1', 'oC', T0), view('w1', 'oC', T0)])
  add('同一用户并发两次只计一次', [c1, c2].filter((r) => r.counted).length === 1 && (await core.handle({ action: 'get', wikiId: 'w1' }, ctx('', T0))).views === 4)
  const before = store.wiki_view_marks.size + store.wiki_stats.size
  const nf = await view('nope', 'oA', T0)
  add('不存在的专题返回 NOT_FOUND 且不写库', nf.success === false && nf.code === 'NOT_FOUND' && store.wiki_view_marks.size + store.wiki_stats.size === before)
  const bad = await Promise.all(['', '../w1', 'a'.repeat(65), 'w1;drop'].map((id) => view(id, 'oA', T0)))
  add('非法 wikiId 一律 BAD_ID', bad.every((r) => r.success === false && r.code === 'BAD_ID'))
  const marksBefore = store.wiki_view_marks.size
  const anon = await view('w1', '', T0 + 5)
  add('无 openid 只读不计', anon.success && anon.counted === false && anon.views === 4 && store.wiki_view_marks.size === marksBefore)
  const cc = await view('c1', 'oA', T0)
  add('降级来源 curated_collections 的专题也计数', cc.counted === true && cc.views === 1)
  const g = await core.handle({ action: 'get', wikiId: 'w1' }, ctx('oZ', T0))
  add('get 只读：回计数、likes 恒 0、不写标记', g.success && g.views === 4 && g.likes === 0 && !store.wiki_view_marks.has('oZ_w1'))
  add('未知 action 拒绝', (await core.handle({ action: 'reset', wikiId: 'w1' }, ctx('oA', T0))).code === 'BAD_ACTION')
  return out
}

function wiring(s) {
  const out = []
  const add = (name, ok) => out.push({ name, ok: !!ok })
  add('页面两条加载路径（getWikiData / curated_collections 降级）都调 loadViewStats(id)', (s.pageJs.match(/\n\s+this\.loadViewStats\(id\)\n/g) || []).length === 2)
  add('loadViewStats 调 wikiViewStats.view 且只写 wiki.stats、失败静默',
    /name: 'wikiViewStats', data: \{ action: 'view', wikiId: id \}/.test(s.pageJs) && /'wiki\.stats': \{ views: r\.views \|\| 0, likes: r\.likes \|\| 0 \}/.test(s.pageJs) && /\.catch\(\(\) => \{\}\)/.test(s.pageJs))
  add('阅读 / 收藏各自为 0 不画（整行仍在两者皆 0 时隐藏）',
    /<view class="stats-row" wx:if="\{\{wiki\.stats\.views \|\| wiki\.stats\.likes\}\}">/.test(s.pageWxml) &&
    /<view class="stat-item" wx:if="\{\{wiki\.stats\.views\}\}">/.test(s.pageWxml) && /<view class="stat-item" wx:if="\{\{wiki\.stats\.likes\}\}">/.test(s.pageWxml))
  const rule = (n) => { try { const j = JSON.parse(rd(`cloudbase/rules/${n}.json`)); return j.read === false && j.write === false } catch { return false } }
  add('三处同步：COLLECTIONS 两条 + rules 仅云函数 + schema 文档',
    /WIKI_STATS: 'wiki_stats'/.test(s.cloudJs) && /WIKI_VIEW_MARKS: 'wiki_view_marks'/.test(s.cloudJs) &&
    rule('wiki_stats') && rule('wiki_view_marks') && existsSync(join(ROOT, 'cloudbase/schema/wiki_stats.md')) && existsSync(join(ROOT, 'cloudbase/schema/wiki_view_marks.md')))
  add('cloudbaserc 登记 wikiViewStats', /"name": "wikiViewStats"/.test(s.rc))
  add('getWikiData 契约未动（get_detail 的 stats 仍为占位 0）', /stats: \{ views: 0, likes: 0 \}/.test(s.wikiFn))
  return out
}

async function run(s) {
  let core
  try { core = loadCore(s.core) } catch (e) { return [{ name: `核加载失败：${e.message}`, ok: false }] }
  return [...(await behaviour(core)), ...wiring(s)]
}

if (process.argv.includes('--selftest')) {
  const INJ = [
    ['去掉防刷窗口', 'core', (t) => t.replace('_.lt(now - WINDOW_MS)', '_.lt(now + 1)')],
    ['主键冲突也当计数（并发双计）', 'core', (t) => t.replace(/(await db\.collection\(MARKS\)\.add[^\n]*\n\s+return true\n\s+\} catch \(e\) \{\n\s+)return false/, '$1return true')],
    ['不校验专题存在', 'core', (t) => t.replace("if (!(await wikiExists(db, wikiId))) return { success: false, code: 'NOT_FOUND', msg: '专题不存在' }", '')],
    ['放宽 id 校验', 'core', (t) => t.replace('const ID_RE = /^[\\w-]{1,64}$/', 'const ID_RE = /.*/')],
    ['降级路径漏调计数', 'pageJs', (t) => t.replace('          this.loadViewStats(id)\n', '')],
    ['收藏为 0 也画', 'pageWxml', (t) => t.replace('<view class="stat-item" wx:if="{{wiki.stats.likes}}">', '<view class="stat-item">')],
    ['COLLECTIONS 漏登记防刷集合', 'cloudJs', (t) => t.replace("WIKI_VIEW_MARKS: 'wiki_view_marks'", "WIKI_VIEW_MARK: 'wiki_view_marks'")]
  ]
  const base = await run(SRC)
  let ok = base.every((c) => c.ok)
  console.log(`${ok ? '✓' : '✗'} 基线：真源码全部通过`)
  if (!ok) base.filter((c) => !c.ok).forEach((c) => console.log('   ✗ ' + c.name))
  for (const [name, key, fn] of INJ) {
    const mutated = { ...SRC, [key]: fn(SRC[key]) }
    if (mutated[key] === SRC[key]) { console.log(`✗ 注入锚点失效：${name}`); ok = false; continue }
    const red = (await run(mutated)).some((c) => !c.ok)
    if (!red) ok = false
    console.log(`${red ? '✓' : '✗'} 注入「${name}」→ ${red ? '被检出' : '未检出'}`)
  }
  console.log(ok ? '✓ selftest 通过' : '✗ selftest 失败')
  process.exit(ok ? 0 : 1)
}

const res = await run(SRC)
for (const c of res) console.log(`${c.ok ? '✓' : '✗'} ${c.name}`)
const ok = res.every((c) => c.ok)
console.log(ok ? `✓ 专题阅读计数 ${res.length} 项通过（防刷窗口 / 并发 / 不存在与非法 id / 接线与三处同步）` : '✗ 专题阅读计数断言失败')
process.exit(ok ? 0 : 1)
