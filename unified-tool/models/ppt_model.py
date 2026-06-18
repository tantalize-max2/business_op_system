# -*- coding: utf-8 -*-
"""PPT 模板数据存取层（纯 JSON CRUD + 上次标准化输出状态）

业务逻辑（数据读取、格式化、PPT 生成）已迁移至 services/ppt_service.py。
本模块仅负责 PPT 模板持久化与上次标准化输出路径记录。
"""
import os
from datetime import datetime
from config import PPT_TEMPLATES_DIR, PPT_DATA_DIR
from utils.storage import load_json, save_json, safe_filename


def ppt_template_path(name):
    return os.path.join(PPT_TEMPLATES_DIR, f"{safe_filename(name)}.json")


def list_ppt_templates():
    """列出所有 PPT 模板摘要（按保存时间倒序）。"""
    templates = []
    if not os.path.exists(PPT_TEMPLATES_DIR):
        return templates
    for fname in os.listdir(PPT_TEMPLATES_DIR):
        if not fname.endswith('.json'):
            continue
        data = load_json(os.path.join(PPT_TEMPLATES_DIR, fname), default={})
        if not data:
            continue
        templates.append({
            'name': data.get('name', fname[:-5]),
            'savedAt': data.get('savedAt', 0),
            'hasDataFile': bool(data.get('dataFileData')),
            'hasTemplate': bool(data.get('templateData'))
        })
    templates.sort(key=lambda t: t.get('savedAt', 0), reverse=True)
    return templates


def save_ppt_template(name, template_data=None, data_file_data=None, data_map=None):
    """保存 PPT 模板（含模板文件、数据文件、数据映射）。"""
    template_record = {
        'name': name,
        'templateData': template_data or '',
        'dataFileData': data_file_data or '',
        'dataMap': data_map or {},
        'savedAt': datetime.now().timestamp() * 1000
    }
    save_json(ppt_template_path(name), template_record)
    return {'ok': True, 'name': name}


def get_ppt_template(name):
    """读取单个 PPT 模板完整数据，不存在返回 None。"""
    fpath = ppt_template_path(name)
    if not os.path.exists(fpath):
        return None
    return load_json(fpath, default=None)


def delete_ppt_template(name):
    """删除 PPT 模板，不存在返回 False。"""
    fpath = ppt_template_path(name)
    if not os.path.exists(fpath):
        return False
    os.remove(fpath)
    return True


def save_last_nz_output(output_path):
    """保存最近一次标准化填充的输出路径（供 PPT 模块读取）。"""
    state_file = os.path.join(PPT_DATA_DIR, 'last_nz_output.json')
    save_json(state_file, {'path': output_path, 'time': datetime.now().isoformat()})


def get_last_nz_output():
    """获取最近一次标准化填充的输出路径信息。"""
    state_file = os.path.join(PPT_DATA_DIR, 'last_nz_output.json')
    data = load_json(state_file, default=None)
    if not data:
        return None
    path = data.get('path', '')
    if path and os.path.exists(path):
        return data
    return None
