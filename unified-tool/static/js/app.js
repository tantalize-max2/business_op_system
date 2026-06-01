// ========== 主题切换（必须在最前面，防止闪烁） ==========
const THEMES = ['light', 'dark', 'eyecare'];
const THEME_LABELS = { light: '白天', dark: '黑夜', eyecare: '护眼' };
const THEME_ICONS = { light: '&#9728;', dark: '&#9790;', eyecare: '&#127811;' };

(function initTheme() {
  const saved = localStorage.getItem('ba-theme');
  const theme = saved && THEMES.includes(saved) ? saved : 'light';
  document.documentElement.setAttribute('data-theme', theme);
})();

function applyThemeUI(theme) {
  const icon = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  if (icon) icon.innerHTML = THEME_ICONS[theme] || THEME_ICONS.light;
  if (label) label.textContent = THEME_LABELS[theme] || '白天';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const idx = THEMES.indexOf(current);
  const next = THEMES[(idx + 1) % THEMES.length];
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('ba-theme', next);
  applyThemeUI(next);
}

// ========== 刷新持久化 ==========
function saveState() {
  // 只保存mappingData，不再保存文件状态（每次启动应为空白）
  try {
    localStorage.setItem('ba-state', JSON.stringify({ mappingData: S.mappingData }));
  } catch (e) { /* ignore */ }
}

// loadState 已移除：每次启动为空白，不再恢复旧文件状态

// 定时自动保存 + 关键操作后保存
let _saveTimer = null;
function debouncedSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveState, 800);
}

// 重写 ntf 以在操作后触发保存
const _origNtf = ntf;
ntf = function(m, t) {
  _origNtf(m, t);
  debouncedSave();
};

// ========== 全局状态 ==========
const S = {
  files: [],       // [{id, name, raw:[], hdr:[], l1:{}, grps:[], gid:0, addedCols:[], sumCol:'', hiddenCols:Set, rawFileData:ArrayBuffer}]
  activeFileId: null,
  currentStep: 'upload',
  l1Temp: null,
  l1EditCol: null,
  selGColor: 'blue',
  selGVals: [],
  splitResult: null,
  splitFileId: null,      // 执行拆分时的文件ID，splitMatchedRows 只对该文件生效
  mappingData: {},
  splitMatchedRows: null,  // Set<row index> - 拆分后匹配的行索引集合（仅对 splitFileId 文件有效）
};

const CM = {
  blue:   {d:'#4c8bf5', t:'t-blue'},
  green:  {d:'#2dd4a0', t:'t-green'},
  orange: {d:'#f0a030', t:'t-orange'},
  purple: {d:'#a78bfa', t:'t-purple'},
  cyan:   {d:'#22c8dc', t:'t-cyan'},
  red:    {d:'#f05050', t:'t-red'}
};
const SEC_COLORS = ['#4c8bf5','#2dd4a0','#f0a030','#a78bfa','#22c8dc','#f05050','#ec4899','#84cc16'];

// ========== 拆分列选择器 & 预处理列选择器 ==========
function populateSplitColSel() {
  const sel = document.getElementById('splitColSel');
  const cur = sel.value;
  sel.innerHTML = '<option value="">-- 选择拆分列 --</option>';
  const f = getActiveFile();
  if (f) {
    let hasExactMatch = false;
    f.hdr.forEach(c => { if (c === '客户经理') hasExactMatch = true; });
    f.hdr.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      // 精确匹配"客户经理"列优先，否则匹配包含"客户经理"的列
      if (hasExactMatch ? (c === '客户经理') : c.includes('客户经理')) opt.selected = true;
      sel.appendChild(opt);
    });
  }
  if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
  // 同步预处理列选择器
  syncPreprocessColSel();
}

function syncPreprocessColSel() {
  const sel = document.getElementById('preprocessColSel');
  if (!sel) return;
  const cur = sel.value || document.getElementById('splitColSel')?.value;
  sel.innerHTML = '<option value="">预处理列</option>';
  const f = getActiveFile();
  if (f) {
    let hasExactMatch = false;
    f.hdr.forEach(c => { if (c === '客户经理') hasExactMatch = true; });
    f.hdr.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      if (hasExactMatch ? (c === '客户经理') : c.includes('客户经理')) opt.selected = true;
      sel.appendChild(opt);
    });
  }
  if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
}

// 预处理列选择变化时同步到拆分列
function onPreprocessColChange() {
  const pSel = document.getElementById('preprocessColSel');
  const sSel = document.getElementById('splitColSel');
  if (pSel && sSel && pSel.value) sSel.value = pSel.value;
}

function getSplitCol() {
  const sel = document.getElementById('splitColSel');
  return sel ? sel.value : '';
}

// ========== 工具函数 ==========
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function ntf(m, t='success') {
  const e = document.getElementById('toast');
  e.textContent = m;
  e.className = `toast ${t} show`;
  setTimeout(() => e.classList.remove('show'), 2200);
}
function fmtN(n) {
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
}
function uniq(col, data) {
  data = data || getActiveRaw();
  const s = new Set();
  data.forEach(r => s.add(String(r[col] ?? '')));
  return [...s].sort();
}

function getActiveRaw() { const f = getActiveFile(); return f ? f.raw : []; }
function getActiveFile() { return S.files.find(f => f.id === S.activeFileId) || null; }
function getActiveHdr() { const f = getActiveFile(); return f ? f.hdr : []; }

// ========== 步骤导航 ==========
function switchStep(step) {
  S.currentStep = step;
  debouncedSave();
  document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('step' + capitalize(step)).classList.add('active');
  document.querySelectorAll('.sb-item').forEach(n => n.classList.remove('active'));
  const navMap = {upload:'navUpload', filter1:'navFilter1', split:'navSplit', filter2:'navFilter2', kdocs:'navKdocs'};
  document.getElementById(navMap[step])?.classList.add('active');
  // 更新侧栏统计
  if (step !== 'upload' && step !== 'kdocs') {
    document.getElementById('sbStats').style.display = '';
    updSbStats();
  } else {
    document.getElementById('sbStats').style.display = 'none';
  }
  // 进入二级统计时刷新L2数据（清理过时分组值、更新数据条数）
  if (step === 'filter2') {
    refreshL2Data();
  }
  // 进入分局拆分时加载最新mapping数据
  if (step === 'split') {
    loadMapping();
    populateSplitColSel();
    updSplitActiveFile();
  }
  // 进入在线推送时加载数据
  if (step === 'kdocs') {
    loadKdocsCats();
    loadKdocsSheets();
  }
}
function capitalize(s) {
  const map = {upload:'Upload', filter1:'Filter1', split:'Split', filter2:'Filter2', kdocs:'Kdocs'};
  return map[s] || s;
}

// 辅助：将过滤后数据按splitMatchedRows（索引集合）排除未匹配行
function filterBySplitMatch(l1Data, file) {
  if (!S.splitMatchedRows || S.splitFileId !== file.id || S.splitMatchedRows.size === 0) return l1Data;
  return l1Data.filter(r => {
    const idx = file.raw.indexOf(r);
    return idx >= 0 && S.splitMatchedRows.has(idx);
  });
}

function updSbStats() {
  const f = getActiveFile();
  if (!f) return;
  const fd = getFilteredData();
  document.getElementById('sAll').textContent = f.raw.length;
  // 如果在二级统计页面且有拆分数据，显示拆分后的数量
  if (S.currentStep === 'filter2' && S.splitMatchedRows && S.splitFileId === S.activeFileId && S.splitMatchedRows.size > 0) {
    document.getElementById('sFil').textContent = filterBySplitMatch(fd, f).length;
  } else {
    document.getElementById('sFil').textContent = fd.length;
  }
  document.getElementById('sCol').textContent = f.hdr.length - f.hiddenCols.size;
}

// ========== L1 数据函数 ==========
function newL1() {
  return {checked: null, cascade: false, dependCol: null, sort: null, condOn: false, condOp: 'eq', condVal: ''};
}

function getDepChain(col, f) {
  const chain = [];
  let cur = col;
  const visited = new Set();
  while (cur) {
    if (visited.has(cur)) break;
    visited.add(cur);
    if (f && f.cascade && f.dependCol) {
      chain.unshift(f.dependCol);
      const af = getActiveFile();
      cur = f.dependCol;
      f = af ? af.l1[cur] : null;
    } else break;
  }
  return chain;
}

function getDataFilteredForCol(col) {
  const af = getActiveFile();
  if (!af) return [];
  const f = af.l1[col];
  const chain = getDepChain(col, f);
  let data = getActiveRaw();
  for (const c of chain) {
    const pf = af.l1[c];
    if (pf && pf.checked && pf.checked.size < uniq(c).length)
      data = data.filter(r => pf.checked.has(String(r[c] ?? '')));
  }
  return data;
}

function getFilteredData() {
  const hdr = getActiveHdr(), l1 = getActiveFile().l1;
  const order = [];
  const visited = new Set();
  const visiting = new Set();
  function visit(col) {
    if (visited.has(col)) return;
    if (visiting.has(col)) return;
    visiting.add(col);
    const f = l1[col];
    if (f && f.cascade && f.dependCol) visit(f.dependCol);
    visiting.delete(col);
    visited.add(col);
    order.push(col);
  }
  hdr.forEach(c => visit(c));
  let data = getActiveRaw();
  for (const col of order) {
    const f = l1[col];
    if (f && f.checked && f.checked.size < uniq(col).length)
      data = data.filter(r => f.checked.has(String(r[col] ?? '')));
    if (f && f.condOn && f.condVal !== '') {
      const cv = f.condVal.toLowerCase(), op = f.condOp;
      data = data.filter(r => {
        const v = String(r[col] ?? '').toLowerCase();
        const numV = parseFloat(v), numC = parseFloat(f.condVal);
        switch (op) {
          case 'eq': return v === cv;
          case 'neq': return v !== cv;
          case 'gt': return !isNaN(numV) && !isNaN(numC) && numV > numC;
          case 'lt': return !isNaN(numV) && !isNaN(numC) && numV < numC;
          case 'gte': return !isNaN(numV) && !isNaN(numC) && numV >= numC;
          case 'lte': return !isNaN(numV) && !isNaN(numC) && numV <= numC;
          case 'sw': return v.startsWith(cv);
          case 'ew': return v.endsWith(cv);
          case 'contains': return v.includes(cv);
          default: return true;
        }
      });
    }
  }
  return data;
}

function getFilteredData_forFile(file) {
  const hdr = file.hdr, l1 = file.l1;
  const order = [];
  const visited = new Set();
  const visiting = new Set();
  function visit(col) {
    if (visited.has(col)) return;
    if (visiting.has(col)) return;
    visiting.add(col);
    const f = l1[col];
    if (f && f.cascade && f.dependCol) visit(f.dependCol);
    visiting.delete(col);
    visited.add(col);
    order.push(col);
  }
  hdr.forEach(c => visit(c));
  let data = file.raw;
  for (const col of order) {
    const f = l1[col];
    if (f && f.checked && f.checked.size < uniq_for(col, file).length)
      data = data.filter(r => f.checked.has(String(r[col] ?? '')));
    if (f && f.condOn && f.condVal !== '') {
      const cv = f.condVal.toLowerCase(), op = f.condOp;
      data = data.filter(r => {
        const v = String(r[col] ?? '').toLowerCase();
        const numV = parseFloat(v), numC = parseFloat(f.condVal);
        switch (op) {
          case 'eq': return v === cv;
          case 'neq': return v !== cv;
          case 'gt': return !isNaN(numV) && !isNaN(numC) && numV > numC;
          case 'lt': return !isNaN(numV) && !isNaN(numC) && numV < numC;
          case 'gte': return !isNaN(numV) && !isNaN(numC) && numV >= numC;
          case 'lte': return !isNaN(numV) && !isNaN(numC) && numV <= numC;
          case 'sw': return v.startsWith(cv);
          case 'ew': return v.endsWith(cv);
          case 'contains': return v.includes(cv);
          default: return true;
        }
      });
    }
  }
  return data;
}

function uniq_for(col, file) {
  const s = new Set();
  file.raw.forEach(r => s.add(String(r[col] ?? '')));
  return [...s].sort();
}

function getSortedData(data) {
  const hdr = getActiveHdr(), l1 = getActiveFile().l1;
  for (const col of hdr) {
    const f = l1[col];
    if (f && f.sort) {
      const dir = f.sort === 'asc' ? 1 : -1;
      return [...data].sort((a, b) => {
        const va = a[col] ?? '', vb = b[col] ?? '';
        const na = parseFloat(va), nb = parseFloat(vb);
        if (!isNaN(na) && !isNaN(nb)) return (na - nb) * dir;
        return String(va).localeCompare(String(vb), 'zh-CN') * dir;
      });
    }
  }
  return data;
}

// ========== L2 GROUP CONTEXT ==========
function getGroupContext(gid, l1Data, grps, cache) {
  if (cache[gid]) return cache[gid];
  // 防止循环依赖：标记正在计算
  if (cache['_calc_' + gid]) return [];
  cache['_calc_' + gid] = true;
  const g = grps.find(x => x.id === gid);
  let ctx;
  // 1级分组：聚合所有子分组的上下文
  if (g.level === 1 && g.childGroupIds && g.childGroupIds.length) {
    const seen = new Set();
    ctx = [];
    g.childGroupIds.forEach(cid => {
      const childCtx = getGroupContext(cid, l1Data, grps, cache);
      childCtx.forEach(r => { if (!seen.has(r)) { seen.add(r); ctx.push(r); } });
    });
  } else if (!g.parentId && (!g.parentIds || !g.parentIds.length)) {
    const valSet = new Set(g.values.map(v => String(v).trim()));
    ctx = l1Data.filter(r => valSet.has(String(r[g.column] ?? '').trim()));
  } else {
    // 支持多父分组依赖
    const pids = g.parentIds && g.parentIds.length ? g.parentIds : (g.parentId ? [g.parentId] : []);
    const prels = g.parentRels && g.parentRels.length ? g.parentRels : (g.parentRel ? [g.parentRel] : []);
    // 先取第一个父分组的上下文作为基础
    let mergedCtx;
    pids.forEach((pid, i) => {
      const rel = prels[i] || 'AND';
      const pg = grps.find(x => x.id === pid);
      // 如果父分组是L1分组，直接用L1的子分组数据（不走递归），避免循环依赖
      let parentCtx;
      if (pg && pg.level === 1 && pg.childGroupIds && pg.childGroupIds.length) {
        const seen = new Set();
        parentCtx = [];
        pg.childGroupIds.forEach(cid => {
          // 只取不在当前分组依赖链中的子分组上下文
          const cc = getGroupContext(cid, l1Data, grps, cache);
          cc.forEach(r => { if (!seen.has(r)) { seen.add(r); parentCtx.push(r); } });
        });
      } else {
        parentCtx = getGroupContext(pid, l1Data, grps, cache);
      }
      const valSet = new Set(g.values.map(v => String(v).trim()));
      const selfMatch = l1Data.filter(r => valSet.has(String(r[g.column] ?? '').trim()));
      if (i === 0) {
        // 第一个父分组
        if (rel === 'AND') {
          const ps = new Set(parentCtx);
          mergedCtx = selfMatch.filter(r => ps.has(r));
        } else {
          const seen = new Set();
          mergedCtx = [];
          [...parentCtx, ...selfMatch].forEach(r => { if (!seen.has(r)) { seen.add(r); mergedCtx.push(r); } });
        }
      } else {
        // 后续父分组：与已合并的取并集
        let nextCtx;
        if (rel === 'AND') {
          const ps = new Set(parentCtx);
          nextCtx = selfMatch.filter(r => ps.has(r));
        } else {
          const seen2 = new Set();
          nextCtx = [];
          [...parentCtx, ...selfMatch].forEach(r => { if (!seen2.has(r)) { seen2.add(r); nextCtx.push(r); } });
        }
        const seen = new Set(mergedCtx);
        nextCtx.forEach(r => { if (!seen.has(r)) { seen.add(r); mergedCtx.push(r); } });
      }
    });
    ctx = mergedCtx;
  }
  cache[gid] = ctx;
  return ctx;
}

// ========== 分组值自动清理 ==========
// 当前过滤条件变化后，分组中某些值可能已不在过滤后数据中，自动剔除这些值
function cleanGroupValues(file) {
  if (!file || !file.grps.length) return false;
  let l1Data = getFilteredData_forFile(file);
  // 如果已执行拆分且该文件是拆分文件，排除未匹配行
  if (S.splitMatchedRows && S.splitFileId === file.id && S.splitMatchedRows.size > 0) {
    l1Data = filterBySplitMatch(l1Data, file);
  }
  // 收集每列在当前过滤数据中的可用值
  const availByCol = {};
  file.grps.forEach(g => {
    if (g.column && !availByCol[g.column]) {
      availByCol[g.column] = new Set(l1Data.map(r => String(r[g.column] ?? '').trim()).filter(v => v));
    }
  });
  let changed = false;
  // 清理每组中不在过滤数据内的值
  file.grps.forEach(g => {
    if (g.level === 1) return; // 1级分组没有自己的values
    const avail = availByCol[g.column];
    if (!avail) return;
    const origLen = g.values.length;
    g.values = g.values.filter(v => avail.has(String(v).trim()));
    if (g.values.length !== origLen) changed = true;
  });
  // 移除值已清空的2级分组
  const emptyGrpIds = new Set(
    file.grps.filter(g => g.level !== 1 && g.values.length === 0).map(g => g.id)
  );
  if (emptyGrpIds.size) {
    file.grps = file.grps.filter(g => !emptyGrpIds.has(g.id));
    // 清理1级分组的childGroupIds引用
    file.grps.filter(g => g.level === 1 && g.childGroupIds).forEach(g => {
      g.childGroupIds = g.childGroupIds.filter(id => !emptyGrpIds.has(id));
    });
    // 移除无子分组的1级分组
    file.grps = file.grps.filter(g => g.level !== 1 || (g.childGroupIds && g.childGroupIds.length > 0));
    // 清理其他分组的parentIds引用
    file.grps.forEach(g => {
      if (g.parentIds && g.parentIds.length) {
        const newPids = g.parentIds.filter(id => !emptyGrpIds.has(id) && file.grps.some(x => x.id === id));
        const newRels = g.parentRels ? g.parentRels.filter((_, i) => i < newPids.length) : [];
        if (newPids.length !== g.parentIds.length) {
          g.parentIds = newPids.length ? newPids : [];
          g.parentRels = newRels;
          g.parentId = newPids[0] || null;
          g.parentRel = newRels[0] || null;
          changed = true;
        }
      }
    });
    changed = true;
  }
  return changed;
}

