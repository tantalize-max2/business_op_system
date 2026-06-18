# -*- coding: utf-8 -*-
"""统计配置数据存取层（纯 JSON CRUD）

从原 routes/stats_routes.py 抽取。本模块仅负责统计配置的持久化。
20个上限淘汰等业务规则由 services/stats_service.py 负责。
"""
import os
from config import CONFIGS_DIR
from utils.storage import load_json, save_json, safe_filename


def config_path(name):
    return os.path.join(CONFIGS_DIR, f"{safe_filename(name)}.json")


def load_config(name):
    """读取单个统计配置，不存在返回 None。"""
    fpath = config_path(name)
    if not os.path.exists(fpath):
        return None
    return load_json(fpath, default=None)


def save_config(name, config_data):
    """保存统计配置（覆盖写入）。"""
    save_json(config_path(name), config_data)


def delete_config(name):
    """删除统计配置，不存在返回 False。"""
    fpath = config_path(name)
    if not os.path.exists(fpath):
        return False
    os.remove(fpath)
    return True


def list_config_files():
    """列出配置目录下所有 JSON 文件名（含扩展名）。"""
    if not os.path.exists(CONFIGS_DIR):
        return []
    return [f for f in os.listdir(CONFIGS_DIR) if f.endswith('.json')]
