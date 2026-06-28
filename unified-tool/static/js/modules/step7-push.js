// ========== step7-push.js — 步骤7：在线推送 ==========
const KD = {
  sheets: [],
  cats: [],
  editingId: null,
  activeCat: '',  // 空串=全部
  _selectedFilePath: '',  // 编辑对话框中选中的本地文件路径
};

// 遮掩Token：只显示开头2个+结尾2个字符
function maskSecret(val) {
  if (!val || val.length <= 4) return val || '';
  return val.substring(0, 2) + '****' + val.substring(val.length - 2);
}

// ===== 主题化确认模态框 =====
const kdModal = {
  _onOk: null,
  show({ title = '确认', content = '', okText = '确定' }) {
    document.getElementById('kdModalTitle').textContent = title;
    const hintEl = document.getElementById('kdModalHint');
    hintEl.textContent = content;
    hintEl.classList.add('warn');
    document.getElementById('kdModalOk').textContent = okText;
    document.getElementById('kdModalMask').classList.add('show');
    document.getElementById('kdModalBox').classList.add('show');
    setTimeout(() => document.getElementById('kdModalOk').focus(), 50);
    return new Promise(resolve => { this._onOk = resolve; });
  },
  hide() {
    document.getElementById('kdModalMask').classList.remove('show');
    document.getElementById('kdModalBox').classList.remove('show');
    this._onOk = null;
  }
};

// 确认模态框事件绑定
document.getElementById('kdModalClose').addEventListener('click', () => { if (kdModal._onOk) kdModal._onOk(false); kdModal.hide(); });
document.getElementById('kdModalCancel').addEventListener('click', () => { if (kdModal._onOk) kdModal._onOk(false); kdModal.hide(); });
document.getElementById('kdModalMask').addEventListener('click', () => { if (kdModal._onOk) kdModal._onOk(false); kdModal.hide(); });
document.getElementById('kdModalOk').addEventListener('click', () => { if (kdModal._onOk) kdModal._onOk(true); kdModal.hide(); });

// ===== 模态框快捷方法：显示/隐藏 =====
function kdShowModal(maskId, boxId) {
  document.getElementById(maskId).classList.add('show');
  document.getElementById(boxId).classList.add('show');
}
function kdHideModal(maskId, boxId) {
  document.getElementById(maskId).classList.remove('show');
  document.getElementById(boxId).classList.remove('show');
}

// ===== 数据加载 =====
async function loadKdocsSheets() {
  try {
    const catParam = KD.activeCat ? `?category=${encodeURIComponent(KD.activeCat)}` : '';
    const res = await fetch('/api/kdocs-sheets' + catParam);
    KD.sheets = await res.json();
    renderKdocsList();
  } catch (e) {
    ntf('加载在线表格列表失败', 'error');
  }
}

async function loadKdocsCats() {
  try {
    const res = await fetch('/api/kdocs-categories');
    KD.cats = await res.json();
    renderKdocsCatBar();
  } catch (e) { /* ignore */ }
}

// ===== 分类标签栏 =====
function renderKdocsCatBar() {
  const bar = document.getElementById('kdCatBar');
  if (!bar) return;
  const allCount = KD.sheets.length;
  let html = `<span class="kd-cat-tag ${KD.activeCat === '' ? 'on' : ''}" data-cat="">全部</span>`;
  KD.cats.forEach(c => {
    html += `<span class="kd-cat-tag ${KD.activeCat === c.id ? 'on' : ''}" data-cat="${c.id}" style="${c.color && KD.activeCat === c.id ? `border-color:${c.color};color:${c.color}` : ''}">
      <span class="kd-cat-dot" style="background:${c.color || '#0d9488'}"></span>${esc(c.name)}<span class="kd-cat-count">${c.count || 0}</span>
    </span>`;
  });
  bar.innerHTML = html;
  bar.querySelectorAll('.kd-cat-tag').forEach(t => t.addEventListener('click', async () => {
    KD.activeCat = t.dataset.cat;
    await loadKdocsSheets();
    renderKdocsCatBar();
  }));
}

// ===== 分类管理对话框 =====
document.getElementById('kdCatBtn').addEventListener('click', () => {
  renderCatMgrList();
  kdShowModal('kdCatMask', 'kdCatBox');
});

