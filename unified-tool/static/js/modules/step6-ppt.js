// ========== step6-ppt.js — 步骤6：PPT通报生成 ==========

const PPT = {
  templateData: '',       // base64 PPT模板
  templateName: '',       // 模板文件名
  dataFileData: '',       // base64 数据Excel
  dataFileName: '',       // 数据文件名
  generating: false,
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
    dataZone.addEventListener('dragleave', () => { dataZone.classList.remove('drag-over'); });
    dataZone.addEventListener('drop', e => { e.preventDefault(); dataZone.classList.remove('drag-over'); if (e.dataTransfer.files.length) handleDataFile(e.dataTransfer.files[0]); });
    dataInput.addEventListener('change', () => { if (dataInput.files.length) handleDataFile(dataInput.files[0]); });
  }

  // 生成按钮
  const genBtn = document.getElementById('pptGenerateBtn');
  if (genBtn) genBtn.addEventListener('click', doGenerate);

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

  if (!PPT.dataFileData) {
    ntf('请先上传数据Excel文件', 'error');
    return;
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
        dataFileData: PPT.dataFileData,
        customTexts: {}
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
        dataFileData: PPT.dataFileData
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

// ===== 进入步骤时初始化 =====
function initPptStep() {
  loadPptTemplates();
}
