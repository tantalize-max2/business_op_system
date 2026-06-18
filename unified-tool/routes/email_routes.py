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
    """获取所有邮件联系人列表
    ---
    tags:
      - 邮件
    responses:
      200:
        description: 联系人列表
        schema:
          type: object
          properties:
            success: {type: boolean}
            data:
              type: array
              items:
                type: object
                properties:
                  id: {type: integer}
                  name: {type: string}
                  email: {type: string}
                  group_id: {type: integer}
    """
    return jsonify({'success': True, 'data': get_contacts()})


@email_bp.route('/api/email/contacts', methods=['POST'])
def email_add_contact():
    """新增一个邮件联系人
    ---
    tags:
      - 邮件
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          required: [name, email]
          properties:
            name: {type: string, description: "联系人姓名"}
            email: {type: string, description: "邮箱地址"}
            group_id: {type: integer, description: "所属联系人分组ID"}
    responses:
      200:
        description: 添加成功
        schema:
          type: object
          properties:
            success: {type: boolean}
            data: {type: object, description: "新建联系人对象"}
    """
    data = request.json
    contact = add_contact(data)
    return jsonify({'success': True, 'data': contact})


@email_bp.route('/api/email/contacts/<int:cid>', methods=['DELETE'])
def email_delete_contact(cid):
    """根据ID删除联系人
    ---
    tags:
      - 邮件
    parameters:
      - name: cid
        in: path
        type: integer
        required: true
        description: 联系人ID
    responses:
      200:
        description: 删除成功
        schema:
          type: object
          properties:
            success: {type: boolean}
    """
    delete_contact(cid)
    return jsonify({'success': True})


@email_bp.route('/api/email/contacts/<int:cid>', methods=['PUT'])
def email_update_contact(cid):
    """根据ID更新联系人信息
    ---
    tags:
      - 邮件
    parameters:
      - name: cid
        in: path
        type: integer
        required: true
        description: 联系人ID
      - name: body
        in: body
        required: true
        schema:
          type: object
          properties:
            name: {type: string}
            email: {type: string}
            group_id: {type: integer}
    responses:
      200:
        description: 更新成功
        schema:
          type: object
          properties:
            success: {type: boolean}
    """
    data = request.json
    update_contact(cid, data)
    return jsonify({'success': True})


@email_bp.route('/api/email/groups', methods=['GET'])
def email_get_groups():
    """获取所有联系人分组
    ---
    tags:
      - 邮件
    responses:
      200:
        description: 分组列表
        schema:
          type: object
          properties:
            success: {type: boolean}
            data:
              type: array
              items:
                type: object
                properties:
                  id: {type: integer}
                  name: {type: string}
    """
    groups = get_groups()
    return jsonify({'success': True, 'data': groups})


@email_bp.route('/api/email/login/check', methods=['GET'])
def email_check_login():
    """检查邮箱当前是否已登录
    ---
    tags:
      - 邮件
    responses:
      200:
        description: 登录状态
        schema:
          type: object
          properties:
            success: {type: boolean}
            logged_in: {type: boolean, description: "是否已登录"}
    """
    logged_in = check_login()
    return jsonify({'success': True, 'logged_in': logged_in})


