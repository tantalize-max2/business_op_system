# -*- coding: utf-8 -*-
import os
import re
import json
import time
import base64
import threading
import urllib.parse
from config import (MAIL_CONFIG, EMAIL_DATA_DIR, EMAIL_CONTACTS_FILE, EMAIL_TEMPLATES_FILE,
                    EMAIL_COOKIES_FILE, EMAIL_UPLOAD_DIR, EMAIL_LOGIN_CREDS_FILE, TXT_VARS_DIR)
from services.email_service import (load_json, save_json, create_mail_session,
                                     load_csrftoken, get_security_code, upload_attachment,
                                     build_html_body, send_mail_api, encode_attachment_name)

login_state = {
    'status': 'idle',
    'message': '',
    'code': None,
    'browser_open': False,
}

# 启动时自动加载持久化的登录凭证到 MAIL_CONFIG
_saved_creds = load_json(EMAIL_LOGIN_CREDS_FILE, default=None)
if _saved_creds:
    if _saved_creds.get('account'): MAIL_CONFIG['account'] = _saved_creds['account']
    if _saved_creds.get('password'): MAIL_CONFIG['password'] = _saved_creds['password']
    if _saved_creds.get('phone'): MAIL_CONFIG['phone'] = _saved_creds['phone']
    if _saved_creds.get('username'): MAIL_CONFIG['username'] = _saved_creds['username']


def get_login_state():
    return login_state


def set_login_state(state):
    global login_state
    login_state = state


def load_login_creds():
    data = load_json(EMAIL_LOGIN_CREDS_FILE, default=None)
    if data and data.get('account'):
        return data
    return {'account': MAIL_CONFIG['account'], 'password': MAIL_CONFIG['password'],
            'phone': MAIL_CONFIG['phone'], 'username': MAIL_CONFIG['username']}


def save_login_creds(account, password, phone, username=None):
    save_json(EMAIL_LOGIN_CREDS_FILE, {
        'account': account, 'password': password, 'phone': phone,
        'username': username or f'{account}@chinatelecom.cn'
    })


def get_contacts():
    return load_json(EMAIL_CONTACTS_FILE)


def add_contact(data):
    contacts = load_json(EMAIL_CONTACTS_FILE)
    contact = {
        'id': int(time.time() * 1000),
        'name': data.get('name', ''),
        'email': data.get('email', ''),
        'group': data.get('group', '默认分组')
    }
    contacts.append(contact)
    save_json(EMAIL_CONTACTS_FILE, contacts)
    return contact


def delete_contact(cid):
    contacts = [c for c in load_json(EMAIL_CONTACTS_FILE) if c.get('id') != cid]
    save_json(EMAIL_CONTACTS_FILE, contacts)


def update_contact(cid, data):
    contacts = load_json(EMAIL_CONTACTS_FILE)
    for c in contacts:
        if c.get('id') == cid:
            c['name'] = data.get('name', c['name'])
            c['email'] = data.get('email', c['email'])
            c['group'] = data.get('group', c.get('group', '默认分组'))
            break
    save_json(EMAIL_CONTACTS_FILE, contacts)


def get_groups():
    contacts = load_json(EMAIL_CONTACTS_FILE)
    groups = {}
    for c in contacts:
        g = c.get('group', '默认分组')
        if g not in groups:
            groups[g] = {'name': g, 'count': 0, 'contacts': []}
        groups[g]['count'] += 1
        groups[g]['contacts'].append({'id': c['id'], 'name': c['name'], 'email': c['email'], 'group': g})
    return list(groups.values())


def check_login():
    cookies_data = load_json(EMAIL_COOKIES_FILE, default=None)
    if not cookies_data:
        return False
    csrftoken = load_csrftoken(EMAIL_DATA_DIR)
    if not csrftoken:
        return False
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
            return True
    except Exception:
        pass
    return False


def upload_txt_var(filename, content):
    lines = [line.strip() for line in content.split('\n') if line.strip()]
    basename = os.path.splitext(filename)[0]
    save_path = os.path.join(TXT_VARS_DIR, f'{basename}.json')
    save_json(save_path, {'name': basename, 'values': lines})
    return {'name': basename, 'count': len(lines)}


def list_txt_vars():
    result = []
    for fname in os.listdir(TXT_VARS_DIR):
        if fname.endswith('.json'):
            data = load_json(os.path.join(TXT_VARS_DIR, fname), default={})
            if data:
                result.append({'name': data.get('name', ''), 'count': len(data.get('values', []))})
    return result


