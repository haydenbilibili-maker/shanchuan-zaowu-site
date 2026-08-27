<template>
  <div class="capital-sandbox-embed">
    <div class="embed-toolbar">
      <div class="embed-title-group">
        <span class="embed-kicker">财务资本</span>
        <h2 class="embed-title">资本架构沙盘</h2>
      </div>
      <div class="embed-actions">
        <el-tag v-if="financeSynced" size="small" type="success" effect="plain" class="sync-tag">
          已同步财务账本
        </el-tag>
        <el-button size="small" @click="goFinance">财务核算</el-button>
        <el-button size="small" :loading="syncing" @click="syncFinanceLedger">同步财务账本</el-button>
        <el-tooltip content="重新加载沙盘" placement="bottom">
          <el-button size="small" circle :loading="loading" @click="reload">
            <el-icon><Refresh /></el-icon>
          </el-button>
        </el-tooltip>
        <el-button size="small" @click="openInNewTab">独立窗口</el-button>
      </div>
    </div>

    <div class="embed-frame-wrap">
      <div v-if="loading" class="embed-loading">
        <el-icon class="spin"><Loading /></el-icon>
        <span>加载沙盘中…</span>
      </div>
      <iframe
        ref="iframeRef"
        class="embed-frame"
        :src="src"
        title="资本架构沙盘"
        sandbox="allow-same-origin allow-scripts allow-forms allow-downloads allow-popups"
        @load="onIframeLoad"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { Refresh, Loading } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { embeddedPageUrl, standalonePageUrl } from '../utils/embeddedPageUrl'
import {
  pushFinanceSnapshotToIframeAsync,
  readFinanceSnapshotAsync,
} from '../utils/financeSandboxBridge'
import {
  pushMiniprogramSnapshotToIframeAsync,
  readMiniprogramSandboxSnapshot,
} from '../utils/miniprogramSandboxBridge'

const emit = defineEmits(['switch-tab'])

const PAGE = 'shanhai-capital-architecture-sandbox.html'

const iframeRef = ref(null)
const loading = ref(true)
const syncing = ref(false)
const financeSynced = ref(false)
const cacheBuster = ref(Date.now())

const src = computed(() => embeddedPageUrl(PAGE, { cacheBuster: cacheBuster.value }))

const syncFinanceToIframe = async () => {
  if (!iframeRef.value || syncing.value) return
  syncing.value = true
  try {
    const [financeOk] = await Promise.all([
      pushFinanceSnapshotToIframeAsync(iframeRef.value),
      pushMiniprogramSnapshotToIframeAsync(iframeRef.value),
    ])
    financeSynced.value = financeOk
  } catch {
    financeSynced.value = false
  } finally {
    syncing.value = false
  }
}

const onIframeLoad = () => {
  loading.value = false
  syncFinanceToIframe()
}

const syncFinanceLedger = async () => {
  await syncFinanceToIframe()
  if (financeSynced.value) {
    ElMessage.success('财务账本已同步至沙盘')
  } else {
    ElMessage.warning('未读取到山川造物 ERP 账本，请先在「财务核算」录入或检查云端同步')
  }
}

const goFinance = () => emit('switch-tab', '2')

const reload = () => {
  loading.value = true
  cacheBuster.value = Date.now()
}

const openInNewTab = () => {
  try {
    window.open(standalonePageUrl(PAGE), '_blank', 'noopener,noreferrer')
  } catch {
    ElMessage.warning('无法打开新窗口，请检查浏览器拦截设置')
  }
}

const onMessage = (event) => {
  if (event?.data?.type === 'capital-sandbox-ready') {
    loading.value = false
    syncFinanceToIframe()
  }
  if (event?.data?.type === 'capital-sandbox-request-finance') {
    syncFinanceToIframe()
  }
}

onMounted(() => {
  window.addEventListener('message', onMessage)
  Promise.all([readFinanceSnapshotAsync(), readMiniprogramSandboxSnapshot()]).then(([snap]) => {
    financeSynced.value = !!(snap?.hasErpShanhaizaowu)
    if (iframeRef.value && !loading.value) syncFinanceToIframe()
  })
})

onUnmounted(() => {
  window.removeEventListener('message', onMessage)
})
</script>

<style scoped>
.capital-sandbox-embed {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: calc(100vh - 72px);
  margin: 0;
  background: #f4ede0;
}

.embed-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 20px;
  background: linear-gradient(180deg, #f8f2e8 0%, #f4ede0 100%);
  border-bottom: 1px solid rgba(28, 24, 20, 0.1);
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
  color: #9a7b4f;
  letter-spacing: 0.12em;
}

.embed-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #1c1814;
  letter-spacing: 0.04em;
}

.embed-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.sync-tag {
  border-color: rgba(45, 106, 79, 0.35) !important;
  color: #2d6a4f !important;
  background: rgba(45, 106, 79, 0.08) !important;
}

.embed-frame-wrap {
  position: relative;
  flex: 1;
  min-height: 480px;
  background: #f4ede0;
}

.embed-frame {
  width: 100%;
  height: 100%;
  min-height: 480px;
  border: 0;
  display: block;
  background: #f4ede0;
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
  background: rgba(244, 237, 224, 0.92);
  color: #6b6258;
  font-size: 13px;
}

.embed-loading .spin {
  font-size: 28px;
  color: #9a7b4f;
  animation: sandbox-spin 0.9s linear infinite;
}

@keyframes sandbox-spin {
  to { transform: rotate(360deg); }
}
</style>
