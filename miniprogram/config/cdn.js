/**
 * 云存储 CDN 前缀（与 config/cloudEnv.js 保持一致）
 */
const { CLOUD_ENV, CLOUD_FILE_ID_PREFIX, cdnPath } = require('./cloudEnv')

/** 标本师招募轮播 / 详情 hero（云存储 fileID，勿再打进主包） */
const FRAMER_RECRUIT_BANNER_FILE_ID = cdnPath(
  'banners/d225de57986a74fc592cc876cd09a4df-2524a3ca-bb99-481.png'
)

module.exports = {
  CLOUD_ENV,
  CLOUD_FILE_ID_PREFIX,
  cdnPath,
  FRAMER_RECRUIT_BANNER_FILE_ID
}
