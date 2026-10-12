#!/usr/bin/env node
/**
 * check:address-parse —— 代填地址「粘贴整段 → 自动识别」（2026-10-12）
 *
 * A 解析器样例：真源 `subpackages/feature/utils/addressParse.js` 逐条比对 收件人 / 手机 / 省市区 / 详细地址
 *   （含产品负责人给的原文样例；姓名前后、手机空格 / 横杠 / +86、标签、换行 / 逗号、直辖市、自治区 / 自治州 / 盟 / 地区、
 *    县级市、缺省份不猜、乱文不填）。
 * B 接线：代填弹层有粘贴框 + 「识别」+「从剪贴板粘贴」，识别结果写进表单字段、用就地提示（不弹原生提示），
 *   提交仍走原校验；解析器在 feature 分包（不进主包）。
 *
 * 用法：node miniprogram/scripts/check-address-parse.mjs [--selftest]
 * --selftest：对真源做**内存注入**（不改文件），每条注入都必须被检出。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCjsModule } from './lib/cjs-loader.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const PARSER = resolve(MP, 'subpackages/feature/utils/addressParse.js')
const SHEET_JS = resolve(MP, 'subpackages/feature/gift/proxy-address-sheet/index.js')
const SHEET_WXML = resolve(MP, 'subpackages/feature/gift/proxy-address-sheet/index.wxml')

const SH = ['上海市', '上海市']
const CASES = [
  ['产品负责人原文', '上海市杨浦区政悦路500弄21号301  惠惠15901285772', '惠惠', '15901285772', [...SH, '杨浦区'], '政悦路500弄21号301'],
  ['姓名在前 · 普通省市区', '张三 13800138000 广东省深圳市南山区科技园科苑路15号', '张三', '13800138000', ['广东省', '深圳市', '南山区'], '科技园科苑路15号'],
  ['手机号含空格', '李四 138 0013 8000 浙江省杭州市西湖区文三路90号', '李四', '13800138000', ['浙江省', '杭州市', '西湖区'], '文三路90号'],
  ['+86 与横杠', '+86-138-0013-8000 王五 北京市朝阳区建国路88号SOHO现代城5号楼', '王五', '13800138000', ['北京市', '北京市', '朝阳区'], '建国路88号SOHO现代城5号楼'],
  ['+86 与空格', '惠惠 +86 159 0128 5772 上海市杨浦区政悦路500弄21号301', '惠惠', '15901285772', [...SH, '杨浦区'], '政悦路500弄21号301'],
  ['标签 + 换行', '收件人：赵六\n电话：13912345678\n地址：天津市和平区南京路100号', '赵六', '13912345678', ['天津市', '天津市', '和平区'], '南京路100号'],
  ['全角标签与冒号', '收货人:孙七  手机号码：13700001111  收货地址：重庆市渝中区解放碑民族路188号', '孙七', '13700001111', ['重庆市', '重庆市', '渝中区'], '解放碑民族路188号'],
  ['逗号分隔', '钱八，15901234567，重庆市城口县葛城街道北大街1号', '钱八', '15901234567', ['重庆市', '重庆市', '城口县'], '葛城街道北大街1号'],
  ['县级市', '江苏省苏州市昆山市玉山镇前进西路1号 周九 18612345678', '周九', '18612345678', ['江苏省', '苏州市', '昆山市'], '玉山镇前进西路1号'],
  ['自治区 + 自治州', '新疆维吾尔自治区伊犁哈萨克自治州伊宁市解放路2号 吴十 13511112222', '吴十', '13511112222', ['新疆维吾尔自治区', '伊犁哈萨克自治州', '伊宁市'], '解放路2号'],
  ['省份简写 + 自治州', '四川甘孜藏族自治州康定市炉城镇1号 郑一 13322223333', '郑一', '13322223333', ['四川省', '甘孜藏族自治州', '康定市'], '炉城镇1号'],
  ['自治区简写 + 盟', '内蒙古锡林郭勒盟锡林浩特市额尔敦路3号 王二 15011112222', '王二', '15011112222', ['内蒙古自治区', '锡林郭勒盟', '锡林浩特市'], '额尔敦路3号'],
  ['地区（不被当成标签）', '西藏自治区阿里地区噶尔县狮泉河镇1号 次仁 13899990000', '次仁', '13899990000', ['西藏自治区', '阿里地区', '噶尔县'], '狮泉河镇1号'],
  ['广西全称', '广西壮族自治区南宁市青秀区民族大道1号 黄五 13977001122', '黄五', '13977001122', ['广西壮族自治区', '南宁市', '青秀区'], '民族大道1号'],
  ['直辖市省略「市」', '上海浦东新区张江路100号 刘四 13600002222', '刘四', '13600002222', [...SH, '浦东新区'], '张江路100号'],
  ['省份简写与地级同名', '吉林市船营区北京路1号 林六 13100001111', '林六', '13100001111', ['吉林省', '吉林市', '船营区'], '北京路1号'],
  ['姓名粘在地址前', '惠惠上海市杨浦区政悦路500弄21号301 15901285772', '惠惠', '15901285772', [...SH, '杨浦区'], '政悦路500弄21号301'],
  ['姓名粘在地址后', '上海市杨浦区政悦路500弄21号301惠惠 15901285772', '惠惠', '15901285772', [...SH, '杨浦区'], '政悦路500弄21号301'],
  ['地址里有空格', '上海市 杨浦区 政悦路500弄 21号301 惠惠 15901285772', '惠惠', '15901285772', [...SH, '杨浦区'], '政悦路500弄21号301'],
  ['缺省份不猜（深圳）', '深圳市南山区科技园1号 陈三 13800001111', '陈三', '13800001111', [], '深圳市南山区科技园1号'],
  ['路名含省名不误认', '黄浦区江西中路100号 何七 13800002222', '何七', '13800002222', [], '黄浦区江西中路100号'],
  ['座机与邮编不混进地址', '张三 021-65430000 上海市杨浦区政悦路500弄 200433 13800138000', '张三', '13800138000', [...SH, '杨浦区'], '政悦路500弄'],
  ['只有姓名手机', '惠惠 15901285772', '惠惠', '15901285772', [], ''],
  ['乱文不填', '你好呀', '', '', [], '']
]

function runCases(parse) {
  const fails = []
  for (const [label, input, name, phone, region, detail] of CASES) {
    let r
    try { r = parse(input) } catch (e) { fails.push(`A ${label}：抛错 ${e.message}`); continue }
    const got = { name: r.name, phone: r.phone, region: (r.region || []).join('/'), detail: r.detail }
    const want = { name, phone, region: region.join('/'), detail }
    for (const k of Object.keys(want)) {
      if (got[k] !== want[k]) fails.push(`A ${label}：${k} 期望「${want[k]}」实得「${got[k]}」`)
    }
    const missing = (r.missing || []).join(',')
    if (!region.length && !/省市区/.test(missing)) fails.push(`A ${label}：省市区没认出却没列入 missing`)
  }
  return fails
}

function checkWiring(js, wxml) {
  const fails = []
  if (!/require\(['"]\.\.\/\.\.\/utils\/addressParse(\.js)?['"]\)/.test(js)) fails.push('B 弹层未引用 feature 分包的 addressParse')
  if (!/wx\.getClipboardData\(/.test(js)) fails.push('B 弹层没有「从剪贴板粘贴」')
  if (/wx\.show(Modal|Toast|Loading)\(/.test(js)) fails.push('B 弹层用了原生弹窗 / 提示（应就地提示）')
  if (!/parseAddressText\(/.test(js) || !/pasteTip/.test(js)) fails.push('B 识别结果没有写回字段 / 没有就地提示')
  fails.push(...runSheet(js))
  if (!/'请填写 11 位收件手机号'/.test(js) || !/region\.length < 2/.test(js)) fails.push('B 提交校验被放宽（识别结果只是预填，提交仍须原校验）')
  if (!/<textarea[^>]*value="\{\{pasteText\}\}"[^>]*bindinput="onPasteInput"/.test(wxml) && !/<textarea[^>]*bindinput="onPasteInput"[^>]*value="\{\{pasteText\}\}"/.test(wxml)) fails.push('B 弹层缺「粘贴整段地址」输入框')
  if (!/粘贴整段地址自动识别/.test(wxml)) fails.push('B 弹层缺「粘贴整段地址自动识别」文案')
  if (!/bindtap="parsePaste"[^>]*>识别</.test(wxml.replace(/\s+/g, ' ')) && !/bindtap="parsePaste"/.test(wxml)) fails.push('B 弹层缺「识别」按钮')
  if (!/bindtap="pasteClipboard"/.test(wxml)) fails.push('B 弹层缺「从剪贴板粘贴」按钮')
  if (!/\{\{pasteTip\}\}/.test(wxml)) fails.push('B 弹层没有显示识别提示')
  return fails
}

/** 真跑弹层：粘贴原文 → 字段被填上；只认出一部分时，没认出的字段保留原值，并提示要补填 */
function runSheet(js) {
  const fails = []
  let def = null
  let clip = ''
  const wx = { getClipboardData: ({ success }) => success({ data: clip }), cloud: {}, chooseAddress() {} }
  try {
    new Function('Component', 'wx', 'require', js)((d) => { def = d }, wx, (name) => {
      if (/addressParse/.test(name)) return loadCjsModule(PARSER)
      throw new Error('未提供桩的模块 ' + name)
    })
  } catch (e) { return [`B 弹层脚本无法执行：${e.message}`] }
  if (!def || !def.methods || typeof def.methods.pasteClipboard !== 'function') return ['B 弹层没有 pasteClipboard 方法']
  const mk = (data) => {
    const ctx = { data: { ...def.data, ...data }, setData(p) { Object.assign(this.data, p) } }
    for (const [k, fn] of Object.entries(def.methods)) ctx[k] = fn.bind(ctx)
    return ctx
  }
  clip = '上海市杨浦区政悦路500弄21号301  惠惠15901285772'
  const a = mk({})
  a.pasteClipboard()
  const want = { name: '惠惠', phone: '15901285772', regionText: '上海市 上海市 杨浦区', detail: '政悦路500弄21号301' }
  for (const [k, v] of Object.entries(want)) {
    if (a.data[k] !== v) fails.push(`B 剪贴板识别后字段 ${k} 期望「${v}」实得「${a.data[k]}」`)
  }
  if (!/已识别/.test(a.data.pasteTip || '') || a.data.pasteMissing) fails.push('B 全部识别后没有给出「已识别」提示')
  const b = mk({ name: '旧名', region: ['广东省', '深圳市', '南山区'], regionText: '广东省 深圳市 南山区' })
  b.setData({ pasteText: '深圳市南山区科技园1号 13800001111' })
  b.parsePaste()
  if (b.data.phone !== '13800001111') fails.push('B 「识别」按钮没有写回手机号')
  if (b.data.regionText !== '广东省 深圳市 南山区' || b.data.name !== '旧名') fails.push('B 没认出的字段被清空 / 覆盖（应保留原值让人补）')
  if (!b.data.pasteMissing || !/省市区|收件人/.test(b.data.pasteTip || '')) fails.push('B 只认出一部分时没有提示哪些要补')
  return fails
}

