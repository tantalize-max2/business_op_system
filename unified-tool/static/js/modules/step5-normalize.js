// ========== step5-normalize.js — 步骤5：数据标准化 ==========

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
  _stickyDecimal: 2,    // 用户上次设置的小数位（粘性，切换单元格不重置）
  _stickyPercent: false, // 用户上次设置的百分比状态（粘性）
  previewMode: false,     // 是否为预览模式（显示计算值）
};

// 引用选取模式：输入 = 后点击单元格自动插入引用
let nzCellRefPickMode = false;
// 正常模式拖选状态
let nzNormalDragStart = null;   // {r, c} 鼠标按下的起点格
let nzNormalDragMoved = false;  // 是否已拖动到不同格（区分点击与拖选）
let nzSuppressNextClick = false;// 拖选结束后抑制一次 click 事件

// ---- 公式解析 ----
// 单公式精确匹配（向后兼容）
const NZ_FORMULA_RE = /^\{\{(.+?)\}\}$/;
// 全局查找所有 {{...}} 的正则（用于多公式表达式）
const NZ_FORMULA_GLOBAL_RE = /\{\{(.+?)\}\}/g;
// 判断单元格值是否包含至少一个公式
function nzHasFormula(val) { return /\{\{.+?\}\}/.test(val) || nzIsExpression(val); }
// 判断是否为纯公式表达式（以 = 开头或仅一个 {{...}}）
function nzIsExpression(val) { return String(val).startsWith('='); }

