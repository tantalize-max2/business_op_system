// ========== common.js — 公共基础设施（主题、导航、工具函数、数据管道） ==========

// ========== 主题切换（必须在最前面，防止闪烁） ==========
const THEMES = ['light', 'dark', 'eyecare'];
const THEME_LABELS = { light: '白天', dark: '黑夜', eyecare: '护眼' };
const THEME_ICONS = { light: 'icon-sun', dark: 'icon-moon', eyecare: 'icon-eye' };

(function initTheme() {
  const saved = localStorage.getItem('ba-theme');
  const theme = saved && THEMES.includes(saved) ? saved : 'light';
  document.documentElement.setAttribute('data-theme', theme);
})();

function applyThemeUI(theme) {
  const iconSvg = document.getElementById('themeIconSvg');
  const label = document.getElementById('themeLabel');
  if (iconSvg) {
    const use = iconSvg.querySelector('use');
    if (use) use.setAttribute('xlink:href', '#' + (THEME_ICONS[theme] || THEME_ICONS.light));
  }
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
  // 保存mappingData、splitGroups和拆分状态（用于刷新后恢复）
  try {
    const hasSplit = S.splitMatchedRows && S.splitMatchedRows.size > 0;
    localStorage.setItem('ba-state', JSON.stringify({
      mappingData: S.mappingData,
      splitGroups: S.splitGroups,
      // 只在有拆分状态时持久化，清除时保存null
      splitFileName: hasSplit ? S.splitFileName : null,
      splitColName: hasSplit ? S.splitColName : null
    }));
  } catch (e) { /* ignore */ }
}

// loadState 已移除：mappingData 通过后端 API 持久化
// 拆分状态的恢复在 step1-upload.js 的 restoreSplitState 中处理（需要文件存在）

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
  splitGroups: null,       // {组名: [分局列表]} - 拆分组配置，null时使用默认值
  splitFileName: null,     // 执行拆分时的文件名（用于刷新后恢复拆分状态）
  splitColName: null,      // 执行拆分时的拆分列名（用于刷新后恢复拆分状态）
  splitMappingReady: false, // 是否已通过应用模板或加载配置激活分局映射（控制拆分区域显示）
  _localMapping: null       // 未激活模板时的临时映射（添加分局不污染默认 mappingData）
};

const CM = {
  teal:   {d:'#14b8a6', t:'t-blue'},
  green:  {d:'#2dd4a0', t:'t-green'},
  orange: {d:'#f0a030', t:'t-orange'},
  purple: {d:'#a78bfa', t:'t-purple'},
  cyan:   {d:'#22c8dc', t:'t-cyan'},
  red:    {d:'#f05050', t:'t-red'}
};
const SEC_COLORS = ['#14b8a6','#2dd4a0','#f0a030','#a78bfa','#22c8dc','#f05050','#ec4899','#84cc16'];

// ========== 工具函数 ==========
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function ntf(m, t='success') {
  const e = document.getElementById('toast');
  e.textContent = m;
  e.className = `toast ${t} show`;
  setTimeout(() => e.classList.remove('show'), 2200);
}

// ========== 玻璃拟态弹窗（替代原生 confirm / prompt） ==========
/**
 * 玻璃拟态确认框（替代 confirm）
 * @param {string} message - 提示信息
 * @param {Function} onConfirm - 确认回调
 * @param {Object} [opts] - 选项 { title, confirmText, cancelText }
 */
function glassConfirm(message, onConfirm, opts = {}) {
  const title = opts.title || '确认操作';
  const confirmText = opts.confirmText || '确定';
  const cancelText = opts.cancelText || '取消';
  const overlay = document.createElement('div');
  overlay.className = 'glass-overlay';
  const dlg = document.createElement('div');
  dlg.className = 'glass-dialog';
  dlg.innerHTML = `
    <div class="glass-dlg-head">
      <span class="glass-dlg-title">${esc(title)}</span>
      <span class="glass-dlg-close" data-close>&times;</span>
    </div>
    <div class="glass-dlg-body">${esc(message)}</div>
    <div class="glass-dlg-foot">
      <button class="btn btn-ghost btn-sm glass-dlg-cancel">${esc(cancelText)}</button>
      <button class="btn btn-primary btn-sm glass-dlg-ok">${esc(confirmText)}</button>
    </div>`;
  overlay.appendChild(dlg);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  dlg.querySelector('[data-close]').addEventListener('click', close);
  dlg.querySelector('.glass-dlg-cancel').addEventListener('click', close);
  dlg.querySelector('.glass-dlg-ok').addEventListener('click', () => { close(); onConfirm(); });
}

