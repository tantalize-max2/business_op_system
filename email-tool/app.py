# -*- coding: utf-8 -*-
"""
邮箱工具 - Flask 后端应用
功能：黑箱自动登录、网页API发信、模板管理、收件人管理
"""

import os
import json
import base64
import threading
import time
import urllib.parse
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)

# ============ 数据存储 ============
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
os.makedirs(DATA_DIR, exist_ok=True)

CONTACTS_FILE = os.path.join(DATA_DIR, 'contacts.json')
TEMPLATES_FILE = os.path.join(DATA_DIR, 'templates.json')
COOKIES_FILE = os.path.join(DATA_DIR, 'cookies.json')
UPLOAD_DIR = os.path.join(DATA_DIR, 'uploads')
os.makedirs(UPLOAD_DIR, exist_ok=True)

LOGIN_CREDS_FILE = os.path.join(DATA_DIR, 'login_creds.json')

MAIL_CONFIG = {
    'username': 'wangy592@chinatelecom.cn',
    'password': 'wY0426!..',
    'auth_code': 'nblaelviyhpdegbh',
    'account': 'wangy592',
    'phone': '18081927229',
}


def load_login_creds():
    """加载上次登录的账号密码"""
    data = load_json(LOGIN_CREDS_FILE, default=None)
    if data and data.get('account'):
        return data
    return {'account': MAIL_CONFIG['account'], 'password': MAIL_CONFIG['password'], 'phone': MAIL_CONFIG['phone']}


def save_login_creds(account, password, phone):
    """保存登录凭证供下次默认使用"""
    save_json(LOGIN_CREDS_FILE, {'account': account, 'password': password, 'phone': phone})

login_state = {
    'status': 'idle',
    'message': '',
    'code': None,
    'browser_open': False,
}


def load_json(filepath, default=None):
    if default is None:
        default = []
    if os.path.exists(filepath):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return default
    return default


def save_json(filepath, data):
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ============ 首页 ============
@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


# ============ 收件人管理 ============
@app.route('/api/contacts', methods=['GET'])
def get_contacts():
    return jsonify({'success': True, 'data': load_json(CONTACTS_FILE)})


@app.route('/api/contacts', methods=['POST'])
def add_contact():
    data = request.json
    contacts = load_json(CONTACTS_FILE)
    contact = {
        'id': int(time.time() * 1000),
        'name': data.get('name', ''),
        'email': data.get('email', ''),
        'group': data.get('group', '默认分组')
    }
    contacts.append(contact)
    save_json(CONTACTS_FILE, contacts)
    return jsonify({'success': True, 'data': contact})


@app.route('/api/contacts/<int:cid>', methods=['DELETE'])
def delete_contact(cid):
    contacts = [c for c in load_json(CONTACTS_FILE) if c.get('id') != cid]
    save_json(CONTACTS_FILE, contacts)
    return jsonify({'success': True})


@app.route('/api/contacts/<int:cid>', methods=['PUT'])
def update_contact(cid):
    data = request.json
    contacts = load_json(CONTACTS_FILE)
    for c in contacts:
        if c.get('id') == cid:
            c['name'] = data.get('name', c['name'])
            c['email'] = data.get('email', c['email'])
            c['group'] = data.get('group', c.get('group', '默认分组'))
            break
    save_json(CONTACTS_FILE, contacts)
    return jsonify({'success': True})


# ============ 分组管理 ============
@app.route('/api/groups', methods=['GET'])
def get_groups():
    """获取所有分组及每个分组的联系人"""
    contacts = load_json(CONTACTS_FILE)
    groups = {}
    for c in contacts:
        g = c.get('group', '默认分组')
        if g not in groups:
            groups[g] = {'name': g, 'count': 0, 'contacts': []}
        groups[g]['count'] += 1
        groups[g]['contacts'].append({'id': c['id'], 'name': c['name'], 'email': c['email'], 'group': g})
    return jsonify({'success': True, 'data': list(groups.values())})


