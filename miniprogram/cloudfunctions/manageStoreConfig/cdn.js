/**
 * 云存储 CDN 前缀（与 config/cdn.js / getStoreConfig/cdn.js 保持同步）
 */
const CLOUD_ENV = 'cloud1-8gnkty5bfff9f0bf'
const CLOUD_FILE_ID_PREFIX = `cloud://${CLOUD_ENV}.636c-cloud1-8gnkty5bfff9f0bf-1387508856`

function cdnPath(relativePath) {
  return `${CLOUD_FILE_ID_PREFIX}/${String(relativePath).replace(/^\//, '')}`
}

module.exports = {
  CLOUD_ENV,
  CLOUD_FILE_ID_PREFIX,
  cdnPath
}
