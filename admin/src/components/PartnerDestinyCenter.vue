<template>
  <div class="partner-destiny-center">
    <div class="module-header">
      <div class="title-box">
        <h2>合伙人命理中心</h2>
        <span class="subtitle">命理全书 · 深度版 · 十一人全景 · 含谢天全书 · 家庭合盘</span>
      </div>

      <div class="actions">
        <el-button v-if="unlocked" size="small" @click="lock">锁定</el-button>
        <el-button size="small" :loading="loading" @click="reload">刷新</el-button>
        <el-button v-if="unlocked && activeId" size="small" @click="printCurrent">导出 PDF</el-button>
        <el-button size="small" type="primary" @click="openInNewTab">新窗口打开</el-button>
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
            <el-button type="primary" :loading="unlocking" @click="unlock">解锁</el-button>
          </div>
        </div>
      </div>

      <div v-else class="destiny-shell">
        <div v-if="loading && !people.length" class="state-panel">
          <el-icon class="is-loading" :size="28"><Loading /></el-icon>
          <p>正在载入命理全书…</p>
        </div>

        <div v-else-if="loadError" class="state-panel error">
          <p class="state-title">内容载入失败</p>
          <p class="state-desc">{{ loadError }}</p>
          <el-button type="primary" size="small" :loading="loading" @click="loadContent">重试</el-button>
        </div>

        <div v-else class="destiny-embed" ref="scrollRoot">
          <div v-if="heroHtml" class="destiny-hero" v-html="heroHtml" />

          <nav class="pnav" aria-label="人员切换">
            <div class="pnav-inner">
              <button
                v-for="p in people"
                :key="p.id"
                type="button"
                class="pn"
                :class="{ on: activeId === p.id }"
                @click="selectPerson(p.id)"
              >
                {{ p.label }}
              </button>
            </div>
          </nav>

          <div class="container">
            <div
              v-if="activeId && htmlById[activeId]"
              :id="`embed-tab-${activeId}`"
              :key="activeId"
              class="tc on"
              v-html="htmlById[activeId]"
            />
          </div>

          <div v-if="footerHtml" class="destiny-footer" v-html="footerHtml" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { safeWarn } from '../utils/safeStorage.js'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'

const STORAGE_KEY = 'sc_partner_destiny_unlocked'
const DEFAULT_PASSWORD = 'admin888'
const EXPECTED_IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'hcx', 'wh', 'lel', 'xt', 'fam', 'z']
const BASE = import.meta.env.BASE_URL || '/admin/'

const unlocked = ref(typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1')
const password = ref('')
const unlocking = ref(false)
const loading = ref(false)
const loadError = ref('')
const cacheBuster = ref(Date.now())

const people = ref([])
const htmlById = ref({})
const activeId = ref('')
const heroHtml = ref('')
const footerHtml = ref('')
const scrollRoot = ref(null)

let styleEl = null

const destinyPageUrl = (v = cacheBuster.value) => `${BASE}partner-destiny-center.html?v=${v}`

function scopeCss(css, scope) {
  const scopeSelectors = (selectors) =>
    selectors
      .split(',')
      .map((s) => {
        s = s.trim()
        if (!s) return s
        if (s === ':root' || s.startsWith(':root')) return s.replace(':root', scope)
        if (s === 'body' || s.startsWith('body')) return s.replace(/^body\b/, scope)
        if (s.startsWith(scope)) return s
        return `${scope} ${s}`
      })
      .join(', ')

  const scopeBlock = (block) => {
    let out = ''
    let i = 0
    while (i < block.length) {
      while (i < block.length && /\s/.test(block[i])) {
        out += block[i]
        i++
      }
      if (i >= block.length) break
      if (block[i] === '@') {
        const open = block.indexOf('{', i)
        if (open < 0) {
          out += block.slice(i)
          break
        }
        out += block.slice(i, open + 1)
        let depth = 1
        let j = open + 1
        while (j < block.length && depth > 0) {
          if (block[j] === '{') depth++
          else if (block[j] === '}') depth--
          j++
        }
        out += scopeBlock(block.slice(open + 1, j - 1)) + '}'
        i = j
        continue
      }
      const open = block.indexOf('{', i)
      if (open < 0) {
        out += block.slice(i)
        break
      }
      out += scopeSelectors(block.slice(i, open)) + '{'
      let depth = 1
      let j = open + 1
      while (j < block.length && depth > 0) {
        if (block[j] === '{') depth++
        else if (block[j] === '}') depth--
        j++
      }
      out += block.slice(open + 1, j)
      i = j
    }
    return out
  }

  return scopeBlock(css)
}

function injectScopedCss(rawCss) {
  if (styleEl) {
    styleEl.remove()
    styleEl = null
  }
  if (!rawCss) return
  styleEl = document.createElement('style')
  styleEl.setAttribute('data-partner-destiny', '1')
  // 嵌入后仅渲染当前 tab；覆盖源 HTML 的 .tc{display:none}
  styleEl.textContent =
    scopeCss(rawCss, '.destiny-embed') +
    '\n.destiny-embed .tc{display:block}\n.destiny-embed .export-bar{display:none!important}\n'
  document.head.appendChild(styleEl)
}

function clearEmbedState() {
  people.value = []
  htmlById.value = {}
  activeId.value = ''
  heroHtml.value = ''
  footerHtml.value = ''
  loadError.value = ''
  if (styleEl) {
    styleEl.remove()
    styleEl = null
  }
}

function parseDestinyHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error('命理 HTML 解析失败')
  }

  const styleText = [...doc.querySelectorAll('style')].map((s) => s.textContent || '').join('\n')
  injectScopedCss(styleText)

  const hero = doc.querySelector('.hero')
  heroHtml.value = hero ? hero.outerHTML : ''

  const footer = doc.querySelector('.footer')
  footerHtml.value = footer ? footer.outerHTML : ''

  const buttons = [...doc.querySelectorAll('.pnav .pn')]
  const parsedPeople = buttons
    .map((btn) => {
      const onclick = btn.getAttribute('onclick') || ''
      const m = onclick.match(/sw\(\s*['"]([^'"]+)['"]\s*\)/)
      const id = m?.[1]
      const label = (btn.textContent || '').trim()
      return id && label ? { id, label } : null
    })
    .filter(Boolean)

  if (!parsedPeople.length) {
    throw new Error('未找到人员导航（.pnav .pn）')
  }

  const map = {}
  const thin = []
  for (const p of parsedPeople) {
    const el = doc.getElementById(`tab-${p.id}`)
    const inner = el?.innerHTML?.trim() || ''
    const textLen = (el?.textContent || '').replace(/\s+/g, ' ').trim().length
    if (!el || textLen < 100) {
      thin.push(p.label)
    }
    map[p.id] = inner
  }

  const missingExpected = EXPECTED_IDS.filter((id) => !parsedPeople.some((p) => p.id === id))
  if (missingExpected.length) {
    throw new Error(`缺少人员 tab：${missingExpected.join(', ')}`)
  }
  if (thin.length) {
    throw new Error(`以下人员内容过短或为空：${thin.join('、')}`)
  }

  people.value = parsedPeople
  htmlById.value = map
  activeId.value = parsedPeople[0]?.id || ''
}

