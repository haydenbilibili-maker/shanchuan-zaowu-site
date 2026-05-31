// cloudfunctions/moveCollectionItems/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

/**
 * 移动收藏物品到收藏夹
 * @param {Object} event - 事件参数
 * @param {Array} event.itemIds - 物品ID数组
 * @param {string} event.folderId - 目标收藏夹ID（null表示移出收藏夹）
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { itemIds, folderId } = event;

  if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
    return { success: false, msg: '请选择要移动的物品' };
  }

  try {
    // 如果指定了收藏夹，验证收藏夹是否存在
    if (folderId) {
      const folderRes = await db.collection('collection_folders').doc(folderId).get();
      if (!folderRes.data || folderRes.data._openid !== openid) {
        return { success: false, msg: '收藏夹不存在或无权限' };
      }
    }

    // 批量更新物品的folderId
    const tasks = itemIds.map(itemId => {
      return db.collection('collections').where({
        _openid: openid,
        _id: itemId
      }).update({
        data: {
          folderId: folderId || null,
          updateTime: db.serverDate()
        }
      });
    });

    await Promise.all(tasks);

    // 更新收藏夹的物品数量
    if (folderId) {
      const countRes = await db.collection('collections').where({
        _openid: openid,
        folderId: folderId
      }).count();
      
      await db.collection('collection_folders').doc(folderId).update({
        data: {
          itemCount: countRes.total,
          updateTime: db.serverDate()
        }
      });
    }

    return {
      success: true,
      msg: '移动成功'
    };
  } catch (err) {
    console.error('移动物品失败:', err);
    return { success: false, msg: '移动失败', error: err.message };
  }
};