# ============ Cookie 验证 ============
@app.route('/api/login/check', methods=['GET'])
def check_login():
    """检查 Cookie 是否仍然有效"""
    cookies_data = load_json(COOKIES_FILE, default=None)
    if not cookies_data:
        return jsonify({'success': True, 'logged_in': False})

    csrftoken_file = os.path.join(DATA_DIR, 'csrftoken.txt')
    if not os.path.exists(csrftoken_file):
        return jsonify({'success': True, 'logged_in': False})

    with open(csrftoken_file, 'r', encoding='utf-8') as f:
        csrftoken = f.read().strip()

    import re
    csrftoken = re.sub(r'[\u200b\u200c\u200d\ufeff\u00a0\s]', '', csrftoken)
    if not csrftoken:
        return jsonify({'success': True, 'logged_in': False})

    # 尝试用 cookie 发一个轻量请求验证有效性
    try:
        import requests as req
        session = req.Session()
        for c in cookies_data:
            session.cookies.set(c['name'], c['value'], domain=c.get('domain', ''))
        session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'csrftoken': csrftoken,
            'Referer': 'https://mail.chinatelecom.cn/mail/index.html',
        })
        resp = session.post('https://mail.chinatelecom.cn/w2/replay/getRandomNum', timeout=8)
        if resp.status_code == 200 and resp.json().get('code') == 0:
            return jsonify({'success': True, 'logged_in': True})
    except Exception:
        pass

    return jsonify({'success': True, 'logged_in': False})


# ============ txt 变量文件上传 ============
TXT_VARS_DIR = os.path.join(DATA_DIR, 'txt_vars')
os.makedirs(TXT_VARS_DIR, exist_ok=True)


@app.route('/api/txt-vars', methods=['POST'])
def upload_txt_var():
    """上传 txt 文件作为变量源，每行一个值"""
    f = request.files.get('file')
    if not f or not f.filename:
        return jsonify({'success': False, 'message': '请选择文件'}), 400
    if not f.filename.endswith('.txt'):
        return jsonify({'success': False, 'message': '仅支持 .txt 文件'}), 400

    basename = os.path.splitext(f.filename)[0]
    content = f.read().decode('utf-8', errors='ignore')
    lines = [line.strip() for line in content.split('\n') if line.strip()]

    save_path = os.path.join(TXT_VARS_DIR, f'{basename}.json')
    save_json(save_path, {'name': basename, 'values': lines})

    return jsonify({'success': True, 'data': {'name': basename, 'count': len(lines)}})


@app.route('/api/txt-vars', methods=['GET'])
def list_txt_vars():
    """列出所有已上传的 txt 变量文件"""
    result = []
    for fname in os.listdir(TXT_VARS_DIR):
        if fname.endswith('.json'):
            data = load_json(os.path.join(TXT_VARS_DIR, fname), default={})
            if data:
                result.append({'name': data.get('name', ''), 'count': len(data.get('values', []))})
    return jsonify({'success': True, 'data': result})


@app.route('/api/txt-vars/<name>', methods=['GET'])
def get_txt_var(name):
    """获取某个 txt 变量文件的值列表"""
    fpath = os.path.join(TXT_VARS_DIR, f'{name}.json')
    data = load_json(fpath, default=None)
    if not data:
        return jsonify({'success': False, 'message': '变量文件不存在'}), 404
    return jsonify({'success': True, 'data': data})


@app.route('/api/txt-vars/<name>', methods=['DELETE'])
def delete_txt_var(name):
    """删除某个 txt 变量文件"""
    fpath = os.path.join(TXT_VARS_DIR, f'{name}.json')
    if os.path.exists(fpath):
        os.remove(fpath)
    return jsonify({'success': True})


# ============ 图片上传（正文插入） ============
@app.route('/api/upload-image', methods=['POST'])
def upload_image():
    """上传图片文件，返回可访问的URL"""
    f = request.files.get('file')
    if not f or not f.filename:
        return jsonify({'success': False, 'message': '请选择图片'}), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'):
        return jsonify({'success': False, 'message': '仅支持图片文件'}), 400
    fname = f'{int(time.time()*1000)}{ext}'
    fpath = os.path.join(UPLOAD_DIR, fname)
    f.save(fpath)
    return jsonify({'success': True, 'data': {'url': f'/uploads/{fname}', 'filename': fname}})


# 静态文件服务：上传的图片
@app.route('/uploads/<path:filename>')
def serve_upload(filename):
    return send_from_directory(UPLOAD_DIR, filename)


