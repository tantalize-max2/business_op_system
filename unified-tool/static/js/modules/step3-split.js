// ========== step3-split.js — 步骤3：分局拆分 ==========

// ========== 拆分组管理 ==========
// 分组颜色标签（与分局分组颜色复用）
const SG_COLORS = ['#14b8a6', '#f0a030', '#a78bfa', '#22c8dc', '#f05050', '#ec4899', '#84cc16', '#6366f1'];

function getSplitGroups() {
  return S.splitGroups || getDefaultSplitGroups();
}

function getDefaultSplitGroups() {
  // 从后端获取默认拆分组（DEFAULT_SPLIT_GROUPS）
  // 前端也维护一份默认值作为 fallback
  const bureaus = Object.keys(getWorkingMapping());
  const industryBureaus = bureaus.filter(b =>
    b.includes('政企分局') || b.includes('智改数转服务局')
  );
  const commercialBureaus = bureaus.filter(b =>
    b.includes('商客分局') || b.includes('校园分局')
  );
  const groups = {};
  if (industryBureaus.length) groups['行业'] = industryBureaus;
  if (commercialBureaus.length) groups['商业'] = commercialBureaus;
  return groups;
}

function initSplitGroups() {
  // 初始化：如果从未设置过拆分组，从后端加载默认值
  if (S.splitGroups === null) {
    loadSplitGroupsFromServer();
  } else {
    renderSplitGroups();
  }
}

async function loadSplitGroupsFromServer() {
  try {
    const res = await fetch('/api/split-groups');
    if (res.ok) {
      const data = await res.json();
      S.splitGroups = data;
    } else {
      S.splitGroups = getDefaultSplitGroups();
    }
  } catch {
    S.splitGroups = getDefaultSplitGroups();
  }
  renderSplitGroups();
}

async function saveSplitGroups() {
  try {
    await fetch('/api/split-groups', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(S.splitGroups)
    });
  } catch { /* ignore */ }
  debouncedSave();
}

function renderSplitGroups() {
  const list = document.getElementById('sgList');
  if (!list) return;
  const groups = getSplitGroups();
  const bureaus = Object.keys(getWorkingMapping());
  const groupNames = Object.keys(groups);

  let html = '';
  groupNames.forEach((name, i) => {
    const members = groups[name];
    const color = SG_COLORS[i % SG_COLORS.length];

    html += `<div class="sg-card" data-group="${esc(name)}" style="--sg-color:${color}">
      <div class="sg-card-head">
        <span class="sg-dot" style="background:${color}"></span>
        <span class="sg-name">${esc(name)}</span>
        <span class="sg-count">${members.length} 分局</span>
        <div class="sg-actions">
          <button class="btn btn-ghost btn-xs sg-rename-btn" title="重命名">改名</button>
          <button class="btn btn-ghost btn-xs sg-del-btn" title="删除组" style="color:var(--err)">删除</button>
        </div>
      </div>
      <div class="sg-members">
        ${members.map(b => `<span class="sg-member" data-bureau="${esc(b)}" draggable="true" style="border-color:${color}30;background:${color}10;color:${color}">${esc(b)}<span class="sg-member-x" onclick="removeBureauFromGroup('${esc(name)}','${esc(b)}')">&times;</span></span>`).join('')}
        <span class="sg-member sg-member-add" onclick="addBureauToGroup('${esc(name)}')" style="border-color:${color}40;background:${color}08;color:${color}">+ 添加分局</span>
      </div>
    </div>`;
  });

  // 未分配分局提示
  const assigned = new Set();
  Object.values(groups).forEach(members => members.forEach(b => assigned.add(b)));
  const unassigned = bureaus.filter(b => !assigned.has(b));

  if (unassigned.length) {
    html += `<div class="sg-unassigned">
      <div class="sg-unassigned-head"><span style="color:var(--t3)">未分组分局 (${unassigned.length})</span></div>
      <div class="sg-members">
        ${unassigned.map(b => `<span class="sg-member sg-member-unassigned" data-bureau="${esc(b)}" draggable="true">${esc(b)}</span>`).join('')}
      </div>
    </div>`;
  }

  list.innerHTML = html;
  bindSplitGroupDrag();
  bindSplitGroupActions();
}

