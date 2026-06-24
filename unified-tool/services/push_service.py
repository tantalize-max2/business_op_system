# -*- coding: utf-8 -*-
"""金山文档推送服务层 - 文件浏览、分类/表格编排、AirScript 推送的业务逻辑

从原 models/push_model.py 迁移。数据存取由 models/push_model.py 负责。
"""
import os
import json
import time
import uuid
import http.client
import ssl
from urllib.parse import urlparse
import pandas as pd
from config import UPLOAD_DIR
from models.push_model import (load_kdocs_sheets, save_kdocs_sheets,
                                load_kdocs_cats, save_kdocs_cats)


# ========== 文件浏览 ==========

def browse_local_fs(path):
    """浏览本地文件系统，返回目录结构。"""
    import platform
    is_windows = platform.system() == 'Windows'

    if path == '__drives__':
        if is_windows:
            drives = []
            for letter in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ':
                d = f'{letter}:\\'
                if os.path.exists(d):
                    drives.append({'name': f'{letter}:', 'path': d, 'is_drive': True})
            return {
                'current': '__drives__',
                'current_display': '此电脑',
                'parent': '',
                'dirs': drives,
                'files': [],
                'is_drives': True
            }
        else:
            return browse_local_fs(UPLOAD_DIR)

    if not path:
        path = os.path.expanduser('~') if is_windows else UPLOAD_DIR
    if not os.path.exists(path):
        return {'error': f'路径不存在: {path}'}

    dirs = []
    files = []
    try:
        for item in os.listdir(path):
            full = os.path.join(path, item)
            if os.path.isdir(full):
                dirs.append({'name': item, 'path': full})
            elif item.endswith(('.xlsx', '.xls')) and not item.startswith('~$'):
                files.append({'name': item, 'path': full, 'size': os.path.getsize(full)})
    except PermissionError:
        return {'error': '无权限访问该路径'}

    parent = ''
    if is_windows:
        if path and len(path) <= 3 and path.endswith(':\\'):
            parent = '__drives__'
        elif path:
            parent = os.path.dirname(path)
            if parent == path:
                parent = '__drives__'
    else:
        if os.path.abspath(path) == os.path.abspath(UPLOAD_DIR):
            parent = ''
        elif path:
            parent = os.path.dirname(path)

    return {
        'current': path,
        'parent': parent,
        'dirs': sorted(dirs, key=lambda x: x['name'].lower()),
        'files': sorted(files, key=lambda x: x['name'].lower()),
        'is_dir': os.path.isdir(path)
    }


def scan_folder(folder_path):
    """扫描文件夹中的 Excel 文件。"""
    if not folder_path or not os.path.isdir(folder_path):
        return None
    files = []
    for f in os.listdir(folder_path):
        if f.endswith(('.xlsx', '.xls')) and not f.startswith('~$'):
            fpath = os.path.join(folder_path, f)
            files.append({'name': f, 'path': fpath, 'size': os.path.getsize(fpath)})
    return files


# ========== 分类编排 ==========

def list_kdocs_cats_with_count():
    """列出所有分类及其关联表格数。"""
    cats = load_kdocs_cats()
    sheets = load_kdocs_sheets()
    for c in cats:
        c['count'] = sum(1 for s in sheets if s.get('category') == c['id'])
    return cats


def add_kdocs_cat(name, color):
    """添加分类，名称重复返回 None。"""
    cats = load_kdocs_cats()
    if any(c['name'] == name for c in cats):
        return None
    cat = {'id': str(uuid.uuid4())[:8], 'name': name, 'color': color}
    cats.append(cat)
    save_kdocs_cats(cats)
    return cat


def delete_kdocs_cat(cid):
    """删除分类（默认分类不可删），关联表格归入默认分类。"""
    cats = load_kdocs_cats()
    cats = [c for c in cats if not (c['id'] == cid and cid != 'default')]
    save_kdocs_cats(cats)
    sheets = load_kdocs_sheets()
    for s in sheets:
        if s.get('category') == cid:
            s['category'] = 'default'
    save_kdocs_sheets(sheets)


# ========== 表格配置编排 ==========

