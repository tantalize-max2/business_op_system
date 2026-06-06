# -*- coding: utf-8 -*-
import os
import re
import json
import tempfile
from datetime import datetime
import base64
from openpyxl import load_workbook
from openpyxl.styles import Font, Alignment
from openpyxl.utils import get_column_letter
from config import NZ_TEMPLATES_DIR


_formula_pattern = re.compile(r'\{\{(.+?)\}\}')
_cell_ref_pattern = re.compile(r'\b([A-Z]{1,3})(\d{1,5})\b')
_func_pattern = re.compile(r'\b(SUM|AVG)\s*\(([^)]+)\)', re.IGNORECASE)


def nz_template_path(name):
    safe_name = re.sub(r'[^\w\u4e00-\u9fff\-\.]', '_', name)
    return os.path.join(NZ_TEMPLATES_DIR, f"{safe_name}.json")


def list_nz_templates():
    templates = []
    if os.path.exists(NZ_TEMPLATES_DIR):
        for fname in os.listdir(NZ_TEMPLATES_DIR):
            if not fname.endswith('.json'):
                continue
            fpath = os.path.join(NZ_TEMPLATES_DIR, fname)
            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                templates.append({
                    'name': data.get('name', fname[:-5]),
                    'savedAt': data.get('savedAt', 0),
                    'sheetCount': data.get('sheetCount', 0)
                })
            except:
                pass
    templates.sort(key=lambda t: t.get('savedAt', 0), reverse=True)
    return templates


def save_nz_template(name, file_data):
    try:
        raw = base64.b64decode(file_data)
        tmp = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
        tmp.write(raw)
        tmp.close()
        wb = load_workbook(tmp.name)
        sheet_count = len(wb.sheetnames)
        wb.close()
        os.unlink(tmp.name)
    except Exception as e:
        return {'ok': False, 'error': f'模板文件无效: {str(e)}'}

    template_data = {
        'name': name,
        'fileData': file_data,
        'savedAt': datetime.now().timestamp() * 1000,
        'sheetCount': sheet_count
    }
    fpath = nz_template_path(name)
    with open(fpath, 'w', encoding='utf-8') as f:
        json.dump(template_data, f, ensure_ascii=False)
    return {'ok': True, 'name': name}


def get_nz_template(name):
    fpath = nz_template_path(name)
    if not os.path.exists(fpath):
        return None
    with open(fpath, 'r', encoding='utf-8') as f:
        return json.load(f)


def delete_nz_template(name):
    fpath = nz_template_path(name)
    if not os.path.exists(fpath):
        return False
    os.remove(fpath)
    return True


def nz_resolve_formula_str(formula_str, stats_data):
    m = re.match(r'^\{\{(.+?)\}\}$', formula_str.strip())
    if not m:
        m = re.search(r'\{\{(.+?)\}\}', formula_str.strip())
        if not m:
            return {'ok': False, 'value': '格式错误'}
    inner = m.group(1).strip()
    slash_idx = inner.rfind('/')
    if slash_idx < 0:
        return {'ok': False, 'value': '格式错误(无/指标)'}
    metric = inner[slash_idx + 1:].strip()
    path = inner[:slash_idx].strip()
    parts = path.split(':')
    parts = [p.strip() for p in parts]

    file_idx = None
    try:
        file_idx = int(parts[0])
    except (ValueError, IndexError):
        return {'ok': False, 'value': '文件序号无效'}

    if file_idx < 1:
        return {'ok': False, 'value': '文件序号无效'}

    fi_str = str(file_idx)
    if fi_str not in stats_data:
        return {'ok': False, 'value': '未匹配(文件不存在)'}

    fd = stats_data[fi_str]
    entries = fd.get('entries', [])
    total = fd.get('total', {})
    sum_col = fd.get('sumCol', '')

    l1, col = '', ''
    entry_name = ''

    if len(parts) == 2 and parts[1] == '总合计':
        return _nz_resolve_metric(total, '', metric, sum_col, None, None, fd)

    if len(parts) == 2:
        entry_name = parts[1]
    elif len(parts) == 3:
        l1 = parts[1]
        entry_name = parts[2]
    elif len(parts) == 4:
        l1 = parts[1]
        entry_name = parts[2]
        col = parts[3]
    elif len(parts) >= 5:
        l1 = parts[1]
        remaining = parts[2:]
        if remaining and '.' in remaining[-1]:
            col = remaining[-1]
            entry_name = ' · '.join(remaining[:-1])
        else:
            entry_name = ' · '.join(remaining)

    ac_col, ac_val = None, None
    if col and '.' in col:
        dp = col.split('.', 1)
        ac_col, ac_val = dp[0], dp[1]

    if l1 and entry_name == '合计':
        l1_total = None
        for e in entries:
            if e.get('isL1Total') and e.get('l1Name') == l1:
                l1_total = e
                break
        if not l1_total:
            return {'ok': False, 'value': '未匹配'}
        return _nz_resolve_metric(l1_total, col, metric, sum_col, ac_col, ac_val, fd)

    if entry_name == '总合计' or (not l1 and entry_name == '总合计'):
        return _nz_resolve_metric(total, col, metric, sum_col, ac_col, ac_val, fd)

    entry = None
    if l1:
        for e in entries:
            if e.get('isGroup') and e.get('l1Name') == l1 and e.get('name', '') == entry_name:
                entry = e
                break
        if not entry:
            for e in entries:
                if e.get('isL1Total') and e.get('l1Name') == l1:
                    entry = e
                    break
    else:
        for e in entries:
            if e.get('isGroup') and not e.get('l1Name') and e.get('name', '') == entry_name:
                entry = e
                break

    if not entry:
        return {'ok': False, 'value': '未匹配'}

    return _nz_resolve_metric(entry, col, metric, sum_col, ac_col, ac_val, fd)


