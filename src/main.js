import * as THREE from 'three';
import { CONFIG } from './config.js';
import { initAnalytics } from './analytics.js';
import { createViewer, isWebGLAvailable } from './viewer.js';
import { createDemoController } from './animation.js';
import { createPicker, createShellToggle, componentCenter } from './components.js';

// ============================================================
// main.js：装配 viewer + 动画 + 零件说明 + 全部 UI 接线
// ============================================================

const $ = (id) => document.getElementById(id);
const els = {
  viewer: $('viewer'),
  loading: $('loading'),
  loadingText: $('loading-text'),
  loadingBar: $('loading-bar'),
  loadError: $('load-error'),
  hint: $('hint'),
  pulseDot: $('pulse-dot'),
  rain: $('rain-value'),
  pulse: $('pulse-value'),
  stageLabel: $('stage-label'),
  stageDesc: $('stage-desc'),
  steps: $('steps'),
  progressFill: $('progress-fill'),
  timeText: $('time-text'),
  btnPlay: $('btn-play'),
  btnReset: $('btn-reset'),
  btnSlow: $('btn-slow'),
  btnShell: $('btn-shell'),
  btnRotate: $('btn-rotate'),
  btnCam: $('btn-cam'),
  card: $('card'),
  cardTitle: $('card-title'),
  cardDesc: $('card-desc'),
  cardFocus: $('card-focus'),
  cardClose: $('card-close'),
  debugPanel: $('debug-panel'),
  debugInfo: $('debug-info')
};

// ---------- 用户统计（第三方，后台看数；未配置 ID 时为 no-op）----------
const analytics = initAnalytics();
const track = (name, data) => {
  try {
    analytics.trackEvent(name, data);
  } catch {
    /* 统计绝不影响主流程 */
  }
};
const pageStartTs = performance.now();
let demoCompletedTracked = false;

// ---------- 无 WebGL 降级 ----------
if (!isWebGLAvailable()) {
  els.loading.hidden = true;
  els.loadError.hidden = false;
  els.loadError.querySelector('p').textContent =
    '当前浏览器无法显示 3D 模型，请使用最新版 Chrome、Safari 或 Edge。';
  throw new Error('WebGL unavailable');
}

// ---------- 六阶段步骤条 ----------
const stepItems = CONFIG.stageTimeline.map((s, i) => {
  const li = document.createElement('li');
  li.textContent = s.label;
  li.dataset.index = String(i);
  els.steps.appendChild(li);
  return li;
});

let controller = null;
let started = false; // 是否进入过播放（决定按钮文案 开始/继续）
let currentFocusObject = null;

function playButtonLabel(state) {
  if (!state) return '开始演示';
  if (state.finished) return '再次播放';
  if (state.playing) return '暂停';
  return started ? '继续' : '开始演示';
}

function renderUI(s) {
  els.rain.textContent = s.rainfall.toFixed(1);
  els.pulse.textContent = String(s.count);
  const stage = CONFIG.stageTimeline[s.stageIndex];
  els.stageLabel.textContent = started || s.playing ? stage.label : '待开始';
  els.stageDesc.textContent =
    started || s.playing ? stage.desc : '点击「开始演示」，观看降水变成数字的全过程。';
  stepItems.forEach((li, i) => {
    li.classList.toggle('active', started && i === s.stageIndex);
    li.classList.toggle('done', started && i < s.stageIndex);
  });
  els.progressFill.style.width = `${(s.time / s.duration) * 100}%`;
  els.timeText.textContent = `${s.time.toFixed(1)}s / ${s.duration.toFixed(1)}s`;
  els.btnPlay.textContent = playButtonLabel(s);
  // 演示看完一次即记一次（重置/重播后可再次计数）
  if (s.finished && !demoCompletedTracked) {
    demoCompletedTracked = true;
    track('demo_complete', { count: s.count, rainfall: s.rainfall });
  }
  if (s.pulseJustFired) {
    els.pulseDot.classList.remove('flash');
    void els.pulseDot.offsetWidth; // 重启动画
    els.pulseDot.classList.add('flash');
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch { /* 忽略 */ } }
  }
}

