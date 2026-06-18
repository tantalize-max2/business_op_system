// ========== step5-normalize.js — 数据标准化主入口 ==========
// 从原文件拆分后的主入口。包含：模板管理、nzModal、所有事件绑定、工具函数。
// 加载顺序：第3个（依赖 nz-core.js + nz-ui.js）。


// ---- 模板列表加载 ----
async function loadNzTemplates() {
  try {
    const res = await fetch('/api/nz-templates');
    const data = await res.json();
    NZ.templates = data.templates || [];
    nzRenderTemplateSel();
  } catch (e) {
    console.error('加载模板列表失败', e);
  }
}

function nzRenderTemplateSel() {
  const sel = document.getElementById('nzTemplateSel');
  sel.innerHTML = '<option value="">-- 选择已保存模板 --</option>';
  NZ.templates.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.name;
    opt.textContent = t.name + (t.sheetCount ? ` (${t.sheetCount}个Sheet)` : '');
    sel.appendChild(opt);
  });
  if (NZ.currentTemplate) sel.value = NZ.currentTemplate;
}

// ---- 模板上传与解析 ----
document.getElementById('nzUploadBtn').addEventListener('click', () => {
  document.getElementById('nzFileInput').click();
});

document.getElementById('nzFileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  NZ.currentTemplate = file.name.replace(/\.(xlsx|xls)$/i, '');
  const reader = new FileReader();
  reader.onload = ev => {
    NZ.rawBuffer = ev.target.result;
    nzParseWorkbook(ev.target.result);
    nzRenderTemplateSel();
    document.getElementById('nzTemplateSel').value = NZ.currentTemplate;
  };
  reader.readAsArrayBuffer(file);
  e.target.value = '';
});

function nzParseWorkbook(buffer) {
  try {
    NZ.wb = XLSX.read(buffer, { type: 'array', cellStyles: true, cellDates: true });
    NZ.cellEdits = {};
    NZ.cellFormats = {};
    NZ.selectedCell = null;
    NZ.selectedRange = null;
    NZ.activeSheet = 0;
    NZ.previewMode = false;
    nzHideRangeActionBar();
    // 重置预览按钮
    const pvBtn = document.getElementById('nzPreviewBtn');
    if (pvBtn) {
      pvBtn.textContent = '预览';
      pvBtn.classList.remove('btn-primary');
      pvBtn.classList.add('btn-ghost');
    }
    nzShowWorkspace();
    nzRenderSheetTabs();
    nzRenderTable();
  } catch (e) {
    ntf('解析模板失败: ' + e.message, 'error');
  }
}


// ---- 快速插入 ----
document.getElementById('nzQuickInsertBtn').addEventListener('click', () => {
  const body = document.getElementById('nzQiBody');
  const visible = body.style.display !== 'none';
  body.style.display = visible ? 'none' : '';
  if (!visible) nzPopulateQiSelects(); // 每次展开时刷新
});

document.getElementById('nzQiToggle').addEventListener('click', () => {
  const body = document.getElementById('nzQiBody');
  const visible = body.style.display !== 'none';
  body.style.display = visible ? 'none' : '';
  if (!visible) nzPopulateQiSelects(); // 每次展开时刷新
});

document.getElementById('nzScanToggle').addEventListener('click', () => {
  const body = document.getElementById('nzScanBody');
  body.style.display = body.style.display !== 'none' ? 'none' : '';
});


// ---- 预览模式（两态切换：预览计算值 ↔ 显示原始公式） ----
document.getElementById('nzPreviewBtn').addEventListener('click', () => {
  if (!NZ.wb) { ntf('请先上传模板', 'warn'); return; }
  NZ.previewMode = !NZ.previewMode;
  const btn = document.getElementById('nzPreviewBtn');
  btn.textContent = NZ.previewMode ? '公式' : '预览';
  btn.classList.toggle('btn-primary', NZ.previewMode);
  btn.classList.toggle('btn-ghost', !NZ.previewMode);
  nzRenderTable();
});

// ---- SUM/AVG 范围选取按钮 ----
document.getElementById('nzFuncSumBtn').addEventListener('click', () => {
  if (!NZ.wb) { ntf('请先上传模板', 'warn'); return; }
  nzEnterRangePick('SUM');
});
document.getElementById('nzFuncAvgBtn').addEventListener('click', () => {
  if (!NZ.wb) { ntf('请先上传模板', 'warn'); return; }
  nzEnterRangePick('AVG');
});
document.getElementById('nzRangeCancelBtn').addEventListener('click', () => {
  nzExitRangePick();
  // 恢复输入框到选取前的值
  const input = document.getElementById('nzCellInput');
  if (nzDragState?.baseInput) {
    input.value = nzDragState.baseInput;
  }
});

