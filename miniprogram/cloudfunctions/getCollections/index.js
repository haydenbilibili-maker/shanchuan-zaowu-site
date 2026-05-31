// cloudfunctions/getCollections/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  try {
    // 假设你的专题数据存在一个名为 'curated_collections' 的集合中
    // 如果没有，可以先在数据库手动创建几条
    const res = await db.collection('curated_collections')
      .where({ status: 'published' })
      .orderBy('sortOrder', 'asc')
      .get()

    let collections = res.data

    // 🟢 核心修复：批量转换文件 ID
    if (collections.length > 0) {
      const fileList = collections.map(item => item.cover);
      const fileRes = await cloud.getTempFileURL({ fileList: fileList });
      
      // 将 HTTPS 链接合并回数据
      collections.forEach(item => {
        const match = fileRes.fileList.find(file => file.fileID === item.cover);
        if (match && match.tempFileURL) {
          item.cover = match.tempFileURL;
        }
      });
    }

    return { success: true, data: collections };
  } catch (e) {
    console.error(e);
    return { success: false, data: [] };
  }
}