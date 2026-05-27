// ========== 主题切换（必须在最前面，防止闪烁） ==========
(function initTheme() {
  const saved = localStorage.getItem('ba-theme');
  const preferDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (preferDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
})();

function applyThemeUI(theme) {
  const icon = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  if (theme === 'light') {
    icon.innerHTML = '&#9728;'; // 太阳
    label.textContent = '亮色';
  } else {
    icon.innerHTML = '&#9790;'; // 月亮
    label.textContent = '暗色';
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('ba-theme', next);
  applyThemeUI(next);
}

// ========== 刷新持久化 ==========
function saveState() {
  try {
    const serializable = {
      activeFileId: S.activeFileId,
      currentStep: S.currentStep,
      mappingData: S.mappingData,
      splitResult: S.splitResult,
      files: S.files.map(f => ({
        id: f.id,
        name: f.name,
        hdr: f.hdr,
        l1: {},
        grps: f.grps,
        gid: f.gid,
        addedCols: f.addedCols,
        sumCol: f.sumCol,
        hiddenCols: [...f.hiddenCols]
      }))
    };
    // 序列化 l1 (Set → Array)
    S.files.forEach((f, fi) => {
      f.hdr.forEach(col => {
        const l1f = f.l1[col];
        serializable.files[fi].l1[col] = {
          checked: l1f.checked ? [...l1f.checked] : null,
          cascade: l1f.cascade || false,
          dependCol: l1f.dependCol || null,
          sort: l1f.sort || null,
          condOn: l1f.condOn || false,
          condOp: l1f.condOp || 'eq',
          condVal: l1f.condVal || ''
        };
      });
    });
    localStorage.setItem('ba-state', JSON.stringify(serializable));
  } catch (e) { /* quota exceeded, ignore */ }
}

function loadState() {
  try {
    const saved = localStorage.getItem('ba-state');
    if (!saved) return false;
    const data = JSON.parse(saved);
    if (!data.files || !data.files.length) return false;
    S.currentStep = data.currentStep || 'upload';
    S.mappingData = data.mappingData || {};
    S.splitResult = data.splitResult || null;
    S.files = data.files.map(fc => {
      const hdr = fc.hdr || [];
      const l1 = {};
      hdr.forEach(c => {
        const lf = fc.l1 && fc.l1[c];
        l1[c] = lf ? {
          checked: lf.checked ? new Set(lf.checked) : null,
          cascade: lf.cascade || false,
          dependCol: lf.dependCol || null,
          sort: lf.sort || null,
          condOn: lf.condOn || false,
          condOp: lf.condOp || 'eq',
          condVal: lf.condVal || ''
        } : newL1();
      });
      const grps = (fc.grps || []).map(g => ({
        id: g.id, name: g.name, color: g.color, column: g.column,
        values: g.values || [], l1Dep: g.l1Dep || null,
        parentId: g.parentId || null, parentRel: g.parentRel || null
      }));
      return {
        id: fc.id, name: fc.name, raw: [], hdr, l1, grps,
        gid: fc.gid || 0, addedCols: fc.addedCols || [],
        sumCol: fc.sumCol || '', hiddenCols: new Set(fc.hiddenCols || []),
        rawFileData: null
      };
    });
    fileIdCounter = Math.max(...S.files.map(f => f.id), 0);
    S.activeFileId = data.activeFileId || S.files[0].id;
    return true;
  } catch (e) { return false; }
}

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
  mappingData: {},
  splitMatchedRows: null,  // Set<row ref> - 拆分后匹配的行引用集合
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

// ========== 拆分列选择器 ==========
function populateSplitColSel() {
  const sel = document.getElementById('splitColSel');
  if (!sel) return;
  const f = getActiveFile();
  const cur = sel.value;
  sel.innerHTML = '<option value="">-- 选择拆分列 --</option>';
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
  const navMap = {upload:'navUpload', filter1:'navFilter1', split:'navSplit', filter2:'navFilter2'};
  document.getElementById(navMap[step])?.classList.add('active');
  // 更新侧栏统计
  if (step !== 'upload') {
    document.getElementById('sbStats').style.display = '';
    updSbStats();
  }
}
function capitalize(s) {
  const map = {upload:'Upload', filter1:'Filter1', split:'Split', filter2:'Filter2'};
  return map[s] || s;
}

function updSbStats() {
  const f = getActiveFile();
  if (!f) return;
  const fd = getFilteredData();
  document.getElementById('sAll').textContent = f.raw.length;
  document.getElementById('sFil').textContent = fd.length;
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
  const g = grps.find(x => x.id === gid);
  let ctx;
  const valSet = new Set(g.values.map(v => String(v).trim()));
  if (!g.parentId) {
    ctx = l1Data.filter(r => valSet.has(String(r[g.column] ?? '').trim()));
  } else {
    const parentCtx = getGroupContext(g.parentId, l1Data, grps, cache);
    const selfMatch = l1Data.filter(r => valSet.has(String(r[g.column] ?? '').trim()));
    if (g.parentRel === 'AND') {
      const ps = new Set(parentCtx);
      ctx = selfMatch.filter(r => ps.has(r));
    } else {
      const seen = new Set();
      ctx = [];
      [...parentCtx, ...selfMatch].forEach(r => { if (!seen.has(r)) { seen.add(r); ctx.push(r); } });
    }
  }
  cache[gid] = ctx;
  return ctx;
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
      // 检查是否有同名的配置已保存但需要重连数据
      const existing = S.files.find(f => f.name === file.name && f._needsReupload && hdrSignature(f.hdr) === hdrSignature(hdr));
      if (existing) {
        // 重连：填充数据但保留配置
        existing.raw = json;
        existing.rawFileData = rawBuffer;
        delete existing._needsReupload;
        ntf(`已加载数据并恢复配置 ${file.name} (${json.length} 行)`);
      } else {
        const l1 = {};
        hdr.forEach(c => { l1[c] = newL1(); });
        S.files.push({
          id: ++fileIdCounter,
          name: file.name,
          raw: json,
          hdr,
          l1,
          grps: [],
          gid: 0,
          addedCols: [],
          sumCol: '',
          hiddenCols: new Set(),
          rawFileData: rawBuffer
        });
        ntf(`已加载 ${file.name} (${json.length} 行)`);
      }
      renderFileList();
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
  renderFileList();
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
function renderL2FileTabs() {
  const div = document.getElementById('l2FileTabs');
  if (!div) return;
  if (!S.files.length) { div.innerHTML = ''; document.getElementById('l2Preview').style.display = 'none'; return; }
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
  if (!f || !f.raw.length) { div.style.display = 'none'; return; }
  div.style.display = 'block';
  let l1Data = getFilteredData();
  if (S.splitMatchedRows && S.splitMatchedRows.size > 0) {
    l1Data = l1Data.filter(r => S.splitMatchedRows.has(r));
  }
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
  const sel = document.getElementById('gDepGrp'), f = getActiveFile();
  sel.innerHTML = '<option value="">-- 无(独立) --</option>';
  f.grps.forEach(g => { sel.innerHTML += `<option value="${g.id}">${esc(g.name)} (${esc(g.column)})</option>`; });
  document.getElementById('l2RelF').style.display = sel.value ? 'flex' : 'none';
}
document.getElementById('gDepGrp').addEventListener('change', e => { document.getElementById('l2RelF').style.display = e.target.value ? 'flex' : 'none'; });

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
  const pGroupId = document.getElementById('gDepGrp').value, pRel = document.getElementById('gDepRel').value;
  if (!col) { ntf('请选择列', 'error'); return; }
  if (!name) { ntf('请输入分组名', 'error'); return; }
  if (!S.selGVals.length) { ntf('请选择值', 'error'); return; }
  const l1f = f.l1[col];
  f.grps.push({
    id: ++f.gid, name, color: S.selGColor, column: col, values: [...S.selGVals],
    l1Dep: {col, cascade: l1f.cascade, dependCol: l1f.dependCol, filtered: l1f.checked && l1f.checked.size < uniq(col).length},
    parentId: pGroupId ? +pGroupId : null,
    parentRel: pGroupId ? pRel : null
  });
  S.selGVals = [];
  document.getElementById('gName').value = '';
  renderVP2(col);
  renderGrpCards();
  popDepGrp();
  ntf(`分组 "${name}" 已创建`);
});

function renderGrpCards() {
  const f = getActiveFile();
  if (!f) return;
  const div = document.getElementById('grpCards');
  if (!f.grps.length) { div.innerHTML = ''; return; }
  let html = '';
  f.grps.forEach(g => {
    const cm = CM[g.color] || CM.blue;
    const l1Info = g.l1Dep ? `L1:${esc(g.l1Dep.col)}` : '';
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
    html += `<div class="gc"><div class="gc-h"><span class="gc-dot" style="background:${cm.d}"></span><span class="gc-n">${esc(g.name)}</span><span class="gc-col">${esc(g.column)} ${l1Info}</span><button class="btn btn-danger btn-xs" data-del="${g.id}">✕</button></div><div class="gc-vs">${g.values.map(v => `<span class="gc-v ${cm.t}">${esc(v)}</span>`).join('')}</div>${depHtml}${chHtml}</div>`;
  });
  div.innerHTML = html;
  div.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const delId = +b.dataset.del;
    f.grps.forEach(g => { if (g.parentId === delId) g.parentId = null; });
    f.grps = f.grps.filter(g => g.id !== delId);
    const col = document.getElementById('gCol').value;
    if (col) { renderVP2(col); showL2BaseInfo(col); }
    renderGrpCards();
    popDepGrp();
    ntf('已删除');
  }));
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
  let html = '';
  S.files.forEach((file, fi) => {
    if (!file.raw.length) return; // 跳过无数据文件
    const sumCol = file.sumCol || '';
    let l1Data = getFilteredData_forFile(file);
    // 如果已执行拆分，排除未匹配行
    if (S.splitMatchedRows && S.splitMatchedRows.size > 0) {
      l1Data = l1Data.filter(r => S.splitMatchedRows.has(r));
    }
    const ctxCache = {};
    const entries = [];
    const groupedValsByCol = {};
    file.grps.forEach(g => {
      if (!groupedValsByCol[g.column]) groupedValsByCol[g.column] = new Set();
      g.values.forEach(v => groupedValsByCol[g.column].add(String(v)));
    });
    file.grps.forEach(g => {
      const ctx = getGroupContext(g.id, l1Data, file.grps, ctxCache);
      let depLabel = g.l1Dep ? `L1:${g.l1Dep.col}` : '';
      if (g.parentId) {
        const pg = file.grps.find(x => x.id === g.parentId);
        if (pg) depLabel += ` ${g.parentRel}→${pg.name}`;
      } else depLabel += ' (独立)';
      const entry = {name: g.name, color: g.color, isGroup: true, column: g.column, count: ctx.length, pct: l1Data.length > 0 ? (ctx.length / l1Data.length * 100).toFixed(1) : '0', depInfo: depLabel};
      if (sumCol) entry.sum = ctx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
      file.addedCols.forEach(ac => { const tc = {}; ctx.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; }); entry['ac_' + ac] = tc; });
      entries.push(entry);
    });
    if (!file.grps.length) {
      entries.push({name: '(未分组)', color: null, isGroup: false, column: '', count: l1Data.length, pct: '100', depInfo: ''});
    }
    const allRows = new Set();
    file.grps.forEach(g => { getGroupContext(g.id, l1Data, file.grps, ctxCache).forEach(r => allRows.add(r)); });
    const totalRows = [...allRows];
    const total = {name: '合计', isTotal: true, count: totalRows.length, pct: l1Data.length > 0 ? (totalRows.length / l1Data.length * 100).toFixed(1) : '0', sum: sumCol ? totalRows.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0) : null};
    file.addedCols.forEach(ac => { const tc = {}; totalRows.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; }); total['ac_' + ac] = tc; });

    const secColor = SEC_COLORS[fi % SEC_COLORS.length];
    let scOpts = '<option value="">-- 无 --</option>';
    file.hdr.forEach(c => { scOpts += `<option value="${esc(c)}"${c === sumCol ? ' selected' : ''}>${esc(c)}</option>`; });
    html += `<div class="rv-section"><div class="rv-section-hdr"><span class="sec-dot" style="background:${secColor}"></span>${esc(file.name)}<span class="sec-info">${file.raw.length}行 / ${file.hdr.length}列 / ${file.grps.length}分组</span><div class="rv-sum-sel"><label>求和列</label><select data-fid="${file.id}" class="rv-sc">${scOpts}</select></div></div>`;
    html += '<table class="rt"><thead><tr><th>类别</th><th>依托</th><th>列</th><th style="text-align:right">数量</th><th style="text-align:right">占比</th>';
    if (sumCol) html += `<th style="text-align:right">${esc(sumCol)} 求和</th>`;
    file.addedCols.forEach(ac => html += `<th style="text-align:right">${esc(ac)} 类型数</th>`);
    html += '</tr></thead><tbody>';
    entries.forEach(e => {
      const cm = e.color ? CM[e.color] : null;
      html += '<tr>';
      html += `<td><div class="cc">${cm ? `<span class="cdot" style="background:${cm.d}"></span>` : ''}<span class="gico">${e.isGroup ? '📁' : '📌'}</span> ${esc(e.name)}</div></td>`;
      html += `<td style="color:var(--cy);font-size:10px;font-family:var(--mf)">${esc(e.depInfo)}</td>`;
      html += `<td style="color:var(--t3);font-size:10px">${esc(e.column)}</td>`;
      html += `<td class="nc">${e.count}</td><td class="nc">${e.pct}%</td>`;
      if (sumCol) html += `<td class="nc" style="color:var(--wn)">${e.sum !== undefined ? fmtN(e.sum) : '-'}</td>`;
      file.addedCols.forEach(ac => { const tc = e['ac_' + ac] || {}; html += `<td class="nc" style="color:var(--cy)">${Object.keys(tc).length} 种</td>`; });
      html += '</tr>';
    });
    html += `<tr class="tot"><td>合计</td><td></td><td></td><td class="nc">${total.count}</td><td class="nc">${total.pct}%</td>`;
    if (sumCol) html += `<td class="nc" style="color:var(--wn)">${fmtN(total.sum)}</td>`;
    file.addedCols.forEach(ac => { const tc = total['ac_' + ac] || {}; html += `<td class="nc" style="color:var(--cy)">${Object.keys(tc).length} 种</td>`; });
    html += '</tr></tbody></table>';
    if (file.addedCols.length) {
      file.addedCols.forEach(ac => {
        html += `<div class="det-sec"><div class="det-hdr">${esc(ac)} 详细分布</div><table class="rt"><thead><tr><th>类别</th><th>${esc(ac)} 值</th><th style="text-align:right">数量</th></tr></thead><tbody>`;
        entries.forEach(e => {
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
    html += '</div>';
  });
  area.innerHTML = html;
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
    // 如果已执行拆分，排除未匹配行
    if (S.splitMatchedRows && S.splitMatchedRows.size > 0) {
      l1Data = l1Data.filter(r => S.splitMatchedRows.has(r));
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

function saveGlobalConfig() {
  const cfg = {files: S.files.map(f => ({name: f.name, hdr: f.hdr, l1: {}, grps: f.grps.map(g => ({name: g.name, color: g.color, column: g.column, values: g.values, l1Dep: g.l1Dep, parentId: g.parentId, parentRel: g.parentRel})), addedCols: f.addedCols, sumCol: f.sumCol || '', hiddenCols: [...f.hiddenCols]}))};
  S.files.forEach((_, fi) => {
    const f = S.files[fi];
    f.hdr.forEach(col => {
      const l1f = f.l1[col];
      cfg.files[fi].l1[col] = {checked: l1f.checked ? [...l1f.checked] : null, cascade: l1f.cascade || false, dependCol: l1f.dependCol || null, sort: l1f.sort || null, condOn: l1f.condOn || false, condOp: l1f.condOp || 'eq', condVal: l1f.condVal || ''};
    });
  });
  const sig = hdrSignature(S.files.map(f => f.hdr).flat());
  try {
    let configs = JSON.parse(localStorage.getItem('ba-configs') || '{}');
    const configName = `config_${new Date().toLocaleString('zh-CN').replace(/[\/:]/g, '-')}`;
    configs[configName] = {sig, cfg, savedAt: Date.now()};
    const keys = Object.keys(configs);
    if (keys.length > 20) {
      keys.sort((a, b) => configs[a].savedAt - configs[b].savedAt);
      keys.slice(0, keys.length - 20).forEach(k => delete configs[k]);
    }
    localStorage.setItem('ba-configs', JSON.stringify(configs));
  } catch (e) { /* ignore */ }
  ntf('配置已保存');
}

function exportConfig() {
  const cfg = {files: S.files.map(f => ({name: f.name, hdr: f.hdr, l1: {}, grps: f.grps.map(g => ({name: g.name, color: g.color, column: g.column, values: g.values, l1Dep: g.l1Dep, parentId: g.parentId, parentRel: g.parentRel})), addedCols: f.addedCols, sumCol: f.sumCol || '', hiddenCols: [...f.hiddenCols]}))};
  S.files.forEach((_, fi) => {
    const f = S.files[fi];
    f.hdr.forEach(col => {
      const l1f = f.l1[col];
      cfg.files[fi].l1[col] = {checked: l1f.checked ? [...l1f.checked] : null, cascade: l1f.cascade || false, dependCol: l1f.dependCol || null, sort: l1f.sort || null, condOn: l1f.condOn || false, condOp: l1f.condOp || 'eq', condVal: l1f.condVal || ''};
    });
  });
  const blob = new Blob([JSON.stringify(cfg, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'filter_config.json'; a.click();
  URL.revokeObjectURL(url);
  ntf('配置已导出');
}

document.getElementById('btnSave').addEventListener('click', saveGlobalConfig);
document.getElementById('btnExport').addEventListener('click', exportConfig);

document.getElementById('btnLoad').addEventListener('click', () => {
  let configs = {};
  try { configs = JSON.parse(localStorage.getItem('ba-configs') || '{}'); } catch (e) {}
  const keys = Object.keys(configs);
  if (!keys.length) {
    ntf('无已保存配置', 'warn');
    return;
  }
  // 按表头匹配筛选
  const currentSigs = S.files.map(f => hdrSignature(f.hdr));
  const matched = keys.filter(k => {
    const cfgSigs = configs[k].cfg.files.map(f => hdrSignature(f.hdr));
    return cfgSigs.some(cs => currentSigs.includes(cs));
  });
  if (matched.length === 0) {
    ntf('无匹配当前文件的配置', 'warn');
    return;
  }
  showConfigPicker(matched, configs);
});

function showConfigPicker(matchedKeys, configs) {
  // 创建选择弹窗
  const overlay = document.createElement('div');
  overlay.className = 'fd-overlay vis';
  const dd = document.createElement('div');
  dd.className = 'fd-dropdown vis';
  dd.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%);width:400px;max-height:500px;';
  let html = `<div class="fd-head"><span class="fd-cn">选择配置</span><div class="fd-acts"><button class="btn btn-ghost btn-xs" id="cfgFileImport">从文件导入</button></div></div>`;
  html += '<div class="fd-value-list" style="max-height:320px">';
  matchedKeys.forEach(k => {
    const c = configs[k];
    const date = new Date(c.savedAt).toLocaleString('zh-CN');
    const fileNames = c.cfg.files.map(f => esc(f.name)).join(', ');
    html += `<div class="fd-item" data-cfg-key="${esc(k)}" style="flex-direction:column;align-items:flex-start;gap:4px;padding:10px 14px">
      <div style="font-weight:600;font-size:12px">${esc(k)}</div>
      <div style="font-size:10px;color:var(--t3)">${date} - ${fileNames}</div>
    </div>`;
  });
  html += '</div>';
  html += '<div class="fd-foot"><span class="fd-cnt">' + matchedKeys.length + ' 个匹配</span><div class="fd-btns"><button class="btn btn-ghost btn-xs" id="cfgCancel">取消</button></div></div>';
  dd.innerHTML = html;
  document.body.appendChild(overlay);
  document.body.appendChild(dd);

  overlay.addEventListener('click', () => { overlay.remove(); dd.remove(); });
  dd.querySelector('#cfgCancel').addEventListener('click', () => { overlay.remove(); dd.remove(); });
  dd.querySelector('#cfgFileImport').addEventListener('click', () => { overlay.remove(); dd.remove(); document.getElementById('cfgIn').click(); });
  dd.querySelectorAll('.fd-item').forEach(item => item.addEventListener('click', () => {
    const key = item.dataset.cfgKey;
    const cfg = configs[key].cfg;
    applyConfig(cfg);
    overlay.remove();
    dd.remove();
  }));
}

function applyConfig(cfg) {
  if (!cfg.files || !cfg.files.length) { ntf('配置文件格式错误', 'error'); return; }
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
        targetFile.grps.push({id: ++targetFile.gid, name: g.name, color: g.color, column: g.column, values: g.values, l1Dep: g.l1Dep || null, parentId: g.parentId || null, parentRel: g.parentRel || null});
      });
    }
  });
  initActiveFile();
  ntf('配置已应用');
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
    html += `<div class="bureau-card" data-index="${i}">
      <div class="bureau-header" onclick="toggleBureau(this)">
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
}

function toggleBureau(header) { header.closest('.bureau-card').classList.toggle('open'); }
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
  if (!f || !f.rawFileData || !f.raw.length) { ntf('请先上传文件并加载数据（刷新页面后需重新上传）', 'error'); return; }

  const splitCol = getSplitCol();
  if (!splitCol) { ntf('请选择拆分列', 'error'); return; }

  const overlay = document.getElementById('progressOverlay');
  overlay.style.display = 'flex';

  try {
    // 计算一级过滤后数据在原始raw中的索引
    const filteredData = getFilteredData();
    const filteredIndices = [];
    filteredData.forEach(row => {
      const idx = f.raw.indexOf(row);
      if (idx >= 0) filteredIndices.push(idx);
    });

    // 将原始文件数据转base64
    const b64 = arrayBufferToBase64(f.rawFileData);

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
    // 计算拆分后匹配的行集合（用于L2统计时排除未匹配行）
    const splitColName = getSplitCol();
    if (splitColName && S.mappingData) {
      const matchedSet = new Set();
      f.raw.forEach(row => {
        const val = String(row[splitColName] ?? '').trim();
        for (const members of Object.values(S.mappingData)) {
          if (members.some(m => m === val)) {
            matchedSet.add(row);
            break;
          }
        }
      });
      S.splitMatchedRows = matchedSet;
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
    if (step === 'upload' || S.files.length) switchStep(step);
  });
});

// 上传区
document.getElementById('goFilter1').addEventListener('click', () => {
  if (!S.files.length) { ntf('请先上传文件', 'error'); return; }
  S.activeFileId = S.files[0].id;
  switchStep('filter1');
  initActiveFile();
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
document.getElementById('goFilter2FromSplit').addEventListener('click', () => switchStep('filter2'));

// ========== 姓名预处理 ==========
document.getElementById('btnPreprocess').addEventListener('click', () => {
  const f = getActiveFile();
  if (!f || !f.raw.length) { ntf('请先上传文件', 'error'); return; }
  const col = getSplitCol();
  if (!col) { ntf('请先选择拆分列', 'error'); return; }
  const mapping = S.mappingData;
  if (!Object.keys(mapping).length) { ntf('映射数据为空', 'error'); return; }

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
      for (const [bureau, members] of Object.entries(mapping)) {
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

  // 显示结果
  const div = document.getElementById('preprocessResult');
  div.style.display = 'block';
  div.innerHTML = `
    <div style="margin-bottom:6px;font-weight:600">预处理结果</div>
    <span class="pp-stat pp-ok"><span class="pp-val">${processedCount}</span>条已处理</span>
    <span class="pp-stat pp-multi"><span class="pp-val">${multiCount}</span>条多人名</span>
    <span class="pp-stat pp-empty"><span class="pp-val">${emptyCount}</span>条为空</span>
    <div class="pp-detail">${details.map(d => `<div>${esc(d)}</div>`).join('')}</div>
  `;
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

// 主题切换
document.getElementById('themeToggle').addEventListener('click', toggleTheme);
applyThemeUI(document.documentElement.getAttribute('data-theme') || 'dark');

// 恢复持久化状态
(function restoreState() {
  if (loadState()) {
    // 清除无数据的文件（raw为空需要重新上传）
    const emptyFiles = S.files.filter(f => !f.raw.length);
    if (emptyFiles.length) {
      // 保留配置信息但标记需要重新上传
      S.files.forEach(f => { if (!f.raw.length) f._needsReupload = true; });
    }
    renderFileList();
    switchStep(S.currentStep);
    if (emptyFiles.length) {
      ntf('已恢复配置，请重新上传文件以加载数据', 'warn');
    }
  }
})();
