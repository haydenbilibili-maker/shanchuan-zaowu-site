<template>
  <transition name="cp-fade">
    <div v-if="visible" class="cp-mask" @click.self="close">
      <div class="cp-panel">
        <div class="cp-search">
          <el-icon class="cp-search-icon"><Search /></el-icon>
          <input
            ref="inputRef"
            v-model="query"
            class="cp-input"
            placeholder="搜索模块 / 命令…（拼音、英文、关键词均可）"
            @keydown.down.prevent="moveActive(1)"
            @keydown.up.prevent="moveActive(-1)"
            @keydown.enter.prevent="select()"
            @keydown.esc.prevent="close"
          />
          <div class="cp-hint"><kbd>↑</kbd><kbd>↓</kbd> 移动 · <kbd>Enter</kbd> 进入 · <kbd>Esc</kbd> 关闭</div>
        </div>

        <div class="cp-body">
          <!-- 置顶收藏 -->
          <div v-if="!query && pinned.length" class="cp-section">
            <div class="cp-section-title">⭐ 置顶</div>
            <div
              v-for="(m, i) in pinned"
              :key="'pin-' + m.id"
              class="cp-item"
              :class="{ active: activeIndex === i }"
              @mouseenter="activeIndex = i"
              @click="select(m)"
            >
              <span class="cp-icon">{{ groupIcon(m.group) }}</span>
              <span class="cp-name">{{ m.name }}</span>
              <span class="cp-group">{{ groupName(m.group) }}</span>
              <el-icon class="cp-pin" @click.stop="togglePin(m)"><Star /></el-icon>
            </div>
          </div>

          <!-- 最近访问 -->
          <div v-if="!query && recent.length" class="cp-section">
            <div class="cp-section-title">⏱️ 最近</div>
            <div
              v-for="(m, i) in recent"
              :key="'rec-' + m.id"
              class="cp-item"
              :class="{ active: activeIndex === pinned.length + i }"
              @mouseenter="activeIndex = pinned.length + i"
              @click="select(m)"
            >
              <span class="cp-icon">{{ groupIcon(m.group) }}</span>
              <span class="cp-name">{{ m.name }}</span>
              <span class="cp-group">{{ groupName(m.group) }}</span>
              <el-icon class="cp-pin" @click.stop="togglePin(m)" :class="{ pinned: isPinned(m.id) }"><Star /></el-icon>
            </div>
          </div>

          <!-- 搜索结果 - 动作（⚡） -->
          <div v-if="query && actionResults.length" class="cp-section">
            <div class="cp-section-title">⚡ 动作 ({{ actionResults.length }})</div>
            <div
              v-for="(a, i) in actionResults"
              :key="a.id"
              class="cp-item act"
              :class="{ active: activeIndex === i }"
              @mouseenter="activeIndex = i"
              @click="runActionItem(a)"
            >
              <span class="cp-icon">{{ a.icon }}</span>
              <span class="cp-name" v-html="highlight(a.label)"></span>
              <span class="cp-hint-text">{{ a.hint }}</span>
              <kbd v-if="a.shortcut" class="cp-shortcut">{{ a.shortcut }}</kbd>
            </div>
          </div>

          <!-- 搜索结果 - 模块（🔍） -->
          <div v-if="query" class="cp-section">
            <div class="cp-section-title">🔍 模块 ({{ results.length }})</div>
            <div v-if="!results.length && !actionResults.length" class="cp-empty">没有匹配的模块或动作</div>
            <div
              v-for="(m, i) in results"
              :key="m.id"
              class="cp-item"
              :class="{ active: activeIndex === actionResults.length + i }"
              @mouseenter="activeIndex = actionResults.length + i"
              @click="select(m)"
            >
              <span class="cp-icon">{{ groupIcon(m.group) }}</span>
              <span class="cp-name" v-html="highlight(m.name)"></span>
              <span class="cp-group">{{ groupName(m.group) }}<span v-if="m.subgroup"> / {{ m.subgroup }}</span></span>
              <el-icon class="cp-pin" @click.stop="togglePin(m)" :class="{ pinned: isPinned(m.id) }"><Star /></el-icon>
            </div>
          </div>

          <!-- 不搜索时也展示常用动作 -->
          <div v-if="!query" class="cp-section">
            <div class="cp-section-title">⚡ 常用动作</div>
            <div
              v-for="(a, i) in ACTIONS.slice(0, 6)"
              :key="a.id"
              class="cp-item act"
              @click="runActionItem(a)"
            >
              <span class="cp-icon">{{ a.icon }}</span>
              <span class="cp-name">{{ a.label }}</span>
              <span class="cp-hint-text">{{ a.hint }}</span>
              <kbd v-if="a.shortcut" class="cp-shortcut">{{ a.shortcut }}</kbd>
            </div>
          </div>

          <!-- 默认列表（按一级分类分组浏览） -->
          <div v-if="!query && !pinned.length && !recent.length" class="cp-section">
            <div class="cp-section-title">📁 全部模块（共 {{ MODULES.length }} 个）</div>
            <div
              v-for="(grp, key) in groupedByGroup"
              :key="key"
              class="cp-grp"
            >
              <div class="cp-grp-name">{{ GROUPS[key].icon }} {{ GROUPS[key].name }}</div>
              <div
                v-for="m in grp"
                :key="m.id"
                class="cp-item"
                @click="select(m)"
              >
                <span class="cp-icon"></span>
                <span class="cp-name">{{ m.name }}</span>
                <span class="cp-group">{{ m.subgroup || '' }}</span>
                <el-icon class="cp-pin" @click.stop="togglePin(m)" :class="{ pinned: isPinned(m.id) }"><Star /></el-icon>
              </div>
            </div>
          </div>
        </div>

        <div class="cp-footer">
          <span><kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd> 打开命令面板</span>
          <span><kbd>⌘1</kbd> ~ <kbd>⌘6</kbd> 切换一级分类</span>
          <span><kbd>Alt+]</kbd> / <kbd>Alt+[</kbd> 切换标签 · <kbd>Alt+W</kbd> 关闭标签</span>
          <span>悬浮 ⭐ 置顶模块</span>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { Search, Star } from '@element-plus/icons-vue'
import { MODULES, MODULES_BY_ID, GROUPS, searchModules, modulesByGroup, ACTIONS, searchActions, runAction } from '../utils/modulesRegistry'

const emit = defineEmits(['switch-tab'])

const visible = ref(false)
const query = ref('')
const activeIndex = ref(0)
const inputRef = ref(null)

const RECENT_KEY = 'sc_admin_recent_modules'
const PIN_KEY = 'sc_admin_pinned_modules'

const recentIds = ref(loadIds(RECENT_KEY))
const pinnedIds = ref(loadIds(PIN_KEY))

function loadIds(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(id => MODULES_BY_ID[id]) : []
  } catch (e) { return [] }
}
function persistIds(key, arr) {
  try { localStorage.setItem(key, JSON.stringify(arr)) } catch (e) {}
  // storage 事件只派发给其它标签页；同页内用自定义事件通知 App.vue 侧栏刷新
  window.dispatchEvent(new CustomEvent('pinned-changed'))
}
// 接收来自侧栏（App.vue togglePin）的同页变更
const onPinnedChanged = () => { pinnedIds.value = loadIds(PIN_KEY) }

