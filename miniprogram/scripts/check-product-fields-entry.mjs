#!/usr/bin/env node
/**
 * check:product-fields-entry —— 「字段维护」入口（装裱方式/制作工艺）接线守卫
 *
 * 背景：craftType 既是**运输口径**（决定运费档）又是展示口径，历史上有 86 件未标注。
 * ⚠️ 2026-09-20 **入口位置变更**：它原本是超管工作台的独立 Tab 17，但产品负责人在开发仓里
 * **找不到**它（入口只在 Hub 的 OPS 分组里，而"改装裱 / 改工艺"这类活用户会去「藏品库」找）。
 * 现在并入 **藏品库 → 分类管理** 里的 `.cat-field-zone`「字段维护专区」——
 * **只换位置、不放宽权限**：可见性仍由 `MENU_KEYS.PRODUCT_FIELDS`（仅超管）判定。
 *
 * 断言（都能失败）：
 *   ① 入口**已并入分类管理**且**仍只给超管**：
 *      `MENU_KEYS.PRODUCT_FIELDS` 保留 → `managerPageConfig` 用它算出 `canProductFields`
 *      → `_subviews.wxml` 的 `.cat-field-zone` 在 `productLibTab==='category'` 块内且带
 *      `wx:if="{{canProductFields}}"`；同时**旧的独立 Tab 17 必须已撤销**
 *      （TAB_MENU_KEY 不再映射 17、Hub 的 OPS 分组不再列它 —— 一件事两个入口就会再次分叉）
 *   ② 选项表同源：面板从 `config/productTaxonomy.js` 取 `CRAFT_TYPE_OPTIONS`/`CRAFT_PROCESS_OPTIONS`，
 *      **不得内联**一份自己的选项清单（同一套语义写两份必然漂移）
 *   ③ 保存走唯一写通道：`manageProducts` 的 `batchPatch`，且分批 ≤100（云端就是这个上限）
 *   ④ 面板渲染的是 picker（可改）而不是只读文本；未标注要能选回去（picker 第 0 项）
 *
 * 用法：node miniprogram/scripts/check-product-fields-entry.mjs [--selftest] [--root <dir>]
 */
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP_DEFAULT = join(HERE, '..')

const REL = {
  roles: 'utils/workspaceRoles.js',
  manager: 'subpackages/manager/manager/managerPageConfig.js',
  subviews: 'subpackages/manager/manager/workspace/_subviews.wxml',
  taxonomy: 'config/productTaxonomy.js',
  // 选项维护（2026-09-20）：字典本身可增删改
  sync: 'utils/productTaxonomySync.js',
  cloudFn: 'cloudfunctions/getProductTaxonomy/index.js',
  cloudFnPkg: 'cloudfunctions/getProductTaxonomy/package.json',
  // 选项表的**另外两份副本**（2026-09-20 缺陷就在这两份里：别名表是手写的、漏了 7 个新工艺）
  cloudTaxonomy: 'cloudfunctions/manageProducts/productTaxonomy.js',
  feedTaxonomy: 'cloudfunctions/getEncyclopediaFeed/productTaxonomy.js',
  artisanFn: 'cloudfunctions/manageArtisanCommission/index.js',
  // C 端「馆藏 → 筛选」面板（2026-09-20：这里的装裱/工艺曾经是**硬编码**的冻结常量）
  filterPanel: 'components/ProductFilterPanel/index.js',
  appJs: 'app.js',
  cloudbaserc: 'cloudbaserc.json'
}

