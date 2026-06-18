// ========== nz-ui.js — 数据标准化渲染与交互层 ==========
// 从 step5-normalize.js 拆分。包含：表格渲染、拖拽选择、单元格编辑、
// 快速插入面板、格式工具栏、行操作函数。加载顺序：第2个（依赖 nz-core.js）。


// 引用选取模式：输入 = 后点击单元格自动插入引用
let nzCellRefPickMode = false;
// 正常模式拖选状态
let nzNormalDragStart = null;   // {r, c} 鼠标按下的起点格
let nzNormalDragMoved = false;  // 是否已拖动到不同格（区分点击与拖选）
let nzSuppressNextClick = false;// 拖选结束后抑制一次 click 事件

function nzShowWorkspace() {
  document.getElementById('nzWorkspace').style.display = '';
  document.getElementById('nzEmpty').style.display = 'none';
  nzShowFormatBar();
}

// ---- Sheet标签 ----
function nzRenderSheetTabs() {
  const tabs = document.getElementById('nzSheetTabs');
  tabs.innerHTML = '';
  if (!NZ.wb) return;
  NZ.wb.SheetNames.forEach((name, i) => {
    const tab = document.createElement('div');
    tab.className = 'nz-sheet-tab' + (i === NZ.activeSheet ? ' active' : '');
    tab.textContent = name;
    tab.addEventListener('click', () => {
      NZ.activeSheet = i;
      NZ.selectedCell = null;
      nzRenderSheetTabs();
      nzRenderTable();
    });
    tabs.appendChild(tab);
  });
}

// ---- 表格渲染 ----
function nzRenderTable() {
  if (!NZ.wb) return;
  const ws = NZ.wb.Sheets[NZ.wb.SheetNames[NZ.activeSheet]];
  if (!ws || !ws['!ref']) {
    document.getElementById('nzThead').innerHTML = '';
    document.getElementById('nzTbody').innerHTML = '<tr><td style="padding:20px;color:var(--t3)">空Sheet</td></tr>';
    return;
  }
  const range = XLSX.utils.decode_range(ws['!ref']);
  const maxR = Math.min(range.e.r, 200); // 最多显示200行
  const maxC = Math.min(range.e.c, 50);  // 最多显示50列

  // 表头: 列号
  let thead = '<tr><th></th>';
  for (let c = 0; c <= maxC; c++) {
    thead += `<th>${XLSX.utils.encode_col(c)}</th>`;
  }
  thead += '</tr>';
  document.getElementById('nzThead').innerHTML = thead;

  // 数据行
  let tbody = '';
  for (let r = 0; r <= maxR; r++) {
    const rowKey = `${NZ.activeSheet}!${r}`;
    const rh = NZ.rowHeights[rowKey];
    const rhStyle = rh ? ` style="height:${rh}px"` : '';
    tbody += `<tr${rhStyle}><td>${r + 1}</td>`;
    for (let c = 0; c <= maxC; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const editKey = `${NZ.activeSheet}!${r}!${c}`;
      let cellVal = '';
      let isFormula = false;
      // 优先显示编辑缓存
      if (NZ.cellEdits[editKey] !== undefined) {
        cellVal = NZ.cellEdits[editKey];
      } else {
        const cell = ws[ref];
        if (cell) {
          cellVal = cell.v != null ? String(cell.v) : '';
          if (cell.t === 'd') cellVal = cell.v.toLocaleDateString?.() || String(cell.v);
        }
      }
      isFormula = nzHasFormula(cellVal);
      const fmt = NZ.cellFormats[editKey];
      let fmtStyle = '';
      if (fmt) {
        if (fmt.bold) fmtStyle += 'font-weight:700;';
        if (fmt.italic) fmtStyle += 'font-style:italic;';
        if (fmt.align) fmtStyle += `text-align:${fmt.align};`;
        if (fmt.fontSize) fmtStyle += `font-size:${fmt.fontSize}px;`;
        if (fmt.fontName) fmtStyle += `font-family:${fmt.fontName};`;
      }
      const cls = isFormula ? ' nz-formula' : '';
      const selCls = (NZ.selectedCell && NZ.selectedCell.row === r && NZ.selectedCell.col === c) ? ' selected' : '';
      const fmtAttr = fmtStyle ? ` style="${fmtStyle}"` : '';

      // 预览模式下替换公式为计算值（应用小数位和百分比格式）
      let displayVal = cellVal;
      if (NZ.previewMode && isFormula) {
        const statsData = nzComputeStats();
        const resolved = nzResolveCellFormula(cellVal, statsData, NZ.activeSheet);
        displayVal = resolved.ok ? nzFormatValue(resolved.value, fmt) : cellVal;
      }

      tbody += `<td class="${cls}${selCls}" data-r="${r}" data-c="${c}" title="${esc(cellVal)}"${fmtAttr}>${esc(displayVal)}</td>`;
    }
    tbody += '</tr>';
  }
  document.getElementById('nzTbody').innerHTML = tbody;

  // 绑定点击事件
  document.getElementById('nzTbody').querySelectorAll('td[data-r]').forEach(td => {
    td.addEventListener('click', () => nzSelectCell(+td.dataset.r, +td.dataset.c));
  });

  // 绑定拖拽选择事件（用于公式范围选取）
  nzBindDragSelect();

  // 更新编辑栏
  nzUpdateEditBar();
}

// ---- 拖拽选择范围（用于 SUM/AVG 公式） ----
let nzDragState = null; // { startR, startC, active, funcName, baseInput }
let nzRangePickMode = null; // 'SUM' | 'AVG' | null - 选取模式

