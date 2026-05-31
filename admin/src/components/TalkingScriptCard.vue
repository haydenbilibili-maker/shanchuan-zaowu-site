<template>
  <div class="ts-card">
    <div class="ts-head">
      <span class="ts-title">🤖 AI 沟通锦囊</span>
      <div class="ts-actions">
        <el-select v-model="scenario" size="small" style="width: 140px" @change="regen">
          <el-option label="通用触达" value="general" />
          <el-option label="客服场景" value="support_ticket" />
          <el-option label="召回沉睡" value="inactive" />
          <el-option label="新客承接" value="new_user" />
        </el-select>
        <el-button size="small" :icon="MagicStick" type="primary" color="#d4af37" :loading="loading" @click="run">
          {{ data ? '重新生成' : '生成锦囊' }}
        </el-button>
      </div>
    </div>

    <div v-if="!data && !loading && !error" class="ts-empty">
      <div class="ts-empty-icon">✨</div>
      <div class="ts-empty-text">点击「生成锦囊」由 LLM 基于 RFM/标签/最近行为产出可执行话术</div>
    </div>

    <div v-if="loading" class="ts-loading">
      <el-icon class="is-loading" :size="20"><Loading /></el-icon>
      <span>正在生成…（首次约 5-10 秒）</span>
    </div>

    <el-alert v-if="error" :title="error" type="warning" :closable="true" show-icon />

    <div v-if="data" class="ts-body">
      <!-- 一句话画像 -->
      <div class="ts-headline">
        <span class="ts-tag">画像</span>
        <span class="ts-headtext">{{ data.headline }}</span>
      </div>

      <!-- 时机 -->
      <div class="ts-section">
        <div class="ts-section-title">⏰ 最佳触达时机</div>
        <div class="ts-section-content">{{ data.timing }}</div>
      </div>

      <!-- 话术 -->
      <div class="ts-section">
        <div class="ts-section-title">💬 话术建议</div>
        <div v-for="(s, i) in data.scripts || []" :key="i" class="ts-script">
          <div class="ts-script-channel">{{ s.channel }}</div>
          <div class="ts-script-text">
            {{ s.content }}
            <el-button link size="small" :icon="CopyDocument" @click="copy(s.content)">复制</el-button>
          </div>
        </div>
      </div>

      <!-- 推荐 -->
      <div class="ts-section">
        <div class="ts-section-title">🎁 推荐策略</div>
        <ul class="ts-list">
          <li v-for="(r, i) in data.recommendations || []" :key="i">{{ r }}</li>
        </ul>
      </div>

      <!-- 风险 -->
      <div v-if="data.risks?.length" class="ts-section">
        <div class="ts-section-title">⚠️ 风险提示</div>
        <ul class="ts-list ts-risk">
          <li v-for="(r, i) in data.risks" :key="i">{{ r }}</li>
        </ul>
      </div>

      <!-- 期望动作 -->
      <div v-if="data.expectedAction" class="ts-footer">
        <span class="ts-foot-label">目标动作 →</span>
        <span class="ts-foot-action">{{ data.expectedAction }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { MagicStick, Loading, CopyDocument } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { generateTalkingScript } from '../utils/llmTalkingScript'

const props = defineProps({
  profile: { type: Object, default: null },
  // 默认场景，工单嵌入时可传 'support_ticket'
  defaultScenario: { type: String, default: 'general' },
  // 是否在 profile 变化时自动清空
  autoReset: { type: Boolean, default: true }
})

const loading = ref(false)
const data = ref(null)
const error = ref('')
const scenario = ref(props.defaultScenario)

watch(() => props.profile?.openid, () => {
  if (props.autoReset) {
    data.value = null
    error.value = ''
  }
})

const run = async () => {
  if (!props.profile) {
    ElMessage.warning('未提供用户画像')
    return
  }
  loading.value = true
  error.value = ''
  try {
    const res = await generateTalkingScript(props.profile, { scenario: scenario.value })
    if (res.ok) {
      data.value = res.data
    } else {
      error.value = res.error || '调用失败'
      // 兜底：模型未配置时给一个本地规则版的锦囊，避免空白
      if ((res.error || '').includes('API') || (res.error || '').includes('key')) {
        data.value = buildLocalFallback(props.profile, scenario.value)
        error.value = '未配置 LLM API Key，已使用本地规则模板兜底（建议在 .env 配置 VITE_GEMINI_API_KEYS）'
      }
    }
  } catch (e) {
    error.value = e?.message || '运行异常'
  } finally {
    loading.value = false
  }
}
const regen = () => { if (data.value) run() }

const copy = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制')
  } catch (e) {
    ElMessage.warning('复制失败，请手动选择')
  }
}

