const CLOUD_ENV = 'cloud1-8gnkty5bfff9f0bf'
const CLOUD_FILE_ID_PREFIX = `cloud://${CLOUD_ENV}.636c-cloud1-8gnkty5bfff9f0bf-1387508856`

function cdnPath(relativePath) {
  return `${CLOUD_FILE_ID_PREFIX}/${String(relativePath).replace(/^\//, '')}`
}

const SH = 'stores/shanhaizaowu'

function seq(prefix, count) {
  return Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(2, '0')
    return cdnPath(`${SH}/${prefix}-${n}.png`)
  })
}

const MEDIA = {
  bannerBlue: cdnPath('banners/chris-nguyen-tXmc2mVDxJc-unsplash.jpg'),
  bannerMuseum: cdnPath('banners/__-drz-__-CK7rdTauhDE-unsplash.jpg'),
  // 标本师招募轮播：由 getHomeConfig 幂等种子写入 banners，或 Admin/店长后台配置
  bannerRecruit: cdnPath('banners/d225de57986a74fc592cc876cd09a4df-2524a3ca-bb99-481.png'),
  storeCover: cdnPath('stores/store_shanhaizaowu.png'),
  insectCover: cdnPath(`${SH}/insect-cover.png`),
  insectImages: seq('insect', 5),
  mineralCover: cdnPath(`${SH}/mineral-cover.png`),
  mineralImages: seq('mineral', 7),
  plantCover: cdnPath(`${SH}/plant-cover.png`),
  plantImages: seq('plant', 2),
  marineCover: cdnPath(`${SH}/marine-cover.png`),
  marineImages: seq('marine', 8)
}

module.exports = { cdnPath, MEDIA }
