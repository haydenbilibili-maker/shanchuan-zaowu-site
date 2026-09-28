<template>
  <div class="startup-model-embed">
    <div class="embed-toolbar">
      <div class="embed-title-group">
        <span class="embed-kicker">财务资本</span>
        <h2 class="embed-title">工作室启动成本模型</h2>
      </div>
      <div class="embed-actions">
        <el-button size="small" @click="goFinance">财务核算</el-button>
        <el-button size="small" @click="goPropertyEval">物业合作测算</el-button>
        <el-tooltip content="重新加载模型" placement="bottom">
          <el-button size="small" circle :loading="loading" @click="reload">
            <el-icon><Refresh /></el-icon>
          </el-button>
        </el-tooltip>
        <el-button size="small" @click="openInNewTab">独立窗口</el-button>
      </div>
    </div>

    <div class="embed-frame-wrap">
      <el-alert
        v-if="!internalEmbedsAvailable"
        class="embed-unavailable"
        type="warning"
        :closable="false"
        show-icon
        title="启动成本模型仅在本地 / 私有环境可用"
        :description="INTERNAL_EMBED_UNAVAILABLE_TIP"
      />
      <template v-else>
        <div v-if="loading" class="embed-loading">
          <el-icon class="spin"><Loading /></el-icon>
          <span>加载启动成本模型…</span>
        </div>
        <iframe
          ref="iframeRef"
          class="embed-frame"
          :src="src"
          title="工作室启动成本模型"
          sandbox="allow-same-origin allow-scripts allow-forms allow-downloads allow-popups"
          @load="onIframeLoad"
        />
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Refresh, Loading } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  embeddedPageUrl,
  standalonePageUrl,
  internalEmbedPath,
  internalEmbedsAvailable,
  INTERNAL_EMBED_UNAVAILABLE_TIP,
} from '../utils/embeddedPageUrl'

const emit = defineEmits(['switch-tab'])

const PAGE = internalEmbedPath('shanhai-studio-startup-cost-model.html')

const loading = ref(internalEmbedsAvailable)
const cacheBuster = ref(Date.now())

const src = computed(() => embeddedPageUrl(PAGE, { cacheBuster: cacheBuster.value }))

const onIframeLoad = () => {
  loading.value = false
}

const goFinance = () => emit('switch-tab', '2')
const goPropertyEval = () => emit('switch-tab', '48')

const reload = () => {
  if (!internalEmbedsAvailable) return
  loading.value = true
  cacheBuster.value = Date.now()
}

const openInNewTab = () => {
  if (!internalEmbedsAvailable) {
    ElMessage.warning(INTERNAL_EMBED_UNAVAILABLE_TIP)
    return
  }
  try {
    window.open(standalonePageUrl(PAGE), '_blank', 'noopener,noreferrer')
  } catch {
    ElMessage.warning('无法打开新窗口，请检查浏览器拦截设置')
  }
}
</script>

<style scoped>
.startup-model-embed {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: calc(100vh - 72px);
  margin: 0;
  background: #eef2f7;
}

.embed-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 20px;
  background: linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
  border-bottom: 1px solid #dbe3ec;
  flex-shrink: 0;
}

.embed-title-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.embed-kicker {
  font-size: 11px;
  color: #2e75b6;
  letter-spacing: 0.12em;
}

.embed-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #1f4e79;
  letter-spacing: 0.04em;
}

.embed-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.embed-frame-wrap {
  position: relative;
  flex: 1;
  min-height: 480px;
  background: #eef2f7;
}

.embed-unavailable {
  margin: 20px;
  width: auto;
}

.embed-frame {
  width: 100%;
  height: 100%;
  min-height: 480px;
  border: 0;
  display: block;
  background: #eef2f7;
}

.embed-loading {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(238, 242, 247, 0.92);
  color: #6b7280;
  font-size: 13px;
}

.embed-loading .spin {
  font-size: 28px;
  color: #2e75b6;
  animation: startup-spin 0.9s linear infinite;
}

@keyframes startup-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 768px) {
  .embed-toolbar {
    flex-direction: column;
    align-items: flex-start;
    padding: 10px 12px;
  }
  .embed-actions {
    width: 100%;
    justify-content: flex-start;
  }
  .startup-model-embed {
    height: calc(100vh - 56px);
  }
}
</style>
