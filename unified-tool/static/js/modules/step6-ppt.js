// ========== step6-ppt.js — 步骤6：PPT通报生成 ==========

const PPT = {
  templateData: '',       // base64 PPT模板
  templateName: '',       // 模板文件名
  dataFileData: '',       // base64 数据Excel
  dataFileName: '',       // 数据文件名
  dataSource: 'upload',   // 'upload' | 'nz'
  nzAvailable: false,     // 上次标准化输出是否可用
  nzInfo: null,           // 上次标准化输出信息
  generating: false,
  dataMap: null,          // 自定义数据映射（覆盖 DEFAULT_DATA_MAP）
};

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
  // PPT模板上传
  const pptZone = document.getElementById('pptUploadZone');
  const pptInput = document.getElementById('pptFileInput');
  if (pptZone && pptInput) {
    pptZone.addEventListener('click', () => pptInput.click());
    pptZone.addEventListener('dragover', e => { e.preventDefault(); pptZone.classList.add('drag-over'); });
    pptZone.addEventListener('dragleave', () => pptZone.classList.remove('drag-over'));
    pptZone.addEventListener('drop', e => { e.preventDefault(); pptZone.classList.remove('drag-over'); if (e.dataTransfer.files.length) handlePptFile(e.dataTransfer.files[0]); });
    pptInput.addEventListener('change', () => { if (pptInput.files.length) handlePptFile(pptInput.files[0]); });
  }

  // 数据文件上传
  const dataZone = document.getElementById('pptDataZone');
  const dataInput = document.getElementById('pptDataInput');
  if (dataZone && dataInput) {
    dataZone.addEventListener('click', () => dataInput.click());
    dataZone.addEventListener('dragover', e => { e.preventDefault(); dataZone.classList.add('drag-over'); });
    dataZone.addEventListener('dragleave', () => dataZone.classList.remove('drag-over'));
    dataZone.addEventListener('drop', e => { e.preventDefault(); dataZone.classList.remove('drag-over'); if (e.dataTransfer.files.length) handleDataFile(e.dataTransfer.files[0]); });
    dataInput.addEventListener('change', () => { if (dataInput.files.length) handleDataFile(dataInput.files[0]); });
  }

  // 数据来源切换
  document.querySelectorAll('.ppt-source-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const src = tab.dataset.source;
      PPT.dataSource = src;
      document.querySelectorAll('.ppt-source-tab').forEach(t => t.classList.toggle('active', t.dataset.source === src));
      document.getElementById('pptDataUploadWrap').style.display = src === 'upload' ? '' : 'none';
      document.getElementById('pptNzImport').style.display = src === 'nz' ? '' : 'none';
    });
  });

  // 生成按钮
  const genBtn = document.getElementById('pptGenerateBtn');
  if (genBtn) genBtn.addEventListener('click', doGenerate);

  // 校准数据按钮
  const previewBtn = document.getElementById('pptPreviewBtn');
  if (previewBtn) previewBtn.addEventListener('click', doPreviewData);

  // 下载按钮
  const dlBtn = document.getElementById('pptDownloadBtn');
  if (dlBtn) dlBtn.addEventListener('click', doDownload);

  // 保存模板按钮
  const saveBtn = document.getElementById('pptSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', showSaveModal);

  // 删除模板按钮
  const delBtn = document.getElementById('pptDeleteBtn');
  if (delBtn) delBtn.addEventListener('click', doDeleteTemplate);

  // 下载模板按钮
  const dlTplBtn = document.getElementById('pptDownloadTplBtn');
  if (dlTplBtn) dlTplBtn.addEventListener('click', doDownloadTemplate);

  // 模态框事件
  const modalClose = document.getElementById('pptModalClose');
  if (modalClose) modalClose.addEventListener('click', hideSaveModal);
  const modalCancel = document.getElementById('pptModalCancel');
  if (modalCancel) modalCancel.addEventListener('click', hideSaveModal);
  const modalOk = document.getElementById('pptModalOk');
  if (modalOk) modalOk.addEventListener('click', doSaveTemplate);
  const modalMask = document.getElementById('pptModalMask');
  if (modalMask) modalMask.addEventListener('click', hideSaveModal);

  // 模板选择
  const tplSel = document.getElementById('pptTemplateSel');
  if (tplSel) tplSel.addEventListener('change', onTemplateSelect);
});

