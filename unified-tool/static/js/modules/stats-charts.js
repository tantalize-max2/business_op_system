// ========== stats-charts.js — 统计结果 ECharts 图表区 ==========
// 在统计结果页底部渲染柱状图和饼图，直观展示各分组数据量和占比。
// 依赖：echarts（CDN 引入）、step4-stats.js 的分组数据结构。

const StatsCharts = {
  _charts: [], // 已创建的 ECharts 实例（用于 dispose 防止内存泄漏）
  _activeFileIdx: 0,
  _chartType: 'bar', // 'bar' | 'pie'

  /**
   * 渲染图表区。在 calcAllStats 末尾调用。
   * 从 S.files 中提取每个文件的分组统计数据。
   */
  render() {
    this._disposeAll();

    // 收集图表数据
    const filesData = this._collectData();
    if (!filesData.length) return;

    // 确保 DOM 容器存在
    const area = document.getElementById('resContent');
    if (!area) return;

    // 移除旧图表区
    const oldSection = document.getElementById('chartSection');
    if (oldSection) oldSection.remove();

    // 构建图表区 HTML
    const section = document.createElement('div');
    section.id = 'chartSection';
    section.className = 'chart-section';
    section.innerHTML = this._buildHTML(filesData);
    area.appendChild(section);

    // 绑定事件
    this._bindEvents(filesData);

    // 渲染初始图表
    this._renderChart(filesData[this._activeFileIdx] || filesData[0]);
  },

  /**
   * 从 S.files 收集每个文件的分组统计数据。
   */
  _collectData() {
    const result = [];
    if (typeof S === 'undefined' || !S.files) return result;

    S.files.forEach((file, fi) => {
      if (!file.raw || !file.raw.length || !file.grps || !file.grps.length) return;

      const sumCol = file.sumCol || '';
      let l1Data = [];
      try {
        if (typeof getFilteredData_forFile === 'function') {
          l1Data = getFilteredData_forFile(file);
        } else {
          l1Data = file.raw;
        }
      } catch (e) { l1Data = file.raw; }

      // 收集所有有数据的分组（L2 及以下）
      const groups = [];
      file.grps.forEach(g => {
        if (g.level === 1 && g.childGroupIds && g.childGroupIds.length) return; // 跳过 L1 容器
        let ctx = [];
        try {
          if (typeof getGroupContext === 'function') {
            ctx = getGroupContext(g.id, l1Data, file.grps, {});
          }
        } catch (e) { ctx = []; }

        const count = ctx.length;
        if (count > 0) {
          let sum = 0;
          if (sumCol) {
            sum = ctx.reduce((a, r) => a + (parseFloat(r[sumCol]) || 0), 0);
          }
          groups.push({
            name: g.name || '未命名',
            color: g.color || 'teal',
            count,
            sum,
            pct: l1Data.length > 0 ? (count / l1Data.length * 100) : 0,
          });
        }
      });

      if (groups.length > 0) {
        // 按数量降序排列
        groups.sort((a, b) => b.count - a.count);
        result.push({
          fileIdx: fi,
          fileName: file.name || `文件${fi + 1}`,
          totalRows: l1Data.length,
          sumCol,
          groups,
        });
      }
    });

    return result;
  },

  _buildHTML(filesData) {
    const fileTabs = filesData.map((fd, i) =>
      `<span class="chart-tab ${i === this._activeFileIdx ? 'active' : ''}" data-file-idx="${i}">${this._esc(fd.fileName)}</span>`
    ).join('');

    return `
      <div class="chart-section-title">
        <svg class="icon" aria-hidden="true" style="width:20px;height:20px"><use xlink:href="#icon-chart"></use></svg>
        数据可视化
      </div>
      <div class="chart-tabs">${fileTabs}</div>
      <div class="chart-tabs">
        <span class="chart-tab ${this._chartType === 'bar' ? 'active' : ''}" data-chart-type="bar">柱状图</span>
        <span class="chart-tab ${this._chartType === 'pie' ? 'active' : ''}" data-chart-type="pie">饼图</span>
        <span class="chart-tab ${this._chartType === 'sum' ? 'active' : ''}" data-chart-type="sum">${filesData[0]?.sumCol ? '求和对比' : ''}</span>
      </div>
      <div class="chart-grid">
        <div class="chart-box">
          <div class="chart-box-title" id="chartBoxTitle1">分组数据量分布</div>
          <div id="statsChartMain" class="chart-canvas"></div>
        </div>
        <div class="chart-box">
          <div class="chart-box-title" id="chartBoxTitle2">分组占比</div>
          <div id="statsChartSide" class="chart-canvas"></div>
        </div>
      </div>
    `;
  },

  _bindEvents(filesData) {
    const section = document.getElementById('chartSection');
    if (!section) return;

    // 文件切换
    section.querySelectorAll('[data-file-idx]').forEach(tab => {
      tab.addEventListener('click', () => {
        this._activeFileIdx = +tab.dataset.fileIdx;
        section.querySelectorAll('[data-file-idx]').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._renderChart(filesData[this._activeFileIdx]);
      });
    });

    // 图表类型切换
    section.querySelectorAll('[data-chart-type]').forEach(tab => {
      tab.addEventListener('click', () => {
        const type = tab.dataset.chartType;
        if (!type) return;
        this._chartType = type;
        section.querySelectorAll('[data-chart-type]').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._renderChart(filesData[this._activeFileIdx]);
      });
    });
  },

  _renderChart(fileData) {
    if (!fileData || !fileData.groups.length) return;
    if (typeof echarts === 'undefined') return;

    const groups = fileData.groups.slice(0, 20); // 最多显示20个分组
    const names = groups.map(g => g.name);
    const counts = groups.map(g => g.count);

    // 主图表（柱状图或饼图）
    const mainEl = document.getElementById('statsChartMain');
    const sideEl = document.getElementById('statsChartSide');
    const title1 = document.getElementById('chartBoxTitle1');
    const title2 = document.getElementById('chartBoxTitle2');

    if (this._chartType === 'sum' && fileData.sumCol) {
      // 求和对比图
      title1.textContent = `${fileData.sumCol} 求和对比`;
      title2.textContent = '数量 vs 求和';
      this._renderSumChart(mainEl, groups, fileData.sumCol);
      this._renderDualBar(sideEl, groups);
    } else if (this._chartType === 'pie') {
      title1.textContent = '分组数据量占比';
      title2.textContent = 'Top 8 分组';
      this._renderPie(mainEl, groups);
      this._renderPie(sideEl, groups.slice(0, 8), true);
    } else {
      // 默认柱状图
      title1.textContent = '分组数据量分布';
      title2.textContent = '分组数据量占比';
      this._renderBar(mainEl, names, counts);
      this._renderPie(sideEl, groups.slice(0, 8), true);
    }
  },

  _renderBar(el, names, counts) {
    const chart = echarts.init(el);
    this._charts.push(chart);
    chart.setOption({
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
      xAxis: {
        type: 'category',
        data: names,
        axisLabel: { rotate: names.length > 6 ? 35 : 0, fontSize: 11, color: 'var(--t2)' },
      },
      yAxis: { type: 'value', name: '数量' },
      series: [{
        type: 'bar',
        data: counts,
        itemStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: '#0d9488' }, { offset: 1, color: '#14b8a6' }] },
          borderRadius: [4, 4, 0, 0],
        },
        label: { show: true, position: 'top', fontSize: 11 },
      }],
    });
  },

  _renderPie(el, groups, isDonut) {
    const chart = echarts.init(el);
    this._charts.push(chart);
    const data = groups.map(g => ({ name: g.name, value: g.count }));
    chart.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { type: 'scroll', orient: 'vertical', right: 5, top: 'center', textStyle: { fontSize: 11 } },
      series: [{
        type: 'pie',
        radius: isDonut ? ['35%', '60%'] : '60%',
        center: ['35%', '50%'],
        data,
        label: { fontSize: 11 },
        emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.3)' } },
      }],
    });
  },

  _renderSumChart(el, groups, sumCol) {
    const chart = echarts.init(el);
    this._charts.push(chart);
    const names = groups.map(g => g.name);
    chart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { data: [sumCol + '求和'], bottom: 0 },
      grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
      xAxis: { type: 'category', data: names, axisLabel: { rotate: names.length > 6 ? 35 : 0, fontSize: 11 } },
      yAxis: { type: 'value', name: sumCol },
      series: [{
        name: sumCol + '求和',
        type: 'bar',
        data: groups.map(g => Math.round(g.sum * 100) / 100),
        itemStyle: { color: '#6366f1', borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', fontSize: 11 },
      }],
    });
  },

  _renderDualBar(el, groups) {
    const chart = echarts.init(el);
    this._charts.push(chart);
    chart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { data: ['数量', '求和'], bottom: 0 },
      grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
      xAxis: { type: 'category', data: groups.map(g => g.name), axisLabel: { rotate: 35, fontSize: 11 } },
      yAxis: [
        { type: 'value', name: '数量', position: 'left' },
        { type: 'value', name: '求和', position: 'right' },
      ],
      series: [
        { name: '数量', type: 'bar', data: groups.map(g => g.count), itemStyle: { color: '#0d9488', borderRadius: [4, 4, 0, 0] } },
        { name: '求和', type: 'bar', yAxisIndex: 1, data: groups.map(g => Math.round(g.sum * 100) / 100), itemStyle: { color: '#6366f1', borderRadius: [4, 4, 0, 0] } },
      ],
    });
  },

  _disposeAll() {
    this._charts.forEach(c => { try { c.dispose(); } catch (e) {} });
    this._charts = [];
  },

  _esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  },
};
