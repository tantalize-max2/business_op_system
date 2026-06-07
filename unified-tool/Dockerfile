# ============================================
# 商机数据综合分析平台 - Dockerfile
# 基于 Playwright 官方镜像（预装 Chromium + 浏览器依赖）
# ============================================

FROM mcr.microsoft.com/playwright/python:v1.49.0-noble

# 设置工作目录
WORKDIR /app

# 设置时区为中国时区
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 设置环境变量，禁止 Python 写入 pyc 缓存、关闭 stdout 缓冲
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# 复制依赖文件并安装（使用清华镜像加速）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    -i https://pypi.tuna.tsinghua.edu.cn/simple

# 复制项目代码
COPY . .

# 确保数据目录存在（首次启动时）
RUN python -c "from config import ensure_dirs; ensure_dirs()"

# 暴露端口
EXPOSE 5557

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=15s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5557/', timeout=5)" || exit 1

# 启动命令（debug 模式由环境变量 FLASK_DEBUG 控制）
CMD ["python", "app.py"]
