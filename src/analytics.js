// ============================================================
// analytics.js：第三方统计的可插拔接入层（纯静态站专用）
//
// 设计目标：
// - 本站托管在 Netlify 纯静态环境，无后端，所以 PV/UV/停留时长
//   直接用第三方统计后台看，不自建库、不自建看板页。
// - 在 config.js 的 CONFIG.analytics 里填了哪家的 ID，就只加载哪家，
//   可多家同时开（比如国内用 51.la，海外兼顾 Umami），全空则零开销。
// - 所有加载都是动态 async/defer 注入，不阻塞 3D 首屏；离线/拦截
//   插件/脚本 404 时静默失败，绝不影响主流程。
// - 尊重 Do Not Track：navigator.doNotTrack === '1' 时不加载任何脚本。
//
// 各家后台能直接看到的指标：
// - 访问人数：PV（浏览量）/ UV（访客数），各家后台「概况」页自带。
// - 停留时长：Plausible「Engagement / Visit duration」、Umami「 engagement」
//   /百度「访问时长」/51.la「访问时长/平均停留」/Clarity「Session 回放时长」。
//   另外本模块在 pagehide 时会补发一次 visit_complete 事件（带 duration_s），
//   方便你在任意一家的「事件」里按分位看停留分布。
//
// 自定义事件（演示互动，用于看“看了多久、看到哪”）：
//   model_loaded / model_load_failed / demo_start / demo_pause /
//   demo_resume / demo_replay / demo_complete / demo_reset /
//   slow_on / slow_off / shell_on / shell_off / rotate_on / rotate_off /
//   part_view / cam_reset / visit_complete
// 在各家后台的 Events（事件）面板里查看。
// ============================================================

import { CONFIG } from './config.js';

const DEBUG = (...args) => {
  if (CONFIG.DEBUG) console.log('[analytics]', ...args);
};

function dntEnabled() {
  const dnt = navigator.doNotTrack ?? window.doNotTrack ?? navigator.msDoNotTrack;
  return dnt === '1' || dnt === 'yes';
}