// ---- 格式工具栏 ----
// 显示/隐藏格式工具栏（在表格加载后显示）

document.getElementById('nzBoldBtn').addEventListener('click', () => {
  const fmt = nzGetCurrentFmt();
  nzSetFmt('bold', !fmt.bold);
  document.getElementById('nzBoldBtn').classList.toggle('nz-fmt-active', !fmt.bold);
});

document.getElementById('nzItalicBtn').addEventListener('click', () => {
  const fmt = nzGetCurrentFmt();
  nzSetFmt('italic', !fmt.italic);
  document.getElementById('nzItalicBtn').classList.toggle('nz-fmt-active', !fmt.italic);
});

document.getElementById('nzAlignLeftBtn').addEventListener('click', () => nzSetFmt('align', 'left'));
document.getElementById('nzAlignCenterBtn').addEventListener('click', () => nzSetFmt('align', 'center'));
document.getElementById('nzAlignRightBtn').addEventListener('click', () => nzSetFmt('align', 'right'));

document.getElementById('nzFontName').addEventListener('change', e => nzSetFmt('fontName', e.target.value || ''));
document.getElementById('nzFontSize').addEventListener('change', e => nzSetFmt('fontSize', e.target.value ? parseInt(e.target.value) : ''));

// 小数位数（单格或范围批量设置，粘性状态）
document.getElementById('nzDecimalSel').addEventListener('change', e => {
  const decimalVal = parseInt(e.target.value);
  NZ._stickyDecimal = decimalVal;
  if (NZ.selectedRange) {
    // 批量设置选中范围内所有格的小数位
    const { r1, c1, r2, c2 } = NZ.selectedRange;
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const editKey = `${NZ.activeSheet}!${r}!${c}`;
        if (!NZ.cellFormats[editKey]) NZ.cellFormats[editKey] = {};
        NZ.cellFormats[editKey].decimal = decimalVal;
      }
    }
    // 同步百分比状态也批量应用
    const pctBtn = document.getElementById('nzPercentBtn');
    if (pctBtn && pctBtn.classList.contains('active')) {
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          NZ.cellFormats[`${NZ.activeSheet}!${r}!${c}`].percent = true;
        }
      }
    }
  } else {
    nzSetFmt('decimal', decimalVal);
  }
  // 更新预览
  if (NZ.previewMode) nzRenderTable();
});
// 百分比（单格或范围批量设置，粘性状态）
document.getElementById('nzPercentBtn').addEventListener('click', () => {
  const newVal = !document.getElementById('nzPercentBtn').classList.contains('active');
  NZ._stickyPercent = newVal;
  if (NZ.selectedRange) {
    // 批量设置选中范围内所有格的百分比格式
    const { r1, c1, r2, c2 } = NZ.selectedRange;
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const editKey = `${NZ.activeSheet}!${r}!${c}`;
        if (!NZ.cellFormats[editKey]) NZ.cellFormats[editKey] = {};
        if (newVal) {
          NZ.cellFormats[editKey].percent = true;
        } else {
          delete NZ.cellFormats[editKey].percent;
        }
      }
    }
  } else {
    nzSetFmt('percent', newVal);
  }
  document.getElementById('nzPercentBtn').classList.toggle('active', newVal);
  // 更新预览
  if (NZ.previewMode) nzRenderTable();
});

// 选中单元格时同步格式工具栏状态

document.getElementById('nzRabSumBtn').addEventListener('click', () => {
  if (!NZ.selectedRange || !NZ.selectedCell) return;
  const addr = nzRangeAddr(NZ.selectedRange);
  const formula = `=SUM(${addr})`;
  const input = document.getElementById('nzCellInput');
  const curVal = input.value;
  // 在光标位置插入公式
  const pos = input.selectionStart != null ? input.selectionStart : curVal.length;
  const endPos = input.selectionEnd != null ? input.selectionEnd : pos;
  input.value = curVal.substring(0, pos) + formula + curVal.substring(endPos);
  const newPos = pos + formula.length;
  // 写入锚点格
  const { row, col } = NZ.selectedCell;
  const editKey = `${NZ.activeSheet}!${row}!${col}`;
  NZ.cellEdits[editKey] = input.value;
  input.setSelectionRange(newPos, newPos);
  nzClearRangeSelection();
  nzRenderTable();
  ntf('已插入求和公式');
});

