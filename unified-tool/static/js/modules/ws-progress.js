// ========== ws-progress.js — WebSocket 任务进度客户端 ==========
// 连接后端 SocketIO，监听 task_progress 事件，实时更新进度条 UI。
// 后端在拆分/PPT生成等长任务中通过 emit_progress 发送进度。

const TaskProgress = {
  _socket: null,
  _connected: false,
  _overlay: null,
  _bar: null,
  _text: null,
  _pct: null,

  init() {
    if (this._socket) return;
    // socket.io 库未加载（如 CDN 失败）或连接失败时，降级为模拟进度模式
    if (typeof io === 'undefined') {
      console.warn('[WS] SocketIO 库未加载，进度条使用模拟模式');
      this._connected = false;
      return;
    }
    try {
      this._socket = io({ transports: ['websocket', 'polling'], reconnectionAttempts: 2 });
      this._socket.on('connect', () => { this._connected = true; console.log('[WS] 进度推送已连接'); });
      this._socket.on('connect_error', () => { this._connected = false; });
      this._socket.on('disconnect', () => { this._connected = false; });
      this._socket.on('task_progress', (data) => this._onProgress(data));
    } catch (e) {
      console.warn('[WS] SocketIO 连接失败，进度条使用模拟模式', e);
      this._connected = false;
    }
  },

  /** 确保 overlay DOM 存在 */
  _ensureOverlay() {
    if (this._overlay) return;
    this._overlay = document.getElementById('wsProgressOverlay');
    if (!this._overlay) {
      // 动态创建进度遮罩
      this._overlay = document.createElement('div');
      this._overlay.id = 'wsProgressOverlay';
      this._overlay.className = 'progress-overlay';
      this._overlay.style.display = 'none';
      this._overlay.innerHTML = `
        <div class="progress-card" style="min-width:360px;">
          <div class="ws-progress-header">
            <div class="spinner" style="width:28px;height:28px;border-width:3px;flex-shrink:0;"></div>
            <span class="ws-progress-title">正在执行任务...</span>
          </div>
          <div class="ws-progress-bar-wrap">
            <div class="ws-progress-bar" id="wsProgressBar" style="width:0%"></div>
          </div>
          <div class="ws-progress-info">
            <span class="ws-progress-text" id="wsProgressText">准备中...</span>
            <span class="ws-progress-pct" id="wsProgressPct">0%</span>
          </div>
        </div>
      `;
      document.body.appendChild(this._overlay);
    }
    this._bar = document.getElementById('wsProgressBar');
    this._text = document.getElementById('wsProgressText');
    this._pct = document.getElementById('wsProgressPct');
  },

  /** 收到进度事件 */
  _onProgress(data) {
    this._ensureOverlay();
    const { task, percent, message, done } = data;

    // 任务标题映射
    const titleMap = { split: '分局拆分', ppt: 'PPT通报生成' };
    const titleEl = this._overlay.querySelector('.ws-progress-title');
    if (titleEl) titleEl.textContent = (titleMap[task] || task) + '...';

    this._bar.style.width = percent + '%';
    this._pct.textContent = Math.round(percent) + '%';
    if (message) this._text.textContent = message;

    if (done) {
      // 完成后延迟隐藏
      this._bar.style.width = '100%';
      this._pct.textContent = '100%';
      setTimeout(() => { this._overlay.style.display = 'none'; }, 800);
    } else {
      this._overlay.style.display = '';
    }
  },

  /** 手动显示进度遮罩（任务开始前调用）。WebSocket 不可用时启动模拟进度。 */
  show(task) {
    this._ensureOverlay();
    const titleMap = { split: '分局拆分', ppt: 'PPT通报生成' };
    const titleEl = this._overlay.querySelector('.ws-progress-title');
    if (titleEl) titleEl.textContent = (titleMap[task] || task) + '...';
    this._bar.style.width = '0%';
    this._pct.textContent = '0%';
    this._text.textContent = this._connected ? '准备中...' : '正在处理，请稍候...';
    this._overlay.style.display = '';

    // WebSocket 未连接时启动模拟进度（从 0 慢速递增到 90%，完成任务后由 hide 收尾）
    if (!this._connected) {
      this._simPercent = 0;
      clearInterval(this._simTimer);
      this._simTimer = setInterval(() => {
        this._simPercent = Math.min(90, this._simPercent + Math.random() * 8 + 2);
        this._bar.style.width = this._simPercent + '%';
        this._pct.textContent = Math.round(this._simPercent) + '%';
      }, 600);
    }
  },

  /** 手动隐藏 */
  hide() {
    clearInterval(this._simTimer);
    if (this._overlay) this._overlay.style.display = 'none';
  },
};

// 页面加载后自动初始化 WebSocket 连接
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => TaskProgress.init());
} else {
  TaskProgress.init();
}
