# -*- coding: utf-8 -*-
import os
import json
from flask import Blueprint, request, jsonify, send_file, current_app
from config import OUTPUT_DIR, UPLOAD_DIR
from models.push_model import get_airscript_code, save_airscript_code
from services.push_service import (browse_local_fs, list_kdocs_cats_with_count, add_kdocs_cat,
                                    delete_kdocs_cat, list_kdocs_sheets, add_kdocs_sheet,
                                    update_kdocs_sheet, delete_kdocs_sheet, push_to_kdocs,
                                    push_to_kdocs_batch, scan_folder)

push_bp = Blueprint('push', __name__)


@push_bp.route('/api/kdocs-upload', methods=['POST'])
def upload_excel_api():
    """上传 Excel 文件到服务器 data/uploads 目录（供推送模块使用）"""
    if 'file' not in request.files:
        return jsonify({'error': '未选择文件'}), 400
    f = request.files['file']
    if not f or not f.filename:
        return jsonify({'error': '未选择文件'}), 400
    fname = f.filename.strip()
    ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ''
    if ext not in ('xlsx', 'xls'):
        return jsonify({'error': '仅支持 xlsx/xls 格式'}), 400
    # 安全文件名：去掉路径分隔符，避免目录穿越
    safe_name = os.path.basename(fname)
    save_path = os.path.join(UPLOAD_DIR, safe_name)
    f.save(save_path)
    return jsonify({'message': '上传成功', 'path': save_path, 'name': safe_name,
                    'size': os.path.getsize(save_path)})


@push_bp.route('/api/kdocs-browse', methods=['POST'])
def browse_local_fs_api():
    data = request.json or {}
    path = data.get('path', '').strip()
    result = browse_local_fs(path)
    if 'error' in result:
        return jsonify(result), 400
    return jsonify(result)


@push_bp.route('/api/kdocs-categories', methods=['GET'])
def list_kdocs_cats_api():
    cats = list_kdocs_cats_with_count()
    return jsonify(cats)


@push_bp.route('/api/kdocs-categories', methods=['POST'])
def add_kdocs_cat_api():
    data = request.json or {}
    name = data.get('name', '').strip()
    color = data.get('color', '#0d9488').strip()
    if not name:
        return jsonify({'error': '分类名不能为空'}), 400
    cat = add_kdocs_cat(name, color)
    if cat is None:
        return jsonify({'error': '分类名已存在'}), 400
    return jsonify({'message': '添加成功', 'category': cat})


@push_bp.route('/api/kdocs-categories/<cid>', methods=['DELETE'])
def delete_kdocs_cat_api(cid):
    delete_kdocs_cat(cid)
    return jsonify({'message': '已删除'})


@push_bp.route('/api/kdocs-sheets', methods=['GET'])
def list_kdocs_sheets_api():
    cat_id = request.args.get('category', '')
    sheets = list_kdocs_sheets(cat_id)
    return jsonify(sheets)


@push_bp.route('/api/kdocs-sheets', methods=['POST'])
def add_kdocs_sheet_api():
    data = request.json or {}
    name = data.get('name', '').strip()
    url = data.get('url', '').strip()
    api_token = data.get('api_token', '').strip()
    webhook_url = data.get('webhook_url', '').strip()
    excel_path = data.get('excel_path', '').strip()
    batch_size = data.get('batch_size', 3)
    category = data.get('category', 'default')
    if not name or not url:
        return jsonify({'error': '名称和URL不能为空'}), 400
    sheet = add_kdocs_sheet(name, url, api_token, webhook_url, excel_path, batch_size, category)
    return jsonify({'message': '添加成功', 'sheet': sheet})


@push_bp.route('/api/kdocs-sheets/<sid>', methods=['PUT'])
def update_kdocs_sheet_api(sid):
    data = request.json or {}
    sheet = update_kdocs_sheet(sid, data)
    if sheet is None:
        return jsonify({'error': '未找到该配置'}), 404
    return jsonify({'message': '更新成功', 'sheet': sheet})


@push_bp.route('/api/kdocs-sheets/<sid>', methods=['DELETE'])
def delete_kdocs_sheet_api(sid):
    delete_kdocs_sheet(sid)
    return jsonify({'message': '删除成功'})


@push_bp.route('/api/kdocs-push', methods=['POST'])
def push_to_kdocs_api():
    data = request.json or {}
    sid = data.get('id', '')
    excel_path = data.get('excel_path', '')
    result = push_to_kdocs(sid, excel_path)
    if 'error' in result:
        return jsonify(result), 400 if '未配置' in result['error'] or '未指定' in result['error'] else 500
    return jsonify(result)


@push_bp.route('/api/kdocs-push-batch', methods=['POST'])
def push_to_kdocs_batch_api():
    data = request.json or {}
    folder_path = data.get('folder_path', '').strip()
    result = push_to_kdocs_batch(folder_path)
    if 'error' in result:
        return jsonify(result), 400
    return jsonify(result)


@push_bp.route('/api/kdocs-airscript-code', methods=['GET'])
def get_airscript_code_api():
    code = get_airscript_code()
    if code is None:
        return jsonify({'error': 'airscript_code.js 文件不存在'}), 404
    return jsonify({'code': code})


@push_bp.route('/api/kdocs-airscript-code', methods=['PUT'])
def save_airscript_code_api():
    data = request.json or {}
    code = data.get('code', '')
    if save_airscript_code(code):
        return jsonify({'message': '保存成功'})
    return jsonify({'error': '保存失败'}), 500


@push_bp.route('/api/kdocs-folder-scan', methods=['POST'])
def scan_folder_api():
    data = request.json or {}
    folder_path = data.get('folder_path', '').strip()
    files = scan_folder(folder_path)
    if files is None:
        return jsonify({'error': '文件夹路径无效'}), 400
    return jsonify({'files': files, 'count': len(files)})