document.getElementById('nzRabAvgBtn').addEventListener('click', () => {
  if (!NZ.selectedRange || !NZ.selectedCell) return;
  const addr = nzRangeAddr(NZ.selectedRange);
  const formula = `=AVG(${addr})`;
  const input = document.getElementById('nzCellInput');
  const curVal = input.value;
  // 在光标位置插入公式
  const pos = input.selectionStart != null ? input.selectionStart : curVal.length;
  const endPos = input.selectionEnd != null ? input.selectionEnd : pos;
  input.value = curVal.substring(0, pos) + formula + curVal.substring(endPos);
  const newPos = pos + formula.length;
  // 写入锚点格
  const { row, col } = NZ.selectedCell;
  const editKey = `${NZ.activeSheet}!${row}!${col}`;
  NZ.cellEdits[editKey] = input.value;
  input.setSelectionRange(newPos, newPos);
  nzClearRangeSelection();
  nzRenderTable();
  ntf('已插入均值公式');
});

document.getElementById('nzRabPctBtn').addEventListener('click', () => {
  if (!NZ.selectedRange) return;
  // 对范围内所有格应用百分比格式
  for (let r = NZ.selectedRange.r1; r <= NZ.selectedRange.r2; r++) {
    for (let c = NZ.selectedRange.c1; c <= NZ.selectedRange.c2; c++) {
      const editKey = `${NZ.activeSheet}!${r}!${c}`;
      if (!NZ.cellFormats[editKey]) NZ.cellFormats[editKey] = {};
      NZ.cellFormats[editKey].percent = true;
    }
  }
  nzClearRangeSelection();
  nzRenderTable();
  // 同步锚点格的 % 按钮状态
  if (NZ.selectedCell) {
    const fmt = nzGetCurrentFmt();
    document.getElementById('nzPercentBtn')?.classList.toggle('active', !!fmt.percent);
  }
  ntf('已应用百分比格式');
});

// Escape 键清除范围选择
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && NZ.selectedRange) {
    nzClearRangeSelection();
    nzRenderTable();
  }
});

// ---- 主题化命名输入模态框（替代原生prompt/confirm） ----
const nzModal = {
  _onOk: null, _onCancel: null,
  show({ title = '输入', label = '', value = '', placeholder = '', hint = '', okText = '确定', mode = 'input' }) {
    document.getElementById('nzModalTitle').textContent = title;
    document.getElementById('nzModalLabel').textContent = label;
    const input = document.getElementById('nzModalInput');
    const labelEl = document.getElementById('nzModalLabel');
    input.placeholder = placeholder;
    input.value = value;
    // confirm模式隐藏输入框和label
    input.style.display = mode === 'confirm' ? 'none' : '';
    labelEl.style.display = mode === 'confirm' ? 'none' : '';
    const hintEl = document.getElementById('nzModalHint');
    hintEl.textContent = hint;
    hintEl.classList.toggle('warn', mode === 'confirm');
    document.getElementById('nzModalOk').textContent = okText;
    document.getElementById('nzModalMask').classList.add('show');
    document.getElementById('nzModalBox').classList.add('show');
    setTimeout(() => {
      if (mode === 'confirm') document.getElementById('nzModalOk').focus();
      else { input.focus(); input.select(); }
    }, 50);
    return new Promise(resolve => {
      this._onOk = resolve;
    });
  },
  // 确认对话框（替代confirm）
  confirm({ title = '确认', content = '', okText = '确定' }) {
    return this.show({ title, hint: content, okText, mode: 'confirm' });
  },
  hide() {
    document.getElementById('nzModalMask').classList.remove('show');
    document.getElementById('nzModalBox').classList.remove('show');
    this._onOk = null;
  },
  setHint(text, isWarn = false) {
    const hintEl = document.getElementById('nzModalHint');
    hintEl.textContent = text;
    hintEl.classList.toggle('warn', isWarn);
  }
};

document.getElementById('nzModalClose').addEventListener('click', () => {
  if (nzModal._onOk) nzModal._onOk(null);
  nzModal.hide();
});
document.getElementById('nzModalCancel').addEventListener('click', () => {
  if (nzModal._onOk) nzModal._onOk(null);
  nzModal.hide();
});
document.getElementById('nzModalMask').addEventListener('click', () => {
  if (nzModal._onOk) nzModal._onOk(null);
  nzModal.hide();
});
document.getElementById('nzModalOk').addEventListener('click', () => {
  const input = document.getElementById('nzModalInput');
  const isConfirmMode = input.style.display === 'none';
  if (isConfirmMode) {
    if (nzModal._onOk) nzModal._onOk(true);
    nzModal.hide();
    return;
  }
  const val = input.value.trim();
  if (!val) { nzModal.setHint('名称不能为空', true); input.focus(); return; }
  if (nzModal._onOk) nzModal._onOk(val);
  nzModal.hide();
});
document.getElementById('nzModalInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('nzModalOk').click(); }
  else if (e.key === 'Escape') { e.preventDefault(); document.getElementById('nzModalCancel').click(); }
});