/**
 * 格式化数值：按 decimal 精度四舍五入 + 百分比
 * @param {number} value - 原始数值
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
// 匹配 SUM(...) 或 AVG(...) 函数调用
const NZ_FUNC_RE = /\b(SUM|AVG)\s*\(([^)]+)\)/gi;

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
  try {
    const numResult = Function('"use strict"; return (' + safeExpr + ')')();
    if (typeof numResult === 'number' && isFinite(numResult)) {
      return { ok: true, value: numResult };
    }
    return { ok: false, value: '计算错误' };
  } catch (e) {
    return { ok: false, value: '表达式错误' };
  }
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
  const textResult = cellVal.replace(NZ_FORMULA_GLOBAL_RE, (match) => {
    const parsed = nzParseFormula(match);
    if (!parsed) { anyFail = true; return match; }
    const result = nzResolveFormula(parsed, statsData);
    if (!result.ok) { anyFail = true; return match; }
    return String(result.value);
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

// ---- 模板列表加载 ----
async function loadNzTemplates() {
  try {
    const res = await fetch('/api/nz-templates');
    const data = await res.json();
    NZ.templates = data.templates || [];
    nzRenderTemplateSel();
  } catch (e) {
    console.error('加载模板列表失败', e);
  }
}

function nzRenderTemplateSel() {
  const sel = document.getElementById('nzTemplateSel');
  sel.innerHTML = '<option value="">-- 选择已保存模板 --</option>';
  NZ.templates.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.name;
    opt.textContent = t.name + (t.sheetCount ? ` (${t.sheetCount}个Sheet)` : '');
    sel.appendChild(opt);
  });
  if (NZ.currentTemplate) sel.value = NZ.currentTemplate;
}

// ---- 模板上传与解析 ----
document.getElementById('nzUploadBtn').addEventListener('click', () => {
  document.getElementById('nzFileInput').click();
});

document.getElementById('nzFileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  NZ.currentTemplate = file.name.replace(/\.(xlsx|xls)$/i, '');
  const reader = new FileReader();
  reader.onload = ev => {
    NZ.rawBuffer = ev.target.result;
    nzParseWorkbook(ev.target.result);
    nzRenderTemplateSel();
    document.getElementById('nzTemplateSel').value = NZ.currentTemplate;
  };
  reader.readAsArrayBuffer(file);
  e.target.value = '';
});

function nzParseWorkbook(buffer) {
  try {
    NZ.wb = XLSX.read(buffer, { type: 'array', cellStyles: true, cellDates: true });
    NZ.cellEdits = {};
    NZ.cellFormats = {};
    NZ.selectedCell = null;
    NZ.selectedRange = null;
    NZ.activeSheet = 0;
    NZ.previewMode = false;
    nzHideRangeActionBar();
    // 重置预览按钮
    const pvBtn = document.getElementById('nzPreviewBtn');
    if (pvBtn) {
      pvBtn.textContent = '预览';
      pvBtn.classList.remove('btn-primary');
      pvBtn.classList.add('btn-ghost');
    }
    nzShowWorkspace();
    nzRenderSheetTabs();
    nzRenderTable();
  } catch (e) {
    ntf('解析模板失败: ' + e.message, 'error');
  }
}

function nzShowWorkspace() {
  document.getElementById('nzWorkspace').style.display = '';
  document.getElementById('nzEmpty').style.display = 'none';
  nzShowFormatBar();
}

// ---- Sheet标签 ----
function nzRenderSheetTabs() {
  const tabs = document.getElementById('nzSheetTabs');
  tabs.innerHTML = '';
  if (!NZ.wb) return;
  NZ.wb.SheetNames.forEach((name, i) => {
    const tab = document.createElement('div');
    tab.className = 'nz-sheet-tab' + (i === NZ.activeSheet ? ' active' : '');
    tab.textContent = name;
    tab.addEventListener('click', () => {
      NZ.activeSheet = i;
      NZ.selectedCell = null;
      nzRenderSheetTabs();
      nzRenderTable();
    });
    tabs.appendChild(tab);
  });
}

// ---- 表格渲染 ----
function nzRenderTable() {
  if (!NZ.wb) return;
  const ws = NZ.wb.Sheets[NZ.wb.SheetNames[NZ.activeSheet]];
  if (!ws || !ws['!ref']) {
    document.getElementById('nzThead').innerHTML = '';
    document.getElementById('nzTbody').innerHTML = '<tr><td style="padding:20px;color:var(--t3)">空Sheet</td></tr>';
    return;
  }
  const range = XLSX.utils.decode_range(ws['!ref']);
  const maxR = Math.min(range.e.r, 200); // 最多显示200行
  const maxC = Math.min(range.e.c, 50);  // 最多显示50列

  // 表头: 列号
  let thead = '<tr><th></th>';
  for (let c = 0; c <= maxC; c++) {
    thead += `<th>${XLSX.utils.encode_col(c)}</th>`;
  }
  thead += '</tr>';
  document.getElementById('nzThead').innerHTML = thead;

  // 数据行
  let tbody = '';
  for (let r = 0; r <= maxR; r++) {
    tbody += `<tr><td>${r + 1}</td>`;
    for (let c = 0; c <= maxC; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const editKey = `${NZ.activeSheet}!${r}!${c}`;
      let cellVal = '';
      let isFormula = false;
      // 优先显示编辑缓存
      if (NZ.cellEdits[editKey] !== undefined) {
        cellVal = NZ.cellEdits[editKey];
      } else {
        const cell = ws[ref];
        if (cell) {
          cellVal = cell.v != null ? String(cell.v) : '';
          if (cell.t === 'd') cellVal = cell.v.toLocaleDateString?.() || String(cell.v);
        }
      }
      isFormula = nzHasFormula(cellVal);
      const fmt = NZ.cellFormats[editKey];
      let fmtStyle = '';
      if (fmt) {
        if (fmt.bold) fmtStyle += 'font-weight:700;';
        if (fmt.italic) fmtStyle += 'font-style:italic;';
        if (fmt.align) fmtStyle += `text-align:${fmt.align};`;
        if (fmt.fontSize) fmtStyle += `font-size:${fmt.fontSize}px;`;
        if (fmt.fontName) fmtStyle += `font-family:${fmt.fontName};`;
      }
      const cls = isFormula ? ' nz-formula' : '';
      const selCls = (NZ.selectedCell && NZ.selectedCell.row === r && NZ.selectedCell.col === c) ? ' selected' : '';
      const fmtAttr = fmtStyle ? ` style="${fmtStyle}"` : '';

      // 预览模式下替换公式为计算值（应用小数位和百分比格式）
      let displayVal = cellVal;
      if (NZ.previewMode && isFormula) {
        const statsData = nzComputeStats();
        const resolved = nzResolveCellFormula(cellVal, statsData, NZ.activeSheet);
        displayVal = resolved.ok ? nzFormatValue(resolved.value, fmt) : cellVal;
      }

      tbody += `<td class="${cls}${selCls}" data-r="${r}" data-c="${c}" title="${esc(cellVal)}"${fmtAttr}>${esc(displayVal)}</td>`;
    }
    tbody += '</tr>';
  }
  document.getElementById('nzTbody').innerHTML = tbody;

  // 绑定点击事件
  document.getElementById('nzTbody').querySelectorAll('td[data-r]').forEach(td => {
    td.addEventListener('click', () => nzSelectCell(+td.dataset.r, +td.dataset.c));
  });

  // 绑定拖拽选择事件（用于公式范围选取）
  nzBindDragSelect();

  // 更新编辑栏
  nzUpdateEditBar();
}

// ---- 拖拽选择范围（用于 SUM/AVG 公式） ----
let nzDragState = null; // { startR, startC, active, funcName, baseInput }
let nzRangePickMode = null; // 'SUM' | 'AVG' | null - 选取模式

/** 进入范围选取模式（由 SUM/AVG 按钮触发） */
function nzEnterRangePick(funcName) {
  // 如果已在选取模式且函数相同，取消
  if (nzRangePickMode === funcName) {
    nzExitRangePick();
    return;
  }
  nzRangePickMode = funcName;
  
  // 记住当前输入框内容作为基础
  const input = document.getElementById('nzCellInput');
  const curVal = input.value.trim();
  
  // 更新按钮高亮
  document.getElementById('nzFuncSumBtn')?.classList.toggle('active', funcName === 'SUM');
  document.getElementById('nzFuncAvgBtn')?.classList.toggle('active', funcName === 'AVG');
  
  // 显示提示条
  const hint = document.getElementById('nzRangeHint');
  if (hint) {
    hint.querySelector('span').textContent = `正在选取 ${funcName} 范围，拖动鼠标选择单元格，松开完成`;
    hint.style.display = '';
  }
  
  // 设置输入框 — 智能拼接公式
  if (curVal.startsWith('=')) {
    // 已有公式，检查是否已包含 SUM/AVG
    if (/\b(SUM|AVG)\s*\(/i.test(curVal) && /[,(]\s*$/.test(curVal)) {
      // 已在函数参数输入中，保持不变
      nzDragState = { baseInput: curVal, funcName };
    } else {
      // 追加函数，如已有 =A1+ 变成 =A1+SUM(
      input.value = curVal + (curVal.endsWith('+') || curVal.endsWith('-') || curVal.endsWith('*') || curVal.endsWith('/') ? '' : '+') + funcName + '(';
      nzDragState = { baseInput: input.value, funcName };
    }
  } else {
    // 空值或纯文本，直接开始新公式
    input.value = '=' + funcName + '(';
    nzDragState = { baseInput: input.value, funcName };
  }
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

/** 退出范围选取模式 */
function nzExitRangePick() {
  nzRangePickMode = null;
  nzDragState = null;
  nzClearRangeHighlight();
  
  document.getElementById('nzFuncSumBtn')?.classList.remove('active');
  document.getElementById('nzFuncAvgBtn')?.classList.remove('active');
  
  const hint = document.getElementById('nzRangeHint');
  if (hint) hint.style.display = 'none';
}

function nzBindDragSelect() {
  const tbody = document.getElementById('nzTbody');
  if (!tbody) return;

  let dragging = false; // nzRangePickMode 专用

  // ---- mousedown ----
  tbody.onmousedown = (e) => {
    const td = e.target.closest('td[data-r]');
    if (!td) return;

    if (nzRangePickMode) {
      // 公式函数选取模式：开始拖拽选范围
      e.preventDefault();
      dragging = true;
      const startR = +td.dataset.r, startC = +td.dataset.c;
      nzDragState = nzDragState || {};
      nzDragState.startR = startR;
      nzDragState.startC = startC;
      nzDragState.active = true;
      nzHighlightRange(startR, startC, startR, startC);
      return;
    }

    if (nzCellRefPickMode) return; // 引用选取模式由 click 处理

    // 正常模式：记录拖拽起点
    // 锚点格 = 之前单击选中的格（如果有），否则用当前格
    e.preventDefault(); // 防止文本选中
    nzNormalDragStart = { r: +td.dataset.r, c: +td.dataset.c };
    nzNormalDragMoved = false;
  };

  // ---- mousemove ----
  tbody.onmousemove = (e) => {
    // nzRangePickMode 拖拽
    if (dragging && nzDragState?.active) {
      const td = e.target.closest('td[data-r]');
      if (!td) return;
      nzHighlightRange(nzDragState.startR, nzDragState.startC, +td.dataset.r, +td.dataset.c);
      const startRef = XLSX.utils.encode_cell({ r: nzDragState.startR, c: nzDragState.startC });
      const endRef = XLSX.utils.encode_cell({ r: +td.dataset.r, c: +td.dataset.c });
      const rangeStr = (nzDragState.startR === +td.dataset.r && nzDragState.startC === +td.dataset.c)
        ? startRef : `${startRef}:${endRef}`;
      document.getElementById('nzCellInput').value = nzDragState.baseInput + rangeStr;
      return;
    }

    // 正常模式拖拽
    if (!nzNormalDragStart) return;
    const td = e.target.closest('td[data-r]');
    if (!td) return;
    const curR = +td.dataset.r, curC = +td.dataset.c;
    if (curR !== nzNormalDragStart.r || curC !== nzNormalDragStart.c) {
      nzNormalDragMoved = true;
      // 锚点 = 之前选中的格（selectedCell），范围 = 锚点到当前拖拽位置
      const anchorR = NZ.selectedCell ? NZ.selectedCell.row : nzNormalDragStart.r;
      const anchorC = NZ.selectedCell ? NZ.selectedCell.col : nzNormalDragStart.c;
      NZ.selectedRange = {
        r1: Math.min(anchorR, curR), c1: Math.min(anchorC, curC),
        r2: Math.max(anchorR, curR), c2: Math.max(anchorC, curC)
      };
      nzHighlightNormalRange();
      nzUpdateRangeActionBar();
    }
  };

  // ---- mouseup ----
  const finishNormalDrag = () => {
    if (nzNormalDragStart && nzNormalDragMoved && NZ.selectedRange) {
      nzSuppressNextClick = true;
      requestAnimationFrame(() => { nzSuppressNextClick = false; });
      nzShowRangeActionBar();
      nzUpdateEditBar();
    }
    nzNormalDragStart = null;
    nzNormalDragMoved = false;
  };

  tbody.onmouseup = (e) => {
    // nzRangePickMode 拖拽完成
    if (dragging && nzDragState?.active) {
      dragging = false;
      const td = e.target.closest('td[data-r]');
      if (td) {
        const endR = +td.dataset.r, endC = +td.dataset.c;
        const startRef = XLSX.utils.encode_cell({ r: nzDragState.startR, c: nzDragState.startC });
        const endRef = XLSX.utils.encode_cell({ r: endR, c: endC });
        const rangeStr = (nzDragState.startR === endR && nzDragState.startC === endC)
          ? startRef : `${startRef}:${endRef}`;
        const input = document.getElementById('nzCellInput');
        input.value = nzDragState.baseInput + rangeStr + ')';
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      nzExitRangePick();
      return;
    }
    // 正常模式拖拽完成
    finishNormalDrag();
  };

  // 鼠标移出表格后松开
  document.addEventListener('mouseup', () => {
    if (dragging && nzDragState?.active) {
      dragging = false;
      nzExitRangePick();
    }
    finishNormalDrag();
  });
}

/** 高亮选中的范围 */
function nzHighlightRange(r1, c1, r2, c2) {
  nzClearRangeHighlight();
  const minR = Math.min(r1, r2), maxR = Math.max(r1, r2);
  const minC = Math.min(c1, c2), maxC = Math.max(c1, c2);
  document.querySelectorAll('#nzTbody td[data-r]').forEach(td => {
    const r = +td.dataset.r, c = +td.dataset.c;
    if (r >= minR && r <= maxR && c >= minC && c <= maxC) {
      td.classList.add('nz-range-select');
    }
  });
}

/** 清除范围高亮（nzRangePickMode 用） */
function nzClearRangeHighlight() {
  document.querySelectorAll('#nzTbody td.nz-range-select').forEach(td => {
    td.classList.remove('nz-range-select');
  });
}

/** 高亮正常模式拖选范围 */
function nzHighlightNormalRange() {
  nzClearNormalRangeHighlight();
  if (!NZ.selectedRange) return;
  const { r1, c1, r2, c2 } = NZ.selectedRange;
  document.querySelectorAll('#nzTbody td[data-r]').forEach(td => {
    const r = +td.dataset.r, c = +td.dataset.c;
    if (r >= r1 && r <= r2 && c >= c1 && c <= c2) {
      td.classList.add('nz-range-selected');
    }
  });
  // 锚点格额外标记
  if (NZ.selectedCell) {
    const anchor = document.querySelector(`#nzTbody td[data-r="${NZ.selectedCell.row}"][data-c="${NZ.selectedCell.col}"]`);
    if (anchor) anchor.classList.add('selected');
  }
}

/** 清除正常模式范围高亮 */
function nzClearNormalRangeHighlight() {
  document.querySelectorAll('#nzTbody td.nz-range-selected').forEach(td => {
    td.classList.remove('nz-range-selected');
  });
}

/** 计算范围内的统计数据（支持公式单元格） */
function nzCalcRangeStats(range) {
  if (!range || !NZ.wb) return null;
  const { r1, c1, r2, c2 } = range;
  const statsData = nzComputeStats();
  let count = 0, sum = 0, numCount = 0;
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      count++;
      let val = nzGetCellDisplayValue(NZ.activeSheet, r, c);
      const valStr = String(val);
      if (nzHasFormula(valStr)) {
        const resolved = nzResolveCellFormula(valStr, statsData, NZ.activeSheet);
        if (resolved.ok) val = resolved.value;
      }
      const num = parseFloat(val);
      if (!isNaN(num)) { sum += num; numCount++; }
    }
  }
  return { count, numCount, sum, avg: numCount > 0 ? sum / numCount : 0 };
}

/** 生成范围地址字符串（如 A1:B5 或 A1） */
function nzRangeAddr(range) {
  if (!range) return '';
  const s = XLSX.utils.encode_cell({ r: range.r1, c: range.c1 });
  if (range.r1 === range.r2 && range.c1 === range.c2) return s;
  return s + ':' + XLSX.utils.encode_cell({ r: range.r2, c: range.c2 });
}

/** 显示范围操作栏 */
function nzShowRangeActionBar() {
  const bar = document.getElementById('nzRangeActionBar');
  if (bar) bar.style.display = '';
}

/** 隐藏范围操作栏 */
function nzHideRangeActionBar() {
  const bar = document.getElementById('nzRangeActionBar');
  if (bar) bar.style.display = 'none';
}

/** 更新范围操作栏内容 */
function nzUpdateRangeActionBar() {
  if (!NZ.selectedRange) { nzHideRangeActionBar(); return; }
  const stats = nzCalcRangeStats(NZ.selectedRange);
  const info = document.getElementById('nzRabInfo');
  const statsEl = document.getElementById('nzRabStats');
  if (!info || !statsEl) return;

  const addr = nzRangeAddr(NZ.selectedRange);
  info.textContent = `${addr} (${stats.count}格)`;

  statsEl.innerHTML = ''
    + `<span>求和: <strong>${stats.sum % 1 === 0 ? stats.sum : stats.sum.toFixed(2)}</strong></span>`
    + `<span>均值: <strong>${stats.avg.toFixed(2)}</strong></span>`
    + `<span>计数: <strong>${stats.numCount}</strong></span>`;

  nzShowRangeActionBar();
}

/** 进入单元格引用选取模式（输入=后激活） */
function nzEnterCellRefPick() {
  if (nzCellRefPickMode) return;
  nzCellRefPickMode = true;
  const hint = document.getElementById('nzRangeHint');
  if (hint) {
    hint.querySelector('span').textContent = '点击表格单元格插入引用，可配合 + - * / 运算符组合';
    hint.style.display = '';
  }
}

/** 退出单元格引用选取模式 */
function nzExitCellRefPick() {
  if (!nzCellRefPickMode) return;
  nzCellRefPickMode = false;
  if (!nzRangePickMode) {
    const hint = document.getElementById('nzRangeHint');
    if (hint) hint.style.display = 'none';
  }
}

function nzSelectCell(r, c) {
  // 拖选结束时抑制点选
  if (nzSuppressNextClick) return;
  // 引用选取模式：点击单元格插入引用
  if (nzCellRefPickMode) {
    const ref = XLSX.utils.encode_cell({ r, c });
    const input = document.getElementById('nzCellInput');
    const pos = input.selectionStart != null ? input.selectionStart : input.value.length;
    const endPos = input.selectionEnd != null ? input.selectionEnd : pos;
    input.value = input.value.substring(0, pos) + ref + input.value.substring(endPos);
    input.focus();
    const newPos = pos + ref.length;
    input.setSelectionRange(newPos, newPos);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  // 普通单选：清除范围选择
  NZ.selectedRange = null;
  nzHideRangeActionBar();
  nzClearNormalRangeHighlight();

  NZ.selectedCell = { row: r, col: c };
  // 高亮
  document.querySelectorAll('#nzTbody td.selected').forEach(td => td.classList.remove('selected'));
  const td = document.querySelector(`#nzTbody td[data-r="${r}"][data-c="${c}"]`);
  if (td) td.classList.add('selected');
  nzUpdateEditBar();
  try { nzSyncFormatBar(); } catch(e) { /* 格式栏未就绪时忽略 */ }
}

function nzUpdateEditBar() {
  const bar = document.getElementById('nzEditBar');
  const refEl = document.getElementById('nzCellRef');
  const input = document.getElementById('nzCellInput');
  if (!NZ.selectedCell || !NZ.wb) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = '';
  const { row, col } = NZ.selectedCell;
  // 有范围选择时显示范围地址，否则显示单格地址
  refEl.textContent = NZ.selectedRange ? nzRangeAddr(NZ.selectedRange) : XLSX.utils.encode_cell({ r: row, c: col });
  const editKey = `${NZ.activeSheet}!${row}!${col}`;
  const ws = NZ.wb.Sheets[NZ.wb.SheetNames[NZ.activeSheet]];
  let val = '';
  if (NZ.cellEdits[editKey] !== undefined) {
    val = NZ.cellEdits[editKey];
  } else {
    const ref = XLSX.utils.encode_cell({ r: row, c: col });
    const cell = ws?.[ref];
    if (cell) val = cell.v != null ? String(cell.v) : '';
  }
  input.value = val;
  
  // 小数位和百分比使用粘性状态，切换单元格不重置
  const decSel = document.getElementById('nzDecimalSel');
  const pctBtn = document.getElementById('nzPercentBtn');
  if (decSel) decSel.value = NZ._stickyDecimal;
  if (pctBtn) pctBtn.classList.toggle('active', NZ._stickyPercent);
}

// ---- 单元格编辑 ----
document.getElementById('nzCellInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    nzExitCellRefPick();
    nzApplyCellEdit();
  } else if (e.key === 'Escape') {
    // Escape：取消编辑，退出选取模式，恢复原始值
    nzExitCellRefPick();
    nzExitRangePick();
    nzUpdateEditBar();
    e.target.blur();
  }
});
document.getElementById('nzCellInput').addEventListener('blur', () => {
  // 选取模式（拖拽或引用）时不提交编辑
  if (nzRangePickMode || nzCellRefPickMode) return;
  nzApplyCellEdit();
});
// 监听输入变化，自动进入/退出选取模式
document.getElementById('nzCellInput').addEventListener('input', () => {
  const val = document.getElementById('nzCellInput').value.trim();
  // 检测是否处于函数参数输入状态：=SUM( 或 =AVG( 且末尾是 ( 或 ,
  const funcMatch = val.match(/=\s*(SUM|AVG)\s*\(/i);
  const inFuncArgs = funcMatch && /[,(]\s*$/.test(val);
  if (inFuncArgs) {
    // SUM/AVG 参数输入 → 拖拽选取模式
    const fn = funcMatch[1].toUpperCase();
    if (nzRangePickMode !== fn) {
      nzRangePickMode = fn;
      nzDragState = nzDragState || {};
      nzDragState.baseInput = val;
      nzDragState.funcName = fn;
      // 更新UI
      document.getElementById('nzFuncSumBtn')?.classList.toggle('active', fn === 'SUM');
      document.getElementById('nzFuncAvgBtn')?.classList.toggle('active', fn === 'AVG');
    }
    nzExitCellRefPick();
    const hint = document.getElementById('nzRangeHint');
    if (hint) {
      hint.querySelector('span').textContent = `正在选取 ${fn} 范围，拖动鼠标选择单元格，松开完成`;
      hint.style.display = '';
    }
  } else {
    // 不在函数参数状态
    if (nzRangePickMode) nzExitRangePick();
    // 引用选取模式：= 开头时激活，点击单元格可插入引用
    if (val.startsWith('=')) {
      nzEnterCellRefPick();
    } else {
      nzExitCellRefPick();
    }
  }
});

function nzApplyCellEdit() {
  if (!NZ.selectedCell || !NZ.wb) return;
  const { row, col } = NZ.selectedCell;
  const editKey = `${NZ.activeSheet}!${row}!${col}`;
  const newVal = document.getElementById('nzCellInput').value;
  const ws = NZ.wb.Sheets[NZ.wb.SheetNames[NZ.activeSheet]];
  const ref = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = ws?.[ref];
  const origVal = cell ? (cell.v != null ? String(cell.v) : '') : '';
  if (newVal === origVal) {
    delete NZ.cellEdits[editKey];
  } else {
    NZ.cellEdits[editKey] = newVal;
  }
  // 只刷新该单元格而非全表
  const td = document.querySelector(`#nzTbody td[data-r="${row}"][data-c="${col}"]`);
  if (td) {
    const isFormula = nzHasFormula(newVal);
    const fmt = NZ.cellFormats[editKey];
    let fmtStyle = '';
    if (fmt) {
      if (fmt.bold) fmtStyle += 'font-weight:700;';
      if (fmt.italic) fmtStyle += 'font-style:italic;';
      if (fmt.align) fmtStyle += `text-align:${fmt.align};`;
      if (fmt.fontSize) fmtStyle += `font-size:${fmt.fontSize}px;`;
      if (fmt.fontName) fmtStyle += `font-family:${fmt.fontName};`;
    }
    td.className = (isFormula ? ' nz-formula' : '') + ' selected';
    td.title = newVal;
    if (fmtStyle) td.style.cssText = fmtStyle;
    // 预览模式下显示计算值
    if (NZ.previewMode && isFormula) {
      const statsData = nzComputeStats();
      const resolved = nzResolveCellFormula(newVal, statsData, NZ.activeSheet);
      td.textContent = resolved.ok ? String(resolved.value) : newVal;
    } else {
      td.textContent = newVal;
    }
  }
}

// ---- 快速插入 ----
document.getElementById('nzQuickInsertBtn').addEventListener('click', () => {
  const body = document.getElementById('nzQiBody');
  const visible = body.style.display !== 'none';
  body.style.display = visible ? 'none' : '';
  if (!visible) nzPopulateQiSelects(); // 每次展开时刷新
});

document.getElementById('nzQiToggle').addEventListener('click', () => {
  const body = document.getElementById('nzQiBody');
  const visible = body.style.display !== 'none';
  body.style.display = visible ? 'none' : '';
  if (!visible) nzPopulateQiSelects(); // 每次展开时刷新
});

document.getElementById('nzScanToggle').addEventListener('click', () => {
  const body = document.getElementById('nzScanBody');
  body.style.display = body.style.display !== 'none' ? 'none' : '';
});

function nzPopulateQiSelects() {
  // 文件下拉
  const fileSel = document.getElementById('nzQiFile');
  fileSel.innerHTML = '';
  if (!S.files.length) {
    fileSel.innerHTML = '<option value="">-- 无文件 --</option>';
    return;
  }
  S.files.forEach((f, i) => {
    const opt = document.createElement('option');
    opt.value = i + 1;
    opt.textContent = `${i + 1} - ${f.name}`;
    fileSel.appendChild(opt);
  });
  nzQiUpdateL1();
}

document.getElementById('nzQiFile').addEventListener('change', nzQiUpdateL1);
document.getElementById('nzQiL1').addEventListener('change', nzQiUpdateEntry);
document.getElementById('nzQiEntry').addEventListener('change', nzQiUpdateCol);
document.getElementById('nzQiCol').addEventListener('change', nzQiUpdatePreview);
document.getElementById('nzQiMetric').addEventListener('change', nzQiUpdatePreview);

function nzQiUpdateL1() {
  const fi = parseInt(document.getElementById('nzQiFile').value);
  const l1Sel = document.getElementById('nzQiL1');
  l1Sel.innerHTML = '<option value="">(无/总合计)</option>';
  if (!fi || !S.files[fi - 1]) return;
  const file = S.files[fi - 1];
  const l1Groups = file.grps.filter(g => g.level === 1);
  l1Groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.name;
    opt.textContent = g.name;
    l1Sel.appendChild(opt);
  });
  nzQiUpdateEntry();
}

function nzQiUpdateEntry() {
  const fi = parseInt(document.getElementById('nzQiFile').value);
  const l1Val = document.getElementById('nzQiL1').value;
  const entryRow = document.getElementById('nzQiEntryRow');
  const entrySel = document.getElementById('nzQiEntry');
  entrySel.innerHTML = '';

  if (!fi || !S.files[fi - 1]) {
    entryRow.style.display = 'none';
    nzQiUpdateCol();
    return;
  }

  // 计算统计数据
  const statsData = nzComputeStats();
  const fd = statsData[fi];
  if (!fd) {
    entryRow.style.display = 'none';
    nzQiUpdateCol();
    return;
  }

  entryRow.style.display = '';

  if (!l1Val) {
    // 无L1选择：显示总合计和独立分组（含交叉项）
    const opt = document.createElement('option');
    opt.value = '总合计';
    opt.textContent = '总合计';
    entrySel.appendChild(opt);
    // 交叉项
    fd.entries.filter(e => e.isL1Cross && !e.l1Name).forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.name;
      opt.textContent = `[交叉] ${e.name}`;
      entrySel.appendChild(opt);
    });
    // 独立分组自身
    fd.entries.filter(e => e.isGroup && !e.isL1Cross && !e.l1Name).forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.name;
      opt.textContent = `[分组] ${e.name}`;
      entrySel.appendChild(opt);
    });
  } else if (l1Val === '__standalone__') {
    // 独立分组（含交叉项）
    fd.entries.filter(e => e.isL1Cross && !e.l1Name).forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.name;
      opt.textContent = `[交叉] ${e.name}`;
      entrySel.appendChild(opt);
    });
    fd.entries.filter(e => e.isGroup && !e.isL1Cross && !e.l1Name).forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.name;
      opt.textContent = `[分组] ${e.name}`;
      entrySel.appendChild(opt);
    });
  } else {
    // 选了L1：列出该L1下所有条目（交叉项、合计、小计等）
    // 按类型分组：交叉项、自身名称、小计、L1合计
    const l1Entries = fd.entries.filter(e => e.l1Name === l1Val);
    // 先加L1合计
    const l1Total = l1Entries.find(e => e.isL1Total);
    if (l1Total) {
      const opt = document.createElement('option');
      opt.value = l1Total.name;
      opt.textContent = `[合计] ${l1Val}`;
      entrySel.appendChild(opt);
    }
    // 交叉项
    l1Entries.filter(e => e.isL1Cross).forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.name;
      opt.textContent = `[交叉] ${e.name}`;
      entrySel.appendChild(opt);
    });
    // L1子分组自身
    l1Entries.filter(e => e.isGroup && !e.isL1Cross && !e.isL1Total && !e.isL1Subtotal && !e.isL1Copy).forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.name;
      opt.textContent = `[分组] ${e.name}`;
      entrySel.appendChild(opt);
    });
    // 小计
    l1Entries.filter(e => e.isL1Subtotal).forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.name;
      opt.textContent = `[小计] ${e.name}`;
      entrySel.appendChild(opt);
    });
  }

  nzQiUpdateCol();
}

