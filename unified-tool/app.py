# -*- coding: utf-8 -*-
"""
商机数据综合分析工具 - Flask 后端 (MVC架构)
功能：分局拆分（基于过滤后数据）、格式保持、文件下载
"""

from flask import Flask
from flask_cors import CORS
from config import ensure_dirs
from routes.file_routes import file_bp
from routes.filter_routes import filter_bp
from routes.stats_routes import stats_bp
from routes.normalize_routes import normalize_bp
from routes.push_routes import push_bp
from routes.email_routes import email_bp

ensure_dirs()

app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)

app.register_blueprint(file_bp)
app.register_blueprint(filter_bp)
app.register_blueprint(stats_bp)
app.register_blueprint(normalize_bp)
app.register_blueprint(push_bp)
app.register_blueprint(email_bp)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5557, debug=True)