# ============ 模板管理 ============
@app.route('/api/templates', methods=['GET'])
def get_templates():
    return jsonify({'success': True, 'data': load_json(TEMPLATES_FILE)})


@app.route('/api/templates', methods=['POST'])
def add_template():
    data = request.json
    templates = load_json(TEMPLATES_FILE)
    template = {
        'id': int(time.time() * 1000),
        'name': data.get('name', '未命名模板'),
        'subject': data.get('subject', ''),
        'body': data.get('body', ''),
        'to': data.get('to', []),
        'cc': data.get('cc', []),
    }
    templates.append(template)
    save_json(TEMPLATES_FILE, templates)
    return jsonify({'success': True, 'data': template})


@app.route('/api/templates/<int:tid>', methods=['DELETE'])
def delete_template(tid):
    templates = [t for t in load_json(TEMPLATES_FILE) if t.get('id') != tid]
    save_json(TEMPLATES_FILE, templates)
    return jsonify({'success': True})


@app.route('/api/templates/<int:tid>', methods=['PUT'])
def update_template(tid):
    data = request.json
    templates = load_json(TEMPLATES_FILE)
    for t in templates:
        if t.get('id') == tid:
            t['name'] = data.get('name', t['name'])
            t['subject'] = data.get('subject', t['subject'])
            t['body'] = data.get('body', t['body'])
            if 'to' in data:
                t['to'] = data['to']
            if 'cc' in data:
                t['cc'] = data['cc']
            break
    save_json(TEMPLATES_FILE, templates)
    return jsonify({'success': True})


