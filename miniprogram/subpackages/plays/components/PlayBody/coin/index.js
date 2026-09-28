const { createRitualPlayBody } = require('../../../utils/ritualPlayPage')

// 祈福墙弹层里的「coin」本体：行为 = 独立页同一个工厂；皮 = 独立页同一份 WXML/WXSS（include / @import）
Component(createRitualPlayBody('coin'))
