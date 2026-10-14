#!/usr/bin/env node
/**
 * 藏品库「高风险藏品 + 一键上下线 + 停留当前页 + 水印」守卫（manager 域）
 *
 * 起因（产品负责人 2026-10-13，提审前点名）：
 *   ① 藏品库要能一眼认出「三有 / 保护类」标本，并能**一键全下架**（合规兜底）；
 *   ② 上下线 / 编辑保存 / 搜索之后必须**停留在当前页**（原先每次操作都整页重载 + 全屏遮罩，
 *      还把列表拉回第一页，一次操作丢掉已加载的多页与滚动位置）；
 *   ③ 商品图上的「已下架 / 已上架」水印不明显。
 *
 * 判据（每条都配自检注入，见 `--selftest`）：
 *   A1 高风险口径三方同源：云函数 PROTECTED_TYPES ≡ 客户端 PROTECTED_TYPE_LABELS ≡ {sanyou, protected_plant, protected_animal}，
 *      且**都不含 none**（把 none 算进去 = 全库都成高风险）
 *   A2 一键上下线**复用既有审批接口**（manageApprovals.submitProductShelf），不新增写库旁路
 *   A3 作用域是**全量**（分页扫描 + 只认服务端 total），不是当前页
 *   A4 执行前必须有确认弹窗，且带件数；下架方向用危险色
 *   B1 上下线不再整页重载（toggleShelf 不许出现无参 loadProducts，改走就地更新）
 *   B2 搜索 / 排序 / 筛选的刷新不弹全屏遮罩（silent）
 *   C1 水印四态齐全（已上架 / 已下架 / 审核中 / 已驳回）且样式有对应类
 *   C2 水印文字不再半透明（原来 approved 只有 .55 透明度，实拍图上看不见）
 *   D  页面接线：高风险 chip、工具条两个方向、卡片高风险标签、筛选计数
 *
 * 用法：node miniprogram/scripts/check-product-lib-risk.mjs
 *       node miniprogram/scripts/check-product-lib-risk.mjs --selftest
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const F = {
  cfg: 'miniprogram/subpackages/manager/manager/managerPageConfig.js',
  wxml: 'miniprogram/subpackages/manager/manager/workspace/_subviews.wxml',
  wxss: 'miniprogram/subpackages/manager/manager/index.wxss',
  fn: 'miniprogram/cloudfunctions/manageProducts/index.js'
}

const read = (f) => readFileSync(resolve(ROOT, f), 'utf8')

/** 取一个对象方法体：从 `名(...) {` 到下一处同缩进的 `},`（守卫只看这一段，避免误伤同文件其它地方） */
function methodBody(src, name) {
  const i = src.search(new RegExp(`\\n  (?:async )?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\(`))
  if (i < 0) return ''
  const end = src.indexOf('\n  },', i)
  return end < 0 ? src.slice(i) : src.slice(i, end)
}

