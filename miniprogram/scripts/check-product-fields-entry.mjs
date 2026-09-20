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
  taxonomy: 'config/productTaxonomy.js'
}

function check (root) {
  const problems = []
  const read = (k) => readFileSync(join(root, REL[k]), 'utf8')
  let roles = ''
  let manager = ''
  let subviews = ''
  let taxonomy = ''
  try {
    roles = read('roles'); manager = read('manager'); subviews = read('subviews'); taxonomy = read('taxonomy')
  } catch (e) {
    return [`读取失败：${e.message}`]
  }

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
    if (zoneAt >= 0 && !/class="cat-field-zone"\s+wx:if="\{\{canProductFields\}\}"/.test(subviews)) {
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
  // 面板自己又内联一份中文选项清单 → 红（用「长中文标签数组」做特征）
  if (/pfTypeLabels:\s*\[['"][\u4e00-\u9fa5]/.test(manager)) {
    problems.push('面板内联了装裱方式中文清单 —— 必须用 TAXONOMY.CRAFT_TYPE_OPTIONS 派生')
  }

  // ③ 保存通道与分批
  if (!/action:\s*'batchPatch'/.test(manager)) problems.push('保存未走 manageProducts 的 batchPatch')
  if (!/name:\s*'manageProducts'/.test(manager)) problems.push('保存未调用 manageProducts')
  // ⚠️ 必须锚在 batchPatch 附近：文件里更早有 `i += 1` 之类的循环，全局找会命中它
  const batchAt = manager.indexOf("action: 'batchPatch'")
  const chunk = batchAt > 0 ? manager.slice(Math.max(0, batchAt - 900), batchAt).match(/i \+= (\d+)/) : null
  if (!chunk || Number(chunk[1]) > 100) {
    problems.push(`batchPatch 分批步长应为 ≤100（当前 ${chunk ? chunk[1] : '找不到'}）—— 云端单次上限就是 100`)
  }

  // ④ 面板是 picker（可改）+ 未标注可选回
  const panelAt = subviews.indexOf('class="cat-field-zone"')
  if (panelAt < 0) problems.push('_subviews.wxml 缺 .cat-field-zone 面板（字段维护专区）')
  else {
    const panel = subviews.slice(panelAt, panelAt + 4000)
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

  // 未标注必须能选回去（picker 第 0 项 = 未标注）
  if (!/_pfIndex\(/.test(manager) || !/i < 0 \? 0 : i \+ 1/.test(manager)) {
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

    const injections = [
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
        // 必须命中「保存」那段循环：文件里同形的 `i += 100` 有 2 处，按 batchPatch 位置定位
        mutate: (s) => {
          const at = s.indexOf("action: 'batchPatch'")
          if (at < 0) return s
          const winStart = Math.max(0, at - 900)
          const m = s.slice(winStart, at).match(/i \+= 100/)
          if (!m) return s
          const abs = winStart + m.index
          return s.slice(0, abs) + 'i += 500' + s.slice(abs + 'i += 100'.length)
        },
        expect: /分批步长应为 ≤100/
      },
      {
        name: '面板退化成只读文本（点不动、改不了）',
        file: REL.subviews,
        mutate: (s) => s.replace(/bindchange="onPfPick"/g, 'bindchange="noop"'),
        expect: /未用 picker 就地改/
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
        mutate: (s) => s.replace('class="cat-field-zone" wx:if="{{canProductFields}}"', 'class="cat-field-zone"'),
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
  console.log('\n自检通过：7 处真实注入（发给店长 / 内联选项清单 / 分批超限 / 退化成只读 / 横排抄了竖排输入框 / 专区没权限门 / Tab 17 复活）全部拦下')
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
