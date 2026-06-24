# -*- coding: utf-8 -*-
"""Excel 格式保真拆分工具。

核心策略：绕过 openpyxl 的样式重写，直接操作 xlsx 内部的 XML：
- 读取源 xlsx 的 sheet XML，按行过滤
- 重新编号行号，生成新的 sheet XML
- 保留原始 styles.xml / theme / sharedStrings.xml 等全部不动
- 输出文件与源文件格式 100% 一致

样式索引（s 属性）和共享字符串索引（t="s" + v 值）直接引用原始文件，
无需任何转换。
"""
import os
import re
import io
import zipfile
import xml.etree.ElementTree as ET
from openpyxl.utils import get_column_letter


def clean_name(name):
    if not isinstance(name, str):
        return ""
    name = re.sub(r'\([^)]*\)', '', name)
    name = re.sub(r'\（[^）]*\）', '', name)
    parts = re.split(r'[,，、;；\s]+', name)
    parts = [p.strip() for p in parts if p.strip()]
    return parts[0] if parts else name.strip()


def split_xlsx_fidelity(source_bytes, bureau_row_map, header_xml, max_col,
                        output_folder, current_date, split_groups,
                        unmatched_rows, matched_count, unmatched_count):
    """直接操作 XML 实现格式 100% 保真的拆分。

    Args:
        source_bytes: 源 xlsx 文件字节
        bureau_row_map: {分局名: [源Excel行号列表]}
        header_xml: 表头行的原始 XML 字符串（<row r="1">...</row>）
        max_col: 最大列数
        output_folder: 输出目录
        current_date: 日期时间字符串
        split_groups: 拆分组配置
        unmatched_rows: 未匹配行号列表
        matched_count: 匹配总数
        unmatched_count: 未匹配总数

    Returns:
        list: 生成的文件信息
    """
    # 将源文件读入内存 zip
    source_zip = zipfile.ZipFile(io.BytesIO(source_bytes), 'r')
    source_files = {name: source_zip.read(name) for name in source_zip.namelist()}
    source_zip.close()

    # 提取 sheet XML 的非数据部分（前缀和后缀）
    sheet_xml_name = _find_sheet_xml_name(source_files)
    sheet_content = source_files[sheet_xml_name].decode('utf-8')

    # 分离 sheet XML: 前缀 + sheetData + 后缀
    sd_start = sheet_content.find('<sheetData>')
    sd_close = sheet_content.find('</sheetData>')
    xml_prefix = sheet_content[:sd_start + len('<sheetData>')]
    xml_suffix = '</sheetData>' + sheet_content[sd_close + len('</sheetData>'):]
    all_rows_xml = sheet_content[sd_start + len('<sheetData>'):sd_close]

    # 解析所有行，建立行号 -> XML 的映射
    row_map = _parse_rows(all_rows_xml)

    generated_files = []

    # ========== 生成各分局文件 ==========
    for bureau_name, row_numbers in bureau_row_map.items():
        if not row_numbers:
            continue
        # 构建新行列表：表头(行1) + 数据行
        new_rows = [1] + row_numbers
        new_sheet_xml = _build_sheet_xml(xml_prefix, xml_suffix, row_map, new_rows)

        safe_name = re.sub(r'[\/\\:*?"<>|]', '_', bureau_name)
        output_file = os.path.join(output_folder, f"{safe_name}_{current_date}.xlsx")
        _write_xlsx(source_files, sheet_xml_name, new_sheet_xml, output_file)
        generated_files.append({
            'bureau': bureau_name,
            'rows': len(row_numbers),
            'filename': f"{safe_name}_{current_date}.xlsx"
        })

    # ========== 生成汇总文件 ==========
    summary_rows_map = {}
    total_summary_rows = 0
    for bureau_name, row_numbers in bureau_row_map.items():
        if row_numbers:
            summary_rows_map[bureau_name] = row_numbers
            total_summary_rows += len(row_numbers)

    summary_file = os.path.join(output_folder, f"汇总数据_{current_date}.xlsx")
    _write_multi_sheet_xlsx(source_files, sheet_xml_name, row_map,
                            summary_rows_map, summary_file, xml_prefix, xml_suffix)
    generated_files.append({
        'bureau': '- 汇总文件 -',
        'rows': matched_count,
        'filename': f"汇总数据_{current_date}.xlsx"
    })

    # ========== 生成分类汇总 ==========
    for group_name, group_bureaus in split_groups.items():
        cat_rows_map = {}
        cat_total = 0
        for bn in group_bureaus:
            rn = bureau_row_map.get(bn, [])
            if rn:
                cat_rows_map[bn] = rn
                cat_total += len(rn)
        if cat_rows_map:
            safe_cat = re.sub(r'[\/\\:*?"<>|]', '_', group_name)
            cat_file = os.path.join(output_folder, f"{safe_cat}_{current_date}.xlsx")
            _write_multi_sheet_xlsx(source_files, sheet_xml_name, row_map,
                                    cat_rows_map, cat_file, xml_prefix, xml_suffix)
            generated_files.append({
                'bureau': f'- {group_name} -',
                'rows': cat_total,
                'filename': f"{safe_cat}_{current_date}.xlsx"
            })

    # ========== 生成未匹配名单 ==========
    if unmatched_rows:
        new_rows = [1] + unmatched_rows
        new_sheet_xml = _build_sheet_xml(xml_prefix, xml_suffix, row_map, new_rows)
        unmatched_file = os.path.join(output_folder, f"未匹配名单_{current_date}.xlsx")
        _write_xlsx(source_files, sheet_xml_name, new_sheet_xml, unmatched_file)
        generated_files.append({
            'bureau': '- 未匹配名单 -',
            'rows': unmatched_count,
            'filename': f"未匹配名单_{current_date}.xlsx"
        })

    return generated_files