/** 进入范围选取模式（由 SUM/AVG 按钮触发） */
function nzEnterRangePick(funcName) {
  // 如果已在选取模式且函数相同，取消
  if (nzRangePickMode === funcName) {
    nzExitRangePick();
    return;
  }
  nzRangePickMode = funcName;
  
  // 记住当前输入框内容作为基础
  const input = document.getElementById('nzCellInput');
  const curVal = input.value;
  const pos = input.selectionStart != null ? input.selectionStart : curVal.length;
  
  // 更新按钮高亮
  document.getElementById('nzFuncSumBtn')?.classList.toggle('active', funcName === 'SUM');
  document.getElementById('nzFuncAvgBtn')?.classList.toggle('active', funcName === 'AVG');
  
  // 显示提示条
  const hint = document.getElementById('nzRangeHint');
  if (hint) {
    hint.querySelector('span').textContent = `正在选取 ${funcName} 范围，拖动鼠标选择单元格，松开完成`;
    hint.style.display = '';
  }
  
  // 在光标位置插入函数起始
  const insertText = '=' + funcName + '(';
  let baseInput;
  if (curVal.startsWith('=')) {
    // 已有公式，在光标位置插入
    const before = curVal.substring(0, pos);
    const after = curVal.substring(input.selectionEnd != null ? input.selectionEnd : pos);
    baseInput = before + insertText;
    input.value = baseInput + after;
  } else {
    // 空值或纯文本，在光标位置直接插入新公式
    baseInput = curVal.substring(0, pos) + insertText;
    input.value = baseInput + curVal.substring(input.selectionEnd != null ? input.selectionEnd : pos);
  }
  nzDragState = { baseInput, funcName };
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

/** 退出范围选取模式 */
function nzExitRangePick() {
  nzRangePickMode = null;
  nzDragState = null;
  nzClearRangeHighlight();
  
  document.getElementById('nzFuncSumBtn')?.classList.remove('active');
  document.getElementById('nzFuncAvgBtn')?.classList.remove('active');
  
  const hint = document.getElementById('nzRangeHint');
  if (hint) hint.style.display = 'none';
}

function nzBindDragSelect() {
  const tbody = document.getElementById('nzTbody');
  if (!tbody) return;

  let dragging = false; // nzRangePickMode 专用

  // ---- mousedown ----
  tbody.onmousedown = (e) => {
    const td = e.target.closest('td[data-r]');
    if (!td) return;

    if (nzRangePickMode) {
      // 公式函数选取模式：开始拖拽选范围
      e.preventDefault();
      dragging = true;
      const startR = +td.dataset.r, startC = +td.dataset.c;
      nzDragState = nzDragState || {};
      nzDragState.startR = startR;
      nzDragState.startC = startC;
      nzDragState.active = true;
      nzHighlightRange(startR, startC, startR, startC);
      return;
    }

    if (nzCellRefPickMode) return; // 引用选取模式由 click 处理

    // 正常模式：记录拖拽起点
    // 锚点格 = 之前单击选中的格（如果有），否则用当前格
    e.preventDefault(); // 防止文本选中
    nzNormalDragStart = { r: +td.dataset.r, c: +td.dataset.c };
    nzNormalDragMoved = false;
  };

  // ---- mousemove ----
  tbody.onmousemove = (e) => {
    // nzRangePickMode 拖拽
    if (dragging && nzDragState?.active) {
      const td = e.target.closest('td[data-r]');
      if (!td) return;
      nzHighlightRange(nzDragState.startR, nzDragState.startC, +td.dataset.r, +td.dataset.c);
      const startRef = XLSX.utils.encode_cell({ r: nzDragState.startR, c: nzDragState.startC });
      const endRef = XLSX.utils.encode_cell({ r: +td.dataset.r, c: +td.dataset.c });
      const rangeStr = (nzDragState.startR === +td.dataset.r && nzDragState.startC === +td.dataset.c)
        ? startRef : `${startRef}:${endRef}`;
      document.getElementById('nzCellInput').value = nzDragState.baseInput + rangeStr;
      return;
    }

    // 正常模式拖拽
    if (!nzNormalDragStart) return;
    const td = e.target.closest('td[data-r]');
    if (!td) return;
    const curR = +td.dataset.r, curC = +td.dataset.c;
    if (curR !== nzNormalDragStart.r || curC !== nzNormalDragStart.c) {
      nzNormalDragMoved = true;
      // 锚点 = 之前选中的格（selectedCell），范围 = 锚点到当前拖拽位置
      const anchorR = NZ.selectedCell ? NZ.selectedCell.row : nzNormalDragStart.r;
      const anchorC = NZ.selectedCell ? NZ.selectedCell.col : nzNormalDragStart.c;
      NZ.selectedRange = {
        r1: Math.min(anchorR, curR), c1: Math.min(anchorC, curC),
        r2: Math.max(anchorR, curR), c2: Math.max(anchorC, curC)
      };
      nzHighlightNormalRange();
      nzUpdateRangeActionBar();
    }
  };

  // ---- mouseup ----
  const finishNormalDrag = () => {
    if (nzNormalDragStart && nzNormalDragMoved && NZ.selectedRange) {
      nzSuppressNextClick = true;
      requestAnimationFrame(() => { nzSuppressNextClick = false; });
      nzShowRangeActionBar();
      nzUpdateEditBar();
    }
    nzNormalDragStart = null;
    nzNormalDragMoved = false;
  };

  tbody.onmouseup = (e) => {
    // nzRangePickMode 拖拽完成
    if (dragging && nzDragState?.active) {
      dragging = false;
      const td = e.target.closest('td[data-r]');
      if (td) {
        const endR = +td.dataset.r, endC = +td.dataset.c;
        const startRef = XLSX.utils.encode_cell({ r: nzDragState.startR, c: nzDragState.startC });
        const endRef = XLSX.utils.encode_cell({ r: endR, c: endC });
        const rangeStr = (nzDragState.startR === endR && nzDragState.startC === endC)
          ? startRef : `${startRef}:${endRef}`;
        const input = document.getElementById('nzCellInput');
        input.value = nzDragState.baseInput + rangeStr + ')';
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      nzExitRangePick();
      return;
    }
    // 正常模式拖拽完成
    finishNormalDrag();
  };

  // 鼠标移出表格后松开
  document.addEventListener('mouseup', () => {
    if (dragging && nzDragState?.active) {
      dragging = false;
      nzExitRangePick();
    }
    finishNormalDrag();
  });
}

/** 高亮选中的范围 */
function nzHighlightRange(r1, c1, r2, c2) {
  nzClearRangeHighlight();
  const minR = Math.min(r1, r2), maxR = Math.max(r1, r2);
  const minC = Math.min(c1, c2), maxC = Math.max(c1, c2);
  document.querySelectorAll('#nzTbody td[data-r]').forEach(td => {
    const r = +td.dataset.r, c = +td.dataset.c;
    if (r >= minR && r <= maxR && c >= minC && c <= maxC) {
      td.classList.add('nz-range-select');
    }
  });
}

/** 清除范围高亮（nzRangePickMode 用） */
function nzClearRangeHighlight() {
  document.querySelectorAll('#nzTbody td.nz-range-select').forEach(td => {
    td.classList.remove('nz-range-select');
  });
}

/** 高亮正常模式拖选范围 */
function nzHighlightNormalRange() {
  nzClearNormalRangeHighlight();
  if (!NZ.selectedRange) return;
  const { r1, c1, r2, c2 } = NZ.selectedRange;
  document.querySelectorAll('#nzTbody td[data-r]').forEach(td => {
    const r = +td.dataset.r, c = +td.dataset.c;
    if (r >= r1 && r <= r2 && c >= c1 && c <= c2) {
      td.classList.add('nz-range-selected');
    }
  });
  // 锚点格额外标记
  if (NZ.selectedCell) {
    const anchor = document.querySelector(`#nzTbody td[data-r="${NZ.selectedCell.row}"][data-c="${NZ.selectedCell.col}"]`);
    if (anchor) anchor.classList.add('selected');
  }
}

/** 清除正常模式范围高亮 */
function nzClearNormalRangeHighlight() {
  document.querySelectorAll('#nzTbody td.nz-range-selected').forEach(td => {
    td.classList.remove('nz-range-selected');
  });
}

/** 计算范围内的统计数据（支持公式单元格） */
function nzCalcRangeStats(range) {
  if (!range || !NZ.wb) return null;
  const { r1, c1, r2, c2 } = range;
  const statsData = nzComputeStats();
  let count = 0, sum = 0, numCount = 0;
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      count++;
      let val = nzGetCellDisplayValue(NZ.activeSheet, r, c);
      const valStr = String(val);
      if (nzHasFormula(valStr)) {
        const resolved = nzResolveCellFormula(valStr, statsData, NZ.activeSheet);
        if (resolved.ok) val = resolved.value;
      }
      const num = parseFloat(val);
      if (!isNaN(num)) { sum += num; numCount++; }
    }
  }
  return { count, numCount, sum, avg: numCount > 0 ? sum / numCount : 0 };
}

