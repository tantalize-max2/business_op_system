# -*- coding: utf-8 -*-
import os
import json
import time
from flask import Blueprint, request, jsonify, send_from_directory
from config import MAIL_CONFIG, EMAIL_DATA_DIR, EMAIL_UPLOAD_DIR
from services.email_service import (get_login_state, get_contacts, add_contact, delete_contact,
                                     update_contact, get_groups, check_login, upload_txt_var,
                                     list_txt_vars, get_txt_var, delete_txt_var_api,
                                     save_uploaded_image, get_templates, add_template,
                                     delete_template, update_template, send_email, batch_send_email,
                                     start_login, submit_verify_code, do_logout, cancel_login,
                                     load_login_creds_api)

email_bp = Blueprint('email', __name__)


@email_bp.route('/api/email/contacts', methods=['GET'])
def email_get_contacts():
    return jsonify({'success': True, 'data': get_contacts()})


@email_bp.route('/api/email/contacts', methods=['POST'])
def email_add_contact():
    data = request.json
    contact = add_contact(data)
    return jsonify({'success': True, 'data': contact})


@email_bp.route('/api/email/contacts/<int:cid>', methods=['DELETE'])
def email_delete_contact(cid):
    delete_contact(cid)
    return jsonify({'success': True})


@email_bp.route('/api/email/contacts/<int:cid>', methods=['PUT'])
def email_update_contact(cid):
    data = request.json
    update_contact(cid, data)
    return jsonify({'success': True})


@email_bp.route('/api/email/groups', methods=['GET'])
def email_get_groups():
    groups = get_groups()
    return jsonify({'success': True, 'data': groups})


@email_bp.route('/api/email/login/check', methods=['GET'])
def email_check_login():
    logged_in = check_login()
    return jsonify({'success': True, 'logged_in': logged_in})


@email_bp.route('/api/email/txt-vars', methods=['POST'])
def email_upload_txt_var():
    f = request.files.get('file')
    if not f or not f.filename:
        return jsonify({'success': False, 'message': '请选择文件'}), 400
    if not f.filename.endswith('.txt'):
        return jsonify({'success': False, 'message': '仅支持 .txt 文件'}), 400
    content = f.read().decode('utf-8', errors='ignore')
    result = upload_txt_var(f.filename, content)
    return jsonify({'success': True, 'data': result})


@email_bp.route('/api/email/txt-vars', methods=['GET'])
def email_list_txt_vars():
    result = list_txt_vars()
    return jsonify({'success': True, 'data': result})


@email_bp.route('/api/email/txt-vars/<name>', methods=['GET'])
def email_get_txt_var(name):
    data = get_txt_var(name)
    if not data:
        return jsonify({'success': False, 'message': '变量文件不存在'}), 404
    return jsonify({'success': True, 'data': data})


@email_bp.route('/api/email/txt-vars/<name>', methods=['DELETE'])
def email_delete_txt_var(name):
    delete_txt_var_api(name)
    return jsonify({'success': True})


@email_bp.route('/api/email/upload-image', methods=['POST'])
def email_upload_image():
    f = request.files.get('file')
    if not f or not f.filename:
        return jsonify({'success': False, 'message': '请选择图片'}), 400
    result = save_uploaded_image(f)
    if result is None:
        return jsonify({'success': False, 'message': '仅支持图片文件'}), 400
    return jsonify({'success': True, 'data': result})


@email_bp.route('/email-uploads/<path:filename>')
def email_serve_upload(filename):
    return send_from_directory(EMAIL_UPLOAD_DIR, filename)


@email_bp.route('/api/email/templates', methods=['GET'])
def email_get_templates():
    return jsonify({'success': True, 'data': get_templates()})


@email_bp.route('/api/email/templates', methods=['POST'])
def email_add_template():
    data = request.json
    template = add_template(data)
    return jsonify({'success': True, 'data': template})


@email_bp.route('/api/email/templates/<int:tid>', methods=['DELETE'])
def email_delete_template(tid):
    delete_template(tid)
    return jsonify({'success': True})


