// ========== module-loader.js — 按步骤懒加载引擎 ==========
// 只有用户首次访问某步骤时才加载对应 JS，之后缓存不再重复加载。
// 首屏必需的 common.js 和 step1-upload.js 在 index.html 中静态加载，不经过这里。

const ModuleLoader = {
  // 已加载完成的步骤
  _loaded: new Set(),
  // 正在加载中的步骤（防止重复加载）
  _loading: new Map(),

  // 步骤名 → 需加载的脚本列表（按顺序加载，前一个加载完才加载下一个）
  _stepScripts: {
    filter1:   ['js/modules/step2-filter.js'],
    split:     ['js/modules/step3-split.js'],
    filter2:   ['js/modules/step4-stats.js'],
    normalize: [
      'js/modules/step5/nz-core.js',
      'js/modules/step5/nz-ui.js',
      'js/modules/step5-normalize.js',
    ],
    ppt:       ['js/modules/step6-ppt.js'],
    kdocs:     ['js/modules/step7-push.js'],
    email:     ['js/modules/step8-email.js'],
  },

  /**
   * 确保指定步骤的 JS 已加载完成。
   * 已加载的步骤会立即 resolve（同步），首次加载则按顺序加载所有脚本。
   * @returns {Promise<void>}
   */
  ensure(step) {
    // 首屏已加载的步骤
    if (step === 'upload') return Promise.resolve();
    // 已加载完成
    if (this._loaded.has(step)) return Promise.resolve();
    // 正在加载中，返回同一个 Promise（防止重复加载）
    if (this._loading.has(step)) return this._loading.get(step);

    const scripts = this._stepScripts[step];
    if (!scripts || scripts.length === 0) return Promise.resolve();

    const promise = this._loadScriptsSequentially(scripts)
      .then(() => {
        this._loaded.add(step);
        this._loading.delete(step);
      })
      .catch((err) => {
        this._loading.delete(step);
        console.error('[ModuleLoader] 加载失败:', step, err);
        ntf('模块加载失败: ' + step, 'error');
      });

    this._loading.set(step, promise);
    return promise;
  },

  /**
   * 按顺序加载多个脚本（保证依赖顺序）。
   */
  async _loadScriptsSequentially(srcs) {
    for (const src of srcs) {
      await this._loadScript(src);
    }
  },

  /**
   * 加载单个脚本文件。
   * @returns {Promise<void>}
   */
  _loadScript(src) {
    return new Promise((resolve, reject) => {
      // 避免重复添加同一个 script
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === '1') return resolve();
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(src)), { once: true });
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = false; // 保持执行顺序
      s.onload = () => { s.dataset.loaded = '1'; resolve(); };
      s.onerror = () => reject(new Error('加载失败: ' + src));
      document.body.appendChild(s);
    });
  },

  /**
   * 预加载步骤（不等待），用于空闲时预热。
   */
  prefetch(step) {
    if (step === 'upload' || this._loaded.has(step) || this._loading.has(step)) return;
    this.ensure(step);
  },
};