def _nz_resolve_metric(entry, col, metric, sum_col, ac_col, ac_val, fd):
    if metric == '数量':
        if ac_col and ac_val:
            ac_data = entry.get('acData', {})
            tc = ac_data.get(ac_col, {})
            return {'ok': True, 'value': tc.get(ac_val, 0)}
        return {'ok': True, 'value': entry.get('count', 0)}
    if metric == '占比':
        pct = entry.get('pct', '0')
        try:
            return {'ok': True, 'value': float(pct)}
        except:
            return {'ok': False, 'value': '占比解析失败'}
    if metric == '求和':
        target_col = col or sum_col
        if not target_col:
            return {'ok': False, 'value': '未匹配(无求和列)'}
        s = entry.get('sum')
        if s is not None:
            try:
                return {'ok': True, 'value': float(s)}
            except:
                pass
        return {'ok': False, 'value': '未匹配(求和)'}
    if metric == '均值':
        target_col = col or sum_col
        if not target_col:
            return {'ok': False, 'value': '未匹配(无求和列)'}
        s = entry.get('sum')
        c = entry.get('count', 0)
        if s is not None and c > 0:
            try:
                return {'ok': True, 'value': float(s) / c}
            except:
                pass
        return {'ok': True, 'value': 0}
    return {'ok': False, 'value': '未知指标'}


def _get_cell_value(ws_obj, col_str, row_str):
    try:
        col_idx = 0
        for ch in col_str:
            col_idx = col_idx * 26 + (ord(ch) - ord('A') + 1)
        row_idx = int(row_str)
        if row_idx < 1 or col_idx < 1:
            return None
        c = ws_obj.cell(row=row_idx, column=col_idx)
        if c.value is None:
            return 0
        return c.value
    except:
        return None


def _resolve_cell_refs_in_expr(expr_str, ws_obj, stats_data, visited=None):
    if visited is None:
        visited = set()
    def replace_ref(m):
        col_s, row_s = m.group(1), m.group(2)
        ref_key = f"{col_s}{row_s}"
        if ref_key in visited:
            return 'NaN'
        visited.add(ref_key)
        val = _get_cell_value(ws_obj, col_s, row_s)
        if val is None:
            return 'NaN'
        val_str = str(val).strip()
        if val_str.startswith('='):
            inner = val_str[1:]
            inner = _formula_pattern.sub(lambda fm: str(nz_resolve_formula_str(fm.group(0), stats_data).get('value', 'NaN')), inner)
            inner = _resolve_cell_refs_in_expr(inner, ws_obj, stats_data, visited)
            try:
                safe = re.sub(r'[^0-9+\-*/().eE\s]', '', inner)
                result = eval(safe)
                if isinstance(result, (int, float)):
                    return str(result)
                return 'NaN'
            except:
                return 'NaN'
        try:
            num = float(val)
            if '.' not in str(val) and isinstance(val, int):
                return str(val)
            return str(num)
        except (ValueError, TypeError):
            return 'NaN'
    return _cell_ref_pattern.sub(replace_ref, expr_str)


