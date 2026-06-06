// ========== step6-push.js — 步骤6：在线推送 ==========
// ========== STEP 5: 在线推送 ==========
const KD = {
  sheets: [],
  cats: [],
  editingId: null,
  activeCat: '',  // 空串=全部
};

// 遮掩Token：只显示开头2个+结尾2个字符
function maskSecret(val) {
  if (!val || val.length <= 4) return val || '';
  return val.substring(0, 2) + '****' + val.substring(val.length - 2);
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
  const overlay = document.createElement('div');
  overlay.className = 'fd-overlay vis';
  const dd = document.createElement('div');
  dd.className = 'fd-dropdown vis';
  dd.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%);width:360px;';

  function renderCatList() {
    let listHtml = '';
    KD.cats.forEach(c => {
      listHtml += `<div class="kd-cat-mgr-item">
        <span class="kd-cat-dot" style="background:${c.color || '#0d9488'}"></span>
        <span class="kd-cat-mgr-name">${esc(c.name)}</span>
        <span class="kd-cat-mgr-count">${c.count || 0}个</span>
        ${c.id !== 'default' ? `<button class="btn btn-danger btn-xs kd-cat-del" data-cid="${c.id}">删除</button>` : ''}
      </div>`;
    });
    return listHtml;
  }

  let html = '<div class="fd-head"><span class="fd-cn">管理分类</span></div>';
  html += '<div style="padding:14px;display:flex;flex-direction:column;gap:10px">';
  html += '<div class="kd-cat-mgr-list" id="kdCatMgrList">' + renderCatList() + '</div>';
  html += '<div class="kd-cat-add-row"><input id="kdCatAddName" placeholder="新分类名称"><input id="kdCatAddColor" type="color" value="#0d9488" style="width:36px;height:30px;padding:2px;border:1px solid var(--bd);border-radius:6px;cursor:pointer"><button class="btn btn-primary btn-xs" id="kdCatAddBtn">添加</button></div>';
  html += '</div>';
  html += '<div class="fd-foot"><span></span><div class="fd-btns"><button class="btn btn-ghost btn-xs" id="kdCatClose">关闭</button></div></div>';
  dd.innerHTML = html;
  document.body.appendChild(overlay);
  document.body.appendChild(dd);

  const close = () => { overlay.remove(); dd.remove(); };
  overlay.addEventListener('click', close);
  dd.querySelector('#kdCatClose').addEventListener('click', close);
  dd.querySelector('#kdCatAddBtn').addEventListener('click', async () => {
    const name = dd.querySelector('#kdCatAddName').value.trim();
    const color = dd.querySelector('#kdCatAddColor').value;
    if (!name) { ntf('请输入分类名', 'error'); return; }
    const res = await fetch('/api/kdocs-categories', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ name, color }) });
    const data = await res.json();
    if (data.error) { ntf(data.error, 'error'); return; }
    dd.querySelector('#kdCatAddName').value = '';
    await loadKdocsCats();
    dd.querySelector('#kdCatMgrList').innerHTML = renderCatList();
    bindCatDel(dd);
    ntf('分类已添加');
  });
  function bindCatDel(container) {
    container.querySelectorAll('.kd-cat-del').forEach(b => b.addEventListener('click', async () => {
      await fetch(`/api/kdocs-categories/${b.dataset.cid}`, { method: 'DELETE' });
      await loadKdocsCats();
      await loadKdocsSheets();
      container.innerHTML = renderCatList();
      bindCatDel(container);
      ntf('分类已删除');
    }));
  }
  bindCatDel(dd);
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
    if (!confirm('确定删除该在线表格配置？')) return;
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

