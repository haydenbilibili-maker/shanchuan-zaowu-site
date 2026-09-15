/**
 * 微信云开发环境配置（唯一维护点）
 *
 * 续费 / 换环境后请在微信开发者工具 → 云开发 确认环境 ID，
 * 并同步更新下方 CLOUD_ENV 与 CLOUD_BUCKET_SUFFIX。
 * bucket 后缀可在：云开发控制台 → 存储 → 任意文件 → fileID 中查看
 * 格式：cloud://{CLOUD_ENV}.{CLOUD_BUCKET_SUFFIX}/path
 */
const CLOUD_ENV = 'cloud1-8gnkty5bfff9f0bf'
const CLOUD_BUCKET_SUFFIX = '636c-cloud1-8gnkty5bfff9f0bf-1387508856'
const CLOUD_FILE_ID_PREFIX = `cloud://${CLOUD_ENV}.${CLOUD_BUCKET_SUFFIX}`

function cdnPath(relativePath) {
  return `${CLOUD_FILE_ID_PREFIX}/${String(relativePath).replace(/^\//, '')}`
}

module.exports = {
  CLOUD_ENV,
  CLOUD_BUCKET_SUFFIX,
  CLOUD_FILE_ID_PREFIX,
  cdnPath
}
