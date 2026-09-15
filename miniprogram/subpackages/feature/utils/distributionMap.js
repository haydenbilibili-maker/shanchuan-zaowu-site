/**
 * 从分布文字或区域列表解析地图标注（不请求用户定位）
 * 仅使用静态地理中心点，供 <map> 展示概略分布
 */

const REGION_COORDS = {
  北京: { latitude: 39.904, longitude: 116.407 },
  天津: { latitude: 39.084, longitude: 117.199 },
  河北: { latitude: 38.042, longitude: 114.514 },
  山西: { latitude: 37.873, longitude: 112.562 },
  内蒙古: { latitude: 40.817, longitude: 111.765 },
  辽宁: { latitude: 41.836, longitude: 123.431 },
  吉林: { latitude: 43.898, longitude: 125.325 },
  黑龙江: { latitude: 45.803, longitude: 126.535 },
  上海: { latitude: 31.230, longitude: 121.474 },
  江苏: { latitude: 32.061, longitude: 118.796 },
  浙江: { latitude: 30.274, longitude: 120.155 },
  安徽: { latitude: 31.861, longitude: 117.285 },
  福建: { latitude: 26.074, longitude: 119.296 },
  江西: { latitude: 28.682, longitude: 115.858 },
  山东: { latitude: 36.651, longitude: 117.120 },
  河南: { latitude: 34.746, longitude: 113.625 },
  湖北: { latitude: 30.593, longitude: 114.305 },
  湖南: { latitude: 28.228, longitude: 112.938 },
  广东: { latitude: 23.129, longitude: 113.264 },
  广西: { latitude: 22.817, longitude: 108.366 },
  海南: { latitude: 20.044, longitude: 110.199 },
  重庆: { latitude: 29.563, longitude: 106.551 },
  四川: { latitude: 30.572, longitude: 104.066 },
  贵州: { latitude: 26.647, longitude: 106.630 },
  云南: { latitude: 25.045, longitude: 102.710 },
  西藏: { latitude: 29.652, longitude: 91.172 },
  陕西: { latitude: 34.341, longitude: 108.940 },
  甘肃: { latitude: 36.061, longitude: 103.834 },
  青海: { latitude: 36.623, longitude: 101.780 },
  宁夏: { latitude: 38.487, longitude: 106.230 },
  新疆: { latitude: 43.793, longitude: 87.627 },
  台湾: { latitude: 25.033, longitude: 121.565 },
  香港: { latitude: 22.319, longitude: 114.169 },
  澳门: { latitude: 22.198, longitude: 113.544 },
  中国: { latitude: 35.861, longitude: 104.195 },
  华南: { latitude: 23.5, longitude: 113.5 },
  华东: { latitude: 31.0, longitude: 120.0 },
  华北: { latitude: 39.5, longitude: 116.5 },
  西南: { latitude: 28.0, longitude: 102.0 },
  西北: { latitude: 36.0, longitude: 96.0 },
  东北: { latitude: 43.5, longitude: 126.5 },
  东南亚: { latitude: 10.0, longitude: 106.0 },
  南亚: { latitude: 22.0, longitude: 78.0 },
  东亚: { latitude: 35.0, longitude: 120.0 },
  中亚: { latitude: 42.0, longitude: 65.0 },
  欧洲: { latitude: 50.0, longitude: 10.0 },
  非洲: { latitude: 0.0, longitude: 20.0 },
  北美: { latitude: 45.0, longitude: -100.0 },
  北美洲: { latitude: 45.0, longitude: -100.0 },
  南美: { latitude: -10.0, longitude: -55.0 },
  南美洲: { latitude: -10.0, longitude: -55.0 },
  中美洲: { latitude: 15.0, longitude: -90.0 },
  大洋洲: { latitude: -25.0, longitude: 135.0 },
  澳大利亚: { latitude: -25.0, longitude: 133.0 },
  亚马逊: { latitude: -3.0, longitude: -62.0 },
  热带雨林: { latitude: -2.0, longitude: -60.0 },
  全球: { latitude: 20.0, longitude: 0.0 },
   worldwide: { latitude: 20.0, longitude: 0.0 }
}

