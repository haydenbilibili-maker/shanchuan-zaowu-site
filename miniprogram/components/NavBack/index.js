/**
 * Museum Mode 统一回退按钮
 * 主样式：黄铜圆环 + 左箭头（assets/icons/nav-back-brass.png）
 * 热区默认 ≥72rpx；不改动页面返回逻辑，仅触发 back / tap 事件。
 */
Component({
  options: {
    virtualHost: false,
    styleIsolation: 'apply-shared'
  },

  externalClasses: ['ext-class'],

  properties: {
    /** 旁注文字，如店长工作台「看板」 */
    label: {
      type: String,
      value: ''
    },
    /** 可选：覆盖默认 icon 路径 */
    src: {
      type: String,
      value: '/assets/icons/nav-back-brass.png'
    },
    /** 绝对定位等场景的内联样式透传 */
    customStyle: {
      type: String,
      value: ''
    },
    /** 无障碍文案 */
    ariaLabel: {
      type: String,
      value: '返回'
    }
  },

  data: {
    iconBroken: false
  },

  methods: {
    onTap() {
      this.triggerEvent('back')
      this.triggerEvent('tap')
    },
    /** 图标加载失败时降级为文字箭头，避免返回入口变成不可见热区 */
    onIconError() {
      if (!this.data.iconBroken) this.setData({ iconBroken: true })
    }
  }
})
