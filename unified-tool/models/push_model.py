# -*- coding: utf-8 -*-
"""金山文档推送数据存取层（纯 JSON/文件存取）

业务逻辑（文件浏览、推送、分类/表格编排）已迁移至 services/push_service.py。
本模块仅负责 kdocs 表格配置、分类配置、AirScript 脚本的持久化。
"""
import os
from config import SHEETS_FILE, KDOCS_CATS_FILE, DATA_DIR
from utils.storage import load_json, save_json

_DEFAULT_CATS = [{'id': 'default', 'name': '默认', 'color': '#0d9488'}]


def load_kdocs_sheets():
    """读取所有在线表格配置，不存在返回空列表。"""
    return load_json(SHEETS_FILE, default=[])


def save_kdocs_sheets(sheets):
    """保存在线表格配置列表。"""
    save_json(SHEETS_FILE, sheets)


def load_kdocs_cats():
    """读取分类列表，不存在返回默认分类。"""
    cats = load_json(KDOCS_CATS_FILE, default=None)
    if cats is None:
        return list(_DEFAULT_CATS)
    return cats


def save_kdocs_cats(cats):
    """保存分类列表。"""
    save_json(KDOCS_CATS_FILE, cats)


def get_airscript_code():
    """读取 AirScript 脚本代码，不存在返回 None。"""
    code_path = os.path.join(DATA_DIR, 'airscript_code.js')
    if not os.path.exists(code_path):
        return None
    try:
        with open(code_path, 'r', encoding='utf-8') as f:
            return f.read()
    except (IOError, OSError):
        return None


def save_airscript_code(code):
    """保存 AirScript 脚本代码，成功返回 True。"""
    code_path = os.path.join(DATA_DIR, 'airscript_code.js')
    try:
        with open(code_path, 'w', encoding='utf-8') as f:
            f.write(code)
        return True
    except (IOError, OSError):
        return False