# ============ 邮件发送（网页API方式） ============
@app.route('/api/send', methods=['POST'])
def send_email():
    """通过网页邮箱API发送邮件（用登录后的cookie调用）"""
    import json as _json

    to_emails = _json.loads(request.form.get('to', '[]'))
    cc_emails = _json.loads(request.form.get('cc', '[]'))
    subject = request.form.get('subject', '')
    body = request.form.get('body', '')

    if not to_emails:
        return jsonify({'success': False, 'message': '请填写收件人'}), 400
    if not subject:
        return jsonify({'success': False, 'message': '请填写邮件主题'}), 400

    cookies_data = load_json(COOKIES_FILE, default=None)
    if not cookies_data:
        return jsonify({'success': False, 'message': '请先登录邮箱（点击登录管理进行黑箱登录）'}), 400

    try:
        import requests as req

        session = req.Session()
        for c in cookies_data:
            session.cookies.set(c['name'], c['value'], domain=c.get('domain', ''))

        session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://mail.chinatelecom.cn/mail/index.html',
        })

        # 读取csrftoken
        csrftoken_file = os.path.join(DATA_DIR, 'csrftoken.txt')
        if not os.path.exists(csrftoken_file):
            return jsonify({'success': False, 'message': '登录会话已过期，请重新登录邮箱'}), 400

        with open(csrftoken_file, 'r', encoding='utf-8') as f:
            csrftoken = f.read().strip()

        # 清理零宽字符
        import re
        csrftoken = re.sub(r'[\u200b\u200c\u200d\ufeff\u00a0\s]', '', csrftoken)

        if not csrftoken:
            return jsonify({'success': False, 'message': '登录会话已过期，请重新登录邮箱'}), 400

        # 1. 获取securityCode
        session.headers.update({'csrftoken': csrftoken})
        random_resp = session.post('https://mail.chinatelecom.cn/w2/replay/getRandomNum', timeout=10)
        if random_resp.status_code != 200:
            return jsonify({'success': False, 'message': f'获取安全码失败 (HTTP {random_resp.status_code})'}), 500

        random_data = random_resp.json()
        if random_data.get('code') != 0:
            return jsonify({'success': False, 'message': f'获取安全码失败: {random_data.get("desc", "未知错误")}'}), 500

        security_code = random_data.get('data', '')

        # 2. 构造邮件正文（base64编码的HTML）
        html_body = body.replace('\n', '<br>') if '<' not in body else body
        if '<p>' not in html_body and '<br>' not in html_body and '<div' not in html_body:
            html_body = '<p>' + html_body + '</p>'

        content_b64 = base64.b64encode(html_body.encode('utf-8')).decode('utf-8')

        # 3. 处理附件
        attachment_list = []
        attachment_name_list = []
        upload_errors = []
        uploaded_files = request.files.getlist('files')

        for f in uploaded_files:
            if f.filename:
                tmp_path = os.path.join(UPLOAD_DIR, f.filename)
                f.save(tmp_path)
                try:
                    file_key = _upload_attachment(session, csrftoken, tmp_path, f.filename)
                    if file_key:
                        attachment_list.append(file_key)
                        attachment_name_list.append(f.filename)
                    else:
                        upload_errors.append(f"附件 '{f.filename}' 上传失败")
                except Exception as e:
                    upload_errors.append(f"附件 '{f.filename}' 上传异常: {str(e)}")
                finally:
                    try:
                        os.remove(tmp_path)
                    except OSError:
                        pass

        # 4. 发送邮件
        # 附件列表使用逗号分隔格式（JSON格式无法附带附件）
        if attachment_list:
            attachment_list_str = ','.join(attachment_list)
            attachment_name_list_str = ','.join(attachment_name_list)
        else:
            attachment_list_str = ''
            attachment_name_list_str = ''

        send_data = {
            'from': MAIL_CONFIG['username'],
            'to': ','.join(to_emails),
            'cc': ','.join(cc_emails),
            'bcc': '',
            'fast': '0',
            'content': content_b64,
            'contentType': '1',
            'subject': subject,
            'attachmentList': attachment_list_str,
            'attachmentNameList': attachment_name_list_str,
            'dnt': '0',
            'action': 'send',
            'sendMode': '0',
            'saveSended': '1',
            'securityDestroy': '0',
            'acceptSmsphones': '',
            'acceptSmsKey': '',
            'securityCode': security_code,
        }

        # 手动构建 URL 编码的请求体，使用 UTF-8 编码
        import urllib.parse
        encoded_body = urllib.parse.urlencode(send_data, encoding='utf-8')

        send_resp = session.post(
            'https://mail.chinatelecom.cn/w2/mail/sendMail',
            data=encoded_body.encode('utf-8'),
            headers={'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'},
            timeout=30
        )

        if send_resp.status_code != 200:
            return jsonify({'success': False, 'message': f'发信接口返回错误 (HTTP {send_resp.status_code})'}), 500

        result = send_resp.json()

        if result.get('code') == 0:
            msg = f'邮件已成功发送至 {len(to_emails)} 位收件人'
            if attachment_list and uploaded_files and len(attachment_list) < len(uploaded_files):
                msg += '（部分附件上传失败）'
            if upload_errors:
                msg += f'。附件问题: {"; ".join(upload_errors)}'
            return jsonify({'success': True, 'message': msg})
        else:
            return jsonify({'success': False, 'message': f'发送失败: {result.get("desc", "未知错误")}'}), 500

    except req.exceptions.ConnectionError:
        return jsonify({'success': False, 'message': '网络连接失败'}), 500
    except Exception as e:
        return jsonify({'success': False, 'message': f'发送失败: {str(e)}'}), 500


def _upload_attachment(session, csrftoken, file_path, filename):
    """上传附件到邮箱服务器，返回 fileKey"""
    url = 'https://mail.chinatelecom.cn/w2/common/uploadFile'

    # 上传附件时需要带 csrftoken 请求头和其他必要头
    upload_headers = {
        'csrftoken': csrftoken,
        'Origin': 'https://mail.chinatelecom.cn',
        'Referer': 'https://mail.chinatelecom.cn/mail/index.html',
    }

    # 使用文件对象直接上传
    with open(file_path, 'rb') as f:
        files = {
            'file': (filename, f, 'application/octet-stream')
        }
        resp = session.post(url, files=files, headers=upload_headers, timeout=60)

    if resp.status_code == 200:
        try:
            data = resp.json()
            print(f"附件上传响应: code={data.get('code')}, desc={data.get('desc')}, data={data.get('data')}")
            if data.get('code') == 0 and data.get('data'):
                return data['data'][0].get('fileKey', '')
            else:
                print(f"上传附件失败: {data.get('desc', '未知错误')}")
        except Exception as e:
            print(f"解析附件上传响应失败: {e}, 响应内容: {resp.text[:500]}")
    else:
        print(f"附件上传HTTP错误: {resp.status_code}, 响应: {resp.text[:500]}")
    return None


