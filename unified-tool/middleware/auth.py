# -*- coding: utf-8 -*-
"""API Token 认证中间件

通过环境变量 API_TOKEN 配置：
- 未设置（默认）：不启用认证，适合本地开发。
- 已设置：所有 /api/ 请求需在 X-API-Token 请求头或 ?token= 查询参数中
  携带正确 token，否则返回 401。
"""
import os
from flask import request, jsonify

_API_TOKEN = os.environ.get('API_TOKEN', '').strip()


def is_auth_enabled():
    return bool(_API_TOKEN)


def require_token():
    """before_request 钩子：校验 API token。未配置 API_TOKEN 时直接放行。"""
    if not _API_TOKEN:
        return None
    token = request.headers.get('X-API-Token', '') or request.args.get('token', '')
    if token == _API_TOKEN:
        return None
    return jsonify({'ok': False, 'error': '未授权：API Token 无效或缺失'}), 401
