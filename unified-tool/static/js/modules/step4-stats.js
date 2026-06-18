// ========== step4-stats.js — 步骤4：二级统计 + 配置系统 ==========
// ========== L2 逐文件预览 ==========
function updateL2DataInfo(totalRows, filteredRows) {
  const el = document.getElementById('l2DataInfo');
  if (!el) return;
  if (!totalRows) { el.style.display = 'none'; return; }
  el.style.display = 'inline-flex';
  const splitNote = getSplitMatchForFile(getActiveFile()) ? ' (已拆分过滤)' : '';
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
  // 可被链式依赖的L2分组：属于某个L1、且自身不是链式子分组（无parentIds指向同L1内其他L2）
  const l1ChildSet = new Set();
  l1Grps.forEach(l1g => { (l1g.childGroupIds || []).forEach(cid => l1ChildSet.add(cid)); });
  const chainableL2 = f.grps.filter(g => {
    if (g.level === 1) return false;
    if (!l1ChildSet.has(g.id)) return false; // 必须属于某个L1
    // 不能是链式子分组（parentIds指向同L1内其他L2的才算链式）
    const pids = g.parentIds && g.parentIds.length ? g.parentIds : (g.parentId ? [g.parentId] : []);
    if (!pids.length) return true; // 独立子分组，可被依赖
    // 检查是否所有parent都在同L1内——如果是则是链式子分组，不可被依赖
    const ownerL1 = l1Grps.find(l1 => l1.childGroupIds && l1.childGroupIds.includes(g.id));
    if (!ownerL1) return true;
    const allInSameL1 = pids.every(pid => ownerL1.childGroupIds && ownerL1.childGroupIds.includes(pid));
    return !allInSameL1; // 如果所有parent都在同L1内，说明是链式子分组，不可被依赖
  });

  if (!l1Grps.length && !chainableL2.length) {
    div.innerHTML = '<span style="color:var(--t3);font-size:11px">暂无分组可依托</span>';
    document.getElementById('l2RelF').style.display = 'none';
    return;
  }
  // L1分组
  if (l1Grps.length) {
    const lbl = document.createElement('div');
    lbl.className = 'dep-section-label';
    lbl.textContent = 'L1分组';
    lbl.style.cssText = 'font-size:10px;color:var(--t3);margin:4px 0 2px;font-weight:600';
    div.appendChild(lbl);
    l1Grps.forEach(g => {
      const lbl = document.createElement('label');
      lbl.className = 'dep-chk-label';
      lbl.innerHTML = `<input type="checkbox" value="${g.id}" class="dep-chk dep-l1"> ${esc(g.name)}`;
      div.appendChild(lbl);
    });
  }
  // 可链式依赖的L2分组
  if (chainableL2.length) {
    const lbl = document.createElement('div');
    lbl.className = 'dep-section-label';
    lbl.textContent = 'L2分组（链式依赖）';
    lbl.style.cssText = 'font-size:10px;color:var(--t3);margin:8px 0 2px;font-weight:600';
    div.appendChild(lbl);
    chainableL2.forEach(g => {
      const ownerL1 = l1Grps.find(l1 => l1.childGroupIds && l1.childGroupIds.includes(g.id));
      const suffix = ownerL1 ? ` (${ownerL1.name})` : '';
      const lbl = document.createElement('label');
      lbl.className = 'dep-chk-label';
      lbl.innerHTML = `<input type="checkbox" value="${g.id}" class="dep-chk dep-l2" data-owner-l1="${ownerL1 ? ownerL1.id : ''}"> ${esc(g.name)}${suffix}`;
      div.appendChild(lbl);
    });
  }
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
  // 补充：已分组但不在当前数据中的值（新Excel可能缺少某些标签，但配置中已定义）
  const allValsSet = new Set(allVals);
  const notInData = new Set();
  grouped.forEach(v => { if (!allValsSet.has(v)) { allVals.push(v); notInData.add(v); } });
  const inScope = allVals.filter(v => inScopeSet.has(v)), outScope = allVals.filter(v => !inScopeSet.has(v));
  let html = '';
  [...inScope, ...outScope].forEach(v => {
    const isG = grouped.has(v), isS = S.selGVals.includes(v), isIn = inScopeSet.has(v);
    const noData = notInData.has(v); // 在当前数据中完全不存在
    let cls = 'vp2-i';
    if (isS) cls += ' sel';
    if (isG) cls += ' grp';
    if (!isIn) cls += ' l1out';
    const label = noData ? v + ' (无数据)' : (!isIn ? v + ' (L1外)' : v);
    html += `<div class="${cls}" data-v="${esc(v)}">${esc(label)}</div>`;
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
    parentRel: pGroupIds.length ? pRel : null,
    level: 2
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
    const cm = CM[g.color] || CM.teal;
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
    updLxButtons();
    ntf(`1级分组 "${name}" 已创建，包含 ${selectedIds.size} 个子分组`);
  });
}

