// components/Calendar/index.js
Component({
  properties: {
    // 当前选中的日期
    selectedDate: {
      type: String,
      value: ''
    },
    // 不可预约的日期列表
    unavailableDates: {
      type: Array,
      value: []
    },
    // 已满的日期列表
    fullDates: {
      type: Array,
      value: []
    }
  },

  data: {
    currentYear: 2025,
    currentMonth: 1,
    calendarDays: [],
    weekDays: ['日', '一', '二', '三', '四', '五', '六']
  },

  lifetimes: {
    attached() {
      const now = new Date();
      this.setData({
        currentYear: now.getFullYear(),
        currentMonth: now.getMonth() + 1
      });
      this.generateCalendar();
    }
  },

  methods: {
    // 生成日历数据
    generateCalendar() {
      const { currentYear, currentMonth } = this.data;
      const firstDay = new Date(currentYear, currentMonth - 1, 1);
      const lastDay = new Date(currentYear, currentMonth, 0);
      const daysInMonth = lastDay.getDate();
      const startDayOfWeek = firstDay.getDay();

      const days = [];
      
      // 填充上个月的日期（灰色显示）
      const prevMonthLastDay = new Date(currentYear, currentMonth - 1, 0).getDate();
      for (let i = startDayOfWeek - 1; i >= 0; i--) {
        days.push({
          date: prevMonthLastDay - i,
          month: 'prev',
          fullDate: this.formatDate(currentYear, currentMonth - 1, prevMonthLastDay - i),
          disabled: true
        });
      }

      // 当前月的日期
      const today = new Date();
      const todayStr = this.formatDate(today.getFullYear(), today.getMonth() + 1, today.getDate());
      
      for (let i = 1; i <= daysInMonth; i++) {
        const fullDate = this.formatDate(currentYear, currentMonth, i);
        const dateObj = new Date(currentYear, currentMonth - 1, i);
        const isPast = dateObj < today && fullDate !== todayStr;
        const isUnavailable = this.data.unavailableDates.includes(fullDate);
        const isFull = this.data.fullDates.includes(fullDate);
        const isSelected = fullDate === this.data.selectedDate;

        days.push({
          date: i,
          month: 'current',
          fullDate: fullDate,
          disabled: isPast || isUnavailable,
          isPast: isPast,
          isFull: isFull,
          isSelected: isSelected,
          isToday: fullDate === todayStr
        });
      }

      // 填充下个月的日期（灰色显示）
      const remainingCells = 42 - days.length; // 6行 x 7列 = 42
      for (let i = 1; i <= remainingCells; i++) {
        days.push({
          date: i,
          month: 'next',
          fullDate: this.formatDate(currentYear, currentMonth + 1, i),
          disabled: true
        });
      }

      this.setData({ calendarDays: days });
    },

    // 格式化日期
    formatDate(year, month, day) {
      const m = month.toString().padStart(2, '0');
      const d = day.toString().padStart(2, '0');
      return `${year}-${m}-${d}`;
    },

    // 选择日期
    selectDate(e) {
      const { fullDate, disabled } = e.currentTarget.dataset;
      if (disabled) return;

      wx.vibrateShort({ type: 'light' });
      this.triggerEvent('select', { date: fullDate });
      
      // 更新选中状态
      const days = this.data.calendarDays.map(day => ({
        ...day,
        isSelected: day.fullDate === fullDate
      }));
      this.setData({ calendarDays: days, selectedDate: fullDate });
    },

    // 切换月份
    changeMonth(e) {
      const { direction } = e.currentTarget.dataset;
      let { currentYear, currentMonth } = this.data;

      if (direction === 'prev') {
        if (currentMonth === 1) {
          currentMonth = 12;
          currentYear--;
        } else {
          currentMonth--;
        }
      } else {
        if (currentMonth === 12) {
          currentMonth = 1;
          currentYear++;
        } else {
          currentMonth++;
        }
      }

      this.setData({ currentYear, currentMonth });
      this.generateCalendar();
    }
  },

  observers: {
    'selectedDate, unavailableDates, fullDates': function() {
      this.generateCalendar();
    }
  }
});