// ====== 本地规则兜底 ======
function buildLocalFallback(p, sc) {
  const seg = p.segmentMeta?.name || '该客户'
  const monPart = p.monetary > 0 ? `累计 ¥${p.monetary.toLocaleString()}` : '尚未消费'
  const tagPart = (p.tags || []).map(t => t.label).slice(0, 2).join('、') || '无显著偏好'
  return {
    headline: `${seg} · ${tagPart}`,
    timing: sc === 'inactive'
      ? '建议在周末早上 10-11 点或周日晚上 8-9 点触达，频次每月 1-2 次为宜。'
      : '建议工作日午休或晚间 7-9 点触达，最近订单后 7-14 天为复购黄金窗口。',
    scripts: [
      { channel: '微信',
        content: `您好，山海造物长春馆 ${p.nickName || '朋友'}。${monPart}的支持让我们记住您。本月新上一批 ${tagPart || '精品'}，方便时回复 1，我把图鉴发您。` },
      { channel: '电话',
        content: `您好我是山海造物的运营，看到您是我们的 ${seg}。想和您聊聊本月新品与权益升级，您方便接听 2 分钟吗？` }
    ],
    recommendations: [
      `根据偏好「${tagPart}」推荐对应专题的限时礼盒`,
      p.frequency >= 2 ? '邀请加入「藏家社群」，获取新品优先购权益' : '发放 30 元新人券激活首次到店',
      '推送门店参观+鉴定服务的预约入口，转化到线下体验'
    ],
    risks: p.recencyDays > 60
      ? ['用户长期未活跃，话术需轻量化避免反感', '不建议高频次推送，先观察打开率']
      : ['首次触达建议先以服务价值开场，避免过于硬销售'],
    expectedAction: p.frequency === 0 ? '完成首单或预约到店' : '复购 / 推荐朋友'
  }
}
</script>

<style scoped>
.ts-card { background: linear-gradient(135deg, #fffbf0, #fff); border: 1px solid #f3e6c0; border-radius: 12px; padding: 16px 18px; }
.ts-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.ts-title { font-weight: bold; color: #b7950b; font-size: 14px; }
.ts-actions { display: flex; gap: 8px; align-items: center; }

.ts-empty { text-align: center; padding: 24px 0; color: #999; }
.ts-empty-icon { font-size: 32px; margin-bottom: 8px; }
.ts-empty-text { font-size: 13px; }

.ts-loading { display: flex; gap: 8px; align-items: center; padding: 20px; color: #d4af37; justify-content: center; }

.ts-body { display: flex; flex-direction: column; gap: 14px; }

.ts-headline { background: linear-gradient(135deg, #d4af37, #b7950b); color: #fff; padding: 10px 14px; border-radius: 8px; display: flex; align-items: center; gap: 10px; }
.ts-tag { background: rgba(255,255,255,0.25); padding: 2px 8px; border-radius: 4px; font-size: 11px; }
.ts-headtext { font-weight: bold; font-size: 14px; }

.ts-section { background: #fff; border-radius: 8px; padding: 10px 14px; border: 1px solid #f5f5f5; }
.ts-section-title { font-weight: 600; color: #333; font-size: 13px; margin-bottom: 6px; }
.ts-section-content { color: #555; font-size: 13px; line-height: 1.7; }

.ts-script { background: #fafafa; border-left: 3px solid #d4af37; padding: 8px 12px; border-radius: 6px; margin-top: 6px; }
.ts-script-channel { font-size: 11px; color: #b7950b; font-weight: bold; margin-bottom: 4px; }
.ts-script-text { color: #333; font-size: 13px; line-height: 1.7; }

.ts-list { padding-left: 20px; margin: 0; }
.ts-list li { line-height: 1.8; color: #555; font-size: 13px; }
.ts-list.ts-risk li { color: #c95350; }

.ts-footer { background: #fdf6ec; padding: 8px 14px; border-radius: 8px; font-size: 12px; display: flex; gap: 10px; align-items: center; }
.ts-foot-label { color: #999; }
.ts-foot-action { color: #b7950b; font-weight: bold; }
</style>
