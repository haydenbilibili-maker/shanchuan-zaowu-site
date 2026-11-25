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
  submitFn: join(MP, 'cloudfunctions/submitComment/index.js'),
  staffNotify: join(MP, 'cloudfunctions/submitComment/staffNotify.js'),
  hub: join(MP, 'subpackages/manager/manager/hubNav.js'),
  roles: join(MP, 'utils/workspaceRoles.js'),
  catalog: join(MP, 'subpackages/manager/utils/workNoticeCatalog.js'),
  hubWxml: join(MP, 'subpackages/manager/manager/index.wxml'),
  hubNav: join(MP, 'subpackages/manager/manager/hubNav.js')
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

  ok('R4 Hub：磁贴「评价」→ switchTab idx=17；菜单键 reviews 落 TAB_MENU_KEY；超管与店长可进（店员 / 标本师不进）',
    /id: 'reviews'[^\n]*keys: \['reviews'\][^\n]*tap: 'switchTab', idx: 17, tabTitle: '用户评价'/.test(hub) &&
    /17: MENU_KEYS\.REVIEWS/.test(roles) && /REVIEWS: 'reviews'/.test(roles) &&
    /STORE_MANAGER_MENUS = \[[\s\S]*?MENU_KEYS\.REVIEWS[\s\S]*?\]/.test(roles) &&
    !/STORE_STAFF_MENUS = \[[\s\S]*?MENU_KEYS\.REVIEWS[\s\S]*?\]/.test(roles) &&
    !/SPECIMEN_ARTISAN_MENUS = \[[\s\S]*?MENU_KEYS\.REVIEWS[\s\S]*?\]/.test(roles))

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

  // R7（2026-11-25）：用户提交商品评价后，员工「工作信息」要收到一条待回复提醒
  const submitFn = read(F.submitFn)
  const staffNotify = read(F.staffNotify)
  ok('R7 新评价会发「工作信息」：workflow 队列 + ops 待办分类 + 深链到用户评价 + 文案含星级与「记得及时回复」',
    /notifyStaffNewComment\(db, \{/.test(submitFn) &&
    /queue: 'workflow'/.test(staffNotify) && /category: 'ops'/.test(staffNotify) &&
    /type: 'staff_comment_new'/.test(staffNotify) && /read: false/.test(staffNotify) &&
    /tab=17/.test(staffNotify) && /记得及时回复/.test(staffNotify) &&
    /staff_members/.test(staffNotify) && /isAdmin: true/.test(staffNotify) &&
    /collection\('user_messages'\)\.add\(/.test(staffNotify))

  // R8（2026-11-25）：超管 / 店长工作台要有「收到商品评价」消息提示 + 语音播报
  const catalog = read(F.catalog)
  const hubWxml = read(F.hubWxml)
  const hubNav = read(F.hubNav)
  const commentType = (catalog.match(/type: 'comment'[\s\S]*?source: 'commentNoticeUnread'/) || [''])[0]
  ok('R8 语音播报：workNoticeCatalog 有 comment 类型（超管 + 店长），文案与计数来源就位',
    !!commentType &&
    /text: '收到一条用户商品评价，请记得及时回复'/.test(commentType) &&
    /ROLE\.SUPER_ADMIN/.test(commentType) && /ROLE\.STORE_MANAGER/.test(commentType) &&
    /file: 'comment\.(mp3|m4a)'/.test(commentType) && /priority: 25/.test(commentType))
  ok('R8 工作台消息提示：数据字段 + 拉未读 + 预取 + 提醒条 + 待处理项',
    /commentNoticeUnread: 0/.test(cfg) &&
    /getUnreadCount', queue: 'workflow', types: \['staff_comment_new'\]/.test(cfg) &&
    /safe\('commentNotice', \(\) => this\.loadCommentNoticeBadge\(\)\)/.test(cfg) &&
    /hub-comment-notice/.test(hubWxml) && /去回复 ›/.test(hubWxml) &&
    /id: 'comments', label: '评价待回', keys: \['reviews'\], badge: 'commentNoticeUnread'/.test(hubNav))
  ok('R8 店长也能进「评价」并听到播报（菜单 + 角色）',
    /STORE_MANAGER_MENUS = \[[\s\S]*?MENU_KEYS\.REVIEWS[\s\S]*?\]/.test(roles))

  ok('R5 内容管理里删掉的只是这一项：专题 / 文章 / 养护三个子 Tab 仍在',
    ['exhibition', 'article', 'care'].every((t) => contentTab.includes(`data-type="${t}"`)))

  return fails
}

if (process.argv.includes('--selftest')) {
  const cases = [
    { name: '内容管理又把用户评价塞回子 Tab', file: F.wxml, find: '<!-- [Tab 9] 内容管理 -->', replace: '<!-- [Tab 9] 内容管理 -->\n      <view class="sub-tab" bindtap="switchContentType" data-type="comment">用户评价</view>' },
    { name: 'Tab 17 不再拉评价', file: F.cfg, find: 'if(idx === 17) await this.loadComments();', replace: '' },
    { name: 'Hub 入口丢了「评价」', file: F.hub, find: "keys: ['reviews'], tap: 'switchTab', idx: 17", replace: "keys: ['reviews'], tap: 'switchTab', idx: 18" },
    { name: '回复后不再发「山海有信」', file: F.fn, find: 'await notifyCommentReplied(comment, replyText)', replace: '' },
    { name: '新评价不再提醒员工（工作信息）', file: F.submitFn, find: 'await notifyStaffNewComment(db, {', replace: 'await Promise.resolve({ ok: true }); void ({' },
    { name: '工作台不再预取评价未读（语音也没数可播）', file: F.cfg, find: "safe('commentNotice', () => this.loadCommentNoticeBadge())", replace: "safe('commentNoticeX', () => this.loadCommentNoticeBadge())" }
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
