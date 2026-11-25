#!/usr/bin/env node
/**
 * check:reviews-tab —— 「用户评价」独立为「商品内容」一级磁贴（2026-11-25 产品负责人）
 *
 * 口径：
 *   ① 「内容管理」(tab 9) 的子 Tab 只剩 专题策展 / 知识文章 / 标本养护 —— 用户评价不再混在里面；
 *   ② 用户评价是独立 Tab 17：curTab===17 块里有列表与审核动作（通过 / 置顶 / 回复 / 隐藏 / 删除）；
 *   ③ 入口：Hub 磁贴「评价」→ switchTab idx=17；菜单键 reviews 只进超管；
 *   ④ 进 Tab 17 要 loadComments（否则白屏）；TAB_MENU_KEY[17] 必须是 reviews。
 *
 * 用法：node miniprogram/scripts/check-reviews-tab.mjs [--selftest]
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const F = {
  wxml: join(MP, 'subpackages/manager/manager/workspace/_subviews.wxml'),
  cfg: join(MP, 'subpackages/manager/manager/managerPageConfig.js'),
  fn: join(MP, 'cloudfunctions/moderateComment/index.js'),
  hub: join(MP, 'subpackages/manager/manager/hubNav.js'),
  roles: join(MP, 'utils/workspaceRoles.js')
}

let INJECT = null
const read = (f) => {
  let src = readFileSync(f, 'utf8')
  if (INJECT && INJECT.file === f) {
    if (!src.includes(INJECT.find)) throw new Error('注入锚点失效：' + INJECT.name)
    src = src.replace(INJECT.find, INJECT.replace)
  }
  return src
}

function runChecks() {
  const fails = []
  const ok = (name, cond) => { if (!cond) fails.push(name) }
  const wxml = read(F.wxml)
  const cfg = read(F.cfg)
  const hub = read(F.hub)
  const roles = read(F.roles)

  const tab9At = wxml.indexOf('<!-- [Tab 9] 内容管理 -->')
  const tab17At = wxml.indexOf('<!-- [Tab 17] 用户评价')
  const tab10At = wxml.indexOf('<!-- [Tab 10] 工单 -->')
  const contentTab = wxml.slice(tab9At, tab17At > tab9At ? tab17At : tab10At)
  const reviewsTab = wxml.slice(tab17At >= 0 ? tab17At : tab10At, tab10At)

  ok('R1 「内容管理」子 Tab 不再有「用户评价」，也不再有 contentType===\'comment\' 分支',
    contentTab.indexOf('用户评价') === -1 && !/contentType==='comment'/.test(wxml))

  ok('R2 用户评价是独立 Tab 17：curTab===17 块里有列表与五个审核动作',
    /<block wx:if="\{\{curTab===17\}\}">/.test(wxml) &&
    /wx:for="\{\{commentList\}\}"/.test(reviewsTab) &&
    ['approve', 'pin', 'reply', 'hide', 'delete'].every((a) => reviewsTab.includes(`data-action="${a}"`)))

  ok('R3 进 Tab 17 会拉评价；内容管理不再拉',
    /if\(idx === 17\) await this\.loadComments\(\)/.test(cfg) &&
    (() => {
      const m = cfg.match(/if\(idx === 9\) \{[\s\S]*?\n      \}/)
      return m ? !/loadComments\(\)/.test(m[0]) : false
    })())

  ok('R4 Hub：磁贴「评价」→ switchTab idx=17；菜单键 reviews 落 TAB_MENU_KEY 且只进超管',
    /id: 'reviews'[^\n]*keys: \['reviews'\][^\n]*tap: 'switchTab', idx: 17, tabTitle: '用户评价'/.test(hub) &&
    /17: MENU_KEYS\.REVIEWS/.test(roles) && /REVIEWS: 'reviews'/.test(roles) &&
    !/STORE_MANAGER_MENUS = \[[\s\S]*?MENU_KEYS\.REVIEWS[\s\S]*?\]/.test(roles))

  // R6（2026-11-25 核查补）：商家回复后，评价作者要收到「山海有信」（原来只写 comments.merchantReply，用户端无提醒）
  const fn = read(F.fn)
  const replyBlock = (fn.match(/if \(action === 'reply'\)[\s\S]*?\n    \}/) || [''])[0]
  ok('R6 回复后会写「山海有信」：先读评价拿作者、更新后发信、消息带 targetType/targetId/orderId 深链',
    /async function notifyCommentReplied\(comment, reply\)/.test(fn) &&
    /collection\('user_messages'\)\.add\(/.test(fn) &&
    /type: 'comment_replied'/.test(fn) && /queue: 'customer'/.test(fn) && /read: false/.test(fn) &&
    /subpackages\/content\/comment\/index\?/.test(fn) &&
    /await db\.collection\('comments'\)\.doc\(commentId\)\.get\(\)/.test(replyBlock) &&
    /await notifyCommentReplied\(comment, replyText\)/.test(replyBlock) &&
    /notified: !!notified\.success/.test(replyBlock))
  ok('R6 面板如实反馈送达结果（未送达时不说「回复成功」了事）',
    /res\.result\.notified/.test(cfg) && /消息通知未送达/.test(cfg))

  ok('R5 内容管理里删掉的只是这一项：专题 / 文章 / 养护三个子 Tab 仍在',
    ['exhibition', 'article', 'care'].every((t) => contentTab.includes(`data-type="${t}"`)))

  return fails
}

if (process.argv.includes('--selftest')) {
  const cases = [
    { name: '内容管理又把用户评价塞回子 Tab', file: F.wxml, find: '<!-- [Tab 9] 内容管理 -->', replace: '<!-- [Tab 9] 内容管理 -->\n      <view class="sub-tab" bindtap="switchContentType" data-type="comment">用户评价</view>' },
    { name: 'Tab 17 不再拉评价', file: F.cfg, find: 'if(idx === 17) await this.loadComments();', replace: '' },
    { name: 'Hub 入口丢了「评价」', file: F.hub, find: "keys: ['reviews'], tap: 'switchTab', idx: 17", replace: "keys: ['reviews'], tap: 'switchTab', idx: 18" },
    { name: '回复后不再发「山海有信」', file: F.fn, find: 'await notifyCommentReplied(comment, replyText)', replace: '' }
  ]
  let bad = 0
  const base = runChecks()
  if (base.length) { console.error('✗ 自检前提：真源须先通过\n  - ' + base.join('\n  - ')); process.exit(1) }
  for (const c of cases) {
    INJECT = c
    let fails = []
    try { fails = runChecks() } catch (e) { fails = [String(e.message || e)] }
    INJECT = null
    if (!fails.length) { console.error(`✗ 注入「${c.name}」→ 未检出`); bad += 1 }
  }
  if (bad) process.exit(1)
  console.log(`✓ check:reviews-tab 自检通过（${cases.length} 条注入全部检出，内存副本不写盘）`)
} else {
  const fails = runChecks()
  if (fails.length) {
    console.error('✗ 用户评价一级磁贴不合格：')
    fails.forEach((f) => console.error('  - ' + f))
    process.exit(1)
  }
  console.log('✓ check:reviews-tab：内容管理不再承载评价 / 评价为 Tab 17（列表与五个动作）/ 懒加载 / Hub 磁贴与菜单键')
}