function bindSplitGroupActions() {
  const list = document.getElementById('sgList');
  if (!list) return;

  // 重命名
  list.querySelectorAll('.sg-rename-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const card = btn.closest('.sg-card');
      const oldName = card.dataset.group;
      glassPrompt('输入新组名：', newName => {
        if (newName === oldName) return;
        if (S.splitGroups && S.splitGroups[newName]) { ntf('组名已存在', 'error'); return; }
        const members = S.splitGroups[oldName];
        delete S.splitGroups[oldName];
        S.splitGroups[newName] = members;
        saveSplitGroups();
        renderSplitGroups();
        renderMapping();
        ntf(`已重命名为「${newName}」`);
      }, { title: '重命名拆分组', placeholder: '输入新组名', defaultValue: oldName });
    });
  });

  // 删除组
  list.querySelectorAll('.sg-del-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const card = btn.closest('.sg-card');
      const name = card.dataset.group;
      glassConfirm(`确定删除拆分组「${name}」？分局不会被删除，仅移出分组。`, () => {
        delete S.splitGroups[name];
        saveSplitGroups();
        renderSplitGroups();
        renderMapping();
        ntf(`已删除拆分组「${name}」`);
      }, { title: '删除拆分组', confirmText: '删除' });
    });
  });
}

// 新建组
document.getElementById('sgAddBtn').addEventListener('click', () => {
  glassPrompt('输入新拆分组名称：', name => {
    if (!S.splitGroups) S.splitGroups = getDefaultSplitGroups();
    if (S.splitGroups[name]) { ntf('该组名已存在', 'error'); return; }
    S.splitGroups[name] = [];
    saveSplitGroups();
    renderSplitGroups();
    renderMapping();
    ntf(`已创建拆分组「${name}」`);
  }, { title: '新建拆分组', placeholder: '输入组名' });
});

// 从组中移除分局
function removeBureauFromGroup(groupName, bureauName) {
  if (!S.splitGroups || !S.splitGroups[groupName]) return;
  S.splitGroups[groupName] = S.splitGroups[groupName].filter(b => b !== bureauName);
  saveSplitGroups();
  renderSplitGroups();
  renderMapping();
}

// 向组中添加分局（弹出选择器）
function addBureauToGroup(groupName) {
  if (!S.splitGroups) return;
  const bureaus = Object.keys(getWorkingMapping());
  const currentGroups = S.splitGroups;
  const assigned = new Set();
  Object.values(currentGroups).forEach(m => m.forEach(b => assigned.add(b)));
  // 允许添加已分配的（切换组）和未分配的
  const available = bureaus.filter(b => !currentGroups[groupName].includes(b));
  if (!available.length) { ntf('没有可添加的分局', 'error'); return; }

  // 创建选择弹窗
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center';
  const dlg = document.createElement('div');
  dlg.style.cssText = 'background:var(--bg2);border:1px solid var(--bd);border-radius:16px;width:400px;max-height:60vh;display:flex;flex-direction:column;box-shadow:var(--sh)';
  let html = `<div style="padding:14px 18px 10px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between"><span style="font-weight:700;font-size:14px">添加分局到「${esc(groupName)}」</span><span style="cursor:pointer;color:var(--t3);font-size:18px" id="sgPickClose">&times;</span></div>`;
  html += `<div style="padding:12px 18px;overflow-y:auto;flex:1">`;
  available.forEach(b => {
    const inGroup = Object.entries(currentGroups).find(([gn, ms]) => gn !== groupName && ms.includes(b));
    const extraInfo = inGroup ? `<span style="font-size:10px;color:var(--t3)">${esc(inGroup[0])}</span>` : '';
    html += `<label class="sg-pick-item" style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;cursor:pointer;transition:background .15s" onmouseenter="this.style.background='var(--acg)'" onmouseleave="this.style.background=''"><input type="checkbox" value="${esc(b)}" style="accent-color:var(--ac)"><span style="flex:1;font-size:13px">${esc(b)}</span>${extraInfo}</label>`;
  });
  html += `</div>`;
  html += `<div style="padding:10px 18px;border-top:1px solid var(--bd);display:flex;justify-content:flex-end;gap:8px"><button class="btn btn-ghost btn-sm" id="sgPickCancel">取消</button><button class="btn btn-primary btn-sm" id="sgPickOk">添加</button></div>`;
  dlg.innerHTML = html;
  overlay.appendChild(dlg);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  dlg.querySelector('#sgPickClose').addEventListener('click', close);
  dlg.querySelector('#sgPickCancel').addEventListener('click', close);
  dlg.querySelector('#sgPickOk').addEventListener('click', () => {
    const checked = dlg.querySelectorAll('input[type="checkbox"]:checked');
    if (!checked.length) { ntf('请选择分局', 'error'); return; }
    checked.forEach(cb => {
      S.splitGroups[groupName].push(cb.value);
      // 从其他组移除
      Object.keys(S.splitGroups).forEach(gn => {
        if (gn !== groupName) S.splitGroups[gn] = S.splitGroups[gn].filter(b => b !== cb.value);
      });
    });
    saveSplitGroups();
    renderSplitGroups();
    renderMapping();
    close();
    ntf(`已添加 ${checked.length} 个分局到「${groupName}」`);
  });
}

