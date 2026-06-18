// ========== nz-core.js — 数据标准化核心引擎（公式解析 + 统计计算） ==========
// 从 step5-normalize.js 拆分。包含：NZ 状态对象、正则常量、公式引擎、统计计算。
// 不含任何 DOM 操作，纯计算逻辑。加载顺序：第1个。

// ========== step5-normalize.js — 步骤5：数据标准化 ==========

// ================================================================
// 安全算术表达式求值（递归下降解析器）
// 仅支持数字与 + - * / () 及一元正负号、科学计数法。
// 不使用 eval / new Function，从语法层面杜绝代码注入。
// ================================================================
function nzSafeArith(expr) {
  const s = String(expr).replace(/\s+/g, '');
  if (!s) return NaN;
  let i = 0;

  function peek() { return s[i]; }

  function parseExpr() { // 加减（低优先级）
    let val = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = s[i++];
      const rhs = parseTerm();
      val = op === '+' ? val + rhs : val - rhs;
    }
    return val;
  }

  function parseTerm() { // 乘除（高优先级）
    let val = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = s[i++];
      const rhs = parseFactor();
      val = op === '*' ? val * rhs : val / rhs;
    }
    return val;
  }

  function parseFactor() { // 括号 / 一元正负 / 数字
    if (peek() === '(') {
      i++;
      const val = parseExpr();
      if (peek() !== ')') throw new Error('括号不匹配');
      i++;
      return val;
    }
    if (peek() === '-') { i++; return -parseFactor(); }
    if (peek() === '+') { i++; return parseFactor(); }
    return parseNumber();
  }

  function parseNumber() {
    let num = '';
    while (i < s.length) {
      const ch = s[i];
      if (/[0-9.]/.test(ch)) {
        num += ch; i++;
      } else if (/[eE]/.test(ch) && num && !/[eE]$/.test(num)) {
        // 科学计数法指数标记
        num += ch; i++;
        if (s[i] === '+' || s[i] === '-') { num += s[i]; i++; }
      } else {
        break;
      }
    }
    if (!num) throw new Error('非数字');
    const n = parseFloat(num);
    if (isNaN(n)) throw new Error('无效数字');
    return n;
  }

  try {
    const result = parseExpr();
    // 必须完整消费整个表达式，否则视为非法
    if (i !== s.length) return NaN;
    return result;
  } catch (e) {
    return NaN;
  }
}

// ================================================================
// STEP 5: 数据标准化 (Normalize)
// ================================================================

