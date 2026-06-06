# -*- coding: utf-8 -*-
import os
import json
from datetime import datetime
from flask import Blueprint, request, jsonify, current_app
from config import CONFIGS_DIR

stats_bp = Blueprint('stats', __name__)


def _config_path(name):
    safe_name = __import__('re').sub(r'[^\w\u4e00-\u9fff\-\.]', '_', name)
    return os.path.join(CONFIGS_DIR, f"{safe_name}.json")


@stats_bp.route('/api/configs', methods=['GET'])
def list_configs():
    configs = []
    for fname in os.listdir(CONFIGS_DIR):
        if not fname.endswith('.json'):
            continue
        fpath = os.path.join(CONFIGS_DIR, fname)
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            cfg = data.get('cfg', {})
            mapping_data = cfg.get('mappingData')
            configs.append({
                'name': data.get('name', fname[:-5]),
                'sig': data.get('sig', ''),
                'savedAt': data.get('savedAt', 0),
                'fileNames': [fd.get('name', '') for fd in cfg.get('files', [])],
                'hasMapping': mapping_data is not None and isinstance(mapping_data, dict) and len(mapping_data) > 0,
                'mappingCount': len(mapping_data) if isinstance(mapping_data, dict) else 0
            })
        except:
            pass
    configs.sort(key=lambda c: c.get('savedAt', 0), reverse=True)
    return current_app.response_class(
        response=json.dumps(configs, ensure_ascii=False),
        status=200,
        mimetype='application/json'
    )


@stats_bp.route('/api/configs', methods=['POST'])
def save_config():
    data = request.json or {}
    name = data.get('name', '').strip()
    cfg = data.get('cfg')
    sig = data.get('sig', '')
    if not name:
        return jsonify({'error': '配置名称不能为空'}), 400
    if not cfg:
        return jsonify({'error': '配置数据不能为空'}), 400
    config_data = {
        'name': name,
        'sig': sig,
        'cfg': cfg,
        'savedAt': data.get('savedAt', datetime.now().timestamp() * 1000)
    }
    fpath = _config_path(name)
    existing = [f for f in os.listdir(CONFIGS_DIR) if f.endswith('.json')]
    if len(existing) >= 20 and not os.path.exists(fpath):
        all_configs = []
        for ef in existing:
            ep = os.path.join(CONFIGS_DIR, ef)
            try:
                with open(ep, 'r', encoding='utf-8') as f:
                    d = json.load(f)
                all_configs.append((ef, d.get('savedAt', 0)))
            except:
                all_configs.append((ef, 0))
        all_configs.sort(key=lambda x: x[1])
        os.remove(os.path.join(CONFIGS_DIR, all_configs[0][0]))
    with open(fpath, 'w', encoding='utf-8') as f:
        json.dump(config_data, f, ensure_ascii=False)
    return jsonify({'message': '配置已保存', 'name': name})


@stats_bp.route('/api/configs/<path:name>', methods=['GET'])
def get_config(name):
    fpath = _config_path(name)
    if not os.path.exists(fpath):
        return jsonify({'error': '配置不存在'}), 404
    with open(fpath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return current_app.response_class(
        response=json.dumps(data, ensure_ascii=False),
        status=200,
        mimetype='application/json'
    )


@stats_bp.route('/api/configs/<path:name>', methods=['DELETE'])
def delete_config(name):
    fpath = _config_path(name)
    if not os.path.exists(fpath):
        return jsonify({'error': '配置不存在'}), 404
    os.remove(fpath)
    return jsonify({'message': '配置已删除'})