async function loadContent() {
  if (!unlocked.value) return
  loading.value = true
  loadError.value = ''
  try {
    const url = destinyPageUrl(cacheBuster.value)
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) {
      throw new Error(`无法读取命理全书（HTTP ${res.status}）。请确认 ${url} 可访问。`)
    }
    const html = await res.text()
    if (!html || html.length < 1000) {
      throw new Error('命理全书内容异常偏短，请检查静态资源是否完整。')
    }
    parseDestinyHtml(html)
  } catch (e) {
    clearEmbedState()
    loadError.value = e?.message || '载入失败'
    ElMessage.error(loadError.value)
  } finally {
    loading.value = false
  }
}

function selectPerson(id) {
  if (!id || !htmlById.value[id]) {
    ElMessage.warning('该人员内容不可用')
    return
  }
  activeId.value = id
  nextTick(() => {
    const root = scrollRoot.value
    const nav = root?.querySelector?.('.pnav')
    if (root && nav) {
      root.scrollTo({ top: Math.max(0, nav.offsetTop - 8), behavior: 'smooth' })
    }
  })
}

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
    // 内容由 unlocked watch 统一拉取，避免与 unlock 双请求竞态
  } finally {
    unlocking.value = false
  }
}

const lock = () => {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (_) { safeWarn('PartnerDestinyCenter 非关键操作失败（已忽略）', _) }
  unlocked.value = false
  password.value = ''
  clearEmbedState()
  ElMessage.info('已锁定')
}

const reload = async () => {
  cacheBuster.value = Date.now()
  if (!unlocked.value) {
    ElMessage.info('请先解锁')
    return
  }
  await loadContent()
  if (!loadError.value) ElMessage.success('已刷新')
}

const openInNewTab = () => {
  try {
    if (!unlocked.value) {
      ElMessage.warning('请先解锁后再打开')
      return
    }
    window.open(destinyPageUrl(Date.now()), '_blank', 'noopener,noreferrer')
  } catch (_) {
    ElMessage.warning('无法打开新窗口，请检查浏览器拦截设置')
  }
}

const printCurrent = () => {
  if (!activeId.value) return
  window.print()
}

watch(
  unlocked,
  (v) => {
    if (v && !people.value.length && !loading.value) loadContent()
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (styleEl) {
    styleEl.remove()
    styleEl = null
  }
})
</script>

<style scoped>
.partner-destiny-center {
  min-height: 100%;
}

.actions {
  display: inline-flex;
  gap: var(--space-3);
  align-items: center;
  flex-wrap: wrap;
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

.destiny-shell {
  min-height: calc(100vh - 210px);
  max-height: calc(100vh - 210px);
  overflow: auto;
  background: #faf8f5;
}

.state-panel {
  min-height: calc(100vh - 210px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--light-text-secondary);
  padding: 32px;
  text-align: center;
}

.state-panel.error .state-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--light-text-primary);
}

.state-panel.error .state-desc {
  max-width: 520px;
  line-height: 1.6;
  color: var(--light-text-secondary);
}

@media (max-width: 768px) {
  .destiny-shell,
  .lock-mask,
  .state-panel {
    min-height: calc(100vh - 250px);
    max-height: calc(100vh - 250px);
  }

  .lock-mask {
    padding: var(--space-6);
  }

  .lock-card {
    padding: var(--space-6);
  }
}

@media print {
  .module-header,
  .actions,
  .lock-mask {
    display: none !important;
  }

  .content-card,
  .destiny-shell {
    border: none !important;
    box-shadow: none !important;
    max-height: none !important;
    overflow: visible !important;
  }
}
</style>