const NZ = {
  templates: [],          // 模板列表 [{name, savedAt}]
  currentTemplate: null,  // 当前编辑的模板名
  wb: null,               // SheetJS workbook 对象
  rawBuffer: null,        // 原始 ArrayBuffer (用于回写后端)
  activeSheet: 0,         // 当前活动 sheet 索引
  selectedCell: null,     // {row, col} 当前选中的单元格（锚点）
  selectedRange: null,    // {r1,c1,r2,c2} 拖选范围（2+格时有效）
  cellEdits: {},          // 'sheetIdx!row!col' -> newValue 编辑缓存
  cellFormats: {},        // 'sheetIdx!row!col' -> {bold,italic,align,fontSize,fontName} 格式缓存
  rowHeights: {},         // 'sheetIdx!row' -> height(px) 行高缓存
  insertedRows: {},       // 'sheetIdx!row' -> true 标记插入的空行
  _stickyDecimal: 2,    // 用户上次设置的小数位（粘性，切换单元格不重置）
  _stickyPercent: false, // 用户上次设置的百分比状态（粘性）
  previewMode: false,     // 是否为预览模式（显示计算值）
};
// ---- 公式解析 ----
// 单公式精确匹配（向后兼容）
const NZ_FORMULA_RE = /^\{\{(.+?)\}\}$/;
// 全局查找所有 {{...}} 的正则（用于多公式表达式）
const NZ_FORMULA_GLOBAL_RE = /\{\{.+?\}\}/g;
// 匹配文本中嵌入的 =SUM(...) 或 =AVG(...)（内联函数）
const NZ_INLINE_FUNC_RE = /=\s*(SUM|AVG)\s*\(([^)]+)\)/gi;
// 匹配 SUM(...) 或 AVG(...) 函数调用（纯函数，无 = 前缀）
const NZ_FUNC_RE = /\b(SUM|AVG)\s*\(([^)]+)\)/gi;
// 判断单元格值是否包含至少一个公式
function nzHasFormula(val) { return /\{\{.+?\}\}/.test(val) || nzIsExpression(val) || /=\s*(SUM|AVG)\s*\(/i.test(val); }
// 判断是否为纯公式表达式（以 = 开头或仅一个 {{...}}）
function nzIsExpression(val) { return String(val).startsWith('='); }

/**
 * 格式化数值：按 decimal 精度四舍五入 + 百分比
 * 百分比模式：值 * 100 后保留 decimal 位小数并追加 % 号
 * 例：0.8205 + {percent:true, decimal:2} → "82.05%"
 * @param {number} value - 原始数值（比率形式）
 * @param {object} fmt - 格式对象 { decimal: 2, percent: false }
 * @returns {string} 格式化后的字符串
 */
function nzFormatValue(value, fmt) {
  if (value == null || isNaN(value)) return String(value);
  const decimal = fmt?.decimal != null ? fmt.decimal : 2;
  const isPercent = fmt?.percent || false;
  let v = Number(value);
  if (isPercent) v = v * 100;
  const factor = Math.pow(10, decimal);
  const rounded = Math.round(v * factor) / factor;
  let str = decimal > 0 ? rounded.toFixed(decimal) : String(Math.round(rounded));
  if (isPercent) str += '%';
  return str;
}

// ---- 单元格引用解析 ----
// 匹配单元格引用: A1, B2, AA10 等（列字母+行号），但排除 {{...}} 内部内容
const NZ_CELL_REF_RE = /\b([A-Z]{1,3})(\d{1,5})\b/g;
// 匹配单元格范围: A1:B5
const NZ_RANGE_RE = /\b([A-Z]{1,3})(\d{1,5}):([A-Z]{1,3})(\d{1,5})\b/g;

/**
 * 将范围引用（如 A1:B5）展开为所有单元格的值
 * @returns {{ values: number[], ok: boolean }}
 */
function nzResolveRange(rangeStr, sheetIdx, visitedRefs, statsData) {
  if (!visitedRefs) visitedRefs = new Set();
  const _sd = statsData || nzComputeStats();
  const values = [];
  // 按逗号分割多个范围/引用
  const parts = rangeStr.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    // 判断是范围 (A1:B5) 还是单个引用 (A1)
    const rangeMatch = trimmed.match(/^([A-Z]{1,3})(\d{1,5}):([A-Z]{1,3})(\d{1,5})$/);
    if (rangeMatch) {
      const col1 = XLSX.utils.decode_col(rangeMatch[1]);
      const row1 = parseInt(rangeMatch[2]) - 1;
      const col2 = XLSX.utils.decode_col(rangeMatch[3]);
      const row2 = parseInt(rangeMatch[4]) - 1;
      const minR = Math.min(row1, row2), maxR = Math.max(row1, row2);
      const minC = Math.min(col1, col2), maxC = Math.max(col1, col2);
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          const refKey = `${sheetIdx}!${r}!${c}`;
          if (visitedRefs.has(refKey)) continue; // 跳过循环引用
          visitedRefs.add(refKey);
          let val = nzGetCellDisplayValue(sheetIdx, r, c);
          const valStr = String(val);
          if (nzHasFormula(valStr)) {
            const inner = nzResolveCellFormula(valStr, _sd, sheetIdx);
            val = inner.ok ? inner.value : NaN;
          }
          const num = parseFloat(val);
          if (!isNaN(num)) values.push(num);
        }
      }
    } else {
      // 单个单元格引用
      const cellMatch = trimmed.match(/^([A-Z]{1,3})(\d{1,5})$/);
      if (cellMatch) {
        const col = XLSX.utils.decode_col(cellMatch[1]);
        const row = parseInt(cellMatch[2]) - 1;
        const refKey = `${sheetIdx}!${row}!${col}`;
        if (!visitedRefs.has(refKey)) {
          visitedRefs.add(refKey);
          let val = nzGetCellDisplayValue(sheetIdx, row, col);
          const valStr = String(val);
          if (nzHasFormula(valStr)) {
            const inner = nzResolveCellFormula(valStr, _sd, sheetIdx);
            val = inner.ok ? inner.value : NaN;
          }
          const num = parseFloat(val);
          if (!isNaN(num)) values.push(num);
        }
      }
    }
  }
  return { values, ok: values.length > 0 };
}

/**
 * 获取当前表格中某个单元格的显示值（优先编辑缓存，否则原始值）
 */
function nzGetCellDisplayValue(sheetIdx, row, col) {
  if (!NZ.wb) return 0;
  const editKey = `${sheetIdx}!${row}!${col}`;
  if (NZ.cellEdits[editKey] !== undefined) {
    return NZ.cellEdits[editKey];
  }
  const ws = NZ.wb.Sheets[NZ.wb.SheetNames[sheetIdx]];
  if (!ws) return 0;
  const ref = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = ws[ref];
  if (!cell || cell.v == null) return 0;
  return cell.v;
}

/**
 * 解析表达式中的单元格引用，替换为实际数值
 * @param {string} expr - 表达式（不含=前缀）
 * @param {number} sheetIdx - 当前sheet索引
 * @param {Set} visitedRefs - 已访问引用（防止循环引用）
 * @returns {{resolved: string, ok: boolean}}
 */
function nzResolveCellRefs(expr, sheetIdx, visitedRefs, statsData) {
  if (!visitedRefs) visitedRefs = new Set();
  const _sd = statsData || nzComputeStats();
  let allOk = true;
  const resolved = expr.replace(NZ_CELL_REF_RE, (match, colStr, rowStr) => {
    // 注意：调用前 {{...}} 已被上层 nzEvalExpression 替换为数值，此处仅处理纯单元格引用
    const col = XLSX.utils.decode_col(colStr);
    const row = parseInt(rowStr) - 1; // Excel行号从1开始
    if (row < 0 || col < 0) return match;
    const refKey = `${sheetIdx}!${row}!${col}`;
    // 防循环引用
    if (visitedRefs.has(refKey)) { allOk = false; return 'NaN'; }
    visitedRefs.add(refKey);
    let val = nzGetCellDisplayValue(sheetIdx, row, col);
    // 如果被引用单元格包含任何公式（=表达式 或 {{...}}纯公式 或混合文本），递归解析
    const valStr = String(val);
    if (nzHasFormula(valStr)) {
      const innerResult = nzResolveCellFormula(valStr, _sd, sheetIdx);
      if (innerResult.ok) {
        val = innerResult.value;
      } else {
        allOk = false;
        return 'NaN';
      }
    }
    const num = parseFloat(val);
    if (isNaN(num)) { allOk = false; return 'NaN'; }
    return String(num);
  });
  return { resolved, ok: allOk };
}