const recent = computed(() => recentIds.value.map(id => MODULES_BY_ID[id]).filter(Boolean).slice(0, 5))
const pinned = computed(() => pinnedIds.value.map(id => MODULES_BY_ID[id]).filter(Boolean))
const results = computed(() => query.value ? searchModules(query.value) : [])
const actionResults = computed(() => query.value ? searchActions(query.value) : [])

const runActionItem = (a) => {
  runAction(a)
  close()
}
const groupedByGroup = computed(() => modulesByGroup())

const totalItems = computed(() => {
  if (query.value) return results.value.length
  return pinned.value.length + recent.value.length
})

watch(query, () => { activeIndex.value = 0 })

const groupIcon = (key) => GROUPS[key]?.icon || ''
const groupName = (key) => GROUPS[key]?.name || ''
const isPinned = (id) => pinnedIds.value.includes(id)

const togglePin = (m) => {
  if (isPinned(m.id)) {
    pinnedIds.value = pinnedIds.value.filter(id => id !== m.id)
  } else {
    pinnedIds.value = [...pinnedIds.value, m.id].slice(0, 8) // 最多 8 个
  }
  persistIds(PIN_KEY, pinnedIds.value)
}

const recordRecent = (m) => {
  recentIds.value = [m.id, ...recentIds.value.filter(id => id !== m.id)].slice(0, 6)
  persistIds(RECENT_KEY, recentIds.value)
}

const moveActive = (dir) => {
  const max = (query.value ? (results.value.length + actionResults.value.length) : totalItems.value) - 1
  if (max < 0) return
  activeIndex.value = (activeIndex.value + dir + max + 1) % (max + 1)
}

const select = (m) => {
  if (!m) {
    // 优先动作，其次模块
    if (query.value) {
      const idx = activeIndex.value
      if (idx < actionResults.value.length) {
        runActionItem(actionResults.value[idx])
        return
      }
      const modIdx = idx - actionResults.value.length
      m = results.value[modIdx]
    } else {
      const list = [...pinned.value, ...recent.value]
      m = list[activeIndex.value]
    }
  }
  if (!m) return
  emit('switch-tab', m.id)
  recordRecent(m)
  close()
}

