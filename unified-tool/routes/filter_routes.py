# -*- coding: utf-8 -*-
import base64
from flask import Blueprint, request, jsonify
from models.file_model import load_mapping
from services.filter_service import split_filtered_data

filter_bp = Blueprint('filter', __name__)


@filter_bp.route('/api/split-filtered', methods=['POST'])
def split_filtered():
    data = request.json or {}
    file_data_b64 = data.get('fileDataBase64', '')
    filtered_indices = data.get('filteredRowIndices', [])
    mapping = data.get('mapping') or load_mapping()
    split_column = data.get('splitColumn', '')
    split_groups = data.get('splitGroups')  # {组名: [分局列表]}

    if not file_data_b64:
        return jsonify({'error': '缺少文件数据'}), 400

    try:
        raw_bytes = base64.b64decode(file_data_b64)
    except:
        return jsonify({'error': '文件数据解码失败'}), 400

    result = split_filtered_data(raw_bytes, filtered_indices, mapping, split_column, split_groups)

    if not result['ok']:
        return jsonify({'error': result['error']}), 400

    del result['ok']
    return jsonify(result)
