// ========== particles.js — 全局粒子特效（基于 particles.js 库） ==========

(function () {
  'use strict';

  // 预设颜色方案
  var COLOR_PRESETS = [
    { name: '青绿', color: '#14b8a6' },
    { name: '蓝紫', color: '#818cf8' },
    { name: '橙金', color: '#fbbf24' },
    { name: '玫红', color: '#f472b6' },
    { name: '天蓝', color: '#38bdf8' },
    { name: '翠绿', color: '#4ade80' },
    { name: '白色', color: '#e2e8f0' },
  ];

  var currentColorIdx = 0;
  var particlesOn = true;
  var particlesOpacity = 60; // 0-100

  // 恢复保存的设置
  try {
    var savedColor = localStorage.getItem('ba-particle-color');
    if (savedColor !== null) {
      var idx = parseInt(savedColor);
      if (!isNaN(idx) && idx >= 0 && idx < COLOR_PRESETS.length) currentColorIdx = idx;
    }
    var savedOn = localStorage.getItem('ba-particle-on');
    if (savedOn === 'false') particlesOn = false;
    var savedOpacity = localStorage.getItem('ba-particle-opacity');
    if (savedOpacity !== null) {
      var op = parseInt(savedOpacity);
      if (!isNaN(op) && op >= 0 && op <= 100) particlesOpacity = op;
    }
  } catch (e) {}

  // 生成 particles.js 配置
  function buildConfig(color) {
    return {
      particles: {
        number: { value: 50, density: { enable: true, value_area: 900 } },
        color: { value: color },
        shape: { type: 'circle', stroke: { width: 0, color: '#000000' } },
        opacity: {
          value: 0.6, random: true,
          anim: { enable: true, speed: 0.8, opacity_min: 0.2, sync: false }
        },
        size: {
          value: 4, random: true,
          anim: { enable: true, speed: 2, size_min: 1, sync: false }
        },
        line_linked: {
          enable: true, distance: 150, color: color, opacity: 0.4, width: 1
        },
        move: {
          enable: true, speed: 3, direction: 'none', random: true,
          straight: false, out_mode: 'out',
          attract: { enable: false, rotateX: 600, rotateY: 1200 }
        }
      },
      interactivity: {
        detect_on: 'window',
        events: {
          onhover: { enable: true, mode: 'repulse' },
          onclick: { enable: true, mode: 'push' },
          resize: true
        },
        modes: {
          grab: { distance: 400, line_linked: { opacity: 1 } },
          bubble: { distance: 400, size: 40, duration: 2, opacity: 8, speed: 3 },
          repulse: { distance: 150 },
          push: { particles_nb: 4 },
          remove: { particles_nb: 2 }
        }
      },
      retina_detect: true
    };
  }

  // 应用可见度
  function applyOpacity() {
    var container = document.getElementById('particles-js');
    if (!container) return;
    container.style.opacity = particlesOn ? (particlesOpacity / 100) : 0;
  }

  // 初始化粒子
  var MAX_PARTICLES = 50;

  function init() {
    var container = document.getElementById('particles-js');
    if (!container) return;
    if (typeof particlesJS === 'undefined') return;
    var color = COLOR_PRESETS[currentColorIdx].color;
    particlesJS('particles-js', buildConfig(color));
    // 限制粒子总数不超过 MAX_PARTICLES
    capParticles();
    buildColorPicker();
    bindControls();
    applyOpacity();
    updateToggleUI();
    console.log('[particles] initialized with color:', color);
  }

  // 封装 push 方法防止超过上限
  function capParticles() {
    if (window.pJSDom && window.pJSDom.length) {
      var pjs = window.pJSDom[0].pJS;
      if (pjs && pjs.fn && pjs.fn.modes && pjs.fn.modes.push) {
        var origPush = pjs.fn.modes.push;
        pjs.fn.modes.push = function () {
          if (pjs.particles.array.length >= MAX_PARTICLES) return;
          origPush.apply(pjs, arguments);
        };
      }
    }
  }

  // 切换颜色：销毁旧实例，用新颜色重建
  function switchColor(idx) {
    currentColorIdx = idx;
    try { localStorage.setItem('ba-particle-color', idx); } catch (e) {}
    if (window.pJSDom && window.pJSDom.length) {
      window.pJSDom[0].pJS.fn.vendors.destroypJS();
      window.pJSDom = [];
    }
    var color = COLOR_PRESETS[idx].color;
    particlesJS('particles-js', buildConfig(color));
    capParticles();
    var dots = document.querySelectorAll('.pc-dot');
    dots.forEach(function (d) { d.classList.remove('active'); });
    var target = document.querySelector('.pc-dot[data-idx="' + idx + '"]');
    if (target) target.classList.add('active');
  }

  // 更新开关按钮 UI
  function updateToggleUI() {
    var btn = document.getElementById('pbToggle');
    if (!btn) return;
    if (particlesOn) {
      btn.classList.remove('off');
      btn.innerHTML = '<svg class="icon" aria-hidden="true"><use xlink:href="#icon-eye"/></svg>';
    } else {
      btn.classList.add('off');
      btn.innerHTML = '<svg class="icon" aria-hidden="true"><use xlink:href="#icon-eye"/></svg>';
    }
  }

  // 绑定开关和滑块事件
  function bindControls() {
    // 开关
    var toggleBtn = document.getElementById('pbToggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        particlesOn = !particlesOn;
        try { localStorage.setItem('ba-particle-on', particlesOn); } catch (e) {}
        applyOpacity();
        updateToggleUI();
      });
    }
    // 可见度滑块
    var slider = document.getElementById('pbOpacity');
    if (slider) {
      slider.value = particlesOpacity;
      slider.addEventListener('input', function () {
        particlesOpacity = parseInt(this.value);
        try { localStorage.setItem('ba-particle-opacity', particlesOpacity); } catch (e) {}
        applyOpacity();
      });
    }
  }

  // 构建颜色选择器
  function buildColorPicker() {
    var container = document.getElementById('particleColors');
    if (!container) return;
    container.innerHTML = '';
    COLOR_PRESETS.forEach(function (preset, idx) {
      var dot = document.createElement('div');
      dot.className = 'pc-dot' + (idx === currentColorIdx ? ' active' : '');
      dot.style.background = preset.color;
      dot.title = preset.name;
      dot.dataset.idx = idx;
      dot.addEventListener('click', function () { switchColor(idx); });
      container.appendChild(dot);
    });
  }

  // 启动：等待 DOM + particles.js 库就绪
  function waitForLib(cb) {
    if (typeof particlesJS !== 'undefined') { cb(); return; }
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (typeof particlesJS !== 'undefined') { clearInterval(timer); cb(); }
      else if (tries > 80) { clearInterval(timer); console.warn('[particles] library not loaded'); }
    }, 100);
  }

  function bootstrap() {
    waitForLib(function () {
      if (document.getElementById('particles-js')) {
        init();
      } else {
        requestAnimationFrame(init);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
