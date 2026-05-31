/**
 * 点赞评价云函数
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { commentId, isLike } = event
  const userId = wxContext.OPENID

  if (!commentId) {
    return {
      success: false,
      msg: '参数不完整'
    }
  }

  try {
    const commentRef = db.collection('comments').doc(commentId)
    const comment = await commentRef.get()

    if (!comment.data) {
      return {
        success: false,
        msg: '评价不存在'
      }
    }

    // 更新点赞数
    if (isLike) {
      await commentRef.update({
        data: {
          likes: _.inc(1)
        }
      })
    } else {
      // 取消点赞（点赞数不能小于0）
      await commentRef.update({
        data: {
          likes: _.max([_.inc(-1), 0])
        }
      })
    }

    // 获取更新后的点赞数
    const updatedComment = await commentRef.get()

    return {
      success: true,
      likes: updatedComment.data.likes || 0
    }
  } catch (e) {
    console.error('点赞评价失败:', e)
    return {
      success: false,
      msg: e.message || '操作失败'
    }
  }
}






