// ========== step2-filter.js — 步骤2：一级过滤 ==========

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

  // 只对一级过滤后的行统计和修改
  const filteredRawIdx = new Set();
  const fd = getFilteredData();
  fd.forEach(fr => {
    const idx = f.raw.indexOf(fr);
    if (idx >= 0) filteredRawIdx.add(idx);
  });

  f.raw.forEach((r, i) => {
    if (!filteredRawIdx.has(i)) return; // 跳过被过滤掉的行
    const raw = String(r[col] ?? '').trim();
    if (!raw) {
      emptyCount++;
      return;
    }
    // 按常见分隔符拆分
    const names = raw.split(/[,，、;；\s]+/).map(n => n.trim()).filter(n => n);
    // 拆分后为空（原始值全是分隔符，如 "，"），视为空值
    if (!names.length) {
      emptyCount++;
      r[col] = '';
      details.push(`行${i+2}: "${raw}" → (全为分隔符，已清空)`);
      return;
    }
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
