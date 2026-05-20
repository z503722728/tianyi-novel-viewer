/**
 * 天意小说阅读器 · 应用逻辑 v4
 * - 首页：3张摘要卡（世界观/最新章/历史总览）
 * - 新增独立页面：战场事件、权力转移、角色命运、历史节点、时代分段
 * - 角色：完整字段（capabilities/personality_tags/fate）
 * - LazyList：IntersectionObserver + 双端回收
 */
(() => {
  'use strict';

  let currentBook = null;
  let currentTab  = 'home';
  let backTarget  = null;
  let _lazyList   = null;

  // ===== 路径路由（path-based，无 #）=====
  // 格式：/tianyi-novel-viewer/book/{bookId}/chapter/{num}/block/{blockId}
  //       /tianyi-novel-viewer/book/{bookId}/chapter/{num}
  //       /tianyi-novel-viewer/book/{bookId}/setting/{section}
  //       /tianyi-novel-viewer/book/{bookId}/characters/{charName}
  //       /tianyi-novel-viewer/book/{bookId}/history/{section}
  //       /tianyi-novel-viewer/book/{bookId}

  const BASE_PATH = '/tianyi-novel-viewer';

  const Router = (() => {
    // 从 pathname 解析路由对象（兼容旧 hash 格式）
    function parse(path) {
      const p = (path || location.pathname).replace(/^#\/?/, '');
      if (!p) return null;
      // 剥离 base path
      let relative = p;
      if (relative.startsWith(BASE_PATH)) {
        relative = relative.slice(BASE_PATH.length) || '/';
      }
      const parts = relative.replace(/^\/+/, '').split('/');
      if (parts[0] !== 'book' || !parts[1]) return null;
      const route = { bookId: decodeURIComponent(parts[1]) };
      if (parts[2]) {
        route.section = parts[2];          // chapter / setting / characters / history
        route.param   = parts[3] ? decodeURIComponent(parts[3]) : null;
        route.sub     = parts[4] ? parts[4] : null;
        route.subId   = parts[5] ? decodeURIComponent(parts[5]) : null;
      }
      return route;
    }

    // 兼容旧 hash 格式：#/book/{bookId}/...
    function parseHash(hash) {
      if (!hash || !hash.startsWith('#/')) return null;
      return parse(hash);
    }

    // 生成干净路径（供外部调用生成链接）
    function build(bookId, section, param, sub, subId) {
      let p = BASE_PATH;
      p += `/book/${encodeURIComponent(bookId)}`;
      if (section) p += `/${section}`;
      if (param  ) p += `/${encodeURIComponent(String(param))}`;
      if (sub    ) p += `/${sub}`;
      if (subId  ) p += `/${encodeURIComponent(subId)}`;
      return p;
    }

    // 把当前状态写入地址栏（不触发 popstate）
    function set(bookId, section, param, sub, subId) {
      const path = build(bookId, section, param, sub, subId);
      history.replaceState(null, '', path);
    }

    // 导航到路径路由（异步，解锁后自动执行）
    async function navigate(route) {
      if (!route || !route.bookId) return;

      if (!currentBook || currentBook.book_id !== route.bookId) {
        try {
          const res = await fetch('/tianyi-novel-viewer/data/books.json?' + Date.now());
          if (!res.ok) return;
          const books = await res.json();
          const meta = books.find(b => b.book_id === route.bookId || b.world_name === route.bookId);
          if (!meta) return;
          await openBook(meta);
        } catch (e) { return; }
      }

      const { section, param, sub, subId } = route;
      if (!section || section === 'home') return;

      if (section === 'chapter') {
        const chNum = parseInt(param, 10);
        const ch = (currentBook?.chapters || []).find(c => c.chapter_num === chNum);
        if (ch) {
          showChapterDetail(ch);
          if (sub === 'block' && subId) {
            setTimeout(() => scrollToBlock(subId), 400);
          }
        }
        return;
      }
      if (section === 'setting') {
        switchNav('world');
        if (param === 'world')   setTimeout(showWorldDetail,  100);
        if (param === 'magic')   setTimeout(showMagicSystem,  100);
        if (param === 'rules')   setTimeout(showWorldRules,   100);
        if (param === 'factions')setTimeout(showFactions,     100);
        if (param === 'locations')setTimeout(showLocations,   100);
        return;
      }
      if (section === 'characters') {
        switchNav('characters');
        if (param) {
          setTimeout(() => {
            const c = (currentBook?.world?.characters || []).find(x => x.name === param || x.character_id === param);
            if (c) showCharDetail(c);
          }, 100);
        }
        return;
      }
      if (section === 'history') {
        switchNav('timeline');
        if (param === 'eras')         setTimeout(showEras,         100);
        if (param === 'battles')      setTimeout(showBattles,      100);
        if (param === 'power_shifts') setTimeout(showPowerShifts,  100);
        if (param === 'char_fates')   setTimeout(showCharFates,    100);
        if (param === 'nodes')        setTimeout(showHistoryNodes, 100);
        if (param === 'timeline')     setTimeout(showTimeline,     100);
        return;
      }
      if (section === 'plan') {
        switchNav('plan');
        if (param === 'outline') setTimeout(showPlanOutline, 100);
        if (param === 'blueprints') setTimeout(showBlueprintList, 100);
        if (param && param.startsWith('ch_')) {
          setTimeout(() => showBlueprintDetail(param), 100);
        }
        return;
      }
      if (section === 'boxes') {
        switchNav('boxes');
        if (param === 'truth_map') setTimeout(showTruthMap, 100);
        if (param === 'statuses') setTimeout(showCharacterStatuses, 100);
        if (param && param.startsWith('box_')) {
          setTimeout(() => showBoxDetail(param), 100);
        }
        return;
      }
    }

    function scrollToBlock(blockId) {
      const el = document.getElementById(blockId);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // 监听 popstate（浏览器前进/后退）
    window.addEventListener('popstate', async () => {
      const route = parse() || parseHash(location.hash);
      if (route && window._sessionKey) await navigate(route);
    });

    // 监听旧 hashtag 变化（兼容手动修改地址栏 # 的情况）
    window.addEventListener('hashchange', async () => {
      const route = parseHash(location.hash);
      if (route && window._sessionKey) await navigate(route);
    });

    return { parse, parseHash, build, set, navigate };
  })();

  // 暴露给外部
  window.RouterBuild = Router.build;

  // ===== LazyList =====
  class LazyList {
    constructor({ container, items, renderItem, batch = 20, maxDom = 60 }) {
      this.container = container; this.items = items;
      this.renderItem = renderItem; this.batch = batch; this.maxDom = maxDom;
      this.renderedStart = 0; this.renderedEnd = 0; this.topPad = 0;
      this._topSpacer = document.createElement('div');
      this._topSpacer.style.cssText = 'width:100%;pointer-events:none';
      this._botSentinel = document.createElement('div');
      this._botSentinel.style.cssText = 'width:100%;height:1px;pointer-events:none';
      container.innerHTML = '';
      container.appendChild(this._topSpacer);
      container.appendChild(this._botSentinel);
      this._observer = new IntersectionObserver(
        e => { if (e[0].isIntersecting) this._loadMore(); },
        { root: container.closest('.content-area'), rootMargin: '200px' }
      );
      this._observer.observe(this._botSentinel);
      this._loadMore();
    }
    _loadMore() {
      if (this.renderedEnd >= this.items.length) { this._observer.disconnect(); return; }
      const end = Math.min(this.renderedEnd + this.batch, this.items.length);
      const frag = document.createDocumentFragment();
      for (let i = this.renderedEnd; i < end; i++) frag.appendChild(this.renderItem(this.items[i], i));
      this.container.insertBefore(frag, this._botSentinel);
      this.renderedEnd = end;
      this._recycleTop();
    }
    _recycleTop() {
      const excess = (this.renderedEnd - this.renderedStart) - this.maxDom;
      if (excess <= 0) return;
      const toRemove = [];
      let node = this._topSpacer.nextSibling;
      while (node && node !== this._botSentinel && toRemove.length < excess) {
        toRemove.push(node); node = node.nextSibling;
      }
      let freed = 0;
      toRemove.forEach(n => { freed += n.offsetHeight || 80; n.remove(); });
      this.renderedStart += toRemove.length;
      this.topPad += freed;
      this._topSpacer.style.height = this.topPad + 'px';
    }
    destroy() { this._observer.disconnect(); this.container.innerHTML = ''; }
  }

  function destroyLazyList() {
    if (_lazyList) { _lazyList.destroy(); _lazyList = null; }
  }

  // ===== 启动 =====
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
      if (await TianYiCrypto.verifyPassword(pwd)) {
        window._sessionKey = pwd;
        document.getElementById('unlock-screen').classList.remove('active');
        document.getElementById('main-screen').classList.add('active');
        // 解锁后检查是否有路由需要直接导航（path优先，fallback到hash兼容旧链接）
        const initRoute = Router.parse() || Router.parseHash(location.hash);
        if (initRoute) { await Router.navigate(initRoute); return; }
        await enterBookshelf(); return;
      }
    } catch (e) { console.warn('自动解锁失败', e); }
    TianYiCrypto.clearKey();
    btn.textContent = '解锁阅读'; btn.disabled = false;
  });

  window.togglePwd = () => {
    const i = document.getElementById('password-input');
    i.type = i.type === 'password' ? 'text' : 'password';
  };
  window.unlock = async () => {
    const pwd = document.getElementById('password-input').value.trim();
    if (!pwd) return;
    const btn = document.getElementById('unlock-btn');
    const err = document.getElementById('unlock-error');
    btn.textContent = '验证中...'; btn.disabled = true;
    err.classList.add('hidden');
    if (!await TianYiCrypto.verifyPassword(pwd)) {
      err.classList.remove('hidden'); btn.textContent = '解锁阅读'; btn.disabled = false; return;
    }
    window._sessionKey = pwd;
    if (document.getElementById('remember-key').checked) await TianYiCrypto.saveKey(pwd);
    document.getElementById('unlock-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');
    // 解锁后检查是否有路由需要直接导航（path优先，fallback到hash兼容旧链接）
    const initRoute = Router.parse() || Router.parseHash(location.hash);
    if (initRoute) { await Router.navigate(initRoute); return; }
    await enterBookshelf();
  };
  window.clearSavedKey = () => { TianYiCrypto.clearKey(); showToast('已清除本地密钥'); };
  window.lockScreen = () => {
    window._sessionKey = null; currentBook = null; destroyLazyList();
    document.getElementById('main-screen').classList.remove('active');
    document.getElementById('unlock-screen').classList.add('active');
    document.getElementById('password-input').value = '';
    document.getElementById('unlock-btn').textContent = '解锁阅读';
    document.getElementById('unlock-btn').disabled = false;
    document.getElementById('bottom-nav').style.display = 'none';
  };
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
    const sub = document.getElementById('bookshelf-sub');
    const grid = document.getElementById('book-grid');
    sub.textContent = '加载中...'; grid.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    try {
      const res = await fetch('/tianyi-novel-viewer/data/books.json?' + Date.now());
      if (!res.ok) throw new Error('books.json not found');
      const books = await res.json();
      sub.textContent = `共 ${books.length} 本书`; grid.innerHTML = '';
      if (!books.length) { grid.innerHTML = `<div class="empty-state"><div class="empty-icon">📚</div><div class="empty-text">暂无书籍，请先同步</div></div>`; return; }
      books.forEach(b => grid.appendChild(makeBookCard(b)));
    } catch (e) {
      sub.textContent = '加载失败';
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${e.message}</div></div>`;
    }
  }
  window.goBookshelf = enterBookshelf;

  function makeBookCard(meta) {
    const el = document.createElement('div'); el.className = 'book-card';
    el.innerHTML = `
      <div class="book-cover"><div class="book-cover-text">${escHtml((meta.world_name||'?').slice(0,2))}</div></div>
      <div class="book-info">
        <div class="book-title">${escHtml(meta.world_name||meta.book_id)}</div>
        <div class="book-meta">${meta.chapter_count||0} 章 · ${fmtNum(meta.total_words||0)} 字</div>
        <div class="book-meta" style="color:var(--text3);font-size:11px">${meta.updated_at||''}</div>
      </div><div class="book-arrow">›</div>`;
    el.onclick = () => openBook(meta); return el;
  }

  // ===== 打开书 =====
  async function openBook(meta) {
    destroyLazyList(); showView('home-view');
    document.getElementById('card-grid').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    document.getElementById('book-hero-title').textContent = meta.world_name || meta.book_id;
    document.getElementById('book-hero-sub').textContent = '加载中...';
    document.getElementById('current-title').textContent = meta.world_name || '读书';
    document.getElementById('bottom-nav').style.display = 'flex';
    try {
      const data = await TianYiCrypto.fetchDecrypted(`/tianyi-novel-viewer/data/${encodeURIComponent(meta.book_id)}/index.enc`, window._sessionKey);
      currentBook = data;
      currentBook.book_id = currentBook.book_id || meta.book_id;
      Router.set(currentBook.book_id);
      renderBookHome();
    } catch (e) {
      document.getElementById('card-grid').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">加载失败: ${e.message}</div></div>`;
    }
  }

  // ===== 书内首页：只显3张摘要卡 =====
  function renderBookHome() {
    if (!currentBook) return;
    const d = currentBook;
    const totalWords = (d.chapters||[]).reduce((s,c) => s + (c.word_count||0), 0);
    document.getElementById('book-hero-sub').textContent =
      `${(d.chapters||[]).length} 章 · ${fmtNum(totalWords)} 字 · ${d.updated_at||''}`;
    document.getElementById('current-title').textContent = d.world_name || '未知世界';
    currentTab = 'home'; updateNavActive('home');
    destroyLazyList();

    const grid = document.getElementById('card-grid');
    grid.innerHTML = '';

    // 1. 世界观摘要卡
    if (d.world) {
      grid.appendChild(makeCard({
        icon: '🌍', title: d.world.world_name || '世界观', badge: '设定', badgeClass: 'badge-world',
        desc: (d.world.world_description||'').slice(0, 100) + '…',
        stats: [{ label: '角色', value: (d.world.characters||[]).length }, { label: '势力', value: (d.world.factions||[]).length }],
        onClick: () => switchNav('world')
      }));
    }

    // 2. 最新章节（最多1张）
    const lastCh = (d.chapters||[]).slice(-1)[0];
    if (lastCh) {
      grid.appendChild(makeCard({
        icon: '📖', title: lastCh.title || `第${lastCh.chapter_num}章`, badge: '最新章', badgeClass: 'badge-chapter',
        desc: lastCh.summary || '',
        stats: [{ label: '字数', value: fmtNum(lastCh.word_count||0) }, { label: '共', value: `${(d.chapters||[]).length}章` }],
        onClick: () => switchNav('chapters')
      }));
    }

    // 3. 历史总览卡
    const histTotal = (d.power_shifts||[]).length + (d.battle_milestones||[]).length + (d.character_fates||[]).length;
    if (histTotal > 0 || (d.timeline||[]).length > 0) {
      grid.appendChild(makeCard({
        icon: '⚔️', title: '历史大事记', badge: '历史', badgeClass: 'badge-history',
        desc: `${(d.eras||[]).length}个时代 · ${(d.battle_milestones||[]).length}场战役 · ${(d.character_fates||[]).length}条命运`,
        stats: [{ label: '权力转移', value: (d.power_shifts||[]).length }, { label: '历史节点', value: (d.history_nodes||[]).length }],
        onClick: () => switchNav('timeline')
      }));
    }

    // 4. 箱庭总览卡（如有数据）
    const boxTotal = (d.boxes||[]).length;
    if (boxTotal > 0 || (d.truth_map||[]).length > 0) {
      grid.appendChild(makeCard({
        icon: '🏠', title: '箱庭架构', badge: '箱庭', badgeClass: 'badge-box',
        desc: `${boxTotal}个箱庭 · ${(d.truth_map||[]).length}条真相 · ${(d.character_statuses||[]).length}人状态`,
        stats: [{ label: '阶段', value: (d.stages||[]).length }, { label: '真相', value: (d.truth_map||[]).length }],
        onClick: () => switchNav('boxes')
      }));
    }

    buildSidebar();
  }

  // ===== 侧边栏 =====
  function buildSidebar() {
    const nav = document.getElementById('sidebar-nav');
    nav.innerHTML = '';
    if (!currentBook) return;
    const d = currentBook;

    const addSection = (title, items) => {
      if (!items.length) return;
      const sec = document.createElement('div'); sec.className = 'nav-section';
      sec.innerHTML = `<div class="nav-section-title">${title}</div>`;
      items.forEach(({ icon, label, fn }) => {
        const btn = document.createElement('button'); btn.className = 'nav-link';
        btn.innerHTML = `<span class="nav-icon">${icon}</span>${escHtml(label)}`;
        btn.onclick = fn; sec.appendChild(btn);
      });
      nav.appendChild(sec);
    };

    // 导航
    addSection('导航', [
      { icon: '📚', label: '切换书籍', fn: () => { enterBookshelf(); hideSidebar(); } },
    ]);

    // 设定
    addSection('世界设定', [
      { icon: '🌍', label: '世界观',   fn: () => { showWorldDetail(); hideSidebar(); } },
      { icon: '⚔️', label: '势力格局', fn: () => { showFactions();   hideSidebar(); } },
    ]);

    // 历史
    addSection('历史', [
      { icon: '🌐', label: '时代分段',   fn: () => { showEras();          hideSidebar(); } },
      { icon: '💥', label: '战场事件',   fn: () => { showBattles();       hideSidebar(); } },
      { icon: '🔀', label: '权力转移',   fn: () => { showPowerShifts();   hideSidebar(); } },
      { icon: '☠️', label: '角色命运',   fn: () => { showCharFates();     hideSidebar(); } },
      { icon: '🗂', label: '历史节点',   fn: () => { showHistoryNodes();  hideSidebar(); } },
    ].filter(x => {
      if (x.label === '时代分段')  return (d.eras||[]).length > 0;
      if (x.label === '战场事件')  return (d.battle_milestones||[]).length > 0;
      if (x.label === '权力转移')  return (d.power_shifts||[]).length > 0;
      if (x.label === '角色命运')  return (d.character_fates||[]).length > 0;
      if (x.label === '历史节点')  return (d.history_nodes||[]).length > 0;
      return true;
    }));
  }

  window.showSidebar = () => { document.getElementById('sidebar').classList.remove('hidden'); document.getElementById('overlay').classList.remove('hidden'); };
  window.hideSidebar = () => { document.getElementById('sidebar').classList.add('hidden'); document.getElementById('overlay').classList.add('hidden'); };

  // ===== 底部导航（7个tab：首页/章节/设定/角色/历史/蓝图/箱庭）=====
  window.switchNav = (tab) => {
    if (!currentBook) return;
    currentTab = tab; updateNavActive(tab);
    showView('home-view'); destroyLazyList();
    if (tab === 'home')       return renderBookHome();
    if (tab === 'chapters')   return renderChapterList();
    if (tab === 'world')      return renderWorldHub();
    if (tab === 'characters') return renderCharList();
    if (tab === 'timeline')   return renderHistoryHub();
    if (tab === 'plan')       return renderPlanHub();
    if (tab === 'boxes')      return renderBoxesHub();
  };
  function updateNavActive(tab) {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  }

  // ===== 视图 =====
  function showView(id) {
    ['bookshelf-view','home-view','detail-view'].forEach(v =>
      document.getElementById(v).classList.toggle('active', v === id));
    document.querySelector('.content-area').scrollTop = 0;
  }
  function showDetail(html, title, back = 'home') {
    destroyLazyList(); backTarget = back;
    document.getElementById('current-title').textContent = title || '详情';
    document.getElementById('back-btn').textContent = back === 'bookshelf' ? '← 书架' : '← 返回';
    document.getElementById('detail-content').innerHTML = html;
    showView('detail-view');
  }
  window.handleBack = () => {
    destroyLazyList();
    if (backTarget === 'bookshelf') { enterBookshelf(); return; }
    // 返回对应 tab 的列表
    const tabMap = { world: 'world', characters: 'characters', timeline: 'timeline', chapters: 'chapters', plan: 'plan', boxes: 'boxes' };
    if (tabMap[currentTab]) { showView('home-view'); switchNav(currentTab); }
    else { showView('home-view'); document.getElementById('current-title').textContent = currentBook?.world_name || '天意'; }
  };

  // ===== 手势翻页接口（供 gesture.js 调用）=====
  let _currentChapterIndex = -1;

  window._getCurrentChapterIndex = () => _currentChapterIndex;
  window._currentBook            = null;   // gesture.js 读取

  window._showChapterByIndex = (idx) => {
    const chapters = currentBook?.chapters || [];
    if (idx < 0 || idx >= chapters.length) return;
    _currentChapterIndex = idx;
    showChapterDetail(chapters[idx]);
    // PagedReader 已全屏，无需手动滚顶
  };

  // ===== 章节列表（LazyList）=====
  function renderChapterList() {
    const chs = currentBook?.chapters || [];
    const grid = document.getElementById('card-grid');
    grid.innerHTML = `<div class="update-time">共 ${chs.length} 章 · ${fmtNum(chs.reduce((s,c)=>s+(c.word_count||0),0))} 字</div>`;
    if (!chs.length) return;
    const wrap = document.createElement('div'); grid.appendChild(wrap);
    _lazyList = new LazyList({ container: wrap, items: chs, renderItem: ch => makeChapterCard(ch), batch: 20, maxDom: 60 });
  }
  function makeChapterCard(ch) {
    const typeIconMap = ch.chapter_type?.includes('dark') ? '⚡' : ch.chapter_type === 'box_entry' ? '🚪' : ch.chapter_type === 'box_discussion' ? '💬' : ch.chapter_type === 'box_twist' ? '🌀' : '📖';
    const typeBadgeMap = ch.chapter_type === 'dark_line_a' ? '暗线A' : ch.chapter_type === 'dark_line_b' ? '暗线B' : ch.chapter_type === 'box_entry' ? '箱庭·入场' : ch.chapter_type === 'box_discussion' ? '箱庭·讨论' : ch.chapter_type === 'box_twist' ? '箱庭·反转' : '正线';
    return makeCard({
      icon: typeIconMap,
      title: ch.title || `第${ch.chapter_num}章`,
      badge: typeBadgeMap,
      badgeClass: ch.chapter_type?.startsWith('box_') ? 'badge-box' : 'badge-chapter',
      desc: ch.summary || '',
      stats: [{ label: '字数', value: fmtNum(ch.word_count||0) }, { label: '视角', value: ch.pov_character||'主角' }],
      onClick: () => showChapterDetail(ch)
    });
  }
  function showChapterDetail(ch) {
    // 同步当前章节 index，供手势翻页使用
    const chapters = currentBook?.chapters || [];
    _currentChapterIndex = chapters.findIndex(c => c === ch || c.chapter_id === ch.chapter_id);
    window._currentBook = currentBook;

    // 更新 hash 路由
    if (currentBook?.book_id) {
      Router.set(currentBook.book_id, 'chapter', ch.chapter_num);
    }

    // 构建章节 HTML（头部信息 + 正文，段落注入 block id）
    const headerHtml = `
      <h1 style="font-size:20px;font-weight:700;margin:0 0 12px;color:#fff">${escHtml(ch.title||'章节')}</h1>
      <div class="meta-row" style="margin-bottom:12px">
        <span class="tag">${ch.chapter_type==='dark_line_a'?'⚡ 暗线A':ch.chapter_type==='dark_line_b'?'⚡ 暗线B':ch.chapter_type==='box_entry'?'🚪 箱庭·入场':ch.chapter_type==='box_discussion'?'💬 箱庭·讨论':ch.chapter_type==='box_twist'?'🌀 箱庭·反转':'🎬 正线'}</span>
        <span class="tag">👁 ${escHtml(ch.pov_character||'主角')}</span>
        ${ch.word_count?`<span class="tag">${fmtNum(ch.word_count)} 字</span>`:''}
        ${ch.location?`<span class="tag">📍 ${escHtml(ch.location)}</span>`:''}
      </div>
      ${ch.strategy_core?`<blockquote style="border-left:3px solid var(--accent);padding:8px 12px;margin:0 0 12px;background:rgba(124,92,252,.08);border-radius:0 8px 8px 0;font-size:14px;color:rgba(255,255,255,.6)">♟ ${escHtml(ch.strategy_core)}</blockquote>`:''}
      ${ch.cost_this_chapter?`<blockquote style="border-left:3px solid var(--red,#ef4444);padding:8px 12px;margin:0 0 12px;background:rgba(239,68,68,.08);border-radius:0 8px 8px 0;font-size:14px;color:rgba(255,255,255,.6)">💔 ${escHtml(ch.cost_this_chapter)}</blockquote>`:''}
      <hr style="border:none;border-top:1px solid rgba(255,255,255,.1);margin:0 0 16px">
    `;

    // 用 blocks 数据渲染正文（带 id），fallback 到 mdToHtml
    let bodyHtml;
    if (ch.blocks && ch.blocks.length) {
      bodyHtml = ch.blocks.map(b => {
        if (b.type === 'heading') return `<h2 id="${b.id}">${escHtml(b.text)}</h2>`;
        return `<p id="${b.id}">${escHtml(b.text)}</p>`;
      }).join('');
    } else {
      bodyHtml = mdToHtml(ch.content || '（本章暂无正文）');
    }

    // 打开翻页阅读器
    window.PagedReader.open(headerHtml + bodyHtml, ch.title || `第${ch.chapter_num}章`);
  }

  // ===== 设定中心（world tab）=====
  function renderWorldHub() {
    const d = currentBook;
    if (!d) return;
    const grid = document.getElementById('card-grid');
    grid.innerHTML = `<div class="update-time">世界设定档案</div>`;
    const items = [];

    if (d.world) {
      items.push(makeCard({ icon:'🌍', title:'世界观总览', badge:'世界', badgeClass:'badge-world',
        desc: (d.world.world_description||'').slice(0,80)+'…',
        stats:[{label:'规则',value:(d.world.world_rules||[]).length},{label:'地点',value:(d.world.locations||[]).length}],
        onClick: () => showWorldDetail() }));
      items.push(makeCard({ icon:'✨', title:'修炼体系', badge:'体系', badgeClass:'badge-world',
        desc: (d.world.magic_system||'').slice(0,80)+'…',
        stats:[], onClick: () => showMagicSystem() }));
      if ((d.world.world_rules||[]).length) {
        items.push(makeCard({ icon:'📜', title:'世界规则', badge:`${(d.world.world_rules||[]).length}条`, badgeClass:'badge-world',
          desc:'天地运行的根本法则', stats:[], onClick: () => showWorldRules() }));
      }
      if ((d.world.factions||[]).length) {
        items.push(makeCard({ icon:'⚔️', title:'势力格局', badge:`${(d.world.factions||[]).length}方`, badgeClass:'badge-char',
          desc:'各方势力与派系', stats:[], onClick: () => showFactions() }));
      }
      if ((d.world.locations||[]).length) {
        items.push(makeCard({ icon:'🗺️', title:'地点档案', badge:`${d.world.locations.length}处`, badgeClass:'badge-world',
          desc:'重要场景与地理', stats:[], onClick: () => showLocations() }));
      }
    }
    items.forEach(el => grid.appendChild(el));
  }

  function showWorldDetail() {
    if (currentBook?.book_id) Router.set(currentBook.book_id, 'setting', 'world');
    const w = currentBook?.world; if (!w) return;
    showDetail(`
      <h1>${escHtml(w.world_name||'世界观')}</h1>
      <p class="no-indent">${escHtml(w.world_description||'')}</p>
      ${w.genre?`<div class="meta-row"><span class="tag">🎭 ${escHtml(w.genre)}</span></div>`:''}
    `, '世界观总览', 'world');
  }
  function showMagicSystem() {
    const w = currentBook?.world; if (!w) return;
    showDetail(`<h1>修炼体系</h1><p>${escHtml(w.magic_system||'暂无')}</p>`, '修炼体系', 'world');
  }
  function showWorldRules() {
    const rules = currentBook?.world?.world_rules || [];
    showDetail(`
      <h1>世界规则</h1>
      ${rules.map(r => {
        if (typeof r === 'string') return `<div class="info-card"><p>• ${escHtml(r)}</p></div>`;
        return `<div class="info-card">
          <div class="info-card-title">${escHtml(r.name||r.rule_id||'')}</div>
          <p class="no-indent">${escHtml(r.description||'')}</p>
          ${r.is_hard_constraint?'<div class="tag" style="color:var(--red);border-color:var(--red)">⚠ 硬性约束</div>':''}
        </div>`;
      }).join('')}
    `, '世界规则', 'world');
  }
  function showFactions() {
    const factions = currentBook?.world?.factions||[];
    showDetail(`
      <h1>势力格局</h1>
      ${factions.map(f=>`<div class="info-card">
        <div class="info-card-title">${escHtml(f.name)}</div>
        <div class="meta-row">
          ${f.power_level?`<span class="tag">💪 战力 ${f.power_level}</span>`:''}
          ${f.alignment?`<span class="tag">${escHtml(f.alignment)}</span>`:''}
        </div>
        <p class="no-indent">${escHtml(f.description||'')}</p>
        ${f.internal_conflict?`<div class="fact-row"><span class="fact-label">内部矛盾</span><span class="fact-val">${escHtml(f.internal_conflict)}</span></div>`:''}
        ${f.leader_id?`<div class="fact-row"><span class="fact-label">首领ID</span><span class="fact-val">${escHtml(f.leader_id)}</span></div>`:''}
      </div>`).join('')}
    `, '势力格局', 'world');
  }
  function showLocations() {
    const locs = currentBook?.world?.locations||[];
    showDetail(`
      <h1>地点档案</h1>
      ${locs.length ? locs.map(l=>`<div class="info-card">
        <div class="info-card-title">${escHtml(l.name||l.location_id||'')}</div>
        <p class="no-indent">${escHtml(l.description||'')}</p>
      </div>`).join('') : '<div class="empty-state"><div class="empty-icon">🗺️</div><div class="empty-text">暂无地点数据</div></div>'}
    `, '地点档案', 'world');
  }

  // ===== 历史中心（timeline tab）=====
  function renderHistoryHub() {
    const d = currentBook; if (!d) return;
    const grid = document.getElementById('card-grid');
    grid.innerHTML = `<div class="update-time">历史大事记</div>`;
    const items = [
      { icon:'🌐', title:'时代分段',   badge:`${(d.eras||[]).length}个时代`,   badgeClass:'badge-history', desc:'各时代宏观走势与章节范围', fn: showEras,         arr: d.eras },
      { icon:'💥', title:'战场事件',   badge:`${(d.battle_milestones||[]).length}场战役`, badgeClass:'badge-history', desc:'关键战役、布阵策略、战果',fn: showBattles,      arr: d.battle_milestones },
      { icon:'🔀', title:'权力转移',   badge:`${(d.power_shifts||[]).length}次转移`,    badgeClass:'badge-history', desc:'势力格局变化与触发条件',  fn: showPowerShifts, arr: d.power_shifts },
      { icon:'☠️', title:'角色命运',   badge:`${(d.character_fates||[]).length}条命运`,  badgeClass:'badge-char',   desc:'各角色的宿命节点与结局',  fn: showCharFates,   arr: d.character_fates },
      { icon:'🗂', title:'历史节点',   badge:`${(d.history_nodes||[]).length}个节点`,    badgeClass:'badge-history', desc:'命运锚点与剧情锁定事件',  fn: showHistoryNodes,arr: d.history_nodes },
      { icon:'📖', title:'时间轴总览', badge:'全部',                                      badgeClass:'badge-history', desc:'所有历史事件时间线',      fn: showTimeline,    arr: d.timeline },
    ].filter(x => (x.arr||[]).length > 0);
    items.forEach(({ icon, title, badge, badgeClass, desc, fn }) =>
      grid.appendChild(makeCard({ icon, title, badge, badgeClass, desc, stats:[], onClick: fn })));
  }

  function showEras() {
    const eras = currentBook?.eras||[];
    showDetail(`
      <h1>时代分段</h1>
      ${eras.map(e=>`<div class="info-card">
        <div class="info-card-title">🌐 ${escHtml(e.name)}</div>
        ${e.chapter_range?`<div class="meta-row"><span class="tag">第${e.chapter_range[0]}~${e.chapter_range[1]}章</span></div>`:''}
        <p class="no-indent">${escHtml(e.macro_trend||'')}</p>
      </div>`).join('')}
    `, '时代分段', 'timeline');
  }

  function showBattles() {
    const bms = currentBook?.battle_milestones||[];
    showDetail(`
      <h1>战场事件</h1>
      ${bms.map(b=>`<div class="info-card">
        <div class="info-card-title">💥 ${escHtml(b.name)}</div>
        ${b.chapter_window?`<div class="meta-row"><span class="tag">第${b.chapter_window[0]}~${b.chapter_window[1]}章</span></div>`:''}
        ${(b.sides||[]).length?`<div class="fact-row"><span class="fact-label">双方</span><span class="fact-val">${b.sides.map(escHtml).join(' vs ')}</span></div>`:''}
        ${b.strategy_archetype?`<div class="fact-row"><span class="fact-label">策略</span><span class="fact-val">${escHtml(b.strategy_archetype)}</span></div>`:''}
        <div class="fact-row"><span class="fact-label">战果</span><span class="fact-val">${escHtml(b.outcome||'')}</span></div>
        ${b.aftermath?`<div class="fact-row"><span class="fact-label">余波</span><span class="fact-val">${escHtml(b.aftermath)}</span></div>`:''}
      </div>`).join('')}
    `, '战场事件', 'timeline');
  }

  function showPowerShifts() {
    const pss = currentBook?.power_shifts||[];
    showDetail(`
      <h1>权力转移</h1>
      ${pss.map(ps=>`<div class="info-card">
        <div class="info-card-title">🔀 ${escHtml(ps.name)}</div>
        ${ps.chapter_window?`<div class="meta-row"><span class="tag">第${ps.chapter_window[0]}~${ps.chapter_window[1]}章</span></div>`:''}
        ${(ps.trigger_conditions||[]).length?`<div class="fact-row"><span class="fact-label">触发条件</span><span class="fact-val">${ps.trigger_conditions.map(escHtml).join('；')}</span></div>`:''}
        <div class="fact-row"><span class="fact-label">结果</span><span class="fact-val">${escHtml(ps.outcome||'')}</span></div>
        ${ps.is_irrevocable?`<span class="tag" style="color:var(--red);border-color:var(--red)">⚠ 不可逆</span>`:''}
      </div>`).join('')}
    `, '权力转移', 'timeline');
  }

  function showCharFates() {
    const fates = currentBook?.character_fates||[];
    // 用 char_id 匹配角色名
    const charMap = {};
    (currentBook?.world?.characters||[]).forEach(c => charMap[c.char_id] = c.name);
    showDetail(`
      <h1>角色命运</h1>
      ${fates.map(f=>`<div class="info-card">
        <div class="info-card-title">☠️ ${escHtml(charMap[f.character_id]||f.character_id)}</div>
        <div class="meta-row">
          ${f.fate_type?`<span class="tag">${escHtml(f.fate_type)}</span>`:''}
          ${f.chapter_window?`<span class="tag">第${f.chapter_window[0]}~${f.chapter_window[1]}章</span>`:''}
          ${f.is_irrevocable?`<span class="tag" style="color:var(--red);border-color:var(--red)">不可逆</span>`:''}
        </div>
        ${f.trigger?`<div class="fact-row"><span class="fact-label">触发</span><span class="fact-val">${escHtml(f.trigger)}</span></div>`:''}
        <div class="fact-row"><span class="fact-label">结局</span><span class="fact-val">${escHtml(f.outcome||'')}</span></div>
        ${(f.foreshadow_hints||[]).length?`<div class="fact-row"><span class="fact-label">伏笔</span><span class="fact-val">${f.foreshadow_hints.map(escHtml).join('；')}</span></div>`:''}
      </div>`).join('')}
    `, '角色命运', 'timeline');
  }

  function showHistoryNodes() {
    const nodes = currentBook?.history_nodes||[];
    showDetail(`
      <h1>历史节点</h1>
      ${nodes.map(n=>`<div class="info-card">
        <div class="info-card-title">🗂 ${escHtml(n.name)}</div>
        <div class="meta-row">
          ${n.chapter_window?`<span class="tag">第${n.chapter_window[0]}~${n.chapter_window[1]}章</span>`:''}
          ${n.is_irrevocable?`<span class="tag" style="color:var(--red);border-color:var(--red)">锁定</span>`:''}
          ${n.assigned_character?`<span class="tag">👤 ${escHtml(n.assigned_character)}</span>`:''}
        </div>
        ${(n.invariants||[]).length?`<div class="fact-row"><span class="fact-label">不变量</span><span class="fact-val">${n.invariants.map(escHtml).join('；')}</span></div>`:''}
        ${(n.variables||[]).length?`<div class="fact-row"><span class="fact-label">可变量</span><span class="fact-val">${n.variables.map(escHtml).join('；')}</span></div>`:''}
        ${n.trigger_resolution?`<div class="fact-row"><span class="fact-label">触发解析</span><span class="fact-val">${escHtml(n.trigger_resolution)}</span></div>`:''}
      </div>`).join('')}
    `, '历史节点', 'timeline');
  }

  function showTimeline() {
    const tl = currentBook?.timeline||[];
    const typeIcon  = { era:'🌐', power_shift:'🔀', battle:'💥' };
    const typeColor = { era:'var(--accent)', power_shift:'var(--red)', battle:'var(--gold)' };
    const grid = document.getElementById('card-grid');
    grid.innerHTML = `<div class="update-time">时间轴 · ${tl.length} 个节点</div>`;
    const wrap = document.createElement('div'); wrap.className = 'timeline'; wrap.style.padding = '16px';
    grid.appendChild(wrap);
    _lazyList = new LazyList({
      container: wrap, items: tl, batch: 30, maxDom: 90,
      renderItem: (node, i) => {
        const col = typeColor[node.type]||'var(--accent)';
        const el = document.createElement('div'); el.className = 'tl-item';
        el.innerHTML = `
          <div class="tl-dot-col">
            <div class="tl-dot" style="background:${col};border-color:${col}"></div>
            <div class="tl-line"></div>
          </div>
          <div class="tl-body">
            <div class="tl-year">${typeIcon[node.type]||'⏳'} ${escHtml(node.year||`节点${i+1}`)}</div>
            <div class="tl-event">${escHtml(node.event||node.title||'')}</div>
            ${node.description?`<div class="tl-desc">${escHtml(node.description)}</div>`:''}
          </div>`;
        return el;
      }
    });
  }

  // ===== 蓝图/大纲页面 =====
  function renderPlanHub() {
    const d = currentBook; if (!d) return;
    const grid = document.getElementById('card-grid');
    grid.innerHTML = `<div class="update-time">写作规划</div>`;
    const items = [];

    // 大纲概览
    const outline = d.outline;
    if (outline) {
      items.push(makeCard({
        icon: '📐', title: '小说大纲', badge: '总纲',
        badgeClass: 'badge-history', desc: (outline.protagonist_arc||'').slice(0,80),
        onClick: () => showPlanOutline(outline)
      }));
    }

    // 各章蓝图
    const bps = d.blueprints || [];
    if (bps.length) {
      items.push(makeCard({
        icon: '🗺', title: '章节蓝图', badge: `${bps.length}章`,
        badgeClass: 'badge-history', desc: '各章的写作目标、谋略核心与风格选择',
        onClick: () => showBlueprintList(bps)
      }));
    }

    // 风格配置
    const usedStyles = new Set();
    bps.forEach(bp => (bp.styles||[]).forEach(s => usedStyles.add(s)));
    const allStyles = Array.from(usedStyles);
    if (allStyles.length) {
      const iconMap = {'base':'📄','combat_spectacle':'⚔️','confrontation_duel':'🤝','dub_flow':'😂','political_duel':'🎭','entrepreneur_mode':'💰','emotional_relief':'💔'};
      items.push(makeCard({
        icon: '🎨', title: '使用风格', badge: `${allStyles.length}种`,
        badgeClass: 'badge-history', desc: allStyles.map(s => `${iconMap[s]||'📌'} ${s}`).join('  '),
        onClick: () => showStyleOverview(bps)
      }));
    }

    if (!items.length) {
      grid.innerHTML += '<p style="padding:16px;color:var(--text-dim)">暂无大纲和蓝图数据</p>';
      return;
    }
    items.forEach(el => grid.appendChild(el));
  }

  function showPlanOutline(outline) {
    const html = `
      <h1>写作大纲</h1>
      ${outline.world_name?`<div class="fact-row"><span class="fact-label">世界</span><span class="fact-val">${escHtml(outline.world_name)}</span></div>`:''}
      ${outline.protagonist_arc?`<h2>主角弧线</h2><p>${escHtml(outline.protagonist_arc)}</p>`:''}
      ${outline.central_conflict?`<h2>核心冲突</h2><p>${escHtml(outline.central_conflict)}</p>`:''}
      ${outline.ending_vision?`<h2>结局构想</h2><p>${escHtml(outline.ending_vision)}</p>`:''}
      ${outline.global_mysteries?`<h2>核心悬念</h2><p>${escHtml(outline.global_mysteries)}</p>`:''}
      ${outline.theme?`<h2>主题</h2><p>${escHtml(outline.theme)}</p>`:''}
    `;
    showDetail(html, '小说大纲', 'plan');
  }

  function showBlueprintList(bps) {
    const sorted = [...bps].sort((a,b) => (a.chapter_number||0) - (b.chapter_number||0));
    const styleIcon = {'base':'','combat_spectacle':'⚔️','confrontation_duel':'🤝','dub_flow':'😂','political_duel':'🎭','entrepreneur_mode':'💰','emotional_relief':'💔'};
    showDetail(`
      <h1>章节蓝图</h1>
      ${sorted.map(bp => {
        const styles = (bp.styles||[]).map(s => styleIcon[s]||'📌').join(' ');
        const chType = {'main_pov':'主角明线','dark_line_a':'⚡暗线A','dark_line_b':'⚡暗线B','character_interlude':'配角插曲','side_arc':'支线','box_entry':'🚪箱庭·入场','box_discussion':'💬箱庭·讨论','box_twist':'🌀箱庭·反转'}[bp.chapter_type]||bp.chapter_type;
        return `<div class="info-card" onclick="showBlueprintDetail('${escHtml(bp.chapter_id)}')" style="cursor:pointer">
          <div class="info-card-title">第${bp.chapter_number}章 ${escHtml(bp.title||'')} ${styles}</div>
          <div class="meta-row">
            <span class="tag">${chType}</span>
            ${bp.pov_character?`<span class="tag">👁 ${escHtml(bp.pov_character)}</span>`:''}
            ${bp.word_count_target?`<span class="tag">${bp.word_count_target}字</span>`:''}
          </div>
          <p class="no-indent">${escHtml((bp.goal||'').slice(0,80))}</p>
          ${bp.strategy_core?`<div class="fact-row"><span class="fact-label">谋略</span><span class="fact-val">${escHtml(bp.strategy_core)}</span></div>`:''}
          ${bp.cost_this_chapter?`<div class="fact-row"><span class="fact-label">代价</span><span class="fact-val">${escHtml(bp.cost_this_chapter)}</span></div>`:''}
          ${bp.chapter_tension?`<div class="fact-row"><span class="fact-label">张力</span><span class="fact-val">${escHtml(bp.chapter_tension)}</span></div>`:''}
        </div>`;
      }).join('')}
    `, '章节蓝图', 'plan');
  }

  window.showBlueprintDetail = (chapterId) => {
    const bp = (currentBook?.blueprints||[]).find(b => b.chapter_id === chapterId);
    if (!bp) return showToast('蓝图未找到');
    const styleIcon = {'base':'📄base','combat_spectacle':'⚔️combat_spectacle','confrontation_duel':'🤝confrontation_duel','dub_flow':'😂dub_flow','political_duel':'🎭political_duel','entrepreneur_mode':'💰entrepreneur_mode','emotional_relief':'💔emotional_relief'};
    const styles = (bp.styles||[]).map(s => styleIcon[s]||s).join('  ');
    showDetail(`
      <h1>第${bp.chapter_number}章 · ${escHtml(bp.title||'')}</h1>
      <div class="meta-row">
        <span class="tag">${escHtml(bp.chapter_type||'main_pov')}</span>
        ${bp.pov_character?`<span class="tag">👁 ${escHtml(bp.pov_character)}</span>`:''}
        ${bp.location?`<span class="tag">📍 ${escHtml(bp.location)}</span>`:''}
        ${bp.word_count_target?`<span class="tag">${bp.word_count_target}字</span>`:''}
        ${bp.cycle_position?`<span class="tag">周期${bp.cycle_position}/5</span>`:''}
      </div>
      ${styles ? `<div class="meta-row">写作风格：${styles}</div>` : ''}
      ${bp.goal?`<h2>叙事目标</h2><p>${escHtml(bp.goal)}</p>`:''}
      ${bp.strategy_core?`<div class="fact-row"><span class="fact-label">谋略核心</span><span class="fact-val">${escHtml(bp.strategy_core)}</span></div>`:''}
      ${bp.cost_this_chapter?`<div class="fact-row"><span class="fact-label">本章代价</span><span class="fact-val">${escHtml(bp.cost_this_chapter)}</span></div>`:''}
      ${bp.conflict_to_advance?`<div class="fact-row"><span class="fact-label">推进冲突</span><span class="fact-val">${escHtml(bp.conflict_to_advance)}</span></div>`:''}
      <h2>游戏设计张力</h2>
      ${bp.reader_emotion_target?`<div class="fact-row"><span class="fact-label">读者情绪</span><span class="fact-val">${escHtml(bp.reader_emotion_target)}</span></div>`:''}
      ${bp.desire_and_obstacle?`<div class="fact-row"><span class="fact-label">欲望/阻碍</span><span class="fact-val">${escHtml(bp.desire_and_obstacle)}</span></div>`:''}
      ${bp.chapter_tension?`<div class="fact-row"><span class="fact-label">章节张力</span><span class="fact-val">${escHtml(bp.chapter_tension)}</span></div>`:''}
      ${bp.hook_strategy?`<div class="fact-row"><span class="fact-label">章尾截断</span><span class="fact-val">${escHtml(bp.hook_strategy)}</span></div>`:''}
      ${bp.foreshadow_hints?.length ? `<h2>伏笔提示</h2><ul>${bp.foreshadow_hints.map(h=>`<li>${escHtml(h)}</li>`).join('')}</ul>` : ''}
      ${bp.characters_required?.length ? `<h2>必需角色</h2><p>${bp.characters_required.map(escHtml).join('、')}</p>` : ''}
      ${bp.reaction_roles?.length ? `<h2>旁观脑补位</h2><p>${bp.reaction_roles.map(escHtml).join('；')}</p>` : ''}
      ${bp.relationship_targets?.length ? `<h2>关系变化目标</h2>${bp.relationship_targets.map(r=>`<div class="info-card" style="border-color:var(--accent)"><div class="fact-row"><span class="fact-label">${escHtml(r.character_a)}→${escHtml(r.character_b)}</span><span class="fact-val">${escHtml(r.direction)}</span></div>${(r.behavioral_indicators||[]).length?`<div>行为指标：${r.behavioral_indicators.map(escHtml).join('；')}</div>`:''}</div>`).join('')}` : ''}
      ${bp.information_wrapper?`<h2>信息量包裹</h2><p>${escHtml(bp.information_wrapper)}</p>`:''}
      ${(bp.story_direction||bp.information_points||bp.prose_direction||bp.plot_function||bp.core_interaction||bp.dialogue_ratio)?`
        <div class="separator"></div>
        <h2>进阶设计 (v4/v5)</h2>
        ${bp.story_direction?`<div class="fact-row"><span class="fact-label">故事走向</span><span class="fact-val">${escHtml(bp.story_direction)}</span></div>`:''}
        ${bp.information_points?`<div class="fact-row"><span class="fact-label">信息要点</span><span class="fact-val">${escHtml(bp.information_points)}</span></div>`:''}
        ${bp.prose_direction?`<div class="fact-row"><span class="fact-label">散文方向</span><span class="fact-val">${escHtml(bp.prose_direction)}</span></div>`:''}
        ${bp.plot_function?`<div class="fact-row"><span class="fact-label">剧情功能</span><span class="fact-val">${escHtml(bp.plot_function)}</span></div>`:''}
        ${bp.core_interaction?`<div class="fact-row"><span class="fact-label">核心交互</span><span class="fact-val">${escHtml(bp.core_interaction)}</span></div>`:''}
        ${bp.dialogue_ratio?`<div class="fact-row"><span class="fact-label">对话占比</span><span class="fact-val">${escHtml(bp.dialogue_ratio)}</span></div>`:''}
      `:''}
    `, `第${bp.chapter_number}章 蓝图`, 'plan');
  };

  function showStyleOverview(bps) {
    const styleIcon = {'base':'📄','combat_spectacle':'⚔️','confrontation_duel':'🤝','dub_flow':'😂','political_duel':'🎭','entrepreneur_mode':'💰','emotional_relief':'💔'};
    const styleNames = {'base':'通用基础','combat_spectacle':'战斗场面','confrontation_duel':'博弈对峙','dub_flow':'迪化流','political_duel':'政治权谋','entrepreneur_mode':'种田搞钱','emotional_relief':'命运抉择'};
    // 统计每个风格被多少章使用
    const usage = {};
    bps.forEach(bp => (bp.styles||[]).forEach(s => { if (!usage[s]) usage[s] = []; usage[s].push(bp.chapter_number); }));
    const sorted = Object.entries(usage).sort((a,b) => b[1].length - a[1].length);
    showDetail(`
      <h1>写作风格使用统计</h1>
      ${sorted.map(([style, chapters]) => `
        <div class="info-card">
          <div class="info-card-title">${styleIcon[style]||'📌'} ${styleNames[style]||style}</div>
          <div class="meta-row">
            <span class="tag">使用 ${chapters.length} 章</span>
          </div>
          <p class="no-indent">章节：第${chapters.sort((a,b)=>a-b).join('、')}章</p>
        </div>
      `).join('')}
    `, '写作风格', 'plan');
  }

  // ===== 箱庭/Box 中心 =====
  function renderBoxesHub() {
    const d = currentBook; if (!d) return;
    const grid = document.getElementById('card-grid');
    grid.innerHTML = `<div class="update-time">箱庭架构</div>`;
    const items = [];

    const boxes = d.boxes || [];
    if (boxes.length) {
      items.push(makeCard({
        icon: '🏠', title: '箱庭列表', badge: `${boxes.length}个箱庭`,
        badgeClass: 'badge-box', desc: '各箱庭的规则、参与者与脚本',
        onClick: () => showBoxList()
      }));
    }

    const truthMap = d.truth_map || [];
    if (truthMap.length) {
      items.push(makeCard({
        icon: '🗺', title: '真相地图', badge: `${truthMap.length}条信息`,
        badgeClass: 'badge-box', desc: '信息的锁定/解锁状态与阶段分布',
        onClick: () => showTruthMap()
      }));
    }

    const statuses = d.character_statuses || [];
    if (statuses.length) {
      const alive = statuses.filter(s => s.status === 'alive').length;
      const dormant = statuses.filter(s => s.status === 'dormant').length;
      const dead = statuses.filter(s => s.status === 'dead').length;
      items.push(makeCard({
        icon: '🩺', title: '角色状态', badge: `${statuses.length}人`,
        badgeClass: 'badge-char',
        desc: `🟢 活跃 ${alive} · 🟡 休眠 ${dormant} · 🔴 已故 ${dead}`,
        onClick: () => showCharacterStatuses()
      }));
    }

    const stages = d.stages || [];
    if (stages.length) {
      items.push(makeCard({
        icon: '🎭', title: '箱庭阶段', badge: `${stages.length}个阶段`,
        badgeClass: 'badge-stage', desc: '各阶段的目标、规则与解锁条件',
        onClick: () => showStages()
      }));
    }

    if (!items.length) {
      grid.innerHTML += '<p style="padding:16px;color:var(--text-dim)">暂无箱庭数据</p>';
      return;
    }
    items.forEach(el => grid.appendChild(el));
  }

  function showBoxList() {
    if (currentBook?.book_id) Router.set(currentBook.book_id, 'boxes');
    const boxes = currentBook?.boxes || [];
    if (!boxes.length) {
      showDetail('<p style="color:var(--text2)">暂无箱庭数据</p>', '箱庭列表', 'boxes');
      return;
    }
    const html = `
      <h1>箱庭列表</h1>
      ${boxes.map(box => {
        const rules = box.rules || [];
        const participants = box.participants || [];
        const scripts = box.scripts || [];
        return `
          <div class="box-card" id="box-${escHtml(box.box_id||'')}">
            <div class="box-card-header" onclick="this.parentElement.classList.toggle('expanded')">
              <span style="font-size:20px">🏠</span>
              <div style="flex:1">
                <div style="font-weight:600;color:var(--text)">${escHtml(box.name||box.box_id||'箱庭')}</div>
                ${box.theme?`<div style="font-size:12px;color:var(--text3);margin-top:2px">${escHtml(box.theme)}</div>`:''}
              </div>
              <div class="meta-row" style="margin:0;gap:4px">
                ${rules.length?`<span class="tag badge-box">${rules.length}条规则</span>`:''}
                ${participants.length?`<span class="tag badge-char">${participants.length}人</span>`:''}
                ${scripts.length?`<span class="tag badge-stage">${scripts.length}个脚本</span>`:''}
              </div>
              <span class="box-card-arrow">›</span>
            </div>
            <div class="box-card-body">
              <div class="box-card-inner">
                ${box.description?`<p class="no-indent" style="font-size:14px;margin-bottom:12px">${escHtml(box.description)}</p>`:''}
                ${rules.length?`
                  <h3 style="font-size:14px;color:var(--accent2);margin-bottom:8px">📜 规则</h3>
                  ${rules.map(r => typeof r === 'string'
                    ? `<div class="fact-row"><span class="fact-val">• ${escHtml(r)}</span></div>`
                    : `<div class="fact-row"><span class="fact-label">${escHtml(r.name||'规则')}</span><span class="fact-val">${escHtml(r.description||r.condition||'')}</span></div>`
                  ).join('')}
                `:''}
                ${participants.length?`
                  <h3 style="font-size:14px;color:var(--accent2);margin:12px 0 8px">👥 参与者</h3>
                  <div class="meta-row">${participants.map(p => {
                    const name = typeof p === 'string' ? p : (p.name||p.character_id||'?');
                    const role = typeof p === 'object' ? p.role : '';
                    return `<span class="tag">${escHtml(role?`${escHtml(name)} (${escHtml(role)})`:name)}</span>`;
                  }).join('')}</div>
                `:''}
                ${scripts.length?`
                  <h3 style="font-size:14px;color:var(--accent2);margin:12px 0 8px">🎬 脚本</h3>
                  ${scripts.map(s => typeof s === 'string'
                    ? `<div class="fact-row"><span class="fact-val">• ${escHtml(s)}</span></div>`
                    : `<div class="info-card" style="margin-bottom:6px">
                        <div style="font-weight:600;font-size:13px;color:var(--accent2)">${escHtml(s.name||s.script_id||'脚本')}</div>
                        ${s.description?`<p class="no-indent" style="font-size:13px;margin-top:4px">${escHtml(s.description)}</p>`:''}
                        ${s.trigger?`<div class="fact-row"><span class="fact-label">触发</span><span class="fact-val">${escHtml(s.trigger)}</span></div>`:''}
                      </div>`
                  ).join('')}
                `:''}
                ${box.unlock_condition?`<div class="fact-row" style="margin-top:8px"><span class="fact-label">解锁条件</span><span class="fact-val">${escHtml(box.unlock_condition)}</span></div>`:''}
              </div>
            </div>
          </div>`;
      }).join('')}
    `;
    showDetail(html, '箱庭列表', 'boxes');
  }

  window.showBoxDetail = (boxId) => {
    if (!boxId) return;
    const box = (currentBook?.boxes||[]).find(b => b.box_id === boxId);
    if (!box) return showToast('箱庭未找到');
    if (currentBook?.book_id) Router.set(currentBook.book_id, 'boxes', 'box_' + boxId);
    const rules = box.rules || [];
    const participants = box.participants || [];
    const scripts = box.scripts || [];
    showDetail(`
      <h1>🏠 ${escHtml(box.name||box.box_id)}</h1>
      ${box.theme?`<div class="meta-row"><span class="tag badge-box">${escHtml(box.theme)}</span></div>`:''}
      ${box.description?`<p class="no-indent">${escHtml(box.description)}</p>`:''}
      ${rules.length?`
        <h2>📜 规则 (${rules.length})</h2>
        ${rules.map(r => typeof r === 'string'
          ? `<div class="info-card"><p class="no-indent">• ${escHtml(r)}</p></div>`
          : `<div class="info-card">
              <div class="info-card-title">${escHtml(r.name||r.rule_id||'')}</div>
              <p class="no-indent">${escHtml(r.description||'')}</p>
              ${r.is_hard_constraint?'<span class="tag" style="color:var(--red);border-color:var(--red)">⚠ 硬性约束</span>':''}
            </div>`
        ).join('')}
      `:''}
      ${participants.length?`
        <h2>👥 参与者 (${participants.length})</h2>
        <div class="meta-row">${participants.map(p => {
          const name = typeof p === 'string' ? p : (p.name||p.character_id||'?');
          const role = typeof p === 'object' ? p.role : '';
          return `<span class="tag">${escHtml(role?`${name} (${role})`:name)}</span>`;
        }).join('')}</div>
      `:''}
      ${scripts.length?`
        <h2>🎬 脚本 (${scripts.length})</h2>
        ${scripts.map(s => typeof s === 'string'
          ? `<div class="info-card"><p class="no-indent">• ${escHtml(s)}</p></div>`
          : `<div class="info-card">
              <div class="info-card-title">${escHtml(s.name||s.script_id||'脚本')}</div>
              ${s.description?`<p class="no-indent">${escHtml(s.description)}</p>`:''}
              ${s.trigger?`<div class="fact-row"><span class="fact-label">触发条件</span><span class="fact-val">${escHtml(s.trigger)}</span></div>`:''}
              ${s.outcome?`<div class="fact-row"><span class="fact-label">预期结果</span><span class="fact-val">${escHtml(s.outcome)}</span></div>`:''}
            </div>`
        ).join('')}
      `:''}
      ${box.unlock_condition?`<h2>🔐 解锁条件</h2><p class="no-indent">${escHtml(box.unlock_condition)}</p>`:''}
      ${box.success_condition?`<h2>✅ 成功条件</h2><p class="no-indent">${escHtml(box.success_condition)}</p>`:''}
      ${box.failure_condition?`<h2>❌ 失败条件</h2><p class="no-indent">${escHtml(box.failure_condition)}</p>`:''}
    `, box.name || '箱庭详情', 'boxes');
  };

  function showTruthMap() {
    if (currentBook?.book_id) Router.set(currentBook.book_id, 'boxes', 'truth_map');
    const truthMap = currentBook?.truth_map || [];
    const stages = currentBook?.stages || [];
    const stageNames = stages.map(s => s.name || s.stage_id).filter(Boolean);

    const grid = document.getElementById('card-grid');
    grid.innerHTML = `<div class="update-time">真相地图 · ${truthMap.length} 条信息</div>`;

    // Stage filter bar
    const filterBar = document.createElement('div');
    filterBar.className = 'filter-bar';
    filterBar.style.padding = '8px 16px 0';
    const filterBtnAll = document.createElement('button');
    filterBtnAll.className = 'filter-btn active';
    filterBtnAll.textContent = '全部';
    filterBtnAll.onclick = () => filterTruthMap(null);
    filterBar.appendChild(filterBtnAll);
    stageNames.forEach(stage => {
      const btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.textContent = stage;
      btn.dataset.stage = stage;
      btn.onclick = () => filterTruthMap(stage);
      filterBar.appendChild(btn);
    });
    grid.appendChild(filterBar);

    // Truth items container
    const wrap = document.createElement('div');
    wrap.style.padding = '0 16px';
    wrap.id = 'truth-map-list';
    grid.appendChild(wrap);

    function renderTruthItems(filter) {
      wrap.innerHTML = '';
      const items = filter ? truthMap.filter(t => t.stage === filter) : truthMap;
      if (!items.length) {
        wrap.innerHTML = '<p style="color:var(--text3);text-align:center;padding:24px">无匹配信息</p>';
        return;
      }
      items.forEach(t => {
        const lockState = t.is_revealed === true ? 'unlocked' : t.is_revealed === false ? 'locked' : 'pending';
        const lockLabel = lockState === 'unlocked' ? '🔓 已揭示' : lockState === 'locked' ? '🔒 未揭示' : '⏳ 待定';
        const el = document.createElement('div');
        el.className = 'info-card';
        el.innerHTML = `
          <div style="display:flex;align-items:flex-start;gap:10px">
            <div class="truth-dot ${lockState}" style="margin-top:4px"></div>
            <div style="flex:1">
              <div style="font-weight:600;color:var(--text);font-size:14px">${escHtml(t.title||t.information_id||'真相')}</div>
              ${t.description?`<p class="no-indent" style="font-size:13px;margin-top:4px">${escHtml(t.description)}</p>`:''}
              <div class="meta-row" style="margin-top:6px">
                ${t.stage?`<span class="tag badge-stage">${escHtml(t.stage)}</span>`:''}
                <span class="lock-badge ${lockState}">${lockLabel}</span>
                ${t.holder?`<span class="tag">持有: ${escHtml(t.holder)}</span>`:''}
                ${t.reveal_chapter?`<span class="tag">揭示: 第${t.reveal_chapter}章</span>`:''}
              </div>
            </div>
          </div>`;
        wrap.appendChild(el);
      });
    }

    window.filterTruthMap = (stage) => {
      filterBar.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', stage ? b.dataset.stage === stage : !b.dataset.stage));
      renderTruthItems(stage);
    };

    renderTruthItems(null);
  }

  function showCharacterStatuses() {
    if (currentBook?.book_id) Router.set(currentBook.book_id, 'boxes', 'statuses');
    const statuses = currentBook?.character_statuses || [];
    if (!statuses.length) {
      showDetail('<p style="color:var(--text2)">暂无角色状态数据</p>', '角色状态', 'boxes');
      return;
    }
    // Group by status
    const grouped = { alive: [], dormant: [], dead: [], unknown: [] };
    statuses.forEach(s => {
      const st = s.status || 'unknown';
      if (grouped[st]) grouped[st].push(s);
      else grouped.unknown.push(s);
    });
    const statusMeta = {
      alive:   { icon: '🟢', label: '活跃', cssClass: 'status-alive' },
      dormant: { icon: '🟡', label: '休眠', cssClass: 'status-dormant' },
      dead:    { icon: '🔴', label: '已故', cssClass: 'status-dead' },
      unknown: { icon: '⚪', label: '未知', cssClass: '' },
    };
    let html = '<h1>角色状态</h1>';
    for (const [status, list] of Object.entries(grouped)) {
      if (!list.length) continue;
      const meta = statusMeta[status];
      html += `<h2>${meta.icon} ${meta.label} (${list.length})</h2>`;
      html += list.map(s => `
        <div class="info-card">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="tag ${meta.cssClass}" style="font-size:11px">${meta.label}</span>
            <span style="font-weight:600;color:var(--text)">${escHtml(s.name||s.character_id||'?')}</span>
          </div>
          ${s.reason?`<p class="no-indent" style="font-size:13px;margin-top:6px">${escHtml(s.reason)}</p>`:''}
          ${s.since_chapter?`<div class="fact-row"><span class="fact-label">起始章节</span><span class="fact-val">第${s.since_chapter}章</span></div>`:''}
          ${s.location?`<div class="fact-row"><span class="fact-label">当前位置</span><span class="fact-val">${escHtml(s.location)}</span></div>`:''}
        </div>
      `).join('');
    }
    showDetail(html, '角色状态', 'boxes');
  }

  function showStages() {
    const stages = currentBook?.stages || [];
    if (!stages.length) {
      showDetail('<p style="color:var(--text2)">暂无阶段数据</p>', '箱庭阶段', 'boxes');
      return;
    }
    showDetail(`
      <h1>箱庭阶段</h1>
      ${stages.map(s => `
        <div class="info-card">
          <div class="info-card-title">🎭 ${escHtml(s.name||s.stage_id||'阶段')}</div>
          ${s.chapter_range?`<div class="meta-row"><span class="tag badge-stage">第${s.chapter_range[0]}~${s.chapter_range[1]}章</span></div>`:''}
          ${s.description?`<p class="no-indent">${escHtml(s.description)}</p>`:''}
          ${s.goal?`<div class="fact-row"><span class="fact-label">目标</span><span class="fact-val">${escHtml(s.goal)}</span></div>`:''}
          ${s.rules?`<div class="fact-row"><span class="fact-label">规则</span><span class="fact-val">${escHtml(typeof s.rules === 'string' ? s.rules : (s.rules||[]).join('；'))}</span></div>`:''}
          ${s.unlock_condition?`<div class="fact-row"><span class="fact-label">解锁条件</span><span class="fact-val">${escHtml(s.unlock_condition)}</span></div>`:''}
        </div>
      `).join('')}
    `, '箱庭阶段', 'boxes');
  }

  // ===== 角色列表（LazyList）=====
  function renderCharList() {
    const chars = currentBook?.world?.characters||[];
    const grid = document.getElementById('card-grid');
    grid.innerHTML = `<div class="update-time">共 ${chars.length} 位角色</div>`;
    if (!chars.length) return;
    const wrap = document.createElement('div'); grid.appendChild(wrap);
    _lazyList = new LazyList({
      container: wrap, items: chars, batch: 20, maxDom: 60,
      renderItem: c => makeCard({
        icon: roleIcon(c.role_type), title: c.name,
        badge: roleLabel(c.role_type), badgeClass: 'badge-char',
        desc: (c.background||c.description||'').slice(0,80),
        stats: [{ label: '阵营', value: c.faction||'未知' }, { label: '境界', value: c.power_level||'?' }],
        onClick: () => showCharDetail(c)
      })
    });
  }

  function showCharDetail(c) {
    if (currentBook?.book_id) Router.set(currentBook.book_id, 'characters', c.name || c.character_id);
    const sym = c.symbol||{};
    // 找该角色的命运
    const fate = (currentBook?.character_fates||[]).find(f => f.character_id === c.char_id);
    showDetail(`
      <h1>${escHtml(c.name)}</h1>
      <div class="meta-row">
        <span class="tag">${escHtml(roleLabel(c.role_type))}</span>
        ${c.faction?`<span class="tag">${escHtml(c.faction)}</span>`:''}
        ${c.power_level?`<span class="tag">${escHtml(c.power_level)}</span>`:''}
      </div>
      ${c.background||c.description?`<p>${escHtml(c.background||c.description)}</p>`:''}
      ${(c.personality_tags||[]).length?`
        <h2>性格标签</h2>
        <div class="meta-row">${c.personality_tags.map(t=>`<span class="tag">${escHtml(t)}</span>`).join('')}</div>`:''}
      ${(c.capabilities||[]).length?`
        <h2>核心能力</h2>
        <div class="meta-row">${c.capabilities.map(cap=>`<span class="tag">⚡ ${escHtml(cap)}</span>`).join('')}</div>`:''}
      ${Object.keys(sym).length?`
        <h2>角色符号体系</h2>
        <div class="info-card">
          ${(sym.visual_markers||[]).length?`<div class="fact-row"><span class="fact-label">视觉锚点</span><span class="fact-val">${sym.visual_markers.map(escHtml).join('；')}</span></div>`:''}
          ${sym.speech_pattern?`<div class="fact-row"><span class="fact-label">口头禅</span><span class="fact-val">${escHtml(sym.speech_pattern)}</span></div>`:''}
          ${(sym.behavioral_tics||[]).length?`<div class="fact-row"><span class="fact-label">标志行为</span><span class="fact-val">${sym.behavioral_tics.map(escHtml).join('；')}</span></div>`:''}
          ${sym.core_contradiction?`<div class="fact-row"><span class="fact-label">内在矛盾</span><span class="fact-val">${escHtml(sym.core_contradiction)}</span></div>`:''}
          ${sym.arc_direction?`<div class="fact-row"><span class="fact-label">人物弧线</span><span class="fact-val">${escHtml(sym.arc_direction)}</span></div>`:''}
          ${sym.personal_imagery?`<div class="fact-row"><span class="fact-label">专属意象</span><span class="fact-val">${escHtml(sym.personal_imagery)}</span></div>`:''}
        </div>`:''}
      ${fate?`
        <h2>命运节点</h2>
        <div class="info-card" style="border-color:var(--red)">
          <div class="meta-row">
            ${fate.fate_type?`<span class="tag" style="color:var(--red)">${escHtml(fate.fate_type)}</span>`:''}
            ${fate.chapter_window?`<span class="tag">第${fate.chapter_window[0]}~${fate.chapter_window[1]}章</span>`:''}
            ${fate.is_irrevocable?`<span class="tag" style="color:var(--red);border-color:var(--red)">⚠ 不可逆</span>`:''}
          </div>
          ${fate.trigger?`<div class="fact-row"><span class="fact-label">触发条件</span><span class="fact-val">${escHtml(fate.trigger)}</span></div>`:''}
          <div class="fact-row"><span class="fact-label">最终结局</span><span class="fact-val">${escHtml(fate.outcome||'')}</span></div>
          ${(fate.foreshadow_hints||[]).length?`<div class="fact-row"><span class="fact-label">伏笔提示</span><span class="fact-val">${fate.foreshadow_hints.map(escHtml).join('；')}</span></div>`:''}
        </div>`:''}
    `, c.name, 'characters');
  }

  // ===== 通用卡片 =====
  function makeCard({ icon, title, badge, badgeClass, desc, stats, onClick }) {
    const el = document.createElement('div'); el.className = 'card';
    el.innerHTML = `
      <div class="card-header">
        <span class="card-icon">${icon}</span>
        <div class="card-meta">
          <div class="card-title">${escHtml(title)}</div>
          <span class="card-badge ${badgeClass}">${badge}</span>
        </div>
      </div>
      <div class="card-desc">${escHtml(desc)}</div>
      ${stats&&stats.length?`<div class="card-stats">${stats.map(s=>`<div class="stat">${s.label} <span>${s.value}</span></div>`).join('')}</div>`:''}
    `;
    if (onClick) {
      el.addEventListener('click', onClick);
      // 触摸检测：短触（<200ms）才算点击，长按/滑动不算
      let _touchStartTime = 0;
      el.addEventListener('touchstart', () => {
        _touchStartTime = Date.now();
      }, { passive: true });
      el.addEventListener('touchend', (e) => {
        if (Date.now() - _touchStartTime > 200) return;
        e.preventDefault();
        onClick(e);
      }, { passive: false });
    }
    return el;
  }

  window.showToast = (msg) => {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div'); el.id = 'toast';
      el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 18px;border-radius:99px;font-size:13px;z-index:999;pointer-events:none;transition:opacity .3s';
      document.body.appendChild(el);
    }
    el.textContent = msg; el.style.opacity = '1';
    clearTimeout(el._t); el._t = setTimeout(() => el.style.opacity = '0', 2000);
  };

  function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmtNum(n)  { return n >= 10000 ? (n/10000).toFixed(1)+'万' : n.toString(); }
  function mdToHtml(md) {
    const lines = md.split('\n'); let html = '', inP = false;
    lines.forEach(line => {
      if      (line.startsWith('# '))   { if(inP){html+='</p>';inP=false;} html+=`<h1>${escHtml(line.slice(2))}</h1>`; }
      else if (line.startsWith('## '))  { if(inP){html+='</p>';inP=false;} html+=`<h2>${escHtml(line.slice(3))}</h2>`; }
      else if (line.startsWith('### ')) { if(inP){html+='</p>';inP=false;} html+=`<h3>${escHtml(line.slice(4))}</h3>`; }
      else if (line.trim()==='')        { if(inP){html+='</p>';inP=false;} }
      else { if(!inP){html+='<p>';inP=true;} else html+='<br>'; html+=escHtml(line); }
    });
    if(inP) html+='</p>'; return html;
  }
  function roleIcon(t)  { return {protagonist:'🦸',antagonist:'🦹',supporting:'👤',neutral:'🧩'}[t]||'👤'; }
  function roleLabel(t) { return {protagonist:'主角',antagonist:'反派',supporting:'配角',neutral:'中立'}[t]||'角色'; }
})();
