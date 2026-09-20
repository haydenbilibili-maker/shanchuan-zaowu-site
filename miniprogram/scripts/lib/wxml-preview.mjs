/**
 * 极简 WXML → HTML 渲染器（**只服务离线版式预览**，不参与小程序构建、不参与 check:admin）
 *
 * 为什么需要它（错题本 E3「锚点从渲染输出回抄」的同族错误）：
 * 2026-09-18 的 `render-wall-preview.mjs` 是**手抄**一份 WXML 结构再去量版的。手抄件会漂移，
 * 而且漂移是**静默**的 —— 2026-09-20 实测：预览里渲染了 `.ww-play-mark`（玩法瓦片上的「签/饼/座/我」字标），
 * 真实 `index.wxml` 里根本没有这个元素；于是预览"看着没问题"，真机截图里瓦片是四个纯文本框。
 * 同一份手抄件还把发送条放在了玩法区**之后**（真源码是弹幕墙**正下方**），并因此报出两条
 * 「发送条没有吸底」的假失败 —— 判据的对象根本不是真源码。
 *
 * 结论：预览的结构**必须从 index.wxml 现读**。本文件是那件事的最小实现。
 *
 * 支持（本页用到的全部语法）：
 *   · `{{ }}` 插值（整值 / 拼接 / 三元 / 比较 / 数组字面量 / 属性访问）
 *   · `wx:if` / `wx:elif` / `wx:else`（含跨 `<block>` 的链）
 *   · `wx:for`（含 `wx:for-item` / `wx:for-index`）
 *   · `view|text|block|image|button|input` 标签映射；`<block>` 不产元素
 *   · 自定义组件（标签名含 `-`，如 `app-toast`）整棵跳过
 * 不支持（本页没用到，遇到了会**抛错**而不是静默画错）：
 *   · `wx:for` 与 `wx:if` 同标签（本页注释里明确禁止这么写）
 *   · `<template>` / `<import>` / `<include>` / 自定义组件插槽
 */

const VOID_TAGS = new Set(['input', 'image', 'img', 'br'])

/* ── 1. 解析 ──────────────────────────────────────────────────────────── */

/** 扫描式取标签：属性值里可能出现 `>`（如 `wx:if="{{a > b}}"`），正则会在那里截断 */
function parseWxml(src) {
  const root = { tag: '#root', attrs: {}, kids: [] }
  const stack = [root]
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) {
      pushText(stack[stack.length - 1], src.slice(i))
      break
    }
    if (lt > i) pushText(stack[stack.length - 1], src.slice(i, lt))
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt)
      if (end < 0) throw new Error('wxml-preview：注释没有闭合')
      i = end + 3
      continue
    }
    // 读到标签结束（引号内的 `>` 不算结束）
    let j = lt + 1
    let quote = null
    while (j < src.length) {
      const c = src[j]
      if (quote) {
        if (c === quote) quote = null
      } else if (c === '"' || c === "'") quote = c
      else if (c === '>') break
      j += 1
    }
    if (j >= src.length) throw new Error('wxml-preview：标签没有闭合')
    const raw = src.slice(lt + 1, j)
    i = j + 1
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim()
      const top = stack[stack.length - 1]
      // ⚠️ `<image …></image>`：image 在 HTML 里是空元素（不产闭合标签），WXML 里却常写闭合标签。
      // 若在开标签处就不入栈、却在闭标签处弹栈，会**静默弹掉父节点**，后面第一个 `</view>` 才报错，
      // 报错点离真因很远（本文件第一版就是这样）。所以闭标签要按"名字对不对得上"来判断。
      if (top && top.tag === name) { stack.pop(); continue }
      if (VOID_TAGS.has(name)) continue
      if (stack.length < 2) throw new Error(`wxml-preview：多余的结束标签 </${name}>`)
      throw new Error(`wxml-preview：</${name}> 与当前打开的 <${top && top.tag}> 不匹配（有标签没闭合，或闭合写错了）`)
    }
    const selfClose = raw.endsWith('/')
    const body = selfClose ? raw.slice(0, -1) : raw
    const nameMatch = /^([A-Za-z][\w:-]*)/.exec(body)
    if (!nameMatch) throw new Error(`wxml-preview：解析不出标签名：<${raw}>`)
    const tag = nameMatch[1]
    const node = { tag, attrs: parseAttrs(body.slice(nameMatch[1].length)), kids: [] }
    stack[stack.length - 1].kids.push(node)
    if (!selfClose && !VOID_TAGS.has(tag)) stack.push(node)
  }
  if (stack.length !== 1) throw new Error(`wxml-preview：有 ${stack.length - 1} 个标签没有闭合`)
  return root
}

