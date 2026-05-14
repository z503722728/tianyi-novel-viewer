/**
 * 天意阅读器 · 翻页阅读模块 v1
 *
 * 工作原理：
 * 1. 把章节 HTML 渲染到隐藏的等高测量容器里
 * 2. 按屏幕可用高度自动切页（二分查找最大安全高度）
 * 3. 切换页用 CSS transform 滑动动画
 * 4. 支持：左右滑动手势 / 点击左右半屏 / 键盘方向键
 * 5. 顶部细进度条 + 页码提示
 */

window.PagedReader = (() => {
  'use strict';

  // ===== 常量 =====
  const PADDING_H   = 20;   // 左右内边距 px
  const PADDING_TOP = 12;   // 顶部内边距 px
  const PADDING_BOT = 56;   // 底部内边距 px（留给页码）
  const ANIM_MS     = 280;  // 翻页动画时长
  const FONT_SIZE   = 17;   // 正文字号 px
  const LINE_HEIGHT = 1.85; // 行高

  // ===== 状态 =====
  let pages       = [];   // 每页 HTML 字符串
  let curPage     = 0;
  let isAnimating = false;
  let chapterInfo = null; // { title, meta }

  // ===== DOM 引用（懒创建）=====
  let _overlay  = null;   // 全屏阅读层
  let _pageEl   = null;   // 当前页 div
  let _nextEl   = null;   // 备用页 div（动画用）
  let _progress = null;   // 顶部进度条
  let _counter  = null;   // 页码

  // ===== 手势状态 =====
  let _txStart = 0, _tyStart = 0, _txTime = 0;
  let _dragging = false;

  // ===========================
  // 1. 构建全屏 DOM
  // ===========================
  function buildDOM() {
    if (_overlay) return;

    _overlay = document.createElement('div');
    _overlay.id = 'paged-reader';
    _overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:500',
      'background:var(--bg,#0f0f1a)',
      'display:flex', 'flex-direction:column',
      'overflow:hidden',
      'touch-action:none',
    ].join(';');

    // 顶部栏
    const bar = document.createElement('div');
    bar.style.cssText = [
      'display:flex', 'align-items:center', 'justify-content:space-between',
      'padding:0 16px', 'height:48px', 'flex-shrink:0',
      'border-bottom:1px solid rgba(255,255,255,.06)',
    ].join(';');

    const titleEl = document.createElement('div');
    titleEl.id = 'pr-title';
    titleEl.style.cssText = 'font-size:14px;color:rgba(255,255,255,.55);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = [
      'background:none', 'border:none', 'color:rgba(255,255,255,.5)',
      'font-size:18px', 'cursor:pointer', 'padding:8px',
      'line-height:1', 'flex-shrink:0',
    ].join(';');
    closeBtn.onclick = close;

    bar.appendChild(titleEl);
    bar.appendChild(closeBtn);

    // 进度条
    _progress = document.createElement('div');
    _progress.style.cssText = [
      'height:2px', 'background:rgba(124,92,252,.25)', 'flex-shrink:0',
    ].join(';');
    const _progressFill = document.createElement('div');
    _progressFill.id = 'pr-prog-fill';
    _progressFill.style.cssText = [
      'height:100%', 'background:var(--accent,#7c5cfc)',
      'transition:width .3s', 'width:0%',
    ].join(';');
    _progress.appendChild(_progressFill);

    // 翻页区域
    const viewport = document.createElement('div');
    viewport.id = 'pr-viewport';
    viewport.style.cssText = [
      'flex:1', 'position:relative', 'overflow:hidden',
    ].join(';');

    _pageEl = makePageDiv('pr-cur');
    _nextEl = makePageDiv('pr-next');
    _nextEl.style.transform = 'translateX(100%)';

    viewport.appendChild(_pageEl);
    viewport.appendChild(_nextEl);

    // 页码
    _counter = document.createElement('div');
    _counter.id = 'pr-counter';
    _counter.style.cssText = [
      'position:absolute', 'bottom:10px', 'left:0', 'right:0',
      'text-align:center', 'font-size:12px',
      'color:rgba(255,255,255,.25)', 'pointer-events:none',
    ].join(';');
    viewport.appendChild(_counter);

    _overlay.appendChild(bar);
    _overlay.appendChild(_progress);
    _overlay.appendChild(viewport);
    document.body.appendChild(_overlay);

    // 手势
    bindGestures(viewport);
    // 键盘
    document.addEventListener('keydown', onKey);
  }

  function makePageDiv(id) {
    const d = document.createElement('div');
    d.id = id;
    d.style.cssText = [
      'position:absolute', 'inset:0',
      `padding:${PADDING_TOP}px ${PADDING_H}px ${PADDING_BOT}px`,
      'overflow:hidden',
      `font-size:${FONT_SIZE}px`,
      `line-height:${LINE_HEIGHT}`,
      'color:rgba(255,255,255,.88)',
      'transition:transform ' + ANIM_MS + 'ms cubic-bezier(.4,0,.2,1)',
    ].join(';');
    return d;
  }

  // ===========================
  // 2. 分页算法
  // ===========================
  function splitPages(html) {
    // 用隐藏 iframe 测量，避免影响主页面布局
    const measure = document.createElement('div');
    measure.style.cssText = [
      'position:fixed', 'left:-9999px', 'top:0',
      'width:' + (window.innerWidth - PADDING_H * 2) + 'px',
      `font-size:${FONT_SIZE}px`,
      `line-height:${LINE_HEIGHT}`,
      'visibility:hidden', 'overflow:hidden',
      'word-break:break-all',
    ].join(';');
    measure.innerHTML = html;
    document.body.appendChild(measure);

    // 可用高度
    const availH = window.innerHeight - 48 - 2 - PADDING_TOP - PADDING_BOT;

    // 把所有段落/h1/h2/h3/blockquote 节点拿出来逐个装
    const nodes = Array.from(measure.childNodes);
    const result = [];
    let bucket = [];
    let bucketH = 0;

    for (const node of nodes) {
      if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) continue;

      // 测量这个节点高度
      const tmp = document.createElement('div');
      tmp.style.cssText = measure.style.cssText.replace('left:-9999px','left:-99999px');
      tmp.appendChild(node.cloneNode(true));
      document.body.appendChild(tmp);
      const nodeH = tmp.scrollHeight + 8; // +8 margin
      document.body.removeChild(tmp);

      if (bucketH + nodeH > availH && bucket.length > 0) {
        // 当前桶已满，存一页
        result.push(bucket.join(''));
        bucket = [];
        bucketH = 0;
      }

      // 如果单个节点超过一页（超长段落），强制切字
      if (nodeH > availH) {
        const chunks = splitLongNode(node, availH, measure.style.cssText);
        chunks.forEach((chunk, i) => {
          if (i === 0 && bucket.length > 0) {
            bucket.push(chunk);
            result.push(bucket.join(''));
            bucket = []; bucketH = 0;
          } else if (i === chunks.length - 1) {
            bucket.push(chunk);
            bucketH = availH * 0.5; // 估算
          } else {
            result.push(chunk);
          }
        });
      } else {
        bucket.push(node.outerHTML || node.textContent);
        bucketH += nodeH;
      }
    }
    if (bucket.length > 0) result.push(bucket.join(''));

    document.body.removeChild(measure);
    return result.length > 0 ? result : [html];
  }

  function splitLongNode(node, availH, baseStyle) {
    // 对超长 <p> 按字数二分切片
    const text = node.textContent || '';
    const tag  = node.tagName?.toLowerCase() || 'p';
    const chunks = [];
    let start = 0;
    const total = text.length;

    while (start < total) {
      // 二分查找最大安全长度
      let lo = 1, hi = Math.min(total - start, 600), safe = lo;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const tmp = document.createElement('div');
        tmp.style.cssText = baseStyle.replace('left:-9999px','left:-99999px');
        tmp.innerHTML = `<${tag}>${escHtmlSimple(text.slice(start, start + mid))}</${tag}>`;
        document.body.appendChild(tmp);
        const h = tmp.scrollHeight;
        document.body.removeChild(tmp);
        if (h <= availH) { safe = mid; lo = mid + 1; }
        else { hi = mid - 1; }
      }
      chunks.push(`<${tag}>${escHtmlSimple(text.slice(start, start + safe))}</${tag}>`);
      start += safe;
    }
    return chunks;
  }

  function escHtmlSimple(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ===========================
  // 3. 渲染与翻页
  // ===========================
  function render(idx) {
    curPage = Math.max(0, Math.min(idx, pages.length - 1));
    _pageEl.innerHTML = pages[curPage];
    updateUI();
  }

  function updateUI() {
    const fill = document.getElementById('pr-prog-fill');
    if (fill) fill.style.width = ((curPage + 1) / pages.length * 100) + '%';
    if (_counter) _counter.textContent = `${curPage + 1} / ${pages.length}`;
  }

  function goTo(idx, fromRight /* true=从右滑入, false=从左滑入 */) {
    if (isAnimating) return;
    idx = Math.max(0, Math.min(idx, pages.length - 1));
    if (idx === curPage) return;

    isAnimating = true;
    const dir = fromRight ? 1 : -1;

    // 准备 next 页
    _nextEl.innerHTML = pages[idx];
    _nextEl.style.transition = 'none';
    _nextEl.style.transform  = `translateX(${dir * 100}%)`;

    // 强制重排
    _nextEl.offsetHeight; // eslint-disable-line

    // 同步动画
    _nextEl.style.transition = `transform ${ANIM_MS}ms cubic-bezier(.4,0,.2,1)`;
    _pageEl.style.transition = `transform ${ANIM_MS}ms cubic-bezier(.4,0,.2,1)`;
    _nextEl.style.transform  = 'translateX(0)';
    _pageEl.style.transform  = `translateX(${-dir * 100}%)`;

    setTimeout(() => {
      // 交换
      _pageEl.style.transition = 'none';
      _pageEl.style.transform  = 'translateX(0)';
      _pageEl.innerHTML        = pages[idx];
      _nextEl.style.transition = 'none';
      _nextEl.style.transform  = `translateX(${dir * 100}%)`;
      _nextEl.innerHTML        = '';

      curPage     = idx;
      isAnimating = false;
      updateUI();
    }, ANIM_MS);
  }

  function nextPage() {
    if (curPage < pages.length - 1) { goTo(curPage + 1, true); return true; }
    return false; // 已到末页
  }
  function prevPage() {
    if (curPage > 0) { goTo(curPage - 1, false); return true; }
    return false; // 已到首页
  }

  // ===========================
  // 4. 手势绑定
  // ===========================
  function bindGestures(el) {
    el.addEventListener('touchstart', (e) => {
      _txStart  = e.touches[0].clientX;
      _tyStart  = e.touches[0].clientY;
      _txTime   = Date.now();
      _dragging = false;
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      const dx = e.touches[0].clientX - _txStart;
      const dy = e.touches[0].clientY - _tyStart;
      if (Math.abs(dx) > Math.abs(dy) * 1.2 && Math.abs(dx) > 8) _dragging = true;
    }, { passive: true });

    el.addEventListener('touchend', (e) => {
      const dx  = e.changedTouches[0].clientX - _txStart;
      const dy  = e.changedTouches[0].clientY - _tyStart;
      const dt  = Date.now() - _txTime;
      const absDx = Math.abs(dx), absDy = Math.abs(dy);

      // 快速 tap（不是拖动）
      if (!_dragging && absDx < 12 && absDy < 12 && dt < 300) {
        const ratio = e.changedTouches[0].clientX / window.innerWidth;
        if (ratio < 0.35)       prevPage();
        else if (ratio > 0.65)  nextPage();
        // 中间 30% 不响应
        return;
      }

      // 滑动翻页
      if (_dragging && absDx > absDy * 1.2 && dt < 500) {
        if (dx < -50)      nextPage();
        else if (dx > 50)  prevPage();
      }
    }, { passive: true });
  }

  function onKey(e) {
    if (!_overlay || _overlay.style.display === 'none') return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown')  nextPage();
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')    prevPage();
    if (e.key === 'Escape') close();
  }

  // ===========================
  // 5. 公开 API
  // ===========================
  function open(html, title) {
    buildDOM();

    // 标题
    const titleEl = document.getElementById('pr-title');
    if (titleEl) titleEl.textContent = title || '';

    // 分页（异步，让浏览器先渲染 overlay）
    _overlay.style.display = 'flex';
    _pageEl.innerHTML = '<div style="padding:40px 0;text-align:center;color:rgba(255,255,255,.3)">排版中…</div>';
    _counter.textContent = '';

    requestAnimationFrame(() => {
      pages   = splitPages(html);
      curPage = 0;
      render(0);
    });
  }

  function close() {
    if (_overlay) _overlay.style.display = 'none';
    document.removeEventListener('keydown', onKey);
    pages = []; curPage = 0;
  }

  // 暴露翻页给外部（章节切换时跳到第1页）
  function reset() { curPage = 0; if (pages.length) render(0); }

  return { open, close, reset, nextPage, prevPage,
           get isOpen() { return _overlay && _overlay.style.display !== 'none'; } };
})();