const highlight = (text) => {
  if (!query.value) return text
  const q = query.value.trim().toLowerCase()
  if (!q) return text
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return text
  return text.slice(0, i) + '<mark>' + text.slice(i, i + q.length) + '</mark>' + text.slice(i + q.length)
}

const open = () => {
  visible.value = true
  query.value = ''
  activeIndex.value = 0
  // 兜底：重新加载置顶/最近，防止其它入口修改后状态陈旧
  pinnedIds.value = loadIds(PIN_KEY)
  recentIds.value = loadIds(RECENT_KEY)
  nextTick(() => inputRef.value?.focus())
}
const close = () => { visible.value = false }


// ====== 全局快捷键 ======
const onKeydown = (e) => {
  // Cmd/Ctrl + K 打开
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    visible.value ? close() : open()
    return
  }
  // Cmd/Ctrl + 1..6 切顶级分类
  if ((e.metaKey || e.ctrlKey) && /^[1-6]$/.test(e.key)) {
    e.preventDefault()
    const groupKeys = Object.keys(GROUPS)
    const idx = parseInt(e.key) - 1
    const target = groupKeys[idx]
    if (target) {
      const firstMod = MODULES.find(m => m.group === target)
      if (firstMod) emit('switch-tab', firstMod.id)
    }
  }
}

// 暴露给父组件的方法
defineExpose({ open, close })

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('pinned-changed', onPinnedChanged)
  window.addEventListener('storage', onPinnedChanged) // 跨标签页兜底
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pinned-changed', onPinnedChanged)
  window.removeEventListener('storage', onPinnedChanged)
})
</script>

<style scoped>
.cp-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,0.45);
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 12vh;
  z-index: 9000;
  backdrop-filter: blur(4px);
}
.cp-panel {
  width: 640px; max-width: 92vw; max-height: 76vh;
  background: #fff; border-radius: 14px; overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,0.4);
  display: flex; flex-direction: column;
}
.cp-search {
  display: flex; align-items: center; gap: 10px;
  padding: 16px 18px; border-bottom: 1px solid #f0f0f0;
  position: relative;
}
.cp-search-icon { color: #d4af37; font-size: 20px; }
.cp-input {
  flex: 1; border: none; outline: none; font-size: 16px;
  background: transparent; color: #333;
}
.cp-hint { font-size: 11px; color: #999; white-space: nowrap; }
.cp-hint kbd { background: #f5f5f5; padding: 1px 6px; border-radius: 4px; font-family: monospace; margin: 0 2px; }

.cp-body { flex: 1; overflow-y: auto; padding: 8px 0; }
.cp-section { padding: 6px 0; }
.cp-section-title { padding: 4px 18px; font-size: 11px; color: #999; letter-spacing: 1px; }
.cp-empty { padding: 30px; text-align: center; color: #ccc; font-size: 13px; }

.cp-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 18px; cursor: pointer;
  transition: background 0.1s;
}
.cp-item:hover, .cp-item.active {
  background: linear-gradient(90deg, #fdf6ec, transparent);
}
.cp-icon { font-size: 16px; width: 20px; }
.cp-name { flex: 1; color: #333; font-size: 14px; font-weight: 500; }
.cp-name :deep(mark) { background: #ffe58f; color: #b7950b; padding: 0 2px; border-radius: 2px; }
.cp-group { color: #999; font-size: 12px; }
.cp-pin { color: #ddd; cursor: pointer; }
.cp-pin:hover { color: #d4af37; }
.cp-pin.pinned { color: #d4af37; }

.cp-grp { padding: 4px 0; }
.cp-grp-name { padding: 6px 18px 2px; font-size: 11px; color: #b7950b; font-weight: bold; }

/* 动作项样式 */
.cp-item.act:hover, .cp-item.act.active {
  background: linear-gradient(90deg, #f0f9eb, transparent);
}
.cp-item.act .cp-icon { font-size: 16px; }
.cp-hint-text { color: #999; font-size: 11px; flex: 1; text-align: right; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-shortcut {
  background: #f5f5f5;
  border: 1px solid #e0e0e0;
  padding: 1px 6px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 11px;
  color: #666;
  margin-left: 6px;
}

.cp-footer {
  display: flex; gap: 16px;
  padding: 10px 18px; border-top: 1px solid #f0f0f0;
  font-size: 11px; color: #999; background: #fafafa;
  flex-wrap: wrap;
}
.cp-footer kbd { background: #fff; padding: 1px 6px; border-radius: 4px; font-family: monospace; border: 1px solid #e4e7ed; margin: 0 2px; }

.cp-fade-enter-active, .cp-fade-leave-active { transition: opacity 0.15s; }
.cp-fade-enter-from, .cp-fade-leave-to { opacity: 0; }
</style>