// 刷新L2数据（清理分组值 + 重新渲染L2区域）
function refreshL2Data() {
  const f = getActiveFile();
  if (!f) return;
  const changed = cleanGroupValues(f);
  if (changed) {
    renderGrpCards();
    popDepGrp();
    ntf('已自动清理与当前过滤不匹配的分组值', 'warn');
  }
  renderL2FileTabs();
  // 刷新值选择面板（如果已选列）
  const col = document.getElementById('gCol').value;
  if (col) { renderVP2(col); showL2BaseInfo(col); }
}

// ========== 文件管理 ==========
let fileIdCounter = 0;

function handleFiles(files) {
  for (const file of files) {
    handleFile(file);
  }
}

function handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx', 'xls', 'csv'].includes(ext)) { ntf('不支持该格式', 'error'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const rawBuffer = e.target.result;
      const wb = XLSX.read(rawBuffer, {type: 'array'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, {defval: ''});
      if (!json.length) { ntf('文件为空', 'error'); return; }
      const hdr = Object.keys(json[0]);
      const l1 = {};
      hdr.forEach(c => { l1[c] = newL1(); });
      // 同名文件自动替换旧文件
      const oldIdx = S.files.findIndex(f => f.name === file.name);
      let newId;
      if (oldIdx >= 0) {
        newId = S.files[oldIdx].id;
        S.files[oldIdx] = {
          id: newId, name: file.name, raw: json, hdr, l1,
          grps: [], gid: 0, addedCols: [], sumCol: '', hiddenCols: new Set(), rawFileData: rawBuffer
        };
        // 清理与旧文件关联的拆分状态
        if (S.splitFileId === newId) { S.splitFileId = null; S.splitMatchedRows = null; S.splitResult = null; }
        ntf(`已替换 ${file.name} (${json.length} 行)`);
      } else {
        newId = ++fileIdCounter;
        S.files.push({
          id: newId, name: file.name, raw: json, hdr, l1,
          grps: [], gid: 0, addedCols: [], sumCol: '', hiddenCols: new Set(), rawFileData: rawBuffer
        });
        ntf(`已加载 ${file.name} (${json.length} 行)`);
      }
      S.activeFileId = newId;
      renderFileList();
      renderFileTabs();
      renderTable();
      updHdr();
      popGCol();
      renderGrpCards();
      renderL2FileTabs();
      updSbStats();
      debouncedSave();
    } catch (err) { ntf('解析失败: ' + err.message, 'error'); }
  };
  reader.readAsArrayBuffer(file);
}

function removeFile(id) {
  S.files = S.files.filter(f => f.id !== id);
  if (S.activeFileId === id) {
    S.activeFileId = S.files.length ? S.files[0].id : null;
  }
  // 清理与该文件关联的拆分状态
  if (S.splitFileId === id) {
    S.splitFileId = null;
    S.splitMatchedRows = null;
    S.splitResult = null;
  }
  renderFileList();
  // 刷新当前页面显示
  if (S.files.length) {
    renderFileTabs();
    renderTable();
    updHdr();
    popGCol();
    renderGrpCards();
    renderL2FileTabs();
    updSbStats();
  }
  debouncedSave();
}

function renderFileList() {
  const div = document.getElementById('fileList');
  if (!S.files.length) { div.innerHTML = ''; document.getElementById('uploadActions').style.display = 'none'; return; }
  document.getElementById('uploadActions').style.display = '';
  let html = '';
  S.files.forEach(f => {
    html += `<div class="file-card" data-fid="${f.id}">
      <span class="file-card-icon">&#128202;</span>
      <div class="file-card-info">
        <div class="file-card-name">${esc(f.name)}</div>
        <div class="file-card-meta">${f.raw.length} 行 &middot; ${f.hdr.length} 列</div>
      </div>
      <span class="file-card-remove" data-fid="${f.id}">&times;</span>
    </div>`;
  });
  div.innerHTML = html;
  div.querySelectorAll('.file-card-remove').forEach(btn => {
    btn.addEventListener('click', () => removeFile(+btn.dataset.fid));
  });
}

// ========== 渲染: 文件标签 ==========
function renderFileTabs() {
  const div = document.getElementById('fileTabs');
  if (!div) return;
  let html = '';
  S.files.forEach(f => {
    const on = f.id === S.activeFileId ? 'on' : '';
    html += `<span class="ftab ${on}" data-fid="${f.id}">${esc(f.name)}<span class="rx" data-fid="${f.id}">&times;</span></span>`;
  });
  div.innerHTML = html;
  div.querySelectorAll('.ftab').forEach(el => el.addEventListener('click', e => {
    if (e.target.classList.contains('rx')) { removeFile(+e.target.dataset.fid); renderFileTabs(); return; }
    S.activeFileId = +el.dataset.fid;
    renderFileTabs();
    renderTable();
    updHdr();
    syncPreprocessColSel();
  }));
}

// ========== 渲染: 数据表格（含虚拟滚动） ==========
const VIRTUAL_ROW_H = 29; // 估算每行高度
const VIRTUAL_BUFFER = 15; // 上下缓冲行数
let _lastScrollTop = 0;
let _rafPending = false;

function renderTable() {
  const thead = document.getElementById('dth'), tbody = document.getElementById('dtb');
  const f = getActiveFile();
  if (!f) return;
  const hdr = f.hdr, l1 = f.l1, data = getSortedData(getFilteredData()), hidden = f.hiddenCols;
  let hh = '<tr><th style="width:34px"><div class="th-inner"><span class="th-name">#</span></div></th>';
  hdr.forEach(col => {
    if (hidden.has(col)) return;
    const cf = l1[col];
    const isActive = cf && cf.checked && cf.checked.size < uniq(col).length;
    const isCascade = cf && cf.cascade;
    const dependLabel = isCascade && cf.dependCol ? `→ ${cf.dependCol}` : '';
    const isSort = cf && cf.sort;
    const sortIcon = isSort === 'asc' ? '▲' : isSort === 'desc' ? '▼' : '⇅';
    const hasCond = cf && cf.condOn && cf.condVal !== '';
    hh += `<th data-col="${esc(col)}"><div class="th-inner">
      <span class="th-grip" title="拖拽调换列">⠿</span>
      <span class="th-name">${esc(col)}${hasCond ? ' *' : ''}</span>
      ${isCascade ? `<span class="th-dep on" data-col="${esc(col)}" title="级联: ${esc(cf.dependCol)}">${dependLabel}</span>` : `<span class="th-dep off" data-col="${esc(col)}" title="无依赖">○</span>`}
      <span class="th-fbtn ${isActive ? 'on' : ''}" data-col="${esc(col)}" title="过滤">▾</span>
      <span class="th-sort ${isSort ? 'on' : ''}" data-col="${esc(col)}" title="排序">${sortIcon}</span>
      <span class="th-hide" data-col="${esc(col)}" title="隐藏此列">✕</span>
    </div></th>`;
  });
  hh += '</tr>';
  thead.innerHTML = hh;

  // 虚拟滚动：大数据只渲染可见行
  const totalRows = data.length;
  if (totalRows > 200) {
    renderVirtualTable(data, hdr, hidden, tbody, totalRows);
  } else {
    let bb = '';
    data.forEach((r, i) => {
      bb += `<tr data-ridx="${i}"><td class="ti">${i + 1}</td>`;
      hdr.forEach(c => { if (!hidden.has(c)) bb += `<td data-col="${esc(c)}" data-ridx="${i}" title="${esc(String(r[c] ?? ''))}">${esc(String(r[c] ?? ''))}</td>`; });
      bb += '</tr>';
    });
    tbody.innerHTML = bb;
  }

  bindTableEvents(thead, f);
}

function renderVirtualTable(data, hdr, hidden, tbody, totalRows) {
  const wrap = document.getElementById('tableWrap');
  const scrollTop = wrap.scrollTop;
  const viewH = wrap.clientHeight;
  const totalH = totalRows * VIRTUAL_ROW_H;
  // 计算可见范围
  const startIdx = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_H) - VIRTUAL_BUFFER);
  const endIdx = Math.min(totalRows, Math.ceil((scrollTop + viewH) / VIRTUAL_ROW_H) + VIRTUAL_BUFFER);

  const frag = document.createDocumentFragment();
  // 顶部占位
  const spacerTop = document.createElement('tr');
  spacerTop.innerHTML = `<td colspan="99" style="height:${startIdx * VIRTUAL_ROW_H}px;padding:0;border:none"></td>`;
  frag.appendChild(spacerTop);

  for (let i = startIdx; i < endIdx; i++) {
    const r = data[i];
    const tr = document.createElement('tr');
    tr.dataset.ridx = i;
    let cells = `<td class="ti">${i + 1}</td>`;
    hdr.forEach(c => { if (!hidden.has(c)) cells += `<td data-col="${esc(c)}" data-ridx="${i}" title="${esc(String(r[c] ?? ''))}">${esc(String(r[c] ?? ''))}</td>`; });
    tr.innerHTML = cells;
    frag.appendChild(tr);
  }
  // 底部占位
  const spacerBottom = document.createElement('tr');
  spacerBottom.innerHTML = `<td colspan="99" style="height:${(totalRows - endIdx) * VIRTUAL_ROW_H}px;padding:0;border:none"></td>`;
  frag.appendChild(spacerBottom);

  tbody.innerHTML = '';
  tbody.appendChild(frag);
}

// 虚拟滚动监听
document.getElementById('tableWrap').addEventListener('scroll', function() {
  const f = getActiveFile();
  if (!f) return;
  const data = getSortedData(getFilteredData());
  if (data.length <= 200) return;
  if (_rafPending) return;
  _rafPending = true;
  requestAnimationFrame(() => {
    _rafPending = false;
    const tbody = document.getElementById('dtb');
    renderVirtualTable(data, f.hdr, f.hiddenCols, tbody, data.length);
  });
});

function bindTableEvents(thead, f) {
  thead.querySelectorAll('.th-fbtn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openFD(b.dataset.col, b); }));
  thead.querySelectorAll('.th-dep').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openFD(b.dataset.col, b, true); }));
  thead.querySelectorAll('.th-sort').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const col = b.dataset.col, l1 = getActiveFile().l1;
    getActiveHdr().forEach(c => { if (c !== col) l1[c].sort = null; });
    const cf = l1[col];
    if (!cf.sort) cf.sort = 'asc';
    else if (cf.sort === 'asc') cf.sort = 'desc';
    else cf.sort = null;
    renderTable();
    updHdr();
  }));
  // 列拖拽
  thead.querySelectorAll('.th-grip').forEach(grip => {
    grip.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      const srcTh = grip.closest('th'), srcCol = srcTh.dataset.col;
      srcTh.classList.add('dragging');
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      const onMove = ev => {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const tgtTh = el ? el.closest('th[data-col]') : null;
        thead.querySelectorAll('th[data-col]').forEach(t => t.classList.remove('drag-over'));
        if (tgtTh && tgtTh.dataset.col !== srcCol) tgtTh.classList.add('drag-over');
      };
      const onUp = ev => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        srcTh.classList.remove('dragging');
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const tgtTh = el ? el.closest('th[data-col]') : null;
        thead.querySelectorAll('th[data-col]').forEach(t => t.classList.remove('drag-over'));
        if (tgtTh && tgtTh.dataset.col !== srcCol) {
          const si = f.hdr.indexOf(srcCol), ti = f.hdr.indexOf(tgtTh.dataset.col);
          if (si >= 0 && ti >= 0) { f.hdr.splice(si, 1); f.hdr.splice(ti, 0, srcCol); renderTable(); ntf('列顺序已调整'); }
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
  // 列隐藏
  thead.querySelectorAll('.th-hide').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const col = btn.dataset.col;
    f.hiddenCols.add(col);
    renderTable();
    updHdr();
    ntf(`已隐藏 "${col}"`);
  }));
  // 双击编辑单元格（只绑定一次）
  const tbody = document.getElementById('dtb');
  if (!tbody._editBound) {
    tbody._editBound = true;
    tbody.addEventListener('dblclick', e => {
    const td = e.target.closest('td[data-col]');
    if (!td || td.classList.contains('ti')) return;
    if (td.querySelector('input')) return; // 已在编辑
    const col = td.dataset.col;
    const ridx = +td.dataset.ridx;
    const filtered = getSortedData(getFilteredData());
    const row = filtered[ridx];
    if (!row) return;
    const oldVal = String(row[col] ?? '');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldVal;
    input.className = 'cell-edit-input';
    td.textContent = '';
    td.appendChild(input);
    input.focus();
    input.select();
    const finish = (save) => {
      if (save) {
        const newVal = input.value;
        if (newVal !== oldVal) {
          row[col] = newVal;
          td.title = newVal;
          debouncedSave();
        }
      }
      td.textContent = String(row[col] ?? '');
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    });
  }

  // 行悬停高亮：通过动态样式表实现，虚拟滚动兼容（只绑定一次）
  let _hoverStyle = document.getElementById('_hoverColStyle');
  if (!_hoverStyle) { _hoverStyle = document.createElement('style'); _hoverStyle.id = '_hoverColStyle'; document.head.appendChild(_hoverStyle); }
  const dataTable = document.getElementById('dataTable');
  if (!dataTable._hoverBound) {
    dataTable._hoverBound = true;
    dataTable.addEventListener('mouseover', e => {
      const td = e.target.closest('td[data-col]');
      if (td) {
        const ridx = td.dataset.ridx;
        if (ridx != null) {
          _hoverStyle.textContent = `.data-table tr[data-ridx="${ridx}"] td{background:var(--acg)!important;transition:background .08s}`;
        }
      }
    });
    dataTable.addEventListener('mouseout', e => {
      if (!e.relatedTarget || !dataTable.contains(e.relatedTarget)) {
        _hoverStyle.textContent = '';
      } else {
        const nextTd = e.relatedTarget.closest ? e.relatedTarget.closest('td[data-col]') : null;
        if (!nextTd) _hoverStyle.textContent = '';
      }
    });
  }
}

function updHdr() {
  const f = getActiveFile();
  if (!f) return;
  const fd = getFilteredData();
  document.getElementById('sAll').textContent = f.raw.length;
  document.getElementById('sFil').textContent = fd.length;
  const visCols = f.hdr.length - f.hiddenCols.size;
  document.getElementById('sCol').textContent = visCols + (f.hiddenCols.size ? `/${f.hdr.length}` : '');
  updColMgr();
}

// ========== 过滤下拉 ==========
const fdOv = document.getElementById('fdOv'), fdDd = document.getElementById('fdDd'), fdL = document.getElementById('fdL');

function openFD(col, anchor, focusCascade = false) {
  S.l1EditCol = col;
  document.getElementById('fdCn').textContent = col;
  document.getElementById('fdSe').value = '';
  const f = getActiveFile().l1[col];
  document.getElementById('fdCascade').checked = f.cascade || false;
  const depSel = document.getElementById('fdDepCol');
  const hdr = getActiveHdr();
  const colIdx = hdr.indexOf(col);
  depSel.innerHTML = '<option value="">-- 选择依赖列 --</option>';
  for (let i = 0; i < colIdx; i++) depSel.innerHTML += `<option value="${esc(hdr[i])}">${esc(hdr[i])}</option>`;
  depSel.value = f.dependCol || '';
  depSel.style.display = f.cascade ? 'block' : 'none';
  updateCasInfo();
  const baseData = f.cascade && f.dependCol ? getDataFilteredForCol(col) : getActiveRaw();
  const valSet = new Set();
  baseData.forEach(r => valSet.add(String(r[col] ?? '')));
  const vals = [...valSet].sort();
  const allVals = uniq(col);
  S.l1Temp = {
    checked: new Map(), cascade: f.cascade, dependCol: f.dependCol,
    sort: f.sort || null, condOn: f.condOn || false,
    condOp: f.condOp || 'eq', condVal: f.condVal || ''
  };
  allVals.forEach(v => {
    const inScope = vals.includes(v);
    const cur = f.checked ? f.checked.has(v) : true;
    S.l1Temp.checked.set(v, inScope ? cur : false);
  });
  document.querySelectorAll('.fd-sort .sbtn').forEach(b => b.classList.toggle('on', b.dataset.s === (S.l1Temp.sort || '')));
  const condCb = document.getElementById('fdCondOn'), condRow = document.getElementById('fdCondRow');
  const condOp = document.getElementById('fdCondOp'), condVal = document.getElementById('fdCondVal');
  condCb.checked = S.l1Temp.condOn;
  condRow.style.display = S.l1Temp.condOn ? 'flex' : 'none';
  condOp.value = S.l1Temp.condOp;
  condVal.value = S.l1Temp.condVal;
  renderFDList('');
  const rect = anchor.closest('th').getBoundingClientRect();
  let left = rect.left, top = rect.bottom + 2;
  if (left + 300 > window.innerWidth) left = window.innerWidth - 308;
  if (top + 480 > window.innerHeight) top = rect.top - 480;
  fdDd.style.left = left + 'px';
  fdDd.style.top = top + 'px';
  fdDd.style.width = '300px';
  fdOv.classList.add('vis');
  fdDd.classList.add('vis');
  (focusCascade ? document.getElementById('fdCascade') : document.getElementById('fdSe')).focus();
}

