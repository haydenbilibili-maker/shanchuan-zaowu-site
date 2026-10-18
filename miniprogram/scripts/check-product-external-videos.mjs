#!/usr/bin/env node
/**
 * 藏品实拍视频 · 外平台 + ERP 录入守卫（2026-10-18 产品负责人点名「产品详情页添加视频模块，支持填写 bilibili 等平台地址」）。
 * 评估与取舍：miniprogram/docs/藏品视频_外平台与云存储评估_2026-10-18.md
 *
 * 要守的不变量：
 *   A. 服务端：externalVideos 进白名单并被净化；只收 https + 白名单平台域名（仿冒域名 / http 丢弃）；
 *      视频号必须 sph 开头 ID + feedId；≤3 条、去重；B站分享文案能提取出链接。
 *   B. ERP 工具与服务端同口径：外平台常量（条数 / 平台域名 / 视频号正则）、media 常量（条数 / 时长 / 体积）；
 *      录入解析与服务端净化对同一批样例给出同样结论。
 *   C. ERP 保存：media / externalVideos 都只在「有值或原本有值」时才送（不清库里已有视频）；视频传到 products/ 目录。
 *   D. 店长端编辑器不送 externalVideos（它不认识这个字段 —— 送了就会洗掉；不送则合并写保留）。
 *   E. 详情页：外平台只做卡片 + 复制链接 / 视频号跳转，不出现 web-view / navigateToMiniProgram；
 *      视频号只有带 feedToken 才内嵌；不读 .media（media 归主图轮播，守卫 check:product-media）。
 *   F. cloudbase/schema/products.md 登记了 externalVideos。
 *
 * 自检在内存副本上注入（不写盘）。
 * 用法：node miniprogram/scripts/check-product-external-videos.mjs [--selftest]
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FILES = {
  srvIndex: 'miniprogram/cloudfunctions/manageProducts/index.js',
  srvExt: 'miniprogram/cloudfunctions/manageProducts/externalVideos.js',
  srvMedia: 'miniprogram/cloudfunctions/manageProducts/productMedia.js',
  adminUtil: 'admin/src/utils/productVideos.js',
  adminApp: 'admin/src/App.vue',
  adminCloud: 'admin/src/cloud.js',
  manager: 'miniprogram/subpackages/manager/manager/managerPageConfig.js',
  detailUtil: 'miniprogram/subpackages/feature/utils/externalVideos.js',
  detailJs: 'miniprogram/subpackages/feature/detail/index.js',
  detailWxml: 'miniprogram/subpackages/feature/detail/index.wxml',
  schema: 'cloudbase/schema/products.md'
}
const readAll = () => Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, readFileSync(resolve(ROOT, p), 'utf8')]))

function cjs(src) {
  try { const m = { exports: {} }; new Function('module', 'exports', 'require', src)(m, m.exports, () => ({})); return m.exports } catch (e) { return {} }
}
async function esm(src) {
  try { return await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(src)}`) } catch (e) { return {} }
}

const SAMPLES = [
  { url: '【蓝闪蝶展翅】 https://b23.tv/AbC123x 复制此链接，打开哔哩哔哩' },
  { url: 'https://www.bilibili.com/video/BV1xx411c7mD?p=1' },
  { url: 'http://www.bilibili.com/video/BV1xx411c7mD' },
  { url: 'https://evilbilibili.com/video/BV1xx411c7mD' },
  { url: 'https://evil.com/?u=bilibili.com' },
  { url: 'https://v.douyin.com/iABCdef/' },
  { url: 'https://www.xiaohongshu.com/explore/123' },
  { url: 'https://youtube.com/watch?v=1' }
]

async function checks(s) {
  const out = []
  const add = (name, ok) => out.push({ name, ok: !!ok })
  const srv = cjs(s.srvExt)
  const srvMedia = cjs(s.srvMedia)
  const adm = await esm(s.adminUtil)
  const det = cjs(s.detailUtil)

  // A
  let a = false
  try {
    const r = srv.sanitizeExternalVideos([
      SAMPLES[0], SAMPLES[2], SAMPLES[3], SAMPLES[4],
      { platform: 'channels', finderUserName: 'sphABCdef', feedId: 'export/UzFfAgtgekIEAQ', feedToken: 'tok_123456' },
      { platform: 'channels', finderUserName: 'ABCdef', feedId: 'export/OtherFeed99' },
      SAMPLES[1], SAMPLES[1], SAMPLES[5]
    ])
    a = r.length === 3 && r[0].url === 'https://b23.tv/AbC123x' && r[0].platform === 'bilibili' &&
      r[1].platform === 'channels' && r[1].feedToken === 'tok_123456' && r[1].url === '' && r[1].sameSubject === false &&
      srv.sanitizeExternalVideos([{ platform: 'channels', finderUserName: 'sphABCdef', feedId: 'feed000001', sameSubject: 'yes' }])[0].sameSubject === false &&
      r[2].bvid === 'BV1xx411c7mD' && srv.sanitizeExternalVideos('x').length === 0
  } catch (e) { a = false }
  add('A1 服务端净化：只收 https + 白名单平台（仿冒域名 / http 丢弃）；视频号要 sph ID + feedId；≤3 条、去重；分享文案能提取链接', a)
  add('A2 externalVideos 进 ALLOWED_FIELDS，且 prepareProductData 里过 sanitizeExternalVideos',
    /'externalVideos'/.test((/const ALLOWED_FIELDS = \[(.*?)\n\]/s.exec(s.srvIndex) || [])[1] || '') &&
      /if \(Object\.prototype\.hasOwnProperty\.call\(data, 'externalVideos'\)\) \{\s*data\.externalVideos = sanitizeExternalVideos\(data\.externalVideos\)/.test(s.srvIndex))

  // B
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y)
  add('B1 ERP 与服务端外平台常量同口径（条数 / 平台域名）', srv.MAX_EXTERNAL === adm.MAX_EXTERNAL && same(srv.PLATFORMS, adm.PLATFORMS))
  add('B2 ERP 与服务端 media 常量同口径（条数 / 时长 / 体积）',
    srvMedia.MAX_MEDIA === adm.MAX_MEDIA && srvMedia.MAX_VIDEO_SECONDS === adm.MAX_VIDEO_SECONDS && srvMedia.MAX_VIDEO_BYTES === adm.MAX_VIDEO_BYTES)
  let b3 = false
  try {
    b3 = SAMPLES.every((x) => {
      const mine = adm.parseExternalDraft({ kind: 'link', url: x.url }, [])
      const theirs = srv.sanitizeExternalVideos([x])
      return mine.item ? (theirs.length === 1 && theirs[0].url === mine.item.url && theirs[0].platform === mine.item.platform && theirs[0].bvid === mine.item.bvid) : theirs.length === 0
    }) && !!adm.parseExternalDraft({ kind: 'channels', finderUserName: 'sphABCdef', feedId: 'export/UzFfAgtgekIEAQ' }, []).item &&
      !!adm.parseExternalDraft({ kind: 'channels', finderUserName: 'ABCdef', feedId: 'export/UzFfAgtgekIEAQ' }, []).error &&
      adm.checkVideoFile({ size: 60 * 1048576, duration: 30 }).ok === false && adm.checkVideoFile({ size: 10 * 1048576, duration: 70 }).ok === false &&
      !!adm.checkVideoFile({ size: 40 * 1048576, duration: 30 }).warn && !adm.checkVideoFile({ size: 8 * 1048576, duration: 30 }).warn
  } catch (e) { b3 = false }
  add('B3 ERP 录入解析与服务端净化对同一批样例结论一致；视频超 50MB / 超 60 秒拒、码率偏高只提醒', b3)

  // C
  add('C1 ERP 保存：media / externalVideos 只在有值或原本有值时才送（不清库里已有视频）',
    /\.\.\.\(\(form\.value\.media \|\| \[\]\)\.length \|\| form\.value\.mediaOrigCount \? \{ media: toPayloadMedia\(form\.value\.media\) \} : \{\}\)/.test(s.adminApp) &&
      /\(form\.value\.externalVideos \|\| \[\]\)\.length \|\| form\.value\.externalOrigCount\s*\? \{ externalVideos:/.test(s.adminApp) &&
      /mediaOrigCount: Array\.isArray\(row\.media\) \? row\.media\.length : 0/.test(s.adminApp) &&
      /externalOrigCount: Array\.isArray\(row\.externalVideos\) \? row\.externalVideos\.length : 0/.test(s.adminApp))
  add('C2 ERP 视频上传到 products/ 目录并带进度；上传工具的进度参数可选（老调用不变）',
    /uploadAdminBinary\(file, 'products', \{ onProgress:/.test(s.adminApp) &&
      /export const uploadAdminBinary = async \(file, folder = 'erp-store', \{ onProgress \} = \{\}\) =>/.test(s.adminCloud))

  // D
  add('D1 店长端编辑器不送 externalVideos（合并写保留 ERP 录入的外平台视频）', !/externalVideos/.test(s.manager))

  // E
  let e1 = false
  try {
    const v = det.buildExternalVideos([
      { platform: 'bilibili', url: 'https://b23.tv/x', bvid: '' },
      { platform: 'channels', finderUserName: 'sphA1b2', feedId: 'f123456', feedToken: '' },
      { platform: 'channels', finderUserName: 'sphA1b2', feedId: 'f654321', feedToken: 'tok_abcdef' },
      { platform: 'youtube', url: 'https://youtube.com/x' }
    ])
    const same = det.buildExternalVideos([{ platform: 'channels', finderUserName: 'sphA1b2', feedId: 'f777777', sameSubject: true }])
    e1 = v.length === 3 && v[0].label === '哔哩哔哩' && !v[0].embed && !v[1].embed && v[2].embed && same[0].embed && det.buildExternalVideos(null).length === 0
  } catch (e) { e1 = false }
  add('E1 详情页视图模型：只认四个平台；视频号同主体或带 feedToken 才内嵌', e1)
  add('E4 视频号内嵌报错就地降级成卡片，不自动跳离详情页',
    /binderror="onChannelEmbedError"/.test(s.detailWxml) && /onChannelEmbedError\(e\) \{[\s\S]{0,240}\.embed`\]: false/.test(s.detailJs) && !/binderror="openChannelsVideo"/.test(s.detailWxml))
  add('E2 详情页不内嵌外平台网页、不跳外部小程序；B站等卡片走复制链接；视频号内嵌带 feed-token',
    !/<web-view/.test(s.detailWxml) && !/navigateToMiniProgram/.test(s.detailJs) &&
      /bindtap="copyExternalVideo" data-url="\{\{item\.url\}\}"/.test(s.detailWxml) &&
      /<channel-video [^>]*feed-token="\{\{item\.feedToken\}\}"/.test(s.detailWxml) &&
      /wx\.setClipboardData\(\{\s*data: url,/.test(s.detailJs))
  add('E3 详情页视图模型不读 .media（media 归主图轮播）', !/\.media\b/.test(s.detailUtil) && /externalVideos: buildExternalVideos\(data\.externalVideos\),/.test(s.detailJs))

  // F
  add('F1 cloudbase/schema/products.md 登记 externalVideos', /\| `externalVideos` \|/.test(s.schema))
  return out
}

const INJ = [
  ['净化放过 http 链接', 'srvExt', (t) => t.replace("/https:\\/\\/[^\\s\"'<>，。]+/i", "/https?:\\/\\/[^\\s\"'<>，。]+/i").replace(".replace(/^https:\\/\\//i, '')", ".replace(/^https?:\\/\\//i, '')")],
  ['平台域名改成包含匹配（仿冒域名过关）', 'srvExt', (t) => t.replace("host === h || host.endsWith(`.${h}`)", 'host.includes(h)')],
  ['视频号不校验 sph ID', 'srvExt', (t) => t.replace('if (!FINDER_RE.test(finderUserName) || ', 'if (')],
  ['白名单漏登记 externalVideos', 'srvIndex', (t) => t.replace("  'externalVideos',\n", '')],
  ['ERP 条数常量与服务端不一致', 'adminUtil', (t) => t.replace('export const MAX_EXTERNAL = 3', 'export const MAX_EXTERNAL = 5')],
  ['ERP media 时长上限漂移', 'adminUtil', (t) => t.replace('export const MAX_VIDEO_SECONDS = 60', 'export const MAX_VIDEO_SECONDS = 90')],
  ['ERP 每次保存都送 media（会清掉店长传的视频）', 'adminApp', (t) => t.replace('...((form.value.media || []).length || form.value.mediaOrigCount ? { media: toPayloadMedia(form.value.media) } : {}),', 'media: toPayloadMedia(form.value.media),')],
  ['店长端开始送 externalVideos', 'manager', (t) => t + '\n// externalVideos: []\n'],
  ['详情页视频号无 token 也内嵌', 'detailUtil', (t) => t.replace("embed: v.platform === 'channels' && !!(v.feedToken || v.sameSubject)", "embed: v.platform === 'channels'")],
  ['详情页改用 web-view 打开 B站', 'detailWxml', (t) => t.replace('<view class="films">', '<view class="films"><web-view src="https://www.bilibili.com"></web-view>')],
  ['视频号内嵌报错改成自动跳走', 'detailWxml', (t) => t.replace('binderror="onChannelEmbedError" data-index="{{index}}"', 'binderror="openChannelsVideo" data-index="{{index}}"')],
  ['schema 漏登记', 'schema', (t) => t.replace('| `externalVideos` |', '| `extVideos` |')]
]

const report = (list) => { list.forEach((c) => console.log(`${c.ok ? '✓' : '✗'} ${c.name}`)); return list.every((c) => c.ok) }

if (process.argv.includes('--selftest')) {
  const base = readAll()
  const baseOk = (await checks(base)).every((c) => c.ok)
  let ok = baseOk
  console.log(`${baseOk ? '✓' : '✗'} 基线：真源码全部断言通过`)
  for (const [name, key, fn] of INJ) {
    const mutated = { ...base, [key]: fn(base[key]) }
    if (mutated[key] === base[key]) { console.log(`✗ 注入锚点失效：${name}`); ok = false; continue }
    const red = (await checks(mutated)).some((c) => !c.ok)
    console.log(`${red ? '✓' : '✗'} 注入「${name}」→ ${red ? '被检出' : '未检出'}`)
    if (!red) ok = false
  }
  console.log(ok ? '✓ selftest 通过' : '✗ selftest 失败')
  process.exit(ok ? 0 : 1)
}
const ok = report(await checks(readAll()))
console.log(ok ? '✓ 藏品外平台视频 / ERP 录入断言全部通过' : '✗ 藏品外平台视频 / ERP 录入断言失败（见上）')
process.exit(ok ? 0 : 1)