export function run(src = {}) {
  const cfg = src.cfg ?? read(F.cfg)
  const wxml = src.wxml ?? read(F.wxml)
  const wxss = src.wxss ?? read(F.wxss)
  const fn = src.fn ?? read(F.fn)
  const fails = []
  const ok = (cond, msg) => { if (!cond) fails.push(msg) }

  /* ── A1 口径三方同源 ───────────────────────────────────────────── */
  const CANON = ['sanyou', 'protected_plant', 'protected_animal']
  const fnTypes = (fn.match(/const PROTECTED_TYPES = \[([^\]]*)\]/) || [])[1] || ''
  const fnList = fnTypes.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  ok(CANON.every((t) => fnList.includes(t)) && fnList.length === CANON.length,
    `A1 云函数 PROTECTED_TYPES 不等于 ${CANON.join('/')}（实得 ${fnList.join('/') || '无'}）`)
  ok(!fnList.includes('none'), 'A1 云函数把 none 也算成高风险（那全库都是高风险）')

  const labelBlock = (cfg.match(/const PROTECTED_TYPE_LABELS = \{([\s\S]*?)\}/) || [])[1] || ''
  const cfgKeys = [...labelBlock.matchAll(/(\w+)\s*:/g)].map((m) => m[1])
  ok(CANON.every((t) => cfgKeys.includes(t)) && cfgKeys.length === CANON.length,
    `A1 客户端 PROTECTED_TYPE_LABELS 的键不等于 ${CANON.join('/')}（实得 ${cfgKeys.join('/') || '无'}）`)

  /* ── A2/A3/A4 一键上下线 ──────────────────────────────────────── */
  const bulk = methodBody(cfg, 'bulkToggleHighRisk')
  ok(!!bulk, 'A2 找不到 bulkToggleHighRisk（一键上下线）')
  ok(/action:\s*'submitProductShelf'/.test(bulk) && /name:\s*'manageApprovals'/.test(bulk),
    'A2 一键上下线没有复用 manageApprovals.submitProductShelf（不许新增写库旁路）')
  ok(!/\.collection\(/.test(bulk), 'A2 一键上下线里出现直接读写集合（绕过了审批接口）')
  ok(/this\._scanProductIds\(/.test(bulk), 'A3 作用域不是分页扫描（_scanProductIds）')
  ok(!/this\.data\.products/.test(bulk), 'A3 作用域用了当前页列表（this.data.products）——只处理第一页')
  const scan = methodBody(cfg, '_scanProductIds')
  ok(/action:\s*'list'/.test(scan) && /pageSize/.test(scan) && /total/.test(scan) && /page \+= 1/.test(scan),
    'A3 _scanProductIds 没有「分页 + 只认服务端 total」的扫描循环')
  ok(/page <= 50/.test(scan), 'A3 _scanProductIds 缺页数上限兜底（死循环风险）')
  ok(/openAppModal\(/.test(bulk) && /\$\{ids\.length\}/.test(bulk),
    'A4 一键上下线没有确认弹窗或没带件数')
  ok(/#D64045/i.test(bulk), 'A4 一键下架没有用危险色（确认框缺危险语义）')

  /* ── B1/B2 停留当前页 ─────────────────────────────────────────── */
  const toggle = methodBody(cfg, 'toggleShelf')
  ok(!!toggle, 'B1 找不到 toggleShelf')
  ok(!/this\.loadProducts\(\)/.test(toggle), 'B1 toggleShelf 仍在整页重载（loadProducts()）')
  ok(/this\._patchShelfRow\(/.test(toggle), 'B1 toggleShelf 没有走就地更新（_patchShelfRow）')

  for (const [name, label] of [
    ['onSearchInput', '搜索'],
    ['setProductSort', '切排序'],
    ['setProductArchiveFilter', '在档筛选'],
    ['setProductPromoFilter', '促销筛选']
  ]) {
    const body = methodBody(cfg, name)
    ok(!!body, `B2 找不到 ${name}`)
    ok(!/this\.loadProducts\(\)/.test(body), `B2 ${label}（${name}）仍在弹全屏遮罩重载（loadProducts() 无参）`)
    ok(/this\.loadProducts\(\{\s*silent:\s*true\s*\}\)/.test(body), `B2 ${label}（${name}）没有走 silent 刷新`)
  }

  /* ── C1/C2 水印 ──────────────────────────────────────────────── */
  const wm = (cfg.match(/function resolveProductShelfWatermark\(p\) \{[\s\S]*?\n\}/) || [''])[0]
  for (const t of ['已上架', '已下架', '审核中', '已驳回']) {
    ok(wm.includes(`'${t}'`), `C1 水印缺「${t}」态`)
  }
  for (const c of ['approved', 'offshelf', 'pending', 'rejected']) {
    ok(new RegExp(`className: '${c}'`).test(wm), `C1 水印缺 ${c} 样式类`)
  }
  ok(/\.p-wm\.offshelf \.p-wm-text/.test(wxss), 'C1 样式缺 .p-wm.offshelf .p-wm-text（已下架没样式）')
  const wmText = (wxss.match(/\.p-wm-text \{[\s\S]*?\n\}/) || [''])[0]
  ok(!/opacity\s*:\s*0\.[0-8]/.test(wmText), 'C2 .p-wm-text 又是半透明（原先 approved 只有 .55，实拍图上看不见）')
  ok(!/rotate\(/.test(wmText), 'C2 .p-wm-text 又回到斜字（120rpx 缩略图上辨识度差）')
  for (const c of ['approved', 'pending', 'rejected', 'offshelf']) {
    ok(new RegExp(`\\.p-wm\\.${c} \\.p-wm-text`).test(wxss), `C2 样式缺 .p-wm.${c} .p-wm-text 的配色`)
  }

  /* ── D 页面接线 ──────────────────────────────────────────────── */
  ok(/bindtap="bulkToggleHighRisk"[^>]*data-on="0"/.test(wxml), 'D 工具条缺「一键下架」按钮')
  ok(/bindtap="bulkToggleHighRisk"[^>]*data-on="1"/.test(wxml), 'D 工具条缺「一键上架」按钮')
  ok(/bindtap="setProductRiskFilter"[^>]*data-val="high"/.test(wxml), 'D 筛选条缺「高风险」chip')
  ok(/item\.isHighRisk/.test(wxml), 'D 藏品卡没有高风险标签')
  ok(/productShelfCounts\.on/.test(wxml) && /productShelfCounts\.off/.test(wxml),
    'D 筛选条没有用上架态计数（productShelfCounts）')
  ok(/bindtap="resetProductFilters"/.test(wxml), 'D 「全部」没有走一键清空筛选')
  ok(/highRiskCount/.test(wxml), 'D 工具条没有显示高风险件数')

  /* ── E 分类管理（第③项后半）展示层检索 / 排序 / 空分类 ────────────── */
  const catFn = (cfg.match(/rebuildCatTreeView\(\) \{[\s\S]*?\n  \},/) || [''])[0]
  ok(!!catFn, 'E1 找不到 rebuildCatTreeView（分类树展示层派生）')
  ok(!/categoryManageTree:\s*view/.test(catFn) && !/setData\(\{[^}]*categoryManageTree/.test(catFn),
    'E1 派生视图写回了源树 categoryManageTree（新增分类 / 关联弹层按下标取值会错位）')
  const submitCat = methodBody(cfg, 'submitCategory')
  ok(/this\.data\.categoryManageTree/.test(submitCat),
    'E1 submitCategory 不再读源树（改读过滤后的视图会取错「所属一级分类」）')
  ok(/hit\(root\.name\)/.test(catFn) && /hit\(root\.enName\)/.test(catFn), 'E2 检索没有覆盖一级的中文 / 英文名')
  ok(/hit\(c\.latinName\)/.test(catFn) || /hit\(c\.latin\)/.test(catFn), 'E2 检索没有覆盖二级的拉丁名')
  ok(/mode === 'count'/.test(catFn) && /mode === 'name'/.test(catFn), 'E3 缺「按数量 / 按名称」排序分支')
  // 一级与二级**都要**按中文序（只改一层 = 用户看到两段不同顺序）
  ok((catFn.match(/localeCompare\([\s\S]{0,120}?'zh/g) || []).length >= 2, 'E3 名称排序没覆盖一级与二级两层（中文排序缺失）')
  ok(/isEmpty/.test(catFn) && /emptyCount \+= 1/.test(catFn) && /catEmptyCount: emptyCount/.test(catFn),
    'E4 没有空分类标记或其计数没真的累加（chip 上的数字会恒 0）')
  ok(/catOnlyEmpty/.test(catFn), 'E4 没有「只看空分类」筛选')
  ok(/totalCount:\s*children\.reduce\(/.test(catFn), 'E5 一级分类的合计件数不是由二级求和（恒 0 = 假合计）')
  ok(/wx:for="\{\{catTreeView\}\}"/.test(wxml), 'E6 分类树没有用派生视图 catTreeView')
  ok(/bindinput="setCatKeyword"/.test(wxml), 'E6 分类页没有检索输入框')
  ok(/没有匹配的分类/.test(wxml), 'E6 筛选后的空态没有区分文案')

  return fails
}

function selftest() {
  let okN = 0
  let bad = 0
  const t = (name, cond, extra) => {
    if (cond) { okN += 1; console.log(`  ✓ ${name}`) }
    else { bad += 1; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`) }
  }
  const base = { cfg: read(F.cfg), wxml: read(F.wxml), wxss: read(F.wxss), fn: read(F.fn) }
  const clean = run(base)
  t('未注入时通过（无假阳性）', clean.length === 0, clean.join(' | '))

  const HTML = 'miniprogram/subpackages/manager/manager/workspace/_subviews.wxml'
  const cases = [
    ['云函数把 none 也算高风险', (s) => ({ ...s, fn: s.fn.replace("const PROTECTED_TYPES = ['sanyou', 'protected_plant', 'protected_animal']", "const PROTECTED_TYPES = ['none', 'sanyou']") }), /A1/],
    ['客户端口径漏掉保护植物', (s) => ({ ...s, cfg: s.cfg.replace('  protected_plant: \'保护植物\',\n', '') }), /A1/],
    ['一键上下线改直写集合（绕过审批）', (s) => ({ ...s, cfg: s.cfg.replace("        data: { action: 'submitProductShelf', productId: id, onShelf }", "        data: { action: 'bulkSet', ids }") }), /A2/],
    ['作用域改回当前页', (s) => ({ ...s, cfg: s.cfg.replace('      ids = await this._scanProductIds({ riskFilter: \'high\' });', '      ids = (this.data.products || []).map((r) => r._id);') }), /A3/],
    ['扫描丢掉分页', (s) => ({ ...s, cfg: s.cfg.replace('      page += 1;\n    }\n    return ids;', '    }\n    return ids;') }), /A3/],
    ['去掉确认弹窗', (s) => ({ ...s, cfg: s.cfg.replace('      openAppModal({\n        title: onShelf ? \'一键上架高风险藏品\' : \'一键下架高风险藏品\',', '      Promise.resolve({\n        title: onShelf ? \'一键上架高风险藏品\' : \'一键下架高风险藏品\',') }), /A4/],
    ['toggleShelf 回到整页重载', (s) => ({ ...s, cfg: s.cfg.replace("        this._patchShelfRow(id, { isOffShelf: !onShelf, shelfApprovalStatus: '' });", '        this.loadProducts();') }), /B1/],
    ['搜索回到弹遮罩重载', (s) => ({ ...s, cfg: s.cfg.replace('this.timer = setTimeout(() => { this.loadProducts({ silent: true }); }, 500);', 'this.timer = setTimeout(() => { this.loadProducts(); }, 500);') }), /B2/],
    ['切排序回到弹遮罩重载', (s) => ({ ...s, cfg: s.cfg.replace("    // 2026-10-13：切排序属于「本来就该重查」，但**不弹全屏遮罩**（弹了就像整页刷新，还打断视线）\n    this.loadProducts({ silent: true });", '    this.loadProducts();') }), /B2/],
    ['水印丢掉已下架态', (s) => ({ ...s, cfg: s.cfg.replace("  if (status === 'offshelf') return { status, text: '已下架', className: 'offshelf' };\n", '') }), /C1/],
    ['水印样式回到半透明斜字', (s) => ({ ...s, wxss: s.wxss.replace('.p-wm-text {\n  position: absolute;\n  left: 0; top: 0;', '.p-wm-text {\n  opacity: 0.55;\n  transform: rotate(-28deg);\n  position: absolute;\n  left: 0; top: 0;') }), /C2/],
    ['样式丢掉已下架配色', (s) => ({ ...s, wxss: s.wxss.replace(/\/\* 已下架：墨底浅字[\s\S]*?\n\}\n/, '') }), /C2/],
    ['页面去掉高风险 chip', (s) => ({ ...s, wxml: s.wxml.replace('bindtap="setProductRiskFilter" data-val="high"', 'bindtap="setProductRiskFilter" data-val="normal"') }), /D/],
    ['工具条丢掉一键下架', (s) => ({ ...s, wxml: s.wxml.replace('bindtap="bulkToggleHighRisk" data-on="0"', 'bindtap="bulkToggleHighRisk" data-on="1"') }), /D/],
    ['卡片丢掉高风险标签', (s) => ({ ...s, wxml: s.wxml.replace('wx:if="{{item.isHighRisk}}"', 'wx:if="{{false}}"') }), /D/],
    /* ── E 分类管理 ── */
    ['派生视图写回源树（下标会错位）', (s) => ({ ...s, cfg: s.cfg.replace('    catTreeView: view,', '    catTreeView: view,\n    categoryManageTree: view,') }), /E1/],
    ['submitCategory 改读过滤后的视图', (s) => ({ ...s, cfg: s.cfg.replace('    const tree = this.data.categoryManageTree || [];', '    const tree = this.data.catTreeView || [];') }), /E1/],
    ['检索丢掉拉丁名', (s) => ({ ...s, cfg: s.cfg.replace('if (kw && !rootHit) kept = kept.filter((c) => hit(c.name) || hit(c.latinName) || hit(c.latin) || hit(c.enName));', 'if (kw && !rootHit) kept = kept.filter((c) => hit(c.name));') }), /E2/],
    ['排序丢掉按名称分支', (s) => ({ ...s, cfg: s.cfg.replace("    } else if (mode === 'name') {\n      kept = kept.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'));\n    }", '    }') }), /E3/],
    ['丢掉空分类计数', (s) => ({ ...s, cfg: s.cfg.replace('      if (count === 0) emptyCount += 1;', '') }), /E4/],
    ['丢掉一级合计件数', (s) => ({ ...s, cfg: s.cfg.replace('      totalCount: children.reduce((sum, c) => sum + (Number(c.productCount) || 0), 0) + (Number(root.productCount) || 0),', '      totalCount: 0,') }), /E5/],
    ['分类树用回源树渲染', (s) => ({ ...s, wxml: s.wxml.replace('wx:for="{{catTreeView}}"', 'wx:for="{{categoryManageTree}}"') }), /E6/],
    ['分类页丢掉检索框', (s) => ({ ...s, wxml: s.wxml.replace('bindinput="setCatKeyword"', 'bindinput="noopSearch"') }), /E6/]
  ]
  for (const [name, mut, expect] of cases) {
    const mutated = mut(base)
    const changed = Object.keys(base).some((k) => base[k] !== mutated[k])
    if (!changed) { bad += 1; console.error(`  ✗ 锚点失效（注入没改动任何文件）：${name}`); continue }
    const got = run(mutated)
    t(`★ 被检出：${name}`, got.some((f) => expect.test(f)), got.join(' | ') || '无')
  }
  console.log(`\n${bad ? `✗ 自检失败 ${bad} 项` : `✓ 自检通过：${okN} 项（含 ${cases.length} 条注入，内存副本不写盘）`}`)
  if (bad) process.exit(1)
}

if (process.argv.includes('--selftest')) selftest()
else {
  const fails = run()
  if (fails.length) {
    console.error(`✗ 藏品库高风险 / 停留页 / 水印检查失败（${fails.length}）：`)
    for (const f of fails) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log('✓ 藏品库：高风险口径同源 / 一键上下线走审批且全量 / 操作后停留当前页 / 水印四态可辨')
}
