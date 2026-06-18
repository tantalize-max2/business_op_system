# -*- coding: utf-8 -*-
import os
import json
import base64
from flask import Blueprint, request, jsonify, send_file, current_app
from models.normalize_model import (list_nz_templates, save_nz_template, get_nz_template,
                                     delete_nz_template)
from services.normalize_service import fill_template
from models.ppt_model import save_last_nz_output

normalize_bp = Blueprint('normalize', __name__)


@normalize_bp.route('/api/nz-templates', methods=['GET'])
def list_nz_templates_api():
    """获取所有标准化模板列表
    ---
    tags:
      - 标准化
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
    templates = list_nz_templates()
    return jsonify({'templates': templates})


@normalize_bp.route('/api/nz-templates', methods=['POST'])
def save_nz_template_api():
    """保存一个新的标准化模板（Excel 模板文件）
    ---
    tags:
      - 标准化
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          required: [name, fileData]
          properties:
            name: {type: string, description: "模板名称（唯一）"}
            fileData:
              type: string
              description: 模板文件（xlsx）的 base64 编码
    responses:
      200:
        description: 保存成功
        schema:
          type: object
          properties:
            message: {type: string}
            name: {type: string, description: "实际保存的模板名称"}
      400:
        description: 参数错误（名称/数据为空、重名等）
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
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
    """根据名称获取单个标准化模板的完整内容
    ---
    tags:
      - 标准化
    parameters:
      - name: name
        in: path
        type: string
        required: true
        description: 模板名称
    responses:
      200:
        description: 模板详情（包含 base64 编码的模板文件及配置）
        schema:
          type: object
      404:
        description: 模板不存在
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
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
    """删除指定名称的标准化模板
    ---
    tags:
      - 标准化
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
    if not delete_nz_template(name):
        return jsonify({'error': '模板不存在'}), 404
    return jsonify({'message': '模板已删除'})


@normalize_bp.route('/api/nz-fill', methods=['POST'])
def nz_fill_template():
    """使用统计数据填充标准化 Excel 模板，返回生成的 xlsx 文件
    ---
    tags:
      - 标准化
    consumes:
      - application/json
    produces:
      - application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
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
              description: 模板文件（xlsx）的 base64 编码
            statsData:
              type: object
              description: 统计数据对象，按字段写入对应单元格
            cellEdits:
              type: array
              description: 单元格手动编辑项
              items: {type: object}
            cellFormats:
              type: array
              description: 单元格格式调整项
              items: {type: object}
    responses:
      200:
        description: 填充成功，返回 xlsx 文件
        schema:
          type: file
      400:
        description: 参数错误（缺少模板 / base64 解码失败）
        schema:
          $ref: '#/definitions/ErrorResponse'
      500:
        description: 模板填充内部错误
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
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

    # 保存标准化输出路径供PPT通报模块使用
    save_last_nz_output(tmp_out)

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
        except:
            pass
        # 注意：不删除 tmp_out，供PPT通报模块通过 get_last_nz_output() 读取
        # 旧文件会在下次标准化输出时被替代（新路径写入 last_nz_output.json）

    return response