function updateCasInfo() {
  const casInfo = document.getElementById('fdCasInfo');
  const casCb = document.getElementById('fdCascade');
  const depSel = document.getElementById('fdDepCol');
  if (casCb.checked && depSel.value) {
    const depCol = depSel.value;
    const depF = getActiveFile().l1[depCol];
    const isF = depF && depF.checked && depF.checked.size < uniq(depCol).length;
    const vs = isF ? [...depF.checked] : uniq(depCol);
    casInfo.innerHTML = `依赖 <b>${esc(depCol)}</b> (${isF ? '已过滤' : '未过滤'}: ${vs.slice(0, 5).map(v => esc(v)).join(',')}${vs.length > 5 ? '...' : ''})`;
    casInfo.style.display = 'block';
  } else {
    casInfo.innerHTML = '限定在此列的过滤结果内';
    casInfo.style.display = casCb.checked ? 'block' : 'none';
  }
}

function recomputeFDVals() {
  const col = S.l1EditCol;
  const cascade = document.getElementById('fdCascade').checked;
  const dependCol = document.getElementById('fdDepCol').value;
  const allVals = uniq(col);
  allVals.forEach(v => S.l1Temp.checked.set(v, true));
  S.l1Temp.cascade = cascade;
  S.l1Temp.dependCol = cascade ? dependCol : null;
  renderFDList(document.getElementById('fdSe').value);
}

function renderFDList(search) {
  const col = S.l1EditCol;
  const allVals = uniq(col);
  const cascade = S.l1Temp.cascade;
  const dependCol = S.l1Temp.dependCol;
  const baseData = cascade && dependCol ? getDataFilteredForCol(col) : getActiveRaw();
  const scopeSet = new Set();
  baseData.forEach(r => scopeSet.add(String(r[col] ?? '')));
  let displayVals = allVals;
  if (search) displayVals = displayVals.filter(v => v.toLowerCase().includes(search.toLowerCase()));
  const checkedCount = [...S.l1Temp.checked.entries()].filter(([, v]) => v).length;
  document.getElementById('fdCnt').textContent = `${checkedCount}/${allVals.length}${cascade && dependCol ? ` (${scopeSet.size}可选)` : ''}`;
  let html = '';
  displayVals.forEach(v => {
    const inScope = scopeSet.has(v);
    const cnt = inScope ? baseData.filter(r => String(r[col] ?? '') === v).length : 0;
    html += `<div class="fd-item" data-v="${esc(v)}" style="${!inScope ? 'opacity:.35' : ''}">
      <input type="checkbox" ${S.l1Temp.checked.get(v) ? 'checked' : ''} ${!inScope ? 'disabled' : ''}>
      <span class="vl">${esc(v)}${!inScope ? ' (外)' : ''}</span>
      <span class="vc">${cnt}</span>
    </div>`;
  });
  fdL.innerHTML = html;
  fdL.querySelectorAll('.fd-item').forEach(item => {
    item.addEventListener('click', () => {
      const cb = item.querySelector('input');
      if (cb.disabled) return;
      cb.checked = !cb.checked;
      S.l1Temp.checked.set(item.dataset.v, cb.checked);
      const cc = [...S.l1Temp.checked.entries()].filter(([, v]) => v).length;
      document.getElementById('fdCnt').textContent = `${cc}/${allVals.length}`;
    });
  });
}

// Filter事件绑定
document.getElementById('fdSe').addEventListener('input', e => renderFDList(e.target.value));
document.getElementById('fdCascade').addEventListener('change', () => {
  const ds = document.getElementById('fdDepCol');
  const checked = document.getElementById('fdCascade').checked;
  ds.style.display = checked ? 'block' : 'none';
  if (checked && !ds.value) {
    // 自动默认选择前一列
    const hdr = getActiveHdr();
    const colIdx = hdr.indexOf(S.l1EditCol);
    if (colIdx > 0) ds.value = hdr[colIdx - 1];
  }
  if (!checked) ds.value = '';
  updateCasInfo();
  recomputeFDVals();
  // 勾选级联后自动选中范围内的值
  if (checked && ds.value) autoSelectCascadeScope();
});
document.getElementById('fdDepCol').addEventListener('change', () => { updateCasInfo(); recomputeFDVals(); autoSelectCascadeScope(); });

function autoSelectCascadeScope() {
  // 自动将级联范围内的值设为勾选，范围外的取消
  const cascade = document.getElementById('fdCascade').checked;
  const dependCol = document.getElementById('fdDepCol').value;
  if (!cascade || !dependCol) return;
  const col = S.l1EditCol;
  const baseData = getDataFilteredForCol(col);
  const scopeSet = new Set();
  baseData.forEach(r => scopeSet.add(String(r[col] ?? '')));
  S.l1Temp.checked.forEach((_, k) => {
    S.l1Temp.checked.set(k, scopeSet.has(k));
  });
  renderFDList(document.getElementById('fdSe').value);
}
document.getElementById('fdAll').addEventListener('click', () => {
  const col = S.l1EditCol;
  const baseData = S.l1Temp.cascade && S.l1Temp.dependCol ? getDataFilteredForCol(col) : getActiveRaw();
  const ss = new Set();
  baseData.forEach(r => ss.add(String(r[col] ?? '')));
  S.l1Temp.checked.forEach((_, k) => S.l1Temp.checked.set(k, ss.has(k)));
  renderFDList(document.getElementById('fdSe').value);
});
document.getElementById('fdNone').addEventListener('click', () => {
  S.l1Temp.checked.forEach((_, k) => S.l1Temp.checked.set(k, false));
  renderFDList(document.getElementById('fdSe').value);
});
document.querySelectorAll('.fd-sort .sbtn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.fd-sort .sbtn').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  S.l1Temp.sort = b.dataset.s || null;
}));
document.getElementById('fdCondOn').addEventListener('change', e => {
  S.l1Temp.condOn = e.target.checked;
  document.getElementById('fdCondRow').style.display = e.target.checked ? 'flex' : 'none';
});
document.getElementById('fdCondOp').addEventListener('change', e => S.l1Temp.condOp = e.target.value);
document.getElementById('fdCondVal').addEventListener('input', e => S.l1Temp.condVal = e.target.value);

document.getElementById('fdOk').addEventListener('click', () => {
  const col = S.l1EditCol, l1 = getActiveFile().l1, allVals = uniq(col);
  const checkedVals = new Set();
  S.l1Temp.checked.forEach((v, k) => { if (v) checkedVals.add(k); });
  l1[col] = {
    checked: checkedVals.size === allVals.length ? null : checkedVals,
    cascade: S.l1Temp.cascade, dependCol: S.l1Temp.dependCol,
    sort: S.l1Temp.sort, condOn: S.l1Temp.condOn,
    condOp: S.l1Temp.condOp, condVal: S.l1Temp.condVal
  };
  if (S.l1Temp.sort) { getActiveHdr().forEach(c => { if (c !== col) l1[c].sort = null; }); }
  closeFD();
  renderTable();
  updHdr();
  popGCol();
  ntf('过滤已应用');
});
document.getElementById('fdX').addEventListener('click', closeFD);
fdOv.addEventListener('click', closeFD);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFD(); });

function closeFD() { fdOv.classList.remove('vis'); fdDd.classList.remove('vis'); S.l1EditCol = null; S.l1Temp = null; }

// ========== 列管理 ==========
const cmOv = document.getElementById('cmOv'), cmDd = document.getElementById('cmDd'), cmList = document.getElementById('cmList');

function updColMgr() {
  const f = getActiveFile();
  if (!f) return;
  let html = '';
  f.hdr.forEach(col => {
    const isHidden = f.hiddenCols.has(col);
    html += `<div class="cm-item${isHidden ? ' hidden' : ''}" data-col="${esc(col)}">
      <input type="checkbox" ${isHidden ? '' : 'checked'}>
      <span class="vl">${esc(col)}</span>
      ${isHidden ? '<span class="cm-tag">已隐藏</span>' : ''}
    </div>`;
  });
  cmList.innerHTML = html;
  const vis = f.hdr.length - f.hiddenCols.size;
  document.getElementById('cmCnt').textContent = `${vis}/${f.hdr.length} 可见`;
  cmList.querySelectorAll('.cm-item').forEach(item => item.addEventListener('click', () => {
    const col = item.dataset.col, cb = item.querySelector('input');
    if (cb.disabled) return;
    cb.checked = !cb.checked;
    if (cb.checked) {
      f.hiddenCols.delete(col);
      item.classList.remove('hidden');
      item.querySelector('.cm-tag')?.remove();
    } else {
      f.hiddenCols.add(col);
      item.classList.add('hidden');
      if (!item.querySelector('.cm-tag')) {
        const tag = document.createElement('span');
        tag.className = 'cm-tag';
        tag.textContent = '已隐藏';
        item.appendChild(tag);
      }
    }
    const v = f.hdr.length - f.hiddenCols.size;
    document.getElementById('cmCnt').textContent = `${v}/${f.hdr.length} 可见`;
    renderTable();
    updHdr();
  }));
}

document.getElementById('btnColMgr').addEventListener('click', e => {
  const f = getActiveFile();
  if (!f) return;
  updColMgr();
  const rect = e.target.closest('.toolbar').getBoundingClientRect();
  cmDd.style.left = Math.min(rect.right - 280, window.innerWidth - 290) + 'px';
  cmDd.style.top = (rect.bottom + 2) + 'px';
  cmOv.classList.add('vis');
  cmDd.classList.add('vis');
});
document.getElementById('cmShowAll').addEventListener('click', () => {
  const f = getActiveFile();
  if (!f) return;
  f.hiddenCols.clear();
  updColMgr();
  renderTable();
  updHdr();
  ntf('全部列已显示');
});
document.getElementById('cmX').addEventListener('click', () => { cmOv.classList.remove('vis'); cmDd.classList.remove('vis'); });
cmOv.addEventListener('click', () => { cmOv.classList.remove('vis'); cmDd.classList.remove('vis'); });

document.getElementById('btnClrL1').addEventListener('click', () => {
  const f = getActiveFile();
  if (!f) return;
  f.hdr.forEach(c => { f.l1[c] = newL1(); });
  renderTable();
  updHdr();
  popGCol();
  ntf('L1已清空');
});

// ========== L2 逐文件预览 ==========
function updateL2DataInfo(totalRows, filteredRows) {
  const el = document.getElementById('l2DataInfo');
  if (!el) return;
  if (!totalRows) { el.style.display = 'none'; return; }
  el.style.display = 'inline-flex';
  const splitNote = (S.splitMatchedRows && S.splitFileId) ? ' (已拆分过滤)' : '';
  el.innerHTML = `<span class="ldi-label">当前数据</span><span class="ldi-val">${filteredRows}</span><span class="ldi-unit">条</span><span class="ldi-total">/ 共${totalRows}条${splitNote}</span>`;
}

function renderL2FileTabs() {
  const div = document.getElementById('l2FileTabs');
  if (!div) return;
  if (!S.files.length) { div.innerHTML = ''; document.getElementById('l2Preview').style.display = 'none'; updateL2DataInfo(0, 0); return; }
  let html = '';
  S.files.forEach(f => {
    const on = f.id === S.activeFileId ? 'on' : '';
    html += `<span class="l2-ftab ${on}" data-fid="${f.id}">${esc(f.name)}</span>`;
  });
  div.innerHTML = html;
  div.querySelectorAll('.l2-ftab').forEach(el => el.addEventListener('click', () => {
    S.activeFileId = +el.dataset.fid;
    renderL2FileTabs();
    renderTable();
    updHdr();
    popGCol();
    renderGrpCards();
  }));
  renderL2Preview();
}

function renderL2Preview() {
  const div = document.getElementById('l2Preview');
  const f = getActiveFile();
  if (!f || !f.raw.length) { div.style.display = 'none'; updateL2DataInfo(0, 0); return; }
  div.style.display = 'block';
  let l1Data = getFilteredData();
  l1Data = filterBySplitMatch(l1Data, f);
  // 更新数据条数信息
  updateL2DataInfo(f.raw.length, l1Data.length);
  const previewRows = l1Data.slice(0, 3);
  const hidden = f.hiddenCols;
  const visCols = f.hdr.filter(c => !hidden.has(c));
  let html = `<div class="l2-preview-title">${esc(f.name)} - ${l1Data.length} 行数据预览</div>`;
  html += '<table class="l2-preview-table"><thead><tr>';
  visCols.forEach(c => html += `<th>${esc(c)}</th>`);
  html += '</tr></thead><tbody>';
  previewRows.forEach(r => {
    html += '<tr>';
    visCols.forEach(c => html += `<td title="${esc(String(r[c] ?? ''))}">${esc(String(r[c] ?? ''))}</td>`);
    html += '</tr>';
  });
  if (!previewRows.length) html += '<tr><td colspan="99" style="text-align:center;color:var(--t3)">无数据</td></tr>';
  html += '</tbody></table>';
  div.innerHTML = html;
}

// ========== L2 分组 ==========
function popGCol() {
  const sel = document.getElementById('gCol');
  const v = sel.value;
  sel.innerHTML = '<option value="">-- 选择列 --</option>';
  getActiveHdr().forEach(c => sel.innerHTML += `<option value="${esc(c)}">${esc(c)}</option>`);
  if (v) sel.value = v;
}

document.getElementById('l2Tog').addEventListener('click', () => {
  const t = document.getElementById('l2Tog'), b = document.getElementById('l2Body');
  t.classList.toggle('open');
  b.classList.toggle('open');
});

document.getElementById('gCol').addEventListener('change', e => {
  S.selGVals = [];
  const col = e.target.value;
  if (col) { renderVP2(col); showL2BaseInfo(col); popDepGrp(); }
  else { document.getElementById('vp2').innerHTML = ''; document.getElementById('l2BaseInfo').style.display = 'none'; }
});

function popDepGrp() {
  const div = document.getElementById('gDepGrpList'), f = getActiveFile();
  if (!div) return;
  div.innerHTML = '';
  const l1Grps = f.grps.filter(g => g.level === 1);
  if (!l1Grps.length) { div.innerHTML = '<span style="color:var(--t3);font-size:11px">暂无1级分组</span>'; document.getElementById('l2RelF').style.display = 'none'; return; }
  l1Grps.forEach(g => {
    const lbl = document.createElement('label');
    lbl.className = 'dep-chk-label';
    lbl.innerHTML = `<input type="checkbox" value="${g.id}" class="dep-chk"> ${esc(g.name)}`;
    div.appendChild(lbl);
  });
  div.querySelectorAll('.dep-chk').forEach(chk => chk.addEventListener('change', () => {
    document.getElementById('l2RelF').style.display = div.querySelectorAll('.dep-chk:checked').length ? 'flex' : 'none';
  }));
}
// 兼容：获取选中的依托分组
function getDepGrpIds() {
  const checked = document.querySelectorAll('#gDepGrpList .dep-chk:checked');
  return Array.from(checked).map(c => +c.value);
}

function showL2BaseInfo(col) {
  const f = getActiveFile(), info = document.getElementById('l2BaseInfo'), l1f = f.l1[col];
  const isActive = l1f && l1f.checked && l1f.checked.size < uniq(col).length;
  info.innerHTML = `依托列: <b>${esc(col)}</b> ${isActive ? `L1已过滤 (${[...l1f.checked].length}/${uniq(col).length})` : ''}<br><span style="color:var(--t3)">虚线框 = L1范围外的值，仍可组合</span>`;
  info.style.display = 'block';
}

function renderVP2(col) {
  const f = getActiveFile(), pk = document.getElementById('vp2'), fd = getFilteredData();
  const inScopeVals = uniq(col, fd), inScopeSet = new Set(inScopeVals), allVals = uniq(col);
  const grouped = new Set();
  f.grps.forEach(g => { if (g.column === col) g.values.forEach(v => grouped.add(String(v))); });
  const inScope = allVals.filter(v => inScopeSet.has(v)), outScope = allVals.filter(v => !inScopeSet.has(v));
  let html = '';
  [...inScope, ...outScope].forEach(v => {
    const isG = grouped.has(v), isS = S.selGVals.includes(v), isIn = inScopeSet.has(v);
    let cls = 'vp2-i';
    if (isS) cls += ' sel';
    if (isG) cls += ' grp';
    if (!isIn) cls += ' l1out';
    html += `<div class="${cls}" data-v="${esc(v)}">${esc(!isIn ? v + ' (L1外)' : v)}</div>`;
  });
  pk.innerHTML = html;
  pk.querySelectorAll('.vp2-i').forEach(el => el.addEventListener('click', () => {
    const v = el.dataset.v;
    if (S.selGVals.includes(v)) { S.selGVals = S.selGVals.filter(x => x !== v); el.classList.remove('sel'); }
    else { S.selGVals.push(v); el.classList.add('sel'); }
  }));
}

document.querySelectorAll('.gco').forEach(o => o.addEventListener('click', () => {
  document.querySelectorAll('.gco').forEach(x => x.classList.remove('sel'));
  o.classList.add('sel');
  S.selGColor = o.dataset.c;
}));

document.getElementById('btnAddGrp').addEventListener('click', () => {
  const f = getActiveFile(), col = document.getElementById('gCol').value, name = document.getElementById('gName').value.trim();
  const pGroupIds = getDepGrpIds(), pRel = document.getElementById('gDepRel').value;
  if (!col) { ntf('请选择列', 'error'); return; }
  if (!name) { ntf('请输入分组名', 'error'); return; }
  if (!S.selGVals.length) { ntf('请选择值', 'error'); return; }
  const l1f = f.l1[col];
  f.grps.push({
    id: ++f.gid, name, color: S.selGColor, column: col, values: [...S.selGVals],
    l1Dep: {col, cascade: l1f.cascade, dependCol: l1f.dependCol, filtered: l1f.checked && l1f.checked.size < uniq(col).length},
    parentIds: pGroupIds.length ? pGroupIds : [],
    parentRels: pGroupIds.length ? pGroupIds.map(() => pRel) : [],
    // 向后兼容
    parentId: pGroupIds.length ? pGroupIds[0] : null,
    parentRel: pGroupIds.length ? pRel : null
  });
  S.selGVals = [];
  document.getElementById('gName').value = '';
  renderVP2(col);
  renderGrpCards();
  popDepGrp();
  ntf(`分组 "${name}" 已创建`);
});

// 创建1级分组
document.getElementById('btnAddL1Grp').addEventListener('click', () => {
  const f = getActiveFile();
  if (!f || !f.grps.length) { ntf('请先创建普通分组', 'error'); return; }
  showL1GroupDialog();
});

