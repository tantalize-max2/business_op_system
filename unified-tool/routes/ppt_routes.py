# -*- coding: utf-8 -*-
import os
import json
import base64
from flask import Blueprint, request, jsonify, send_file, current_app
from models.ppt_model import (
    list_ppt_templates, save_ppt_template, get_ppt_template,
    delete_ppt_template, generate_ppt, get_last_nz_output, save_last_nz_output
)

ppt_bp = Blueprint('ppt', __name__)


@ppt_bp.route('/api/ppt-templates', methods=['GET'])
def list_ppt_templates_api():
    templates = list_ppt_templates()
    return jsonify({'templates': templates})


@ppt_bp.route('/api/ppt-templates', methods=['POST'])
def save_ppt_template_api():
    data = request.json or {}
    name = (data.get('name') or '').strip()
    template_data = data.get('templateData', '')
    data_file_data = data.get('dataFileData', '')
    data_map = data.get('dataMap')
    if not name:
        return jsonify({'error': '模板名称不能为空'}), 400
    if not template_data and not data_file_data:
        return jsonify({'error': '至少需要提供模板或数据文件'}), 400
    result = save_ppt_template(name, template_data, data_file_data, data_map)
    if not result['ok']:
        return jsonify({'error': '保存失败'}), 500
    return jsonify({'message': '模板已保存', 'name': result['name']})


@ppt_bp.route('/api/ppt-templates/<path:name>', methods=['GET'])
def get_ppt_template_api(name):
    data = get_ppt_template(name)
    if data is None:
        return jsonify({'error': '模板不存在'}), 404
    return current_app.response_class(
        response=json.dumps(data, ensure_ascii=False),
        status=200,
        mimetype='application/json'
    )


@ppt_bp.route('/api/ppt-templates/<path:name>', methods=['DELETE'])
def delete_ppt_template_api(name):
    if not delete_ppt_template(name):
        return jsonify({'error': '模板不存在'}), 404
    return jsonify({'message': '模板已删除'})


