#!/usr/bin/env node
/**
 * check:gift-compose-steps —— 送礼页「礼赠编排」的版式与分步守卫（2026-10-12 产品负责人点名）
 *
 *   L 拉得到底：滚动区高度 = 自身顶边 → 底栏顶边（真跑 syncScrollPane，桩 wx 给尺寸）。
 *     起因：旧算法只减步骤轨、漏减音效条，底部留白又写死 160rpx，而底栏带会员价小字 + 安全区后更高
 *     → 最后一行「WRAP · 包装」压在底栏下（「犒劳自己」最明显）。底栏高度一变（会员价晚到）须重量。
 *
 * 用法：node miniprogram/scripts/check-gift-compose-steps.mjs [--selftest]
 * --selftest：对真源做**内存注入**（不改文件），每条注入都必须被检出。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const P = {
  js: resolve(MP, 'subpackages/feature/gift/compose/index.js'),
  wxml: resolve(MP, 'subpackages/feature/gift/compose/index.wxml'),
  wxss: resolve(MP, 'subpackages/feature/gift/compose/index.wxss')
}

let INJECT = null
function read(p) {
  const src = readFileSync(p, 'utf8')
  if (!INJECT || INJECT.file !== p) return src
  if (!src.includes(INJECT.find)) throw new Error(`注入锚点失效：${INJECT.name}`)
  return src.split(INJECT.find).join(INJECT.replace)
}

/** 取 Page({...}) 里两格缩进的方法体（到下一个两格缩进的 `},`） */
function method(js, name) {
  const re = new RegExp(`\\n  (?:async )?${name}\\(([^)]*)\\) \\{`)
  const m = re.exec(js)
  if (!m) return null
  const end = js.indexOf('\n  },', m.index + 1)
  return js.slice(m.index + 1, end + 4)
}

function rule(css, sel) {
  const i = css.indexOf(`\n${sel} {`)
  if (i < 0) return ''
  return css.slice(i, css.indexOf('}', i))
}

/** 真跑 syncScrollPane：桩 wx.createSelectorQuery 按选择器回尺寸 */
function runSync(js, rects, winH) {
  const body = method(js, 'syncScrollPane')
  if (!body) throw new Error('找不到 syncScrollPane')
  const page = { data: { scrollHeightPx: 0 }, setData(p) { Object.assign(this.data, p) } }
  const wx = {
    nextTick: (f) => f(),
    createSelectorQuery() {
      const q = []
      const api = {
        in: () => api,
        select: (s) => { q.push(s); return api },
        boundingClientRect: () => api,
        exec: (cb) => cb(q.map((s) => rects[s] || null))
      }
      return api
    }
  }
  const ctx = vm.createContext({ wx, page, getWindowHeight: () => winH, setTimeout: (f) => f(), Math })
  vm.runInContext(`page.syncScrollPane = function ${body.replace(/^ {2}syncScrollPane/, '')}; page.syncScrollPane()`, ctx)
  return page.data.scrollHeightPx
}

function runChecks() {
  const fails = []
  const ok = (name, cond) => { if (!cond) fails.push(name) }
  const js = read(P.js)
  const wxml = read(P.wxml)
  const wxss = read(P.wxss)

  // ── L 拉得到底 ─────────────────────────────────────────────
  // 视口 753（iPhone 13 可用高），步骤轨 + 音效条后滚动区顶边在 92；底栏两种高度：无会员价 96 / 带会员价 + 安全区 158
  const base = { '.page': { top: 0, height: 753 }, '.scroll': { top: 92, height: 600 }, '.step-rail': { top: 0, height: 56 } }
  let h1 = 0
  let h2 = 0
  try {
    h1 = runSync(js, { ...base, '.bottom-bar': { top: 657, height: 96 } }, 753)
    h2 = runSync(js, { ...base, '.bottom-bar': { top: 595, height: 158 } }, 753)
  } catch (e) {
    fails.push('L0 syncScrollPane 跑不起来：' + e.message)
  }
  ok(`L1 滚动区底边 = 底栏顶边（底栏 96：期望 565，实得 ${h1}）`, h1 === 753 - 92 - 96)
  ok(`L2 底栏变高（会员价 + 安全区 158）滚动区随之变矮（期望 503，实得 ${h2}）`, h2 === 753 - 92 - 158)
  ok('L3 会员价落定后重量滚动区（底栏高度会变）', /memberLevelName: r\.levelName\s*\}, \(\) => this\.syncScrollPane\(\)\)/.test(js))
  ok('L4 底栏仍固定在底部（滚动区按它的顶边截止）', /position:\s*fixed/.test(rule(wxss, '.bottom-bar')) && /bottom:\s*0/.test(rule(wxss, '.bottom-bar')))
  ok('L5 滚动区末尾有留白块', /<view class="scroll-pad"><\/view>\s*<\/scroll-view>/.test(wxml))
  ok('L6 留白不再估底栏高度（底栏高度只由实测决定，不得回到写死 160rpx + 安全区）', !/env\(safe-area-inset-bottom\)/.test(rule(wxss, '.scroll-pad')))

  return fails
}

const INJECTIONS = [
  { name: '滚动区不减底栏（回到旧算法：铺满到底）', file: P.js, find: 'bottom - scroll.top - barH', replace: 'bottom - scroll.top' },
  { name: '滚动区漏减上方音效条（只按步骤轨算）', file: P.js, find: 'bottom - scroll.top - barH', replace: 'bottom - 56 - barH' },
  { name: '不量底栏', file: P.js, find: ".select('.bottom-bar')", replace: ".select('.no-such-bar')" },
  { name: '会员价落定后不重量', file: P.js, find: '}, () => this.syncScrollPane())\n  },', replace: '})\n  },' },
  { name: '底栏不再固定', file: P.wxss, find: '.bottom-bar {\n  position: fixed;', replace: '.bottom-bar {\n  position: relative;' },
  { name: '留白回到写死底栏估高', file: P.wxss, find: '.scroll-pad {\n  height: 48rpx;', replace: '.scroll-pad {\n  height: calc(160rpx + env(safe-area-inset-bottom));' }
]

function main() {
  if (process.argv.includes('--selftest')) {
    const clean = runChecks()
    if (clean.length) {
      console.error('✗ 自检前提：真源须先通过\n  - ' + clean.join('\n  - '))
      process.exit(1)
    }
    let bad = 0
    for (const inj of INJECTIONS) {
      INJECT = inj
      let fails
      try { fails = runChecks() } catch (e) { fails = ['抛错：' + e.message] }
      INJECT = null
      if (fails.length) console.log(`✓ 注入「${inj.name}」→ 检出（${fails[0]}）`)
      else { bad += 1; console.log(`✗ 注入「${inj.name}」→ 未检出`) }
    }
    if (bad) {
      console.error(`\n自检失败 ${bad} 项 —— 守卫不可信`)
      process.exit(1)
    }
    console.log(`✓ check:gift-compose-steps 自检通过（${INJECTIONS.length} 条内存注入全部检出，未写盘）`)
    return
  }
  const fails = runChecks()
  if (fails.length) {
    console.error('✗ 送礼页（礼赠编排）版式 / 分步不合格：\n  - ' + fails.join('\n  - '))
    process.exit(1)
  }
  console.log('✓ check:gift-compose-steps：滚动区止于底栏顶边（会员价 / 安全区让底栏变高时同步变矮），最后一行不被遮挡')
}

main()