document.getElementById('kdCatModalClose').addEventListener('click', () => kdHideModal('kdCatMask', 'kdCatBox'));
document.getElementById('kdCatCloseBtn').addEventListener('click', () => kdHideModal('kdCatMask', 'kdCatBox'));
document.getElementById('kdCatMask').addEventListener('click', () => kdHideModal('kdCatMask', 'kdCatBox'));

function renderCatMgrList() {
  const listEl = document.getElementById('kdCatMgrList');
  let listHtml = '';
  KD.cats.forEach(c => {
    listHtml += `<div class="kd-cat-mgr-item">
      <span class="kd-cat-dot" style="background:${c.color || '#0d9488'}"></span>
      <span class="kd-cat-mgr-name">${esc(c.name)}</span>
      <span class="kd-cat-mgr-count">${c.count || 0}个</span>
      ${c.id !== 'default' ? `<button class="btn btn-danger btn-xs kd-cat-del" data-cid="${c.id}">删除</button>` : ''}
    </div>`;
  });
  listEl.innerHTML = listHtml;
  listEl.querySelectorAll('.kd-cat-del').forEach(b => b.addEventListener('click', async () => {
    await fetch(`/api/kdocs-categories/${b.dataset.cid}`, { method: 'DELETE' });
    await loadKdocsCats();
    await loadKdocsSheets();
    renderCatMgrList();
    ntf('分类已删除');
  }));
}

document.getElementById('kdCatAddBtn').addEventListener('click', async () => {
  const name = document.getElementById('kdCatAddName').value.trim();
  const color = document.getElementById('kdCatAddColor').value;
  if (!name) { ntf('请输入分类名', 'error'); return; }
  const res = await fetch('/api/kdocs-categories', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ name, color }) });
  const data = await res.json();
  if (data.error) { ntf(data.error, 'error'); return; }
  document.getElementById('kdCatAddName').value = '';
  await loadKdocsCats();
  renderCatMgrList();
  ntf('分类已添加');
});

// ===== 渲染在线表格列表（按分类分组） =====
function renderKdocsList() {
  const div = document.getElementById('kdSheetList');
  if (!KD.sheets.length) {
    div.innerHTML = '<div class="kd-empty"><div class="kd-empty-icon"><svg class="icon icon-xl" aria-hidden="true"><use xlink:href="#icon-cloud-upload"/></svg></div><div class="kd-empty-text">暂无在线表格配置</div><div class="kd-empty-hint">点击"添加在线表格"开始配置</div></div>';
    return;
  }

  // 如果在"全部"视图下，按分类分组
  let html = '';
  if (!KD.activeCat) {
    const grouped = {};
    KD.cats.forEach(c => { grouped[c.id] = { name: c.name, color: c.color || '#0d9488', items: [] }; });
    // 未分类的归入默认
    if (!grouped['default']) grouped['default'] = { name: '默认', color: '#0d9488', items: [] };
    KD.sheets.forEach(s => {
      const catId = s.category || 'default';
      if (!grouped[catId]) grouped[catId] = { name: catId, color: '#0d9488', items: [] };
      grouped[catId].items.push(s);
    });
    for (const [catId, group] of Object.entries(grouped)) {
      if (!group.items.length) continue;
      html += `<div class="kd-group" data-catid="${catId}">
        <div class="kd-group-header" data-catid="${catId}"><span class="kd-collapse-arrow">&#9660;</span><span class="kd-cat-dot" style="background:${group.color}"></span><span class="kd-group-name">${esc(group.name)}</span><span class="kd-group-count">${group.items.length}个</span></div>
        <div class="kd-group-body">`;
      group.items.forEach(s => { html += renderKdocsCard(s); });
      html += '</div></div>';
    }
  } else {
    KD.sheets.forEach(s => { html += renderKdocsCard(s); });
  }
  div.innerHTML = html;

  // 绑定分类折叠事件
  div.querySelectorAll('.kd-group-header').forEach(h => {
    h.addEventListener('click', () => {
      const group = h.parentElement;
      const body = group.querySelector('.kd-group-body');
      const arrow = h.querySelector('.kd-collapse-arrow');
      const collapsed = group.classList.toggle('kd-collapsed');
      if (collapsed) {
        body.style.maxHeight = '0';
        body.style.overflow = 'hidden';
        arrow.innerHTML = '&#9654;';
      } else {
        body.style.maxHeight = '';
        body.style.overflow = '';
        arrow.innerHTML = '&#9660;';
      }
    });
  });

  // 绑定卡片事件
  div.querySelectorAll('.kd-open-btn').forEach(b => b.addEventListener('click', () => {
    const s = KD.sheets.find(x => x.id === b.dataset.sid);
    if (s && s.url) window.open(s.url, '_blank');
  }));
  div.querySelectorAll('.kd-edit-btn').forEach(b => b.addEventListener('click', () => showKdocsEditDialog(b.dataset.sid)));
  div.querySelectorAll('.kd-del-btn').forEach(b => b.addEventListener('click', async () => {
    const ok = await kdModal.show({ title: '删除确认', content: '确定删除该在线表格配置？此操作不可恢复。', okText: '删除' });
    if (!ok) return;
    await fetch(`/api/kdocs-sheets/${b.dataset.sid}`, { method: 'DELETE' });
    ntf('已删除');
    loadKdocsSheets();
    loadKdocsCats();
  }));
  div.querySelectorAll('.kd-push-btn').forEach(b => b.addEventListener('click', () => pushKdocsSingle(b.dataset.sid)));
}

