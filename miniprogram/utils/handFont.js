/**
 * 手写体（网络字体）加载器 —— iOS 上系统字体栈取不到手写族，必须走 wx.loadFontFace
 *
 * 背景（2026-09-19 真机实测）：
 *   之前用系统字体栈 `"HanziPen SC", "Hannotate SC", "STKaiti", …` 在 **iOS 真机一律落回系统默认字体**
 *   （祈福墙与礼赠卡同样失灵 → 证明不是某页写错，而是 iOS 的 WeChat WebView 不向网页暴露这些中文族）。
 *   唯一可靠解：`wx.loadFontFace` 加载**网络字体**，并注册成一个自定义族名（下面 FONT_FAMILY）供 WXSS 使用。
 *
 * 字体：马善政毛笔楷书（Ma Shan Zheng，Google Fonts，**OFL 1.1 → 可商用**）
 *   已裁剪到 GB2312 全集 + ASCII/标点（覆盖日常 ~99.9%），转 WOFF2 后 3.08 MB，托管在 CloudBase（**不进包体**）。
 *
 * 关键参数（缺一不可）：
 *   - `global: true`      ：全局生效，页面无需各自注册；
 *   - `scopes: ['webview','native']`：**让 <text> 等原生层也用上**（默认只管 webview，iOS 上会看不到效果）。
 *
 * 用法：app.js onLaunch 调用 ensureHandFont()；WXSS 里写 font-family: 'ShanhaiHand', <系统兜底>。
 */
const FONT_FILE_ID = 'cloud://cloud1-8gnkty5bfff9f0bf.636c-cloud1-8gnkty5bfff9f0bf-1387508856/fonts/ShanhaiHand.woff2'
const FONT_HTTPS = 'https://636c-cloud1-8gnkty5bfff9f0bf-1387508856.tcb.qcloud.la/fonts/ShanhaiHand.woff2'
const FONT_FAMILY = 'ShanhaiHand'

let loaded = false
let inflight = null

function tryLoad(src, label) {
  return new Promise((resolve) => {
    wx.loadFontFace({
      family: FONT_FAMILY,
      source: 'url("' + src + '")',
      global: true,
      scopes: ['webview', 'native'],
      success: () => { loaded = true; console.log('[handFont] loaded via ' + label); resolve(true) },
      fail: (err) => {
        console.warn('[handFont] fail via ' + label + ':', (err && err.errMsg) || err)
        resolve(false)
      }
    })
  })
}

function downloadViaCloud() {
  return new Promise((resolve) => {
    try {
      wx.cloud.downloadFile({
        fileID: FONT_FILE_ID,
        success: (r) => resolve((r && r.tempFilePath) || ''),
        fail: () => resolve('')
      })
    } catch (e) { resolve('') }
  })
}

/**
 * 按**多源链**逐个尝试，任一成功即止（幂等、并发合并）。
 *
 * ⚠️ 教训（2026-09-19 真机）：`wx.loadFontFace` 的 source **只接受网络 URL**（https），
 *   传 `wxfile://` 本地路径**不生效** ✗ —— 我最初的实现是「downloadFile 成功 → 用本地路径」，
 *   且该分支失败后**没有再试 https** ✗ → 字体永远加载不上。
 *   现在：**https（公开可读，实测 HTTP 200）优先** → cloud 下载（取临时网络路径用不了，仅作探测）
 *   → 1.5s 后整体重试一次。
 */
function ensureHandFont() {
  if (loaded) return Promise.resolve(true)
  if (inflight) return inflight
  inflight = (async () => {
    // ① 静态 https（实测公开可读；不依赖 cloud.init）
    if (await tryLoad(FONT_HTTPS, 'https')) return true
    // ② 试一次云下载（若失败仅说明云侧不可用，不再用其本地路径 —— loadFontFace 不接受本地路径）
    const local = await downloadViaCloud()
    console.log('[handFont] cloud downloadFile ->', local ? 'ok(但本地路径不可用于 loadFontFace)' : 'failed')
    // ③ 整体重试一次（网络抖动 / 首次启动）
    await new Promise((r) => setTimeout(r, 1500))
    if (await tryLoad(FONT_HTTPS, 'https-retry')) return true
    console.warn('[handFont] 全部来源失败：请在 miniprogram 后台把 636c-cloud1-8gnkty5bfff9f0bf-1387508856.tcb.qcloud.la 加入 downloadFile 合法域名')
    return false
  })()
  return inflight
}

module.exports = { ensureHandFont, FONT_FAMILY, FONT_FILE_ID, FONT_HTTPS }
