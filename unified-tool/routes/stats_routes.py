# -*- coding: utf-8 -*-
import json
from datetime import datetime
from flask import Blueprint, request, jsonify, current_app
from services.stats_service import list_configs, save_config_with_limit, get_config, delete_config_api

stats_bp = Blueprint('stats', __name__)


@stats_bp.route('/api/configs', methods=['GET'])
def list_configs_api():
    """获取所有统计配置列表
    ---
    tags:
      - 统计配置
    responses:
      200:
        description: 配置列表
        schema:
          type: array
          items:
            type: object
            properties:
              name: {type: string, description: "配置名称"}
              cfg: {type: object, description: "配置内容（表头/分组/统计项）"}
              sig: {type: string, description: "配置签名"}
              savedAt: {type: number, description: "保存时间戳(毫秒)"}
    """
    configs = list_configs()
    return current_app.response_class(
        response=json.dumps(configs, ensure_ascii=False),
        status=200,
        mimetype='application/json'
    )


@stats_bp.route('/api/configs', methods=['POST'])
def save_config_api():
    """保存（新增或覆盖）一个统计配置
    ---
    tags:
      - 统计配置
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          required: [name, cfg]
          properties:
            name: {type: string, description: "配置名称（唯一）"}
            cfg:
              type: object
              description: 配置内容（表头映射、分组、统计项等）
            sig: {type: string, description: "配置签名（用于校验/版本）"}
            savedAt: {type: number, description: "保存时间戳(毫秒)，不传则使用当前时间"}
    responses:
      200:
        description: 保存成功
        schema:
          type: object
          properties:
            message: {type: string}
            name: {type: string}
      400:
        description: 参数错误（名称/配置为空）
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
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
    """根据名称获取单个统计配置详情
    ---
    tags:
      - 统计配置
    parameters:
      - name: name
        in: path
        type: string
        required: true
        description: 配置名称
    responses:
      200:
        description: 配置详情
        schema:
          type: object
          properties:
            name: {type: string}
            cfg: {type: object}
            sig: {type: string}
            savedAt: {type: number}
      404:
        description: 配置不存在
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
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
    """删除指定名称的统计配置
    ---
    tags:
      - 统计配置
    parameters:
      - name: name
        in: path
        type: string
        required: true
        description: 配置名称
    responses:
      200:
        description: 删除成功
        schema:
          type: object
          properties:
            message: {type: string}
      404:
        description: 配置不存在
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    if not delete_config_api(name):
        return jsonify({'error': '配置不存在'}), 404
    return jsonify({'message': '配置已删除'})