function showL1GroupDialog() {
  const f = getActiveFile();
  const nonL1Grps = f.grps.filter(g => g.level !== 1);
  if (!nonL1Grps.length) { ntf('无可用子分组', 'error'); return; }

  const overlay = document.createElement('div');
  overlay.className = 'fd-overlay vis';
  const dd = document.createElement('div');
  dd.className = 'fd-dropdown vis';
  dd.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%);width:420px;max-height:560px;';
  let html = '<div class="fd-head"><span class="fd-cn">创建1级分组</span></div>';
  html += '<div style="padding:12px 14px;display:flex;flex-direction:column;gap:8px">';
  html += '<div style="display:flex;gap:8px;align-items:center"><label style="font-size:12px;color:var(--t3);white-space:nowrap">分组名</label><input id="l1GrpName" placeholder="如：行业" style="flex:1;background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:6px 10px;color:var(--t1);font:12px var(--sf);outline:none"></div>';
  html += '<div style="display:flex;gap:8px;align-items:center"><label style="font-size:12px;color:var(--t3);white-space:nowrap">颜色</label><div class="gcolors" id="l1GCols">';
  GROUP_COLORS.forEach((c, i) => {
    html += `<div class="gco c-${c}${i === 0 ? ' sel' : ''}" data-c="${c}"></div>`;
  });
  html += '</div></div>';
  html += '<label style="font-size:11px;color:var(--t3)">选择子分组（点击选择/取消）</label>';
  html += '<div class="fd-value-list" style="max-height:260px">';
  nonL1Grps.forEach(g => {
    const cm = CM[g.color] || CM.blue;
    html += `<div class="fd-item l1-child-item" data-gid="${g.id}" style="gap:8px;padding:8px 14px"><span class="cdot" style="background:${cm.d};width:8px;height:8px;border-radius:50%;flex-shrink:0"></span><span style="font-size:12px">${esc(g.name)}</span><span style="font-size:10px;color:var(--t3);margin-left:auto">${esc(g.column)}</span></div>`;
  });
  html += '</div></div>';
  html += '<div class="fd-foot"><span class="fd-cnt" id="l1SelCnt">0 个已选</span><div class="fd-btns"><button class="btn btn-ghost btn-xs" id="l1Cancel">取消</button><button class="btn btn-primary btn-xs" id="l1Ok">创建</button></div></div>';
  dd.innerHTML = html;
  document.body.appendChild(overlay);
  document.body.appendChild(dd);

  let l1Color = GROUP_COLORS[0];
  const selectedIds = new Set();

  // 颜色选择
  dd.querySelectorAll('#l1GCols .gco').forEach(el => el.addEventListener('click', () => {
    dd.querySelectorAll('#l1GCols .gco').forEach(e => e.classList.remove('sel'));
    el.classList.add('sel');
    l1Color = el.dataset.c;
  }));

  // 子分组选择
  dd.querySelectorAll('.l1-child-item').forEach(item => item.addEventListener('click', () => {
    const gid = +item.dataset.gid;
    if (selectedIds.has(gid)) {
      selectedIds.delete(gid);
      item.style.background = '';
    } else {
      selectedIds.add(gid);
      item.style.background = 'var(--acg)';
    }
    dd.querySelector('#l1SelCnt').textContent = selectedIds.size + ' 个已选';
  }));

  const close = () => { overlay.remove(); dd.remove(); };
  overlay.addEventListener('click', close);
  dd.querySelector('#l1Cancel').addEventListener('click', close);
  dd.querySelector('#l1Ok').addEventListener('click', () => {
    const name = dd.querySelector('#l1GrpName').value.trim();
    if (!name) { ntf('请输入分组名', 'error'); return; }
    if (!selectedIds.size) { ntf('请选择至少一个子分组', 'error'); return; }
    f.grps.push({
      id: ++f.gid,
      name,
      color: l1Color,
      column: '',
      values: [],
      l1Dep: null,
      parentId: null,
      parentRel: null,
      level: 1,
      childGroupIds: [...selectedIds]
    });
    close();
    renderGrpCards();
    popDepGrp();
    ntf(`1级分组 "${name}" 已创建，包含 ${selectedIds.size} 个子分组`);
  });
}

function renderGrpCards() {
  const f = getActiveFile();
  if (!f) return;
  const div = document.getElementById('grpCards');
  if (!f.grps.length) { div.innerHTML = ''; return; }

  // 找出被1级分组包含的子分组ID（这些会嵌套在1级分组内展示）
  const childOfL1 = new Set();
  f.grps.filter(g => g.level === 1 && g.childGroupIds).forEach(g => g.childGroupIds.forEach(id => childOfL1.add(id)));

  let html = '';
  f.grps.forEach(g => {
    const cm = CM[g.color] || CM.blue;
    const l1Info = g.l1Dep ? `L1:${esc(g.l1Dep.col)}` : '';

    if (g.level === 1) {
      // 1级分组：可折叠容器，包含子分组
      const childGrps = (g.childGroupIds || []).map(cid => f.grps.find(x => x.id === cid)).filter(Boolean);
      const childCount = childGrps.length;
      html += `<div class="gc-l1-card" data-l1id="${g.id}" draggable="true">
        <div class="gc-l1-header" data-toggle-l1="${g.id}">
          <span class="gc-dot" style="background:${cm.d}"></span>
          <span class="gc-n">${esc(g.name)}</span>
          <span class="gc-lv1">1级</span>
          <span class="gc-l1-count">${childCount}个子分组</span>
          <span class="gc-l1-arrow">&#9660;</span>
          <button class="btn btn-ghost btn-xs" data-edit="${g.id}" onclick="event.stopPropagation()">✎</button>
          <button class="btn btn-danger btn-xs" data-del="${g.id}" onclick="event.stopPropagation()">✕</button>
        </div>
        <div class="gc-l1-body" data-l1body="${g.id}">`;
      childGrps.forEach(cg => {
        const ccm = CM[cg.color] || CM.blue;
        html += `<div class="gc gc-nested" draggable="true" data-gid="${cg.id}">
          <div class="gc-h"><span class="gc-dot" style="background:${ccm.d}"></span><span class="gc-n">${esc(cg.name)}</span><span class="gc-col">${esc(cg.column)}</span><button class="btn btn-ghost btn-xs" data-edit="${cg.id}">✎</button><button class="btn btn-danger btn-xs" data-del="${cg.id}">✕</button></div>
          <div class="gc-vs">${cg.values.slice(0, 8).map(v => `<span class="gc-v ${ccm.t}">${esc(v)}</span>`).join('')}${cg.values.length > 8 ? `<span class="gc-v gc-more">+${cg.values.length - 8}</span>` : ''}</div>
        </div>`;
      });
      html += `</div></div>`;
    } else if (!childOfL1.has(g.id)) {
      // 不属于1级分组的普通分组
      let depHtml = '';
      if (g.parentId) {
        const pg = f.grps.find(x => x.id === g.parentId);
        if (pg) {
          const rc = g.parentRel === 'AND' ? 'rel-and' : 'rel-or';
          depHtml = `<div class="gc-dep"><span class="dep-arrow">↑</span> <span class="gc-rel ${rc}">${g.parentRel}</span> ${esc(pg.name)}</div>`;
        }
      }
      const children = f.grps.filter(x => x.parentId === g.id);
      let chHtml = '';
      if (children.length) {
        chHtml = '<div class="gc-dep"><span style="color:var(--t3)">↓</span> ' + children.map(c => {
          const rc = c.parentRel === 'AND' ? 'rel-and' : 'rel-or';
          return `<span class="gc-rel ${rc}">${c.parentRel}</span> ${esc(c.name)}`;
        }).join(' · ') + '</div>';
      }
      html += `<div class="gc" draggable="true" data-gid="${g.id}"><div class="gc-h"><span class="gc-dot" style="background:${cm.d}"></span><span class="gc-n">${esc(g.name)}</span><span class="gc-col">${esc(g.column)} ${l1Info}</span><button class="btn btn-ghost btn-xs" data-edit="${g.id}">✎</button><button class="btn btn-danger btn-xs" data-del="${g.id}">✕</button></div><div class="gc-vs">${g.values.slice(0, 8).map(v => `<span class="gc-v ${cm.t}">${esc(v)}</span>`).join('')}${g.values.length > 8 ? `<span class="gc-v gc-more">+${g.values.length - 8}</span>` : ''}</div>${depHtml}${chHtml}</div>`;
    }
    // 属于1级分组的子分组：已在上面嵌套渲染，跳过
  });
  div.innerHTML = html;

  // 绑定1级分组折叠/展开
  div.querySelectorAll('.gc-l1-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const l1id = hdr.dataset.toggleL1;
      const body = div.querySelector(`[data-l1body="${l1id}"]`);
      const card = hdr.closest('.gc-l1-card');
      if (body) {
        body.classList.toggle('gc-l1-body-open');
        card.classList.toggle('gc-l1-card-open');
      }
    });
  });

  // 绑定编辑
  div.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const gid = +b.dataset.edit;
    showEditGroupDialog(gid);
  }));

  // 绑定删除
  div.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const gid = +b.dataset.del;
    const f = getActiveFile();
    const g = f.grps.find(x => x.id === gid);
    if (g && g.level === 1) {
      // 删除1级分组时，子分组变为独立分组
      f.grps = f.grps.filter(x => x.id !== gid);
    } else {
      // 删除子分组时，从1级分组的childGroupIds中也移除
      f.grps = f.grps.filter(x => x.id !== gid);
      f.grps.filter(x => x.level === 1 && x.childGroupIds).forEach(l1 => {
        l1.childGroupIds = l1.childGroupIds.filter(id => id !== gid);
      });
    }
    renderGrpCards();
    popDepGrp();
    ntf('分组已删除');
  }));

  // 拖拽排序 & 拖入1级分组
  bindGrpDrag(div);
}

function showEditGroupDialog(gid) {
  const f = getActiveFile();
  const g = f.grps.find(x => x.id === gid);
  if (!g) return;
  
  const overlay = document.createElement('div');
  overlay.className = 'fd-overlay vis';
  const dd = document.createElement('div');
  dd.className = 'gc-edit-pop';
  dd.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);';
  
  let html = `<div style="font-weight:600;font-size:13px;margin-bottom:8px">编辑分组</div>`;
  html += `<label>名称</label><input id="gepName" value="${esc(g.name)}">`;
  
  if (g.level !== 1) {
    // 2级分组可以编辑values
    html += `<label>列</label><input id="gepCol" value="${esc(g.column)}" disabled>`;
    html += `<label>值 (逗号分隔)</label><input id="gepVals" value="${esc((g.values || []).join(','))}">`;
  }
  // 颜色选择
  html += `<label>颜色</label><div class="gcolors" id="gepColors">`;
  GROUP_COLORS.forEach((c, i) => {
    html += `<div class="gco c-${c}${c === g.color ? ' sel' : ''}" data-c="${c}"></div>`;
  });
  html += '</div>';
  html += `<div class="gep-btns"><button class="btn btn-ghost btn-xs" id="gepCancel">取消</button><button class="btn btn-primary btn-xs" id="gepOk">保存</button></div>`;
  
  dd.innerHTML = html;
  document.body.appendChild(overlay);
  document.body.appendChild(dd);
  
  let selColor = g.color;
  dd.querySelectorAll('.gco').forEach(o => o.addEventListener('click', () => {
    dd.querySelectorAll('.gco').forEach(x => x.classList.remove('sel'));
    o.classList.add('sel');
    selColor = o.dataset.c;
  }));
  
  const close = () => { overlay.remove(); dd.remove(); };
  overlay.addEventListener('click', close);
  dd.querySelector('#gepCancel').addEventListener('click', close);
  dd.querySelector('#gepOk').addEventListener('click', () => {
    const newName = dd.querySelector('#gepName').value.trim();
    if (!newName) { ntf('名称不能为空', 'error'); return; }
    g.name = newName;
    g.color = selColor;
    if (g.level !== 1) {
      const valsInput = dd.querySelector('#gepVals');
      if (valsInput) g.values = valsInput.value.split(/[,，]/).map(v => v.trim()).filter(v => v);
    }
    close();
    renderGrpCards();
    popDepGrp();
    ntf('分组已更新');
  });
}

/* ===== 分组拖拽：排序 + 拖入1级分组 ===== */
let _dragGid = null;
let _dragSource = null; // 'top' | 'l1body' — 拖拽来源区域
function bindGrpDrag(container) {
  const f = getActiveFile();
  if (!f) return;

  // ---- 拖拽源：2级分组卡片 ----
  container.querySelectorAll('[data-gid]').forEach(el => {
    el.addEventListener('dragstart', e => {
      _dragGid = +el.dataset.gid;
      _dragSource = el.closest('.gc-l1-body') ? 'l1body' : 'top';
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('gc-dragging');
      // 给所有L1 body加提示
      container.querySelectorAll('.gc-l1-body').forEach(b => b.classList.add('gc-l1-drop-hint'));
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('gc-dragging');
      _dragGid = null; _dragSource = null;
      container.querySelectorAll('.gc-l1-drop-hint').forEach(b => b.classList.remove('gc-l1-drop-hint'));
      container.querySelectorAll('.gc-drop-over').forEach(b => b.classList.remove('gc-drop-over'));
      container.querySelectorAll('.gc-reorder-over').forEach(b => b.classList.remove('gc-reorder-over'));
    });
  });

  // ---- 拖拽源：1级分组卡片 ----
  container.querySelectorAll('.gc-l1-card[draggable]').forEach(el => {
    el.addEventListener('dragstart', e => {
      _dragGid = +el.dataset.l1id;
      _dragSource = 'top';
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('gc-dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('gc-dragging');
      _dragGid = null; _dragSource = null;
      container.querySelectorAll('.gc-reorder-over').forEach(b => b.classList.remove('gc-reorder-over'));
      container.querySelectorAll('.gc-drop-over').forEach(b => b.classList.remove('gc-drop-over'));
    });
  });

  // ---- Drop: 拖入L1分组body（将2级分组加入L1） ----
  container.querySelectorAll('.gc-l1-body').forEach(body => {
    body.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      body.classList.add('gc-drop-over');
    });
    body.addEventListener('dragleave', e => {
      // 只有真正离开body时才移除样式
      if (!body.contains(e.relatedTarget)) body.classList.remove('gc-drop-over');
    });
    body.addEventListener('drop', e => {
      e.preventDefault();
      body.classList.remove('gc-drop-over');
      if (_dragGid == null) return;
      const l1id = +body.dataset.l1body;
      const l1 = f.grps.find(x => x.id === l1id);
      const g = f.grps.find(x => x.id === _dragGid);
      if (!l1 || !g || g.level === 1) return;
      if (l1.childGroupIds && l1.childGroupIds.includes(g.id)) return;
      // 从其他L1中移除
      f.grps.filter(x => x.level === 1 && x.childGroupIds).forEach(l1g => {
        l1g.childGroupIds = l1g.childGroupIds.filter(id => id !== g.id);
      });
      if (!l1.childGroupIds) l1.childGroupIds = [];
      // 插入到目标位置
      const dropTarget = e.target.closest('[data-gid]');
      if (dropTarget) {
        const tgid = +dropTarget.dataset.gid;
        const tidx = l1.childGroupIds.indexOf(tgid);
        if (tidx >= 0) {
          l1.childGroupIds.splice(tidx, 0, g.id);
        } else {
          l1.childGroupIds.push(g.id);
        }
      } else {
        l1.childGroupIds.push(g.id);
      }
      renderGrpCards();
      ntf(`已将「${g.name}」移入1级分组「${l1.name}」`);
    });
  });

  // ---- Drop: 顶级排序（L1卡片与独立L2分组之间交换位置） ----
  const topItems = container.querySelectorAll(':scope > .gc, :scope > .gc-l1-card');
  topItems.forEach(el => {
    const isL1 = el.classList.contains('gc-l1-card');
    el.addEventListener('dragover', e => {
      if (_dragGid == null) return;
      // L1 body内部的拖入优先
      if (isL1 && e.target.closest('.gc-l1-body')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('gc-reorder-over');
    });
    el.addEventListener('dragleave', e => {
      if (isL1 && e.target.closest('.gc-l1-body')) return;
      if (!el.contains(e.relatedTarget)) el.classList.remove('gc-reorder-over');
    });
    el.addEventListener('drop', e => {
      if (isL1 && e.target.closest('.gc-l1-body')) return;
      e.preventDefault();
      el.classList.remove('gc-reorder-over');
      if (_dragGid == null) return;
      const dragG = f.grps.find(x => x.id === _dragGid);
      if (!dragG) return;
      // 确定目标分组
      const targetGid = isL1 ? +el.dataset.l1id : +(el.dataset.gid);
      if (!targetGid || targetGid === _dragGid) return;
      const targetG = f.grps.find(x => x.id === targetGid);
      if (!targetG) return;
      // 拖拽L2分组时，从原L1的childGroupIds中移除
      if (dragG.level !== 1) {
        f.grps.filter(x => x.level === 1 && x.childGroupIds).forEach(l1 => {
          l1.childGroupIds = l1.childGroupIds.filter(id => id !== _dragGid);
        });
      }
      // 在grps数组中重排：先移除拖拽项，再插入到目标位置
      const iFrom = f.grps.indexOf(dragG);
      const iTo = f.grps.indexOf(targetG);
      if (iFrom < 0 || iTo < 0) return;
      f.grps.splice(iFrom, 1);
      const newTo = f.grps.indexOf(targetG);
      f.grps.splice(newTo, 0, dragG);
      renderGrpCards();
      ntf('分组顺序已调整');
    });
  });

  // ---- Drop: L1内部L2分组之间排序 ----
  container.querySelectorAll('.gc-nested').forEach(el => {
    el.addEventListener('dragover', e => {
      // 只响应来自同一L1 body内的拖拽
      if (_dragGid == null) return;
      const parentBody = el.closest('.gc-l1-body');
      if (!parentBody) return;
      const dragEl = container.querySelector(`[data-gid="${_dragGid}"]`);
      // 允许从外部拖入（加入L1分组）或同L1内排序
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('gc-reorder-over');
    });
    el.addEventListener('dragleave', e => {
      if (!el.contains(e.relatedTarget)) el.classList.remove('gc-reorder-over');
    });
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('gc-reorder-over');
      if (_dragGid == null) return;
      const parentBody = el.closest('.gc-l1-body');
      if (!parentBody) return;
      const l1id = +parentBody.dataset.l1body;
      const l1 = f.grps.find(x => x.id === l1id);
      const dragG = f.grps.find(x => x.id === _dragGid);
      const targetGid = +el.dataset.gid;
      if (!l1 || !dragG || !targetGid || targetGid === _dragGid) return;
      if (dragG.level === 1) return; // 不允许L1进入L1

      // 如果拖拽项不在当前L1中：先从其他L1移除，再加入当前L1
      if (!l1.childGroupIds || !l1.childGroupIds.includes(dragG.id)) {
        f.grps.filter(x => x.level === 1 && x.childGroupIds).forEach(l1g => {
          l1g.childGroupIds = l1g.childGroupIds.filter(id => id !== dragG.id);
        });
        if (!l1.childGroupIds) l1.childGroupIds = [];
      }

      // 在childGroupIds中排序
      const targetIdx = l1.childGroupIds.indexOf(targetGid);
      const dragIdx = l1.childGroupIds.indexOf(dragG.id);
      if (dragIdx >= 0) {
        // 同L1内排序：先移除，再插入
        l1.childGroupIds.splice(dragIdx, 1);
        const newTargetIdx = l1.childGroupIds.indexOf(targetGid);
        l1.childGroupIds.splice(newTargetIdx, 0, dragG.id);
      } else {
        // 从外部拖入：插入到目标位置
        if (targetIdx >= 0) {
          l1.childGroupIds.splice(targetIdx, 0, dragG.id);
        } else {
          l1.childGroupIds.push(dragG.id);
        }
      }

      // 同步调整grps数组中子分组的顺序，使其与childGroupIds一致
      reorderGrpsByL1(f, l1);

      renderGrpCards();
      ntf('分组顺序已调整');
    });
  });
}

