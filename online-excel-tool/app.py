"""在线Excel表格管理工具 - Flask 后端服务"""
import os, json, uuid
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder='static')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
SHEETS_FILE = os.path.join(DATA_DIR, 'sheets.json')
CATEGORIES_FILE = os.path.join(DATA_DIR, 'categories.json')

os.makedirs(DATA_DIR, exist_ok=True)

# ── 工具函数 ──────────────────────────────────────────
def load_json(path, default=None):
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return default if default is not None else []

def save_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def now_str():
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')

# ── 初始化默认分类 ────────────────────────────────────
def init_categories():
    if not os.path.exists(CATEGORIES_FILE):
        default_cats = [
            {"id": str(uuid.uuid4()), "name": "商机数据", "color": "#1a73e8", "order": 0},
            {"id": str(uuid.uuid4()), "name": "统计报表", "color": "#188038", "order": 1},
            {"id": str(uuid.uuid4()), "name": "项目文档", "color": "#f29900", "order": 2},
            {"id": str(uuid.uuid4()), "name": "其他", "color": "#5f6368", "order": 3},
        ]
        save_json(CATEGORIES_FILE, default_cats)

init_categories()

# ── 页面路由 ──────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

# ── 表格 CRUD ─────────────────────────────────────────
@app.route('/api/sheets', methods=['GET'])
def get_sheets():
    """获取所有表格"""
    category = request.args.get('category', '')
    keyword = request.args.get('keyword', '')
    sheets = load_json(SHEETS_FILE, [])
    # 过滤
    if category:
        sheets = [s for s in sheets if s.get('category') == category]
    if keyword:
        kw = keyword.lower()
        sheets = [s for s in sheets if kw in s.get('name', '').lower()
                  or kw in s.get('url', '').lower()
                  or kw in s.get('description', '').lower()]
    # 排序: 置顶优先, 然后按更新时间倒序
    sheets.sort(key=lambda s: (not s.get('pinned', False), s.get('updated_at', '')), reverse=False)
    sheets.sort(key=lambda s: not s.get('pinned', False))
    return jsonify({"success": True, "data": sheets})

@app.route('/api/sheets', methods=['POST'])
def add_sheet():
    """新增表格"""
    data = request.get_json(force=True)
    name = data.get('name', '').strip()
    url = data.get('url', '').strip()
    if not name or not url:
        return jsonify({"success": False, "message": "名称和链接不能为空"})
    sheets = load_json(SHEETS_FILE, [])
    # 检查URL是否已存在
    if any(s.get('url') == url for s in sheets):
        return jsonify({"success": False, "message": "该链接已存在"})
    sheet = {
        "id": str(uuid.uuid4()),
        "name": name,
        "url": url,
        "category": data.get('category', ''),
        "description": data.get('description', '').strip(),
        "tags": data.get('tags', []),
        "pinned": data.get('pinned', False),
        "access_count": 0,
        "created_at": now_str(),
        "updated_at": now_str(),
    }
    sheets.append(sheet)
    save_json(SHEETS_FILE, sheets)
    return jsonify({"success": True, "data": sheet, "message": "添加成功"})

@app.route('/api/sheets/<sheet_id>', methods=['PUT'])
def update_sheet(sheet_id):
    """更新表格"""
    data = request.get_json(force=True)
    sheets = load_json(SHEETS_FILE, [])
    for s in sheets:
        if s['id'] == sheet_id:
            # 更新允许的字段
            for key in ['name', 'url', 'category', 'description', 'tags', 'pinned']:
                if key in data:
                    s[key] = data[key]
            s['updated_at'] = now_str()
            save_json(SHEETS_FILE, sheets)
            return jsonify({"success": True, "data": s, "message": "更新成功"})
    return jsonify({"success": False, "message": "未找到该表格"})

@app.route('/api/sheets/<sheet_id>', methods=['DELETE'])
def delete_sheet(sheet_id):
    """删除表格"""
    sheets = load_json(SHEETS_FILE, [])
    new_sheets = [s for s in sheets if s['id'] != sheet_id]
    if len(new_sheets) == len(sheets):
        return jsonify({"success": False, "message": "未找到该表格"})
    save_json(SHEETS_FILE, new_sheets)
    return jsonify({"success": True, "message": "删除成功"})