// ========== 创建3/4/5级分组 ==========
function showLxGroupDialog(targetLevel) {
  const f = getActiveFile();
  if (!f) { ntf('无活跃文件', 'error'); return; }
  const parentLevel = targetLevel - 1;
  // 收集可用的父级分组
  const parentGrps = f.grps.filter(g => g.level === parentLevel || (parentLevel === 2 && (!g.level || g.level === 2)));
  if (!parentGrps.length) { ntf(`请先创建${parentLevel}级分组`, 'error'); return; }

  const overlay = document.createElement('div');
  overlay.className = 'fd-overlay vis';
  const dd = document.createElement('div');
  dd.className = 'fd-dropdown vis';
  dd.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%);width:420px;max-height:600px;';
  let html = `<div class="fd-head"><span class="fd-cn">创建${targetLevel}级分组</span></div>`;
  html += '<div style="padding:12px 14px;display:flex;flex-direction:column;gap:8px">';
  // 父级选择
  html += `<div style="display:flex;gap:8px;align-items:center"><label style="font-size:12px;color:var(--t3);white-space:nowrap">父级分组</label><select id="lxParentSel" style="flex:1;background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:6px 10px;color:var(--t1);font:12px var(--sf);outline:none">`;
  parentGrps.forEach(g => {
    html += `<option value="${g.id}">${esc(g.name)} (${esc(g.column || '聚合')})</option>`;
  });
  html += '</select></div>';
  // 列选择
  html += `<div style="display:flex;gap:8px;align-items:center"><label style="font-size:12px;color:var(--t3);white-space:nowrap">列</label><select id="lxColSel" style="flex:1;background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:6px 10px;color:var(--t1);font:12px var(--sf);outline:none">`;
  f.hdr.forEach(c => { html += `<option value="${esc(c)}">${esc(c)}</option>`; });
  html += '</select></div>';
  // 分组名
  html += '<div style="display:flex;gap:8px;align-items:center"><label style="font-size:12px;color:var(--t3);white-space:nowrap">分组名</label><input id="lxGrpName" placeholder="如：重点项" style="flex:1;background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:6px 10px;color:var(--t1);font:12px var(--sf);outline:none"></div>';
  // 颜色
  html += '<div style="display:flex;gap:8px;align-items:center"><label style="font-size:12px;color:var(--t3);white-space:nowrap">颜色</label><div class="gcolors" id="lxGCols">';
  GROUP_COLORS.forEach((c, i) => {
    html += `<div class="gco c-${c}${i === 0 ? ' sel' : ''}" data-c="${c}"></div>`;
  });
  html += '</div></div>';
  // 值选择（动态渲染）
  html += '<label style="font-size:11px;color:var(--t3)">选择值</label>';
  html += '<div class="fd-value-list" id="lxValueList" style="max-height:220px"></div>';
  html += '</div>';
  html += '<div class="fd-foot"><span class="fd-cnt" id="lxSelCnt">0 个已选</span><div class="fd-btns"><button class="btn btn-ghost btn-xs" id="lxCancel">取消</button><button class="btn btn-primary btn-xs" id="lxOk">创建</button></div></div>';
  dd.innerHTML = html;
  document.body.appendChild(overlay);
  document.body.appendChild(dd);

  let lxColor = GROUP_COLORS[0];
  const lxSelectedValues = [];

  // 颜色选择
  dd.querySelectorAll('#lxGCols .gco').forEach(el => el.addEventListener('click', () => {
    dd.querySelectorAll('#lxGCols .gco').forEach(e => e.classList.remove('sel'));
    el.classList.add('sel');
    lxColor = el.dataset.c;
  }));

  // 列变更时刷新值列表
  function renderLxValues() {
    const col = dd.querySelector('#lxColSel').value;
    const list = dd.querySelector('#lxValueList');
    if (!col) { list.innerHTML = '<div style="padding:8px;color:var(--t3)">请选择列</div>'; return; }
    const parentSel = dd.querySelector('#lxParentSel').value;
    const parentGrp = f.grps.find(g => g.id === +parentSel);
    // 获取父分组的上下文数据
    const l1Data = getFilteredData_forFile(f);
    const ctxCache = {};
    const parentCtx = parentGrp ? getGroupContext(parentGrp.id, l1Data, f.grps, ctxCache) : l1Data;
    // 在父上下文中提取该列的唯一值
    const valCounts = {};
    parentCtx.forEach(r => { const v = String(r[col] ?? '').trim(); if (v) valCounts[v] = (valCounts[v] || 0) + 1; });
    const sorted = Object.entries(valCounts).sort((a, b) => b[1] - a[1]);
    list.innerHTML = sorted.map(([v, cnt]) =>
      `<div class="fd-item lx-val-item" data-v="${esc(v)}" style="gap:6px;padding:6px 12px"><span style="font-size:12px">${esc(v)}</span><span style="font-size:10px;color:var(--t3);margin-left:auto">${cnt}</span></div>`
    ).join('');
    lxSelectedValues.length = 0;
    updLxCnt();
    list.querySelectorAll('.lx-val-item').forEach(el => el.addEventListener('click', () => {
      const v = el.dataset.v;
      const idx = lxSelectedValues.indexOf(v);
      if (idx >= 0) { lxSelectedValues.splice(idx, 1); el.classList.remove('sel'); }
      else { lxSelectedValues.push(v); el.classList.add('sel'); }
      updLxCnt();
    }));
  }

  function updLxCnt() {
    const cntEl = dd.querySelector('#lxSelCnt');
    if (cntEl) cntEl.textContent = `${lxSelectedValues.length} 个已选`;
  }

  dd.querySelector('#lxColSel').addEventListener('change', renderLxValues);
  dd.querySelector('#lxParentSel').addEventListener('change', renderLxValues);
  renderLxValues();

  const close = () => { overlay.remove(); dd.remove(); };
  dd.querySelector('#lxCancel').addEventListener('click', close);
  overlay.addEventListener('click', close);

  dd.querySelector('#lxOk').addEventListener('click', () => {
    const parentSel = +dd.querySelector('#lxParentSel').value;
    const col = dd.querySelector('#lxColSel').value;
    const name = dd.querySelector('#lxGrpName').value.trim();
    if (!col) { ntf('请选择列', 'error'); return; }
    if (!name) { ntf('请输入分组名', 'error'); return; }
    if (!lxSelectedValues.length) { ntf('请选择值', 'error'); return; }
    f.grps.push({
      id: ++f.gid, name, color: lxColor, column: col, values: [...lxSelectedValues],
      l1Dep: null, parentIds: [parentSel], parentRels: ['AND'],
      parentId: parentSel, parentRel: 'AND',
      level: targetLevel
    });
    close();
    renderGrpCards();
    popDepGrp();
    updLxButtons();
    ntf(`${targetLevel}级分组 "${name}" 已创建`);
  });
}

function updLxButtons() {
  const f = getActiveFile();
  const hasL2 = f && f.grps.some(g => g.level === 2 || (!g.level && g.level !== 1));
  const hasL3 = f && f.grps.some(g => g.level === 3);
  const hasL4 = f && f.grps.some(g => g.level === 4);
  document.getElementById('btnAddL3Grp').style.display = hasL2 ? '' : 'none';
  document.getElementById('btnAddL4Grp').style.display = hasL3 ? '' : 'none';
  document.getElementById('btnAddL5Grp').style.display = hasL4 ? '' : 'none';
}

document.getElementById('btnAddL3Grp').addEventListener('click', () => showLxGroupDialog(3));
document.getElementById('btnAddL4Grp').addEventListener('click', () => showLxGroupDialog(4));
document.getElementById('btnAddL5Grp').addEventListener('click', () => showLxGroupDialog(5));

