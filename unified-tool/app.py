# -*- coding: utf-8 -*-
"""
商机数据综合分析工具 - Flask 后端
功能：分局拆分（基于过滤后数据）、格式保持、文件下载
"""

import os
import json
import re
import shutil
import zipfile
import tempfile
import base64
import http.client
import ssl
import time
import uuid
from datetime import datetime
from urllib.parse import urlparse
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
import pandas as pd
from openpyxl import load_workbook, Workbook
from openpyxl.utils import get_column_letter

app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)

# ============ 数据存储 ============
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
UPLOAD_DIR = os.path.join(DATA_DIR, 'uploads')
OUTPUT_DIR = os.path.join(DATA_DIR, 'output')
CONFIGS_DIR = os.path.join(DATA_DIR, 'configs')
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(CONFIGS_DIR, exist_ok=True)

MAPPING_FILE = os.path.join(DATA_DIR, 'bureau_mapping.json')
SHEETS_FILE = os.path.join(DATA_DIR, 'kdocs_sheets.json')
TEMPLATES_DIR = os.path.join(DATA_DIR, 'bureau_templates')
NZ_TEMPLATES_DIR = os.path.join(DATA_DIR, 'nz_templates')
os.makedirs(TEMPLATES_DIR, exist_ok=True)
os.makedirs(NZ_TEMPLATES_DIR, exist_ok=True)

# ============ 默认分局人员映射 ============
DEFAULT_MAPPING = {
    "工业能源政企分局": ["朱晨静", "肖智宇", "杜云帆", "屈容", "陈谦", "唐璐", "杜秋宇"],
    "国有平台政企分局": ["付登会", "蓝旭辉", "田小兰", "颜小琳", "易琴", "杨文", "王越"],
    "健康医疗政企分局": ["潘昱忻", "黎明", "先有为", "王虹丹"],
    "金融证券政企分局": ["贺贤珍", "曹岚", "梁曦宇", "杨彭萱", "张静", "郑文", "刘浩林", "杨真", "杨玮萍"],
    "软件科研政企分局": ["雷世豪", "陈燕", "杨璨宇", "李春江", "潘邓浩", "蒋尧莉", "李永婷", "蒲竑佚", "周建龙", "杨楚琪"],
    "新经济政企分局": ["曾理", "韩思萌", "罗维", "罗霞", "杨佩东", "刘文博", "戚新鹏"],
    "政法应急政企分局": ["王万辞", "徐杨", "袁进", "朱林", "袁新博", "张皓秋", "林佳俊", "黄天玉"],
    "政务政企分局": ["薛笑枫", "廖晓东", "钱宇煊", "吴倩", "杜成思", "黄振宇"],
    "高新孵化园智改数转服务局": ["董小凤", "邱国锋", "龙俊儒"],
    "高新天府生命科技园智改数转服务局": ["杨佳", "蒋建国", "王斯祺"],
    "高新天府软件园智改数转服务局": ["谢思宇", "黄微", "李选玉", "朱勇", "谢勇", "何琼", "高欢", "周莉", "李艺"],
    "金融城商客分局": ["姚尧", "王淑惠", "陈伟智", "曾宇嘉", "罗中伟", "张成铭", "刘荣"],
    "新川商客分局": ["靳扬", "姜春阳", "郑黎霞", "杨晋"],
    "天府新谷商客分局": ["李思锐", "彭倩", "黄燕", "刘鹏洋", "刘星月"],
    "新会展商客分局": ["何艳", "樊志林", "周滨", "蒋稚薇"],
    "天府国际商客分局": ["叶江", "蒋天佑", "杨茜", "李巧巧", "王辰雨", "廖华", "曾明全", "巫婷婷"],
    "环球商客分局": ["曾明", "许可", "钟小燕", "肖福洋", "冯麟霞", "王琴丽"],
    "大源商客分局": ["邱浩锋", "冯兰越", "冯特峰", "裴嘉轩", "何亚琪"],
    "肖芳商客分局": ["任登科", "贾小东", "梁润", "陈雪"],
    "府城商客分局": ["陈磊", "李若玉", "张小龙", "孙雯"],
    "连锁商客分局": ["杨凤翥", "肖帆", "赵娇", "高毛茅", "温有军"],
    "西信商客分局": ["杨力", "王宇", "任少杰", "周雨晴", "刘祖源", "胡文瀚", "赵川川"],
    "东苑商客分局": ["雷蕾", "吴文宪", "孙艺丹", "张宇魁", "聂海林", "陈健明"],
    "校园分局": ["薛程月", "李经霜", "阳文婷", "欧阳晨"]
}


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


def clean_name(name):
    if not isinstance(name, str):
        return ""
    name = re.sub(r'\([^)]*\)', '', name)
    name = re.sub(r'\（[^）]*\）', '', name)
    return name.strip()