function pushText(parent, text) {
  // ⚠️ 纯空白文本节点必须**在解析期就丢掉**：WXML 里 `wx:if` 与 `wx:elif` 之间隔着一个换行，
  // 若把它们当成兄弟节点，`wx:elif` 就会找不到它的 `wx:if` 而被判成"孤儿"（本文件第二版就是这样）。
  if (!text || !text.trim()) return
  parent.kids.push({ tag: '#text', text })
}

const ATTR_RE = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g
function parseAttrs(s) {
  const attrs = {}
  ATTR_RE.lastIndex = 0
  let m
  while ((m = ATTR_RE.exec(s))) {
    if (!m[1]) continue
    attrs[m[1]] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : '')
  }
  return attrs
}

/* ── 2. 求值 ──────────────────────────────────────────────────────────── */

const FN_CACHE = new Map()
/** `with` 只在**非严格模式**可用；`new Function` 的函数体天然是非严格的（ESM 的严格性不外溢） */
/**
 * 缺字段时的行为：
 *   · `null`（默认，严格）= 抛错。这是 **wish-wall 预览**要的：样例数据必须覆盖 WXML 引用的每个字段，
 *     少一个就说明预览会少画一块，必须当场报出来（assertSampleCovers 是同一道闸）。
 *   · 函数 = 宽免模式：记下缺的表达式、求值为 undefined，**照常渲染**。
 *     给「藏品库 → 分类管理」那种几千行、引用上百个字段的面板用：
 *     为了量一条行的宽度去补齐全页样例数据不现实；但「静默少画一块」仍然是危险的 ——
 *     所以宽免模式**必须**把缺的字段名交回调用方（见 onMissing）。
 */
let ON_MISSING = null

function evalJs(expr, scope) {
  let fn = FN_CACHE.get(expr)
  if (!fn) {
    // eslint-disable-next-line no-new-func
    fn = new Function('$scope', `with ($scope) { return (${expr}); }`)
    FN_CACHE.set(expr, fn)
  }
  try {
    return fn(scope)
  } catch (e) {
    if (ON_MISSING) { ON_MISSING(expr); return undefined }
    throw new Error(`wxml-preview：表达式 {{${expr}}} 求值失败 —— ${e.message}（多半是样例数据缺字段）`)
  }
}

function evalAttr(raw, scope) {
  if (raw === undefined) return undefined
  const s = String(raw)
  // ⚠️ 整值判据必须**禁止表达式里出现 `}}`**：`{{a}}{{b}}` 用贪心或非贪心都会把
  // `a}}{{b` 当成一个表达式（两种写法都会一路吃到最后一个 `}}`），于是把两个相邻插值
  // 拼成一句语法错误 —— 真源码里 `.ww-scope` 就是这种写法（WXML 56）。
  const whole = /^\s*\{\{((?:(?!\}\})[\s\S])*)\}\}\s*$/.exec(s)
  if (whole) return evalJs(whole[1], scope)
  if (!s.includes('{{')) return s
  return s.replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => {
    const v = evalJs(e, scope)
    return v === undefined || v === null ? '' : String(v)
  })
}

/* ── 3. 渲染 ──────────────────────────────────────────────────────────── */

const TAG_MAP = {
  view: 'div', text: 'span', block: null, image: 'img', button: 'button', input: 'input',
  // 小程序内建组件（2026-09-20 补，起因：给「藏品库 → 分类管理」量版式时 <picker> 直接抛错）。
  // ⚠️ 带 `-` 的标签**必须显式登记**：否则会被当成"自定义组件"整棵跳过 ——
  // 而 `<scroll-view>` 这类是**有子节点的容器**，跳过它等于把里面量没了（比抛错更危险）。
  picker: 'div', 'scroll-view': 'div', swiper: 'div', 'swiper-item': 'div',
  'radio-group': 'div', 'checkbox-group': 'div', radio: 'span', checkbox: 'span',
  switch: 'span', label: 'span', textarea: 'div', video: 'div', navigator: 'div',
  form: 'div', canvas: 'div', 'movable-area': 'div', 'movable-view': 'div',
  'cover-view': 'div', 'cover-image': 'img', 'rich-text': 'div', progress: 'div',
  icon: 'span', slot: null, wxs: null
}
const KEEP_ATTRS = new Set(['class', 'style', 'id', 'src', 'placeholder', 'value', 'maxlength', 'type'])

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s) => esc(s).replace(/"/g, '&quot;')

const isChain = (n) => n.attrs['wx:if'] !== undefined && n.attrs['wx:for'] === undefined
const chainNext = (n) => n.attrs['wx:elif'] !== undefined || n.attrs['wx:else'] !== undefined

function renderNodes(nodes, scope) {
  let out = ''
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i]
    if (n.tag === '#text') { out += esc(evalAttr(n.text, scope)); continue }
    if (isChain(n)) {
      let j = i
      const chain = [n]
      while (j + 1 < nodes.length && nodes[j + 1].tag !== '#text' && chainNext(nodes[j + 1])) chain.push(nodes[++j])
      i = j
      for (const c of chain) {
        const cond = c.attrs['wx:if'] !== undefined
          ? truthy(evalAttr(c.attrs['wx:if'], scope))
          : c.attrs['wx:elif'] !== undefined ? truthy(evalAttr(c.attrs['wx:elif'], scope)) : true
        if (cond) { out += renderNode(c, scope); break }
      }
      continue
    }
    if (chainNext(n)) throw new Error('wxml-preview：出现没有 wx:if 开头的 wx:elif / wx:else')
    out += renderNode(n, scope)
  }
  return out
}