// 拖拽分局到拆分组
let _dragSgBureau = null;
function bindSplitGroupDrag() {
  const list = document.getElementById('sgList');
  if (!list) return;

  // 分局标签可拖拽
  list.querySelectorAll('.sg-member[data-bureau]').forEach(tag => {
    tag.addEventListener('dragstart', e => {
      _dragSgBureau = tag.dataset.bureau;
      e.dataTransfer.effectAllowed = 'move';
      tag.classList.add('sg-dragging');
    });
    tag.addEventListener('dragend', () => {
      tag.classList.remove('sg-dragging');
      _dragSgBureau = null;
      list.querySelectorAll('.sg-drop-over').forEach(c => c.classList.remove('sg-drop-over'));
    });
  });

  // 拆分组卡片可接收拖拽
  list.querySelectorAll('.sg-card').forEach(card => {
    card.addEventListener('dragover', e => {
      if (!_dragSgBureau) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('sg-drop-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('sg-drop-over'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('sg-drop-over');
      if (!_dragSgBureau) return;
      const targetGroup = card.dataset.group;
      if (!S.splitGroups || !S.splitGroups[targetGroup]) return;
      if (S.splitGroups[targetGroup].includes(_dragSgBureau)) return;
      // 从其他组移除
      Object.keys(S.splitGroups).forEach(gn => {
        S.splitGroups[gn] = S.splitGroups[gn].filter(b => b !== _dragSgBureau);
      });
      S.splitGroups[targetGroup].push(_dragSgBureau);
      saveSplitGroups();
      renderSplitGroups();
      renderMapping();
      ntf(`已将「${_dragSgBureau}」移入「${targetGroup}」`);
    });
  });
}

// 获取分局所属的拆分组名
function getBureauGroupName(bureauName) {
  const groups = getSplitGroups();
  for (const [name, members] of Object.entries(groups)) {
    if (members.includes(bureauName)) return name;
  }
  return null;
}

// ========== 分局拆分 ==========

// 获取当前工作映射：激活时用 mappingData，未激活时用临时映射 _localMapping
function getWorkingMapping() {
  if (S.splitMappingReady) return S.mappingData;
  if (!S._localMapping) S._localMapping = {};
  return S._localMapping;
}

// 控制分局列表/拆分组/添加按钮的显示/隐藏
// 分局人员配置头部和拆分列选择器始终可见
// 三层控制：
//   - splitMappingReady（应用模板/加载配置）→ 显示分局列表、拆分组
//   - 有分局数据（手动添加等）→ 也显示分局列表、拆分组
//   - 有文件上传 → 显示添加按钮（无需模板）
function updSplitLayoutVisibility() {
  const hasMapping = S.splitMappingReady;
  const map = getWorkingMapping();
  const hasBureaus = map && Object.keys(map).length > 0;
  const hasFile = S.files.length > 0;
  const showBureau = hasMapping || hasBureaus;
  const showAdd = hasMapping || hasBureaus || hasFile;
  document.getElementById('splitEmptyHint').style.display = showAdd ? 'none' : '';
  document.getElementById('bureauList').style.display = showBureau ? '' : 'none';
  document.getElementById('splitGroupsSection').style.display = showBureau ? '' : 'none';
  document.getElementById('addBureauRow').style.display = showAdd ? '' : 'none';
}

async function loadMapping() {
  const res = await fetch('/api/mapping');
  S.mappingData = await res.json();
  renderMapping();
  updSplitLayoutVisibility();
}

function renderMapping() {
  const list = document.getElementById('bureauList');
  const map = getWorkingMapping();
  const keys = Object.keys(map);
  const groups = getSplitGroups();
  const groupNames = Object.keys(groups);
  let html = '';
  keys.forEach((bureau, i) => {
    const managers = map[bureau];
    // 查找所属拆分组
    const groupName = getBureauGroupName(bureau);
    const groupIdx = groupName ? groupNames.indexOf(groupName) : -1;
    const groupColor = groupIdx >= 0 ? SG_COLORS[groupIdx % SG_COLORS.length] : null;
    html += `<div class="bureau-card" data-index="${i}" data-bureau="${esc(bureau)}" draggable="true">
      <div class="bureau-header">
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="arrow">▶</span>
          <span class="bureau-name">${esc(bureau)}</span>
          <span class="bureau-count">${managers.length} 人</span>
          ${groupName ? `<span class="bureau-group-tag" style="background:${groupColor}18;color:${groupColor};border:1px solid ${groupColor}40">${esc(groupName)}</span>` : ''}
        </div>
        <div class="mapping-actions" onclick="event.stopPropagation()">
          <button class="btn btn-ghost btn-xs" onclick="deleteBureau('${esc(bureau)}')">删除</button>
        </div>
      </div>
      <div class="bureau-body">
        <div class="manager-tags" id="tags-${i}">
          ${managers.map(m => `<span class="manager-tag">${esc(m)}<span class="x" onclick="removeManager('${esc(bureau)}','${esc(m)}')">&times;</span></span>`).join('')}
        </div>
        <div class="add-person-row">
          <input type="text" id="addPerson-${i}" placeholder="姓名后回车添加" onkeydown="if(event.key==='Enter')addManager('${esc(bureau)}',${i})">
          <button class="btn btn-primary btn-xs" onclick="addManager('${esc(bureau)}',${i})">添加</button>
        </div>
      </div>
    </div>`;
  });
  list.innerHTML = html;
  // 绑定分局卡片点击展开/折叠
  list.querySelectorAll('.bureau-header').forEach(hdr => {
    hdr.addEventListener('click', e => {
      if (e.target.closest('.mapping-actions')) return;
      hdr.closest('.bureau-card').classList.toggle('open');
    });
  });
  bindBureauDrag(list);
}

/* ===== 分局拖拽排序 ===== */
let _dragBureau = null;
function bindBureauDrag(container) {
  container.querySelectorAll('.bureau-card').forEach(card => {
    card.addEventListener('dragstart', e => {
      _dragBureau = card.dataset.bureau;
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('bureau-dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('bureau-dragging');
      _dragBureau = null;
      container.querySelectorAll('.bureau-reorder-over').forEach(c => c.classList.remove('bureau-reorder-over'));
    });
    card.addEventListener('dragover', e => {
      if (!_dragBureau) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('bureau-reorder-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('bureau-reorder-over'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('bureau-reorder-over');
      if (!_dragBureau || _dragBureau === card.dataset.bureau) return;
      const map = getWorkingMapping();
      const keys = Object.keys(map);
      const iFrom = keys.indexOf(_dragBureau);
      const iTo = keys.indexOf(card.dataset.bureau);
      if (iFrom < 0 || iTo < 0) return;
      // 重建有序对象
      const entries = Object.entries(map);
      const [moved] = entries.splice(iFrom, 1);
      entries.splice(iTo, 0, moved);
      // 写回工作映射
      if (S.splitMappingReady) {
        S.mappingData = Object.fromEntries(entries);
      } else {
        S._localMapping = Object.fromEntries(entries);
      }
      renderMapping();
      saveMapping();
      ntf('分局顺序已调整');
    });
  });
}
document.getElementById('collapseAll').addEventListener('click', () => document.querySelectorAll('.bureau-card').forEach(c => c.classList.remove('open')));
document.getElementById('expandAll').addEventListener('click', () => document.querySelectorAll('.bureau-card').forEach(c => c.classList.add('open')));

async function removeManager(bureau, name) {
  const map = getWorkingMapping();
  map[bureau] = map[bureau].filter(m => m !== name);
  await saveMapping();
  renderMapping();
}

async function addManager(bureau, index) {
  const input = document.getElementById(`addPerson-${index}`);
  const name = input.value.trim();
  if (!name) return;
  const map = getWorkingMapping();
  if (map[bureau].includes(name)) { ntf('该人员已存在', 'error'); return; }
  map[bureau].push(name);
  input.value = '';
  await saveMapping();
  renderMapping();
  document.querySelectorAll('.bureau-card').forEach(c => c.classList.add('open'));
}

async function deleteBureau(bureau) {
  glassConfirm(`确定删除分局「${bureau}」？`, async () => {
    const map = getWorkingMapping();
    delete map[bureau];
    await saveMapping();
    renderMapping();
  }, { title: '删除分局', confirmText: '删除' });
}

document.getElementById('addBureauBtn').addEventListener('click', async () => {
  const name = document.getElementById('newBureauName').value.trim();
  if (!name) { ntf('请输入分局名称', 'error'); return; }
  const map = getWorkingMapping();
  if (map[name]) { ntf('该分局已存在', 'error'); return; }
  map[name] = [];
  document.getElementById('newBureauName').value = '';
  await saveMapping();
  // 更新布局可见性和拆分组管理
  updSplitLayoutVisibility();
  renderMapping();
  renderSplitGroups();
  document.querySelectorAll('.bureau-card').forEach(c => c.classList.add('open'));
  ntf(`已添加分局「${name}」`);
});

document.getElementById('resetMapping').addEventListener('click', async () => {
  glassConfirm('确定恢复为默认映射？', async () => {
    await fetch('/api/reset-mapping', {method: 'POST'});
    await loadMapping();
    ntf('已恢复默认映射');
  }, { title: '恢复默认映射' });
});

// ========== 分局模板 ==========
document.getElementById('btnBureauTemplate').addEventListener('click', async () => {
  const res = await fetch('/api/bureau-templates');
  const templates = await res.json();
  showBureauTemplateDialog(templates);
});

// 空状态提示区域的"应用模板"按钮
document.getElementById('btnTemplateFromHint').addEventListener('click', () => {
  document.getElementById('btnBureauTemplate').click();
});

function showBureauTemplateDialog(templates) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center';
  const dlg = document.createElement('div');
  dlg.style.cssText = 'background:var(--bg2);border:1px solid var(--bd);border-radius:16px;width:420px;max-height:70vh;display:flex;flex-direction:column;box-shadow:var(--sh)';
  let html = `<div style="padding:18px 20px 12px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between"><span style="font-weight:700;font-size:14px">分局模板管理</span><span style="cursor:pointer;color:var(--t3);font-size:18px" id="btClose">&times;</span></div>`;
  html += `<div style="padding:16px 20px;border-bottom:1px solid var(--bd);display:flex;gap:8px"><input type="text" id="btNewName" placeholder="输入模板名称..." style="flex:1;padding:8px 12px;border:1px solid var(--bd);border-radius:8px;background:var(--bg);color:var(--t1);font-size:13px;outline:none"><button class="btn btn-primary btn-sm" id="btSaveBtn">保存当前映射为模板</button></div>`;
  html += `<div style="flex:1;overflow-y:auto;padding:12px 20px" id="btList">`;
  if (!templates.length) {
    html += `<div style="color:var(--t3);font-size:12px;text-align:center;padding:20px">暂无保存的模板</div>`;
  } else {
    templates.forEach(t => {
      const d = new Date(t.savedAt);
      const ts = `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
      html += `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--bd);border-radius:10px;margin-bottom:8px;transition:background .15s;cursor:pointer" class="bt-item" data-btname="${esc(t.name)}" onmouseenter="this.style.background='var(--acg)'" onmouseleave="this.style.background=''"><div style="flex:1"><div style="font-weight:600;font-size:13px">${esc(t.name)}</div><div style="font-size:10px;color:var(--t3);font-family:var(--mf)">${t.bureauCount}个分局 · ${ts}</div></div><button class="btn btn-primary btn-xs bt-apply" style="margin-right:4px">应用</button><button class="btn btn-ghost btn-xs bt-del" style="color:var(--err)">删除</button></div>`;
    });
  }
  html += `</div>`;
  dlg.innerHTML = html;
  overlay.appendChild(dlg);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  dlg.querySelector('#btClose').addEventListener('click', () => overlay.remove());

  // 保存当前映射为模板（同时保存拆分组配置）
  dlg.querySelector('#btSaveBtn').addEventListener('click', async () => {
    const name = dlg.querySelector('#btNewName').value.trim();
    if (!name) { ntf('请输入模板名称', 'error'); return; }
    const map = getWorkingMapping();
    if (!Object.keys(map).length) { ntf('当前映射为空', 'error'); return; }
    const res = await fetch('/api/bureau-templates', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ name, mapping: map, splitGroups: S.splitGroups || null, savedAt: Date.now() })
    });
    const data = await res.json();
    if (data.error) { ntf(data.error, 'error'); return; }
    ntf(`模板「${name}」已保存`);
    overlay.remove();
    // 刷新模板列表
    document.getElementById('btnBureauTemplate').click();
  });
  dlg.querySelector('#btNewName').addEventListener('keydown', e => {
    if (e.key === 'Enter') dlg.querySelector('#btSaveBtn').click();
  });

  // 应用模板
  dlg.querySelectorAll('.bt-apply').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const item = btn.closest('.bt-item');
      const name = item.dataset.btname;
      glassConfirm(`确定应用模板「${name}」？当前映射将被替换。`, async () => {
        const res = await fetch(`/api/bureau-templates/${encodeURIComponent(name)}`);
        const data = await res.json();
        if (data.error) { ntf(data.error, 'error'); return; }
        S.mappingData = data.mapping;
        S.splitMappingReady = true;
        S._localMapping = null; // 清空临时映射
        // 恢复拆分组：模板自带则使用，否则基于新 mappingData 重新生成
        if (data.splitGroups && Object.keys(data.splitGroups).length) {
          S.splitGroups = data.splitGroups;
        } else {
          S.splitGroups = null; // null 会触发 getDefaultSplitGroups() 基于新分局自动生成
        }
        saveSplitGroups();
        renderSplitGroups();
        renderMapping();
        saveMapping();
        updSplitLayoutVisibility();
        ntf(`已应用模板「${name}」`);
        overlay.remove();
      }, { title: '应用模板' });
    });
  });

  // 删除模板
  dlg.querySelectorAll('.bt-del').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const item = btn.closest('.bt-item');
      const name = item.dataset.btname;
      glassConfirm(`确定删除模板「${name}」？`, async () => {
        await fetch(`/api/bureau-templates/${encodeURIComponent(name)}`, {method: 'DELETE'});
        item.remove();
        ntf(`模板「${name}」已删除`);
        if (!dlg.querySelectorAll('.bt-item').length) {
          dlg.querySelector('#btList').innerHTML = '<div style="color:var(--t3);font-size:12px;text-align:center;padding:20px">暂无保存的模板</div>';
        }
      }, { title: '删除模板', confirmText: '删除' });
    });
  });
}