/** 生成范围地址字符串（如 A1:B5 或 A1） */
function nzRangeAddr(range) {
  if (!range) return '';
  const s = XLSX.utils.encode_cell({ r: range.r1, c: range.c1 });
  if (range.r1 === range.r2 && range.c1 === range.c2) return s;
  return s + ':' + XLSX.utils.encode_cell({ r: range.r2, c: range.c2 });
}

/** 显示范围操作栏 */
function nzShowRangeActionBar() {
  const bar = document.getElementById('nzRangeActionBar');
  if (bar) bar.style.display = '';
}

/** 隐藏范围操作栏 */
function nzHideRangeActionBar() {
  const bar = document.getElementById('nzRangeActionBar');
  if (bar) bar.style.display = 'none';
}

/** 更新范围操作栏内容 */
function nzUpdateRangeActionBar() {
  if (!NZ.selectedRange) { nzHideRangeActionBar(); return; }
  const stats = nzCalcRangeStats(NZ.selectedRange);
  const info = document.getElementById('nzRabInfo');
  const statsEl = document.getElementById('nzRabStats');
  if (!info || !statsEl) return;

  const addr = nzRangeAddr(NZ.selectedRange);
  info.textContent = `${addr} (${stats.count}格)`;

  statsEl.innerHTML = ''
    + `<span>求和: <strong>${stats.sum % 1 === 0 ? stats.sum : stats.sum.toFixed(2)}</strong></span>`
    + `<span>均值: <strong>${stats.avg.toFixed(2)}</strong></span>`
    + `<span>计数: <strong>${stats.numCount}</strong></span>`;

  nzShowRangeActionBar();
}

