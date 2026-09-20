#!/usr/bin/env node
/**
 * check:product-fields-entry —— 「字段维护」入口（装裱方式/制作工艺）接线守卫
 *
 * 背景：craftType 既是**运输口径**（决定运费档）又是展示口径，历史上有 86 件未标注。
 * 超管工作台新增了 curTab 17「字段维护」用于就地改这两个字段并批量保存。
 *
 * 断言（都能失败）：
 *   ① 入口注册齐：`MENU_KEYS.PRODUCT_FIELDS` + `TAB_MENU_KEY[17]` + `HUB_MENU_SECTIONS.OPS`，
 *      且**只给超管**（不在店长/店员菜单里 —— 该字段影响收钱，不该给店员）
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

  // ① 注册齐 + 仅超管
  if (!/PRODUCT_FIELDS:\s*'productFields'/.test(roles)) problems.push('workspaceRoles 缺 MENU_KEYS.PRODUCT_FIELDS')
  if (!/17:\s*MENU_KEYS\.PRODUCT_FIELDS/.test(roles)) problems.push('TAB_MENU_KEY[17] 未指向 PRODUCT_FIELDS（面板挂不上 Tab 17）')
  if (!/HUB_MENU_SECTIONS[\s\S]{0,600}MENU_KEYS\.PRODUCT_FIELDS/.test(roles)) {
    problems.push('HUB_MENU_SECTIONS 未包含 PRODUCT_FIELDS（超管工作台看不到入口）')
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
  const panelAt = subviews.indexOf('curTab===17')
  if (panelAt < 0) problems.push('_subviews.wxml 缺 curTab===17 面板')
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
  console.log('\n自检通过：4 处真实注入（发给店长 / 内联选项清单 / 分批超限 / 退化成只读）全部拦下')
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
  console.log('✓ 「字段维护」入口接线合格：入口仅超管 / 选项表取唯一事实源 /')
  console.log('  保存走 manageProducts.batchPatch 且分批 ≤100 / 面板是可改的 picker（未标注可选回）')
}

main()
