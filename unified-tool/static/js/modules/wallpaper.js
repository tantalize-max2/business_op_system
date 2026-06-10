// ========== wallpaper.js — 一键切换壁纸 ==========

(function () {
  'use strict';

  // ====== 壁纸源配置 ======
  // 多源 fallback：wallhaven → picsum → 本地预设
  var SOURCES = {
    wallhaven: {
      // wallhaven API（国内可能无法访问）
      url: function () {
        var page = Math.floor(Math.random() * 10) + 1;
        return 'https://wallhaven.cc/api/v1/search?categories=111&purity=100&topRange=1M&sorting=toplist&order=desc&page=' + page;
      },
      parse: function (data) {
        if (!data || !data.data || !data.data.length) return null;
        var wp = data.data[Math.floor(Math.random() * data.data.length)];
        return wp.path; // 完整分辨率 URL
      },
      timeout: 5000
    },
    picsum: {
      // picsum.photos（国内可访问）
      url: function () {
        var id = Math.floor(Math.random() * 1000) + 10;
        return 'https://picsum.photos/id/' + id + '/1920/1080';
      },
      parse: function () { return null; }, // 直接返回 URL
      direct: true,
      timeout: 5000
    }
  };

  // 预设壁纸（离线 fallback，来自 Unsplash 免费 CDNs）
  var PRESET_WALLPAPERS = [
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&q=80',
    'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1920&q=80',
    'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1920&q=80',
    'https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?w=1920&q=80',
    'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1920&q=80',
    'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1920&q=80',
    'https://images.unsplash.com/photo-1454496522488-7a8e488e8606?w=1920&q=80',
    'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=1920&q=80',
    'https://images.unsplash.com/photo-1433086966358-54859d0ed716?w=1920&q=80',
    'https://images.unsplash.com/photo-1536431311719-392b6a9ec2d6?w=1920&q=80',
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&q=80',
    'https://images.unsplash.com/photo-1534088568595-a066f410bcda?w=1920&q=80',
  ];

  var currentWallpaper = null;
  var wallpaperOn = false;
  var loading = false;
  var wallpaperOpacity = 80; // 壁纸透明度 0(不显示)-100(最明显)，默认80

  // 恢复保存的壁纸
  try {
    var savedWp = localStorage.getItem('ba-wallpaper-url');
    var savedOn = localStorage.getItem('ba-wallpaper-on');
    if (savedWp) currentWallpaper = savedWp;
    if (savedOn === 'true') wallpaperOn = true;
    var savedOpacity = localStorage.getItem('ba-wallpaper-opacity');
    if (savedOpacity != null) wallpaperOpacity = Math.max(0, Math.min(100, parseInt(savedOpacity) || 80));
  } catch (e) {}

  // ====== 更新壁纸可见度（壁纸bg opacity + 内容遮罩联动） ======
  function updateWallpaperVisibility() {
    var bg = document.getElementById('wallpaperBg');
    // 壁纸bg opacity: 滑块值直接映射 (0→0, 100→1)
    var bgOpacity = wallpaperOpacity / 100;
    if (bg) bg.style.opacity = String(bgOpacity);
    // 内容遮罩 alpha: 从1.0(不透)到0.7(最低保文字)，跟随壁纸减弱
    // value=0→alpha=1.0(全遮), value=100→alpha=0.7(壁纸透出但文字清晰)
    var overlayAlpha = 1.0 - wallpaperOpacity * 0.003;
    overlayAlpha = Math.min(1, Math.max(0.7, overlayAlpha));
    document.documentElement.style.setProperty('--wp-overlay-alpha', overlayAlpha);
  }

  // ====== 应用壁纸 ======
  function applyWallpaper(url) {
    currentWallpaper = url;
    wallpaperOn = true;
    try {
      localStorage.setItem('ba-wallpaper-url', url);
      localStorage.setItem('ba-wallpaper-on', 'true');
    } catch (e) {}
    var bg = document.getElementById('wallpaperBg');
    if (!bg) return;
    bg.style.backgroundImage = 'url(' + url + ')';
    updateWallpaperVisibility();
    document.body.classList.add('has-wallpaper');
    updateToggleUI();
  }

  // ====== 移除壁纸 ======
  function removeWallpaper() {
    wallpaperOn = false;
    try { localStorage.setItem('ba-wallpaper-on', 'false'); } catch (e) {}
    var bg = document.getElementById('wallpaperBg');
    if (bg) bg.style.opacity = '0';
    document.body.classList.remove('has-wallpaper');
    updateToggleUI();
  }

  // ====== 从 wallhaven 获取壁纸 ======
  function fetchFromWallhaven() {
    var src = SOURCES.wallhaven;
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, src.timeout);

    return fetch(src.url(), { signal: controller.signal })
      .then(function (r) {
        clearTimeout(timeout);
        if (!r.ok) throw new Error('wallhaven API error');
        return r.json();
      })
      .then(function (data) {
        var url = src.parse(data);
        if (!url) throw new Error('no wallpaper data');
        return url;
      });
  }

  // ====== 从 picsum 获取壁纸 ======
  function fetchFromPicsum() {
    var src = SOURCES.picsum;
    return Promise.resolve(src.url());
  }

  // ====== 使用预设壁纸 ======
  function usePreset() {
    return PRESET_WALLPAPERS[Math.floor(Math.random() * PRESET_WALLPAPERS.length)];
  }

  // ====== 一键切换（多源 fallback） ======
  function switchWallpaper() {
    if (loading) return;
    loading = true;
    var btn = document.getElementById('wpToggle');
    if (btn) btn.classList.add('loading');

    // 预加载图片，确保可用后再应用
    function tryUrl(url) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () { resolve(url); };
        img.onerror = function () { reject(new Error('image load failed')); };
        img.src = url;
      });
    }

    // 依次尝试：wallhaven → picsum → 预设
    fetchFromWallhaven()
      .then(function (url) { return tryUrl(url); })
      .catch(function () {
        return fetchFromPicsum().then(function (url) { return tryUrl(url); });
      })
      .catch(function () {
        return tryUrl(usePreset());
      })
      .then(function (url) {
        if (url) applyWallpaper(url);
      })
      .catch(function () {
        // 所有源都失败，使用预设（不验证）
        applyWallpaper(usePreset());
      })
      .finally(function () {
        loading = false;
        if (btn) btn.classList.remove('loading');
      });
  }

  // ====== 开关按钮 UI ======
  function updateToggleUI() {
    var btn = document.getElementById('wpToggle');
    if (!btn) return;
    if (wallpaperOn) {
      btn.classList.remove('off');
    } else {
      btn.classList.add('off');
    }
  }

  // ====== 初始化 ======
  function init() {
    // 绑定按钮
    var btn = document.getElementById('wpToggle');
    if (!btn) return;

    btn.addEventListener('click', function () {
      if (wallpaperOn && !loading) {
        // 已开启：点击切换到下一张
        switchWallpaper();
      } else if (!wallpaperOn) {
        // 未开启：开启并切换
        switchWallpaper();
      }
    });

    // 右键关闭壁纸
    btn.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (wallpaperOn) removeWallpaper();
    });

    // 恢复上次壁纸
    if (wallpaperOn && currentWallpaper) {
      var bg = document.getElementById('wallpaperBg');
      if (bg) {
        bg.style.backgroundImage = 'url(' + currentWallpaper + ')';
        document.body.classList.add('has-wallpaper');
      }
      updateWallpaperVisibility();
    }
    updateToggleUI();

    // 透明度滑块（值越大壁纸越明显）
    var opacitySlider = document.getElementById('wpOpacity');
    if (opacitySlider) {
      opacitySlider.value = wallpaperOpacity;
      opacitySlider.addEventListener('input', function () {
        wallpaperOpacity = parseInt(this.value);
        try { localStorage.setItem('ba-wallpaper-opacity', wallpaperOpacity); } catch (e) {}
        updateWallpaperVisibility();
      });
      // 阻止滑块拖动时触发壁纸切换
      opacitySlider.addEventListener('click', function (e) { e.stopPropagation(); });
    }
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