@email_bp.route('/api/email/txt-vars', methods=['POST'])
def email_upload_txt_var():
    """上传一个 .txt 文本变量文件（用于邮件正文变量替换）
    ---
    tags:
      - 邮件
    consumes:
      - multipart/form-data
    parameters:
      - name: file
        in: formData
        type: file
        required: true
        description: .txt 文件（UTF-8）
    responses:
      200:
        description: 上传成功
        schema:
          type: object
          properties:
            success: {type: boolean}
            data: {type: object, description: "新建变量文件信息"}
      400:
        description: 未选择文件 / 非 .txt 文件
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
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
    """列出所有已上传的文本变量文件
    ---
    tags:
      - 邮件
    responses:
      200:
        description: 变量文件列表
        schema:
          type: object
          properties:
            success: {type: boolean}
            data:
              type: array
              items:
                type: object
                properties:
                  name: {type: string}
                  savedAt: {type: number}
    """
    result = list_txt_vars()
    return jsonify({'success': True, 'data': result})


@email_bp.route('/api/email/txt-vars/<name>', methods=['GET'])
def email_get_txt_var(name):
    """获取指定文本变量文件内容
    ---
    tags:
      - 邮件
    parameters:
      - name: name
        in: path
        type: string
        required: true
        description: 变量文件名
    responses:
      200:
        description: 变量文件内容
        schema:
          type: object
          properties:
            success: {type: boolean}
            data: {type: object, description: "变量文件对象"}
      404:
        description: 变量文件不存在
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    data = get_txt_var(name)
    if not data:
        return jsonify({'success': False, 'message': '变量文件不存在'}), 404
    return jsonify({'success': True, 'data': data})


@email_bp.route('/api/email/txt-vars/<name>', methods=['DELETE'])
def email_delete_txt_var(name):
    """删除指定文本变量文件
    ---
    tags:
      - 邮件
    parameters:
      - name: name
        in: path
        type: string
        required: true
        description: 变量文件名
    responses:
      200:
        description: 删除成功
        schema:
          type: object
          properties:
            success: {type: boolean}
    """
    delete_txt_var_api(name)
    return jsonify({'success': True})