const truthy = (v) => !(v === false || v === undefined || v === null || v === '' || v === 0)

function renderNode(n, scope) {
  if (n.attrs['wx:for'] !== undefined) {
    if (n.attrs['wx:if'] !== undefined) {
      throw new Error('wxml-preview：wx:for 与 wx:if 写在同一标签上（本仓明令禁止，WXML 编译器也不认这种 elif 链）')
    }
    const list = evalAttr(n.attrs['wx:for'], scope) || []
    if (!Array.isArray(list)) throw new Error(`wxml-preview：wx:for 的值不是数组：{{${n.attrs['wx:for']}}}`)
    const itemName = n.attrs['wx:for-item'] || 'item'
    const idxName = n.attrs['wx:for-index'] || 'index'
    const attrs = { ...n.attrs }
    delete attrs['wx:for']; delete attrs['wx:for-item']; delete attrs['wx:for-index']; delete attrs['wx:key']
    return list.map((it, ix) => {
      const child = Object.create(scope)
      child[itemName] = it
      child[idxName] = ix
      return renderElement({ tag: n.tag, attrs, kids: n.kids }, child)
    }).join('')
  }
  return renderElement(n, scope)
}

function renderElement(n, scope) {
  const mapped = TAG_MAP[n.tag]
  if (mapped === undefined) {
    // 自定义组件：预览里没有它的实现，整棵跳过（不渲染成一堆文字，也不报错）
    if (n.tag.includes('-')) return ''
    throw new Error(`wxml-preview：没见过的标签 <${n.tag}>（要支持就在 TAG_MAP 里补一条）`)
  }
  if (mapped === null) return renderNodes(n.kids, scope) // <block>

  const parts = []
  let cls = ''
  for (const [k, v] of Object.entries(n.attrs)) {
    if (k.startsWith('wx:') || k.startsWith('bind') || k.startsWith('catch') || k.startsWith('hover-')) continue
    const val = evalAttr(v, scope)
    if (k === 'class') { cls = String(val == null ? '' : val).trim().replace(/\s+/g, ' '); continue }
    if (k.startsWith('data-') || k === 'aria-role') continue
    if (k.startsWith('aria-')) { parts.push(`${k}="${escAttr(val)}"`); continue }
    if (KEEP_ATTRS.has(k)) parts.push(`${k}="${escAttr(val)}"`)
    // mode / lazy-load / open-type 等：预览用不到，丢掉
  }
  if (cls) parts.unshift(`class="${escAttr(cls)}"`)
  if (VOID_TAGS.has(n.tag)) return `<${mapped} ${parts.join(' ')}>`
  return `<${mapped} ${parts.join(' ')}>${renderNodes(n.kids, scope)}</${mapped}>`
}

/**
 * 渲染一份 WXML。
 * @param {string} wxml 真实源码（**不是手抄件**）
 * @param {object} data 样例数据（模拟 Page 的 data）
 * @param {{rewrite?: (html: string) => string}} [opts] 出图前的后处理（例：把弹幕的动画态摆到画面里）
 */
export function renderWxml(wxml, data, opts = {}) {
  const tree = parseWxml(wxml.replace(/<!--[\s\S]*?-->/g, ''))
  const scope = Object.assign(Object.create(null), data)
  const prev = ON_MISSING
  // 只有显式声明 lenient 才开宽免；开了就把缺的字段交回 onMissing（缺字段必须留痕）
  ON_MISSING = opts.lenient ? (opts.onMissing || (() => {})) : null
  let html
  try {
    html = renderNodes(tree.kids, scope)
  } finally {
    ON_MISSING = prev
  }
  return opts.rewrite ? opts.rewrite(html) : html
}
