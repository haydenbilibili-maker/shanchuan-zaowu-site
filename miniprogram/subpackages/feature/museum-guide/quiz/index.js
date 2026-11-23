/**
 * 博物君 · 博物小测（2026-11-23）：每天 5 题，全部由山海图鉴的馆藏事实生成，同一天人人同一组。
 * 答一题当场揭晓 + 解释；答完记分、最好成绩、连续天数（存本机）。不调云函数。
 */
const N = require('../naturalist')
const { ATLAS_SPECIES, ATLAS_SERIES } = require('../../config/atlasCatalog')

const app = getApp()
const GUIDE = '/subpackages/feature/museum-guide/index'

function storeKey() {
  const openid = (app && app.globalData && app.globalData.openid) || ''
  return openid ? `museum_guide_quiz_v1_${openid}` : 'museum_guide_quiz_v1'
}

function readState() {
  try { return wx.getStorageSync(storeKey()) || null } catch (e) { return null }
}

Page({
  data: {
    quiz: [],
    total: 0,
    idx: 0,
    picked: -1,
    answers: [],
    done: false,
    result: null,
    review: []
  },

  onLoad() {
    const now = Date.now()
    this._day = N.dayIndex(now)
    const quiz = N.buildQuiz(ATLAS_SPECIES, ATLAS_SERIES, now)
    const state = readState()
    const today = state && state.results && state.results[this._day]
    this.setData({ quiz, total: quiz.length })
    // 今天已经答过：直接看结果（同一组题，不能刷分）
    if (today) this.showResult(today.answers, state, false)
  },

  onShareAppMessage() {
    const r = this.data.result
    return { title: r ? `今天的博物小测我答对了 ${r.score}/${r.total}` : '博物君 · 每天 5 道博物小测', path: '/subpackages/feature/museum-guide/quiz/index' }
  },

  /** 选一个选项：当场揭晓（只能选一次） */
  onPick(e) {
    if (this.data.picked >= 0 || this.data.done) return
    const i = Number(e.currentTarget.dataset.i)
    const answers = this.data.answers.concat(i)
    this.setData({ picked: i, answers })
  },

  onNext() {
    if (this.data.picked < 0) return
    if (this.data.idx + 1 < this.data.quiz.length) {
      this.setData({ idx: this.data.idx + 1, picked: -1 })
      return
    }
    const state = N.recordQuiz(readState(), this._day, this.data.answers, this.data.quiz)
    try { wx.setStorageSync(storeKey(), state) } catch (err) { /* 存不下只影响连续天数 */ }
    this.showResult(this.data.answers, state, true)
  },

  showResult(answers, state, fresh) {
    const quiz = this.data.quiz
    const score = quiz.reduce((n, q, i) => n + (answers[i] === q.answer ? 1 : 0), 0)
    const review = quiz.map((q, i) => ({
      prompt: q.prompt,
      mine: q.options[answers[i]] || '未作答',
      right: q.options[q.answer],
      ok: answers[i] === q.answer,
      explain: q.explain,
      askQ: q.askQ,
      no: q.no
    }))
    this.setData({
      done: true,
      review,
      result: {
        score,
        total: quiz.length,
        line: N.scoreLine(score, quiz.length),
        streak: N.liveStreak(state, Date.now()),
        best: (state && state.best) || score,
        fresh: !!fresh
      }
    })
  },

  onAsk(e) {
    const q = e.currentTarget.dataset.q
    if (!q) return
    wx.navigateTo({ url: `${GUIDE}?from=quiz&auto=1&q=${encodeURIComponent(q)}` })
  },

  onDaily() {
    wx.redirectTo({ url: '/subpackages/feature/museum-guide/daily/index' })
  }
})