async function saveMapping() {
  if (S.splitMappingReady) {
    // 已激活模板：保存到后端
    await fetch('/api/mapping', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(S.mappingData)
    });
  }
  // 未激活时只保存在内存（_localMapping），不写入后端
  debouncedSave();
}

async function doSplit() {
  const f = getActiveFile();
  if (!f || !f.raw.length) { ntf('请先上传文件并加载数据', 'error'); return; }

  const splitCol = getSplitCol();
  if (!splitCol) { ntf('请选择拆分列', 'error'); return; }

  const overlay = document.getElementById('progressOverlay');
  overlay.style.display = 'flex';

  try {
    // 用当前raw数据（可能已被一级过滤编辑修改过）构建新的xlsx文件
    const ws = XLSX.utils.json_to_sheet(f.raw);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const binStr = XLSX.write(wb, {type: 'binary', bookType: 'xlsx'});
    const buf = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) buf[i] = binStr.charCodeAt(i) & 0xFF;
    const currentFileData = buf.buffer;

    // 计算一级过滤后数据的索引
    const filteredData = getFilteredData();
    const filteredIndices = [];
    filteredData.forEach(row => {
      const idx = f.raw.indexOf(row);
      if (idx >= 0) filteredIndices.push(idx);
    });

    // 将当前数据转base64
    const b64 = arrayBufferToBase64(currentFileData);

    const res = await fetch('/api/split-filtered', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        fileName: f.name,
        fileDataBase64: b64,
        filteredRowIndices: filteredIndices,
        mapping: getWorkingMapping(),
        splitColumn: splitCol,
        splitGroups: S.splitGroups || null
      })
    });
    const data = await res.json();
    if (!res.ok) { ntf(data.error, 'error'); overlay.style.display = 'none'; return; }

    S.splitResult = data;
    // 将拆分结果存到文件对象（多文件各自独立）
    f._splitResult = data;
    // 计算拆分后匹配的行索引集合（用于L2统计时排除未匹配行）
    const splitColName = getSplitCol();
    const workingMap = getWorkingMapping();
    if (splitColName && workingMap && Object.keys(workingMap).length) {
      const matchedSet = new Set();
      f.raw.forEach((row, idx) => {
        const val = String(row[splitColName] ?? '').trim();
        for (const members of Object.values(workingMap)) {
          if (members.some(m => m === val)) {
            matchedSet.add(idx);
            break;
          }
        }
      });
      f._splitMatchedRows = matchedSet;
      f._splitColName = splitColName;
      // 同时更新全局状态（兼容单文件场景）
      S.splitMatchedRows = matchedSet;
      S.splitFileId = f.id;
      // 持久化拆分状态（用于刷新后恢复）
      S.splitFileName = f.name;
      S.splitColName = splitColName;
    }
    renderSplitResults();
    debouncedSave();
    ntf(`拆分完成！匹配 ${data.matched} 行，未匹配 ${data.unmatched} 行`);
  } catch (err) {
    ntf('拆分失败: ' + err.message, 'error');
  } finally {
    overlay.style.display = 'none';
  }
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ========== 拆分后自动创建分局分组 ==========
const GROUP_COLORS = ['blue', 'green', 'orange', 'purple', 'cyan', 'red'];