function renderGrpCards() {
  const f = getActiveFile();
  if (!f) return;
  const div = document.getElementById('grpCards');
  if (!f.grps.length) { div.innerHTML = ''; return; }

  // 找出被1级分组包含的子分组ID（这些会嵌套在1级分组内展示）
  const childOfL1 = new Set();
  f.grps.filter(g => g.level === 1 && g.childGroupIds).forEach(g => g.childGroupIds.forEach(id => childOfL1.add(id)));
  // 找出被任何父分组包含的L3+子分组ID（这些会嵌套在父分组内展示）
  const childOfAny = new Set();
  f.grps.forEach(g => { if (g.parentId && g.level >= 3) childOfAny.add(g.id); });

  // 构建子分组映射：parentId -> [children]（用于L3+嵌套渲染）
  const childrenOf = {};
  f.grps.forEach(g => {
    if (g.parentId && g.level >= 3) {
      if (!childrenOf[g.parentId]) childrenOf[g.parentId] = [];
      childrenOf[g.parentId].push(g);
    }
  });

  // 递归渲染子级分组（L3/L4/L5）
  function renderSubGroups(parentId, depth) {
    const kids = childrenOf[parentId];
    if (!kids || !kids.length) return '';
    let h = '<div class="gc-sub-children" style="margin-left:' + (depth * 16) + 'px">';
    kids.forEach(kid => {
      const kcm = CM[kid.color] || CM.teal;
      const lvLabel = kid.level ? `${kid.level}级` : '2级';
      h += `<div class="gc gc-sub" draggable="true" data-gid="${kid.id}">
        <div class="gc-h"><span class="gc-dot" style="background:${kcm.d}"></span><span class="gc-n">${esc(kid.name)}</span><span class="gc-col">${esc(kid.column)} <span class="badge-lv">${lvLabel}</span></span><button class="btn btn-ghost btn-xs" data-edit="${kid.id}">✎</button><button class="btn btn-danger btn-xs" data-del="${kid.id}">✕</button></div>
        <div class="gc-vs">${kid.values.slice(0, 8).map(v => `<span class="gc-v ${kcm.t}">${esc(v)}</span>`).join('')}${kid.values.length > 8 ? `<span class="gc-v gc-more">+${kid.values.length - 8}</span>` : ''}</div>`;
      h += renderSubGroups(kid.id, depth + 1);
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  let html = '';
  f.grps.forEach(g => {
    const cm = CM[g.color] || CM.teal;
    const l1Info = g.l1Dep ? `L1:${esc(g.l1Dep.col)}` : '';

    if (g.level === 1) {
      // 1级分组：可折叠容器，包含子分组（支持链式嵌套展示）
      const childGrps = (g.childGroupIds || []).map(cid => f.grps.find(x => x.id === cid)).filter(Boolean);
      // 识别链式关系
      const childIdSet = new Set(childGrps.map(c => c.id));
      const chainMap = {};
      const chainChildSet = new Set();
      childGrps.forEach(cg => {
        if (cg.level === 1) return;
        const pids = cg.parentIds && cg.parentIds.length ? cg.parentIds : (cg.parentId ? [cg.parentId] : []);
        const localParent = pids.find(pid => childIdSet.has(pid) && pid !== cg.id);
        if (localParent) {
          if (!chainMap[localParent]) chainMap[localParent] = [];
          chainMap[localParent].push(cg.id);
          chainChildSet.add(cg.id);
        }
      });
      const independentCount = childGrps.filter(c => !chainChildSet.has(c.id)).length;
      html += `<div class="gc-l1-card" data-l1id="${g.id}" draggable="true">
        <div class="gc-l1-header" data-toggle-l1="${g.id}">
          <span class="gc-dot" style="background:${cm.d}"></span>
          <span class="gc-n">${esc(g.name)}</span>
          <span class="gc-lv1">1级</span>
          <span class="gc-l1-count">${independentCount}个独立${chainChildSet.size ? ' + ' + chainChildSet.size + '个链式' : ''}</span>
          <span class="gc-l1-arrow">&#9660;</span>
          <button class="btn btn-ghost btn-xs" data-edit="${g.id}" onclick="event.stopPropagation()">✎</button>
          <button class="btn btn-danger btn-xs" data-del="${g.id}" onclick="event.stopPropagation()">✕</button>
        </div>
        <div class="gc-l1-body" data-l1body="${g.id}">`;
      childGrps.forEach(cg => {
        if (chainChildSet.has(cg.id)) return;
        const ccm = CM[cg.color] || CM.teal;
        const hasChain = chainMap[cg.id] && chainMap[cg.id].length;
        const unmatchedCls = cg._unmatched ? ' gc-unmatched' : '';
        const unmatchedHint = cg._unmatched ? '<span class="gc-unmatched-tag">列未匹配</span>' : '';
        html += `<div class="gc gc-nested${unmatchedCls}" draggable="true" data-gid="${cg.id}">
          <div class="gc-h"><span class="gc-dot" style="background:${cg._unmatched ? 'var(--t3)' : ccm.d}"></span><span class="gc-n">${esc(cg.name)}</span><span class="gc-col">${esc(cg.column)}</span>${unmatchedHint}<button class="btn btn-ghost btn-xs" data-edit="${cg.id}">✎</button><button class="btn btn-danger btn-xs" data-del="${cg.id}">✕</button></div>
          <div class="gc-vs">${cg.values.slice(0, 8).map(v => `<span class="gc-v ${cg._unmatched ? '' : ccm.t}">${esc(v)}</span>`).join('')}${cg.values.length > 8 ? `<span class="gc-v gc-more">+${cg.values.length - 8}</span>` : ''}</div>`;
        if (hasChain) {
          html += '<div class="gc-chain-children">';
          chainMap[cg.id].forEach(chainedId => {
            const cg2 = f.grps.find(x => x.id === chainedId);
            if (!cg2) return;
            const ccm2 = CM[cg2.color] || CM.teal;
            const relLabel = cg2.parentRel || (cg2.parentRels && cg2.parentRels[0]) || 'AND';
            const umCls = cg2._unmatched ? ' gc-unmatched' : '';
            const umHint = cg2._unmatched ? '<span class="gc-unmatched-tag">列未匹配</span>' : '';
            html += `<div class="gc gc-chained${umCls}" draggable="true" data-gid="${cg2.id}">
              <div class="gc-chain-arrow">└ ${relLabel}</div>
              <div class="gc-h"><span class="gc-dot" style="background:${cg2._unmatched ? 'var(--t3)' : ccm2.d}"></span><span class="gc-n">${esc(cg2.name)}</span><span class="gc-col">${esc(cg2.column)}</span>${umHint}<button class="btn btn-ghost btn-xs" data-edit="${cg2.id}">✎</button><button class="btn btn-danger btn-xs" data-del="${cg2.id}">✕</button></div>
              <div class="gc-vs">${cg2.values.slice(0, 8).map(v => `<span class="gc-v ${cg2._unmatched ? '' : ccm2.t}">${esc(v)}</span>`).join('')}${cg2.values.length > 8 ? `<span class="gc-v gc-more">+${cg2.values.length - 8}</span>` : ''}</div>
              ${renderSubGroups(cg2.id, 1)}
            </div>`;
          });
          html += '</div>';
        }
        // 渲染L3+子分组
        html += renderSubGroups(cg.id, 1);
        html += '</div>';
      });
      html += `</div></div>`;
    } else if (!childOfL1.has(g.id) && !childOfAny.has(g.id)) {
      // 不属于1级分组的普通分组
      const lvLabel = g.level ? `${g.level}级` : '2级';
      const umCls = g._unmatched ? ' gc-unmatched' : '';
      const umHint = g._unmatched ? '<span class="gc-unmatched-tag">列未匹配</span>' : '';
      let depHtml = '';
      if (g.parentId) {
        const pg = f.grps.find(x => x.id === g.parentId);
        if (pg) {
          const rc = g.parentRel === 'AND' ? 'rel-and' : 'rel-or';
          depHtml = `<div class="gc-dep"><span class="dep-arrow">↑</span> <span class="gc-rel ${rc}">${g.parentRel}</span> ${esc(pg.name)}</div>`;
        }
      }
      html += `<div class="gc${umCls}" draggable="true" data-gid="${g.id}"><div class="gc-h"><span class="gc-dot" style="background:${g._unmatched ? 'var(--t3)' : cm.d}"></span><span class="gc-n">${esc(g.name)}</span><span class="gc-col">${esc(g.column)} <span class="badge-lv">${lvLabel}</span> ${l1Info}</span>${umHint}<button class="btn btn-ghost btn-xs" data-edit="${g.id}">✎</button><button class="btn btn-danger btn-xs" data-del="${g.id}">✕</button></div><div class="gc-vs">${g.values.slice(0, 8).map(v => `<span class="gc-v ${g._unmatched ? '' : cm.t}">${esc(v)}</span>`).join('')}${g.values.length > 8 ? `<span class="gc-v gc-more">+${g.values.length - 8}</span>` : ''}</div>${depHtml}`;
      // 渲染L3+子分组
      html += renderSubGroups(g.id, 1);
      html += '</div>';
    }
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
      // 删除子分组时，递归删除所有下级子分组，并从1级分组的childGroupIds中移除
      const toDelete = new Set([gid]);
      const queue = [gid];
      while (queue.length) {
        const pid = queue.shift();
        f.grps.filter(x => x.parentId === pid).forEach(c => { toDelete.add(c.id); queue.push(c.id); });
      }
      f.grps = f.grps.filter(x => !toDelete.has(x.id));
      f.grps.filter(x => x.level === 1 && x.childGroupIds).forEach(l1 => {
        l1.childGroupIds = l1.childGroupIds.filter(id => !toDelete.has(id));
      });
    }
    renderGrpCards();
    popDepGrp();
    updLxButtons();
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
    updLxButtons();
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
  const hasData = S.files.some(f => f.raw.length > 0);
  if (!hasData) { area.innerHTML = '<div class="empty-hint">文件数据未加载，请重新上传文件后刷新</div>'; return; }
  let html = '';
  S.files.forEach((file, fi) => {
    if (!file.raw.length) return;
    const sumCol = file.sumCol || '';
    let l1Data = getFilteredData_forFile(file);
    const splitRows = getSplitMatchForFile(file);
    if (splitRows && splitRows.size > 0) {
      l1Data = filterBySplitMatch(l1Data, file);
    }
    const ctxCache = {};
    const l1Groups = file.grps.filter(g => g.level === 1 && g.childGroupIds && g.childGroupIds.length);
    const l1ChildSet = new Set();
    l1Groups.forEach(l1g => { (l1g.childGroupIds || []).forEach(cid => l1ChildSet.add(cid)); });

    // ===== 生成条目 =====
    // 每个非L1分组生成一个条目，包含其context
    function makeEntry(g, indent, extra) {
      const ctx = getGroupContext(g.id, l1Data, file.grps, ctxCache);
      const e = {
        name: g.name, color: g.color, isGroup: true, column: g.column,
        count: ctx.length, pct: l1Data.length > 0 ? (ctx.length / l1Data.length * 100).toFixed(1) : '0',
        indent, _ctx: ctx, level: g.level || 2, _gid: g.id, ...(extra || {})
      };
      if (sumCol) e.sum = ctx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
      file.addedCols.forEach(ac => { const tc = {}; ctx.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; }); e['ac_' + ac] = tc; });
      return e;
    }

    // 为L2分组生成L1交叉项和L1小计
    function makeL1CrossEntries(g, ownerL1) {
      const parentIds = g.parentIds && g.parentIds.length ? g.parentIds : (g.parentId ? [g.parentId] : []);
      const parentRels = g.parentRels && g.parentRels.length ? g.parentRels : (g.parentRel ? [g.parentRel] : []);
      const hasL1Parent = parentIds.some(pid => { const pg = file.grps.find(x => x.id === pid); return pg && pg.level === 1; });
      if (!hasL1Parent) return null;

      const totalCtx = getGroupContext(g.id, l1Data, file.grps, ctxCache);
      const parentNames = parentIds.map(pid => { const pg = file.grps.find(x => x.id === pid); return pg ? pg.name : '?'; });
      const depLabel = parentRels.map((r, i) => `${r || 'AND'}→${parentNames[i]}`).join(' ');
      const totalEntry = {
        name: g.name, color: g.color, isGroup: true, column: g.column,
        count: totalCtx.length, pct: l1Data.length > 0 ? (totalCtx.length / l1Data.length * 100).toFixed(1) : '0',
        depInfo: depLabel, indent: 1, _ctx: totalCtx, _gid: g.id, crossItems: [], l1Subtotals: []
      };
      if (sumCol) totalEntry.sum = totalCtx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
      file.addedCols.forEach(ac => { const tc = {}; totalCtx.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; }); totalEntry['ac_' + ac] = tc; });

      // 对每个L1父分组生成交叉项
      parentIds.forEach((pid, pi) => {
        const pg = file.grps.find(x => x.id === pid);
        if (!pg || pg.level !== 1) return;
        const rel = parentRels[pi] || 'AND';
        const l1SubtotalRows = new Set();
        if (pg.childGroupIds && pg.childGroupIds.length) {
          pg.childGroupIds.forEach(cid => {
            const cg = file.grps.find(x => x.id === cid);
            if (!cg) return;
            const childCtx = getGroupContext(cid, l1Data, file.grps, ctxCache);
            const valSet = getGroupValues(g);
            const selfMatch = l1Data.filter(r => valSet.has(String(r[g.column] ?? '').trim()));
            let ctx;
            if (rel === 'AND') { const ps = new Set(childCtx); ctx = selfMatch.filter(r => ps.has(r)); }
            else { const seen = new Set(); ctx = []; [...childCtx, ...selfMatch].forEach(r => { if (!seen.has(r)) { seen.add(r); ctx.push(r); } }); }
            ctx.forEach(r => l1SubtotalRows.add(r));
            const crossEntry = {
              name: `${cg.name} · ${g.name}`, color: g.color, isGroup: true, column: g.column,
              count: ctx.length, pct: l1Data.length > 0 ? (ctx.length / l1Data.length * 100).toFixed(1) : '0',
              depInfo: `${rel}→${pg.name}.${cg.name}`, indent: 1, l1Name: pg.name, l1Id: pg.id, isL1Cross: true, _ctx: ctx
            };
            if (sumCol) crossEntry.sum = ctx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
            file.addedCols.forEach(ac => { const tc = {}; ctx.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; }); crossEntry['ac_' + ac] = tc; });
            totalEntry.crossItems.push(crossEntry);
          });
        }
        // 每个L1父分组一个小计
        const subRows = [...l1SubtotalRows];
        const subtotal = {
          name: `${g.name} · ${pg.name} 小计`, isL1Subtotal: true, isGroup: true, l1Name: pg.name, l1Id: pg.id,
          count: subRows.length, pct: l1Data.length > 0 ? (subRows.length / l1Data.length * 100).toFixed(1) : '0',
          indent: 1, _ctx: subRows
        };
        if (sumCol) subtotal.sum = subRows.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
        totalEntry.l1Subtotals.push(subtotal);
      });
      return totalEntry;
    }

    // 按L1分组归类
    const l1Entries = {};
    const standaloneEntries = [];
    // 收集未匹配分组，用于在结果中灰色显示
    const unmatchedGroups = file.grps.filter(g => g._unmatched && g.level !== 1);

    file.grps.forEach(g => {
      if (g.level === 1) return;
      // 跳过未匹配分组（后面单独处理展示）
      if (g._unmatched) return;

      const parentIds = g.parentIds && g.parentIds.length ? g.parentIds : (g.parentId ? [g.parentId] : []);
      const parentRels = g.parentRels && g.parentRels.length ? g.parentRels : (g.parentRel ? [g.parentRel] : []);
      const ownerL1 = findOwnerL1(g.id, file.grps, l1Groups);

      // L3+分组：与上一级每项结果相交展示
      if (g.level >= 3) {
        const totalCtx = getGroupContext(g.id, l1Data, file.grps, ctxCache);
        const pathParts = getGroupPath(g.id, file.grps);
        const fullName = pathParts.join(' · ');
        const parentGrp = file.grps.find(x => x.id === g.parentId);
        const depInfo = parentGrp ? `${g.level}级→${parentGrp.name}` : `${g.level}级`;
        // 查找所有祖先L1分组（通过parentId/parentIds向上遍历）
        const ancestorL1s = findAncestorL1s(g.id, file.grps, l1Groups);
        // 总entry
        const totalEntry = {
          name: fullName, color: g.color, isGroup: true, column: g.column,
          count: totalCtx.length, pct: l1Data.length > 0 ? (totalCtx.length / l1Data.length * 100).toFixed(1) : '0',
          depInfo, indent: 1, _ctx: totalCtx, level: g.level, _gid: g.id,
          l1Name: '', l1Id: null,
          crossItems: [], l1Subtotals: []
        };
        if (sumCol) totalEntry.sum = totalCtx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
        file.addedCols.forEach(ac => { const tc = {}; totalCtx.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; }); totalEntry['ac_' + ac] = tc; });

        // 对每个祖先L1生成交叉项
        ancestorL1s.forEach(ancL1 => {
          if (ancL1.childGroupIds && ancL1.childGroupIds.length) {
            const l1SubtotalRows = new Set();
            ancL1.childGroupIds.forEach(cid => {
              const cg = file.grps.find(x => x.id === cid);
              if (!cg) return;
              const childCtx = getGroupContext(cid, l1Data, file.grps, ctxCache);
              const childSet = new Set(childCtx);
              const ctx = totalCtx.filter(r => childSet.has(r));
              ctx.forEach(r => l1SubtotalRows.add(r));
              const parentName = parentGrp ? parentGrp.name : '?';
              const crossEntry = {
                name: `${cg.name} · ${parentName} · ${g.name}`, color: g.color, isGroup: true, column: g.column,
                count: ctx.length, pct: l1Data.length > 0 ? (ctx.length / l1Data.length * 100).toFixed(1) : '0',
                depInfo: `AND→${ancL1.name}.${cg.name}`, indent: 1, l1Name: ancL1.name, l1Id: ancL1.id, isL1Cross: true, _ctx: ctx
              };
              if (sumCol) crossEntry.sum = ctx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
              file.addedCols.forEach(ac => { const tc = {}; ctx.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; }); crossEntry['ac_' + ac] = tc; });
              totalEntry.crossItems.push(crossEntry);
            });
            // L1小计
            const subRows = [...l1SubtotalRows];
            const subtotal = {
              name: `${fullName} · ${ancL1.name} 小计`, isL1Subtotal: true, isGroup: true, l1Name: ancL1.name, l1Id: ancL1.id,
              count: subRows.length, pct: l1Data.length > 0 ? (subRows.length / l1Data.length * 100).toFixed(1) : '0',
              indent: 1, _ctx: subRows
            };
            if (sumCol) subtotal.sum = subRows.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
            totalEntry.l1Subtotals.push(subtotal);
          }
        });

        // 分发到l1Entries或standaloneEntries
        if (ancestorL1s.length) {
          // 分发交叉项和小计到各自L1
          if (totalEntry.crossItems) totalEntry.crossItems.forEach(ce => {
            if (!l1Entries[ce.l1Id]) l1Entries[ce.l1Id] = [];
            l1Entries[ce.l1Id].push(ce);
          });
          if (totalEntry.l1Subtotals) totalEntry.l1Subtotals.forEach(st => {
            if (!l1Entries[st.l1Id]) l1Entries[st.l1Id] = [];
            l1Entries[st.l1Id].push(st);
          });
          // 为每个L1创建带l1Name的totalEntry副本
          ancestorL1s.forEach(l1 => {
            if (!l1Entries[l1.id]) l1Entries[l1.id] = [];
            const copy = Object.assign({}, totalEntry, { l1Name: l1.name, l1Id: l1.id, isL1Copy: true });
            delete copy.crossItems;
            delete copy.l1Subtotals;
            l1Entries[l1.id].push(copy);
          });
        } else {
          standaloneEntries.push(totalEntry);
        }
        return;
      }

      // L2分组逻辑
      const hasL1Parent = parentIds.some(pid => { const pg = file.grps.find(x => x.id === pid); return pg && pg.level === 1; });
      const hasChainedL2Parent = ownerL1 && parentIds.some(pid => ownerL1.childGroupIds && ownerL1.childGroupIds.includes(pid));

      if (hasL1Parent) {
        const totalEntry = makeL1CrossEntries(g, ownerL1);
        if (!ownerL1) {
          // 无ownerL1但hasL1Parent=true：分发给每个L1父分组
          // 分发交叉项和小计到各自L1
          if (totalEntry.crossItems) totalEntry.crossItems.forEach(ce => {
            if (!l1Entries[ce.l1Id]) l1Entries[ce.l1Id] = [];
            l1Entries[ce.l1Id].push(ce);
          });
          if (totalEntry.l1Subtotals) totalEntry.l1Subtotals.forEach(st => {
            if (!l1Entries[st.l1Id]) l1Entries[st.l1Id] = [];
            l1Entries[st.l1Id].push(st);
          });
          // 为每个L1父分组创建带l1Name的totalEntry副本
          parentIds.forEach(pid => {
            const pg = file.grps.find(x => x.id === pid);
            if (!pg || pg.level !== 1) return;
            if (!l1Entries[pg.id]) l1Entries[pg.id] = [];
            const copy = Object.assign({}, totalEntry, { l1Name: pg.name, l1Id: pg.id, isL1Copy: true });
            delete copy.crossItems;
            delete copy.l1Subtotals;
            l1Entries[pg.id].push(copy);
          });
          // standalone显示用：清空已分发的crossItems/subtotals避免allEntries展平时重复
          totalEntry.crossItems = [];
          totalEntry.l1Subtotals = [];
          standaloneEntries.push(totalEntry);
        } else {
          // 交叉项和totalEntry都放入对应L1的entries中（与L3+一致）
          if (totalEntry.crossItems) totalEntry.crossItems.forEach(ce => {
            if (!l1Entries[ce.l1Id]) l1Entries[ce.l1Id] = [];
            l1Entries[ce.l1Id].push(ce);
          });
          if (totalEntry.l1Subtotals) totalEntry.l1Subtotals.forEach(st => {
            if (!l1Entries[st.l1Id]) l1Entries[st.l1Id] = [];
            l1Entries[st.l1Id].push(st);
          });
          // 推送totalEntry自身（与L3+一致）
          if (!l1Entries[ownerL1.id]) l1Entries[ownerL1.id] = [];
          l1Entries[ownerL1.id].push(totalEntry);
        }
        return;
      } else if (hasChainedL2Parent && ownerL1) {
        const entry = makeEntry(g, 2, { depInfo: `链式: ${parentRels.map((r, i) => { const pg = file.grps.find(x => x.id === parentIds[i]); return `${r || 'AND'}→${pg ? pg.name : '?'}`; }).join(' ')}`, isChained: true, l1Name: ownerL1.name, l1Id: ownerL1.id });
        if (!l1Entries[ownerL1.id]) l1Entries[ownerL1.id] = [];
        l1Entries[ownerL1.id].push(entry);
        return;
      } else if (parentIds.length > 0) {
        const entry = makeEntry(g, 1, { depInfo: parentRels.map((r, i) => { const pg = file.grps.find(x => x.id === parentIds[i]); return `${r || 'AND'}→${pg ? pg.name : '?'}`; }).join(' ') });
        standaloneEntries.push(entry);
        return;
      }

      // 无依赖的普通L2分组
      const ctx = getGroupContext(g.id, l1Data, file.grps, ctxCache);
      // 找到所有包含此L2的L1分组（支持一个L2属于多个L1）
      const ownerL1s = l1Groups.filter(l1 => l1.childGroupIds && l1.childGroupIds.includes(g.id));
      if (ownerL1s.length) {
        ownerL1s.forEach((ownerL1, oi) => {
          const isChained = isChainedChild(g, ownerL1, file.grps);
          const depInfo = isChained ? `链式:${ownerL1.name}` : `L1:${ownerL1.name}`;
          const entry = makeEntry(g, 1, { depInfo, l1Name: ownerL1.name, l1Id: ownerL1.id, isChained });
          if (!l1Entries[ownerL1.id]) l1Entries[ownerL1.id] = [];
          l1Entries[ownerL1.id].push(entry);
        });
      } else {
        const entry = makeEntry(g, 1, { depInfo: '(独立)', l1Name: '', l1Id: null });
        standaloneEntries.push(entry);
      }
    });

    // L1合计行
    l1Groups.forEach(l1g => {
      const l1Rows = new Set();
      (l1Entries[l1g.id] || []).forEach(e => {
        if (e.isChained || e.isL1Cross || e.isL1Subtotal || e.isL1Copy || (e.level && e.level >= 3)) return;
        if (e._ctx) e._ctx.forEach(r => l1Rows.add(r));
      });
      const l1r = [...l1Rows];
      const l1entry = { name: `${l1g.name} 合计`, isL1Total: true, count: l1r.length, pct: l1Data.length > 0 ? (l1r.length / l1Data.length * 100).toFixed(1) : '0', sum: sumCol ? l1r.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0) : null, _ctx: l1r };
      file.addedCols.forEach(ac => { const tc = {}; l1r.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; }); l1entry['ac_' + ac] = tc; });
      if (!l1Entries[l1g.id]) l1Entries[l1g.id] = [];
      l1Entries[l1g.id].push(l1entry);
    });

    // 未匹配分组条目：在L1手风琴或独立区域中灰色显示
    if (unmatchedGroups.length) {
      unmatchedGroups.forEach(g => {
        const ownerL1 = l1Groups.find(l1 => l1.childGroupIds && l1.childGroupIds.includes(g.id));
        const entry = {
          name: g.name, color: g.color, isGroup: true, column: g.column,
          count: 0, pct: '0.0', indent: 1, _ctx: [], isUnmatched: true,
          sum: sumCol ? 0 : undefined
        };
        if (ownerL1) {
          if (!l1Entries[ownerL1.id]) l1Entries[ownerL1.id] = [];
          l1Entries[ownerL1.id].push(entry);
        } else {
          standaloneEntries.push(entry);
        }
      });
    }

    // 总合计
    const allGroupRows = new Set();
    file.grps.forEach(g => { if (g.level === 1 || g._unmatched) return; getGroupContext(g.id, l1Data, file.grps, ctxCache).forEach(r => allGroupRows.add(r)); });
    const coveredRows = [...allGroupRows];
    const uncovered = l1Data.length - coveredRows.length;
    const total = { name: '合计', isTotal: true, count: coveredRows.length, pct: l1Data.length > 0 ? (coveredRows.length / l1Data.length * 100).toFixed(1) : '0', sum: sumCol ? coveredRows.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0) : null, totalData: l1Data.length, uncovered };
    file.addedCols.forEach(ac => { const tc = {}; coveredRows.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; }); total['ac_' + ac] = tc; });

    const secColor = SEC_COLORS[fi % SEC_COLORS.length];
    let scOpts = '<option value="">-- 无 --</option>';
    file.hdr.forEach(c => { scOpts += `<option value="${esc(c)}"${c === sumCol ? ' selected' : ''}>${esc(c)}</option>`; });
    html += `<div class="rv-section"><div class="rv-section-hdr" data-toggle-rv><span class="sec-dot" style="background:${secColor}"></span>${esc(file.name)}<span class="sec-info">${l1Data.length}行 / ${file.hdr.length}列 / ${file.grps.filter(g => g.level !== 1).length}分组</span><span class="rv-toggle-arrow">&#9660;</span><div class="rv-sum-sel"><label>求和列</label><select data-fid="${file.id}" class="rv-sc">${scOpts}</select></div></div><div class="rv-section-body">`;

    // 表格头部
    function tableHead() {
      let h = '<table class="rt"><thead><tr><th>类别</th><th>依托</th><th>列</th><th style="text-align:right">数量</th><th style="text-align:right">占比</th>';
      if (sumCol) h += `<th style="text-align:right">${esc(sumCol)} 求和</th>`;
      file.addedCols.forEach(ac => h += `<th style="text-align:right">${esc(ac)} 类型数</th>`);
      h += '</tr></thead><tbody>';
      return h;
    }
    // 表格行
    function entryRow(e) {
      const cm = e.color ? CM[e.color] : null;
      const indentPx = (e.indent || 0) * 20;
      const indentStyle = indentPx ? `style="padding-left:${indentPx}px;color:var(--t2)"` : '';
      let rowCls = e.isL1Total ? 'l1tot' : (e.isL1Subtotal ? 'l1sub' : '');
      if (e.isUnmatched) rowCls += ' rv-unmatched-row';
      const rowClass = rowCls ? ` class="${rowCls.trim()}"` : '';
      let r = `<tr${rowClass}>`;
      const iconSvg = e.isL1Total ? 'icon-chart' : (e.isL1Subtotal ? 'icon-table' : (e.isGroup ? (e.indent === 2 ? 'icon-link' : (e.indent ? 'icon-file' : 'icon-folder')) : 'icon-tag'));
      const unmatchedTag = e.isUnmatched ? '<span style="font-size:9px;color:var(--wn);margin-left:4px">(列未匹配)</span>' : '';
      r += `<td ${indentStyle}><div class="cc">${cm && !e.isUnmatched ? `<span class="cdot" style="background:${cm.d}"></span>` : (e.isUnmatched ? '<span class="cdot" style="background:var(--t3)"></span>' : '')}<svg class="icon" style="font-size:12px" aria-hidden="true"><use xlink:href="#${iconSvg}"/></svg> ${esc(e.name)}${unmatchedTag}</div></td>`;
      r += `<td style="color:var(--cy);font-size:10px;font-family:var(--mf)">${esc(e.depInfo || '')}</td>`;
      r += `<td style="color:var(--t3);font-size:10px">${esc(e.column || '')}</td>`;
      r += `<td class="nc">${e.count}</td><td class="nc">${e.pct}%</td>`;
      if (sumCol) r += `<td class="nc" style="color:var(--wn)">${e.sum !== undefined ? fmtN(e.sum) : '-'}</td>`;
      file.addedCols.forEach(ac => { const tc = e['ac_' + ac] || {}; r += `<td class="nc" style="color:var(--cy)">${Object.keys(tc).length} 种</td>`; });
      r += '</tr>';
      return r;
    }
    function totalRow(t) {
      const uncoveredHint = t.uncovered > 0 ? `<span style="color:var(--wn);font-size:10px;margin-left:6px">(未覆盖 ${t.uncovered} 条)</span>` : '';
      const totalHint = t.totalData != null ? `<span style="color:var(--t3);font-size:10px;margin-left:6px">/ 总${t.totalData}条</span>` : '';
      let r = `<tr class="tot"><td>合计${totalHint}${uncoveredHint}</td><td></td><td></td><td class="nc">${t.count}</td><td class="nc">${t.pct}%</td>`;
      if (sumCol) r += `<td class="nc" style="color:var(--wn)">${fmtN(t.sum)}</td>`;
      file.addedCols.forEach(ac => { const tc = t['ac_' + ac] || {}; r += `<td class="nc" style="color:var(--cy)">${Object.keys(tc).length} 种</td>`; });
      r += '</tr>';
      return r;
    }

    // === L1手风琴展示 ===
    l1Groups.forEach(l1g => {
      const l1EntriesList = l1Entries[l1g.id] || [];
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

    // 独立分组（每个独立分组单独一个手风琴）
    if (standaloneEntries.length) {
      standaloneEntries.forEach(e => {
        const crossItems = e.crossItems || [];
        const l1Subtotals = e.l1Subtotals || [];
        const mainCount = e.count;
        const mainPct = e.pct;
        html += `<div class="rv-acc rv-acc-standalone">`;
        html += `<div class="rv-acc-hdr" data-toggle-acc="sa_${e.name}"><span class="rv-acc-dot" style="background:${e.color ? (CM[e.color] || {}).d : 'var(--t3)'}"></span><span class="rv-acc-title">${esc(e.name)}</span><span class="rv-acc-info">${mainCount}条 · ${mainPct}%</span><span class="rv-acc-arrow">&#9660;</span></div>`;
        html += `<div class="rv-acc-body" data-accbody="sa_${e.name}">`;
        html += tableHead();
        crossItems.forEach(ce => { html += entryRow(ce); });
        l1Subtotals.forEach(st => { html += entryRow(st); });
        html += entryRow(e);
        const saTotal = { name: `${e.name} 合计`, isL1Total: true, count: mainCount, pct: mainPct, sum: e.sum, column: e.column || '' };
        file.addedCols.forEach(ac => { saTotal['ac_' + ac] = e['ac_' + ac] || {}; });
        html += entryRow(saTotal);
        html += '</tbody></table></div></div>';
      });
    }

    // 总合计
    html += tableHead();
    html += totalRow(total);
    html += '</tbody></table>';

    // 附加列详细分布
    if (file.addedCols.length) {
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
      if (body) { body.classList.toggle('rv-body-hidden'); section.classList.toggle('rv-section-collapsed'); }
    });
  });
  // 折叠/展开L1手风琴
  area.querySelectorAll('[data-toggle-acc]').forEach(hdr => {
    hdr.addEventListener('click', e => {
      const key = hdr.dataset.toggleAcc;
      const section = hdr.closest('.rv-section');
      const body = section ? section.querySelector(`[data-accbody="${key}"]`) : null;
      const acc = hdr.closest('.rv-acc');
      if (body) body.classList.toggle('rv-acc-body-hidden');
      if (acc) acc.classList.toggle('rv-acc-collapsed');
    });
  });
  // 求和列切换
  area.querySelectorAll('.rv-sc').forEach(sel => sel.addEventListener('change', e => {
    const fid = +e.target.dataset.fid;
    const file = S.files.find(f => f.id === fid);
    if (file) { file.sumCol = e.target.value; calcAllStats(); }
  }));
  document.getElementById('exportBtn').style.display = S.files.length ? 'inline-flex' : 'none';

  // 渲染 ECharts 图表区
  if (typeof StatsCharts !== 'undefined') {
    setTimeout(() => StatsCharts.render(), 100);
  }
}

