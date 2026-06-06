# -*- coding: utf-8 -*-
import os
import json
import random
import re


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


def create_mail_session(cookies_data):
    import requests as req
    session = req.Session()
    for c in cookies_data:
        session.cookies.set(c['name'], c['value'], domain=c.get('domain', ''))
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://mail.chinatelecom.cn/mail/index.html',
    })
    return session


def load_csrftoken(email_data_dir):
    csrftoken_file = os.path.join(email_data_dir, 'csrftoken.txt')
    if not os.path.exists(csrftoken_file):
        return None
    with open(csrftoken_file, 'r', encoding='utf-8') as f:
        csrftoken = f.read().strip()
    csrftoken = re.sub(r'[\u200b\u200c\u200d\ufeff\u00a0\s]', '', csrftoken)
    return csrftoken if csrftoken else None


def get_security_code(session, csrftoken):
    session.headers.update({'csrftoken': csrftoken})
    random_resp = session.post('https://mail.chinatelecom.cn/w2/replay/getRandomNum', timeout=10)
    if random_resp.status_code != 200:
        return None, f'获取安全码失败 (HTTP {random_resp.status_code})'
    random_data = random_resp.json()
    if random_data.get('code') != 0:
        return None, f'获取安全码失败: {random_data.get("desc", "未知错误")}'
    return random_data.get('data', ''), None


def upload_attachment(session, csrftoken, file_path, filename):
    url = 'https://mail.chinatelecom.cn/w2/common/uploadFile'
    upload_headers = {
        'csrftoken': csrftoken,
        'Origin': 'https://mail.chinatelecom.cn',
        'Referer': 'https://mail.chinatelecom.cn/mail/index.html',
    }
    with open(file_path, 'rb') as f:
        file_data = f.read()
    boundary = '----WebKitFormBoundary' + ''.join(random.choices('0123456789abcdef', k=16))
    body_parts = []
    body_parts.append(f'--{boundary}'.encode('utf-8'))
    cd = f'Content-Disposition: form-data; name="file"; filename="{filename}"'
    body_parts.append(cd.encode('utf-8'))
    body_parts.append(b'Content-Type: application/octet-stream')
    body_parts.append(b'')
    body_parts.append(file_data)
    body_parts.append(f'--{boundary}--'.encode('utf-8'))
    body_bytes = b'\r\n'.join(body_parts)
    upload_headers['Content-Type'] = f'multipart/form-data; boundary={boundary}'
    resp = session.post(url, data=body_bytes, headers=upload_headers, timeout=60)
    if resp.status_code == 200:
        try:
            data = resp.json()
            if data.get('code') == 0 and data.get('data'):
                return data['data'][0].get('fileKey', '')
        except Exception:
            pass
    return None


def build_html_body(body):
    html_body = body.replace('\n', '<br>') if '<' not in body else body
    if '<p>' not in html_body and '<br>' not in html_body and '<div' not in html_body:
        html_body = '<p>' + html_body + '</p>'
    return html_body


def send_mail_api(session, from_addr, to_emails, cc_emails, subject,
                  content_b64, attachment_list_str, attachment_name_list_str,
                  security_code):
    import urllib.parse
    send_data = {
        'from': from_addr, 'to': ','.join(to_emails) if isinstance(to_emails, list) else to_emails,
        'cc': ','.join(cc_emails) if isinstance(cc_emails, list) else cc_emails,
        'bcc': '', 'fast': '0', 'content': content_b64, 'contentType': '1',
        'subject': subject, 'attachmentList': attachment_list_str,
        'attachmentNameList': attachment_name_list_str, 'dnt': '0',
        'action': 'send', 'sendMode': '0', 'saveSended': '1',
        'securityDestroy': '0', 'acceptSmsphones': '', 'acceptSmsKey': '',
        'securityCode': security_code,
    }
    encoded_body = urllib.parse.urlencode(send_data, encoding='utf-8')
    send_resp = session.post('https://mail.chinatelecom.cn/w2/mail/sendMail',
        data=encoded_body.encode('utf-8'),
        headers={'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'}, timeout=30)
    return send_resp
