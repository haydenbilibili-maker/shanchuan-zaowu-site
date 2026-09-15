Page({
  onLoad(options) {
    const qs = Object.keys(options || {})
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(options[k])}`)
      .join('&')
    const tail = qs ? `&${qs}` : ''
    wx.redirectTo({
      url: `/subpackages/manager/payslip/index?workspace=staff${tail}`,
      fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' })
    })
  }
})
