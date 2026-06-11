# -*- coding: utf-8 -*-
import os
import re
import json
from config import MAPPING_FILE, TEMPLATES_DIR, DEFAULT_MAPPING, SPLIT_GROUPS_FILE, DEFAULT_SPLIT_GROUPS


def template_path(name):
    safe_name = re.sub(r'[^\w\u4e00-\u9fff\-\.]', '_', name)
    return os.path.join(TEMPLATES_DIR, f"{safe_name}.json")


def load_mapping():
    if os.path.exists(MAPPING_FILE):
        try:
            with open(MAPPING_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return DEFAULT_MAPPING.copy()


def save_mapping(mapping):
    with open(MAPPING_FILE, 'w', encoding='utf-8') as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)


def list_bureau_templates():
    templates = []
    for fname in os.listdir(TEMPLATES_DIR):
        if not fname.endswith('.json'):
            continue
        fpath = os.path.join(TEMPLATES_DIR, fname)
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            templates.append({
                'name': data.get('name', fname[:-5]),
                'bureauCount': len(data.get('mapping', {})),
                'savedAt': data.get('savedAt', 0)
            })
        except:
            pass
    templates.sort(key=lambda t: t.get('savedAt', 0), reverse=True)
    return templates


def save_bureau_template(name, mapping, saved_at, split_groups=None):
    template_data = {
        'name': name,
        'mapping': mapping,
        'savedAt': saved_at
    }
    if split_groups:
        template_data['splitGroups'] = split_groups
    fpath = template_path(name)
    with open(fpath, 'w', encoding='utf-8') as f:
        json.dump(template_data, f, ensure_ascii=False, indent=2)
    return name


def get_bureau_template(name):
    fpath = template_path(name)
    if not os.path.exists(fpath):
        return None
    with open(fpath, 'r', encoding='utf-8') as f:
        return json.load(f)


def delete_bureau_template(name):
    fpath = template_path(name)
    if not os.path.exists(fpath):
        return False
    os.remove(fpath)
    return True


def load_split_groups():
    """加载拆分组配置，如不存在则返回默认值"""
    if os.path.exists(SPLIT_GROUPS_FILE):
        try:
            with open(SPLIT_GROUPS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return DEFAULT_SPLIT_GROUPS.copy()


def save_split_groups(groups):
    """保存拆分组配置"""
    with open(SPLIT_GROUPS_FILE, 'w', encoding='utf-8') as f:
        json.dump(groups, f, ensure_ascii=False, indent=2)
