/**
 * 邮件发送模块 - 独立 JS
 * 从 email-tool 整合，作为 unified-tool 第7步功能
 * 所有函数和状态封装在 EmailTool 对象中，避免污染全局命名空间
 */
const EmailTool = (() => {
    const API = '/api/email';

    let recipients = [], ccList = [], attachments = [], contacts = [], templates = [];
    let pickerChecked = [], groupPickerChecked = [], pickerTarget = 'to';
    let batchMode = false, currentStep = 1;
    let previewEdits = {};
    let perRecipientFiles = {};
    let previewTimer = null;
    let isLoggedIn = false;  // 登录状态守卫

    let txtVarFiles = {};
    let currentEditVar = null;
    let tplTo = [], tplCc = [];

    const FONT_SIZE_MAP = {'1':'10px','2':'11px','3':'12px','4':'14px','5':'16px','6':'18px','7':'20px'};
    const EXTRA_SIZES = {'8':'24px','9':'36px'};

    // ============ 工具函数 ============
    function _esc(s) {
        if (!s) return '';
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function _fmtSize(b) {
        if (b < 1024) return b + ' B';
        if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
        return (b / 1048576).toFixed(1) + ' MB';
    }

    // 隐藏邮箱@前4位：w***@qq.com
    function _maskEmail(email) {
        if (!email) return '';
        const atIdx = email.indexOf('@');
        if (atIdx <= 0) return email;
        const local = email.substring(0, atIdx);
        const domain = email.substring(atIdx);
        if (local.length <= 1) return '*' + domain;
        const show = local.length <= 2 ? local[0] : local.substring(0, local.length - 4);
        const masked = local.substring(local.length - 4).replace(/./g, '*');
        return show + masked + domain;
    }

    // 获取联系人显示名（优先名字，否则邮箱前缀）
    function _getDisplayName(email) {
        const c = _findContactByEmail(email);
        return c ? c.name : email.split('@')[0];
    }

    function _schedulePreviewUpdate() {
        if (!batchMode) return;
        clearTimeout(previewTimer);
        previewTimer = setTimeout(_renderRecipientPreview, 300);
    }

    // ============ 模态框（独立实现，不依赖 fd-dropdown） ============
    function _showModal(id) {
        const mask = document.getElementById(id + 'Mask');
        const box = document.getElementById(id + 'Box');
        if (mask) mask.classList.add('show');
        if (box) box.classList.add('show');
    }
    function _hideModal(id) {
        const mask = document.getElementById(id + 'Mask');
        const box = document.getElementById(id + 'Box');
        if (mask) mask.classList.remove('show');
        if (box) box.classList.remove('show');
    }
    function _hideAllModals() {
        ['emContactModal', 'emTemplateModal', 'emPickerModal', 'emGroupPickerModal'].forEach(_hideModal);
    }

    // ============ 初始化 ============
    function init() {
        _checkLoginStatus();
        _loadLoginCreds();
        _updateLoginGuard();
        setInterval(_pollLogin, 2000);
        document.querySelectorAll('.em-sub-item').forEach(item => {
            item.addEventListener('click', () => _showSubPanel(item.dataset.empanel));
        });
        // 点击遮罩关闭模态框
        document.querySelectorAll('.em-modal-mask').forEach(mask => {
            mask.addEventListener('click', () => {
                mask.classList.remove('show');
                const box = mask.nextElementSibling;
                if (box) box.classList.remove('show');
            });
        });
    }

    function _showSubPanel(name) {
        // 未登录只能看登录面板
        if (!isLoggedIn && name !== 'login') {
            _toast('请先登录邮箱', 'error');
            _showSubPanel('login');
            return;
        }
        document.querySelectorAll('.em-subpanel').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.em-sub-item').forEach(s => s.classList.remove('active'));
        const panel = document.getElementById(`emPanel${name.charAt(0).toUpperCase() + name.slice(1)}`);
        const nav = document.querySelector(`.em-sub-item[data-empanel="${name}"]`);
        if (panel) panel.classList.add('active');
        if (nav) nav.classList.add('active');
        if (name === 'contacts') _loadContacts();
        if (name === 'templates') _loadTemplates();
    }

    // 登录守卫：更新UI可用状态
    function _updateLoginGuard() {
        const composePanel = document.getElementById('emPanelCompose');
        const contactsNav = document.querySelector('.em-sub-item[data-empanel="contacts"]');
        const templatesNav = document.querySelector('.em-sub-item[data-empanel="templates"]');
        if (isLoggedIn) {
            composePanel.classList.remove('em-locked');
            if (contactsNav) contactsNav.classList.remove('em-locked');
            if (templatesNav) templatesNav.classList.remove('em-locked');
            _loadContacts();
            _loadTemplates();
            _loadTxtVars();
        } else {
            composePanel.classList.add('em-locked');
            if (contactsNav) contactsNav.classList.add('em-locked');
            if (templatesNav) templatesNav.classList.add('em-locked');
            contacts = []; templates = [];
            const cEl = document.getElementById('emContactCount');
            const tEl = document.getElementById('emTemplateCount');
            if (cEl) cEl.textContent = '0';
            if (tEl) tEl.textContent = '0';
            _renderContactsTable();
            _renderTemplates();
            _updateTplSelect();
        }
    }

    // ============ 联系人 ============
    async function _loadContacts() {
        if (!isLoggedIn) return;
        try {
            const r = await fetch(`${API}/contacts`);
            const j = await r.json();
            if (j.success) {
                contacts = j.data;
                _renderContactsTable();
                const el = document.getElementById('emContactCount');
                if (el) el.textContent = contacts.length;
            }
        } catch (e) { console.error(e); }
    }

    function _renderContactsTable() {
        const tbody = document.getElementById('emContactsTbody');
        if (!tbody) return;
        if (!isLoggedIn) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--t3);padding:40px;">请先登录邮箱</td></tr>';
            return;
        }
        const search = (document.getElementById('emContactSearch')?.value || '').toLowerCase();
        const filtered = contacts.filter(c => !search || c.name.toLowerCase().includes(search) || c.email.toLowerCase().includes(search));
        if (!filtered.length) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--t3);padding:40px;">${search ? '未找到匹配的联系人' : '暂无联系人'}</td></tr>`;
            return;
        }
        tbody.innerHTML = filtered.map(c => `<tr>
            <td style="font-weight:500;">${_esc(c.name)}</td>
            <td style="color:var(--t2);font-family:var(--mf);letter-spacing:0.3px;">${_esc(_maskEmail(c.email))}</td>
            <td><span class="em-tag em-tag-blue">${_esc(c.group)}</span></td>
            <td class="em-td-actions">
                <button class="btn btn-ghost btn-sm" onclick="EmailTool.addToCompose('${_esc(c.email)}')">添加到收件人</button>
                <button class="btn btn-ghost btn-sm" onclick="EmailTool.editContact(${c.id})">编辑</button>
                <button class="btn btn-ghost btn-sm" style="color:var(--err);" onclick="EmailTool.delContact(${c.id})">删除</button>
            </td></tr>`).join('');
    }

    function _addToCompose(email) {
        if (!isLoggedIn) { _toast('请先登录邮箱', 'error'); return; }
        if (!recipients.includes(email)) {
            recipients.push(email);
            _renderToTags();
            _toast(`已添加 ${_getDisplayName(email)}`, 'success');
        } else _toast('该收件人已存在', 'info');
    }

    // 更新分组下拉列表
    function _updateGroupDatalist() {
        const dl = document.getElementById('emGroupList');
        if (!dl) return;
        const groups = [...new Set(contacts.map(c => c.group).filter(Boolean))];
        dl.innerHTML = groups.map(g => `<option value="${_esc(g)}">`).join('');
    }

    function _openAddContact() {
        if (!isLoggedIn) { _toast('请先登录邮箱', 'error'); return; }
        document.getElementById('emContactModalTitle').textContent = '添加联系人';
        document.getElementById('emEditContactId').value = '';
        document.getElementById('emContactName').value = '';
        document.getElementById('emContactEmail').value = '';
        document.getElementById('emContactGroup').value = '默认分组';
        _updateGroupDatalist();
        _showModal('emContactModal');
    }

    function _editContact(id) {
        const c = contacts.find(x => x.id === id);
        if (!c) return;
        document.getElementById('emContactModalTitle').textContent = '编辑联系人';
        document.getElementById('emEditContactId').value = c.id;
        document.getElementById('emContactName').value = c.name;
        document.getElementById('emContactEmail').value = c.email;
        document.getElementById('emContactGroup').value = c.group || '默认分组';
        _updateGroupDatalist();
        _showModal('emContactModal');
    }

    async function _saveContact() {
        const id = document.getElementById('emEditContactId').value;
        const name = document.getElementById('emContactName').value.trim();
        const email = document.getElementById('emContactEmail').value.trim();
        const group = document.getElementById('emContactGroup').value.trim() || '默认分组';
        if (!name || !email) { _toast('请填写姓名和邮箱', 'error'); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { _toast('邮箱格式不正确', 'error'); return; }
        const url = id ? `${API}/contacts/${id}` : `${API}/contacts`;
        const method = id ? 'PUT' : 'POST';
        await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, group }) });
        _hideModal('emContactModal');
        _loadContacts();
        _toast(id ? '联系人已更新' : '联系人已添加', 'success');
    }

    async function _delContact(id) {
        if (!confirm('确定删除该联系人？')) return;
        await fetch(`${API}/contacts/${id}`, { method: 'DELETE' });
        _loadContacts();
        _toast('已删除', 'success');
    }

    // ============ 联系人选择器 ============
    function _openContactPicker(target = 'to') {
        if (!isLoggedIn) { _toast('请先登录邮箱', 'error'); return; }
        pickerChecked = [];
        pickerTarget = target;
        const body = document.getElementById('emPickerBody');
        if (!contacts.length) {
            body.innerHTML = '<div style="text-align:center;color:var(--t3);padding:30px;">暂无联系人</div>';
        } else {
            body.innerHTML = contacts.map(c => `<label class="em-picker-row">
                <input type="checkbox" value="${_esc(c.email)}" onchange="EmailTool._togglePicker('${_esc(c.email)}',this.checked)">
                <span class="em-pk-name">${_esc(c.name)}</span>
                <span class="em-pk-email">${_esc(_maskEmail(c.email))}</span>
                <span class="em-tag em-tag-blue">${_esc(c.group)}</span></label>`).join('');
        }
        _showModal('emPickerModal');
    }

    function _togglePicker(email, checked) {
        if (checked && !pickerChecked.includes(email)) pickerChecked.push(email);
        if (!checked) pickerChecked = pickerChecked.filter(e => e !== email);
    }

    function _confirmPicker() {
        let added = 0;
        const targetList = pickerTarget === 'cc' ? ccList : recipients;
        pickerChecked.forEach(e => { if (!targetList.includes(e)) { targetList.push(e); added++; } });
        if (pickerTarget === 'cc') { _renderCcTags(); } else { _renderToTags(); }
        _hideModal('emPickerModal');
        if (added > 0) _toast(`已添加 ${added} 位${pickerTarget === 'cc' ? '抄送人' : '收件人'}`, 'success');
        else _toast('选中的联系人已都在列表中', 'info');
        if (batchMode) _renderRecipientPreview();
    }

    // ============ 分组选择器 ============
    async function _openGroupPicker(target = 'to') {
        if (!isLoggedIn) { _toast('请先登录邮箱', 'error'); return; }
        groupPickerChecked = [];
        pickerTarget = target;
        const body = document.getElementById('emGroupPickerBody');
        try {
            const r = await fetch(`${API}/groups`);
            const j = await r.json();
            if (!j.success || !j.data || !j.data.length) {
                body.innerHTML = '<div style="text-align:center;color:var(--t3);padding:30px;">暂无分组</div>';
                _showModal('emGroupPickerModal');
                return;
            }
            body.innerHTML = j.data.map(g => `<div>
                <div class="em-gp-group-head">
                    <input type="checkbox" class="em-gp-group-cb" data-group="${_esc(g.name)}" onchange="EmailTool._toggleGroupCheck('${_esc(g.name)}',this.checked)">
                    <span class="em-gp-name">${_esc(g.name)}</span>
                    <span class="em-gp-count">${g.count} 人</span>
                    <button class="btn btn-ghost btn-sm" onclick="this.parentElement.nextElementSibling.style.display=this.parentElement.nextElementSibling.style.display==='none'?'block':'none'" style="font-size:11px;padding:2px 8px;">展开</button>
                </div>
                <div style="display:none;">${g.contacts.map(c => `<div class="em-gp-member">
                    <input type="checkbox" class="em-gp-member-cb" data-group="${_esc(g.name)}" data-email="${_esc(c.email)}" onchange="EmailTool._toggleGroupMemberCheck('${_esc(g.name)}','${_esc(c.email)}',this.checked)">
                    <span class="em-gp-mname">${_esc(c.name)}</span>
                    <span class="em-gp-memail">${_esc(_maskEmail(c.email))}</span>
                </div>`).join('')}</div>
            </div>`).join('');
        } catch (e) {
            body.innerHTML = '<div style="text-align:center;color:var(--err);padding:30px;">加载分组失败</div>';
        }
        _showModal('emGroupPickerModal');
    }

    function _toggleGroupCheck(groupName, checked) {
        document.querySelectorAll(`.em-gp-member-cb[data-group="${groupName}"]`).forEach(cb => {
            cb.checked = checked;
            const email = cb.dataset.email;
            if (checked) { if (!groupPickerChecked.find(g => g.email === email)) groupPickerChecked.push({ group: groupName, email }); }
            else { groupPickerChecked = groupPickerChecked.filter(g => g.email !== email); }
        });
    }

    function _toggleGroupMemberCheck(groupName, email, checked) {
        if (checked) { if (!groupPickerChecked.find(g => g.email === email)) groupPickerChecked.push({ group: groupName, email }); }
        else { groupPickerChecked = groupPickerChecked.filter(g => g.email !== email); }
    }

    function _confirmGroupPicker() {
        const emails = groupPickerChecked.map(g => g.email);
        const targetList = pickerTarget === 'cc' ? ccList : recipients;
        let added = 0;
        emails.forEach(e => { if (!targetList.includes(e)) { targetList.push(e); added++; } });
        if (pickerTarget === 'cc') { _renderCcTags(); } else { _renderToTags(); }
        _hideModal('emGroupPickerModal');
        if (added > 0) _toast(`已添加 ${added} 位${pickerTarget === 'cc' ? '抄送人' : '收件人'}`, 'success');
        else _toast('选中的联系人已都在列表中', 'info');
        if (batchMode) _renderRecipientPreview();
    }

    // ============ 收件人/抄送 ============
    function _handleToKey(e) {
        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); _addTo(); }
        if (e.key === 'Backspace' && !e.target.value && recipients.length) { recipients.pop(); _renderToTags(); }
    }

    function _addTo() {
        const input = document.getElementById('emToInput');
        const v = input.value.trim().replace(/,$/, '');
        if (!v) return;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { _toast('邮箱格式不正确', 'error'); return; }
        if (recipients.includes(v)) { _toast('已添加', 'info'); return; }
        recipients.push(v);
        input.value = '';
        _renderToTags();
    }

    function _removeTo(email) {
        recipients = recipients.filter(r => r !== email);
        delete previewEdits[email];
        _renderToTags();
    }

    // 收件人标签按名字显示
    function _renderToTags() {
        document.getElementById('emToTags').innerHTML = recipients.map(e => {
            const name = _getDisplayName(e);
            return `<span class="em-tag em-tag-green" title="${_esc(e)}">${_esc(name)}<span class="em-tag-x" onclick="EmailTool._removeTo('${_esc(e)}')">&times;</span></span>`;
        }).join('');
        _updateComposeInfo();
        if (batchMode) _renderRecipientPreview();
    }

    function _handleCcKey(e) {
        if (batchMode) { e.preventDefault(); return; }
        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); _addCc(); }
        if (e.key === 'Backspace' && !e.target.value && ccList.length) { ccList.pop(); _renderCcTags(); }
    }

    function _addCc() {
        if (batchMode) { _toast('个性化发送时不允许抄送', 'error'); return; }
        const input = document.getElementById('emCcInput');
        const v = input.value.trim().replace(/,$/, '');
        if (!v) return;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { _toast('邮箱格式不正确', 'error'); return; }
        if (ccList.includes(v)) { _toast('已添加', 'info'); return; }
        ccList.push(v);
        input.value = '';
        _renderCcTags();
    }

    function _removeCc(email) { ccList = ccList.filter(r => r !== email); _renderCcTags(); }

    function _renderCcTags() {
        document.getElementById('emCcTags').innerHTML = ccList.map(e => {
            const name = _getDisplayName(e);
            return `<span class="em-tag em-tag-blue" title="${_esc(e)}">${_esc(name)}<span class="em-tag-x" onclick="EmailTool._removeCc('${_esc(e)}')">&times;</span></span>`;
        }).join('');
    }

    function _updateComposeInfo() {
        const info = document.getElementById('emComposeInfo');
        const parts = [];
        if (recipients.length > 0) parts.push(`${recipients.length} 位收件人`);
        if (!batchMode && ccList.length > 0) parts.push(`${ccList.length} 位抄送`);
        if (attachments.length > 0) parts.push(`${attachments.length} 个附件`);
        info.textContent = parts.join('，');
    }

    // ============ 富文本工具栏 ============
    function _execRich(cmd, val) {
        document.execCommand(cmd, false, val || null);
        document.getElementById('emBody').focus();
        if (batchMode) _renderRecipientPreview();
    }

    function _applyFontSize(val) {
        if (!val) return;
        if (EXTRA_SIZES[val]) {
            if (!window.getSelection().rangeCount) return;
            document.execCommand('fontSize', false, '7');
            document.getElementById('emBody').querySelectorAll('font[size="7"]').forEach(el => {
                const span = document.createElement('span');
                span.style.fontSize = EXTRA_SIZES[val];
                span.innerHTML = el.innerHTML;
                el.parentNode.replaceChild(span, el);
            });
        } else {
            document.execCommand('fontSize', false, val);
            document.getElementById('emBody').querySelectorAll(`font[size="${val}"]`).forEach(el => {
                const span = document.createElement('span');
                span.style.fontSize = FONT_SIZE_MAP[val];
                span.innerHTML = el.innerHTML;
                el.parentNode.replaceChild(span, el);
            });
        }
        document.getElementById('emBody').focus();
        if (batchMode) _renderRecipientPreview();
    }

    function _applyLineHeight(val) {
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        let el = sel.getRangeAt(0).commonAncestorContainer;
        if (el.nodeType === 3) el = el.parentNode;
        if (el === document.getElementById('emBody')) {
            document.execCommand('insertHTML', false, `<div style="line-height:${val};"><br></div>`);
        } else {
            el.style.lineHeight = val;
        }
    }

    function _applyIndent() {
        document.execCommand('insertHTML', false, '&emsp;&emsp;&emsp;&emsp;');
        document.getElementById('emBody').focus();
    }

    function _insertLink() {
        const url = prompt('请输入链接地址：', 'https://');
        if (url) { document.execCommand('createLink', false, url); document.getElementById('emBody').focus(); }
    }

    function _insertImage() {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*';
        input.onchange = async function () {
            const file = this.files[0];
            if (!file) return;
            const fd = new FormData(); fd.append('file', file);
            try {
                const r = await fetch(`${API}/upload-image`, { method: 'POST', body: fd });
                const j = await r.json();
                if (j.success) {
                    document.getElementById('emBody').focus();
                    document.execCommand('insertHTML', false, `<img src="${j.data.url}" style="max-width:100%;height:auto;margin:4px 0;">`);
                    _toast('图片已插入', 'success');
                } else _toast(j.message, 'error');
            } catch (e) { _toast('上传失败', 'error'); }
        };
        input.click();
    }

    function _getBodyText() { return document.getElementById('emBody').innerText || ''; }
    function _getBodyHTML() { return document.getElementById('emBody').innerHTML; }

    // ============ 个性化模式 ============
    function _toggleBatchMode() {
        batchMode = document.getElementById('emBatchMode').checked;
        document.getElementById('emVarHelper').style.display = batchMode ? 'flex' : 'none';
        document.getElementById('emPreviewSection').style.display = batchMode ? 'block' : 'none';
        document.getElementById('emSendBtn').style.display = batchMode ? 'none' : 'inline-flex';
        document.getElementById('emBatchSendBtn').style.display = batchMode ? 'inline-flex' : 'none';
        // 个性化发送时禁止抄送
        const ccGroup = document.getElementById('emCcGroup');
        if (ccGroup) {
            if (batchMode) {
                ccGroup.style.display = 'none';
                ccList = [];
                _renderCcTags();
            } else {
                ccGroup.style.display = '';
            }
        }
        if (batchMode) {
            document.getElementById('emBody').setAttribute('data-placeholder', '输入邮件正文，支持 {{name}}、{{email}}、{{group}} 等变量');
            _renderRecipientPreview();
        } else {
            document.getElementById('emBody').setAttribute('data-placeholder', '请输入邮件正文内容...');
        }
        _updateComposeInfo();
    }

    function _insertVariable(varName) {
        const el = document.getElementById('emBody');
        el.focus();
        document.execCommand('insertText', false, `{{${varName}}}`);
        if (batchMode) _renderRecipientPreview();
    }

    // ============ txt 变量系统 ============
    async function _loadTxtVars() {
        if (!isLoggedIn) return;
        try {
            const r = await fetch(`${API}/txt-vars`);
            const j = await r.json();
            if (j.success && j.data) { j.data.forEach(d => { txtVarFiles[d.name] = null; }); _renderTxtVarList(); }
        } catch (e) { }
    }

    async function _uploadTxtVar(e) {
        if (!isLoggedIn) { _toast('请先登录邮箱', 'error'); return; }
        const file = e.target.files[0];
        if (!file) return;
        let varName = prompt('请输入变量名（在正文中用 {{变量名}} 引用）：', file.name.replace('.txt', ''));
        if (!varName) return;
        varName = varName.trim();
        if (!varName) { _toast('变量名不能为空', 'error'); return; }
        const fd = new FormData(); fd.append('file', file);
        try {
            const r = await fetch(`${API}/txt-vars`, { method: 'POST', body: fd });
            const j = await r.json();
            if (j.success) {
                const rv = await fetch(`${API}/txt-vars/${j.data.name}`);
                const jv = await rv.json();
                txtVarFiles[varName] = jv.success ? (jv.data.values || []) : [];
                _renderTxtVarList();
                _toast(`变量「${varName}」已导入（${j.data.count} 行）`, 'success');
            } else _toast(j.message, 'error');
        } catch (e) { _toast('上传失败', 'error'); }
        e.target.value = '';
    }

    function _addNewTxtVar() {
        let varName = prompt('请输入新变量名（在正文中用 {{变量名}} 引用）：');
        if (!varName) return;
        varName = varName.trim();
        if (!varName) { _toast('变量名不能为空', 'error'); return; }
        if (txtVarFiles.hasOwnProperty(varName)) {
            _toast(`变量「${varName}」已存在`, 'info');
            _openVarEdit(varName);
            return;
        }
        txtVarFiles[varName] = [];
        _renderTxtVarList();
        _openVarEdit(varName);
        _toast(`变量「${varName}」已创建`, 'success');
    }

    function _renderTxtVarList() {
        const list = document.getElementById('emTxtVarList');
        const names = Object.keys(txtVarFiles);
        if (!names.length) { list.innerHTML = ''; return; }
        list.innerHTML = names.map(name => {
            const vals = txtVarFiles[name] || [];
            const count = vals.length || '?';
            return `<span class="em-var-btn" style="position:relative;padding-right:20px;cursor:pointer;" onclick="EmailTool._openVarEdit('${name.replace(/'/g, "\\'")}')" title="点击编辑">
                {{${_esc(name)}}}<span style="font-size:10px;opacity:0.7;margin-left:2px;">${count}行</span>
                <span onclick="event.stopPropagation();EmailTool._deleteTxtVar('${name.replace(/'/g, "\\'")}')" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);font-size:14px;cursor:pointer;opacity:0.5;width:16px;height:16px;display:flex;align-items:center;justify-content:center;border-radius:50%;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.5'">&times;</span>
            </span>`;
        }).join('');
    }

    async function _openVarEdit(name) {
        currentEditVar = name;
        document.getElementById('emVarEditPanel').style.display = 'block';
        document.getElementById('emVarEditTitle').textContent = `编辑变量：{{${name}}}`;
        document.getElementById('emVarEditName').value = name;
        if (txtVarFiles[name] === null) {
            try {
                const r = await fetch(`${API}/txt-vars/${name}`);
                const j = await r.json();
                txtVarFiles[name] = j.success ? (j.data.values || []) : [];
            } catch (e) { txtVarFiles[name] = []; }
        }
        document.getElementById('emVarEditValues').value = (txtVarFiles[name] || []).join('\n');
        _updateVarEditCount();
    }

    function _closeVarEdit() { document.getElementById('emVarEditPanel').style.display = 'none'; currentEditVar = null; }

    function _onVarNameChange() {
        const newName = document.getElementById('emVarEditName').value.trim();
        if (!newName || !currentEditVar) return;
        if (newName !== currentEditVar) {
            if (txtVarFiles.hasOwnProperty(newName)) { _toast(`变量名「${newName}」已被占用`, 'error'); document.getElementById('emVarEditName').value = currentEditVar; return; }
            txtVarFiles[newName] = txtVarFiles[currentEditVar];
            delete txtVarFiles[currentEditVar];
            _syncVarToBackend(newName);
            currentEditVar = newName;
            document.getElementById('emVarEditTitle').textContent = `编辑变量：{{${newName}}}`;
            _renderTxtVarList();
            _schedulePreviewUpdate();
        }
    }

    function _onVarValuesChange() {
        const text = document.getElementById('emVarEditValues').value;
        const lines = text.split('\n').filter(l => l.trim());
        if (currentEditVar) {
            txtVarFiles[currentEditVar] = lines.map(l => l.trim());
            _syncVarToBackend(currentEditVar);
            _renderTxtVarList();
            _schedulePreviewUpdate();
        }
        _updateVarEditCount();
    }

    function _updateVarEditCount() {
        const text = document.getElementById('emVarEditValues').value;
        document.getElementById('emVarEditCount').textContent = `${text.split('\n').filter(l => l.trim()).length} 行`;
    }

    async function _syncVarToBackend(name) {
        try {
            const fd = new FormData();
            fd.append('file', new Blob([(txtVarFiles[name] || []).join('\n')], { type: 'text/plain' }), `${name}.txt`);
            await fetch(`${API}/txt-vars`, { method: 'POST', body: fd });
        } catch (e) { console.error('同步变量失败', e); }
    }

    async function _deleteTxtVar(name) {
        if (!confirm(`确定删除变量「${name}」？`)) return;
        delete txtVarFiles[name];
        try { await fetch(`${API}/txt-vars/${name}`, { method: 'DELETE' }); } catch (e) { }
        if (currentEditVar === name) _closeVarEdit();
        _renderTxtVarList();
        _toast(`变量「${name}」已删除`, 'success');
    }

    // ============ 变量替换 ============
    function _findContactByEmail(email) { return contacts.find(c => c.email === email) || null; }

    async function _replaceVariables(text, contact, recipientIndex) {
        if (!text) return '';
        let result = text;
        result = result.replace(/\{\{name\}\}/g, contact ? contact.name : '');
        result = result.replace(/\{\{email\}\}/g, contact ? contact.email : '');
        result = result.replace(/\{\{group\}\}/g, contact ? (contact.group || '') : '');
        const allVars = Object.keys(txtVarFiles).filter(n => !['name', 'email', 'group'].includes(n));
        for (const varName of allVars) {
            const pattern = new RegExp(`\\{\\{${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\}`, 'g');
            let values = txtVarFiles[varName];
            if (values === null) {
                try {
                    const r = await fetch(`${API}/txt-vars/${varName}`);
                    const j = await r.json();
                    values = j.success ? (j.data.values || []) : [];
                    txtVarFiles[varName] = values;
                } catch (e) { values = []; txtVarFiles[varName] = []; }
            }
            if (!values) values = [];
            let matchCount = 0;
            result = result.replace(pattern, () => {
                const idx = recipientIndex + matchCount;
                const val = idx < values.length ? values[idx] : (values[0] || '');
                matchCount++;
                return val || '{{' + varName + '}}';
            });
        }
        return result;
    }

    // ============ 个性化预览 ============
    async function _renderRecipientPreview() {
        const body = document.getElementById('emPreviewBody');
        const countEl = document.getElementById('emPreviewCount');
        const subject = document.getElementById('emSubject').value;
        const bodyText = _getBodyText();
        if (!recipients.length) {
            body.innerHTML = '<div style="text-align:center;color:var(--t3);padding:20px;">请先添加收件人</div>';
            countEl.textContent = '';
            return;
        }
        countEl.textContent = `共 ${recipients.length} 位收件人`;
        let html = '';
        for (let i = 0; i < recipients.length; i++) {
            const email = recipients[i];
            const c = _findContactByEmail(email);
            const name = c ? c.name : email.split('@')[0];
            const group = c ? (c.group || '-') : '-';
            const previewSubject = await _replaceVariables(subject, c, i);
            const previewBody = await _replaceVariables(bodyText, c, i);
            const edit = previewEdits[email];
            const showSubject = edit ? edit.subject : previewSubject;
            const showBody = edit ? edit.body : previewBody;
            const pFiles = perRecipientFiles[email] || [];
            html += `<div class="em-preview-item" data-email="${_esc(email)}">
                <div class="em-pi-head">
                    <span class="em-pi-name">${_esc(name)}</span>
                    <span class="em-pi-email">&lt;${_esc(email)}&gt;</span>
                    <span class="em-pi-group">${_esc(group)}</span>
                    <button class="btn btn-ghost btn-sm" onclick="EmailTool._togglePreviewEdit('${_esc(email)}')" style="margin-left:auto;font-size:11px;">编辑</button>
                </div>
                <div id="em-pi-display-${_esc(email).replace(/[@.]/g, '_')}">
                    <div class="em-pi-subject">${_esc(showSubject) || '<span style="color:var(--t3)">(无主题)</span>'}</div>
                    <div class="em-pi-body">${_esc(showBody.substring(0, 200))}${showBody.length > 200 ? '...' : ''}</div>
                    <div class="em-pi-attach-row">
                        ${pFiles.map(f => `<span class="em-pi-attach-tag">${_esc(f.name)}</span>`).join('')}
                        <span class="em-pi-attach-add" onclick="EmailTool._addPerRecipientFile('${_esc(email)}')">+ 个别附件</span>
                    </div>
                </div>
                <div class="em-pi-edit-area" id="em-pi-edit-${_esc(email).replace(/[@.]/g, '_')}">
                    <input type="text" value="${_esc(showSubject)}" onchange="EmailTool._updatePreviewEdit('${_esc(email)}','subject',this.value)" placeholder="主题">
                    <textarea onchange="EmailTool._updatePreviewEdit('${_esc(email)}','body',this.value)" placeholder="正文">${_esc(showBody)}</textarea>
                </div>
            </div>`;
        }
        body.innerHTML = html;
    }

    function _togglePreviewEdit(email) {
        const safe = email.replace(/[@.]/g, '_');
        const display = document.getElementById(`em-pi-display-${safe}`);
        const editArea = document.getElementById(`em-pi-edit-${safe}`);
        if (!display || !editArea) return;
        const show = editArea.style.display === 'none' || !editArea.style.display;
        editArea.style.display = show ? 'block' : 'none';
        display.style.display = show ? 'none' : 'block';
    }

    function _updatePreviewEdit(email, field, value) {
        if (!previewEdits[email]) previewEdits[email] = {};
        previewEdits[email][field] = value;
    }

    function _addPerRecipientFile(email) {
        const input = document.createElement('input');
        input.type = 'file'; input.multiple = true;
        input.onchange = function () {
            if (!perRecipientFiles[email]) perRecipientFiles[email] = [];
            Array.from(this.files).forEach(f => perRecipientFiles[email].push(f));
            if (batchMode) _renderRecipientPreview();
            _toast(`已为 ${email} 添加 ${this.files.length} 个个别附件`, 'success');
        };
        input.click();
    }

    // ============ 模板 ============
    async function _loadTemplates() {
        if (!isLoggedIn) return;
        try {
            const r = await fetch(`${API}/templates`);
            const j = await r.json();
            if (j.success) {
                templates = j.data;
                _renderTemplates();
                _updateTplSelect();
                const el = document.getElementById('emTemplateCount');
                if (el) el.textContent = templates.length;
            }
        } catch (e) { console.error(e); }
    }

    function _updateTplSelect() {
        const sel = document.getElementById('emTemplateSelect');
        sel.innerHTML = '<option value="">-- 不使用模板 --</option>' + templates.map(t => `<option value="${t.id}">${_esc(t.name)}</option>`).join('');
    }

    function _renderTemplates() {
        const container = document.getElementById('emTplList');
        if (!isLoggedIn || !templates.length) {
            container.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--t3);padding:40px;">${!isLoggedIn ? '请先登录邮箱' : '暂无模板'}</div>`;
            return;
        }
        container.innerHTML = templates.map(t => {
            const toArr = t.to || [];
            const ccArr = t.cc || [];
            let tags = '';
            if (toArr.length) tags += toArr.slice(0, 3).map(e => {
                const name = _getDisplayName(e);
                return `<span class="em-tag em-tag-green" title="${_esc(e)}">${_esc(name)}</span>`;
            }).join('') + (toArr.length > 3 ? `<span class="em-tag" style="background:var(--bg3);color:var(--t3);">+${toArr.length - 3}</span>` : '');
            if (ccArr.length) tags += ccArr.slice(0, 2).map(e => {
                const name = _getDisplayName(e);
                return `<span class="em-tag em-tag-blue" title="${_esc(e)}">${_esc(name)}</span>`;
            }).join('');
            const batchTag = t.batchMode ? '<span class="em-tag" style="background:var(--wnbg);color:var(--wn);font-size:10px;">个性化</span>' : '';
            return `<div class="em-tpl-card">
                <div class="em-tpl-name">${_esc(t.name)} ${batchTag}</div>
                ${tags ? `<div class="em-tpl-tags">${tags}</div>` : ''}
                <div class="em-tpl-preview">${_esc(t.subject || '(无主题)')}</div>
                <div class="em-tpl-preview">${_esc((t.body || '').substring(0, 80))}${(t.body || '').length > 80 ? '...' : ''}</div>
                <div class="em-tpl-actions">
                    <button class="btn btn-primary btn-sm" onclick="EmailTool._useTemplate(${t.id})">使用</button>
                    <button class="btn btn-outline btn-sm" onclick="EmailTool._editTemplate(${t.id})">编辑</button>
                    <button class="btn btn-outline btn-sm" style="color:var(--err);" onclick="EmailTool._delTemplate(${t.id})">删除</button>
                </div></div>`;
        }).join('');
    }

    function _handleTplToKey(e) {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const input = document.getElementById('emTplToInput');
            const v = input.value.trim().replace(/,$/, '');
            if (!v) return;
            if (!tplTo.includes(v)) { tplTo.push(v); input.value = ''; _renderTplToTags(); }
        }
    }

    function _handleTplCcKey(e) {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const input = document.getElementById('emTplCcInput');
            const v = input.value.trim().replace(/,$/, '');
            if (!v) return;
            if (!tplCc.includes(v)) { tplCc.push(v); input.value = ''; _renderTplCcTags(); }
        }
    }

    function _renderTplToTags() {
        document.getElementById('emTplToTags').innerHTML = tplTo.map(e => {
            const name = _getDisplayName(e);
            return `<span class="em-tag em-tag-green" title="${_esc(e)}">${_esc(name)}<span class="em-tag-x" onclick="EmailTool._removeTplTo('${_esc(e)}')">&times;</span></span>`;
        }).join('');
    }

    function _removeTplTo(email) { tplTo = tplTo.filter(x => x !== email); _renderTplToTags(); }

    function _renderTplCcTags() {
        document.getElementById('emTplCcTags').innerHTML = tplCc.map(e => {
            const name = _getDisplayName(e);
            return `<span class="em-tag em-tag-blue" title="${_esc(e)}">${_esc(name)}<span class="em-tag-x" onclick="EmailTool._removeTplCc('${_esc(e)}')">&times;</span></span>`;
        }).join('');
    }

    function _removeTplCc(email) { tplCc = tplCc.filter(x => x !== email); _renderTplCcTags(); }

    function _applyTemplate() {
        const id = parseInt(document.getElementById('emTemplateSelect').value);
        if (id) _useTemplate(id);
    }

    // 使用模板：替换收件人、恢复个性化发送状态
    function _useTemplate(id) {
        const t = templates.find(x => x.id === id);
        if (!t) return;
        document.getElementById('emSubject').value = t.subject || '';
        document.getElementById('emBody').innerText = t.body || '';
        document.getElementById('emTemplateSelect').value = id;
        // 替换收件人（而非追加）
        recipients = [...(t.to || [])];
        ccList = [...(t.cc || [])];
        _renderToTags();
        _renderCcTags();
        // 恢复模板保存的个性化发送状态
        if (t.batchMode) {
            document.getElementById('emBatchMode').checked = true;
            _toggleBatchMode();
        } else {
            if (batchMode) {
                document.getElementById('emBatchMode').checked = false;
                _toggleBatchMode();
            }
        }
        _showSubPanel('compose');
        _toast(`已应用模板: ${t.name}`, 'success');
    }

    function _saveCurrentAsTemplate() {
        if (!isLoggedIn) { _toast('请先登录邮箱', 'error'); return; }
        const subject = document.getElementById('emSubject').value.trim();
        const body = _getBodyText().trim();
        if (!subject && !body) { _toast('当前内容为空，无法保存为模板', 'error'); return; }
        document.getElementById('emTemplateModalTitle').textContent = '保存为模板';
        document.getElementById('emEditTplId').value = '';
        document.getElementById('emTplName').value = '';
        document.getElementById('emTplSubject').value = subject;
        document.getElementById('emTplBody').value = body;
        document.getElementById('emTplBatchMode').checked = batchMode;
        tplTo = [...recipients]; tplCc = [...ccList];
        _renderTplToTags(); _renderTplCcTags();
        _showModal('emTemplateModal');
    }

    function _openNewTemplate() {
        if (!isLoggedIn) { _toast('请先登录邮箱', 'error'); return; }
        document.getElementById('emTemplateModalTitle').textContent = '新建模板';
        document.getElementById('emEditTplId').value = '';
        document.getElementById('emTplName').value = '';
        document.getElementById('emTplSubject').value = '';
        document.getElementById('emTplBody').value = '';
        document.getElementById('emTplBatchMode').checked = false;
        tplTo = []; tplCc = [];
        _renderTplToTags(); _renderTplCcTags();
        _showModal('emTemplateModal');
    }

    function _editTemplate(id) {
        const t = templates.find(x => x.id === id);
        if (!t) return;
        document.getElementById('emTemplateModalTitle').textContent = '编辑模板';
        document.getElementById('emEditTplId').value = t.id;
        document.getElementById('emTplName').value = t.name;
        document.getElementById('emTplSubject').value = t.subject || '';
        document.getElementById('emTplBody').value = t.body || '';
        document.getElementById('emTplBatchMode').checked = !!t.batchMode;
        tplTo = [...(t.to || [])]; tplCc = [...(t.cc || [])];
        _renderTplToTags(); _renderTplCcTags();
        _showModal('emTemplateModal');
    }

    async function _saveTemplateModal() {
        const id = document.getElementById('emEditTplId').value;
        const name = document.getElementById('emTplName').value.trim();
        const subject = document.getElementById('emTplSubject').value.trim();
        const body = document.getElementById('emTplBody').value.trim();
        const batchModeVal = document.getElementById('emTplBatchMode').checked;
        if (!name) { _toast('请输入模板名称', 'error'); return; }
        const url = id ? `${API}/templates/${id}` : `${API}/templates`;
        const method = id ? 'PUT' : 'POST';
        await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, subject, body, to: tplTo, cc: tplCc, batchMode: batchModeVal }) });
        _hideModal('emTemplateModal');
        _loadTemplates();
        _toast(id ? '模板已更新' : '模板已保存', 'success');
    }

    async function _delTemplate(id) {
        if (!confirm('确定删除该模板？')) return;
        await fetch(`${API}/templates/${id}`, { method: 'DELETE' });
        _loadTemplates();
        _toast('模板已删除', 'success');
    }

    // ============ 附件 ============
    function _handleFileSelect(e) {
        Array.from(e.target.files).forEach(f => { attachments.push({ name: f.name, size: f.size, file: f }); });
        _renderAttach(); _updateComposeInfo(); e.target.value = '';
    }

    function _handleDrop(e) {
        Array.from(e.dataTransfer.files).forEach(f => { attachments.push({ name: f.name, size: f.size, file: f }); });
        _renderAttach(); _updateComposeInfo();
    }

    function _removeAttach(i) { attachments.splice(i, 1); _renderAttach(); _updateComposeInfo(); }

    function _renderAttach() {
        const el = document.getElementById('emAttachList');
        if (!attachments.length) { el.innerHTML = ''; return; }
        el.innerHTML = attachments.map((a, i) => `<div class="em-attach-item">
            <span class="em-att-name">${_esc(a.name)}</span>
            <span class="em-att-size">${_fmtSize(a.size)}</span>
            <button class="em-att-del" onclick="EmailTool._removeAttach(${i})">&times;</button>
        </div>`).join('');
    }

    // ============ 发送邮件 ============
    async function _sendEmail() {
        if (!isLoggedIn) { _toast('请先登录邮箱', 'error'); return; }
        if (!recipients.length) { _toast('请添加至少一位收件人', 'error'); return; }
        const subject = document.getElementById('emSubject').value.trim();
        if (!subject) { _toast('请填写邮件主题', 'error'); return; }
        const body = _getBodyHTML();
        document.getElementById('emSendingOverlay').classList.add('show');
        const fd = new FormData();
        fd.append('to', JSON.stringify(recipients));
        fd.append('cc', JSON.stringify(ccList));
        fd.append('subject', subject);
        fd.append('body', body);
        fd.append('is_html', 'true');
        attachments.forEach(a => { if (a.file) fd.append('files', a.file); });
        try {
            const r = await fetch(`${API}/send`, { method: 'POST', body: fd });
            const j = await r.json();
            if (j.success) { _toast(j.message, 'success'); _clearCompose(); }
            else _toast(j.message, 'error');
        } catch (e) { _toast('发送失败: ' + e.message, 'error'); }
        document.getElementById('emSendingOverlay').classList.remove('show');
    }

    async function _sendBatchEmail() {
        if (!isLoggedIn) { _toast('请先登录邮箱', 'error'); return; }
        if (!recipients.length) { _toast('请添加至少一位收件人', 'error'); return; }
        const subjectTpl = document.getElementById('emSubject').value.trim();
        const bodyTpl = _getBodyText();
        if (!subjectTpl) { _toast('请填写邮件主题模板', 'error'); return; }
        const items = [];
        for (let i = 0; i < recipients.length; i++) {
            const email = recipients[i];
            const c = _findContactByEmail(email);
            const edit = previewEdits[email];
            let s, b;
            if (edit) {
                s = edit.subject || await _replaceVariables(subjectTpl, c, i);
                b = edit.body || await _replaceVariables(bodyTpl, c, i);
            } else {
                s = await _replaceVariables(subjectTpl, c, i);
                b = await _replaceVariables(bodyTpl, c, i);
            }
            items.push({ to: email, subject: s, body: b });
        }
        document.getElementById('emSendingOverlay').classList.add('show');
        document.querySelector('.em-sending-text').textContent = `正在批量发送邮件 (0/${items.length})...`;
        const fd = new FormData();
        fd.append('items', JSON.stringify(items));
        fd.append('cc', JSON.stringify([])); // 个性化发送无抄送
        attachments.forEach(a => { if (a.file) fd.append('files', a.file); });
        for (let i = 0; i < recipients.length; i++) {
            const pFiles = perRecipientFiles[recipients[i]] || [];
            pFiles.forEach(f => { fd.append(`files_${i}`, f); });
        }
        try {
            const r = await fetch(`${API}/batch-send`, { method: 'POST', body: fd });
            const j = await r.json();
            if (j.success) { _toast(j.message, j.fail_count > 0 ? 'info' : 'success'); if (j.success_count === items.length) _clearCompose(); }
            else _toast(j.message, 'error');
        } catch (e) { _toast('批量发送失败: ' + e.message, 'error'); }
        document.getElementById('emSendingOverlay').classList.remove('show');
        document.querySelector('.em-sending-text').textContent = '正在发送邮件，请稍候...';
    }

    function _clearCompose() {
        recipients = []; ccList = []; attachments = [];
        previewEdits = {}; perRecipientFiles = {};
        document.getElementById('emToInput').value = '';
        document.getElementById('emCcInput').value = '';
        document.getElementById('emSubject').value = '';
        document.getElementById('emBody').innerHTML = '';
        document.getElementById('emTemplateSelect').value = '';
        if (batchMode) { document.getElementById('emBatchMode').checked = false; _toggleBatchMode(); }
        _renderToTags(); _renderCcTags(); _renderAttach();
        document.getElementById('emComposeInfo').textContent = '';
    }

    // ============ 登录 ============
    function _updateSteps(step) {
        currentStep = step;
        document.querySelectorAll('#emLoginSteps .em-step').forEach(s => {
            const n = parseInt(s.dataset.step);
            s.classList.remove('active', 'done');
            if (n < step) s.classList.add('done');
            if (n === step) s.classList.add('active');
        });
        document.querySelectorAll('#emLoginSteps .em-step-line').forEach((line, i) => {
            line.classList.toggle('done', i + 1 < step);
        });
    }

    async function _startLogin() {
        const account = document.getElementById('emLoginAccount').value.trim();
        const password = document.getElementById('emLoginPassword').value.trim();
        const phone = document.getElementById('emLoginPhone').value.trim();
        if (!account || !password) { _toast('请填写账号和密码', 'error'); return; }
        document.getElementById('emLoginIcon').innerHTML = '<div class="em-spinner"></div>';
        document.getElementById('emLoginText').textContent = '正在启动黑箱登录...';
        document.getElementById('emLoginSub').textContent = '请稍候';
        document.getElementById('emLoginActions').innerHTML = '<button class="btn btn-outline" disabled>登录中...</button>';
        document.getElementById('emLoginCredsArea').style.display = 'none';
        document.getElementById('emLoginCodeArea').style.display = 'none';
        _updateSteps(2);
        const codeInput = document.getElementById('emCodeInput');
        if (codeInput) codeInput.value = '';
        try {
            const r = await fetch(`${API}/login/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account, password, phone }) });
            const j = await r.json();
            if (!j.success) document.getElementById('emLoginText').textContent = j.message;
        } catch (e) { _toast('启动失败: ' + e.message, 'error'); }
    }

    async function _loadLoginCreds() {
        try {
            const r = await fetch(`${API}/login/creds`);
            const j = await r.json();
            if (j.success && j.data) {
                document.getElementById('emLoginAccount').value = j.data.account || '';
                document.getElementById('emLoginPassword').value = j.data.password || '';
                document.getElementById('emLoginPhone').value = j.data.phone || '';
                document.getElementById('emLoginPhoneMask').textContent = j.data.phone_display || '';
            }
        } catch (e) { }
    }

    async function _doLogout() {
        if (!confirm('确定退出登录？退出后需重新登录才能发邮件。')) return;
        try {
            await fetch(`${API}/logout`, { method: 'POST' });
            isLoggedIn = false;
            document.getElementById('emStatusDot').className = 'em-dot em-dot-gray';
            document.getElementById('emStatusLabel').textContent = '未登录';
            document.getElementById('emLogoutArea').style.display = 'none';
            _showLoginCredsForm();
            _updateLoginGuard();
            _toast('已退出登录', 'info');
        } catch (e) { _toast('退出失败', 'error'); }
    }

    function _showLoginCredsForm() {
        document.getElementById('emLoginCredsArea').style.display = 'block';
        document.getElementById('emLoginIcon').innerHTML = '&#128274;';
        document.getElementById('emLoginText').textContent = '填写账号密码后点击登录，系统将自动完成登录流程';
        document.getElementById('emLoginSub').textContent = '默认填充上次登录的账号密码，确认无误后点击登录';
        document.getElementById('emLoginActions').innerHTML = '<button class="btn btn-primary" onclick="EmailTool.startLogin()" style="padding:10px 32px;">确认并登录</button>';
        document.getElementById('emLoginCodeArea').style.display = 'none';
        document.getElementById('emLogoutArea').style.display = 'none';
        _updateSteps(1);
    }

    async function _checkLoginStatus() {
        try {
            const r = await fetch(`${API}/login/check`);
            const j = await r.json();
            isLoggedIn = !!j.logged_in;
            if (isLoggedIn) {
                document.getElementById('emStatusDot').className = 'em-dot em-dot-green';
                document.getElementById('emStatusLabel').textContent = '已登录';
                _updateLoginGuard();
            }
        } catch (e) { }
    }

    function _pollLogin() {
        fetch(`${API}/login/status`).then(r => r.json()).then(s => {
            const icon = document.getElementById('emLoginIcon');
            const text = document.getElementById('emLoginText');
            const sub = document.getElementById('emLoginSub');
            const actions = document.getElementById('emLoginActions');
            const codeArea = document.getElementById('emLoginCodeArea');
            const credsArea = document.getElementById('emLoginCredsArea');
            const logoutArea = document.getElementById('emLogoutArea');
            const dot = document.getElementById('emStatusDot');
            const label = document.getElementById('emStatusLabel');

            if (s.status === 'logging_in') {
                icon.innerHTML = '<div class="em-spinner"></div>';
                text.textContent = s.message || '正在自动登录...';
                sub.textContent = '系统正在后台操作';
                actions.innerHTML = '<button class="btn btn-outline" disabled>登录中...</button>';
                codeArea.style.display = 'none'; credsArea.style.display = 'none';
                _updateSteps(2);
                dot.className = 'em-dot em-dot-yellow'; label.textContent = '登录中';
            } else if (s.status === 'waiting_code') {
                icon.innerHTML = '&#128241;';
                text.textContent = '验证码已发送到您的手机';
                sub.textContent = '请在下方输入6位数字验证码';
                actions.innerHTML = '<button class="btn btn-outline" onclick="EmailTool.cancelLogin()">取消登录</button>';
                codeArea.style.display = 'block'; credsArea.style.display = 'none';
                _updateSteps(4);
                setTimeout(() => { const el = document.getElementById('emCodeInput'); if (el) el.focus(); }, 100);
                dot.className = 'em-dot em-dot-yellow'; label.textContent = '等待验证码';
            } else if (s.status === 'verifying') {
                icon.innerHTML = '<div class="em-spinner"></div>';
                text.textContent = '正在验证...';
                codeArea.style.display = 'none';
                _updateSteps(5);
                dot.className = 'em-dot em-dot-yellow'; label.textContent = '验证中';
            } else if (s.status === 'success') {
                isLoggedIn = true;
                icon.innerHTML = '&#9989;';
                text.textContent = '登录成功！可以正常使用邮件发送功能';
                sub.textContent = '邮箱已通过黑箱模式自动登录完成';
                actions.innerHTML = '<button class="btn btn-outline" onclick="EmailTool._showLoginCredsForm()">切换账号</button>';
                codeArea.style.display = 'none'; credsArea.style.display = 'none';
                logoutArea.style.display = 'block';
                _updateSteps(5);
                dot.className = 'em-dot em-dot-green'; label.textContent = '已登录';
                _updateLoginGuard();
            } else if (s.status === 'failed') {
                _showLoginCredsForm();
                icon.innerHTML = '&#10060;';
                text.textContent = s.message || '登录失败，请重试';
                sub.textContent = '';
                dot.className = 'em-dot em-dot-gray'; label.textContent = '未登录';
            }
        }).catch(() => { });
    }

    async function _submitCode(code) {
        if (!code || code.length < 4) { _toast('验证码不完整', 'error'); return; }
        try {
            const r = await fetch(`${API}/login/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
            const j = await r.json();
            if (!j.success) _toast(j.message, 'error');
        } catch (e) { _toast('提交失败', 'error'); }
    }

    async function _cancelLogin() {
        await fetch(`${API}/login/cancel`, { method: 'POST' });
        _updateSteps(1);
        document.getElementById('emLoginIcon').innerHTML = '&#128274;';
        document.getElementById('emLoginText').textContent = '点击下方按钮，系统将自动完成邮箱登录流程';
        document.getElementById('emLoginSub').textContent = '黑箱模式：自动填写账号密码、获取验证码';
        document.getElementById('emLoginActions').innerHTML = '<button class="btn btn-primary" onclick="EmailTool.startLogin()" style="padding:10px 32px;">开始自动登录</button>';
        document.getElementById('emLoginCodeArea').style.display = 'none';
        document.getElementById('emStatusDot').className = 'em-dot em-dot-gray';
        document.getElementById('emStatusLabel').textContent = '未登录';
    }

    // ============ Toast ============
    function _toast(msg, type = 'info') {
        if (typeof ntf === 'function') { ntf(msg, type); return; }
        const el = document.getElementById('toast');
        if (!el) return;
        el.textContent = msg;
        el.className = 'toast show';
        setTimeout(() => { el.className = 'toast'; }, 3000);
    }

    // ============ 公共 API ============
    return {
        init,
        addToCompose: _addToCompose,
        openAddContact: _openAddContact,
        editContact: _editContact,
        saveContact: _saveContact,
        delContact: _delContact,
        hideContactModal: () => _hideModal('emContactModal'),
        openContactPicker: _openContactPicker,
        _togglePicker: _togglePicker,
        confirmPicker: _confirmPicker,
        hidePickerModal: () => _hideModal('emPickerModal'),
        openGroupPicker: _openGroupPicker,
        _toggleGroupCheck: _toggleGroupCheck,
        _toggleGroupMemberCheck: _toggleGroupMemberCheck,
        confirmGroupPicker: _confirmGroupPicker,
        hideGroupPickerModal: () => _hideModal('emGroupPickerModal'),
        handleToKey: _handleToKey,
        handleCcKey: _handleCcKey,
        _removeTo: _removeTo,
        _removeCc: _removeCc,
        execRich: _execRich,
        applyFontSize: _applyFontSize,
        applyLineHeight: _applyLineHeight,
        applyIndent: _applyIndent,
        insertLink: _insertLink,
        insertImage: _insertImage,
        toggleBatchMode: _toggleBatchMode,
        insertVariable: _insertVariable,
        schedulePreviewUpdate: _schedulePreviewUpdate,
        uploadTxtVar: _uploadTxtVar,
        addNewTxtVar: _addNewTxtVar,
        _openVarEdit: _openVarEdit,
        closeVarEdit: _closeVarEdit,
        onVarNameChange: _onVarNameChange,
        onVarValuesChange: _onVarValuesChange,
        _deleteTxtVar: _deleteTxtVar,
        _togglePreviewEdit: _togglePreviewEdit,
        _updatePreviewEdit: _updatePreviewEdit,
        _addPerRecipientFile: _addPerRecipientFile,
        applyTemplate: _applyTemplate,
        saveCurrentAsTemplate: _saveCurrentAsTemplate,
        openNewTemplate: _openNewTemplate,
        hideTemplateModal: () => _hideModal('emTemplateModal'),
        _useTemplate: _useTemplate,
        _editTemplate: _editTemplate,
        _delTemplate: _delTemplate,
        saveTemplateModal: _saveTemplateModal,
        handleTplToKey: _handleTplToKey,
        handleTplCcKey: _handleTplCcKey,
        _removeTplTo: _removeTplTo,
        _removeTplCc: _removeTplCc,
        handleFileSelect: _handleFileSelect,
        handleDrop: _handleDrop,
        _removeAttach: _removeAttach,
        sendEmail: _sendEmail,
        sendBatchEmail: _sendBatchEmail,
        clearCompose: _clearCompose,
        startLogin: _startLogin,
        submitCode: _submitCode,
        cancelLogin: _cancelLogin,
        doLogout: _doLogout,
        _showLoginCredsForm: _showLoginCredsForm,
    };
})();

document.addEventListener('DOMContentLoaded', () => {
    const navEmail = document.getElementById('navEmail');
    if (navEmail) {
        navEmail.addEventListener('click', () => {
            if (!navEmail._inited) { EmailTool.init(); navEmail._inited = true; }
        });
    }
});
