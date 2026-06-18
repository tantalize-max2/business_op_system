# -*- coding: utf-8 -*-
import os
import json
from flask import Blueprint, request, jsonify, send_file, current_app
from config import OUTPUT_DIR, UPLOAD_DIR
from models.push_model import get_airscript_code, save_airscript_code
from services.push_service import (browse_local_fs, list_kdocs_cats_with_count, add_kdocs_cat,
                                    delete_kdocs_cat, list_kdocs_sheets, add_kdocs_sheet,
                                    update_kdocs_sheet, delete_kdocs_sheet, push_to_kdocs,
                                    push_to_kdocs_batch, scan_folder)

push_bp = Blueprint('push', __name__)


@push_bp.route('/api/kdocs-upload', methods=['POST'])
def upload_excel_api():
    """上传 Excel 文件到服务器 data/uploads 目录（供推送模块使用）
    ---
    tags:
      - 在线推送
    consumes:
      - multipart/form-data
    parameters:
      - name: file
        in: formData
        type: file
        required: true
        description: 待上传的 Excel 文件（仅 xlsx/xls）
    responses:
      200:
        description: 上传成功
        schema:
          type: object
          properties:
            message: {type: string}
            path: {type: string, description: "服务器保存路径"}
            name: {type: string, description: "安全文件名"}
            size: {type: integer, description: "文件大小(字节)"}
      400:
        description: 未选择文件 / 格式不支持
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    if 'file' not in request.files:
        return jsonify({'error': '未选择文件'}), 400
    f = request.files['file']
    if not f or not f.filename:
        return jsonify({'error': '未选择文件'}), 400
    fname = f.filename.strip()
    ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ''
    if ext not in ('xlsx', 'xls'):
        return jsonify({'error': '仅支持 xlsx/xls 格式'}), 400
    # 安全文件名：去掉路径分隔符，避免目录穿越
    safe_name = os.path.basename(fname)
    save_path = os.path.join(UPLOAD_DIR, safe_name)
    f.save(save_path)
    return jsonify({'message': '上传成功', 'path': save_path, 'name': safe_name,
                    'size': os.path.getsize(save_path)})


@push_bp.route('/api/kdocs-browse', methods=['POST'])
def browse_local_fs_api():
    """浏览服务器本地文件系统目录内容
    ---
    tags:
      - 在线推送
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          properties:
            path:
              type: string
              description: 要浏览的目录绝对路径（为空则返回根驱动器列表）
    responses:
      200:
        description: 目录条目列表
        schema:
          type: object
          properties:
            path: {type: string, description: "当前目录绝对路径"}
            parent: {type: string, description: "父目录绝对路径"}
            items:
              type: array
              items:
                type: object
                properties:
                  name: {type: string}
                  is_dir: {type: boolean}
                  size: {type: integer}
      400:
        description: 路径无效或不可访问
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    data = request.json or {}
    path = data.get('path', '').strip()
    result = browse_local_fs(path)
    if 'error' in result:
        return jsonify(result), 400
    return jsonify(result)


@push_bp.route('/api/kdocs-categories', methods=['GET'])
def list_kdocs_cats_api():
    """获取所有金山文档推送分类（含每个分类下的表格数量）
    ---
    tags:
      - 在线推送
    responses:
      200:
        description: 分类列表
        schema:
          type: array
          items:
            type: object
            properties:
              id: {type: string, description: "分类ID"}
              name: {type: string, description: "分类名称"}
              color: {type: string, description: "分类颜色(hex)"}
              count: {type: integer, description: "该分类下的表格数量"}
    """
    cats = list_kdocs_cats_with_count()
    return jsonify(cats)