/**
 * 完整计算一个 = 开头的表达式（含单元格引用+{{}}公式+SUM/AVG函数）
 */
function nzEvalExpression(cellVal, sheetIdx, visitedRefs) {
  if (!nzIsExpression(cellVal)) return { ok: false, value: cellVal };
  if (!visitedRefs) visitedRefs = new Set();
  let expr = cellVal.substring(1); // 去掉 = 前缀
  const statsData = nzComputeStats();
  const si = sheetIdx != null ? sheetIdx : NZ.activeSheet;

  // 1. 先替换 {{...}} 公式为数值
  let allOk = true;
  expr = expr.replace(NZ_FORMULA_GLOBAL_RE, (match) => {
    const parsed = nzParseFormula(match);
    if (!parsed) { allOk = false; return 'NaN'; }
    const result = nzResolveFormula(parsed, statsData);
    if (!result.ok) { allOk = false; return 'NaN'; }
    return String(result.value);
  });
  if (!allOk) return { ok: false, value: cellVal };

  // 2. 替换 SUM(...)/AVG(...) 函数为数值
  expr = expr.replace(NZ_FUNC_RE, (match, funcName, argsStr) => {
    const { values, ok } = nzResolveRange(argsStr, si, visitedRefs, statsData);
    if (!ok) { allOk = false; return 'NaN'; }
    const fn = funcName.toUpperCase();
    if (fn === 'SUM') {
      const sum = values.reduce((a, b) => a + b, 0);
      return String(sum);
    } else if (fn === 'AVG') {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      return String(avg);
    }
    allOk = false;
    return 'NaN';
  });
  if (!allOk) return { ok: false, value: cellVal };

  // 3. 再替换单元格引用为数值
  const refResult = nzResolveCellRefs(expr, si, visitedRefs, statsData);
  if (!refResult.ok) return { ok: false, value: cellVal };

  // 4. 安全计算算术表达式（支持括号优先级）
  const safeExpr = refResult.resolved.replace(/[^0-9+\-*/().eE\s]/g, '');
  if (!safeExpr.trim()) return { ok: false, value: '计算错误' };
  const numResult = nzSafeArith(safeExpr);
  if (typeof numResult === 'number' && isFinite(numResult)) {
    return { ok: true, value: numResult };
  }
  return { ok: false, value: '计算错误' };
}

function nzParseFormula(str) {
  const m = String(str).match(NZ_FORMULA_RE);
  if (!m) return null;
  const inner = m[1].trim();
  const slashIdx = inner.lastIndexOf('/');
  if (slashIdx < 0) return null;
  const metric = inner.substring(slashIdx + 1).trim();
  const path = inner.substring(0, slashIdx).trim();
  const parts = path.split(':').map(p => p.trim());
  // 格式: {{文件序号:L1:entryName:col/指标}} 或 {{文件序号::entryName/指标}}
  // 兼容旧格式: {{文件序号:L1:L2/指标}} 或 {{文件序号:总合计/指标}}
  let fileIdx, l1 = '', l2 = '', col = '';
  if (parts.length >= 1) fileIdx = parseInt(parts[0], 10);
  if (isNaN(fileIdx) || fileIdx < 1) return null;

  if (parts.length === 2) {
    // {{1:总合计/指标}} 或 {{1:entryName/指标}}
    l2 = parts[1];
  } else if (parts.length === 3) {
    // {{1:L1:entryName/指标}} 或 {{1::entryName/指标}}
    l1 = parts[1]; l2 = parts[2];
  } else if (parts.length === 4) {
    // {{1:L1:entryName:col/指标}} 或 {{1::entryName:col/指标}}
    l1 = parts[1]; l2 = parts[2]; col = parts[3];
  } else if (parts.length >= 5) {
    // 兼容旧多级格式: {{fileIdx:L1:L1Sub:L2:L3:...:col/metric}}
    // 判断是否旧格式：parts[2]在L1的values中则为旧格式L1Sub
    const fi2 = fileIdx - 1;
    const file2 = S.files && S.files[fi2];
    let isOldFormat = false;
    if (file2 && parts[1]) {
      const l1g = file2.grps && file2.grps.find(g => g.level === 1 && g.name === parts[1]);
      if (l1g) {
        const l1Values = l1g.values || [];
        if (l1Values.includes(parts[2]) || parts[2] === '') {
          isOldFormat = true;
        }
      }
    }
    if (isOldFormat) {
      // 旧格式: 拼接parts[3..N-1]为entryName，最后一段可能是col
      l1 = parts[1];
      const remaining = parts.slice(2);  // L1Sub + L2 + L3 + ... + col
      // 最后一段如果包含.或在表头中，则为col
      let colIdx = -1;
      for (let i = remaining.length - 1; i >= 1; i--) {
        if (remaining[i] && (remaining[i].includes('.') || _nzLooksLikeCol(remaining[i], file2))) {
          colIdx = i; break;
        }
      }
      if (colIdx >= 0) {
        col = remaining[colIdx];
        l2 = remaining.slice(0, colIdx).join(' · ');
      } else {
        l2 = remaining.join(' · ');
      }
    } else {
      // 更旧的多级格式: {{fileIdx:L1:L2:L3:...:col/metric}}
      l1 = parts[1]; l2 = parts[2];
      const remaining = parts.slice(3);
      let colIdx = -1;
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (remaining[i] && (remaining[i].includes('.') || _nzLooksLikeCol(remaining[i], file2))) {
          colIdx = i; break;
        }
      }
      if (colIdx >= 0) {
        col = remaining[colIdx];
        const lvls = remaining.slice(0, colIdx);
        if (lvls.length) l2 += ' · ' + lvls.join(' · ');
      } else {
        if (remaining.length) l2 += ' · ' + remaining.join(' · ');
      }
    }
  }

  // 解析附加列.值
  let acCol, acVal;
  if (col && col.includes('.')) {
    const dp = col.split('.');
    acCol = dp[0];
    acVal = dp.slice(1).join('.');
    col = acCol;
  }
  return { fileIdx, l1, l2, col: col || '', metric, acCol, acVal };
}

