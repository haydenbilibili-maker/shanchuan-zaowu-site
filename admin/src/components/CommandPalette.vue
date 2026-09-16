<template>
  <transition name="cp-fade">
    <div v-if="visible" class="cp-mask" @click.self="close">
      <div
        class="cp-panel"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板：搜索模块与命令"
      >
        <div class="cp-search">
          <el-icon class="cp-search-icon" aria-hidden="true"><Search /></el-icon>
          <input
            ref="inputRef"
            v-model="query"
            class="cp-input"
            role="combobox"
            aria-expanded="true"
            aria-controls="cp-listbox"
            aria-autocomplete="list"
            :aria-activedescendant="activeDescendantId || undefined"
            aria-label="搜索模块或命令"
            placeholder="搜索模块 / 命令…（拼音、英文、关键词均可）"
            @keydown.down.prevent="moveActive(1)"
            @keydown.up.prevent="moveActive(-1)"
            @keydown.enter.prevent="select()"
            @keydown.esc.prevent="close"
          />
          <div class="cp-hint" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> 移动 · <kbd>Enter</kbd> 进入 · <kbd>Esc</kbd> 关闭</div>
        </div>

        <!-- 读屏播报：结果数变化时告知，否则键盘用户不知道列表变了 -->
        <div class="cp-sr-status" role="status" aria-live="polite">
          {{ flatItems.length ? `共 ${flatItems.length} 个可选项` : '没有匹配项' }}
        </div>

        <div class="cp-body" id="cp-listbox" role="listbox" aria-label="命令面板结果">
          <!-- 置顶收藏 -->
          <div v-if="!query && pinned.length" class="cp-section">
            <div class="cp-section-title">⭐ 置顶</div>
            <div
              v-for="m in pinned"
              :key="'pin-' + m.id"
              class="cp-item"
              role="option"
              :id="'cp-opt-' + m.id"
              :aria-selected="activeIndex === flatIndexOf('module', m.id)"
              :class="{ active: activeIndex === flatIndexOf('module', m.id) }"
              @mouseenter="activeIndex = flatIndexOf('module', m.id)"
              @click="select(m)"
            >
              <el-icon class="cp-icon" aria-hidden="true"><component :is="resolveEpIcon(m.icon || groupIconName(m.group))" /></el-icon>
              <span class="cp-name">{{ m.name }}</span>
              <span class="cp-group">{{ groupName(m.group) }}</span>
              <el-icon class="cp-pin" role="button" tabindex="-1" :aria-label="isPinned(m.id) ? '取消置顶' : '置顶'" @click.stop="togglePin(m)"><Star /></el-icon>
            </div>
          </div>

          <!-- 最近访问 -->
          <div v-if="!query && recent.length" class="cp-section">
            <div class="cp-section-title">⏱️ 最近</div>
            <div
              v-for="m in recent"
              :key="'rec-' + m.id"
              class="cp-item"
              role="option"
              :id="'cp-opt-' + m.id"
              :aria-selected="activeIndex === flatIndexOf('module', m.id)"
              :class="{ active: activeIndex === flatIndexOf('module', m.id) }"
              @mouseenter="activeIndex = flatIndexOf('module', m.id)"
              @click="select(m)"
            >
              <el-icon class="cp-icon" aria-hidden="true"><component :is="resolveEpIcon(m.icon || groupIconName(m.group))" /></el-icon>
              <span class="cp-name">{{ m.name }}</span>
              <span class="cp-group">{{ groupName(m.group) }}</span>
              <el-icon class="cp-pin" role="button" tabindex="-1" :aria-label="isPinned(m.id) ? '取消置顶' : '置顶'" @click.stop="togglePin(m)" :class="{ pinned: isPinned(m.id) }"><Star /></el-icon>
            </div>
          </div>

          <!-- 搜索结果 - 动作（⚡） -->
          <div v-if="query && actionResults.length" class="cp-section">
            <div class="cp-section-title">⚡ 动作 ({{ actionResults.length }})</div>
            <div
              v-for="a in actionResults"
              :key="a.id"
              class="cp-item act"
              role="option"
              :id="'cp-opt-' + a.id"
              :aria-selected="activeIndex === flatIndexOf('action', a.id)"
              :class="{ active: activeIndex === flatIndexOf('action', a.id) }"
              @mouseenter="activeIndex = flatIndexOf('action', a.id)"
              @click="runActionItem(a)"
            >
              <span class="cp-icon" aria-hidden="true">{{ a.icon }}</span>
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
              v-for="m in results"
              :key="m.id"
              class="cp-item"
              role="option"
              :id="'cp-opt-' + m.id"
              :aria-selected="activeIndex === flatIndexOf('module', m.id)"
              :class="{ active: activeIndex === flatIndexOf('module', m.id) }"
              @mouseenter="activeIndex = flatIndexOf('module', m.id)"
              @click="select(m)"
            >
              <el-icon class="cp-icon" aria-hidden="true"><component :is="resolveEpIcon(m.icon || groupIconName(m.group))" /></el-icon>
              <span class="cp-name" v-html="highlight(m.name)"></span>
              <!-- 别名模块：点进去其实落到合并后的 Hub，必须写清楚，否则像两个功能 -->
              <span v-if="m._aliasTargetName" class="cp-alias">并入 {{ m._aliasTargetName }}</span>
              <span class="cp-group">{{ groupName(m.group) }}<span v-if="m.subgroup"> / {{ m.subgroup }}</span></span>
              <el-icon class="cp-pin" @click.stop="togglePin(m)" :class="{ pinned: isPinned(m.id) }"><Star /></el-icon>
            </div>
          </div>

          <!-- 不搜索时也展示常用动作 -->
          <div v-if="!query" class="cp-section">
            <div class="cp-section-title">⚡ 常用动作</div>
            <div
              v-for="a in ACTIONS.slice(0, 6)"
              :key="a.id"
              class="cp-item act"
              role="option"
              :id="'cp-opt-' + a.id"
              :aria-selected="activeIndex === flatIndexOf('action', a.id)"
              :class="{ active: activeIndex === flatIndexOf('action', a.id) }"
              @mouseenter="activeIndex = flatIndexOf('action', a.id)"
              @click="runActionItem(a)"
            >
              <span class="cp-icon" aria-hidden="true">{{ a.icon }}</span>
              <span class="cp-name">{{ a.label }}</span>
              <span class="cp-hint-text">{{ a.hint }}</span>
              <kbd v-if="a.shortcut" class="cp-shortcut">{{ a.shortcut }}</kbd>
            </div>
          </div>

          <!-- 默认列表（按一级分类分组浏览） -->
          <div v-if="!query && !pinned.length && !recent.length" class="cp-section">
            <div class="cp-section-title">📁 全部模块（共 {{ MODULES_CANONICAL.length }} 个）</div>
            <div
              v-for="(grp, key) in groupedByGroup"
              :key="key"
              class="cp-grp"
            >
              <div class="cp-grp-name">
                <el-icon class="cp-grp-ico" aria-hidden="true"><component :is="resolveEpIcon(GROUPS[key].icon)" /></el-icon>
                {{ GROUPS[key].name }}
              </div>
              <div
                v-for="m in grp"
                :key="m.id"
                class="cp-item"
                role="option"
                :id="'cp-opt-' + m.id"
                :aria-selected="activeIndex === flatIndexOf('module', m.id)"
                :class="{ active: activeIndex === flatIndexOf('module', m.id) }"
                @mouseenter="activeIndex = flatIndexOf('module', m.id)"
                @click="select(m)"
              >
                <span class="cp-icon" aria-hidden="true"></span>
                <span class="cp-name">{{ m.name }}</span>
                <span class="cp-group">{{ m.subgroup || '' }}</span>
                <el-icon class="cp-pin" role="button" tabindex="-1" :aria-label="isPinned(m.id) ? '取消置顶' : '置顶'" @click.stop="togglePin(m)" :class="{ pinned: isPinned(m.id) }"><Star /></el-icon>
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
import { safeLocalSet } from '../utils/safeStorage.js'
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import * as EpIcons from '@element-plus/icons-vue'
import { Search, Star } from '@element-plus/icons-vue'
import { MODULES, MODULES_CANONICAL, MODULES_BY_ID, GROUPS, searchModules, modulesByGroup, ACTIONS, searchActions, runAction } from '../utils/modulesRegistry'
import { useRecentModules, RECENT_MODULES_KEY, RECENT_CHANGED_EVENT } from '../composables/useRecentModules'