function renderKdocsCard(s) {
  const hasToken = !!s.api_token;
  const hasWebhook = !!s.webhook_url;
  const hasExcel = !!s.excel_path;
  return `<div class="kd-card" data-sid="${s.id}">
    <div class="kd-card-header">
      <div class="kd-card-info">
        <span class="kd-card-name">${esc(s.name)}</span>
        <span class="kd-card-badges">
          ${hasToken ? '<span class="kd-badge kd-badge-ok">Token</span>' : '<span class="kd-badge kd-badge-no">无Token</span>'}
          ${hasWebhook ? '<span class="kd-badge kd-badge-ok">Webhook</span>' : '<span class="kd-badge kd-badge-no">无Webhook</span>'}
          ${hasExcel ? '<span class="kd-badge kd-badge-ok">本地</span>' : ''}
        </span>
      </div>
      <div class="kd-card-actions">
        <button class="btn btn-ghost btn-xs kd-open-btn" data-sid="${s.id}" title="新标签页打开">&#8599;</button>
        <button class="btn btn-ghost btn-xs kd-edit-btn" data-sid="${s.id}" title="编辑">&#9998;</button>
        <button class="btn btn-danger btn-xs kd-del-btn" data-sid="${s.id}" title="删除">&#10005;</button>
      </div>
    </div>
    <div class="kd-card-body">
      <div class="kd-field"><span class="kd-fld-label">URL</span><span class="kd-fld-val kd-url-val" title="${esc(s.url)}">${esc(s.url)}</span></div>
      ${hasToken ? `<div class="kd-field"><span class="kd-fld-label">Token</span><span class="kd-fld-val kd-secret">${esc(maskSecret(s.api_token))}</span></div>` : ''}
      ${hasWebhook ? `<div class="kd-field"><span class="kd-fld-label">Webhook</span><span class="kd-fld-val kd-secret">${esc(maskSecret(s.webhook_url))}</span></div>` : ''}
      ${hasExcel ? `<div class="kd-field"><span class="kd-fld-label">本地文件</span><span class="kd-fld-val">${esc(s.excel_path)}</span></div>` : ''}
      ${s.updated_at ? `<div class="kd-field"><span class="kd-fld-label">更新</span><span class="kd-fld-val kd-fld-time">${esc(s.updated_at)}</span></div>` : ''}
    </div>
    <div class="kd-card-footer">
      <button class="btn btn-primary btn-xs kd-push-btn" data-sid="${s.id}" ${(!hasToken || !hasWebhook) ? 'disabled title="请先配置Token和Webhook"' : ''}>推送数据</button>
      <span class="kd-card-status" id="kdStatus_${s.id}"></span>
    </div>
  </div>`;
}

// ===== 文件浏览器对话框（使用HTML预置模态框） =====
let _kbTargetCallback = null; // 选择文件后的回调
let _kbSelectedPath = '';
let _kbCurrentIsDrives = false;
let _kbCurrentParent = '';

function showFileBrowser(callback) {
  _kbTargetCallback = callback;
  _kbSelectedPath = '';
  _kbCurrentIsDrives = false;
  _kbCurrentParent = '';
  kdShowModal('kdBrowseMask', 'kdBrowseBox');
  kbBrowse('__drives__');
}

