<template>
  <el-empty :image-size="imageSize" :description="description">
    <template v-if="hint || actionText" #default>
      <p v-if="hint" class="erp-empty-hint">{{ hint }}</p>
      <el-button
        v-if="actionText"
        type="primary"
        size="small"
        @click="$emit('action')"
      >
        {{ actionText }}
      </el-button>
    </template>
  </el-empty>
</template>

<script setup>
/**
 * ERP 统一空态。
 *
 * 为什么需要它（2026-09-16 审计 P1）：
 * 22/60 个取数屏没有任何空态 —— 列表为空时用户看到的是**裸表头或空白面板**，
 * 无法区分「确实没有数据」与「没加载出来 / 加载失败」，也不知道下一步该做什么。
 * 更糟的是 `Categories.vue:228` 曾写 `empty-text=" "`（一个空格，故意空白）。
 *
 * 约定：描述说清「这里本来会有什么」，hint 说清「怎样才能有」，actionText 给一个出口。
 * 与错误态的分工：加载失败请用 `el-alert type="error"` + 重试，不要用空态冒充
 * （见 Orders.vue / Refunds.vue 的 loadError 写法）。
 */
defineProps({
  /** 主描述：这里本来会有什么 */
  description: { type: String, default: '暂无数据' },
  /** 补充说明：怎样才能有数据 */
  hint: { type: String, default: '' },
  /** 可选行动按钮文案；点击派发 action 事件 */
  actionText: { type: String, default: '' },
  imageSize: { type: [Number, String], default: 88 }
})

defineEmits(['action'])
</script>

<style scoped>
.erp-empty-hint {
  margin: 0 0 12px;
  font-size: var(--text-sm);
  line-height: 1.7;
  /* tertiary 白底仅 ~3:1，空态说明是信息文本 → secondary（~5.7:1 AA） */
  color: var(--light-text-secondary);
  max-width: 420px;
}
</style>