/**
 * 根据L1的childGroupIds顺序，重新排列f.grps中对应子分组的位置
 * 使子分组在f.grps中的顺序与childGroupIds一致，并紧跟在L1分组之后
 */
function reorderGrpsByL1(f, l1) {
  if (!l1.childGroupIds || !l1.childGroupIds.length) return;
  const l1Idx = f.grps.indexOf(l1);
  if (l1Idx < 0) return;
  // 取出所有子分组
  const childGrps = l1.childGroupIds.map(id => f.grps.find(g => g.id === id)).filter(Boolean);
  // 从grps中移除这些子分组
  childGrps.forEach(cg => { f.grps.splice(f.grps.indexOf(cg), 1); });
  // 按childGroupIds顺序插入到L1之后
  const newL1Idx = f.grps.indexOf(l1);
  childGrps.forEach((cg, i) => { f.grps.splice(newL1Idx + 1 + i, 0, cg); });
}

document.getElementById('btnClrL2').addEventListener('click', () => {
  const f = getActiveFile();
  if (!f) return;
  f.grps = [];
  f.gid = 0;
  renderGrpCards();
  popDepGrp();
  const col = document.getElementById('gCol').value;
  if (col) { renderVP2(col); showL2BaseInfo(col); }
  ntf('L2已清空');
});

// ========== 统计结果 ==========
document.getElementById('btnResult').addEventListener('click', () => {
  document.getElementById('l2Section').style.display = 'none';
  document.querySelector('.l2-top-actions').style.display = 'none';
  document.getElementById('resultArea').style.display = '';
  calcAllStats();
});
document.getElementById('btnBackFromResult').addEventListener('click', () => {
  document.getElementById('resultArea').style.display = 'none';
  document.getElementById('l2Section').style.display = '';
  document.querySelector('.l2-top-actions').style.display = '';
});
document.getElementById('btnCalc').addEventListener('click', calcAllStats);

function calcAllStats() {
  const area = document.getElementById('resContent');
  if (!S.files.length) { area.innerHTML = '<div class="empty-hint">请先上传文件</div>'; return; }
  // 检查是否有数据
  const hasData = S.files.some(f => f.raw.length > 0);
  if (!hasData) { area.innerHTML = '<div class="empty-hint">文件数据未加载，请重新上传文件后刷新</div>'; return; }
  // 计算前自动清理与当前过滤不匹配的分组值
  let anyCleaned = false;
  S.files.forEach(file => { if (cleanGroupValues(file)) anyCleaned = true; });
  if (anyCleaned) {
    renderGrpCards();
    popDepGrp();
    ntf('已自动清理与当前过滤不匹配的分组值', 'warn');
  }
  let html = '';
  S.files.forEach((file, fi) => {
    if (!file.raw.length) return;
    const sumCol = file.sumCol || '';
    let l1Data = getFilteredData_forFile(file);
    // 如果已执行拆分且该文件是拆分文件，排除未匹配行
    if (S.splitMatchedRows && S.splitFileId === file.id && S.splitMatchedRows.size > 0) {
      l1Data = filterBySplitMatch(l1Data, file);
    }
    const ctxCache = {};
    const entries = [];
    const groupedValsByCol = {};
    file.grps.forEach(g => {
      if (!groupedValsByCol[g.column]) groupedValsByCol[g.column] = new Set();
      g.values.forEach(v => groupedValsByCol[g.column].add(String(v)));
    });
    // 收集1级分组信息以便生成合计行
    const l1Groups = file.grps.filter(g => g.level === 1 && g.childGroupIds && g.childGroupIds.length);
    // 按L1分组归类entries
    const l1Entries = {}; // l1id -> [entries]
    const standaloneEntries = []; // 不属于任何L1分组的独立条目
    // 构建L1子分组ID集合，用于判断L2归属
    const l1ChildSet = new Set();
    l1Groups.forEach(l1g => { (l1g.childGroupIds || []).forEach(cid => l1ChildSet.add(cid)); });

    file.grps.forEach(g => {
      // 1级分组：不直接展示
      if (g.level === 1) return;
      // 2级分组依托1级分组（通过parentIds或childGroupIds）
      const parentIds = g.parentIds && g.parentIds.length ? g.parentIds : (g.parentId ? [g.parentId] : []);
      const parentRels = g.parentRels && g.parentRels.length ? g.parentRels : (g.parentRel ? [g.parentRel] : []);
      if (parentIds.length > 0) {
        let allParentCtx = [];
        let depParts = [];
        parentIds.forEach((pid, pi) => {
          const pg = file.grps.find(x => x.id === pid);
          if (!pg) return;
          const rel = parentRels[pi] || 'OR';
          if (pg.level === 1 && pg.childGroupIds && pg.childGroupIds.length) {
            pg.childGroupIds.forEach(cid => {
              const cg = file.grps.find(x => x.id === cid);
              if (!cg) return;
              const childCtx = getGroupContext(cid, l1Data, file.grps, ctxCache);
              const valSet = new Set(g.values.map(v => String(v).trim()));
              const selfMatch = l1Data.filter(r => valSet.has(String(r[g.column] ?? '').trim()));
              let ctx;
              if (rel === 'AND') {
                const ps = new Set(childCtx);
                ctx = selfMatch.filter(r => ps.has(r));
              } else {
                const seen = new Set();
                ctx = [];
                [...childCtx, ...selfMatch].forEach(r => { if (!seen.has(r)) { seen.add(r); ctx.push(r); } });
              }
              allParentCtx.push(...ctx);
              depParts.push(`${rel}→${pg.name}.${cg.name}`);
              const depLabel = `L1:${g.l1Dep ? g.l1Dep.col : ''} ${rel}→${pg.name}.${cg.name}`;
              const entryName = cg.name === g.name ? cg.name : `${cg.name} · ${g.name}`;
              const entry = {name: entryName, color: g.color, isGroup: true, column: g.column, count: ctx.length, pct: l1Data.length > 0 ? (ctx.length / l1Data.length * 100).toFixed(1) : '0', depInfo: depLabel, indent: 1, l1Name: pg.name, l1Id: pg.id};
              if (sumCol) entry.sum = ctx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
              file.addedCols.forEach(ac => { const tc = {}; ctx.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; }); entry['ac_' + ac] = tc; });
              // 归入对应L1分组的entries数组
              if (!l1Entries[pg.id]) l1Entries[pg.id] = [];
              l1Entries[pg.id].push(entry);
            });
          } else {
            // 父分组是普通2级分组
            const parentCtx = getGroupContext(pid, l1Data, file.grps, ctxCache);
            const valSet = new Set(g.values.map(v => String(v).trim()));
            const selfMatch = l1Data.filter(r => valSet.has(String(r[g.column] ?? '').trim()));
            let ctx;
            if (rel === 'AND') {
              const ps = new Set(parentCtx);
              ctx = selfMatch.filter(r => ps.has(r));
            } else {
              const seen = new Set();
              ctx = [];
              [...parentCtx, ...selfMatch].forEach(r => { if (!seen.has(r)) { seen.add(r); ctx.push(r); } });
            }
            allParentCtx.push(...ctx);
            depParts.push(`${rel}→${pg.name}`);
            const depLabel = `${rel}→${pg.name}`;
            const entryName = pg.name === g.name ? pg.name : `${pg.name} · ${g.name}`;
            const entry = {name: entryName, color: g.color, isGroup: true, column: g.column, count: ctx.length, pct: l1Data.length > 0 ? (ctx.length / l1Data.length * 100).toFixed(1) : '0', depInfo: depLabel, indent: 1};
            if (sumCol) entry.sum = ctx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
            file.addedCols.forEach(ac => { const tc = {}; ctx.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; }); entry['ac_' + ac] = tc; });
            standaloneEntries.push(entry);
          }
        });
        return;
      }
      // 普通分组（无依赖）——判断是否属于某个L1的childGroupIds
      const ctx = getGroupContext(g.id, l1Data, file.grps, ctxCache);
      // 查找包含此分组ID的L1
      const ownerL1 = l1Groups.find(l1 => l1.childGroupIds && l1.childGroupIds.includes(g.id));
      if (ownerL1) {
        // 归属到L1分组下展示
        let depLabel = `L1:${ownerL1.name}`;
        const entry = {name: g.name, color: g.color, isGroup: true, column: g.column, count: ctx.length, pct: l1Data.length > 0 ? (ctx.length / l1Data.length * 100).toFixed(1) : '0', depInfo: depLabel, indent: 1, l1Name: ownerL1.name, l1Id: ownerL1.id};
        if (sumCol) entry.sum = ctx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
        file.addedCols.forEach(ac => { const tc = {}; ctx.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; }); entry['ac_' + ac] = tc; });
        if (!l1Entries[ownerL1.id]) l1Entries[ownerL1.id] = [];
        l1Entries[ownerL1.id].push(entry);
      } else {
        // 真正独立的L2分组
        let depLabel = '(独立)';
        const entry = {name: g.name, color: g.color, isGroup: true, column: g.column, count: ctx.length, pct: l1Data.length > 0 ? (ctx.length / l1Data.length * 100).toFixed(1) : '0', depInfo: depLabel};
        if (sumCol) entry.sum = ctx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
        file.addedCols.forEach(ac => { const tc = {}; ctx.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; }); entry['ac_' + ac] = tc; });
        standaloneEntries.push(entry);
      }
    });

    // 为每个1级分组生成合计行
    l1Groups.forEach(l1g => {
      const l1Rows = new Set();
      l1g.childGroupIds.forEach(cid => {
        getGroupContext(cid, l1Data, file.grps, ctxCache).forEach(r => l1Rows.add(r));
      });
      const l1r = [...l1Rows];
      const l1entry = {name: `${l1g.name} 合计`, isL1Total: true, count: l1r.length, pct: l1Data.length > 0 ? (l1r.length / l1Data.length * 100).toFixed(1) : '0', sum: sumCol ? l1r.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0) : null};
      file.addedCols.forEach(ac => { const tc = {}; l1r.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; }); l1entry['ac_' + ac] = tc; });
      if (!l1Entries[l1g.id]) l1Entries[l1g.id] = [];
      l1Entries[l1g.id].push(l1entry);
    });

    if (!file.grps.length) {
      standaloneEntries.push({name: '(未分组)', color: null, isGroup: false, column: '', count: l1Data.length, pct: '100', depInfo: ''});
    }
    const allRows = new Set();
    file.grps.forEach(g => { getGroupContext(g.id, l1Data, file.grps, ctxCache).forEach(r => allRows.add(r)); });
    const totalRows = [...allRows];
    const total = {name: '合计', isTotal: true, count: totalRows.length, pct: l1Data.length > 0 ? (totalRows.length / l1Data.length * 100).toFixed(1) : '0', sum: sumCol ? totalRows.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0) : null};
    file.addedCols.forEach(ac => { const tc = {}; totalRows.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; }); total['ac_' + ac] = tc; });

    const secColor = SEC_COLORS[fi % SEC_COLORS.length];
    let scOpts = '<option value="">-- 无 --</option>';
    file.hdr.forEach(c => { scOpts += `<option value="${esc(c)}"${c === sumCol ? ' selected' : ''}>${esc(c)}</option>`; });
    html += `<div class="rv-section"><div class="rv-section-hdr" data-toggle-rv><span class="sec-dot" style="background:${secColor}"></span>${esc(file.name)}<span class="sec-info">${file.raw.length}行 / ${file.hdr.length}列 / ${file.grps.length}分组</span><span class="rv-toggle-arrow">&#9660;</span><div class="rv-sum-sel"><label>求和列</label><select data-fid="${file.id}" class="rv-sc">${scOpts}</select></div></div><div class="rv-section-body">`;

    // 表格头部生成函数
    function tableHead() {
      let h = '<table class="rt"><thead><tr><th>类别</th><th>依托</th><th>列</th><th style="text-align:right">数量</th><th style="text-align:right">占比</th>';
      if (sumCol) h += `<th style="text-align:right">${esc(sumCol)} 求和</th>`;
      file.addedCols.forEach(ac => h += `<th style="text-align:right">${esc(ac)} 类型数</th>`);
      h += '</tr></thead><tbody>';
      return h;
    }
    // 表格行生成函数
    function entryRow(e) {
      const cm = e.color ? CM[e.color] : null;
      const indentStyle = e.indent ? 'style="padding-left:20px;color:var(--t2)"' : '';
      const rowClass = e.isL1Total ? ' class="l1tot"' : '';
      let r = `<tr${rowClass}>`;
      const icon = e.isL1Total ? '📊' : (e.isGroup ? (e.indent ? '📄' : '📁') : '📌');
      r += `<td ${indentStyle}><div class="cc">${cm ? `<span class="cdot" style="background:${cm.d}"></span>` : ''}<span class="gico">${icon}</span> ${esc(e.name)}</div></td>`;
      r += `<td style="color:var(--cy);font-size:10px;font-family:var(--mf)">${esc(e.depInfo)}</td>`;
      r += `<td style="color:var(--t3);font-size:10px">${esc(e.column)}</td>`;
      r += `<td class="nc">${e.count}</td><td class="nc">${e.pct}%</td>`;
      if (sumCol) r += `<td class="nc" style="color:var(--wn)">${e.sum !== undefined ? fmtN(e.sum) : '-'}</td>`;
      file.addedCols.forEach(ac => { const tc = e['ac_' + ac] || {}; r += `<td class="nc" style="color:var(--cy)">${Object.keys(tc).length} 种</td>`; });
      r += '</tr>';
      return r;
    }
    // 合计行
    function totalRow(t) {
      let r = `<tr class="tot"><td>合计</td><td></td><td></td><td class="nc">${t.count}</td><td class="nc">${t.pct}%</td>`;
      if (sumCol) r += `<td class="nc" style="color:var(--wn)">${fmtN(t.sum)}</td>`;
      file.addedCols.forEach(ac => { const tc = t['ac_' + ac] || {}; r += `<td class="nc" style="color:var(--cy)">${Object.keys(tc).length} 种</td>`; });
      r += '</tr>';
      return r;
    }

    // === 按L1分组手风琴展示 ===
    l1Groups.forEach(l1g => {
      const l1EntriesList = l1Entries[l1g.id] || [];
      // L1分组的总行数和总占比
      const l1TotalEntry = l1EntriesList.find(e => e.isL1Total);
      const l1Count = l1TotalEntry ? l1TotalEntry.count : l1EntriesList.reduce((a, e) => a + e.count, 0);
      const l1Pct = l1TotalEntry ? l1TotalEntry.pct : (l1Data.length > 0 ? (l1Count / l1Data.length * 100).toFixed(1) : '0');
      const childCount = (l1g.childGroupIds || []).length;
      html += `<div class="rv-acc" data-l1id="${l1g.id}">`;
      html += `<div class="rv-acc-hdr" data-toggle-acc="${l1g.id}"><span class="rv-acc-dot" style="background:var(--ac)"></span><span class="rv-acc-title">${esc(l1g.name)}</span><span class="rv-acc-info">${childCount}个子分组 · ${l1Count}条 · ${l1Pct}%</span><span class="rv-acc-arrow">&#9660;</span></div>`;
      html += `<div class="rv-acc-body" data-accbody="${l1g.id}">`;
      html += tableHead();
      l1EntriesList.forEach(e => { html += entryRow(e); });
      html += '</tbody></table></div></div>';
    });

    // 独立分组（非L1的）
    if (standaloneEntries.length) {
      html += `<div class="rv-acc rv-acc-standalone">`;
      html += `<div class="rv-acc-hdr" data-toggle-acc="standalone"><span class="rv-acc-dot" style="background:var(--t3)"></span><span class="rv-acc-title">独立分组</span><span class="rv-acc-info">${standaloneEntries.length}个</span><span class="rv-acc-arrow">&#9660;</span></div>`;
      html += `<div class="rv-acc-body" data-accbody="standalone">`;
      html += tableHead();
      standaloneEntries.forEach(e => { html += entryRow(e); });
      html += '</tbody></table></div></div>';
    }

    // 总合计（始终显示）
    html += tableHead();
    html += totalRow(total);
    html += '</tbody></table>';

    // 附加列详细分布
    if (file.addedCols.length) {
      // 收集所有entries用于详细分布
      const allEntries = [];
      l1Groups.forEach(l1g => { (l1Entries[l1g.id] || []).forEach(e => allEntries.push(e)); });
      standaloneEntries.forEach(e => allEntries.push(e));

      file.addedCols.forEach(ac => {
        html += `<div class="det-sec"><div class="det-hdr">${esc(ac)} 详细分布</div><table class="rt"><thead><tr><th>类别</th><th>${esc(ac)} 值</th><th style="text-align:right">数量</th></tr></thead><tbody>`;
        allEntries.forEach(e => {
          const tc = e['ac_' + ac] || {};
          const sorted = Object.entries(tc).sort((a, b) => b[1] - a[1]);
          if (!sorted.length) { html += `<tr><td style="font-weight:600">${esc(e.name)}</td><td>-</td><td class="nc">0</td></tr>`; return; }
          sorted.forEach(([val, cnt], i) => {
            html += '<tr>';
            if (i === 0) html += `<td rowspan="${sorted.length}" style="font-weight:600;vertical-align:top">${esc(e.name)}</td>`;
            html += `<td style="font-family:var(--mf);font-size:11px">${esc(val)}</td><td class="nc">${cnt}</td></tr>`;
          });
        });
        html += '</tbody></table></div>';
      });
    }
    html += '</div></div>';
  });
  area.innerHTML = html;
  // 折叠/展开文件区
  area.querySelectorAll('[data-toggle-rv]').forEach(hdr => {
    hdr.addEventListener('click', e => {
      if (e.target.closest('.rv-sum-sel')) return;
      const body = hdr.nextElementSibling;
      const section = hdr.closest('.rv-section');
      if (body) {
        body.classList.toggle('rv-body-hidden');
        section.classList.toggle('rv-section-collapsed');
      }
    });
  });
  // 折叠/展开L1手风琴
  area.querySelectorAll('[data-toggle-acc]').forEach(hdr => {
    hdr.addEventListener('click', e => {
      const key = hdr.dataset.toggleAcc;
      // 在最近的文件section内查找body，避免多文件时key冲突
      const section = hdr.closest('.rv-section');
      const body = section ? section.querySelector(`[data-accbody="${key}"]`) : null;
      const acc = hdr.closest('.rv-acc');
      if (body) {
        body.classList.toggle('rv-acc-body-hidden');
      }
      if (acc) {
        acc.classList.toggle('rv-acc-collapsed');
      }
    });
  });
  // 求和列切换
  area.querySelectorAll('.rv-sc').forEach(sel => sel.addEventListener('change', e => {
    const fid = +e.target.dataset.fid;
    const file = S.files.find(f => f.id === fid);
    if (file) { file.sumCol = e.target.value; calcAllStats(); }
  }));
  document.getElementById('exportBtn').style.display = S.files.length ? 'inline-flex' : 'none';
}