function nzQiUpdateCol() {
  const fi = parseInt(document.getElementById('nzQiFile').value);
  const colSel = document.getElementById('nzQiCol');
  colSel.innerHTML = '<option value="">默认</option>';
  if (!fi || !S.files[fi - 1]) return;
  const file = S.files[fi - 1];
  file.hdr.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    colSel.appendChild(opt);
  });
  nzQiUpdatePreview();
}

function nzQiUpdatePreview() {
  const p = nzQiBuildParsed();
  const preview = document.getElementById('nzQiPreview');
  if (!p) { preview.textContent = ''; return; }
  const formula = nzBuildFormula(p);
  preview.textContent = formula;

  // 尝试解析预览值
  const statsData = nzComputeStats();
  // nzResolveFormula需要 l2=entryName，p.l2已经是entryName
  const result = nzResolveFormula(p, statsData);
  if (result.ok) {
    preview.textContent += ` = ${result.value}`;
  } else {
    preview.textContent += ` → ${result.value}`;
  }
}

function nzQiBuildParsed() {
  const fi = parseInt(document.getElementById('nzQiFile').value);
  if (!fi) return null;
  const l1Val = document.getElementById('nzQiL1').value;
  const entrySel = document.getElementById('nzQiEntry');
  const entryVal = entrySel?.value || '';
  const colVal = document.getElementById('nzQiCol').value;
  const metric = document.getElementById('nzQiMetric').value;
  if (!entryVal) return null;

  let l1 = '';
  if (l1Val === '__standalone__') {
    l1 = '';
  } else {
    l1 = l1Val || '';
  }

  // 修正[合计]条目：L1合计的 name 是"L1名称 合计"，但公式 l2 应为"合计"
  let l2 = entryVal;
  if (l1 && entryVal.endsWith(' 合计')) {
    l2 = '合计';
  }

  return { fileIdx: fi, l1, l2, col: colVal || '', metric };
}

