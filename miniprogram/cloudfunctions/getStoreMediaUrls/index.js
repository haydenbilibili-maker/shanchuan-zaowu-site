const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

/**
 * 服务端批量换取云存储临时 HTTPS 链接（解决客户端 STORAGE_EXCEED_AUTHORITY）
 * event.fileList: string[] cloud:// fileID 列表
 */
/**
 * 允许换取临时链接的公开内容目录。
 *
 * 背景：本函数以管理员权限把 cloud:// 换成可下载 URL。若不加限制，
 * 任何登录用户只要拿到他人订单/售后的凭证 fileID（例如通过读 orders 集合），
 * 就能把私密图片转成公开链接。这里只放行 C 端公开展示用的目录。
 */
const ALLOWED_PUBLIC_PREFIXES = [
  'stores/',
  'banners/',
  'categories/',
  'activities/',
  'framers/',
  'cms/',
  'articles/'
]

/** 取 fileID 的环境前缀之后的相对路径，例如 cloud://env.xxx/stores/a.png → stores/a.png */
function relativePath(fileID) {
  const m = String(fileID || '').match(/^cloud:\/\/[^/]+\/(.+)$/)
  return m ? m[1] : ''
}

exports.main = async (event) => {
  const requested = [...new Set((event.fileList || []).filter((id) => id && String(id).startsWith('cloud://')))]
  const fileList = requested.filter((id) => {
    const rel = relativePath(id)
    return !!rel && ALLOWED_PUBLIC_PREFIXES.some((p) => rel.startsWith(p))
  })
  const rejected = requested.length - fileList.length
  const urlMap = {}
  if (!fileList.length) {
    return { success: true, urlMap, rejected }
  }

  for (let i = 0; i < fileList.length; i += 50) {
    const chunk = fileList.slice(i, i + 50)
    try {
      const res = await cloud.getTempFileURL({ fileList: chunk })
      ;(res.fileList || []).forEach((item) => {
        if (item.fileID && item.tempFileURL) {
          urlMap[item.fileID] = item.tempFileURL
        }
      })
    } catch (e) {
      console.warn('getStoreMediaUrls chunk failed', e.message)
    }
  }

  return { success: true, urlMap, rejected }
}