@email_bp.route('/api/email/upload-image', methods=['POST'])
def email_upload_image():
    """上传一个图片文件（用于邮件正文内嵌图片）
    ---
    tags:
      - 邮件
    consumes:
      - multipart/form-data
    parameters:
      - name: file
        in: formData
        type: file
        required: true
        description: 图片文件（png/jpg/gif 等）
    responses:
      200:
        description: 上传成功
        schema:
          type: object
          properties:
            success: {type: boolean}
            data: {type: object, description: "图片访问信息（含URL/路径）"}
      400:
        description: 未选择图片 / 非图片类型
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    f = request.files.get('file')
    if not f or not f.filename:
        return jsonify({'success': False, 'message': '请选择图片'}), 400
    result = save_uploaded_image(f)
    if result is None:
        return jsonify({'success': False, 'message': '仅支持图片文件'}), 400
    return jsonify({'success': True, 'data': result})


@email_bp.route('/email-uploads/<path:filename>')
def email_serve_upload(filename):
    """访问已上传的图片（邮件内嵌资源静态服务）
    ---
    tags:
      - 邮件
    parameters:
      - name: filename
        in: path
        type: string
        required: true
        description: 上传图片文件名
    produces:
      - image/*
    responses:
      200:
        description: 图片二进制流
        schema:
          type: file
      404:
        description: 文件不存在
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    return send_from_directory(EMAIL_UPLOAD_DIR, filename)


@email_bp.route('/api/email/templates', methods=['GET'])
def email_get_templates():
    """获取所有邮件模板
    ---
    tags:
      - 邮件
    responses:
      200:
        description: 模板列表
        schema:
          type: object
          properties:
            success: {type: boolean}
            data:
              type: array
              items:
                type: object
                properties:
                  id: {type: integer}
                  name: {type: string}
                  subject: {type: string}
                  body: {type: string, description: "邮件正文（HTML/纯文本）"}
    """
    return jsonify({'success': True, 'data': get_templates()})


@email_bp.route('/api/email/templates', methods=['POST'])
def email_add_template():
    """新增一个邮件模板
    ---
    tags:
      - 邮件
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          required: [name]
          properties:
            name: {type: string, description: "模板名称"}
            subject: {type: string, description: "默认邮件主题"}
            body: {type: string, description: "邮件正文（HTML）"}
    responses:
      200:
        description: 添加成功
        schema:
          type: object
          properties:
            success: {type: boolean}
            data: {type: object, description: "新建模板对象"}
    """
    data = request.json
    template = add_template(data)
    return jsonify({'success': True, 'data': template})


@email_bp.route('/api/email/templates/<int:tid>', methods=['DELETE'])
def email_delete_template(tid):
    """根据ID删除邮件模板
    ---
    tags:
      - 邮件
    parameters:
      - name: tid
        in: path
        type: integer
        required: true
        description: 模板ID
    responses:
      200:
        description: 删除成功
        schema:
          type: object
          properties:
            success: {type: boolean}
    """
    delete_template(tid)
    return jsonify({'success': True})


@email_bp.route('/api/email/templates/<int:tid>', methods=['PUT'])
def email_update_template(tid):
    """根据ID更新邮件模板
    ---
    tags:
      - 邮件
    parameters:
      - name: tid
        in: path
        type: integer
        required: true
        description: 模板ID
      - name: body
        in: body
        required: true
        schema:
          type: object
          properties:
            name: {type: string}
            subject: {type: string}
            body: {type: string}
    responses:
      200:
        description: 更新成功
        schema:
          type: object
          properties:
            success: {type: boolean}
    """
    data = request.json
    update_template(tid, data)
    return jsonify({'success': True})


@email_bp.route('/api/email/send', methods=['POST'])
def email_send():
    """发送一封邮件（支持附件）
    ---
    tags:
      - 邮件
    consumes:
      - multipart/form-data
    parameters:
      - name: to
        in: formData
        type: string
        required: true
        description: 收件人邮箱数组（JSON 字符串）
      - name: cc
        in: formData
        type: string
        required: false
        description: 抄送邮箱数组（JSON 字符串）
      - name: subject
        in: formData
        type: string
        required: true
        description: 邮件主题
      - name: body
        in: formData
        type: string
        required: false
        description: 邮件正文（HTML）
      - name: files
        in: formData
        type: file
        required: false
        description: 普通附件（可多个）
    responses:
      200:
        description: 发送成功
        schema:
          type: object
          properties:
            success: {type: boolean}
            message: {type: string}
      400:
        description: 缺少收件人/主题
        schema:
          $ref: '#/definitions/ErrorResponse'
      500:
        description: 邮件发送失败
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
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
    """批量发送个性化邮件（每个收件人独立正文/附件）
    ---
    tags:
      - 邮件
    consumes:
      - multipart/form-data
    parameters:
      - name: items
        in: formData
        type: string
        required: true
        description: 收件数据数组（JSON 字符串），每项含 to/subject/body 等
      - name: cc
        in: formData
        type: string
        required: false
        description: 公共抄送邮箱数组（JSON 字符串）
      - name: files
        in: formData
        type: file
        required: false
        description: 公共附件（可多个）
      - name: files_<idx>
        in: formData
        type: file
        required: false
        description: 第 idx 个收件人的私有附件（与 items 数组下标对应，可多个）
    responses:
      200:
        description: 批量发送完成
        schema:
          type: object
          properties:
            success: {type: boolean}
            message: {type: string}
            success_count: {type: integer, description: "成功发送数量"}
            fail_count: {type: integer, description: "失败数量"}
      400:
        description: 数据格式错误 / 无收件人
        schema:
          $ref: '#/definitions/ErrorResponse'
      500:
        description: 批量发送内部错误
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
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
    """获取邮箱登录详细状态（含是否需要验证码、当前阶段等）
    ---
    tags:
      - 邮件
    responses:
      200:
        description: 登录状态详情
        schema:
          type: object
          properties:
            logged_in: {type: boolean}
            need_verify: {type: boolean, description: "是否需要短信验证码"}
            message: {type: string}
    """
    return jsonify(get_login_state())


@email_bp.route('/api/email/login/start', methods=['POST'])
def email_start_login():
    """启动邮箱登录流程（异步，发起后通过 status 轮询）
    ---
    tags:
      - 邮件
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          required: [account, password]
          properties:
            account: {type: string, description: "邮箱账号"}
            password: {type: string, description: "邮箱密码"}
            phone: {type: string, description: "短信验证用手机号"}
    responses:
      200:
        description: 登录流程已启动或正在中
        schema:
          type: object
          properties:
            success: {type: boolean}
            message: {type: string}
    """
    data = request.json or {}
    account = data.get('account', '').strip()
    password = data.get('password', '').strip()
    phone = data.get('phone', '').strip()
    if not start_login(account, password, phone):
        return jsonify({'success': False, 'message': '登录流程进行中，请稍候'})
    return jsonify({'success': True, 'message': '登录流程已启动'})


@email_bp.route('/api/email/login/creds', methods=['GET'])
def email_get_login_creds():
    """获取上次保存的登录凭据（手机号会脱敏显示）
    ---
    tags:
      - 邮件
    responses:
      200:
        description: 凭据信息
        schema:
          type: object
          properties:
            success: {type: boolean}
            data:
              type: object
              properties:
                account: {type: string}
                password: {type: string}
                phone: {type: string, description: "完整手机号"}
                phone_display: {type: string, description: "脱敏后的手机号"}
    """
    creds = load_login_creds_api()
    phone = creds.get('phone', '')
    phone_display = phone[:3] + '****' + phone[-4:] if len(phone) >= 7 else phone
    return jsonify({'success': True, 'data': {
        'account': creds.get('account', ''), 'password': creds.get('password', ''),
        'phone': phone, 'phone_display': phone_display}})


@email_bp.route('/api/email/logout', methods=['POST'])
def email_logout():
    """退出邮箱登录，清理本地登录态
    ---
    tags:
      - 邮件
    responses:
      200:
        description: 退出成功
        schema:
          type: object
          properties:
            success: {type: boolean}
            message: {type: string}
    """
    do_logout()
    return jsonify({'success': True, 'message': '已退出登录'})


@email_bp.route('/api/email/login/verify', methods=['POST'])
def email_submit_verify_code():
    """提交短信验证码完成登录
    ---
    tags:
      - 邮件
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          required: [code]
          properties:
            code: {type: string, description: "短信验证码（至少4位）"}
    responses:
      200:
        description: 验证码已提交
        schema:
          type: object
          properties:
            success: {type: boolean}
            message: {type: string}
    """
    code = request.json.get('code', '')
    if not submit_verify_code(code):
        if not code or len(code) < 4:
            return jsonify({'success': False, 'message': '验证码格式不正确'})
        return jsonify({'success': False, 'message': '当前不需要验证码'})
    return jsonify({'success': True, 'message': '验证码已提交'})


@email_bp.route('/api/email/login/cancel', methods=['POST'])
def email_cancel_login():
    """取消正在进行的邮箱登录流程
    ---
    tags:
      - 邮件
    responses:
      200:
        description: 取消成功
        schema:
          type: object
          properties:
            success: {type: boolean}
    """
    cancel_login()
    return jsonify({'success': True})


@email_bp.route('/api/email/mail-config', methods=['GET'])
def email_get_mail_config():
    """获取当前邮箱服务配置（SMTP/POP3/IMAP 服务器及账号）
    ---
    tags:
      - 邮件
    responses:
      200:
        description: 邮箱配置
        schema:
          type: object
          properties:
            success: {type: boolean}
            data:
              type: object
              properties:
                smtp_server: {type: string}
                smtp_port: {type: integer}
                pop3_server: {type: string}
                pop3_port: {type: integer}
                imap_server: {type: string}
                imap_port: {type: integer}
                username: {type: string, description: "登录账号"}
                send_method: {type: string, description: "发送方式（如 webapi）"}
    """
    return jsonify({'success': True, 'data': {
        'smtp_server': 'smtp.chinatelecom.cn', 'smtp_port': 587,
        'pop3_server': 'pop.chinatelecom.cn', 'pop3_port': 995,
        'imap_server': 'imap.chinatelecom.cn', 'imap_port': 993,
        'username': MAIL_CONFIG['username'],
        'send_method': 'webapi'}})