def _resolve_range_values(range_str, ws_obj, visited=None):
    if visited is None:
        visited = set()
    values = []
    parts = [p.strip() for p in range_str.split(',')]
    range_re = re.compile(r'^([A-Z]{1,3})(\d{1,5}):([A-Z]{1,3})(\d{1,5})$')
    cell_re = re.compile(r'^([A-Z]{1,3})(\d{1,5})$')
    for part in parts:
        rm = range_re.match(part)
        if rm:
            c1 = 0
            for ch in rm.group(1):
                c1 = c1 * 26 + (ord(ch) - ord('A') + 1)
            r1 = int(rm.group(2))
            c2 = 0
            for ch in rm.group(3):
                c2 = c2 * 26 + (ord(ch) - ord('A') + 1)
            r2 = int(rm.group(4))
            min_r, max_r = min(r1, r2), max(r1, r2)
            min_c, max_c = min(c1, c2), max(c1, c2)
            for rr in range(min_r, max_r + 1):
                for cc in range(min_c, max_c + 1):
                    ref_key = f"{rr},{cc}"
                    if ref_key in visited:
                        continue
                    visited.add(ref_key)
                    cv = ws_obj.cell(row=rr, column=cc).value
                    if cv is not None:
                        try:
                            v = float(cv)
                            values.append(v)
                        except (ValueError, TypeError):
                            pass
        else:
            cm = cell_re.match(part)
            if cm:
                col_s, row_s = cm.group(1), cm.group(2)
                ref_key = f"{col_s}{row_s}"
                if ref_key not in visited:
                    visited.add(ref_key)
                    val = _get_cell_value(ws_obj, col_s, row_s)
                    if val is not None:
                        try:
                            values.append(float(val))
                        except (ValueError, TypeError):
                            pass
    return values


def _resolve_funcs(expr_str, ws_obj, visited=None):
    if visited is None:
        visited = set()
    def replace_func(m):
        fn = m.group(1).upper()
        args = m.group(2)
        vals = _resolve_range_values(args, ws_obj, visited)
        if not vals:
            return 'NaN'
        if fn == 'SUM':
            return str(sum(vals))
        elif fn == 'AVG':
            return str(sum(vals) / len(vals))
        return 'NaN'
    return _func_pattern.sub(replace_func, expr_str)


def _resolve_formulas_in_expr(expr, stats_data):
    all_ok = [True]
    def replace_fn(match):
        result = nz_resolve_formula_str(match.group(0), stats_data)
        if result['ok']:
            return str(result['value'])
        all_ok[0] = False
        return 'NaN'
    resolved = _formula_pattern.sub(replace_fn, expr)
    return resolved, all_ok[0]


def _resolve_formulas_in_text(text, stats_data):
    any_fail = [False]
    def replace_fn(match):
        result = nz_resolve_formula_str(match.group(0), stats_data)
        if result['ok']:
            return str(result['value'])
        any_fail[0] = True
        return match.group(0)
    resolved = _formula_pattern.sub(replace_fn, text)
    return resolved, not any_fail[0]