/** 辅助函数：判断一个字符串是否像列名（在文件表头中存在） */
function _nzLooksLikeCol(name, file) {
  if (!file || !file.hdr) return false;
  return file.hdr.includes(name);
}

function nzBuildFormula(p) {
  // 格式: {{fileIdx:L1:entryName/指标}} 或 {{fileIdx::entryName/指标}}（无L1用:占位）
  // entryName可以是简单名（如"重点项"）或·分隔路径（如"重点项·核心项"、"子项·重点项·核心项"）
  let inner = p.fileIdx;
  inner += ':' + (p.l1 || '');  // L1，可能为空
  inner += ':' + (p.l2 || '');  // entryName（直接匹配entry.name）
  if (p.col) {
    if (p.acVal) inner += ':' + p.col + '.' + p.acVal;
    else inner += ':' + p.col;
  }
  inner += '/' + p.metric;
  return '{{' + inner + '}}';
}

// ---- 多公式表达式解析与计算 ----
/**
 * 解析单元格值中的所有公式并计算结果
 * 支持四种模式：
 * 1. 纯公式：{{1:高新:重点项/数量}} → 返回数值
 * 2. 表达式（含单元格引用和{{}}）：=A1+B2*3 或 ={{1:L1:L2/数量}}+A1
 * 3. 混合文本：合计: {{1:高新:重点项/数量}} 项 → 替换公式为数值，保留文本
 * 4. 纯单元格引用：=A1+B2 → 引用其他单元格值计算
 */
function nzResolveCellFormula(cellVal, statsData, sheetIdx) {
  if (!nzHasFormula(cellVal)) return { ok: false, value: cellVal };

  // = 开头的表达式（支持单元格引用 + {{}} 混合）
  if (nzIsExpression(cellVal)) {
    return nzEvalExpression(cellVal, sheetIdx);
  }

  // 单公式模式
  if (NZ_FORMULA_RE.test(cellVal)) {
    const parsed = nzParseFormula(cellVal);
    if (!parsed) return { ok: false, value: cellVal };
    return nzResolveFormula(parsed, statsData);
  }

  // 混合文本模式：替换所有 {{...}} 为数值
  let anyFail = false;
  let textResult = cellVal.replace(NZ_FORMULA_GLOBAL_RE, (match) => {
    const parsed = nzParseFormula(match);
    if (!parsed) { anyFail = true; return match; }
    const result = nzResolveFormula(parsed, statsData);
    if (!result.ok) { anyFail = true; return match; }
    return String(result.value);
  });

  // 内联函数模式：替换文本中的 =SUM(...) / =AVG(...) 为计算值
  textResult = textResult.replace(NZ_INLINE_FUNC_RE, (match, funcName, argsStr) => {
    const si = sheetIdx != null ? sheetIdx : NZ.activeSheet;
    const { values, ok } = nzResolveRange(argsStr, si, null, statsData);
    if (!ok) { anyFail = true; return match; }
    const fn = funcName.toUpperCase();
    let computed;
    if (fn === 'SUM') {
      computed = values.reduce((a, b) => a + b, 0);
    } else if (fn === 'AVG') {
      computed = values.reduce((a, b) => a + b, 0) / values.length;
    } else {
      anyFail = true;
      return match;
    }
    // 保留原始小数精度
    return Number.isInteger(computed) ? String(computed) : String(parseFloat(computed.toFixed(10)));
  });

  return { ok: !anyFail, value: textResult };
}