async function kbBrowse(path) {
  document.getElementById('kbPath').value = (path === '__drives__') ? '' : path;
  _kbSelectedPath = (path === '__drives__') ? '' : path;
  _kbCurrentIsDrives = (path === '__drives__');
  try {
    const res = await fetch('/api/kdocs-browse', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ path }) });
    const data = await res.json();
    if (data.error) { document.getElementById('kbList').innerHTML = `<div class="kd-batch-hint kd-batch-err">${data.error}</div>`; return; }

    _kbCurrentParent = data.parent || '';

    const titleEl = document.getElementById('kbTitle');
    if (data.is_drives) {
      titleEl.textContent = '此电脑';
      _kbCurrentIsDrives = true;
    } else {
      titleEl.textContent = '浏览本地文件';
      _kbCurrentIsDrives = false;
    }

    let html = '';
    if (data.parent) {
      const parentLabel = data.parent === '__drives__' ? '.. (此电脑)' : '.. (上级目录)';
      html += `<div class="kb-item kb-dir" data-path="${esc(data.parent)}"><span class="kb-icon"><svg class="icon" aria-hidden="true"><use xlink:href="#icon-folder"/></svg></span><span class="kb-name">${parentLabel}</span></div>`;
    }
    data.dirs.forEach(d => {
      const icon = d.is_drive ? '<svg class="icon" aria-hidden="true"><use xlink:href="#icon-save"/></svg>' : '<svg class="icon" aria-hidden="true"><use xlink:href="#icon-folder"/></svg>';
      const cls = d.is_drive ? 'kb-item kb-dir kb-drive' : 'kb-item kb-dir';
      const label = d.is_drive ? `${d.name} 驱动器` : d.name;
      html += `<div class="${cls}" data-path="${esc(d.path)}"><span class="kb-icon">${icon}</span><span class="kb-name">${esc(label)}</span></div>`;
    });
    if (!data.is_drives) {
      data.files.forEach(f => { html += `<div class="kb-item kb-file" data-path="${esc(f.path)}"><span class="kb-icon"><svg class="icon" aria-hidden="true"><use xlink:href="#icon-file"/></svg></span><span class="kb-name">${esc(f.name)}</span><span class="kb-size">${(f.size / 1024).toFixed(0)}KB</span></div>`; });
    }
    if (!data.dirs.length && !data.files.length) html = '<div class="kd-batch-hint">此目录为空</div>';
    document.getElementById('kbList').innerHTML = html;

    if (data.is_drives) {
      document.getElementById('kbInfo').textContent = `${data.dirs.length} 个驱动器`;
    } else {
      document.getElementById('kbInfo').textContent = `${data.dirs.length} 个文件夹, ${data.files.length} 个Excel`;
    }

    const kbListEl = document.getElementById('kbList');
    kbListEl.querySelectorAll('.kb-dir').forEach(item => {
      item.addEventListener('dblclick', () => kbBrowse(item.dataset.path));
      item.addEventListener('click', () => { _kbSelectedPath = item.dataset.path; kbListEl.querySelectorAll('.kb-item').forEach(i => i.classList.remove('sel')); item.classList.add('sel'); });
    });
    kbListEl.querySelectorAll('.kb-file').forEach(item => {
      item.addEventListener('click', () => { _kbSelectedPath = item.dataset.path; kbListEl.querySelectorAll('.kb-item').forEach(i => i.classList.remove('sel')); item.classList.add('sel'); });
      item.addEventListener('dblclick', () => { if (_kbTargetCallback) _kbTargetCallback(item.dataset.path); kdHideModal('kdBrowseMask', 'kdBrowseBox'); });
    });
  } catch (e) {
    document.getElementById('kbList').innerHTML = `<div class="kd-batch-hint kd-batch-err">浏览失败: ${e.message}</div>`;
  }
}

