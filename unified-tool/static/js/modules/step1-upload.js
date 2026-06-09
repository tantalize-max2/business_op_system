// ========== step1-upload.js — 步骤1：上传文件 ==========

// ========== 文件管理 ==========
let fileIdCounter = 0;

/**
 * 根据原始二维数组和跳过行数，生成 hdr 和 raw
 * skipRows: 跳过前N行，第N+1行作为表头
 */
function _parseFromAoA(rawAoA, skipRows) {
  skipRows = Math.max(0, skipRows || 0);
  if (rawAoA.length <= skipRows) return { hdr: [], raw: [], l1: {} };
  const hdr = rawAoA[skipRows].map((v, i) => v !== undefined && v !== null && String(v).trim() !== '' ? String(v).trim() : `列${i + 1}`);
  // 处理表头重复：给重复列名加后缀
  const seen = {};
  const hdrUnique = hdr.map(h => {
    if (!seen[h]) { seen[h] = 1; return h; }
    seen[h]++;
    return `${h}_${seen[h]}`;
  });
  const l1 = {};
  hdrUnique.forEach(c => { l1[c] = newL1(); });
  const raw = [];
  for (let i = skipRows + 1; i < rawAoA.length; i++) {
    const row = {};
    hdrUnique.forEach((c, ci) => { row[c] = rawAoA[i][ci] !== undefined ? rawAoA[i][ci] : ''; });
    raw.push(row);
  }
  return { hdr: hdrUnique, raw, l1 };
}

function handleFiles(files) {
  for (const file of files) {
    handleFile(file);
  }
}

/**
 * 刷新后恢复拆分状态
 * 如果上传的文件名与持久化的拆分记录匹配，重新计算 splitMatchedRows
 * 行索引基于重新解析的 file.raw，与执行拆分时的逻辑一致
 */
function restoreSplitState(fileObj) {
  if (!S.splitFileName || !S.splitColName) return;
  if (S.splitFileName !== fileObj.name) return; // 文件名不匹配，不恢复
  if (!S.mappingData || !Object.keys(S.mappingData).length) return; // 无映射数据，无法恢复
  // 重新计算匹配的行索引（与 step3-split.js 执行拆分时的逻辑一致）
  const matchedSet = new Set();
  fileObj.raw.forEach((row, idx) => {
    const val = String(row[S.splitColName] ?? '').trim();
    for (const members of Object.values(S.mappingData)) {
      if (members.some(m => m === val)) { matchedSet.add(idx); break; }
    }
  });
  if (matchedSet.size > 0) {
    S.splitMatchedRows = matchedSet;
    S.splitFileId = fileObj.id;
    ntf('已自动恢复拆分过滤状态');
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
      // 保存原始二维数组，用于后续调整 skipRows
      const rawAoA = XLSX.utils.sheet_to_json(ws, {header: 1, defval: ''});
      if (!rawAoA.length) { ntf('文件为空', 'error'); return; }
      const { hdr, raw, l1 } = _parseFromAoA(rawAoA, 0);
      if (!hdr.length) { ntf('文件为空', 'error'); return; }
      // 同名文件自动替换旧文件
      const oldIdx = S.files.findIndex(f => f.name === file.name);
      let newId;
      const fileObj = {
        id: 0, name: file.name, raw, hdr, l1, rawAoA, skipRows: 0,
        grps: [], gid: 0, addedCols: [], sumCol: '', hiddenCols: new Set(), rawFileData: rawBuffer
      };
      if (oldIdx >= 0) {
        newId = S.files[oldIdx].id;
        fileObj.id = newId;
        S.files[oldIdx] = fileObj;
        // 清理与旧文件关联的拆分状态
        if (S.splitFileId === newId) clearSplitState();
        ntf(`已替换 ${file.name} (${raw.length} 行)`);
      } else {
        newId = ++fileIdCounter;
        fileObj.id = newId;
        S.files.push(fileObj);
        ntf(`已加载 ${file.name} (${raw.length} 行)`);
      }
      S.activeFileId = newId;
      // 刷新后恢复拆分状态：如果文件名匹配持久化的拆分记录，重新计算 splitMatchedRows
      restoreSplitState(fileObj);
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

/**
 * 重新解析文件：调整 skipRows 后重新生成 hdr 和 raw
 */
function reparseFileWithSkipRows(fileId, skipRows) {
  const f = S.files.find(x => x.id === fileId);
  if (!f || !f.rawAoA) return;
  skipRows = Math.max(0, Math.min(skipRows, f.rawAoA.length - 1));
  f.skipRows = skipRows;
  const { hdr, raw, l1 } = _parseFromAoA(f.rawAoA, skipRows);
  // 保留已有的分组信息（如果表头不变）
  f.hdr = hdr;
  f.raw = raw;
  f.l1 = l1;
  // 清除与列相关的旧状态
  f.addedCols = [];
  f.hiddenCols = new Set();
  f.sumCol = '';
  // 清理拆分状态
  if (S.splitFileId === fileId) clearSplitState();
  renderFileList();
  renderFileTabs();
  renderTable();
  updHdr();
  popGCol();
  renderGrpCards();
  renderL2FileTabs();
  updSbStats();
  ntf(`已跳过前 ${skipRows} 行，表头: ${hdr.slice(0, 5).join(', ')}${hdr.length > 5 ? '...' : ''}`);
}

function removeFile(id) {
  S.files = S.files.filter(f => f.id !== id);
  if (S.activeFileId === id) {
    S.activeFileId = S.files.length ? S.files[0].id : null;
  }
  // 清理与该文件关联的拆分状态
  if (S.splitFileId === id) clearSplitState();
  // 刷新分局拆分区域可见性（文件全删后隐藏添加按钮）
  if (typeof updSplitLayoutVisibility === 'function') updSplitLayoutVisibility();
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
      <span class="file-card-icon"><svg class="icon icon-lg" aria-hidden="true"><use xlink:href="#icon-file"/></svg></span>
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

// 恢复持久化状态（不恢复文件列表，每次启动为空白；mappingData从后端加载）
// 拆分状态在文件上传时按文件名匹配恢复
(function restoreState() {
  // 读取持久化的状态
  try {
    const saved = JSON.parse(localStorage.getItem('ba-state') || '{}');
    // 恢复拆分状态（splitFileName/splitColName），供文件上传时恢复
    if (saved.splitFileName) { S.splitFileName = saved.splitFileName; S.splitColName = saved.splitColName; }
    // mappingData fallback：后端 API 异步加载，文件上传时可能还没完成，先从 localStorage 恢复
    if (saved.mappingData && Object.keys(saved.mappingData).length) { S.mappingData = saved.mappingData; }
  } catch (e) { /* ignore */ }
})();