// ---- 统计数据计算 (简化版：直接用 column+values 匹配) ----
function nzComputeStats() {
  const result = {}; // fileIdx -> { entries: [], l1Groups: [], total: {} }
  S.files.forEach((file, fi) => {
    if (!file.raw.length) return;
    const fileIdx = fi + 1;
    const sumCol = file.sumCol || '';
    let l1Data = getFilteredData_forFile(file);
    const splitRows = getSplitMatchForFile(file);
    if (splitRows && splitRows.size > 0) {
      l1Data = filterBySplitMatch(l1Data, file);
    }
    const ctxCache = {};
    const entries = [];
    const l1Groups = file.grps.filter(g => g.level === 1 && g.childGroupIds && g.childGroupIds.length);
    const l1Entries = {};
    const standaloneEntries = [];

    // 构建L1子分组ID集合
    const l1ChildSet = new Set();
    l1Groups.forEach(l1g => { (l1g.childGroupIds || []).forEach(cid => l1ChildSet.add(cid)); });

    // 遍历所有2级+分组
    file.grps.forEach(g => {
      if (g.level === 1) return; // 跳过1级分组
      if (g._unmatched) return; // 跳过未匹配分组（公式系统不处理）

      const parentIds = g.parentIds && g.parentIds.length ? g.parentIds : (g.parentId ? [g.parentId] : []);
      const parentRels = g.parentRels && g.parentRels.length ? g.parentRels : (g.parentRel ? [g.parentRel] : []);
      const ownerL1 = l1Groups.find(l1 => l1.childGroupIds && l1.childGroupIds.includes(g.id));

      // L3+分组：与L2每项相交展示，名称为完整层级路径
      if (g.level >= 3) {
        const ctx = getGroupContext(g.id, l1Data, file.grps, ctxCache);
        const pathParts = getGroupPath(g.id, file.grps);
        const fullName = pathParts.join(' · ');
        const parentGrp = file.grps.find(x => x.id === g.parentId);
        const depInfo = parentGrp ? `${g.level}级→${parentGrp.name}` : `${g.level}级`;
        // 查找所有祖先L1分组
        const ancestorL1s = findAncestorL1s(g.id, file.grps, l1Groups);
        const entry = {
          name: fullName, isGroup: true, column: g.column, count: ctx.length,
          pct: l1Data.length > 0 ? (ctx.length / l1Data.length * 100).toFixed(1) : '0',
          depInfo, _ctx: ctx, level: g.level,
          l1Name: '', l1Id: null,
          crossItems: [], l1Subtotals: []
        };
        if (sumCol) entry.sum = ctx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
        file.addedCols.forEach(ac => {
          const tc = {}; ctx.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; });
          entry['ac_' + ac] = tc;
        });

        // 对每个祖先L1生成交叉项
        ancestorL1s.forEach(ancL1 => {
          if (ancL1.childGroupIds && ancL1.childGroupIds.length) {
            const l1SubtotalRows = new Set();
            ancL1.childGroupIds.forEach(cid => {
              const cg = file.grps.find(x => x.id === cid);
              if (!cg) return;
              const childCtx = getGroupContext(cid, l1Data, file.grps, ctxCache);
              const childSet = new Set(childCtx);
              const crossCtx = ctx.filter(r => childSet.has(r));
              crossCtx.forEach(r => l1SubtotalRows.add(r));
              const parentName = parentGrp ? parentGrp.name : '?';
              const crossEntry = {
                name: `${cg.name} · ${parentName} · ${g.name}`, isGroup: true, column: g.column,
                count: crossCtx.length,
                pct: l1Data.length > 0 ? (crossCtx.length / l1Data.length * 100).toFixed(1) : '0',
                depInfo: `AND→${ancL1.name}.${cg.name}`, l1Name: ancL1.name, l1Id: ancL1.id,
                isL1Cross: true, _ctx: crossCtx
              };
              if (sumCol) crossEntry.sum = crossCtx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
              file.addedCols.forEach(ac => {
                const tc = {}; crossCtx.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; });
                crossEntry['ac_' + ac] = tc;
              });
              entry.crossItems.push(crossEntry);
            });
            // L1小计
            const subRows = [...l1SubtotalRows];
            const subtotal = {
              name: `${fullName} · ${ancL1.name} 小计`, isL1Subtotal: true, isGroup: true, l1Name: ancL1.name, l1Id: ancL1.id,
              count: subRows.length, pct: l1Data.length > 0 ? (subRows.length / l1Data.length * 100).toFixed(1) : '0',
              _ctx: subRows
            };
            if (sumCol) subtotal.sum = subRows.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
            entry.l1Subtotals.push(subtotal);
          }
        });

        // 分发到l1Entries或standaloneEntries
        if (ancestorL1s.length) {
          // 分发交叉项和小计到各自L1
          entry.crossItems.forEach(ce => {
            if (!l1Entries[ce.l1Id]) l1Entries[ce.l1Id] = [];
            l1Entries[ce.l1Id].push(ce);
          });
          entry.l1Subtotals.forEach(st => {
            if (!l1Entries[st.l1Id]) l1Entries[st.l1Id] = [];
            l1Entries[st.l1Id].push(st);
          });
          // 为每个L1创建带l1Name的entry副本
          ancestorL1s.forEach(l1 => {
            if (!l1Entries[l1.id]) l1Entries[l1.id] = [];
            const copy = Object.assign({}, entry, { l1Name: l1.name, l1Id: l1.id, isL1Copy: true });
            delete copy.crossItems;
            delete copy.l1Subtotals;
            l1Entries[l1.id].push(copy);
          });
        } else {
          standaloneEntries.push(entry);
        }
        return;
      }

      if (parentIds.length > 0) {
        const hasL1Parent = parentIds.some(pid => {
          const pg = file.grps.find(x => x.id === pid);
          return pg && pg.level === 1;
        });
        const hasChainedL2Parent = ownerL1 && parentIds.some(pid => {
          return ownerL1.childGroupIds && ownerL1.childGroupIds.includes(pid);
        });

        if (hasL1Parent) {
          // 依托L1分组
          if (!ownerL1) {
            // 未被L1的childGroupIds收纳，但parentIds中有L1（通过依赖关系）
            const totalCtx = getGroupContext(g.id, l1Data, file.grps, ctxCache);
            const parentNames = parentIds.map(pid => { const pg = file.grps.find(x => x.id === pid); return pg ? pg.name : '?'; });
            const depLabel = parentRels.map((r, i) => `${r || 'AND'}→${parentNames[i]}`).join(' ');
            const totalEntry = {
              name: g.name, isGroup: true, column: g.column, count: totalCtx.length,
              pct: l1Data.length > 0 ? (totalCtx.length / l1Data.length * 100).toFixed(1) : '0',
              depInfo: depLabel, _ctx: totalCtx, crossItems: []
            };
            if (sumCol) totalEntry.sum = totalCtx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
            file.addedCols.forEach(ac => {
              const tc = {}; totalCtx.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; });
              totalEntry['ac_' + ac] = tc;
            });
            parentIds.forEach((pid, pi) => {
              const pg = file.grps.find(x => x.id === pid);
              if (!pg || pg.level !== 1) return;
              const rel = parentRels[pi] || 'AND';
              const l1SubtotalRows = new Set();
              if (pg.childGroupIds && pg.childGroupIds.length) {
                pg.childGroupIds.forEach(cid => {
                  const cg = file.grps.find(x => x.id === cid);
                  if (!cg) return;
                  const childCtx = getGroupContext(cid, l1Data, file.grps, ctxCache);
                  const valSet = getGroupValues(g);
                  const selfMatch = l1Data.filter(r => valSet.has(String(r[g.column] ?? '').trim()));
                  let ctx;
                  if (rel === 'AND') { const ps = new Set(childCtx); ctx = selfMatch.filter(r => ps.has(r)); }
                  else { const seen = new Set(); ctx = []; [...childCtx, ...selfMatch].forEach(r => { if (!seen.has(r)) { seen.add(r); ctx.push(r); } }); }
                  ctx.forEach(r => l1SubtotalRows.add(r));
                  const crossEntry = {
                    name: `${cg.name} · ${g.name}`, isGroup: true, column: g.column, count: ctx.length,
                    pct: l1Data.length > 0 ? (ctx.length / l1Data.length * 100).toFixed(1) : '0',
                    depInfo: `${rel}→${pg.name}.${cg.name}`, indent: 1, l1Name: pg.name, l1Id: pg.id, isL1Cross: true, _ctx: ctx
                  };
                  if (sumCol) crossEntry.sum = ctx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
                  file.addedCols.forEach(ac => { const tc = {}; ctx.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; }); crossEntry['ac_' + ac] = tc; });
                  totalEntry.crossItems.push(crossEntry);
                  l1Entries[pg.id].push(crossEntry);
                });
              }
              // 为该L1生成小计
              const subRows = [...l1SubtotalRows];
              const subtotal = {
                name: `${g.name} · ${pg.name} 小计`, isL1Subtotal: true, isGroup: true, l1Name: pg.name, l1Id: pg.id,
                count: subRows.length, pct: l1Data.length > 0 ? (subRows.length / l1Data.length * 100).toFixed(1) : '0',
                _ctx: subRows
              };
              if (sumCol) subtotal.sum = subRows.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
              if (!l1Entries[pg.id]) l1Entries[pg.id] = [];
              l1Entries[pg.id].push(subtotal);
            });
            // 为每个L1父分组创建带l1Name的totalEntry副本
            parentIds.forEach(pid => {
              const pg = file.grps.find(x => x.id === pid);
              if (!pg || pg.level !== 1) return;
              if (!l1Entries[pg.id]) l1Entries[pg.id] = [];
              const copy = Object.assign({}, totalEntry, { l1Name: pg.name, l1Id: pg.id, isL1Copy: true });
              delete copy.crossItems;
              l1Entries[pg.id].push(copy);
            });
            // standalone显示用：清空已分发的crossItems避免allEntries展平时重复
            totalEntry.crossItems = [];
            standaloneEntries.push(totalEntry);
          } else {
            // 已被纳入L1：交叉entry + totalEntry自身放入对应L1的entries中
            const totalCtx = getGroupContext(g.id, l1Data, file.grps, ctxCache);
            const parentNames = parentIds.map(pid => { const pg = file.grps.find(x => x.id === pid); return pg ? pg.name : '?'; });
            const depLabel = parentRels.map((r, i) => `${r || 'AND'}→${parentNames[i]}`).join(' ');
            const totalEntry = {
              name: g.name, isGroup: true, column: g.column, count: totalCtx.length,
              pct: l1Data.length > 0 ? (totalCtx.length / l1Data.length * 100).toFixed(1) : '0',
              depInfo: depLabel, _ctx: totalCtx, crossItems: [], l1Subtotals: []
            };
            if (sumCol) totalEntry.sum = totalCtx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
            file.addedCols.forEach(ac => {
              const tc = {}; totalCtx.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; });
              totalEntry['ac_' + ac] = tc;
            });
            parentIds.forEach((pid, pi) => {
              const pg = file.grps.find(x => x.id === pid);
              if (!pg || pg.level !== 1) return;
              const rel = parentRels[pi] || 'AND';
              const l1SubtotalRows = new Set();
              if (pg.childGroupIds && pg.childGroupIds.length) {
                pg.childGroupIds.forEach(cid => {
                  const cg = file.grps.find(x => x.id === cid);
                  if (!cg) return;
                  const childCtx = getGroupContext(cid, l1Data, file.grps, ctxCache);
                  const valSet = getGroupValues(g);
                  const selfMatch = l1Data.filter(r => valSet.has(String(r[g.column] ?? '').trim()));
                  let ctx;
                  if (rel === 'AND') { const ps = new Set(childCtx); ctx = selfMatch.filter(r => ps.has(r)); }
                  else { const seen = new Set(); ctx = []; [...childCtx, ...selfMatch].forEach(r => { if (!seen.has(r)) { seen.add(r); ctx.push(r); } }); }
                  ctx.forEach(r => l1SubtotalRows.add(r));
                  const entry = {
                    name: `${cg.name} · ${g.name}`, isGroup: true, column: g.column, count: ctx.length,
                    pct: l1Data.length > 0 ? (ctx.length / l1Data.length * 100).toFixed(1) : '0',
                    depInfo: `${rel}→${pg.name}.${cg.name}`, l1Name: pg.name, l1Id: pg.id, isL1Cross: true, _ctx: ctx
                  };
                  if (sumCol) entry.sum = ctx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
                  file.addedCols.forEach(ac => {
                    const tc = {}; ctx.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; });
                    entry['ac_' + ac] = tc;
                  });
                  if (!l1Entries[pg.id]) l1Entries[pg.id] = [];
                  l1Entries[pg.id].push(entry);
                  totalEntry.crossItems.push(entry);
                });
              }
              // 为该L1生成小计
              const subRows = [...l1SubtotalRows];
              const subtotal = {
                name: `${g.name} · ${pg.name} 小计`, isL1Subtotal: true, isGroup: true, l1Name: pg.name, l1Id: pg.id,
                count: subRows.length, pct: l1Data.length > 0 ? (subRows.length / l1Data.length * 100).toFixed(1) : '0',
                _ctx: subRows
              };
              if (sumCol) subtotal.sum = subRows.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
              if (!l1Entries[pg.id]) l1Entries[pg.id] = [];
              l1Entries[pg.id].push(subtotal);
            });
            // 推送totalEntry自身
            if (!l1Entries[ownerL1.id]) l1Entries[ownerL1.id] = [];
            totalEntry.l1Name = ownerL1.name;
            totalEntry.l1Id = ownerL1.id;
            l1Entries[ownerL1.id].push(totalEntry);
          }
          return;
        } else if (hasChainedL2Parent && ownerL1) {
          // 链式子分组
          const ctx = getGroupContext(g.id, l1Data, file.grps, ctxCache);
          const parentNames = parentIds.map(pid => { const pg = file.grps.find(x => x.id === pid); return pg ? pg.name : '?'; });
          const relLabel = parentRels.map((r, i) => `${r || 'AND'}→${parentNames[i]}`).join(' ');
          const entry = {
            name: g.name, isGroup: true, column: g.column, count: ctx.length,
            pct: l1Data.length > 0 ? (ctx.length / l1Data.length * 100).toFixed(1) : '0',
            depInfo: `链式: ${relLabel}`, l1Name: ownerL1.name, l1Id: ownerL1.id,
            isChained: true, _ctx: ctx
          };
          if (sumCol) entry.sum = ctx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
          file.addedCols.forEach(ac => {
            const tc = {}; ctx.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; });
            entry['ac_' + ac] = tc;
          });
          if (!l1Entries[ownerL1.id]) l1Entries[ownerL1.id] = [];
          l1Entries[ownerL1.id].push(entry);
          return;
        } else {
          // 普通L2→L2依赖（跨L1或独立）
          const ctx = getGroupContext(g.id, l1Data, file.grps, ctxCache);
          const parentNames = parentIds.map(pid => { const pg = file.grps.find(x => x.id === pid); return pg ? pg.name : '?'; });
          const depLabel = parentRels.map((r, i) => `${r || 'AND'}→${parentNames[i]}`).join(' ');
          const entry = {
            name: g.name, isGroup: true, column: g.column, count: ctx.length,
            pct: l1Data.length > 0 ? (ctx.length / l1Data.length * 100).toFixed(1) : '0',
            depInfo: depLabel, _ctx: ctx
          };
          if (sumCol) entry.sum = ctx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
          file.addedCols.forEach(ac => {
            const tc = {}; ctx.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; });
            entry['ac_' + ac] = tc;
          });
          standaloneEntries.push(entry);
          return;
        }
      }

      // 无依赖的普通分组
      const ctx = getGroupContext(g.id, l1Data, file.grps, ctxCache);
      // 找到所有包含此分组的L1分组（支持一个分组属于多个L1）
      const ownerL1s = l1Groups.filter(l1 => l1.childGroupIds && l1.childGroupIds.includes(g.id));
      if (ownerL1s.length) {
        ownerL1s.forEach(ownerL1 => {
          const isChained = isChainedChild(g, ownerL1, file.grps);
          const depInfo = isChained ? `链式:${ownerL1.name}` : `L1:${ownerL1.name}`;
          const entry = {
            name: g.name, isGroup: true, column: g.column, count: ctx.length,
            pct: l1Data.length > 0 ? (ctx.length / l1Data.length * 100).toFixed(1) : '0',
            depInfo, l1Name: ownerL1.name, l1Id: ownerL1.id,
            isChained, _ctx: ctx
          };
          if (sumCol) entry.sum = ctx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
          file.addedCols.forEach(ac => {
            const tc = {}; ctx.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; });
            entry['ac_' + ac] = tc;
          });
          if (!l1Entries[ownerL1.id]) l1Entries[ownerL1.id] = [];
          l1Entries[ownerL1.id].push(entry);
        });
      } else {
        const entry = {
          name: g.name, isGroup: true, column: g.column, count: ctx.length,
          pct: l1Data.length > 0 ? (ctx.length / l1Data.length * 100).toFixed(1) : '0',
          depInfo: '(独立)', l1Name: '', l1Id: null,
          isChained: false, _ctx: ctx
        };
        if (sumCol) entry.sum = ctx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
        file.addedCols.forEach(ac => {
          const tc = {}; ctx.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; });
          entry['ac_' + ac] = tc;
        });
        standaloneEntries.push(entry);
      }
    });

    // L1合计行（排除链式子分组和交叉项，避免重复计数）
    l1Groups.forEach(l1g => {
      const chainedIds = getChainedChildIds(l1g, file.grps);
      // 聚合独立子分组的ctx（去重，跳过链式子分组和交叉项）
      const l1Rows = new Set();
      (l1Entries[l1g.id] || []).forEach(e => {
        if (e.isChained || e.isL1Cross) return; // 跳过链式子分组和交叉项
        if (e._ctx) e._ctx.forEach(r => l1Rows.add(r));
      });
      const l1r = [...l1Rows];
      const l1entry = {
        name: `${l1g.name} 合计`,
        isL1Total: true,
        l1Name: l1g.name,
        l1Id: l1g.id,
        count: l1r.length,
        pct: l1Data.length > 0 ? (l1r.length / l1Data.length * 100).toFixed(1) : '0',
        sum: sumCol ? l1r.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0) : null,
        _ctx: l1r
      };
      file.addedCols.forEach(ac => {
        const tc = {};
        l1r.forEach(r => { const v = String(r[ac] ?? ''); tc[v] = (tc[v] || 0) + 1; });
        l1entry['ac_' + ac] = tc;
      });
      if (!l1Entries[l1g.id]) l1Entries[l1g.id] = [];
      l1Entries[l1g.id].push(l1entry);
    });

    // 总合计：所有L2分组ctx的并集（确保合计=分组之和）
    const nzAllGroupRows = new Set();
    file.grps.forEach(g => {
      if (g.level === 1 || g._unmatched) return;
      getGroupContext(g.id, l1Data, file.grps, ctxCache).forEach(r => nzAllGroupRows.add(r));
    });
    const nzCovered = [...nzAllGroupRows];
    const total = {
      name: '合计',
      isTotal: true,
      count: nzCovered.length,
      pct: l1Data.length > 0 ? (nzCovered.length / l1Data.length * 100).toFixed(1) : '0',
      sum: sumCol ? nzCovered.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0) : null,
      _ctx: nzCovered
    };

    // 汇总entries（展平所有交叉项）
    const allEntries = [];
    l1Groups.forEach(l1g => {
      if (l1Entries[l1g.id]) allEntries.push(...l1Entries[l1g.id]);
    });
    standaloneEntries.forEach(e => {
      // 展平独立分组的crossItems和l1Subtotals
      if (e.crossItems) e.crossItems.forEach(ce => allEntries.push(ce));
      if (e.l1Subtotals) e.l1Subtotals.forEach(st => allEntries.push(st));
      allEntries.push(e);
    });

    result[fileIdx] = { entries: allEntries, l1Groups, total, file, l1Data };
  });
  return result;
}

