<template>
  <div class="content-factory">
    <div class="cf-module-header">
      <div class="cf-title-box">
        <h2>内容工厂</h2>
        <span class="cf-subtitle">Content Factory · Phase 1</span>
        <div class="cf-flow-hint">
          <span
            v-for="(step, i) in flowSteps"
            :key="step.key"
            class="cf-flow-step"
            :class="{ 'is-active': activeTab === step.tab }"
          >{{ i + 1 }}. {{ step.label }}</span>
        </div>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="cf-tabs">
      <el-tab-pane label="看板" name="kanban" lazy>
        <ContentKanban ref="kanbanRef" @open-review="openReview" />
      </el-tab-pane>
      <el-tab-pane label="选题库" name="topics" lazy>
        <TopicLibrary @picked="onTopicPicked" />
      </el-tab-pane>
      <el-tab-pane label="母素材库" name="assets" lazy>
        <AssetLibrary @repurposed="onRepurposed" />
      </el-tab-pane>
      <el-tab-pane label="复盘" name="review" lazy>
        <ContentReview />
      </el-tab-pane>
      <el-tab-pane label="话术宪法" name="constitution" lazy>
        <div class="cf-constitution cf-subpanel">
          <ConstitutionPanel />
          <div class="cf-card cf-ts-wrap">
            <div class="cf-subheader">
              <h3>沟通锦囊</h3>
              <p>TalkingScriptCard · 内容触达话术试写</p>
            </div>
            <TalkingScriptCard :profile="talkingProfile" default-scenario="general" :auto-reset="false" />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <ReviewDrawer v-model="reviewOpen" :piece="reviewPiece" @done="onKanbanRefresh" />
  </div>
</template>

<script setup>
import { ref, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
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

const flowSteps = [
  { key: 'topics', tab: 'topics', label: '选题' },
  { key: 'kanban', tab: 'kanban', label: '撰写·终审' },
  { key: 'review', tab: 'review', label: '复盘飞轮' },
  { key: 'constitution', tab: 'constitution', label: '话术宪法' },
]

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

async function onTopicPicked() {
  activeTab.value = 'kanban'
  await nextTick()
  kanbanRef.value?.load?.()
  ElMessage.success('已加入看板，已切换到「看板」Tab')
}

async function onRepurposed() {
  activeTab.value = 'kanban'
  await nextTick()
  kanbanRef.value?.load?.()
  ElMessage.success('成品已写入看板')
}

defineExpose({ activeTab })
</script>

<style scoped>
.cf-constitution {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.cf-ts-wrap {
  margin-top: var(--space-2);
}
</style>