function evaluate({ parserTransform = null, js = null, wxml = null } = {}) {
  const mod = loadCjsModule(PARSER, { transform: parserTransform ? (f, s) => (f === PARSER ? parserTransform(s) : s) : null })
  return [
    ...runCases(mod.parseAddressText),
    ...checkWiring(js != null ? js : readFileSync(SHEET_JS, 'utf8'), wxml != null ? wxml : readFileSync(SHEET_WXML, 'utf8'))
  ]
}

function mustReplace(src, a, b, label) {
  if (!src.includes(a)) throw new Error(`自检注入锚点缺失（${label}）：${a}`)
  return src.replace(a, b)
}

const INJECTIONS = [
  ['手机号不去空格', { parser: (s) => mustReplace(s, "pm[1].replace(/[\\s-]/g, '')", 'pm[1]', 'phone') }],
  ['不认 +86', { parser: (s) => mustReplace(s, '(?:\\+?\\s*86[\\s-]*)?', '', '+86') }],
  ['直辖市第二级留空', { parser: (s) => mustReplace(s, '      city = p.province\n', "      city = ''\n", 'muni') }],
  ['省份简写不补全称', { parser: (s) => mustReplace(s, "return { province: full, rest, short: true }", "return { province: short, rest, short: true }", 'short') }],
  ['没有省份就按城市猜', { parser: (s) => mustReplace(s, '    if (!city) continue', "    if (!city) return { prefix, region: [p.province], rest }", 'nocity') }],
  ['认不出省份也硬填地区', { parser: (s) => mustReplace(s, '  if (r) {', "  if (!r && addr) { region = ['广东省'] }\n  if (r) {", 'guess') }],
  ['自治州不认', { parser: (s) => mustReplace(s, '(?:自治州|地区|盟|市)', '(?:市)', 'pref') }],
  ['「地区」被当成标签删掉', { parser: (s) => mustReplace(s, '所在地址|地址)', '所在地址|地址|地区)', 'label') }],
  ['标签不剥', { parser: (s) => mustReplace(s, "s = s.replace(LABEL_NAME, ' ').replace(LABEL_PHONE, ' ').replace(LABEL_ADDR, ' ')", '', 'labels') }],
  ['姓名粘在地址后不拆', { parser: (s) => mustReplace(s, "if (tail && looksLikeName(tail[2]))", 'if (false)', 'tail') }],
  ['姓名粘在地址前不拆', { parser: (s) => mustReplace(s, "if (r.prefix && !name && looksLikeName(r.prefix)) name = r.prefix", '', 'prefix') }],
  ['座机混进地址', { parser: (s) => mustReplace(s, ' && !LANDLINE_RE.test(t)', '', 'landline') }],
  ['乱文填进详细地址', { parser: (s) => mustReplace(s, "if (!region.length && !/\\d/.test(detail) && !ADDR_HINT.test(detail)) detail = ''", '', 'garbage') }],
  ['弹层用原生提示', { js: (s) => s.replace('this.setData({ pasteTip', "wx.showToast({ title: 'x' }); this.setData({ pasteTip") }],
  ['弹层没有剪贴板按钮', { wxml: (s) => s.replace(/bindtap="pasteClipboard"/g, '') }],
  ['识别结果不写回手机号', { js: (s) => mustReplace(s, 'if (r.phone) patch.phone = r.phone', '', 'apply') }],
  ['提交校验被放宽', { js: (s) => mustReplace(s, "'请填写 11 位收件手机号'", "''", 'submit') }]
]

