/** 统一 UI 图标路径 — 避免引用不存在的 PNG */
module.exports = {
  view: '/assets/icons/eye.png',
  like: '/assets/icons/heart.png',
  likeActive: '/assets/icons/star-active.png',
  collect: '/assets/icons/star.png',
  collectActive: '/assets/icons/star-active.png',
  comment: '/assets/icons/message.png',
  categoryIcon(category) {
    const map = {
      knowledge: '/assets/icons/knowledge.png',
      art: '/assets/icons/exhibition-tab-active.png',
      craft: '/assets/icons/edit.png',
      story: '/assets/icons/article-tab.png'
    };
    return map[category] || map.knowledge;
  }
};
