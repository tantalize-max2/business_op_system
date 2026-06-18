# -*- coding: utf-8 -*-
"""统计配置服务层 - 配置摘要提取与 20 个上限淘汰的业务逻辑

从原 routes/stats_routes.py 抽取。数据存取由 models/stats_model.py 负责。
"""
import os
from datetime import datetime
from config import CONFIGS_DIR
from models.stats_model import config_path, load_config, save_config, delete_config, list_config_files
from utils.storage import load_json

MAX_CONFIGS = 20


def list_configs():
    """列出所有统计配置摘要（按保存时间倒序）。"""
    configs = []
    for fname in list_config_files():
        fpath = os.path.join(CONFIGS_DIR, fname)
        data = load_json(fpath, default={})
        if not data:
            continue
        cfg = data.get('cfg', {})
        mapping_data = cfg.get('mappingData')
        configs.append({
            'name': data.get('name', fname[:-5]),
            'sig': data.get('sig', ''),
            'savedAt': data.get('savedAt', 0),
            'fileNames': [fd.get('name', '') for fd in cfg.get('files', [])],
            'hasMapping': mapping_data is not None and isinstance(mapping_data, dict) and len(mapping_data) > 0,
            'mappingCount': len(mapping_data) if isinstance(mapping_data, dict) else 0
        })
    configs.sort(key=lambda c: c.get('savedAt', 0), reverse=True)
    return configs


def save_config_with_limit(name, cfg, sig='', saved_at=None):
    """保存统计配置，超过 MAX_CONFIGS 上限时淘汰最旧的。

    Args:
        name: 配置名称
        cfg: 配置数据
        sig: 签名
        saved_at: 保存时间戳（毫秒），None 则取当前

    Returns:
        dict: {ok, name}
    """
    if saved_at is None:
        saved_at = datetime.now().timestamp() * 1000

    config_data = {'name': name, 'sig': sig, 'cfg': cfg, 'savedAt': saved_at}
    fpath = config_path(name)

    # 上限淘汰：仅在新增（非覆盖）且超限时触发
    existing = list_config_files()
    if len(existing) >= MAX_CONFIGS and not os.path.exists(fpath):
        _evict_oldest()

    save_config(name, config_data)
    return {'ok': True, 'name': name}


def _evict_oldest():
    """淘汰最旧的配置文件。"""
    candidates = []
    for fname in list_config_files():
        fpath = os.path.join(CONFIGS_DIR, fname)
        data = load_json(fpath, default={})
        candidates.append((fname, data.get('savedAt', 0)))
    if candidates:
        candidates.sort(key=lambda x: x[1])
        os.remove(os.path.join(CONFIGS_DIR, candidates[0][0]))


def get_config(name):
    return load_config(name)


def delete_config_api(name):
    return delete_config(name)