// ========== 导出 Excel ==========
document.getElementById('exportBtn').addEventListener('click', () => {
  if (!S.files.length) { ntf('无数据可导出', 'error'); return; }
  const wb = XLSX.utils.book_new();
  S.files.forEach(file => {
    const sumCol = file.sumCol || '';
    let l1Data = getFilteredData_forFile(file);
    // 如果已执行拆分且该文件是拆分文件，排除未匹配行
    if (S.splitMatchedRows && S.splitFileId === file.id && S.splitMatchedRows.size > 0) {
      l1Data = filterBySplitMatch(l1Data, file);
    }
    const ctxCache = {};
    const rows = [];
    const header = ['文件', '类别', '依托', '列', '数量', '占比(%)'];
    if (sumCol) header.push(`${sumCol} 求和`);
    file.grps.forEach(g => {
      const ctx = getGroupContext(g.id, l1Data, file.grps, ctxCache);
      let depLabel = g.l1Dep ? `L1:${g.l1Dep.col}` : '';
      if (g.parentId) { const pg = file.grps.find(x => x.id === g.parentId); if (pg) depLabel += ` ${g.parentRel}→${pg.name}`; } else depLabel += ' (独立)';
      const row = [file.name, g.name, depLabel, g.column, ctx.length, l1Data.length > 0 ? (ctx.length / l1Data.length * 100).toFixed(1) : '0'];
      if (sumCol) row.push(parseFloat((ctx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0)).toFixed(2)));
      rows.push(row);
    });
    if (!file.grps.length) { const row = [file.name, '(未分组)', '', '', l1Data.length, '100']; if (sumCol) row.push(0); rows.push(row); }
    const allRows = new Set();
    file.grps.forEach(g => { getGroupContext(g.id, l1Data, file.grps, ctxCache).forEach(r => allRows.add(r)); });
    const totalRow = [file.name, '合计', '', '', allRows.size, l1Data.length > 0 ? (allRows.size / l1Data.length * 100).toFixed(1) : '0'];
    if (sumCol) totalRow.push([...allRows].reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0));
    rows.push(totalRow);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, file.name.substring(0, 20));
  });
  XLSX.writeFile(wb, '统计结果.xlsx');
  ntf('已导出 统计结果.xlsx');
});

// ========== 保存/加载配置（全局版） ==========
function hdrSignature(hdr) {
  // 用排序后的表头 join 作为签名，不依赖列顺序
  return [...hdr].sort().join('|');
}

function buildConfigData() {
  // 只保存当前活跃文件的配置
  const f = getActiveFile();
  if (!f) return {files: []};
  const fc = {name: f.name, hdr: f.hdr, l1: {}, grps: f.grps.map(g => ({name: g.name, color: g.color, column: g.column, values: g.values, l1Dep: g.l1Dep, parentIds: g.parentIds || (g.parentId ? [g.parentId] : []), parentRels: g.parentRels || (g.parentRel ? [g.parentRel] : []), parentId: g.parentId || null, parentRel: g.parentRel || null, level: g.level || null, childGroupIds: g.childGroupIds || null})), addedCols: f.addedCols, sumCol: f.sumCol || '', hiddenCols: [...f.hiddenCols]};
  f.hdr.forEach(col => {
    fc.l1[col] = {checked: f.l1[col].checked ? [...f.l1[col].checked] : null, cascade: f.l1[col].cascade || false, dependCol: f.l1[col].dependCol || null, sort: f.l1[col].sort || null, condOn: f.l1[col].condOn || false, condOp: f.l1[col].condOp || 'eq', condVal: f.l1[col].condVal || ''};
  });
  return {files: [fc], mappingData: S.mappingData && Object.keys(S.mappingData).length ? S.mappingData : null};
}

function saveGlobalConfig() {
  const f = getActiveFile();
  if (!f) { ntf('无活跃文件', 'error'); return; }
  const cfg = buildConfigData();
  const sig = hdrSignature(f.hdr);
  // 弹出命名对话框
  showConfigNameDialog(name => {
    if (!name) return;
    fetch('/api/configs', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ name, cfg, sig, savedAt: Date.now() })
    }).then(r => r.json()).then(data => {
      if (data.error) { ntf(data.error, 'error'); return; }
      ntf('配置已保存');
    }).catch(() => ntf('保存失败', 'error'));
  });
}

function showConfigNameDialog(callback) {
  const overlay = document.createElement('div');
  overlay.className = 'fd-overlay vis';
  const dd = document.createElement('div');
  dd.className = 'fd-dropdown vis';
  dd.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%);width:360px;';
  const defaultName = `配置_${new Date().toLocaleString('zh-CN').replace(/[\/:]/g, '-')}`;
  const hasMapping = S.mappingData && Object.keys(S.mappingData).length > 0;
  dd.innerHTML = `
    <div class="fd-head"><span class="fd-cn">保存配置</span></div>
    <div style="padding:14px;display:flex;flex-direction:column;gap:10px">
      <label style="font-size:12px;color:var(--t3)">配置名称</label>
      <input id="cfgNameInput" value="${esc(defaultName)}" style="background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:8px 12px;color:var(--t1);font:13px var(--sf);outline:none;width:100%">
      ${hasMapping ? '<div style="font-size:10px;color:var(--cy);font-family:var(--mf)">包含分局映射 (' + Object.keys(S.mappingData).length + '个分局)</div>' : ''}
    </div>
    <div class="fd-foot"><span></span><div class="fd-btns">
      <button class="btn btn-ghost btn-xs" id="cfgNameCancel">取消</button>
      <button class="btn btn-primary btn-xs" id="cfgNameOk">保存</button>
    </div></div>`;
  document.body.appendChild(overlay);
  document.body.appendChild(dd);
  const input = dd.querySelector('#cfgNameInput');
  input.focus();
  input.select();
  const close = () => { overlay.remove(); dd.remove(); };
  dd.querySelector('#cfgNameCancel').addEventListener('click', close);
  overlay.addEventListener('click', close);
  const confirm = () => { const v = input.value.trim(); if (v) { close(); callback(v); } };
  dd.querySelector('#cfgNameOk').addEventListener('click', confirm);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); });
}

function exportConfig() {
  const cfg = buildConfigData();
  const blob = new Blob([JSON.stringify(cfg, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'filter_config.json'; a.click();
  URL.revokeObjectURL(url);
  ntf('配置已导出');
}

document.getElementById('btnSave').addEventListener('click', saveGlobalConfig);
document.getElementById('btnExport').addEventListener('click', exportConfig);

document.getElementById('btnLoad').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/configs');
    const configs = await res.json();
    if (!configs.length) {
      ntf('无已保存配置', 'warn');
      return;
    }
    showConfigPicker(configs);
  } catch (e) {
    ntf('加载配置列表失败', 'error');
  }
});

