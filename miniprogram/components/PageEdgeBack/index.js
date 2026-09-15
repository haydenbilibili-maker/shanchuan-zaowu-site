const {
  edgeTouchStart,
  edgeTouchMove,
  edgeTouchEnd
} = require('../../utils/pageEdgeBack')

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'apply-shared'
  },

  externalClasses: ['ext-class'],

  properties: {
    disabled: {
      type: Boolean,
      value: false
    }
  },

  methods: {
    onEdgeTouchStart(e) {
      if (this.data.disabled) return
      edgeTouchStart(this, e)
    },

    onEdgeTouchMove(e) {
      if (this.data.disabled) return
      edgeTouchMove(this, e, () => {
        this.triggerEvent('back')
      })
    },

    onEdgeTouchEnd() {
      edgeTouchEnd(this)
    },

    onEdgeTouchCancel() {
      edgeTouchEnd(this)
    }
  }
})
