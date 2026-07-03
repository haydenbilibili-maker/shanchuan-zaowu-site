<template>
  <div class="cf-subpanel constitution-panel">
    <div class="cf-subheader">
      <h3>话术宪法试写 / 校验</h3>
      <p>标本不作主语；主语只能是光/空气/季节/容器/看的人/时刻/产地/寂静</p>
    </div>

    <div class="cf-card">
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
    </div>

    <el-row :gutter="16" style="margin: 16px 0">
      <el-col v-for="(ex, i) in examples" :key="i" :span="24" style="margin-bottom: 10px">
        <div class="cf-ex-pair">
          <el-tag size="small" type="info">{{ ex.category }}</el-tag>
          <div class="cf-ex-bad">❌ {{ ex.forbidden }}</div>
          <div class="cf-ex-good">✅ {{ ex.compliant }}</div>
        </div>
      </el-col>
    </el-row>

    <div v-if="result" class="cf-result-box">
      <el-alert
        :type="result.passed ? 'success' : 'error'"
        :title="result.passed ? '通过话术宪法' : '未通过话术宪法'"
        :closable="false"
        show-icon
      />
      <div v-if="result.violations?.length" class="rv-list">
        <div class="cf-rec-label">违规项</div>
        <ul><li v-for="(v, i) in result.violations" :key="i">{{ v }}</li></ul>
      </div>
      <div v-if="result.rewritten" class="rv-rewritten">
        <div class="cf-rec-label">合规改写</div>
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

.rv-rewritten p {
  line-height: var(--leading-loose);
  margin: 0 0 8px;
}

.rv-list ul {
  margin: 0;
  padding-left: 18px;
  font-size: var(--text-sm);
  color: var(--semantic-error-text);
}
</style>
