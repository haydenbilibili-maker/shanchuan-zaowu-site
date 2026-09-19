/**
 * 出货算价引擎（**门面**）—— 真正实现在 `pricingCore.js`
 *
 * 为什么拆成两个文件：
 *   云函数之间不能跨目录 require（仓库惯例：共享模块逐函数留副本，见 check:shared-modules）。
 *   价目表的**写入方**是 `manageStudioSettlement`，算价方是 `manageStoreShipment`，
 *   两边都要做**同一套名称归一化**（否则「同一材料」的判定会不一致：
 *   一个把 `大蓝闪 蝶` 和 `大蓝闪蝶` 当两个材料，另一个当一个）。
 *   所以把纯函数抽到 `pricingCore.js` 作**唯一真源**，两个函数目录各留一份逐字节副本，
 *   并由 `check:shared-modules` 守副本一致。
 *
 * 本文件保留 `pricingEngine` 这个名字作为对外门面：
 *   调用方（云函数 action、守卫测试）继续 require 本文件，不必知道内部拆分。
 *
 * 铁律（违反即为交付失败）见 `pricingCore.js` 头部注释。
 */

module.exports = require('./pricingCore')