function loadScript(src, attrs = {}) {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('empty src'));
      return;
    }
    // 同一个 src 只注入一次（StrictMode/重复 init 防护）
    if (document.querySelector(`script[data-analytics-src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.defer = true;
    s.referrerPolicy = 'strict-origin-when-cross-origin';
    s.dataset.analyticsSrc = src;
    for (const [k, v] of Object.entries(attrs)) {
      if (v != null && v !== '') s.setAttribute(k, v);
    }
    const timeout = setTimeout(() => {
      s.remove();
      reject(new Error(`load timeout: ${src}`));
    }, 8000);
    s.onload = () => {
      clearTimeout(timeout);
      resolve();
    };
    s.onerror = () => {
      clearTimeout(timeout);
      s.remove();
      reject(new Error(`load failed: ${src}`));
    };
    document.head.appendChild(s);
  });
}

// ---- 停留时长：只累计页面可见时间（切后台/锁屏不计入）----
function createDwellTracker(onLeave) {
  const startWall = Date.now();
  let visibleMs = 0;
  let lastVisibleTs = document.visibilityState === 'visible' ? Date.now() : 0;

  const onVisibility = () => {
    const now = Date.now();
    if (document.visibilityState === 'visible') {
      lastVisibleTs = now;
    } else if (lastVisibleTs > 0) {
      visibleMs += now - lastVisibleTs;
      lastVisibleTs = 0;
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  let sent = false;
  const snapshot = () => {
    const now = Date.now();
    const visible = visibleMs + (lastVisibleTs > 0 ? now - lastVisibleTs : 0);
    return {
      wall_s: Math.round((now - startWall) / 1000),
      visible_s: Math.round(visible / 1000)
    };
  };

  const leave = () => {
    if (sent) return;
    sent = true;
    try {
      onLeave(snapshot());
    } catch {
      /* 忽略 */
    }
  };
  // pagehide 覆盖 bfcache/移动端切后台杀进程；visibilitychange 兜底
  window.addEventListener('pagehide', leave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leave();
  });

  return { snapshot };
}

export function initAnalytics() {
  const noop = {
    ready: false,
    trackEvent() {},
    snapshot: () => ({ wall_s: 0, visible_s: 0 })
  };

  const cfg = CONFIG.analytics || {};
  const hasAnyId =
    cfg.umami?.websiteId || cfg.plausible?.domain || cfg.baidu?.id || cfg.la51?.id || cfg.clarity?.id;

  if (!hasAnyId) {
    DEBUG('未配置任何统计 ID，跳过加载（去 config.js 填 CONFIG.analytics）');
    return noop;
  }
  if (dntEnabled()) {
    DEBUG('检测到 DNT=1，尊重用户选择，不加载统计');
    return noop;
  }

  const active = { umami: false, plausible: false, baidu: false, la51: false, clarity: false };

  // ---- 各家事件转发（全部 try/catch，单家失败不影响其他家）----
  function trackEvent(name, data = {}) {
    // Umami：umami.track(name, data)
    if (active.umami) {
      try {
        window.umami?.track?.(name, data);
      } catch {
        /* 忽略 */
      }
    }
    // Plausible：plausible(name, { props })
    if (active.plausible) {
      try {
        window.plausible?.(name, { props: flatten(data) });
      } catch {
        /* 忽略 */
      }
    }
    // 百度统计：_hmt.push(['_trackEvent', category, action, label])
    if (active.baidu) {
      try {
        window._hmt?.push?.(['_trackEvent', 'exhibit', name, JSON.stringify(data).slice(0, 200)]);
      } catch {
        /* 忽略 */
      }
    }
    // 51.la：LA.track(name, data)
    if (active.la51) {
      try {
        window.LA?.track?.(name, data);
      } catch {
        /* 忽略 */
      }
    }
    // Clarity：clarity('event', name)
    if (active.clarity) {
      try {
        window.clarity?.('event', name);
      } catch {
        /* 忽略 */
      }
    }
    DEBUG('event', name, data);
  }

  function flatten(obj) {
    // Plausible props 只接受 string/number，且有长度限制，做一层拍平
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
      if (v == null) continue;
      out[k] = typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v).slice(0, 200);
    }
    return out;
  }

  // ---- 按配置动态注入脚本（PV 由各家自动采集，不手动发 page_view 防重复）----
  (async () => {
    // Umami（国际/隐私友好，推荐自托管或 Umami Cloud）
    if (cfg.umami?.websiteId && cfg.umami?.src) {
      try {
        await loadScript(cfg.umami.src, { 'data-website-id': cfg.umami.websiteId });
        active.umami = true;
        DEBUG('umami loaded');
      } catch (err) {
        DEBUG('umami 跳过：', err.message);
      }
    }
    // Plausible（国际/隐私友好，轻量 ~1KB）
    if (cfg.plausible?.domain && cfg.plausible?.src) {
      try {
        await loadScript(cfg.plausible.src, { 'data-domain': cfg.plausible.domain });
        active.plausible = true;
        DEBUG('plausible loaded');
      } catch (err) {
        DEBUG('plausible 跳过：', err.message);
      }
    }
    // 百度统计（国内可达，功能全但脚本较重）
    if (cfg.baidu?.id) {
      try {
        window._hmt = window._hmt || [];
        await loadScript(`https://hm.baidu.com/hm.js?${cfg.baidu.id}`);
        active.baidu = true;
        DEBUG('baidu loaded');
      } catch (err) {
        DEBUG('baidu 跳过：', err.message);
      }
    }
    // 51.la（国内可达，轻量，静态站常用；需同时填 id 与 ck）
    if (cfg.la51?.id && cfg.la51?.ck) {
      try {
        window.LA = window.LA || { track() {}, init() {} };
        // 必须先声明 LA.init 占位再加载 SDK，SDK 就绪后按官方要求初始化
        await loadScript('https://sdk.51.la/js-sdk-pro.min.js');
        try {
          window.LA?.init?.({ id: cfg.la51.id, ck: cfg.la51.ck, hashMode: true });
        } catch {
          /* 忽略 */
        }
        active.la51 = true;
        DEBUG('51.la loaded');
      } catch (err) {
        DEBUG('51.la 跳过：', err.message);
      }
    }
    // Microsoft Clarity（免费热力图+回放，看“用户怎么点”最直观）
    if (cfg.clarity?.id) {
      try {
        const cid = cfg.clarity.id;
        /* eslint-disable */
        (function (c, l, a, r, i, t, y) {
          c[a] =
            c[a] ||
            function () {
              (c[a].q = c[a].q || []).push(arguments);
            };
          t = l.createElement(r);
          t.async = 1;
          t.src = 'https://www.clarity.ms/tag/' + i;
          y = l.getElementsByTagName(r)[0];
          y.parentNode.insertBefore(t, y);
        })(window, document, 'clarity', 'script', cid);
        /* eslint-enable */
        active.clarity = true;
        DEBUG('clarity loaded');
      } catch (err) {
        DEBUG('clarity 跳过：', err.message);
      }
    }
  })();

  // ---- 离开时补发停留时长（best-effort，发送失败不重试）----
  const dwell = createDwellTracker(({ wall_s, visible_s }) => {
    // 时长分桶，方便在事件面板直接看分布；原始秒数也一并带上
    const bucket = visible_s < 10 ? '<10s' : visible_s < 30 ? '10-30s' : visible_s < 60 ? '30-60s' : visible_s < 180 ? '1-3min' : '3min+';
    trackEvent('visit_complete', { wall_s, visible_s, duration_s: visible_s, bucket });
  });

  const api = {
    ready: true,
    trackEvent,
    snapshot: dwell.snapshot
  };
  // 调试用：控制台可手动 window.__analytics.trackEvent('test',{a:1})
  window.__analytics = api;
  return api;
}