const resolveEpIcon = (name) => EpIcons[name] || EpIcons.Menu

const emit = defineEmits(['switch-tab'])

const visible = ref(false)
const query = ref('')
const activeIndex = ref(0)
const inputRef = ref(null)

const PIN_KEY = 'sc_admin_pinned_modules'

const { recentModules, recordRecent, loadRecent } = useRecentModules()
const pinnedIds = ref(loadIds(PIN_KEY))

function loadIds(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(id => MODULES_BY_ID[id]) : []
  } catch (e) { return [] }
}
function persistPinnedIds(arr) {
  safeLocalSet(PIN_KEY, JSON.stringify(arr))
  // storage 事件只派发给其它标签页；同页内用自定义事件通知 App.vue 侧栏刷新
  window.dispatchEvent(new CustomEvent('pinned-changed'))
}
// 接收来自侧栏（App.vue togglePin）的同页变更
const onPinnedChanged = () => { pinnedIds.value = loadIds(PIN_KEY) }
const onRecentChanged = () => { loadRecent() }

const recent = computed(() => recentModules.value.slice(0, 5))
const pinned = computed(() => pinnedIds.value.map(id => MODULES_BY_ID[id]).filter(Boolean))
const results = computed(() => query.value ? searchModules(query.value) : [])
const actionResults = computed(() => query.value ? searchActions(query.value) : [])

