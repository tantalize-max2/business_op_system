// ========== step1-upload.js — 步骤1：上传文件 ==========

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

// 恢复持久化状态（不恢复文件列表和mappingData，每次启动为空白，mappingData从后端加载）
(function restoreState() {
  // mappingData 已通过后端 API 持久化，不需要从 localStorage 恢复
  // 清除旧的文件状态，确保启动时为空白
  localStorage.removeItem('ba-state');
})();
