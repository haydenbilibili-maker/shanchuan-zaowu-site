<template>
  <div class="marketing-container">
    <el-row :gutter="30" style="height: calc(100vh - 120px);">
      <el-col :span="16" class="editor-col">
        <div class="panel-header">
          <h2>权益与营销中心</h2>
          <p class="panel-sub">会员等级体系已并入「客户经营 → 会员经营 → 等级」，不在本页维护。</p>
          <div class="tabs-wrapper">
            <el-radio-group v-model="activeModule" fill="#2D6A4F" @change="refreshData">
              <el-radio-button label="coupon">优惠券配置</el-radio-button>
              <el-radio-button label="reward">积分兑换</el-radio-button>
              <el-radio-button label="vip">会员权益卡</el-radio-button>
              <el-radio-button label="virtual">虚拟权益商品</el-radio-button>
            </el-radio-group>
          </div>
        </div>

        <!-- 集合缺失的诚实提示：不把「功能没接通」显示成「暂无数据」 -->
        <el-alert
          v-if="missingCollection"
          type="warning"
          show-icon
          :closable="false"
          class="missing-collection-alert"
          :title="`集合「${missingCollection}」尚未在云开发创建，本页暂时不可用`"
        >
          <template #default>
            经线上核对，该集合在云开发环境中不存在，因此<b>列表恒为空、新建与删除都不会生效</b>。
            需要先由技术同学在云开发控制台创建集合并配置安全规则，再回来使用本页 —— 这是环境未就绪，不是没有数据。
          </template>
        </el-alert>

        <div v-if="activeModule === 'coupon'" class="list-area">
          <div class="action-bar">
            <span class="tip">管理店铺优惠券，支持满减与折扣。</span>
            <el-button type="primary" icon="Plus" @click="openEditor('coupon')">新建优惠券</el-button>
          </div>
          <el-table :data="listData" v-loading="loading" @row-click="setPreview" highlight-current-row>
            <el-table-column prop="name" label="券名" />
            <el-table-column label="面额/折扣" width="120">
              <template #default="{ row }">
                <span v-if="row.type==='discount'" class="highlight">{{ row.value }}折</span>
                <span v-else class="highlight">¥{{ row.value }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="condition" label="门槛" />
            <el-table-column label="领取时间" min-width="150">
              <template #default="{ row }">
                {{ describeCouponWindow(row) || '不限' }}
              </template>
            </el-table-column>
            <el-table-column label="有效期" min-width="130">
              <template #default="{ row }">
                {{ describeCouponExpiry(row) }}
              </template>
            </el-table-column>
            <el-table-column label="渠道" width="110">
              <template #default="{ row }">
                {{ channelLabel(row.channel) }}
              </template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-switch v-model="row.active" active-color="var(--semantic-success-icon)" @change="toggleStatus(row, 'coupons')" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="100">
              <template #default="{ row }">
                <el-button link type="primary" @click.stop="editItem(row)">编辑</el-button>
                <el-button link type="danger" @click.stop="deleteItem(row, 'coupons')">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div v-if="activeModule === 'reward'" class="list-area">
          <div class="action-bar">
            <span class="tip">对齐小程序积分中心 · 集合 rewards · redeemReward</span>
            <el-button type="primary" icon="Plus" @click="openEditor('reward')">新建兑换品</el-button>
          </div>
          <el-table :data="listData" v-loading="loading" @row-click="setPreview" highlight-current-row empty-text="暂无积分兑换品">
            <el-table-column label="兑换品" min-width="180">
              <template #default="{ row }">
                <div style="display:flex;align-items:center;gap:10px;">
                  <img
                    v-if="row.httpImage"
                    :src="row.httpImage"
                    style="width:40px;height:40px;object-fit:cover;border-radius:6px;background:#f0f0f0;"
                  />
                  <div
                    v-else
                    style="width:40px;height:40px;border-radius:6px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;color:#bbb;flex-shrink:0;"
                  >
                    <el-icon><Picture /></el-icon>
                  </div>
                  <div>
                    <div>{{ row.title }}</div>
                    <div style="font-size:12px;color:#999;">{{ row.type }}</div>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="积分" width="100">
              <template #default="{ row }"><span class="highlight">{{ row.cost }} PTS</span></template>
            </el-table-column>
            <el-table-column prop="stock" label="库存" width="80" />
            <el-table-column label="券面值" width="100">
              <template #default="{ row }">{{ row.type === 'coupon' ? `¥${row.value || 0}` : '-' }}</template>
            </el-table-column>
            <el-table-column label="渠道" width="100">
              <template #default="{ row }">
                <span v-if="row.type === 'coupon'">{{ channelLabel(row.channel) }}</span>
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column label="上架" width="90">
              <template #default="{ row }">
                <el-switch
                  :model-value="!row.isOffShelf" active-color="var(--semantic-success-icon)"
                  @change="(v) => toggleRewardShelf(row, v)"
                />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="120">
              <template #default="{ row }">
                <el-button link type="primary" @click.stop="editItem(row)">编辑</el-button>
                <el-button link type="danger" @click.stop="deleteItem(row, 'rewards')">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty
            v-if="!loading && !listData.length"
            description="尚无兑换品。新建后小程序积分中心可兑换（集合 rewards）。"
            :image-size="72"
          />
        </div>

        <div v-if="activeModule === 'vip'" class="list-area">
          <div class="action-bar">
            <span class="tip">定义 VIP 等级与权益，卡面将显示在用户中心。</span>
            <el-button type="primary" icon="Plus" :disabled="!!missingCollection" @click="openEditor('vip')">新建会员卡</el-button>
          </div>
          <div class="vip-grid">
            <div 
              v-for="card in listData" 
              :key="card._id" 
              class="vip-item" 
              :class="{active: previewItem?._id === card._id}"
              @click="setPreview(card)"
            >
              <div class="vip-preview-mini" :style="getCardStyle(card.styleType)">
                <div class="v-name">{{ card.name }}</div>
                <div class="v-level">LV.{{ card.level }}</div>
              </div>
              <div class="vip-actions">
                <span class="price">¥{{ card.price }}/年</span>
                <el-button size="small" circle icon="Edit" @click.stop="editItem(card)" />
              </div>
            </div>
          </div>
        </div>

        <div v-if="activeModule === 'virtual'" class="list-area">
          <div class="action-bar">
            <span class="tip">无需物流的权益商品（如课程兑换码、礼品卡）。</span>
            <el-button type="primary" icon="Plus" :disabled="!!missingCollection" @click="openEditor('virtual')">发布权益品</el-button>
          </div>
          <el-table :data="listData" v-loading="loading" @row-click="setPreview" highlight-current-row>
            <el-table-column label="商品信息" min-width="200">
              <template #default="{ row }">
                <div style="display:flex; align-items:center; gap:10px;">
                  <div class="icon-box"><el-icon><Ticket /></el-icon></div>
                  <div>
                    <div style="font-weight:bold">{{ row.title }}</div>
                    <div style="font-size:12px; color:#999">{{ row.subTitle }}</div>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="price" label="售价" width="100">
              <template #default="{ row }"><span class="highlight">¥{{ row.price }}</span></template>
            </el-table-column>
            <el-table-column prop="stock" label="库存" width="100" />
            <el-table-column label="操作" width="150">
              <template #default="{ row }">
                <el-button link type="primary" @click.stop="editItem(row)">编辑</el-button>
                <el-button link type="danger" @click.stop="deleteItem(row, 'equity_goods')">下架</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-col>

      <el-col :span="8" class="preview-col">
        <div class="iphone-frame">
          <div class="iphone-notch"></div>
          <div class="iphone-screen">
            <div class="status-bar">
              <span>9:41</span>
              <span><el-icon><Connection /></el-icon></span>
            </div>
            <div class="preview-content">
              <div v-if="activeModule === 'coupon'" class="preview-coupon-wrap">
                <div class="p-title">优惠券预览</div>
                <div class="coupon-ticket" :class="{ 'editing': isEditing }">
                  <div class="c-left">
                    <div class="c-price">
                      <span v-if="previewItem.type==='discount'">{{ previewItem.value }}<span style="font-size:14px">折</span></span>
                      <span v-else><span style="font-size:14px">¥</span>{{ previewItem.value }}</span>
                    </div>
                    <div class="c-cond">{{ previewItem.condition || '无使用门槛' }}</div>
                  </div>
                  <div class="c-right">
                    <div class="c-name">{{ previewItem.name || '优惠券名称' }}</div>
                    <div class="c-time">有效期：{{ previewExpiryText }}</div>
                    <div class="c-btn">立即领取</div>
                  </div>
                </div>
                <div class="preview-tip">启用且在领取时间内的券，出现在小程序商品详情页「礼券」抽屉的「可领取」</div>
              </div>

              <div v-if="activeModule === 'vip'" class="preview-vip-wrap">
                <div class="p-title">会员中心视觉</div>
                <div class="vip-card-large" :style="getCardStyle(previewItem.styleType || 'black')">
                  <div class="card-top">
                    <div class="c-logo">山</div>
                    <div class="c-name">山海造物</div>
                  </div>
                  <div class="card-center">
                    <div class="c-level-name">{{ previewItem.name || '会员卡名称' }}</div>
                    <div class="c-level-num">LEVEL {{ previewItem.level || '1' }}</div>
                  </div>
                  <div class="card-bottom">
                    NO. 8888 8888
                  </div>
                </div>
                <div class="privilege-list">
                  <div class="p-item" v-for="(p, i) in (previewItem.privileges || [])" :key="i">
                    <el-icon><Select /></el-icon> {{ p }}
                  </div>
                  <div v-if="!previewItem.privileges?.length" style="color:#999; font-size:12px; text-align:center;">暂无权益配置</div>
                </div>
              </div>

              <div v-if="activeModule === 'virtual'" class="preview-goods-wrap">
                <div class="p-title">商品详情页</div>
                <div class="goods-cover-mock">
                  <el-icon size="40" color="#fff"><Picture /></el-icon>
                  <span>1:1 封面图</span>
                </div>
                <div class="goods-info-box">
                  <div class="g-price">¥ <span style="font-size:24px">{{ previewItem.price || '0.00' }}</span></div>
                  <div class="g-title">{{ previewItem.title || '商品标题' }}</div>
                  <div class="g-sub">{{ previewItem.subTitle || '商品副标题/简介' }}</div>
                  <div class="g-tags">
                    <span class="g-tag">自动发货</span>
                    <span class="g-tag">随时退</span>
                  </div>
                </div>
                <div class="buy-bar">
                  <div class="b-btn">立即购买</div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </el-col>
    </el-row>

    <el-dialog 
      v-model="dialogVisible" 
      :title="dialogTitle" 
      width="500px" 
      destroy-on-close
      :close-on-click-modal="false"
    >
      <el-form ref="moduleFormRef" :model="form" :rules="moduleFormRules" label-width="90px" label-position="left">
        <template v-if="activeModule === 'coupon'">
          <el-form-item label="优惠券名"><el-input v-model="form.name" placeholder="如：新客立减券" /></el-form-item>
          <el-form-item label="类型">
            <el-radio-group v-model="form.type">
              <el-radio value="cash">满减券(元)</el-radio>
              <el-radio value="discount">折扣券(折)</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="面额/数值"><el-input-number v-model="form.value" :min="0.1" :precision="1" /></el-form-item>
          <el-form-item label="使用门槛"><el-input v-model="form.condition" placeholder="如：无门槛 / 满100可用" /></el-form-item>
          <el-form-item label="门槛金额">
            <el-input-number v-model="form.minSpend" :min="0" :precision="0" />
            <span class="hint" style="margin-left:8px;color:#999;font-size:12px;">写入 minSpend，小程序运行时热读</span>
          </el-form-item>
          <el-form-item label="领取时间" prop="endTime">
            <div class="coupon-window">
              <el-date-picker
                v-model="form.startTime"
                type="datetime"
                value-format="YYYY-MM-DD HH:mm:ss"
                format="YYYY-MM-DD HH:mm:ss"
                placeholder="开始（不填=立即）"
              />
              <span class="coupon-window-sep">至</span>
              <el-date-picker
                v-model="form.endTime"
                type="datetime"
                value-format="YYYY-MM-DD HH:mm:ss"
                format="YYYY-MM-DD HH:mm:ss"
                placeholder="截止（不填=不限）"
              />
            </div>
            <span class="coupon-form-hint">北京时间；不填与以前一样，启用即可领</span>
          </el-form-item>
          <el-form-item label="到期方式" prop="fixedExpireTime">
            <el-radio-group v-model="form.expireMode">
              <el-radio value="days">领取后 N 天</el-radio>
              <el-radio value="fixed">固定到期日</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="form.expireMode === 'fixed'" label="统一到期">
            <el-date-picker
              v-model="form.fixedExpireTime"
              type="datetime"
              value-format="YYYY-MM-DD HH:mm:ss"
              format="YYYY-MM-DD HH:mm:ss"
              placeholder="北京时间，如 2026-11-15 23:59:59"
            />
            <span class="coupon-form-hint is-inline">领到的券都在这一刻失效</span>
          </el-form-item>
          <el-form-item v-else label="有效天数"><el-input-number v-model="form.expireDays" :min="1" :precision="0" /></el-form-item>
          <el-form-item label="每人限领"><el-input-number v-model="form.limitPerUser" :min="0" :precision="0" /></el-form-item>
          <el-form-item label="适用渠道">
            <el-radio-group v-model="form.channel">
              <el-radio value="online">仅线上商城</el-radio>
              <el-radio value="store">仅门店</el-radio>
              <el-radio value="all">线上+门店</el-radio>
            </el-radio-group>
          </el-form-item>
        </template>

        <template v-if="activeModule === 'reward'">
          <el-form-item label="标题" prop="title"><el-input v-model="form.title" placeholder="如：50 元优惠券" /></el-form-item>
          <el-form-item label="类型">
            <el-radio-group v-model="form.type">
              <el-radio value="coupon">优惠券</el-radio>
              <el-radio value="goods">实物</el-radio>
              <el-radio value="virtual">虚拟核销</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="所需积分" prop="cost"><el-input-number v-model="form.cost" :min="1" /></el-form-item>
          <el-form-item label="库存"><el-input-number v-model="form.stock" :min="0" /></el-form-item>
          <el-form-item v-if="form.type === 'coupon'" label="券面值" prop="value"><el-input-number v-model="form.value" :min="0" /></el-form-item>
          <el-form-item v-if="form.type === 'coupon'" label="使用门槛" prop="minSpend"><el-input-number v-model="form.minSpend" :min="0" /></el-form-item>
          <el-form-item v-if="form.type === 'coupon'" label="有效天数"><el-input-number v-model="form.expireDays" :min="1" /></el-form-item>
          <el-form-item v-if="form.type === 'coupon'" label="每人限兑"><el-input-number v-model="form.limitPerUser" :min="0" /></el-form-item>
          <el-form-item v-if="form.type === 'coupon'" label="适用渠道">
            <el-radio-group v-model="form.channel">
              <el-radio value="online">仅线上</el-radio>
              <el-radio value="store">仅门店</el-radio>
              <el-radio value="all">线上+门店</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="图片">
            <ImageUploadField
              v-model="form.image"
              folder="rewards"
              tip="上传成功后须再点「保存配置」，新图才会写入云库并同步小程序"
              preview-width="96px"
              preview-height="96px"
              @uploading-change="onImageUploading"
            />
          </el-form-item>
          <el-form-item label="说明"><el-input v-model="form.description" type="textarea" :rows="2" /></el-form-item>
        </template>

        <template v-if="activeModule === 'vip'">
          <el-form-item label="卡片名称"><el-input v-model="form.name" placeholder="如：黑金会员" /></el-form-item>
          <el-form-item label="等级权重"><el-input-number v-model="form.level" :min="1" placeholder="数字越大等级越高" /></el-form-item>
          <el-form-item label="售卖价格"><el-input-number v-model="form.price" :min="0" /> 元/年</el-form-item>
          <el-form-item label="卡面风格">
            <el-radio-group v-model="form.styleType">
              <el-radio value="black">黑金尊享</el-radio>
              <el-radio value="silver">流光白银</el-radio>
              <el-radio value="red">故宫丹红</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="权益列表">
            <div v-for="(p, idx) in form.privileges" :key="idx" style="display:flex; gap:10px; margin-bottom:5px;">
              <el-input v-model="form.privileges[idx]" placeholder="输入权益内容" />
              <el-button type="danger" icon="Minus" circle size="small" @click="removePrivilege(idx)" />
            </div>
            <el-button type="primary" link icon="Plus" @click="addPrivilege">添加权益条目</el-button>
          </el-form-item>
        </template>

        <template v-if="activeModule === 'virtual'">
          <el-form-item label="商品标题"><el-input v-model="form.title" /></el-form-item>
          <el-form-item label="副标题"><el-input v-model="form.subTitle" placeholder="简短描述" /></el-form-item>
          <el-form-item label="销售价格"><el-input-number v-model="form.price" :min="0" /></el-form-item>
          <el-form-item label="库存数量"><el-input-number v-model="form.stock" :min="0" /></el-form-item>
          <el-form-item label="发货方式">
            <el-tag type="info">系统自动发货(核销码)</el-tag>
          </el-form-item>
        </template>

      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="imageUploading || !!missingCollection" :loading="imageUploading" @click="saveData">
          {{ imageUploading ? '图片上传中…' : (missingCollection ? '集合未创建，无法保存' : '保存配置') }}
        </el-button>
      </template>
    </el-dialog>

  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { COLLECTIONS, fetchCollectionSorted, cdnAdd, cdnUpdate, cdnRemove, getTempFileUrls } from '../cloud.js'
import { Plus, Edit, Delete, Ticket, Connection, Select, Picture, Minus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ImageUploadField from './ImageUploadField.vue'
import { toInstant, bjWallToDate, dateToBjWall, describeCouponExpiry, describeCouponWindow } from '../utils/couponWindow.js'

const CHANNEL_OPTIONS = ['online', 'store', 'all']

function normalizeChannel(raw) {
  const s = String(raw || '').trim().toLowerCase()
  return CHANNEL_OPTIONS.includes(s) ? s : 'all'
}

function emptyForm(module = 'coupon') {
  return {
    _id: null,
    name: '',
    type: module === 'reward' ? 'coupon' : 'cash',
    value: module === 'coupon' || module === 'reward' ? 10 : 0,
    condition: '无门槛',
    active: true,
    level: 1,
    price: 99,
    styleType: 'black',
    privileges: ['全场88折'],
    title: '',
    subTitle: '',
    stock: 99,
    cost: 100,
    description: '',
    image: '',
    minSpend: 0,
    isOffShelf: false,
    expireDays: 30,
    limitPerUser: 0,
    channel: 'all',
    // 券模板时间窗（北京时间墙钟字符串，保存时换成绝对时刻）
    startTime: '',
    endTime: '',
    expireMode: 'days',
    fixedExpireTime: ''
  }
}

function channelLabel(ch) {
  const c = normalizeChannel(ch)
  if (c === 'store') return '仅门店'
  if (c === 'all') return '线上+门店'
  return '仅线上'
}

// --- 状态定义 ---
const activeModule = ref('coupon') // coupon | reward | vip | virtual
const loading = ref(false)
const listData = ref([])
const previewItem = ref({}) // 当前预览的对象
const dialogVisible = ref(false)
const isEditing = ref(false) // 标记是新增还是编辑
const editingRow = ref(null) // 编辑前的原始行：清空时间字段时据此写 null
const imageUploading = ref(false)
const onImageUploading = (v) => {
  imageUploading.value = !!v
}

// 表单模型 (由所有模块共用，按需取值)
const form = reactive(emptyForm('coupon'))

// --- 样式辅助 ---
const getCardStyle = (type) => {
  const map = {
    black: 'background: linear-gradient(135deg, #2b2b2b, #000000); color: #d4af37; border: 1px solid #444;',
    silver: 'background: linear-gradient(135deg, #e0e0e0, #ffffff); color: #333; border: 1px solid #ccc;',
    red: 'background: linear-gradient(135deg, #922b21, #c0392b); color: #fff; border: 1px solid #e74c3c;'
  }
  return map[type] || map.black
}

// --- 数据加载 ---
/**
 * tab → 集合的唯一映射。
 *
 * 2026-09-16 审计（只读线上核对发现）：
 * ① 原实现末尾是 `return 'coupons'`，于是「会员等级体系」tab（`level`）会去**读优惠券集合**，
 *    而模板里根本没有 `activeModule === 'level'` 的分支 → 点了只看到空白，数据却取错集合。
 *    兜底成「某个具体集合」本身就是隐患：任何新 tab 漏配都会静默改错数据源。
 * ② `vip_cards` / `equity_goods` 经线上核对**在云开发里根本不存在**（`DescribeTable` 报 Db or Table not exist），
 *    所以这两个 tab 的新建/保存/删除必然失败。已在上方显式提示并禁用写入。
 */
const MODULE_COLLECTIONS = {
  coupon: COLLECTIONS.COUPONS,
  reward: COLLECTIONS.REWARDS,
  vip: COLLECTIONS.VIP_CARDS,          // ⚠ 线上不存在，待创建（声明集中在 cloud.js 的 COLLECTIONS）
  virtual: COLLECTIONS.EQUITY_GOODS,   // ⚠ 线上不存在，待创建
}
/** 线上尚未创建的集合：不做兜底、不假装成功，直接禁用写入并提示 */
const MISSING_COLLECTIONS = { vip: COLLECTIONS.VIP_CARDS, virtual: COLLECTIONS.EQUITY_GOODS }

const getCollectionName = () => MODULE_COLLECTIONS[activeModule.value] || ''
/** 当前 tab 的目标集合在云开发里是否还不存在 */
const missingCollection = computed(() => MISSING_COLLECTIONS[activeModule.value] || '')

const refreshData = async () => {
  loading.value = true
  previewItem.value = {}
  const colName = getCollectionName()
  if (!colName) {
    // 未映射的 tab：宁可空着，也不去读一个「碰巧」的集合
    listData.value = []
    loading.value = false
    return
  }
  try {
    let rows = await fetchCollectionSorted(colName, {
      limit: 200,
      sortFn: (a, b) => (b.createTime || 0) - (a.createTime || 0)
    })
    // rewards.image 多为 cloud:// fileID，浏览器无法直接加载，需转临时 HTTPS
    if (activeModule.value === 'reward' && rows.length) {
      const urls = await getTempFileUrls(rows.map((r) => r.image || ''))
      rows = rows.map((item, i) => ({
        ...item,
        httpImage: urls[i] || ''
      }))
    }
    listData.value = rows
    if (listData.value.length > 0) {
      previewItem.value = { ...listData.value[0] }
    }
  } catch (e) {
    console.error(e)
    listData.value = []
    ElMessage.error('加载失败：' + (e.message || e))
  } finally {
    loading.value = false
  }
}

// --- 交互逻辑 ---
const setPreview = (row) => {
  if (!dialogVisible.value) {
    previewItem.value = { ...row }
  }
}

// 监听表单变化，实现“实时预览”
watch(form, (newVal) => {
  if (dialogVisible.value) {
    // 只有在编辑模式下，表单变动才实时同步到预览区
    previewItem.value = { ...newVal }
  }
}, { deep: true })

/** 预览卡「有效期」：编辑中读表单（北京时间墙钟），否则读行 */
const previewExpiryText = computed(() => {
  const p = previewItem.value || {}
  if (p.expireMode === 'fixed') return p.fixedExpireTime ? `至 ${String(p.fixedExpireTime).slice(0, 16)}` : '未选到期时间'
  if (p.expireMode === 'days') return `领取后${parseInt(p.expireDays, 10) > 0 ? parseInt(p.expireDays, 10) : 30}天`
  return describeCouponExpiry(p)
})

const dialogTitle = computed(() => {
  const action = isEditing.value ? '编辑' : '新建'
  const map = { coupon: '优惠券', reward: '积分兑换品', vip: '会员权益卡', virtual: '权益商品' }
  return `${action}${map[activeModule.value]}`
})

const openEditor = (module) => {
  isEditing.value = false
  editingRow.value = null
  imageUploading.value = false
  Object.assign(form, emptyForm(module))
  previewItem.value = { ...form }
  dialogVisible.value = true
}

const editItem = (row) => {
  isEditing.value = true
  imageUploading.value = false
  const base = emptyForm(activeModule.value)
  const { httpImage: _httpImage, _openid, _createTime, ...rest } = row || {}
  Object.assign(form, base, rest, {
    _id: row && row._id ? row._id : null,
    channel: normalizeChannel(row && row.channel),
    minSpend: Number(row && row.minSpend) || 0,
    value: Number(row && row.value) || 0,
    expireDays: parseInt(row && row.expireDays, 10) > 0 ? parseInt(row.expireDays, 10) : 30,
    limitPerUser: parseInt(row && row.limitPerUser, 10) || 0,
    active: row && row.active !== false,
    isOffShelf: !!(row && row.isOffShelf),
    startTime: dateToBjWall(row && row.startTime),
    endTime: dateToBjWall(row && row.endTime),
    expireMode: toInstant(row && row.fixedExpireTime) ? 'fixed' : 'days',
    fixedExpireTime: dateToBjWall(row && row.fixedExpireTime)
  })
  editingRow.value = row || null
  previewItem.value = { ...form }
  dialogVisible.value = true
}

const addPrivilege = () => {
  if (!form.privileges) form.privileges = []
  form.privileges.push('')
}
const removePrivilege = (idx) => {
  form.privileges.splice(idx, 1)
}

function buildCouponPayload() {
  const name = String(form.name || '').trim()
  const minSpend = Number(form.minSpend) || 0
  const channel = normalizeChannel(form.channel)
  const fixedMode = form.expireMode === 'fixed'
  const payload = {
    name,
    type: form.type === 'discount' ? 'discount' : 'cash',
    value: Number(form.value) || 0,
    minSpend,
    condition: String(form.condition || '').trim() || (minSpend > 0 ? `满${minSpend}可用` : '无门槛'),
    // 固定到期：不再叠「领取后 N 天」（receiveCoupon 见 expireDays 为 0 即只按固定到期日）
    expireDays: fixedMode ? 0 : (parseInt(form.expireDays, 10) > 0 ? parseInt(form.expireDays, 10) : 30),
    limitPerUser: parseInt(form.limitPerUser, 10) || 0,
    channel,
    active: form.active !== false,
    updateTime: Date.now()
  }
  // 时间字段：填了才写；编辑时清空原有值写 null（receiveCoupon / getProductCoupons 视 null 为未设）
  const prev = (isEditing.value && editingRow.value) || {}
  const timeFields = {
    startTime: bjWallToDate(form.startTime),
    endTime: bjWallToDate(form.endTime),
    fixedExpireTime: fixedMode ? bjWallToDate(form.fixedExpireTime) : null
  }
  Object.keys(timeFields).forEach((key) => {
    if (timeFields[key]) payload[key] = timeFields[key]
    else if (prev[key] != null && prev[key] !== '') payload[key] = null
  })
  return payload
}

function buildRewardPayload() {
  return {
    title: String(form.title || '').trim(),
    type: form.type || 'coupon',
    cost: parseInt(form.cost, 10) || 0,
    stock: parseInt(form.stock, 10) || 0,
    value: Number(form.value) || 0,
    minSpend: Number(form.minSpend) || 0,
    expireDays: parseInt(form.expireDays, 10) > 0
      ? parseInt(form.expireDays, 10)
      : (form.type === 'coupon' ? 30 : 0),
    limitPerUser: parseInt(form.limitPerUser, 10) || 0,
    channel: normalizeChannel(form.channel),
    isOffShelf: isEditing.value ? !!form.isOffShelf : false,
    image: String(form.image || '').trim(),
    description: String(form.description || '').trim(),
    updateTime: Date.now()
  }
}

function buildVipPayload() {
  return {
    name: String(form.name || '').trim(),
    level: parseInt(form.level, 10) || 1,
    price: Number(form.price) || 0,
    styleType: form.styleType || 'black',
    privileges: (form.privileges || []).map((p) => String(p || '').trim()).filter(Boolean),
    updateTime: Date.now()
  }
}

function buildVirtualPayload() {
  return {
    title: String(form.title || '').trim(),
    subTitle: String(form.subTitle || '').trim(),
    price: Number(form.price) || 0,
    stock: parseInt(form.stock, 10) || 0,
    updateTime: Date.now()
  }
}

// --- 表单校验（审计 P1：兑换品的券面值/门槛直接关系资金口径，不能只靠 toast） ---
const moduleFormRef = ref(null)
/** 7.5 折地板：value / minSpend ≤ 0.25（与 couponDiscountRules.validateCashCoupon 同一口径） */
const MIN_SPEND_MAX_OFF = 0.25

const rewardRules = computed(() => {
  const rules = {
    title: [{ required: true, message: '请填写兑换品标题', trigger: 'blur' }],
    cost: [{
      validator: (rule, value, callback) => (Number(value) >= 1 ? callback() : callback(new Error('所需积分须 ≥ 1'))),
      trigger: 'change'
    }]
  }
  if (form.type === 'coupon') {
    rules.value = [{
      validator: (rule, value, callback) => (Number(value) > 0 ? callback() : callback(new Error('券面值须大于 0'))),
      trigger: 'change'
    }]
    rules.minSpend = [{
      validator: (rule, value, callback) => {
        const face = Number(form.value) || 0
        if (!(face > 0)) return callback() // 面额本身已报错，避免重复提示
        const floor = Math.ceil(face / MIN_SPEND_MAX_OFF)
        if (Number(value) < floor) {
          return callback(new Error(`门槛过低：满${Number(value)}减${face} 低于 7.5 折，门槛至少 ¥${floor}`))
        }
        callback()
      },
      trigger: 'change'
    }]
  }
  return rules
})

const moduleFormRules = computed(() => {
  if (activeModule.value === 'reward') return rewardRules.value
  if (activeModule.value === 'coupon') {
    return {
      name: [{ required: true, message: '请填写优惠券名', trigger: 'blur' }],
      endTime: [{
        validator: (rule, value, callback) => {
          if (form.startTime && !bjWallToDate(form.startTime)) return callback(new Error('开始时间格式不对'))
          if (form.endTime && !bjWallToDate(form.endTime)) return callback(new Error('截止时间格式不对'))
          const s = bjWallToDate(form.startTime)
          const e = bjWallToDate(form.endTime)
          if (s && e && e.getTime() <= s.getTime()) return callback(new Error('截止时间须晚于开始时间'))
          callback()
        },
        trigger: 'change'
      }],
      fixedExpireTime: [{
        validator: (rule, value, callback) => {
          if (form.expireMode !== 'fixed') return callback()
          const f = bjWallToDate(form.fixedExpireTime)
          if (!f) return callback(new Error('请选择统一到期时间'))
          const s = bjWallToDate(form.startTime)
          const e = bjWallToDate(form.endTime)
          if (s && f.getTime() <= s.getTime()) return callback(new Error('到期时间须晚于开始领取时间'))
          if (e && f.getTime() < e.getTime()) return callback(new Error('到期早于领取截止：截止前领到的券会立即过期'))
          callback()
        },
        trigger: 'change'
      }]
    }
  }
  return {}
})

// --- 核心 CRUD ---
const saveData = async () => {
  if (imageUploading.value) {
    ElMessage.warning('图片仍在上传，请稍候再保存')
    return
  }

  const colName = getCollectionName()
  if (!colName) {
    ElMessage.error('该页签未配置数据集合，无法保存（这是配置缺失，不是网络问题）')
    return
  }
  if (missingCollection.value) {
    ElMessage.error(`集合「${missingCollection.value}」尚未在云开发创建，保存不会生效。请先在云开发控制台新建该集合与安全规则。`)
    return
  }
  let data = null

  // 内联校验优先：错误标在字段下方（兑换品的券面值/门槛关系资金口径）
  if (moduleFormRef.value && ['coupon', 'reward'].includes(activeModule.value)) {
    try {
      await moduleFormRef.value.validate()
    } catch {
      ElMessage.warning('请先修正表单中标红的必填项')
      return
    }
  }

  if (activeModule.value === 'coupon') {
    data = buildCouponPayload()
    if (!data.name) {
      ElMessage.warning('请填写优惠券名')
      return
    }
  } else if (activeModule.value === 'reward') {
    data = buildRewardPayload()
    if (!data.title) {
      ElMessage.warning('请填写标题')
      return
    }
    if (!data.image) {
      ElMessage.warning('请先上传图片，再保存配置')
      return
    }
  } else if (activeModule.value === 'vip') {
    data = buildVipPayload()
    if (!data.name) {
      ElMessage.warning('请填写卡片名称')
      return
    }
  } else if (activeModule.value === 'virtual') {
    data = buildVirtualPayload()
    if (!data.title) {
      ElMessage.warning('请填写商品标题')
      return
    }
  } else {
    ElMessage.warning('未知模块')
    return
  }

  try {
    if (isEditing.value && form._id) {
      await cdnUpdate(colName, form._id, data)
    } else {
      data.createTime = Date.now()
      await cdnAdd(colName, data)
    }
    ElMessage.success(`保存成功${data.channel ? `（渠道：${channelLabel(data.channel)}）` : ''}`)
    dialogVisible.value = false
    imageUploading.value = false
    await refreshData()
  } catch (e) {
    ElMessage.error('保存失败：' + (e?.message || '请检查数据库集合是否存在'))
  }
}

const toggleRewardShelf = async (row, onShelf) => {
  try {
    await cdnUpdate('rewards', row._id, { isOffShelf: !onShelf })
    row.isOffShelf = !onShelf
  } catch (e) {
    ElMessage.error('更新失败')
  }
}

const deleteItem = (row, colName) => {
  ElMessageBox.confirm('确定要删除吗？', '警告', { type: 'warning' }).then(async () => {
    try {
      await cdnRemove(colName, row._id)
      ElMessage.success('已删除')
      await refreshData()
    } catch (e) {
      console.error('删除失败', e)
      // 运营话术；技术细节留在注释里（审计 P2：不要把环境变量名甩给运营）
      ElMessage.error('删除失败：' + (e?.message || '请刷新重试；持续失败请联系技术')) /* 技术排查：manageStoreContent 是否已部署、ADMIN_OPS_KEY 是否正确 */
    }
  }).catch((e) => { if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e) })
}

const toggleStatus = async (row, colName) => {
  try {
    await cdnUpdate(colName, row._id, { active: row.active })
    ElMessage.success('状态已更新')
  } catch (e) {
    row.active = !row.active
    ElMessage.error('状态更新失败：' + (e?.message || '无写权限'))
  }
}

// 初始化
onMounted(() => refreshData())
</script>

<style scoped>
/* 布局与容器 */
.marketing-container { padding: 10px; height: 100%; box-sizing: border-box; }
.editor-col { display: flex; flex-direction: column; height: 100%; border-right: 1px solid #eee; padding-right: 20px; }
.preview-col { display: flex; justify-content: center; align-items: center; background: #f9f9f9; border-radius: 20px; }

/* 头部 */
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 8px; }
.panel-header h2 { margin: 0; color: #333; }
/* 「等级体系已并入会员经营」的归属说明（勿去掉：本页曾有一个空白且读错集合的等级 tab） */
.panel-sub { margin: 0; flex-basis: 100%; font-size: 12px; color: #909399; }
/* 集合缺失告警：与错误态一样要显眼，避免被当成「暂无数据」 */
.missing-collection-alert { margin-bottom: 16px; }
.action-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding: 10px; background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.03); }
.tip { font-size: 12px; color: #999; }
.coupon-window { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.coupon-window-sep { font-size: 12px; color: var(--el-text-color-secondary); }
.coupon-form-hint { display: block; width: 100%; font-size: 12px; color: var(--el-text-color-secondary); }
.coupon-form-hint.is-inline { display: inline; width: auto; margin-left: 8px; }
.highlight { color: #d4af37; font-weight: bold; }

/* VIP Grid */
.vip-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px; }
.vip-item { border: 2px solid transparent; border-radius: 10px; cursor: pointer; transition: 0.2s; overflow: hidden; position: relative; }
.vip-item.active { border-color: #d4af37; box-shadow: 0 0 10px rgba(212, 175, 55, 0.2); }
.vip-preview-mini { height: 100px; padding: 15px; display: flex; flex-direction: column; justify-content: space-between; }
.v-name { font-weight: bold; font-size: 14px; }
.v-level { font-size: 12px; opacity: 0.8; }
.vip-actions { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: #fff; border: 1px solid #eee; border-top: none; }
.vip-actions .price { font-size: 12px; color: #d4af37; font-weight: bold; }

/* 虚拟商品 Icon */
.icon-box { width: 40px; height: 40px; background: #f0f0f0; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #999; }

/* ================= 手机仿真器 (The Magic Part) ================= */
.iphone-frame {
  width: 320px; height: 640px; background: #000; border-radius: 40px; padding: 12px;
  box-shadow: 0 20px 50px rgba(0,0,0,0.2); position: relative;
}
.iphone-notch { width: 120px; height: 20px; background: #000; position: absolute; top: 12px; left: 50%; transform: translateX(-50%); border-bottom-left-radius: 12px; border-bottom-right-radius: 12px; z-index: 10; }
.iphone-screen { width: 100%; height: 100%; background: #f5f5f5; border-radius: 30px; overflow: hidden; position: relative; display: flex; flex-direction: column; }
.status-bar { height: 40px; display: flex; justify-content: space-between; padding: 0 20px; align-items: center; font-size: 12px; font-weight: bold; color: #000; padding-top: 10px; }

.preview-content { flex: 1; padding: 20px; overflow-y: auto; }
.p-title { font-size: 14px; color: #999; text-align: center; margin-bottom: 20px; letter-spacing: 1px; }

/* A. 优惠券样式 */
.coupon-ticket { background: #fff; border-radius: 8px; display: flex; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); position: relative; }
.coupon-ticket::before, .coupon-ticket::after { content: ''; position: absolute; top: 50%; width: 16px; height: 16px; background: #f5f5f5; border-radius: 50%; transform: translateY(-50%); }
.coupon-ticket::before { left: -8px; }
.coupon-ticket::after { right: -8px; }
.c-left { width: 90px; background: #1f1f1f; color: #d4af37; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 15px 5px; }
.c-price { font-size: 24px; font-weight: bold; }
.c-cond { font-size: 10px; opacity: 0.8; margin-top: 5px; text-align: center; }
.c-right { flex: 1; padding: 15px; display: flex; flex-direction: column; justify-content: center; }
.c-name { font-weight: bold; font-size: 14px; color: #333; margin-bottom: 5px; }
.c-time { font-size: 10px; color: #999; margin-bottom: 8px; }
.c-btn { background: #d4af37; color: #fff; text-align: center; font-size: 10px; padding: 4px 10px; border-radius: 20px; width: fit-content; }
.preview-tip { margin-top: 20px; font-size: 12px; color: #999; text-align: center; }

/* B. VIP 卡预览 */
.vip-card-large { height: 160px; border-radius: 12px; padding: 20px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 10px 20px rgba(0,0,0,0.1); }
.card-top { display: flex; align-items: center; gap: 8px; }
.c-logo { width: 20px; height: 20px; background: rgba(255,255,255,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; }
.c-name { font-size: 12px; opacity: 0.8; letter-spacing: 1px; }
.c-level-name { font-size: 20px; font-weight: bold; margin-bottom: 5px; }
.c-level-num { font-size: 12px; opacity: 0.7; font-family: 'Segoe UI', sans-serif; letter-spacing: 2px; }
.card-bottom { font-family: monospace; opacity: 0.6; font-size: 12px; letter-spacing: 2px; text-align: right; }
.privilege-list { margin-top: 20px; background: #fff; border-radius: 12px; padding: 15px; }
.p-item { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #333; margin-bottom: 10px; border-bottom: 1px dashed #eee; padding-bottom: 8px; }
.p-item:last-child { border: none; margin: 0; padding: 0; }

/* C. 虚拟商品预览 */
.goods-cover-mock { width: 100%; height: 200px; background: #ddd; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #fff; font-size: 12px; }
.goods-info-box { background: #fff; padding: 15px; margin-bottom: 10px; }
.g-price { color: #d4af37; font-weight: bold; margin-bottom: 5px; font-size: 14px; }
.g-title { font-weight: bold; font-size: 16px; margin-bottom: 5px; color: #333; }
.g-sub { font-size: 12px; color: #999; line-height: 1.4; margin-bottom: 10px; }
.g-tags { display: flex; gap: 5px; }
.g-tag { font-size: 10px; background: #f7f7f7; padding: 2px 6px; border-radius: 4px; color: #666; }
.buy-bar { position: absolute; bottom: 0; left: 0; width: 100%; background: #fff; padding: 10px 20px; border-top: 1px solid #eee; display: flex; justify-content: flex-end; }
.b-btn { background: #1f1f1f; color: #d4af37; padding: 8px 25px; border-radius: 20px; font-size: 13px; font-weight: bold; }
</style>