// ---------- Viewer ----------
const viewer = createViewer(els.viewer, {
  onAutoRotateChange(v) {
    els.btnRotate.classList.toggle('on', v);
    els.btnRotate.setAttribute('aria-pressed', String(v));
  },
  onFirstInteract() {
    hideHintSoon(1200);
  },
  onTick(dt) {
    controller?.update(dt);
  },
  onFramed({ radius }) {
    if (CONFIG.DEBUG) console.log('[main] framed, radius =', radius);
  }
});
viewer.resize();
viewer.tick();

function hideHintSoon(ms = 4000) {
  if (els.hint.hidden) return;
  setTimeout(() => {
    els.hint.style.opacity = '0';
    setTimeout(() => { els.hint.hidden = true; }, 650);
  }, ms);
}

// ---------- 按钮 ----------
els.btnPlay.addEventListener('click', () => {
  if (!controller) return;
  // 按播放前状态区分事件：重播 / 暂停 / 继续 / 首次开始
  const wasFinished = controller.finished;
  const wasPlaying = controller.playing;
  const wasStarted = started;
  started = true;
  if (wasFinished) demoCompletedTracked = false; // 重播后允许再次记 complete
  controller.toggle();
  if (wasFinished) track('demo_replay');
  else if (wasPlaying) track('demo_pause', { t: +controller.time.toFixed(1) });
  else if (wasStarted) track('demo_resume', { t: +controller.time.toFixed(1) });
  else track('demo_start');
});
els.btnReset.addEventListener('click', () => {
  if (!controller) return;
  started = false; // 回到“待开始”文案，数字清零；保留用户当前视角
  demoCompletedTracked = false;
  track('demo_reset');
  controller.resetToStart();
  renderUI({
    time: 0, duration: controller.duration, count: 0, rainfall: 0,
    stageIndex: 0, playing: false, finished: false, pulseJustFired: false
  });
  els.stageLabel.textContent = '待开始';
  els.stageDesc.textContent = '已重置。点击「开始演示」重新观看。';
  stepItems.forEach((li) => li.classList.remove('active', 'done'));
  els.btnPlay.textContent = '开始演示';
});
els.btnSlow.addEventListener('click', () => {
  if (!controller) return;
  const on = els.btnSlow.getAttribute('aria-pressed') !== 'true';
  els.btnSlow.setAttribute('aria-pressed', String(on));
  els.btnSlow.classList.toggle('on', on);
  controller.setSlow(on);
  track(on ? 'slow_on' : 'slow_off');
});
els.btnRotate.addEventListener('click', () => {
  const on = els.btnRotate.getAttribute('aria-pressed') !== 'true';
  els.btnRotate.setAttribute('aria-pressed', String(on));
  els.btnRotate.classList.toggle('on', on);
  viewer.setAutoRotate(on);
  track(on ? 'rotate_on' : 'rotate_off');
});
els.btnCam.addEventListener('click', () => {
  viewer.resetView();
  track('cam_reset');
});

const shell = createShellToggle(viewer);
els.btnShell.addEventListener('click', () => {
  const r = shell.toggle();
  if (!r.ok) {
    els.stageDesc.textContent = r.reason;
    return;
  }
  els.btnShell.setAttribute('aria-pressed', String(r.active));
  els.btnShell.classList.toggle('on', r.active);
  els.btnShell.textContent = r.active ? '恢复外观' : '查看内部';
  track(r.active ? 'shell_on' : 'shell_off');
});

// ---------- 零件说明卡 ----------
let picker = null;
function hideCard() {
  els.card.hidden = true;
  currentFocusObject = null;
  picker?.clearHighlight();
}
els.cardClose.addEventListener('click', hideCard);
els.cardFocus.addEventListener('click', () => {
  if (!currentFocusObject) return;
  const c = componentCenter(currentFocusObject);
  if (c) viewer.focusOn(c);
});