/** 进入单元格引用选取模式（输入=后激活） */
function nzEnterCellRefPick() {
  if (nzCellRefPickMode) return;
  nzCellRefPickMode = true;
  const hint = document.getElementById('nzRangeHint');
  if (hint) {
    hint.querySelector('span').textContent = '点击表格单元格插入引用，可配合 + - * / 运算符组合';
    hint.style.display = '';
  }
}

/** 退出单元格引用选取模式 */
function nzExitCellRefPick() {
  if (!nzCellRefPickMode) return;
  nzCellRefPickMode = false;
  if (!nzRangePickMode) {
    const hint = document.getElementById('nzRangeHint');
    if (hint) hint.style.display = 'none';
  }
}

function nzSelectCell(r, c) {
  // 拖选结束时抑制点选
  if (nzSuppressNextClick) return;
  // 引用选取模式：点击单元格插入引用
  if (nzCellRefPickMode) {
    const ref = XLSX.utils.encode_cell({ r, c });
    const input = document.getElementById('nzCellInput');
    const pos = input.selectionStart != null ? input.selectionStart : input.value.length;
    const endPos = input.selectionEnd != null ? input.selectionEnd : pos;
    input.value = input.value.substring(0, pos) + ref + input.value.substring(endPos);
    input.focus();
    const newPos = pos + ref.length;
    input.setSelectionRange(newPos, newPos);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  // 普通单选：清除范围选择
  NZ.selectedRange = null;
  nzHideRangeActionBar();
  nzClearNormalRangeHighlight();

  NZ.selectedCell = { row: r, col: c };
  // 高亮
  document.querySelectorAll('#nzTbody td.selected').forEach(td => td.classList.remove('selected'));
  const td = document.querySelector(`#nzTbody td[data-r="${r}"][data-c="${c}"]`);
  if (td) td.classList.add('selected');
  nzUpdateEditBar();
  try { nzSyncFormatBar(); } catch(e) { /* 格式栏未就绪时忽略 */ }
}

function nzUpdateEditBar() {
  const bar = document.getElementById('nzEditBar');
  const refEl = document.getElementById('nzCellRef');
  const input = document.getElementById('nzCellInput');
  if (!NZ.selectedCell || !NZ.wb) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = '';
  const { row, col } = NZ.selectedCell;
  // 有范围选择时显示范围地址，否则显示单格地址
  refEl.textContent = NZ.selectedRange ? nzRangeAddr(NZ.selectedRange) : XLSX.utils.encode_cell({ r: row, c: col });
  const editKey = `${NZ.activeSheet}!${row}!${col}`;
  const ws = NZ.wb.Sheets[NZ.wb.SheetNames[NZ.activeSheet]];
  let val = '';
  if (NZ.cellEdits[editKey] !== undefined) {
    val = NZ.cellEdits[editKey];
  } else {
    const ref = XLSX.utils.encode_cell({ r: row, c: col });
    const cell = ws?.[ref];
    if (cell) val = cell.v != null ? String(cell.v) : '';
  }
  input.value = val;
  
  // 小数位和百分比使用粘性状态，切换单元格不重置
  const decSel = document.getElementById('nzDecimalSel');
  const pctBtn = document.getElementById('nzPercentBtn');
  if (decSel) decSel.value = NZ._stickyDecimal;
  if (pctBtn) pctBtn.classList.toggle('active', NZ._stickyPercent);

  // 同步行高输入框
  const rowHEl = document.getElementById('nzRowHeightInput');
  if (rowHEl) {
    const rowKey = `${NZ.activeSheet}!${row}`;
    const h = NZ.rowHeights[rowKey];
    rowHEl.value = h || 28;
  }
}

// ---- 单元格编辑 ----
document.getElementById('nzCellInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    nzExitCellRefPick();
    nzApplyCellEdit();
  } else if (e.key === 'Escape') {
    // Escape：取消编辑，退出选取模式，恢复原始值
    nzExitCellRefPick();
    nzExitRangePick();
    nzUpdateEditBar();
    e.target.blur();
  }
});
document.getElementById('nzCellInput').addEventListener('blur', () => {
  // 选取模式（拖拽或引用）时不提交编辑
  if (nzRangePickMode || nzCellRefPickMode) return;
  nzApplyCellEdit();
});
// 监听输入变化，自动进入/退出选取模式
document.getElementById('nzCellInput').addEventListener('input', () => {
  const val = document.getElementById('nzCellInput').value.trim();
  // 检测是否处于函数参数输入状态：=SUM( 或 =AVG( 且末尾是 ( 或 ,
  const funcMatch = val.match(/=\s*(SUM|AVG)\s*\(/i);
  const inFuncArgs = funcMatch && /[,(]\s*$/.test(val);
  if (inFuncArgs) {
    // SUM/AVG 参数输入 → 拖拽选取模式
    const fn = funcMatch[1].toUpperCase();
    if (nzRangePickMode !== fn) {
      nzRangePickMode = fn;
      nzDragState = nzDragState || {};
      nzDragState.baseInput = val;
      nzDragState.funcName = fn;
      // 更新UI
      document.getElementById('nzFuncSumBtn')?.classList.toggle('active', fn === 'SUM');
      document.getElementById('nzFuncAvgBtn')?.classList.toggle('active', fn === 'AVG');
    }
    nzExitCellRefPick();
    const hint = document.getElementById('nzRangeHint');
    if (hint) {
      hint.querySelector('span').textContent = `正在选取 ${fn} 范围，拖动鼠标选择单元格，松开完成`;
      hint.style.display = '';
    }
  } else {
    // 不在函数参数状态
    if (nzRangePickMode) nzExitRangePick();
    // 引用选取模式：= 开头时激活，点击单元格可插入引用
    if (val.startsWith('=')) {
      nzEnterCellRefPick();
    } else {
      nzExitCellRefPick();
    }
  }
});

function nzApplyCellEdit() {
  if (!NZ.selectedCell || !NZ.wb) return;
  const { row, col } = NZ.selectedCell;
  const editKey = `${NZ.activeSheet}!${row}!${col}`;
  const newVal = document.getElementById('nzCellInput').value;
  const ws = NZ.wb.Sheets[NZ.wb.SheetNames[NZ.activeSheet]];
  const ref = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = ws?.[ref];
  const origVal = cell ? (cell.v != null ? String(cell.v) : '') : '';
  if (newVal === origVal) {
    delete NZ.cellEdits[editKey];
  } else {
    NZ.cellEdits[editKey] = newVal;
  }
  // 只刷新该单元格而非全表
  const td = document.querySelector(`#nzTbody td[data-r="${row}"][data-c="${col}"]`);
  if (td) {
    const isFormula = nzHasFormula(newVal);
    const fmt = NZ.cellFormats[editKey];
    let fmtStyle = '';
    if (fmt) {
      if (fmt.bold) fmtStyle += 'font-weight:700;';
      if (fmt.italic) fmtStyle += 'font-style:italic;';
      if (fmt.align) fmtStyle += `text-align:${fmt.align};`;
      if (fmt.fontSize) fmtStyle += `font-size:${fmt.fontSize}px;`;
      if (fmt.fontName) fmtStyle += `font-family:${fmt.fontName};`;
    }
    td.className = (isFormula ? ' nz-formula' : '') + ' selected';
    td.title = newVal;
    if (fmtStyle) td.style.cssText = fmtStyle;
    // 预览模式下显示计算值
    if (NZ.previewMode && isFormula) {
      const statsData = nzComputeStats();
      const resolved = nzResolveCellFormula(newVal, statsData, NZ.activeSheet);
      td.textContent = resolved.ok ? String(resolved.value) : newVal;
    } else {
      td.textContent = newVal;
    }
  }
}
function nzPopulateQiSelects() {
  // 文件下拉
  const fileSel = document.getElementById('nzQiFile');
  fileSel.innerHTML = '';
  if (!S.files.length) {
    fileSel.innerHTML = '<option value="">-- 无文件 --</option>';
    return;
  }
  S.files.forEach((f, i) => {
    const opt = document.createElement('option');
    opt.value = i + 1;
    opt.textContent = `${i + 1} - ${f.name}`;
    fileSel.appendChild(opt);
  });
  nzQiUpdateL1();
}

document.getElementById('nzQiFile').addEventListener('change', nzQiUpdateL1);
document.getElementById('nzQiL1').addEventListener('change', nzQiUpdateEntry);
document.getElementById('nzQiEntry').addEventListener('change', nzQiUpdateCol);
document.getElementById('nzQiCol').addEventListener('change', nzQiUpdatePreview);
document.getElementById('nzQiMetric').addEventListener('change', nzQiUpdatePreview);

function nzQiUpdateL1() {
  const fi = parseInt(document.getElementById('nzQiFile').value);
  const l1Sel = document.getElementById('nzQiL1');
  l1Sel.innerHTML = '<option value="">(无/总合计)</option>';
  if (!fi || !S.files[fi - 1]) return;
  const file = S.files[fi - 1];
  const l1Groups = file.grps.filter(g => g.level === 1);
  l1Groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.name;
    opt.textContent = g.name;
    l1Sel.appendChild(opt);
  });
  nzQiUpdateEntry();
}

