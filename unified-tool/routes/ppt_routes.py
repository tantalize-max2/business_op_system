# -*- coding: utf-8 -*-
import os
import json
import base64
from flask import Blueprint, request, jsonify, send_file, current_app
from models.ppt_model import (
    list_ppt_templates, save_ppt_template, get_ppt_template,
    delete_ppt_template, generate_ppt, get_last_nz_output, save_last_nz_output
)

ppt_bp = Blueprint('ppt', __name__)


@ppt_bp.route('/api/ppt-templates', methods=['GET'])
def list_ppt_templates_api():
    templates = list_ppt_templates()
    return jsonify({'templates': templates})


@ppt_bp.route('/api/ppt-templates', methods=['POST'])
def save_ppt_template_api():
    data = request.json or {}
    name = (data.get('name') or '').strip()
    template_data = data.get('templateData', '')
    data_file_data = data.get('dataFileData', '')
    if not name:
        return jsonify({'error': '模板名称不能为空'}), 400
    if not template_data and not data_file_data:
        return jsonify({'error': '至少需要提供模板或数据文件'}), 400
    result = save_ppt_template(name, template_data, data_file_data)
    if not result['ok']:
        return jsonify({'error': '保存失败'}), 500
    return jsonify({'message': '模板已保存', 'name': result['name']})


@ppt_bp.route('/api/ppt-templates/<path:name>', methods=['GET'])
def get_ppt_template_api(name):
    data = get_ppt_template(name)
    if data is None:
        return jsonify({'error': '模板不存在'}), 404
    return current_app.response_class(
        response=json.dumps(data, ensure_ascii=False),
        status=200,
        mimetype='application/json'
    )


@ppt_bp.route('/api/ppt-templates/<path:name>', methods=['DELETE'])
def delete_ppt_template_api(name):
    if not delete_ppt_template(name):
        return jsonify({'error': '模板不存在'}), 404
    return jsonify({'message': '模板已删除'})


@ppt_bp.route('/api/ppt-generate', methods=['POST'])
def ppt_generate_api():
    data = request.json or {}
    template_b64 = data.get('templateData', '')
    data_file_b64 = data.get('dataFileData', '')
    custom_texts = data.get('customTexts', {})

    # 如果没有提供数据文件，尝试使用上次标准化输出
    if not data_file_b64:
        nz_output = get_last_nz_output()
        if nz_output and nz_output.get('path'):
            try:
                with open(nz_output['path'], 'rb') as f:
                    data_file_b64 = base64.b64encode(f.read()).decode('utf-8')
            except Exception:
                pass

    if not template_b64:
        return jsonify({'error': '请上传PPT模板文件'}), 400
    if not data_file_b64:
        return jsonify({'error': '请上传数据Excel文件，或在数据标准化步骤执行填充操作'}), 400

    try:
        template_bytes = base64.b64decode(template_b64)
    except Exception:
        return jsonify({'error': 'PPT模板数据解码失败'}), 400

    try:
        data_bytes = base64.b64decode(data_file_b64)
    except Exception:
        return jsonify({'error': '数据文件解码失败'}), 400

    result = generate_ppt(template_bytes, data_bytes, custom_texts)

    if not result['ok']:
        return jsonify({'error': result['error']}), 500

    output_path = result['output_path']
    if not os.path.exists(output_path):
        return jsonify({'error': '生成文件丢失'}), 500

    response = send_file(
        output_path,
        as_attachment=True,
        download_name='商机通报.pptx',
        mimetype='application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )

    @response.call_on_close
    def cleanup():
        try:
            os.unlink(output_path)
        except Exception:
            pass

    return response


@ppt_bp.route('/api/ppt-nz-output', methods=['GET'])
def ppt_nz_output_api():
    """获取上次标准化填充的输出信息"""
    nz_output = get_last_nz_output()
    if nz_output:
        return jsonify({
            'available': True,
            'time': nz_output.get('time', ''),
            'path': nz_output.get('path', '')
        })
    return jsonify({'available': False})
