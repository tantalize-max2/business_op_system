# -*- coding: utf-8 -*-
"""
商机数据综合分析工具 - Flask 后端 (MVC架构)
功能：分局拆分（基于过滤后数据）、格式保持、文件下载、WebSocket进度推送
"""

from flask import Flask, request
from flask_cors import CORS
from flasgger import Swagger
import os
from config import ensure_dirs
from middleware.auth import require_token, is_auth_enabled
from services.progress_service import socketio
from routes.file_routes import file_bp
from routes.filter_routes import filter_bp
from routes.stats_routes import stats_bp
from routes.normalize_routes import normalize_bp
from routes.ppt_routes import ppt_bp
from routes.push_routes import push_bp
from routes.email_routes import email_bp

ensure_dirs()

app = Flask(__name__, static_folder='static', static_url_path='')

# Swagger API 文档配置（访问 /apidocs）
app.config['SWAGGER'] = {
    'title': '商机数据综合分析工具 API',
    'version': '1.0.0',
    'description': '分局拆分、格式标准化、PPT通报生成、邮件发送等接口文档',
    'uiversion': 3,
}
Swagger(app)

# CORS 来源限制：未配置 CORS_ORIGINS 时默认放开（适合本地开发）；
# 生产部署时通过环境变量限定允许的前端地址（逗号分隔）。
_cors_origins_env = os.environ.get('CORS_ORIGINS', '').strip()
if _cors_origins_env:
    CORS(app, origins=[o.strip() for o in _cors_origins_env.split(',') if o.strip()])
else:
    CORS(app)

# 将 SocketIO 绑定到 Flask app
socketio.init_app(app)

# API Token 认证：仅当设置了环境变量 API_TOKEN 时启用，校验所有 /api/ 请求
@app.before_request
def _auth_check():
    if request.path.startswith('/api/'):
        return require_token()

app.register_blueprint(file_bp)
app.register_blueprint(filter_bp)
app.register_blueprint(stats_bp)
app.register_blueprint(normalize_bp)
app.register_blueprint(ppt_bp)
app.register_blueprint(push_bp)
app.register_blueprint(email_bp)


@socketio.on('connect')
def _on_connect():
    """客户端连接 WebSocket 时触发。"""
    pass


if __name__ == '__main__':
    debug = os.environ.get('FLASK_DEBUG', '1') == '1'
    if is_auth_enabled():
        print('[安全] API Token 认证已启用')
    print('[文档] API 文档: http://localhost:9527/apidocs')
    print('[WebSocket] 进度推送已启用')
    # SocketIO 替代 app.run，支持 WebSocket 长连接
    socketio.run(app, host='0.0.0.0', port=9527, debug=debug, allow_unsafe_werkzeug=True)