document.getElementById('nzQiInsertBtn').addEventListener('click', () => {
  const p = nzQiBuildParsed();
  if (!p) { ntf('请选择分组信息', 'warn'); return; }
  const formula = nzBuildFormula(p);
  const input = document.getElementById('nzCellInput');
  // 追加而非替换：如果当前内容非空且不是纯公式，在光标位置插入
  const curVal = input.value;
  if (curVal && !NZ_FORMULA_RE.test(curVal.trim())) {
    // 在光标位置插入公式
    const pos = input.selectionStart || curVal.length;
    input.value = curVal.substring(0, pos) + formula + curVal.substring(input.selectionEnd || pos);
  } else {
    input.value = formula;
  }
  nzApplyCellEdit();
  ntf('公式已插入');
});

// ---- 扫描公式 ----
document.getElementById('nzScanBtn').addEventListener('click', nzScanFormulas);

function nzScanFormulas() {
  if (!NZ.wb) { ntf('请先上传模板', 'warn'); return; }
  const body = document.getElementById('nzScanBody');
  body.style.display = '';
  const list = document.getElementById('nzScanList');
  const statsData = nzComputeStats();
  const formulas = [];
  let matchCount = 0, failCount = 0;

  NZ.wb.SheetNames.forEach((sname, si) => {
    const ws = NZ.wb.Sheets[sname];
    if (!ws || !ws['!ref']) return;
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        const editKey = `${si}!${r}!${c}`;
        let cellVal;
        if (NZ.cellEdits[editKey] !== undefined) {
          cellVal = NZ.cellEdits[editKey];
        } else {
          const cell = ws[ref];
          if (!cell) continue;
          cellVal = cell.v != null ? String(cell.v) : '';
        }
        if (!nzHasFormula(cellVal)) continue;
        // 使用多公式解析（传入sheet索引用于单元格引用）
        const result = nzResolveCellFormula(cellVal, statsData, si);
        formulas.push({ formula: cellVal, ref, sheet: sname, ok: result.ok, value: result.value });
        if (result.ok) matchCount++; else failCount++;
      }
    }
  });

  if (!formulas.length) {
    list.innerHTML = '<div style="padding:10px;color:var(--t3);font-size:12px">未找到任何公式（{{...}}、=表达式、SUM/AVG函数）</div>';
  } else {
    list.innerHTML = formulas.map(f => `
      <div class="nz-scan-item ${f.ok ? 'ok' : 'err'}">
        <span class="nz-scan-icon">${f.ok ? '✅' : '❌'}</span>
        <span class="nz-scan-formula">${esc(f.sheet)}!${esc(f.ref)}: ${esc(f.formula)}</span>
        <span class="nz-scan-value ${f.ok ? '' : 'err'}">${esc(String(f.value))}</span>
      </div>
    `).join('');
  }
  ntf(`扫描完成：${matchCount} 匹配，${failCount} 未匹配`, failCount ? 'warn' : 'success');
}