/**
 * 玻璃拟态输入框（替代 prompt）
 * @param {string} message - 提示信息
 * @param {Function} onConfirm - 确认回调（参数为输入值）
 * @param {Object} [opts] - 选项 { title, placeholder, defaultValue, confirmText, cancelText }
 */
function glassPrompt(message, onConfirm, opts = {}) {
  const title = opts.title || '输入';
  const placeholder = opts.placeholder || '';
  const defaultValue = opts.defaultValue || '';
  const confirmText = opts.confirmText || '确定';
  const cancelText = opts.cancelText || '取消';
  const overlay = document.createElement('div');
  overlay.className = 'glass-overlay';
  const dlg = document.createElement('div');
  dlg.className = 'glass-dialog';
  dlg.innerHTML = `
    <div class="glass-dlg-head">
      <span class="glass-dlg-title">${esc(title)}</span>
      <span class="glass-dlg-close" data-close>&times;</span>
    </div>
    <div class="glass-dlg-body">
      <div style="margin-bottom:12px">${esc(message)}</div>
      <input type="text" class="glass-dlg-input" placeholder="${esc(placeholder)}" value="${esc(defaultValue)}">
    </div>
    <div class="glass-dlg-foot">
      <button class="btn btn-ghost btn-sm glass-dlg-cancel">${esc(cancelText)}</button>
      <button class="btn btn-primary btn-sm glass-dlg-ok">${esc(confirmText)}</button>
    </div>`;
  overlay.appendChild(dlg);
  document.body.appendChild(overlay);
  const input = dlg.querySelector('.glass-dlg-input');
  setTimeout(() => input.focus(), 50);
  const close = () => overlay.remove();
  const confirm = () => { const v = input.value.trim(); if (v) { close(); onConfirm(v); } };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  dlg.querySelector('[data-close]').addEventListener('click', close);
  dlg.querySelector('.glass-dlg-cancel').addEventListener('click', close);
  dlg.querySelector('.glass-dlg-ok').addEventListener('click', confirm);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); });
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
  const navMap = {upload:'navUpload', filter1:'navFilter1', split:'navSplit', filter2:'navFilter2', normalize:'navNormalize', ppt:'navPpt', kdocs:'navKdocs', email:'navEmail'};
  document.getElementById(navMap[step])?.classList.add('active');
  // 更新侧栏统计
  if (step !== 'upload' && step !== 'kdocs' && step !== 'normalize' && step !== 'email' && step !== 'ppt') {
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
    initSplitGroups();
  }
  // 进入数据标准化时加载模板列表并刷新快速插入面板
  if (step === 'normalize') {
    loadNzTemplates();
    nzPopulateQiSelects();
  }
  // 进入PPT通报时初始化
  if (step === 'ppt') {
    initPptStep();
  }
  // 进入在线推送时加载数据
  if (step === 'kdocs') {
    loadKdocsCats();
    loadKdocsSheets();
  }
  // 进入邮件发送时初始化
  if (step === 'email') {
    if (typeof EmailTool !== 'undefined') {
      const navEmail = document.getElementById('navEmail');
      if (navEmail && !navEmail._inited) {
        EmailTool.init();
        navEmail._inited = true;
      }
    }
  }
}
function capitalize(s) {
  const map = {upload:'Upload', filter1:'Filter1', split:'Split', filter2:'Filter2', normalize:'Normalize', ppt:'Ppt', kdocs:'Kdocs', email:'Email'};
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

// 辅助：完全清除拆分状态（内存 + 持久化记录）
function clearSplitState() {
  S.splitMatchedRows = null;
  S.splitFileId = null;
  S.splitResult = null;
  S.splitFileName = null;
  S.splitColName = null;
  saveState(); // 立即保存到 localStorage（不用 debouncedSave，避免延迟期间刷新导致状态残留）
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
  const af = getActiveFile();
  if (!af) return [];
  const hdr = af.hdr, l1 = af.l1;
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

// ========== 分组值与映射同步 ==========
/**
 * 获取分组的有效值集合（动态合并 mappingData，不修改原始 g.values）
 * 确保统计时所有映射中的客户经理都能被正确匹配
 * @param {Object} g - 分组对象
 * @returns {Set} 有效值集合
 */
function getGroupValues(g) {
  const vals = new Set((g.values || []).map(v => String(v).trim()));
  if (S.mappingData && g.name && S.mappingData[g.name]) {
    S.mappingData[g.name].forEach(v => {
      const vs = String(v).trim();
      if (vs) vals.add(vs);
    });
  }
  return vals;
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
      const cg = grps.find(x => x.id === cid);
      if (cg && cg._unmatched) return; // 跳过未匹配子分组
      const childCtx = getGroupContext(cid, l1Data, grps, cache);
      childCtx.forEach(r => { if (!seen.has(r)) { seen.add(r); ctx.push(r); } });
    });
  } else if (g.level >= 3 && g.parentId) {
    // 3级+分组：与父分组上下文取交集
    const parentCtx = getGroupContext(g.parentId, l1Data, grps, cache);
    const valSet = getGroupValues(g);
    const selfMatch = l1Data.filter(r => valSet.has(String(r[g.column] ?? '').trim()));
    const ps = new Set(parentCtx);
    ctx = selfMatch.filter(r => ps.has(r));
  } else if (!g.parentId && (!g.parentIds || !g.parentIds.length)) {
    const valSet = getGroupValues(g);
    ctx = l1Data.filter(r => valSet.has(String(r[g.column] ?? '').trim()));
  } else {
    // 支持多父分组依赖
    const pids = g.parentIds && g.parentIds.length ? g.parentIds : (g.parentId ? [g.parentId] : []);
    const prels = g.parentRels && g.parentRels.length ? g.parentRels : (g.parentRel ? [g.parentRel] : []);
    const valSet = getGroupValues(g);
    const selfMatch = l1Data.filter(r => valSet.has(String(r[g.column] ?? '').trim()));
    let mergedCtx;
    pids.forEach((pid, i) => {
      const rel = prels[i] || 'AND';
      const pg = grps.find(x => x.id === pid);
      let parentCtx;
      if (pg && pg.level === 1 && pg.childGroupIds && pg.childGroupIds.length) {
        // 父分组是L1：聚合其所有子分组的上下文
        const seen = new Set();
        parentCtx = [];
        pg.childGroupIds.forEach(cid => {
          const cg = grps.find(x => x.id === cid);
          if (cg && cg._unmatched) return; // 跳过未匹配子分组
          let cc;
          if (cid === gid) {
            // 循环依赖防护：当前分组自身出现在L1子分组中时，
            // 用 selfMatch 代替递归（依赖自身所属L1等价于无约束）
            cc = selfMatch;
          } else {
            cc = getGroupContext(cid, l1Data, grps, cache);
          }
          cc.forEach(r => { if (!seen.has(r)) { seen.add(r); parentCtx.push(r); } });
        });
      } else {
        parentCtx = getGroupContext(pid, l1Data, grps, cache);
      }
      if (i === 0) {
        // 第一个父分组
        if (rel === 'AND') {
          const ps = new Set(parentCtx);
          mergedCtx = selfMatch.filter(r => ps.has(r));
        } else {
          // OR: selfMatch ∪ parentCtx
          const seen = new Set();
          mergedCtx = [];
          [...parentCtx, ...selfMatch].forEach(r => { if (!seen.has(r)) { seen.add(r); mergedCtx.push(r); } });
        }
      } else {
        // 后续父分组
        const isL1Parent = pg && pg.level === 1 && pg.childGroupIds && pg.childGroupIds.length;
        if (rel === 'AND' && !isL1Parent) {
          // 非L1父分组 AND: 取交集（约束条件必须同时满足）
          const ps = new Set(parentCtx);
          const nextCtx = selfMatch.filter(r => ps.has(r));
          const nextSet = new Set(nextCtx);
          mergedCtx = mergedCtx.filter(r => nextSet.has(r));
        } else if (rel === 'AND' && isL1Parent) {
          // L1父分组 AND: 取并集
          // L1是范围/分类分组，多个L1(如行业+商业)互斥且覆盖全集，
          // AND取交集必然为空，应取并集扩大覆盖范围
          const ps = new Set(parentCtx);
          const nextCtx = selfMatch.filter(r => ps.has(r));
          const seen = new Set(mergedCtx);
          nextCtx.forEach(r => { if (!seen.has(r)) { seen.add(r); mergedCtx.push(r); } });
        } else {
          // OR: 与已合并的取并集（满足任一OR父分组即可）
          const seen2 = new Set();
          const nextCtx = [];
          [...parentCtx, ...selfMatch].forEach(r => { if (!seen2.has(r)) { seen2.add(r); nextCtx.push(r); } });
          const seen = new Set(mergedCtx);
          nextCtx.forEach(r => { if (!seen.has(r)) { seen.add(r); mergedCtx.push(r); } });
        }
      }
    });
    ctx = mergedCtx;
  }
  cache[gid] = ctx;
  return ctx;
}