def list_kdocs_sheets(cat_id=''):
    """列出在线表格配置，可按分类过滤。"""
    sheets = load_kdocs_sheets()
    if cat_id:
        sheets = [s for s in sheets if s.get('category', 'default') == cat_id]
    return sheets


def add_kdocs_sheet(name, url, api_token, webhook_url, excel_path, batch_size, category):
    """新增在线表格配置。"""
    sheets = load_kdocs_sheets()
    now = datetime_now_str()
    sheet = {
        'id': str(uuid.uuid4())[:8],
        'name': name,
        'url': url,
        'api_token': api_token,
        'webhook_url': webhook_url,
        'excel_path': excel_path,
        'batch_size': batch_size,
        'category': category,
        'created_at': now,
        'updated_at': now,
    }
    sheets.append(sheet)
    save_kdocs_sheets(sheets)
    return sheet


def update_kdocs_sheet(sid, data):
    """更新在线表格配置，不存在返回 None。"""
    sheets = load_kdocs_sheets()
    for s in sheets:
        if s['id'] == sid:
            for k in ['name', 'url', 'api_token', 'webhook_url', 'excel_path', 'batch_size', 'category']:
                if k in data:
                    s[k] = data[k]
            s['updated_at'] = datetime_now_str()
            save_kdocs_sheets(sheets)
            return s
    return None


def delete_kdocs_sheet(sid):
    """删除在线表格配置。"""
    sheets = load_kdocs_sheets()
    sheets = [s for s in sheets if s['id'] != sid]
    save_kdocs_sheets(sheets)


def datetime_now_str():
    from datetime import datetime
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


# ========== 推送逻辑 ==========

def _read_excel_rows(excel_path):
    """读取 Excel 为 [{col: val}, ...] 列表。"""
    df = pd.read_excel(excel_path)
    columns = list(df.columns)
    rows = []
    for _, row in df.iterrows():
        row_data = {}
        for col in columns:
            val = row[col]
            if pd.isna(val):
                row_data[col] = ""
            elif isinstance(val, float) and val == int(val):
                row_data[col] = int(val)
            else:
                row_data[col] = str(val)
        rows.append(row_data)
    return columns, rows


def _call_airscript(host, path, api_token, argv, timeout=30):
    """调用 AirScript webhook，返回解析后的结果 dict。"""
    conn = http.client.HTTPSConnection(host, context=ssl._create_unverified_context(), timeout=timeout)
    pl = json.dumps({"Context": {"argv": argv}}, ensure_ascii=False)
    headers = {"Content-Type": "application/json", "AirScript-Token": api_token}
    conn.request("POST", path, pl.encode("utf-8"), headers)
    resp = conn.getresponse()
    result = json.loads(resp.read().decode("utf-8"))
    conn.close()
    return result


def _parse_script_result(result):
    """解析 AirScript 返回，提取成功标志和写入数。"""
    error = result.get("error", "")
    if error:
        return False, 0, error
    script_result = result.get("data", {}).get("result", "")
    ret = script_result
    if isinstance(ret, str) and ret and ret != "[Undefined]":
        try:
            ret = json.loads(ret)
        except (json.JSONDecodeError, ValueError):
            pass
    if isinstance(ret, dict) and ret.get("success"):
        return True, ret.get("writeCount", 0), None
    return False, 0, str(ret)[:100] if ret else '空结果'


def _do_push(sheet_cfg, excel_path):
    """执行单次推送（简洁版，用于批量推送）。"""
    api_token = sheet_cfg.get('api_token', '')
    webhook_url = sheet_cfg.get('webhook_url', '')
    batch_size = sheet_cfg.get('batch_size', 3)

    parsed = urlparse(webhook_url)
    host = parsed.hostname or "www.kdocs.cn"
    path = parsed.path

    try:
        columns, rows = _read_excel_rows(excel_path)
    except Exception as e:
        return {'success_count': 0, 'fail_count': 0, 'message': f'读取Excel失败: {str(e)}'}

    success_count = 0
    fail_count = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        try:
            result = _call_airscript(host, path, api_token, {"columns": columns, "rows": batch})
            ok, write_count, err = _parse_script_result(result)
            if ok:
                success_count += write_count or len(batch)
            else:
                fail_count += len(batch)
        except Exception:
            fail_count += len(batch)

        if i + batch_size < len(rows):
            time.sleep(1.5)

    return {'success_count': success_count, 'fail_count': fail_count,
            'message': f'成功 {success_count} 行，失败 {fail_count} 行'}


