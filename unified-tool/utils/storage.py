# -*- coding: utf-8 -*-
"""通用 JSON 文件存取工具

所有 model 层的 JSON 持久化统一走这里，保证错误处理与编码一致。
"""
import os
import json


def load_json(filepath, default=None):
    """读取 JSON 文件。文件不存在或解析失败时返回 default。"""
    if default is None:
        default = []
    if not os.path.exists(filepath):
        return default
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError, OSError):
        return default


def save_json(filepath, data):
    """写入 JSON 文件（UTF-8，缩进2空格，不转义中文）。"""
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def safe_filename(name):
    """将任意名称转为安全的文件名（保留中文、字母、数字、-、.，其余替换为 _）。"""
    import re
    return re.sub(r'[^\w\u4e00-\u9fff\-\.]', '_', name)