// ---- 保存模板（每次保存即为新模板，直接保存） ----
document.getElementById('nzSaveBtn').addEventListener('click', async () => {
  if (!NZ.wb) { ntf('请先上传模板', 'warn'); return; }
  nzApplyEditsToWorkbook();

  // 弹出主题化命名输入框，默认填当前模板名
  const defaultName = NZ.currentTemplate || '';
  const name = await nzModal.show({
    title: '保存模板',
    label: '模板名称',
    value: defaultName,
    placeholder: '请输入模板名称',
    hint: '保存将创建新的模板记录',
    okText: '保存'
  });
  if (!name) return; // 用户取消

  NZ.currentTemplate = name;
  // 使用原始文件数据保存，保留完整 Excel 格式（不用 SheetJS 重新生成）
  let b64;
  if (NZ.rawBuffer) {
    b64 = arrayBufferToBase64(NZ.rawBuffer);
  } else {
    ntf('原始模板文件不可用，请重新上传', 'error');
    return;
  }

  try {
    const res = await fetch('/api/nz-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, fileData: b64 })
    });
    const data = await res.json();
    if (data.error) { ntf(data.error, 'error'); return; }
    ntf('模板已保存');
    await loadNzTemplates();
  } catch (e) {
    ntf('保存失败: ' + e.message, 'error');
  }
});

// ---- 选择已有模板 ----
document.getElementById('nzTemplateSel').addEventListener('change', async () => {
  const name = document.getElementById('nzTemplateSel').value;
  if (!name) return;
  console.log('[NZ] 模板切换:', name);
  NZ.currentTemplate = name;
  try {
    const res = await fetch(`/api/nz-templates/${encodeURIComponent(name)}`);
    if (!res.ok) { ntf(`加载模板失败 (HTTP ${res.status})`, 'error'); return; }
    const data = await res.json();
    if (data.error) { ntf(data.error, 'error'); return; }
    if (!data.fileData) { ntf('模板数据为空', 'error'); return; }
    const raw = base64ToArrayBuffer(data.fileData);
    NZ.rawBuffer = raw;
    nzParseWorkbook(raw);
    ntf(`已加载模板「${name}」`);
  } catch (e) {
    ntf('加载模板失败: ' + e.message, 'error');
  }
});

// ---- 删除模板 ----
document.getElementById('nzDeleteBtn').addEventListener('click', async () => {
  const name = NZ.currentTemplate;
  if (!name) { ntf('请先选择模板', 'warn'); return; }
  const ok = await nzModal.confirm({
    title: '删除模板',
    content: `确定删除模板「${name}」吗？此操作不可撤销。`,
    okText: '删除'
  });
  if (!ok) return;
  try {
    await fetch(`/api/nz-templates/${encodeURIComponent(name)}`, { method: 'DELETE' });
    ntf('模板已删除');
    NZ.currentTemplate = null;
    NZ.wb = null;
    document.getElementById('nzWorkspace').style.display = 'none';
    document.getElementById('nzEmpty').style.display = '';
    await loadNzTemplates();
  } catch (e) {
    ntf('删除失败', 'error');
  }
});

