import * as THREE from 'three';
import { CONFIG } from './config.js';

// ============================================================
// animation.js：AnimationMixer 封装
// - 优先播放 Full_Demo；不存在则回退第一个 Clip（并如实报告）
// - 脉冲计数 = 已到达 pulseTimes 的个数（绝对时间重算）
//   → 暂停/继续/拖动/慢放都不会重复计数；重置即清零
// - 动画播放期间不锁 OrbitControls（viewer 侧本来就没锁）
// ============================================================

export function createDemoController(gltf, onUpdate = () => {}) {
  const clips = gltf.animations || [];
  let clip = THREE.AnimationClip.findByName(clips, CONFIG.clipName);
  let fallbackUsed = false;
  if (!clip) {
    clip = clips[0] || null;
    fallbackUsed = true;
  }
  if (!clip) {
    throw new Error('GLB 中没有可播放的 AnimationClip');
  }

  const mixer = new THREE.AnimationMixer(gltf.scene);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  action.paused = true; // 默认不自动播放机械动画，只自动旋转展示

  const duration = clip.duration;
  let playing = false;
  let finished = false;
  let lastCount = -1;

  const countAt = (t) => CONFIG.pulseTimes.filter((pt) => t + 1e-4 >= pt).length;
  const stageAt = (t) => {
    const tl = CONFIG.stageTimeline;
    for (let i = 0; i < tl.length; i++) {
      if (t >= tl[i].start && t < tl[i].end) return i;
    }
    return tl.length - 1;
  };

  function report() {
    const t = action.time;
    const count = countAt(t);
    lastCount = count;
    onUpdate({
      time: t,
      duration,
      count,
      rainfall: +(count * CONFIG.rainPerPulse).toFixed(1),
      stageIndex: stageAt(t),
      playing,
      finished,
      pulseJustFired: false
    });
  }

  // 脉冲边沿检测：只在 update 里 count 增加的那一帧触发一次 UI 闪光
  let prevCount = 0;

  return {
    clipName: clip.name,
    duration,
    fallbackUsed,
    get playing() { return playing; },
    get finished() { return finished; },
    get time() { return action.time; },

    play() {
      if (finished || action.time >= duration - 1e-3) this.restart();
      else { action.paused = false; playing = true; report(true); }
    },
    pause() {
      action.paused = true;
      playing = false;
      report(true);
    },
    toggle() {
      if (playing) this.pause();
      else this.play();
    },
    restart() {
      action.reset();
      action.paused = false;
      action.timeScale = this._timeScale ?? CONFIG.normalTimeScale;
      playing = true;
      finished = false;
      prevCount = 0;
      lastCount = -1;
      mixer.update(0);
      report(true);
    },
    resetToStart() {
      // 回到第 0 帧并停住（用于“重置”按钮：数字清零、阶段回到①）
      action.reset();
      action.paused = true;
      playing = false;
      finished = false;
      prevCount = 0;
      lastCount = -1;
      mixer.update(0);
      report(true);
    },
    setSlow(enabled) {
      this._timeScale = enabled ? CONFIG.slowTimeScale : CONFIG.normalTimeScale;
      action.timeScale = this._timeScale;
    },

    update(delta) {
      if (playing && !action.paused) {
        mixer.update(delta);
        if (action.time >= duration - 1e-4) {
          action.time = duration;
          action.paused = true;
          playing = false;
          finished = true;
        }
      }
      const count = countAt(action.time);
      const fired = count > prevCount;
      prevCount = count;
      lastCount = count;
      onUpdate({
        time: action.time,
        duration,
        count,
        rainfall: +(count * CONFIG.rainPerPulse).toFixed(1),
        stageIndex: stageAt(action.time),
        playing,
        finished,
        pulseJustFired: fired && playing !== undefined && count > 0
      });
    },

    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(gltf.scene);
    }
  };
}