function autoCreateBureauGroups() {
  if (!S.splitResult || !S.splitResult.files) return;
  const f = getActiveFile();
  if (!f) return;
  const splitCol = getSplitCol();
  if (!splitCol) return;

  // 只在有拆分结果且当前没有分组时自动创建（避免重复）
  if (f.grps.length > 0) return;

  const bureausWithRows = S.splitResult.files.filter(bf => bf.bureau && bf.bureau !== '- 汇总文件 -' && bf.bureau !== '- 未匹配名单 -' && bf.rows > 0);
  if (!bureausWithRows.length) return;

  let colorIdx = 0;
  bureausWithRows.forEach(bf => {
    const bureauName = bf.bureau;
    const managers = getWorkingMapping()[bureauName] || [];
    if (!managers.length) return;
    const l1f = f.l1[splitCol];
    f.grps.push({
      id: ++f.gid,
      name: bureauName,
      color: GROUP_COLORS[colorIdx % GROUP_COLORS.length],
      column: splitCol,
      values: [...managers],
      l1Dep: {col: splitCol, cascade: l1f && l1f.cascade, dependCol: l1f && l1f.dependCol, filtered: l1f && l1f.checked && l1f.checked.size < uniq(splitCol).length},
      parentId: null,
      parentRel: null
    });
    colorIdx++;
  });

  renderGrpCards();
  popDepGrp();
  renderL2Preview();
  if (f.grps.length) ntf(`已自动创建 ${f.grps.length} 个分局分组`);
}