const REGION_ALIASES = {
  北京市: '北京',
  天津市: '天津',
  上海市: '上海',
  重庆市: '重庆',
  内蒙古自治区: '内蒙古',
  广西壮族自治区: '广西',
  西藏自治区: '西藏',
  宁夏回族自治区: '宁夏',
  新疆维吾尔自治区: '新疆',
  香港特别行政区: '香港',
  澳门特别行政区: '澳门'
}

function normalizeRegionName(name) {
  const t = String(name || '').trim()
  if (!t) return ''
  if (REGION_ALIASES[t]) return REGION_ALIASES[t]
  if (REGION_COORDS[t]) return t
  const short = t.replace(/(省|市|自治区|特别行政区|壮族|维吾尔|回族)/g, '')
  if (REGION_COORDS[short]) return short
  return t
}

function parseRegionsFromText(text) {
  const s = String(text || '').trim()
  if (!s) return []
  const found = []
  const keys = Object.keys(REGION_COORDS).sort((a, b) => b.length - a.length)
  keys.forEach((key) => {
    if (s.indexOf(key) !== -1 && found.indexOf(key) === -1) {
      found.push(key)
    }
  })
  return found
}

function parseRegionsFromGeo(geo) {
  if (!geo) return []
  if (Array.isArray(geo)) {
    return geo
      .map((item) => {
        if (typeof item === 'string') return normalizeRegionName(item)
        if (item && typeof item === 'object') {
          return normalizeRegionName(item.name || item.region || item.province || item.label || '')
        }
        return ''
      })
      .filter(Boolean)
  }
  if (typeof geo === 'object') {
    const list = geo.regions || geo.provinces || geo.areas || geo.names
    if (Array.isArray(list)) return parseRegionsFromGeo(list)
  }
  return []
}

function buildMapState({ distributionText, geo, regions }) {
  let regionNames = []
  if (Array.isArray(regions) && regions.length) {
    regionNames = regions.map(normalizeRegionName).filter(Boolean)
  }
  if (!regionNames.length && geo) {
    regionNames = parseRegionsFromGeo(geo)
  }
  if (!regionNames.length && distributionText) {
    regionNames = parseRegionsFromText(distributionText)
  }

  const unique = []
  regionNames.forEach((name) => {
    const key = normalizeRegionName(name)
    if (key && unique.indexOf(key) === -1) unique.push(key)
  })

  const markers = unique
    .map((name, index) => {
      const coord = REGION_COORDS[name]
      if (!coord) return null
      return {
        id: index + 1,
        latitude: coord.latitude,
        longitude: coord.longitude,
        width: 24,
        height: 24,
        label: {
          content: name.length > 4 ? name.slice(0, 4) : name,
          color: '#C4A76C',
          fontSize: 10,
          anchorX: 0,
          anchorY: -4,
          borderWidth: 0,
          bgColor: 'transparent'
        }
      }
    })
    .filter(Boolean)

  if (!markers.length) {
    return {
      hasMap: false,
      mapCenter: { latitude: 30.0, longitude: 105.0 },
      mapScale: 4,
      mapMarkers: [],
      mapPlaceholder: distributionText ? '分布图待著录' : '暂未著录分布坐标'
    }
  }

  const latSum = markers.reduce((s, m) => s + m.latitude, 0)
  const lngSum = markers.reduce((s, m) => s + m.longitude, 0)
  const scale = markers.length === 1 ? 6 : markers.length <= 3 ? 5 : 4

  return {
    hasMap: true,
    mapCenter: {
      latitude: latSum / markers.length,
      longitude: lngSum / markers.length
    },
    mapScale: scale,
    mapMarkers: markers,
    mapPlaceholder: ''
  }
}

module.exports = {
  buildMapState,
  parseRegionsFromText,
  REGION_COORDS
}
