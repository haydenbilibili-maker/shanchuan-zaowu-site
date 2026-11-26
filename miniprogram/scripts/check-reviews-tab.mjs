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
  hubNav: join(MP, 'subpackages/manager/manager/hubNav.js'),
  view: join(MP, 'subpackages/manager/manager/reviewView.js')
}

/** reviewView.js 是纯 CJS 模块：按当前（可能被注入的）源码求值 */
function loadView(src) {
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', src)(mod, mod.exports, () => { throw new Error('reviewView 不应 require') })
  return mod.exports
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

  // 2026-11-26：通过 / 恢复 / 回复成了卡片的「主动作」（data-action 随状态由 reviewView.primaryAction 给出），
  // 所以 approve / reply 既可能写死，也可能经主动作出现 —— 两种都认，但主动作的映射必须真对
  let view = null
  try { view = loadView(read(F.view)) } catch (e) { fails.push('reviewView.js 加载失败：' + e.message) }
  const viaPrimary = /data-action="\{\{item\.primary\.action\}\}"/.test(reviewsTab) && !!view &&
    view.primaryAction({ status: 'pending' }).action === 'approve' && view.primaryAction({ status: 'hidden' }).action === 'approve' &&
    view.primaryAction({ status: 'approved' }).action === 'reply' && view.primaryAction({ status: 'approved', merchantReply: 'x' }).action === 'reply'
  ok('R2 用户评价是独立 Tab 17：curTab===17 块里有列表与五个审核动作（通过 / 回复可经按状态的主动作）',
    /<block wx:if="\{\{curTab===17\}\}">/.test(wxml) &&
    /wx:for="\{\{commentList\}\}"/.test(reviewsTab) &&
    ['pin', 'hide', 'delete'].every((a) => reviewsTab.includes(`data-action="${a}"`)) &&
    ['approve', 'reply'].every((a) => reviewsTab.includes(`data-action="${a}"`) || viaPrimary))

  ok('R3 进 Tab 17 会拉评价；内容管理不再拉',
    /if\(idx === 17\)/.test(cfg) && /this\.loadComments\(\)/.test(cfg) &&
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

  // R12（2026-11-26 产品负责人）：回复参考文案要更多、更丰富、更有人情味（按情境分组）
  const vw = read(F.view)
  const groupCount = (vw.match(/id: '(praise|neutral|negative|care|custom|regular)'/g) || []).length
  const phraseCount = (vw.match(/^\s+'[^']+[。！？]',?$/gm) || []).length
  ok('R12 回复参考文案：6 组情境、≥24 句、按星级默认组、弹层可切组',
    groupCount === 6 && phraseCount >= 24 &&
    /function replyGroupForRating\(rating\)/.test(vw) &&
    /if \(r >= 4\) return 'praise'/.test(vw))
  ok('R12 弹层接线：分组导航 + 切组方法 + 打开时按评分选组',
    /comment-reply-groups/.test(wxml) && /switchCommentReplyGroup/.test(cfg) &&
    /reviewView\.replyGroupForRating\(row\.rating\)/.test(cfg) &&
    /commentReplyGroups: reviewView\.REPLY_PHRASE_GROUPS/.test(cfg))

  // R9（2026-11-26 产品负责人）：用户评价要有全局看板 —— 待审为 0 也不能是空白页
  ok('R9 评价总览看板：云端 stats（各状态计数 / 均分 / 回复率 / 近 7 天）+ 页面看板与筛选联动',
    /async function commentStats\(\)/.test(fn) && /action === 'stats'/.test(fn) &&
    /collection\('comments'\)\.count\(\)/.test(fn) && /replyRate/.test(fn) && /days\.push\(/.test(fn) &&
    /async loadCommentStats\(\)/.test(cfg) && /action: 'stats'/.test(cfg) &&
    /Promise\.all\(\[this\.loadComments\(\), this\.loadCommentStats\(\)\]\)/.test(cfg) &&
    /class="cm-dash"/.test(wxml) && /cm-dash-tiles/.test(wxml) && /cm-bars/.test(wxml) &&
    /bindtap="switchCommentFilter" data-filter="pending"/.test(wxml))

  // R10（2026-11-26 产品负责人「继续优化评价审核页面」）
  ok('R10-1 看板四格即筛选（待审核 / 待回复 / 已通过 / 已隐藏）+ 标题行「全部」；页签行只在看板读不到时兜底出现',
    ['pending', 'unreplied', 'approved', 'hidden'].every((f) => new RegExp(`class="cm-tile[^"]*" bindtap="switchCommentFilter" data-filter="${f}"`).test(reviewsTab)) &&
    /class="cm-all[^"]*" wx:if="\{\{commentStats\}\}" bindtap="switchCommentFilter" data-filter="all"/.test(reviewsTab) &&
    /<view class="sub-tab-row inner-filter" wx:if="\{\{!commentStats && !commentStatsLoading\}\}">/.test(reviewsTab))
  let behave = false
  try {
    const st = view.statsView({ counts: { all: 3, pending: 0, approved: 3, hidden: 0 }, unreplied: 2, days: [{ date: 'a', count: 0 }, { date: 'b', count: 2 }] })
    const st0 = view.statsView({ counts: { all: 0, pending: 0, approved: 0, hidden: 0 }, days: [{ date: 'a', count: 0 }] })
    const row = view.decorateComment({ _id: 'c1', status: 'approved', rating: 4, targetType: 'product', targetId: 'prod_9f8e7d', targetLabel: 'product · prod_9f8e7d', content: 'x', images: ['cloud://a', ''], createTime: Date.UTC(2026, 10, 24, 13, 3) })
    behave = st.weekTotal === 2 && st.unreplied === 2 && st0.unreplied === null && st0.unrepliedText === '–' && st0.weekTotal === 0 &&
      view.pickDefaultFilter({ counts: { pending: 2 }, unreplied: 5 }, 'pending') === 'pending' &&
      view.pickDefaultFilter({ counts: { pending: 0 }, unreplied: 5 }, 'pending') === 'unreplied' &&
      view.pickDefaultFilter({ counts: { pending: 0 }, unreplied: 0 }, 'pending') === 'all' &&
      view.pickDefaultFilter({ counts: { pending: 0 }, unreplied: 5 }, 'hidden') === 'hidden' &&
      row.stars === '★★★★☆' && row.timeText === '11-24 21:03' && row.imageCount === 1 && row.primary.label === '回复' &&
      !row.targetText.includes('prod_9f8e7d') &&
      view.filterRows([{ status: 'approved' }, { status: 'approved', merchantReply: '好' }, { status: 'pending' }], 'unreplied').length === 1 &&
      view.listQuery('unreplied').listFilter === 'unreplied' && view.listQuery('nope').listFilter === 'all' &&
      view.emptyCopy('pending', st).next.some((n) => n.filter === 'unreplied')
  } catch (e) { behave = false }
  ok('R10-2 展示口径实跑：默认筛选落在有活干的一队、近 7 天合计 / 无新增、待回复缺数不编 0、星级与北京时间、不露原始商品 id、待回复兜底本地筛、空态给下一步', behave)
  ok('R10-3 页面：用户手动选过筛选就不再自动改；进页默认筛选只改一次；切筛选期间的旧结果丢弃；卡片不再展示 targetId',
    /switchCommentFilter\(e\) \{[\s\S]{0,200}this\._commentFilterPicked = true/.test(cfg) &&
    /if \(!this\._commentFilterPicked\) \{[\s\S]{0,200}reviewView\.pickDefaultFilter\(/.test(cfg) &&
    /if \(filter !== this\.data\.commentFilter\) return/.test(cfg) &&
    !/item\.targetId/.test(reviewsTab))
  ok('R10-4 云端：看板带「待回复」数、列表支持 unreplied 筛选（已通过且未回复）；回复弹层带原评价摘要与常用说法',
    /const unreplied = rows\.filter\(\(r\) => r\.status === 'approved' && !String\(r\.merchantReply/.test(fn) && /\n    unreplied,\n/.test(fn) &&
    /\} else if \(listFilter === 'unreplied'\) \{\n[^\n]*\n\s*query = query\.where\(\{ status: 'approved' \}\)/.test(fn) &&
    /if \(listFilter === 'unreplied'\) rows = rows\.filter\(\(r\) => !String\(r\.merchantReply/.test(fn) &&
    /comment-reply-quote/.test(wxml) && /bindtap|catchtap="pickCommentReplyPhrase"/.test(wxml) && /async previewCommentImages\(e\)/.test(cfg))

  ok('R5 内容管理里删掉的只是这一项：专题 / 文章 / 养护三个子 Tab 仍在',
    ['exhibition', 'article', 'care'].every((t) => contentTab.includes(`data-type="${t}"`)))

  return fails
}

if (process.argv.includes('--selftest')) {
  const cases = [
    { name: '内容管理又把用户评价塞回子 Tab', file: F.wxml, find: '<!-- [Tab 9] 内容管理 -->', replace: '<!-- [Tab 9] 内容管理 -->\n      <view class="sub-tab" bindtap="switchContentType" data-type="comment">用户评价</view>' },
    { name: 'Tab 17 不再拉评价', file: F.cfg, find: 'if(idx === 17) await Promise.all([this.loadComments(), this.loadCommentStats()]);', replace: '' },
    { name: 'Hub 入口丢了「评价」', file: F.hub, find: "keys: ['reviews'], tap: 'switchTab', idx: 17", replace: "keys: ['reviews'], tap: 'switchTab', idx: 18" },
    { name: '回复后不再发「山海有信」', file: F.fn, find: 'await notifyCommentReplied(comment, replyText)', replace: '' },
    { name: '看板 stats 动作被删', file: F.fn, find: "    if (action === 'stats') {", replace: "    if (action === 'statsX') {" },
    { name: '新评价不再提醒员工（工作信息）', file: F.submitFn, find: 'await notifyStaffNewComment(db, {', replace: 'await Promise.resolve({ ok: true }); void ({' },
    { name: '待审核为 0 仍停在空的待审核', file: F.view, find: "  if (Number(stats.unreplied) > 0) return 'unreplied'\n  return 'all'", replace: "  return current" },
    { name: '手动选过筛选还被自动改回', file: F.cfg, find: '    this._commentFilterPicked = true; // 用户手动选过', replace: '    // 用户手动选过' },
    { name: '卡片又露出原始商品 id', file: F.view, find: "  if (lbl && !/·/.test(lbl)) return lbl", replace: '  if (lbl) return lbl' },
    { name: '待回复缺数时编成 0', file: F.view, find: "    unrepliedText: unreplied === null ? '–' : String(unreplied),", replace: "    unrepliedText: String(unreplied || 0)," },
    { name: '看板与页签又重复两排', file: F.wxml, find: '<view class="sub-tab-row inner-filter" wx:if="{{!commentStats && !commentStatsLoading}}">', replace: '<view class="sub-tab-row inner-filter">' },
    { name: '通过 / 恢复主动作映射错', file: F.view, find: "  if (st === 'hidden') return { action: 'approve', label: '恢复' }", replace: "  if (st === 'hidden') return { action: 'hide', label: '恢复' }" },
    { name: '云端待回复筛选丢失', file: F.fn, find: "  } else if (listFilter === 'unreplied') {", replace: "  } else if (listFilter === 'unrepliedX') {" },
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
    // 锚点失效不算「检出」（2026-11-26 修：原来会把失效锚点当成检出，假绿）
    if (fails.length === 1 && /^注入锚点失效/.test(fails[0])) { console.error(`✗ 注入「${c.name}」→ ${fails[0]}`); bad += 1; continue }
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
  console.log('✓ check:reviews-tab：内容管理不再承载评价 / 评价为 Tab 17（列表与五个动作）/ 懒加载 / Hub 磁贴与菜单键 / 看板四格即筛选 + 待回复 + 默认落在有活干的一队')
}
