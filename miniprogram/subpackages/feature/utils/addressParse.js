// 整段地址文本 → { name, phone, region, detail }（纯函数，无 wx 依赖）。
// 只做预填：认不准的部分留空让人补，不按常见城市去猜省份。
// region 对齐 picker mode="region" 的取值：省级全称 / 地级全称 / 县级全称；直辖市第二级与第一级同名。

const PROVINCES = [
  ['北京市', '北京'], ['天津市', '天津'], ['上海市', '上海'], ['重庆市', '重庆'],
  ['河北省', '河北'], ['山西省', '山西'], ['辽宁省', '辽宁'], ['吉林省', '吉林'], ['黑龙江省', '黑龙江'],
  ['江苏省', '江苏'], ['浙江省', '浙江'], ['安徽省', '安徽'], ['福建省', '福建'], ['江西省', '江西'],
  ['山东省', '山东'], ['河南省', '河南'], ['湖北省', '湖北'], ['湖南省', '湖南'], ['广东省', '广东'],
  ['海南省', '海南'], ['四川省', '四川'], ['贵州省', '贵州'], ['云南省', '云南'], ['陕西省', '陕西'],
  ['甘肃省', '甘肃'], ['青海省', '青海'], ['台湾省', '台湾'],
  ['内蒙古自治区', '内蒙古'], ['广西壮族自治区', '广西'], ['西藏自治区', '西藏'],
  ['宁夏回族自治区', '宁夏'], ['新疆维吾尔自治区', '新疆'],
  ['香港特别行政区', '香港'], ['澳门特别行政区', '澳门']
]
const MUNICIPALITIES = ['北京市', '天津市', '上海市', '重庆市']

const ADDR_HINT = /[省市区县旗镇乡村路街道巷弄号室栋幢楼层单元座苑园庄府里湾坊厦城宅]/
const NAME_STOP = /[省市区县旗镇乡村路街道巷弄号室栋幢楼层单元座]/
const LABEL_NAME = /(收件人|收货人|联系人|姓名|名字)\s*[:：]?/g
const LABEL_PHONE = /(联系电话|手机号码|手机号|电话号码|电话|手机|tel|TEL|Tel)\s*[:：]?/g
const LABEL_ADDR = /(收货地址|详细地址|所在地区|所在地址|地址)\s*[:：]?/g
const LANDLINE_RE = /^(\+?86)?0\d{2,3}-?\d{7,8}(-\d{1,6})?$/
const PHONE_RE = /(?:\+?\s*86[\s-]*)?(1[3-9]\d(?:[\s-]*\d){8})(?!\d)/

function toHalfWidth(s) {
  return String(s || '')
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
}

function takeProvince(s) {
  for (const [full, short] of PROVINCES) {
    if (s.startsWith(full)) return { province: full, rest: s.slice(full.length), short: false }
  }
  for (const [full, short] of PROVINCES) {
    if (!s.startsWith(short)) continue
    let rest = s.slice(short.length)
    const tail = full.slice(short.length)
    if (tail && rest.startsWith(tail)) rest = rest.slice(tail.length)
    else if (/^(省|自治区)/.test(rest)) rest = rest.replace(/^(省|自治区)/, '')
    return { province: full, rest, short: true }
  }
  return null
}

const CITY_RE = /^([\u4e00-\u9fa5]{1,10}?(?:自治州|地区|盟|市))/
const COUNTY_RE = /^([\u4e00-\u9fa5]{1,8}?(?:自治县|自治旗|新区|区|县|旗|市))/