// ========== 链式子分组辅助 ==========
/**
 * 判断一个L2分组是否为链式子分组（parentIds指向同L1内的其他L2分组）
 * @param {Object} g - 要判断的L2分组
 * @param {Object} l1g - 所属的L1分组
 * @param {Array} allGrps - 所有分组
 * @returns {boolean}
 */
function isChainedChild(g, l1g, allGrps) {
  if (g.level === 1) return false;
  if (!l1g || !l1g.childGroupIds) return false;
  const childIdSet = new Set(l1g.childGroupIds);
  const pids = g.parentIds && g.parentIds.length ? g.parentIds : (g.parentId ? [g.parentId] : []);
  if (!pids.length) return false;
  // 只要有一个parent在同L1内，就是链式子分组
  return pids.some(pid => childIdSet.has(pid));
}

/**
 * 获取一个L1分组内的链式子分组ID集合
 */
function getChainedChildIds(l1g, allGrps) {
  const result = new Set();
  if (!l1g.childGroupIds) return result;
  const childIdSet = new Set(l1g.childGroupIds);
  l1g.childGroupIds.forEach(cid => {
    const g = allGrps.find(x => x.id === cid);
    if (g && isChainedChild(g, l1g, allGrps)) result.add(cid);
  });
  return result;
}

