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

function loadFrom(src, resolve) {
  wx.loadFontFace({
    family: FONT_FAMILY,
    source: 'url("' + src + '")',
    global: true,
    scopes: ['webview', 'native'],
    success: () => { loaded = true; resolve(true) },
    fail: (err) => {
      console.warn('[handFont] loadFontFace failed:', src.slice(0, 48), err && err.errMsg)
      resolve(false)
    }
  })
}

/**
 * 确保手写体已加载（幂等、并发合并）。
 * 优先走 `wx.cloud.downloadFile` 取本地临时文件 —— **cloud API 不受 downloadFile 合法域名限制**；
 * 失败再兜底用静态 https（该路径需要在小程序后台把 tcb.qcloud.la 加入 downloadFile 白名单）。
 * @returns {Promise<boolean>} 是否加载成功（失败不抛错，页面按系统兜底字体渲染即可）
 */
function ensureHandFont() {
  if (loaded) return Promise.resolve(true)
  if (inflight) return inflight
  inflight = new Promise((resolve) => {
    try {
      wx.cloud.downloadFile({
        fileID: FONT_FILE_ID,
        success: (r) => loadFrom((r && r.tempFilePath) || FONT_HTTPS, resolve),
        fail: () => loadFrom(FONT_HTTPS, resolve)
      })
    } catch (e) {
      loadFrom(FONT_HTTPS, resolve)
    }
  })
  return inflight
}

module.exports = { ensureHandFont, FONT_FAMILY, FONT_FILE_ID, FONT_HTTPS }
