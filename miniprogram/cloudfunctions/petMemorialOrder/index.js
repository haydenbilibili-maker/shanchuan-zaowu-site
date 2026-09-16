const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function genOrderNo() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `PM${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${String(Date.now()).slice(-6)}`
}

/**
 * 需求 14：把「客户指定的标本师」解析成可投递的权威对象。
 *
 * 为什么必须重解析：客户端只传 framerId，姓名与 openid 全部以 `framers` 档案为准 ——
 * 否则伪造 client 字段就能把工单派到任意 openid（越权投递）。
 *
 * 三条门槛与 `getPetMemorialConfig.loadPetArtisans` 完全一致，缺一即视为「当前不可接单」：
 * petOrderQualified === true / active !== false / staffOpenid 非空。
 */
async function resolveQualifiedArtisan(framerId) {
  const id = String(framerId || '').trim()
  if (!id) return null
  try {
    const res = await db.collection('framers').doc(id).get()
    const row = res && res.data
    if (!row) return null
    if (row.active === false) return null
    if (row.petOrderQualified !== true) return null
    const artisanOpenid = String(row.staffOpenid || '').trim()
    if (!artisanOpenid) return null
    return {
      framerId: row._id,
      framerName: row.name || '标本师',
      artisanOpenid,
      priceDelta: row.priceDelta != null ? Number(row.priceDelta) : 0,
      extraDays: row.extraDays != null ? parseInt(row.extraDays, 10) || 0 : 0
    }
  } catch (e) {
    console.warn('resolveQualifiedArtisan failed:', id, e && e.message)
    return null
  }
}

/** 服务端自行解析「调用者名下的 framerId」，不接受客户端传入的 framerId（防越权查看） */
async function findFramerIdByStaffOpenid(openid) {
  const so = String(openid || '').trim()
  if (!so) return ''
  try {
    const res = await db.collection('framers').where({ staffOpenid: so }).limit(1).get()
    const row = (res.data || [])[0]
    return (row && row._id) || ''
  } catch (e) {
    console.warn('findFramerIdByStaffOpenid failed:', e && e.message)
    return ''
  }
}

