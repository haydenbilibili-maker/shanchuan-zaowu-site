/**
 * 集合保障：首次写入遇 -502005 时 createCollection
 * 权限建议控制台设为仅云函数可读写（read/write: false）
 */
function errorText(err) {
  return [err && err.errCode, err && err.errMsg, err && err.message, String(err || '')]
    .filter(Boolean)
    .join(' ')
}

function isMissingCollectionError(err) {
  return /502005|DATABASE_COLLECTION_NOT_EXIST|collection not exist|集合不存在/i.test(errorText(err))
}

function isCollectionExistsError(err) {
  return /already exist|already exists|COLLECTION_EXIST|ResourceExist|-501001/i.test(errorText(err))
}

async function ensureCollection(db, name) {
  try {
    await db.createCollection(name)
    console.log('created collection', name)
  } catch (err) {
    if (isCollectionExistsError(err)) return
    throw err
  }
}

async function withCollectionRetry(db, collectionName, fn) {
  try {
    return await fn()
  } catch (err) {
    if (!isMissingCollectionError(err)) throw err
    await ensureCollection(db, collectionName)
    return await fn()
  }
}

module.exports = {
  errorText,
  isMissingCollectionError,
  isCollectionExistsError,
  ensureCollection,
  withCollectionRetry
}