// ---- 下载模板 ----
document.getElementById('nzDownloadBtn').addEventListener('click', () => {
  if (!NZ.wb) { ntf('请先上传模板', 'warn'); return; }
  // 使用原始文件数据下载，保留完整 Excel 格式（不用 SheetJS 重新生成）
  if (NZ.rawBuffer) {
    const blob = new Blob([NZ.rawBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (NZ.currentTemplate || '模板') + '.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  } else {
    ntf('原始模板文件不可用，请重新上传', 'error');
  }
});

// ---- 填充并下载 ----
document.getElementById('nzFillBtn').addEventListener('click', async () => {
  if (!NZ.wb) { ntf('请先上传模板', 'warn'); return; }
  if (!S.files.length) { ntf('请先上传数据文件并完成二级统计', 'warn'); return; }
  if (!NZ.rawBuffer) { ntf('原始模板文件不可用，请重新上传', 'error'); return; }

  // 计算统计数据发送给后端
  const statsData = nzComputeStats();
  const statsPayload = {};
  for (const [fi, fd] of Object.entries(statsData)) {
    statsPayload[fi] = {
      entries: fd.entries.map(e => ({
        name: e.name, isGroup: e.isGroup, isL1Total: e.isL1Total, isTotal: e.isTotal,
        isL1Cross: e.isL1Cross || false, isL1Subtotal: e.isL1Subtotal || false,
        l1Name: e.l1Name || '', count: e.count, pct: e.pct,
        sum: e.sum, column: e.column || '',
        acCols: fd.file.addedCols,
        acData: fd.file.addedCols.reduce((acc, ac) => {
          acc[ac] = e['ac_' + ac] || {};
          return acc;
        }, {}),
      })),
      total: { count: fd.total.count, pct: fd.total.pct, sum: fd.total.sum },
      sumCol: fd.file.sumCol || '',
      hdr: fd.file.hdr,
      l1Groups: fd.l1Groups.map(l1g => ({
        name: l1g.name, values: l1g.values || [],
        childGroupNames: (l1g.childGroupIds || []).map(cid => {
          const cg = fd.file.grps.find(x => x.id === cid);
          return cg ? cg.name : '';
        })
      })),
    };
  }

  // 构建cellEdits列表（后端用openpyxl应用到原始文件）
  const edits = [];
  Object.entries(NZ.cellEdits).forEach(([key, val]) => {
    const parts = key.split('!');
    if (parts.length !== 3) return;
    edits.push({ sheet: parseInt(parts[0]), row: parseInt(parts[1]), col: parseInt(parts[2]), value: val });
  });

  // 构建cellFormats列表
  const fmtList = [];
  Object.entries(NZ.cellFormats).forEach(([key, fmt]) => {
    const parts = key.split('!');
    if (parts.length !== 3) return;
    fmtList.push({ sheet: parseInt(parts[0]), row: parseInt(parts[1]), col: parseInt(parts[2]), fmt });
  });

  // 发送原始文件 + 编辑 + 统计数据
  const rawB64 = arrayBufferToBase64(NZ.rawBuffer);

  try {
    ntf('正在填充数据...', 'info');
    const res = await fetch('/api/nz-fill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateData: rawB64, statsData: statsPayload, cellEdits: edits, cellFormats: fmtList })
    });
    if (!res.ok) { ntf('填充失败', 'error'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (NZ.currentTemplate || '报表') + '_填充结果.xlsx';
    a.click();
    URL.revokeObjectURL(url);
    ntf('填充完成，文件已下载');
  } catch (e) {
    ntf('填充失败: ' + e.message, 'error');
  }
});

// ---- 辅助函数 ----

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ---- 行高调整 ----
document.getElementById('nzRowHeightInput').addEventListener('change', function () {
  if (!NZ.selectedCell || !NZ.wb) return;
  const h = Math.max(18, Math.min(120, parseInt(this.value) || 28));
  this.value = h;
  const rowKey = `${NZ.activeSheet}!${NZ.selectedCell.row}`;
  NZ.rowHeights[rowKey] = h;
  nzRenderTable();
});

// ---- 插入行（上方） ----
document.getElementById('nzInsertRowAboveBtn').addEventListener('click', function () {
  if (!NZ.selectedCell || !NZ.wb) { ntf('请先选中一个单元格', 'warn'); return; }
  nzInsertRowAt(NZ.selectedCell.row);
  ntf('已在当前行上方插入空行');
});

// ---- 插入行（下方） ----
document.getElementById('nzInsertRowBelowBtn').addEventListener('click', function () {
  if (!NZ.selectedCell || !NZ.wb) { ntf('请先选中一个单元格', 'warn'); return; }
  nzInsertRowAt(NZ.selectedCell.row + 1);
  ntf('已在当前行下方插入空行');
});

// ---- 删除行 ----
document.getElementById('nzDeleteRowBtn').addEventListener('click', function () {
  if (!NZ.selectedCell || !NZ.wb) { ntf('请先选中一个单元格', 'warn'); return; }
  const si = NZ.activeSheet;
  const ws = NZ.wb.Sheets[NZ.wb.SheetNames[si]];
  if (!ws || !ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  // 只剩1行时不允许删除
  if (range.e.r - range.s.r < 1) { ntf('至少保留一行', 'warn'); return; }
  nzDeleteRowAt(NZ.selectedCell.row);
  ntf('已删除当前行');
});

/**
 * 在指定行位置插入一个空行
 * 把 insertRow 及以下的所有编辑缓存、格式缓存、行高缓存都下移一行
 */