// ---- 预览模式（两态切换：预览计算值 ↔ 显示原始公式） ----
document.getElementById('nzPreviewBtn').addEventListener('click', () => {
  if (!NZ.wb) { ntf('请先上传模板', 'warn'); return; }
  NZ.previewMode = !NZ.previewMode;
  const btn = document.getElementById('nzPreviewBtn');
  btn.textContent = NZ.previewMode ? '公式' : '预览';
  btn.classList.toggle('btn-primary', NZ.previewMode);
  btn.classList.toggle('btn-ghost', !NZ.previewMode);
  nzRenderTable();
});

// ---- SUM/AVG 范围选取按钮 ----
document.getElementById('nzFuncSumBtn').addEventListener('click', () => {
  if (!NZ.wb) { ntf('请先上传模板', 'warn'); return; }
  nzEnterRangePick('SUM');
});
document.getElementById('nzFuncAvgBtn').addEventListener('click', () => {
  if (!NZ.wb) { ntf('请先上传模板', 'warn'); return; }
  nzEnterRangePick('AVG');
});
document.getElementById('nzRangeCancelBtn').addEventListener('click', () => {
  nzExitRangePick();
  // 恢复输入框到选取前的值
  const input = document.getElementById('nzCellInput');
  if (nzDragState?.baseInput) {
    input.value = nzDragState.baseInput;
  }
});