// ---- 公式匹配与取值 ----
function nzResolveFormula(parsed, statsData) {
  const { fileIdx, l1, l2, col, metric, acCol, acVal } = parsed;
  const fd = statsData[fileIdx];
  if (!fd) return { ok: false, value: '未匹配(文件不存在)' };
  const { entries, total, file, l1Data } = fd;

  // 总合计
  if (l2 === '总合计' || (!l1 && l2 === '总合计')) {
    return nzResolveMetric(total, col, metric, file, l1Data, acCol, acVal);
  }

  // L1合计
  if (l1 && l2 === '合计') {
    const l1Total = entries.find(e => e.isL1Total && e.l1Name === l1);
    if (!l1Total) return { ok: false, value: '未匹配' };
    return nzResolveMetric(l1Total, col, metric, file, l1Data, acCol, acVal);
  }

  // 按 entry.name 直接匹配（l2就是entry.name）
  let entry;
  if (l1) {
    entry = entries.find(e => e.isGroup && e.l1Name === l1 && e.name === l2);
  } else {
    entry = entries.find(e => e.isGroup && !e.l1Name && e.name === l2);
  }
  if (!entry) return { ok: false, value: '未匹配' };
  return nzResolveMetric(entry, col, metric, file, l1Data, acCol, acVal);
}

