/**
 * 定制装裱 AR / 静态预览 — 框型视觉映射
 */
const FRAME_STYLES = {
  frame_wood_classic: {
    className: 'frame-wood',
    label: '经典木框',
    borderColor: '#8B6F47',
    matColor: '#F2EDE4',
    borderWidth: 14,
    matPadding: 12
  },
  frame_metal_slim: {
    className: 'frame-metal',
    label: '窄边金属框',
    borderColor: '#C4A76C',
    matColor: '#1F1D1A',
    borderWidth: 6,
    matPadding: 8
  },
  frame_museum: {
    className: 'frame-museum',
    label: '博物馆复刻框',
    borderColor: '#6B5A24',
    matColor: '#FAF6ED',
    borderWidth: 22,
    matPadding: 16
  }
}

const DEFAULT_FRAME_ID = 'frame_wood_classic'

function getFrameStyle(frameId) {
  return FRAME_STYLES[frameId] || FRAME_STYLES[DEFAULT_FRAME_ID]
}

function getFrameOptions() {
  return Object.keys(FRAME_STYLES).map((id) => ({
    id,
    name: FRAME_STYLES[id].label,
    className: FRAME_STYLES[id].className
  }))
}

module.exports = {
  FRAME_STYLES,
  DEFAULT_FRAME_ID,
  getFrameStyle,
  getFrameOptions
}
