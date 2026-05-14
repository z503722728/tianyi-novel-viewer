/**
 * 天意小说阅读器 · 主应用逻辑
 */
(() => {
  'use strict';

  // ===== 状态 =====
  let currentTab = 'home';
  let novelData  = null; // 解密后的全量数据
  let chapters   = [];
  let worldData  = null;
  let timeline   = [];

  // ===== 解锁 =====
  window.togglePwd = () => {
    const inp = document.getElementById('password-input');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  };

  window.unlock = async () => {
    const pwd = document.getElementById('password-input').value.trim();
    if (!pwd) return;
    const btn = document.querySelector('.btn-primary');
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
    btn.textContent = '加载数据...';
    await loadAllData();
    document.getElementById('unlock-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');
    renderHome();
  };

  document.getElementById('password-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') window.unlock();
  });

  // ===== 加载数据 =====
  async function loadAllData() {
    try {
      const index = await TianYiCrypto.fetchDecrypted('data/index.enc', window._sessionKey);
      novelData = index;
      chapters  = index.chapters  || [];
      worldData = index.world     || null;
      timeline  = index.timeline  || [];
    } catch (e) {
      console.error('loadAllData error', e);
    }
  }

  // ===== 渲染首页 =====
  function renderHome() {
    if (!novelData) return;
    const hero = document.querySelector('.hero-sub');
    hero.textContent = `已加载 · 最后更新 ${novelData.updated_at || '未知'}`;
    document.getElementById('current-title').textContent = novelData.world_name || '天意创作档案';

    const grid = document.getElementById('card-grid');
    grid.innerHTML = '';

    // 世界观卡片
    if (worldData) {
      grid.appendChild(makeCard({
        icon: '🌍', title: worldData.world_name || '世界观设定',
        badge: '世界', badgeClass: 'badge-world',
        desc: worldData.world_description?.slice(0, 80) + '…' || '',
        stats: [
          { label: '角色', value: (worldData.characters||[]).length },
          { label: '势力', value: (worldData.factions||[]).length },
        ],
        onClick: () => showWorldDetail()
      }));
    }

    // 章节卡片（最近3章）
    const lastChaps = [...chapters].reverse().slice(0, 3);
    lastChaps.forEach(ch => {
      grid.appendChild(makeCard({
        icon: '📖', title: ch.title || `第${ch.chapter_id}章`,
        badge: '章节', badgeClass: 'badge-chapter',
        desc: (ch.summary || ch.content?.slice(0, 80) || '') + '…',
        stats: [
          { label: '字数', value: ch.word_count || ch.content?.length || '?' },
          { label: '视角', value: ch.pov_character || '主角' },
        ],
        onClick: () => showChapterDetail(ch)
      }));
    });

    // 时间轴卡片
    if (timeline.length) {
      grid.appendChild(makeCard({
        icon: '⏳', title: '历史时间轴',
        badge: '历史', badgeClass: 'badge-history',
        desc: `${timeline.length} 个历史节点`,
        stats: [{ label: '节点', value: timeline.length }],
        onClick: () => switchNav('timeline')
      }));
    }

    // 角色卡片
    if (worldData?.characters?.length) {
      grid.appendChild(makeCard({
        icon: '👥', title: '角色档案',
        badge: '角色', badgeClass: 'badge-char',
        desc: `${worldData.characters.length} 位角色`,
        stats: [{ label: '已收录', value: worldData.characters.length }],
        onClick: () => switchNav('characters')
      }));
    }

    buildSidebar();
  }

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
      ${stats ? `<div class="card-stats">${stats.map(s => `<div class="stat">${s.label} <span>${s.value}</span></div>`).join('')}</div>` : ''}
    `;
    el.onclick = onClick;
    return el;
  }

  // ===== 侧边栏 =====
  function buildSidebar() {
    const nav = document.getElementById('sidebar-nav');
    nav.innerHTML = '';

    const sections = [
      { title: '章节', items: chapters.map((ch, i) => ({
          icon: '📄', label: ch.title || `第${i+1}章`,
          onClick: () => { showChapterDetail(ch); hideSidebar(); }
        }))
      },
      { title: '世界设定', items: [
          { icon: '🌍', label: '世界观', onClick: () => { showWorldDetail(); hideSidebar(); } },
          { icon: '⚔️', label: '势力格局', onClick: () => { showFactions(); hideSidebar(); } },
        ]
      },
      { title: '角色', items: (worldData?.characters||[]).map(ch => ({
          icon: roleIcon(ch.role_type), label: ch.name,
          onClick: () => { showCharDetail(ch); hideSidebar(); }
        }))
      },
    ];

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
    currentTab = tab;
    document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
    goHome();
    if (tab === 'home') return renderHome();
    if (tab === 'chapters') return renderChapterList();
    if (tab === 'world') return showWorldDetail();
    if (tab === 'characters') return renderCharList();
    if (tab === 'timeline') return renderTimeline();
  };

  // ===== 详情视图切换 =====
  window.goHome = () => {
    document.getElementById('home-view').classList.add('active');
    document.getElementById('detail-view').classList.remove('active');
  };

  function showDetail(html, title) {
    document.getElementById('current-title').textContent = title || '天意档案';
    document.getElementById('home-view').classList.remove('active');
    document.getElementById('detail-view').classList.add('active');
    const dc = document.getElementById('detail-content');
    dc.innerHTML = html;
    dc.scrollTop = 0;
    // 阅读进度
    document.querySelector('.content-area').scrollTop = 0;
  }

  // ===== 章节 =====
  function renderChapterList() {
    const grid = document.getElementById('card-grid');
    grid.innerHTML = `<div class="update-time">共 ${chapters.length} 章</div>`;
    chapters.forEach(ch => {
      grid.appendChild(makeCard({
        icon: '📖', title: ch.title || `第${ch.chapter_id}章`,
        badge: ch.chapter_type === 'dark_line_a' ? '暗线A' : ch.chapter_type === 'dark_line_b' ? '暗线B' : '正线',
        badgeClass: 'badge-chapter',
        desc: ch.summary || '',
        stats: [
          { label: '字数', value: ch.word_count || '?' },
          { label: '视角', value: ch.pov_character || '主角' },
        ],
        onClick: () => showChapterDetail(ch)
      }));
    });
  }

  function showChapterDetail(ch) {
    const content = ch.content || '';
    const html = `
      <h1>${escHtml(ch.title || '章节')}</h1>
      <div class="meta-row">
        <span class="tag">${ch.chapter_type === 'dark_line_a' ? '⚡ 暗线A' : ch.chapter_type === 'dark_line_b' ? '⚡ 暗线B' : '🎬 正线'}</span>
        <span class="tag">👁 ${escHtml(ch.pov_character || '主角')}</span>
        ${ch.word_count ? `<span class="tag">${ch.word_count} 字</span>` : ''}
      </div>
      ${ch.strategy_core ? `<blockquote>♟ ${escHtml(ch.strategy_core)}</blockquote>` : ''}
      ${ch.cost_this_chapter ? `<blockquote>💔 ${escHtml(ch.cost_this_chapter)}</blockquote>` : ''}
      <div class="separator"></div>
      ${markdownToHtml(content)}
    `;
    showDetail(html, ch.title);
  }

  // ===== 世界观 =====
  function showWorldDetail() {
    if (!worldData) return;
    const w = worldData;
    const html = `
      <h1>${escHtml(w.world_name || '世界观')}</h1>
      <p class="no-indent">${escHtml(w.world_description || '')}</p>
      ${w.magic_system ? `<h2>修炼体系</h2><p>${escHtml(w.magic_system)}</p>` : ''}
      ${w.world_rules?.length ? `<h2>世界规则</h2>${w.world_rules.map(r => {
        if (typeof r === 'string') return `<p>• ${escHtml(r)}</p>`;
        const name = r.name || r.rule_id || '';
        const desc = r.description || '';
        return `<div class="char-card" style="margin-bottom:10px">
          <div style="font-size:14px;font-weight:600;color:var(--accent2);margin-bottom:4px">${escHtml(name)}</div>
          <div style="font-size:13px;color:var(--text2)">${escHtml(desc)}</div>
          ${r.is_hard_constraint ? '<div style="font-size:11px;color:var(--red);margin-top:4px">⚠ 硬性约束</div>' : ''}
        </div>`;
      }).join('')}` : ''}
      ${w.factions?.length ? `<h2>主要势力</h2>${w.factions.map(f => `
        <div class="char-card">
          <div class="char-name">${escHtml(f.name)}</div>
          <div class="char-role">${escHtml(f.type || '')}</div>
          <p class="no-indent" style="font-size:13px;color:var(--text2)">${escHtml(f.description || '')}</p>
        </div>`).join('')}` : ''}
    `;
    showDetail(html, '世界观设定');
  }

  function showFactions() {
    if (!worldData?.factions?.length) return;
    const html = `
      <h1>势力格局</h1>
      ${worldData.factions.map(f => `
        <div class="char-card">
          <div class="char-name">${escHtml(f.name)}</div>
          <div class="char-role">${escHtml(f.type||'')} · ${escHtml(f.alignment||'')}</div>
          <p class="no-indent" style="font-size:13px;color:var(--text2);margin-top:6px">${escHtml(f.description||'')}</p>
          ${f.internal_conflict ? `<div class="char-symbol-item" style="margin-top:8px">
            <span class="sym-label" style="color:var(--red)">内部矛盾</span>
            <span class="sym-value">${escHtml(f.internal_conflict)}</span>
          </div>` : ''}
        </div>`).join('')}
    `;
    showDetail(html, '势力格局');
  }

  // ===== 角色 =====
  function renderCharList() {
    const grid = document.getElementById('card-grid');
    const chars = worldData?.characters || [];
    grid.innerHTML = `<div class="update-time">共 ${chars.length} 位角色</div>`;
    chars.forEach(ch => {
      grid.appendChild(makeCard({
        icon: roleIcon(ch.role_type), title: ch.name,
        badge: roleLabel(ch.role_type), badgeClass: 'badge-char',
        desc: ch.background?.slice(0,80)||ch.description?.slice(0,80)||'',
        stats: [
          { label: '阵营', value: ch.faction||'未知' },
          { label: '境界', value: ch.power_level||'?' },
        ],
        onClick: () => showCharDetail(ch)
      }));
    });
  }

  function showCharDetail(ch) {
    const sym = ch.symbol || {};
    const html = `
      <h1>${escHtml(ch.name)}</h1>
      <div class="meta-row">
        <span class="tag">${escHtml(roleLabel(ch.role_type))}</span>
        ${ch.faction ? `<span class="tag">${escHtml(ch.faction)}</span>` : ''}
        ${ch.power_level ? `<span class="tag">${escHtml(ch.power_level)}</span>` : ''}
      </div>
      ${ch.background || ch.description ? `<p>${escHtml(ch.background || ch.description)}</p>` : ''}
      ${Object.keys(sym).length ? `
        <h2>角色符号体系</h2>
        <div class="char-card">
          ${sym.visual_markers?.length ? `<div class="char-symbol-item"><span class="sym-label">视觉锚点</span><span class="sym-value">${sym.visual_markers.map(escHtml).join('；')}</span></div>` : ''}
          ${sym.speech_pattern ? `<div class="char-symbol-item"><span class="sym-label">口头禅</span><span class="sym-value">${escHtml(sym.speech_pattern)}</span></div>` : ''}
          ${sym.behavioral_tics?.length ? `<div class="char-symbol-item"><span class="sym-label">标志行为</span><span class="sym-value">${sym.behavioral_tics.map(escHtml).join('；')}</span></div>` : ''}
          ${sym.core_contradiction ? `<div class="char-symbol-item"><span class="sym-label">内在矛盾</span><span class="sym-value">${escHtml(sym.core_contradiction)}</span></div>` : ''}
          ${sym.arc_direction ? `<div class="char-symbol-item"><span class="sym-label">人物弧线</span><span class="sym-value">${escHtml(sym.arc_direction)}</span></div>` : ''}
          ${sym.personal_imagery ? `<div class="char-symbol-item"><span class="sym-label">专属意象</span><span class="sym-value">${escHtml(sym.personal_imagery)}</span></div>` : ''}
        </div>` : ''}
    `;
    showDetail(html, ch.name);
  }

  function renderTimeline() {
    const grid = document.getElementById('card-grid');
    if (!timeline.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div><div class="empty-text">暂无历史记录</div></div>`;
      return;
    }
    const typeIcon = { era: '🌐', power_shift: '⚔️', battle: '💥' };
    const typeColor = { era: 'var(--accent)', power_shift: 'var(--red)', battle: 'var(--gold)' };
    let html = `<div class="update-time">共 ${timeline.length} 个节点</div><div class="timeline" style="padding:16px">`;
    timeline.forEach((node, i) => {
      const dotColor = typeColor[node.type] || 'var(--accent)';
      const icon = typeIcon[node.type] || '⏳';
      html += `
        <div class="tl-item">
          <div class="tl-dot-col">
            <div class="tl-dot" style="background:${dotColor};border-color:${dotColor}"></div>
            ${i < timeline.length - 1 ? '<div class="tl-line"></div>' : ''}
          </div>
          <div class="tl-body">
            <div class="tl-year">${icon} ${escHtml(node.year || node.era || `节点 ${i+1}`)}</div>
            <div class="tl-event">${escHtml(node.event || node.title || '')}</div>
            ${node.description ? `<div class="tl-desc">${escHtml(node.description)}</div>` : ''}
          </div>
        </div>`;
    });
    html += '</div>';
    grid.innerHTML = html;
  }

  // ===== 锁屏 =====
  window.lockScreen = () => {
    window._sessionKey = null;
    novelData = null; chapters = []; worldData = null; timeline = [];
    document.getElementById('main-screen').classList.remove('active');
    document.getElementById('unlock-screen').classList.add('active');
    document.getElementById('password-input').value = '';
  };

  // ===== 工具函数 =====
  function escHtml(s) {
    if (typeof s !== 'string') s = String(s||'');
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function markdownToHtml(md) {
    // 简单 Markdown → HTML（仅处理段落和标题）
    const lines = md.split('\n');
    let html = ''; let inPara = false;
    lines.forEach(line => {
      if (line.startsWith('# '))  { if(inPara){html+='</p>';inPara=false;} html+=`<h1>${escHtml(line.slice(2))}</h1>`; }
      else if (line.startsWith('## ')) { if(inPara){html+='</p>';inPara=false;} html+=`<h2>${escHtml(line.slice(3))}</h2>`; }
      else if (line.startsWith('### ')){ if(inPara){html+='</p>';inPara=false;} html+=`<h3>${escHtml(line.slice(4))}</h3>`; }
      else if (line.trim() === '')  { if(inPara){html+='</p>';inPara=false;} }
      else { if(!inPara){html+='<p>';inPara=true;} else{html+='<br>';} html+=escHtml(line); }
    });
    if (inPara) html += '</p>';
    return html;
  }

  function roleIcon(t) {
    return { protagonist:'🦸', antagonist:'🦹', supporting:'👤', neutral:'🧩' }[t] || '👤';
  }
  function roleLabel(t) {
    return { protagonist:'主角', antagonist:'反派', supporting:'配角', neutral:'中立' }[t] || '角色';
  }
})();
