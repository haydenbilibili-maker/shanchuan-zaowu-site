/**
 * 装裱方式 / 制作工艺：**云端覆写层的纯函数**（ERP 侧）。
 *
 * 为什么单独一个模块（而不是写在 `App.vue` 里）：
 *   `App.vue` 是 5300 行的 SFC，守卫**无法对它求值**，只能做结构断言（"看起来接对了"）。
 *   而本仓反复吃过"结构对、行为错"的亏（错题本 E7：**判据自身会失效**）。
 *   把纯函数抽出来之后，守卫可以像测小程序 `config/productTaxonomy.js` 那样**真的求值**：
 *   传 `null` 必须退回代码默认、传空/非法项必须丢弃、`other` 必须恒在最后。
 *
 * 语义**必须**与小程序 `miniprogram/config/productTaxonomy.js` 的
 *   `normalizeOverlayList` / `otherLast` / `craftTypeOptions` 逐条一致 ——
 *   不一致就是下一处"双真源"（那条字段在 ERP 与小程序的显示会分叉）。
 */

/**
 * 归一化一份云端选项表。
 * @param raw 云端返回的 `[{value,label}]`（可能为 null / 非数组 / 含脏项）
 * @returns 归一化后的数组；**空或非法一律 null**（= 让调用方退回代码默认，绝不把界面弄空）
 */
export function normalizeOverlayList(raw) {
    if (!Array.isArray(raw)) return null
    const seen = new Set()
    const out = []
    for (const item of raw) {
        const value = String((item && item.value) || '').trim()
        const label = String((item && item.label) || '').trim()
        // 无 value 或 label 的项直接丢（渲染出来是空白行）；重复 value 只留第一个（后台不该出现，防脏数据）
        if (!value || !label || seen.has(value)) continue
        seen.add(value)
        out.push({ value, label })
    }
    return out.length ? out : null
}

/**
 * 把 `other`（「其它」）移到**最后**；其余保持原有相对顺序。
 *
 * 产品负责人 2026-09-21 口径：「其它」必须恒在最后。
 * 为什么放在这一层：选项表有多个消费方（ERP 下拉、C 端筛选、字段维护 picker…），
 * 只有在出口排一次才不用每个消费方各排一遍。
 * ⚠️ 云端字典里 `other` 原本排在中间（后台新增的选项会插在它后面），所以这一步不能省。
 * 用稳定做法（filter 两遍再拼接），**不重排后台的编排**。
 */
export function otherLast(list) {
    const arr = Array.isArray(list) ? list.slice() : []
    const rest = arr.filter((o) => !o || String(o.value) !== 'other')
    const tail = arr.filter((o) => o && String(o.value) === 'other')
    return rest.concat(tail)
}

/**
 * 当前生效的选项表：**云端覆写优先，否则代码默认**；`other` 恒在最后。
 * @param base 代码默认数组（ERP 里那份与小程序逐字一致的清单）
 * @param overlayList 已归一化的云端覆写（`null` = 没有覆写）
 */
export function resolveCraftOptions(base, overlayList) {
    return otherLast(overlayList || base)
}
