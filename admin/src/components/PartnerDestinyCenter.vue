<template>
  <div class="partner-destiny-center">
    <div class="module-header">
      <div class="title-box">
        <h2>合伙人命理中心</h2>
        <span class="subtitle">命理全书 · 深度版 · 十一人全景 · 含谢天全书 · 家庭合盘</span>
      </div>

      <div class="actions">
        <el-button v-if="unlocked" size="small" @click="lock">
          锁定
        </el-button>
        <el-button size="small" @click="reload" :loading="loading">
          刷新
        </el-button>
        <el-button size="small" @click="openInNewTab" type="primary">
          新窗口打开
        </el-button>
      </div>
    </div>

    <div class="content-card">
      <div v-if="!unlocked" class="lock-mask">
        <div class="lock-card">
          <div class="lock-title">需要密码访问</div>
          <div class="lock-sub">合伙人命理中心为敏感信息区，请输入访问口令。</div>

          <el-input
            v-model="password"
            type="password"
            show-password
            placeholder="请输入访问密码"
            @keyup.enter="unlock"
          />

          <div class="lock-actions">
            <el-button type="primary" @click="unlock" :loading="unlocking">
              解锁
            </el-button>
          </div>
        </div>
      </div>

      <iframe
        v-else
        ref="iframeRef"
        class="destiny-iframe"
        :src="src"
        title="合伙人命理中心 · 命理全书深度版 · 十一人全景"
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

const STORAGE_KEY = 'sc_partner_destiny_unlocked'
const DEFAULT_PASSWORD = 'admin888'
// Admin 部署在 /admin/，静态页在 admin/public/ → /admin/partner-destiny-center.html
const BASE = import.meta.env.BASE_URL || '/admin/'

const unlocked = ref(typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1')
const password = ref('')
const unlocking = ref(false)

const destinyPageUrl = (v = cacheBuster.value) => `${BASE}partner-destiny-center.html?v=${v}`
const src = computed(() => destinyPageUrl())

const unlock = async () => {
  if (unlocking.value) return
  unlocking.value = true
  try {
    if ((password.value || '').trim() !== DEFAULT_PASSWORD) {
      ElMessage.error('密码错误')
      return
    }
    localStorage.setItem(STORAGE_KEY, '1')
    unlocked.value = true
    password.value = ''
    ElMessage.success('已解锁')
  } finally {
    unlocking.value = false
  }
}

const lock = () => {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (_) {}
  unlocked.value = false
  password.value = ''
  ElMessage.info('已锁定')
}

const reload = async () => {
  loading.value = true
  try {
    cacheBuster.value = Date.now()
    // 保险起见：触发一次 iframe 原生 reload（部分浏览器对 query 刷新不敏感）
    setTimeout(() => {
      try {
        iframeRef.value?.contentWindow?.location?.reload?.()
      } catch (_) {}
      loading.value = false
    }, 200)
  } catch (e) {
    loading.value = false
    ElMessage.warning(e?.message || '刷新失败')
  }
}

const openInNewTab = () => {
  try {
    if (!unlocked.value) {
      ElMessage.warning('请先解锁后再打开')
      return
    }
    window.open(destinyPageUrl(Date.now()), '_blank', 'noopener,noreferrer')
  } catch (e) {
    ElMessage.warning('无法打开新窗口，请检查浏览器拦截设置')
  }
}
</script>

<style scoped>
.partner-destiny-center {
  min-height: 100%;
}

.actions {
  display: inline-flex;
  gap: var(--space-3);
  align-items: center;
}

.content-card {
  background: var(--light-bg-elevated);
  border: 1px solid var(--light-border-default);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  position: relative;
}

.lock-mask {
  min-height: calc(100vh - 210px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-8);
  background: linear-gradient(180deg, rgba(45, 106, 79, 0.06) 0%, rgba(26, 24, 21, 0.02) 100%);
}

.lock-card {
  width: min(520px, 100%);
  background: var(--light-bg-elevated);
  border: 1px solid var(--light-border-default);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-md);
  padding: var(--space-8);
}

.lock-title {
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--light-text-primary);
  margin-bottom: var(--space-2);
}

.lock-sub {
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
  margin-bottom: var(--space-6);
  line-height: var(--leading-normal);
}

.lock-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-5);
}

.destiny-iframe {
  width: 100%;
  height: calc(100vh - 210px);
  border: 0;
  background: var(--light-bg-primary);
}

@media (max-width: 768px) {
  .destiny-iframe {
    height: calc(100vh - 250px);
  }

  .lock-mask {
    min-height: calc(100vh - 250px);
    padding: var(--space-6);
  }

  .lock-card {
    padding: var(--space-6);
  }
}
</style>