def _find_sheet_xml_name(source_files):
    """找到第一个 worksheet 的 XML 文件名。"""
    for name in source_files:
        if name.startswith('xl/worksheets/sheet') and name.endswith('.xml'):
            return name
    return 'xl/worksheets/sheet1.xml'


def _parse_rows(all_rows_xml):
    """解析 sheetData XML，建立 {行号: 行XML字符串} 映射。

    使用正则提取每个 <row>...</row> 块。
    """
    row_map = {}
    # 匹配 <row r="数字">...</row>
    pattern = re.compile(r'<row r="(\d+)"[^>]*>.*?</row>', re.DOTALL)
    for match in pattern.finditer(all_rows_xml):
        row_num = int(match.group(1))
        row_map[row_num] = match.group(0)
    return row_map


def _renumber_row_xml(row_xml, old_num, new_num, max_col):
    """重新编号行的 r 属性和其中所有 cell 的 r 属性。"""
    # 替换行号: <row r="old" -> <row r="new"
    result = row_xml.replace(f'<row r="{old_num}"', f'<row r="{new_num}"', 1)

    # 替换每个 cell 的行号: r="Aold" -> r="Anew", r="Bold" -> r="Bnew"
    for col in range(1, max_col + 1):
        col_letter = get_column_letter(col)
        result = result.replace(f'r="{col_letter}{old_num}"', f'r="{col_letter}{new_num}"')

    return result


def _build_sheet_xml(xml_prefix, xml_suffix, row_map, row_numbers):
    """构建单 sheet 的 XML。

    Args:
        xml_prefix: sheetData 开始标签之前的内容（含 <sheetData>）
        xml_suffix: sheetData 结束标签之后的内容
        row_map: {行号: 行XML}
        row_numbers: 要包含的源行号列表（已含表头行1）

    Returns:
        完整的 sheet XML 字符串
    """
    # 找最大列数
    max_col = 32  # 默认值，后续从行数据中推断

    parts = []
    for new_idx, src_row_num in enumerate(row_numbers, start=1):
        if src_row_num in row_map:
            # 推断最大列数
            row_xml = row_map[src_row_num]
            cols_in_row = re.findall(r'r="([A-Z]+)\d+"', row_xml)
            for c in cols_in_row:
                col_num = 0
                for ch in c:
                    col_num = col_num * 26 + (ord(ch) - ord('A') + 1)
                if col_num > max_col:
                    max_col = col_num
            parts.append(_renumber_row_xml(row_xml, src_row_num, new_idx, max_col))

    rows_xml = ''.join(parts)
    return xml_prefix + rows_xml + xml_suffix


def _write_xlsx(source_files, sheet_xml_name, new_sheet_xml, output_path):
    """写入单 sheet xlsx：复制源文件所有内容，只替换 sheet XML。"""
    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for name, data in source_files.items():
            if name == sheet_xml_name:
                zf.writestr(name, new_sheet_xml.encode('utf-8'))
            else:
                zf.writestr(name, data)