// 文件浏览器事件绑定
document.getElementById('kbCloseBtn').addEventListener('click', () => kdHideModal('kdBrowseMask', 'kdBrowseBox'));
document.getElementById('kbCancel').addEventListener('click', () => kdHideModal('kdBrowseMask', 'kdBrowseBox'));
document.getElementById('kdBrowseMask').addEventListener('click', () => kdHideModal('kdBrowseMask', 'kdBrowseBox'));
document.getElementById('kbUp').addEventListener('click', () => {
  if (_kbCurrentIsDrives) return;
  if (_kbCurrentParent) { kbBrowse(_kbCurrentParent); return; }
  const p = document.getElementById('kbPath').value;
  if (!p) { kbBrowse('__drives__'); return; }
  const parent = p.replace(/[\\\/][^\\\/]+$/, '');
  if (parent && parent !== p) kbBrowse(parent);
  else kbBrowse('__drives__');
});
document.getElementById('kbGo').addEventListener('click', () => {
  const val = document.getElementById('kbPath').value.trim();
  kbBrowse(val || '__drives__');
});
document.getElementById('kbPath').addEventListener('keydown', e => {
  if (e.key === 'Enter') { const val = document.getElementById('kbPath').value.trim(); kbBrowse(val || '__drives__'); }
});
document.getElementById('kbOk').addEventListener('click', () => {
  if (_kbSelectedPath && _kbTargetCallback) _kbTargetCallback(_kbSelectedPath);
  kdHideModal('kdBrowseMask', 'kdBrowseBox');
});

// ===== 编辑/添加对话框（使用HTML预置模态框） =====
function showKdocsEditDialog(sid) {
  const isEdit = !!sid;
  const s = isEdit ? KD.sheets.find(x => x.id === sid) : {};
  KD.editingId = sid || null;

  document.getElementById('kdEditTitle').textContent = isEdit ? '编辑在线表格' : '添加在线表格';
  document.getElementById('kdEdName').value = s.name || '';
  document.getElementById('kdEdUrl').value = s.url || '';
  document.getElementById('kdEdToken').value = s.api_token || '';
  document.getElementById('kdEdWebhook').value = s.webhook_url || '';
  document.getElementById('kdEdBatch').value = s.batch_size || 3;

  // 分类选项
  let catOpts = '<option value="default">默认</option>';
  KD.cats.forEach(c => { if (c.id !== 'default') catOpts += `<option value="${c.id}">${esc(c.name)}</option>`; });
  document.getElementById('kdEdCat').innerHTML = catOpts;
  if (s.category) document.getElementById('kdEdCat').value = s.category;

  // 本地文件选择区域
  KD._selectedFilePath = s.excel_path || '';
  const fileZone = document.getElementById('kdEdFileZone');
  const fileText = document.getElementById('kdEdFileText');
  if (KD._selectedFilePath) {
    fileZone.classList.add('has-file');
    fileText.textContent = KD._selectedFilePath;
  } else {
    fileZone.classList.remove('has-file');
    fileText.textContent = '点击上传本地Excel文件';
  }

  kdShowModal('kdEditMask', 'kdEditBox');
}

// 编辑对话框关闭
function kdEditClose() {
  kdHideModal('kdEditMask', 'kdEditBox');
}
document.getElementById('kdEditClose').addEventListener('click', kdEditClose);
document.getElementById('kdEditCancelBtn').addEventListener('click', kdEditClose);
document.getElementById('kdEditMask').addEventListener('click', kdEditClose);

// 拖拽区域 - 点击打开本地文件选择（仅允许本地上传，禁止浏览云服务器）
document.getElementById('kdEdFileZone').addEventListener('click', (e) => {
  // 点击上传按钮时不重复触发（按钮自己有独立事件）
  if (e.target.closest('#kdEdUploadBtn')) return;
  document.getElementById('kdEdFileInput').click();
});

// 上传本地文件按钮 - 通过FormData上传到服务器 data/uploads 目录
document.getElementById('kdEdUploadBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('kdEdFileInput').click();
});

document.getElementById('kdEdFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  const fileZone = document.getElementById('kdEdFileZone');
  const fileText = document.getElementById('kdEdFileText');
  fileText.textContent = '上传中...';
  try {
    const res = await fetch('/api/kdocs-upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.error) {
      ntf(data.error, 'error');
      fileText.textContent = '点击上传本地Excel文件';
      fileZone.classList.remove('has-file');
    } else {
      KD._selectedFilePath = data.path;
      fileZone.classList.add('has-file');
      fileText.textContent = data.path;
      ntf('上传成功: ' + data.name, 'success');
    }
  } catch (err) {
    ntf('上传失败: ' + err.message, 'error');
    fileText.textContent = '点击上传本地Excel文件';
    fileZone.classList.remove('has-file');
  }
  // 重置 input，允许再次选择同一文件
  e.target.value = '';
});