@app.route('/api/sheets/<sheet_id>/open', methods=['POST'])
def open_sheet(sheet_id):
    """记录打开表格（不再用外部浏览器，由前端iframe嵌入）"""
    sheets = load_json(SHEETS_FILE, [])
    for s in sheets:
        if s['id'] == sheet_id:
            s['access_count'] = s.get('access_count', 0) + 1
            s['updated_at'] = now_str()
            save_json(SHEETS_FILE, sheets)
            return jsonify({"success": True, "data": {"url": s['url'], "name": s['name']}, "message": "已打开"})
    return jsonify({"success": False, "message": "未找到该表格"})

@app.route('/api/sheets/<sheet_id>/pin', methods=['POST'])
def toggle_pin(sheet_id):
    """切换置顶状态"""
    sheets = load_json(SHEETS_FILE, [])
    for s in sheets:
        if s['id'] == sheet_id:
            s['pinned'] = not s.get('pinned', False)
            s['updated_at'] = now_str()
            save_json(SHEETS_FILE, sheets)
            status = "已置顶" if s['pinned'] else "已取消置顶"
            return jsonify({"success": True, "data": s, "message": status})
    return jsonify({"success": False, "message": "未找到该表格"})

# ── 分类 CRUD ─────────────────────────────────────────
@app.route('/api/categories', methods=['GET'])
def get_categories():
    """获取所有分类"""
    cats = load_json(CATEGORIES_FILE, [])
    cats.sort(key=lambda c: c.get('order', 0))
    # 统计每个分类下的表格数量
    sheets = load_json(SHEETS_FILE, [])
    for c in cats:
        c['count'] = sum(1 for s in sheets if s.get('category') == c['id'])
    return jsonify({"success": True, "data": cats})

@app.route('/api/categories', methods=['POST'])
def add_category():
    """新增分类"""
    data = request.get_json(force=True)
    name = data.get('name', '').strip()
    if not name:
        return jsonify({"success": False, "message": "分类名称不能为空"})
    cats = load_json(CATEGORIES_FILE, [])
    if any(c['name'] == name for c in cats):
        return jsonify({"success": False, "message": "分类已存在"})
    cat = {
        "id": str(uuid.uuid4()),
        "name": name,
        "color": data.get('color', '#1a73e8'),
        "order": len(cats),
    }
    cats.append(cat)
    save_json(CATEGORIES_FILE, cats)
    return jsonify({"success": True, "data": cat, "message": "分类添加成功"})

@app.route('/api/categories/<cat_id>', methods=['PUT'])
def update_category(cat_id):
    """更新分类"""
    data = request.get_json(force=True)
    cats = load_json(CATEGORIES_FILE, [])
    for c in cats:
        if c['id'] == cat_id:
            for key in ['name', 'color', 'order']:
                if key in data:
                    c[key] = data[key]
            save_json(CATEGORIES_FILE, cats)
            return jsonify({"success": True, "data": c, "message": "分类更新成功"})
    return jsonify({"success": False, "message": "未找到该分类"})

@app.route('/api/categories/<cat_id>', methods=['DELETE'])
def delete_category(cat_id):
    """删除分类"""
    cats = load_json(CATEGORIES_FILE, [])
    new_cats = [c for c in cats if c['id'] != cat_id]
    if len(new_cats) == len(cats):
        return jsonify({"success": False, "message": "未找到该分类"})
    save_json(CATEGORIES_FILE, new_cats)
    # 将该分类下的表格移到无分类
    sheets = load_json(SHEETS_FILE, [])
    for s in sheets:
        if s.get('category') == cat_id:
            s['category'] = ''
    save_json(SHEETS_FILE, sheets)
    return jsonify({"success": True, "message": "分类删除成功"})

# ── 批量操作 ──────────────────────────────────────────
@app.route('/api/sheets/batch-delete', methods=['POST'])
def batch_delete():
    """批量删除表格"""
    data = request.get_json(force=True)
    ids = data.get('ids', [])
    if not ids:
        return jsonify({"success": False, "message": "未选择表格"})
    sheets = load_json(SHEETS_FILE, [])
    id_set = set(ids)
    new_sheets = [s for s in sheets if s['id'] not in id_set]
    removed = len(sheets) - len(new_sheets)
    save_json(SHEETS_FILE, new_sheets)
    return jsonify({"success": True, "message": f"已删除 {removed} 个表格"})