// ---- 格式工具栏 ----
// 显示/隐藏格式工具栏（在表格加载后显示）
function nzShowFormatBar() {
  const bar = document.getElementById('nzFormatBar');
  if (bar) bar.style.display = NZ.wb ? '' : 'none';
}

function nzGetCurrentFmt() {
  if (!NZ.selectedCell) return {};
  const editKey = `${NZ.activeSheet}!${NZ.selectedCell.row}!${NZ.selectedCell.col}`;
  return NZ.cellFormats[editKey] || {};
}

function nzSetFmt(prop, value) {
  if (!NZ.selectedCell || !NZ.wb) return;
  const editKey = `${NZ.activeSheet}!${NZ.selectedCell.row}!${NZ.selectedCell.col}`;
  if (!NZ.cellFormats[editKey]) NZ.cellFormats[editKey] = {};
  if (value === '' || value === false) {
    delete NZ.cellFormats[editKey][prop];
  } else {
    NZ.cellFormats[editKey][prop] = value;
  }
  // 清理空格式
  if (!Object.keys(NZ.cellFormats[editKey]).length) delete NZ.cellFormats[editKey];
  // 刷新单元格显示
  const td = document.querySelector(`#nzTbody td[data-r="${NZ.selectedCell.row}"][data-c="${NZ.selectedCell.col}"]`);
  if (td) {
    const fmt = NZ.cellFormats[editKey];
    let s = '';
    if (fmt) {
      if (fmt.bold) s += 'font-weight:700;';
      if (fmt.italic) s += 'font-style:italic;';
      if (fmt.align) s += `text-align:${fmt.align};`;
      if (fmt.fontSize) s += `font-size:${fmt.fontSize}px;`;
      if (fmt.fontName) s += `font-family:${fmt.fontName};`;
    }
    td.style.cssText = s;
  }
}

document.getElementById('nzBoldBtn').addEventListener('click', () => {
  const fmt = nzGetCurrentFmt();
  nzSetFmt('bold', !fmt.bold);
  document.getElementById('nzBoldBtn').classList.toggle('nz-fmt-active', !fmt.bold);
});

document.getElementById('nzItalicBtn').addEventListener('click', () => {
  const fmt = nzGetCurrentFmt();
  nzSetFmt('italic', !fmt.italic);
  document.getElementById('nzItalicBtn').classList.toggle('nz-fmt-active', !fmt.italic);
});

document.getElementById('nzAlignLeftBtn').addEventListener('click', () => nzSetFmt('align', 'left'));
document.getElementById('nzAlignCenterBtn').addEventListener('click', () => nzSetFmt('align', 'center'));
document.getElementById('nzAlignRightBtn').addEventListener('click', () => nzSetFmt('align', 'right'));

document.getElementById('nzFontName').addEventListener('change', e => nzSetFmt('fontName', e.target.value || ''));
document.getElementById('nzFontSize').addEventListener('change', e => nzSetFmt('fontSize', e.target.value ? parseInt(e.target.value) : ''));

// 小数位数（单格或范围批量设置，粘性状态）
document.getElementById('nzDecimalSel').addEventListener('change', e => {
  const decimalVal = parseInt(e.target.value);
  NZ._stickyDecimal = decimalVal;
  if (NZ.selectedRange) {
    // 批量设置选中范围内所有格的小数位
    const { r1, c1, r2, c2 } = NZ.selectedRange;
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const editKey = `${NZ.activeSheet}!${r}!${c}`;
        if (!NZ.cellFormats[editKey]) NZ.cellFormats[editKey] = {};
        NZ.cellFormats[editKey].decimal = decimalVal;
      }
    }
    // 同步百分比状态也批量应用
    const pctBtn = document.getElementById('nzPercentBtn');
    if (pctBtn && pctBtn.classList.contains('active')) {
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          NZ.cellFormats[`${NZ.activeSheet}!${r}!${c}`].percent = true;
        }
      }
    }
  } else {
    nzSetFmt('decimal', decimalVal);
  }
  // 更新预览
  if (NZ.previewMode) nzRenderTable();
});
// 百分比（单格或范围批量设置，粘性状态）
document.getElementById('nzPercentBtn').addEventListener('click', () => {
  const newVal = !document.getElementById('nzPercentBtn').classList.contains('active');
  NZ._stickyPercent = newVal;
  if (NZ.selectedRange) {
    // 批量设置选中范围内所有格的百分比格式
    const { r1, c1, r2, c2 } = NZ.selectedRange;
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const editKey = `${NZ.activeSheet}!${r}!${c}`;
        if (!NZ.cellFormats[editKey]) NZ.cellFormats[editKey] = {};
        if (newVal) {
          NZ.cellFormats[editKey].percent = true;
        } else {
          delete NZ.cellFormats[editKey].percent;
        }
      }
    }
  } else {
    nzSetFmt('percent', newVal);
  }
  document.getElementById('nzPercentBtn').classList.toggle('active', newVal);
  // 更新预览
  if (NZ.previewMode) nzRenderTable();
});