const runActionItem = (a) => {
  runAction(a)
  close()
}
const groupedByGroup = computed(() => modulesByGroup())

/** 无查询时展示的 6 个常用动作（与模板里那一节保持一致）*/
const actionList = computed(() => (query.value ? actionResults.value : ACTIONS.slice(0, 6)))
/** 无查询且无置顶/最近时，兜底展示的「全部模块」平铺列表 */
const browseList = computed(() => {
  if (query.value || pinned.value.length || recent.value.length) return []
  return Object.values(groupedByGroup.value).flat()
})

/**
 * **当前屏幕上真正渲染出来的条目，按视觉顺序平铺** —— 键盘导航的唯一事实来源。
 *
 * 这里修的是一个真实的功能缺口（不只是缺 aria）：原来 `totalItems` 只数「置顶 + 最近」，
 * 而没有置顶/最近时（新用户第一次打开就是这种状态）屏幕上渲染的是
 * 「常用动作 + 全部模块」，键盘却算出 `max = -1` → ↓ 无反应、Enter 也选不中任何东西。
 * 面板底部明明写着「↑↓ 移动 · Enter 进入」，实际按不动。
 */
const flatItems = computed(() => {
  const out = []
  if (query.value) {
    actionResults.value.forEach((item) => out.push({ kind: 'action', item }))
    results.value.forEach((item) => out.push({ kind: 'module', item }))
    return out
  }
  pinned.value.forEach((item) => out.push({ kind: 'module', item }))
  recent.value.forEach((item) => out.push({ kind: 'module', item }))
  actionList.value.forEach((item) => out.push({ kind: 'action', item }))
  browseList.value.forEach((item) => out.push({ kind: 'module', item }))
  return out
})

/** 某条渲染项在平铺顺序里的下标（模板据此标 active / aria-selected）*/
const flatIndexOf = (kind, id) => flatItems.value.findIndex((x) => x.kind === kind && String(x.item.id) === String(id))

/** aria-activedescendant 指向当前高亮项，读屏才知道光标停在哪一行 */
const activeDescendantId = computed(() => {
  const cur = flatItems.value[activeIndex.value]
  return cur ? `cp-opt-${cur.item.id}` : null
})

watch(query, () => { activeIndex.value = 0 })

