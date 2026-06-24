# -*- coding: utf-8 -*-
"""拆分服务层 - 商机数据按分局拆分的核心业务逻辑

使用 XML 直操作方案实现 100% 格式保真：绕过 openpyxl 的样式重写，
直接操作 xlsx 内部 XML，保留原始 styles.xml 不变。
"""
import os
import re
import shutil
import tempfile
import zipfile
from datetime import datetime
import pandas as pd
from openpyxl import load_workbook
from config import (OUTPUT_DIR, DEFAULT_MAPPING, INDUSTRY_BUREAUS,
                    COMMERCIAL_BUREAUS, DEFAULT_SPLIT_GROUPS)
from services.excel_service import clean_name
from models.file_model import load_mapping


def split_filtered_data(file_bytes, filtered_indices, mapping, split_column, split_groups=None, skip_rows=0):
    """按分局拆分过滤后的数据。

    Args:
        file_bytes: 源 Excel 文件字节（原始文件，保留完整格式）
        filtered_indices: 已过滤的行索引列表（None 表示全部，基于跳过 skip_rows 后的数据）
        mapping: {分局名: [客户经理列表]}
        split_column: 拆分依据列名
        split_groups: {组名: [分局列表]}，None 时用默认拆分组
        skip_rows: 跳过的标题行数（原始文件顶部非数据行）

    Returns:
        dict: 拆分结果，含 matched/unmatched/files/zip 等
    """
    tmp_in = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_in.write(file_bytes)
    tmp_in.close()

    # 清空输出目录
    for f in os.listdir(OUTPUT_DIR):
        fp = os.path.join(OUTPUT_DIR, f)
        if os.path.isfile(fp):
            os.remove(fp)
        elif os.path.isdir(fp):
            shutil.rmtree(fp)

    current_date = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_folder = os.path.join(OUTPUT_DIR, f"分局拆分结果_{current_date}")
    os.makedirs(output_folder, exist_ok=True)

    # 用 openpyxl 读取基本结构信息（只读，不保存）
    try:
        wb = load_workbook(tmp_in.name, read_only=True)
        ws = wb.active
        source_sheet_title = ws.title
        max_col = ws.max_column
        wb.close()
    except Exception as e:
        os.unlink(tmp_in.name)
        return {'ok': False, 'error': f'读取文件出错: {str(e)}'}

    # 用 pandas 读取数据进行匹配（跳过标题行）
    try:
        read_kwargs = {'sheet_name': source_sheet_title, 'dtype': str}
        if skip_rows > 0:
            read_kwargs['skiprows'] = skip_rows
        df = pd.read_excel(tmp_in.name, **read_kwargs)
    except Exception as e:
        os.unlink(tmp_in.name)
        return {'ok': False, 'error': f'读取数据出错: {str(e)}'}

    filtered_set = set(filtered_indices) if filtered_indices else set(range(len(df)))

    if not split_column:
        os.unlink(tmp_in.name)
        return {'ok': False, 'error': '未指定拆分列'}
    if split_column not in df.columns:
        os.unlink(tmp_in.name)
        return {'ok': False, 'error': f'拆分列 "{split_column}" 不存在于数据中'}

    # 按分局匹配行号
    bureau_rows = {bureau: [] for bureau in mapping.keys()}
    unmatched_rows = []
    header_row = 1
    matched_count = 0
    unmatched_count = 0
    unmatched_managers = set()

    for index in sorted(filtered_set):
        if index < 0 or index >= len(df):
            continue
        excel_row = index + 2 + skip_rows  # pandas 0-based → Excel 1-based（含表头 + 跳过的标题行）

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

    # 使用 XML 直操作生成拆分文件（格式 100% 保真）
    from services.excel_split import split_xlsx_fidelity

    generated_files = split_xlsx_fidelity(
        source_bytes=file_bytes,
        bureau_row_map=bureau_rows,
        header_xml=None,
        max_col=max_col,
        output_folder=output_folder,
        current_date=current_date,
        split_groups=split_groups if split_groups else DEFAULT_SPLIT_GROUPS,
        unmatched_rows=unmatched_rows,
        matched_count=matched_count,
        unmatched_count=unmatched_count,
        skip_rows=skip_rows
    )

    os.unlink(tmp_in.name)

    # 打包 ZIP
    zip_name = f"分局拆分结果_{current_date}.zip"
    zip_path = os.path.join(OUTPUT_DIR, zip_name)
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for f in os.listdir(output_folder):
            zf.write(os.path.join(output_folder, f), f)

    return {
        'ok': True,
        'message': '拆分完成',
        'matched': matched_count,
        'unmatched': unmatched_count,
        'totalFiltered': len(filtered_set),
        'files': generated_files,
        'unmatched_managers': sorted(unmatched_managers),
        'zip': zip_name,
        'output_folder': f"分局拆分结果_{current_date}"
    }