function check (root) {
  const problems = []
  const read = (k) => readFileSync(join(root, REL[k]), 'utf8')
  let roles = ''
  let manager = ''
  let subviews = ''
  let taxonomy = ''
  let sync = ''
  let cloudFn = ''
  let appJs = ''
  let cloudbaserc = ''
  try {
    roles = read('roles'); manager = read('manager'); subviews = read('subviews'); taxonomy = read('taxonomy')
    sync = read('sync'); cloudFn = read('cloudFn'); appJs = read('appJs'); cloudbaserc = read('cloudbaserc')
  } catch (e) {
    return [`读取失败：${e.message}`]
  }

  // ⚠️ 负向断言一律看**去注释**的源码：注释里会正当地写出历史 bug 的写法
  //    （例如 `values[idx - 1]` 就写在"这里曾经错在哪"的说明里），拿含注释的源码判会自己把自己判红。
  //    必须在**所有使用点之前**声明（const 有 TDZ，写在中间会让整个守卫抛异常）。
  const managerCode = manager.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  // ① 权限键保留 + 专区并入分类管理 + 旧 Tab 17 已撤销 + 仅超管
  if (!/PRODUCT_FIELDS:\s*'productFields'/.test(roles)) problems.push('workspaceRoles 缺 MENU_KEYS.PRODUCT_FIELDS（专区的可见性靠它判）')
  if (!/canProductFields:\s*menu\[MENU_KEYS\.PRODUCT_FIELDS\]\s*===\s*true/.test(manager)) {
    problems.push('managerPageConfig 未用 MENU_KEYS.PRODUCT_FIELDS 算出 canProductFields（专区的权限判据）')
  }
  {
    // 专区必须**在分类管理块内部**：先出现 `productLibTab==='category'`，后出现 `.cat-field-zone`
    const catAt = subviews.indexOf("productLibTab==='category'")
    const zoneAt = subviews.indexOf('class="cat-field-zone"')
    if (catAt < 0) problems.push('_subviews.wxml 找不到分类管理块（productLibTab===category）')
    if (zoneAt < 0) problems.push('_subviews.wxml 找不到 .cat-field-zone 字段维护专区（入口又丢了）')
    if (catAt >= 0 && zoneAt >= 0 && zoneAt < catAt) {
      problems.push('.cat-field-zone 不在分类管理块内部（专区被挪出了「藏品库 → 分类管理」）')
    }
    // 门可以是复合的（`canProductFields && catZone==='fields'`，2026-09-20 分子 Tab 之后），
    // 但**必须包含** canProductFields —— 判据只认这一点，不去钉门的完整写法。
    if (zoneAt >= 0 && !/class="cat-field-zone"\s+wx:if="\{\{[^}]*canProductFields[^}]*\}\}"/.test(subviews)) {
      problems.push('.cat-field-zone 未受 canProductFields 控制 —— 合并不得放宽权限（该字段影响运费档）')
    }
  }
  // 旧的独立 Tab 必须已撤销：一件事两个入口就会再次分叉（产品负责人正是找不到它才要求合并的）
  if (/17:\s*MENU_KEYS\.PRODUCT_FIELDS/.test(roles)) {
    problems.push('TAB_MENU_KEY[17] 仍指向 PRODUCT_FIELDS —— 独立 Tab 未撤销（同一件事两个入口）')
  }
  {
    const body = (() => {
      const at = roles.indexOf('const HUB_MENU_SECTIONS = {')
      if (at < 0) return null
      let depth = 0
      for (let i = roles.indexOf('{', at); i < roles.length; i += 1) {
        if (roles[i] === '{') depth += 1
        else if (roles[i] === '}') { depth -= 1; if (depth === 0) return roles.slice(at, i + 1) }
      }
      return null
    })()
    // ⚠️ 判据前必须**去注释**：这段数组里我自己写了一句"PRODUCT_FIELDS 于 2026-09-20 从 Hub 菜单移除"
    // 的说明，直接正则会被自己的注释判红（本仓的老坑：守卫读到自己那段解释）。
    const code = (body || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    if (body == null) problems.push('找不到 HUB_MENU_SECTIONS（守卫锚点需要同步更新）')
    else if (/MENU_KEYS\.PRODUCT_FIELDS/.test(code)) {
      problems.push('Hub 菜单仍列 PRODUCT_FIELDS —— 它已并入分类管理，菜单里留着就是第二个入口')
    }
  }
  // ⚠️ 不能用 slice(indexOf(A), indexOf(B))：两个常量的先后顺序在文件里并不保证
  //    （第一版就这么写，注入反而"通过"了）。按 `const NAME = [` → 配对 `]` 取体。
  const arrayBody = (name) => {
    const at = roles.indexOf(`const ${name} = [`)
    if (at < 0) return null
    let depth = 0
    for (let i = roles.indexOf('[', at); i < roles.length; i += 1) {
      if (roles[i] === '[') depth += 1
      else if (roles[i] === ']') {
        depth -= 1
        if (depth === 0) return roles.slice(at, i + 1)
      }
    }
    return null
  }
  for (const menuName of ['STORE_MANAGER_MENUS', 'STORE_STAFF_MENUS']) {
    const body = arrayBody(menuName)
    if (body == null) { problems.push(`找不到 ${menuName}（守卫锚点需要同步更新）`); continue }
    if (/PRODUCT_FIELDS/.test(body)) {
      problems.push(`${menuName} 里出现了 PRODUCT_FIELDS —— 该字段影响运费档，应仅超管`)
    }
  }

  // ② 选项表同源
  if (!/require\(['"][^'"]*config\/productTaxonomy['"]\)/.test(manager)) {
    problems.push('字段维护面板未从 config/productTaxonomy 取选项表（会另抄一份 → 漂移）')
  }
  if (!/CRAFT_TYPE_OPTIONS/.test(taxonomy) || !/CRAFT_PROCESS_OPTIONS/.test(taxonomy)) {
    problems.push('productTaxonomy 缺 CRAFT_TYPE_OPTIONS / CRAFT_PROCESS_OPTIONS（事实源被改名？）')
  }
  // 面板自己又内联一份中文选项清单 → 红。
  // ⚠️ 特征必须是「数组里有**两个以上**中文项」（即出现了 `'中文',`），
  //    否则会把 picker 的「未标注」首项 `pfTypeLabels: ['未标注'].concat(...)` 误判成内联清单
  //    —— 2026-09-20 加「未标注」首项时就是这么假红了一次。
  if (/pfTypeLabels:\s*\[\s*['"][\u4e00-\u9fa5][^'"]*['"]\s*,/.test(manager)) {
    problems.push('面板内联了装裱方式中文清单 —— 必须用 TAXONOMY.CRAFT_TYPE_OPTIONS 派生')
  }

  // ③ 保存通道与分批
  if (!/action:\s*'batchPatch'/.test(manager)) problems.push('保存未走 manageProducts 的 batchPatch')
  if (!/name:\s*'manageProducts'/.test(manager)) problems.push('保存未调用 manageProducts')
  // ⚠️ 分批步长锚在**批量循环**上：2026-09-20 起本文件里 `batchPatch` 有**两处调用**
  //    （单行即时保存 1 件 + 重试全部失败项的分批循环），按"第一个 batchPatch 往前找"会锚错。
  const chunk = /for \(let i = 0; i < ids\.length; i \+= (\d+)\)/.exec(manager)
  if (!chunk || Number(chunk[1]) > 100) {
    problems.push(`批量重试的分批步长应为 ≤100（当前 ${chunk ? chunk[1] : '找不到'}）—— 云端单次上限就是 100`)
  }
  // ★ 单行即时保存：必须**只发 1 件**（产品负责人：「单个编辑即默认生效，不需要拉到最下保存」）
  if (!/items:\s*\[\{ productId: id, data: patch \}\]/.test(manager)) {
    problems.push('单行编辑没有走"立即保存这一件"（items 里只有 1 条）—— 面板会退回"改完还得拉到底点保存"')
  }
  /* ★★ 下标坐标系（2026-09-20 产品负责人实测的"整体偏移一位"）。
   *    现象：**选干制存成针插、选浸制存成干制，装裱方式也一样**。
   *    根因：picker 的 `range` 是**纯标签数组**（第 0 项是「压制（腊叶）标本」），
   *          而 `_pfIndex` 按"第 0 项 = 未标注"算（`i + 1`）、`onPfPick` 又 `values[idx - 1]`
   *          —— 两头各自加减一次，整张列表就整体错开一位。
   *    判据：**range 必须带「未标注」首项**，且下标/取值**两头都不许再 ±1**。 */
  if (!/pfProcessLabels: \['未标注'\]\.concat\(/.test(manager) || !/pfTypeLabels: \['未标注'\]\.concat\(/.test(manager)) {
    problems.push("picker 的 range 没有「未标注」首项 —— 与下标口径不在同一坐标系（会整体偏移一位）")
  }
  if (!/const value = String\(values\[idx\] \|\| ''\)/.test(manager)) {
    problems.push('onPfPick 取的不是 `values[idx]`（若写成 idx-1，就是"选干制存成针插"）')
  }
  if (/values\[idx - 1\]/.test(managerCode)) {
    problems.push('onPfPick 里出现了 `values[idx - 1]` —— 整体偏移一位的元凶')
  }
  if (/return i < 0 \? 0 : i \+ 1/.test(manager)) {
    problems.push('_pfIndex 还在 `i + 1`（range 已有「未标注」首项，再 +1 就偏一位）')
  }
  // ★ 下标 → 取值必须用 picker 自己的那份快照（与 range 同源），否则选项表一变就错位
  if (!/const values = field === 'craftType' \? \(this\.data\.pfTypeValues/.test(manager)) {
    problems.push('onPfPick 不是用 picker 的快照数组做下标映射 —— 选项表一变就会"选干制存成针插"')
  }
  if (!/_syncPfPickerOptions\(\)/.test(manager) || !/pfProcessValues/.test(manager)) {
    problems.push('缺 _syncPfPickerOptions（picker 的 labels 与 values 必须同一次刷，否则下标错位）')
  }

  /* ★ 交互形态（2026-09-20 产品负责人）：「单个编辑即默认生效，不需要拉到最下保存」。
   * 判据钉的是**结果形态**：保存入口（重试条）必须出现在列表**之前**，
   * 且行上要有可点重试的状态 —— 只要有人把"底部保存按钮"加回来，这条就红。 */
  {
    const zoneAt = subviews.indexOf('class="cat-field-zone"')
    const zoneEnd = zoneAt >= 0 ? subviews.indexOf('class="cat-opt-block"', zoneAt) : -1
    const zone = zoneAt >= 0 ? subviews.slice(zoneAt, zoneEnd > 0 ? zoneEnd : undefined) : ''
    const saveAt = zone.indexOf('bindtap="saveProductFields"')
    const listAt = zone.indexOf('class="pf-row')
    if (saveAt < 0) {
      problems.push('字段维护区里没有"重试未保存项"的入口 —— 网络抖动时只能逐行重试')
    } else if (listAt > 0 && saveAt > listAt) {
      problems.push('保存入口出现在藏品列表**之后** —— 又变回"拉到最下才能保存"（产品负责人明确不要）')
    }
    if (!/catchtap="onPfRetry"/.test(zone)) {
      problems.push('行上没有"未保存·点此重试"的入口 —— 单行保存失败后没有就地补救')
    }
    if (/class="pf-dirty"/.test(zone)) {
      problems.push('还在用「待存」标记 —— 单行即时保存下不应该再有"攒着等保存"的状态')
    }
  }

  // ④ 面板是 picker（可改）+ 未标注可选回
  const panelAt = subviews.indexOf('class="cat-field-zone"')
  if (panelAt < 0) problems.push('_subviews.wxml 缺 .cat-field-zone 面板（字段维护专区）')
  else {
    // ⚠️ 原来这里是 `slice(panelAt, panelAt + 4000)` 的**固定窗口** —— 面板一变长，
    //    第二个 picker（制作工艺）就被切到窗口外，判据报"未标 data-field"（假红）。
    //    按分区边界切：到下一个分区 `cat-opt-block` 为止。
    const panelEnd = subviews.indexOf('class="cat-opt-block"', panelAt)
    const panel = subviews.slice(panelAt, panelEnd > panelAt ? panelEnd : panelAt + 12000)
    if (!/bindchange="onPfPick"/.test(panel)) problems.push('面板未用 picker 就地改（bindchange="onPfPick" 缺失）')
    if (!/range="\{\{pfTypeLabels\}\}"/.test(panel) || !/range="\{\{pfProcessLabels\}\}"/.test(panel)) {
      problems.push('面板缺装裱方式/制作工艺两个 picker 的选项绑定')
    }
    if (!/data-field="craftType"/.test(panel) || !/data-field="craftProcess"/.test(panel)) {
      problems.push('picker 未标 data-field="craftType|craftProcess"（保存时不知道改哪个字段）')
    }
  }
  // ④b 布局：`cfg-field-full`（width:100% + flex:none）**不许**放进 `.cfg-row`（横排）。
  // 起因（2026-09-20 产品负责人真机截图）：专区里那行「搜索」直接抄了 `.cfg-field-block`（竖排）的
  // `cfg-field-full`，于是 100% + 220rpx 标签 + gap + padding 一起算 → 整行 min-content 超出卡片
  // → 卡片被撑宽、**整页横向溢出**（左侧文字被切、右侧多一条背景）。
  // 静态判据够了：`.cfg-row` 是横排这一件事写在 WXSS 里，二者同现就是错配。
  {
    const rows = subviews.match(/<view class="cfg-row">[\s\S]{0,400}?<\/view>/g) || []
    for (const r of rows) {
      if (/cfg-field-full/.test(r)) {
        problems.push('.cfg-row（横排）里用了 cfg-field-full（width:100% + flex:none）—— 会把整行撑出卡片')
        break
      }
    }
  }

  // ④c 内层分区（2026-09-20 产品负责人：「几个功能分区做成分 tab，而不是无限下拉」）
  // 判据本体是**每个分区都带 catZone 门** —— 只要有一块不 gate，它就又变回"永远显示在下拉流里"。
  {
    const tabs = subviews.match(/class="cat-zone-tab [^"]*"/g) || []
    if (tabs.length < 3) problems.push(`内层分区 Tab 不足 3 个（分类 / 属性 / 选项 —— 2026-10-14 起标签去掉了与页面页签重复的「分类管理」），实测 ${tabs.length}`)
    const gates = [
      ['分类管理块', /<block wx:if="\{\{catZone==='category'\}\}">/],
      ['字段维护区', /class="cat-field-zone"\s+wx:if="\{\{canProductFields && catZone==='fields'\}\}"/],
      ['选项维护区', /class="cat-opt-block"\s+wx:if="\{\{canProductFields && catZone==='options'\}\}"/]
    ]
    for (const [name, re] of gates) {
      if (!re.test(subviews)) problems.push(`${name}没有 catZone 门 —— 分 Tab 会退回"无限下拉"`)
    }
    if (!/switchCatZone\(/.test(manager) || !/loadCatZoneData\(/.test(manager)) {
      problems.push('managerPageConfig 缺 switchCatZone / loadCatZoneData（切 Tab 没接线 / 没懒加载）')
    }
  }

  // ⑤ 选项维护（2026-09-20）：装裱方式 / 制作工艺的**字典本身**可增删改
  // 判据分四层：客户端覆写层 / 客户端标签走覆写 / 服务端删除保护 + 超管门 / 启动接线 + 函数登记。
  {
    // ⑤-a 覆写层：代码常量是默认值，云端文档是覆写（与运费规则同一套「双真源」口径）
    if (!/function setCraftOverlay/.test(taxonomy)) problems.push('productTaxonomy 缺 setCraftOverlay（云端字典没处落）')
    if (!/function craftTypeOptions/.test(taxonomy) || !/function craftProcessOptions/.test(taxonomy)) {
      problems.push('productTaxonomy 缺 craftTypeOptions/craftProcessOptions 访问器')
    }
    // ⑤-b 标签必须走访问器：`CRAFT_TYPE_LABELS` 是**冻结的常量映射**，只认内置 value；
    //      超管新增的选项用它查会得到空串（详情页会显示空白）—— 这正是最容易漏的一处。
    const labelFn = (/function craftTypeLabel[\s\S]{0,400}?\n\}/.exec(taxonomy) || [])[0] || ''
    if (!/craftTypeOptions\(\)/.test(labelFn)) {
      problems.push('craftTypeLabel 没走 craftTypeOptions() 访问器 —— 超管新增的选项在 C 端会显示成空白')
    }
    if (!/normalizeCraftType\(value\) \|\|/.test(labelFn)) {
      problems.push('craftTypeLabel 没给"别名表不认的新值"留退回路径（云端新增的 value 不在别名表里）')
    }
    // ⑤-c 页面两侧（选商品 / 维护字典）都要走访问器，不许直接用常量数组
    if (/TAXONOMY\.CRAFT_TYPE_OPTIONS|TAXONOMY\.CRAFT_PROCESS_OPTIONS/.test(manager)) {
      problems.push('managerPageConfig 仍直接用 TAXONOMY 常量数组 —— 云端覆写对它不可见，必须走访问器')
    }
    if (!/loadTaxonomyEditor\(\)/.test(manager) || !/saveTaxonomy\(\)/.test(manager)) {
      problems.push('managerPageConfig 缺 loadTaxonomyEditor / saveTaxonomy（选项维护没接线）')
    }
    // ⑤-d 服务端：超管门 + 删除保护（数在用量）+ 兜底项 other 不许删
    if (!/requireSuperAdmin:\s*true/.test(cloudFn)) problems.push('getProductTaxonomy 保存没有超管门（requireSuperAdmin）')
    // ⚠️ 判据要锚**真正的拒绝分支**（`if (n > 0) … 'IN_USE'`），不能只 grep 标识符 ——
    // 第一版写的就是后者，注入把 `if (n > 0)` 改成 `if (false)` 之后标识符还在，守卫照样绿（自己放水）。
    if (!/countInUse/.test(cloudFn) || !/if \(n > 0\)[\s\S]{0,240}?'IN_USE'/.test(cloudFn)) {
      problems.push('getProductTaxonomy 缺「被删选项还有商品在用」的服务端校验 —— craftType 决定运费档，删错会静默落档')
    }
    if (!/o\.value === 'other'/.test(cloudFn)) problems.push('getProductTaxonomy 没守住兜底项 other 不许删')
    if (!/VALUE_RE/.test(cloudFn)) problems.push('getProductTaxonomy 缺 value 格式校验（中文名当 value 会立刻坏掉）')
    // ⑤-e 启动接线 + 函数登记
    if (!/ensureProductTaxonomy/.test(appJs) || !/hydrateFromStorage: hydrateTaxonomy/.test(appJs)) {
      problems.push('app.js 没接 productTaxonomySync（超管改完字典，C 端本次启动读不到）')
    }
    if (!/"name":\s*"getProductTaxonomy"/.test(cloudbaserc)) {
      problems.push('cloudbaserc.json 未登记 getProductTaxonomy（部署会漏掉这个函数）')
    }
    // ⑤-f 横排行的输入框不许用 width:100%（2026-09-20 真机横向溢出的直接成因）
    const optRows = subviews.match(/<view class="cat-opt-row"[\s\S]{0,600}?<\/view>/g) || []
    for (const r of optRows) {
      if (/cfg-field-full/.test(r)) { problems.push('.cat-opt-row（横排）里用了 cfg-field-full —— 会把整行撑出卡片'); break }
    }
  }

  /* ── ⑤-g 选项表**往返一致**（2026-09-20 真机缺陷的判据）─────────────────────────
   * 缺陷形态：产品负责人在「分类管理 → 字段维护」里把制作工艺标成「针插」→ 保存 → 再读回来还是「未标注」。
   * 根因：云函数 `manageProducts/productTaxonomy.js` 的**别名表是手写的**，只覆盖 4 个旧工艺；
   *   2026-09-19 追加的 7 个（压制/针插/干制骨骼/切片/涂片/透明骨骼/包埋）不在表里 →
   *   `normalizeCraftProcess('pinned')` 返回 `''` → `batchPatch` 把 craftProcess **静默写成空串**。
   *   （客户端 `config/productTaxonomy.js` 早已改成从选项表派生，两份云函数副本没跟上。）
   *
   * 判据只钉**结果**：每个选项的 value 与中文名，在**每一份** normalize 里都必须往返回同一个 value；
   * 选项维护新增的 `custom_xxx` 必须放行（校验端放行的值，写库端也得放行）；脏值仍要挡住。 */
  {
    const loadCjs = (rel) => {
      try {
        const m = { exports: {} }
        // eslint-disable-next-line no-new-func
        new Function('module', 'exports', 'require', readFileSync(join(root, rel), 'utf8'))(
          m, m.exports, () => { throw new Error('守卫里不提供 require') }
        )
        return m.exports
      } catch (e) { return null }
    }
    const client = loadCjs(REL.taxonomy)
    const cloudMP = loadCjs(REL.cloudTaxonomy)
    const feed = loadCjs(REL.feedTaxonomy)
    const optionsOf = (m) => (m && (m.craftTypeOptions ? m.craftTypeOptions() : m.CRAFT_TYPE_OPTIONS)) || []
    const procsOf = (m) => (m && (m.craftProcessOptions ? m.craftProcessOptions() : m.CRAFT_PROCESS_OPTIONS)) || []
    if (!client || !cloudMP || !feed) {
      problems.push('选项表副本加载失败（路径改了？三份副本必须都能被独立加载）')
    } else {
      const canonTypes = optionsOf(client)
      const canonProcs = procsOf(client)
      // 三份副本的**选项清单**必须逐字一致（差异 = 下一处「值合法但被抹掉」）
      for (const [label, m] of [['manageProducts', cloudMP]]) {
        const tv = optionsOf(m).map((o) => o.value).join(',')
        const pv = procsOf(m).map((o) => o.value).join(',')
        if (tv !== canonTypes.map((o) => o.value).join(',')) problems.push(`云函数 ${label} 的装裱方式选项与客户端不一致 —— 手工副本已漂移`)
        if (pv !== canonProcs.map((o) => o.value).join(',')) problems.push(`云函数 ${label} 的制作工艺选项与客户端不一致 —— 手工副本已漂移`)
      }
      // 往返：每一份有 normalize 的副本都得过
      const plain = (m, fn, v) => { try { return m[fn](v) } catch (e) { return null } }
      for (const [label, m] of [['客户端', client], ['manageProducts', cloudMP], ['getEncyclopediaFeed', feed]]) {
        const nt = (v) => plain(m, 'normalizeCraftType', v)
        const np = (v) => plain(m, 'normalizeCraftProcess', v)
        if (typeof nt('相框') !== 'string') continue
        const bad = []
        for (const o of canonTypes) {
          if (nt(o.value) !== o.value) bad.push(`craftType(${o.value})=${JSON.stringify(nt(o.value))}`)
          if (nt(o.label) !== o.value) bad.push(`craftType(${o.label})=${JSON.stringify(nt(o.label))}`)
        }
        for (const o of canonProcs) {
          if (np(o.value) !== o.value) bad.push(`craftProcess(${o.value})=${JSON.stringify(np(o.value))}`)
          if (np(o.label) !== o.value) bad.push(`craftProcess(${o.label})=${JSON.stringify(np(o.label))}`)
        }
        if (bad.length) {
          problems.push(`${label} 的 normalize 不能往返（**标记后会静默清空**）：${bad.slice(0, 4).join(' / ')}`)
        }
        if (nt('custom_abc') !== 'custom_abc') problems.push(`${label} 把「选项维护」新增的 craftType 值抹成空串`)
        if (np('custom_xyz') !== 'custom_xyz') problems.push(`${label} 把「选项维护」新增的 craftProcess 值抹成空串`)
        if (np('不是合法值') !== '') problems.push(`${label} 没挡住非法 craftProcess 值`)
      }
    }
  }

  /* ── ⑤-h ERP（`admin/src/App.vue`）的选项表必须与小程序**逐字一致** ────────────────
   * 2026-09-20 产品负责人：「生产工艺保存了两套字段 —— 编辑藏品处还是老字段，字段维护处是新字段，
   *   保存后仍是老字段信息」。根因：ERP 里**自己手写了两份清单**（下拉 `<el-option>` + 标签表），
   *   制作工艺只写了 4 个旧工艺，而小程序 2026-09-19 已扩到 11 个 →
   *   ERP 下拉选不了新工艺、列表取不到中文名（回退成英文 key）⇒ 看起来"没保存"。
   * 现在 ERP 的下拉与标签表都从**一份数组**派生，本判据再钉死"那份数组 == 小程序的口径"。 */
  {
    // 本脚本没有 ROOT（只有 HERE / MP_DEFAULT）—— miniprogram 的上一级才是仓库根
    const erpPath = process.env.PRODUCT_FIELDS_ERP || join(MP_DEFAULT, '..', 'admin/src/App.vue')
    let erpSrc = ''
    try { erpSrc = readFileSync(erpPath, 'utf8') } catch (e) { erpSrc = '' }
    if (!erpSrc) {
      problems.push('读不到 admin/src/App.vue —— ERP 侧的选项表无法核对')
    } else {
      const arrOf = (name) => {
        const i = erpSrc.indexOf('const ' + name + ' = [')
        if (i < 0) return null
        const j = erpSrc.indexOf('\n]', i)
        return [...erpSrc.slice(i, j).matchAll(/value:\s*'([^']+)'/g)].map((m) => m[1])
      }
      const erpTypes = arrOf('CRAFT_TYPE_OPTIONS')
      const erpProcs = arrOf('CRAFT_PROCESS_OPTIONS')
      const mini = (() => {
        try {
          const m = { exports: {} }
          new Function('module', 'exports', 'require', readFileSync(join(root, REL.taxonomy), 'utf8'))(m, m.exports, () => { throw new Error('no require') })
          return m.exports
        } catch (e) { return null }
      })()
      if (!erpTypes || !erpProcs) {
        problems.push('ERP 的 CRAFT_TYPE_OPTIONS / CRAFT_PROCESS_OPTIONS 数组找不到（下拉与标签表必须从它派生，不许再手写两份）')
      } else if (mini) {
        const want = (mini.CRAFT_TYPE_OPTIONS || []).map((o) => o.value).join(',')
        const wantP = (mini.CRAFT_PROCESS_OPTIONS || []).map((o) => o.value).join(',')
        if (erpTypes.join(',') !== want) problems.push('ERP 装裱方式清单与小程序不一致 —— 编辑藏品里会看不到/选不了新装裱方式')
        if (erpProcs.join(',') !== wantP) problems.push('ERP 制作工艺清单与小程序不一致 —— **编辑藏品里看到的就是老字段**（这就是产品负责人报的现象）')
      }
      if (!/Object\.fromEntries\(CRAFT_PROCESS_OPTIONS\.map/.test(erpSrc)) {
        problems.push('ERP 的 CRAFT_PROCESS_LABEL_MAP 不是从 CRAFT_PROCESS_OPTIONS 派生的（两份清单会再次漂移）')
      }
      /* ⚠️ 2026-09-21 夜班**纠正了这条判据的目标** —— 原判据要求的就是缺口本身：
       *   原来这里断言「下拉必须是 `v-for CRAFT_PROCESS_OPTIONS`（**冻结常量**）」，
       *   而冻结常量里**没有**超管在「选项维护」新增的 `custom_xxx` ⇒
       *   "照原判据写"的结果就是：后台加了新选项，ERP 下拉里选不了（正是产品负责人报的那类"看起来没保存"）。
       *   正确目标是：下拉走**云端覆写后的生效表** `ERP_CRAFT_*_OPTIONS`，
       *   而生效表本身必须由「代码默认 + 云端覆写」派生（不许退化成第三份手写清单）。
       *   **这不是放宽**：原来只钉"用了某个数组"，现在同时钉住 ①生效表的来源 ②标签表并入云端标签，
       *   并配了三条注入证明它真的能失败（见 `--selftest`）。 */
      for (const [re, name] of [
        [/v-for="o in ERP_CRAFT_PROCESS_OPTIONS"/, '制作工艺'],
        [/v-for="o in ERP_CRAFT_TYPE_OPTIONS"/, '装裱方式']
      ]) {
        if (!re.test(erpSrc)) {
          problems.push(`ERP 的${name}下拉不是 v-for ERP_CRAFT_*_OPTIONS —— 用冻结常量会让「选项维护」新增的选项选不了，手写 el-option 会漏项`)
        }
      }
      if (!/resolveCraftOptions\(CRAFT_TYPE_OPTIONS,\s*erpTaxonomyOverlay/.test(erpSrc)
        || !/resolveCraftOptions\(CRAFT_PROCESS_OPTIONS,\s*erpTaxonomyOverlay/.test(erpSrc)) {
        problems.push('ERP 的 ERP_CRAFT_*_OPTIONS 不是「云端覆写 || 代码默认」派生的（会退化成第三份手写清单）')
      }
      if (!/const CRAFT_TYPE_LABEL_MAP = computed\([\s\S]{0,800}?erpTaxonomyOverlay/.test(erpSrc)
        || !/const CRAFT_PROCESS_LABEL_MAP = computed\([\s\S]{0,800}?erpTaxonomyOverlay/.test(erpSrc)) {
        problems.push('ERP 的 CRAFT_*_LABEL_MAP 没有并入云端标签 —— custom_xxx 在列表里会显示英文 key（看着像没保存）')
      }

      /* ── ⑤-h-2 **行为**断言（不只是结构）：求值 ERP 的纯函数模块 ─────────────────────
       * 为什么必须求值：结构断言只能证明"看起来接对了"——本仓反复吃过"结构对、行为错"的亏
       *   （错题本 E7：判据自身会失效）。把纯函数从 5300 行的 `App.vue` 里抽出来，
       *   就是为了这里能**真的跑**：null 退回默认、脏项被丢、覆写优先、`other` 恒在最后。
       * 求值方式：模块是 ESM，而本脚本 `--root` 指向临时目录、**不能 import 仓库外路径**，
       *   故剥掉 `export ` 前缀后用 `Function` 求值（与上面测小程序 `config/productTaxonomy.js`
       *   同一思路，那份是 CommonJS，直接给 module/exports）。 */
      {
        const utilPath = process.env.PRODUCT_FIELDS_ERP_UTIL || join(MP_DEFAULT, '..', 'admin/src/utils/productTaxonomyOverlay.js')
        let utilSrc = ''
        try { utilSrc = readFileSync(utilPath, 'utf8') } catch (e) { utilSrc = '' }
        if (!utilSrc) {
          problems.push('读不到 admin/src/utils/productTaxonomyOverlay.js —— ERP 的覆写语义无法求值核对')
        } else {
          let mod = null
          try {
            const body = utilSrc.replace(/^export\s+/gm, '')
            mod = new Function(body + '\nreturn { normalizeOverlayList, otherLast, resolveCraftOptions }')()
          } catch (e) { mod = null }
          if (!mod) {
            problems.push('admin/src/utils/productTaxonomyOverlay.js 求值失败（导出名被改名？）')
          } else {
            const base = [{ value: 'frame', label: '相框' }, { value: 'other', label: '其它' }]
            // 覆写里刻意塞三种脏数据：空 value、重复 other、与 base 重名的 frame
            const overlay = [
              { value: 'custom_1', label: '玻璃瓶' },
              { value: 'other', label: '其它' },
              { value: 'frame', label: '相框' },
              { value: '', label: '空 value（必须丢）' }
            ]
            const resolved = mod.resolveCraftOptions(base, mod.normalizeOverlayList(overlay))
            const values = resolved.map((o) => o.value).join(',')
            if (values !== 'custom_1,frame,other') {
              problems.push(`ERP 云端覆写解析不对：期望 custom_1,frame,other，实得 ${values}（覆写优先/丢脏项/other 最后，三者之一坏了）`)
            }
            if (mod.normalizeOverlayList([]) !== null) problems.push('ERP 空覆写没有退回 null（会把下拉弄空）')
            if (mod.normalizeOverlayList(null) !== null) problems.push('ERP 非数组覆写没有退回 null')
            const fallback = mod.resolveCraftOptions(base, mod.normalizeOverlayList(null)).map((o) => o.value).join(',')
            if (fallback !== 'frame,other') problems.push(`ERP 无覆写时没有退回代码默认：实得 ${fallback}`)
            const moved = mod.otherLast([{ value: 'other', label: '其它' }, { value: 'frame', label: '相框' }]).map((o) => o.value).join(',')
            if (moved !== 'frame,other') problems.push('ERP 「其它」没有恒排最后（产品负责人 2026-09-21 口径）')
          }
        }
      }
    }
  }

  /* ── ⑤-i **编辑藏品表单**与「字段维护」必须同一份选项口径 ────────────────────────
   * 产品负责人报的「保存了两套字段」在**小程序内部**也有一份：表单用冻结常量、字段维护用
   * `TAXONOMY.craft*Options()`（常量 + 云端覆写）。后台在「选项维护」里改过的选项，
   * 表单里看不到，商品存的是新值时下拉会落到「未标注」→ 看着像没保存。 */
  {
    // 只看"有没有在表单里 concat 冻结常量" —— 前缀是 `['未标注']`（labels）还是 `['']`（values）都算
    const formUsesFrozen = /\.concat\(CRAFT_(TYPE|PROCESS)_OPTIONS\.map/.test(manager)
    if (formUsesFrozen) {
      problems.push('「编辑藏品」表单的选项表用了**冻结常量** CRAFT_*_OPTIONS —— 与字段维护不是同一份口径（后台改过的选项在表单里看不到）')
    }
    // 表单里 labels 用 ['未标注'] 前缀、values 用 [''] 前缀 —— 两条都要走 TAXONOMY
    const formOk = /const craftProcessLabels = \['未标注'\]\.concat\(TAXONOMY\.craftProcessOptions\(\)/.test(manager)
      && /const craftProcessValues = \[''\]\.concat\(TAXONOMY\.craftProcessOptions\(\)/.test(manager)
    if (!formOk) {
      problems.push('「编辑藏品」表单的制作工艺选项表没走 TAXONOMY.craftProcessOptions()')
    }
    if (/^\s*CRAFT_TYPE_OPTIONS,\s*$/m.test(manager) || /^\s*CRAFT_PROCESS_OPTIONS,\s*$/m.test(manager)) {
      problems.push('managerPageConfig 还在导入冻结常量 —— 迟早被某个表单用回去')
    }
  }

  // ★ 字典里没有的历史值必须**原样显示**（不许伪装成「未标注」）
  if (!/i >= 0 \? \(\(labels \|\| \[\]\)\[i\] \|\| v\) : v/.test(managerCode)) {
    problems.push('_pfLabel 把"不在字典里的历史值"显示成「未标注」—— 操作员会以为没保存过、顺手重选，真相被藏起来')
  }

  /* ── ⑤-j C 端「馆藏 → 筛选」的装裱/工艺必须**跟后台实时对齐**（2026-09-20 产品负责人）──
   * 「馆藏的筛选项目，装裱方式和生产工艺没有跟后台的字段实时对齐，核查是不是硬编码」
   * ——**是硬编码**：`components/ProductFilterPanel/index.js` 把冻结常量直接塞进 `data`，
   *   那是**构造那一刻的快照**：后台在「选项维护」里增删/改名之后它永远不变（也看不到自定义项）。
   * 判据：必须导入**访问器**、`data` 里不许放冻结常量、且**每次打开面板都重新现取**。 */
  {
    const filterPanel = read('filterPanel')
    if (/craftOptions:\s*CRAFT_TYPE_OPTIONS|craftProcessOptions:\s*CRAFT_PROCESS_OPTIONS/.test(filterPanel)) {
      problems.push('馆藏筛选面板把**冻结常量**塞进了 data —— 后台改完字典它永远不更新（硬编码）')
    }
    if (!/craftTypeOptions\b/.test(filterPanel) || !/craftProcessOptions\b/.test(filterPanel)) {
      problems.push('馆藏筛选面板没走 craftTypeOptions()/craftProcessOptions() 访问器 —— 读不到云端字典')
    }
    if (!/syncTaxonomyOptions\s*\(\s*\)/.test(filterPanel)) {
      problems.push('馆藏筛选面板缺 syncTaxonomyOptions —— 打开时不会重新读字典，"实时对齐"无从谈起')
    }
    // 打开面板（observers.visible）那一步必须真的调它
    if (!/visible\(v\)\s*\{[\s\S]{0,200}?syncTaxonomyOptions\(\)/.test(filterPanel)) {
      problems.push('打开筛选面板时没有重取字典（只是构造时取一次 = 依然是硬编码）')
    }
  }

  /* ── ⑤-k 「其它」必须排在最后（产品负责人 2026-09-21）──────────────────────────
   * 线上字典实测：`…, other, custom_1 玻璃瓶, custom_2 塑封` —— 后台新增的选项插在「其它」后面，
   * 顾客翻筛选时它夹在中间。判据钉在**出口与保存两处**：
   *  ① 唯一事实源的访问器必须把它排到最后（所有消费方自动一致）；
   *  ② 存进云端的归一化也必须排（否则读原始文档的地方还是乱的）。 */
  {
    const tax = read('taxonomy')
    if (!/function otherLast\s*\(/.test(tax)) {
      problems.push('productTaxonomy 缺 otherLast() ——「其它」不会排到最后（线上字典里它本来在中间）')
    }
    if (!/craftTypeOptions \(\) \{ return otherLast\(/.test(tax) || !/craftProcessOptions \(\) \{ return otherLast\(/.test(tax)) {
      problems.push('装裱/工艺访问器没有经过 otherLast() —— 消费方还是会看到「其它」在中间')
    }
    const cloudGet = read('cloudFn')
    if (!/const rest = out\.filter\(\(o\) => o\.value !== 'other'\)/.test(cloudGet)) {
      problems.push('getProductTaxonomy 保存时没把「其它」排到最后 —— 存进云端的顺序仍是乱的')
    }
  }

  // 未标注必须能选回去（picker 第 0 项 = 未标注，下标 0 ↔ 空串）
  if (!/_pfIndex\(/.test(managerCode) || !/if \(!v\) return 0/.test(managerCode)) {
    problems.push('picker 下标未按「第 0 项 = 未标注」映射 —— 无法把字段清回未标注')
  }

  return problems
}

function selftest () {
  let bad = 0
  const t = (name, ok, extra) => {
    if (!ok) bad += 1
    console.log(`${ok ? '✓' : '✗'} ${name}${ok || !extra ? '' : ` —— ${extra}`}`)
  }
  // 注入清单在 try 块里声明，末尾的汇总在块外 —— 提出来，汇总才能从数组派生（写死过一版，加了注入还是显示 11）
  let injections = []
  const tmp = mkdtempSync(join(tmpdir(), 'product-fields-'))
  try {
    const copy = () => {
      for (const [k, rel] of Object.entries(REL)) {
        const dst = join(tmp, rel)
        mkdirSync(dirname(dst), { recursive: true })
        writeFileSync(dst, readFileSync(join(MP_DEFAULT, rel)))
      }
    }
    const run = () => spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--root', tmp], { encoding: 'utf8' })
    copy()
    const base = run()
    t('基线（真文件副本）通过', base.status === 0, (base.stdout || '') + (base.stderr || ''))

    injections = [
      {
        name: '把入口也发给店长（该字段影响运费档，不该给店员）',
        file: REL.roles,
        mutate: (s) => s.replace('const STORE_MANAGER_MENUS = [', 'const STORE_MANAGER_MENUS = [\n  MENU_KEYS.PRODUCT_FIELDS,'),
        expect: /应仅超管/
      },
      {
        name: '面板内联一份自己的装裱方式清单（与实际口径漂移）',
        file: REL.manager,
        mutate: (s) => s.replace('    pfTypeLabels:', "    pfTypeLabels: ['相框', '玻璃罩'],\n    pfTypeLabelsX:"),
        expect: /内联了装裱方式中文清单/
      },
      {
        name: '分批步长调成 500（超过云端 batchPatch 的 100 上限）',
        file: REL.manager,
        // 直接锚批量重试循环（文件里 batchPatch 有两处，按位置找会锚错行）
        mutate: (s) => s.replace('for (let i = 0; i < ids.length; i += 100)', 'for (let i = 0; i < ids.length; i += 500)'),
        expect: /分批步长应为 ≤100/
      },
      {
        name: '保存入口被挪回列表之后（又变成"拉到最下才能保存"）',
        file: REL.subviews,
        mutate: (s) => {
          const at = s.indexOf('仅显示前 {{pfVisible.length}} 件')
          if (at < 0) return s
          const lineEnd = s.indexOf('\n', at) + 1
          // ① 在列表**之后**加回一个"保存全部改动"按钮 ② 把顶部那条的入口摘掉
          const withBottom = s.slice(0, lineEnd) + '          <view class="pf-bottom-save" bindtap="saveProductFields">保存全部改动</view>\n' + s.slice(lineEnd)
          return withBottom.replace('<view hover-class="tap-press" hover-stay-time="80" class="pf-retry-btn" bindtap="saveProductFields">', '<view hover-class="tap-press" hover-stay-time="80" class="pf-retry-btn" bindtap="noop">')
        },
        expect: /拉到最下才能保存/
      },
      {
        name: '单行编辑退回"攒着等底下批量保存"（产品负责人明确不要）',
        file: REL.manager,
        mutate: (s) => s.replace('items: [{ productId: id, data: patch }]', 'items: []'),
        expect: /立即保存这一件/
      },
      {
        name: '「其它」不再排最后（线上字典里它夹在新增项中间）',
        file: REL.taxonomy,
        mutate: (s) => s.replace('function craftProcessOptions () { return otherLast(CRAFT_OVERLAY.processes || CRAFT_PROCESS_OPTIONS) }',
                                 'function craftProcessOptions () { return CRAFT_OVERLAY.processes || CRAFT_PROCESS_OPTIONS }'),
        expect: /其它.*排到最后|otherLast/
      },
      {
        name: '云端保存不再把「其它」排最后（存进云端的顺序是乱的）',
        file: REL.cloudFn,
        mutate: (s) => s.replace("  const rest = out.filter((o) => o.value !== 'other')\n  const tail = out.filter((o) => o.value === 'other')\n  return rest.concat(tail)", '  return out'),
        expect: /没把「其它」排到最后/
      },
      {
        name: '馆藏筛选面板退回"冻结常量硬编码"（后台改完字典它不更新）',
        file: 'components/ProductFilterPanel/index.js',
        mutate: (s) => s.replace('    craftOptions: [],', '    craftOptions: CRAFT_TYPE_OPTIONS,'),
        expect: /冻结常量|硬编码/
      },
      {
        name: '馆藏筛选面板打开时不再重取字典（只是构造时取一次）',
        file: 'components/ProductFilterPanel/index.js',
        mutate: (s) => s.replace('        this.syncTaxonomyOptions()\n        this.openDraft()', '        this.openDraft()'),
        expect: /没有重取字典|syncTaxonomyOptions/
      },
      {
        name: 'picker 偏移一位（选干制存成针插、选浸制存成干制 —— 产品负责人实测的那个）',
        file: REL.manager,
        mutate: (s) => s.replace("    const value = String(values[idx] || '')", "    const value = String(values[idx - 1] || '')"),
        expect: /整体偏移一位|idx - 1/
      },
      {
        name: 'picker 的 range 去掉「未标注」首项（与下标口径错开一位）',
        file: REL.manager,
        mutate: (s) => s.replace("      pfProcessLabels: ['未标注'].concat(procs.map((o) => o.label)),", '      pfProcessLabels: procs.map((o) => o.label),'),
        expect: /没有「未标注」首项/
      },
      {
        name: '下标映射退回"现算 TAXONOMY 选项"（选项表一变就选干制存成针插）',
        file: REL.manager,
        mutate: (s) => s.replace(
          "    const values = field === 'craftType' ? (this.data.pfTypeValues || []) : (this.data.pfProcessValues || [])",
          "    const values = (field === 'craftType' ? TAXONOMY.craftTypeOptions() : TAXONOMY.craftProcessOptions()).map((o) => o.value)"
        ),
        expect: /下标映射/
      },
      {
        name: '面板退化成只读文本（点不动、改不了）',
        file: REL.subviews,
        mutate: (s) => s.replace(/bindchange="onPfPick"/g, 'bindchange="noop"'),
        expect: /未用 picker 就地改/
      },
      {
        name: '字段维护区丢掉 catZone 门（分 Tab 退回"无限下拉"）',
        file: REL.subviews,
        mutate: (s) => s.replace('class="cat-field-zone" wx:if="{{canProductFields && catZone===\'fields\'}}"',
                                 'class="cat-field-zone" wx:if="{{canProductFields}}"'),
        expect: /catZone 门/
      },
      {
        // 真机缺陷本体：云函数别名表退回**手写**（只留 4 个旧工艺）→ 标记「针插」写库变空串
        name: '编辑藏品表单退回冻结常量（后台改过的工艺选项在表单里看不到）',
        file: REL.manager,
        mutate: (s) => s.replace(
          "  const craftProcessValues = [''].concat(TAXONOMY.craftProcessOptions().map((o) => o.value));",
          "  const craftProcessValues = [''].concat(CRAFT_PROCESS_OPTIONS.map((o) => o.value));"
        ),
        expect: /冻结常量/
      },
      {
        name: 'ERP 制作工艺清单漏掉「针插」（编辑藏品里看不到新工艺）',
        erp: (s) => s.replace("    { value: 'pinned', label: '针插标本' },\n", ''),
        expect: /编辑藏品里看到的就是老字段/
      },
      {
        // 这条注入就是「原判据」的样子：下拉退回冻结常量 —— 后台新增的 custom_xxx 会选不了
        name: 'ERP 下拉退回冻结常量（「选项维护」新增的选项选不了）',
        erp: (s) => s.replace('v-for="o in ERP_CRAFT_PROCESS_OPTIONS"', 'v-for="o in CRAFT_PROCESS_OPTIONS"'),
        expect: /不是 v-for ERP_CRAFT_\*_OPTIONS/
      },
      {
        name: 'ERP 生效表丢掉云端覆写（退化成第三份手写清单）',
        erp: (s) => s.replace(
          'const ERP_CRAFT_PROCESS_OPTIONS = computed(() => resolveCraftOptions(CRAFT_PROCESS_OPTIONS, erpTaxonomyOverlay.value.processes))',
          'const ERP_CRAFT_PROCESS_OPTIONS = computed(() => resolveCraftOptions(CRAFT_PROCESS_OPTIONS, null))'
        ),
        expect: /不是「云端覆写 \|\| 代码默认」派生的/
      },
      {
        // 求值型注入：**行为**坏了（不是结构）—— 覆写不再优先
        name: 'ERP 覆写层不再优先（后台新增的选项被代码默认顶掉）',
        erpUtil: (s) => s.replace(
          '    return otherLast(overlayList || base)',
          '    return otherLast(base)'
        ),
        expect: /ERP 云端覆写解析不对/
      },
      {
        // 求值型注入：`other` 不再排最后
        name: 'ERP 「其它」不再恒排最后（产品负责人 2026-09-21 口径被破坏）',
        erpUtil: (s) => s.replace(
          '    const rest = arr.filter((o) => !o || String(o.value) !== \'other\')',
          '    const rest = arr.filter((o) => !!o)'
        ),
        expect: /「其它」没有恒排最后/
      },
      {
        name: 'ERP 标签表不并入云端标签（custom_xxx 显示英文 key）',
        erp: (s) => s.replace(
          '    Object.fromEntries((erpTaxonomyOverlay.value.processes || []).map((o) => [o.value, o.label]))\n',
          ''
        ),
        expect: /没有并入云端标签/
      },
      {
        name: '云函数别名表退回手写 4 项（标记「针插」写库变空串 —— 产品负责人报的那个缺陷）',
        file: REL.cloudTaxonomy,
        mutate: (s) => s.replace(
          'const CRAFT_PROCESS_ALIASES = Object.assign(\n  aliasesFromOptions(CRAFT_PROCESS_OPTIONS),\n  CRAFT_PROCESS_ALIAS_EXTRAS\n)',
          "const CRAFT_PROCESS_ALIASES = Object.assign({ immersion: 'immersion', plastination: 'plastination', taxidermy: 'taxidermy', other: 'other' }, CRAFT_PROCESS_ALIAS_EXTRAS)"
        ),
        expect: /不能往返/
      },
      {
        name: '云函数不再放行「选项维护」新增的值（自定义选项保存后仍是未标注）',
        file: REL.cloudTaxonomy,
        mutate: (s) => s.replace("  return SAFE_OPTION_VALUE_RE.test(s) ? s : ''\n}\n\nfunction normalizeCraftProcess", '  return \'\'\n}\n\nfunction normalizeCraftProcess'),
        expect: /抹成空串/
      },
      {
        name: '百科云函数的工艺数值表漏掉新工艺（同一个漂移的第二份副本）',
        file: REL.feedTaxonomy,
        mutate: (s) => s.replace("  pinned: ['pinned', '针插标本', '针插'],\n", ''),
        expect: /不能往返/
      },
      {
        name: 'C 端标签退回冻结常量（超管新增的选项会显示成空白）',
        file: REL.taxonomy,
        mutate: (s) => s.replace(
          '  const key = normalizeCraftType(value) || String(value == null ? \'\' : value).trim()\n  if (!key) return \'\'\n  const hit = craftTypeOptions().find((o) => o.value === key)',
          '  const key = normalizeCraftType(value)\n  const hit = craftTypeOptions().find((o) => o.value === key)'
        ),
        expect: /没走 craftTypeOptions\(\) 访问器|退回路径/
      },
      {
        name: '历史值被打扮成「未标注」（字典漂移时真相反被藏起来）',
        file: REL.manager,
        mutate: (s) => s.replace("    return i >= 0 ? ((labels || [])[i] || v) : v", "    return i >= 0 ? ((labels || [])[i] || v) : '未标注'"),
        expect: /不在字典里的历史值/
      },
      {
        name: '服务端去掉「被删选项还有商品在用」的校验（craftType 决定运费档，删错会静默落档）',
        file: REL.cloudFn,
        mutate: (s) => s.replace('        if (n > 0) {', '        if (false) {'),
        expect: /服务端校验|IN_USE/
      },
      {
        name: 'app.js 不再加载云端字典（超管改完 C 端读不到）',
        file: REL.appJs,
        mutate: (s) => s.replace("        const { hydrateFromStorage: hydrateTaxonomy, ensureProductTaxonomy } = require('./utils/productTaxonomySync');",
                                "        const hydrateTaxonomy = () => {}; const ensureProductTaxonomy = () => Promise.resolve(null);"),
        expect: /没接 productTaxonomySync/
      },
      {
        name: '搜索行又抄回 cfg-field-full（横排 100% → 整页横向溢出）',
        file: REL.subviews,
        mutate: (s) => s.replace('<text class="cfg-label">搜索</text>\n            <input class="cfg-field"',
                                 '<text class="cfg-label">搜索</text>\n            <input class="cfg-field cfg-field-full"'),
        expect: /会把整行撑出卡片/
      },
      {
        name: '专区不再受超管开关控制（合并顺手放宽了权限）',
        file: REL.subviews,
        mutate: (s) => s.replace('class="cat-field-zone" wx:if="{{canProductFields && catZone===\'fields\'}}"', 'class="cat-field-zone"'),
        expect: /未受 canProductFields 控制/
      },
      {
        name: '独立 Tab 17 又回来了（同一件事两个入口）',
        file: REL.roles,
        mutate: (s) => s.replace('  16: MENU_KEYS.CONTENT_FLAGS', '  16: MENU_KEYS.CONTENT_FLAGS,\n  17: MENU_KEYS.PRODUCT_FIELDS'),
        expect: /独立 Tab 未撤销/
      },
      {
        name: 'Hub 菜单又把 PRODUCT_FIELDS 列回去',
        file: REL.roles,
        mutate: (s) => s.replace('    MENU_KEYS.CONTENT_FLAGS\n    // ⚠️ MENU_KEYS.PRODUCT_FIELDS', '    MENU_KEYS.CONTENT_FLAGS,\n    MENU_KEYS.PRODUCT_FIELDS\n    // ⚠️ MENU_KEYS.PRODUCT_FIELDS'),
        expect: /第二个入口/
      }
    ]
    for (const inj of injections) {
      // `erp:` / `erpUtil:` 型注入：ERP 文件不在小程序目录下（拷进 tmp 会越出隔离区），
      // 所以写到 tmp 下的独立副本、用 `PRODUCT_FIELDS_ERP*` 指过去。
      if (inj.erp || inj.erpUtil) {
        const env = Object.assign({}, process.env)
        const copies = []
        if (inj.erp) {
          const erpAbs = join(MP_DEFAULT, '..', 'admin/src/App.vue')
          const erpCopy = join(tmp, 'admin-App.vue')
          writeFileSync(erpCopy, inj.erp(readFileSync(erpAbs, 'utf8')))
          env.PRODUCT_FIELDS_ERP = erpCopy
          copies.push(erpCopy)
        }
        if (inj.erpUtil) {
          const utilAbs = join(MP_DEFAULT, '..', 'admin/src/utils/productTaxonomyOverlay.js')
          const utilCopy = join(tmp, 'admin-productTaxonomyOverlay.js')
          writeFileSync(utilCopy, inj.erpUtil(readFileSync(utilAbs, 'utf8')))
          env.PRODUCT_FIELDS_ERP_UTIL = utilCopy
          copies.push(utilCopy)
        }
        const resErp = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--root', tmp], {
          encoding: 'utf8', env
        })
        const outErp = `${resErp.stdout || ''}${resErp.stderr || ''}`
        const hitErp = resErp.status !== 0 && inj.expect.test(outErp)
        t(`${inj.name} → 被守卫拦下`, hitErp, hitErp ? '' : outErp.split('\n').filter((l) => l.includes('✗')).slice(0, 3).join(' | '))
        for (const c of copies) { try { rmSync(c, { force: true }) } catch (e) { /* ignore */ } }
        continue
      }
      copy()
      const abs = join(tmp, inj.file)
      const orig = readFileSync(abs, 'utf8')
      const mutated = inj.mutate(orig)
      if (mutated === orig) { bad += 1; console.log(`✗ 注入锚点缺失：${inj.name}`); continue }
      writeFileSync(abs, mutated)
      const res = run()
      const out = `${res.stdout || ''}${res.stderr || ''}`
      if (res.status !== 0 && inj.expect.test(out)) console.log(`✓ ${inj.name} → 被守卫拦下`)
      else { bad += 1; console.log(`✗ ${inj.name} → 未被拦下（status=${res.status}）\n${out.slice(0, 400)}`) }
    }
    copy()
    t('注入全部还原后重新通过', run().status === 0)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 守卫不可信，请先修它`)
    process.exit(1)
  }
  // 计数与清单都从数组派生 —— 写死会在加注入时变成假的「11 处」（这行上一版就是写死的）
  console.log(`\n自检通过：${injections.length} 处真实注入（${injections.map((i) => i.name.slice(0, 12)).join(' / ')}）全部拦下`)
}

function main () {
  if (process.argv.includes('--selftest')) return selftest()
  const i = process.argv.indexOf('--root')
  const root = i >= 0 ? process.argv[i + 1] : MP_DEFAULT
  const problems = check(root)
  if (problems.length) {
    console.error('✗ 「字段维护」入口接线不合格：')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log('✓ 「字段维护专区」接线合格：并入「藏品库 → 分类管理」且仍仅超管（canProductFields）/')
  console.log('  旧独立 Tab 17 已撤销（不留第二个入口）/ 选项表取唯一事实源 /')
  console.log('  保存走 manageProducts.batchPatch 且分批 ≤100 / 面板是可改的 picker（未标注可选回）')
}

main()
