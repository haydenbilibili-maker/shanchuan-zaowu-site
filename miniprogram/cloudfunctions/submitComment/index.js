/**
 * 提交评价云函数
 * 支持对藏品、活动、课程进行评价
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { targetType, targetId, rating, content, images = [] } = event
  const userId = wxContext.OPENID

  // 参数验证
  if (!targetType || !targetId || !rating) {
    return {
      success: false,
      msg: '参数不完整'
    }
  }

  if (rating < 1 || rating > 5) {
    return {
      success: false,
      msg: '评分必须在1-5之间'
    }
  }

  if (!content || content.trim().length === 0) {
    return {
      success: false,
      msg: '评价内容不能为空'
    }
  }

  if (images.length > 3) {
    return {
      success: false,
      msg: '最多只能上传3张图片'
    }
  }

  try {
    // 检查用户是否已评价过（可选：允许修改评价）
    const existingComment = await db.collection('comments')
      .where({
        targetType,
        targetId,
        userId,
        status: _.neq('rejected')
      })
      .get()

    if (existingComment.data.length > 0) {
      // 如果已存在，更新评价
      const commentId = existingComment.data[0]._id
      await db.collection('comments').doc(commentId).update({
        data: {
          rating,
          content: content.trim(),
          images,
          status: 'pending', // 重新提交需要审核
          updatedAt: new Date()
        }
      })

      return {
        success: true,
        msg: '评价已更新，等待审核',
        commentId
      }
    }

    // 创建新评价
    const result = await db.collection('comments').add({
      data: {
        targetType,
        targetId,
        userId,
        rating,
        content: content.trim(),
        images,
        likes: 0,
        replies: [],
        status: 'pending', // 默认待审核
        createdAt: new Date(),
        updatedAt: new Date()
      }
    })

    // 评价奖励：发放积分（使用earnPoints云函数，异步调用）
    try {
      await cloud.callFunction({
        name: 'earnPoints',
        data: {
          userId,
          points: 10, // 评价奖励10积分
          reason: '评价奖励',
          source: 'comment',
          sourceId: result._id
        }
      })
    } catch (e) {
      console.warn('发放评价奖励失败:', e)
      // 不影响评价提交
    }

    return {
      success: true,
      msg: '评价提交成功，等待审核',
      commentId: result._id
    }
  } catch (e) {
    console.error('提交评价失败:', e)
    return {
      success: false,
      msg: e.message || '提交评价失败'
    }
  }
}






