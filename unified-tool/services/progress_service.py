# -*- coding: utf-8 -*-
"""WebSocket 进度推送

统一封装 SocketIO 实例和进度事件发送逻辑。
所有长任务（拆分、PPT生成）通过 emit_progress 发送进度，
前端监听 'task_progress' 事件更新进度条。

事件格式：
    { task: 'split' | 'ppt', percent: 0-100, message: str, done: bool }
"""
from flask_socketio import SocketIO

# 异步模式用 threading（无需额外 worker 进程，适合单机内网工具）
socketio = SocketIO(async_mode='threading', cors_allowed_origins='*', logger=False, engineio_logger=False)


def emit_progress(task, percent, message='', done=False, extra=None):
    """发送任务进度事件。

    Args:
        task: 任务标识，如 'split'（拆分）、'ppt'（PPT生成）
        percent: 进度百分比 0-100
        message: 进度描述文字
        done: 是否完成（True 时前端隐藏进度条）
        extra: 额外数据 dict（如 result）
    """
    payload = {'task': task, 'percent': min(100, max(0, percent)), 'message': message, 'done': done}
    if extra:
        payload.update(extra)
    socketio.emit('task_progress', payload, namespace='/')
