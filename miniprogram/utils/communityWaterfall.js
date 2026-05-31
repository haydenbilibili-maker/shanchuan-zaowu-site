/** 社区瀑布流：按预估高度分配到左右列 */
const RATIOS = ['ratio-tall', 'ratio-square', 'ratio-wide']
const RATIO_HEIGHT = { 'ratio-tall': 1.35, 'ratio-square': 1, 'ratio-wide': 0.82 }

function ratioFor(index) {
  return RATIOS[index % RATIOS.length]
}

function estimateCardHeight(item, index) {
  const ratio = RATIO_HEIGHT[ratioFor(index)] || 1
  const titleLen = (item.title || '').length
  const titleLines = Math.min(2, Math.ceil(titleLen / 14))
  return ratio * 100 + titleLines * 24 + 48
}

function splitWaterfall(items) {
  const list = items || []
  const leftCol = []
  const rightCol = []
  let leftH = 0
  let rightH = 0

  list.forEach((item, index) => {
    const card = {
      ...item,
      cardRatio: ratioFor(index)
    }
    const h = estimateCardHeight(item, index)
    if (leftH <= rightH) {
      leftCol.push(card)
      leftH += h
    } else {
      rightCol.push(card)
      rightH += h
    }
  })

  return { leftCol, rightCol }
}

module.exports = {
  splitWaterfall,
  ratioFor
}