function nzQiUpdateEntry() {
  const fi = parseInt(document.getElementById('nzQiFile').value);
  const l1Val = document.getElementById('nzQiL1').value;
  const entryRow = document.getElementById('nzQiEntryRow');
  const entrySel = document.getElementById('nzQiEntry');
  entrySel.innerHTML = '';

  if (!fi || !S.files[fi - 1]) {
    entryRow.style.display = 'none';
    nzQiUpdateCol();
    return;
  }

  // 计算统计数据
  const statsData = nzComputeStats();
  const fd = statsData[fi];
  if (!fd) {
    entryRow.style.display = 'none';
    nzQiUpdateCol();
    return;
  }

  entryRow.style.display = '';

  if (!l1Val) {
    // 无L1选择：显示总合计和独立分组（含交叉项）
    const opt = document.createElement('option');
    opt.value = '总合计';
    opt.textContent = '总合计';
    entrySel.appendChild(opt);
    // 交叉项
    fd.entries.filter(e => e.isL1Cross && !e.l1Name).forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.name;
      opt.textContent = `[交叉] ${e.name}`;
      entrySel.appendChild(opt);
    });
    // 独立分组自身
    fd.entries.filter(e => e.isGroup && !e.isL1Cross && !e.l1Name).forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.name;
      opt.textContent = `[分组] ${e.name}`;
      entrySel.appendChild(opt);
    });
  } else if (l1Val === '__standalone__') {
    // 独立分组（含交叉项）
    fd.entries.filter(e => e.isL1Cross && !e.l1Name).forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.name;
      opt.textContent = `[交叉] ${e.name}`;
      entrySel.appendChild(opt);
    });
    fd.entries.filter(e => e.isGroup && !e.isL1Cross && !e.l1Name).forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.name;
      opt.textContent = `[分组] ${e.name}`;
      entrySel.appendChild(opt);
    });
  } else {
    // 选了L1：列出该L1下所有条目（交叉项、合计、小计等）
    // 按类型分组：交叉项、自身名称、小计、L1合计
    const l1Entries = fd.entries.filter(e => e.l1Name === l1Val);
    // 先加L1合计
    const l1Total = l1Entries.find(e => e.isL1Total);
    if (l1Total) {
      const opt = document.createElement('option');
      opt.value = l1Total.name;
      opt.textContent = `[合计] ${l1Val}`;
      entrySel.appendChild(opt);
    }
    // 交叉项
    l1Entries.filter(e => e.isL1Cross).forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.name;
      opt.textContent = `[交叉] ${e.name}`;
      entrySel.appendChild(opt);
    });
    // L1子分组自身
    l1Entries.filter(e => e.isGroup && !e.isL1Cross && !e.isL1Total && !e.isL1Subtotal && !e.isL1Copy).forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.name;
      opt.textContent = `[分组] ${e.name}`;
      entrySel.appendChild(opt);
    });
    // 小计
    l1Entries.filter(e => e.isL1Subtotal).forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.name;
      opt.textContent = `[小计] ${e.name}`;
      entrySel.appendChild(opt);
    });
  }

  nzQiUpdateCol();
}

