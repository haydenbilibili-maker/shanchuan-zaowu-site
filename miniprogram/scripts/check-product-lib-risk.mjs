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
  const bulk = methodBody(cfg, 'bulkToggleRisk')
  ok(!!bulk, 'A2 找不到 bulkToggleRisk（一键上下线）')
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

  /* ── A5/A6 中等风险（动物类）——两个独立入口 ───────────────────── */
  const animalKingdoms = (fn.match(/const ANIMAL_KINGDOMS = \[([^\]]*)\]/) || [])[1] || ''
  ok(/动物界/.test(animalKingdoms) && /Animalia/i.test(animalKingdoms),
    `A5 云函数 ANIMAL_KINGDOMS 没覆盖「动物界 / Animalia」（实得 ${animalKingdoms || '无'}）`)
  ok(/riskFilter === 'medium'/.test(fn), 'A5 云函数缺 riskFilter=medium（中等风险）分支')
  // ⚠️ 2026-10-14 修正**假阴性**：原来是 `/animalCategoryIds = await loadAnimalCategoryIds\(\)/`，
  //    而 `const animalCategoryIds = await loadAnimalCategoryIds()` 里也含这段子串 ——
  //    新增的 riskOverview 里正好有这么一行，于是「把 list 的分类兜底拆掉」这条注入**检不出来**了。
  //    改成必须以「行首缩进 + 裸赋值」出现（`const ` 前缀不算），注入才落得进判据。
  ok(/\n\s+animalCategoryIds = await loadAnimalCategoryIds\(\)/.test(fn),
    'A5 中等风险没用「所属分类属动物界」兜底（历史商品 taxonomy 可能为空）')
  const mediumBlock = (fn.match(/riskFilter === 'medium'\) \{[\s\S]*?\n  \}/) || [''])[0]
  ok(/\.nin\(PROTECTED_TYPES\)/.test(mediumBlock),
    'A5 中等风险没有排除保护类（与高风险重叠 → 同一件落进两个一键入口、计数重复）')
  ok(/dataset\.risk|ds\.risk/.test(bulk) && /riskFilter: risk/.test(bulk),
    'A6 一键上下线没有按 data-risk 区分高/中等两个口径')
  ok(/mediumRiskCount: 0,/.test(cfg) && /highRiskCount: 0,/.test(cfg), 'A6 高/中等风险没有各自独立的件数（data 默认值）')
  // 两个口径各自**上架 + 下架**两只按钮 = 2 + 2，共 4 个独立入口
  ok((wxml.match(/data-risk="high"/g) || []).length === 2 && (wxml.match(/data-risk="medium"/g) || []).length === 2,
    'A6 高/中等风险的两个独立入口不完整（应各 2 颗：下架 / 上架）')
  ok(/productRiskFilter==='medium'/.test(wxml), 'A6 筛选条缺「中等风险」chip')

  /* ── A7 风险三层：互斥穷尽 + 内存判据与 DB where 同源（2026-10-14）─────────
     起因：产品负责人真机看到「中等风险 216 件」，与先前判断的 12 件不符。
     于是把高/中风险抽成独立「风险管理」tab，并在服务端给出**可自证**的三层划分。
     三层必须互斥且相加 = 全库，否则概览上的数字加不回总数（一眼假）。
     线上真数据核对（2026-10-14）：内存 11/216/28 == where 11/216/28，相加 255 == 全库 255。 */
  const tierFn = (fn.match(/function riskTierOf\(row, animalCategoryIds = \[\]\) \{[\s\S]*?\n\}/) || [''])[0]
  ok(!!tierFn, 'A7 云函数缺 riskTierOf（风险三层的内存判据）')
  ok(/PROTECTED_TYPES\.indexOf\(pt\)\s*>=\s*0/.test(tierFn), 'A7 riskTierOf 的 high 判定没走 PROTECTED_TYPES（第二套口径）')
  ok(/isAnimalTaxonomy\(row\)/.test(tierFn) && /isAnimalCategory\(row, animalCategoryIds\)/.test(tierFn),
    'A7 riskTierOf 的 medium 判定没走 isAnimalTaxonomy / isAnimalCategory（与 where 分支的口径会分叉）')
  ok(/return 'normal'/.test(tierFn), 'A7 riskTierOf 缺 normal 兜底（三层不穷尽 = 有藏品归不了类）')
  // normal 分支必须是**真补集**：原来是「none / 缺失」，那会把 216 件中等风险再包一遍（三层相加 ≠ 全库）
  const normalBlock = (fn.match(/riskFilter === 'normal'\) \{[\s\S]*?\n  \}/) || [''])[0]
  ok(/\.nin\(ANIMAL_KINGDOMS\)/.test(normalBlock) && /\.nin\(PROTECTED_TYPES\)/.test(normalBlock),
    'A7 normal 分支不是「非高风险且非中等风险」的真补集（三层相加会超过全库）')
  ok(!/_\.exists\(false\)/.test(normalBlock), 'A7 normal 分支又回到「protectionType 缺失」（与中等风险重叠）')
  // 只读概览 action：注册 + 路由
  ok(/async function riskOverview\(event, actor\)/.test(fn), 'A7 云函数缺 riskOverview（风险分层概览）')
  ok(/case 'riskOverview':/.test(fn), "A7 riskOverview 没有注册进 action 路由（前端调用会得到「未知 action」）")
  ok(/tiers\s*=\s*\{\s*high: blank\(\), medium: blank\(\), normal: blank\(\)\s*\}/.test(fn),
    'A7 riskOverview 没有同时给出 high / medium / normal 三层')
  ok(/tiers\.high\.byProtection/.test(fn) && /tiers\.medium\.byBasis/.test(fn),
    'A7 概览缺「高风险按保护类细分 / 中等风险按命中原因细分」')
  // ⚠️ 只断言 `/missingCert/` 会假阴性：`blank()` 里的 `missingCert: 0` 就满足了它。
  // 必须断言**真的在累加** —— 否则「概览缺合规提醒计数」这条注入检不出来。
  ok(/bucket\.missingCert \+= 1/.test(fn) && /all\.missingCert \+= 1/.test(fn),
    'A7 概览缺缺收藏证书计数（合规提醒的唯一数据源）')
  // 合规提醒必须**分两档**：先问保护类缺不缺（缺了才是真警报），不缺才退成静默提示。
  // 线上实测 244/255 为空、但高风险 11 件一件不缺 —— 一句「全空」会把做到位的部分也说成没做。
  ok(/riskOverview\.tiers\.high\.missingCert > 0/.test(wxml),
    'A7 合规提醒没有先看「保护类有没有缺证书」（不分档 = 把做到位的部分也说成没做）')
  // 扫描循环只许有一处（list 与 riskOverview 共用）—— 两处各写一次必然漂移
  ok(/async function scanProducts\(where\)/.test(fn), 'A7 缺共用的 scanProducts（list 与概览各写一套扫描循环会漂移）')
  // 「通用全量扫描」只许有一处 —— 就是 scanProducts 里那句 `if (where) query = query.where(where)`。
  // （backfillMineProductLinks 另有两条扫描，但它们各带固定 where，不是通用扫描。）
  ok((fn.match(/if \(where\) query = query\.where\(where\)/g) || []).length === 1,
    `A7 通用全量扫描循环出现了 ${(fn.match(/if \(where\) query = query\.where\(where\)/g) || []).length} 处（只该有 scanProducts 一处）`)
  ok(/await scanProducts\(where\)/.test(fn) && /await scanProducts\(scopeCond\)/.test(fn),
    'A7 list 与 riskOverview 没有共用 scanProducts')
  ok(/function buildScopeCondition\(event, actor, verifiedFramerId\)/.test(fn) &&
    (fn.match(/buildScopeCondition\(event, actor, verifiedFramerId\)/g) || []).length >= 3,
    'A7 「本人藏品」作用域没有共用 buildScopeCondition（概览与清单的口径会分叉）')

  /* ── A8 命中原因（凭什么算这一层）────────────────────────────── */
  const basisFn = (fn.match(/function riskBasisOf\(row, animalCategoryIds = \[\]\) \{[\s\S]*?\n\}/) || [''])[0]
  ok(!!basisFn, 'A8 云函数缺 riskBasisOf（逐件命中原因）')
  for (const k of ['protection', 'taxonomy', 'category']) {
    ok(basisFn.includes(`'${k}'`), `A8 riskBasisOf 缺 '${k}' 这一种命中原因`)
  }
  const basisLabels = (cfg.match(/const RISK_BASIS_LABELS = \{([\s\S]*?)\n\};/) || [])[1] || ''
  const basisKeys = [...basisLabels.matchAll(/(\w+)\s*:/g)].map((m) => m[1])
  ok(['protection', 'taxonomy', 'category'].every((k) => basisKeys.includes(k)) && basisKeys.length === 3,
    `A8 客户端 RISK_BASIS_LABELS 的键与云函数 riskBasisOf 不对应（实得 ${basisKeys.join('/') || '无'}）`)
  // withRiskMeta：只在点名时附加，不传 = 与改前逐字一致
  ok(/needRiskMeta/.test(fn) && /withRiskMeta/.test(fn), 'A8 云函数缺 withRiskMeta（清单要拿到命中原因）')
  ok(/if \(needRiskMeta\) \{/.test(fn) && /out\.riskTier = riskTierOf\(/.test(fn) && /out\.riskBasis = riskBasisOf\(/.test(fn),
    'A8 withRiskMeta 没有真的把 riskTier / riskBasis 附到每一行')
  // ⚠️ 只断言 `animalCategoryIds = []` 也会假阴性：改成无条件 `loadAnimalCategoryIds()` 之后
  // 那行字面量还在。必须断言**加载条件**：只有点名 medium / normal / withRiskMeta 才查。
  ok(/if \(needRiskMeta \|\| riskFilterRaw === 'medium' \|\| riskFilterRaw === 'normal'\)/.test(fn),
    'A8 withRiskMeta 缺「默认不查分类」的退化（会让每次明细列表都多打一次库）')

  /* ── A9 独立「风险管理」tab：一个能力只有一个入口 ──────────────────
     明细页不许再留风险工具条 / 风险 chip —— 抽出去还留着 = 两处计数迟早打架。 */
  ok(/data-tab="risk"/.test(wxml), 'A9 藏品库顶栏缺「风险管理」tab')
  ok(/wx:if="\{\{productLibTab==='risk'\}\}"/.test(wxml), "A9 缺 productLibTab=risk 的渲染块")
  ok(/tab === 'risk'/.test(cfg), "A9 setProductLibTab 不认 'risk'（点了会掉回藏品明细）")
  const listBlock = (wxml.match(/wx:if="\{\{productLibTab==='list'\}\}"[\s\S]*?wx:if="\{\{productLibTab==='risk'\}\}"/) || [''])[0]
  ok(!!listBlock, 'A9 取不到「藏品明细」块（无法判断风险能力是否已抽走）')
  ok(!/bulkToggleRisk/.test(listBlock), 'A9 藏品明细页还留着风险一键工具条（能力抽走后必须只剩一个入口）')
  ok(!/setProductRiskFilter/.test(listBlock), 'A9 藏品明细页还留着风险筛选 chip（同上）')
  const riskBlock = (wxml.match(/wx:if="\{\{productLibTab==='risk'\}\}"[\s\S]*?<!-- 库存概览/) || [''])[0]
  ok((riskBlock.match(/bindtap="setProductRiskFilter"/g) || []).length === 4,
    `A9 风险管理页的分层 chip 不是 4 颗（全部/高风险/中等风险/普通），实得 ${(riskBlock.match(/bindtap="setProductRiskFilter"/g) || []).length}`)
  ok(/bindtap="copyRiskList"/.test(riskBlock), 'A9 风险管理页缺「复制风险清单」')
  ok(/riskOverview\.tiers\.medium\.byBasis\.taxonomy/.test(riskBlock) && /riskOverview\.tiers\.medium\.byBasis\.category/.test(riskBlock) &&
    /riskOverview\.tiers\.high\.byProtection\.sanyou/.test(riskBlock) && /riskOverview\.tiers\.high\.byProtection\.protected_animal/.test(riskBlock),
    'A9 概览的构成数字没有取服务端回包（客户端重算 = 第二套口径）')
  ok(/riskShelfCounts\.on/.test(riskBlock) && /riskShelfCounts\.off/.test(riskBlock),
    'A9 上架态筛选没有用**分层**计数（用全库计数会与分层件数同屏打架）')
  const ovMethod = methodBody(cfg, 'loadRiskOverview')
  ok(!!ovMethod, 'A9 找不到 loadRiskOverview')
  ok(/action:\s*'riskOverview'/.test(ovMethod), 'A9 loadRiskOverview 没走云函数 action riskOverview')
  ok(/highRiskCount:/.test(ovMethod) && /mediumRiskCount:/.test(ovMethod),
    'A9 两条工具条的件数没有取自概览回包（同一份数字只能有一个来源）')
  const riskFilterMethod = methodBody(cfg, 'setProductRiskFilter')
  ok(/productShelfFilter:\s*'all'/.test(riskFilterMethod),
    'A9 切分层没有清掉上架态筛选（切到中等风险还留着「已下架」＝只看见 12 件，像是丢数据）')
  const recompute = methodBody(cfg, '_recomputeRiskShelfCounts')
  ok(!!recompute && /this\.data\.riskOverview/.test(recompute) && !/productShelfCounts/.test(recompute),
    '_recomputeRiskShelfCounts 没有从 riskOverview 取值（或又去读全局 productShelfCounts）')
  const copyMethod = methodBody(cfg, 'copyRiskList')
  ok(!!copyMethod, 'A9 找不到 copyRiskList')
  ok(/wx\.setClipboardData\(/.test(copyMethod), 'A9 复制清单没用 wx.setClipboardData')
  ok(/withRiskMeta:\s*true/.test(copyMethod), 'A9 复制的清单没带命中原因（withRiskMeta）')
  ok(/page \+= 1/.test(copyMethod) && /total/.test(copyMethod),
    'A9 复制清单只导了当前页（提审要的是全量，不是「已加载」那 50 件）')
  ok(/riskTierLabel/.test(copyMethod) && /riskBasisLabel/.test(copyMethod),
    'A9 复制清单的每行缺风险等级 / 命中原因')

  /* ── F 风险管理模块样式 ──────────────────────────────────────── */
  for (const c of ['.risk-hero', '.risk-tier-item', '.rti-detail', '.risk-note', '.risk-sec-label', '.risk-copy-btn']) {
    ok(new RegExp(`\\${c} \\{`).test(wxss), `F 样式缺 ${c}`)
  }

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
  ok(/bindtap="bulkToggleRisk"[^>]*data-risk="high"[^>]*data-on="0"/.test(wxml), 'D 工具条缺「高风险一键下架」按钮')
  ok(/bindtap="bulkToggleRisk"[^>]*data-risk="medium"[^>]*data-on="x"?/.test(wxml) || /bindtap="bulkToggleRisk"[^>]*data-risk="medium"/.test(wxml), 'D 工具条缺「中等风险」入口')
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
    ['作用域改回当前页', (s) => ({ ...s, cfg: s.cfg.replace('      ids = await this._scanProductIds({ riskFilter: risk });', '      ids = (this.data.products || []).map((r) => r._id);') }), /A3/],
    ['扫描丢掉分页', (s) => ({ ...s, cfg: s.cfg.replace('      page += 1;\n    }\n    return ids;', '    }\n    return ids;') }), /A3/],
    ['去掉确认弹窗', (s) => ({ ...s, cfg: s.cfg.replace('      openAppModal({\n        title: onShelf ? `一键上架${tier.label}藏品` : `一键下架${tier.label}藏品`,', '      Promise.resolve({\n        title: onShelf ? `一键上架${tier.label}藏品` : `一键下架${tier.label}藏品`,') }), /A4/],
    ['toggleShelf 回到整页重载', (s) => ({ ...s, cfg: s.cfg.replace("        this._patchShelfRow(id, { isOffShelf: !onShelf, shelfApprovalStatus: '' });", '        this.loadProducts();') }), /B1/],
    ['搜索回到弹遮罩重载', (s) => ({ ...s, cfg: s.cfg.replace('this.timer = setTimeout(() => { this.loadProducts({ silent: true }); }, 500);', 'this.timer = setTimeout(() => { this.loadProducts(); }, 500);') }), /B2/],
    ['切排序回到弹遮罩重载', (s) => ({ ...s, cfg: s.cfg.replace("    // 2026-10-13：切排序属于「本来就该重查」，但**不弹全屏遮罩**（弹了就像整页刷新，还打断视线）\n    this.loadProducts({ silent: true });", '    this.loadProducts();') }), /B2/],
    ['水印丢掉已下架态', (s) => ({ ...s, cfg: s.cfg.replace("  if (status === 'offshelf') return { status, text: '已下架', className: 'offshelf' };\n", '') }), /C1/],
    ['水印样式回到半透明斜字', (s) => ({ ...s, wxss: s.wxss.replace('.p-wm-text {\n  position: absolute;\n  left: 0; top: 0;', '.p-wm-text {\n  opacity: 0.55;\n  transform: rotate(-28deg);\n  position: absolute;\n  left: 0; top: 0;') }), /C2/],
    ['样式丢掉已下架配色', (s) => ({ ...s, wxss: s.wxss.replace(/\/\* 已下架：墨底浅字[\s\S]*?\n\}\n/, '') }), /C2/],
    ['页面去掉高风险 chip', (s) => ({ ...s, wxml: s.wxml.replace('bindtap="setProductRiskFilter" data-val="high"', 'bindtap="setProductRiskFilter" data-val="normal"') }), /D/],
    ['工具条丢掉一键下架', (s) => ({ ...s, wxml: s.wxml.replace('bindtap="bulkToggleRisk" data-risk="high" data-on="0"', 'bindtap="bulkToggleRisk" data-risk="high" data-on="1"') }), /D/],
    ['卡片丢掉高风险标签', (s) => ({ ...s, wxml: s.wxml.replace('wx:if="{{item.isHighRisk}}"', 'wx:if="{{false}}"') }), /D/],
    /* ── A5/A6 中等风险（动物类）── */
    ['中等风险不再排除保护类（与高风险重叠）', (s) => ({ ...s, fn: s.fn.replace("conditions.push(_.and([_.or(animalSignals), { protectionType: _.nin(PROTECTED_TYPES) }]))", 'conditions.push(_.or(animalSignals))') }), /A5/],
    ['动物界口径丢失', (s) => ({ ...s, fn: s.fn.replace("const ANIMAL_KINGDOMS = ['动物界', 'Animalia', 'animalia']", "const ANIMAL_KINGDOMS = ['Insecta']") }), /A5/],
    ['中等风险去掉分类兜底信号', (s) => ({ ...s, fn: s.fn.replace('    animalCategoryIds = await loadAnimalCategoryIds()', '    animalCategoryIds = []') }), /A5/],
    ['两个入口共用同一口径', (s) => ({ ...s, wxml: s.wxml.split('data-risk="medium"').join('data-risk="high"') }), /A6/],
    ['丢弃中等风险件数', (s) => ({ ...s, cfg: s.cfg.replace('    mediumRiskCount: 0,', '') }), /A6/],
    /* ── A7 三层互斥穷尽 + 两套判据同源 ── */
    ['normal 回到「protectionType 缺失」（与中等风险重叠、三层相加超全库）',
      (s) => ({ ...s, fn: s.fn.replace(/const notAnimal = \[[\s\S]*?\]\n/, "const notAnimal = [{ protectionType: _.exists(false) }]\n") }), /A7/],
    ['riskTierOf 自己造一套 high 口径（不走 PROTECTED_TYPES）',
      (s) => ({ ...s, fn: s.fn.replace("  if (PROTECTED_TYPES.indexOf(pt) >= 0) return 'high'", "  if (pt === 'sanyou') return 'high'") }), /A7/],
    ['三层丢掉 normal（有藏品归不了类）',
      (s) => ({ ...s, fn: s.fn.replace("  return 'normal'\n}", '  return \'medium\'\n}') }), /A7/],
    ['概览不注册进 action 路由（前端只会拿到「未知 action」）',
      (s) => ({ ...s, fn: s.fn.replace("      case 'riskOverview':\n", '') }), /A7/],
    ['list 与概览各写一套扫描循环',
      (s) => ({ ...s, fn: s.fn.replace("  const { rows: scannedRows, scanned, truncated } = await scanProducts(where)", '  const scannedRows = []\n  let cursor2 = 0\n  while (cursor2 < 5000) { const r = await db.collection(\'products\').skip(cursor2).limit(100).get(); if (!r.data.length) break; scannedRows.push(...r.data); cursor2 += r.data.length }\n  const scanned = scannedRows.length\n  const truncated = false') }), /A7/],
    ['概览不共用「本人藏品」作用域条件',
      (s) => ({ ...s, fn: s.fn.replace('  const scopeCond = buildScopeCondition(event, actor, verifiedFramerId)\n  const { rows, scanned, truncated } = await scanProducts(scopeCond)', '  const scopeCond = null\n  const { rows, scanned, truncated } = await scanProducts(scopeCond)') }), /A7/],
    ['合规提醒不分档（把做到位的保护类也说成没证书）',
      (s) => ({ ...s, wxml: s.wxml.replace('<view class="risk-note" wx:if="{{riskOverview.tiers.high.missingCert > 0}}">', '<view class="risk-note" wx:if="{{riskOverview.all.missingCert > 0}}">') }), /A7/],
    ['概览缺合规提醒计数',
      (s) => ({ ...s, fn: s.fn.replace('    if (missing) { bucket.missingCert += 1; all.missingCert += 1 }', '') }), /A7/],
    /* ── A8 命中原因 ── */
    ['命中原因丢掉「所属分类兜底」这一种',
      (s) => ({ ...s, fn: s.fn.replace("  if (isAnimalCategory(row, animalCategoryIds)) return 'category'\n", '') }), /A8/],
    ['客户端命中原因文案与云函数脱钩',
      (s) => ({ ...s, cfg: s.cfg.replace("  taxonomy: '学名属动物界',", "  taxonomyByLatin: '学名属动物界',") }), /A8/],
    ['withRiskMeta 不把命中原因附到行上',
      (s) => ({ ...s, fn: s.fn.replace('      out.riskBasis = riskBasisOf(row, animalCategoryIds)\n', '') }), /A8/],
    ['每次明细列表都无条件查分类（丢掉「默认不查」退化）',
      (s) => ({ ...s, fn: s.fn.replace('  const riskFilterRaw = String((event && event.riskFilter) || \'\').trim()\n  let animalCategoryIds = []\n  if (needRiskMeta || riskFilterRaw === \'medium\' || riskFilterRaw === \'normal\') {\n    animalCategoryIds = await loadAnimalCategoryIds()\n  }', '  let animalCategoryIds = []\n  animalCategoryIds = await loadAnimalCategoryIds()') }), /A8/],
    /* ── A9 独立 tab：能力抽走后只留一个入口 ── */
    ['明细页还留着风险一键工具条（两个入口）',
      // 注入必须**带 bulkToggleRisk 本体**：只插一个空 .risk-bar 的话，判据里那句 /bulkToggleRisk/
      // 根本没被碰到，于是"注入成功但检不出来"（2026-10-14 实际踩到）。
      (s) => ({ ...s, wxml: s.wxml.replace('<view class="search-box">\n        <input placeholder="搜索藏品…"', '<view class="risk-bar"><view class="risk-bar-btn is-danger" bindtap="bulkToggleRisk" data-risk="high" data-on="0">一键下架</view><view class="risk-bar-btn" bindtap="bulkToggleRisk" data-risk="high" data-on="1">一键上架</view></view>\n      <view class="search-box">\n        <input placeholder="搜索藏品…"') }), /A9/],
    ['明细页还留着风险筛选 chip',
      (s) => ({ ...s, wxml: s.wxml.replace('<view class="pf-chip {{productArchiveFilter===\'oneOfAKind\'?\'on\':\'\'}}" bindtap="setProductArchiveFilter" data-val="oneOfAKind">孤品</view>', '<view class="pf-chip {{productArchiveFilter===\'oneOfAKind\'?\'on\':\'\'}}" bindtap="setProductArchiveFilter" data-val="oneOfAKind">孤品</view>\n        <view class="pf-chip is-risk" bindtap="setProductRiskFilter" data-val="high">高风险</view>') }), /A9/],
    ['切分层不清上架态（选高风险却只剩已下架的 11 件）',
      (s) => ({ ...s, cfg: s.cfg.replace("    this.setData({ productRiskFilter: next, productShelfFilter: 'all' });", '    this.setData({ productRiskFilter: next });') }), /A9/],
    ['分层 chip 少一颗（普通层点不着）',
      (s) => ({ ...s, wxml: s.wxml.replace('<view class="pf-chip {{productRiskFilter===\'normal\'?\'on\':\'\'}}" bindtap="setProductRiskFilter" data-val="normal">普通 {{riskOverview.tiers.normal.total}}</view>', '') }), /A9/],
    ['概览数字改由客户端重算（去掉服务端构成）',
      (s) => ({ ...s, wxml: s.wxml.replace('riskOverview.tiers.medium.byBasis.taxonomy', 'riskOverview.tiers.medium.total') }), /A9/],
    ['上架态筛选改读全局计数（与分层件数同屏打架）',
      (s) => ({ ...s, wxml: s.wxml.split('riskShelfCounts.on').join('productShelfCounts.on') }), /A9/],
    ['复制清单只导当前页',
      (s) => ({ ...s, cfg: s.cfg.replace('        if (!batch.length || rows.length >= total) break;\n        page += 1;\n      }\n    } catch (err) {\n      wx.hideLoading();\n      this.setData({ riskCopyRunning: false });\n      this.showHubTip(formatCloudFnError(err, \'清单整理失败\'), \'warn\');', '        break;\n      }\n    } catch (err) {\n      wx.hideLoading();\n      this.setData({ riskCopyRunning: false });\n      this.showHubTip(formatCloudFnError(err, \'清单整理失败\'), \'warn\');') }), /A9/],
    ['复制清单不带命中原因',
      (s) => ({ ...s, cfg: s.cfg.replace('            withRiskMeta: true', '            withRiskMeta: false') }), /A9/],
    ['tier 列表丢掉命中原因文案',
      (s) => ({ ...s, cfg: s.cfg.replace('        `${r.riskTierLabel || \'—\'}${r.riskBasisLabel ? \' · \' + r.riskBasisLabel : \'\'}`,', '        `${r.riskTierLabel || \'—\'}`,') }), /A9/],
    /* ── F 样式 ── */
    ['丢掉风险管理分层卡样式',
      (s) => ({ ...s, wxss: s.wxss.replace(/\.risk-tier-item \{[\s\S]*?\n\}\n/, '') }), /F/],
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