function renderSplitResults() {
  const data = S.splitResult;
  if (!data) return;
  document.getElementById('splitResults').style.display = '';
  document.getElementById('matchedCount').textContent = data.matched;
  document.getElementById('unmatchedCount').textContent = data.unmatched;
  document.getElementById('splitFileCount').textContent = data.files.length;

  if (data.unmatched_managers && data.unmatched_managers.length) {
    document.getElementById('unmatchedManagers').innerHTML = data.unmatched_managers.map(m => `<span class="tag-item">${esc(m)}</span>`).join('');
    document.getElementById('unmatchedCard').style.display = '';
  } else {
    document.getElementById('unmatchedCard').style.display = 'none';
  }

  const grid = document.getElementById('splitFilesGrid');
  grid.innerHTML = data.files.map(f => `
    <div class="split-file-card">
      <div class="sfc-name">${esc(f.bureau)}</div>
      <div class="sfc-rows">${f.rows} 行数据</div>
      <a class="sfc-dl" href="/api/download-folder/${data.output_folder}" download>下载</a>
    </div>
  `).join('');
}

document.getElementById('downloadAllBtn').addEventListener('click', () => {
  if (S.splitResult && S.splitResult.zip) window.open('/api/download/' + S.splitResult.zip, '_blank');
});

