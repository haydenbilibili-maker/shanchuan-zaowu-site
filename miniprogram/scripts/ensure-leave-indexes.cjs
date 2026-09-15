#!/usr/bin/env node
/**
 * 请假考勤集合索引建议（只打印，不自动创建）
 *
 * 集合：staff_leave_requests
 * 用法：node scripts/ensure-leave-indexes.cjs
 */

const LEAVE_INDEXES = [
  {
    name: 'leave_mine_time',
    keys: [
      { field: 'staffOpenid', direction: 1 },
      { field: 'createTime', direction: -1 }
    ],
    why: 'leaveList：本人请假按创建时间倒序'
  },
  {
    name: 'leave_pending_queue',
    keys: [
      { field: 'status', direction: 1 },
      { field: 'approverRoleRequired', direction: 1 },
      { field: 'createTime', direction: -1 }
    ],
    why: 'leavePendingList：待审队列（店长 / 超管分流）'
  },
  {
    name: 'leave_approved_cover',
    keys: [
      { field: 'staffOpenid', direction: 1 },
      { field: 'status', direction: 1 },
      { field: 'startKey', direction: 1 },
      { field: 'endKey', direction: 1 }
    ],
    why: 'attendanceToday：已通过请假覆盖某日（absenceExempt）'
  }
]

function main() {
  console.log('集合: staff_leave_requests\n')
  LEAVE_INDEXES.forEach((idx, i) => {
    console.log(`${i + 1}. ${idx.name}`)
    console.log(`   用途: ${idx.why}`)
    console.log(
      `   字段: ${idx.keys.map((k) => `${k.field} ${k.direction === 1 ? '升序' : '降序'}`).join(' + ')}`
    )
    console.log('')
  })
  console.log('请在云开发控制台 → 数据库 → staff_leave_requests → 索引 手动创建。')
}

main()