// 拖拽区域 - 拖放提示（浏览器安全限制无法获取完整路径，引导使用文件浏览器）
const kdFileZone = document.getElementById('kdEdFileZone');
kdFileZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  kdFileZone.classList.add('dragover');
});
kdFileZone.addEventListener('dragleave', () => {
  kdFileZone.classList.remove('dragover');
});
kdFileZone.addEventListener('drop', (e) => {
  e.preventDefault();
  kdFileZone.classList.remove('dragover');
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  if (!/\.(xlsx|xls)$/i.test(file.name)) { ntf('仅支持 xlsx/xls 格式', 'error'); return; }
  // 复用上传逻辑
  const formData = new FormData();
  formData.append('file', file);
  const fileText = document.getElementById('kdEdFileText');
  fileText.textContent = '上传中...';
  fetch('/api/kdocs-upload', { method: 'POST', body: formData })
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        ntf(data.error, 'error');
        fileText.textContent = '点击上传本地Excel文件';
        document.getElementById('kdEdFileZone').classList.remove('has-file');
      } else {
        KD._selectedFilePath = data.path;
        document.getElementById('kdEdFileZone').classList.add('has-file');
        fileText.textContent = data.path;
        ntf('上传成功: ' + data.name, 'success');
      }
    })
    .catch(err => {
      ntf('上传失败: ' + err.message, 'error');
      fileText.textContent = '点击上传本地Excel文件';
      document.getElementById('kdEdFileZone').classList.remove('has-file');
    });
});

// 保存按钮
document.getElementById('kdEditOkBtn').addEventListener('click', async () => {
  const name = document.getElementById('kdEdName').value.trim();
  const url = document.getElementById('kdEdUrl').value.trim();
  const api_token = document.getElementById('kdEdToken').value.trim();
  const webhook_url = document.getElementById('kdEdWebhook').value.trim();
  const excel_path = KD._selectedFilePath;
  const batch_size = parseInt(document.getElementById('kdEdBatch').value) || 3;
  const category = document.getElementById('kdEdCat').value;
  const isEdit = !!KD.editingId;
  const s = isEdit ? KD.sheets.find(x => x.id === KD.editingId) : {};

  if (!name || !url) { ntf('名称和URL不能为空', 'error'); return; }

  // 编辑时：如果token/webhook为空，保留原值
  const finalToken = api_token || (isEdit ? s.api_token : '');
  const finalWebhook = webhook_url || (isEdit ? s.webhook_url : '');

  const body = { name, url, api_token: finalToken, webhook_url: finalWebhook, excel_path, batch_size, category };

  try {
    if (isEdit) {
      await fetch(`/api/kdocs-sheets/${KD.editingId}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
    } else {
      await fetch('/api/kdocs-sheets', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
    }
    kdEditClose();
    ntf(isEdit ? '已更新' : '已添加');
    loadKdocsSheets();
    loadKdocsCats();
  } catch (e) { ntf('保存失败', 'error'); }
});

// ===== 单个推送 =====
async function pushKdocsSingle(sid) {
  const s = KD.sheets.find(x => x.id === sid);
  if (!s) return;

  const statusEl = document.getElementById(`kdStatus_${sid}`);
  if (statusEl) { statusEl.textContent = '推送中...'; statusEl.className = 'kd-card-status pushing'; }

  try {
    const res = await fetch('/api/kdocs-push', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ id: sid })
    });
    const data = await res.json();
    if (data.error) {
      if (statusEl) { statusEl.textContent = data.error; statusEl.className = 'kd-card-status error'; }
      ntf(data.error, 'error');
    } else {
      if (statusEl) { statusEl.textContent = `成功${data.success_count}行/失败${data.fail_count}行`; statusEl.className = 'kd-card-status ' + (data.fail_count > 0 ? 'partial' : 'ok'); }
      ntf(data.message, data.fail_count > 0 ? 'warn' : 'success');
      try {
        await fetch(`/api/kdocs-sheets/${sid}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ excel_path: '' }) });
        loadKdocsSheets();
      } catch(e) {}
    }
  } catch (e) {
    if (statusEl) { statusEl.textContent = '推送失败'; statusEl.className = 'kd-card-status error'; }
    ntf('推送失败: ' + e.message, 'error');
  }
}