// ========== 事件绑定：步骤导航 ==========
document.querySelectorAll('.sb-item').forEach(item => {
  item.addEventListener('click', () => {
    const step = item.dataset.step;
    // filter1/filter2/separator 无条件可进入（无文件时显示空状态）
    switchStep(step);
  });
});

// 上传区
document.getElementById('goFilter1').addEventListener('click', () => {
  if (!S.files.length) { ntf('请先上传文件', 'error'); return; }
  S.activeFileId = S.files[0].id;
  switchStep('filter1');
  initActiveFile();
  syncPreprocessColSel();
});

function initActiveFile() {
  renderFileTabs();
  renderTable();
  updHdr();
  popGCol();
  renderGrpCards();
  renderL2FileTabs();
  updLxButtons();
  syncPreprocessColSel();
}

// 一级过滤区导航
document.getElementById('btnBackUpload').addEventListener('click', () => switchStep('upload'));
document.getElementById('goSplit').addEventListener('click', () => {
  switchStep('split');
  loadMapping();
  populateSplitColSel();
  updSplitActiveFile();
});

function updSplitActiveFile() {
  const el = document.getElementById('splitActiveFile');
  const f = getActiveFile();
  if (!el || !f) return;
  const fd = getFilteredData();
  el.style.display = 'inline-flex';
  el.innerHTML = `<span>当前拆分文件:</span><span class="saf-name">${esc(f.name)}</span><span class="saf-meta">${fd.length} 行 / ${f.hdr.length} 列</span>`;
}
document.getElementById('btnSkipSplit').addEventListener('click', () => switchStep('filter2'));
document.getElementById('btnReup').addEventListener('click', () => {
  const input = document.getElementById('fileInput');
  input.value = '';
  input.click();
});

// 拆分区导航
document.getElementById('btnBackFilter1').addEventListener('click', () => switchStep('filter1'));
document.getElementById('btnDoSplit').addEventListener('click', doSplit);
document.getElementById('goFilter2FromSplit').addEventListener('click', () => {
  switchStep('filter2');
  autoCreateBureauGroups();
});