const groupIconName = (key) => GROUPS[key]?.icon || 'Menu'
const groupName = (key) => GROUPS[key]?.name || ''
const isPinned = (id) => pinnedIds.value.includes(id)

const togglePin = (m) => {
  if (isPinned(m.id)) {
    pinnedIds.value = pinnedIds.value.filter(id => id !== m.id)
  } else {
    pinnedIds.value = [...pinnedIds.value, m.id].slice(0, 8) // 最多 8 个
  }
  persistPinnedIds(pinnedIds.value)
}

const moveActive = (dir) => {
  const max = flatItems.value.length - 1
  if (max < 0) return
  activeIndex.value = (activeIndex.value + dir + max + 1) % (max + 1)
}

const select = (m) => {
  if (!m) {
    const cur = flatItems.value[activeIndex.value]
    if (!cur) return
    if (cur.kind === 'action') { runActionItem(cur.item); return }
    m = cur.item
  }
  if (!m) return
  emit('switch-tab', m.id)
  recordRecent(m.id)
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
  lastFocused = (typeof document !== 'undefined' && document.activeElement) || null
  visible.value = true
  query.value = ''
  activeIndex.value = 0
  // 兜底：重新加载置顶/最近，防止其它入口修改后状态陈旧
  pinnedIds.value = loadIds(PIN_KEY)
  loadRecent()
  nextTick(() => inputRef.value?.focus())
}
/** 打开前记住焦点，关闭后还回去 —— 否则键盘用户的焦点会掉到 body 上，得重新 Tab 一大圈 */
let lastFocused = null
const close = () => {
  visible.value = false
  const el = lastFocused
  lastFocused = null
  if (el && typeof el.focus === 'function') nextTick(() => el.focus())
}


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

const onStorage = (e) => {
  if (e.key === PIN_KEY) onPinnedChanged()
  if (e.key === RECENT_MODULES_KEY) onRecentChanged()
}

// 暴露给父组件的方法
defineExpose({ open, close })

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('pinned-changed', onPinnedChanged)
  window.addEventListener(RECENT_CHANGED_EVENT, onRecentChanged)
  window.addEventListener('storage', onStorage)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pinned-changed', onPinnedChanged)
  window.removeEventListener(RECENT_CHANGED_EVENT, onRecentChanged)
  window.removeEventListener('storage', onStorage)
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
/* 只给读屏用：结果数播报区（视觉上不占位） */
.cp-sr-status {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0);
  white-space: nowrap; border: 0;
}
.cp-empty { padding: 30px; text-align: center; color: var(--light-text-secondary); font-size: 13px; }

.cp-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 18px; cursor: pointer;
  transition: background 0.1s;
}
.cp-item:hover, .cp-item.active {
  background: linear-gradient(90deg, #fdf6ec, transparent);
}
.cp-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  color: #b7950b;
  overflow: hidden;
  line-height: 1;
}
.cp-name {
  flex: 1;
  min-width: 0;
  color: #333;
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cp-name :deep(mark) { background: #ffe58f; color: #b7950b; padding: 0 2px; border-radius: 2px; }
.cp-group {
  color: #999;
  font-size: 12px;
  flex-shrink: 0;
  max-width: 36%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 别名模块的落点提示：让人一眼看出它并入了哪个 Hub */
.cp-alias {
  font-size: 11px;
  color: var(--gold-700);
  background: var(--gold-50);
  border: 1px solid var(--gold-200);
  border-radius: var(--radius-sm, 4px);
  padding: 1px 6px;
  margin-left: 6px;
  white-space: nowrap;
}
.cp-pin { color: #ddd; cursor: pointer; flex-shrink: 0; }
.cp-pin:hover { color: #d4af37; }
.cp-pin.pinned { color: #d4af37; }

.cp-grp { padding: 4px 0; }
.cp-grp-name {
  padding: 6px 18px 2px;
  font-size: 11px;
  color: #b7950b;
  font-weight: bold;
  display: flex;
  align-items: center;
  gap: 6px;
}
.cp-grp-ico { font-size: 14px; }

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