// ---------- 加载 GLB（UI 先出现，模型异步进） ----------
viewer
  .load(CONFIG.modelUrl, (frac) => {
    if (frac == null) {
      els.loadingText.textContent = '…';
      return;
    }
    const pct = Math.round(frac * 100);
    els.loadingText.textContent = `${pct}%`;
    els.loadingBar.style.width = `${pct}%`;
  })
  .then((gltf) => {
    els.loading.hidden = true;
    track('model_loaded', { load_ms: Math.round(performance.now() - pageStartTs) });
    for (const b of [els.btnPlay, els.btnReset, els.btnSlow, els.btnShell, els.btnCam]) {
      b.disabled = false;
    }

    // 动画控制器（Single Clip：Full_Demo）
    try {
      controller = createDemoController(gltf, renderUI);
    } catch (err) {
      console.error(err);
      els.loadError.hidden = false;
      els.loadError.querySelector('p').textContent =
        '模型动画数据缺失，无法播放演示，但仍可旋转查看模型。';
      return;
    }
    controller.update(0);

    // 点击零件
    picker = createPicker(viewer);
    picker.bind((x, y) => {
      const hit = picker.pick(x, y);
      if (!hit) { hideCard(); return; }
      const comp = picker.resolveComponent(hit.object);
      if (!comp) {
        // 识别不了的部件：如实显示对象名，不编造功能
        els.cardTitle.textContent = hit.object.name || '未知部件';
        els.cardDesc.textContent = '该部件暂无科普说明（GLB 命名未覆盖）。';
        currentFocusObject = hit.object;
        picker.highlight(hit.object);
        els.card.hidden = false;
        track('part_view', { part: hit.object.name || 'unknown', mapped: false });
        if (CONFIG.DEBUG) console.log('[pick] unmapped object:', hit.object.name);
        return;
      }
      currentFocusObject = comp.object;
      els.cardTitle.textContent = comp.name;
      els.cardDesc.textContent = comp.description;
      els.card.hidden = false;
      picker.highlight(comp.object);
      track('part_view', { part: comp.key || comp.name, mapped: true });
      if (CONFIG.DEBUG) console.log('[pick]', hit.object.name, '→', comp.key);
    });

    // 调试信息（仅 dev）
    if (CONFIG.DEBUG) {
      els.debugPanel.hidden = false;
      const meshes = [];
      gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o.name); });
      const entries = performance.getEntriesByName(new URL(CONFIG.modelUrl, location.href).href);
      const bytes = entries[0]?.transferSize || entries[0]?.decodedBodySize || 0;
      const info = {
        clips: gltf.animations.map((a) => ({ name: a.name, duration_s: +a.duration.toFixed(3) })),
        clipUsed: controller.clipName + (controller.fallbackUsed ? '（回退：未找到 Full_Demo）' : ''),
        meshCount: meshes.length,
        pulseTimes_s: CONFIG.pulseTimes,
        stageTimeline: CONFIG.stageTimeline.map((s) => `${s.start}-${s.end}s ${s.label}`),
        shellObjects: CONFIG.shellObjectNames,
        glbBytes: bytes || '未知（dev 内存加载）',
        bbox: viewer.state.sphere
          ? { center: viewer.state.sphere.center, radius: +viewer.state.sphere.radius.toFixed(3) }
          : null
      };
      els.debugInfo.textContent = JSON.stringify(info, null, 2);
      console.log('[debug] Full_Demo clips/duration 已在 viewer 日志输出');
    }

    // 首屏提示，几秒后自动消失
    els.hint.hidden = false;
    hideHintSoon(5000);
  })
  .catch((err) => {
    console.error('GLB load failed:', err);
    track('model_load_failed', { message: String(err?.message || err).slice(0, 200) });
    els.loading.hidden = true;
    els.loadError.hidden = false;
  });
