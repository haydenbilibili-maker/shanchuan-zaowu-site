<template>
  <div class="tbar">
    <!-- 面包屑：移动端仅显示当前模块 -->
    <div class="breadcrumb">
      <el-icon class="brand-mark"><HomeFilled /></el-icon>
      <span class="bc-item brand bc-desktop">山海造物</span>
      <template v-if="activeBreadcrumb">
        <span class="bc-sep bc-desktop">›</span>
        <span class="bc-item bc-desktop">{{ activeBreadcrumb.group }}</span>
        <span v-if="activeBreadcrumb.subgroup" class="bc-sep bc-desktop">›</span>
        <span v-if="activeBreadcrumb.subgroup" class="bc-item bc-desktop">{{ activeBreadcrumb.subgroup }}</span>
        <span class="bc-sep">›</span>
        <span class="bc-item current">{{ activeBreadcrumb.name }}</span>
      </template>
    </div>

    <!-- 多标签条 -->
    <div class="tabs-strip">
      <div class="tabs-scroll" ref="scrollerRef">
        <div
          v-for="tab in openTabs"
          :key="tab.id"
          class="tab-chip"
          :class="{ active: tab.id === activeTabId, pinned: tab.pinned }"
          :draggable="!tab.pinned"
          @click="activate(tab.id)"
          @dragstart="onDragStart(tab.id, $event)"
          @dragover.prevent
          @drop="onDrop(tab.id)"
          @contextmenu.prevent="openContextMenu(tab, $event)"
          @auxclick.prevent="handleAuxClick(tab, $event)"
        >
          <el-icon v-if="tab.pinned" class="pin-mark"><Star /></el-icon>
          <span class="tab-name">{{ moduleName(tab.id) }}</span>
          <el-icon
            v-if="!tab.pinned"
            class="tab-close"
            @click.stop="closeTab(tab.id)"
          >
            <Close />
          </el-icon>
        </div>
      </div>

      <div class="tabs-actions">
        <el-tooltip content="新建（命令面板 ⌘K）" placement="bottom">
          <button class="tab-action-btn" @click="$emit('open-palette')">
            <el-icon><Plus /></el-icon>
          </button>
        </el-tooltip>
        <el-tooltip content="标签操作" placement="bottom">
          <el-dropdown trigger="click" @command="onMenuCommand">
            <button class="tab-action-btn">
              <el-icon><MoreFilled /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="close-others">关闭其它</el-dropdown-item>
                <el-dropdown-item command="close-all" divided>关闭全部</el-dropdown-item>
                <el-dropdown-item command="reload" divided>刷新当前页</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </el-tooltip>
      </div>
    </div>

    <!-- 右键菜单 -->
    <div
      v-if="ctxMenu.show"
      class="ctx-menu"
      :style="{ top: ctxMenu.y + 'px', left: ctxMenu.x + 'px' }"
      @click.stop
    >
      <div class="ctx-item" @click="onCtxAction('pin')">
        <el-icon><Star /></el-icon>
        {{ ctxMenu.tab?.pinned ? '取消固定' : '固定标签' }}
      </div>
      <div class="ctx-item" @click="onCtxAction('close')" :class="{ disabled: ctxMenu.tab?.pinned }">
        <el-icon><Close /></el-icon> 关闭此标签
      </div>
      <div class="ctx-item" @click="onCtxAction('close-others')">
        <el-icon><CloseBold /></el-icon> 关闭其它
      </div>
      <div class="ctx-item" @click="onCtxAction('close-all')">
        <el-icon><Delete /></el-icon> 关闭全部
      </div>
      <div class="ctx-divider"></div>
      <div class="ctx-item" @click="onCtxAction('reload')">
        <el-icon><RefreshRight /></el-icon> 刷新此页
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import {
  HomeFilled, Star, Close, Plus, MoreFilled, CloseBold, Delete, RefreshRight
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { MODULES_BY_ID, GROUPS } from '../utils/modulesRegistry'
import { useTabsManager } from '../composables/useTabsManager'

const emit = defineEmits(['open-palette', 'reload'])

const { openTabs, activeTabId, openTab, closeTab, closeOthers, closeAll, togglePin, reorder, cycleTab } = useTabsManager()

const scrollerRef = ref(null)
const ctxMenu = ref({ show: false, x: 0, y: 0, tab: null })

const moduleName = (id) => MODULES_BY_ID[id]?.name || id

const activeBreadcrumb = computed(() => {
  const m = MODULES_BY_ID[activeTabId.value]
  if (!m) return null
  return {
    group: GROUPS[m.group]?.name || m.group,
    subgroup: m.subgroup,
    name: m.name
  }
})

const activate = (id) => { activeTabId.value = id }

// 拖拽排序
let dragSource = null
const onDragStart = (id, e) => {
  dragSource = id
  e.dataTransfer.effectAllowed = 'move'
}
const onDrop = (toId) => {
  if (dragSource && dragSource !== toId) reorder(dragSource, toId)
  dragSource = null
}

// 中键关闭（鼠标滚轮键）
const handleAuxClick = (tab, e) => {
  if (e.button === 1 && !tab.pinned) closeTab(tab.id)
}

// 右键菜单
const openContextMenu = (tab, e) => {
  ctxMenu.value = { show: true, x: e.clientX, y: e.clientY, tab }
}
const closeContextMenu = () => { ctxMenu.value.show = false }
const onCtxAction = (act) => {
  const t = ctxMenu.value.tab
  if (!t) return
  if (act === 'pin') togglePin(t.id)
  else if (act === 'close' && !t.pinned) closeTab(t.id)
  else if (act === 'close-others') closeOthers(t.id)
  else if (act === 'close-all') closeAll()
  else if (act === 'reload') {
    activeTabId.value = t.id
    emit('reload')
  }
  closeContextMenu()
}
const onMenuCommand = (cmd) => {
  if (cmd === 'close-others') closeOthers()
  else if (cmd === 'close-all') closeAll()
  else if (cmd === 'reload') emit('reload')
}

// 全局点击关菜单 + 快捷键
const onGlobalClick = () => closeContextMenu()
const onKey = (e) => {
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  // Cmd+Tab / Cmd+Shift+W 是浏览器保留键；改用 Alt 组合，用 e.code 匹配（macOS Option+W → ∑）
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    if (e.code === 'KeyW') {
      e.preventDefault()
      if (!openTabs.value.find(x => x.id === activeTabId.value)?.pinned) {
        closeTab(activeTabId.value)
      }
      return
    }
    if (e.code === 'BracketRight') {
      e.preventDefault()
      cycleTab(1)
      return
    }
    if (e.code === 'BracketLeft') {
      e.preventDefault()
      cycleTab(-1)
    }
  }
}