// ===== 一键推送 =====
document.getElementById('kdBatchPushBtn').addEventListener('click', async () => {
  document.getElementById('kdBatchArea').style.display = '';
  document.getElementById('kdBatchResults').style.display = 'none';
  document.getElementById('kdBatchMatches').innerHTML = '';
  await loadKdocsCats();
});
document.getElementById('kdBatchClose').addEventListener('click', () => {
  document.getElementById('kdBatchArea').style.display = 'none';
});

// 一键推送的浏览按钮
document.getElementById('kdBatchBrowseBtn').addEventListener('click', () => {
  showFileBrowser((path) => {
    document.getElementById('kdBatchFolder').value = path;
    renderBatchMatches();
  });
});

// 扫描匹配
document.getElementById('kdBatchScanBtn').addEventListener('click', renderBatchMatches);
document.getElementById('kdBatchFolder').addEventListener('change', renderBatchMatches);

async function renderBatchMatches() {
  const folderPath = document.getElementById('kdBatchFolder').value.trim();
  const matchDiv = document.getElementById('kdBatchMatches');
  if (!folderPath) { matchDiv.innerHTML = '<div class="kd-batch-hint">请输入或浏览文件夹路径</div>'; return; }

  try {
    const res = await fetch('/api/kdocs-folder-scan', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ folder_path: folderPath })
    });
    const data = await res.json();
    if (data.error) { matchDiv.innerHTML = `<div class="kd-batch-hint kd-batch-err">${data.error}</div>`; return; }

    const localFiles = data.files || [];
    if (!localFiles.length) { matchDiv.innerHTML = '<div class="kd-batch-hint">文件夹中无Excel文件</div>'; return; }

    const allRes = await fetch('/api/kdocs-sheets');
    const allSheets = await allRes.json();

    let html = '<div class="kd-match-list">';
    let matchCount = 0;
    allSheets.forEach(s => {
      const onlineName = s.name.replace(/\.xlsx?$/i, '').toLowerCase();
      let matched = null;
      for (const lf of localFiles) {
        const lfBase = lf.name.replace(/\.xlsx?$/i, '').toLowerCase();
        if (onlineName && lfBase && (onlineName.includes(lfBase) || lfBase.includes(onlineName))) {
          matched = lf;
          break;
        }
      }
      if (!matched) return;
      matchCount++;
      const hasConfig = !!s.api_token && !!s.webhook_url;
      html += `<div class="kd-match-item ${hasConfig ? 'kd-match-ready' : 'kd-match-skip'}">
        <div class="kd-match-online">
          <span class="kd-match-dot ${hasConfig ? 'dot-ok' : 'dot-skip'}"></span>
          <span class="kd-match-name">${esc(s.name)}</span>
          ${!hasConfig ? '<span class="kd-match-tag tag-no-config">缺少配置</span>' : ''}
        </div>
        <div class="kd-match-arrow">&#8594;</div>
        <div class="kd-match-local">
          <span class="kd-match-file">${esc(matched.name)}</span>
        </div>
      </div>`;
    });
    html += '</div>';
    if (!matchCount) html = '<div class="kd-batch-hint">未找到匹配的在线表格</div>';
    matchDiv.innerHTML = html;
  } catch (e) {
    matchDiv.innerHTML = `<div class="kd-batch-hint kd-batch-err">扫描失败: ${e.message}</div>`;
  }
}

document.getElementById('kdBatchGoBtn').addEventListener('click', async () => {
  const folderPath = document.getElementById('kdBatchFolder').value.trim();
  if (!folderPath) { ntf('请先选择文件夹', 'error'); return; }

  const resultsDiv = document.getElementById('kdBatchResults');
  resultsDiv.style.display = '';
  resultsDiv.innerHTML = '<div class="kd-batch-hint">正在推送中，请稍候...</div>';

  try {
    const res = await fetch('/api/kdocs-push-batch', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ folder_path: folderPath })
    });
    const data = await res.json();
    if (data.error) { resultsDiv.innerHTML = `<div class="kd-batch-hint kd-batch-err">${data.error}</div>`; return; }

    const results = data.results || [];
    let html = '<div class="kd-batch-result-list">';
    results.forEach(r => {
      const statusCls = r.status === 'ok' ? 'kd-res-ok' : r.status === 'partial' ? 'kd-res-partial' : 'kd-res-skip';
      const icon = r.status === 'ok' ? '&#10003;' : r.status === 'partial' ? '&#9888;' : '&#10007;';
      html += `<div class="kd-batch-result-item ${statusCls}">
        <span class="kd-res-icon">${icon}</span>
        <span class="kd-res-name">${esc(r.name)}</span>
        ${r.file ? `<span class="kd-res-file">${esc(r.file)}</span>` : ''}
        <span class="kd-res-msg">${esc(r.message)}</span>
      </div>`;
    });
    if (!results.length) html += '<div class="kd-batch-hint">没有匹配的表格需要推送</div>';
    html += '</div>';
    resultsDiv.innerHTML = html;
    ntf(`一键推送完成：${results.filter(r => r.status === 'ok').length} 成功`);
  } catch (e) {
    resultsDiv.innerHTML = `<div class="kd-batch-hint kd-batch-err">推送失败: ${e.message}</div>`;
    ntf('推送失败', 'error');
  }
});

