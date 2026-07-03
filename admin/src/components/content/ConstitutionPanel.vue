<template>
  <div class="constitution-panel">
    <div class="ai-header">
      <h3>📜 话术宪法试写 / 校验</h3>
      <p class="subtitle">标本不作主语；主语只能是光/空气/季节/容器/看的人/时刻/产地/寂静</p>
    </div>

    <el-form label-width="100px">
      <el-form-item label="IP 调性">
        <el-select v-model="form.ip" style="width: 160px">
          <el-option label="GRAVITY · 沉静" value="GRAVITY" />
          <el-option label="LIGHTNESS · 明亮" value="LIGHTNESS" />
        </el-select>
      </el-form-item>
      <el-form-item label="平台">
        <el-select v-model="form.platform" style="width: 160px">
          <el-option label="小红书" value="xhs" />
          <el-option label="抖音" value="douyin" />
          <el-option label="视频号" value="shipinhao" />
          <el-option label="B站" value="bilibili" />
        </el-select>
      </el-form-item>
      <el-form-item label="待检文案">
        <el-input v-model="form.text" type="textarea" :rows="6" placeholder="粘贴或输入待校验文案" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="loading" @click="runCheck">合规校验</el-button>
        <el-button :loading="loading" @click="runDraft">AI 起草</el-button>
      </el-form-item>
    </el-form>

    <el-row :gutter="16" style="margin-bottom: 16px">
      <el-col v-for="(ex, i) in examples" :key="i" :span="24" style="margin-bottom: 10px">
        <div class="ex-pair">
          <el-tag size="small" type="info">{{ ex.category }}</el-tag>
          <div class="ex-line bad">❌ {{ ex.forbidden }}</div>
          <div class="ex-line good">✅ {{ ex.compliant }}</div>
        </div>
      </el-col>
    </el-row>

    <div v-if="result" class="result-box">
      <el-alert
        :type="result.passed ? 'success' : 'error'"
        :title="result.passed ? '通过话术宪法' : '未通过话术宪法'"
        :closable="false"
        show-icon
      />
      <div v-if="result.violations?.length" class="rv-list">
        <div class="rv-label">违规项</div>
        <ul><li v-for="(v, i) in result.violations" :key="i">{{ v }}</li></ul>
      </div>
      <div v-if="result.rewritten" class="rv-rewritten">
        <div class="rv-label">合规改写</div>
        <p>{{ result.rewritten }}</p>
        <el-button size="small" @click="copy(result.rewritten)">复制</el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useContentAgents } from '../../composables/useContentAgents'
import { EXAMPLES } from '../../config/contentConstitution'

const { constitutionCheck } = useContentAgents()

const loading = ref(false)
const result = ref(null)
const examples = EXAMPLES
const form = ref({
  ip: 'GRAVITY',
  platform: 'xhs',
  text: '这只标本在展示柜里特别好看，宝宝们快来看',
})

async function runCheck() {
  if (!form.value.text.trim()) {
    ElMessage.warning('请输入文案')
    return
  }
  loading.value = true
  try {
    result.value = await constitutionCheck({ mode: 'check', ...form.value })
  } catch (e) {
    ElMessage.error(e.message || '校验失败')
  } finally {
    loading.value = false
  }
}

async function runDraft() {
  loading.value = true
  try {
    const res = await constitutionCheck({ mode: 'draft', ...form.value })
    result.value = res
    if (res.rewritten) form.value.text = res.rewritten
  } catch (e) {
    ElMessage.error(e.message || '起草失败')
  } finally {
    loading.value = false
  }
}

function copy(text) {
  navigator.clipboard?.writeText(text)
  ElMessage.success('已复制')
}
</script>

<style scoped>
.constitution-panel {
  max-width: 800px;
}

.ai-header h3 {
  color: #d4af37;
  margin: 0 0 6px 0;
}

.subtitle {
  color: #888;
  margin: 0 0 20px 0;
  font-size: 13px;
}

.ex-pair {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(212, 175, 55, 0.15);
}

.ex-line {
  font-size: 13px;
  line-height: 1.55;
  margin-top: 6px;
}

.ex-line.bad { color: #e8a090; }
.ex-line.good { color: #a8d5b5; }

.result-box {
  margin-top: 16px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(212, 175, 55, 0.2);
  border-radius: 10px;
}

.rv-label {
  font-size: 12px;
  font-weight: 600;
  margin: 12px 0 6px;
  color: #888;
}

.rv-rewritten p {
  line-height: 1.6;
  margin: 0 0 8px;
  color: #e0e0e0;
}

:deep(.el-form-item__label) { color: #ccc; }

:deep(.el-input__inner),
:deep(.el-select .el-input__inner),
:deep(.el-textarea__inner) {
  background: rgba(0, 0, 0, 0.35);
  border-color: rgba(212, 175, 55, 0.25);
  color: #e0e0e0;
}
</style>