function showConfigPicker(configs) {
  // 显示全部配置，匹配的高亮可选，不匹配的灰显禁选
  const currentSigs = S.files.map(f => hdrSignature(f.hdr));
  const overlay = document.createElement('div');
  overlay.className = 'fd-overlay vis';
  const dd = document.createElement('div');
  dd.className = 'fd-dropdown vis';
  dd.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%);width:440px;max-height:560px;';
  let html = `<div class="fd-head"><span class="fd-cn">选择配置</span><div class="fd-acts"><button class="btn btn-ghost btn-xs" id="cfgFileImport">从文件导入</button></div></div>`;
  html += '<div class="fd-value-list" style="max-height:360px">';
  const matchedCount = configs.filter(c => {
    const cfgSigs = c.sig ? c.sig.split('|') : [];
    return currentSigs.some(cs => {
      const parts = cs.split('|').sort();
      return cfgSigs.length === parts.length && cfgSigs.every((s, i) => s === parts[i]);
    });
  }).length;
  configs.forEach(c => {
    const date = new Date(c.savedAt).toLocaleString('zh-CN');
    const fileNames = (c.fileNames || []).map(n => esc(n)).join(', ');
    // 检查表头是否匹配
    const cfgSigParts = c.sig ? c.sig.split('|').sort() : [];
    const isMatched = currentSigs.some(cs => {
      const parts = cs.split('|').sort();
      return cfgSigParts.length === parts.length && cfgSigParts.every((s, i) => s === parts[i]);
    });
    const dimStyle = isMatched ? '' : 'opacity:.4;pointer-events:none;';
    const matchBadge = isMatched ? '<span style="color:var(--ok);font-size:9px;margin-left:6px">匹配</span>' : '<span style="color:var(--t3);font-size:9px;margin-left:6px">表头不匹配</span>';
    html += `<div class="fd-item" data-cfg-name="${esc(c.name)}" style="flex-direction:column;align-items:flex-start;gap:4px;padding:10px 14px;${dimStyle}">
      <div style="display:flex;align-items:center;width:100%;justify-content:space-between">
        <div style="font-weight:600;font-size:12px">${esc(c.name)}${matchBadge}</div>
        <button class="btn btn-danger btn-xs cfg-del-btn" data-cfg-name="${esc(c.name)}" style="flex-shrink:0;${isMatched ? '' : 'pointer-events:auto;opacity:1;'}">删除</button>
      </div>
      <div style="font-size:10px;color:var(--t3)">${date} - ${fileNames}${c.hasMapping ? ' <span style="color:var(--cy)">含分局映射(' + c.mappingCount + '个)</span>' : ''}</div>
    </div>`;
  });
  html += '</div>';
  html += `<div class="fd-foot"><span class="fd-cnt">${matchedCount}/${configs.length} 个匹配</span><div class="fd-btns"><button class="btn btn-ghost btn-xs" id="cfgCancel">取消</button></div></div>`;
  dd.innerHTML = html;
  document.body.appendChild(overlay);
  document.body.appendChild(dd);

  const closeDialog = () => { overlay.remove(); dd.remove(); };
  overlay.addEventListener('click', closeDialog);
  dd.querySelector('#cfgCancel').addEventListener('click', closeDialog);
  dd.querySelector('#cfgFileImport').addEventListener('click', () => { closeDialog(); document.getElementById('cfgIn').click(); });
  // 删除按钮
  dd.querySelectorAll('.cfg-del-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const name = btn.dataset.cfgName;
      try {
        const res = await fetch(`/api/configs/${encodeURIComponent(name)}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.error) { ntf(data.error, 'error'); return; }
        ntf(`已删除配置: ${name}`);
        // 移除对应行
        const item = btn.closest('.fd-item');
        if (item) item.remove();
        // 更新计数
        const remaining = dd.querySelectorAll('.fd-item').length;
        const matchedRemaining = [...dd.querySelectorAll('.fd-item')].filter(el => !el.style.opacity || el.style.opacity !== '0.4').length;
        const cntEl = dd.querySelector('.fd-cnt');
        if (cntEl) cntEl.textContent = `${matchedRemaining}/${remaining} 个匹配`;
        if (remaining === 0) closeDialog();
      } catch (err) { ntf('删除失败', 'error'); }
    });
  });
  // 点击配置项（只对匹配的生效）
  dd.querySelectorAll('.fd-item').forEach(item => {
    if (item.style.opacity === '0.4') return; // 不匹配的不可点击
    item.addEventListener('click', async () => {
      const name = item.dataset.cfgName;
      try {
        const res = await fetch(`/api/configs/${encodeURIComponent(name)}`);
        const data = await res.json();
        if (data.error) { ntf(data.error, 'error'); return; }
        applyConfig(data.cfg);
        closeDialog();
      } catch (err) { ntf('加载配置失败', 'error'); }
    });
  });
}

function applyConfig(cfg) {
  if (!cfg.files || !cfg.files.length) { ntf('配置文件格式错误', 'error'); return; }
  let cleanedCount = 0;
  cfg.files.forEach((fc, fi) => {
    // 按表头匹配找到对应的当前文件
    const fcSig = hdrSignature(fc.hdr);
    const targetFile = S.files.find(f => hdrSignature(f.hdr) === fcSig);
    if (!targetFile) return;
    
    const l1 = {};
    fc.hdr.forEach(c => {
      const lf = fc.l1 && fc.l1[c];
      l1[c] = lf ? {checked: lf.checked ? new Set(lf.checked) : null, cascade: lf.cascade || false, dependCol: lf.dependCol || null, sort: lf.sort || null, condOn: lf.condOn || false, condOp: lf.condOp || 'eq', condVal: lf.condVal || ''} : newL1();
    });
    // 同时保留当前文件中存在但配置中不存在的列
    targetFile.hdr.forEach(c => { if (!l1[c]) l1[c] = newL1(); });
    targetFile.l1 = l1;
    targetFile.hiddenCols = new Set(fc.hiddenCols || []);
    targetFile.addedCols = fc.addedCols || [];
    targetFile.sumCol = fc.sumCol || '';
    
    if (fc.grps) {
      targetFile.grps = [];
      targetFile.gid = 0;
      fc.grps.forEach(g => {
        targetFile.grps.push({id: ++targetFile.gid, name: g.name, color: g.color, column: g.column, values: g.values || [], l1Dep: g.l1Dep || null, parentIds: g.parentIds || (g.parentId ? [g.parentId] : []), parentRels: g.parentRels || (g.parentRel ? [g.parentRel] : []), level: g.level || null, childGroupIds: g.childGroupIds || null});
      });
      // 加载配置后，清理与当前过滤数据不匹配的分组值
      const origGrpCount = targetFile.grps.length;
      cleanGroupValues(targetFile);
      if (targetFile.grps.length < origGrpCount) cleanedCount += origGrpCount - targetFile.grps.length;
    }
  });
  // 恢复分局映射排序
  if (cfg.mappingData && typeof cfg.mappingData === 'object') {
    S.mappingData = cfg.mappingData;
    saveMapping();
    renderMapping();
  }
  initActiveFile();
  popDepGrp();
  if (cleanedCount > 0) {
    ntf(`配置已应用，已自动清理 ${cleanedCount} 个空分组`, 'warn');
  } else {
    ntf('配置已应用');
  }
}

// 文件导入回退
document.getElementById('cfgIn').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const cfg = JSON.parse(ev.target.result);
      applyConfig(cfg);
    } catch (err) { ntf('配置文件格式错误', 'error'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});

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
    if (step === 'upload' || step === 'kdocs' || step === 'split' || S.files.length) switchStep(step);
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

// ========== 姓名预处理 ==========
document.getElementById('btnPreprocess').addEventListener('click', async () => {
  const f = getActiveFile();
  if (!f || !f.raw.length) { ntf('请先上传文件', 'error'); return; }
  // 优先使用预处理列选择器，其次使用拆分列选择器
  const pSel = document.getElementById('preprocessColSel');
  const col = (pSel && pSel.value) || getSplitCol();
  if (!col) { ntf('请先选择预处理列', 'error'); return; }
  // 确保 mappingData 已加载
  if (!Object.keys(S.mappingData).length) {
    await loadMapping();
  }
  if (!Object.keys(S.mappingData).length) { ntf('映射数据为空，请先进入拆分页加载分局配置', 'error'); return; }

  let emptyCount = 0;
  let multiCount = 0;
  let processedCount = 0;
  const details = [];

  f.raw.forEach((r, i) => {
    const raw = String(r[col] ?? '').trim();
    if (!raw) {
      emptyCount++;
      return;
    }
    // 按常见分隔符拆分
    const names = raw.split(/[,，、;；\s]+/).map(n => n.trim()).filter(n => n);
    if (names.length <= 1) return; // 单人名无需处理

    multiCount++;
    // 查找每个名字匹配的分局及优先级
    let bestName = names[0];
    let bestPriority = -1;
    let bestBureau = '';
    names.forEach(name => {
      for (const [bureau, members] of Object.entries(S.mappingData)) {
        if (members.includes(name)) {
          const priority = members.indexOf(name) === 0 ? 2 : 1;
          if (priority > bestPriority) {
            bestPriority = priority;
            bestName = name;
            bestBureau = bureau;
          }
        }
      }
    });
    if (bestPriority > 0) {
      r[col] = bestName;
      processedCount++;
      details.push(`行${i+2}: "${raw}" → "${bestName}" (${bestBureau}, 优先级${bestPriority})`);
    } else {
      // 无人匹配，保留第一个名字
      r[col] = names[0];
      details.push(`行${i+2}: "${raw}" → "${names[0]}" (无人匹配分局, 保留首个)`);
    }
  });

  // 显示结果（可折叠）
  const div = document.getElementById('preprocessResult');
  div.style.display = 'block';
  div.className = 'preprocess-result open';
  div.innerHTML = `
    <div class="pp-toggle" id="ppToggle">
      <span style="font-weight:600">预处理结果</span>
      <span class="pp-stats-line">
        <span class="pp-stat pp-ok"><span class="pp-val">${processedCount}</span>条已处理</span>
        <span class="pp-stat pp-multi"><span class="pp-val">${multiCount}</span>条多人名</span>
        <span class="pp-stat pp-empty"><span class="pp-val">${emptyCount}</span>条为空</span>
      </span>
      <span class="pp-arr">&#9660;</span>
    </div>
    <div class="pp-body">
      <div class="pp-detail">${details.map(d => `<div>${esc(d)}</div>`).join('')}</div>
    </div>
  `;
  div.querySelector('#ppToggle').addEventListener('click', () => {
    div.classList.toggle('open');
  });
  // 重新生成 rawFileData 以便拆分使用新数据
  try {
    const ws = XLSX.utils.json_to_sheet(f.raw);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const binStr = XLSX.write(wb, {type: 'binary', bookType: 'xlsx'});
    // binary string → ArrayBuffer
    const buf = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) buf[i] = binStr.charCodeAt(i) & 0xFF;
    f.rawFileData = buf.buffer;
  } catch(e) {
    console.warn('预处理: 重新生成文件数据失败', e);
  }
  // 重算 splitMatchedRows（数据已变）
  S.splitMatchedRows = null;
  S.splitFileId = null;
  S.splitResult = null;
  document.getElementById('splitResults').style.display = 'none';
  debouncedSave();
  if (emptyCount > 0) {
    ntf(`预处理完成：${processedCount} 条已处理，${emptyCount} 条为空值`, 'warn');
  } else {
    ntf(`预处理完成：${processedCount} 条已处理，数据已更新`);
  }
});

// 二级统计区导航
document.getElementById('btnBackFromL2').addEventListener('click', () => {
  if (S.currentStep === 'filter2') switchStep('filter1');
});

// ========== 文件上传事件 ==========
const upZone = document.getElementById('upZone');
const fileInput = document.getElementById('fileInput');

upZone.addEventListener('click', e => {
  if (e.target === fileInput) return;
  fileInput.click();
});
fileInput.addEventListener('change', e => {
  if (e.target.files.length) handleFiles(e.target.files);
  e.target.value = '';
});
upZone.addEventListener('dragover', e => { e.preventDefault(); upZone.classList.add('dragover'); });
upZone.addEventListener('dragleave', () => upZone.classList.remove('dragover'));
upZone.addEventListener('drop', e => {
  e.preventDefault();
  upZone.classList.remove('dragover');
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

// 初始化
document.getElementById('sbStats').style.display = 'none';
document.getElementById('preprocessColSel').addEventListener('change', onPreprocessColChange);

// 主题切换
document.getElementById('themeToggle').addEventListener('click', toggleTheme);
applyThemeUI(document.documentElement.getAttribute('data-theme') || 'dark');

// 恢复持久化状态（不恢复文件列表和mappingData，每次启动为空白，mappingData从后端加载）
(function restoreState() {
  // mappingData 已通过后端 API 持久化，不需要从 localStorage 恢复
  // 清除旧的文件状态，确保启动时为空白
  localStorage.removeItem('ba-state');
})();

// ========== STEP 5: 在线推送 ==========
const KD = {
  sheets: [],
  cats: [],
  editingId: null,
  activeCat: '',  // 空串=全部
};

// 遮掩Token：只显示开头2个+结尾2个字符
function maskSecret(val) {
  if (!val || val.length <= 4) return val || '';
  return val.substring(0, 2) + '****' + val.substring(val.length - 2);
}

// ===== 数据加载 =====
async function loadKdocsSheets() {
  try {
    const catParam = KD.activeCat ? `?category=${encodeURIComponent(KD.activeCat)}` : '';
    const res = await fetch('/api/kdocs-sheets' + catParam);
    KD.sheets = await res.json();
    renderKdocsList();
  } catch (e) {
    ntf('加载在线表格列表失败', 'error');
  }
}

async function loadKdocsCats() {
  try {
    const res = await fetch('/api/kdocs-categories');
    KD.cats = await res.json();
    renderKdocsCatBar();
  } catch (e) { /* ignore */ }
}

// ===== 分类标签栏 =====
function renderKdocsCatBar() {
  const bar = document.getElementById('kdCatBar');
  if (!bar) return;
  const allCount = KD.sheets.length;
  let html = `<span class="kd-cat-tag ${KD.activeCat === '' ? 'on' : ''}" data-cat="">全部</span>`;
  KD.cats.forEach(c => {
    html += `<span class="kd-cat-tag ${KD.activeCat === c.id ? 'on' : ''}" data-cat="${c.id}" style="${c.color && KD.activeCat === c.id ? `border-color:${c.color};color:${c.color}` : ''}">
      <span class="kd-cat-dot" style="background:${c.color || '#6366f1'}"></span>${esc(c.name)}<span class="kd-cat-count">${c.count || 0}</span>
    </span>`;
  });
  bar.innerHTML = html;
  bar.querySelectorAll('.kd-cat-tag').forEach(t => t.addEventListener('click', async () => {
    KD.activeCat = t.dataset.cat;
    await loadKdocsSheets();
    renderKdocsCatBar();
  }));
}

// ===== 分类管理对话框 =====
document.getElementById('kdCatBtn').addEventListener('click', () => {
  const overlay = document.createElement('div');
  overlay.className = 'fd-overlay vis';
  const dd = document.createElement('div');
  dd.className = 'fd-dropdown vis';
  dd.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%);width:360px;';

  function renderCatList() {
    let listHtml = '';
    KD.cats.forEach(c => {
      listHtml += `<div class="kd-cat-mgr-item">
        <span class="kd-cat-dot" style="background:${c.color || '#6366f1'}"></span>
        <span class="kd-cat-mgr-name">${esc(c.name)}</span>
        <span class="kd-cat-mgr-count">${c.count || 0}个</span>
        ${c.id !== 'default' ? `<button class="btn btn-danger btn-xs kd-cat-del" data-cid="${c.id}">删除</button>` : ''}
      </div>`;
    });
    return listHtml;
  }

  let html = '<div class="fd-head"><span class="fd-cn">管理分类</span></div>';
  html += '<div style="padding:14px;display:flex;flex-direction:column;gap:10px">';
  html += '<div class="kd-cat-mgr-list" id="kdCatMgrList">' + renderCatList() + '</div>';
  html += '<div class="kd-cat-add-row"><input id="kdCatAddName" placeholder="新分类名称"><input id="kdCatAddColor" type="color" value="#6366f1" style="width:36px;height:30px;padding:2px;border:1px solid var(--bd);border-radius:6px;cursor:pointer"><button class="btn btn-primary btn-xs" id="kdCatAddBtn">添加</button></div>';
  html += '</div>';
  html += '<div class="fd-foot"><span></span><div class="fd-btns"><button class="btn btn-ghost btn-xs" id="kdCatClose">关闭</button></div></div>';
  dd.innerHTML = html;
  document.body.appendChild(overlay);
  document.body.appendChild(dd);

  const close = () => { overlay.remove(); dd.remove(); };
  overlay.addEventListener('click', close);
  dd.querySelector('#kdCatClose').addEventListener('click', close);
  dd.querySelector('#kdCatAddBtn').addEventListener('click', async () => {
    const name = dd.querySelector('#kdCatAddName').value.trim();
    const color = dd.querySelector('#kdCatAddColor').value;
    if (!name) { ntf('请输入分类名', 'error'); return; }
    const res = await fetch('/api/kdocs-categories', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ name, color }) });
    const data = await res.json();
    if (data.error) { ntf(data.error, 'error'); return; }
    dd.querySelector('#kdCatAddName').value = '';
    await loadKdocsCats();
    dd.querySelector('#kdCatMgrList').innerHTML = renderCatList();
    bindCatDel(dd);
    ntf('分类已添加');
  });
  function bindCatDel(container) {
    container.querySelectorAll('.kd-cat-del').forEach(b => b.addEventListener('click', async () => {
      await fetch(`/api/kdocs-categories/${b.dataset.cid}`, { method: 'DELETE' });
      await loadKdocsCats();
      await loadKdocsSheets();
      container.innerHTML = renderCatList();
      bindCatDel(container);
      ntf('分类已删除');
    }));
  }
  bindCatDel(dd);
});

// ===== 渲染在线表格列表（按分类分组） =====
function renderKdocsList() {
  const div = document.getElementById('kdSheetList');
  if (!KD.sheets.length) {
    div.innerHTML = '<div class="kd-empty"><div class="kd-empty-icon">&#128203;</div><div class="kd-empty-text">暂无在线表格配置</div><div class="kd-empty-hint">点击"添加在线表格"开始配置</div></div>';
    return;
  }

  // 如果在"全部"视图下，按分类分组
  let html = '';
  if (!KD.activeCat) {
    const grouped = {};
    KD.cats.forEach(c => { grouped[c.id] = { name: c.name, color: c.color || '#6366f1', items: [] }; });
    // 未分类的归入默认
    if (!grouped['default']) grouped['default'] = { name: '默认', color: '#6366f1', items: [] };
    KD.sheets.forEach(s => {
      const catId = s.category || 'default';
      if (!grouped[catId]) grouped[catId] = { name: catId, color: '#6366f1', items: [] };
      grouped[catId].items.push(s);
    });
    for (const [catId, group] of Object.entries(grouped)) {
      if (!group.items.length) continue;
      html += `<div class="kd-group" data-catid="${catId}">
        <div class="kd-group-header" data-catid="${catId}"><span class="kd-collapse-arrow">&#9660;</span><span class="kd-cat-dot" style="background:${group.color}"></span><span class="kd-group-name">${esc(group.name)}</span><span class="kd-group-count">${group.items.length}个</span></div>
        <div class="kd-group-body">`;
      group.items.forEach(s => { html += renderKdocsCard(s); });
      html += '</div></div>';
    }
  } else {
    KD.sheets.forEach(s => { html += renderKdocsCard(s); });
  }
  div.innerHTML = html;

  // 绑定分类折叠事件
  div.querySelectorAll('.kd-group-header').forEach(h => {
    h.addEventListener('click', () => {
      const group = h.parentElement;
      const body = group.querySelector('.kd-group-body');
      const arrow = h.querySelector('.kd-collapse-arrow');
      const collapsed = group.classList.toggle('kd-collapsed');
      if (collapsed) {
        body.style.maxHeight = '0';
        body.style.overflow = 'hidden';
        arrow.innerHTML = '&#9654;';
      } else {
        body.style.maxHeight = '';
        body.style.overflow = '';
        arrow.innerHTML = '&#9660;';
      }
    });
  });

  // 绑定卡片事件
  div.querySelectorAll('.kd-open-btn').forEach(b => b.addEventListener('click', () => {
    const s = KD.sheets.find(x => x.id === b.dataset.sid);
    if (s && s.url) window.open(s.url, '_blank');
  }));
  div.querySelectorAll('.kd-edit-btn').forEach(b => b.addEventListener('click', () => showKdocsEditDialog(b.dataset.sid)));
  div.querySelectorAll('.kd-del-btn').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('确定删除该在线表格配置？')) return;
    await fetch(`/api/kdocs-sheets/${b.dataset.sid}`, { method: 'DELETE' });
    ntf('已删除');
    loadKdocsSheets();
    loadKdocsCats();
  }));
  div.querySelectorAll('.kd-push-btn').forEach(b => b.addEventListener('click', () => pushKdocsSingle(b.dataset.sid)));
}

function renderKdocsCard(s) {
  const hasToken = !!s.api_token;
  const hasWebhook = !!s.webhook_url;
  const hasExcel = !!s.excel_path;
  return `<div class="kd-card" data-sid="${s.id}">
    <div class="kd-card-header">
      <div class="kd-card-info">
        <span class="kd-card-name">${esc(s.name)}</span>
        <span class="kd-card-badges">
          ${hasToken ? '<span class="kd-badge kd-badge-ok">Token</span>' : '<span class="kd-badge kd-badge-no">无Token</span>'}
          ${hasWebhook ? '<span class="kd-badge kd-badge-ok">Webhook</span>' : '<span class="kd-badge kd-badge-no">无Webhook</span>'}
          ${hasExcel ? '<span class="kd-badge kd-badge-ok">本地</span>' : ''}
        </span>
      </div>
      <div class="kd-card-actions">
        <button class="btn btn-ghost btn-xs kd-open-btn" data-sid="${s.id}" title="新标签页打开">&#8599;</button>
        <button class="btn btn-ghost btn-xs kd-edit-btn" data-sid="${s.id}" title="编辑">&#9998;</button>
        <button class="btn btn-danger btn-xs kd-del-btn" data-sid="${s.id}" title="删除">&#10005;</button>
      </div>
    </div>
    <div class="kd-card-body">
      <div class="kd-field"><span class="kd-fld-label">URL</span><span class="kd-fld-val kd-url-val" title="${esc(s.url)}">${esc(s.url)}</span></div>
      ${hasToken ? `<div class="kd-field"><span class="kd-fld-label">Token</span><span class="kd-fld-val kd-secret">${esc(maskSecret(s.api_token))}</span></div>` : ''}
      ${hasWebhook ? `<div class="kd-field"><span class="kd-fld-label">Webhook</span><span class="kd-fld-val kd-secret">${esc(maskSecret(s.webhook_url))}</span></div>` : ''}
      ${hasExcel ? `<div class="kd-field"><span class="kd-fld-label">本地文件</span><span class="kd-fld-val">${esc(s.excel_path)}</span></div>` : ''}
      ${s.updated_at ? `<div class="kd-field"><span class="kd-fld-label">更新</span><span class="kd-fld-val kd-fld-time">${esc(s.updated_at)}</span></div>` : ''}
    </div>
    <div class="kd-card-footer">
      <button class="btn btn-primary btn-xs kd-push-btn" data-sid="${s.id}" ${(!hasToken || !hasWebhook) ? 'disabled title="请先配置Token和Webhook"' : ''}>推送数据</button>
      <span class="kd-card-status" id="kdStatus_${s.id}"></span>
    </div>
  </div>`;
}

// ===== 文件浏览器对话框 =====
function showFileBrowser(targetInput, selectMode) {
  // selectMode: 'file' 或 'folder'
  const overlay = document.createElement('div');
  overlay.className = 'fd-overlay vis';
  const dd = document.createElement('div');
  dd.className = 'fd-dropdown vis';
  dd.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%);width:560px;max-height:75vh;display:flex;flex-direction:column;';

  dd.innerHTML = `<div class="fd-head"><span class="fd-cn" id="kbTitle">浏览本地文件</span></div>
    <div class="kd-browse-bar">
      <button class="btn btn-ghost btn-xs" id="kbUp">↑ 上级</button>
      <input id="kbPath" placeholder="路径..." style="flex:1;background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:6px 10px;color:var(--t1);font:11px var(--mf);outline:none">
      <button class="btn btn-ghost btn-xs" id="kbGo">前往</button>
    </div>
    <div class="kd-browse-list" id="kbList" style="flex:1;overflow-y:auto;min-height:200px;max-height:400px"></div>
    <div class="fd-foot"><span id="kbInfo"></span><div class="fd-btns">
      <button class="btn btn-ghost btn-xs" id="kbCancel">取消</button>
      <button class="btn btn-primary btn-xs" id="kbOk">选择</button>
    </div></div>`;
  document.body.appendChild(overlay);
  document.body.appendChild(dd);

  let selectedPath = '';
  let currentIsDrives = false; // 当前是否在驱动器列表视图
  let currentParent = ''; // 后端返回的上级路径

  async function browse(path) {
    dd.querySelector('#kbPath').value = (path === '__drives__') ? '' : path;
    selectedPath = (path === '__drives__') ? '' : path;
    currentIsDrives = (path === '__drives__');
    try {
      const res = await fetch('/api/kdocs-browse', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ path }) });
      const data = await res.json();
      if (data.error) { dd.querySelector('#kbList').innerHTML = `<div class="kd-batch-hint kd-batch-err">${data.error}</div>`; return; }

      // 保存后端返回的上级路径
      currentParent = data.parent || '';

      // 更新标题
      const titleEl = dd.querySelector('#kbTitle');
      if (data.is_drives) {
        titleEl.textContent = '此电脑';
        currentIsDrives = true;
      } else {
        titleEl.textContent = '浏览本地文件';
        currentIsDrives = false;
      }

      let html = '';
      // 上级目录按钮
      if (data.parent) {
        const parentLabel = data.parent === '__drives__' ? '.. (此电脑)' : '.. (上级目录)';
        html += `<div class="kb-item kb-dir" data-path="${esc(data.parent)}"><span class="kb-icon">📂</span><span class="kb-name">${parentLabel}</span></div>`;
      }
      // 目录/驱动器列表
      data.dirs.forEach(d => {
        const icon = d.is_drive ? '💿' : '📁';
        const cls = d.is_drive ? 'kb-item kb-dir kb-drive' : 'kb-item kb-dir';
        const label = d.is_drive ? `${d.name} 驱动器` : d.name;
        html += `<div class="${cls}" data-path="${esc(d.path)}"><span class="kb-icon">${icon}</span><span class="kb-name">${esc(label)}</span></div>`;
      });
      // 文件列表（仅非驱动器视图显示）
      if (!data.is_drives) {
        data.files.forEach(f => { html += `<div class="kb-item kb-file" data-path="${esc(f.path)}"><span class="kb-icon">📄</span><span class="kb-name">${esc(f.name)}</span><span class="kb-size">${(f.size / 1024).toFixed(0)}KB</span></div>`; });
      }
      if (!data.dirs.length && !data.files.length) html = '<div class="kd-batch-hint">此目录为空</div>';
      dd.querySelector('#kbList').innerHTML = html;

      // 信息栏
      if (data.is_drives) {
        dd.querySelector('#kbInfo').textContent = `${data.dirs.length} 个驱动器`;
      } else {
        dd.querySelector('#kbInfo').textContent = `${data.dirs.length} 个文件夹, ${data.files.length} 个Excel`;
      }

      // 绑定双击/点击
      dd.querySelectorAll('.kb-dir').forEach(item => {
        item.addEventListener('dblclick', () => browse(item.dataset.path));
        item.addEventListener('click', () => { selectedPath = item.dataset.path; dd.querySelectorAll('.kb-item').forEach(i => i.classList.remove('sel')); item.classList.add('sel'); });
      });
      dd.querySelectorAll('.kb-file').forEach(item => {
        item.addEventListener('click', () => { selectedPath = item.dataset.path; dd.querySelectorAll('.kb-item').forEach(i => i.classList.remove('sel')); item.classList.add('sel'); });
        item.addEventListener('dblclick', () => { targetInput.value = item.dataset.path; close(); });
      });
    } catch (e) {
      dd.querySelector('#kbList').innerHTML = `<div class="kd-batch-hint kd-batch-err">浏览失败: ${e.message}</div>`;
    }
  }

  // 从驱动器列表开始浏览
  browse('__drives__');

  const close = () => { overlay.remove(); dd.remove(); };
  overlay.addEventListener('click', close);
  dd.querySelector('#kbCancel').addEventListener('click', close);
  dd.querySelector('#kbUp').addEventListener('click', () => {
    if (currentIsDrives) return; // 已经在驱动器列表，无法再上
    // 优先使用后端返回的parent路径，更可靠（处理盘符根目录等情况）
    if (currentParent) {
      browse(currentParent);
      return;
    }
    // 回退：手动路径切割
    const p = dd.querySelector('#kbPath').value;
    if (!p) { browse('__drives__'); return; }
    const parent = p.replace(/[\\\/][^\\\/]+$/, '');
    if (parent && parent !== p) browse(parent);
    else browse('__drives__');
  });
  dd.querySelector('#kbGo').addEventListener('click', () => {
    const val = dd.querySelector('#kbPath').value.trim();
    browse(val || '__drives__');
  });
  dd.querySelector('#kbPath').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const val = dd.querySelector('#kbPath').value.trim();
      browse(val || '__drives__');
    }
  });
  dd.querySelector('#kbOk').addEventListener('click', () => {
    if (selectedPath) { targetInput.value = selectedPath; }
    close();
  });
}

// ===== 添加/编辑对话框 =====
function showKdocsEditDialog(sid) {
  const isEdit = !!sid;
  const s = isEdit ? KD.sheets.find(x => x.id === sid) : {};
  const overlay = document.createElement('div');
  overlay.className = 'fd-overlay vis';
  const dd = document.createElement('div');
  dd.className = 'fd-dropdown vis';
  dd.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%);width:520px;max-height:85vh;overflow-y:auto;';

  // 分类选项
  let catOpts = '<option value="default">默认</option>';
  KD.cats.forEach(c => { if (c.id !== 'default') catOpts += `<option value="${c.id}">${esc(c.name)}</option>`; });

  let html = `<div class="fd-head"><span class="fd-cn">${isEdit ? '编辑' : '添加'}在线表格</span></div>`;
  html += '<div style="padding:16px;display:flex;flex-direction:column;gap:14px">';
  html += `<div class="kd-form-row"><label>名称 *</label><input id="kdEdName" value="${esc(s.name || '')}" placeholder="如：6月商机统计表"></div>`;
  html += `<div class="kd-form-row"><label>URL *</label><input id="kdEdUrl" value="${esc(s.url || '')}" placeholder="https://www.kdocs.cn/l/xxxx"></div>`;
  html += '<div class="kd-form-row kd-form-2col">';
  html += `<div class="kd-form-col"><label>API Token</label><input id="kdEdToken" type="password" value="${esc(s.api_token || '')}" placeholder="AirScript脚本令牌"></div>`;
  html += `<div class="kd-form-col"><label>Webhook URL</label><input id="kdEdWebhook" type="password" value="${esc(s.webhook_url || '')}" placeholder="Webhook链接"></div>`;
  html += '</div>';

  // 本地路径：浏览选择
  html += `<div class="kd-form-row"><label>本地Excel路径</label><div class="kd-path-row">`;
  html += `<input id="kdEdPath" value="${esc(s.excel_path || '')}" placeholder="点击浏览选择本地Excel文件...">`;
  html += '<button class="btn btn-outline btn-xs" id="kdEdBrowseBtn">浏览</button>';
  html += '</div></div>';

  html += '<div class="kd-form-row kd-form-2col">';
  html += `<div class="kd-form-col"><label>分类</label><select id="kdEdCat" style="width:100%;background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:8px 10px;color:var(--t1);font:12px var(--sf);outline:none">${catOpts}</select></div>`;
  html += `<div class="kd-form-col"><label>批次大小</label><input id="kdEdBatch" type="number" value="${s.batch_size || 3}" min="1" max="20" style="width:100%"></div>`;
  html += '</div>';
  html += '</div>';
  html += '<div class="fd-foot"><span></span><div class="fd-btns"><button class="btn btn-ghost btn-xs" id="kdEdCancel">取消</button><button class="btn btn-primary btn-xs" id="kdEdOk">保存</button></div></div>';

  dd.innerHTML = html;
  document.body.appendChild(overlay);
  document.body.appendChild(dd);

  // 设置当前分类
  if (s.category) dd.querySelector('#kdEdCat').value = s.category;

  // 浏览按钮
  dd.querySelector('#kdEdBrowseBtn').addEventListener('click', () => {
    showFileBrowser(dd.querySelector('#kdEdPath'), 'file');
  });

  const close = () => { overlay.remove(); dd.remove(); };
  overlay.addEventListener('click', close);
  dd.querySelector('#kdEdCancel').addEventListener('click', close);

  dd.querySelector('#kdEdOk').addEventListener('click', async () => {
    const name = dd.querySelector('#kdEdName').value.trim();
    const url = dd.querySelector('#kdEdUrl').value.trim();
    const api_token = dd.querySelector('#kdEdToken').value.trim();
    const webhook_url = dd.querySelector('#kdEdWebhook').value.trim();
    const excel_path = dd.querySelector('#kdEdPath').value.trim();
    const batch_size = parseInt(dd.querySelector('#kdEdBatch').value) || 3;
    const category = dd.querySelector('#kdEdCat').value;

    if (!name || !url) { ntf('名称和URL不能为空', 'error'); return; }

    // 编辑时：如果token/webhook为空，保留原值
    const finalToken = api_token || (isEdit ? s.api_token : '');
    const finalWebhook = webhook_url || (isEdit ? s.webhook_url : '');

    const body = { name, url, api_token: finalToken, webhook_url: finalWebhook, excel_path, batch_size, category };

    try {
      if (isEdit) {
        await fetch(`/api/kdocs-sheets/${sid}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
      } else {
        await fetch('/api/kdocs-sheets', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
      }
      close();
      ntf(isEdit ? '已更新' : '已添加');
      loadKdocsSheets();
      loadKdocsCats();
    } catch (e) { ntf('保存失败', 'error'); }
  });
}

