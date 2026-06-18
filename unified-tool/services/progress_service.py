# -*- coding: utf-8 -*-
"""WebSocket 进度推送

统一封装 SocketIO 实例和进度事件发送逻辑。
所有长任务（拆分、PPT生成）通过 emit_progress 发送进度，
前端监听 'task_progress' 事件更新进度条。

事件格式：
    { task: 'split' | 'ppt', percent: 0-100, message: str, done: bool }

容错：如果 flask-socketio 因环境问题（如 Windows SSL 证书库损坏）无法导入，
自动降级为无 WebSocket 模式，emit_progress 变为空操作，不影响应用正常启动。
"""

try:
    from flask_socketio import SocketIO
    # 异步模式用 threading（无需额外 worker 进程，适合单机内网工具）
    socketio = SocketIO(async_mode='threading', cors_allowed_origins='*', logger=False, engineio_logger=False)
    _ws_enabled = True
except Exception as e:
    import logging
    logging.warning('flask-socketio 加载失败，WebSocket 进度推送不可用（不影响其他功能）: %s', e)

    # 降级：创建与 SocketIO 接口兼容的空壳对象，避免调用方崩溃
    class _SocketIOStub:
        def init_app(self, *a, **kw):
            pass
        def run(self, app, *a, **kw):
            # 降级时回退到普通 Flask run
            app.run(*a, **kw)
        def emit(self, *a, **kw):
            pass
        def on(self, *a, **kw):
            def deco(f):
                return f
            return deco

    socketio = _SocketIOStub()
    _ws_enabled = False


def is_ws_enabled():
    """WebSocket 是否可用（flask-socketio 是否成功加载）"""
    return _ws_enabled


def emit_progress(task, percent, message='', done=False, extra=None):
    """发送任务进度事件。WebSocket 不可用时为空操作。

    Args:
        task: 任务标识，如 'split'（拆分）、'ppt'（PPT生成）
        percent: 进度百分比 0-100
        message: 进度描述文字
        done: 是否完成（True 时前端隐藏进度条）
        extra: 额外数据 dict（如 result）
    """
    if not _ws_enabled:
        return
    payload = {'task': task, 'percent': min(100, max(0, percent)), 'message': message, 'done': done}
    if extra:
        payload.update(extra)
    socketio.emit('task_progress', payload, namespace='/')