@ppt_bp.route('/api/ppt-generate', methods=['POST'])
def ppt_generate_api():
    data = request.json or {}
    template_b64 = data.get('templateData', '')
    data_file_b64 = data.get('dataFileData', '')
    custom_texts = data.get('customTexts', {})

    # 如果没有提供数据文件，尝试使用上次标准化输出
    if not data_file_b64:
        nz_output = get_last_nz_output()
        if nz_output and nz_output.get('path'):
            try:
                with open(nz_output['path'], 'rb') as f:
                    data_file_b64 = base64.b64encode(f.read()).decode('utf-8')
            except Exception:
                pass

    if not template_b64:
        return jsonify({'error': '请上传PPT模板文件'}), 400
    if not data_file_b64:
        return jsonify({'error': '请上传数据Excel文件，或在数据标准化步骤执行填充操作'}), 400

    try:
        template_bytes = base64.b64decode(template_b64)
    except Exception:
        return jsonify({'error': 'PPT模板数据解码失败'}), 400

    try:
        data_bytes = base64.b64decode(data_file_b64)
    except Exception:
        return jsonify({'error': '数据文件解码失败'}), 400

    result = generate_ppt(template_bytes, data_bytes, custom_texts, data.get('dataMap'))

    if not result['ok']:
        return jsonify({'error': result['error']}), 500

    output_path = result['output_path']
    if not os.path.exists(output_path):
        return jsonify({'error': '生成文件丢失'}), 500

    # 图表调试信息放入自定义响应头（base64编码避免中文问题）
    import urllib.parse
    chart_debug = result.get('chart_debug', {})
    response = send_file(
        output_path,
        as_attachment=True,
        download_name='商机通报.pptx',
        mimetype='application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )

    # 附加调试响应头（值用 urllib.parse.quote 编码中文）
    debug_map = {
        'X-Ind-Range': chart_debug.get('industry_effective_range', ''),
        'X-Ind-Preview': chart_debug.get('industry_data_preview', ''),
        'X-Ind-Chart-Ok': str(chart_debug.get('industry_chart_ok', False)),
        'X-Comm-Range': chart_debug.get('commercial_effective_range', ''),
        'X-Comm-Preview': chart_debug.get('commercial_data_preview', ''),
        'X-Comm-Chart-Ok': str(chart_debug.get('commercial_chart_ok', False)),
    }
    for k, v in debug_map.items():
        response.headers[k] = urllib.parse.quote(str(v), safe='')

    @response.call_on_close
    def cleanup():
        try:
            os.unlink(output_path)
        except Exception:
            pass

    return response


@ppt_bp.route('/api/ppt-nz-output', methods=['GET'])
def ppt_nz_output_api():
    """获取上次标准化填充的输出信息"""
    nz_output = get_last_nz_output()
    if nz_output:
        return jsonify({
            'available': True,
            'time': nz_output.get('time', ''),
            'path': nz_output.get('path', '')
        })
    return jsonify({'available': False})


@ppt_bp.route('/api/ppt-data-preview', methods=['POST'])
def ppt_data_preview_api():
    """预览PPT模块从数据Excel中读取的各区域内容，用于校准数据匹配"""
    from openpyxl import load_workbook as _load_wb
    data = request.json or {}
    data_file_b64 = data.get('dataFileData', '')

    # 如果没有提供数据文件，尝试使用上次标准化输出
    if not data_file_b64:
        nz_output = get_last_nz_output()
        if nz_output and nz_output.get('path'):
            try:
                with open(nz_output['path'], 'rb') as f:
                    data_file_b64 = base64.b64encode(f.read()).decode('utf-8')
            except Exception:
                pass

    if not data_file_b64:
        return jsonify({'error': '没有可用的数据文件'}), 400

    try:
        data_bytes = base64.b64decode(data_file_b64)
    except Exception:
        return jsonify({'error': '数据文件解码失败'}), 400

    import tempfile
    tmp = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp.write(data_bytes)
    tmp.close()

    try:
        wb = _load_wb(tmp.name, data_only=True)
        ws = wb.active
    except Exception as e:
        os.unlink(tmp.name)
        return jsonify({'error': f'读取失败: {str(e)}'}), 500

    try:
        from models.ppt_model import (cell_val, read_range, excel_date_to_str, fmt_ca,
                                       _parse_cell_ref, _parse_range_ref, DEFAULT_DATA_MAP)
        dm = dict(DEFAULT_DATA_MAP)
        if data.get('dataMap'):
            dm.update(data['dataMap'])

        date_c, date_r = _parse_cell_ref(dm['date_cell'])
        period_c, period_r = _parse_cell_ref(dm['period_cell'])
        b27_c, b27_r = _parse_cell_ref(dm['B27_cell'])
        b28_c, b28_r = _parse_cell_ref(dm['B28_cell'])
        j27_c, j27_r = _parse_cell_ref(dm['J27_cell'])
        j28_c, j28_r = _parse_cell_ref(dm['J28_cell'])
        ai27_c, ai27_r = _parse_cell_ref(dm['AI27_cell'])
        ai28_c, ai28_r = _parse_cell_ref(dm['AI28_cell'])

        preview = {
            'date': str(cell_val(ws, date_c, date_r)),
            'period': str(cell_val(ws, period_c, period_r)),
            'B27': str(cell_val(ws, b27_c, b27_r))[:100],
            'B28': str(cell_val(ws, b28_c, b28_r))[:100],
            'J27': str(cell_val(ws, j27_c, j27_r))[:100],
            'J28': str(cell_val(ws, j28_c, j28_r))[:100],
            'AI27': str(cell_val(ws, ai27_c, ai27_r))[:100],
            'AI28': str(cell_val(ws, ai28_c, ai28_r))[:100],
        }

        # 读取各区域的前几行（使用可配置的范围）
        ir = _parse_range_ref(dm['industry_reserve'])
        cr = _parse_range_ref(dm['commercial_reserve'])
        ie = _parse_range_ref(dm['industry_effective'])
        ce = _parse_range_ref(dm['commercial_effective'])
        ip = _parse_range_ref(dm['industry_progress'])
        cp = _parse_range_ref(dm['commercial_progress'])
        idr = _parse_range_ref(dm['industry_delivered'])
        cdr = _parse_range_ref(dm['commercial_delivered'])

        ind_reserve = read_range(ws, ir[0], ir[1], ir[2], ir[3])
        comm_reserve = read_range(ws, cr[0], cr[1], cr[2], cr[3])
        ind_effective = read_range(ws, ie[0], ie[1], ie[2], ie[3])
        comm_effective = read_range(ws, ce[0], ce[1], ce[2], ce[3])
        ind_progress = read_range(ws, ip[0], ip[1], ip[2], ip[3])
        comm_progress = read_range(ws, cp[0], cp[1], cp[2], cp[3])
        ind_delivered = read_range(ws, idr[0], idr[1], idr[2], idr[3])
        comm_delivered = read_range(ws, cdr[0], cdr[1], cdr[2], cdr[3])

        def to_str_rows(rows):
            return [[str(c) if c is not None else '' for c in r] for r in rows]

        def sample_rows(rows, max_n=3):
            return to_str_rows(rows[:max_n])

        # 有效商机区域返回完整数据（用于图表校准），其他区域返回样本
        preview['ranges'] = {
            'industry_reserve': {'rows': len(ind_reserve), 'sample': sample_rows(ind_reserve)},
            'commercial_reserve': {'rows': len(comm_reserve), 'sample': sample_rows(comm_reserve)},
            'industry_effective': {'rows': len(ind_effective), 'sample': sample_rows(ind_effective), 'full': to_str_rows(ind_effective)},
            'commercial_effective': {'rows': len(comm_effective), 'sample': sample_rows(comm_effective), 'full': to_str_rows(comm_effective)},
            'industry_progress': {'rows': len(ind_progress), 'sample': sample_rows(ind_progress)},
            'commercial_progress': {'rows': len(comm_progress), 'sample': sample_rows(comm_progress)},
            'industry_delivered': {'rows': len(ind_delivered), 'sample': sample_rows(ind_delivered)},
            'commercial_delivered': {'rows': len(comm_delivered), 'sample': sample_rows(comm_delivered)},
        }

        wb.close()
        os.unlink(tmp.name)
        return jsonify(preview)
    except Exception as e:
        wb.close()
        os.unlink(tmp.name)
        return jsonify({'error': f'解析失败: {str(e)}'}), 500