def push_to_kdocs(sid, excel_path=''):
    """推送单个在线表格。先校验 webhook 连通性，再分批推送。"""
    sheets = load_kdocs_sheets()
    sheet_cfg = next((s for s in sheets if s['id'] == sid), None)

    if not sheet_cfg:
        return {'error': '未找到该在线表格配置'}

    api_token = sheet_cfg.get('api_token', '')
    webhook_url = sheet_cfg.get('webhook_url', '')
    batch_size = sheet_cfg.get('batch_size', 3)

    if not api_token or not webhook_url:
        return {'error': 'API_TOKEN 或 WEBHOOK_URL 未配置'}

    if not excel_path:
        excel_path = sheet_cfg.get('excel_path', '')
    if not excel_path:
        return {'error': '未指定本地Excel文件路径'}
    if not os.path.exists(excel_path):
        return {'error': f'文件不存在: {excel_path}'}

    parsed = urlparse(webhook_url)
    host = parsed.hostname or "www.kdocs.cn"
    path = parsed.path

    # 连通性校验
    try:
        result = _call_airscript(host, path, api_token, {"action": "info"}, timeout=15)
        if result.get("error"):
            return {'error': f'Webhook连接异常: {result["error"]}'}
    except Exception as e:
        return {'error': f'Webhook连接失败: {str(e)}'}

    try:
        columns, rows = _read_excel_rows(excel_path)
    except Exception as e:
        return {'error': f'读取Excel失败: {str(e)}'}

    success_count = 0
    fail_count = 0
    details = []

    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        batch_num = i // batch_size + 1
        try:
            result = _call_airscript(host, path, api_token, {"columns": columns, "rows": batch})
            ok, write_count, err = _parse_script_result(result)
            if ok:
                success_count += write_count or len(batch)
                details.append(f"批{batch_num}: 成功 - 写入{write_count or '?'}行")
            else:
                fail_count += len(batch)
                details.append(f"批{batch_num}: 失败 - {err}")
        except Exception as e:
            fail_count += len(batch)
            details.append(f"批{batch_num}: 请求异常 - {str(e)}")

        if i + batch_size < len(rows):
            time.sleep(1.5)

    return {
        'message': f'推送完成：成功 {success_count} 行，失败 {fail_count} 行',
        'success_count': success_count,
        'fail_count': fail_count,
        'total_rows': len(rows),
        'details': details
    }


def push_to_kdocs_batch(folder_path):
    """批量推送：遍历文件夹，按文件名匹配在线表格配置并推送。"""
    if not folder_path or not os.path.isdir(folder_path):
        return {'error': '文件夹路径无效'}

    sheets = load_kdocs_sheets()
    if not sheets:
        return {'error': '暂无在线表格配置'}

    local_files = {}
    for f in os.listdir(folder_path):
        if f.endswith(('.xlsx', '.xls')) and not f.startswith('~$'):
            local_files[f.lower()] = os.path.join(folder_path, f)

    results = []
    for s in sheets:
        online_name = s['name'].replace('.xlsx', '').replace('.xls', '').lower()
        matched_file = None
        matched_name = None
        for lf_name, lf_path in local_files.items():
            lf_base = lf_name.replace('.xlsx', '').replace('.xls', '')
            if online_name and lf_base and (online_name in lf_base or lf_base in online_name):
                matched_file = lf_path
                matched_name = lf_name
                break

        if not matched_file:
            continue

        if not s.get('api_token') or not s.get('webhook_url'):
            results.append({'id': s['id'], 'name': s['name'], 'file': matched_name,
                            'status': 'skip', 'message': 'API_TOKEN或WEBHOOK_URL未配置'})
            continue

        push_result = _do_push(s, matched_file)
        results.append({
            'id': s['id'],
            'name': s['name'],
            'file': matched_name,
            'status': 'ok' if push_result.get('fail_count', 0) == 0 else 'partial',
            'success_count': push_result.get('success_count', 0),
            'fail_count': push_result.get('fail_count', 0),
            'message': push_result.get('message', '')
        })

    return {'results': results, 'total_matched': len(results)}
