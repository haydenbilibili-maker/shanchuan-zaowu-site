/**
 * 分包侧转发：真正实现在主包 utils/workspaceRoles.js
 * （主包不可 require 分包；分包可引用主包）
 */
module.exports = require('../../../utils/workspaceRoles')
