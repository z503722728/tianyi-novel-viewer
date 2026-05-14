/**
 * 天意小说阅读器 · 应用逻辑 v2
 * 新增：多书书架、密钥 LocalStorage 持久化
 */
(() => {
  'use strict';

  // ===== 全局状态 =====
  let currentBook   = null;   // 当前打开的书数据
  let currentTab    = 'home';
  let backTarget    = null;   // 返回键目标：'home' | 'bookshelf'

  // ===== 启动：自动尝试已保存密钥 =====
  window.addEventListener('DOMContentLoaded', async () => {
    // Enter 键始终注册
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
    // 密钥失效，清除并恢复解锁按钮
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

    // 记住密钥
    if (document.getElementById('remember-key').checked) {
      await TianYiCrypto.saveKey(pwd);
    }

    document.getElementById('unlock-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');
    await enterBookshelf();
  };

  // ===== 清除密钥 =====
  window.clearSavedKey = () => {
    TianYiCrypto.clearKey();
    showToast('已清除本地密钥');
  };

  // ===== 锁屏 =====
  window.lockScreen = () => {
    window._sessionKey = null;
    currentBook = null;
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
    document.getElementById('bottom-nav').style.display = 'none';
    document.getElementById('current-title').textContent = '天意 · 书架';
    showView('bookshelf-view');

    const sub  = document.getElementById('bookshelf-sub');
    const grid = document.getElementById('book-grid');
    sub.textContent  = '加载中...';
    grid.innerHTML   = '<div class="loading"><div class="spinner"></div></div>';

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
    showView('home-view');
    document.getElementById('card-grid').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    document.getElementById('book-hero-title').textContent = meta.world_name || meta.book_id;
    document.getElementById('book-hero-sub').textContent   = '加载中...';
    document.getElementById('current-title').textContent   = meta.world_name || '读书';
    document.getElementById('bottom-nav').style.display    = 'flex';

    try {
      // book_id 可能含中文，必须 encodeURIComponent
      const encPath = `data/${encodeURIComponent(meta.book_id)}/index.enc`;
      const data = await TianYiCrypto.fetchDecrypted(encPath, window._sessionKey);
      currentBook = data;
      renderBookHome();
    } catch (e) {
      document.getElementById('card-grid').innerHTML =
        `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">加载失败: ${e.message}</div></div>`;
    }
  }

  // ===== 书内首页 =====
  function renderBookHome() {
    if (!currentBook) return;
    const d = currentBook;
    document.getElementById('book-hero-sub').textContent =
      `${(d.chapters||[]).length} 章 · ${fmtNum((d.chapters||[]).reduce((s,c)=>s+(c.word_count||0),0))} 字 · ${d.updated_at||''}`;
    document.getElementById('current-title').textContent = d.world_name || '未知世界';
    currentTab = 'home';
    updateNavActive('home');

    const grid = document.getElementById('card-grid');
    grid.innerHTML = '';

    // 世界观
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

    // 最近章节（最新3章）
    const lastChaps = [...(d.chapters||[])].reverse().slice(0, 3);
    lastChaps.forEach(ch => grid.appendChild(makeChapterCard(ch)));

    // 时间轴
    if ((d.timeline||[]).length) {
      grid.appendChild(makeCard({
        icon: '⏳', title: '历史时间轴',
        badge: '历史', badgeClass: 'badge-history',
        desc: `${d.timeline.length} 个历史节点`,
        stats: [{ label: '节点', value: d.timeline.length }],
        onClick: () => switchNav('timeline')
      }));
    }

    // 角色
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

  // ===== 侧边栏 =====
  function buildSidebar() {
    const nav  = document.getElementById('sidebar-nav');
    nav.innerHTML = '';
    if (!currentBook) return;

    const sections = [
      {
        title: '章节',
        items: (currentBook.chapters||[]).map(ch => ({
          icon: ch.chapter_type === 'dark_line_a' ? '⚡' : ch.chapter_type === 'dark_line_b' ? '⚡' : '📄',
          label: ch.title || `第${ch.chapter_num}章`,
          onClick: () => { showChapterDetail(ch); hideSidebar(); }
        }))
      },
      {
        title: '世界设定',
        items: [
          { icon: '🌍', label: '世界观', onClick: () => { showWorldDetail(); hideSidebar(); } },
          { icon: '⚔️', label: '势力格局', onClick: () => { showFactions(); hideSidebar(); } },
        ]
      },
      {
        title: '角色',
        items: (currentBook.world?.characters||[]).map(c => ({
          icon: roleIcon(c.role_type), label: c.name,
          onClick: () => { showCharDetail(c); hideSidebar(); }
        }))
      },
    ];

    // 书架入口
    const bookshelfSec = document.createElement('div');
    bookshelfSec.className = 'nav-section';
    bookshelfSec.innerHTML = `<div class="nav-section-title">导航</div>`;
    const bsBtn = document.createElement('button');
    bsBtn.className = 'nav-link';
    bsBtn.innerHTML = `<span class="nav-icon">📚</span>切换书籍`;
    bsBtn.onclick = () => { enterBookshelf(); hideSidebar(); };
    bookshelfSec.appendChild(bsBtn);
    nav.appendChild(bookshelfSec);

    sections.forEach(sec => {
      if (!sec.items.length) return;
      const div = document.createElement('div');
      div.className = 'nav-section';
      div.innerHTML = `<div class="nav-section-title">${sec.title}</div>`;
      sec.items.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'nav-link';
        btn.innerHTML = `<span class="nav-icon">${item.icon}</span>${escHtml(item.label)}`;
        btn.onclick = item.onClick;
        div.appendChild(btn);
      });
      nav.appendChild(div);
    });
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
    backTarget = back;
    document.getElementById('current-title').textContent = title || '详情';
    document.getElementById('back-btn').textContent = back === 'bookshelf' ? '← 书架' : '← 返回';
    document.getElementById('detail-content').innerHTML = html;
    showView('detail-view');
  }

  window.handleBack = () => {
    if (backTarget === 'bookshelf') { enterBookshelf(); }
    else {
      showView('home-view');
      document.getElementById('current-title').textContent = currentBook?.world_name || '天意';
    }
  };

  // ===== 章节 =====
  function renderChapterList() {
    const chs  = currentBook?.chapters || [];
    const grid = document.getElementById('card-grid');
    grid.innerHTML = `<div class="update-time">共 ${chs.length} 章</div>`;
    chs.forEach(ch => grid.appendChild(makeChapterCard(ch)));
  }

  function makeChapterCard(ch) {
    return makeCard({
      icon: ch.chapter_type === 'dark_line_a' ? '⚡' : ch.chapter_type === 'dark_line_b' ? '⚡' : '📖',
      title: ch.title || `第${ch.chapter_num}章`,
      badge: ch.chapter_type === 'dark_line_a' ? '暗线A' : ch.chapter_type === 'dark_line_b' ? '暗线B' : '正线',
      badgeClass: 'badge-chapter',
      desc: ch.summary || '',
      stats: [
        { label: '字数', value: fmtNum(ch.word_count||0) },
        { label: '视角', value: ch.pov_character || '主角' },
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
      ${(w.world_rules||[]).length?`<h2>世界规则</h2>${(w.world_rules).map(r=>{
        if(typeof r==='string') return `<p>• ${escHtml(r)}</p>`;
        return `<div class="char-card" style="margin-bottom:10px">
          <div style="font-size:14px;font-weight:600;color:var(--accent2);margin-bottom:4px">${escHtml(r.name||r.rule_id||'')}</div>
          <div style="font-size:13px;color:var(--text2)">${escHtml(r.description||'')}</div>
          ${r.is_hard_constraint?'<div style="font-size:11px;color:var(--red);margin-top:4px">⚠ 硬性约束</div>':''}
        </div>`;
      }).join('')}`:''}
      ${(w.factions||[]).length?`<h2>主要势力</h2>${w.factions.map(f=>`
        <div class="char-card">
          <div class="char-name">${escHtml(f.name)}</div>
          <div class="char-role">${escHtml(f.type||'')} · ${escHtml(f.alignment||'')}</div>
          <p class="no-indent" style="font-size:13px;color:var(--text2);margin-top:6px">${escHtml(f.description||'')}</p>
          ${f.internal_conflict?`<div class="char-symbol-item" style="margin-top:8px"><span class="sym-label" style="color:var(--red)">内部矛盾</span><span class="sym-value">${escHtml(f.internal_conflict)}</span></div>`:''}
        </div>`).join('')}`:''}
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

  // ===== 角色 =====
  function renderCharList() {
    const chars = currentBook?.world?.characters||[];
    const grid  = document.getElementById('card-grid');
    grid.innerHTML = `<div class="update-time">共 ${chars.length} 位角色</div>`;
    chars.forEach(c => grid.appendChild(makeCard({
      icon: roleIcon(c.role_type), title: c.name,
      badge: roleLabel(c.role_type), badgeClass: 'badge-char',
      desc: (c.background||c.description||'').slice(0,80),
      stats: [
        { label: '阵营', value: c.faction||'未知' },
        { label: '境界', value: c.power_level||'?' },
      ],
      onClick: () => showCharDetail(c)
    })));
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

  // ===== 时间轴 =====
  function renderTimeline() {
    const tl   = currentBook?.timeline||[];
    const grid = document.getElementById('card-grid');
    if (!tl.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div><div class="empty-text">暂无历史记录</div></div>`;
      return;
    }
    const typeIcon  = { era:'🌐', power_shift:'⚔️', battle:'💥' };
    const typeColor = { era:'var(--accent)', power_shift:'var(--red)', battle:'var(--gold)' };
    let html = `<div class="update-time">共 ${tl.length} 个节点</div><div class="timeline" style="padding:16px">`;
    tl.forEach((node, i) => {
      const col  = typeColor[node.type]||'var(--accent)';
      const icon = typeIcon[node.type]||'⏳';
      html += `
        <div class="tl-item">
          <div class="tl-dot-col">
            <div class="tl-dot" style="background:${col};border-color:${col}"></div>
            ${i<tl.length-1?'<div class="tl-line"></div>':''}
          </div>
          <div class="tl-body">
            <div class="tl-year">${icon} ${escHtml(node.year||`节点${i+1}`)}</div>
            <div class="tl-event">${escHtml(node.event||node.title||'')}</div>
            ${node.description?`<div class="tl-desc">${escHtml(node.description)}</div>`:''}
          </div>
        </div>`;
    });
    grid.innerHTML = html + '</div>';
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
      if      (line.startsWith('# '))  { if(inP){html+='</p>';inP=false;} html+=`<h1>${escHtml(line.slice(2))}</h1>`; }
      else if (line.startsWith('## ')) { if(inP){html+='</p>';inP=false;} html+=`<h2>${escHtml(line.slice(3))}</h2>`; }
      else if (line.startsWith('### ')){ if(inP){html+='</p>';inP=false;} html+=`<h3>${escHtml(line.slice(4))}</h3>`; }
      else if (line.trim()==='')       { if(inP){html+='</p>';inP=false;} }
      else { if(!inP){html+='<p>';inP=true;} else html+='<br>'; html+=escHtml(line); }
    });
    if(inP) html+='</p>';
    return html;
  }
  function roleIcon(t) { return {protagonist:'🦸',antagonist:'🦹',supporting:'👤',neutral:'🧩'}[t]||'👤'; }
  function roleLabel(t){ return {protagonist:'主角',antagonist:'反派',supporting:'配角',neutral:'中立'}[t]||'角色'; }
})();