# ============ 黑箱登录 ============
@app.route('/api/login/status', methods=['GET'])
def get_login_status():
    return jsonify(login_state)


@app.route('/api/login/start', methods=['POST'])
def start_login():
    global login_state, MAIL_CONFIG
    if login_state.get('status') in ('logging_in', 'waiting_code', 'verifying'):
        return jsonify({'success': False, 'message': '登录流程进行中，请稍候'})

    # 接收前端传入的账号密码
    data = request.json or {}
    account = data.get('account', '').strip()
    password = data.get('password', '').strip()
    phone = data.get('phone', '').strip()

    if account:
        MAIL_CONFIG['account'] = account
    if password:
        MAIL_CONFIG['password'] = password
    if phone:
        MAIL_CONFIG['phone'] = phone

    # 保存凭证供下次使用
    save_login_creds(MAIL_CONFIG['account'], MAIL_CONFIG['password'], MAIL_CONFIG['phone'])

    login_state = {
        'status': 'logging_in',
        'message': '正在启动浏览器自动登录...',
        'code': None,
        'browser_open': False,
    }

    thread = threading.Thread(target=_blackbox_login_worker, daemon=True)
    thread.start()
    return jsonify({'success': True, 'message': '登录流程已启动'})


@app.route('/api/login/creds', methods=['GET'])
def get_login_creds_api():
    """获取上次登录的账号密码（用于前端预填）"""
    creds = load_login_creds()
    # 手机号脱敏
    phone = creds.get('phone', '')
    phone_display = phone[:3] + '****' + phone[-4:] if len(phone) >= 7 else phone
    return jsonify({
        'success': True,
        'data': {
            'account': creds.get('account', ''),
            'password': creds.get('password', ''),
            'phone': phone,
            'phone_display': phone_display,
        }
    })


@app.route('/api/logout', methods=['POST'])
def logout():
    """退出登录：清除 cookie 和 csrftoken"""
    global login_state
    login_state = {'status': 'idle', 'message': '已退出登录', 'code': None, 'browser_open': False}
    # 删除 cookie 和 csrftoken 文件
    if os.path.exists(COOKIES_FILE):
        os.remove(COOKIES_FILE)
    csrftoken_file = os.path.join(DATA_DIR, 'csrftoken.txt')
    if os.path.exists(csrftoken_file):
        os.remove(csrftoken_file)
    return jsonify({'success': True, 'message': '已退出登录'})


@app.route('/api/login/verify', methods=['POST'])
def submit_verify_code():
    global login_state
    if login_state.get('status') != 'waiting_code':
        return jsonify({'success': False, 'message': '当前不需要验证码'})
    code = request.json.get('code', '')
    if not code or len(code) < 4:
        return jsonify({'success': False, 'message': '验证码格式不正确'})
    login_state['code'] = code
    login_state['status'] = 'verifying'
    login_state['message'] = '正在提交验证码...'
    return jsonify({'success': True, 'message': '验证码已提交'})


@app.route('/api/login/cancel', methods=['POST'])
def cancel_login():
    global login_state
    login_state['status'] = 'idle'
    login_state['message'] = '登录已取消'
    login_state['code'] = None
    return jsonify({'success': True})


