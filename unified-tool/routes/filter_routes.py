# -*- coding: utf-8 -*-
import base64
from flask import Blueprint, request, jsonify
from models.file_model import load_mapping
from services.filter_service import split_filtered_data

filter_bp = Blueprint('filter', __name__)


@filter_bp.route('/api/split-filtered', methods=['POST'])
def split_filtered():
    """按过滤条件拆分商机数据为多个分局/分组文件
    ---
    tags:
      - 拆分
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          required: [fileDataBase64]
          properties:
            fileDataBase64:
              type: string
              description: 原始商机文件（xlsx/xls）的 base64 编码
            filteredRowIndices:
              type: array
              items: {type: integer}
              description: 需要参与拆分的行索引列表
            mapping:
              type: object
              description: 表头到字段的映射配置（不传则使用默认映射）
            splitColumn:
              type: string
              description: 用于拆分的列名（默认按客户经理列）
            splitGroups:
              type: object
              description: 自定义分组配置，键为组名，值为分局列表
    responses:
      200:
        description: 拆分成功
        schema:
          type: object
          properties:
            files:
              type: array
              description: 生成的拆分文件信息列表
              items:
                type: object
                properties:
                  name: {type: string, description: "文件名"}
                  path: {type: string, description: "服务器保存路径"}
                  size: {type: integer, description: "文件大小(字节)"}
                  count: {type: integer, description: "该文件包含的行数"}
      400:
        description: 参数错误（缺少文件数据 / base64 解码失败 / 拆分失败）
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    data = request.json or {}
    file_data_b64 = data.get('fileDataBase64', '')
    filtered_indices = data.get('filteredRowIndices', [])
    mapping = data.get('mapping') or load_mapping()
    split_column = data.get('splitColumn', '')
    split_groups = data.get('splitGroups')  # {组名: [分局列表]}
    skip_rows = data.get('skipRows', 0)

    if not file_data_b64:
        return jsonify({'error': '缺少文件数据'}), 400

    try:
        raw_bytes = base64.b64decode(file_data_b64)
    except:
        return jsonify({'error': '文件数据解码失败'}), 400

    result = split_filtered_data(raw_bytes, filtered_indices, mapping, split_column, split_groups, skip_rows)

    if not result['ok']:
        return jsonify({'error': result['error']}), 400

    del result['ok']
    return jsonify(result)