// ===== 文件浏览器对话框 =====
function showFileBrowser(targetInput, selectMode) {
  // selectMode: 'file' 或 'folder'
  const overlay = document.createElement('div');
  overlay.className = 'fd-overlay vis';
  const dd = document.createElement('div');
  dd.className = 'fd-dropdown vis';
  dd.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%);width:560px;max-height:75vh;display:flex;flex-direction:column;';

  dd.innerHTML = `<div class="fd-head"><span class="fd-cn" id="kbTitle">浏览本地文件</span></div>
    <div class="kd-browse-bar">
      <button class="btn btn-ghost btn-xs" id="kbUp">↑ 上级</button>
      <input id="kbPath" placeholder="路径..." style="flex:1;background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:6px 10px;color:var(--t1);font:11px var(--mf);outline:none">
      <button class="btn btn-ghost btn-xs" id="kbGo">前往</button>
    </div>
    <div class="kd-browse-list" id="kbList" style="flex:1;overflow-y:auto;min-height:200px;max-height:400px"></div>
    <div class="fd-foot"><span id="kbInfo"></span><div class="fd-btns">
      <button class="btn btn-ghost btn-xs" id="kbCancel">取消</button>
      <button class="btn btn-primary btn-xs" id="kbOk">选择</button>
    </div></div>`;
  document.body.appendChild(overlay);
  document.body.appendChild(dd);

  let selectedPath = '';
  let currentIsDrives = false; // 当前是否在驱动器列表视图
  let currentParent = ''; // 后端返回的上级路径

  async function browse(path) {
    dd.querySelector('#kbPath').value = (path === '__drives__') ? '' : path;
    selectedPath = (path === '__drives__') ? '' : path;
    currentIsDrives = (path === '__drives__');
    try {
      const res = await fetch('/api/kdocs-browse', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ path }) });
      const data = await res.json();
      if (data.error) { dd.querySelector('#kbList').innerHTML = `<div class="kd-batch-hint kd-batch-err">${data.error}</div>`; return; }

      // 保存后端返回的上级路径
      currentParent = data.parent || '';

      // 更新标题
      const titleEl = dd.querySelector('#kbTitle');
      if (data.is_drives) {
        titleEl.textContent = '此电脑';
        currentIsDrives = true;
      } else {
        titleEl.textContent = '浏览本地文件';
        currentIsDrives = false;
      }

      let html = '';
      // 上级目录按钮
      if (data.parent) {
        const parentLabel = data.parent === '__drives__' ? '.. (此电脑)' : '.. (上级目录)';
        html += `<div class="kb-item kb-dir" data-path="${esc(data.parent)}"><span class="kb-icon"><svg class="icon" aria-hidden="true"><use xlink:href="#icon-folder"/></svg></span><span class="kb-name">${parentLabel}</span></div>`;
      }
      // 目录/驱动器列表
      data.dirs.forEach(d => {
        const icon = d.is_drive ? '<svg class="icon" aria-hidden="true"><use xlink:href="#icon-save"/></svg>' : '<svg class="icon" aria-hidden="true"><use xlink:href="#icon-folder"/></svg>';
        const cls = d.is_drive ? 'kb-item kb-dir kb-drive' : 'kb-item kb-dir';
        const label = d.is_drive ? `${d.name} 驱动器` : d.name;
        html += `<div class="${cls}" data-path="${esc(d.path)}"><span class="kb-icon">${icon}</span><span class="kb-name">${esc(label)}</span></div>`;
      });
      // 文件列表（仅非驱动器视图显示）
      if (!data.is_drives) {
        data.files.forEach(f => { html += `<div class="kb-item kb-file" data-path="${esc(f.path)}"><span class="kb-icon"><svg class="icon" aria-hidden="true"><use xlink:href="#icon-file"/></svg></span><span class="kb-name">${esc(f.name)}</span><span class="kb-size">${(f.size / 1024).toFixed(0)}KB</span></div>`; });
      }
      if (!data.dirs.length && !data.files.length) html = '<div class="kd-batch-hint">此目录为空</div>';
      dd.querySelector('#kbList').innerHTML = html;

      // 信息栏
      if (data.is_drives) {
        dd.querySelector('#kbInfo').textContent = `${data.dirs.length} 个驱动器`;
      } else {
        dd.querySelector('#kbInfo').textContent = `${data.dirs.length} 个文件夹, ${data.files.length} 个Excel`;
      }

      // 绑定双击/点击
      dd.querySelectorAll('.kb-dir').forEach(item => {
        item.addEventListener('dblclick', () => browse(item.dataset.path));
        item.addEventListener('click', () => { selectedPath = item.dataset.path; dd.querySelectorAll('.kb-item').forEach(i => i.classList.remove('sel')); item.classList.add('sel'); });
      });
      dd.querySelectorAll('.kb-file').forEach(item => {
        item.addEventListener('click', () => { selectedPath = item.dataset.path; dd.querySelectorAll('.kb-item').forEach(i => i.classList.remove('sel')); item.classList.add('sel'); });
        item.addEventListener('dblclick', () => { targetInput.value = item.dataset.path; close(); });
      });
    } catch (e) {
      dd.querySelector('#kbList').innerHTML = `<div class="kd-batch-hint kd-batch-err">浏览失败: ${e.message}</div>`;
    }
  }

  // 从驱动器列表开始浏览
  browse('__drives__');

  const close = () => { overlay.remove(); dd.remove(); };
  overlay.addEventListener('click', close);
  dd.querySelector('#kbCancel').addEventListener('click', close);
  dd.querySelector('#kbUp').addEventListener('click', () => {
    if (currentIsDrives) return; // 已经在驱动器列表，无法再上
    // 优先使用后端返回的parent路径，更可靠（处理盘符根目录等情况）
    if (currentParent) {
      browse(currentParent);
      return;
    }
    // 回退：手动路径切割
    const p = dd.querySelector('#kbPath').value;
    if (!p) { browse('__drives__'); return; }
    const parent = p.replace(/[\\\/][^\\\/]+$/, '');
    if (parent && parent !== p) browse(parent);
    else browse('__drives__');
  });
  dd.querySelector('#kbGo').addEventListener('click', () => {
    const val = dd.querySelector('#kbPath').value.trim();
    browse(val || '__drives__');
  });
  dd.querySelector('#kbPath').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const val = dd.querySelector('#kbPath').value.trim();
      browse(val || '__drives__');
    }
  });
  dd.querySelector('#kbOk').addEventListener('click', () => {
    if (selectedPath) { targetInput.value = selectedPath; }
    close();
  });
}

