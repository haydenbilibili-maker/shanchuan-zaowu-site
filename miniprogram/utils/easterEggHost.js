const easterEgg = require('./easterEgg')

module.exports = Behavior({
  methods: {
    onEasterEggLongPress(e) {
      const dataset = (e.currentTarget && e.currentTarget.dataset) || {}
      const id = dataset.eggId || dataset.eggid || ''
      if (!id) return
      easterEgg.markTapGuard(this)
      easterEgg.tryTrigger(id, { source: 'longPress', page: this })
    }
  }
})
