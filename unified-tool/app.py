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
from datetime import datetime
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
    return jsonify(load_mapping())


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
            configs.append({
                'name': data.get('name', fname[:-5]),
                'sig': data.get('sig', ''),
                'savedAt': data.get('savedAt', 0),
                'fileNames': [fd.get('name', '') for fd in data.get('cfg', {}).get('files', [])]
            })
        except:
            pass
    configs.sort(key=lambda c: c.get('savedAt', 0), reverse=True)
    return jsonify(configs)


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
    return jsonify(data)


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


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5557, debug=True)