// ===== 单个推送 =====
async function pushKdocsSingle(sid) {
  const s = KD.sheets.find(x => x.id === sid);
  if (!s) return;

  const statusEl = document.getElementById(`kdStatus_${sid}`);
  if (statusEl) { statusEl.textContent = '推送中...'; statusEl.className = 'kd-card-status pushing'; }

  try {
    const res = await fetch('/api/kdocs-push', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ id: sid })
    });
    const data = await res.json();
    if (data.error) {
      if (statusEl) { statusEl.textContent = data.error; statusEl.className = 'kd-card-status error'; }
      ntf(data.error, 'error');
    } else {
      if (statusEl) { statusEl.textContent = `成功${data.success_count}行/失败${data.fail_count}行`; statusEl.className = 'kd-card-status ' + (data.fail_count > 0 ? 'partial' : 'ok'); }
      ntf(data.message, data.fail_count > 0 ? 'warn' : 'success');
      // 推送成功后清除本地Excel路径
      try {
        await fetch(`/api/kdocs-sheets/${sid}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ excel_path: '' }) });
        loadKdocsSheets();
      } catch(e) {}
    }
  } catch (e) {
    if (statusEl) { statusEl.textContent = '推送失败'; statusEl.className = 'kd-card-status error'; }
    ntf('推送失败: ' + e.message, 'error');
  }
}

// ===== 一键推送 =====
document.getElementById('kdBatchPushBtn').addEventListener('click', async () => {
  document.getElementById('kdBatchArea').style.display = '';
  document.getElementById('kdBatchResults').style.display = 'none';
  document.getElementById('kdBatchMatches').innerHTML = '';
  await loadKdocsCats();  // 确保分类数据最新
});
document.getElementById('kdBatchClose').addEventListener('click', () => {
  document.getElementById('kdBatchArea').style.display = 'none';
});

// 一键推送的浏览按钮
document.getElementById('kdBatchBrowseBtn').addEventListener('click', () => {
  showFileBrowser(document.getElementById('kdBatchFolder'), 'folder');
});

// 扫描匹配
document.getElementById('kdBatchScanBtn').addEventListener('click', renderBatchMatches);
document.getElementById('kdBatchFolder').addEventListener('change', renderBatchMatches);

async function renderBatchMatches() {
  const folderPath = document.getElementById('kdBatchFolder').value.trim();
  const matchDiv = document.getElementById('kdBatchMatches');
  if (!folderPath) { matchDiv.innerHTML = '<div class="kd-batch-hint">请输入或浏览文件夹路径</div>'; return; }

  try {
    const res = await fetch('/api/kdocs-folder-scan', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ folder_path: folderPath })
    });
    const data = await res.json();
    if (data.error) { matchDiv.innerHTML = `<div class="kd-batch-hint kd-batch-err">${data.error}</div>`; return; }

    const localFiles = data.files || [];
    if (!localFiles.length) { matchDiv.innerHTML = '<div class="kd-batch-hint">文件夹中无Excel文件</div>'; return; }

    // 获取所有在线表格（不分分类）
    const allRes = await fetch('/api/kdocs-sheets');
    const allSheets = await allRes.json();

    // 匹配
    let html = '<div class="kd-match-list">';
    let matchCount = 0;
    allSheets.forEach(s => {
      const onlineName = s.name.replace(/\.xlsx?$/i, '').toLowerCase();
      let matched = null;
      for (const lf of localFiles) {
        const lfBase = lf.name.replace(/\.xlsx?$/i, '').toLowerCase();
        if (onlineName && lfBase && (onlineName.includes(lfBase) || lfBase.includes(onlineName))) {
          matched = lf;
          break;
        }
      }
      if (!matched) return; // 未匹配的不显示
      matchCount++;
      const hasConfig = !!s.api_token && !!s.webhook_url;
      html += `<div class="kd-match-item ${hasConfig ? 'kd-match-ready' : 'kd-match-skip'}">
        <div class="kd-match-online">
          <span class="kd-match-dot ${hasConfig ? 'dot-ok' : 'dot-skip'}"></span>
          <span class="kd-match-name">${esc(s.name)}</span>
          ${!hasConfig ? '<span class="kd-match-tag tag-no-config">缺少配置</span>' : ''}
        </div>
        <div class="kd-match-arrow">&#8594;</div>
        <div class="kd-match-local">
          <span class="kd-match-file">${esc(matched.name)}</span>
        </div>
      </div>`;
    });
    html += '</div>';
    if (!matchCount) html = '<div class="kd-batch-hint">未找到匹配的在线表格</div>';
    matchDiv.innerHTML = html;
  } catch (e) {
    matchDiv.innerHTML = `<div class="kd-batch-hint kd-batch-err">扫描失败: ${e.message}</div>`;
  }
}

document.getElementById('kdBatchGoBtn').addEventListener('click', async () => {
  const folderPath = document.getElementById('kdBatchFolder').value.trim();
  if (!folderPath) { ntf('请先选择文件夹', 'error'); return; }

  const resultsDiv = document.getElementById('kdBatchResults');
  resultsDiv.style.display = '';
  resultsDiv.innerHTML = '<div class="kd-batch-hint">正在推送中，请稍候...</div>';

  try {
    const res = await fetch('/api/kdocs-push-batch', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ folder_path: folderPath })
    });
    const data = await res.json();
    if (data.error) { resultsDiv.innerHTML = `<div class="kd-batch-hint kd-batch-err">${data.error}</div>`; return; }

    const results = data.results || [];
    let html = '<div class="kd-batch-result-list">';
    results.forEach(r => {
      const statusCls = r.status === 'ok' ? 'kd-res-ok' : r.status === 'partial' ? 'kd-res-partial' : 'kd-res-skip';
      const icon = r.status === 'ok' ? '&#10003;' : r.status === 'partial' ? '&#9888;' : '&#10007;';
      html += `<div class="kd-batch-result-item ${statusCls}">
        <span class="kd-res-icon">${icon}</span>
        <span class="kd-res-name">${esc(r.name)}</span>
        ${r.file ? `<span class="kd-res-file">${esc(r.file)}</span>` : ''}
        <span class="kd-res-msg">${esc(r.message)}</span>
      </div>`;
    });
    if (!results.length) html += '<div class="kd-batch-hint">没有匹配的表格需要推送</div>';
    html += '</div>';
    resultsDiv.innerHTML = html;
    ntf(`一键推送完成：${results.filter(r => r.status === 'ok').length} 成功`);
  } catch (e) {
    resultsDiv.innerHTML = `<div class="kd-batch-hint kd-batch-err">推送失败: ${e.message}</div>`;
    ntf('推送失败', 'error');
  }
});

// 添加按钮
document.getElementById('kdAddBtn').addEventListener('click', () => showKdocsEditDialog(null));
document.getElementById('kdRefreshBtn').addEventListener('click', () => { loadKdocsSheets(); loadKdocsCats(); });

// 脚本代码查看按钮
document.getElementById('kdShowScriptBtn').addEventListener('click', async () => {
  const overlay = document.createElement('div');
  overlay.className = 'fd-overlay vis';
  const dd = document.createElement('div');
  dd.className = 'fd-dropdown vis';
  dd.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%);width:660px;max-height:80vh;display:flex;flex-direction:column;';

  // 从后端加载脚本代码
  async function loadCode() {
    try {
      const res = await fetch('/api/kdocs-airscript-code');
      const data = await res.json();
      if (data.error) { ntf(data.error, 'error'); return ''; }
      return data.code || '';
    } catch (e) {
      ntf('获取脚本代码失败', 'error'); return '';
    }
  }

  let codeContent = await loadCode();
  if (!codeContent) { overlay.remove(); dd.remove(); return; }

  dd.innerHTML = `<div class="fd-head"><span class="fd-cn">AirScript 脚本代码</span><span class="kd-script-badge" id="kdScriptModified" style="display:none">已修改</span></div>
    <div style="padding:0;flex:1;overflow:auto;position:relative">
      <textarea class="kd-script-editor" id="kdScriptEditor" spellcheck="false"></textarea>
    </div>
    <div class="fd-foot"><span class="kd-script-hint">编辑后可保存到文件，或一键复制粘贴到金山文档脚本编辑器</span><div class="fd-btns">
      <button class="btn btn-ghost btn-xs" id="kdScriptRestore" title="还原为文件中的原始代码">一键还原</button>
      <button class="btn btn-outline btn-xs" id="kdScriptSave">保存</button>
      <button class="btn btn-primary btn-xs" id="kdScriptCopy">一键复制</button>
      <button class="btn btn-ghost btn-xs" id="kdScriptClose">关闭</button>
    </div></div>`;
  document.body.appendChild(overlay);
  document.body.appendChild(dd);

  const editor = dd.querySelector('#kdScriptEditor');
  const modifiedBadge = dd.querySelector('#kdScriptModified');
  let originalCode = codeContent;
  let lastSavedCode = codeContent;

  editor.value = codeContent;

  // 监听编辑：显示"已修改"标记
  editor.addEventListener('input', () => {
    const changed = editor.value !== lastSavedCode;
    modifiedBadge.style.display = changed ? '' : 'none';
  });

  // 一键复制
  dd.querySelector('#kdScriptCopy').addEventListener('click', () => {
    navigator.clipboard.writeText(editor.value).then(() => ntf('已复制到剪贴板')).catch(() => ntf('复制失败', 'error'));
  });

  // 一键还原
  dd.querySelector('#kdScriptRestore').addEventListener('click', async () => {
    const fresh = await loadCode();
    if (fresh) {
      editor.value = fresh;
      originalCode = fresh;
      lastSavedCode = fresh;
      modifiedBadge.style.display = 'none';
      ntf('已还原为原始代码');
    }
  });

  // 保存
  dd.querySelector('#kdScriptSave').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/kdocs-airscript-code', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ code: editor.value })
      });
      const data = await res.json();
      if (data.error) { ntf(data.error, 'error'); return; }
      lastSavedCode = editor.value;
      modifiedBadge.style.display = 'none';
      ntf('脚本代码已保存');
    } catch (e) {
      ntf('保存失败: ' + e.message, 'error');
    }
  });

  const close = () => { overlay.remove(); dd.remove(); };
  overlay.addEventListener('click', close);
  dd.querySelector('#kdScriptClose').addEventListener('click', close);
});