// ========== 导出 Excel ==========
document.getElementById('exportBtn').addEventListener('click', () => {
  if (!S.files.length) { ntf('无数据可导出', 'error'); return; }
  const wb = XLSX.utils.book_new();
  S.files.forEach(file => {
    const sumCol = file.sumCol || '';
    let l1Data = getFilteredData_forFile(file);
    // 如果已执行拆分，排除未匹配行
    const splitRows = getSplitMatchForFile(file);
    if (splitRows && splitRows.size > 0) {
      l1Data = filterBySplitMatch(l1Data, file);
    }
    const ctxCache = {};
    const rows = [];
    const header = ['文件', '类别', '依托', '列', '数量', '占比(%)'];
    if (sumCol) header.push(`${sumCol} 求和`);
    file.grps.forEach(g => {
      if (g.level === 1) return;
      if (g._unmatched) {
        const row = [file.name, g.name, '(列未匹配)', g.column, 0, '0.0'];
        if (sumCol) row.push(0);
        rows.push(row);
        return;
      }
      const ctx = getGroupContext(g.id, l1Data, file.grps, ctxCache);
      let depLabel = g.l1Dep ? `L1:${g.l1Dep.col}` : '';
      if (g.parentId) { const pg = file.grps.find(x => x.id === g.parentId); if (pg) depLabel += ` ${g.parentRel}→${pg.name}`; } else depLabel += ' (独立)';
      const row = [file.name, g.name, depLabel, g.column, ctx.length, l1Data.length > 0 ? (ctx.length / l1Data.length * 100).toFixed(1) : '0'];
      if (sumCol) row.push(parseFloat((ctx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0)).toFixed(2)));
      rows.push(row);
    });
    if (!file.grps.length) { const row = [file.name, '(未分组)', '', '', l1Data.length, '100']; if (sumCol) row.push(0); rows.push(row); }
    // 合计：所有L2分组ctx并集（排除L1和未匹配分组）
    const expAllRows = new Set();
    file.grps.forEach(g => {
      if (g.level === 1 || g._unmatched) return;
      getGroupContext(g.id, l1Data, file.grps, ctxCache).forEach(r => expAllRows.add(r));
    });
    const expCovered = [...expAllRows];
    const totalRow = [file.name, `合计(总${l1Data.length}条)`, '', '', expCovered.length, l1Data.length > 0 ? (expCovered.length / l1Data.length * 100).toFixed(1) : '0'];
    if (sumCol) totalRow.push(expCovered.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0));
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
  const fc = {name: f.name, hdr: f.hdr, l1: {}, grps: f.grps.map(g => ({id: g.id, name: g.name, color: g.color, column: g.column, values: g.values, l1Dep: g.l1Dep, parentIds: g.parentIds || (g.parentId ? [g.parentId] : []), parentRels: g.parentRels || (g.parentRel ? [g.parentRel] : []), parentId: g.parentId || null, parentRel: g.parentRel || null, level: g.level || null, childGroupIds: g.childGroupIds || null})), addedCols: f.addedCols, sumCol: f.sumCol || '', hiddenCols: [...f.hiddenCols]};
  f.hdr.forEach(col => {
    fc.l1[col] = {checked: f.l1[col].checked ? [...f.l1[col].checked] : null, cascade: f.l1[col].cascade || false, dependCol: f.l1[col].dependCol || null, sort: f.l1[col].sort || null, condOn: f.l1[col].condOn || false, condOp: f.l1[col].condOp || 'eq', condVal: f.l1[col].condVal || ''};
  });
  return {files: [fc], mappingData: S.mappingData && Object.keys(S.mappingData).length ? S.mappingData : null, splitGroups: S.splitGroups || null};
}

function saveGlobalConfig() {
  const f = getActiveFile();
  if (!f) { ntf('无活跃文件', 'error'); return; }
  const cfg = buildConfigData();
  const sig = hdrSignature(f.hdr);
  // 检测分局拆分是否有变动：对比当前 splitGroups 与后端保存的当前状态
  checkSplitGroupsChanged(changed => {
    // 弹出命名对话框
    showConfigNameDialog(name => {
      if (!name) return;
      if (changed) {
        // 分局拆分有变动，询问是否同时保存为新模板
        askSaveSplitTemplate(name, () => doSaveConfig(name, cfg, sig));
      } else {
        doSaveConfig(name, cfg, sig);
      }
    });
  });
}

function doSaveConfig(name, cfg, sig) {
  fetch('/api/configs', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ name, cfg, sig, savedAt: Date.now() })
  }).then(r => r.json()).then(data => {
    if (data.error) { ntf(data.error, 'error'); return; }
    // 记住保存时的 splitGroups 快照，用于下次变动检测
    S._lastSavedSplitGroups = S.splitGroups ? JSON.parse(JSON.stringify(S.splitGroups)) : null;
    ntf('配置已保存');
  }).catch(() => ntf('保存失败', 'error'));
}

