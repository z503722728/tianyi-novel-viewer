/**
 * 天意小说阅读器 · 应用逻辑 v3
 * 新增：LazyList 虚拟懒加载（IntersectionObserver + 双端回收）
 *   - 每批渲染 BATCH 条，滚到底自动追加
 *   - 已渲染节点超过 MAX_DOM 时回收顶部，用占位撑高保持滚动位置
 *   - 章节列表 / 角色列表 / 时间轴 全部走 LazyList
 *   - 侧边栏章节目录也走懒加载（超 50 条折叠）
 */
(() => {
  'use strict';

  // ===== 全局状态 =====
  let currentBook = null;
  let currentTab  = 'home';
  let backTarget  = null;
  let _lazyList   = null;   // 当前活跃的 LazyList 实例

  // ===== LazyList =====
  class LazyList {
    constructor({ container, items, renderItem, batch = 20, maxDom = 60 }) {
      this.container  = container;
      this.items      = items;
      this.renderItem = renderItem;
      this.batch      = batch;
      this.maxDom     = maxDom;

      this.renderedStart = 0;   // items 中已渲染的起始 index
      this.renderedEnd   = 0;   // items 中已渲染的结束 index（exclusive）
      this.topPad        = 0;   // 顶部占位高度（px）
      this.botPad        = 0;   // 底部占位高度（px，reserved）

      // 占位元素（撑开滚动高度，防跳动）
      this._topSpacer = document.createElement('div');
      this._topSpacer.style.cssText = 'width:100%;pointer-events:none';
      this._botSentinel = document.createElement('div');
      this._botSentinel.style.cssText = 'width:100%;height:1px;pointer-events:none';

      container.innerHTML = '';
      container.appendChild(this._topSpacer);
      container.appendChild(this._botSentinel);

      this._observer = new IntersectionObserver(
        entries => { if (entries[0].isIntersecting) this._loadMore(); },
        { root: container.closest('.content-area') || null, rootMargin: '200px' }
      );
      this._observer.observe(this._botSentinel);

      this._loadMore();   // 首批
    }

    _loadMore() {
      if (this.renderedEnd >= this.items.length) {
        this._observer.disconnect();
        return;
      }
      const end = Math.min(this.renderedEnd + this.batch, this.items.length);
      const frag = document.createDocumentFragment();
      for (let i = this.renderedEnd; i < end; i++) {
        frag.appendChild(this.renderItem(this.items[i], i));
      }
      // 插到 sentinel 之前
      this.container.insertBefore(frag, this._botSentinel);
      this.renderedEnd = end;

      // 双端回收：超出 maxDom 时回收顶部
      this._recycleTop();
    }

    _recycleTop() {
      const rendered = this.renderedEnd - this.renderedStart;
      if (rendered <= this.maxDom) return;

      const excess = rendered - this.maxDom;
      let freed = 0;
      // 收集要删的节点（topSpacer 之后，botSentinel 之前，前 excess 个）
      const toRemove = [];
      let node = this._topSpacer.nextSibling;
      while (node && node !== this._botSentinel && toRemove.length < excess) {
        toRemove.push(node);
        node = node.nextSibling;
      }
      toRemove.forEach(n => {
        freed += n.offsetHeight || 80;   // 估算高度
        n.remove();
      });
      this.renderedStart += toRemove.length;
      this.topPad += freed;
      this._topSpacer.style.height = this.topPad + 'px';
    }

    destroy() {
      this._observer.disconnect();
      this.container.innerHTML = '';
      this._lazyList = null;
    }
  }

  function destroyLazyList() {
    if (_lazyList) { _lazyList.destroy(); _lazyList = null; }
  }

  // ===== 启动：自动尝试已保存密钥 =====
  window.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('password-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') unlock();
    });

    if (!TianYiCrypto.hasSavedKey()) return;

    const pwd = await TianYiCrypto.loadKey();
    if (!pwd) return;

    const btn = document.getElementById('unlock-btn');
    btn.textContent = '自动验证中...'; btn.disabled = true;

    try {
      const ok = await TianYiCrypto.verifyPassword(pwd);
      if (ok) {
        window._sessionKey = pwd;
        document.getElementById('unlock-screen').classList.remove('active');
        document.getElementById('main-screen').classList.add('active');
        await enterBookshelf();
        return;
      }
    } catch (e) {
      console.warn('自动解锁失败', e);
    }
    TianYiCrypto.clearKey();
    btn.textContent = '解锁阅读'; btn.disabled = false;
  });

  // ===== 解锁 =====
  window.togglePwd = () => {
    const inp = document.getElementById('password-input');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  };

  window.unlock = async () => {
    const pwd = document.getElementById('password-input').value.trim();
    if (!pwd) return;
    const btn = document.getElementById('unlock-btn');
    const err = document.getElementById('unlock-error');
    btn.textContent = '验证中...'; btn.disabled = true;
    err.classList.add('hidden');

    const ok = await TianYiCrypto.verifyPassword(pwd);
    if (!ok) {
      err.classList.remove('hidden');
      btn.textContent = '解锁阅读'; btn.disabled = false;
      return;
    }
    window._sessionKey = pwd;
    if (document.getElementById('remember-key').checked) {
      await TianYiCrypto.saveKey(pwd);
    }
    document.getElementById('unlock-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');
    await enterBookshelf();
  };

  window.clearSavedKey = () => { TianYiCrypto.clearKey(); showToast('已清除本地密钥'); };

  window.lockScreen = () => {
    window._sessionKey = null;
    currentBook = null;
    destroyLazyList();
    document.getElementById('main-screen').classList.remove('active');
    document.getElementById('unlock-screen').classList.add('active');
    document.getElementById('password-input').value = '';
    document.getElementById('unlock-btn').textContent = '解锁阅读';
    document.getElementById('unlock-btn').disabled = false;
    document.getElementById('bottom-nav').style.display = 'none';
  };

  // ===== 顶部菜单 =====
  window.showTopMenu = () => {
    document.getElementById('top-menu').classList.remove('hidden');
    document.getElementById('top-menu-overlay').classList.remove('hidden');
  };
  window.hideTopMenu = () => {
    document.getElementById('top-menu').classList.add('hidden');
    document.getElementById('top-menu-overlay').classList.add('hidden');
  };

  // ===== 书架 =====
  async function enterBookshelf() {
    destroyLazyList();
    document.getElementById('bottom-nav').style.display = 'none';
    document.getElementById('current-title').textContent = '天意 · 书架';
    showView('bookshelf-view');

    const sub  = document.getElementById('bookshelf-sub');
    const grid = document.getElementById('book-grid');
    sub.textContent = '加载中...';
    grid.innerHTML  = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const res = await fetch('data/books.json?' + Date.now());
      if (!res.ok) throw new Error('books.json not found');
      const books = await res.json();
      sub.textContent = `共 ${books.length} 本书`;
      grid.innerHTML  = '';
      if (!books.length) {
        grid.innerHTML = `<div class="empty-state"><div class="empty-icon">📚</div><div class="empty-text">暂无书籍，请先同步</div></div>`;
        return;
      }
      books.forEach(b => grid.appendChild(makeBookCard(b)));
    } catch (e) {
      sub.textContent = '加载失败';
      grid.innerHTML  = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${e.message}</div></div>`;
    }
  }

  window.goBookshelf = enterBookshelf;

  function makeBookCard(meta) {
    const el = document.createElement('div');
    el.className = 'book-card';
    el.innerHTML = `
      <div class="book-cover">
        <div class="book-cover-text">${escHtml((meta.world_name||'?').slice(0,2))}</div>
      </div>
      <div class="book-info">
        <div class="book-title">${escHtml(meta.world_name || meta.book_id)}</div>
        <div class="book-meta">${meta.chapter_count||0} 章 · ${fmtNum(meta.total_words||0)} 字</div>
        <div class="book-meta" style="color:var(--text3);font-size:11px">${meta.updated_at||''}</div>
      </div>
      <div class="book-arrow">›</div>
    `;
    el.onclick = () => openBook(meta);
    return el;
  }

  // ===== 打开书 =====
  async function openBook(meta) {
    destroyLazyList();
    showView('home-view');
    document.getElementById('card-grid').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    document.getElementById('book-hero-title').textContent = meta.world_name || meta.book_id;
    document.getElementById('book-hero-sub').textContent   = '加载中...';
    document.getElementById('current-title').textContent   = meta.world_name || '读书';
    document.getElementById('bottom-nav').style.display    = 'flex';

    try {
      const encPath = `data/${encodeURIComponent(meta.book_id)}/index.enc`;
      const data    = await TianYiCrypto.fetchDecrypted(encPath, window._sessionKey);
      currentBook   = data;
      renderBookHome();
    } catch (e) {
      document.getElementById('card-grid').innerHTML =
        `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">加载失败: ${e.message}</div></div>`;
    }
  }

  // ===== 书内首页（摘要卡片，数量少，不需要虚拟列表）=====
  function renderBookHome() {
    if (!currentBook) return;
    const d = currentBook;
    document.getElementById('book-hero-sub').textContent =
      `${(d.chapters||[]).length} 章 · ${fmtNum((d.chapters||[]).reduce((s,c)=>s+(c.word_count||0),0))} 字 · ${d.updated_at||''}`;
    document.getElementById('current-title').textContent = d.world_name || '未知世界';
    currentTab = 'home';
    updateNavActive('home');
    destroyLazyList();

    const grid = document.getElementById('card-grid');
    grid.innerHTML = '';

    if (d.world) {
      grid.appendChild(makeCard({
        icon: '🌍', title: d.world.world_name || '世界观',
        badge: '世界', badgeClass: 'badge-world',
        desc: (d.world.world_description||'').slice(0, 80) + '…',
        stats: [
          { label: '角色', value: (d.world.characters||[]).length },
          { label: '势力', value: (d.world.factions||[]).length },
        ],
        onClick: () => showWorldDetail()
      }));
    }

    // 最新 3 章
    const lastChaps = [...(d.chapters||[])].reverse().slice(0, 3);
    lastChaps.forEach(ch => grid.appendChild(makeChapterCard(ch)));

    if ((d.timeline||[]).length) {
      grid.appendChild(makeCard({
        icon: '⏳', title: '历史时间轴',
        badge: '历史', badgeClass: 'badge-history',
        desc: `${d.timeline.length} 个历史节点`,
        stats: [{ label: '节点', value: d.timeline.length }],
        onClick: () => switchNav('timeline')
      }));
    }

    if ((d.world?.characters||[]).length) {
      grid.appendChild(makeCard({
        icon: '👥', title: '角色档案',
        badge: '角色', badgeClass: 'badge-char',
        desc: `${d.world.characters.length} 位角色`,
        stats: [{ label: '已收录', value: d.world.characters.length }],
        onClick: () => switchNav('characters')
      }));
    }

    buildSidebar();
  }

  // ===== 侧边栏（章节目录超50条折叠）=====
  function buildSidebar() {
    const nav = document.getElementById('sidebar-nav');
    nav.innerHTML = '';
    if (!currentBook) return;

    // 导航
    const navSec = document.createElement('div');
    navSec.className = 'nav-section';
    navSec.innerHTML = `<div class="nav-section-title">导航</div>`;
    const bsBtn = document.createElement('button');
    bsBtn.className = 'nav-link';
    bsBtn.innerHTML = `<span class="nav-icon">📚</span>切换书籍`;
    bsBtn.onclick = () => { enterBookshelf(); hideSidebar(); };
    navSec.appendChild(bsBtn);
    nav.appendChild(navSec);

    // 章节（超 50 章折叠，只显示前 50 + 展开按钮）
    const chs = currentBook.chapters || [];
    if (chs.length) {
      const chSec = document.createElement('div');
      chSec.className = 'nav-section';
      chSec.innerHTML = `<div class="nav-section-title">章节（${chs.length}）</div>`;
      const SHOW = 50;
      const visible = chs.slice(0, SHOW);
      visible.forEach(ch => {
        const btn = document.createElement('button');
        btn.className = 'nav-link';
        btn.innerHTML = `<span class="nav-icon">${ch.chapter_type?.includes('dark') ? '⚡' : '📄'}</span>${escHtml(ch.title||`第${ch.chapter_num}章`)}`;
        btn.onclick = () => { showChapterDetail(ch); hideSidebar(); };
        chSec.appendChild(btn);
      });
      if (chs.length > SHOW) {
        const more = document.createElement('button');
        more.className = 'nav-link';
        more.innerHTML = `<span class="nav-icon">＋</span>查看全部 ${chs.length} 章`;
        more.onclick = () => { switchNav('chapters'); hideSidebar(); };
        chSec.appendChild(more);
      }
      nav.appendChild(chSec);
    }

    // 世界设定
    const wSec = document.createElement('div');
    wSec.className = 'nav-section';
    wSec.innerHTML = `<div class="nav-section-title">世界设定</div>`;
    [
      { icon: '🌍', label: '世界观',   fn: () => { showWorldDetail(); hideSidebar(); } },
      { icon: '⚔️', label: '势力格局', fn: () => { showFactions();   hideSidebar(); } },
    ].forEach(({ icon, label, fn }) => {
      const btn = document.createElement('button');
      btn.className = 'nav-link';
      btn.innerHTML = `<span class="nav-icon">${icon}</span>${label}`;
      btn.onclick = fn;
      wSec.appendChild(btn);
    });
    nav.appendChild(wSec);

    // 角色（超 30 折叠）
    const chars = currentBook.world?.characters || [];
    if (chars.length) {
      const cSec = document.createElement('div');
      cSec.className = 'nav-section';
      cSec.innerHTML = `<div class="nav-section-title">角色（${chars.length}）</div>`;
      chars.slice(0, 30).forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'nav-link';
        btn.innerHTML = `<span class="nav-icon">${roleIcon(c.role_type)}</span>${escHtml(c.name)}`;
        btn.onclick = () => { showCharDetail(c); hideSidebar(); };
        cSec.appendChild(btn);
      });
      if (chars.length > 30) {
        const more = document.createElement('button');
        more.className = 'nav-link';
        more.innerHTML = `<span class="nav-icon">＋</span>查看全部 ${chars.length} 位角色`;
        more.onclick = () => { switchNav('characters'); hideSidebar(); };
        cSec.appendChild(more);
      }
      nav.appendChild(cSec);
    }
  }

  window.showSidebar = () => {
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('overlay').classList.remove('hidden');
  };
  window.hideSidebar = () => {
    document.getElementById('sidebar').classList.add('hidden');
    document.getElementById('overlay').classList.add('hidden');
  };

  // ===== 底部导航 =====
  window.switchNav = (tab) => {
    if (!currentBook) return;
    currentTab = tab;
    updateNavActive(tab);
    showView('home-view');
    destroyLazyList();
    if (tab === 'home')       return renderBookHome();
    if (tab === 'chapters')   return renderChapterList();
    if (tab === 'world')      return showWorldDetail();
    if (tab === 'characters') return renderCharList();
    if (tab === 'timeline')   return renderTimeline();
  };

  function updateNavActive(tab) {
    document.querySelectorAll('.nav-item').forEach(el =>
      el.classList.toggle('active', el.dataset.tab === tab));
  }

  // ===== 视图切换 =====
  function showView(id) {
    ['bookshelf-view','home-view','detail-view'].forEach(v =>
      document.getElementById(v).classList.toggle('active', v === id));
    document.querySelector('.content-area').scrollTop = 0;
  }

  function showDetail(html, title, back = 'home') {
    destroyLazyList();
    backTarget = back;
    document.getElementById('current-title').textContent = title || '详情';
    document.getElementById('back-btn').textContent = back === 'bookshelf' ? '← 书架' : '← 返回';
    document.getElementById('detail-content').innerHTML = html;
    showView('detail-view');
  }

  window.handleBack = () => {
    destroyLazyList();
    if (backTarget === 'bookshelf') { enterBookshelf(); }
    else {
      showView('home-view');
      document.getElementById('current-title').textContent = currentBook?.world_name || '天意';
    }
  };

  // ===== 章节列表（LazyList）=====
  function renderChapterList() {
    const chs  = currentBook?.chapters || [];
    const grid = document.getElementById('card-grid');
    grid.innerHTML = `<div class="update-time">共 ${chs.length} 章</div>`;
    if (!chs.length) return;

    const wrap = document.createElement('div');
    grid.appendChild(wrap);
    _lazyList = new LazyList({
      container:  wrap,
      items:      chs,
      renderItem: ch => makeChapterCard(ch),
      batch:      20,
      maxDom:     60,
    });
  }

  function makeChapterCard(ch) {
    return makeCard({
      icon: ch.chapter_type?.includes('dark') ? '⚡' : '📖',
      title: ch.title || `第${ch.chapter_num}章`,
      badge: ch.chapter_type === 'dark_line_a' ? '暗线A' : ch.chapter_type === 'dark_line_b' ? '暗线B' : '正线',
      badgeClass: 'badge-chapter',
      desc:  ch.summary || '',
      stats: [
        { label: '字数',  value: fmtNum(ch.word_count||0) },
        { label: '视角',  value: ch.pov_character || '主角' },
      ],
      onClick: () => showChapterDetail(ch)
    });
  }

  function showChapterDetail(ch) {
    const html = `
      <h1>${escHtml(ch.title||'章节')}</h1>
      <div class="meta-row">
        <span class="tag">${ch.chapter_type==='dark_line_a'?'⚡ 暗线A':ch.chapter_type==='dark_line_b'?'⚡ 暗线B':'🎬 正线'}</span>
        <span class="tag">👁 ${escHtml(ch.pov_character||'主角')}</span>
        ${ch.word_count?`<span class="tag">${fmtNum(ch.word_count)} 字</span>`:''}
      </div>
      ${ch.strategy_core?`<blockquote>♟ ${escHtml(ch.strategy_core)}</blockquote>`:''}
      ${ch.cost_this_chapter?`<blockquote>💔 ${escHtml(ch.cost_this_chapter)}</blockquote>`:''}
      <div class="separator"></div>
      ${mdToHtml(ch.content||'')}
    `;
    showDetail(html, ch.title);
  }

  // ===== 世界观 =====
  function showWorldDetail() {
    const w = currentBook?.world;
    if (!w) return;
    const html = `
      <h1>${escHtml(w.world_name||'世界观')}</h1>
      <p class="no-indent">${escHtml(w.world_description||'')}</p>
      ${w.magic_system?`<h2>修炼体系</h2><p>${escHtml(w.magic_system)}</p>`:''}
      ${(w.world_rules||[]).length?`<h2>世界规则</h2>${w.world_rules.map(r=>{
        if(typeof r==='string') return `<p>• ${escHtml(r)}</p>`;
        return `<div class="char-card" style="margin-bottom:10px">
          <div style="font-size:14px;font-weight:600;color:var(--accent2);margin-bottom:4px">${escHtml(r.name||r.rule_id||'')}</div>
          <div style="font-size:13px;color:var(--text2)">${escHtml(r.description||'')}</div>
          ${r.is_hard_constraint?'<div style="font-size:11px;color:var(--red);margin-top:4px">⚠ 硬性约束</div>':''}
        </div>`;
      }).join('')}`:'' }
      ${(w.factions||[]).length?`<h2>主要势力</h2>${w.factions.map(f=>`
        <div class="char-card">
          <div class="char-name">${escHtml(f.name)}</div>
          <div class="char-role">${escHtml(f.type||'')} · ${escHtml(f.alignment||'')}</div>
          <p class="no-indent" style="font-size:13px;color:var(--text2);margin-top:6px">${escHtml(f.description||'')}</p>
          ${f.internal_conflict?`<div class="char-symbol-item" style="margin-top:8px"><span class="sym-label" style="color:var(--red)">内部矛盾</span><span class="sym-value">${escHtml(f.internal_conflict)}</span></div>`:''}
        </div>`).join('')}`:'' }
    `;
    showDetail(html, '世界观设定');
    if (currentTab==='world') showView('detail-view');
  }

  function showFactions() {
    const factions = currentBook?.world?.factions||[];
    if (!factions.length) return;
    const html = `
      <h1>势力格局</h1>
      ${factions.map(f=>`
        <div class="char-card">
          <div class="char-name">${escHtml(f.name)}</div>
          <div class="char-role">${escHtml(f.type||'')} · ${escHtml(f.alignment||'')}</div>
          <p class="no-indent" style="font-size:13px;color:var(--text2);margin-top:6px">${escHtml(f.description||'')}</p>
          ${f.internal_conflict?`<div class="char-symbol-item" style="margin-top:8px"><span class="sym-label" style="color:var(--red)">内部矛盾</span><span class="sym-value">${escHtml(f.internal_conflict)}</span></div>`:''}
        </div>`).join('')}
    `;
    showDetail(html, '势力格局');
  }

  // ===== 角色列表（LazyList）=====
  function renderCharList() {
    const chars = currentBook?.world?.characters || [];
    const grid  = document.getElementById('card-grid');
    grid.innerHTML = `<div class="update-time">共 ${chars.length} 位角色</div>`;
    if (!chars.length) return;

    const wrap = document.createElement('div');
    grid.appendChild(wrap);
    _lazyList = new LazyList({
      container:  wrap,
      items:      chars,
      renderItem: c => makeCard({
        icon: roleIcon(c.role_type), title: c.name,
        badge: roleLabel(c.role_type), badgeClass: 'badge-char',
        desc: (c.background||c.description||'').slice(0, 80),
        stats: [
          { label: '阵营', value: c.faction||'未知' },
          { label: '境界', value: c.power_level||'?' },
        ],
        onClick: () => showCharDetail(c)
      }),
      batch:  20,
      maxDom: 60,
    });
  }

  function showCharDetail(c) {
    const sym  = c.symbol||{};
    const html = `
      <h1>${escHtml(c.name)}</h1>
      <div class="meta-row">
        <span class="tag">${escHtml(roleLabel(c.role_type))}</span>
        ${c.faction?`<span class="tag">${escHtml(c.faction)}</span>`:''}
        ${c.power_level?`<span class="tag">${escHtml(c.power_level)}</span>`:''}
      </div>
      ${c.background||c.description?`<p>${escHtml(c.background||c.description)}</p>`:''}
      ${Object.keys(sym).length?`
        <h2>角色符号体系</h2>
        <div class="char-card">
          ${(sym.visual_markers||[]).length?`<div class="char-symbol-item"><span class="sym-label">视觉锚点</span><span class="sym-value">${sym.visual_markers.map(escHtml).join('；')}</span></div>`:''}
          ${sym.speech_pattern?`<div class="char-symbol-item"><span class="sym-label">口头禅</span><span class="sym-value">${escHtml(sym.speech_pattern)}</span></div>`:''}
          ${(sym.behavioral_tics||[]).length?`<div class="char-symbol-item"><span class="sym-label">标志行为</span><span class="sym-value">${sym.behavioral_tics.map(escHtml).join('；')}</span></div>`:''}
          ${sym.core_contradiction?`<div class="char-symbol-item"><span class="sym-label">内在矛盾</span><span class="sym-value">${escHtml(sym.core_contradiction)}</span></div>`:''}
          ${sym.arc_direction?`<div class="char-symbol-item"><span class="sym-label">人物弧线</span><span class="sym-value">${escHtml(sym.arc_direction)}</span></div>`:''}
          ${sym.personal_imagery?`<div class="char-symbol-item"><span class="sym-label">专属意象</span><span class="sym-value">${escHtml(sym.personal_imagery)}</span></div>`:''}
        </div>`:''}
    `;
    showDetail(html, c.name);
  }

  // ===== 时间轴（LazyList）=====
  function renderTimeline() {
    const tl   = currentBook?.timeline||[];
    const grid = document.getElementById('card-grid');
    if (!tl.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div><div class="empty-text">暂无历史记录</div></div>`;
      return;
    }
    grid.innerHTML = `<div class="update-time">共 ${tl.length} 个节点</div>`;

    const typeIcon  = { era:'🌐', power_shift:'⚔️', battle:'💥' };
    const typeColor = { era:'var(--accent)', power_shift:'var(--red)', battle:'var(--gold)' };

    // 时间轴用 wrap 包一层（保持竖线连续）
    const wrap = document.createElement('div');
    wrap.className = 'timeline';
    wrap.style.cssText = 'padding:16px;overflow:hidden';
    grid.appendChild(wrap);

    _lazyList = new LazyList({
      container:  wrap,
      items:      tl,
      renderItem: (node, i) => {
        const col  = typeColor[node.type] || 'var(--accent)';
        const icon = typeIcon[node.type]  || '⏳';
        const el   = document.createElement('div');
        el.className = 'tl-item';
        el.innerHTML = `
          <div class="tl-dot-col">
            <div class="tl-dot" style="background:${col};border-color:${col}"></div>
            <div class="tl-line"></div>
          </div>
          <div class="tl-body">
            <div class="tl-year">${icon} ${escHtml(node.year||`节点${i+1}`)}</div>
            <div class="tl-event">${escHtml(node.event||node.title||'')}</div>
            ${node.description?`<div class="tl-desc">${escHtml(node.description)}</div>`:''}
          </div>
        `;
        return el;
      },
      batch:  30,
      maxDom: 90,
    });
  }

  // ===== 通用卡片 =====
  function makeCard({ icon, title, badge, badgeClass, desc, stats, onClick }) {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div class="card-header">
        <span class="card-icon">${icon}</span>
        <div class="card-meta">
          <div class="card-title">${escHtml(title)}</div>
          <span class="card-badge ${badgeClass}">${badge}</span>
        </div>
      </div>
      <div class="card-desc">${escHtml(desc)}</div>
      ${stats?`<div class="card-stats">${stats.map(s=>`<div class="stat">${s.label} <span>${s.value}</span></div>`).join('')}</div>`:''}
    `;
    el.onclick = onClick;
    return el;
  }

  // ===== Toast =====
  window.showToast = (msg) => {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div'); el.id = 'toast';
      el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 18px;border-radius:99px;font-size:13px;z-index:999;pointer-events:none;transition:opacity .3s';
      document.body.appendChild(el);
    }
    el.textContent = msg; el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => el.style.opacity = '0', 2000);
  };

  // ===== 工具 =====
  function escHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function fmtNum(n) {
    return n >= 10000 ? (n/10000).toFixed(1)+'万' : n.toString();
  }
  function mdToHtml(md) {
    const lines = md.split('\n'); let html = '', inP = false;
    lines.forEach(line => {
      if      (line.startsWith('# '))   { if(inP){html+='</p>';inP=false;} html+=`<h1>${escHtml(line.slice(2))}</h1>`; }
      else if (line.startsWith('## '))  { if(inP){html+='</p>';inP=false;} html+=`<h2>${escHtml(line.slice(3))}</h2>`; }
      else if (line.startsWith('### ')) { if(inP){html+='</p>';inP=false;} html+=`<h3>${escHtml(line.slice(4))}</h3>`; }
      else if (line.trim()==='')        { if(inP){html+='</p>';inP=false;} }
      else { if(!inP){html+='<p>';inP=true;} else html+='<br>'; html+=escHtml(line); }
    });
    if(inP) html+='</p>';
    return html;
  }
  function roleIcon(t)  { return {protagonist:'🦸',antagonist:'🦹',supporting:'👤',neutral:'🧩'}[t]||'👤'; }
  function roleLabel(t) { return {protagonist:'主角',antagonist:'反派',supporting:'配角',neutral:'中立'}[t]||'角色'; }
})();