// ===== 添加/编辑对话框 =====
function showKdocsEditDialog(sid) {
  const isEdit = !!sid;
  const s = isEdit ? KD.sheets.find(x => x.id === sid) : {};
  const overlay = document.createElement('div');
  overlay.className = 'fd-overlay vis';
  const dd = document.createElement('div');
  dd.className = 'fd-dropdown vis';
  dd.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%);width:520px;max-height:85vh;overflow-y:auto;';

  // 分类选项
  let catOpts = '<option value="default">默认</option>';
  KD.cats.forEach(c => { if (c.id !== 'default') catOpts += `<option value="${c.id}">${esc(c.name)}</option>`; });

  let html = `<div class="fd-head"><span class="fd-cn">${isEdit ? '编辑' : '添加'}在线表格</span></div>`;
  html += '<div style="padding:16px;display:flex;flex-direction:column;gap:14px">';
  html += `<div class="kd-form-row"><label>名称 *</label><input id="kdEdName" value="${esc(s.name || '')}" placeholder="如：6月商机统计表"></div>`;
  html += `<div class="kd-form-row"><label>URL *</label><input id="kdEdUrl" value="${esc(s.url || '')}" placeholder="https://www.kdocs.cn/l/xxxx"></div>`;
  html += '<div class="kd-form-row kd-form-2col">';
  html += `<div class="kd-form-col"><label>API Token</label><input id="kdEdToken" type="password" value="${esc(s.api_token || '')}" placeholder="AirScript脚本令牌"></div>`;
  html += `<div class="kd-form-col"><label>Webhook URL</label><input id="kdEdWebhook" type="password" value="${esc(s.webhook_url || '')}" placeholder="Webhook链接"></div>`;
  html += '</div>';

  // 本地路径：浏览选择
  html += `<div class="kd-form-row"><label>本地Excel路径</label><div class="kd-path-row">`;
  html += `<input id="kdEdPath" value="${esc(s.excel_path || '')}" placeholder="点击浏览选择本地Excel文件...">`;
  html += '<button class="btn btn-outline btn-xs" id="kdEdBrowseBtn">浏览</button>';
  html += '</div></div>';

  html += '<div class="kd-form-row kd-form-2col">';
  html += `<div class="kd-form-col"><label>分类</label><select id="kdEdCat" style="width:100%;background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:8px 10px;color:var(--t1);font:12px var(--sf);outline:none">${catOpts}</select></div>`;
  html += `<div class="kd-form-col"><label>批次大小</label><input id="kdEdBatch" type="number" value="${s.batch_size || 3}" min="1" max="20" style="width:100%"></div>`;
  html += '</div>';
  html += '</div>';
  html += '<div class="fd-foot"><span></span><div class="fd-btns"><button class="btn btn-ghost btn-xs" id="kdEdCancel">取消</button><button class="btn btn-primary btn-xs" id="kdEdOk">保存</button></div></div>';

  dd.innerHTML = html;
  document.body.appendChild(overlay);
  document.body.appendChild(dd);

  // 设置当前分类
  if (s.category) dd.querySelector('#kdEdCat').value = s.category;

  // 浏览按钮
  dd.querySelector('#kdEdBrowseBtn').addEventListener('click', () => {
    showFileBrowser(dd.querySelector('#kdEdPath'), 'file');
  });

  const close = () => { overlay.remove(); dd.remove(); };
  overlay.addEventListener('click', close);
  dd.querySelector('#kdEdCancel').addEventListener('click', close);

  dd.querySelector('#kdEdOk').addEventListener('click', async () => {
    const name = dd.querySelector('#kdEdName').value.trim();
    const url = dd.querySelector('#kdEdUrl').value.trim();
    const api_token = dd.querySelector('#kdEdToken').value.trim();
    const webhook_url = dd.querySelector('#kdEdWebhook').value.trim();
    const excel_path = dd.querySelector('#kdEdPath').value.trim();
    const batch_size = parseInt(dd.querySelector('#kdEdBatch').value) || 3;
    const category = dd.querySelector('#kdEdCat').value;

    if (!name || !url) { ntf('名称和URL不能为空', 'error'); return; }

    // 编辑时：如果token/webhook为空，保留原值
    const finalToken = api_token || (isEdit ? s.api_token : '');
    const finalWebhook = webhook_url || (isEdit ? s.webhook_url : '');

    const body = { name, url, api_token: finalToken, webhook_url: finalWebhook, excel_path, batch_size, category };

    try {
      if (isEdit) {
        await fetch(`/api/kdocs-sheets/${sid}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
      } else {
        await fetch('/api/kdocs-sheets', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
      }
      close();
      ntf(isEdit ? '已更新' : '已添加');
      loadKdocsSheets();
      loadKdocsCats();
    } catch (e) { ntf('保存失败', 'error'); }
  });
}

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
      // 推送成功后清除本地Excel路径
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
  await loadKdocsCats();  // 确保分类数据最新
});
document.getElementById('kdBatchClose').addEventListener('click', () => {
  document.getElementById('kdBatchArea').style.display = 'none';
});

// 一键推送的浏览按钮
document.getElementById('kdBatchBrowseBtn').addEventListener('click', () => {
  showFileBrowser(document.getElementById('kdBatchFolder'), 'folder');
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

    // 获取所有在线表格（不分分类）
    const allRes = await fetch('/api/kdocs-sheets');
    const allSheets = await allRes.json();

    // 匹配
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
      if (!matched) return; // 未匹配的不显示
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

// 脚本代码查看按钮
document.getElementById('kdShowScriptBtn').addEventListener('click', async () => {
  const overlay = document.createElement('div');
  overlay.className = 'fd-overlay vis';
  const dd = document.createElement('div');
  dd.className = 'fd-dropdown vis';
  dd.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%);width:660px;max-height:80vh;display:flex;flex-direction:column;';

  // 从后端加载脚本代码
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
  if (!codeContent) { overlay.remove(); dd.remove(); return; }

  dd.innerHTML = `<div class="fd-head"><span class="fd-cn">AirScript 脚本代码</span><span class="kd-script-badge" id="kdScriptModified" style="display:none">已修改</span></div>
    <div style="padding:0;flex:1;overflow:auto;position:relative">
      <textarea class="kd-script-editor" id="kdScriptEditor" spellcheck="false"></textarea>
    </div>
    <div class="fd-foot"><span class="kd-script-hint">编辑后可保存到文件，或一键复制粘贴到金山文档脚本编辑器</span><div class="fd-btns">
      <button class="btn btn-ghost btn-xs" id="kdScriptRestore" title="还原为文件中的原始代码">一键还原</button>
      <button class="btn btn-outline btn-xs" id="kdScriptSave">保存</button>
      <button class="btn btn-primary btn-xs" id="kdScriptCopy">一键复制</button>
      <button class="btn btn-ghost btn-xs" id="kdScriptClose">关闭</button>
    </div></div>`;
  document.body.appendChild(overlay);
  document.body.appendChild(dd);

  const editor = dd.querySelector('#kdScriptEditor');
  const modifiedBadge = dd.querySelector('#kdScriptModified');
  let originalCode = codeContent;
  let lastSavedCode = codeContent;

  editor.value = codeContent;

  // 监听编辑：显示"已修改"标记
  editor.addEventListener('input', () => {
    const changed = editor.value !== lastSavedCode;
    modifiedBadge.style.display = changed ? '' : 'none';
  });

  // 一键复制
  dd.querySelector('#kdScriptCopy').addEventListener('click', () => {
    navigator.clipboard.writeText(editor.value).then(() => ntf('已复制到剪贴板')).catch(() => ntf('复制失败', 'error'));
  });

  // 一键还原
  dd.querySelector('#kdScriptRestore').addEventListener('click', async () => {
    const fresh = await loadCode();
    if (fresh) {
      editor.value = fresh;
      originalCode = fresh;
      lastSavedCode = fresh;
      modifiedBadge.style.display = 'none';
      ntf('已还原为原始代码');
    }
  });

  // 保存
  dd.querySelector('#kdScriptSave').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/kdocs-airscript-code', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ code: editor.value })
      });
      const data = await res.json();
      if (data.error) { ntf(data.error, 'error'); return; }
      lastSavedCode = editor.value;
      modifiedBadge.style.display = 'none';
      ntf('脚本代码已保存');
    } catch (e) {
      ntf('保存失败: ' + e.message, 'error');
    }
  });

  const close = () => { overlay.remove(); dd.remove(); };
  overlay.addEventListener('click', close);
  dd.querySelector('#kdScriptClose').addEventListener('click', close);
});