def _blackbox_login_worker():
    """黑箱自动登录 + 保存cookie和csrftoken"""
    global login_state
    browser = None
    try:
        from playwright.sync_api import sync_playwright

        login_state['message'] = '正在启动浏览器...'
        chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'

        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                executable_path=chrome_path,
                args=['--no-sandbox', '--disable-blink-features=AutomationControlled']
            )
            context = browser.new_context(
                viewport={'width': 1280, 'height': 800},
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            )
            page = context.new_page()

            # 步骤1: 打开登录页
            login_state['message'] = '正在打开邮箱登录页面...'
            page.goto('https://mail.chinatelecom.cn/mail/index.html#/user/login',
                       wait_until='networkidle', timeout=30000)
            page.wait_for_timeout(3000)

            # 步骤2: 输入账号
            login_state['message'] = '正在填入账号...'
            account_input = page.get_by_placeholder('邮箱账号/管理员账号')
            account_input.wait_for(state='visible', timeout=10000)
            account_input.click()
            page.wait_for_timeout(300)
            account_input.fill(MAIL_CONFIG['account'])
            page.wait_for_timeout(500)

            # 步骤3: 输入密码
            login_state['message'] = '正在填入密码...'
            pwd_input = page.get_by_placeholder('输入邮箱密码')
            pwd_input.wait_for(state='visible', timeout=5000)
            pwd_input.click()
            page.wait_for_timeout(200)
            pwd_input.fill(MAIL_CONFIG['password'])
            page.wait_for_timeout(500)

            # 步骤4: 点击登录
            login_state['message'] = '正在点击登录...'
            login_btn = page.get_by_role('button', name='登 录')
            login_btn.wait_for(state='visible', timeout=5000)
            login_btn.click()
            login_state['message'] = '等待二次验证页面...'
            page.wait_for_url('**/user/auth**', timeout=15000)
            page.wait_for_timeout(2000)

            # 步骤5: 切换到手机验证码
            login_state['message'] = '正在切换到手机验证码验证...'
            sms_radio = page.get_by_role('radio', name='手机验证码验证')
            sms_radio.wait_for(state='visible', timeout=10000)
            sms_radio.click()
            page.wait_for_timeout(1500)

            # 步骤6: 获取验证码
            login_state['message'] = '正在获取验证码...'
            get_code_btn = page.get_by_role('button', name='获取验证码')
            get_code_btn.wait_for(state='visible', timeout=10000)
            get_code_btn.click()
            page.wait_for_timeout(2000)

            login_state['status'] = 'waiting_code'
            login_state['message'] = '验证码已发送到手机 180****7229，请在下方输入'

            # 步骤7: 等待用户输入验证码
            wait_start = time.time()
            while login_state.get('status') == 'waiting_code':
                page.wait_for_timeout(500)
                elapsed = time.time() - wait_start
                if int(elapsed) % 20 == 0 and int(elapsed) > 0:
                    try:
                        page.mouse.move(100, 100)
                        page.mouse.move(200, 200)
                    except Exception:
                        pass
                if elapsed > 300:
                    login_state['status'] = 'failed'
                    login_state['message'] = '等待验证码超时（5分钟）'
                    return

            if login_state.get('status') != 'verifying':
                return

            code = login_state.get('code', '')
            login_state['message'] = '正在填入验证码...'

            # 步骤8: 填入验证码
            try:
                code_input = page.locator('input[placeholder="请输入验证码"]')
                code_input.wait_for(state='visible', timeout=15000)
                code_input.click()
                page.wait_for_timeout(200)
                code_input.fill('')
                code_input.fill(code)
                page.wait_for_timeout(500)
            except Exception as e:
                login_state['status'] = 'failed'
                login_state['message'] = f'未找到验证码输入框: {str(e)}'
                return

            # 步骤9: 点击"确 定"
            login_state['message'] = '正在确认登录...'
            clicked = False
            for sel in ['button.confirm-btn', 'button.ant-btn-primary.confirm-btn']:
                try:
                    btn = page.locator(sel)
                    if btn.count() > 0 and btn.first.is_visible(timeout=3000):
                        btn.first.click()
                        clicked = True
                        break
                except Exception:
                    continue

            if not clicked:
                page.wait_for_timeout(3000)
                current_url = page.url
                if 'login' not in current_url.lower() and 'auth' not in current_url.lower():
                    clicked = True

            if not clicked:
                login_state['status'] = 'failed'
                login_state['message'] = '登录确认失败，请重试'
                return

            # 步骤10: 等待登录完成
            page.wait_for_timeout(5000)
            current_url = page.url

            login_success = False
            if 'login' not in current_url.lower() and 'auth' not in current_url.lower():
                login_success = True
            else:
                try:
                    if page.locator('text=退出').count() > 0 or page.locator('text=资源管理').count() > 0:
                        login_success = True
                except Exception:
                    pass

            if login_success:
                # ===== 保存cookie和csrftoken =====
                cookies = context.cookies()
                save_json(COOKIES_FILE, cookies)

                try:
                    csrftoken = page.evaluate(
                        '() => { try { const d = JSON.parse(localStorage.getItem("N_W_C_T") || "{}"); '
                        'const keys = Object.keys(d).filter(k => d[k] === true); '
                        'return keys.length > 0 ? keys[keys.length - 1] : ""; } catch(e) { return ""; } }'
                    )
                    # 清理零宽字符和空白字符
                    if csrftoken:
                        import re
                        csrftoken = re.sub(r'[\u200b\u200c\u200d\ufeff\u00a0\s]', '', csrftoken)
                    if csrftoken:
                        with open(os.path.join(DATA_DIR, 'csrftoken.txt'), 'w') as f:
                            f.write(csrftoken)
                except Exception:
                    pass

                login_state['status'] = 'success'
                login_state['message'] = '登录成功！可以正常发送邮件了。'
            else:
                login_state['status'] = 'failed'
                login_state['message'] = '登录失败，请重试。'

            login_state['browser_open'] = False
            try:
                browser.close()
            except Exception:
                pass

    except ImportError:
        login_state['status'] = 'failed'
        login_state['message'] = 'Playwright未正确安装'
    except Exception as e:
        login_state['status'] = 'failed'
        login_state['message'] = f'登录过程出错: {str(e)}'
        login_state['browser_open'] = False
        try:
            if browser:
                browser.close()
        except Exception:
            pass


