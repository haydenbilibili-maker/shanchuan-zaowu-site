<template>
  <div class="content-factory">
    <div class="ai-header">
      <h3>🏭 内容工厂</h3>
      <p class="subtitle">选题 → 撰写 → 终审 → 发布登记 → 复盘 · 话术宪法守门</p>
    </div>

    <el-tabs v-model="activeTab" class="cf-tabs">
      <el-tab-pane label="看板" name="kanban">
        <ContentKanban ref="kanbanRef" @open-review="openReview" />
      </el-tab-pane>
      <el-tab-pane label="选题库" name="topics">
        <TopicLibrary @picked="onKanbanRefresh" />
      </el-tab-pane>
      <el-tab-pane label="母素材库" name="assets">
        <AssetLibrary @repurposed="onKanbanRefresh" />
      </el-tab-pane>
      <el-tab-pane label="复盘" name="review">
        <ContentReview />
      </el-tab-pane>
      <el-tab-pane label="话术宪法" name="constitution">
        <div class="cf-constitution">
          <ConstitutionPanel />
          <div class="section-card ts-wrap">
            <h4>🤖 沟通锦囊</h4>
            <p class="card-sub">复用 TalkingScriptCard · 内容触达话术试写</p>
            <TalkingScriptCard :profile="talkingProfile" default-scenario="general" :auto-reset="false" />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <ReviewDrawer v-model="reviewOpen" :piece="reviewPiece" @done="onKanbanRefresh" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import ContentKanban from './content/ContentKanban.vue'
import TopicLibrary from './content/TopicLibrary.vue'
import AssetLibrary from './content/AssetLibrary.vue'
import ContentReview from './content/ContentReview.vue'
import ConstitutionPanel from './content/ConstitutionPanel.vue'
import ReviewDrawer from './content/ReviewDrawer.vue'
import TalkingScriptCard from './TalkingScriptCard.vue'

const activeTab = ref('kanban')
const reviewOpen = ref(false)
const reviewPiece = ref(null)
const kanbanRef = ref(null)

const talkingProfile = {
  openid: 'content-factory',
  nickName: '内容工厂编辑',
  segment: '内容营销',
  tags: ['山海造物', '标本美学', 'GRAVITY'],
  rfm: { recency: 'active', frequency: 'medium', monetary: 'medium' },
  recentBehaviors: ['浏览标本展柜', '撰写小红书文案'],
}

function openReview(piece) {
  reviewPiece.value = piece
  reviewOpen.value = true
}

function onKanbanRefresh() {
  reviewPiece.value = null
  if (activeTab.value === 'kanban') {
    kanbanRef.value?.load?.()
  }
}
</script>

<style scoped>
.content-factory {
  padding: 24px;
  background: #000;
  color: #e0e0e0;
  min-height: 480px;
}

.ai-header h3 {
  color: #d4af37;
  margin: 0 0 8px 0;
  font-size: 1.25rem;
}

.subtitle {
  color: #888;
  margin: 0 0 20px 0;
  font-size: 0.875rem;
}

.cf-tabs :deep(.el-tabs__header) {
  margin-bottom: 16px;
}

.cf-tabs :deep(.el-tabs__item) {
  color: #888;
}

.cf-tabs :deep(.el-tabs__item.is-active) {
  color: #d4af37;
}

.cf-tabs :deep(.el-tabs__active-bar) {
  background-color: #d4af37;
}

.cf-tabs :deep(.el-tabs__nav-wrap::after) {
  background-color: rgba(212, 175, 55, 0.15);
}

.cf-constitution {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.section-card {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.02) 100%);
  border: 1px solid rgba(212, 175, 55, 0.2);
  border-radius: 12px;
  padding: 20px;
}

.section-card h4 {
  color: #d4af37;
  margin: 0 0 6px 0;
}

.card-sub {
  color: #888;
  font-size: 13px;
  margin: 0 0 16px 0;
}

.ts-wrap :deep(.ts-card) {
  background: transparent;
  border: none;
  padding: 0;
}
</style>