onMounted(() => {
  window.addEventListener('click', onGlobalClick)
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  window.removeEventListener('click', onGlobalClick)
  window.removeEventListener('keydown', onKey)
})

// 当激活的 tab 变化，滚动到可见
watch(activeTabId, () => {
  nextTick(() => {
    const el = scrollerRef.value?.querySelector('.tab-chip.active')
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  })
})
</script>

<style scoped>
.tbar {
  display: flex; flex-direction: column;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
}

.breadcrumb {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 16px;
  font-size: 12px;
  color: #666;
  border-bottom: 1px solid #fafafa;
}
.brand-mark { color: #d4af37; font-size: 14px; }
.bc-item { color: #999; }
.bc-item.brand { color: #b7950b; font-weight: 600; }
.bc-item.current { color: #333; font-weight: 600; }
.bc-sep { color: #ccc; font-size: 14px; margin: 0 2px; }

.tabs-strip {
  display: flex;
  align-items: center;
  height: 38px;
  background: #fafafa;
  padding: 0 8px;
}
.tabs-scroll {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
  height: 100%;
}
.tabs-scroll::-webkit-scrollbar { display: none; }

.tab-chip {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px;
  margin-top: 4px;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: #666;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
  border-bottom: none;
  white-space: nowrap;
  max-width: 200px;
  transition: 0.15s;
  position: relative;
  user-select: none;
}
.tab-chip:hover { background: #fff; color: #333; }
.tab-chip.active {
  background: #fff;
  color: #d4af37;
  font-weight: 600;
  border-color: #f0f0f0;
  box-shadow: 0 -2px 0 #d4af37;
  margin-bottom: -1px;
  z-index: 2;
}
.tab-chip.pinned { padding-left: 6px; }
.tab-chip.pinned::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 2px;
  background: #d4af37;
  border-radius: 6px 0 0 0;
}
.tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}
.pin-mark { color: #d4af37; font-size: 12px; }
.tab-close {
  font-size: 14px;
  color: #ccc;
  border-radius: 3px;
  padding: 1px;
  transition: 0.15s;
}
.tab-close:hover {
  background: #f0f0f0;
  color: #f56c6c;
}

.tabs-actions {
  display: flex;
  gap: 4px;
  align-items: center;
  padding-left: 8px;
  border-left: 1px solid #ececec;
  height: 100%;
}
.tab-action-btn {
  border: none; background: transparent; cursor: pointer;
  width: 28px; height: 28px;
  border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  color: #999;
  transition: 0.15s;
}
.tab-action-btn:hover { background: #f0f0f0; color: #d4af37; }

/* 右键菜单 */
.ctx-menu {
  position: fixed;
  background: #fff;
  box-shadow: 0 6px 20px rgba(0,0,0,0.18);
  border-radius: 8px;
  padding: 6px 0;
  min-width: 160px;
  z-index: 10000;
  border: 1px solid #f0f0f0;
}
.ctx-item {
  padding: 7px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #333;
  cursor: pointer;
  transition: 0.1s;
}
.ctx-item:hover { background: #fdf6ec; color: #d4af37; }
.ctx-item.disabled { color: #ccc; cursor: not-allowed; }
.ctx-item.disabled:hover { background: transparent; }
.ctx-divider { height: 1px; background: #f0f0f0; margin: 4px 0; }

@media (max-width: 768px) {
  .breadcrumb {
    padding: 6px 12px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .bc-desktop { display: none; }
  .bc-item.current {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: calc(100vw - 80px);
  }
  .tabs-strip {
    height: auto;
    min-height: 44px;
    padding: 4px 6px;
  }
  .tab-chip {
    padding: 8px 12px;
    min-height: 40px;
    max-width: 160px;
    margin-top: 0;
  }
  .tab-name { max-width: 120px; }
  .tab-action-btn {
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
  }
  .tabs-actions {
    padding-left: 6px;
    flex-shrink: 0;
  }
}
</style>