def get_txt_var(name):
    fpath = os.path.join(TXT_VARS_DIR, f'{name}.json')
    data = load_json(fpath, default=None)
    return data


def delete_txt_var(name):
    fpath = os.path.join(TXT_VARS_DIR, f'{name}.json')
    if os.path.exists(fpath):
        os.remove(fpath)


def save_uploaded_image(file_obj):
    ext = os.path.splitext(file_obj.filename)[1].lower()
    if ext not in ('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'):
        return None
    fname = f'{int(time.time()*1000)}{ext}'
    fpath = os.path.join(EMAIL_UPLOAD_DIR, fname)
    file_obj.save(fpath)
    return {'url': f'/email-uploads/{fname}', 'filename': fname}


def get_templates():
    return load_json(EMAIL_TEMPLATES_FILE)


def add_template(data):
    templates = load_json(EMAIL_TEMPLATES_FILE)
    template = {
        'id': int(time.time() * 1000),
        'name': data.get('name', '未命名模板'),
        'subject': data.get('subject', ''),
        'body': data.get('body', ''),
        'to': data.get('to', []),
        'cc': data.get('cc', []),
        'batchMode': data.get('batchMode', False),
    }
    templates.append(template)
    save_json(EMAIL_TEMPLATES_FILE, templates)
    return template


def delete_template(tid):
    templates = [t for t in load_json(EMAIL_TEMPLATES_FILE) if t.get('id') != tid]
    save_json(EMAIL_TEMPLATES_FILE, templates)


def update_template(tid, data):
    templates = load_json(EMAIL_TEMPLATES_FILE)
    for t in templates:
        if t.get('id') == tid:
            t['name'] = data.get('name', t['name'])
            t['subject'] = data.get('subject', t['subject'])
            t['body'] = data.get('body', t['body'])
            if 'to' in data:
                t['to'] = data['to']
            if 'cc' in data:
                t['cc'] = data['cc']
            if 'batchMode' in data:
                t['batchMode'] = data['batchMode']
            break
    save_json(EMAIL_TEMPLATES_FILE, templates)


def send_email(to_emails, cc_emails, subject, body, uploaded_files):
    cookies_data = load_json(EMAIL_COOKIES_FILE, default=None)
    if not cookies_data:
        return {'ok': False, 'error': '请先登录邮箱（点击登录管理进行黑箱登录）'}
    try:
        import requests as req
        session = create_mail_session(cookies_data)
        csrftoken = load_csrftoken(EMAIL_DATA_DIR)
        if not csrftoken:
            return {'ok': False, 'error': '登录会话已过期，请重新登录邮箱'}

        security_code, err = get_security_code(session, csrftoken)
        if err:
            return {'ok': False, 'error': err}

        html_body = build_html_body(body)
        content_b64 = base64.b64encode(html_body.encode('utf-8')).decode('utf-8')

        attachment_list, attachment_name_list, upload_errors = [], [], []
        for f in uploaded_files:
            if f.filename:
                tmp_path = os.path.join(EMAIL_UPLOAD_DIR, f.filename)
                f.save(tmp_path)
                try:
                    file_key = upload_attachment(session, csrftoken, tmp_path, f.filename)
                    if file_key:
                        attachment_list.append(file_key)
                        attachment_name_list.append(encode_attachment_name(f.filename))
                    else:
                        upload_errors.append(f"附件 '{f.filename}' 上传失败")
                except Exception as e:
                    upload_errors.append(f"附件 '{f.filename}' 上传异常: {str(e)}")
                finally:
                    try: os.remove(tmp_path)
                    except OSError: pass

        attachment_list_str = ','.join(attachment_list)
        attachment_name_list_str = ','.join(attachment_name_list)

        send_resp = send_mail_api(
            session, MAIL_CONFIG['username'], to_emails, cc_emails, subject,
            content_b64, attachment_list_str, attachment_name_list_str, security_code
        )

        if send_resp.status_code != 200:
            return {'ok': False, 'error': f'发信接口返回错误 (HTTP {send_resp.status_code})'}
        result = send_resp.json()
        if result.get('code') == 0:
            msg = f'邮件已成功发送至 {len(to_emails)} 位收件人'
            if attachment_list and uploaded_files and len(attachment_list) < len(uploaded_files):
                msg += '（部分附件上传失败）'
            if upload_errors:
                msg += f'。附件问题: {"; ".join(upload_errors)}'
            return {'ok': True, 'message': msg}
        else:
            return {'ok': False, 'error': f'发送失败: {result.get("desc", "未知错误")}'}
    except req.exceptions.ConnectionError:
        return {'ok': False, 'error': '网络连接失败'}
    except Exception as e:
        return {'ok': False, 'error': f'发送失败: {str(e)}'}


