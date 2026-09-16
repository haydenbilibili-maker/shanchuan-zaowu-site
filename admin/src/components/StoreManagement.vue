<template>
  <div class="module-wrapper store-mgmt">
    <div class="module-header">
      <div class="title-box">
        <h2>店铺管理</h2>
        <span class="subtitle">OFFLINE STORE OPS</span>
      </div>
      <el-button type="primary" @click="openStoreDialog()">
        <el-icon><Plus /></el-icon>
        新建门店
      </el-button>
    </div>

    <el-card class="table-card" shadow="never">
      <el-table v-loading="loading" :data="bundle.stores" stripe empty-text="暂无门店，请点击「新建门店」">
        <el-table-column prop="code" label="编码" width="120" fixed="left" sortable />
        <el-table-column prop="name" label="门店名称" min-width="140" sortable />
        <el-table-column prop="city" label="城市" width="100" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ STORE_STATUS[row.status] || row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="证照" width="88" align="center">
          <template #default="{ row }">
            <el-tag v-if="licenseAlert(row.id) === 'expired'" type="danger" size="small">有过期</el-tag>
            <el-tag v-else-if="licenseAlert(row.id) === 'soon'" type="warning" size="small">将过期</el-tag>
            <span v-else class="muted-dash">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="managerName" label="负责人" width="100" />
        <el-table-column label="本月营收(登记)" width="130" align="right">
          <template #default="{ row }">
            {{ formatMoney(monthRevenueSum(row.id)) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDrawer(row.id)">管理</el-button>
            <el-button link @click="openStoreDialog(row)">编辑</el-button>
            <el-button link type="danger" @click="removeStore(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 门店表单 -->
    <el-dialog v-model="storeDialog" :title="storeEditingId ? '编辑门店' : '新建门店'" width="560px" destroy-on-close @closed="resetStoreForm">
      <el-form :model="storeForm" label-width="100px">
        <el-form-item label="门店编码" required>
          <el-input v-model="storeForm.code" placeholder="唯一编码，如 CC001" maxlength="32" show-word-limit />
        </el-form-item>
        <el-form-item label="门店名称" required>
          <el-input v-model="storeForm.name" placeholder="门店全称" maxlength="64" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="storeForm.status" style="width: 100%">
            <el-option v-for="(lab, key) in STORE_STATUS" :key="key" :label="lab" :value="key" />
          </el-select>
        </el-form-item>
        <el-form-item label="城市">
          <el-input v-model="storeForm.city" placeholder="如 长春" />
        </el-form-item>
        <el-form-item label="负责人">
          <el-input v-model="storeForm.managerName" placeholder="店长/主理人" />
        </el-form-item>
        <el-form-item label="营业地址">
          <el-input v-model="storeForm.address" type="textarea" :rows="2" placeholder="省市区 + 门牌/楼层" />
        </el-form-item>
        <el-form-item label="邮政编码">
          <el-input v-model="storeForm.postalCode" maxlength="10" />
        </el-form-item>
        <el-form-item label="经纬度">
          <el-input v-model="storeForm.latLng" placeholder="可选，如 43.88,125.32" />
        </el-form-item>
        <el-form-item label="面积(㎡)">
          <el-input-number v-model="storeForm.areaM2" :min="0" :step="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="铺位号">
          <el-input v-model="storeForm.unitNo" />
        </el-form-item>
        <el-form-item label="租约起">
          <el-date-picker v-model="storeForm.leaseStart" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="租约止">
          <el-date-picker v-model="storeForm.leaseEnd" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="房东/物业">
          <el-input v-model="storeForm.landlordName" />
        </el-form-item>
        <el-form-item label="联系方式">
          <el-input v-model="storeForm.landlordContact" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="storeDialog = false">取消</el-button>
        <el-button type="primary" @click="saveStore">保存</el-button>
      </template>
    </el-dialog>

    <!-- 门店详情抽屉 -->
    <el-drawer v-model="drawerVisible" :title="currentStore?.name || '门店'" size="min(920px, 96vw)" destroy-on-close>
      <template v-if="currentStore">
        <div class="drawer-sub">{{ currentStore.code }} · {{ STORE_STATUS[currentStore.status] }}</div>
        <el-tabs v-model="detailTab">
          <el-tab-pane label="概览" name="ov">
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item label="地址">{{ currentStore.address || '—' }}</el-descriptions-item>
              <el-descriptions-item label="负责人">{{ currentStore.managerName || '—' }}</el-descriptions-item>
              <el-descriptions-item label="面积">{{ currentStore.areaM2 ?? '—' }} ㎡</el-descriptions-item>
              <el-descriptions-item label="租约">{{ currentStore.leaseStart || '—' }} ~ {{ currentStore.leaseEnd || '—' }}</el-descriptions-item>
            </el-descriptions>
            <div class="stat-row">
              <el-tag>证照 {{ countLicenses }}</el-tag>
              <el-tag type="warning">租金记录 {{ countRent }}</el-tag>
              <el-tag type="success">发票 {{ countInv }}</el-tag>
              <el-tag type="info">营收行 {{ countRev }}</el-tag>
              <el-tag>员工 {{ countStaff }}</el-tag>
            </div>
          </el-tab-pane>
          <el-tab-pane label="证照" name="lic">
            <div class="tab-actions">
              <el-button type="primary" size="small" @click="openLicenseDialog()">新增证照</el-button>
              <el-button size="small" @click="openLicenseTypesDialog">证照类型配置</el-button>
            </div>
            <el-table :data="licensesForStore" size="small" max-height="360">
              <el-table-column prop="typeName" label="类型" width="120" />
              <el-table-column prop="certNo" label="证号" width="140" />
              <el-table-column prop="validTo" label="有效期至" width="120" />
              <el-table-column label="状态" width="88">
                <template #default="{ row }">
                  <el-tag :type="licenseValidityStatus(row).tag" size="small">{{ licenseValidityStatus(row).label }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="当前" width="70">
                <template #default="{ row }">
                  <el-tag v-if="row.isCurrent" type="success" size="small">生效</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="附件" min-width="160">
                <template #default="{ row }">
                  <template v-for="(f, i) in row.files" :key="i">
                    <el-link type="primary" class="file-link" @click="previewFile(f.fileId)">{{ f.name }}</el-link>
                  </template>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="100">
                <template #default="{ row }">
                  <el-button link type="danger" size="small" @click="removeLicense(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="租金收据" name="rent">
            <div class="tab-actions">
              <el-button type="primary" size="small" @click="openRentDialog()">新增记录</el-button>
              <el-button size="small" @click="exportStoreRentCsv">导出本店租金 CSV</el-button>
            </div>
            <el-table :data="rentForStore" size="small" max-height="360">
              <el-table-column prop="periodStart" label="期间起" width="110" />
              <el-table-column prop="periodEnd" label="期间止" width="110" />
              <el-table-column prop="amount" label="金额" width="100" align="right" />
              <el-table-column prop="payDate" label="缴费日" width="110" />
              <el-table-column label="附件" min-width="140">
                <template #default="{ row }">
                  <el-link v-for="(f, i) in row.files" :key="i" type="primary" class="file-link" @click="previewFile(f.fileId)">{{ f.name }}</el-link>
                </template>
              </el-table-column>
              <el-table-column width="80">
                <template #default="{ row }">
                  <el-button link type="danger" size="small" @click="removeRent(row)">删</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="发票" name="inv">
            <el-alert
              type="info"
              :closable="false"
              show-icon
              style="margin-bottom: 12px;"
              title="此处为门店进销项发票登记（账本）。C 端用户开票申请请用「业务运营 → C端开票申请台」（invoice_requests）。"
            />
            <div class="tab-actions">
              <el-button type="primary" size="small" @click="openInvoiceDialog()">登记发票</el-button>
              <el-button size="small" @click="exportStoreInvoiceCsv">导出本店发票 CSV</el-button>
            </div>
            <el-table :data="invForStore" size="small" max-height="360">
              <el-table-column prop="direction" label="进/销" width="70" />
              <el-table-column prop="number" label="发票号码" width="130" />
              <el-table-column prop="issueDate" label="开票日" width="110" />
              <el-table-column prop="total" label="价税合计" width="100" align="right" />
              <el-table-column label="操作" width="80">
                <template #default="{ row }">
                  <el-button link type="danger" size="small" @click="removeInv(row)">删</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="门店营收" name="rev">
            <el-alert
              type="info"
              :closable="false"
              show-icon
              class="rev-prd-hint"
              title="口径说明（PRD）"
              description="按「营业日」自然日记账；与全渠道订单 GMV 并存——订单为成交明细，本页为门店上报或日结汇总，差异在财务对账中处理。"
            />
            <div class="rev-summary-row">
              <el-statistic title="本月登记净额（自然月）" :value="monthRevenueSum(drawerStoreId)" prefix="¥" :precision="2" />
              <el-button size="small" @click="exportStoreRevenueCsv">导出本店营收 CSV</el-button>
            </div>
            <div class="sub-block-title">按自然月汇总</div>
            <el-table :data="revenueMonthRollup" size="small" max-height="200" class="rollup-table">
              <el-table-column prop="ym" label="月份" width="100" />
              <el-table-column prop="count" label="笔数" width="70" align="center" />
              <el-table-column prop="net" label="净额合计" align="right">
                <template #default="{ row }">{{ formatMoney(row.net) }}</template>
              </el-table-column>
            </el-table>
            <el-alert
              type="warning"
              :closable="false"
              show-icon
              class="rev-import-hint"
              title="批量导入"
              description="首行表头须含「门店编码」「营业日」；可选列：渠道、营业额、退款调整、净额、备注。净额可空，将按 营业额−退款 计算。支持多店混表。"
            />
            <div class="tab-actions">
              <el-button type="primary" size="small" @click="openRevenueDialog()">登记营收</el-button>
              <el-button size="small" @click="downloadRevenueImportTemplate">下载营收导入模板(xlsx)</el-button>
              <el-upload accept=".xlsx,.xls" :show-file-list="false" :http-request="importRevenueXlsxRequest">
                <el-button size="small">导入营收 Excel</el-button>
              </el-upload>
            </div>
            <el-table :data="revForStoreSorted" size="small" max-height="360">
              <el-table-column prop="bizDate" label="营业日" width="120" />
              <el-table-column label="渠道" width="100">
                <template #default="{ row }">{{ REVENUE_CHANNELS[row.channel] || row.channel }}</template>
              </el-table-column>
              <el-table-column prop="netAmount" label="净额" width="100" align="right" />
              <el-table-column label="含税" width="64" align="center">
                <template #default="{ row }">{{ row.taxIncluded === false ? '否' : '是' }}</template>
              </el-table-column>
              <el-table-column label="附件" width="60" align="center">
                <template #default="{ row }">{{ (row.files || []).length }}</template>
              </el-table-column>
              <el-table-column prop="remark" label="备注" show-overflow-tooltip />
              <el-table-column width="80">
                <template #default="{ row }">
                  <el-button link type="danger" size="small" @click="removeRev(row)">删</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="员工" name="stf">
            <el-alert
              type="info"
              show-icon
              :closable="false"
              class="staff-sync-hint"
              title="与「员工花名册」同一套数据"
              description="此处为只读同步视图；增删改请在团队模块维护。打开本抽屉时会自动按薪酬花名册刷新本店员工列表。"
            />
            <el-table :data="staffForStore" size="small" max-height="360">
              <el-table-column prop="name" label="姓名" width="100" />
              <el-table-column label="性别" width="64">
                <template #default="{ row }">{{ row.gender === 'male' ? '男' : row.gender === 'female' ? '女' : '—' }}</template>
              </el-table-column>
              <el-table-column prop="position" label="岗位" width="100" />
              <el-table-column prop="phone" label="手机" width="120" />
              <el-table-column prop="hireDate" label="入职" width="110" />
              <el-table-column label="状态" width="80">
                <template #default="{ row }">{{ row.status === 'left' ? '离职' : '在职' }}</template>
              </el-table-column>
              <el-table-column label="来源" width="100">
                <template #default="{ row }">
                  {{ row.payrollEmployeeId ? '薪酬同步' : '历史数据' }}
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </template>
    </el-drawer>

    <!-- 证照弹窗 -->
    <el-dialog v-model="licenseDialog" title="证照" width="520px" destroy-on-close>
      <el-form :model="licenseForm" label-width="100px">
        <el-form-item label="类型">
          <el-select v-model="licenseForm.licenseTypeId" style="width: 100%" @change="syncLicenseTypeName">
            <el-option v-for="t in bundle.licenseTypes" :key="t.id" :label="t.name" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="证号">
          <el-input v-model="licenseForm.certNo" />
        </el-form-item>
        <el-form-item label="发证机关">
          <el-input v-model="licenseForm.issuer" />
        </el-form-item>
        <el-form-item label="有效期起">
          <el-date-picker v-model="licenseForm.validFrom" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="有效期止">
          <el-date-picker v-model="licenseForm.validTo" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="当前生效">
          <el-switch v-model="licenseForm.isCurrent" />
        </el-form-item>
        <el-form-item label="附件">
          <el-upload :http-request="uploadLicenseFiles" multiple :show-file-list="true" :limit="8">
            <el-button size="small">上传文件</el-button>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="licenseDialog = false">取消</el-button>
        <el-button type="primary" @click="saveLicense">保存</el-button>
      </template>
    </el-dialog>

    <!-- 租金 -->
    <el-dialog v-model="rentDialog" title="租金记录" width="520px" destroy-on-close>
      <el-form :model="rentForm" label-width="100px">
        <el-form-item label="期间起">
          <el-date-picker v-model="rentForm.periodStart" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="期间止">
          <el-date-picker v-model="rentForm.periodEnd" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="金额(元)">
          <el-input-number v-model="rentForm.amount" :min="0" :step="100" style="width: 100%" />
        </el-form-item>
        <el-form-item label="缴费日">
          <el-date-picker v-model="rentForm.payDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="支付方式">
          <el-input v-model="rentForm.payMethod" placeholder="转账/现金等" />
        </el-form-item>
        <el-form-item label="收款方">
          <el-input v-model="rentForm.payeeName" />
        </el-form-item>
        <el-form-item label="凭证号">
          <el-input v-model="rentForm.voucherNo" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="rentForm.remark" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="附件">
          <el-upload :http-request="uploadRentFiles" multiple :limit="8">
            <el-button size="small">上传收据/合同</el-button>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rentDialog = false">取消</el-button>
        <el-button type="primary" @click="saveRent">保存</el-button>
      </template>
    </el-dialog>

    <!-- 发票 -->
    <el-dialog v-model="invoiceDialog" title="发票登记" width="560px" destroy-on-close>
      <el-form :model="invoiceForm" label-width="110px">
        <el-form-item label="进/销项">
          <el-select v-model="invoiceForm.direction" style="width: 100%">
            <el-option label="进项" value="in" />
            <el-option label="销项" value="out" />
          </el-select>
        </el-form-item>
        <el-form-item label="发票类型">
          <el-input v-model="invoiceForm.invoiceKind" placeholder="如 电子普票" />
        </el-form-item>
        <el-form-item label="发票代码">
          <el-input v-model="invoiceForm.code" />
        </el-form-item>
        <el-form-item label="发票号码">
          <el-input v-model="invoiceForm.number" />
        </el-form-item>
        <el-form-item label="开票日期">
          <el-date-picker v-model="invoiceForm.issueDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="不含税金额">
          <el-input-number v-model="invoiceForm.amountExclTax" :min="0" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="税额">
          <el-input-number v-model="invoiceForm.taxAmount" :min="0" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="价税合计">
          <el-input-number v-model="invoiceForm.total" :min="0" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="销售方名称">
          <el-input v-model="invoiceForm.sellerName" />
        </el-form-item>
        <el-form-item label="销售方税号">
          <el-input v-model="invoiceForm.sellerTaxId" />
        </el-form-item>
        <el-form-item label="购买方名称">
          <el-input v-model="invoiceForm.buyerName" />
        </el-form-item>
        <el-form-item label="购买方税号">
          <el-input v-model="invoiceForm.buyerTaxId" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="invoiceForm.remark" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="附件">
          <el-upload :http-request="uploadInvoiceFiles" multiple :limit="8">
            <el-button size="small">上传发票文件</el-button>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="invoiceDialog = false">取消</el-button>
        <el-button type="primary" @click="saveInvoice">保存</el-button>
      </template>
    </el-dialog>

    <!-- 营收 -->
    <el-dialog v-model="revenueDialog" title="门店营收" width="480px" destroy-on-close>
      <el-form :model="revenueForm" label-width="100px">
        <el-form-item label="营业日">
          <el-date-picker v-model="revenueForm.bizDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="渠道">
          <el-select v-model="revenueForm.channel" style="width: 100%">
            <el-option v-for="(lab, key) in REVENUE_CHANNELS" :key="key" :label="lab" :value="key" />
          </el-select>
        </el-form-item>
        <el-form-item label="营业额">
          <el-input-number v-model="revenueForm.grossAmount" :min="0" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="退款调整">
          <el-input-number v-model="revenueForm.refundAmount" :min="0" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="净额">
          <el-input-number v-model="revenueForm.netAmount" :min="0" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="含税口径">
          <el-switch v-model="revenueForm.taxIncluded" active-text="营业额为含税" inactive-text="不含税" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="revenueForm.remark" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="附件">
          <el-upload :http-request="uploadRevenueFiles" multiple :limit="8">
            <el-button size="small">上传</el-button>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="revenueDialog = false">取消</el-button>
        <el-button type="primary" @click="saveRevenue">保存</el-button>
      </template>
    </el-dialog>

    <!-- 证照类型配置 -->
    <el-dialog v-model="licenseTypesDialog" title="证照类型字典" width="520px" destroy-on-close>
      <p class="dialog-hint">与 PRD L-01 一致；删除前请确认无证照记录引用该类型。</p>
      <el-table :data="bundle.licenseTypes" size="small" max-height="320">
        <el-table-column label="类型 ID" prop="id" width="140" show-overflow-tooltip />
        <el-table-column label="名称" min-width="160">
          <template #default="{ row }">
            <el-input v-model="row.name" maxlength="32" size="small" @change="persist" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80">
          <template #default="{ row }">
            <el-button link type="danger" size="small" @click="removeLicenseType(row)">删</el-button>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="addLicenseTypeRow">新增类型</el-button>
        <el-button type="primary" @click="closeLicenseTypes">完成</el-button>
      </template>
    </el-dialog>

  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import * as XLSX from 'xlsx'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  loadStoreBundle,
  saveStoreBundle,
  genStoreEntityId,
  STORE_STATUS,
  REVENUE_CHANNELS,
  licenseValidityStatus,
  storeLicenseAlertLevel,
} from '../utils/storeStorage'
import { loadPayrollBundle } from '../utils/payrollStorage'
import { rebuildStoreStaffFromPayrollEmployees, UNIFIED_EMPLOYEES_CHANGED } from '../utils/unifiedEmployeeSync.js'
import { uploadAdminBinary, getTempFileUrl } from '../cloud'

const loading = ref(false)
const bundle = reactive(loadStoreBundle())
const drawerVisible = ref(false)
const drawerStoreId = ref('')
const detailTab = ref('ov')

const storeDialog = ref(false)
const storeEditingId = ref('')
const storeForm = reactive({
  code: '',
  name: '',
  status: 'operating',
  city: '',
  managerName: '',
  address: '',
  postalCode: '',
  latLng: '',
  areaM2: null,
  unitNo: '',
  leaseStart: '',
  leaseEnd: '',
  landlordName: '',
  landlordContact: '',
})

const licenseDialog = ref(false)
const licenseForm = reactive({
  licenseTypeId: '',
  typeName: '',
  certNo: '',
  issuer: '',
  validFrom: '',
  validTo: '',
  isCurrent: true,
  files: [],
})

const rentDialog = ref(false)
const rentForm = reactive({
  periodStart: '',
  periodEnd: '',
  amount: 0,
  payDate: '',
  payMethod: '',
  payeeName: '',
  voucherNo: '',
  remark: '',
  files: [],
})

const invoiceDialog = ref(false)
const invoiceForm = reactive({
  direction: 'in',
  invoiceKind: '电子普通发票',
  code: '',
  number: '',
  issueDate: '',
  amountExclTax: 0,
  taxAmount: 0,
  total: 0,
  sellerName: '',
  sellerTaxId: '',
  buyerName: '',
  buyerTaxId: '',
  remark: '',
  files: [],
})

const revenueDialog = ref(false)
const revenueForm = reactive({
  bizDate: '',
  channel: 'offline_pos',
  grossAmount: 0,
  refundAmount: 0,
  netAmount: 0,
  taxIncluded: true,
  remark: '',
  files: [],
})

function persist() {
  saveStoreBundle(JSON.parse(JSON.stringify(bundle)))
}

/**
 * 本地改动落盘统一收尾。
 *
 * `saveStoreBundle` 直接调 `localStorage.setItem`，配额满/隐私模式会**抛错**；
 * 而这些删除流程原先都在 `ElMessageBox.confirm(...).then(() => {…}).catch(() => {})` 里，
 * 同步 `.then` 抛出的错误会被那个空 catch 吞掉 —— 界面弹「已删除」，其实没存住（审计 §0 P1）。
 */
function commitLocalChange(mutate, successText = '已删除') {
  try {
    mutate()
    persist()
    ElMessage.success(successText)
  } catch (e) {
    console.error('本地保存失败', e)
    // 回滚内存态，避免界面与已落盘数据不一致
    Object.assign(bundle, loadStoreBundle())
    ElMessage.error(
      `保存失败：${e?.message || '本地存储写入失败'}。改动未生效（可能浏览器存储空间不足）。`
    )
  }
}

const currentStore = computed(() => bundle.stores.find((s) => s.id === drawerStoreId.value) || null)

const licensesForStore = computed(() =>
  bundle.licenses.filter((l) => l.storeId === drawerStoreId.value),
)
const rentForStore = computed(() => bundle.rentPayments.filter((r) => r.storeId === drawerStoreId.value))
const invForStore = computed(() => bundle.invoices.filter((i) => i.storeId === drawerStoreId.value))
const revForStore = computed(() => bundle.revenueEntries.filter((r) => r.storeId === drawerStoreId.value))
const staffForStore = computed(() => bundle.staff.filter((s) => s.storeId === drawerStoreId.value))

const revenueMonthRollup = computed(() => {
  const sid = drawerStoreId.value
  if (!sid) return []
  const map = new Map()
  for (const r of bundle.revenueEntries.filter((x) => x.storeId === sid)) {
    const ym = (r.bizDate || '').slice(0, 7)
    if (!ym) continue
    const row = map.get(ym) || { ym, count: 0, net: 0 }
    row.count += 1
    row.net += Number(r.netAmount) || 0
    map.set(ym, row)
  }
  return [...map.values()].sort((a, b) => b.ym.localeCompare(a.ym))
})

const revForStoreSorted = computed(() =>
  [...revForStore.value].sort((a, b) => String(b.bizDate || '').localeCompare(String(a.bizDate || ''))),
)

const licenseTypesDialog = ref(false)

const countLicenses = computed(() => licensesForStore.value.length)
const countRent = computed(() => rentForStore.value.length)
const countInv = computed(() => invForStore.value.length)
const countRev = computed(() => revForStore.value.length)
const countStaff = computed(() => staffForStore.value.length)

function statusTagType(st) {
  if (st === 'operating') return 'success'
  if (st === 'preparing') return 'info'
  return 'info'
}

function formatMoney(n) {
  if (n == null || Number.isNaN(n)) return '—'
  return `¥${Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

function monthRevenueSum(storeId) {
  const now = new Date()
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return bundle.revenueEntries
    .filter((r) => r.storeId === storeId && r.bizDate && r.bizDate.startsWith(ym))
    .reduce((a, r) => a + (Number(r.netAmount) || 0), 0)
}

function licenseAlert(storeId) {
  return storeLicenseAlertLevel(bundle, storeId)
}

function openLicenseTypesDialog() {
  licenseTypesDialog.value = true
}

function closeLicenseTypes() {
  persist()
  licenseTypesDialog.value = false
  ElMessage.success('证照类型已保存')
}

function addLicenseTypeRow() {
  bundle.licenseTypes.push({ id: genStoreEntityId('lt'), name: '新证照类型' })
  persist()
}

function removeLicenseType(row) {
  const used = bundle.licenses.some((l) => l.licenseTypeId === row.id)
  if (used) {
    ElMessage.warning('已有证照使用该类型，无法删除')
    return
  }
  ElMessageBox.confirm(`确定删除证照类型「${row.name}」？`, '提示', { type: 'warning' })
    .then(() => {
      commitLocalChange(() => {
        bundle.licenseTypes = bundle.licenseTypes.filter((t) => t.id !== row.id)
      })
    })
    .catch((e) => {
      if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e)
    })
}

function normHeader(h) {
  return String(h || '')
    .trim()
    .replace(/\s/g, '')
    .toLowerCase()
}

function colIndex(headers, ...aliases) {
  for (let i = 0; i < headers.length; i++) {
    const n = normHeader(headers[i])
    for (const a of aliases) {
      if (n === normHeader(a)) return i
    }
  }
  return -1
}

function mapChannelFromCell(v) {
  const t = String(v || '').trim()
  if (!t) return 'offline_pos'
  if (t.includes('线下') || t.toUpperCase().includes('POS')) return 'offline_pos'
  if (t.includes('小程序') || t.includes('到店')) return 'miniprogram'
  if (t === 'offline_pos' || t === 'miniprogram' || t === 'other') return t
  return 'other'
}

function downloadRevenueImportTemplate() {
  const data = [
    {
      门店编码: 'CCYS001',
      营业日: '2026-04-01',
      渠道: '线下收银',
      营业额: 10000,
      退款调整: 0,
      净额: 10000,
      备注: '示例行，导入前请改为真实数据',
    },
  ]
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '营收')
  XLSX.writeFile(wb, '门店营收导入模板.xlsx')
  ElMessage.success('模板已下载')
}

function importRevenueXlsxRequest(opt) {
  const file = opt.file
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const buf = reader.result
      const wb = XLSX.read(buf, { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
      if (!rows.length || rows[0].length === 0) throw new Error('空表')
      const headers = rows[0].map((h) => String(h))
      const iCode = colIndex(headers, '门店编码', 'storecode', '编码')
      const iDate = colIndex(headers, '营业日', '日期', 'bizdate')
      const iCh = colIndex(headers, '渠道', 'channel')
      const iGross = colIndex(headers, '营业额', 'gross', '流水')
      const iRef = colIndex(headers, '退款调整', '退款', 'refund')
      const iNet = colIndex(headers, '净额', 'net')
      const iRm = colIndex(headers, '备注', 'remark')
      if (iCode < 0 || iDate < 0) throw new Error('表头须包含「门店编码」与「营业日」列')

      let ok = 0
      const errs = []
      for (let r = 1; r < rows.length; r++) {
        const line = rows[r]
        if (!line || !line.length) continue
        const code = String(line[iCode] || '').trim()
        const bizDate = String(line[iDate] || '').trim().slice(0, 10)
        if (!code || !bizDate) continue
        const st = bundle.stores.find((s) => String(s.code || '').trim() === code)
        if (!st) {
          errs.push(`第${r + 1}行：未找到门店编码 ${code}`)
          continue
        }
        const gross = iGross >= 0 ? Number(line[iGross]) || 0 : 0
        const ref = iRef >= 0 ? Number(line[iRef]) || 0 : 0
        let net = iNet >= 0 ? Number(line[iNet]) : NaN
        if (!Number.isFinite(net)) net = Math.max(0, gross - ref)
        const channel = iCh >= 0 ? mapChannelFromCell(line[iCh]) : 'offline_pos'
        const remark = iRm >= 0 ? String(line[iRm] || '') : ''
        bundle.revenueEntries.push({
          id: genStoreEntityId('rev'),
          storeId: st.id,
          bizDate,
          channel,
          grossAmount: gross,
          refundAmount: ref,
          netAmount: net,
          taxIncluded: true,
          remark,
          files: [],
          createdAt: Date.now(),
        })
        ok++
      }
      if (!ok) throw new Error(errs.length ? errs.slice(0, 5).join('；') : '无有效数据行')
      persist()
      ElMessage.success(`已导入 ${ok} 条营收` + (errs.length ? `（${errs.length} 行跳过）` : ''))
      if (errs.length) errs.slice(0, 8).forEach((m) => ElMessage.warning(m))
      opt.onSuccess?.({}, file)
    } catch (e) {
      ElMessage.error(e?.message || '导入失败')
      opt.onError?.(e)
    }
  }
  reader.onerror = () => opt.onError?.(new Error('read'))
  reader.readAsArrayBuffer(file)
}

function exportStoreRentCsv() {
  const sid = drawerStoreId.value
  if (!sid) return
  const store = bundle.stores.find((s) => s.id === sid)
  const name = (store?.code || '') + '_' + (store?.name || '租金')
  const headers = ['期间起', '期间止', '金额', '缴费日', '支付方式', '收款方', '凭证号', '备注', '附件数']
  const lines = [headers.join(',')]
  for (const r of rentForStore.value) {
    lines.push(
      [
        r.periodStart || '',
        r.periodEnd || '',
        r.amount ?? '',
        r.payDate || '',
        r.payMethod || '',
        r.payeeName || '',
        r.voucherNo || '',
        (r.remark || '').replace(/"/g, '""'),
        (r.files || []).length,
      ]
        .map((c) => `"${String(c)}"`)
        .join(','),
    )
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `租金_${name}_${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
  ElMessage.success('已导出')
}

function exportStoreInvoiceCsv() {
  const sid = drawerStoreId.value
  if (!sid) return
  const store = bundle.stores.find((s) => s.id === sid)
  const name = (store?.code || '') + '_' + (store?.name || '发票')
  const headers = [
    '进销项',
    '发票类型',
    '发票代码',
    '发票号码',
    '开票日',
    '不含税金额',
    '税额',
    '价税合计',
    '销售方名称',
    '销售方税号',
    '购买方名称',
    '购买方税号',
    '备注',
    '附件数',
  ]
  const lines = [headers.join(',')]
  for (const r of invForStore.value) {
    lines.push(
      [
        r.direction || '',
        r.invoiceKind || '',
        r.code || '',
        r.number || '',
        r.issueDate || '',
        r.amountExclTax ?? '',
        r.taxAmount ?? '',
        r.total ?? '',
        r.sellerName || '',
        r.sellerTaxId || '',
        r.buyerName || '',
        r.buyerTaxId || '',
        (r.remark || '').replace(/"/g, '""'),
        (r.files || []).length,
      ]
        .map((c) => `"${String(c)}"`)
        .join(','),
    )
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `发票_${name}_${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
  ElMessage.success('已导出')
}

function exportStoreRevenueCsv() {
  const sid = drawerStoreId.value
  if (!sid) return
  const rows = revForStoreSorted.value
  const store = bundle.stores.find((s) => s.id === sid)
  const name = (store?.code || '') + '_' + (store?.name || '营收')
  const headers = ['营业日', '渠道', '营业额', '退款调整', '净额', '含税口径', '备注', '附件数']
  const lines = [headers.join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.bizDate || '',
        REVENUE_CHANNELS[r.channel] || r.channel || '',
        r.grossAmount ?? '',
        r.refundAmount ?? '',
        r.netAmount ?? '',
        r.taxIncluded === false ? '否' : '是',
        (r.remark || '').replace(/"/g, '""'),
        Array.isArray(r.files) ? r.files.length : 0,
      ]
        .map((c) => `"${String(c)}"`)
        .join(','),
    )
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `门店营收_${name}_${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
  ElMessage.success('已导出')
}

/** 从磁盘重载门店包并按薪酬花名册重建 staff，再落盘（保留非薪酬 legacy 行） */
function reloadBundleAndSyncStaffFromPayroll() {
  Object.assign(bundle, loadStoreBundle())
  rebuildStoreStaffFromPayrollEmployees(bundle, loadPayrollBundle())
  persist()
}

function openDrawer(id) {
  drawerStoreId.value = id
  detailTab.value = 'ov'
  drawerVisible.value = true
  reloadBundleAndSyncStaffFromPayroll()
}

function resetStoreForm() {
  storeEditingId.value = ''
  Object.assign(storeForm, {
    code: '',
    name: '',
    status: 'operating',
    city: '',
    managerName: '',
    address: '',
    postalCode: '',
    latLng: '',
    areaM2: null,
    unitNo: '',
    leaseStart: '',
    leaseEnd: '',
    landlordName: '',
    landlordContact: '',
  })
}

function openStoreDialog(row) {
  resetStoreForm()
  if (row) {
    storeEditingId.value = row.id
    Object.assign(storeForm, {
      code: row.code,
      name: row.name,
      status: row.status || 'operating',
      city: row.city || '',
      managerName: row.managerName || '',
      address: row.address || '',
      postalCode: row.postalCode || '',
      latLng: row.latLng || '',
      areaM2: row.areaM2 ?? null,
      unitNo: row.unitNo || '',
      leaseStart: row.leaseStart || '',
      leaseEnd: row.leaseEnd || '',
      landlordName: row.landlordName || '',
      landlordContact: row.landlordContact || '',
    })
  }
  storeDialog.value = true
}

function saveStore() {
  if (!storeForm.code?.trim() || !storeForm.name?.trim()) {
    ElMessage.warning('请填写门店编码与名称')
    return
  }
  if (bundle.stores.some((s) => s.code === storeForm.code.trim() && s.id !== storeEditingId.value)) {
    ElMessage.warning('门店编码已存在')
    return
  }
  if (storeEditingId.value) {
    const idx = bundle.stores.findIndex((s) => s.id === storeEditingId.value)
    if (idx >= 0) {
      bundle.stores[idx] = {
        ...bundle.stores[idx],
        ...storeForm,
        code: storeForm.code.trim(),
        name: storeForm.name.trim(),
        updatedAt: Date.now(),
      }
    }
    ElMessage.success('已更新')
  } else {
    bundle.stores.push({
      id: genStoreEntityId('store'),
      ...storeForm,
      code: storeForm.code.trim(),
      name: storeForm.name.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    ElMessage.success('已创建')
  }
  persist()
  storeDialog.value = false
}

function removeStore(row) {
  ElMessageBox.confirm(`确定删除门店「${row.name}」？其子数据将一并删除。`, '提示', { type: 'warning' })
    .then(() => {
      const id = row.id
      commitLocalChange(() => {
        bundle.stores = bundle.stores.filter((s) => s.id !== id)
        bundle.licenses = bundle.licenses.filter((l) => l.storeId !== id)
        bundle.rentPayments = bundle.rentPayments.filter((r) => r.storeId !== id)
        bundle.invoices = bundle.invoices.filter((i) => i.storeId !== id)
        bundle.revenueEntries = bundle.revenueEntries.filter((r) => r.storeId !== id)
        bundle.staff = bundle.staff.filter((s) => s.storeId !== id)
        if (drawerStoreId.value === id) drawerVisible.value = false
      })
    })
    .catch((e) => {
      if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e)
    })
}

function syncLicenseTypeName() {
  const t = bundle.licenseTypes.find((x) => x.id === licenseForm.licenseTypeId)
  licenseForm.typeName = t?.name || ''
}

function openLicenseDialog() {
  if (!drawerStoreId.value) return
  licenseForm.licenseTypeId = bundle.licenseTypes[0]?.id || ''
  licenseForm.typeName = bundle.licenseTypes[0]?.name || ''
  licenseForm.certNo = ''
  licenseForm.issuer = ''
  licenseForm.validFrom = ''
  licenseForm.validTo = ''
  licenseForm.isCurrent = true
  licenseForm.files = []
  licenseDialog.value = true
}

async function uploadLicenseFiles(opt) {
  try {
    const id = await uploadAdminBinary(opt.file, 'store-licenses')
    licenseForm.files.push({ fileId: id, name: opt.file.name, uploadedAt: Date.now() })
    opt.onSuccess?.({}, opt.file)
  } catch (e) {
    ElMessage.error('上传失败：' + (e.message || '请检查云存储权限'))
    opt.onError?.(e)
  }
}

function saveLicense() {
  if (!drawerStoreId.value) return
  const id = genStoreEntityId('lic')
  if (licenseForm.isCurrent) {
    bundle.licenses.forEach((l) => {
      if (l.storeId === drawerStoreId.value && l.licenseTypeId === licenseForm.licenseTypeId) {
        l.isCurrent = false
      }
    })
  }
  bundle.licenses.push({
    id,
    storeId: drawerStoreId.value,
    licenseTypeId: licenseForm.licenseTypeId,
    typeName: licenseForm.typeName,
    certNo: licenseForm.certNo,
    issuer: licenseForm.issuer,
    validFrom: licenseForm.validFrom,
    validTo: licenseForm.validTo,
    isCurrent: !!licenseForm.isCurrent,
    files: [...licenseForm.files],
    createdAt: Date.now(),
  })
  persist()
  licenseDialog.value = false
  ElMessage.success('已保存')
}

function removeLicense(row) {
  ElMessageBox.confirm('确定删除该证照记录？附件元数据将一并删除（云文件需另行清理策略）。', '提示', { type: 'warning' })
    .then(() => {
      commitLocalChange(() => {
        bundle.licenses = bundle.licenses.filter((l) => l.id !== row.id)
      })
    })
    .catch((e) => {
      if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e)
    })
}

function openRentDialog() {
  Object.assign(rentForm, {
    periodStart: '',
    periodEnd: '',
    amount: 0,
    payDate: '',
    payMethod: '',
    payeeName: '',
    voucherNo: '',
    remark: '',
    files: [],
  })
  rentDialog.value = true
}

async function uploadRentFiles(opt) {
  try {
    const id = await uploadAdminBinary(opt.file, 'store-rent')
    rentForm.files.push({ fileId: id, name: opt.file.name, uploadedAt: Date.now() })
    opt.onSuccess?.({}, opt.file)
  } catch (e) {
    ElMessage.error('上传失败：' + (e.message || ''))
    opt.onError?.(e)
  }
}

function saveRent() {
  if (!drawerStoreId.value) return
  bundle.rentPayments.push({
    id: genStoreEntityId('rent'),
    storeId: drawerStoreId.value,
    ...rentForm,
    files: [...rentForm.files],
    createdAt: Date.now(),
  })
  persist()
  rentDialog.value = false
  ElMessage.success('已保存')
}

function removeRent(row) {
  ElMessageBox.confirm('确定删除该租金记录？', '提示', { type: 'warning' })
    .then(() => {
      commitLocalChange(() => {
        bundle.rentPayments = bundle.rentPayments.filter((r) => r.id !== row.id)
      })
    })
    .catch((e) => {
      if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e)
    })
}

function openInvoiceDialog() {
  Object.assign(invoiceForm, {
    direction: 'in',
    invoiceKind: '电子普通发票',
    code: '',
    number: '',
    issueDate: '',
    amountExclTax: 0,
    taxAmount: 0,
    total: 0,
    sellerName: '',
    sellerTaxId: '',
    buyerName: '',
    buyerTaxId: '',
    remark: '',
    files: [],
  })
  invoiceDialog.value = true
}

async function uploadInvoiceFiles(opt) {
  try {
    const id = await uploadAdminBinary(opt.file, 'store-invoice')
    invoiceForm.files.push({ fileId: id, name: opt.file.name, uploadedAt: Date.now() })
    opt.onSuccess?.({}, opt.file)
  } catch (e) {
    ElMessage.error('上传失败：' + (e.message || ''))
    opt.onError?.(e)
  }
}

function saveInvoice() {
  if (!drawerStoreId.value) return
  const c = (invoiceForm.code || '').trim()
  const n = (invoiceForm.number || '').trim()
  if (c && n) {
    const dup = bundle.invoices.some(
      (i) =>
        i.storeId === drawerStoreId.value &&
        String(i.code || '').trim() === c &&
        String(i.number || '').trim() === n,
    )
    if (dup) {
      ElMessage.warning('同店已存在相同发票代码与号码')
      return
    }
  }
  bundle.invoices.push({
    id: genStoreEntityId('inv'),
    storeId: drawerStoreId.value,
    direction: invoiceForm.direction === 'out' ? '销项' : '进项',
    invoiceKind: invoiceForm.invoiceKind,
    code: invoiceForm.code,
    number: invoiceForm.number,
    issueDate: invoiceForm.issueDate,
    amountExclTax: invoiceForm.amountExclTax,
    taxAmount: invoiceForm.taxAmount,
    total: invoiceForm.total,
    sellerName: invoiceForm.sellerName,
    sellerTaxId: invoiceForm.sellerTaxId,
    buyerName: invoiceForm.buyerName,
    buyerTaxId: invoiceForm.buyerTaxId,
    remark: invoiceForm.remark,
    files: [...invoiceForm.files],
    createdAt: Date.now(),
  })
  persist()
  invoiceDialog.value = false
  ElMessage.success('已保存')
}

function removeInv(row) {
  ElMessageBox.confirm('确定删除该发票登记？', '提示', { type: 'warning' })
    .then(() => {
      commitLocalChange(() => {
        bundle.invoices = bundle.invoices.filter((i) => i.id !== row.id)
      })
    })
    .catch((e) => {
      if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e)
    })
}

function openRevenueDialog() {
  Object.assign(revenueForm, {
    bizDate: '',
    channel: 'offline_pos',
    grossAmount: 0,
    refundAmount: 0,
    netAmount: 0,
    taxIncluded: true,
    remark: '',
    files: [],
  })
  revenueDialog.value = true
}

async function uploadRevenueFiles(opt) {
  try {
    const id = await uploadAdminBinary(opt.file, 'store-revenue')
    revenueForm.files.push({ fileId: id, name: opt.file.name, uploadedAt: Date.now() })
    opt.onSuccess?.({}, opt.file)
  } catch (e) {
    ElMessage.error('上传失败：' + (e.message || ''))
    opt.onError?.(e)
  }
}

function saveRevenue() {
  if (!drawerStoreId.value || !revenueForm.bizDate) {
    ElMessage.warning('请填写营业日')
    return
  }
  let net = Number(revenueForm.netAmount)
  if (!net && (revenueForm.grossAmount || revenueForm.refundAmount)) {
    net = Number(revenueForm.grossAmount || 0) - Number(revenueForm.refundAmount || 0)
  }
  bundle.revenueEntries.push({
    id: genStoreEntityId('rev'),
    storeId: drawerStoreId.value,
    bizDate: revenueForm.bizDate,
    channel: revenueForm.channel,
    grossAmount: revenueForm.grossAmount,
    refundAmount: revenueForm.refundAmount,
    netAmount: net,
    taxIncluded: revenueForm.taxIncluded !== false,
    remark: revenueForm.remark,
    files: [...revenueForm.files],
    createdAt: Date.now(),
  })
  persist()
  revenueDialog.value = false
  ElMessage.success('已保存')
}

function removeRev(row) {
  ElMessageBox.confirm('确定删除该营收行？', '提示', { type: 'warning' })
    .then(() => {
      commitLocalChange(() => {
        bundle.revenueEntries = bundle.revenueEntries.filter((r) => r.id !== row.id)
      })
    })
    .catch((e) => {
      if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e)
    })
}

async function previewFile(fileId) {
  if (!fileId?.startsWith('cloud://')) {
    ElMessage.warning('无效文件')
    return
  }
  const url = await getTempFileUrl(fileId)
  if (url) window.open(url, '_blank', 'noopener')
  else ElMessage.error('无法获取预览链接')
}

function onUnifiedEmployeesChanged() {
  reloadBundleAndSyncStaffFromPayroll()
}

onMounted(() => {
  loading.value = true
  try {
    reloadBundleAndSyncStaffFromPayroll()
  } finally {
    loading.value = false
  }
  window.addEventListener(UNIFIED_EMPLOYEES_CHANGED, onUnifiedEmployeesChanged)
})

onUnmounted(() => {
  window.removeEventListener(UNIFIED_EMPLOYEES_CHANGED, onUnifiedEmployeesChanged)
})

watch(detailTab, (t) => {
  if (t === 'stf' && drawerVisible.value) reloadBundleAndSyncStaffFromPayroll()
})
</script>

<style scoped>
.store-mgmt .table-card {
  margin-top: 0;
}
.drawer-sub {
  font-size: 12px;
  color: var(--light-text-tertiary);
  margin-bottom: 12px;
}
.stat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}
.tab-actions {
  margin-bottom: 10px;
}
.staff-sync-hint {
  margin-bottom: 12px;
}
.file-link {
  display: inline-block;
  margin-right: 8px;
  font-size: 12px;
}
.muted-dash {
  color: var(--light-text-tertiary, #909399);
  font-size: 12px;
}
.rev-prd-hint {
  margin-bottom: 12px;
}
.rev-summary-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 16px;
  margin-bottom: 12px;
}
.sub-block-title {
  font-size: 13px;
  font-weight: 600;
  margin: 8px 0 6px;
  color: var(--light-text-secondary, #606266);
}
.rollup-table {
  margin-bottom: 12px;
}
.dialog-hint {
  font-size: 12px;
  color: var(--light-text-tertiary, #909399);
  margin: 0 0 12px;
}
.rev-import-hint {
  margin-bottom: 10px;
}
</style>