function nzQiUpdateCol() {
  const fi = parseInt(document.getElementById('nzQiFile').value);
  const colSel = document.getElementById('nzQiCol');
  colSel.innerHTML = '<option value="">默认</option>';
  if (!fi || !S.files[fi - 1]) return;
  const file = S.files[fi - 1];
  file.hdr.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    colSel.appendChild(opt);
  });
  nzQiUpdatePreview();
}

function nzQiUpdatePreview() {
  const p = nzQiBuildParsed();
  const preview = document.getElementById('nzQiPreview');
  if (!p) { preview.textContent = ''; return; }
  const formula = nzBuildFormula(p);
  preview.textContent = formula;

  // 尝试解析预览值
  const statsData = nzComputeStats();
  // nzResolveFormula需要 l2=entryName，p.l2已经是entryName
  const result = nzResolveFormula(p, statsData);
  if (result.ok) {
    preview.textContent += ` = ${result.value}`;
  } else {
    preview.textContent += ` → ${result.value}`;
  }
}

function nzQiBuildParsed() {
  const fi = parseInt(document.getElementById('nzQiFile').value);
  if (!fi) return null;
  const l1Val = document.getElementById('nzQiL1').value;
  const entrySel = document.getElementById('nzQiEntry');
  const entryVal = entrySel?.value || '';
  const colVal = document.getElementById('nzQiCol').value;
  const metric = document.getElementById('nzQiMetric').value;
  if (!entryVal) return null;

  let l1 = '';
  if (l1Val === '__standalone__') {
    l1 = '';
  } else {
    l1 = l1Val || '';
  }

  // 修正[合计]条目：L1合计的 name 是"L1名称 合计"，但公式 l2 应为"合计"
  let l2 = entryVal;
  if (l1 && entryVal.endsWith(' 合计')) {
    l2 = '合计';
  }

  return { fileIdx: fi, l1, l2, col: colVal || '', metric };
}

document.getElementById('nzQiInsertBtn').addEventListener('click', () => {
  const p = nzQiBuildParsed();
  if (!p) { ntf('请选择分组信息', 'warn'); return; }
  const formula = nzBuildFormula(p);
  const input = document.getElementById('nzCellInput');
  // 始终在光标位置插入公式，不替换已有内容
  const curVal = input.value;
  const pos = input.selectionStart != null ? input.selectionStart : curVal.length;
  const endPos = input.selectionEnd != null ? input.selectionEnd : pos;
  input.value = curVal.substring(0, pos) + formula + curVal.substring(endPos);
  const newPos = pos + formula.length;
  input.setSelectionRange(newPos, newPos);
  nzApplyCellEdit();
  ntf('公式已插入');
});

// ---- 扫描公式 ----
document.getElementById('nzScanBtn').addEventListener('click', nzScanFormulas);

function nzScanFormulas() {
  if (!NZ.wb) { ntf('请先上传模板', 'warn'); return; }
  const body = document.getElementById('nzScanBody');
  body.style.display = '';
  const list = document.getElementById('nzScanList');
  const statsData = nzComputeStats();
  const formulas = [];
  let matchCount = 0, failCount = 0;

  NZ.wb.SheetNames.forEach((sname, si) => {
    const ws = NZ.wb.Sheets[sname];
    if (!ws || !ws['!ref']) return;
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        const editKey = `${si}!${r}!${c}`;
        let cellVal;
        if (NZ.cellEdits[editKey] !== undefined) {
          cellVal = NZ.cellEdits[editKey];
        } else {
          const cell = ws[ref];
          if (!cell) continue;
          cellVal = cell.v != null ? String(cell.v) : '';
        }
        if (!nzHasFormula(cellVal)) continue;
        // 使用多公式解析（传入sheet索引用于单元格引用）
        const result = nzResolveCellFormula(cellVal, statsData, si);
        formulas.push({ formula: cellVal, ref, sheet: sname, ok: result.ok, value: result.value });
        if (result.ok) matchCount++; else failCount++;
      }
    }
  });

  if (!formulas.length) {
    list.innerHTML = '<div style="padding:10px;color:var(--t3);font-size:12px">未找到任何公式（{{...}}、=表达式、SUM/AVG函数）</div>';
  } else {
    list.innerHTML = formulas.map(f => `
      <div class="nz-scan-item ${f.ok ? 'ok' : 'err'}">
        <span class="nz-scan-icon">${f.ok ? '✅' : '❌'}</span>
        <span class="nz-scan-formula">${esc(f.sheet)}!${esc(f.ref)}: ${esc(f.formula)}</span>
        <span class="nz-scan-value ${f.ok ? '' : 'err'}">${esc(String(f.value))}</span>
      </div>
    `).join('');
  }
  ntf(`扫描完成：${matchCount} 匹配，${failCount} 未匹配`, failCount ? 'warn' : 'success');
}
function nzShowFormatBar() {
  const bar = document.getElementById('nzFormatBar');
  if (bar) bar.style.display = NZ.wb ? '' : 'none';
}

