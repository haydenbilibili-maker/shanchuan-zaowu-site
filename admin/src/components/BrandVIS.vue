<template>
  <div class="brand-vis module-wrapper">
    <div class="module-header">
      <div class="title-box">
        <h2>品牌 VIS</h2>
        <span class="subtitle">BRAND VISUAL IDENTITY · 基于方案 D</span>
      </div>
      <div class="actions">
        <el-tag size="small" type="warning" effect="plain">方案 D · 待终审</el-tag>
        <el-tag size="small" type="success" effect="plain">全端规范基准</el-tag>
        <el-button size="small" @click="reload">刷新</el-button>
      </div>
    </div>

    <div class="vis-banner">
      <strong>当前状态：</strong>Logo 方向为「单字山印章 × 横版字标」（方案 D），已出自然绿 / 墨黑 / 反白 / 纯图形 / 单色雕刻五版。
      定稿前请勿用于对外印刷物料；后续所有设计工作（官网 / 小程序 / 包装 / 内容）以本模块为唯一规范基准。
    </div>

    <el-tabs v-model="activeTab" class="vis-tabs">
      <!-- ============ 1. Logo 规范 ============ -->
      <el-tab-pane label="Logo 规范" name="logo">
        <div class="vis-grid-2">
          <div v-for="v in variants" :key="v.file" class="vis-card">
            <div class="vis-card-head">
              <span class="vis-card-title">{{ v.name }}</span>
              <span class="vis-card-en">{{ v.en }}</span>
            </div>
            <div class="vis-logo-stage" :class="{ dark: v.dark }">
              <img :src="asset(v.file)" :alt="v.name" class="vis-logo-img" />
            </div>
            <p class="vis-card-desc">{{ v.desc }}</p>
            <p class="vis-card-use"><b>适用：</b>{{ v.use }}</p>
            <el-button size="small" :href="asset(v.file)" download tag="a">下载 SVG</el-button>
          </div>
        </div>

        <div class="vis-card">
          <div class="vis-card-head"><span class="vis-card-title">锁标结构与安全区</span></div>
          <div class="vis-rules-grid">
            <div class="vis-rule"><span class="vis-rule-no">01</span><div><b>构成</b><p>单字山印章（符号）在左，「山海造物」宋体字标在右，英文 <i>NATURE'S CREATIONS</i> 列下，三者为一个整体，不得拆用。</p></div></div>
            <div class="vis-rule"><span class="vis-rule-no">02</span><div><b>安全区</b><p>四周留白不小于印章直径的 1/6（约 16px @100px 印章）；安全区内不得出现其他元素。</p></div></div>
            <div class="vis-rule"><span class="vis-rule-no">03</span><div><b>最小尺寸</b><p>标准版印章直径 ≥12mm；纯图形版 ≥8mm；小于 8mm 禁止使用标志。</p></div></div>
            <div class="vis-rule"><span class="vis-rule-no">04</span><div><b>与产品名并排</b><p>标志在左或上方；禁止把标志作为文字的一部分嵌入句子。</p></div></div>
          </div>
        </div>

        <div class="vis-card">
          <div class="vis-card-head"><span class="vis-card-title">禁止用法</span></div>
          <el-row :gutter="12">
            <el-col v-for="(f, i) in forbidden" :key="i" :xs="12" :sm="8" :md="6">
              <div class="vis-forbidden">✗ {{ f }}</div>
            </el-col>
          </el-row>
        </div>
      </el-tab-pane>

      <!-- ============ 2. 色彩系统 ============ -->
      <el-tab-pane label="色彩系统" name="colors">
        <div class="vis-card">
          <div class="vis-card-head"><span class="vis-card-title">品牌主色（VI v2.0 五色体系）</span></div>
          <div class="vis-color-grid">
            <div v-for="c in brandColors" :key="c.hex" class="vis-color-card">
              <div class="vis-swatch" :style="{ background: c.hex }"></div>
              <div class="vis-color-meta">
                <b>{{ c.name }}</b>
                <code>{{ c.hex }}</code>
                <p>{{ c.rule }}</p>
              </div>
            </div>
          </div>
        </div>
        <div class="vis-card">
          <div class="vis-card-head"><span class="vis-card-title">品类专属色（包装标签 / 分类图标）</span></div>
          <div class="vis-color-grid">
            <div v-for="c in categoryColors" :key="c.hex" class="vis-color-card">
              <div class="vis-swatch" :style="{ background: c.hex }"></div>
              <div class="vis-color-meta">
                <b>{{ c.name }}</b>
                <code>{{ c.hex }}</code>
                <p>{{ c.rule }}</p>
              </div>
            </div>
          </div>
        </div>
        <div class="vis-card">
          <div class="vis-card-head"><span class="vis-card-title">印章与文字色（方案 D 用色）</span></div>
          <div class="vis-color-grid">
            <div v-for="c in sealColors" :key="c.hex" class="vis-color-card">
              <div class="vis-swatch" :style="{ background: c.hex }"></div>
              <div class="vis-color-meta">
                <b>{{ c.name }}</b>
                <code>{{ c.hex }}</code>
                <p>{{ c.rule }}</p>
              </div>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <!-- ============ 3. 字体规范 ============ -->
      <el-tab-pane label="字体规范" name="fonts">
        <div class="vis-card">
          <div class="vis-card-head"><span class="vis-card-title">字体家族</span></div>
          <div class="vis-font-grid">
            <div class="vis-font-item">
              <div class="vis-font-sample cn">山海造物</div>
              <p><b>中文（首选）</b> 思源宋体 Heavy</p>
              <p><b>中文（备选）</b> 仓耳今楷 ExtraBold</p>
            </div>
            <div class="vis-font-item">
              <div class="vis-font-sample en">NATURE'S CREATIONS</div>
              <p><b>英文</b> Georgia / Times New Roman</p>
              <p><b>场景</b> 英文副标、拉丁学名</p>
            </div>
          </div>
        </div>
        <div class="vis-card">
          <div class="vis-card-head"><span class="vis-card-title">文字层级（VI v2.0）</span></div>
          <el-table :data="fontLevels" size="small" border class="vis-table">
            <el-table-column prop="level" label="层级" width="120" />
            <el-table-column prop="scene" label="应用场景" />
            <el-table-column prop="size" label="字号" width="110" />
            <el-table-column prop="weight" label="字重" width="110" />
            <el-table-column label="色彩" width="150">
              <template #default="{ row }"><span :style="{ color: row.color }">■</span> {{ row.colorLabel }} <code>{{ row.color }}</code></template>
            </el-table-column>
          </el-table>
        </div>
        <div class="vis-card">
          <div class="vis-card-head"><span class="vis-card-title">包装信息层文案结构（每件 SKU 品牌卡片背面）</span></div>
          <div class="vis-copy-stack">
            <div class="vis-copy-line"><span class="vis-copy-tag">第一层 · 事实</span> 物种名 + 产地 + 一句话科学事实（如“蓝闪蝶 Morpho menelaus，产自南美亚马逊流域”）</div>
            <div class="vis-copy-line"><span class="vis-copy-tag">第二层 · 感受</span> 这件产品在你生活中的画面（“放在书架上，午后的光穿过羽翼”）</div>
            <div class="vis-copy-line"><span class="vis-copy-tag">第三层 · 连接</span> 你和这件自然之物的关系（“一座雨林里的光，现在就在你手边”）</div>
          </div>
        </div>
      </el-tab-pane>

      <!-- ============ 4. 使用规则 ============ -->
      <el-tab-pane label="使用规则" name="rules">
        <div class="vis-card">
          <div class="vis-card-head"><span class="vis-card-title">版本矩阵（选版指南）</span></div>
          <el-table :data="versionMatrix" size="small" border class="vis-table">
            <el-table-column prop="version" label="版本" width="120" />
            <el-table-column prop="scene" label="适用场景" />
            <el-table-column prop="background" label="背景要求" width="220" />
          </el-table>
        </div>
        <div class="vis-card">
          <div class="vis-card-head"><span class="vis-card-title">品牌审查五关（每个新物料上线前）</span></div>
          <div class="vis-check-grid">
            <div v-for="(c, i) in checks" :key="i" class="vis-check">
              <el-checkbox v-model="checkStates[i]" />
              <div><b>{{ c.title }}</b><p>{{ c.desc }}</p></div>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <!-- ============ 5. 落地清单 ============ -->
      <el-tab-pane label="落地清单" name="tasks">
        <div class="vis-card">
          <div class="vis-card-head"><span class="vis-card-title">全端替换与规范落地</span></div>
          <el-table :data="tasks" size="small" border class="vis-table">
            <el-table-column label="事项" prop="title" />
            <el-table-column label="目标位置" prop="target" width="220" />
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <el-tag :type="row.done ? 'success' : 'info'" size="small" effect="plain">{{ row.done ? '已完成' : '待执行' }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <div class="vis-card">
          <div class="vis-card-head"><span class="vis-card-title">相关文档</span></div>
          <ul class="vis-doc-list">
            <li>品牌视觉识别手册 v2.0 / v2.02 —— Desktop/山海造物/山海造物-归档/01_品牌核心/_最新版/</li>
            <li>品牌专项工作流 —— docs/品牌专项_包装与Logo定稿_工作流_v1.md</li>
            <li>Logo 候选与对比 —— docs/品牌专项/logo-candidates/preview.html</li>
            <li>包装尺寸矩阵草案 —— docs/品牌专项/02_包装SKU与尺寸盘点.md</li>
          </ul>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const activeTab = ref('logo')
const BASE = import.meta.env.BASE_URL || '/admin/'
const asset = (f) => `${BASE}brand/${f}`

const variants = [
  { file: 'vis-logo-D-standard.svg', name: '标准版 · 自然绿', en: 'STANDARD · GREEN', desc: '印章自然绿 + 字标墨绿黑 + 英文大地棕，浅色背景日常主用。', use: '官网 / 小程序 / 包装盒面 / 品牌卡片', dark: false },
  { file: 'vis-logo-D-ink.svg', name: '墨黑版', en: 'INK', desc: '全墨黑印章与字标，印章气质最强。', use: '烫印 / 雕刻 / 极简与黑白场景', dark: false },
  { file: 'vis-logo-D-reverse.svg', name: '反白版', en: 'REVERSE', desc: '白色印章字标 + 黄铜英文，置于深墨绿底。', use: '深色背景 / 夜间主题 / 深底物料', dark: true },
  { file: 'vis-logo-D-mark.svg', name: '纯图形版', en: 'MARK · GREEN', desc: '仅单字山印章（自然绿），最小可用 ≥8mm。', use: 'favicon / 头像 / 水印 / 小尺寸', dark: false },
  { file: 'vis-logo-D-mark-mono.svg', name: '单色雕刻版', en: 'MARK · MONO', desc: '单色墨稿，供制版使用。', use: '凹印 / 烫印 / 雕刻 / 钢印', dark: false }
]

const forbidden = [
  '拉伸、压缩、旋转、斜切标志',
  '改变标志颜色（如变红、变金）',
  '加投影、发光、立体效果',
  '在花纹 / 照片上直接叠加（应用反白版）',
  '安全区内放其他元素',
  '标志旁添加装饰元素',
  '把标志嵌入句子作为文字',
  '将锁标拆开单独使用字标'
]

const brandColors = [
  { name: '自然绿', hex: '#2D6A4F', rule: '主色：标志、标题、强调元素。视觉面积 ≤30%，不大面积填充背景。' },
  { name: '大地棕', hex: '#8B6F47', rule: '辅助：副标题、拉丁学名、温暖点缀；不作为主色单独使用。' },
  { name: '矿物紫', hex: '#7B68AE', rule: '点缀：仅矿石品类标识，不在非矿石产品的包装/宣传中使用。' },
  { name: '微暖白', hex: '#FAFAF5', rule: '所有背景的默认色；禁止纯白 #FFFFFF 作背景。' },
  { name: '墨绿黑', hex: '#2C2C2C', rule: '文字色：正文、标题。' }
]

const categoryColors = [
  { name: '昆虫', hex: '#52B788', rule: '昆虫馆品类标签 / 分类图标' },
  { name: '矿物', hex: '#7B68AE', rule: '矿石馆品类标签 / 分类图标' },
  { name: '植物', hex: '#6DA34D', rule: '植物馆品类标签 / 分类图标' },
  { name: '海洋 / 化石', hex: '#5B8FB9', rule: '海洋馆品类标签 / 分类图标' }
]

const sealColors = [
  { name: '墨黑', hex: '#1A1A1A', rule: '印章墨稿（墨黑版 / 单色雕刻版）' },
  { name: '黄铜', hex: '#B08840', rule: '印章底色（黄铜底墨字场景）；深色背景英文副标用 #C4A76C' }
]

const fontLevels = [
  { level: '品牌名', scene: '门店招牌、包装主视觉', size: '根据场景', weight: 'Medium', color: '#2D6A4F', colorLabel: '自然绿' },
  { level: '主标题', scene: '系列名、类别名', size: '16-20pt', weight: 'Medium', color: '#2C2C2C', colorLabel: '墨绿黑' },
  { level: '物种中文名', scene: '品牌卡片、产品页', size: '13-16pt', weight: 'Medium', color: '#2D6A4F', colorLabel: '自然绿' },
  { level: '拉丁学名', scene: '品牌卡片、产品页', size: '9-11pt', weight: 'Regular Italic', color: '#8B6F47', colorLabel: '大地棕' },
  { level: '正文', scene: '科学冷知识、品牌故事', size: '9-11pt', weight: 'Regular', color: '#2C2C2C', colorLabel: '墨绿黑' },
  { level: 'Tagline', scene: '包装、门店、物料', size: '7-9pt', weight: 'Regular', color: '#A0A0A0', colorLabel: '浅灰' }
]

const versionMatrix = [
  { version: '标准版（绿）', scene: '浅色背景 / 日常全端 / 包装盒面 / 品牌卡片', background: '微暖白 #FAFAF5 或素色浅色背景' },
  { version: '墨黑版', scene: '烫印 / 雕刻 / 黑白印刷 / 极简物料', background: '微暖白或深色，单色工艺' },
  { version: '反白版', scene: '深色背景 / 夜间主题 / 深色包装', background: '品牌深绿 #1B4332 或墨绿黑' },
  { version: '纯图形版', scene: 'favicon / 头像 / 水印 / 小尺寸标签', background: '任意，按最小尺寸 ≥8mm' },
  { version: '单色雕刻版', scene: '凹印 / 烫印 / 雕刻 / 钢印', background: '单色制版，不依赖背景' }
]

const checks = [
  { title: 'Logo 版本正确', desc: '浅底用标准版、深底用反白版；小尺寸用纯图形版；制版用单色版。' },
  { title: '色彩合规', desc: '只使用本模块色彩系统内色值，无自创色；矿物紫仅限矿石品类。' },
  { title: '字体层级合规', desc: '字号 / 字重 / 色彩符合层级表；拉丁学名斜体大地棕。' },
  { title: '文案语气合规', desc: '三层结构（事实 / 感受 / 连接）；固定标签；禁 emoji / 电商话术开头。' },
  { title: '禁止用法未触犯', desc: '无拉伸改色、无效果叠加、安全区干净、锁标未拆用。' }
]
const checkStates = ref(checks.map(() => false))

const tasks = [
  { title: 'Logo 终审定稿（创始人拍板）', target: '品牌专项 · Phase 0', done: false },
  { title: '官网 favicon 替换为纯图形版', target: 'shanchuanzaowu/public/favicon.svg', done: false },
  { title: '设计令牌对齐 VI 色值', target: 'admin/src/styles/design-tokens.css + tailwind.config.mjs', done: false },
  { title: '小程序头像 / 品牌水印替换', target: 'miniprogram/assets', done: false },
  { title: '品牌审查清单并入内容工厂 / 内容管理流程', target: 'admin/src/components/ContentFactory.vue', done: false },
  { title: '包装尺寸矩阵正式版（按本规范输出）', target: 'docs/品牌专项/02_包装SKU与尺寸盘点.md', done: false }
]

const reload = () => {
  activeTab.value = 'logo'
}
</script>

<style scoped>
.brand-vis { padding: 16px; }
.vis-banner {
  background: #fdf6e8; border: 1px solid #eadfc4; border-radius: 10px;
  padding: 12px 16px; font-size: 13px; line-height: 1.8; color: #6b5a2e; margin: 4px 0 16px;
}
.vis-banner strong { color: #a0842f; }
.vis-tabs :deep(.el-tabs__item) { font-weight: 600; }

.vis-grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; margin-bottom: 14px; }
.vis-card {
  background: #fff; border: 1px solid #ece7db; border-radius: 12px;
  padding: 16px; margin-bottom: 14px; box-shadow: 0 2px 8px rgba(44, 44, 44, 0.04);
}
.vis-card-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 12px; }
.vis-card-title { font-size: 15px; font-weight: 700; letter-spacing: 1px; }
.vis-card-en { font-size: 11px; color: #9a917c; letter-spacing: 1.5px; }
.vis-card-desc { font-size: 13px; color: #555; line-height: 1.7; margin: 10px 0 6px; }
.vis-card-use { font-size: 12px; color: #777; line-height: 1.6; margin-bottom: 10px; }
.vis-card-use b { color: #2D6A4F; }

.vis-logo-stage {
  background: #FAFAF5; border: 1px dashed #ddd6c4; border-radius: 10px;
  min-height: 170px; display: flex; align-items: center; justify-content: center; padding: 14px;
}
.vis-logo-stage.dark { background: #1B4332; border-color: #245a42; }
.vis-logo-img { max-width: 100%; max-height: 150px; width: auto; }

.vis-rules-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.vis-rule { display: flex; gap: 10px; align-items: flex-start; }
.vis-rule-no { font-size: 18px; font-weight: 800; color: #C4A76C; line-height: 1.2; }
.vis-rule b { font-size: 13px; }
.vis-rule p { font-size: 12px; color: #666; line-height: 1.7; margin: 2px 0 0; }

.vis-forbidden {
  background: #fdf2f0; border: 1px solid #f0d9d4; border-radius: 8px;
  font-size: 12px; color: #a5544a; padding: 8px 10px; margin-bottom: 10px; line-height: 1.5;
}

.vis-color-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.vis-color-card { border: 1px solid #ece7db; border-radius: 10px; overflow: hidden; background: #fff; }
.vis-swatch { height: 64px; }
.vis-color-meta { padding: 10px 12px; }
.vis-color-meta b { font-size: 13px; display: block; }
.vis-color-meta code { font-size: 12px; color: #8B6F47; }
.vis-color-meta p { font-size: 12px; color: #777; line-height: 1.6; margin: 4px 0 0; }

.vis-font-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
.vis-font-item { border: 1px solid #ece7db; border-radius: 10px; padding: 16px; background: #fff; }
.vis-font-sample { font-size: 30px; margin-bottom: 8px; }
.vis-font-sample.cn { font-family: 'Songti SC', 'STSong', 'Noto Serif SC', 'Source Han Serif SC', serif; font-weight: 700; color: #2C2C2C; }
.vis-font-sample.en { font-family: Georgia, 'Times New Roman', serif; letter-spacing: 3px; color: #8B6F47; }
.vis-font-item p { font-size: 12px; color: #666; line-height: 1.7; margin: 0; }
.vis-font-item b { color: #2D6A4F; }

.vis-table { margin-top: 4px; }
.vis-copy-stack { display: flex; flex-direction: column; gap: 10px; }
.vis-copy-line { font-size: 13px; color: #444; line-height: 1.7; background: #faf8f2; border: 1px solid #ece7db; border-radius: 8px; padding: 10px 12px; }
.vis-copy-tag { display: inline-block; background: #2D6A4F; color: #fff; font-size: 11px; border-radius: 4px; padding: 1px 8px; margin-right: 8px; vertical-align: 1px; }

.vis-check-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px; }
.vis-check { display: flex; gap: 10px; align-items: flex-start; border: 1px solid #ece7db; border-radius: 10px; padding: 10px 12px; background: #fff; }
.vis-check b { font-size: 13px; }
.vis-check p { font-size: 12px; color: #777; line-height: 1.6; margin: 2px 0 0; }

.vis-doc-list { margin: 0; padding-left: 18px; }
.vis-doc-list li { font-size: 12px; color: #666; line-height: 2; }
</style>
