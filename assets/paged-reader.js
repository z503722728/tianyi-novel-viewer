/**
 * 天意阅读器 · 翻页阅读模块 v2
 *
 * 修复：
 * 1. 分页高度双重扣除问题 → 用 CSS column 原生分页，彻底告别手动测量误差
 * 2. 末页点击下一章 / 首页点击上一章 → 触发 window._showChapterByIndex
 *
 * 原理（CSS Columns 分页）：
 *   把整章内容渲染到 column-width=100vw、column-gap=0 的多列容器
 *   用 scrollLeft 步进 viewport 宽度实现翻页
 *   CSS 负责文字分页，不需要手动测量，精确无裂缝
 */

window.PagedReader = (() => {
  'use strict';

  const ANIM_MS  = 260;

  // ===== 状态 =====
  let totalPages  = 1;
  let curPage     = 0;
  let isAnimating = false;
  let chapterTitle = '';

  // ===== DOM =====
  let _overlay   = null;
  let _strip     = null;   // 横向滚动条（columns 容器）
  let _counter   = null;
  let _titleEl   = null;

  // ===== 手势 =====
  let _txStart = 0, _tyStart = 0, _txTime = 0, _dragging = false;

  // ===========================
  // 构建 DOM（懒，只建一次）
  // ===========================
  function buildDOM() {
    if (_overlay) return;

    _overlay = document.createElement('div');
    _overlay.id = 'paged-reader';
    Object.assign(_overlay.style, {
      position: 'fixed', inset: '0', zIndex: '500',
      background: 'var(--bg,#0f0f1a)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    });

    // ── 顶部栏 ──
    const bar = document.createElement('div');
    Object.assign(bar.style, {
      display: 'flex', alignItems: 'center',
      padding: '0 16px', height: '48px', flexShrink: '0',
      borderBottom: '1px solid rgba(255,255,255,.07)',
    });

    _titleEl = document.createElement('div');
    Object.assign(_titleEl.style, {
      flex: '1', fontSize: '14px', color: 'rgba(255,255,255,.5)',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    });

    _counter = document.createElement('div');
    Object.assign(_counter.style, {
      fontSize: '12px', color: 'rgba(255,255,255,.3)',
      marginLeft: '12px', flexShrink: '0',
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    Object.assign(closeBtn.style, {
      background: 'none', border: 'none', color: 'rgba(255,255,255,.4)',
      fontSize: '18px', cursor: 'pointer', padding: '8px 0 8px 16px',
      lineHeight: '1', flexShrink: '0',
    });
    closeBtn.onclick = close;

    bar.appendChild(_titleEl);
    bar.appendChild(_counter);
    bar.appendChild(closeBtn);

    // ── 进度条 ──
    const progWrap = document.createElement('div');
    Object.assign(progWrap.style, {
      height: '2px', background: 'rgba(124,92,252,.2)', flexShrink: '0',
    });
    const progFill = document.createElement('div');
    progFill.id = 'pr-fill';
    Object.assign(progFill.style, {
      height: '100%', background: 'var(--accent,#7c5cfc)',
      width: '0%', transition: 'width .3s',
    });
    progWrap.appendChild(progFill);

    // ── 翻页 viewport（overflow hidden，内部用 strip 滑动）──
    const viewport = document.createElement('div');
    Object.assign(viewport.style, {
      flex: '1', position: 'relative', overflow: 'hidden',
    });

    // strip：CSS multi-column 容器，宽度 = 页数 × 100%
    _strip = document.createElement('div');
    _strip.id = 'pr-strip';
    Object.assign(_strip.style, {
      position: 'absolute', top: '0', left: '0', bottom: '0',
      // 宽度和 column-width 在 open() 时设置
      columnGap: '0px',
      padding: '16px 20px 36px',
      fontSize: '17px',
      lineHeight: '1.9',
      color: 'rgba(255,255,255,.88)',
      wordBreak: 'break-all',
      boxSizing: 'border-box',
      willChange: 'transform',
      transition: `transform ${ANIM_MS}ms cubic-bezier(.4,0,.2,1)`,
    });

    viewport.appendChild(_strip);

    // 左右点击区（透明，不遮文字选中，只响应 tap）
    const tapLeft  = makeTapZone('left',  '35%');
    const tapRight = makeTapZone('right', '35%');
    tapLeft.onclick  = () => prevPage();
    tapRight.onclick = () => nextPage();
    viewport.appendChild(tapLeft);
    viewport.appendChild(tapRight);

    _overlay.appendChild(bar);
    _overlay.appendChild(progWrap);
    _overlay.appendChild(viewport);
    document.body.appendChild(_overlay);

    // 手势
    bindGestures(viewport);
    document.addEventListener('keydown', onKey);
  }

  function makeTapZone(side, width) {
    const z = document.createElement('div');
    Object.assign(z.style, {
      position: 'absolute', top: '0', bottom: '0',
      [side]: '0', width,
      zIndex: '10', cursor: 'pointer',
    });
    return z;
  }

  // ===========================
  // 分页：用 CSS columns 原生分页
  // ===========================
  function calcPages(html) {
    const vw = window.innerWidth;
    const vh = window.innerHeight - 48 - 2; // 减去顶栏和进度条

    // 设置 strip 的 column 属性
    _strip.style.width          = vw + 'px';       // 先设为单列宽，让浏览器计算自然高度
    _strip.style.columnWidth    = vw + 'px';
    _strip.style.columnCount    = 'auto';
    _strip.innerHTML            = html;
    _overlay.style.display      = 'flex';           // 必须可见才能测量
    _strip.style.height         = vh + 'px';

    // 强制回流，获取实际列数
    const scrollW = _strip.scrollWidth;
    const pages   = Math.max(1, Math.round(scrollW / vw));

    // 设置真实宽度（总列数 × vw）
    _strip.style.width = (pages * vw) + 'px';

    return pages;
  }

  // ===========================
  // 渲染 / 翻页
  // ===========================
  function goTo(idx, animate) {
    if (isAnimating && animate) return;
    idx = Math.max(0, Math.min(idx, totalPages - 1));

    if (animate && idx !== curPage) {
      isAnimating = true;
      _strip.style.transition = `transform ${ANIM_MS}ms cubic-bezier(.4,0,.2,1)`;
      _strip.style.transform  = `translateX(${-idx * window.innerWidth}px)`;
      setTimeout(() => { isAnimating = false; }, ANIM_MS);
    } else {
      _strip.style.transition = 'none';
      _strip.style.transform  = `translateX(${-idx * window.innerWidth}px)`;
    }

    curPage = idx;
    updateUI();
  }

  function updateUI() {
    if (_counter) _counter.textContent = `${curPage + 1} / ${totalPages}`;
    const fill = document.getElementById('pr-fill');
    if (fill) fill.style.width = ((curPage + 1) / totalPages * 100) + '%';
  }

  // ── 翻页（返回 true=翻成功，false=已到边界触发章节跳转）──
  function nextPage() {
    if (curPage < totalPages - 1) {
      goTo(curPage + 1, true);
      return;
    }
    // 末页 → 下一章
    const idx = window._getCurrentChapterIndex ? window._getCurrentChapterIndex() : -1;
    const chaps = window._currentBook?.chapters || [];
    if (idx >= 0 && idx < chaps.length - 1) {
      flashEdge('right', '下一章');
      setTimeout(() => {
        if (window._showChapterByIndex) window._showChapterByIndex(idx + 1);
      }, 180);
    } else {
      flashEdge('right', '已是最新章');
    }
  }

  function prevPage() {
    if (curPage > 0) {
      goTo(curPage - 1, true);
      return;
    }
    // 首页 → 上一章
    const idx = window._getCurrentChapterIndex ? window._getCurrentChapterIndex() : -1;
    const chaps = window._currentBook?.chapters || [];
    if (idx > 0) {
      flashEdge('left', '上一章');
      setTimeout(() => {
        if (window._showChapterByIndex) window._showChapterByIndex(idx - 1);
      }, 180);
    } else {
      flashEdge('left', '已是第一章');
    }
  }

  // 边缘提示闪烁
  function flashEdge(side, text) {
    let el = document.getElementById('pr-edge-hint');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pr-edge-hint';
      Object.assign(el.style, {
        position: 'fixed', top: '50%', transform: 'translateY(-50%)',
        background: 'rgba(124,92,252,.75)', color: '#fff',
        fontSize: '13px', padding: '8px 14px', borderRadius: '8px',
        zIndex: '600', pointerEvents: 'none', opacity: '0',
        transition: 'opacity .2s',
      });
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style[side === 'right' ? 'right' : 'left'] = '16px';
    el.style[side === 'right' ? 'left' : 'right'] = '';
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 800);
    if (navigator.vibrate) navigator.vibrate(side === 'right' && text !== '已是最新章' ? 20 : [10, 30, 10]);
  }

  // ===========================
  // 手势
  // ===========================
  function bindGestures(el) {
    el.addEventListener('touchstart', e => {
      _txStart = e.touches[0].clientX;
      _tyStart = e.touches[0].clientY;
      _txTime  = Date.now();
      _dragging = false;
    }, { passive: true });

    el.addEventListener('touchmove', e => {
      const dx = Math.abs(e.touches[0].clientX - _txStart);
      const dy = Math.abs(e.touches[0].clientY - _tyStart);
      if (dx > dy * 1.2 && dx > 8) _dragging = true;
    }, { passive: true });

    el.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - _txStart;
      const dy = e.changedTouches[0].clientY - _tyStart;
      const dt = Date.now() - _txTime;

      if (!_dragging && Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 300) {
        // tap：左 35% 上翻，右 35% 下翻，中间 30% 不响应
        const rx = e.changedTouches[0].clientX / window.innerWidth;
        if (rx < 0.35) prevPage();
        else if (rx > 0.65) nextPage();
        return;
      }

      if (_dragging && Math.abs(dx) > Math.abs(dy) * 1.2 && dt < 500) {
        if (dx < -50) nextPage();
        else if (dx > 50) prevPage();
      }
    }, { passive: true });
  }

  function onKey(e) {
    if (!_overlay || _overlay.style.display === 'none') return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextPage();
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')  prevPage();
    if (e.key === 'Escape') close();
  }

  // ===========================
  // 公开 API
  // ===========================
  function open(html, title) {
    buildDOM();
    _titleEl.textContent = title || '';
    _strip.innerHTML = '<div style="padding:40px 0;text-align:center;color:rgba(255,255,255,.3)">排版中…</div>';
    _overlay.style.display = 'flex';

    // 用两帧确保 overlay 已完成布局再测量
    requestAnimationFrame(() => requestAnimationFrame(() => {
      totalPages = calcPages(html);
      curPage    = 0;
      goTo(0, false);
    }));
  }

  function close() {
    if (_overlay) _overlay.style.display = 'none';
    pages = []; curPage = 0;
  }

  return {
    open, close,
    nextPage, prevPage,
    get isOpen() { return !!(_overlay && _overlay.style.display !== 'none'); },
  };
})();