@push_bp.route('/api/kdocs-categories', methods=['POST'])
def add_kdocs_cat_api():
    """新增一个金山文档推送分类
    ---
    tags:
      - 在线推送
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          required: [name]
          properties:
            name: {type: string, description: "分类名称（唯一）"}
            color: {type: string, description: "分类颜色hex，默认 #0d9488"}
    responses:
      200:
        description: 添加成功
        schema:
          type: object
          properties:
            message: {type: string}
            category:
              type: object
              description: 新建分类对象
      400:
        description: 名称为空 / 名称已存在
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    data = request.json or {}
    name = data.get('name', '').strip()
    color = data.get('color', '#0d9488').strip()
    if not name:
        return jsonify({'error': '分类名不能为空'}), 400
    cat = add_kdocs_cat(name, color)
    if cat is None:
        return jsonify({'error': '分类名已存在'}), 400
    return jsonify({'message': '添加成功', 'category': cat})


@push_bp.route('/api/kdocs-categories/<cid>', methods=['DELETE'])
def delete_kdocs_cat_api(cid):
    """删除指定分类（分类下的表格会被解绑到默认分类）
    ---
    tags:
      - 在线推送
    parameters:
      - name: cid
        in: path
        type: string
        required: true
        description: 分类ID
    responses:
      200:
        description: 删除成功
        schema:
          type: object
          properties:
            message: {type: string}
    """
    delete_kdocs_cat(cid)
    return jsonify({'message': '已删除'})


@push_bp.route('/api/kdocs-sheets', methods=['GET'])
def list_kdocs_sheets_api():
    """获取金山文档推送表格列表（可按分类过滤）
    ---
    tags:
      - 在线推送
    parameters:
      - name: category
        in: query
        type: string
        required: false
        description: 分类ID（不传则返回全部）
    responses:
      200:
        description: 表格配置列表
        schema:
          type: array
          items:
            type: object
            properties:
              id: {type: string, description: "表格配置ID"}
              name: {type: string, description: "显示名称"}
              url: {type: string, description: "金山文档表格URL"}
              api_token: {type: string, description: "表格API Token"}
              webhook_url: {type: string, description: "AirScript webhook URL"}
              excel_path: {type: string, description: "关联的本地Excel路径"}
              batch_size: {type: integer, description: "推送批次大小"}
              category: {type: string, description: "所属分类ID"}
    """
    cat_id = request.args.get('category', '')
    sheets = list_kdocs_sheets(cat_id)
    return jsonify(sheets)


@push_bp.route('/api/kdocs-sheets', methods=['POST'])
def add_kdocs_sheet_api():
    """新增一个金山文档推送表格配置
    ---
    tags:
      - 在线推送
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          required: [name, url]
          properties:
            name: {type: string, description: "显示名称"}
            url: {type: string, description: "金山文档表格URL"}
            api_token: {type: string, description: "表格API Token"}
            webhook_url: {type: string, description: "AirScript webhook URL"}
            excel_path: {type: string, description: "关联的本地Excel路径"}
            batch_size: {type: integer, description: "推送批次大小，默认3"}
            category: {type: string, description: "所属分类ID，默认 default"}
    responses:
      200:
        description: 添加成功
        schema:
          type: object
          properties:
            message: {type: string}
            sheet: {type: object, description: "新建配置对象"}
      400:
        description: 名称或URL为空
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
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
    sheet = add_kdocs_sheet(name, url, api_token, webhook_url, excel_path, batch_size, category)
    return jsonify({'message': '添加成功', 'sheet': sheet})


@push_bp.route('/api/kdocs-sheets/<sid>', methods=['PUT'])
def update_kdocs_sheet_api(sid):
    """更新指定推送表格配置
    ---
    tags:
      - 在线推送
    parameters:
      - name: sid
        in: path
        type: string
        required: true
        description: 表格配置ID
      - name: body
        in: body
        required: true
        schema:
          type: object
          description: 需要更新的字段（任意子集）
          properties:
            name: {type: string}
            url: {type: string}
            api_token: {type: string}
            webhook_url: {type: string}
            excel_path: {type: string}
            batch_size: {type: integer}
            category: {type: string}
    responses:
      200:
        description: 更新成功
        schema:
          type: object
          properties:
            message: {type: string}
            sheet: {type: object, description: "更新后的配置"}
      404:
        description: 未找到该配置
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    data = request.json or {}
    sheet = update_kdocs_sheet(sid, data)
    if sheet is None:
        return jsonify({'error': '未找到该配置'}), 404
    return jsonify({'message': '更新成功', 'sheet': sheet})


@push_bp.route('/api/kdocs-sheets/<sid>', methods=['DELETE'])
def delete_kdocs_sheet_api(sid):
    """删除指定推送表格配置
    ---
    tags:
      - 在线推送
    parameters:
      - name: sid
        in: path
        type: string
        required: true
        description: 表格配置ID
    responses:
      200:
        description: 删除成功
        schema:
          type: object
          properties:
            message: {type: string}
    """
    delete_kdocs_sheet(sid)
    return jsonify({'message': '删除成功'})


@push_bp.route('/api/kdocs-push', methods=['POST'])
def push_to_kdocs_api():
    """将指定 Excel 数据推送到单个金山文档在线表格
    ---
    tags:
      - 在线推送
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          required: [id]
          properties:
            id: {type: string, description: "表格配置ID"}
            excel_path: {type: string, description: "本地Excel路径覆盖（不传则使用配置中的）"}
    responses:
      200:
        description: 推送结果
        schema:
          type: object
          properties:
            success: {type: boolean}
            message: {type: string}
            pushed_rows: {type: integer, description: "成功推送的行数"}
      400:
        description: 未配置 webhook / 未指定文件
        schema:
          $ref: '#/definitions/ErrorResponse'
      500:
        description: 远端调用失败
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    data = request.json or {}
    sid = data.get('id', '')
    excel_path = data.get('excel_path', '')
    result = push_to_kdocs(sid, excel_path)
    if 'error' in result:
        return jsonify(result), 400 if '未配置' in result['error'] or '未指定' in result['error'] else 500
    return jsonify(result)


