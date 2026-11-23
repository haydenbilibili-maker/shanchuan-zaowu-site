/**
 * <shan-img> 全站远程图片（2026-11-23，产品负责人「图片是小程序非常重要的要素……全局图片展示 / 样式 / 交互 / 清晰度多轮优化」）
 *
 * 一处统一三件事（原来散在 200 处 <image> 上，各写各的，多数一件都没有）：
 *   1. 加载中：暖色深底 + 淡「山海」方印，不再是一块与页面同色的空洞；
 *   2. 加载完：0.32s 淡入（不再「啪」地跳出来）；系统开「减少动态效果」时直接出；
 *   3. 加载失败：留着底与方印（不出破图），并通知 utils/imageUrl 回落原图（与各页原 binderror 同一个调用）。
 *
 * 用法与 <image> 一样：尺寸 / 圆角 / 滤镜写在页面自己的 class 上，经 ext-class 落到外框：
 *   <shan-img ext-class="op-img" src="{{item.image}}" mode="aspectFill" />
 * 只支持定框模式（aspectFill / aspectFit / scaleToFill / 九宫裁切类）；widthFix / heightFix 由图片自身撑高，仍用原生 <image>。
 * 透传 load / error 事件（detail 与原生一致），页面原有 binderror 逻辑可挂在 bind:error 上。
 */
Component({
  externalClasses: ['ext-class'],
  properties: {
    src: { type: String, value: '' },
    mode: { type: String, value: 'aspectFill' },
    /** 懒加载：默认开（首屏首图可传 false） */
    lazy: { type: Boolean, value: true },
    /** 加载中 / 失败时的淡「山海」方印；小于 ~64rpx 的缩略图建议关 */
    mark: { type: Boolean, value: true },
    /** 长按识别（小程序码等）透传 */
    showMenuByLongpress: { type: Boolean, value: false }
  },
  data: {
    loaded: false,
    failed: false
  },
  observers: {
    src(next) {
      // 同一实例换图（翻页 / 轮播复用）：回到加载中，不让旧图的「已加载」状态带过去
      if (next !== this._lastSrc) {
        this._lastSrc = next
        if (this.data.loaded || this.data.failed) this.setData({ loaded: false, failed: false })
      }
    }
  },
  methods: {
    onLoad(e) {
      if (!this.data.loaded) this.setData({ loaded: true })
      this.triggerEvent('load', e && e.detail)
    },
    onError(e) {
      if (!this.data.failed) this.setData({ failed: true })
      try { require('../../utils/imageUrl').onImageError() } catch (err) { /* 工具缺失不影响占位 */ }
      this.triggerEvent('error', e && e.detail)
    }
  }
})