/** 在地址串里认省市区；认不出省级就整体返回 null（不凭城市名猜省份）。 */
function parseRegion(addr) {
  const s = addr.replace(/\s+/g, '')
  for (let offset = 0; offset <= Math.min(4, s.length - 2); offset += 1) {
    const prefix = s.slice(0, offset)
    if (offset && !/^[\u4e00-\u9fa5]+$/.test(prefix)) continue
    const p = takeProvince(s.slice(offset))
    if (!p) continue
    let rest = p.rest
    let city = ''
    if (MUNICIPALITIES.includes(p.province)) {
      city = p.province
      if (rest.startsWith(p.province)) rest = rest.slice(p.province.length)
      if (rest.startsWith('市辖区')) rest = rest.slice(3)
    } else if (p.short && rest.startsWith('市')) {
      city = p.province.replace(/(省|自治区|特别行政区)$/, '') + '市'
      rest = rest.slice(1)
    } else {
      const m = rest.match(CITY_RE)
      if (m) { city = m[1]; rest = rest.slice(city.length) }
    }
    if (!city) continue
    let county = ''
    const c = rest.match(COUNTY_RE)
    if (c) { county = c[1]; rest = rest.slice(county.length) }
    return { prefix, region: county ? [p.province, city, county] : [p.province, city], rest }
  }
  return null
}

function looksLikeName(t) {
  return !!t && t.length <= 12 && !/\d/.test(t) && !NAME_STOP.test(t) && !/[#\-/]/.test(t)
}

/**
 * @param {string} text 粘贴的整段文本
 * @returns {{ name: string, phone: string, region: string[], detail: string, found: string[], missing: string[] }}
 */
function parseAddressText(text) {
  let s = toHalfWidth(text)
  let name = ''
  const nameLabeled = s.match(/(?:收件人|收货人|联系人|姓名|名字)\s*[:：]\s*([^\s,，;；:：\n]{1,12})/)
  if (nameLabeled && !/\d/.test(nameLabeled[1])) {
    name = nameLabeled[1]
    s = s.replace(nameLabeled[0], ' ')
  }
  s = s.replace(LABEL_NAME, ' ').replace(LABEL_PHONE, ' ').replace(LABEL_ADDR, ' ')

  let phone = ''
  const pm = s.match(PHONE_RE)
  if (pm) {
    phone = pm[1].replace(/[\s-]/g, '')
    s = s.replace(pm[0], ' ')
  }

  const tokens = s.split(/[\n\r\t,，;；、|:：()（）\[\]【】]+|\s+/).map((t) => t.trim()).filter(Boolean)
    .filter((t, i) => !(i && /^\d{6}$/.test(t)) && !LANDLINE_RE.test(t))
  if (!name && (tokens.length > 1 || (tokens.length === 1 && phone))) {
    const edges = [0, tokens.length - 1]
    const strict = edges.find((i) => looksLikeName(tokens[i]) && !ADDR_HINT.test(tokens[i]) && !parseRegion(tokens[i]))
    const loose = tokens.length > 1 ? edges.find((i) => looksLikeName(tokens[i]) && !parseRegion(tokens[i])) : undefined
    const at = strict != null ? strict : loose
    if (at != null) { name = tokens[at]; tokens.splice(at, 1) }
  }
  const addr = tokens.join('')

  let region = []
  let detail = addr
  const r = addr ? parseRegion(addr) : null
  if (r) {
    region = r.region
    detail = r.rest
    if (r.prefix && !name && looksLikeName(r.prefix)) name = r.prefix
  }
  if (!name) {
    const tail = detail.match(/^(.*\d)([\u4e00-\u9fa5]{2,4})$/)
    if (tail && looksLikeName(tail[2])) { name = tail[2]; detail = tail[1] }
  }
  detail = detail.replace(/^[\s,，.。-]+|[\s,，.。-]+$/g, '')
  if (!region.length && !/\d/.test(detail) && !ADDR_HINT.test(detail)) detail = ''

  const found = []
  const missing = []
  ;(name ? found : missing).push('收件人')
  ;(phone ? found : missing).push('手机号')
  ;(region.length >= 3 ? found : missing).push('省市区')
  ;(detail ? found : missing).push('详细地址')
  return { name, phone, region, detail, found, missing }
}

module.exports = { parseAddressText, parseRegion }