def copy_row_with_format(source_sheet, target_sheet, source_row, target_row, max_col):
    for col in range(1, max_col + 1):
        source_cell = source_sheet.cell(row=source_row, column=col)
        target_cell = target_sheet.cell(row=target_row, column=col)
        target_cell.value = source_cell.value
        if source_cell.has_style:
            target_cell.font = source_cell.font.copy()
            target_cell.border = source_cell.border.copy()
            target_cell.fill = source_cell.fill.copy()
            target_cell.number_format = source_cell.number_format
            target_cell.protection = source_cell.protection.copy()
            target_cell.alignment = source_cell.alignment.copy()
        col_letter = get_column_letter(col)
        target_sheet.column_dimensions[col_letter].width = source_sheet.column_dimensions[col_letter].width


def copy_sheet_with_format(source_sheet, target_sheet, row_indices):
    max_col = source_sheet.max_column
    for col in range(1, max_col + 1):
        col_letter = get_column_letter(col)
        target_sheet.column_dimensions[col_letter].width = source_sheet.column_dimensions[col_letter].width
    target_row = 1
    for source_row in row_indices:
        copy_row_with_format(source_sheet, target_sheet, source_row, target_row, max_col)
        if source_sheet.row_dimensions[source_row].height:
            target_sheet.row_dimensions[target_row].height = source_sheet.row_dimensions[source_row].height
        target_row += 1
    target_sheet.sheet_format = source_sheet.sheet_format
    target_sheet.page_setup = source_sheet.page_setup
    target_sheet.page_margins = source_sheet.page_margins


# ============ API 路由 ============

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


@app.route('/api/mapping', methods=['GET'])
def get_mapping():
    data = load_mapping()
    # 使用 json.dumps 而非 jsonify，保留键的插入顺序（不排序）
    return app.response_class(
        response=json.dumps(data, ensure_ascii=False),
        status=200,
        mimetype='application/json'
    )


@app.route('/api/mapping', methods=['POST'])
def save_mapping_api():
    mapping = request.json
    if not mapping or not isinstance(mapping, dict):
        return jsonify({'error': '无效的映射数据'}), 400
    save_mapping(mapping)
    return jsonify({'message': '保存成功'})


@app.route('/api/reset-mapping', methods=['POST'])
def reset_mapping():
    save_mapping(DEFAULT_MAPPING.copy())
    return jsonify({'message': '已重置为默认映射'})


# ============ 分局模板 API ============

def _template_path(name):
    safe_name = re.sub(r'[^\w\u4e00-\u9fff\-\.]', '_', name)
    return os.path.join(TEMPLATES_DIR, f"{safe_name}.json")


@app.route('/api/bureau-templates', methods=['GET'])
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
    return jsonify(templates)


@app.route('/api/bureau-templates', methods=['POST'])
def save_bureau_template():
    data = request.json or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': '模板名称不能为空'}), 400
    mapping = data.get('mapping')
    if not mapping or not isinstance(mapping, dict):
        return jsonify({'error': '映射数据不能为空'}), 400
    template_data = {
        'name': name,
        'mapping': mapping,
        'savedAt': data.get('savedAt', datetime.now().timestamp() * 1000)
    }
    fpath = _template_path(name)
    with open(fpath, 'w', encoding='utf-8') as f:
        json.dump(template_data, f, ensure_ascii=False, indent=2)
    return jsonify({'message': '模板已保存', 'name': name})


