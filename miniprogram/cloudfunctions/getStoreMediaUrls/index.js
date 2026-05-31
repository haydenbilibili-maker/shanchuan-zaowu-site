const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

/**
 * 服务端批量换取云存储临时 HTTPS 链接（解决客户端 STORAGE_EXCEED_AUTHORITY）
 * event.fileList: string[] cloud:// fileID 列表
 */
exports.main = async (event) => {
  const fileList = [...new Set((event.fileList || []).filter((id) => id && String(id).startsWith('cloud://')))]
  const urlMap = {}
  if (!fileList.length) {
    return { success: true, urlMap }
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

  return { success: true, urlMap }
}
