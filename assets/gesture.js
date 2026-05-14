/**
 * 天意阅读器 · 手势与翻页模块
 *
 * 功能：
 * 1. 左滑返回（detail-view 内任意位置左滑 ≥60px）
 * 2. 边缘右滑返回（全局，左边缘 40px 内右滑）
 * 3. 阅读页区域翻页：点击上30%→上一章，下30%→下一章，中间40%不响应
 * 4. 翻页指示器：半透明提示条，500ms 后自动消失
 */
(() => {
  'use strict';

  // ===== 内部状态 =====
  let touchStartX = 0, touchStartY = 0;
  let touchStartTime = 0;
  let isSwiping = false;
  let swipeEdge = false;       // 是否从左边缘起始

  // 翻页指示器 DOM（懒创建）
  let _indicator = null;

  function getIndicator() {
    if (_indicator) return _indicator;
    _indicator = document.createElement('div');
    _indicator.id = 'page-indicator';
    _indicator.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'pointer-events:none',
      'display:flex', 'align-items:center', 'justify-content:center',
      'font-size:14px', 'color:#fff', 'font-weight:600',
      'letter-spacing:.05em', 'z-index:200',
      'opacity:0', 'transition:opacity .2s',
      'height:44px',
    ].join(';');
    document.body.appendChild(_indicator);
    return _indicator;
  }

  function showIndicator(text, position /* 'top'|'bottom' */) {
    const el = getIndicator();
    el.textContent = text;
    if (position === 'top') {
      el.style.top    = '56px';   // 顶部栏下方
      el.style.bottom = '';
      el.style.background = 'linear-gradient(180deg,rgba(124,92,252,.55) 0%,transparent 100%)';
    } else {
      el.style.bottom = '60px';   // 底部导航上方
      el.style.top    = '';
      el.style.background = 'linear-gradient(0deg,rgba(124,92,252,.55) 0%,transparent 100%)';
    }
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 600);
  }

  // ===== 判断当前视图 =====
  function isDetailActive() {
    const dv = document.getElementById('detail-view');
    return dv && dv.classList.contains('active');
  }

  // ===== 滑动返回边缘指示线 =====
  let _edgeLine = null;
  function getEdgeLine() {
    if (_edgeLine) return _edgeLine;
    _edgeLine = document.createElement('div');
    _edgeLine.style.cssText = [
      'position:fixed', 'left:0', 'top:0', 'bottom:0', 'width:3px',
      'background:var(--accent)', 'opacity:0',
      'transition:opacity .15s', 'z-index:300', 'pointer-events:none',
      'border-radius:0 3px 3px 0',
    ].join(';');
    document.body.appendChild(_edgeLine);
    return _edgeLine;
  }

  // ===== Touch 事件 =====
  document.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    touchStartX    = t.clientX;
    touchStartY    = t.clientY;
    touchStartTime = Date.now();
    isSwiping      = false;
    swipeEdge      = touchStartX < 40;
    if (swipeEdge) getEdgeLine().style.opacity = '0.6';
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!swipeEdge) return;
    const dx = e.touches[0].clientX - touchStartX;
    if (dx > 0) {
      const progress = Math.min(dx / 120, 1);
      getEdgeLine().style.opacity = String(0.3 + progress * 0.5);
      getEdgeLine().style.width   = Math.max(3, progress * 6) + 'px';
    }
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    getEdgeLine().style.opacity = '0';
    getEdgeLine().style.width   = '3px';

    const t   = e.changedTouches[0];
    const dx  = t.clientX - touchStartX;
    const dy  = t.clientY - touchStartY;
    const dt  = Date.now() - touchStartTime;
    const absDx = Math.abs(dx), absDy = Math.abs(dy);

    // 必须横向为主，且有最小速度
    if (absDx < absDy * 1.2) return;
    if (dt > 500) return;

    // 左滑返回（仅 detail-view 内，距离 ≥60px）
    if (dx < -60 && isDetailActive()) {
      triggerBack();
      return;
    }

    // 右滑返回（左边缘起始 ≥50px，或 detail-view 内 ≥80px）
    if (dx > 0) {
      if (swipeEdge && dx > 50) { triggerBack(); return; }
      if (!swipeEdge && dx > 80 && isDetailActive()) { triggerBack(); return; }
    }
  }, { passive: true });

  function triggerBack() {
    if (typeof window.handleBack === 'function') {
      // 轻微震动反馈（若支持）
      if (navigator.vibrate) navigator.vibrate(30);
      window.handleBack();
    }
  }

  // ===== 阅读页区域点击翻页 =====
  // detail-view 上的透明点击层（不遮挡文字选中，只响应快速 tap）
  document.addEventListener('DOMContentLoaded', () => {
    const contentArea = document.getElementById('content-area');
    if (!contentArea) return;

    let tapStartY = 0, tapStartX = 0, tapStartTime = 0;

    contentArea.addEventListener('touchstart', (e) => {
      tapStartY    = e.touches[0].clientY;
      tapStartX    = e.touches[0].clientX;
      tapStartTime = Date.now();
    }, { passive: true });

    contentArea.addEventListener('touchend', (e) => {
      if (!isDetailActive()) return;

      const t    = e.changedTouches[0];
      const dy   = Math.abs(t.clientY - tapStartY);
      const dx   = Math.abs(t.clientX - tapStartX);
      const dt   = Date.now() - tapStartTime;

      // 只处理快速 tap（移动 < 12px，时间 < 300ms）
      if (dy > 12 || dx > 12 || dt > 300) return;

      const rect = contentArea.getBoundingClientRect();
      const relY = (t.clientY - rect.top) / rect.height;

      if (relY < 0.30) {
        // 上 30%：上一章
        handlePageTurn('prev');
      } else if (relY > 0.70) {
        // 下 30%：下一章
        handlePageTurn('next');
      }
      // 中间 40%：不处理，让正常文字选中生效
    }, { passive: true });
  });

  function handlePageTurn(dir) {
    const book = window._currentBook || (window.currentBook);
    // 通过全局 getter 获取当前章节索引
    const idx = window._getCurrentChapterIndex ? window._getCurrentChapterIndex() : -1;
    if (idx < 0) return;

    const chapters = book?.chapters || [];
    if (dir === 'prev') {
      if (idx <= 0) {
        showIndicator('已是第一章', 'top');
        if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
        return;
      }
      showIndicator(`↑ ${chapters[idx-1].title || `第${idx}章`}`, 'top');
      if (navigator.vibrate) navigator.vibrate(20);
      window._showChapterByIndex(idx - 1);
    } else {
      if (idx >= chapters.length - 1) {
        showIndicator('已是最新章', 'bottom');
        if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
        return;
      }
      showIndicator(`↓ ${chapters[idx+1].title || `第${idx+2}章`}`, 'bottom');
      if (navigator.vibrate) navigator.vibrate(20);
      window._showChapterByIndex(idx + 1);
    }
  }

})();
