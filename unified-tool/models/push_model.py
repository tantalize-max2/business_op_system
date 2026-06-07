# -*- coding: utf-8 -*-
import os
import json
import http.client
import ssl
import time
import uuid
import zipfile
from datetime import datetime
from urllib.parse import urlparse
import pandas as pd
from flask import send_file, send_from_directory
from config import DATA_DIR, SHEETS_FILE, KDOCS_CATS_FILE, OUTPUT_DIR


def _load_kdocs_sheets():
    if os.path.exists(SHEETS_FILE):
        try:
            with open(SHEETS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return []


def _save_kdocs_sheets(sheets):
    with open(SHEETS_FILE, 'w', encoding='utf-8') as f:
        json.dump(sheets, f, ensure_ascii=False, indent=2)


def _load_kdocs_cats():
    if os.path.exists(KDOCS_CATS_FILE):
        try:
            with open(KDOCS_CATS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return [{'id': 'default', 'name': '默认', 'color': '#0d9488'}]


def _save_kdocs_cats(cats):
    with open(KDOCS_CATS_FILE, 'w', encoding='utf-8') as f:
        json.dump(cats, f, ensure_ascii=False, indent=2)


def browse_local_fs(path):
    import platform
    is_windows = platform.system() == 'Windows'

    if path == '__drives__':
        if is_windows:
            # Windows: 枚举盘符
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
            # Linux/Docker: 以数据目录为根（用户上传的文件在 data/uploads 下）
            dirs = []
            try:
                for item in os.listdir(DATA_DIR):
                    full = os.path.join(DATA_DIR, item)
                    if os.path.isdir(full):
                        dirs.append({'name': item, 'path': full})
            except PermissionError:
                pass
            return {
                'current': DATA_DIR,
                'current_display': '数据目录',
                'parent': '',
                'dirs': sorted(dirs, key=lambda x: x['name'].lower()),
                'files': [],
                'is_drives': True
            }

    # 默认路径：Windows 用用户主目录，Linux 用数据目录
    if not path:
        path = os.path.expanduser('~') if is_windows else DATA_DIR
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

    # 计算父目录
    parent = ''
    if is_windows:
        if path and len(path) <= 3 and path.endswith(':\\'):
            parent = '__drives__'
        elif path:
            parent = os.path.dirname(path)
            if parent == path:
                parent = '__drives__'
    else:
        # Linux: 到达数据目录根后不再往上
        if os.path.abspath(path) == os.path.abspath(DATA_DIR):
            parent = '__drives__'
        elif path:
            parent = os.path.dirname(path)

    return {
        'current': path,
        'parent': parent,
        'dirs': sorted(dirs, key=lambda x: x['name'].lower()),
        'files': sorted(files, key=lambda x: x['name'].lower()),
        'is_dir': os.path.isdir(path)
    }


def list_kdocs_cats_with_count():
    cats = _load_kdocs_cats()
    sheets = _load_kdocs_sheets()
    for c in cats:
        c['count'] = sum(1 for s in sheets if s.get('category') == c['id'])
    return cats


def add_kdocs_cat(name, color):
    cats = _load_kdocs_cats()
    if any(c['name'] == name for c in cats):
        return None
    cat = {'id': str(uuid.uuid4())[:8], 'name': name, 'color': color}
    cats.append(cat)
    _save_kdocs_cats(cats)
    return cat


def delete_kdocs_cat(cid):
    cats = _load_kdocs_cats()
    cats = [c for c in cats if not (c['id'] == cid and c['id'] == 'default')]
    _save_kdocs_cats(cats)
    sheets = _load_kdocs_sheets()
    for s in sheets:
        if s.get('category') == cid:
            s['category'] = 'default'
    _save_kdocs_sheets(sheets)


def list_kdocs_sheets(cat_id=''):
    sheets = _load_kdocs_sheets()
    if cat_id:
        sheets = [s for s in sheets if s.get('category', 'default') == cat_id]
    return sheets


def add_kdocs_sheet(name, url, api_token, webhook_url, excel_path, batch_size, category):
    sheets = _load_kdocs_sheets()
    sheet = {
        'id': str(uuid.uuid4())[:8],
        'name': name,
        'url': url,
        'api_token': api_token,
        'webhook_url': webhook_url,
        'excel_path': excel_path,
        'batch_size': batch_size,
        'category': category,
        'created_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'updated_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    }
    sheets.append(sheet)
    _save_kdocs_sheets(sheets)
    return sheet


def update_kdocs_sheet(sid, data):
    sheets = _load_kdocs_sheets()
    for s in sheets:
        if s['id'] == sid:
            for k in ['name', 'url', 'api_token', 'webhook_url', 'excel_path', 'batch_size', 'category']:
                if k in data:
                    s[k] = data[k]
            s['updated_at'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            _save_kdocs_sheets(sheets)
            return s
    return None


def delete_kdocs_sheet(sid):
    sheets = _load_kdocs_sheets()
    sheets = [s for s in sheets if s['id'] != sid]
    _save_kdocs_sheets(sheets)


def _do_push(sheet_cfg, excel_path):
    api_token = sheet_cfg.get('api_token', '')
    webhook_url = sheet_cfg.get('webhook_url', '')
    batch_size = sheet_cfg.get('batch_size', 3)

    parsed = urlparse(webhook_url)
    host = parsed.hostname or "www.kdocs.cn"
    path = parsed.path

    try:
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
    except Exception as e:
        return {'success_count': 0, 'fail_count': 0, 'message': f'读取Excel失败: {str(e)}'}

    success_count = 0
    fail_count = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        try:
            conn = http.client.HTTPSConnection(host, context=ssl._create_unverified_context(), timeout=30)
            pl = json.dumps({"Context": {"argv": {"columns": columns, "rows": batch}}}, ensure_ascii=False)
            headers = {"Content-Type": "application/json", "AirScript-Token": api_token}
            conn.request("POST", path, pl.encode("utf-8"), headers)
            resp = conn.getresponse()
            result = json.loads(resp.read().decode("utf-8"))
            conn.close()

            error = result.get("error", "")
            if error:
                fail_count += len(batch)
                continue

            script_result = result.get("data", {}).get("result", "")
            ret = script_result
            if isinstance(ret, str) and ret and ret != "[Undefined]":
                try:
                    ret = json.loads(ret)
                except:
                    pass
            if isinstance(ret, dict) and ret.get("success"):
                success_count += ret.get("writeCount", len(batch))
            else:
                fail_count += len(batch)
        except:
            fail_count += len(batch)

        if i + batch_size < len(rows):
            time.sleep(1.5)

    msg = f'成功 {success_count} 行，失败 {fail_count} 行'
    return {'success_count': success_count, 'fail_count': fail_count, 'message': msg}


def push_to_kdocs(sid, excel_path=''):
    sheets = _load_kdocs_sheets()
    sheet_cfg = None
    for s in sheets:
        if s['id'] == sid:
            sheet_cfg = s
            break

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

    try:
        conn = http.client.HTTPSConnection(host, context=ssl._create_unverified_context(), timeout=15)
        payload = json.dumps({"Context": {"argv": {"action": "info"}}}, ensure_ascii=False)
        headers_k = {"Content-Type": "application/json", "AirScript-Token": api_token}
        conn.request("POST", path, payload.encode("utf-8"), headers_k)
        res = conn.getresponse()
        result = json.loads(res.read().decode("utf-8"))
        conn.close()
        if result.get("error"):
            return {'error': f'Webhook连接异常: {result["error"]}'}
    except Exception as e:
        return {'error': f'Webhook连接失败: {str(e)}'}

    try:
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
    except Exception as e:
        return {'error': f'读取Excel失败: {str(e)}'}

    total_batches = (len(rows) + batch_size - 1) // batch_size
    success_count = 0
    fail_count = 0
    details = []

    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        batch_num = i // batch_size + 1
        try:
            conn = http.client.HTTPSConnection(host, context=ssl._create_unverified_context(), timeout=30)
            pl = json.dumps({"Context": {"argv": {"columns": columns, "rows": batch}}}, ensure_ascii=False)
            h = {"Content-Type": "application/json", "AirScript-Token": api_token}
            conn.request("POST", path, pl.encode("utf-8"), h)
            resp = conn.getresponse()
            result = json.loads(resp.read().decode("utf-8"))
            conn.close()

            error = result.get("error", "")
            if error:
                fail_count += len(batch)
                details.append(f"批{batch_num}: 失败 - {error}")
                continue

            script_result = result.get("data", {}).get("result", "")
            try:
                ret = script_result
                if isinstance(ret, str) and ret and ret != "[Undefined]":
                    ret = json.loads(ret)
                if isinstance(ret, dict) and ret.get("success"):
                    success_count += ret.get("writeCount", len(batch))
                    details.append(f"批{batch_num}: 成功 - 写入{ret.get('writeCount','?')}行 (起始行{ret.get('startRow','?')})")
                else:
                    fail_count += len(batch)
                    details.append(f"批{batch_num}: 脚本返回错误 - {str(ret)[:100]}")
            except Exception as e:
                fail_count += len(batch)
                details.append(f"批{batch_num}: 解析异常 - {str(e)}")

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
    if not folder_path or not os.path.isdir(folder_path):
        return {'error': '文件夹路径无效'}

    sheets = _load_kdocs_sheets()
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
            results.append({'id': s['id'], 'name': s['name'], 'file': matched_name, 'status': 'skip', 'message': 'API_TOKEN或WEBHOOK_URL未配置'})
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


def get_airscript_code():
    code_path = os.path.join(DATA_DIR, 'airscript_code.js')
    if not os.path.exists(code_path):
        return None
    try:
        with open(code_path, 'r', encoding='utf-8') as f:
            code = f.read()
        return code
    except Exception:
        return None


def save_airscript_code(code):
    code_path = os.path.join(DATA_DIR, 'airscript_code.js')
    try:
        with open(code_path, 'w', encoding='utf-8') as f:
            f.write(code)
        return True
    except Exception:
        return False


def scan_folder(folder_path):
    if not folder_path or not os.path.isdir(folder_path):
        return None
    files = []
    for f in os.listdir(folder_path):
        if f.endswith(('.xlsx', '.xls')) and not f.startswith('~$'):
            fpath = os.path.join(folder_path, f)
            fsize = os.path.getsize(fpath)
            files.append({'name': f, 'path': fpath, 'size': fsize})
    return files