/**
 * 检测分局拆分是否有变动
 * 对比当前 S.splitGroups 与上次保存配置时的快照（或后端当前值）
 */
function checkSplitGroupsChanged(callback) {
  const current = S.splitGroups;
  const last = S._lastSavedSplitGroups;
  // 如果有快照，直接对比
  if (last !== undefined) {
    callback(!deepEqualSplitGroups(current, last));
    return;
  }
  // 无快照时从后端获取当前值对比
  fetch('/api/split-groups').then(r => r.json()).then(serverGroups => {
    S._lastSavedSplitGroups = serverGroups;
    callback(!deepEqualSplitGroups(current, serverGroups));
  }).catch(() => callback(false));
}

function deepEqualSplitGroups(a, b) {
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    const av = (a[ak[i]] || []).slice().sort();
    const bv = (b[bk[i]] || []).slice().sort();
    if (av.length !== bv.length || av.some((v, i) => v !== bv[i])) return false;
  }
  return true;
}

/**
 * 询问用户是否将当前分局拆分保存为新模板
 */
function askSaveSplitTemplate(configName, onContinue) {
  const overlay = document.createElement('div');
  overlay.className = 'glass-overlay';
  const dlg = document.createElement('div');
  dlg.className = 'glass-dialog';
  dlg.innerHTML = `
    <div class="glass-dlg-head">
      <span class="glass-dlg-title">分局拆分已变动</span>
      <span class="glass-dlg-close" data-close>&times;</span>
    </div>
    <div class="glass-dlg-body" style="line-height:1.7">
      检测到分局拆分配置与上次保存时不同。<br>
      是否将当前分局拆分保存为新模板？<br>
      <span style="font-size:11px;color:var(--t3)">选择"跳过"仅保存过滤配置，不影响分局拆分模板。</span>
    </div>
    <div class="glass-dlg-foot">
      <button class="btn btn-ghost btn-sm" id="sgSkipBtn">跳过</button>
      <button class="btn btn-primary btn-sm" id="sgSaveBtn">保存模板</button>
    </div>`;
  overlay.appendChild(dlg);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) { close(); onContinue(); } });
  dlg.querySelector('[data-close]').addEventListener('click', () => { close(); onContinue(); });
  dlg.querySelector('#sgSkipBtn').addEventListener('click', () => { close(); onContinue(); });
  dlg.querySelector('#sgSaveBtn').addEventListener('click', () => {
    close();
    // 调用分局模板保存逻辑
    const map = getWorkingMapping();
    if (!map || !Object.keys(map).length) { ntf('当前映射为空，跳过模板保存', 'warn'); onContinue(); return; }
    const templateName = `${configName}_拆分模板`;
    fetch('/api/bureau-templates', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ name: templateName, mapping: map, splitGroups: S.splitGroups || null, savedAt: Date.now() })
    }).then(r => r.json()).then(data => {
      if (data.error) { ntf(data.error, 'error'); } else {
        ntf(`分局拆分模板「${templateName}」已保存`);
      }
      onContinue();
    }).catch(() => { ntf('模板保存失败', 'error'); onContinue(); });
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
      ${hasMapping ? '<div style="font-size:10px;color:var(--cy);font-family:var(--mf)">快照分局映射 (' + Object.keys(S.mappingData).length + '个分局)，加载配置时不会覆盖当前分局拆分</div>' : ''}
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
  // 清除之前的拆分状态，避免加载配置后二级统计仍应用旧的拆分过滤
  clearSplitState();
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
      // 当前文件的表头列集合
      const hdrSet = new Set(targetFile.hdr);
      // 第一遍：建立旧ID→新ID映射
      const idMap = {};
      const tempGroups = fc.grps.map(g => {
        const newId = ++targetFile.gid;
        if (g.id != null) idMap[g.id] = newId;
        return { ...g, _newId: newId };
      });
      // 兼容旧配置（无id字段）：按数组索引+1映射
      if (fc.grps.length && fc.grps[0].id == null) {
        fc.grps.forEach((g, idx) => { idMap[idx + 1] = tempGroups[idx]._newId; });
      }
      // 第二遍：创建分组并重映射所有ID引用
      targetFile.grps = [];
      targetFile.gid = 0;
      tempGroups.forEach(g => {
        const newId = ++targetFile.gid;
        const remapIds = ids => ids ? ids.map(id => idMap[id] || id) : ids;
        const rawPids = g.parentIds && g.parentIds.length ? g.parentIds : (g.parentId ? [g.parentId] : []);
        const pids = remapIds(rawPids) || [];
        const prels = g.parentRels && g.parentRels.length ? g.parentRels : (g.parentRel ? [g.parentRel] : []);
        const childGroupIds = g.childGroupIds ? remapIds(g.childGroupIds) : null;
        // 检查分组是否匹配当前文件的列（L1分组无column，总是匹配）
        const isUnmatched = g.level !== 1 && g.column && !hdrSet.has(g.column);
        targetFile.grps.push({
          id: newId, name: g.name, color: g.color, column: g.column, values: g.values || [],
          l1Dep: g.l1Dep || null, parentIds: pids, parentRels: prels,
          parentId: pids[0] || null, parentRel: prels[0] || null,
          level: g.level || null, childGroupIds,
          _unmatched: isUnmatched
        });
      });
    }
  });
  // 恢复分局映射和拆分组配置（跟着配置一起切换）
  if (cfg.mappingData && typeof cfg.mappingData === 'object') {
    S.mappingData = cfg.mappingData;
    S.splitMappingReady = true;
    S.activeTemplateName = null;   // 配置不是命名模板
    S._localMapping = null;        // 清空临时映射
    saveMapping();
    renderMapping();
  }
  if (cfg.splitGroups && Object.keys(cfg.splitGroups).length) {
    S.splitGroups = cfg.splitGroups;
    saveSplitGroups();
    renderSplitGroups();
  } else if (cfg.mappingData) {
    S.splitGroups = null;
  }
  // 更新快照，用于保存时的变动检测
  S._lastSavedSplitGroups = S.splitGroups ? JSON.parse(JSON.stringify(S.splitGroups)) : null;
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

