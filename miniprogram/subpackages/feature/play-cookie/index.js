const { createRitualPlayPage } = require('../../../utils/ritualPlayPage')

// 玩法页 = 注册表里那一条事实（`cookie`）+ 本页自己的 WXML/WXSS（入口形态 / 进行态动画 / 结果纸面）。
Page(createRitualPlayPage('cookie'))
