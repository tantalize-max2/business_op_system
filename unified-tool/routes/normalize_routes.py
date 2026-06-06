# -*- coding: utf-8 -*-
import os
import json
import base64
from flask import Blueprint, request, jsonify, send_file, current_app
from models.normalize_model import (list_nz_templates, save_nz_template, get_nz_template,
                                     delete_nz_template, fill_template)

normalize_bp = Blueprint('normalize', __name__)


@normalize_bp.route('/api/nz-templates', methods=['GET'])
def list_nz_templates_api():
    templates = list_nz_templates()
    return jsonify({'templates': templates})


@normalize_bp.route('/api/nz-templates', methods=['POST'])
def save_nz_template_api():
    data = request.json or {}
    name = (data.get('name') or '').strip()
    file_data = data.get('fileData', '')
    if not name:
        return jsonify({'error': '模板名称不能为空'}), 400
    if not file_data:
        return jsonify({'error': '模板数据不能为空'}), 400
    result = save_nz_template(name, file_data)
    if not result['ok']:
        return jsonify({'error': result['error']}), 400
    return jsonify({'message': '模板已保存', 'name': result['name']})


@normalize_bp.route('/api/nz-templates/<path:name>', methods=['GET'])
def get_nz_template_api(name):
    data = get_nz_template(name)
    if data is None:
        return jsonify({'error': '模板不存在'}), 404
    return current_app.response_class(
        response=json.dumps(data, ensure_ascii=False),
        status=200,
        mimetype='application/json'
    )


@normalize_bp.route('/api/nz-templates/<path:name>', methods=['DELETE'])
def delete_nz_template_api(name):
    if not delete_nz_template(name):
        return jsonify({'error': '模板不存在'}), 404
    return jsonify({'message': '模板已删除'})


@normalize_bp.route('/api/nz-fill', methods=['POST'])
def nz_fill_template():
    data = request.json or {}
    template_b64 = data.get('templateData', '')
    stats_data = data.get('statsData', {})
    cell_edits = data.get('cellEdits', [])
    cell_formats = data.get('cellFormats', [])

    if not template_b64:
        return jsonify({'error': '缺少模板数据'}), 400

    try:
        raw = base64.b64decode(template_b64)
    except:
        return jsonify({'error': '模板数据解码失败'}), 400

    result = fill_template(raw, stats_data, cell_edits, cell_formats)

    if not result['ok']:
        return jsonify({'error': result['error']}), 500

    tmp_in = result['tmp_in']
    tmp_out = result['tmp_out']

    response = send_file(
        tmp_out,
        as_attachment=True,
        download_name='填充结果.xlsx',
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )

    @response.call_on_close
    def cleanup():
        try:
            os.unlink(tmp_in)
            os.unlink(tmp_out)
        except:
            pass

    return response