@email_bp.route('/api/email/templates/<int:tid>', methods=['PUT'])
def email_update_template(tid):
    data = request.json
    update_template(tid, data)
    return jsonify({'success': True})


@email_bp.route('/api/email/send', methods=['POST'])
def email_send():
    import json as _json
    to_emails = _json.loads(request.form.get('to', '[]'))
    cc_emails = _json.loads(request.form.get('cc', '[]'))
    subject = request.form.get('subject', '')
    body = request.form.get('body', '')
    if not to_emails:
        return jsonify({'success': False, 'message': '请填写收件人'}), 400
    if not subject:
        return jsonify({'success': False, 'message': '请填写邮件主题'}), 400
    uploaded_files = request.files.getlist('files')
    result = send_email(to_emails, cc_emails, subject, body, uploaded_files)
    if not result['ok']:
        return jsonify({'success': False, 'message': result['error']}), 500
    return jsonify({'success': True, 'message': result['message']})


@email_bp.route('/api/email/batch-send', methods=['POST'])
def email_batch_send():
    import json as _json
    items_json = request.form.get('items', '[]')
    cc_emails = _json.loads(request.form.get('cc', '[]'))
    try:
        items = _json.loads(items_json)
    except Exception:
        return jsonify({'success': False, 'message': '发信数据格式错误'}), 400
    if not items:
        return jsonify({'success': False, 'message': '请添加至少一位收件人'}), 400
    common_files = request.files.getlist('files')
    per_files_map = {}
    for idx in range(len(items)):
        per_files_map[idx] = request.files.getlist(f'files_{idx}')
    result = batch_send_email(items, cc_emails, common_files, per_files_map)
    if not result['ok']:
        return jsonify({'success': False, 'message': result.get('error', result.get('message', ''))}), 500
    return jsonify({'success': True, 'message': result['message'],
                    'success_count': result['success_count'], 'fail_count': result['fail_count']})


@email_bp.route('/api/email/login/status', methods=['GET'])
def email_get_login_status():
    return jsonify(get_login_state())


@email_bp.route('/api/email/login/start', methods=['POST'])
def email_start_login():
    data = request.json or {}
    account = data.get('account', '').strip()
    password = data.get('password', '').strip()
    phone = data.get('phone', '').strip()
    if not start_login(account, password, phone):
        return jsonify({'success': False, 'message': '登录流程进行中，请稍候'})
    return jsonify({'success': True, 'message': '登录流程已启动'})


@email_bp.route('/api/email/login/creds', methods=['GET'])
def email_get_login_creds():
    creds = load_login_creds_api()
    phone = creds.get('phone', '')
    phone_display = phone[:3] + '****' + phone[-4:] if len(phone) >= 7 else phone
    return jsonify({'success': True, 'data': {
        'account': creds.get('account', ''), 'password': creds.get('password', ''),
        'phone': phone, 'phone_display': phone_display}})


@email_bp.route('/api/email/logout', methods=['POST'])
def email_logout():
    do_logout()
    return jsonify({'success': True, 'message': '已退出登录'})


@email_bp.route('/api/email/login/verify', methods=['POST'])
def email_submit_verify_code():
    code = request.json.get('code', '')
    if not submit_verify_code(code):
        if not code or len(code) < 4:
            return jsonify({'success': False, 'message': '验证码格式不正确'})
        return jsonify({'success': False, 'message': '当前不需要验证码'})
    return jsonify({'success': True, 'message': '验证码已提交'})


@email_bp.route('/api/email/login/cancel', methods=['POST'])
def email_cancel_login():
    cancel_login()
    return jsonify({'success': True})


@email_bp.route('/api/email/mail-config', methods=['GET'])
def email_get_mail_config():
    return jsonify({'success': True, 'data': {
        'smtp_server': 'smtp.chinatelecom.cn', 'smtp_port': 587,
        'pop3_server': 'pop.chinatelecom.cn', 'pop3_port': 995,
        'imap_server': 'imap.chinatelecom.cn', 'imap_port': 993,
        'username': MAIL_CONFIG['username'],
        'send_method': 'webapi'}})