// ===== 文件处理 =====
function handlePptFile(file) {
  if (!file.name.match(/\.pptx?$/i)) {
    ntf('请上传 .pptx 格式的PPT模板', 'error');
    return;
  }
  PPT.templateName = file.name;
  const reader = new FileReader();
  reader.onload = e => {
    PPT.templateData = arrayBufferToBase64(e.target.result);
    updateUploadZone('pptUploadZone', file.name);
    showDownloadTplBtn();
    ntf(`PPT模板已加载: ${file.name}`);
  };
  reader.readAsArrayBuffer(file);
}

function handleDataFile(file) {
  if (!file.name.match(/\.xlsx?$/i)) {
    ntf('请上传 .xlsx 格式的数据文件', 'error');
    return;
  }
  PPT.dataFileName = file.name;
  const reader = new FileReader();
  reader.onload = e => {
    PPT.dataFileData = arrayBufferToBase64(e.target.result);
    updateUploadZone('pptDataZone', file.name);
    ntf(`数据文件已加载: ${file.name}`);
  };
  reader.readAsArrayBuffer(file);
}

function updateUploadZone(zoneId, filename) {
  const zone = document.getElementById(zoneId);
  if (!zone) return;
  zone.classList.add('has-file');
  const fnEl = zone.querySelector('.ppt-upload-filename');
  if (fnEl) fnEl.textContent = filename;
  const textEl = zone.querySelector('.ppt-upload-text');
  if (textEl) textEl.textContent = '点击更换文件';
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ===== 生成PPT =====
async function doGenerate() {
  if (PPT.generating) return;
  if (!PPT.templateData) {
    ntf('请先上传PPT模板文件', 'error');
    return;
  }

  let dataFileData = PPT.dataFileData;

  // 如果选择从标准化导入，检查是否有可用数据
  if (PPT.dataSource === 'nz' && !dataFileData) {
    if (!PPT.nzAvailable) {
      ntf('没有可用的标准化输出，请先在数据标准化步骤执行填充操作', 'error');
      return;
    }
  }

  PPT.generating = true;
  const resultArea = document.getElementById('pptResultArea');
  if (resultArea) {
    resultArea.style.display = '';
    resultArea.innerHTML = '<div class="ppt-generating"><div class="spinner"></div><div>正在生成PPT通报，请稍候...</div></div>';
  }

  try {
    const res = await fetch('/api/ppt-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateData: PPT.templateData,
        dataFileData: dataFileData,
        customTexts: {},
        dataMap: PPT.dataMap
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: '生成失败' }));
      throw new Error(err.error || '生成失败');
    }

    // 成功 - 获取blob用于下载
    const blob = await res.blob();
    PPT._downloadBlob = blob;
    PPT._downloadUrl = URL.createObjectURL(blob);

    // 获取生成信息从响应头
    const info = {};
    res.headers.forEach((v, k) => { info[k] = v; });

    if (resultArea) {
      resultArea.innerHTML = `
        <div class="ppt-result ppt-result-success">
          <div class="ppt-result-icon"><svg class="icon icon-xl" aria-hidden="true"><use xlink:href="#icon-download"/></svg></div>
          <div class="ppt-result-title" style="color:var(--ok)">PPT通报生成成功</div>
          <div class="ppt-result-desc">文件已就绪，点击下方按钮下载</div>
          <div style="margin-top:18px">
            <button class="btn btn-primary" id="pptDownloadBtn2" onclick="doDownload()" style="padding:10px 36px;">
              <svg class="icon" aria-hidden="true"><use xlink:href="#icon-download"/></svg>
              下载PPT通报
            </button>
          </div>
        </div>`;
    }

    ntf('PPT通报生成成功！');
  } catch (e) {
    if (resultArea) {
      resultArea.style.display = '';
      resultArea.innerHTML = `
        <div class="ppt-result ppt-result-error">
          <div class="ppt-result-icon" style="color:var(--err)">&#10060;</div>
          <div class="ppt-result-title" style="color:var(--err)">生成失败</div>
          <div class="ppt-result-desc">${esc(e.message)}</div>
        </div>`;
    }
    ntf(e.message, 'error');
  } finally {
    PPT.generating = false;
  }
}

