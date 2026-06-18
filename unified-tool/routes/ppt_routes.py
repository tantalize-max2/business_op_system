# -*- coding: utf-8 -*-
import os
import json
import base64
from flask import Blueprint, request, jsonify, send_file, current_app
from models.ppt_model import (
    list_ppt_templates, save_ppt_template, get_ppt_template,
    delete_ppt_template, get_last_nz_output
)
from services.ppt_service import generate_ppt, preview_data_regions

ppt_bp = Blueprint('ppt', __name__)


@ppt_bp.route('/api/ppt-templates', methods=['GET'])
def list_ppt_templates_api():
    """获取所有 PPT 通报模板列表
    ---
    tags:
      - PPT通报
    responses:
      200:
        description: 模板列表
        schema:
          type: object
          properties:
            templates:
              type: array
              items:
                type: object
                properties:
                  name: {type: string, description: "模板名称"}
                  savedAt: {type: number, description: "保存时间戳(毫秒)"}
    """
    templates = list_ppt_templates()
    return jsonify({'templates': templates})


@ppt_bp.route('/api/ppt-templates', methods=['POST'])
def save_ppt_template_api():
    """保存一个新的 PPT 通报模板（含 PPT 模板与数据 Excel）
    ---
    tags:
      - PPT通报
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          required: [name]
          properties:
            name: {type: string, description: "模板名称"}
            templateData:
              type: string
              description: PPT 模板文件（pptx）的 base64 编码
            dataFileData:
              type: string
              description: 数据 Excel 文件（xlsx）的 base64 编码
            dataMap:
              type: object
              description: 数据区域到 PPT 区域的映射配置
    responses:
      200:
        description: 保存成功
        schema:
          type: object
          properties:
            message: {type: string}
            name: {type: string}
      400:
        description: 参数错误（名称为空 / 至少需要模板或数据文件）
        schema:
          $ref: '#/definitions/ErrorResponse'
      500:
        description: 保存失败
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    data = request.json or {}
    name = (data.get('name') or '').strip()
    template_data = data.get('templateData', '')
    data_file_data = data.get('dataFileData', '')
    data_map = data.get('dataMap')
    if not name:
        return jsonify({'error': '模板名称不能为空'}), 400
    if not template_data and not data_file_data:
        return jsonify({'error': '至少需要提供模板或数据文件'}), 400
    result = save_ppt_template(name, template_data, data_file_data, data_map)
    if not result['ok']:
        return jsonify({'error': '保存失败'}), 500
    return jsonify({'message': '模板已保存', 'name': result['name']})


@ppt_bp.route('/api/ppt-templates/<path:name>', methods=['GET'])
def get_ppt_template_api(name):
    """根据名称获取单个 PPT 通报模板的完整内容
    ---
    tags:
      - PPT通报
    parameters:
      - name: name
        in: path
        type: string
        required: true
        description: 模板名称
    responses:
      200:
        description: 模板详情
        schema:
          type: object
      404:
        description: 模板不存在
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
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
    """删除指定名称的 PPT 通报模板
    ---
    tags:
      - PPT通报
    parameters:
      - name: name
        in: path
        type: string
        required: true
        description: 模板名称
    responses:
      200:
        description: 删除成功
        schema:
          type: object
          properties:
            message: {type: string}
      404:
        description: 模板不存在
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    if not delete_ppt_template(name):
        return jsonify({'error': '模板不存在'}), 404
    return jsonify({'message': '模板已删除'})


@ppt_bp.route('/api/ppt-generate', methods=['POST'])
def ppt_generate_api():
    """根据 PPT 模板和数据 Excel 生成商机通报 PPT
    ---
    tags:
      - PPT通报
    consumes:
      - application/json
    produces:
      - application/vnd.openxmlformats-officedocument.presentationml.presentation
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          required: [templateData]
          properties:
            templateData:
              type: string
              description: PPT 模板文件（pptx）的 base64 编码
            dataFileData:
              type: string
              description: 数据 Excel 的 base64 编码；未传则自动使用上次标准化输出
            customTexts:
              type: object
              description: 自定义替换文本（如标题、日期等）
            dataMap:
              type: object
              description: 数据区域映射覆盖配置
    responses:
      200:
        description: 生成成功，返回 pptx 文件
        schema:
          type: file
        headers:
          X-Ind-Range:
            type: string
            description: 行业图表数据有效区域（调试用，URL编码）
          X-Ind-Chart-Ok:
            type: string
            description: 行业图表是否成功生成 true/false
          X-Comm-Range:
            type: string
            description: 商客图表数据有效区域（调试用，URL编码）
          X-Comm-Chart-Ok:
            type: string
            description: 商客图表是否成功生成 true/false
      400:
        description: 参数错误（缺少模板/数据文件、base64 解码失败）
        schema:
          $ref: '#/definitions/ErrorResponse'
      500:
        description: 生成失败 / 文件丢失
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
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

    result = generate_ppt(template_bytes, data_bytes, custom_texts, data.get('dataMap'))

    if not result['ok']:
        return jsonify({'error': result['error']}), 500

    output_path = result['output_path']
    if not os.path.exists(output_path):
        return jsonify({'error': '生成文件丢失'}), 500

    # 图表调试信息放入自定义响应头（base64编码避免中文问题）
    import urllib.parse
    chart_debug = result.get('chart_debug', {})
    response = send_file(
        output_path,
        as_attachment=True,
        download_name='商机通报.pptx',
        mimetype='application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )

    # 附加调试响应头（值用 urllib.parse.quote 编码中文）
    debug_map = {
        'X-Ind-Range': chart_debug.get('industry_effective_range', ''),
        'X-Ind-Preview': chart_debug.get('industry_data_preview', ''),
        'X-Ind-Chart-Ok': str(chart_debug.get('industry_chart_ok', False)),
        'X-Comm-Range': chart_debug.get('commercial_effective_range', ''),
        'X-Comm-Preview': chart_debug.get('commercial_data_preview', ''),
        'X-Comm-Chart-Ok': str(chart_debug.get('commercial_chart_ok', False)),
    }
    for k, v in debug_map.items():
        response.headers[k] = urllib.parse.quote(str(v), safe='')

    @response.call_on_close
    def cleanup():
        try:
            os.unlink(output_path)
        except Exception:
            pass

    return response


@ppt_bp.route('/api/ppt-nz-output', methods=['GET'])
def ppt_nz_output_api():
    """获取上次标准化填充的输出信息
    ---
    tags:
      - PPT通报
    responses:
      200:
        description: 标准化输出状态
        schema:
          type: object
          properties:
            available:
              type: boolean
              description: 是否有可用的标准化输出
            time: {type: string, description: "生成时间"}
            path: {type: string, description: "服务器内文件路径"}
    """
    nz_output = get_last_nz_output()
    if nz_output:
        return jsonify({
            'available': True,
            'time': nz_output.get('time', ''),
            'path': nz_output.get('path', '')
        })
    return jsonify({'available': False})


@ppt_bp.route('/api/ppt-data-preview', methods=['POST'])
def ppt_data_preview_api():
    """预览PPT模块从数据Excel中读取的各区域内容，用于校准数据匹配
    ---
    tags:
      - PPT通报
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          properties:
            dataFileData:
              type: string
              description: 数据 Excel 的 base64 编码；未传则自动使用上次标准化输出
            dataMap:
              type: object
              description: 数据区域映射配置
    responses:
      200:
        description: 各区域数据预览
        schema:
          type: object
      400:
        description: 无可用数据文件 / base64 解码失败
        schema:
          $ref: '#/definitions/ErrorResponse'
      500:
        description: 预览读取失败
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    from openpyxl import load_workbook as _load_wb
    data = request.json or {}
    data_file_b64 = data.get('dataFileData', '')

    # 如果没有提供数据文件，尝试使用上次标准化输出
    if not data_file_b64:
        nz_output = get_last_nz_output()
        if nz_output and nz_output.get('path'):
            try:
                with open(nz_output['path'], 'rb') as f:
                    data_file_b64 = base64.b64encode(f.read()).decode('utf-8')
            except Exception:
                pass

    if not data_file_b64:
        return jsonify({'error': '没有可用的数据文件'}), 400

    try:
        data_bytes = base64.b64decode(data_file_b64)
    except Exception:
        return jsonify({'error': '数据文件解码失败'}), 400

    try:
        preview = preview_data_regions(data_bytes, data.get('dataMap'))
        return jsonify(preview)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