@app.route('/api/sheets/batch-move', methods=['POST'])
def batch_move():
    """批量移动到分类"""
    data = request.get_json(force=True)
    ids = data.get('ids', [])
    category = data.get('category', '')
    if not ids:
        return jsonify({"success": False, "message": "未选择表格"})
    sheets = load_json(SHEETS_FILE, [])
    id_set = set(ids)
    moved = 0
    for s in sheets:
        if s['id'] in id_set:
            s['category'] = category
            s['updated_at'] = now_str()
            moved += 1
    save_json(SHEETS_FILE, sheets)
    return jsonify({"success": True, "message": f"已移动 {moved} 个表格"})

# ── 统计 ──────────────────────────────────────────────
@app.route('/api/stats', methods=['GET'])
def get_stats():
    """获取统计信息"""
    sheets = load_json(SHEETS_FILE, [])
    cats = load_json(CATEGORIES_FILE, [])
    total = len(sheets)
    pinned = sum(1 for s in sheets if s.get('pinned'))
    recent = sorted(sheets, key=lambda s: s.get('updated_at', ''), reverse=True)[:5]
    cat_stats = []
    for c in cats:
        count = sum(1 for s in sheets if s.get('category') == c['id'])
        cat_stats.append({"name": c['name'], "color": c.get('color', '#1a73e8'), "count": count})
    uncat = sum(1 for s in sheets if not s.get('category'))
    if uncat > 0:
        cat_stats.append({"name": "未分类", "color": "#80868b", "count": uncat})
    return jsonify({
        "success": True,
        "data": {
            "total": total,
            "pinned": pinned,
            "categories": len(cats),
            "recent": recent,
            "cat_stats": cat_stats
        }
    })

# ── 导入导出 ──────────────────────────────────────────
@app.route('/api/export', methods=['GET'])
def export_data():
    """导出所有数据"""
    sheets = load_json(SHEETS_FILE, [])
    cats = load_json(CATEGORIES_FILE, [])
    return jsonify({"success": True, "data": {"sheets": sheets, "categories": cats}})

@app.route('/api/import', methods=['POST'])
def import_data():
    """导入数据"""
    data = request.get_json(force=True)
    mode = data.get('mode', 'merge')  # merge 或 replace
    imported_sheets = data.get('sheets', [])
    imported_cats = data.get('categories', [])
    if mode == 'replace':
        save_json(SHEETS_FILE, imported_sheets)
        save_json(CATEGORIES_FILE, imported_cats)
        return jsonify({"success": True, "message": f"已替换: {len(imported_sheets)} 个表格, {len(imported_cats)} 个分类"})
    # merge 模式: 按URL去重合并
    existing_sheets = load_json(SHEETS_FILE, [])
    existing_urls = {s['url'] for s in existing_sheets}
    added = 0
    for s in imported_sheets:
        if s.get('url') not in existing_urls:
            if 'id' not in s:
                s['id'] = str(uuid.uuid4())
            existing_sheets.append(s)
            added += 1
    save_json(SHEETS_FILE, existing_sheets)
    # 分类合并
    existing_cats = load_json(CATEGORIES_FILE, [])
    existing_cat_names = {c['name'] for c in existing_cats}
    cat_added = 0
    for c in imported_cats:
        if c.get('name') not in existing_cat_names:
            if 'id' not in c:
                c['id'] = str(uuid.uuid4())
            existing_cats.append(c)
            cat_added += 1
    save_json(CATEGORIES_FILE, existing_cats)
    return jsonify({"success": True, "message": f"已合并: 新增 {added} 个表格, {cat_added} 个分类"})

if __name__ == '__main__':
    print("=" * 50)
    print("  在线Excel表格管理工具")
    print("  访问地址: http://localhost:5558")
    print("=" * 50)
    app.run(host='0.0.0.0', port=5558, debug=True)