function nzGetCurrentFmt() {
  if (!NZ.selectedCell) return {};
  const editKey = `${NZ.activeSheet}!${NZ.selectedCell.row}!${NZ.selectedCell.col}`;
  return NZ.cellFormats[editKey] || {};
}

function nzSetFmt(prop, value) {
  if (!NZ.selectedCell || !NZ.wb) return;
  const editKey = `${NZ.activeSheet}!${NZ.selectedCell.row}!${NZ.selectedCell.col}`;
  if (!NZ.cellFormats[editKey]) NZ.cellFormats[editKey] = {};
  if (value === '' || value === false) {
    delete NZ.cellFormats[editKey][prop];
  } else {
    NZ.cellFormats[editKey][prop] = value;
  }
  // 清理空格式
  if (!Object.keys(NZ.cellFormats[editKey]).length) delete NZ.cellFormats[editKey];
  // 刷新单元格显示
  const td = document.querySelector(`#nzTbody td[data-r="${NZ.selectedCell.row}"][data-c="${NZ.selectedCell.col}"]`);
  if (td) {
    const fmt = NZ.cellFormats[editKey];
    let s = '';
    if (fmt) {
      if (fmt.bold) s += 'font-weight:700;';
      if (fmt.italic) s += 'font-style:italic;';
      if (fmt.align) s += `text-align:${fmt.align};`;
      if (fmt.fontSize) s += `font-size:${fmt.fontSize}px;`;
      if (fmt.fontName) s += `font-family:${fmt.fontName};`;
    }
    td.style.cssText = s;
  }
}
function nzSyncFormatBar() {
  const fmt = nzGetCurrentFmt();
  const boldBtn = document.getElementById('nzBoldBtn');
  const italicBtn = document.getElementById('nzItalicBtn');
  const fontName = document.getElementById('nzFontName');
  const fontSize = document.getElementById('nzFontSize');
  if (!boldBtn) return; // DOM 未就绪（旧版缓存）
  boldBtn.classList.toggle('nz-fmt-active', !!fmt.bold);
  italicBtn.classList.toggle('nz-fmt-active', !!fmt.italic);
  fontName.value = fmt.fontName || '';
  fontSize.value = fmt.fontSize || '';
}

// ---- 范围选取操作栏按钮 ----
/** 清除范围选择并回到单选状态 */
function nzClearRangeSelection() {
  NZ.selectedRange = null;
  nzClearNormalRangeHighlight();
  nzHideRangeActionBar();
  if (NZ.selectedCell) nzUpdateEditBar();
}
function nzApplyEditsToWorkbook() {
  if (!NZ.wb) return;
  Object.entries(NZ.cellEdits).forEach(([key, val]) => {
    const [si, r, c] = key.split('!').map(Number);
    const ws = NZ.wb.Sheets[NZ.wb.SheetNames[si]];
    if (!ws) return;
    const ref = XLSX.utils.encode_cell({ r, c });
    if (!ws[ref]) {
      ws[ref] = { t: 's', v: val };
    } else {
      ws[ref].v = val;
      ws[ref].t = 's';
      delete ws[ref].w;
    }
    // 扩展range
    if (ws['!ref']) {
      const range = XLSX.utils.decode_range(ws['!ref']);
      if (r > range.e.r) range.e.r = r;
      if (c > range.e.c) range.e.c = c;
      ws['!ref'] = XLSX.utils.encode_range(range);
    }
  });
}
function nzInsertRowAt(insertRow) {
  const si = NZ.activeSheet;
  // 扩展 worksheet 范围
  const ws = NZ.wb.Sheets[NZ.wb.SheetNames[si]];
  if (ws && ws['!ref']) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    // 在插入行位置，把所有单元格下移一行
    // 从最后一行开始往下处理，避免覆盖
    for (let r = range.e.r; r >= insertRow; r--) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const srcRef = XLSX.utils.encode_cell({ r, c });
        const dstRef = XLSX.utils.encode_cell({ r: r + 1, c });
        if (ws[srcRef]) {
          ws[dstRef] = ws[srcRef];
          delete ws[srcRef];
        } else if (ws[dstRef]) {
          delete ws[dstRef];
        }
      }
    }
    range.e.r += 1;
    ws['!ref'] = XLSX.utils.encode_range(range);
  }

  // 下移编辑缓存（从最大行号开始）
  const editsToMove = [];
  for (const key in NZ.cellEdits) {
    const m = key.match(/^(\d+)!(\d+)!(\d+)$/);
    if (m && +m[1] === si && +m[2] >= insertRow) {
      editsToMove.push({ key, col: +m[3], oldRow: +m[2] });
    }
  }
  editsToMove.sort((a, b) => b.oldRow - a.oldRow); // 从下往上
  for (const item of editsToMove) {
    const newKey = `${si}!${item.oldRow + 1}!${item.col}`;
    NZ.cellEdits[newKey] = NZ.cellEdits[item.key];
    delete NZ.cellEdits[item.key];
  }

  // 下移格式缓存
  const fmtsToMove = [];
  for (const key in NZ.cellFormats) {
    const m = key.match(/^(\d+)!(\d+)!(\d+)$/);
    if (m && +m[1] === si && +m[2] >= insertRow) {
      fmtsToMove.push({ key, col: +m[3], oldRow: +m[2] });
    }
  }
  fmtsToMove.sort((a, b) => b.oldRow - a.oldRow);
  for (const item of fmtsToMove) {
    const newKey = `${si}!${item.oldRow + 1}!${item.col}`;
    NZ.cellFormats[newKey] = NZ.cellFormats[item.key];
    delete NZ.cellFormats[item.key];
  }

  // 下移行高缓存
  const heightsToMove = [];
  for (const key in NZ.rowHeights) {
    const m = key.match(/^(\d+)!(\d+)$/);
    if (m && +m[1] === si && +m[2] >= insertRow) {
      heightsToMove.push({ key, oldRow: +m[2] });
    }
  }
  heightsToMove.sort((a, b) => b.oldRow - a.oldRow);
  for (const item of heightsToMove) {
    const newKey = `${si}!${item.oldRow + 1}`;
    NZ.rowHeights[newKey] = NZ.rowHeights[item.key];
    delete NZ.rowHeights[item.key];
  }

  nzRenderTable();
}

