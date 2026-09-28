<template>
  <div>
    <div class="header-row">
        <h2>活动排期 / ACTIVITIES</h2>
        <el-button type="primary" icon="Plus" @click="dialogVisible = true">发布新活动</el-button>
    </div>

    <el-card shadow="never">
        <el-table :data="list" v-loading="loading" style="width: 100%">
          <template #empty>
            <ErpEmpty description="暂无活动" hint="新建活动后可排期并在小程序展示。" />
          </template>

            <el-table-column label="活动主题" min-width="200">
                <template #default="scope">
                    <div style="font-weight:bold; font-size:15px;">{{ scope.row.title }}</div>
                    <div style="font-size:12px; color:#999; margin-top:4px;">📍 {{ scope.row.location }}</div>
                </template>
            </el-table-column>
            
            <el-table-column label="活动时间" width="180">
                <template #default="scope">
                    <div>{{ scope.row.date }}</div>
                    <div style="font-size:12px; color:#999;">{{ scope.row.time }}</div>
                </template>
            </el-table-column>
            <el-table-column prop="type" label="类型" width="100">
                <template #default="scope">
                    <el-tag size="small">{{ scope.row.type === 'course' ? '手作' : '活动' }}</el-tag>
                </template>
            </el-table-column>
            
            <el-table-column label="报名进度" width="180">
                <template #default="scope">
                    <el-progress 
                        :percentage="calcPercent(scope.row)" 
                        :color="customColors" 
                        :format="() => `${joinedOf(scope.row)}/${scope.row.maxPeople || 0}人`"
                    />
                </template>
            </el-table-column>

            <el-table-column label="状态" width="100">
                <template #default="scope">
                    <el-tag v-if="scope.row.status==='open'" type="success" effect="dark">报名中</el-tag>
                    <el-tag v-else type="info">已结束</el-tag>
                </template>
            </el-table-column>

            <el-table-column label="操作" width="120">
                <template #default="scope">
                    <el-button size="small" type="danger" link @click="stopActivity(scope.row)">截止</el-button>
                </template>
            </el-table-column>
        </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" title="发布新活动" width="500px" :close-on-click-modal="false">
        <div style="max-width: 100%; overflow-x: hidden;">
        <el-form :model="form" label-width="80px" style="max-width: 100%;">
            <el-form-item label="活动名称">
                <el-input v-model="form.title" placeholder="例如：昆虫标本制作课" />
            </el-form-item>
            <el-form-item label="活动类型">
                <el-radio-group v-model="form.type">
                    <el-radio label="course">手作</el-radio>
                    <el-radio label="special_activity">活动</el-radio>
                </el-radio-group>
            </el-form-item>
            <el-form-item label="活动日期">
                <el-date-picker v-model="form.date" type="date" placeholder="选择日期" style="width:100%" />
            </el-form-item>
            <el-form-item label="活动时间">
                <el-input v-model="form.time" placeholder="例如：14:00" />
            </el-form-item>
            <el-form-item label="价格">
                <el-input-number v-model="form.price" :min="0" :precision="2" style="width:100%" />
            </el-form-item>
            <el-form-item label="名额限制">
                <el-input-number v-model="form.maxPeople" :min="1" />
            </el-form-item>
            <el-form-item label="举办地点">
                <el-input v-model="form.location" placeholder="例如：本店" />
            </el-form-item>
            <el-form-item label="封面图">
                <ImageUploadField
                  v-model="form.image"
                  folder="activities"
                  tip="优先在此上传活动封面；也可粘贴 cloud:// 或 HTTPS"
                  preview-width="160px"
                  preview-height="100px"
                />
            </el-form-item>
        </el-form>
        </div>
        <template #footer>
            <el-button @click="dialogVisible = false">取消</el-button>
            <el-button type="primary" @click="submitActivity">立即发布</el-button>
        </template>
    </el-dialog>
  </div>
</template>

<script setup>
import ErpEmpty from './ErpEmpty.vue'
import { ref, reactive, onMounted } from 'vue'
import { fetchCollectionSorted, fetchCollectionLimit, cdnAdd, cdnUpdate } from '../cloud'
import { ElMessage } from 'element-plus'
import ImageUploadField from './ImageUploadField.vue'

const loading = ref(false)
const list = ref([])
const bookings = ref([])
const dialogVisible = ref(false)
const customColors = [{color: '#f56c6c', percentage: 100}, {color: '#5cb87a', percentage: 60}]

const form = reactive({
    title: '', type: 'course', date: '', time: '', price: 0, maxPeople: 10, location: '本店', image: ''
})

const fetchList = async () => {
    loading.value = true
    try {
        list.value = await fetchCollectionSorted('activities', {
            limit: 200,
            sortFn: (a, b) => (b.createTime || 0) - (a.createTime || 0)
        })
        try {
            bookings.value = (await fetchCollectionLimit('bookings', { limit: 500 }))
                .filter((b) => ['confirmed', 'pending', 'used'].includes(b.status))
        } catch (e) {
            console.warn('读取预约失败，报名进度显示「—」', e)
            bookings.value = null
        }
    } catch(e) {
        console.error('加载活动失败', e)
        list.value = []
    } finally {
        loading.value = false
    }
}

const submitActivity = async () => {
    if(!form.title) return ElMessage.warning('请填写活动名称')
    
    try {
        const data = {
            title: form.title,
            type: form.type,
            date: form.date ? (typeof form.date === 'string' ? form.date : form.date.toISOString().split('T')[0]) : '',
            time: form.time || '',
            price: form.price || 0,
            maxPeople: form.maxPeople || 10,
            location: form.location || '本店',
            image: form.image || '',
            status: 'open',
            remain: form.maxPeople || 10
        }
        
        await cdnAdd('activities', {
            ...data,
            createTime: new Date().getTime()
        })
        ElMessage.success('发布成功')
        dialogVisible.value = false
        fetchList()
    } catch(e) {
        ElMessage.error('发布失败，请确保已创建 activities 集合')
    }
}

const stopActivity = async (row) => {
    await cdnUpdate('activities', row._id, { status: 'closed' })
    fetchList()
}

// 报名数按 bookings 计：优先 activityId，历史预约没有 activityId 时回退「标题 + 日期」（与小程序工作台同口径）
const joinedOf = (row) => bookings.value ? bookings.value.filter((b) =>
    b.activityId ? b.activityId === row._id : b.title === row.title && b.date === row.date
).length : '—'

const calcPercent = (row) => {
    if(!row.maxPeople) return 0
    const joined = joinedOf(row)
    if (typeof joined !== 'number') return 0
    return Math.min(100, Math.round((joined / row.maxPeople) * 100))
}

onMounted(() => fetchList())
</script>

<style scoped>
.header-row { display:flex; justify-content:space-between; margin-bottom:20px; align-items:center; }
/* 🟢 防止右侧溢出 */
.el-dialog__body {
    max-width: 100%;
    overflow-x: hidden;
}
.el-form {
    max-width: 100%;
}
</style>