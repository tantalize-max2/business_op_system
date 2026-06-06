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
  const navMap = {upload:'navUpload', filter1:'navFilter1', split:'navSplit', filter2:'navFilter2', normalize:'navNormalize', kdocs:'navKdocs', email:'navEmail'};
  document.getElementById(navMap[step])?.classList.add('active');
  // 更新侧栏统计
  if (step !== 'upload' && step !== 'kdocs' && step !== 'normalize' && step !== 'email') {
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
  // 进入数据标准化时加载模板列表并刷新快速插入面板
  if (step === 'normalize') {
    loadNzTemplates();
    nzPopulateQiSelects();
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
  const map = {upload:'Upload', filter1:'Filter1', split:'Split', filter2:'Filter2', normalize:'Normalize', kdocs:'Kdocs', email:'Email'};
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
      const cg = grps.find(x => x.id === cid);
      if (cg && cg._unmatched) return; // 跳过未匹配子分组
      const childCtx = getGroupContext(cid, l1Data, grps, cache);
      childCtx.forEach(r => { if (!seen.has(r)) { seen.add(r); ctx.push(r); } });
    });
  } else if (g.level >= 3 && g.parentId) {
    // 3级+分组：与父分组上下文取交集
    const parentCtx = getGroupContext(g.parentId, l1Data, grps, cache);
    const valSet = new Set(g.values.map(v => String(v).trim()));
    const selfMatch = l1Data.filter(r => valSet.has(String(r[g.column] ?? '').trim()));
    const ps = new Set(parentCtx);
    ctx = selfMatch.filter(r => ps.has(r));
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
      availByCol[g.column] = new Set(l1Data.map(r => String(r[g.column] ?? '').trim()));
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
  // 移除值已清空的2级+分组
  const emptyGrpIds = new Set(
    file.grps.filter(g => g.level !== 1 && g.values.length === 0).map(g => g.id)
  );
  // 级联删除：如果父分组被删除，子分组也应删除
  let cascaded = true;
  while (cascaded) {
    cascaded = false;
    file.grps.forEach(g => {
      if (g.level >= 3 && g.parentId && emptyGrpIds.has(g.parentId) && !emptyGrpIds.has(g.id)) {
        emptyGrpIds.add(g.id);
        cascaded = true;
      }
    });
  }
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
