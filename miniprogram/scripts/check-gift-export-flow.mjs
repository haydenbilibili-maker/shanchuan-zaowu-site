/**
 * 礼笺印刷导出的**交互流程**守卫（域 gift-print）
 *
 * 为什么单独立一条（与 `check:gift-sticker-layout` 分工）：
 *   那条管**版式**（A6/贴纸的几何与不截断）；这条管**导出的交互**。两者都会因真图/真机反馈坏掉，
 *   但坏法不同 —— 版式坏了印出来难看，交互坏了是**印错**（运营一点即存相册并上传，没有回看机会）。
 *
 * 2026-09-19 交互升级后的硬要求（每条都由真实反馈驱动）：
 *   ① **先生成、后动作**：导出只负责生成到预览态，**不得**在导出里直接存相册/上传；
 *   ② 相册被拒必须给**可执行出口**（样式化弹窗 → 去设置 → 授权后自动重试一次），
 *      而不是只弹一句"可检查相册权限"；
 *   ③ 反馈统一走 **AppToast**（非阻塞、主视觉一致）：本页不得出现裸 `wx.showToast`；
 *   ④ **不得新增原生弹窗**（`wx.showModal`）——全站迁移中，`check:dialog-ratchet` 盯着；
 *   ⑤ 导出中两个入口**禁用**（可见进行态 + 防重复点）；
 *   ⑥ 上传失败可**单独重试**，且文件名**可追溯**（orderId + 规格 + 时间戳）并能复制。
 *
 * 用法：
 *   node miniprogram/scripts/check-gift-export-flow.mjs
 *   node miniprogram/scripts/check-gift-export-flow.mjs --selftest
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

let passed = 0
let failed = 0
const failures = []
function check(name, cond, extra) {
  if (cond) passed += 1
  else {
    failed += 1
    failures.push(`${name}${extra ? ' — ' + extra : ''}`)
  }
}
function eq(name, got, want) {
  check(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}

const PAGE = 'miniprogram/subpackages/manager/gift-ops/index'

const INJECTIONS = {
  // 退回"一点即存相册"：运营没机会核对受礼人姓名就印出去了
  'no-preview': {
    file: PAGE + '.js',
    from: "      // ⚠️ 这里**不再**自动存相册/上传：先生成到预览态，由运营看一眼再决定",
    to: "      try { await new Promise((ok, no) => wx.saveImageToPhotosAlbum({ filePath: path, success: ok, fail: no })) } catch (e) {}\n      // 注入：绕过预览直接落盘"
  },
  // 裸 toast 回归：与主视觉不一致，且阻塞
  'bare-toast': {
    file: PAGE + '.js',
    from: "  toast(title, desc, overline) {",
    to: "  toast(title, desc, overline) {\n    wx.showToast({ title: title, icon: 'none' })"
  },
  // 权限被拒只提示、不给出口
  'no-permission-exit': {
    file: PAGE + '.js',
    from: "        const setting = await new Promise((ok) => wx.openSetting({ success: ok, fail: () => ok({ authSetting: {} }) }))",
    to: "        const setting = { authSetting: { 'scope.writePhotosAlbum': true } }"
  },
  // 文件名不可追溯：云存储里一堆同名文件，找不回是哪一单
  'untraceable-filename': {
    file: PAGE + '.js',
    from: 'cloudPath: `gift-print/${pv.fileName}`',
    to: "cloudPath: 'gift-print/latest.png'"
  },
  // 原生弹窗回归（棘轮禁止新增）
  'native-modal': {
    file: PAGE + '.js',
    from: '      const res = await this.modal({',
    to: '      const res = await wx.showModal({ success: () => {} }) && this.modal({'
  }
}

const INJECT = String(process.env.GIFT_EXPORT_INJECT || '').trim()
function readSrc(file) {
  const raw = readFileSync(resolve(ROOT, file), 'utf8')
  if (!INJECT) return raw
  const inj = INJECTIONS[INJECT]
  if (!inj) throw new Error('unknown injection ' + INJECT)
  if (inj.file !== file) return raw
  if (raw.indexOf(inj.from) === -1) throw new Error('injection anchor missing: ' + INJECT)
  return raw.replace(inj.from, inj.to)
}

/** 去掉注释后再做"源码里有没有某调用"的断言（否则注释里的词会假命中/假阴性） */
function stripComments(src) {
  return String(src).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/* ------------------------------------------------------------------ *
 * 装载真实页面 JS（只驱动被测方法；网络/画布/权限全部打桩）
 * ------------------------------------------------------------------ */
function makeHarness() {
  const calls = { save: 0, upload: 0, uploadedPaths: [], openSetting: 0, modal: [], toasts: [], clipboard: [] }
  let saveFailsRemaining = 0
  const page = {
    data: {},
    /**
     * ⚠️ 必须支持 WeChat 的**路径语法**（`'printPreview.saved': true`）。
     * 第一版这里是扁平 `Object.assign` → 把"已置位"的预览状态判成 false（测试台缺陷，不是产品缺陷）。
     */
    setData(patch) {
      Object.keys(patch || {}).forEach((k) => {
        if (k.indexOf('.') === -1) { this.data[k] = patch[k]; return }
        const parts = k.split('.')
        let cur = this.data
        for (let i = 0; i < parts.length - 1; i++) {
          if (cur[parts[i]] == null) cur[parts[i]] = {}
          cur = cur[parts[i]]
        }
        cur[parts[parts.length - 1]] = patch[k]
      })
    }
  }
  const wxStub = {
    cloud: {
      database: () => ({
        collection: () => ({
          doc: () => ({ field: () => ({ get: async () => ({ data: { themeName: '双翼同辉', themeNote: '一对凤蝶并展', images: ['cloud://x/1.png'] } }) }) }),
          where: () => ({ limit: () => ({ field: () => ({ get: async () => ({ data: [{ themeName: '双翼同辉', themeNote: '一对凤蝶并展', images: ['cloud://x/1.png'] }] }) }) }) })
        })
      }),
      callFunction: async () => ({ result: { success: true, cardBody: '祝结婚十周年快乐', cardSignature: '冶禹军', item: { productTitle: '乌桕叶标本' }, productId: 'p1' } }),
      uploadFile: async ({ cloudPath }) => {
        calls.upload += 1
        calls.uploadedPaths.push(cloudPath)
        return { fileID: 'cloud://env/gift-print/x.png' }
      }
    },
    saveImageToPhotosAlbum: ({ success, fail }) => {
      calls.save += 1
      // 只失败前 N 次：真实序列是「首次被拒 → 用户去设置授权 → 自动重试成功」
      if (saveFailsRemaining > 0) {
        saveFailsRemaining -= 1
        fail({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' })
      } else success({})
    },
    openSetting: ({ success }) => { calls.openSetting += 1; success({ authSetting: { 'scope.writePhotosAlbum': true } }) },
    setClipboardData: ({ data, success }) => { calls.clipboard.push(data); success && success({}) },
    showLoading: () => {}, hideLoading: () => {}, vibrateShort: () => {},
    showToast: () => { throw new Error('本页不得使用裸 wx.showToast（应走 AppToast）') },
    showModal: () => { throw new Error('不得新增原生 wx.showModal（dialog-ratchet）') },
    canIUse: () => true, getSystemInfoSync: () => ({ statusBarHeight: 20 })
  }
  const stubModules = {
    'utils/giftShareCard': { renderGiftPrintImage: async () => '/tmp/sticker.png' },
    'utils/staffAuth': { guardStaffPage: () => true, goStaffConsole: () => {} },
    'utils/memberScan': { formatCloudFnError: (e) => String((e && e.message) || e) },
    'utils/appModal': { withAppModal: (cfg) => cfg }
  }
  const src = readSrc(PAGE + '.js')
  const captured = { config: null }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', 'Page', 'wx', 'getApp', 'Behavior', src)(
    { exports: {} },
    {},
    (id) => {
      const key = String(id)
      for (const frag of Object.keys(stubModules)) if (key.includes(frag)) return stubModules[frag]
      throw new Error('unstubbed require ' + key)
    },
    (cfg) => { captured.config = cfg },
    wxStub,
    () => ({ globalData: {} }),
    (cfg) => cfg
  )
  const proto = captured.config
  if (!proto) throw new Error('未捕获到 Page 配置')
  const pathSetData = page.setData.bind(page)
  Object.assign(page, proto)
  page.setData = pathSetData
  page.data = Object.assign({}, proto.data)
  page._exportingCard = false
  // `this.modal` 由 withAppModal 提供；测试里换成间谍并默认"点了去设置"
  page.modal = async (o) => { calls.modal.push(o || {}); return { confirm: true, cancel: false } }
  return { page, calls, wxStub, failSaves: (n) => { saveFailsRemaining = Number(n) || 0 } }
}

/* ------------------------------------------------------------------ *
 * A) 行为：先生成到预览，绝不在导出里存/传
 * ------------------------------------------------------------------ */
{
  const h = makeHarness()
  await h.page.onExportGiftSticker({ currentTarget: { dataset: { id: 'ord1' } } })
  const pv = h.page.data.printPreview
  check('★ 贴纸导出后进入**预览态**（不再盲存盲传）', !!pv, JSON.stringify(pv && pv.spec))
  eq('规格是 sticker', pv && pv.spec, 'sticker')
  check('预览写明了规格与尺寸（运营能核对是不是要的那一版）', /90×110mm/.test((pv && pv.specLabel) || ''), pv && pv.specLabel)
  eq('★ 导出过程**没有**写相册', h.calls.save, 0)
  eq('★ 导出过程**没有**上传云端', h.calls.upload, 0)
  check('文件名可追溯（orderId + 规格 + 时间戳）', /^ord1-sticker-\d+\.png$/.test(pv.fileName), pv.fileName)
  eq('导出中标记已复位（按钮可再点）', h.page.data.exporting, false)

  // 保存到相册（成功）
  await h.page.savePrintToAlbum()
  eq('保存后计数 1', h.calls.save, 1)
  eq('★ 保存成功后回到"已存相册"状态', h.page.data.printPreview.saved, true)
  eq('提示走 AppToast（toastShow 被置位）', h.page.data.toastShow, true)
  eq('没有用到原生弹窗', h.calls.modal.length, 0)

  // 上传（失败 → 可重试；成功 → 记录可追溯）
  await h.page.uploadPrintFile()
  eq('上传 1 次', h.calls.upload, 1)
  eq('★ 云路径 = gift-print/<可追溯文件名>', h.calls.uploadedPaths[0], `gift-print/${pv.fileName}`)
  eq('★ 记入「最近导出」（可追溯）', (h.page.data.recentPrints[0] || {}).fileName, pv.fileName)
  eq('上传成功后状态置位', h.page.data.printPreview.uploaded, true)

  await h.page.closePrintPreview()
  eq('关闭预览后清空预览态', h.page.data.printPreview, null)
}

/* ------------------------------------------------------------------ *
 * B) 行为：相册被拒 → 样式化弹窗给「去设置」→ 授权后自动重试
 * ------------------------------------------------------------------ */
{
  const h = makeHarness()
  h.failSaves(1)   // 首次被拒，授权后重试应成功
  await h.page.onExportGiftCard({ currentTarget: { dataset: { id: 'ord2' } } })
  const pv = h.page.data.printPreview
  eq('A6 规格', pv && pv.spec, 'a6')
  check('A6 预览写明 105×148mm（运营能核对规格）', /105×148mm/.test(pv.specLabel), pv.specLabel)
  await h.page.savePrintToAlbum()
  eq('★ 权限被拒时弹出**可执行**出口（弹窗被调用）', h.calls.modal.length, 1)
  eq('弹窗的确认文案是「去设置」', (h.calls.modal[0] || {}).confirmText, '去设置')
  eq('★ 授权后自动重试了一次保存', h.calls.save, 2)
  eq('★ 重试成功后状态为已存', h.page.data.printPreview.saved, true)
  eq('打开设置页被调用', h.calls.openSetting, 1)
}

/* ------------------------------------------------------------------ *
 * C) 行为：上传失败不让状态说谎，且可再试
 * ------------------------------------------------------------------ */
{
  const h = makeHarness()
  h.wxStub.cloud.uploadFile = async () => { throw new Error('network down') }
  await h.page.onExportGiftSticker({ currentTarget: { dataset: { id: 'ord3' } } })
  await h.page.uploadPrintFile()
  eq('上传失败后 uploaded 保持 false（不说谎）', h.page.data.printPreview.uploaded, false)
  eq('上传失败后 uploading 复位（按钮可再点）', h.page.data.printPreview.uploading, false)
  eq('失败没有记进「最近导出」', h.page.data.recentPrints.length, 0)
  eq('预览仍在（可重试/可保存）', !!h.page.data.printPreview, true)
}

/* ------------------------------------------------------------------ *
 * D) 结构：反馈组件与"不得新增原生弹窗/toast"
 * ------------------------------------------------------------------ */
{
  const js = readSrc(PAGE + '.js')
  const code = stripComments(js)
  const wxml = readSrc(PAGE + '.wxml')
  const json = JSON.parse(readSrc(PAGE + '.json'))
  check('★ 本页不得出现裸 wx.showToast（统一 AppToast）', !/wx\.showToast\s*\(/.test(code))
  check('★ 本页不得新增原生 wx.showModal（dialog-ratchet）', !/wx\.showModal\s*\(/.test(code))
  eq('注册了 AppToast', (json.usingComponents || {})['app-toast'], '/components/AppToast/index')
  eq('注册了 AppModal', (json.usingComponents || {})['app-modal'], '/components/AppModal/index')
  check('挂载了 AppToast 且接 close 事件', /<app-toast[\s\S]{0,200}?bind:close="onToastClose"/.test(wxml))
  check('挂载了样式化弹窗宿主（否则权限出口会退回系统弹窗）', /<app-modal id="appModal"\s*\/>/.test(wxml))
  check('预览层存在且绑定 printPreview', /wx:if="\{\{printPreview\}\}"/.test(wxml) && /printPreview\.path/.test(wxml))
  check('预览层有「保存到相册」与「上传印刷文件」两个动作', /catchtap="savePrintToAlbum"/.test(wxml) && /catchtap="uploadPrintFile"/.test(wxml))
  check('导出中两个入口都带禁用态 is-off', (wxml.match(/mini-btn \{\{exporting \? 'is-off'/g) || []).length >= 2)
  check('导出入口都带尺寸副标题（礼笺图 vs 贴纸图要一眼可分）',
    /A6 105×148mm/.test(wxml) && /贴纸 90×110mm/.test(wxml))
  check('文件名可复制（长按）', /bindlongpress="copyPrintFileName"/.test(wxml) && /copyPrintFileName\s*\(/.test(code))
  check('「最近导出」区块存在', /recentPrints/.test(wxml) && /recentPrints: \[\]/.test(code))
}

/* ------------------------------------------------------------------ */

if (process.argv.includes('--selftest') && !INJECT) {
  const { spawnSync } = await import('node:child_process')
  let bad = 0
  for (const name of Object.keys(INJECTIONS)) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, GIFT_EXPORT_INJECT: name },
      encoding: 'utf8'
    })
    if (run.status !== 0) console.log(`  ✓ 注入 ${name} 被检出`)
    else {
      bad += 1
      console.error(`  ✗ 注入 ${name} 未被检出（断言不会失败 = 守卫无效）`)
    }
  }
  const clean = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
  if (clean.status !== 0) {
    bad += 1
    console.error('  ✗ 未注入时本应通过，实际失败：')
    const lines = `${clean.stdout || ''}\n${clean.stderr || ''}`.split('\n').filter((l) => l.includes('✗')).slice(0, 6)
    console.error(lines.length ? lines.map((l) => '    ' + l.trim()).join('\n') : (clean.stdout || clean.stderr))
  } else {
    console.log('  ✓ 未注入时通过（无假阳性）')
  }
  if (bad) {
    console.error(`\n✗ selftest 失败 ${bad} 项`)
    process.exit(1)
  }
  console.log(`\n✓ selftest 通过：${Object.keys(INJECTIONS).length} 个回归注入全部被检出，且无假阳性`)
  process.exit(0)
}

console.log(`\n礼笺导出交互断言：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 导出交互通过（先生成预览后动作 / 权限被拒给出口 / 提示统一 AppToast / 可追溯可重试）')
