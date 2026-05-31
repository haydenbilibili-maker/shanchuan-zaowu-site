/**
 * 错误日志云函数
 * 用于收集和存储错误信息
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const { error, errors } = event;

  try {
    // 批量上报
    if (errors && Array.isArray(errors)) {
      const logs = errors.map(err => ({
        ...err,
        _openid: err.userId || wxContext.OPENID,
        createTime: db.serverDate()
      }));

      // 批量插入（限制每次最多20条）
      const batchSize = 20;
      let insertedCount = 0;
      for (let i = 0; i < logs.length; i += batchSize) {
        const batch = logs.slice(i, i + batchSize);
        try {
          // 逐条插入（因为微信云数据库不支持批量插入数组）
          const promises = batch.map(log => 
            db.collection('error_logs').add({
              data: {
                ...log,
                _openid: log._openid || wxContext.OPENID,
                createTime: db.serverDate()
              }
            })
          );
          await Promise.all(promises);
          insertedCount += batch.length;
        } catch (e) {
          console.error('批量插入错误日志失败:', e);
        }
      }

      return {
        success: true,
        count: logs.length
      };
    }

    // 单条上报
    if (error) {
      await db.collection('error_logs').add({
        data: {
          ...error,
          _openid: error.userId || wxContext.OPENID,
          createTime: db.serverDate()
        }
      });

      return {
        success: true
      };
    }

    return {
      success: false,
      msg: '缺少错误信息'
    };
  } catch (e) {
    console.error('错误日志上报失败:', e);
    // 即使上报失败，也不抛出错误，避免影响用户体验
    return {
      success: false,
      msg: e.message
    };
  }
};

