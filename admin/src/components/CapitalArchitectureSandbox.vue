<template>
  <div class="capital-architecture-sandbox">
    <div class="module-header">
      <div class="title-box">
        <h2>资本架构沙盘</h2>
        <span class="subtitle">CAPITAL STRUCTURE SANDBOX</span>
      </div>
      <div class="actions">
        <el-button size="small" @click="reload" :loading="loading">刷新</el-button>
        <el-button size="small" type="primary" @click="openInNewTab">新窗口打开</el-button>
      </div>
    </div>

    <div class="content-card">
      <iframe
        ref="iframeRef"
        class="sandbox-iframe"
        :src="src"
        title="山海造物 · 资本架构沙盘"
        loading="lazy"
        sandbox="allow-same-origin allow-scripts allow-forms allow-downloads"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'

const iframeRef = ref(null)
const loading = ref(false)
const cacheBuster = ref(Date.now())

const src = computed(() => `/shanhai-capital-architecture-sandbox.html?v=${cacheBuster.value}`)

const reload = () => {
  loading.value = true
  cacheBuster.value = Date.now()
  setTimeout(() => {
    try {
      iframeRef.value?.contentWindow?.location?.reload?.()
    } catch (_) {
      /* 跨域或沙箱限制时仅靠 query 也已更新 src */
    }
    loading.value = false
  }, 200)
}

const openInNewTab = () => {
  try {
    window.open(`/shanhai-capital-architecture-sandbox.html?v=${Date.now()}`, '_blank', 'noopener,noreferrer')
  } catch (_) {
    ElMessage.warning('无法打开新窗口，请检查浏览器拦截设置')
  }
}
</script>

<style scoped>
.capital-architecture-sandbox {
  min-height: 100%;
}

.actions {
  display: inline-flex;
  gap: var(--space-3);
  align-items: center;
}

.content-card {
  margin-top: var(--space-4);
  border-radius: var(--radius-lg);
  border: 1px solid var(--light-border-subtle);
  overflow: hidden;
  background: var(--light-bg-elevated);
  height: calc(100vh - 200px);
  min-height: 520px;
}

.sandbox-iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
</style>