// ========== 层级路径工具 ==========
/**
 * 获取一个分组的完整层级名称路径（从最顶层L2到当前分组）
 * 返回数组，如 ['行业一组', '重点项', '核心']
 */
function getGroupPath(gid, grps) {
  const g = grps.find(x => x.id === gid);
  if (!g) return [];
  if (g.level === 1) return [g.name]; // L1 不应出现在路径中，但做保护
  if (!g.parentId || g.level === 2 || (!g.level)) return [g.name]; // L2 或独立分组
  // L3+：递归找父级路径
  const parentPath = getGroupPath(g.parentId, grps);
  return [...parentPath, g.name];
}

/**
 * 获取一个L2分组在L1下的完整路径名（用于结果展示和公式）
 * 格式: L1子项名称·L2名称 或 L1子项名称·L2名称·L3名称
 * 如果不在L1内，返回自身名称
 */
function getFullGroupName(gid, grps, l1Groups) {
  const g = grps.find(x => x.id === gid);
  if (!g) return '?';
  if (g.level === 1) return g.name;
  const path = getGroupPath(gid, grps);
  // 查找所在L1
  const ownerL1 = findOwnerL1(gid, grps, l1Groups);
  if (ownerL1) {
    return path.join(' · ');
  }
  // 独立分组：路径直接作为名称
  return path.join(' · ');
}

/**
 * 查找一个分组所属的L1分组
 */
function findOwnerL1(gid, grps, l1Groups) {
  // 直接查
  const direct = l1Groups.find(l1 => l1.childGroupIds && l1.childGroupIds.includes(gid));
  if (direct) return direct;
  // 向上递归查
  const g = grps.find(x => x.id === gid);
  if (g && g.parentId) {
    return findOwnerL1(g.parentId, grps, l1Groups);
  }
  return null;
}

/**
 * 查找一个分组所属的所有祖先L1分组（通过parentId/parentIds向上遍历）
 */
function findAncestorL1s(gid, grps, l1Groups) {
  const visited = new Set();
  const result = [];
  function walk(id) {
    if (visited.has(id)) return;
    visited.add(id);
    // 检查是否直接在某个L1的childGroupIds中
    l1Groups.forEach(l1 => {
      if (l1.childGroupIds && l1.childGroupIds.includes(id)) {
        if (!result.find(r => r.id === l1.id)) result.push(l1);
      }
    });
    const g = grps.find(x => x.id === id);
    if (!g) return;
    const pids = (g.parentIds && g.parentIds.length) ? g.parentIds : (g.parentId ? [g.parentId] : []);
    pids.forEach(pid => {
      const pg = grps.find(x => x.id === pid);
      if (pg && pg.level === 1) {
        if (!result.find(r => r.id === pg.id)) result.push(pg);
      } else if (pg) {
        walk(pid);
      }
    });
  }
  walk(gid);
  return result;
}

// ========== 分组值自动清理 ==========
// 当前过滤条件变化后，分组中某些值可能已不在过滤后数据中，自动剔除这些值
function cleanGroupValues(file) {
  // 核心原则：g.values 必须保持用户设置的原始值，不被统计逻辑修改或删除分组。
  // 用户配置的分组保持完整，统计时没有数据的分组自然显示 count=0。
  // （此前此函数会清空不在当前过滤数据中的 values 并级联删除分组，
  //  导致一级过滤后无数据的分组（如 IDC）消失、编辑新增的标签被清理。）
  return false;
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
