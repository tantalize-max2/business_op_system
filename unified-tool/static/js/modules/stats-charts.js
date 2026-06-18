// ========== stats-charts.js — 统计结果 ECharts 图表区 ==========
// 在统计结果页底部渲染柱状图和饼图，直观展示各分组数据量和占比。
// 需要 echarts（CDN 引入）、step4-stats.js 的分组数据结构。

const StatsCharts = {
  _charts: [],
  _activeFileIdx: 0,
  _chartType: 'bar',       // 'bar' | 'pie' | 'sum' | 'compare'
  _selectedGroupIds: null,  // Set<number> 选中分组 id；null = 全部
  _labelFontSize: 12,       // 图表数字标签字体大小
  _filesData: [],           // 缓存最近采集数据

  // ===== 主题色 =====
  _tc() {
    const t = document.documentElement.getAttribute('data-theme') || 'light';
    const m = {
      light:  { t1:'#1e293b', t2:'#475569', t3:'#94a3b8', bg:'#ffffff', bg2:'#f1f5f9', ln:'#cbd5e1', acc:'#0d9488', acc2:'#14b8a6' },
      dark:   { t1:'#e8edf5', t2:'#c8d3e5', t3:'#5a6f90', bg:'#1e2d48', bg2:'#131c2e', ln:'#2e4064', acc:'#2dd4bf', acc2:'#5eead4' },
      eyecare:{ t1:'#3d3524', t2:'#5a4f38', t3:'#9e917a', bg:'#fefcf5', bg2:'#f0ece2', ln:'#d4cbba', acc:'#7c6f3e', acc2:'#9e8e52' },
    };
    return m[t] || m.light;
  },

  // ===== 分组颜色盘 =====
  _palette: ['#0d9488','#6366f1','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f97316','#14b8a6','#6d28d9','#e11d48'],

  _grpColor(idx) { return this._palette[idx % this._palette.length]; },

  // ===== 主入口 =====
  render() {
    this._disposeAll();
    this._filesData = this._collectData();
    if (!this._filesData.length) return;

    const area = document.getElementById('resContent');
    if (!area) return;
    const old = document.getElementById('chartSection');
    if (old) old.remove();

    const fd = this._filesData[this._activeFileIdx] || this._filesData[0];
    if (!this._selectedGroupIds) {
      this._selectedGroupIds = new Set(fd.groups.map(g => g.id));
    }

    const section = document.createElement('div');
    section.id = 'chartSection';
    section.className = 'chart-section';
    section.innerHTML = this._buildHTML();
    area.appendChild(section);

    this._bindEvents();
    this._renderChart();
  },

  // ===== 数据采集 — 包含所有层级分组 =====
  _collectData() {
    const result = [];
    if (typeof S === 'undefined' || !S.files) return result;

    S.files.forEach((file, fi) => {
      if (!file.raw || !file.raw.length || !file.grps || !file.grps.length) return;

      const sumCol = file.sumCol || '';
      let l1Data = [];
      try {
        l1Data = typeof getFilteredData_forFile === 'function' ? getFilteredData_forFile(file) : file.raw;
      } catch (e) { l1Data = file.raw; }

      const groups = [];
      const ctxCache = {};

      file.grps.forEach((g, gi) => {
        // L1 容器分组：统计其所有子分组数据的并集
        if (g.level === 1 && g.childGroupIds && g.childGroupIds.length) {
          const subRows = new Set();
          g.childGroupIds.forEach(cid => {
            try {
              const ctx = typeof getGroupContext === 'function' ? getGroupContext(cid, l1Data, file.grps, ctxCache) : [];
              ctx.forEach(r => subRows.add(r));
            } catch (e) {}
          });
          const count = subRows.size;
          let sum = 0;
          if (sumCol) { subRows.forEach(r => { sum += parseFloat(r[sumCol]) || 0; }); }
          groups.push({
            id: g.id, name: (g.name || '未命名') + ' (L1)', level: 1,
            color: this._grpColor(gi), count, sum,
            pct: l1Data.length > 0 ? (count / l1Data.length * 100) : 0,
          });
          return;
        }

        // 非 L1 分组（含 L2/L3/L4/L5 及独立分组）
        if (g.level === 1 && g._unmatched) return;
        let ctx = [];
        try {
          if (typeof getGroupContext === 'function') {
            ctx = getGroupContext(g.id, l1Data, file.grps, ctxCache);
          }
        } catch (e) { ctx = []; }

        const count = ctx.length;
        // 0 行的也收集进来（保证分组选择器完整）
        let sum = 0;
        if (sumCol && count > 0) {
          sum = ctx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
        }

        // 构建 label：多级分组带层级前缀
        let label = g.name || '未命名';
        if (g.level && g.level >= 3) {
          // 获取父级路径用于 label
          try {
            if (typeof getGroupPath === 'function') {
              const path = getGroupPath(g.id, file.grps);
              if (path.length > 1) label = path.join('·');
            }
          } catch (e) {}
        }
        // 标注依托关系
        let depLabel = '';
        if (g.parentIds && g.parentIds.length) {
          const pNames = g.parentIds.map(pid => { const pg = file.grps.find(x => x.id === pid); return pg ? pg.name : ''; }).filter(Boolean);
          const pRels = g.parentRels || [];
          depLabel = pNames.map((n, i) => `${pRels[i] || 'AND'}→${n}`).join(' ');
        } else if (g.parentId) {
          const pg = file.grps.find(x => x.id === g.parentId);
          if (pg) depLabel = `${g.parentRel || 'AND'}→${pg.name}`;
        }

        groups.push({
          id: g.id, name: label, level: g.level || 2,
          depLabel, color: this._grpColor(gi),
          count, sum, pct: l1Data.length > 0 ? (count / l1Data.length * 100) : 0,
        });
      });

      if (groups.length > 0) {
        result.push({
          fileIdx: fi, fileName: file.name || `文件${fi + 1}`,
          totalRows: l1Data.length, sumCol, groups,
        });
      }
    });

    return result;
  },

  // ===== HTML =====
  _buildHTML() {
    const fds = this._filesData;
    const fd = fds[this._activeFileIdx] || fds[0];

    // 文件 tab
    const fileTabs = fds.map((f, i) =>
      `<span class="chart-tab ${i === this._activeFileIdx ? 'active' : ''}" data-file-idx="${i}">${this._esc(f.fileName)}</span>`
    ).join('');

    // 分组选择 checkbox（按 level 分组展示）
    const groupedByLevel = {};
    fd.groups.forEach(g => {
      const lv = g.level || 2;
      if (!groupedByLevel[lv]) groupedByLevel[lv] = [];
      groupedByLevel[lv].push(g);
    });
    const levelNames = { 1: '一级分组', 2: '二级分组', 3: '三级分组', 4: '四级分组', 5: '五级分组' };
    let grpChecksHtml = '';
    Object.keys(groupedByLevel).sort((a, b) => a - b).forEach(lv => {
      grpChecksHtml += `<div class="chart-grp-lv-label">${levelNames[lv] || lv + '级分组'}</div>`;
      groupedByLevel[lv].forEach(g => {
        const checked = this._selectedGroupIds.has(g.id) ? 'checked' : '';
        const dep = g.depLabel ? `<span class="chart-grp-dep">${this._esc(g.depLabel)}</span>` : '';
        grpChecksHtml += `<label class="chart-grp-check"><input type="checkbox" data-grp-id="${g.id}" ${checked}><span>${this._esc(g.name)}${dep}</span></label>`;
      });
    });

    // 字体大小选项
    const fontOpts = [10, 11, 12, 13, 14, 16, 18].map(v =>
      `<option value="${v}" ${v === this._labelFontSize ? 'selected' : ''}>${v}px</option>`
    ).join('');

    return `
      <div class="chart-section-title">
        <svg class="icon" aria-hidden="true" style="width:20px;height:20px"><use xlink:href="#icon-chart"></use></svg>
        数据可视化
      </div>
      <div class="chart-tabs">${fileTabs}</div>
      <div class="chart-toolbar">
        <span class="chart-tab ${this._chartType === 'bar' ? 'active' : ''}" data-chart-type="bar">柱状图</span>
        <span class="chart-tab ${this._chartType === 'pie' ? 'active' : ''}" data-chart-type="pie">饼图</span>
        ${fd.sumCol ? `<span class="chart-tab ${this._chartType === 'sum' ? 'active' : ''}" data-chart-type="sum">求和对比</span>` : ''}
        <span class="chart-tab ${this._chartType === 'compare' ? 'active' : ''}" data-chart-type="compare">多分组对比</span>
        <div class="chart-toolbar-right">
          <label class="chart-font-ctrl">字号 <select id="chartFontSize">${fontOpts}</select></label>
          <span class="chart-tab chart-grp-toggle" id="chartGrpToggle" title="选择展示的分组">分组筛选</span>
        </div>
      </div>
      <div class="chart-grp-panel" id="chartGrpPanel" style="display:none">
        <div class="chart-grp-panel-head">
          <span>选择展示分组</span>
          <div>
            <button class="btn btn-ghost btn-xs" id="chartGrpAll">全选</button>
            <button class="btn btn-ghost btn-xs" id="chartGrpNone">全不选</button>
          </div>
        </div>
        <div class="chart-grp-panel-body" id="chartGrpList">${grpChecksHtml}</div>
      </div>
      <div class="chart-grid">
        <div class="chart-box">
          <div class="chart-box-header">
            <div class="chart-box-title" id="chartBoxTitle1">分组数据量分布</div>
            <button class="btn btn-ghost btn-xs chart-dl-btn" data-dl-target="statsChartMain" title="保存为图片">
              <svg class="icon" aria-hidden="true" style="width:14px;height:14px"><use xlink:href="#icon-download"></use></svg>
            </button>
          </div>
          <div id="statsChartMain" class="chart-canvas"></div>
        </div>
        <div class="chart-box">
          <div class="chart-box-header">
            <div class="chart-box-title" id="chartBoxTitle2">分组占比</div>
            <button class="btn btn-ghost btn-xs chart-dl-btn" data-dl-target="statsChartSide" title="保存为图片">
              <svg class="icon" aria-hidden="true" style="width:14px;height:14px"><use xlink:href="#icon-download"></use></svg>
            </button>
          </div>
          <div id="statsChartSide" class="chart-canvas"></div>
        </div>
      </div>`;
  },

  // ===== 事件 =====
  _bindEvents() {
    const sec = document.getElementById('chartSection');
    if (!sec) return;

    // 文件切换
    sec.querySelectorAll('[data-file-idx]').forEach(tab => {
      tab.addEventListener('click', () => {
        this._activeFileIdx = +tab.dataset.fileIdx;
        const fd = this._filesData[this._activeFileIdx];
        this._selectedGroupIds = new Set(fd.groups.map(g => g.id));
        sec.querySelectorAll('[data-file-idx]').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._rebuildGroupPanel(fd);
        this._renderChart();
      });
    });

    // 图表类型
    sec.querySelectorAll('[data-chart-type]').forEach(tab => {
      tab.addEventListener('click', () => {
        this._chartType = tab.dataset.chartType;
        sec.querySelectorAll('[data-chart-type]').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._renderChart();
      });
    });

    // 字体大小
    const fontSel = document.getElementById('chartFontSize');
    if (fontSel) {
      fontSel.addEventListener('change', () => {
        this._labelFontSize = +fontSel.value;
        this._renderChart();
      });
    }

    // 分组面板
    const grpToggle = document.getElementById('chartGrpToggle');
    const grpPanel = document.getElementById('chartGrpPanel');
    if (grpToggle && grpPanel) {
      grpToggle.addEventListener('click', () => {
        grpPanel.style.display = grpPanel.style.display === 'none' ? '' : 'none';
      });
    }

    // 全选/全不选
    const grpAll = document.getElementById('chartGrpAll');
    const grpNone = document.getElementById('chartGrpNone');
    if (grpAll) grpAll.addEventListener('click', () => this._setAllGroups(true));
    if (grpNone) grpNone.addEventListener('click', () => this._setAllGroups(false));

    // 单个分组
    const grpList = document.getElementById('chartGrpList');
    if (grpList) {
      grpList.addEventListener('change', (e) => {
        if (e.target.type === 'checkbox' && e.target.dataset.grpId) {
          const gid = +e.target.dataset.grpId;
          e.target.checked ? this._selectedGroupIds.add(gid) : this._selectedGroupIds.delete(gid);
          this._renderChart();
        }
      });
    }

    // 下载
    sec.querySelectorAll('.chart-dl-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const el = document.getElementById(btn.dataset.dlTarget);
        if (!el) return;
        const chart = echarts.getInstanceByDom(el);
        if (!chart) return;
        const url = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: this._tc().bg });
        const a = document.createElement('a');
        a.href = url;
        a.download = (btn.dataset.dlTarget === 'statsChartMain' ? '图表-主图' : '图表-副图') + '.png';
        a.click();
      });
    });

    // 主题变化
    this._themeObs && this._themeObs.disconnect();
    this._themeObs = new MutationObserver(() => this._renderChart());
    this._themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  },

  _rebuildGroupPanel(fd) {
    const grpList = document.getElementById('chartGrpList');
    if (!grpList) return;
    // 复用 _buildHTML 的分组选择器逻辑，只重建 checkbox 区
    const groupedByLevel = {};
    fd.groups.forEach(g => {
      const lv = g.level || 2;
      if (!groupedByLevel[lv]) groupedByLevel[lv] = [];
      groupedByLevel[lv].push(g);
    });
    const levelNames = { 1: '一级分组', 2: '二级分组', 3: '三级分组', 4: '四级分组', 5: '五级分组' };
    let html = '';
    Object.keys(groupedByLevel).sort((a, b) => a - b).forEach(lv => {
      html += `<div class="chart-grp-lv-label">${levelNames[lv] || lv + '级分组'}</div>`;
      groupedByLevel[lv].forEach(g => {
        const checked = this._selectedGroupIds.has(g.id) ? 'checked' : '';
        const dep = g.depLabel ? `<span class="chart-grp-dep">${this._esc(g.depLabel)}</span>` : '';
        html += `<label class="chart-grp-check"><input type="checkbox" data-grp-id="${g.id}" ${checked}><span>${this._esc(g.name)}${dep}</span></label>`;
      });
    });
    grpList.innerHTML = html;
    const grpPanel = document.getElementById('chartGrpPanel');
    if (grpPanel) grpPanel.style.display = 'none';
  },

  _setAllGroups(selectAll) {
    const fd = this._filesData[this._activeFileIdx];
    if (!fd) return;
    this._selectedGroupIds = selectAll ? new Set(fd.groups.map(g => g.id)) : new Set();
    const grpList = document.getElementById('chartGrpList');
    if (grpList) grpList.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = selectAll; });
    this._renderChart();
  },

  // ===== 渲染调度 =====
  _getFilteredGroups() {
    const fd = this._filesData[this._activeFileIdx];
    if (!fd) return [];
    return fd.groups.filter(g => this._selectedGroupIds.has(g.id));
  },

  _renderChart() {
    const groups = this._getFilteredGroups();
    if (!groups.length) {
      ['statsChartMain', 'statsChartSide'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { const c = echarts.getInstanceByDom(el); if (c) c.clear(); }
      });
      return;
    }
    if (typeof echarts === 'undefined') return;

    const tc = this._tc();
    const fd = this._filesData[this._activeFileIdx];
    const mainEl = document.getElementById('statsChartMain');
    const sideEl = document.getElementById('statsChartSide');
    const title1 = document.getElementById('chartBoxTitle1');
    const title2 = document.getElementById('chartBoxTitle2');

    // 先销毁
    [mainEl, sideEl].forEach(el => {
      if (el) { const c = echarts.getInstanceByDom(el); if (c) c.dispose(); }
    });

    const fs = this._labelFontSize;

    if (this._chartType === 'compare') {
      title1.textContent = '多分组数量对比';
      title2.textContent = '多分组占比对比';
      this._renderCompareBar(mainEl, groups, tc, fs);
      this._renderComparePie(sideEl, groups, tc, fs);
    } else if (this._chartType === 'sum' && fd && fd.sumCol) {
      title1.textContent = `${fd.sumCol} 求和对比`;
      title2.textContent = '数量 vs 求和';
      this._renderSumBar(mainEl, groups, fd.sumCol, tc, fs);
      this._renderDualBar(sideEl, groups, tc, fs);
    } else if (this._chartType === 'pie') {
      title1.textContent = '分组数据量占比';
      title2.textContent = 'Top 8 分组';
      this._renderPie(mainEl, groups, false, tc, fs);
      this._renderPie(sideEl, groups.slice(0, 8), true, tc, fs);
    } else {
      title1.textContent = '分组数据量分布';
      title2.textContent = '分组数据量占比';
      this._renderBar(mainEl, groups, tc, fs);
      this._renderPie(sideEl, groups.slice(0, 8), true, tc, fs);
    }
  },

  // ===== 通用 ECharts 选项基础 =====
  _baseOpt(tc) {
    return {
      backgroundColor: 'transparent',
      tooltip: { backgroundColor: tc.bg, borderColor: tc.ln, textStyle: { color: tc.t1 } },
    };
  },

  // ===== 柱状图 =====
  _renderBar(el, groups, tc, fs) {
    const chart = echarts.init(el);
    const names = groups.map(g => g.name);
    const counts = groups.map(g => g.count);
    const opt = this._baseOpt(tc);
    Object.assign(opt, {
      tooltip: { ...opt.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: '3%', right: '5%', bottom: '12%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category', data: names,
        axisLabel: { rotate: names.length > 5 ? 30 : 0, fontSize: Math.max(10, fs - 1), color: tc.t2, interval: 0, overflow: 'truncate', width: 80 },
        axisLine: { lineStyle: { color: tc.ln } },
        axisTick: { lineStyle: { color: tc.ln } },
      },
      yAxis: {
        type: 'value', name: '数量',
        nameTextStyle: { color: tc.t2, fontSize: fs },
        axisLabel: { color: tc.t2, fontSize: fs - 1 },
        splitLine: { lineStyle: { color: tc.ln, type: 'dashed' } },
      },
      series: [{
        type: 'bar', data: counts, barMaxWidth: 48,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: tc.acc }, { offset: 1, color: tc.acc2 },
          ]),
          borderRadius: [4, 4, 0, 0],
        },
        label: {
          show: true, position: 'top', fontSize: fs, color: tc.t1,
          formatter: function(p) { return p.value > 0 ? p.value : ''; },
        },
      }],
    });
    chart.setOption(opt);
    this._push(chart);
  },

  // ===== 饼图 =====
  _renderPie(el, groups, isDonut, tc, fs) {
    const chart = echarts.init(el);
    const data = groups.map(g => ({ name: g.name, value: g.count, itemStyle: { color: g.color } }));
    const opt = this._baseOpt(tc);
    Object.assign(opt, {
      tooltip: {
        ...opt.tooltip, trigger: 'item',
        formatter: function(p) { return p.name + ': ' + p.value + ' (' + p.percent + '%)'; },
      },
      legend: { type: 'scroll', orient: 'vertical', right: 5, top: 'center', textStyle: { fontSize: Math.max(10, fs - 1), color: tc.t2 } },
      series: [{
        type: 'pie',
        radius: isDonut ? ['35%', '60%'] : '60%',
        center: ['35%', '50%'],
        data,
        label: {
          fontSize: Math.max(10, fs - 1), color: tc.t1,
          formatter: function(p) { return p.name + '\n' + p.value + ' (' + p.percent + '%)'; },
        },
        labelLayout: { hideOverlap: true },
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' } },
      }],
    });
    chart.setOption(opt);
    this._push(chart);
  },

  // ===== 求和柱状图 =====
  _renderSumBar(el, groups, sumCol, tc, fs) {
    const chart = echarts.init(el);
    const names = groups.map(g => g.name);
    const opt = this._baseOpt(tc);
    Object.assign(opt, {
      tooltip: { ...opt.tooltip, trigger: 'axis' },
      grid: { left: '3%', right: '5%', bottom: '12%', top: '12%', containLabel: true },
      xAxis: {
        type: 'category', data: names,
        axisLabel: { rotate: names.length > 5 ? 30 : 0, fontSize: Math.max(10, fs - 1), color: tc.t2, interval: 0 },
        axisLine: { lineStyle: { color: tc.ln } },
      },
      yAxis: {
        type: 'value', name: sumCol, nameTextStyle: { color: tc.t2 },
        axisLabel: { color: tc.t2 }, splitLine: { lineStyle: { color: tc.ln, type: 'dashed' } },
      },
      series: [{
        name: sumCol + '求和', type: 'bar', barMaxWidth: 48,
        data: groups.map(g => Math.round(g.sum * 100) / 100),
        itemStyle: { color: '#6366f1', borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', fontSize: fs, color: tc.t1, formatter: function(p) { return p.value > 0 ? p.value : ''; } },
      }],
    });
    chart.setOption(opt);
    this._push(chart);
  },

  // ===== 双轴柱状图 =====
  _renderDualBar(el, groups, tc, fs) {
    const chart = echarts.init(el);
    const names = groups.map(g => g.name);
    const opt = this._baseOpt(tc);
    Object.assign(opt, {
      tooltip: { ...opt.tooltip, trigger: 'axis' },
      legend: { data: ['数量', '求和'], bottom: 0, textStyle: { color: tc.t2 } },
      grid: { left: '3%', right: '5%', bottom: '14%', top: '12%', containLabel: true },
      xAxis: {
        type: 'category', data: names,
        axisLabel: { rotate: names.length > 5 ? 30 : 0, fontSize: Math.max(10, fs - 1), color: tc.t2, interval: 0 },
        axisLine: { lineStyle: { color: tc.ln } },
      },
      yAxis: [
        { type: 'value', name: '数量', position: 'left', nameTextStyle: { color: tc.t2 }, axisLabel: { color: tc.t2 }, splitLine: { lineStyle: { color: tc.ln, type: 'dashed' } } },
        { type: 'value', name: '求和', position: 'right', nameTextStyle: { color: tc.t2 }, axisLabel: { color: tc.t2 }, splitLine: { show: false } },
      ],
      series: [
        { name: '数量', type: 'bar', barMaxWidth: 32, data: groups.map(g => g.count), itemStyle: { color: tc.acc, borderRadius: [4, 4, 0, 0] }, label: { show: true, position: 'top', fontSize: fs, color: tc.t1 } },
        { name: '求和', type: 'bar', barMaxWidth: 32, yAxisIndex: 1, data: groups.map(g => Math.round(g.sum * 100) / 100), itemStyle: { color: '#6366f1', borderRadius: [4, 4, 0, 0] }, label: { show: true, position: 'top', fontSize: fs, color: tc.t1 } },
      ],
    });
    chart.setOption(opt);
    this._push(chart);
  },

  // ===== 多分组对比 — 分组柱状图 =====
  _renderCompareBar(el, groups, tc, fs) {
    const chart = echarts.init(el);
    const names = groups.map(g => g.name);
    const counts = groups.map(g => g.count);
    const pcts = groups.map(g => +g.pct.toFixed(1));
    const sums = groups.map(g => Math.round(g.sum * 100) / 100);
    const opt = this._baseOpt(tc);
    Object.assign(opt, {
      tooltip: { ...opt.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['数量', '占比(%)'], bottom: 0, textStyle: { color: tc.t2 } },
      grid: { left: '3%', right: '5%', bottom: '14%', top: '12%', containLabel: true },
      xAxis: {
        type: 'category', data: names,
        axisLabel: { rotate: names.length > 5 ? 30 : 0, fontSize: Math.max(10, fs - 1), color: tc.t2, interval: 0 },
        axisLine: { lineStyle: { color: tc.ln } },
      },
      yAxis: [
        { type: 'value', name: '数量', position: 'left', nameTextStyle: { color: tc.t2 }, axisLabel: { color: tc.t2 }, splitLine: { lineStyle: { color: tc.ln, type: 'dashed' } } },
        { type: 'value', name: '占比(%)', position: 'right', nameTextStyle: { color: tc.t2 }, axisLabel: { color: tc.t2 }, splitLine: { show: false } },
      ],
      series: [
        {
          name: '数量', type: 'bar', barMaxWidth: 36,
          data: counts,
          itemStyle: { color: tc.acc, borderRadius: [4, 4, 0, 0] },
          label: { show: true, position: 'top', fontSize: fs, color: tc.t1, formatter: function(p) { return p.value > 0 ? p.value : ''; } },
        },
        {
          name: '占比(%)', type: 'line', yAxisIndex: 1,
          data: pcts,
          lineStyle: { color: '#f59e0b', width: 2 },
          itemStyle: { color: '#f59e0b' },
          symbol: 'circle', symbolSize: 8,
          label: { show: true, fontSize: fs, color: tc.t1, formatter: function(p) { return p.value + '%'; } },
        },
      ],
    });
    // 如果有求和列，额外添加求和折线
    const fd = this._filesData[this._activeFileIdx];
    if (fd && fd.sumCol) {
      opt.legend.data.push(fd.sumCol + '求和');
      opt.series.push({
        name: fd.sumCol + '求和', type: 'bar', barMaxWidth: 36, yAxisIndex: 0,
        data: sums,
        itemStyle: { color: '#6366f1', borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', fontSize: fs, color: tc.t1 },
      });
    }
    chart.setOption(opt);
    this._push(chart);
  },

  // ===== 多分组对比 — 对比饼图 =====
  _renderComparePie(el, groups, tc, fs) {
    const chart = echarts.init(el);
    // 按 level 拆分成多个子饼图环形
    const levels = [...new Set(groups.map(g => g.level))].sort((a, b) => a - b);
    const levelNames = { 1: '一级', 2: '二级', 3: '三级', 4: '四级', 5: '五级' };

    if (levels.length <= 1) {
      // 单层级直接画饼图
      this._renderPie(el, groups, false, tc, fs);
      return;
    }

    // 多层级：嵌套环形图
    const seriesList = levels.map((lv, i) => {
      const lvGroups = groups.filter(g => g.level === lv);
      const innerR = 15 + i * 22;
      const outerR = innerR + 20;
      return {
        type: 'pie',
        radius: [innerR + '%', outerR + '%'],
        center: ['40%', '50%'],
        data: lvGroups.map(g => ({ name: g.name, value: g.count, itemStyle: { color: g.color } })),
        label: {
          fontSize: Math.max(9, fs - 2), color: tc.t1,
          formatter: function(p) { return p.value > 0 ? p.name : ''; },
          position: i === levels.length - 1 ? 'outside' : 'inside',
        },
        labelLine: { show: i === levels.length - 1 },
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.2)' } },
      };
    });

    const opt = this._baseOpt(tc);
    Object.assign(opt, {
      tooltip: {
        ...opt.tooltip, trigger: 'item',
        formatter: function(p) { return p.seriesName + ' - ' + p.name + ': ' + p.value + ' (' + p.percent + '%)'; },
      },
      legend: { type: 'scroll', orient: 'vertical', right: 0, top: 'middle', textStyle: { fontSize: Math.max(10, fs - 1), color: tc.t2 } },
      series: seriesList.map((s, i) => ({
        ...s,
        name: (levelNames[levels[i]] || levels[i] + '级') + '分组',
      })),
    });
    chart.setOption(opt);
    this._push(chart);
  },

  // ===== 工具 =====
  _push(chart) {
    this._charts.push(chart);
    const h = () => { try { chart.resize(); } catch(e) {} };
    window.addEventListener('resize', h);
    chart._rh = h;
  },

  _disposeAll() {
    this._charts.forEach(c => { try { c.dispose(); } catch(e) {} });
    this._charts = [];
    this._themeObs && this._themeObs.disconnect();
  },

  _esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  },
};
