// ========== step3-split.js — 步骤3：分局拆分 ==========

// ========== 分局拆分 ==========
async function loadMapping() {
  const res = await fetch('/api/mapping');
  S.mappingData = await res.json();
  renderMapping();
}

function renderMapping() {
  const list = document.getElementById('bureauList');
  const keys = Object.keys(S.mappingData);
  let html = '';
  keys.forEach((bureau, i) => {
    const managers = S.mappingData[bureau];
    html += `<div class="bureau-card" data-index="${i}" data-bureau="${esc(bureau)}" draggable="true">
      <div class="bureau-header">
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="arrow">▶</span>
          <span class="bureau-name">${esc(bureau)}</span>
          <span class="bureau-count">${managers.length} 人</span>
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
      const keys = Object.keys(S.mappingData);
      const iFrom = keys.indexOf(_dragBureau);
      const iTo = keys.indexOf(card.dataset.bureau);
      if (iFrom < 0 || iTo < 0) return;
      // 重建有序对象
      const entries = Object.entries(S.mappingData);
      const [moved] = entries.splice(iFrom, 1);
      entries.splice(iTo, 0, moved);
      S.mappingData = Object.fromEntries(entries);
      renderMapping();
      saveMapping();
      ntf('分局顺序已调整');
    });
  });
}
document.getElementById('collapseAll').addEventListener('click', () => document.querySelectorAll('.bureau-card').forEach(c => c.classList.remove('open')));
document.getElementById('expandAll').addEventListener('click', () => document.querySelectorAll('.bureau-card').forEach(c => c.classList.add('open')));

async function removeManager(bureau, name) {
  S.mappingData[bureau] = S.mappingData[bureau].filter(m => m !== name);
  await saveMapping();
  renderMapping();
}

async function addManager(bureau, index) {
  const input = document.getElementById(`addPerson-${index}`);
  const name = input.value.trim();
  if (!name) return;
  if (S.mappingData[bureau].includes(name)) { ntf('该人员已存在', 'error'); return; }
  S.mappingData[bureau].push(name);
  input.value = '';
  await saveMapping();
  renderMapping();
  document.querySelectorAll('.bureau-card').forEach(c => c.classList.add('open'));
}

async function deleteBureau(bureau) {
  if (!confirm(`确定删除分局「${bureau}」？`)) return;
  delete S.mappingData[bureau];
  await saveMapping();
  renderMapping();
}

document.getElementById('addBureauBtn').addEventListener('click', async () => {
  const name = document.getElementById('newBureauName').value.trim();
  if (!name) { ntf('请输入分局名称', 'error'); return; }
  if (S.mappingData[name]) { ntf('该分局已存在', 'error'); return; }
  S.mappingData[name] = [];
  document.getElementById('newBureauName').value = '';
  await saveMapping();
  renderMapping();
  document.querySelectorAll('.bureau-card').forEach(c => c.classList.add('open'));
  ntf(`已添加分局「${name}」`);
});

document.getElementById('resetMapping').addEventListener('click', async () => {
  if (!confirm('确定恢复为默认映射？')) return;
  await fetch('/api/reset-mapping', {method: 'POST'});
  await loadMapping();
  ntf('已恢复默认映射');
});

// ========== 分局模板 ==========
document.getElementById('btnBureauTemplate').addEventListener('click', async () => {
  const res = await fetch('/api/bureau-templates');
  const templates = await res.json();
  showBureauTemplateDialog(templates);
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

  // 保存当前映射为模板
  dlg.querySelector('#btSaveBtn').addEventListener('click', async () => {
    const name = dlg.querySelector('#btNewName').value.trim();
    if (!name) { ntf('请输入模板名称', 'error'); return; }
    if (!Object.keys(S.mappingData).length) { ntf('当前映射为空', 'error'); return; }
    const res = await fetch('/api/bureau-templates', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ name, mapping: S.mappingData, savedAt: Date.now() })
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
      if (!confirm(`确定应用模板「${name}」？当前映射将被替换。`)) return;
      const res = await fetch(`/api/bureau-templates/${encodeURIComponent(name)}`);
      const data = await res.json();
      if (data.error) { ntf(data.error, 'error'); return; }
      S.mappingData = data.mapping;
      renderMapping();
      saveMapping();
      ntf(`已应用模板「${name}」`);
      overlay.remove();
    });
  });

  // 删除模板
  dlg.querySelectorAll('.bt-del').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const item = btn.closest('.bt-item');
      const name = item.dataset.btname;
      if (!confirm(`确定删除模板「${name}」？`)) return;
      await fetch(`/api/bureau-templates/${encodeURIComponent(name)}`, {method: 'DELETE'});
      item.remove();
      ntf(`模板「${name}」已删除`);
      if (!dlg.querySelectorAll('.bt-item').length) {
        dlg.querySelector('#btList').innerHTML = '<div style="color:var(--t3);font-size:12px;text-align:center;padding:20px">暂无保存的模板</div>';
      }
    });
  });
}

async function saveMapping() {
  await fetch('/api/mapping', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(S.mappingData)
  });
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
        mapping: S.mappingData,
        splitColumn: splitCol
      })
    });
    const data = await res.json();
    if (!res.ok) { ntf(data.error, 'error'); overlay.style.display = 'none'; return; }

    S.splitResult = data;
    // 计算拆分后匹配的行索引集合（用于L2统计时排除未匹配行）
    const splitColName = getSplitCol();
    if (splitColName && S.mappingData) {
      const matchedSet = new Set();
      f.raw.forEach((row, idx) => {
        const val = String(row[splitColName] ?? '').trim();
        for (const members of Object.values(S.mappingData)) {
          if (members.some(m => m === val)) {
            matchedSet.add(idx);
            break;
          }
        }
      });
      S.splitMatchedRows = matchedSet;
      S.splitFileId = f.id;
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
    const managers = S.mappingData[bureauName] || [];
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
    if (step === 'upload' || step === 'kdocs' || step === 'normalize' || step === 'email' || step === 'split' || S.files.length) switchStep(step);
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
