// cloudfunctions/createCollectionFolder/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

/**
 * 创建收藏夹
 * @param {Object} event - 事件参数
 * @param {string} event.name - 收藏夹名称
 * @param {string} event.description - 收藏夹描述（可选）
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { name, description } = event;

  if (!name || name.trim() === '') {
    return { success: false, msg: '收藏夹名称不能为空' };
  }

  try {
    // 检查是否已存在同名收藏夹
    const existing = await db.collection('collection_folders').where({
      _openid: openid,
      name: name.trim()
    }).get();

    if (existing.data.length > 0) {
      return { success: false, msg: '收藏夹名称已存在' };
    }

    // 创建收藏夹
    const res = await db.collection('collection_folders').add({
      data: {
        _openid: openid,
        name: name.trim(),
        description: description || '',
        itemCount: 0,
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    });

    return {
      success: true,
      msg: '创建成功',
      folderId: res._id
    };
  } catch (err) {
    console.error('创建收藏夹失败:', err);
    return { success: false, msg: '创建失败', error: err.message };
  }
};