/**
 * 删除指定行：把 deleteRow 以下的所有单元格上移一行，并清理缓存
 */
function nzDeleteRowAt(deleteRow) {
  const si = NZ.activeSheet;
  const ws = NZ.wb.Sheets[NZ.wb.SheetNames[si]];
  if (ws && ws['!ref']) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    // 把 deleteRow+1 及以下的单元格上移一行
    for (let r = deleteRow; r < range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const srcRef = XLSX.utils.encode_cell({ r: r + 1, c });
        const dstRef = XLSX.utils.encode_cell({ r, c });
        if (ws[srcRef]) {
          ws[dstRef] = ws[srcRef];
          delete ws[srcRef];
        } else if (ws[dstRef]) {
          delete ws[dstRef];
        }
      }
    }
    // 清除最后一行的残留
    for (let c = range.s.c; c <= range.e.c; c++) {
      const ref = XLSX.utils.encode_cell({ r: range.e.r, c });
      delete ws[ref];
    }
    range.e.r -= 1;
    if (range.e.r < range.s.r) range.e.r = range.s.r;
    ws['!ref'] = XLSX.utils.encode_range(range);
  }

  // 删除当前行的编辑缓存
  for (const key in NZ.cellEdits) {
    const m = key.match(/^(\d+)!(\d+)!(\d+)$/);
    if (m && +m[1] === si && +m[2] === deleteRow) {
      delete NZ.cellEdits[key];
    }
  }
  // 上移 deleteRow+1 以下的编辑缓存
  const editsToMove = [];
  for (const key in NZ.cellEdits) {
    const m = key.match(/^(\d+)!(\d+)!(\d+)$/);
    if (m && +m[1] === si && +m[2] > deleteRow) {
      editsToMove.push({ key, col: +m[3], oldRow: +m[2] });
    }
  }
  editsToMove.sort((a, b) => a.oldRow - b.oldRow); // 从上往下
  for (const item of editsToMove) {
    const newKey = `${si}!${item.oldRow - 1}!${item.col}`;
    NZ.cellEdits[newKey] = NZ.cellEdits[item.key];
    delete NZ.cellEdits[item.key];
  }

  // 删除当前行的格式缓存 + 上移
  for (const key in NZ.cellFormats) {
    const m = key.match(/^(\d+)!(\d+)!(\d+)$/);
    if (m && +m[1] === si && +m[2] === deleteRow) {
      delete NZ.cellFormats[key];
    }
  }
  const fmtsToMove = [];
  for (const key in NZ.cellFormats) {
    const m = key.match(/^(\d+)!(\d+)!(\d+)$/);
    if (m && +m[1] === si && +m[2] > deleteRow) {
      fmtsToMove.push({ key, col: +m[3], oldRow: +m[2] });
    }
  }
  fmtsToMove.sort((a, b) => a.oldRow - b.oldRow);
  for (const item of fmtsToMove) {
    const newKey = `${si}!${item.oldRow - 1}!${item.col}`;
    NZ.cellFormats[newKey] = NZ.cellFormats[item.key];
    delete NZ.cellFormats[item.key];
  }

  // 删除当前行的行高缓存 + 上移
  delete NZ.rowHeights[`${si}!${deleteRow}`];
  const heightsToMove = [];
  for (const key in NZ.rowHeights) {
    const m = key.match(/^(\d+)!(\d+)$/);
    if (m && +m[1] === si && +m[2] > deleteRow) {
      heightsToMove.push({ key, oldRow: +m[2] });
    }
  }
  heightsToMove.sort((a, b) => a.oldRow - b.oldRow);
  for (const item of heightsToMove) {
    const newKey = `${si}!${item.oldRow - 1}`;
    NZ.rowHeights[newKey] = NZ.rowHeights[item.key];
    delete NZ.rowHeights[item.key];
  }

  nzRenderTable();
}