// 添加按钮
document.getElementById('kdAddBtn').addEventListener('click', () => showKdocsEditDialog(null));
document.getElementById('kdRefreshBtn').addEventListener('click', () => { loadKdocsSheets(); loadKdocsCats(); });

// ===== 脚本代码查看（使用HTML预置模态框） =====
document.getElementById('kdShowScriptBtn').addEventListener('click', async () => {
  async function loadCode() {
    try {
      const res = await fetch('/api/kdocs-airscript-code');
      const data = await res.json();
      if (data.error) { ntf(data.error, 'error'); return ''; }
      return data.code || '';
    } catch (e) {
      ntf('获取脚本代码失败', 'error'); return '';
    }
  }

  let codeContent = await loadCode();
  if (!codeContent) return;

  const editor = document.getElementById('kdScriptEditor');
  const modifiedBadge = document.getElementById('kdScriptModified');
  editor.value = codeContent;
  modifiedBadge.style.display = 'none';
  editor._lastSavedCode = codeContent;
  editor._originalCode = codeContent;

  kdShowModal('kdScriptMask', 'kdScriptBox');
});

// 脚本编辑器：监听修改
document.getElementById('kdScriptEditor').addEventListener('input', function() {
  const modifiedBadge = document.getElementById('kdScriptModified');
  const changed = this.value !== (this._lastSavedCode || '');
  modifiedBadge.style.display = changed ? '' : 'none';
});

// 脚本编辑器：一键复制（兼容 HTTP 环境下的 clipboard 降级）
async function kdCopyText(text) {
  // 优先使用 Clipboard API（仅在 HTTPS / localhost 等安全上下文可用）
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) { /* 降级到 execCommand */ }
  }
  // 降级方案：临时 textarea + execCommand('copy')
  return new Promise(resolve => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    resolve(ok);
  });
}

document.getElementById('kdScriptCopy').addEventListener('click', async () => {
  const editor = document.getElementById('kdScriptEditor');
  const ok = await kdCopyText(editor.value);
  ntf(ok ? '已复制到剪贴板' : '复制失败，请手动选择复制', ok ? 'success' : 'error');
});

// 脚本编辑器：一键还原
document.getElementById('kdScriptRestore').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/kdocs-airscript-code');
    const data = await res.json();
    if (data.error) { ntf(data.error, 'error'); return; }
    const fresh = data.code || '';
    const editor = document.getElementById('kdScriptEditor');
    editor.value = fresh;
    editor._lastSavedCode = fresh;
    editor._originalCode = fresh;
    document.getElementById('kdScriptModified').style.display = 'none';
    ntf('已还原为原始代码');
  } catch (e) {
    ntf('还原失败', 'error');
  }
});

// 脚本编辑器：保存
document.getElementById('kdScriptSave').addEventListener('click', async () => {
  const editor = document.getElementById('kdScriptEditor');
  try {
    const res = await fetch('/api/kdocs-airscript-code', {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ code: editor.value })
    });
    const data = await res.json();
    if (data.error) { ntf(data.error, 'error'); return; }
    editor._lastSavedCode = editor.value;
    document.getElementById('kdScriptModified').style.display = 'none';
    ntf('脚本代码已保存');
  } catch (e) {
    ntf('保存失败: ' + e.message, 'error');
  }
});

// 脚本编辑器：关闭
document.getElementById('kdScriptCloseBtn').addEventListener('click', () => kdHideModal('kdScriptMask', 'kdScriptBox'));
document.getElementById('kdScriptMask').addEventListener('click', () => kdHideModal('kdScriptMask', 'kdScriptBox'));