// 选中单元格时同步格式工具栏状态
function nzSyncFormatBar() {
  const fmt = nzGetCurrentFmt();
  const boldBtn = document.getElementById('nzBoldBtn');
  const italicBtn = document.getElementById('nzItalicBtn');
  const fontName = document.getElementById('nzFontName');
  const fontSize = document.getElementById('nzFontSize');
  if (!boldBtn) return; // DOM 未就绪（旧版缓存）
  boldBtn.classList.toggle('nz-fmt-active', !!fmt.bold);
  italicBtn.classList.toggle('nz-fmt-active', !!fmt.italic);
  fontName.value = fmt.fontName || '';
  fontSize.value = fmt.fontSize || '';
}

// ---- 范围选取操作栏按钮 ----
/** 清除范围选择并回到单选状态 */
function nzClearRangeSelection() {
  NZ.selectedRange = null;
  nzClearNormalRangeHighlight();
  nzHideRangeActionBar();
  if (NZ.selectedCell) nzUpdateEditBar();
}

document.getElementById('nzRabSumBtn').addEventListener('click', () => {
  if (!NZ.selectedRange || !NZ.selectedCell) return;
  const addr = nzRangeAddr(NZ.selectedRange);
  const formula = `=SUM(${addr})`;
  // 写入锚点格（先选中的目标格）
  const { row, col } = NZ.selectedCell;
  const editKey = `${NZ.activeSheet}!${row}!${col}`;
  NZ.cellEdits[editKey] = formula;
  const input = document.getElementById('nzCellInput');
  input.value = formula;
  nzClearRangeSelection();
  nzRenderTable();
  ntf('已插入求和公式');
});

document.getElementById('nzRabAvgBtn').addEventListener('click', () => {
  if (!NZ.selectedRange || !NZ.selectedCell) return;
  const addr = nzRangeAddr(NZ.selectedRange);
  const formula = `=AVG(${addr})`;
  // 写入锚点格
  const { row, col } = NZ.selectedCell;
  const editKey = `${NZ.activeSheet}!${row}!${col}`;
  NZ.cellEdits[editKey] = formula;
  const input = document.getElementById('nzCellInput');
  input.value = formula;
  nzClearRangeSelection();
  nzRenderTable();
  ntf('已插入均值公式');
});

document.getElementById('nzRabPctBtn').addEventListener('click', () => {
  if (!NZ.selectedRange) return;
  // 对范围内所有格应用百分比格式
  for (let r = NZ.selectedRange.r1; r <= NZ.selectedRange.r2; r++) {
    for (let c = NZ.selectedRange.c1; c <= NZ.selectedRange.c2; c++) {
      const editKey = `${NZ.activeSheet}!${r}!${c}`;
      if (!NZ.cellFormats[editKey]) NZ.cellFormats[editKey] = {};
      NZ.cellFormats[editKey].percent = true;
    }
  }
  nzClearRangeSelection();
  nzRenderTable();
  // 同步锚点格的 % 按钮状态
  if (NZ.selectedCell) {
    const fmt = nzGetCurrentFmt();
    document.getElementById('nzPercentBtn')?.classList.toggle('active', !!fmt.percent);
  }
  ntf('已应用百分比格式');
});

// Escape 键清除范围选择
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && NZ.selectedRange) {
    nzClearRangeSelection();
    nzRenderTable();
  }
});

// ---- 主题化命名输入模态框（替代原生prompt/confirm） ----
const nzModal = {
  _onOk: null, _onCancel: null,
  show({ title = '输入', label = '', value = '', placeholder = '', hint = '', okText = '确定', mode = 'input' }) {
    document.getElementById('nzModalTitle').textContent = title;
    document.getElementById('nzModalLabel').textContent = label;
    const input = document.getElementById('nzModalInput');
    const labelEl = document.getElementById('nzModalLabel');
    input.placeholder = placeholder;
    input.value = value;
    // confirm模式隐藏输入框和label
    input.style.display = mode === 'confirm' ? 'none' : '';
    labelEl.style.display = mode === 'confirm' ? 'none' : '';
    const hintEl = document.getElementById('nzModalHint');
    hintEl.textContent = hint;
    hintEl.classList.toggle('warn', mode === 'confirm');
    document.getElementById('nzModalOk').textContent = okText;
    document.getElementById('nzModalMask').classList.add('show');
    document.getElementById('nzModalBox').classList.add('show');
    setTimeout(() => {
      if (mode === 'confirm') document.getElementById('nzModalOk').focus();
      else { input.focus(); input.select(); }
    }, 50);
    return new Promise(resolve => {
      this._onOk = resolve;
    });
  },
  // 确认对话框（替代confirm）
  confirm({ title = '确认', content = '', okText = '确定' }) {
    return this.show({ title, hint: content, okText, mode: 'confirm' });
  },
  hide() {
    document.getElementById('nzModalMask').classList.remove('show');
    document.getElementById('nzModalBox').classList.remove('show');
    this._onOk = null;
  },
  setHint(text, isWarn = false) {
    const hintEl = document.getElementById('nzModalHint');
    hintEl.textContent = text;
    hintEl.classList.toggle('warn', isWarn);
  }
};

document.getElementById('nzModalClose').addEventListener('click', () => {
  if (nzModal._onOk) nzModal._onOk(null);
  nzModal.hide();
});
document.getElementById('nzModalCancel').addEventListener('click', () => {
  if (nzModal._onOk) nzModal._onOk(null);
  nzModal.hide();
});
document.getElementById('nzModalMask').addEventListener('click', () => {
  if (nzModal._onOk) nzModal._onOk(null);
  nzModal.hide();
});
document.getElementById('nzModalOk').addEventListener('click', () => {
  const input = document.getElementById('nzModalInput');
  const isConfirmMode = input.style.display === 'none';
  if (isConfirmMode) {
    if (nzModal._onOk) nzModal._onOk(true);
    nzModal.hide();
    return;
  }
  const val = input.value.trim();
  if (!val) { nzModal.setHint('名称不能为空', true); input.focus(); return; }
  if (nzModal._onOk) nzModal._onOk(val);
  nzModal.hide();
});
document.getElementById('nzModalInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('nzModalOk').click(); }
  else if (e.key === 'Escape') { e.preventDefault(); document.getElementById('nzModalCancel').click(); }
});