// ===== 下载PPT =====
function doDownload() {
  if (!PPT._downloadUrl) {
    ntf('请先生成PPT', 'error');
    return;
  }
  const a = document.createElement('a');
  a.href = PPT._downloadUrl;
  a.download = '商机通报.pptx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  ntf('PPT文件已开始下载');
}

// ===== 模板管理 =====
async function loadPptTemplates() {
  try {
    const res = await fetch('/api/ppt-templates');
    const data = await res.json();
    renderPptTemplates(data.templates || []);
  } catch (e) {
    // ignore
  }
}

function renderPptTemplates(templates) {
  const sel = document.getElementById('pptTemplateSel');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- 选择已保存模板 --</option>';
  templates.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.name;
    opt.textContent = `${t.name} (${new Date(t.savedAt).toLocaleDateString()})`;
    sel.appendChild(opt);
  });
}

async function onTemplateSelect() {
  const sel = document.getElementById('pptTemplateSel');
  const name = sel ? sel.value : '';
  if (!name) return;

  try {
    const res = await fetch(`/api/ppt-templates/${encodeURIComponent(name)}`);
    const data = await res.json();

    if (data.templateData) {
      PPT.templateData = data.templateData;
      PPT.templateName = name;
      updateUploadZone('pptUploadZone', name + '.pptx');
      showDownloadTplBtn();
      ntf('PPT模板已加载');
    }
    if (data.dataFileData) {
      PPT.dataFileData = data.dataFileData;
      PPT.dataFileName = name + '_data.xlsx';
      updateUploadZone('pptDataZone', name + '_data.xlsx');
      ntf('数据文件已加载');
    }
    // 恢复 dataMap
    if (data.dataMap && Object.keys(data.dataMap).length > 0) {
      PPT.dataMap = data.dataMap;
      ntf('数据映射已恢复');
    } else {
      PPT.dataMap = null;
    }
  } catch (e) {
    ntf('加载模板失败', 'error');
  }
}

function showSaveModal() {
  if (!PPT.templateData) {
    ntf('请先上传PPT模板', 'error');
    return;
  }
  document.getElementById('pptModalInput').value = '';
  document.getElementById('pptModalMask').classList.add('show');
  document.getElementById('pptModalBox').classList.add('show');
  setTimeout(() => document.getElementById('pptModalInput').focus(), 50);
}

function hideSaveModal() {
  document.getElementById('pptModalMask').classList.remove('show');
  document.getElementById('pptModalBox').classList.remove('show');
}

async function doSaveTemplate() {
  const name = (document.getElementById('pptModalInput').value || '').trim();
  if (!name) {
    ntf('请输入模板名称', 'error');
    return;
  }
  try {
    const res = await fetch('/api/ppt-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        templateData: PPT.templateData,
        dataFileData: PPT.dataFileData,
        dataMap: PPT.dataMap
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '保存失败');
    ntf('模板已保存');
    hideSaveModal();
    loadPptTemplates();
  } catch (e) {
    ntf(e.message, 'error');
  }
}