def batch_send_email(items, cc_emails, common_files, per_files_map):
    cookies_data = load_json(EMAIL_COOKIES_FILE, default=None)
    if not cookies_data:
        return {'ok': False, 'error': '请先登录邮箱'}
    try:
        import requests as req
        session = create_mail_session(cookies_data)
        csrftoken = load_csrftoken(EMAIL_DATA_DIR)
        if not csrftoken:
            return {'ok': False, 'error': '登录会话已过期，请重新登录邮箱'}

        session.headers.update({'csrftoken': csrftoken})

        common_tmp_files = []
        for f in common_files:
            if f.filename:
                tmp_path = os.path.join(EMAIL_UPLOAD_DIR, f'common_{int(time.time()*1000)}_{f.filename}')
                f.save(tmp_path)
                common_tmp_files.append((tmp_path, f.filename))

        success_count, fail_list = 0, []
        for idx, item in enumerate(items):
            to_email = item.get('to', '')
            subject = item.get('subject', '')
            body = item.get('body', '')
            if not to_email or not subject:
                fail_list.append(f"{to_email}: 缺少收件人或主题")
                continue
            security_code, err = get_security_code(session, csrftoken)
            if err:
                fail_list.append(f"{to_email}: 获取安全码失败")
                continue

            html_body = build_html_body(body)
            content_b64 = base64.b64encode(html_body.encode('utf-8')).decode('utf-8')

            common_keys, common_names = [], []
            for tmp_path, orig_name in common_tmp_files:
                try:
                    file_key = upload_attachment(session, csrftoken, tmp_path, orig_name)
                    if file_key:
                        common_keys.append(file_key)
                        common_names.append(encode_attachment_name(orig_name))
                except Exception:
                    pass

            per_files = per_files_map.get(idx, [])
            per_keys, per_names = [], []
            for f in per_files:
                if f.filename:
                    per_tmp = os.path.join(EMAIL_UPLOAD_DIR, f'per_{int(time.time()*1000)}_{f.filename}')
                    f.save(per_tmp)
                    try:
                        file_key = upload_attachment(session, csrftoken, per_tmp, f.filename)
                        if file_key:
                            per_keys.append(file_key)
                            per_names.append(encode_attachment_name(f.filename))
                    except Exception:
                        pass
                    finally:
                        try: os.remove(per_tmp)
                        except OSError: pass

            all_att_keys = common_keys + per_keys
            all_att_names = common_names + per_names
            att_list_str = ','.join(all_att_keys) if all_att_keys else ''
            att_name_str = ','.join(all_att_names) if all_att_names else ''

            send_resp = send_mail_api(
                session, MAIL_CONFIG['username'], to_email, cc_emails, subject,
                content_b64, att_list_str, att_name_str, security_code
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
        for tmp_path, _ in common_tmp_files:
            try: os.remove(tmp_path)
            except OSError: pass
        return {'ok': success_count > 0, 'message': msg,
                'success_count': success_count, 'fail_count': len(fail_list)}
    except req.exceptions.ConnectionError:
        return {'ok': False, 'error': '网络连接失败'}
    except Exception as e:
        return {'ok': False, 'error': f'批量发送失败: {str(e)}'}


def start_login(account, password, phone):
    global login_state, MAIL_CONFIG
    if login_state.get('status') in ('logging_in', 'waiting_code', 'verifying'):
        return False
    if account: MAIL_CONFIG['account'] = account
    if password: MAIL_CONFIG['password'] = password
    if phone: MAIL_CONFIG['phone'] = phone
    # 根据账号生成发件人邮箱（ telecom 企业邮箱格式: account@chinatelecom.cn）
    if account:
        MAIL_CONFIG['username'] = f'{account}@chinatelecom.cn'
    save_login_creds(MAIL_CONFIG['account'], MAIL_CONFIG['password'], MAIL_CONFIG['phone'], MAIL_CONFIG['username'])
    login_state = {'status': 'logging_in', 'message': '正在启动浏览器自动登录...', 'code': None, 'browser_open': False}
    thread = threading.Thread(target=_blackbox_login_worker, daemon=True)
    thread.start()
    return True


def submit_verify_code(code):
    global login_state
    if login_state.get('status') != 'waiting_code':
        return False
    if not code or len(code) < 4:
        return False
    login_state['code'] = code
    login_state['status'] = 'verifying'
    login_state['message'] = '正在提交验证码...'
    return True


def do_logout():
    global login_state
    login_state = {'status': 'idle', 'message': '已退出登录', 'code': None, 'browser_open': False}
    if os.path.exists(EMAIL_COOKIES_FILE): os.remove(EMAIL_COOKIES_FILE)
    csrftoken_file = os.path.join(EMAIL_DATA_DIR, 'csrftoken.txt')
    if os.path.exists(csrftoken_file): os.remove(csrftoken_file)


def cancel_login():
    global login_state
    login_state = {'status': 'idle', 'message': '登录已取消', 'code': None, 'browser_open': False}


def _find_chrome_path():
    """自动检测 Chrome/Chromium 路径，兼容 Windows/Mac/Linux 服务器"""
    import platform
    system = platform.system()
    candidates = []
    if system == 'Windows':
        candidates = [
            os.path.expandvars(r'%ProgramFiles%\Google\Chrome\Application\chrome.exe'),
            os.path.expandvars(r'%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe'),
            os.path.expandvars(r'%LocalAppData%\Google\Chrome\Application\chrome.exe'),
        ]
    elif system == 'Darwin':
        candidates = [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        ]
    else:  # Linux
        candidates = [
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/snap/bin/chromium',
        ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    # 未找到系统 Chrome，返回 None 让 Playwright 使用自带的 Chromium
    return None


def _blackbox_login_worker():
    global login_state
    browser = None
    try:
        from playwright.sync_api import sync_playwright
        login_state['message'] = '正在启动浏览器...'
        chrome_path = _find_chrome_path()
        launch_opts = {
            'headless': True,
            'args': ['--no-sandbox', '--disable-blink-features=AutomationControlled',
                     '--disable-gpu', '--disable-dev-shm-usage'],
        }
        if chrome_path:
            launch_opts['executable_path'] = chrome_path
        with sync_playwright() as p:
            browser = p.chromium.launch(**launch_opts)
            context = browser.new_context(viewport={'width': 1280, 'height': 800},
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
            page = context.new_page()
            login_state['message'] = '正在打开邮箱登录页面...'
            # 用 domcontentloaded 替代 networkidle：邮箱页面有持续心跳/WebSocket，
            # networkidle 永远无法满足会导致超时；后续用显式 wait_for 等元素即可
            page.goto('https://mail.chinatelecom.cn/mail/index.html#/user/login', wait_until='domcontentloaded', timeout=60000)
            page.wait_for_timeout(3000)
            login_state['message'] = '正在填入账号...'
            account_input = page.get_by_placeholder('邮箱账号/管理员账号')
            account_input.wait_for(state='visible', timeout=10000)
            account_input.click(); page.wait_for_timeout(300)
            account_input.fill(MAIL_CONFIG['account']); page.wait_for_timeout(500)
            login_state['message'] = '正在填入密码...'
            pwd_input = page.get_by_placeholder('输入邮箱密码')
            pwd_input.wait_for(state='visible', timeout=5000)
            pwd_input.click(); page.wait_for_timeout(200)
            pwd_input.fill(MAIL_CONFIG['password']); page.wait_for_timeout(500)
            login_state['message'] = '正在点击登录...'
            login_btn = page.get_by_role('button', name='登 录')
            login_btn.wait_for(state='visible', timeout=5000)
            login_btn.click()
            login_state['message'] = '等待二次验证页面...'
            page.wait_for_url('**/user/auth**', timeout=15000)
            page.wait_for_timeout(2000)
            login_state['message'] = '正在切换到手机验证码验证...'
            sms_radio = page.get_by_role('radio', name='手机验证码验证')
            sms_radio.wait_for(state='visible', timeout=10000)
            sms_radio.click(); page.wait_for_timeout(1500)
            login_state['message'] = '正在获取验证码...'
            get_code_btn = page.get_by_role('button', name='获取验证码')
            get_code_btn.wait_for(state='visible', timeout=10000)
            get_code_btn.click(); page.wait_for_timeout(2000)
            login_state['status'] = 'waiting_code'
            login_state['message'] = '验证码已发送到手机，请在下方输入'
            wait_start = time.time()
            while login_state.get('status') == 'waiting_code':
                page.wait_for_timeout(500)
                elapsed = time.time() - wait_start
                if int(elapsed) % 20 == 0 and int(elapsed) > 0:
                    try: page.mouse.move(100, 100); page.mouse.move(200, 200)
                    except Exception: pass
                if elapsed > 300:
                    login_state['status'] = 'failed'
                    login_state['message'] = '等待验证码超时（5分钟）'
                    return
            if login_state.get('status') != 'verifying': return
            code = login_state.get('code', '')
            login_state['message'] = '正在填入验证码...'
            try:
                code_input = page.locator('input[placeholder="请输入验证码"]')
                code_input.wait_for(state='visible', timeout=15000)
                code_input.click(); page.wait_for_timeout(200)
                code_input.fill(''); code_input.fill(code)
                page.wait_for_timeout(500)
            except Exception as e:
                login_state['status'] = 'failed'
                login_state['message'] = f'未找到验证码输入框: {str(e)}'
                return
            login_state['message'] = '正在确认登录...'
            clicked = False
            for sel in ['button.confirm-btn', 'button.ant-btn-primary.confirm-btn']:
                try:
                    btn = page.locator(sel)
                    if btn.count() > 0 and btn.first.is_visible(timeout=3000):
                        btn.first.click(); clicked = True; break
                except Exception: continue
            if not clicked:
                page.wait_for_timeout(3000)
                current_url = page.url
                if 'login' not in current_url.lower() and 'auth' not in current_url.lower():
                    clicked = True
            if not clicked:
                login_state['status'] = 'failed'
                login_state['message'] = '登录确认失败，请重试'
                return
            page.wait_for_timeout(5000)
            current_url = page.url
            login_success = False
            if 'login' not in current_url.lower() and 'auth' not in current_url.lower():
                login_success = True
            else:
                try:
                    if page.locator('text=退出').count() > 0 or page.locator('text=资源管理').count() > 0:
                        login_success = True
                except Exception: pass
            if login_success:
                cookies = context.cookies()
                save_json(EMAIL_COOKIES_FILE, cookies)
                try:
                    csrftoken = page.evaluate(
                        '() => { try { const d = JSON.parse(localStorage.getItem("N_W_C_T") || "{}"); '
                        'const keys = Object.keys(d).filter(k => d[k] === true); '
                        'return keys.length > 0 ? keys[keys.length - 1] : ""; } catch(e) { return ""; } }')
                    if csrftoken:
                        csrftoken = re.sub(r'[\u200b\u200c\u200d\ufeff\u00a0\s]', '', csrftoken)
                    if csrftoken:
                        with open(os.path.join(EMAIL_DATA_DIR, 'csrftoken.txt'), 'w') as f:
                            f.write(csrftoken)
                except Exception: pass
                # 登录成功后提取当前登录用户邮箱，更新MAIL_CONFIG['username']
                try:
                    logged_in_email = page.evaluate(
                        '() => { try {'
                        '  const el = document.querySelector(".user-info .email, .user-name, .account-info, [class*=user][class*=name], [class*=account]");'
                        '  if (el && el.textContent.includes("@")) return el.textContent.trim();'
                        '  const userInfo = document.querySelector(".user-info, .header-user, .login-user, [class*=userInfo], [class*=loginInfo]");'
                        '  if (userInfo) { const m = userInfo.textContent.match(/[\\w.-]+@[\\w.-]+/); if (m) return m[0]; }'
                        '  return "";'
                        '} catch(e) { return ""; } }')
                    if logged_in_email and '@' in logged_in_email:
                        MAIL_CONFIG['username'] = logged_in_email
                    save_login_creds(MAIL_CONFIG['account'], MAIL_CONFIG['password'], MAIL_CONFIG['phone'], MAIL_CONFIG['username'])
                except Exception: pass
                login_state['status'] = 'success'
                login_state['message'] = '登录成功！可以正常发送邮件了。'
            else:
                login_state['status'] = 'failed'
                login_state['message'] = '登录失败，请重试。'
            login_state['browser_open'] = False
            try: browser.close()
            except Exception: pass
    except ImportError:
        login_state['status'] = 'failed'
        login_state['message'] = 'Playwright未安装，请在服务器执行: pip install playwright && playwright install chromium'
    except Exception as e:
        login_state['status'] = 'failed'
        login_state['message'] = f'登录过程出错: {str(e)}'
        login_state['browser_open'] = False
        try:
            if browser: browser.close()
        except Exception: pass