# ============ 批量个性化发信 ============
@app.route('/api/batch-send', methods=['POST'])
def batch_send_email():
    """批量个性化发送 - 每人一封，模板变量替换后逐个发送"""
    import json as _json

    items_json = request.form.get('items', '[]')
    cc_emails = _json.loads(request.form.get('cc', '[]'))

    try:
        items = _json.loads(items_json)
    except Exception:
        return jsonify({'success': False, 'message': '发信数据格式错误'}), 400

    if not items:
        return jsonify({'success': False, 'message': '请添加至少一位收件人'}), 400

    cookies_data = load_json(COOKIES_FILE, default=None)
    if not cookies_data:
        return jsonify({'success': False, 'message': '请先登录邮箱（点击登录管理进行黑箱登录）'}), 400

    try:
        import requests as req

        session = req.Session()
        for c in cookies_data:
            session.cookies.set(c['name'], c['value'], domain=c.get('domain', ''))

        session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://mail.chinatelecom.cn/mail/index.html',
        })

        csrftoken_file = os.path.join(DATA_DIR, 'csrftoken.txt')
        if not os.path.exists(csrftoken_file):
            return jsonify({'success': False, 'message': '登录会话已过期，请重新登录邮箱'}), 400

        with open(csrftoken_file, 'r', encoding='utf-8') as f:
            csrftoken = f.read().strip()

        import re
        csrftoken = re.sub(r'[\u200b\u200c\u200d\ufeff\u00a0\s]', '', csrftoken)

        if not csrftoken:
            return jsonify({'success': False, 'message': '登录会话已过期，请重新登录邮箱'}), 400

        session.headers.update({'csrftoken': csrftoken})

        # 通用附件（所有收件人共用） - 保留临时文件，每封邮件重新上传
        common_tmp_files = []  # [(tmp_path, original_filename), ...]
        uploaded_files = request.files.getlist('files')

        for f in uploaded_files:
            if f.filename:
                tmp_path = os.path.join(UPLOAD_DIR, f'common_{int(time.time()*1000)}_{f.filename}')
                f.save(tmp_path)
                common_tmp_files.append((tmp_path, f.filename))

        # 逐个发送
        success_count = 0
        fail_list = []

        for idx, item in enumerate(items):
            to_email = item.get('to', '')
            subject = item.get('subject', '')
            body = item.get('body', '')

            if not to_email or not subject:
                fail_list.append(f"{to_email}: 缺少收件人或主题")
                continue

            # 每封邮件获取新的 securityCode
            random_resp = session.post('https://mail.chinatelecom.cn/w2/replay/getRandomNum', timeout=10)
            if random_resp.status_code != 200:
                fail_list.append(f"{to_email}: 获取安全码失败")
                continue

            random_data = random_resp.json()
            if random_data.get('code') != 0:
                fail_list.append(f"{to_email}: 获取安全码失败")
                continue

            security_code = random_data.get('data', '')

            html_body = body.replace('\n', '<br>') if '<' not in body else body
            if '<p>' not in html_body and '<br>' not in html_body and '<div' not in html_body:
                html_body = '<p>' + html_body + '</p>'

            content_b64 = base64.b64encode(html_body.encode('utf-8')).decode('utf-8')

            # 每封邮件重新上传通用附件（避免 fileKey 被上一次发送消费掉）
            common_keys = []
            common_names = []
            for tmp_path, orig_name in common_tmp_files:
                try:
                    file_key = _upload_attachment(session, csrftoken, tmp_path, orig_name)
                    if file_key:
                        common_keys.append(file_key)
                        common_names.append(orig_name)
                except Exception:
                    pass

            # 上传该收件人的个性化附件
            per_files = request.files.getlist(f'files_{idx}')
            per_keys = []
            per_names = []
            for f in per_files:
                if f.filename:
                    per_tmp = os.path.join(UPLOAD_DIR, f'per_{int(time.time()*1000)}_{f.filename}')
                    f.save(per_tmp)
                    try:
                        file_key = _upload_attachment(session, csrftoken, per_tmp, f.filename)
                        if file_key:
                            per_keys.append(file_key)
                            per_names.append(f.filename)
                    except Exception:
                        pass
                    finally:
                        try:
                            os.remove(per_tmp)
                        except OSError:
                            pass

            # 合并通用附件 + 个性化附件
            all_att_keys = common_keys + per_keys
            all_att_names = common_names + per_names

            att_list_str = ','.join(all_att_keys) if all_att_keys else ''
            att_name_str = ','.join(all_att_names) if all_att_names else ''

            send_data = {
                'from': MAIL_CONFIG['username'],
                'to': to_email,
                'cc': ','.join(cc_emails),
                'bcc': '',
                'fast': '0',
                'content': content_b64,
                'contentType': '1',
                'subject': subject,
                'attachmentList': att_list_str,
                'attachmentNameList': att_name_str,
                'dnt': '0',
                'action': 'send',
                'sendMode': '0',
                'saveSended': '1',
                'securityDestroy': '0',
                'acceptSmsphones': '',
                'acceptSmsKey': '',
                'securityCode': security_code,
            }

            encoded_body = urllib.parse.urlencode(send_data, encoding='utf-8')
            send_resp = session.post(
                'https://mail.chinatelecom.cn/w2/mail/sendMail',
                data=encoded_body.encode('utf-8'),
                headers={'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'},
                timeout=30
            )

            if send_resp.status_code == 200:
                result = send_resp.json()
                if result.get('code') == 0:
                    success_count += 1
                else:
                    fail_list.append(f"{to_email}: {result.get('desc', '发送失败')}")
            else:
                fail_list.append(f"{to_email}: HTTP {send_resp.status_code}")

        msg = f'成功发送 {success_count}/{len(items)} 封邮件'
        if fail_list:
            msg += f'，失败详情: {"; ".join(fail_list[:5])}'

        # 清理通用附件临时文件
        for tmp_path, _ in common_tmp_files:
            try:
                os.remove(tmp_path)
            except OSError:
                pass

        return jsonify({
            'success': success_count > 0,
            'message': msg,
            'success_count': success_count,
            'fail_count': len(fail_list)
        })

    except req.exceptions.ConnectionError:
        return jsonify({'success': False, 'message': '网络连接失败'}), 500
    except Exception as e:
        return jsonify({'success': False, 'message': f'批量发送失败: {str(e)}'}), 500


# ============ 邮箱配置信息 ============
@app.route('/api/mail-config', methods=['GET'])
def get_mail_config():
    return jsonify({
        'success': True,
        'data': {
            'smtp_server': 'smtp.chinatelecom.cn',
            'smtp_port': 587,
            'pop3_server': 'pop.chinatelecom.cn',
            'pop3_port': 995,
            'imap_server': 'imap.chinatelecom.cn',
            'imap_port': 993,
            'username': MAIL_CONFIG['username'],
            'send_method': 'webapi',
        }
    })


# ============ 启动 ============
if __name__ == '__main__':
    print("=" * 55)
    print("    邮箱工具 已启动")
    print("    访问地址: http://localhost:5555")
    print("    发信方式: 网页API（需先黑箱登录）")
    print("=" * 55)
    app.run(host='0.0.0.0', port=5555, debug=True)