async function doDeleteTemplate() {
  const sel = document.getElementById('pptTemplateSel');
  const name = sel ? sel.value : '';
  if (!name) {
    ntf('请先选择一个模板', 'error');
    return;
  }
  try {
    const res = await fetch(`/api/ppt-templates/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('删除失败');
    ntf('模板已删除');
    loadPptTemplates();
  } catch (e) {
    ntf(e.message, 'error');
  }
}

// ===== 标准化输出检查 =====
async function checkNzOutput() {
  try {
    const res = await fetch('/api/ppt-nz-output');
    const data = await res.json();
    PPT.nzAvailable = data.available;
    PPT.nzInfo = data;
    renderNzImport(data);
  } catch (e) {
    PPT.nzAvailable = false;
  }
}

function renderNzImport(info) {
  const el = document.getElementById('pptNzInfo');
  if (!el) return;
  if (info && info.available) {
    el.innerHTML = `
      <div class="ppt-nz-icon"><svg class="icon" aria-hidden="true"><use xlink:href="#icon-file-excel"/></svg></div>
      <div class="ppt-nz-info">
        <div class="ppt-nz-title">标准化填充输出</div>
        <div class="ppt-nz-time">生成时间：${info.time || '未知'}</div>
      </div>`;
  } else {
    el.innerHTML = `<div class="ppt-nz-empty">暂无标准化输出数据，请先在"数据标准化"步骤执行填充操作</div>`;
  }
}

// ===== 下载PPT模板 =====
function showDownloadTplBtn() {
  const btn = document.getElementById('pptDownloadTplBtn');
  if (btn) btn.style.display = '';
}

function doDownloadTemplate() {
  if (!PPT.templateData) {
    ntf('没有可下载的PPT模板', 'error');
    return;
  }
  const binaryStr = atob(PPT.templateData);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = PPT.templateName || 'PPT模板.pptx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  ntf('PPT模板已开始下载');
}

// ===== 校准数据预览 =====
async function doPreviewData() {
  const area = document.getElementById('pptPreviewArea');
  if (!area) return;

  area.style.display = '';
  area.innerHTML = '<div style="padding:20px;text-align:center;color:var(--t3)"><div class="spinner" style="margin:0 auto 10px"></div>正在读取数据...</div>';

  try {
    const res = await fetch('/api/ppt-data-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataFileData: PPT.dataFileData, dataMap: PPT.dataMap })
    });
    const data = await res.json();

    if (data.error) {
      area.innerHTML = `<div style="padding:20px;color:var(--err)">${esc(data.error)}</div>`;
      return;
    }

    // 构建预览表格
    let html = '<div class="ppt-preview-panel">';
    html += '<div class="ppt-preview-topbar"><span class="ppt-preview-topbar-title">数据校准预览</span><button class="ppt-preview-close" onclick="document.getElementById(\'pptPreviewArea\').style.display=\'none\'">收起</button></div>';

    // ===== 数据映射编辑区 =====
    html += '<div class="ppt-dm-section">';
    html += '<div class="ppt-dm-header"><h3>数据区域映射</h3><span class="ppt-dm-hint">修改范围后点击"应用"更新预览</span></div>';
    html += '<div class="ppt-dm-grid">';

    const dmFields = [
      { key: 'date_cell', label: '截止日期', desc: '如 B30', type: 'cell' },
      { key: 'period_cell', label: '周期', desc: '如 B31', type: 'cell' },
      { key: 'B27_cell', label: '行业储备说明', desc: '如 B27', type: 'cell' },
      { key: 'B28_cell', label: '商业储备说明', desc: '如 B28', type: 'cell' },
      { key: 'industry_reserve', label: '行业储备', desc: '如 A2:G12', type: 'range' },
      { key: 'commercial_reserve', label: '商业储备', desc: '如 A13:G25', type: 'range' },
      { key: 'industry_effective', label: '行业有效商机', desc: '如 J2:M13', type: 'range' },
      { key: 'commercial_effective', label: '商业有效商机', desc: '如 J14:M25', type: 'range' },
      { key: 'industry_progress', label: '行业项目推进', desc: '如 V5:AF15', type: 'range' },
      { key: 'commercial_progress', label: '商业项目推进', desc: '如 V16:AF28', type: 'range' },
      { key: 'industry_delivered', label: '行业交付', desc: '如 AH2:AK12', type: 'range' },
      { key: 'commercial_delivered', label: '商业交付', desc: '如 AH13:AK25', type: 'range' },
    ];

    const defaultMap = {
      date_cell: 'B30', period_cell: 'B31', B27_cell: 'B27', B28_cell: 'B28',
      industry_reserve: 'A2:G12', commercial_reserve: 'A13:G25',
      industry_effective: 'J2:M13', commercial_effective: 'J14:M25',
      industry_progress: 'V5:AF15', commercial_progress: 'V16:AF28',
      industry_delivered: 'AH2:AK12', commercial_delivered: 'AH13:AK25',
    };

    dmFields.forEach(f => {
      const currentVal = PPT.dataMap ? (PPT.dataMap[f.key] || defaultMap[f.key]) : defaultMap[f.key];
      const isChanged = PPT.dataMap && PPT.dataMap[f.key] && PPT.dataMap[f.key] !== defaultMap[f.key];
      html += `<div class="ppt-dm-row">`;
      html += `<label class="ppt-dm-label">${f.label}</label>`;
      html += `<input class="ppt-dm-input${isChanged ? ' ppt-dm-changed' : ''}" data-dm-key="${f.key}" value="${currentVal}" placeholder="${f.desc}">`;
      html += `<span class="ppt-dm-default">默认: ${defaultMap[f.key]}</span>`;
      html += `</div>`;
    });

    html += '</div>'; // ppt-dm-grid
    html += '<div class="ppt-dm-actions">';
    html += '<button class="btn btn-primary btn-sm" onclick="applyDataMap()">应用并刷新预览</button>';
    html += '<button class="btn btn-ghost btn-sm" onclick="resetDataMap()">恢复默认</button>';
    html += '</div>';
    html += '</div>'; // ppt-dm-section

    // ===== 关键单元格 =====
    html += '<div class="ppt-dm-section">';
    html += '<h3>关键单元格</h3>';
    html += '<table class="ppt-preview-table"><thead><tr>';
    html += '<th>单元格</th><th>内容</th><th>说明</th>';
    html += '</tr></thead><tbody>';
    const cells = [
      ['B30', data.date, '截止日期'],
      ['B31', data.period, '周期'],
      ['B27', data.B27, '行业储备说明(前100字)'],
      ['B28', data.B28, '商业储备说明(前100字)'],
      ['J27', data.J27, '行业交付说明1'],
      ['J28', data.J28, '商业交付说明1'],
      ['AI27', data.AI27, '行业交付说明2'],
      ['AI28', data.AI28, '商业交付说明2'],
    ];
    cells.forEach(([cell, val, desc]) => {
      const empty = !val || val === 'None' || val === '';
      html += `<tr><td class="ppt-cell-ref">${cell}</td>`;
      html += `<td class="ppt-cell-val${empty ? ' ppt-cell-empty' : ''}">${esc(val || '(空)')}</td>`;
      html += `<td class="ppt-cell-desc">${desc}</td></tr>`;
    });
    html += '</tbody></table>';
    html += '</div>';

    // ===== 数据区域 =====
    const ranges = data.ranges || {};

    // 行业有效商机 - 完整数据（用于图表校准）
    const indEff = ranges.industry_effective || {};
    const commEff = ranges.commercial_effective || {};

    html += '<div class="ppt-dm-section ppt-eff-section">';
    html += '<h3>有效商机完整数据 <span class="ppt-dm-hint">(用于图表，检查分局名称和数值是否正确)</span></h3>';

    // 行业
    html += '<div class="ppt-eff-block">';
    html += `<div class="ppt-eff-title">行业有效商机 — 实际${indEff.rows || 0}行</div>`;
    if (indEff.full && indEff.full.length > 0) {
      html += '<div class="ppt-table-scroll"><table class="ppt-preview-table ppt-full-table"><thead><tr>';
      indEff.full[0].forEach((_, ci) => {
        const colLabels = ['分局名称', '有效商机', '储备目标', '完成率'];
        html += `<th>${colLabels[ci] || '列' + ci}</th>`;
      });
      html += '</tr></thead><tbody>';
      indEff.full.forEach((row, ri) => {
        html += '<tr>';
        row.forEach((cell, ci) => {
          const cls = ci === 0 ? 'ppt-cell-name' : 'ppt-cell-num';
          html += `<td class="${cls}">${esc(cell)}</td>`;
        });
        html += '</tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += '<div class="ppt-no-data">无数据</div>';
    }
    html += '</div>';

    // 商业
    html += '<div class="ppt-eff-block">';
    html += `<div class="ppt-eff-title">商业有效商机 — 实际${commEff.rows || 0}行</div>`;
    if (commEff.full && commEff.full.length > 0) {
      html += '<div class="ppt-table-scroll"><table class="ppt-preview-table ppt-full-table"><thead><tr>';
      commEff.full[0].forEach((_, ci) => {
        const colLabels = ['分局名称', '有效商机', '储备目标', '完成率'];
        html += `<th>${colLabels[ci] || '列' + ci}</th>`;
      });
      html += '</tr></thead><tbody>';
      commEff.full.forEach((row, ri) => {
        html += '<tr>';
        row.forEach((cell, ci) => {
          const cls = ci === 0 ? 'ppt-cell-name' : 'ppt-cell-num';
          html += `<td class="${cls}">${esc(cell)}</td>`;
        });
        html += '</tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += '<div class="ppt-no-data">无数据</div>';
    }
    html += '</div>';
    html += '</div>'; // ppt-eff-section

    // 其他数据区域（样本预览）
    html += '<div class="ppt-dm-section">';
    html += '<h3>其他数据区域 <span class="ppt-dm-hint">(前3行样本)</span></h3>';
    const otherRanges = [
      ['industry_reserve', '行业储备'],
      ['commercial_reserve', '商业储备'],
      ['industry_progress', '行业项目推进'],
      ['commercial_progress', '商业项目推进'],
      ['industry_delivered', '行业交付'],
      ['commercial_delivered', '商业交付'],
    ];
    otherRanges.forEach(([key, title]) => {
      const r = ranges[key] || {};
      const rows = r.rows || 0;
      const sample = r.sample || [];
      const ok = rows > 0;
      html += `<div class="ppt-range-block">`;
      html += `<div class="ppt-range-title" style="color:${ok ? 'var(--ok)' : 'var(--err)'}">${title} — 实际${rows}行</div>`;
      if (sample.length > 0) {
        html += '<div class="ppt-table-scroll"><table class="ppt-preview-table"><thead><tr>';
        sample[0].forEach((_, ci) => {
          html += `<th>列${ci}</th>`;
        });
        html += '</tr></thead><tbody>';
        sample.forEach(row => {
          html += '<tr>';
          row.forEach(cell => {
            html += `<td>${esc(cell)}</td>`;
          });
          html += '</tr>';
        });
        html += '</tbody></table></div>';
      } else {
        html += '<div class="ppt-no-data">无数据</div>';
      }
      html += '</div>';
    });
    html += '</div>';

    html += '</div>'; // ppt-preview-panel
    area.innerHTML = html;
    ntf('数据预览已加载');
  } catch (e) {
    area.innerHTML = `<div style="padding:20px;color:var(--err)">预览失败: ${esc(e.message)}</div>`;
  }
}

// ===== dataMap 编辑 =====
function applyDataMap() {
  const inputs = document.querySelectorAll('.ppt-dm-input[data-dm-key]');
  const newMap = {};
  const defaultMap = {
    date_cell: 'B30', period_cell: 'B31', B27_cell: 'B27', B28_cell: 'B28',
    industry_reserve: 'A2:G12', commercial_reserve: 'A13:G25',
    industry_effective: 'J2:M13', commercial_effective: 'J14:M25',
    industry_progress: 'V5:AF15', commercial_progress: 'V16:AF28',
    industry_delivered: 'AH2:AK12', commercial_delivered: 'AH13:AK25',
  };
  let hasChange = false;
  inputs.forEach(inp => {
    const key = inp.dataset.dmKey;
    const val = inp.value.trim();
    if (val && val !== defaultMap[key]) {
      newMap[key] = val;
      hasChange = true;
    }
  });
  PPT.dataMap = hasChange ? newMap : null;
  doPreviewData(); // 刷新预览
}

function resetDataMap() {
  PPT.dataMap = null;
  doPreviewData();
}

// ===== 进入步骤时初始化 =====
function initPptStep() {
  loadPptTemplates();
  checkNzOutput();
}