@push_bp.route('/api/kdocs-push-batch', methods=['POST'])
def push_to_kdocs_batch_api():
    """批量推送一个文件夹下的所有 Excel 到对应的在线表格
    ---
    tags:
      - 在线推送
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          required: [folder_path]
          properties:
            folder_path: {type: string, description: "包含待推送 Excel 的文件夹绝对路径"}
    responses:
      200:
        description: 批量推送结果汇总
        schema:
          type: object
          properties:
            total: {type: integer, description: "检测到的Excel数量"}
            success: {type: integer, description: "推送成功的数量"}
            failed: {type: integer, description: "推送失败的数量"}
            details:
              type: array
              items: {type: object}
      400:
        description: 参数错误（路径无效、未配置等）
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    data = request.json or {}
    folder_path = data.get('folder_path', '').strip()
    result = push_to_kdocs_batch(folder_path)
    if 'error' in result:
        return jsonify(result), 400
    return jsonify(result)


@push_bp.route('/api/kdocs-airscript-code', methods=['GET'])
def get_airscript_code_api():
    """获取当前用于推送的 AirScript 脚本代码
    ---
    tags:
      - 在线推送
    responses:
      200:
        description: 脚本内容
        schema:
          type: object
          properties:
            code: {type: string, description: "AirScript 脚本源码"}
      404:
        description: 脚本文件不存在
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    code = get_airscript_code()
    if code is None:
        return jsonify({'error': 'airscript_code.js 文件不存在'}), 404
    return jsonify({'code': code})


@push_bp.route('/api/kdocs-airscript-code', methods=['PUT'])
def save_airscript_code_api():
    """更新 AirScript 脚本代码
    ---
    tags:
      - 在线推送
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          required: [code]
          properties:
            code: {type: string, description: "新的 AirScript 脚本源码"}
    responses:
      200:
        description: 保存成功
        schema:
          type: object
          properties:
            message: {type: string}
      500:
        description: 保存失败
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    data = request.json or {}
    code = data.get('code', '')
    if save_airscript_code(code):
        return jsonify({'message': '保存成功'})
    return jsonify({'error': '保存失败'}), 500


@push_bp.route('/api/kdocs-folder-scan', methods=['POST'])
def scan_folder_api():
    """扫描指定文件夹下所有可推送的 Excel 文件
    ---
    tags:
      - 在线推送
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          required: [folder_path]
          properties:
            folder_path: {type: string, description: "要扫描的文件夹绝对路径"}
    responses:
      200:
        description: 扫描结果
        schema:
          type: object
          properties:
            files:
              type: array
              items:
                type: object
                properties:
                  name: {type: string}
                  path: {type: string, description: "绝对路径"}
                  size: {type: integer}
            count: {type: integer, description: "文件数量"}
      400:
        description: 文件夹路径无效
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    data = request.json or {}
    folder_path = data.get('folder_path', '').strip()
    files = scan_folder(folder_path)
    if files is None:
        return jsonify({'error': '文件夹路径无效'}), 400
    return jsonify({'files': files, 'count': len(files)})
