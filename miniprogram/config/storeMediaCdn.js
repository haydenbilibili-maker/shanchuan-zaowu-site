/**
 * 门店模块图片 CDN 路径（云存储 stores/ 目录）
 * 本地不再保留源文件，以云存储为唯一图源。
 */
const { cdnPath } = require('./cdn')

const SH = 'stores/shanhaizaowu'
const XC = cdnPath('stores/store_xingchen.png')
/** 这有店 · 山海造物展陈导览页底图（特写空镜） */
const SH_COVER = cdnPath('banners/DSC03847.JPG')

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