// ---- 保存模板（每次保存即为新模板，直接保存） ----
document.getElementById('nzSaveBtn').addEventListener('click', async () => {
  if (!NZ.wb) { ntf('请先上传模板', 'warn'); return; }
  nzApplyEditsToWorkbook();

  // 弹出主题化命名输入框，默认填当前模板名
  const defaultName = NZ.currentTemplate || '';
  const name = await nzModal.show({
    title: '保存模板',
    label: '模板名称',
    value: defaultName,
    placeholder: '请输入模板名称',
    hint: '保存将创建新的模板记录',
    okText: '保存'
  });
  if (!name) return; // 用户取消

  NZ.currentTemplate = name;
  // 导出为base64
  const wbOut = XLSX.write(NZ.wb, { type: 'array', bookType: 'xlsx' });
  const b64 = arrayBufferToBase64(wbOut);

  try {
    const res = await fetch('/api/nz-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, fileData: b64 })
    });
    const data = await res.json();
    if (data.error) { ntf(data.error, 'error'); return; }
    ntf('模板已保存');
    await loadNzTemplates();
  } catch (e) {
    ntf('保存失败: ' + e.message, 'error');
  }
});

// ---- 选择已有模板 ----
document.getElementById('nzTemplateSel').addEventListener('change', async () => {
  const name = document.getElementById('nzTemplateSel').value;
  if (!name) return;
  console.log('[NZ] 模板切换:', name);
  NZ.currentTemplate = name;
  try {
    const res = await fetch(`/api/nz-templates/${encodeURIComponent(name)}`);
    if (!res.ok) { ntf(`加载模板失败 (HTTP ${res.status})`, 'error'); return; }
    const data = await res.json();
    if (data.error) { ntf(data.error, 'error'); return; }
    if (!data.fileData) { ntf('模板数据为空', 'error'); return; }
    const raw = base64ToArrayBuffer(data.fileData);
    NZ.rawBuffer = raw;
    nzParseWorkbook(raw);
    ntf(`已加载模板「${name}」`);
  } catch (e) {
    ntf('加载模板失败: ' + e.message, 'error');
  }
});

// ---- 删除模板 ----
document.getElementById('nzDeleteBtn').addEventListener('click', async () => {
  const name = NZ.currentTemplate;
  if (!name) { ntf('请先选择模板', 'warn'); return; }
  const ok = await nzModal.confirm({
    title: '删除模板',
    content: `确定删除模板「${name}」吗？此操作不可撤销。`,
    okText: '删除'
  });
  if (!ok) return;
  try {
    await fetch(`/api/nz-templates/${encodeURIComponent(name)}`, { method: 'DELETE' });
    ntf('模板已删除');
    NZ.currentTemplate = null;
    NZ.wb = null;
    document.getElementById('nzWorkspace').style.display = 'none';
    document.getElementById('nzEmpty').style.display = '';
    await loadNzTemplates();
  } catch (e) {
    ntf('删除失败', 'error');
  }
});

// ---- 下载模板 ----
document.getElementById('nzDownloadBtn').addEventListener('click', () => {
  if (!NZ.wb) { ntf('请先上传模板', 'warn'); return; }
  nzApplyEditsToWorkbook();
  const wbOut = XLSX.write(NZ.wb, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (NZ.currentTemplate || '模板') + '.xlsx';
  a.click();
  URL.revokeObjectURL(url);
});

// ---- 填充并下载 ----
document.getElementById('nzFillBtn').addEventListener('click', async () => {
  if (!NZ.wb) { ntf('请先上传模板', 'warn'); return; }
  if (!S.files.length) { ntf('请先上传数据文件并完成二级统计', 'warn'); return; }
  if (!NZ.rawBuffer) { ntf('原始模板文件不可用，请重新上传', 'error'); return; }

  // 计算统计数据发送给后端
  const statsData = nzComputeStats();
  const statsPayload = {};
  for (const [fi, fd] of Object.entries(statsData)) {
    statsPayload[fi] = {
      entries: fd.entries.map(e => ({
        name: e.name, isGroup: e.isGroup, isL1Total: e.isL1Total, isTotal: e.isTotal,
        isL1Cross: e.isL1Cross || false, isL1Subtotal: e.isL1Subtotal || false,
        l1Name: e.l1Name || '', count: e.count, pct: e.pct,
        sum: e.sum, column: e.column || '',
        acCols: fd.file.addedCols,
        acData: fd.file.addedCols.reduce((acc, ac) => {
          acc[ac] = e['ac_' + ac] || {};
          return acc;
        }, {}),
      })),
      total: { count: fd.total.count, pct: fd.total.pct, sum: fd.total.sum },
      sumCol: fd.file.sumCol || '',
      hdr: fd.file.hdr,
      l1Groups: fd.l1Groups.map(l1g => ({
        name: l1g.name, values: l1g.values || [],
        childGroupNames: (l1g.childGroupIds || []).map(cid => {
          const cg = fd.file.grps.find(x => x.id === cid);
          return cg ? cg.name : '';
        })
      })),
    };
  }

  // 构建cellEdits列表（后端用openpyxl应用到原始文件）
  const edits = [];
  Object.entries(NZ.cellEdits).forEach(([key, val]) => {
    const parts = key.split('!');
    if (parts.length !== 3) return;
    edits.push({ sheet: parseInt(parts[0]), row: parseInt(parts[1]), col: parseInt(parts[2]), value: val });
  });

  // 构建cellFormats列表
  const fmtList = [];
  Object.entries(NZ.cellFormats).forEach(([key, fmt]) => {
    const parts = key.split('!');
    if (parts.length !== 3) return;
    fmtList.push({ sheet: parseInt(parts[0]), row: parseInt(parts[1]), col: parseInt(parts[2]), fmt });
  });

  // 发送原始文件 + 编辑 + 统计数据
  const rawB64 = arrayBufferToBase64(NZ.rawBuffer);

  try {
    ntf('正在填充数据...', 'info');
    const res = await fetch('/api/nz-fill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateData: rawB64, statsData: statsPayload, cellEdits: edits, cellFormats: fmtList })
    });
    if (!res.ok) { ntf('填充失败', 'error'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (NZ.currentTemplate || '报表') + '_填充结果.xlsx';
    a.click();
    URL.revokeObjectURL(url);
    ntf('填充完成，文件已下载');
  } catch (e) {
    ntf('填充失败: ' + e.message, 'error');
  }
});

// ---- 辅助函数 ----
function nzApplyEditsToWorkbook() {
  if (!NZ.wb) return;
  Object.entries(NZ.cellEdits).forEach(([key, val]) => {
    const [si, r, c] = key.split('!').map(Number);
    const ws = NZ.wb.Sheets[NZ.wb.SheetNames[si]];
    if (!ws) return;
    const ref = XLSX.utils.encode_cell({ r, c });
    if (!ws[ref]) {
      ws[ref] = { t: 's', v: val };
    } else {
      ws[ref].v = val;
      ws[ref].t = 's';
      delete ws[ref].w;
    }
    // 扩展range
    if (ws['!ref']) {
      const range = XLSX.utils.decode_range(ws['!ref']);
      if (r > range.e.r) range.e.r = r;
      if (c > range.e.c) range.e.c = c;
      ws['!ref'] = XLSX.utils.encode_range(range);
    }
  });
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}