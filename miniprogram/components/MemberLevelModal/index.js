function resolveToneClass(level) {
  const n = Number(level);
  if (n === 3 || n === 4 || n === 99) return 'skin-tone-dark';
  return 'skin-tone-light';
}

function resolveSkinClass(level) {
  const n = Number(level);
  if (n === 99) return 'level-skin-99';
  if (n >= 1 && n <= 6) return `level-skin-${n}`;
  return 'level-skin-1';
}

function resolveStatus(userLevel, plateLevel) {
  const u = Number(userLevel);
  const p = Number(plateLevel);
  if (u === 99 || u > p) return 'unlocked';
  if (u === p) return 'current';
  return 'locked';
}

function resolveStatusLabel(status) {
  if (status === 'unlocked') return '已达成';
  if (status === 'current') return '当前';
  return '未达成';
}

/** iPhone：scroll-view 需明确 px 高度，避免 flex:1+height:0 塌成空白 */
function getWindowMetrics() {
  try {
    if (typeof wx.getWindowInfo === 'function') {
      const info = wx.getWindowInfo();
      if (info && info.windowHeight) {
        const safeBottom = info.safeArea
          ? Math.max(0, info.windowHeight - info.safeArea.bottom)
          : (info.safeAreaInsets && info.safeAreaInsets.bottom) || 0;
        return { windowHeight: info.windowHeight, safeBottom };
      }
    }
  } catch (e) {
    /* 旧基础库 */
  }
  try {
    const info = wx.getSystemInfoSync();
    const windowHeight = (info && info.windowHeight) || 0;
    let safeBottom = 0;
    if (info.safeArea && windowHeight) {
      safeBottom = Math.max(0, windowHeight - info.safeArea.bottom);
    } else if (info.safeAreaInsets) {
      safeBottom = info.safeAreaInsets.bottom || 0;
    }
    return { windowHeight, safeBottom };
  } catch (e) {
    return { windowHeight: 0, safeBottom: 0 };
  }
}

const SHEET_RATIO = 0.88;
const HEADER_FALLBACK_PX = 76;
const BODY_MIN_PX = 220;
/** 安卓手势条常无 safe-area；脚注至少再留 24px */
const SAFE_PAD_PX = 24;

Component({
  options: {
    addGlobalClass: true,
    styleIsolation: 'apply-shared'
  },
  properties: {
    visible: { type: Boolean, value: false },
    level: { type: Number, value: 1 },
    cardSkinClass: { type: String, value: 'level-skin-1' },
    specimenEmoji: { type: String, value: '' },
    levelName: { type: String, value: '' },
    nextThreshold: { type: Number, value: 0 },
    progressPercent: { type: Number, value: 0 },
    progressWidth: { type: String, value: '0%' },
    growthValue: { type: Number, value: 0 },
    nextLevelPreview: { type: Object, value: null },
    levelBenefits: { type: Array, value: [] }
  },
  data: {
    cardToneClass: 'skin-tone-light',
    selectedLevel: 1,
    selectedPlate: null,
    selectedSkinClass: 'level-skin-1',
    selectedToneClass: 'skin-tone-light',
    selectedStatus: 'current',
    selectedStatusLabel: '当前',
    plateScrollInto: '',
    sheetStyle: '',
    bodyStyle: '',
    safeStyle: ''
  },
  observers: {
    visible(visible) {
      if (!visible) {
        this._layoutToken = (this._layoutToken || 0) + 1;
        return;
      }
      const userLevel = Number(this.properties.level) || 1;
      const list = this.properties.levelBenefits || [];
      const initial =
        userLevel === 99 && list.length
          ? Number(list[list.length - 1].level)
          : userLevel;
      this.applySelection(initial, list);
      this.layoutSheet();
    },
    level(level) {
      if (!this.properties.visible) return;
      this.setData({ cardToneClass: resolveToneClass(level) });
    },
    levelBenefits(benefits) {
      if (!this.properties.visible) return;
      const keep = this.data.selectedLevel || this.properties.level;
      this.applySelection(keep, benefits || []);
    }
  },
  lifetimes: {
    detached() {
      this._layoutToken = (this._layoutToken || 0) + 1;
    }
  },
  pageLifetimes: {
    resize() {
      if (this.properties.visible) this.layoutSheet();
    }
  },
  methods: {
    layoutSheet() {
      const token = (this._layoutToken || 0) + 1;
      this._layoutToken = token;

      const { windowHeight, safeBottom } = getWindowMetrics();
      const winH = windowHeight || 667;
      const sheetH = Math.max(420, Math.floor(winH * SHEET_RATIO));
      const bodyGuess = Math.max(BODY_MIN_PX, sheetH - HEADER_FALLBACK_PX);
      const safeH = Math.max(safeBottom, 0) + SAFE_PAD_PX;

      this.setData({
        sheetStyle: `height:${sheetH}px;max-height:${sheetH}px;`,
        bodyStyle: `height:${bodyGuess}px;`,
        safeStyle: `height:${safeH}px;`
      });

      const refine = () => {
        if (this._layoutToken !== token || !this.properties.visible) return;
        this.createSelectorQuery()
          .in(this)
          .select('.level-header')
          .boundingClientRect()
          .exec((res) => {
            if (this._layoutToken !== token || !this.properties.visible) return;
            const headerH =
              (res && res[0] && res[0].height) || HEADER_FALLBACK_PX;
            const bodyH = Math.max(BODY_MIN_PX, Math.floor(sheetH - headerH));
            const nextBody = `height:${bodyH}px;`;
            if (nextBody === this.data.bodyStyle) return;
            this.setData({ bodyStyle: nextBody });
          });
      };

      if (typeof wx.nextTick === 'function') {
        wx.nextTick(refine);
      } else {
        setTimeout(refine, 16);
      }
      // 字体/动画落稳后再量一次，避免 header 高度抖动
      setTimeout(refine, 120);
    },
    applySelection(selectedLevel, benefits) {
      const userLevel = Number(this.properties.level) || 1;
      const list = benefits || [];
      let target = Number(selectedLevel) || 1;
      let plate = list.find((b) => Number(b.level) === target) || null;

      if (!plate && list.length) {
        plate =
          list.find((b) => Number(b.level) === userLevel) ||
          list[list.length - 1] ||
          list[0];
        target = Number(plate.level);
      }

      if (!plate) {
        this.setData({
          cardToneClass: resolveToneClass(userLevel),
          selectedLevel: target,
          selectedPlate: null,
          selectedSkinClass: resolveSkinClass(target),
          selectedToneClass: resolveToneClass(target),
          selectedStatus: resolveStatus(userLevel, target),
          selectedStatusLabel: resolveStatusLabel(resolveStatus(userLevel, target)),
          plateScrollInto: ''
        });
        return;
      }

      const status = resolveStatus(userLevel, target);
      this.setData({
        cardToneClass: resolveToneClass(userLevel),
        selectedLevel: target,
        selectedPlate: plate,
        selectedSkinClass: plate.skinClass || resolveSkinClass(target),
        selectedToneClass: plate.toneClass || resolveToneClass(target),
        selectedStatus: status,
        selectedStatusLabel: resolveStatusLabel(status),
        plateScrollInto: `plate-${target}`
      });
    },
    onSelectPlate(e) {
      const lv = Number(e.currentTarget.dataset.level);
      if (!lv || lv === this.data.selectedLevel) return;
      this.applySelection(lv, this.properties.levelBenefits || []);
    },
    onClose() {
      this.triggerEvent('close');
    },
    noop() {}
  }
});