exports.main = async (event) => {
  const { action } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (action === 'get') {
    const { orderId } = event
    if (!orderId) return { success: false, msg: '缺少 orderId' }
    try {
      const res = await db.collection('pet_memorial_orders').doc(orderId).get()
      const doc = res.data
      if (!doc) return { success: false, msg: '工单不存在' }
      if (doc._openid !== openid) return { success: false, msg: '无权查看' }
      return { success: true, order: doc }
    } catch (e) {
      return { success: false, msg: e.message }
    }
  }

  if (action === 'list') {
    if (!openid) return { success: false, list: [] }
    try {
      const res = await db.collection('pet_memorial_orders')
        .where({ _openid: openid })
        .orderBy('createTime', 'desc')
        .limit(20)
        .get()
      return { success: true, list: res.data }
    } catch (e) {
      return { success: false, list: [], msg: e.message }
    }
  }

  if (action === 'confirmQuote') {
    const { orderId } = event
    if (!orderId) return { success: false, msg: '缺少 orderId' }
    try {
      const res = await db.collection('pet_memorial_orders').doc(orderId).get()
      const doc = res.data
      if (!doc || doc._openid !== openid) return { success: false, msg: '无权操作' }
      if (doc.status !== 'quoted') return { success: false, msg: '当前状态不可确认报价' }
      if (!doc.quote || doc.quote.amount == null) return { success: false, msg: '暂无有效报价' }

      const logEntry = {
        status: 'accepted',
        time: new Date().toISOString(),
        note: '用户已确认报价'
      }
      await db.collection('pet_memorial_orders').doc(orderId).update({
        data: {
          status: 'accepted',
          'quote.confirmedAt': new Date().toISOString(),
          updateTime: db.serverDate(),
          productionLog: db.command.push([logEntry])
        }
      })
      return { success: true, msg: '已确认报价' }
    } catch (e) {
      return { success: false, msg: e.message }
    }
  }

  if (action === 'submit') {
    if (!openid) return { success: false, msg: '未登录' }
    const { payload } = event
    if (!payload || !payload.consent) {
      return { success: false, msg: '请完成知情确认' }
    }
    const pet = payload.pet || {}
    const craft = payload.craft || {}
    const contact = payload.contact || {}
    if (!pet.name || !pet.species) {
      return { success: false, msg: '请填写宠物档案' }
    }
    if (!craft.craftId) {
      return { success: false, msg: '请选择工艺' }
    }
    if (!contact.name || !contact.phone || String(contact.phone).length < 11) {
      return { success: false, msg: '请填写有效联系方式' }
    }

    // 需求 13：交接方式白名单兜底。
    // UI 已把「合作医院代交(partner_clinic)」置灰，但旧客户端或直接构造 payload 仍可提交，
    // 故云端必须独立校验（此前完全没有 intake 校验，任意字符串都能落库）。
    const ALLOWED_INTAKE = ['store', 'pickup']
    const intakeMethod = String((payload.intake && payload.intake.method) || '').trim()
    if (!intakeMethod) {
      return { success: false, msg: '请选择交接方式' }
    }
    if (ALLOWED_INTAKE.indexOf(intakeMethod) === -1) {
      return { success: false, msg: '该交接方式暂未开放，请选择到店交接或上门收运' }
    }

    // 需求 14：指定标本师（选填）。以 framers 档案为准复核，选到不可接单的人就当场拦下，
    // 不允许「静默落成平台指派」——否则客户以为指定成功，实际没人收到通知。
    let artisan = null
    const wantFramerId = String((payload.artisan && payload.artisan.framerId) || '').trim()
    if (wantFramerId) {
      artisan = await resolveQualifiedArtisan(wantFramerId)
      if (!artisan) {
        return { success: false, msg: '所选标本师当前不可接单，请改选其他标本师或改为平台指派' }
      }
    }

    const orderNo = genOrderNo()
    const now = db.serverDate()
    const submitTime = new Date().toISOString()
    try {
      const addRes = await db.collection('pet_memorial_orders').add({
        data: {
          _openid: openid,
          orderNo,
          status: 'pending_review',
          pet,
          craft,
          intake: payload.intake || {},
          contact,
          consent: payload.consent,
          // 需求 14：指派信息。扁平字段 artisanFramerId/artisanOpenid 供服务端精确查询，
          // 嵌套 artisan 供展示 —— 扁平字段一律取自服务端解析结果，不取客户端入参。
          artisan: artisan
            ? {
                framerId: artisan.framerId,
                framerName: artisan.framerName,
                priceDelta: artisan.priceDelta,
                extraDays: artisan.extraDays,
                assignedAt: submitTime,
                acceptedAt: ''
              }
            : null,
          artisanFramerId: artisan ? artisan.framerId : '',
          artisanOpenid: artisan ? artisan.artisanOpenid : '',
          quote: null,
          productionLog: [{ status: 'pending_review', time: submitTime, note: '用户提交意向' }],
          createTime: now,
          updateTime: now
        }
      })

      cloud.callFunction({
        name: 'dispatchMessage',
        data: {
          action: 'dispatch',
          eventType: 'pet_memorial_received',
          openid,
          relatedId: addRes._id,
          vars: {
            petName: pet.name,
            orderNo
          }
        }
      }).catch((err) => console.warn('pet message failed:', err))

      // 需求 14：定向通知被指派的标本师本人（工单类服务通知，走 staff_ 前缀的工作通知通道）。
      // 未配置模板环境变量时 notifyWorkOrder 会优雅跳过，不影响下单。
      if (artisan && artisan.artisanOpenid) {
        cloud.callFunction({
          name: 'dispatchMessage',
          data: {
            action: 'notifyWorkOrder',
            category: 'pet_memorial_assigned',
            openid: artisan.artisanOpenid,
            relatedId: addRes._id,
            vars: {
              orderNo,
              petName: pet.name,
              craftName: craft.craftName || '',
              submitTime
            }
          }
        }).catch((err) => console.warn('pet artisan notify failed:', err))
      }

      return { success: true, orderId: addRes._id, orderNo, msg: '提交成功' }
    } catch (e) {
      console.error('submit pet memorial:', e)
      return { success: false, msg: e.message || '提交失败' }
    }
  }

  /**
   * 需求 14：标本师工作台 —— 指派给我的伴宠工单。
   * framerId 一律由服务端按调用者 openid 反查，客户端传什么都不采纳。
   */
  if (action === 'listArtisan') {
    if (!openid) return { success: false, list: [], msg: '未登录' }
    try {
      const framerId = await findFramerIdByStaffOpenid(openid)
      if (!framerId) return { success: true, list: [], framerId: '', msg: '' }
      const res = await db.collection('pet_memorial_orders')
        .where({ artisanFramerId: framerId })
        .orderBy('createTime', 'desc')
        .limit(30)
        .get()
      const list = (res.data || []).map((doc) => ({
        _id: doc._id,
        orderNo: doc.orderNo,
        status: doc.status,
        petName: doc.pet ? doc.pet.name : '',
        petSpecies: doc.pet ? (doc.pet.speciesLabel || doc.pet.species) : '',
        craftName: doc.craft ? doc.craft.craftName : '',
        intakeMethodLabel: doc.intake ? doc.intake.methodLabel : '',
        preferredDate: doc.intake ? doc.intake.preferredDate : '',
        contactName: doc.contact ? doc.contact.name : '',
        contactPhone: doc.contact ? doc.contact.phone : '',
        acceptedAt: (doc.artisan && doc.artisan.acceptedAt) || '',
        quoteAmount: doc.quote && doc.quote.amount != null ? doc.quote.amount : null,
        createTime: doc.createTime
      }))
      return { success: true, list, framerId }
    } catch (e) {
      console.warn('listArtisan pet orders failed:', e && e.message)
      return { success: false, list: [], msg: e.message }
    }
  }

  /**
   * 需求 14：标本师确认接单。只能确认「派给自己」的工单，且不可重复确认。
   * 报价 / 状态流转仍归店长与超管工作台，本函数只开放这一个动作 —
   * 避免标本师侧出现超出其职责的写入口。
   */
  if (action === 'acceptAssignment') {
    const { orderId } = event
    if (!orderId) return { success: false, msg: '缺少 orderId' }
    if (!openid) return { success: false, msg: '未登录' }
    try {
      const framerId = await findFramerIdByStaffOpenid(openid)
      if (!framerId) return { success: false, msg: '当前账号未绑定标本师档案' }
      const res = await db.collection('pet_memorial_orders').doc(orderId).get()
      const doc = res && res.data
      if (!doc) return { success: false, msg: '工单不存在' }
      if (String(doc.artisanFramerId || '') !== framerId) {
        return { success: false, msg: '该工单未指派给你' }
      }
      if (doc.artisan && doc.artisan.acceptedAt) {
        return { success: false, msg: '已确认过接单' }
      }
      const acceptedAt = new Date().toISOString()
      await db.collection('pet_memorial_orders').doc(orderId).update({
        data: {
          'artisan.acceptedAt': acceptedAt,
          updateTime: db.serverDate(),
          productionLog: db.command.push([
            { status: doc.status || 'pending_review', time: acceptedAt, note: '标本师已确认接单' }
          ])
        }
      })
      return { success: true, msg: '已确认接单', acceptedAt }
    } catch (e) {
      console.error('acceptAssignment failed:', e)
      return { success: false, msg: e.message || '操作失败' }
    }
  }

  return { success: false, msg: '未知 action' }
}