function nzResolveMetric(entry, col, metric, file, l1Data, acCol, acVal) {
  if (metric === '数量') {
    if (acCol && acVal) {
      const tc = entry['ac_' + acCol];
      if (!tc) return { ok: false, value: '未匹配(附加列)' };
      return { ok: true, value: tc[acVal] || 0 };
    }
    return { ok: true, value: entry.count };
  }
  if (metric === '占比') {
    return { ok: true, value: parseFloat(entry.pct) };
  }
  if (metric === '求和') {
    const targetCol = col || file.sumCol;
    if (!targetCol) return { ok: false, value: '未匹配(无求和列)' };
    if (col && col !== file.sumCol && entry._ctx) {
      const sum = entry._ctx.reduce((a, r) => a + (parseFloat(r[targetCol]) || 0), 0);
      return { ok: true, value: parseFloat(sum.toFixed(2)) };
    }
    return { ok: true, value: entry.sum != null ? parseFloat(entry.sum.toFixed(2)) : 0 };
  }
  if (metric === '均值') {
    const targetCol = col || file.sumCol;
    if (!targetCol) return { ok: false, value: '未匹配(无求和列)' };
    if (!entry._ctx || entry._ctx.length === 0) return { ok: true, value: 0 };
    const sum = entry._ctx.reduce((a, r) => a + (parseFloat(r[targetCol]) || 0), 0);
    return { ok: true, value: parseFloat((sum / entry._ctx.length).toFixed(2)) };
  }
  return { ok: false, value: '未匹配(指标)' };
}
