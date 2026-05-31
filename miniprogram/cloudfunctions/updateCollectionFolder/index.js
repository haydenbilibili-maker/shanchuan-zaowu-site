// cloudfunctions/updateCollectionFolder/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

/**
 * 更新收藏夹（重命名、删除）
 * @param {Object} event - 事件参数
 * @param {string} event.folderId - 收藏夹ID
 * @param {string} event.action - 操作类型：rename, delete
 * @param {string} event.name - 新名称（重命名时）
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { folderId, action, name } = event;

  if (!folderId || !action) {
    return { success: false, msg: '参数不完整' };
  }

  try {
    // 查询收藏夹
    const folderRes = await db.collection('collection_folders').doc(folderId).get();
    const folder = folderRes.data;

    if (!folder) {
      return { success: false, msg: '收藏夹不存在' };
    }

    // 验证权限
    if (folder._openid !== openid) {
      return { success: false, msg: '无权限操作' };
    }

    if (action === 'rename') {
      if (!name || name.trim() === '') {
        return { success: false, msg: '名称不能为空' };
      }

      // 检查是否已存在同名收藏夹
      const existing = await db.collection('collection_folders').where({
        _openid: openid,
        name: name.trim(),
        _id: db.command.neq(folderId)
      }).get();

      if (existing.data.length > 0) {
        return { success: false, msg: '收藏夹名称已存在' };
      }

      // 更新名称
      await db.collection('collection_folders').doc(folderId).update({
        data: {
          name: name.trim(),
          updateTime: db.serverDate()
        }
      });

      return { success: true, msg: '重命名成功' };
    } else if (action === 'delete') {
      // 检查收藏夹中是否有物品
      const itemsRes = await db.collection('collections').where({
        _openid: openid,
        folderId: folderId
      }).count();

      if (itemsRes.total > 0) {
        return { success: false, msg: '收藏夹不为空，无法删除' };
      }

      // 删除收藏夹
      await db.collection('collection_folders').doc(folderId).remove();

      return { success: true, msg: '删除成功' };
    } else {
      return { success: false, msg: '未知操作' };
    }
  } catch (err) {
    console.error('更新收藏夹失败:', err);
    return { success: false, msg: '操作失败', error: err.message };
  }
};








