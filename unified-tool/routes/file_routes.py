# -*- coding: utf-8 -*-
import os
import json
import zipfile
from flask import Blueprint, request, jsonify, send_from_directory, send_file, current_app
from config import OUTPUT_DIR, DEFAULT_MAPPING
from models.file_model import load_mapping, save_mapping, list_bureau_templates, save_bureau_template, get_bureau_template, delete_bureau_template

file_bp = Blueprint('file', __name__)


@file_bp.route('/')
def index():
    return send_from_directory('static', 'index.html')


@file_bp.route('/api/mapping', methods=['GET'])
def get_mapping():
    data = load_mapping()
    return current_app.response_class(
        response=json.dumps(data, ensure_ascii=False),
        status=200,
        mimetype='application/json'
    )


@file_bp.route('/api/mapping', methods=['POST'])
def save_mapping_api():
    mapping = request.json
    if not mapping or not isinstance(mapping, dict):
        return jsonify({'error': '无效的映射数据'}), 400
    save_mapping(mapping)
    return jsonify({'message': '保存成功'})


@file_bp.route('/api/reset-mapping', methods=['POST'])
def reset_mapping():
    save_mapping(DEFAULT_MAPPING.copy())
    return jsonify({'message': '已重置为默认映射'})


@file_bp.route('/api/bureau-templates', methods=['GET'])
def list_bureau_templates_api():
    templates = list_bureau_templates()
    return jsonify(templates)


@file_bp.route('/api/bureau-templates', methods=['POST'])
def save_bureau_template_api():
    data = request.json or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': '模板名称不能为空'}), 400
    mapping = data.get('mapping')
    if not mapping or not isinstance(mapping, dict):
        return jsonify({'error': '映射数据不能为空'}), 400
    saved_at = data.get('savedAt')
    if not saved_at:
        from datetime import datetime
        saved_at = datetime.now().timestamp() * 1000
    save_bureau_template(name, mapping, saved_at)
    return jsonify({'message': '模板已保存', 'name': name})


@file_bp.route('/api/bureau-templates/<path:name>', methods=['GET'])
def get_bureau_template_api(name):
    data = get_bureau_template(name)
    if data is None:
        return jsonify({'error': '模板不存在'}), 404
    return current_app.response_class(
        response=json.dumps(data, ensure_ascii=False),
        status=200,
        mimetype='application/json'
    )


@file_bp.route('/api/bureau-templates/<path:name>', methods=['DELETE'])
def delete_bureau_template_api(name):
    if not delete_bureau_template(name):
        return jsonify({'error': '模板不存在'}), 404
    return jsonify({'message': '模板已删除'})


@file_bp.route('/api/download/<path:filename>')
def download_file(filename):
    return send_file(os.path.join(OUTPUT_DIR, filename), as_attachment=True)


@file_bp.route('/api/download-folder/<path:folder>')
def download_folder(folder):
    folder_path = os.path.join(OUTPUT_DIR, folder)
    if not os.path.isdir(folder_path):
        return jsonify({'error': '文件夹不存在'}), 404
    zip_name = f"{folder}.zip"
    zip_path = os.path.join(OUTPUT_DIR, zip_name)
    if not os.path.exists(zip_path):
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for f in os.listdir(folder_path):
                zf.write(os.path.join(folder_path, f), f)
    return send_file(zip_path, as_attachment=True)