def fill_template(template_bytes, stats_data, cell_edits, cell_formats):
    tmp_in = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_in.write(template_bytes)
    tmp_in.close()
    tmp_out = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_out.close()

    try:
        wb = load_workbook(tmp_in.name)
    except Exception as e:
        os.unlink(tmp_in.name)
        os.unlink(tmp_out.name)
        return {'ok': False, 'error': f'读取模板失败: {str(e)}'}

    for edit in cell_edits:
        si = edit.get('sheet', 0)
        r = edit.get('row', 0)
        c = edit.get('col', 0)
        val = edit.get('value', '')
        if si < 0 or si >= len(wb.sheetnames):
            continue
        ws = wb.worksheets[si]
        cell = ws.cell(row=r + 1, column=c + 1)
        try:
            num_val = float(val) if val and '.' in val else (int(val) if val and val.lstrip('-').isdigit() else None)
        except (ValueError, TypeError, AttributeError):
            num_val = None
        if num_val is not None:
            cell.value = num_val
        else:
            cell.value = val

    for fmt_item in cell_formats:
        si = fmt_item.get('sheet', 0)
        r = fmt_item.get('row', 0)
        c = fmt_item.get('col', 0)
        fmt = fmt_item.get('fmt', {})
        if si < 0 or si >= len(wb.sheetnames):
            continue
        ws = wb.worksheets[si]
        cell = ws.cell(row=r + 1, column=c + 1)
        if fmt.get('bold') or fmt.get('italic') or fmt.get('fontSize') or fmt.get('fontName'):
            cell.font = Font(
                bold=fmt.get('bold', False),
                italic=fmt.get('italic', False),
                size=fmt.get('fontSize'),
                name=fmt.get('fontName')
            )
        if fmt.get('align'):
            align_map = {'left': 'left', 'center': 'center', 'right': 'right'}
            cell.alignment = Alignment(horizontal=align_map.get(fmt['align'], 'left'))

    fill_count = 0
    fail_count = 0

    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if cell.value is None:
                    continue
                cell_str = str(cell.value).strip()

                has_formula = _formula_pattern.search(cell_str) or cell_str.startswith('=')
                if not has_formula:
                    continue

                if cell_str.startswith('='):
                    expr = cell_str[1:]

                    expr, all_ok = _resolve_formulas_in_expr(expr, stats_data)
                    if not all_ok:
                        cell.value = '公式解析失败'
                        fail_count += 1
                        continue

                    visited = set()
                    self_col = get_column_letter(cell.column)
                    self_row = str(cell.row)
                    visited.add(f"{self_col}{self_row}")
                    expr = _resolve_funcs(expr, ws, visited)
                    if 'NaN' in expr:
                        cell.value = '函数解析失败'
                        fail_count += 1
                        continue

                    expr = _resolve_cell_refs_in_expr(expr, ws, stats_data, visited)
                    if 'NaN' in expr:
                        cell.value = '引用解析失败'
                        fail_count += 1
                        continue

                    safe_expr = re.sub(r'[^0-9+\-*/().eE\s]', '', expr)
                    try:
                        num_result = eval(safe_expr)
                        if isinstance(num_result, (int, float)) and str(num_result) != 'nan':
                            cell.value = num_result
                            fill_count += 1
                        else:
                            cell.value = '计算错误'
                            fail_count += 1
                    except:
                        cell.value = '表达式错误'
                        fail_count += 1

                elif re.match(r'^\{\{(.+?)\}\}$', cell_str):
                    result = nz_resolve_formula_str(cell_str, stats_data)
                    if result['ok']:
                        val = result['value']
                        cell.value = val
                        fill_count += 1
                    else:
                        cell.value = str(result['value'])
                        fail_count += 1

                else:
                    final_val, ok = _resolve_formulas_in_text(cell_str, stats_data)
                    cell.value = final_val
                    if not ok:
                        fail_count += 1
                    else:
                        fill_count += 1

    fmt_lookup = {}
    for fmt_item in cell_formats:
        key = (fmt_item.get('sheet', 0), fmt_item.get('row', 0), fmt_item.get('col', 0))
        fmt_lookup[key] = fmt_item.get('fmt', {})

    for ws_idx, ws in enumerate(wb.worksheets):
        for row in ws.iter_rows():
            for cell in row:
                if cell.value is None:
                    continue
                key = (ws_idx, cell.row - 1, cell.column - 1)
                fmt = fmt_lookup.get(key, {})
                decimal = fmt.get('decimal', None)
                isPercent = fmt.get('percent', False)
                if decimal is None and not isPercent:
                    continue
                try:
                    v = float(cell.value)
                except (ValueError, TypeError):
                    continue
                if isPercent:
                    v = v * 100
                d = decimal if decimal is not None else 2
                factor = 10 ** d
                rounded = round(v * factor) / factor
                if isPercent:
                    cell.value = f"{rounded:.{d}f}%"
                else:
                    cell.value = round(v, d) if d > 0 else int(rounded)
                if isPercent:
                    cell.number_format = '0%' if d == 0 else f'0.{"0" * d}%'
                elif d > 0:
                    cell.number_format = f'0.{"0" * d}'

    try:
        wb.save(tmp_out.name)
        wb.close()
    except Exception as e:
        wb.close()
        os.unlink(tmp_in.name)
        os.unlink(tmp_out.name)
        return {'ok': False, 'error': f'保存失败: {str(e)}'}

    return {
        'ok': True,
        'tmp_in': tmp_in.name,
        'tmp_out': tmp_out.name,
        'fill_count': fill_count,
        'fail_count': fail_count
    }