if (process.argv.includes('--selftest')) {
  const base = evaluate()
  if (base.length) { console.error('✗ 自检前置：真源本身未通过\n  ' + base.join('\n  ')); process.exit(1) }
  const jsSrc = readFileSync(SHEET_JS, 'utf8')
  const wxmlSrc = readFileSync(SHEET_WXML, 'utf8')
  let missed = 0
  for (const [label, inj] of INJECTIONS) {
    let fails
    try {
      fails = evaluate({
        parserTransform: inj.parser || null,
        js: inj.js ? inj.js(jsSrc) : null,
        wxml: inj.wxml ? inj.wxml(wxmlSrc) : null
      })
    } catch (e) {
      if (/锚点缺失/.test(e.message)) { console.error('✗ ' + e.message); missed += 1; continue }
      fails = [`抛错：${e.message}`]
    }
    if (fails.length) console.log(`  ✓ 检出「${label}」→ ${fails[0]}`)
    else { console.error(`  ✗ 未检出「${label}」`); missed += 1 }
  }
  if (missed) { console.error(`✗ check:address-parse 自检失败：${missed} 条注入未检出`); process.exit(1) }
  console.log(`✓ check:address-parse 自检通过（${INJECTIONS.length} 条内存注入全部检出，未写盘）`)
  process.exit(0)
}

const fails = evaluate()
if (fails.length) {
  console.error('✗ check:address-parse 未通过：\n  ' + fails.join('\n  '))
  process.exit(1)
}
console.log(`✓ check:address-parse 通过（${CASES.length} 个样例 + 弹层接线）`)
