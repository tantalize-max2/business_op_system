# -*- coding: utf-8 -*-
"""Excel 格式复制工具。

核心优化：新 sheet 与源 sheet 在同一工作簿内时，直接复制 _style 索引（整数数组），
比逐属性复制 font/border/fill 对象快 60 倍以上。

注意：_style 索引指向工作簿级 styles.xml，仅在同一工作簿内有效。
"""
import re
from copy import copy
from openpyxl.utils import get_column_letter


def clean_name(name):
    if not isinstance(name, str):
        return ""
    name = re.sub(r'\([^)]*\)', '', name)
    name = re.sub(r'\（[^）]*\）', '', name)
    parts = re.split(r'[,，、;；\s]+', name)
    parts = [p.strip() for p in parts if p.strip()]
    return parts[0] if parts else name.strip()


def copy_sheet_with_format(source_sheet, target_sheet, row_indices):
    """将源表中指定行复制到目标表，保留完整格式。

    通过直接复制 _style 索引实现高性能格式复制。
    源表和目标表必须在同一工作簿内。
    """
    max_col = source_sheet.max_column

    # 1. 列宽
    for col_letter, src_dim in source_sheet.column_dimensions.items():
        if src_dim.width:
            tgt_dim = target_sheet.column_dimensions[col_letter]
            tgt_dim.width = src_dim.width
            if src_dim.hidden:
                tgt_dim.hidden = True

    # 2. 行数据 + 格式（_style 索引直接复制）
    src_to_tgt = {}
    for target_row, source_row in enumerate(row_indices, start=1):
        src_to_tgt[source_row] = target_row
        for col in range(1, max_col + 1):
            source_cell = source_sheet.cell(row=source_row, column=col)
            target_cell = target_sheet.cell(row=target_row, column=col)
            target_cell.value = source_cell.value
            if source_cell.has_style:
                target_cell._style = copy(source_cell._style)

        # 行高
        src_rd = source_sheet.row_dimensions.get(source_row)
        if src_rd and src_rd.height:
            target_sheet.row_dimensions[target_row].height = src_rd.height
            if src_rd.hidden:
                target_sheet.row_dimensions[target_row].hidden = True

    # 3. 合并单元格
    _copy_merged_cells(source_sheet, target_sheet, src_to_tgt)

    # 4. 冻结窗格 - 按行号映射到新位置
    if source_sheet.freeze_panes:
        from openpyxl.utils import range_boundaries
        fp = source_sheet.freeze_panes
        if isinstance(fp, str):
            fp_col, fp_row = range_boundaries(fp)[0], range_boundaries(fp)[1]
        else:
            fp_col, fp_row = fp.col_idx, fp.row
        new_freeze_row = None
        for src_row in row_indices:
            if src_row >= fp_row:
                new_freeze_row = src_to_tgt[src_row]
                break
        if new_freeze_row is not None and new_freeze_row > 1:
            target_sheet.freeze_panes = f"{get_column_letter(fp_col)}{new_freeze_row}"

    # 5. 自动筛选
    if source_sheet.auto_filter and source_sheet.auto_filter.ref:
        total_rows = len(row_indices)
        if total_rows > 0:
            target_sheet.auto_filter.ref = f"A1:{get_column_letter(max_col)}{total_rows}"

    # 6. 页面设置与工作表属性
    target_sheet.sheet_format = copy(source_sheet.sheet_format)
    target_sheet.page_setup = copy(source_sheet.page_setup)
    target_sheet.page_margins = copy(source_sheet.page_margins)

    # 7. 条件格式
    _copy_conditional_formatting(source_sheet, target_sheet, src_to_tgt)

    # 8. 数据验证
    _copy_data_validations(source_sheet, target_sheet, src_to_tgt)


def _copy_merged_cells(source_sheet, target_sheet, src_to_tgt):
    """复制合并单元格。"""
    if not source_sheet.merged_cells:
        return
    for merged_range in source_sheet.merged_cells.ranges:
        min_row = merged_range.min_row
        max_row = merged_range.max_row
        min_col = merged_range.min_col
        max_col = merged_range.max_col

        new_min_row = src_to_tgt.get(min_row)
        new_max_row = src_to_tgt.get(max_row)
        if new_min_row is None or new_max_row is None:
            continue
        if not all(r in src_to_tgt for r in range(min_row, max_row + 1)):
            continue
        new_range = f"{get_column_letter(min_col)}{new_min_row}:{get_column_letter(max_col)}{new_max_row}"
        target_sheet.merge_cells(new_range)


def _copy_conditional_formatting(source_sheet, target_sheet, src_to_tgt):
    """复制条件格式。"""
    if not hasattr(source_sheet, 'conditional_formatting') or not source_sheet.conditional_formatting:
        return
    for cf in source_sheet.conditional_formatting:
        for rule_range in cf.cells.ranges:
            min_row = rule_range.min_row
            max_row = rule_range.max_row
            min_col = rule_range.min_col
            max_col = rule_range.max_col
            new_min_row = src_to_tgt.get(min_row)
            new_max_row = src_to_tgt.get(max_row)
            if new_min_row is None or new_max_row is None:
                continue
            if not all(r in src_to_tgt for r in range(min_row, max_row + 1)):
                continue
            for rule in cf.rules:
                target_sheet.conditional_formatting.add(
                    f"{get_column_letter(min_col)}{new_min_row}:{get_column_letter(max_col)}{new_max_row}",
                    copy(rule)
                )


def _copy_data_validations(source_sheet, target_sheet, src_to_tgt):
    """复制数据验证。"""
    if not source_sheet.data_validations or not source_sheet.data_validations.dataValidation:
        return
    from openpyxl.utils import range_boundaries
    for dv in source_sheet.data_validations.dataValidation:
        try:
            sqref = dv.sqref
            if not isinstance(sqref, str):
                continue
            parts = sqref.split()
            new_parts = []
            for part in parts:
                min_col_b, min_row_b, max_col_b, max_row_b = range_boundaries(part)
                new_min_row = src_to_tgt.get(min_row_b)
                new_max_row = src_to_tgt.get(max_row_b)
                if new_min_row and new_max_row:
                    if all(r in src_to_tgt for r in range(min_row_b, max_row_b + 1)):
                        new_parts.append(
                            f"{get_column_letter(min_col_b)}{new_min_row}:"
                            f"{get_column_letter(max_col_b)}{new_max_row}"
                        )
            if new_parts:
                new_dv = copy(dv)
                new_dv.sqref = ' '.join(new_parts)
                target_sheet.data_validations.add(new_dv)
        except Exception:
            pass