def _write_multi_sheet_xlsx(source_files, sheet_xml_name, row_map,
                            rows_map, output_path, xml_prefix, xml_suffix):
    """写入多 sheet xlsx：每个分局一个 sheet。

    需要修改 workbook.xml 和 Content_Types.xml 来注册多个 sheet。
    """
    # 先找到源文件的命名空间和前缀
    sheet_content = source_files[sheet_xml_name].decode('utf-8')

    # 解析前缀获取 sheetViews, sheetFormatPr, cols 等公共部分
    sd_start = sheet_content.find('<sheetData>')
    common_prefix = sheet_content[:sd_start + len('<sheetData>')]

    # 推断最大列数
    max_col = 32

    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        bureau_names = list(rows_map.keys())
        sheet_idx = 1

        for name, data in source_files.items():
            if name == sheet_xml_name:
                # 写第一个分局到 sheet1
                first_bureau = bureau_names[0]
                first_rows = [1] + rows_map[first_bureau]
                new_xml = _build_sheet_xml(common_prefix, xml_suffix, row_map, first_rows)
                zf.writestr(name, new_xml.encode('utf-8'))
            elif name == 'xl/workbook.xml':
                # 修改 workbook.xml 添加多个 sheet
                wb_xml = data.decode('utf-8')
                new_sheets = []
                for i, bn in enumerate(bureau_names, start=1):
                    safe = re.sub(r'[\/\\:*?"<>|]', '_', bn)[:28]
                    state = 'active' if i == 1 else 'visible'
                    new_sheets.append(f'<sheet name="{safe}" sheetId="{i}" state="visible" r:id="rId{i}"/>')
                # 替换 sheets 部分
                sheets_pattern = re.compile(r'<sheets>.*?</sheets>', re.DOTALL)
                new_sheets_xml = '<sheets>' + ''.join(new_sheets) + '</sheets>'
                wb_xml = sheets_pattern.sub(new_sheets_xml, wb_xml)
                zf.writestr(name, wb_xml.encode('utf-8'))
            elif name == 'xl/_rels/workbook.xml.rels':
                # 修改 rels 添加多个 sheet 关系
                rels_xml = data.decode('utf-8')
                new_rels = []
                for i in range(1, len(bureau_names) + 1):
                    new_rels.append(
                        f'<Relationship Id="rId{i}" '
                        f'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                        f'Target="worksheets/sheet{i}.xml"/>'
                    )
                rels_pattern = re.compile(r'<Relationships[^>]*>|</Relationships>')
                # 重建
                ns_match = re.search(r'<Relationships[^>]*>', rels_xml)
                ns = ns_match.group(0) if ns_match else '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                # 保留非 sheet 的 relationship（如 styles, sharedStrings 等）
                other_rels = re.findall(r'<Relationship[^/]*(?!worksheet)[^/]*/>', rels_xml)
                # 简化：保留 id 不以 rId 开头数字的，或类型不是 worksheet 的
                all_rels = re.findall(r'<Relationship[^/]*/>', rels_xml)
                kept_rels = [r for r in all_rels if 'worksheet' not in r]

                full_rels = ns + ''.join(new_rels) + ''.join(kept_rels) + '</Relationships>'
                zf.writestr(name, full_rels.encode('utf-8'))
            elif name.startswith('xl/worksheets/') and name.endswith('.xml') and name != sheet_xml_name:
                # 跳过其他 sheet 文件
                pass
            elif name.startswith('xl/worksheets/_rels/'):
                # 跳过 sheet rels
                pass
            elif name == '[Content_Types].xml':
                # 修改 Content_Types 注册多个 sheet
                ct_xml = data.decode('utf-8')
                # 移除原有 sheet Override
                ct_xml = re.sub(r'<Override PartName="/xl/worksheets/sheet\d+\.xml"[^/]*/>', '', ct_xml)
                # 添加新的
                overrides = ''
                for i in range(1, len(bureau_names) + 1):
                    overrides += (f'<Override PartName="/xl/worksheets/sheet{i}.xml" '
                                  f'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
                ct_xml = ct_xml.replace('</Types>', overrides + '</Types>')
                zf.writestr(name, ct_xml.encode('utf-8'))
            else:
                zf.writestr(name, data)

        # 写额外的 sheet 文件（第2个及以后的分局）
        for i, bn in enumerate(bureau_names[1:], start=2):
            bureau_rows = rows_map[bn]
            new_rows = [1] + bureau_rows
            new_xml = _build_sheet_xml(common_prefix, xml_suffix, row_map, new_rows)
            sheet_name = f'xl/worksheets/sheet{i}.xml'
            zf.writestr(sheet_name, new_xml.encode('utf-8'))

            # 写 sheet rels（复制图片等关系）
            base_rels_name = 'xl/worksheets/_rels/sheet1.xml.rels'
            if base_rels_name in source_files:
                rels_data = source_files[base_rels_name].decode('utf-8')
                # 保持原样（图片引用等）
                new_rels_name = f'xl/worksheets/_rels/sheet{i}.xml.rels'
                zf.writestr(new_rels_name, rels_data.encode('utf-8'))
