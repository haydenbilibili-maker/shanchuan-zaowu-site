/**
 * 门店模块图片 CDN（与 config/storeMediaCdn.js 保持同步）
 */
const { cdnPath } = require('./cdn')

const SH = 'stores/shanhaizaowu'
const XC = cdnPath('stores/store_xingchen.png')
const SH_COVER = cdnPath('stores/store_shanhaizaowu.png')

function seq(prefix, count) {
  return Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(2, '0')
    return cdnPath(`${SH}/${prefix}-${n}.png`)
  })
}

module.exports = {
  STORE_COVER: {
    store_shanhaizaowu: SH_COVER,
    store_xingchen: XC
  },
  xingchenCover: XC,
  shanhaizaowu: {
    insectCover: cdnPath(`${SH}/insect-cover.png`),
    insectImages: seq('insect', 5),
    mineralCover: cdnPath(`${SH}/mineral-cover.png`),
    mineralImages: seq('mineral', 7),
    plantCover: cdnPath(`${SH}/plant-cover.png`),
    plantImages: seq('plant', 2),
    marineCover: cdnPath(`${SH}/marine-cover.png`),
    marineImages: seq('marine', 8)
  }
}
