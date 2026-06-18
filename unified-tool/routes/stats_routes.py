# -*- coding: utf-8 -*-
import json
from datetime import datetime
from flask import Blueprint, request, jsonify, current_app
from services.stats_service import list_configs, save_config_with_limit, get_config, delete_config_api

stats_bp = Blueprint('stats', __name__)


@stats_bp.route('/api/configs', methods=['GET'])
def list_configs_api():
    configs = list_configs()
    return current_app.response_class(
        response=json.dumps(configs, ensure_ascii=False),
        status=200,
        mimetype='application/json'
    )


@stats_bp.route('/api/configs', methods=['POST'])
def save_config_api():
    data = request.json or {}
    name = data.get('name', '').strip()
    cfg = data.get('cfg')
    sig = data.get('sig', '')
    if not name:
        return jsonify({'error': '配置名称不能为空'}), 400
    if not cfg:
        return jsonify({'error': '配置数据不能为空'}), 400
    saved_at = data.get('savedAt', datetime.now().timestamp() * 1000)
    save_config_with_limit(name, cfg, sig, saved_at)
    return jsonify({'message': '配置已保存', 'name': name})


@stats_bp.route('/api/configs/<path:name>', methods=['GET'])
def get_config_api(name):
    data = get_config(name)
    if data is None:
        return jsonify({'error': '配置不存在'}), 404
    return current_app.response_class(
        response=json.dumps(data, ensure_ascii=False),
        status=200,
        mimetype='application/json'
    )


@stats_bp.route('/api/configs/<path:name>', methods=['DELETE'])
def delete_config_api_route(name):
    if not delete_config_api(name):
        return jsonify({'error': '配置不存在'}), 404
    return jsonify({'message': '配置已删除'})