@app.route('/api/bureau-templates/<path:name>', methods=['GET'])
def get_bureau_template(name):
    fpath = _template_path(name)
    if not os.path.exists(fpath):
        return jsonify({'error': '模板不存在'}), 404
    with open(fpath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return app.response_class(
        response=json.dumps(data, ensure_ascii=False),
        status=200,
        mimetype='application/json'
    )


@app.route('/api/bureau-templates/<path:name>', methods=['DELETE'])
def delete_bureau_template(name):
    fpath = _template_path(name)
    if not os.path.exists(fpath):
        return jsonify({'error': '模板不存在'}), 404
    os.remove(fpath)
    return jsonify({'message': '模板已删除'})


# ============ 配置管理 API ============

def _config_path(name):
    """安全获取配置文件路径，防止路径穿越"""
    safe_name = re.sub(r'[^\w\u4e00-\u9fff\-\.]', '_', name)
    return os.path.join(CONFIGS_DIR, f"{safe_name}.json")


@app.route('/api/configs', methods=['GET'])
def list_configs():
    """列出所有已保存配置"""
    configs = []
    for fname in os.listdir(CONFIGS_DIR):
        if not fname.endswith('.json'):
            continue
        fpath = os.path.join(CONFIGS_DIR, fname)
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                data = json.load(f)
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
        except:
            pass
    configs.sort(key=lambda c: c.get('savedAt', 0), reverse=True)
    return app.response_class(
        response=json.dumps(configs, ensure_ascii=False),
        status=200,
        mimetype='application/json'
    )


@app.route('/api/configs', methods=['POST'])
def save_config():
    """保存配置"""
    data = request.json or {}
    name = data.get('name', '').strip()
    cfg = data.get('cfg')
    sig = data.get('sig', '')
    if not name:
        return jsonify({'error': '配置名称不能为空'}), 400
    if not cfg:
        return jsonify({'error': '配置数据不能为空'}), 400
    config_data = {
        'name': name,
        'sig': sig,
        'cfg': cfg,
        'savedAt': data.get('savedAt', datetime.now().timestamp() * 1000)
    }
    fpath = _config_path(name)
    # 限制最多20个配置
    existing = [f for f in os.listdir(CONFIGS_DIR) if f.endswith('.json')]
    if len(existing) >= 20 and not os.path.exists(fpath):
        # 删除最旧的
        all_configs = []
        for ef in existing:
            ep = os.path.join(CONFIGS_DIR, ef)
            try:
                with open(ep, 'r', encoding='utf-8') as f:
                    d = json.load(f)
                all_configs.append((ef, d.get('savedAt', 0)))
            except:
                all_configs.append((ef, 0))
        all_configs.sort(key=lambda x: x[1])
        os.remove(os.path.join(CONFIGS_DIR, all_configs[0][0]))
    with open(fpath, 'w', encoding='utf-8') as f:
        json.dump(config_data, f, ensure_ascii=False)
    return jsonify({'message': '配置已保存', 'name': name})


@app.route('/api/configs/<path:name>', methods=['GET'])
def get_config(name):
    """获取指定配置"""
    fpath = _config_path(name)
    if not os.path.exists(fpath):
        return jsonify({'error': '配置不存在'}), 404
    with open(fpath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return app.response_class(
        response=json.dumps(data, ensure_ascii=False),
        status=200,
        mimetype='application/json'
    )


@app.route('/api/configs/<path:name>', methods=['DELETE'])
def delete_config(name):
    """删除指定配置"""
    fpath = _config_path(name)
    if not os.path.exists(fpath):
        return jsonify({'error': '配置不存在'}), 404
    os.remove(fpath)
    return jsonify({'message': '配置已删除'})


@app.route('/api/split-filtered', methods=['POST'])
def split_filtered():
    """对前端一级过滤后的数据进行分局拆分

    接收: {
      fileName: str,               # 原始文件名
      fileDataBase64: str,         # 原始Excel文件的base64编码
      filteredRowIndices: [int],   # 一级过滤后的行索引(0-based, 不含表头)
      mapping: dict                # 分局映射(可选, 默认用保存的)
    }
    """
    data = request.json or {}
    file_data_b64 = data.get('fileDataBase64', '')
    filtered_indices = data.get('filteredRowIndices', [])
    mapping = data.get('mapping') or load_mapping()
    split_column = data.get('splitColumn', '')

    if not file_data_b64:
        return jsonify({'error': '缺少文件数据'}), 400

    # 解码 base64 -> 临时文件
    import base64
    try:
        raw_bytes = base64.b64decode(file_data_b64)
    except:
        return jsonify({'error': '文件数据解码失败'}), 400

    tmp_in = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_in.write(raw_bytes)
    tmp_in.close()

    # 清理旧输出
    for f in os.listdir(OUTPUT_DIR):
        fp = os.path.join(OUTPUT_DIR, f)
        if os.path.isfile(fp):
            os.remove(fp)
        elif os.path.isdir(fp):
            shutil.rmtree(fp)

    current_date = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_folder = os.path.join(OUTPUT_DIR, f"分局拆分结果_{current_date}")
    os.makedirs(output_folder, exist_ok=True)

    try:
        source_wb = load_workbook(tmp_in.name)
        source_sheet = source_wb.active
    except Exception as e:
        os.unlink(tmp_in.name)
        return jsonify({'error': f'读取文件出错: {str(e)}'}), 500

    try:
        df = pd.read_excel(tmp_in.name, sheet_name=source_sheet.title, dtype=str)
    except Exception as e:
        source_wb.close()
        os.unlink(tmp_in.name)
        return jsonify({'error': f'读取数据出错: {str(e)}'}), 500

    # 只在过滤后的行中进行匹配
    filtered_set = set(filtered_indices) if filtered_indices else set(range(len(df)))

    if not split_column:
        return jsonify({'error': '未指定拆分列'}), 400
    if split_column not in df.columns:
        return jsonify({'error': f'拆分列 "{split_column}" 不存在于数据中'}), 400

    bureau_rows = {bureau: [] for bureau in mapping.keys()}
    unmatched_rows = []
    header_row = 1
    matched_count = 0
    unmatched_count = 0
    unmatched_managers = set()

    for index in filtered_set:
        if index < 0 or index >= len(df):
            continue
        excel_row = index + 2  # 转为Excel行号(1-based, +1表头)

        manager_name_raw = df.iloc[index][split_column]
        manager_name_clean = clean_name(manager_name_raw)
        matched = False
        for bureau, managers in mapping.items():
            if manager_name_clean in managers:
                bureau_rows[bureau].append(excel_row)
                matched_count += 1
                matched = True
                break

        if not matched:
            unmatched_rows.append(excel_row)
            unmatched_count += 1
            if manager_name_clean:
                unmatched_managers.add(manager_name_clean)

    # 为每个分局生成文件
    generated_files = []
    for bureau_name, row_indices in bureau_rows.items():
        if row_indices:
            target_wb = Workbook()
            target_sheet = target_wb.active
            all_rows = [header_row] + row_indices
            copy_sheet_with_format(source_sheet, target_sheet, all_rows)
            safe_name = re.sub(r'[\/\\:*?"<>|]', '_', bureau_name)
            output_file = os.path.join(output_folder, f"{safe_name}_{current_date}.xlsx")
            target_wb.save(output_file)
            generated_files.append({
                'bureau': bureau_name,
                'rows': len(row_indices),
                'filename': f"{safe_name}_{current_date}.xlsx"
            })

    # 汇总文件
    summary_file = os.path.join(output_folder, f"行业商机数据汇总_{current_date}.xlsx")
    summary_wb = Workbook()
    if 'Sheet' in summary_wb.sheetnames:
        del summary_wb['Sheet']
    for bureau_name, row_indices in bureau_rows.items():
        sheet_name = bureau_name[:31]
        target_sheet = summary_wb.create_sheet(title=sheet_name)
        if row_indices:
            all_rows = [header_row] + row_indices
            copy_sheet_with_format(source_sheet, target_sheet, all_rows)
    summary_wb.save(summary_file)
    generated_files.append({
        'bureau': '- 汇总文件 -',
        'rows': matched_count,
        'filename': f"行业商机数据汇总_{current_date}.xlsx"
    })

    # 行业/商业分类汇总
    INDUSTRY_BUREAUS = [
        "政法应急政企分局", "国有平台政企分局", "金融证券政企分局", "工业能源政企分局",
        "政务政企分局", "高新天府软件园智改数转服务局", "软件科研政企分局",
        "高新孵化园智改数转服务局", "新经济政企分局", "健康医疗政企分局",
        "高新天府生命科技园智改数转服务局"
    ]
    COMMERCIAL_BUREAUS = [
        "校园分局", "新川商客分局", "金融城商客分局", "肖芳商客分局",
        "东苑商客分局", "天府国际商客分局", "大源商客分局", "新会展商客分局",
        "连锁商客分局", "环球商客分局", "天府新谷商客分局", "西信商客分局", "府城商客分局"
    ]

    def make_category_summary(category_name, category_bureaus):
        """生成行业/商业汇总文件，每个分局一个sheet"""
        cat_wb = Workbook()
        if 'Sheet' in cat_wb.sheetnames:
            del cat_wb['Sheet']
        cat_rows = 0
        for bureau_name in category_bureaus:
            row_indices = bureau_rows.get(bureau_name, [])
            if row_indices:
                sheet_name = bureau_name[:31]
                target_sheet = cat_wb.create_sheet(title=sheet_name)
                all_rows = [header_row] + row_indices
                copy_sheet_with_format(source_sheet, target_sheet, all_rows)
                cat_rows += len(row_indices)
        if cat_rows:
            safe_cat = re.sub(r'[\/\\:*?"<>|]', '_', category_name)
            cat_file = os.path.join(output_folder, f"{safe_cat}_{current_date}.xlsx")
            cat_wb.save(cat_file)
            generated_files.append({
                'bureau': f'- {category_name} -',
                'rows': cat_rows,
                'filename': f"{safe_cat}_{current_date}.xlsx"
            })

    make_category_summary("行业数据汇总", INDUSTRY_BUREAUS)
    make_category_summary("商业数据汇总", COMMERCIAL_BUREAUS)

    # 未匹配名单
    if unmatched_rows:
        unmatched_wb = Workbook()
        unmatched_sheet = unmatched_wb.active
        all_rows = [header_row] + unmatched_rows
        copy_sheet_with_format(source_sheet, unmatched_sheet, all_rows)
        unmatched_file_path = os.path.join(output_folder, f"未匹配名单_{current_date}.xlsx")
        unmatched_wb.save(unmatched_file_path)
        generated_files.append({
            'bureau': '- 未匹配名单 -',
            'rows': unmatched_count,
            'filename': f"未匹配名单_{current_date}.xlsx"
        })

    # ZIP打包
    zip_name = f"分局拆分结果_{current_date}.zip"
    zip_path = os.path.join(OUTPUT_DIR, zip_name)
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for f in os.listdir(output_folder):
            zf.write(os.path.join(output_folder, f), f)

    source_wb.close()
    os.unlink(tmp_in.name)

    return jsonify({
        'message': '拆分完成',
        'matched': matched_count,
        'unmatched': unmatched_count,
        'totalFiltered': len(filtered_set),
        'files': generated_files,
        'unmatched_managers': sorted(unmatched_managers),
        'zip': zip_name,
        'output_folder': f"分局拆分结果_{current_date}"
    })


@app.route('/api/download/<path:filename>')
def download_file(filename):
    return send_file(os.path.join(OUTPUT_DIR, filename), as_attachment=True)


@app.route('/api/download-folder/<path:folder>')
def download_folder(folder):
    folder_path = os.path.join(OUTPUT_DIR, folder)
    if not os.path.isdir(folder_path):
        return jsonify({'error': '文件夹不存在'}), 404
    zip_name = f"{folder}.zip"
    zip_path = os.path.join(OUTPUT_DIR, zip_name)
    if not os.path.exists(zip_path):
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for f in os.listdir(folder_path):
                zf.write(os.path.join(folder_path, f), f)
    return send_file(zip_path, as_attachment=True)


# ============ 在线表格管理 API ============

KDOCS_CATS_FILE = os.path.join(DATA_DIR, 'kdocs_categories.json')

def _load_kdocs_sheets():
    """加载在线表格配置列表"""
    if os.path.exists(SHEETS_FILE):
        try:
            with open(SHEETS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return []

def _save_kdocs_sheets(sheets):
    """保存在线表格配置列表"""
    with open(SHEETS_FILE, 'w', encoding='utf-8') as f:
        json.dump(sheets, f, ensure_ascii=False, indent=2)

def _load_kdocs_cats():
    """加载分类列表"""
    if os.path.exists(KDOCS_CATS_FILE):
        try:
            with open(KDOCS_CATS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return [{'id': 'default', 'name': '默认', 'color': '#6366f1'}]

def _save_kdocs_cats(cats):
    """保存分类列表"""
    with open(KDOCS_CATS_FILE, 'w', encoding='utf-8') as f:
        json.dump(cats, f, ensure_ascii=False, indent=2)


@app.route('/api/kdocs-browse', methods=['POST'])
def browse_local_fs():
    """浏览本地文件系统，返回指定路径下的子目录和xlsx文件"""
    data = request.json or {}
    path = data.get('path', '').strip()

    # 特殊路径 "__drives__" 表示列出所有盘符
    if path == '__drives__':
        drives = []
        for letter in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ':
            d = f'{letter}:\\'
            if os.path.exists(d):
                drives.append({'name': f'{letter}:', 'path': d, 'is_drive': True})
        return jsonify({
            'current': '__drives__',
            'current_display': '此电脑',
            'parent': '',
            'dirs': drives,
            'files': [],
            'is_drives': True
        })

    if not path:
        path = os.path.expanduser('~')
    if not os.path.exists(path):
        return jsonify({'error': f'路径不存在: {path}'}), 400

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
        return jsonify({'error': '无权限访问该路径'}), 400

    # 判断上级目录：盘符根目录的上级回到盘符列表
    parent = ''
    if path and len(path) <= 3 and path.endswith(':\\'):
        # 盘符根目录，上级回到盘符列表
        parent = '__drives__'
    elif path:
        parent = os.path.dirname(path)
        if parent == path:
            parent = '__drives__'

    return jsonify({
        'current': path,
        'parent': parent,
        'dirs': sorted(dirs, key=lambda x: x['name'].lower()),
        'files': sorted(files, key=lambda x: x['name'].lower()),
        'is_dir': os.path.isdir(path)
    })


@app.route('/api/kdocs-categories', methods=['GET'])
def list_kdocs_cats():
    """列出所有分类"""
    cats = _load_kdocs_cats()
    sheets = _load_kdocs_sheets()
    # 附加每个分类下有多少个表格
    for c in cats:
        c['count'] = sum(1 for s in sheets if s.get('category') == c['id'])
    return jsonify(cats)


@app.route('/api/kdocs-categories', methods=['POST'])
def add_kdocs_cat():
    """添加分类"""
    data = request.json or {}
    name = data.get('name', '').strip()
    color = data.get('color', '#6366f1').strip()
    if not name:
        return jsonify({'error': '分类名不能为空'}), 400
    cats = _load_kdocs_cats()
    if any(c['name'] == name for c in cats):
        return jsonify({'error': '分类名已存在'}), 400
    cat = {'id': str(uuid.uuid4())[:8], 'name': name, 'color': color}
    cats.append(cat)
    _save_kdocs_cats(cats)
    return jsonify({'message': '添加成功', 'category': cat})


@app.route('/api/kdocs-categories/<cid>', methods=['DELETE'])
def delete_kdocs_cat(cid):
    """删除分类"""
    cats = _load_kdocs_cats()
    # 不允许删除默认分类
    cats = [c for c in cats if not (c['id'] == cid and c['id'] == 'default')]
    _save_kdocs_cats(cats)
    # 将属于该分类的表格移至默认分类
    sheets = _load_kdocs_sheets()
    for s in sheets:
        if s.get('category') == cid:
            s['category'] = 'default'
    _save_kdocs_sheets(sheets)
    return jsonify({'message': '已删除'})


@app.route('/api/kdocs-sheets', methods=['GET'])
def list_kdocs_sheets():
    """列出所有在线表格配置"""
    sheets = _load_kdocs_sheets()
    cat_id = request.args.get('category', '')
    if cat_id:
        sheets = [s for s in sheets if s.get('category', 'default') == cat_id]
    return jsonify(sheets)


@app.route('/api/kdocs-sheets', methods=['POST'])
def add_kdocs_sheet():
    """添加在线表格配置"""
    data = request.json or {}
    name = data.get('name', '').strip()
    url = data.get('url', '').strip()
    api_token = data.get('api_token', '').strip()
    webhook_url = data.get('webhook_url', '').strip()
    excel_path = data.get('excel_path', '').strip()
    batch_size = data.get('batch_size', 3)
    category = data.get('category', 'default')

    if not name or not url:
        return jsonify({'error': '名称和URL不能为空'}), 400

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
    return jsonify({'message': '添加成功', 'sheet': sheet})


@app.route('/api/kdocs-sheets/<sid>', methods=['PUT'])
def update_kdocs_sheet(sid):
    """更新在线表格配置"""
    data = request.json or {}
    sheets = _load_kdocs_sheets()
    for s in sheets:
        if s['id'] == sid:
            for k in ['name', 'url', 'api_token', 'webhook_url', 'excel_path', 'batch_size', 'category']:
                if k in data:
                    s[k] = data[k]
            s['updated_at'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            _save_kdocs_sheets(sheets)
            return jsonify({'message': '更新成功', 'sheet': s})
    return jsonify({'error': '未找到该配置'}), 404


@app.route('/api/kdocs-sheets/<sid>', methods=['DELETE'])
def delete_kdocs_sheet(sid):
    """删除在线表格配置"""
    sheets = _load_kdocs_sheets()
    sheets = [s for s in sheets if s['id'] != sid]
    _save_kdocs_sheets(sheets)
    return jsonify({'message': '删除成功'})


@app.route('/api/kdocs-push', methods=['POST'])
def push_to_kdocs():
    """将本地Excel数据推送到金山文档在线表格"""
    data = request.json or {}
    sid = data.get('id', '')
    excel_path = data.get('excel_path', '')

    sheets = _load_kdocs_sheets()
    sheet_cfg = None
    for s in sheets:
        if s['id'] == sid:
            sheet_cfg = s
            break

    if not sheet_cfg:
        return jsonify({'error': '未找到该在线表格配置'}), 404

    api_token = sheet_cfg.get('api_token', '')
    webhook_url = sheet_cfg.get('webhook_url', '')
    batch_size = sheet_cfg.get('batch_size', 3)

    if not api_token or not webhook_url:
        return jsonify({'error': 'API_TOKEN 或 WEBHOOK_URL 未配置'}), 400

    # 如果传了excel_path则优先使用，否则用配置中的
    if not excel_path:
        excel_path = sheet_cfg.get('excel_path', '')
    if not excel_path:
        return jsonify({'error': '未指定本地Excel文件路径'}), 400

    if not os.path.exists(excel_path):
        return jsonify({'error': f'文件不存在: {excel_path}'}), 400

    # 解析webhook URL
    parsed = urlparse(webhook_url)
    host = parsed.hostname or "www.kdocs.cn"
    path = parsed.path

    # 测试连接
    try:
        conn = http.client.HTTPSConnection(host, context=ssl._create_unverified_context(), timeout=15)
        payload = json.dumps({"Context": {"argv": {"action": "info"}}}, ensure_ascii=False)
        headers = {"Content-Type": "application/json", "AirScript-Token": api_token}
        conn.request("POST", path, payload.encode("utf-8"), headers)
        res = conn.getresponse()
        result = json.loads(res.read().decode("utf-8"))
        conn.close()
        if result.get("error"):
            return jsonify({'error': f'Webhook连接异常: {result["error"]}'}), 500
    except Exception as e:
        return jsonify({'error': f'Webhook连接失败: {str(e)}'}), 500

    # 读取Excel
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
        return jsonify({'error': f'读取Excel失败: {str(e)}'}), 500

    # 分批写入
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
            headers = {"Content-Type": "application/json", "AirScript-Token": api_token}
            conn.request("POST", path, pl.encode("utf-8"), headers)
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

    return jsonify({
        'message': f'推送完成：成功 {success_count} 行，失败 {fail_count} 行',
        'success_count': success_count,
        'fail_count': fail_count,
        'total_rows': len(rows),
        'details': details
    })


@app.route('/api/kdocs-push-batch', methods=['POST'])
def push_to_kdocs_batch():
    """一键推送：只推送与在线表格名称匹配的本地Excel文件"""
    data = request.json or {}
    folder_path = data.get('folder_path', '').strip()

    if not folder_path or not os.path.isdir(folder_path):
        return jsonify({'error': '文件夹路径无效'}), 400

    sheets = _load_kdocs_sheets()
    if not sheets:
        return jsonify({'error': '暂无在线表格配置'}), 400

    # 扫描文件夹下所有xlsx文件
    local_files = {}
    for f in os.listdir(folder_path):
        if f.endswith(('.xlsx', '.xls')) and not f.startswith('~$'):
            local_files[f.lower()] = os.path.join(folder_path, f)

    results = []
    for s in sheets:
        # 模糊匹配：去掉扩展名后进行子串匹配（双向包含）
        online_name = s['name'].replace('.xlsx', '').replace('.xls', '').lower()
        matched_file = None
        matched_name = None
        for lf_name, lf_path in local_files.items():
            lf_base = lf_name.replace('.xlsx', '').replace('.xls', '')
            # 双向子串匹配：AAAB匹配AAABB
            if online_name and lf_base and (online_name in lf_base or lf_base in online_name):
                matched_file = lf_path
                matched_name = lf_name
                break

        if not matched_file:
            continue  # 未匹配的跳过，不推送也不报错

        if not s.get('api_token') or not s.get('webhook_url'):
            results.append({'id': s['id'], 'name': s['name'], 'file': matched_name, 'status': 'skip', 'message': 'API_TOKEN或WEBHOOK_URL未配置'})
            continue

        # 调用推送逻辑
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

    return jsonify({'results': results, 'total_matched': len(results)})


def _do_push(sheet_cfg, excel_path):
    """执行单个推送（内部函数）"""
    api_token = sheet_cfg.get('api_token', '')
    webhook_url = sheet_cfg.get('webhook_url', '')
    batch_size = sheet_cfg.get('batch_size', 3)

    parsed = urlparse(webhook_url)
    host = parsed.hostname or "www.kdocs.cn"
    path = parsed.path

    # 读取Excel
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


@app.route('/api/kdocs-airscript-code', methods=['GET'])
def get_airscript_code():
    """获取airscript_code.js脚本内容"""
    code_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'airscript_code.js')
    if not os.path.exists(code_path):
        return jsonify({'error': 'airscript_code.js 文件不存在'}), 404
    try:
        with open(code_path, 'r', encoding='utf-8') as f:
            code = f.read()
        return jsonify({'code': code})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/kdocs-airscript-code', methods=['PUT'])
def save_airscript_code():
    """保存airscript_code.js脚本内容"""
    data = request.json or {}
    code = data.get('code', '')
    code_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'airscript_code.js')
    try:
        with open(code_path, 'w', encoding='utf-8') as f:
            f.write(code)
        return jsonify({'message': '保存成功'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/kdocs-folder-scan', methods=['POST'])
def scan_folder():
    """扫描文件夹，列出所有Excel文件"""
    data = request.json or {}
    folder_path = data.get('folder_path', '').strip()
    if not folder_path or not os.path.isdir(folder_path):
        return jsonify({'error': '文件夹路径无效'}), 400

    files = []
    for f in os.listdir(folder_path):
        if f.endswith(('.xlsx', '.xls')) and not f.startswith('~$'):
            fpath = os.path.join(folder_path, f)
            fsize = os.path.getsize(fpath)
            files.append({'name': f, 'path': fpath, 'size': fsize})

    return jsonify({'files': files, 'count': len(files)})


# ============ 数据标准化模板 API ============

def _nz_template_path(name):
    """安全获取数据标准化模板路径"""
    safe_name = re.sub(r'[^\w\u4e00-\u9fff\-\.]', '_', name)
    return os.path.join(NZ_TEMPLATES_DIR, f"{safe_name}.json")


def _nz_resolve_formula_str(formula_str, stats_data):
    """解析并计算单个公式字符串的值
    格式: {{fileIdx:L1:entryName:col/metric}} 或 {{fileIdx::entryName/metric}}
    entryName直接匹配entry.name（如"重点项"、"子项·重点项·核心项"等）
    兼容旧格式: {{fileIdx:L1:L2:L3/指标}} 或 {{fileIdx:总合计/指标}}
    """
    m = re.match(r'^\{\{(.+?)\}\}$', formula_str.strip())
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

    # 解析各层级
    l1, col = '', ''
    entry_name = ''

    # 总合计
    if len(parts) == 2 and parts[1] == '总合计':
        return _nz_resolve_metric(total, '', metric, sum_col, None, None, fd)

    if len(parts) == 2:
        # {{1:entryName/指标}}
        entry_name = parts[1]
    elif len(parts) == 3:
        # {{1:L1:entryName/指标}} 或 {{1::entryName/指标}}
        l1 = parts[1]
        entry_name = parts[2]
    elif len(parts) == 4:
        # {{1:L1:entryName:col/指标}}
        l1 = parts[1]
        entry_name = parts[2]
        col = parts[3]
    elif len(parts) >= 5:
        # 旧多级格式兼容: {{fileIdx:L1:L2:L3:...:col/metric}}
        # 合并L2..L(N-1)为entry_name
        l1 = parts[1]
        remaining = parts[2:]
        # 最后一段如果包含.则为列名
        if remaining and '.' in remaining[-1]:
            col = remaining[-1]
            entry_name = ' · '.join(remaining[:-1])
        else:
            entry_name = ' · '.join(remaining)

    # 解析附加列.值
    ac_col, ac_val = None, None
    if col and '.' in col:
        dp = col.split('.', 1)
        ac_col, ac_val = dp[0], dp[1]

    # L1合计
    if l1 and entry_name == '合计':
        l1_total = None
        for e in entries:
            if e.get('isL1Total') and e.get('l1Name') == l1:
                l1_total = e
                break
        if not l1_total:
            return {'ok': False, 'value': '未匹配'}
        return _nz_resolve_metric(l1_total, col, metric, sum_col, ac_col, ac_val, fd)

    # 总合计（entry_name='总合计'）
    if entry_name == '总合计' or (not l1 and entry_name == '总合计'):
        return _nz_resolve_metric(total, col, metric, sum_col, ac_col, ac_val, fd)

    # 按 entry.name 直接匹配
    entry = None
    if l1:
        for e in entries:
            if e.get('isGroup') and e.get('l1Name') == l1 and e.get('name', '') == entry_name:
                entry = e
                break
        # 尝试L1合计
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
    """解析指标值"""
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
                return {'ok': True, 'value': round(float(s), 2)}
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
                return {'ok': True, 'value': round(float(s) / c, 2)}
            except:
                pass
        return {'ok': True, 'value': 0}
    return {'ok': False, 'value': '未知指标'}


@app.route('/api/nz-templates', methods=['GET'])
def list_nz_templates():
    """列出所有数据标准化模板"""
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
    return jsonify({'templates': templates})


@app.route('/api/nz-templates', methods=['POST'])
def save_nz_template():
    """保存数据标准化模板"""
    data = request.json or {}
    name = (data.get('name') or '').strip()
    file_data = data.get('fileData', '')
    if not name:
        return jsonify({'error': '模板名称不能为空'}), 400
    if not file_data:
        return jsonify({'error': '模板数据不能为空'}), 400

    # 验证base64是有效的Excel
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
        return jsonify({'error': f'模板文件无效: {str(e)}'}), 400

    template_data = {
        'name': name,
        'fileData': file_data,
        'savedAt': datetime.now().timestamp() * 1000,
        'sheetCount': sheet_count
    }
    fpath = _nz_template_path(name)
    with open(fpath, 'w', encoding='utf-8') as f:
        json.dump(template_data, f, ensure_ascii=False)
    return jsonify({'message': '模板已保存', 'name': name})


@app.route('/api/nz-templates/<path:name>', methods=['GET'])
def get_nz_template(name):
    """获取指定数据标准化模板"""
    fpath = _nz_template_path(name)
    if not os.path.exists(fpath):
        return jsonify({'error': '模板不存在'}), 404
    with open(fpath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return app.response_class(
        response=json.dumps(data, ensure_ascii=False),
        status=200,
        mimetype='application/json'
    )


@app.route('/api/nz-templates/<path:name>', methods=['DELETE'])
def delete_nz_template(name):
    """删除指定数据标准化模板"""
    fpath = _nz_template_path(name)
    if not os.path.exists(fpath):
        return jsonify({'error': '模板不存在'}), 404
    os.remove(fpath)
    return jsonify({'message': '模板已删除'})


@app.route('/api/nz-fill', methods=['POST'])
def nz_fill_template():
    """填充数据标准化模板：解析公式并替换值，返回填充后的Excel文件
    使用原始模板文件保留格式，仅替换公式单元格的值。
    """
    data = request.json or {}
    template_b64 = data.get('templateData', '')
    stats_data = data.get('statsData', {})
    cell_edits = data.get('cellEdits', [])

    if not template_b64:
        return jsonify({'error': '缺少模板数据'}), 400

    # 解码base64模板
    try:
        raw = base64.b64decode(template_b64)
    except:
        return jsonify({'error': '模板数据解码失败'}), 400

    # 写入临时文件并用openpyxl打开（保留原格式）
    tmp_in = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_in.write(raw)
    tmp_in.close()
    tmp_out = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_out.close()

    try:
        wb = load_workbook(tmp_in.name)
    except Exception as e:
        os.unlink(tmp_in.name)
        os.unlink(tmp_out.name)
        return jsonify({'error': f'读取模板失败: {str(e)}'}), 500

    # 1. 先应用前端单元格编辑（保留格式，只改值）
    for edit in cell_edits:
        si = edit.get('sheet', 0)
        r = edit.get('row', 0)
        c = edit.get('col', 0)
        val = edit.get('value', '')
        if si < 0 or si >= len(wb.sheetnames):
            continue
        ws = wb.worksheets[si]
        cell = ws.cell(row=r + 1, column=c + 1)  # openpyxl是1-based
        # 保留原有格式，只替换值
        try:
            # 尝试转为数字
            num_val = float(val) if val and '.' in val else (int(val) if val and val.lstrip('-').isdigit() else None)
        except (ValueError, TypeError, AttributeError):
            num_val = None
        if num_val is not None:
            cell.value = num_val
        else:
            cell.value = val

    # 2. 扫描公式并替换值
    formula_pattern = re.compile(r'^\{\{(.+?)\}\}$')
    fill_count = 0
    fail_count = 0

    for ws in wb.worksheets:
        # 遍历所有单元格
        for row in ws.iter_rows():
            for cell in row:
                if cell.value is None:
                    continue
                cell_str = str(cell.value).strip()
                if not formula_pattern.match(cell_str):
                    continue
                # 解析公式并取值
                result = _nz_resolve_formula_str(cell_str, stats_data)
                if result['ok']:
                    val = result['value']
                    # 根据类型设置单元格值（保留格式）
                    if isinstance(val, (int, float)):
                        cell.value = val
                    else:
                        cell.value = val
                    fill_count += 1
                else:
                    cell.value = str(result['value'])
                    fail_count += 1

    try:
        wb.save(tmp_out.name)
        wb.close()
    except Exception as e:
        wb.close()
        os.unlink(tmp_in.name)
        os.unlink(tmp_out.name)
        return jsonify({'error': f'保存失败: {str(e)}'}), 500

    # 发送文件
    result = send_file(
        tmp_out.name,
        as_attachment=True,
        download_name='填充结果.xlsx',
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )

    # 清理（使用after_request延迟清理）
    @result.call_on_close
    def cleanup():
        try:
            os.unlink(tmp_in.name)
            os.unlink(tmp_out.name)
        except:
            pass

    return result


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5557, debug=True)
