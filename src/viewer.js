import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CONFIG } from './config.js';

// ============================================================
// viewer.js：Renderer / Scene / Camera / 灯光 / OrbitControls /
// GLB 加载 / BoundingBox 自适应取景。动画与 UI 不在这里。
// ============================================================

export function isWebGLAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl2') || canvas.getContext('webgl'))
    );
  } catch {
    return false;
  }
}

export function createViewer(container, hooks = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.pixelRatioCap));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.light.background);

  // 轻量环境反射：保证 Transmission/金属/塑料观感，无需下载 HDR
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  if ('environmentIntensity' in scene) scene.environmentIntensity = CONFIG.light.envIntensity;
  pmrem.dispose();

  const isMobileLayout = () => window.innerWidth < 768;
  const camera = new THREE.PerspectiveCamera(
    isMobileLayout() ? CONFIG.camera.fovMobile : CONFIG.camera.fovDesktop,
    1,
    0.01,
    1000
  );

  // ---- 基础灯光（不依赖 GLB 自带灯光）----
  scene.add(new THREE.HemisphereLight(CONFIG.light.hemiSky, CONFIG.light.hemiGround, CONFIG.light.hemiIntensity));
  const keyLight = new THREE.DirectionalLight(0xffffff, CONFIG.light.keyIntensity);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(CONFIG.light.shadowMapSize, CONFIG.light.shadowMapSize);
  keyLight.shadow.bias = -0.0005;
  scene.add(keyLight);
  scene.add(keyLight.target);
  const fillLight = new THREE.DirectionalLight(0xdfe8ff, CONFIG.light.fillIntensity);
  fillLight.position.set(-6, 4, -6);
  scene.add(fillLight);

  // ---- OrbitControls：单指旋转 / 双指缩放 / 双指平移 ----
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = true; // 默认缓慢旋转，用户操作后暂停（可由开关恢复）
  controls.autoRotateSpeed = CONFIG.autoRotateSpeed;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  const state = {
    model: null,
    bbox: null,
    sphere: null,
    userInteracted: false,
    focusTween: null // {fromTarget,toTarget,fromPos,toPos,t,dur}
  };

  // 用户一旦手动操作：停掉自动旋转并通知 UI（按钮状态同步）
  controls.addEventListener('start', () => {
    state.userInteracted = true;
    if (controls.autoRotate) {
      controls.autoRotate = false;
      hooks.onAutoRotateChange?.(false);
    }
    state.focusTween = null; // 打断镜头定位飞行
    hooks.onFirstInteract?.();
  });

  function excludedFromFraming(obj) {
    const n = obj.name || '';
    if (CONFIG.bboxExcludeExact.includes(n)) return true;
    if (!obj.isMesh) return true; // 取景只看 Mesh
    return CONFIG.bboxExcludePrefixes.some((p) => n.startsWith(p));
  }

  // 自动计算 BoundingBox 并完成相机/灯光/阴影自适应（不依赖硬编码距离）
  function frameModel(model) {
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    model.updateWorldMatrix(true, true);
    model.traverse((o) => {
      if (excludedFromFraming(o)) return;
      tmp.setFromObject(o);
      if (!tmp.isEmpty()) box.union(tmp);
    });
    if (box.isEmpty()) return;
    state.bbox = box;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    state.sphere = sphere;
    const { center, radius } = sphere;

    controls.target.copy(center);
    controls.minDistance = radius * CONFIG.camera.minDistanceFactor;
    controls.maxDistance = radius * CONFIG.camera.maxDistanceFactor;

    // 默认 3/4 美观视角（不正对）
    const az = THREE.MathUtils.degToRad(CONFIG.camera.startAzimuthDeg);
    const pol = THREE.MathUtils.degToRad(CONFIG.camera.startPolarDeg);
    const dist = radius * 3.0;
    camera.position.set(
      center.x + dist * Math.sin(pol) * Math.sin(az),
      center.y + dist * Math.cos(pol),
      center.z + dist * Math.sin(pol) * Math.cos(az)
    );
    camera.near = Math.max(radius * CONFIG.camera.nearFactor, 0.001);
    camera.far = radius * CONFIG.camera.farFactor;
    camera.updateProjectionMatrix();

    // 灯光与阴影范围跟随模型尺寸
    keyLight.position.set(center.x + radius * 2.2, center.y + radius * 3.0, center.z + radius * 1.6);
    keyLight.target.position.copy(center);
    const s = radius * 2.5;
    Object.assign(keyLight.shadow.camera, {
      left: -s, right: s, top: s, bottom: -s, near: radius * 0.1, far: radius * 10
    });
    keyLight.shadow.camera.updateProjectionMatrix();

    // 地面柔和投影（博物馆展台感，ShadowMaterial 开销极小）
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 3, 48),
      new THREE.ShadowMaterial({ opacity: 0.16 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = box.min.y - radius * 0.02;
    ground.receiveShadow = true;
    ground.name = '__ground__';
    scene.add(ground);

    model.traverse((o) => {
      if (o.isMesh && !o.name.startsWith('Water_') && !o.name.startsWith('Rain_')) {
        o.castShadow = true;
      }
    });

    hooks.onFramed?.({ center: center.clone(), radius });
    if (CONFIG.DEBUG) {
      console.log('[viewer] BoundingBox size:', box.getSize(new THREE.Vector3()), 'center:', center, 'radius:', radius);
    }
  }

  function load(url, onProgress) {
    const manager = new THREE.LoadingManager();
    if (onProgress) {
      manager.onProgress = (_url, loaded, total) => onProgress(loaded / Math.max(total, 1));
    }
    return new Promise((resolve, reject) => {
      new GLTFLoader(manager).load(
        url,
        (gltf) => {
          state.model = gltf.scene;
          scene.add(gltf.scene);
          frameModel(gltf.scene);
          if (CONFIG.DEBUG) {
            const names = [];
            gltf.scene.traverse((o) => { if (o.name) names.push(o.name); });
            console.log('[viewer] Object count:', names.length);
            console.log('[viewer] Clip names:', gltf.animations.map((a) => `${a.name} (${a.duration.toFixed(2)}s)`));
          }
          resolve(gltf);
        },
        (xhr) => {
          if (xhr.total > 0) onProgress?.(xhr.loaded / xhr.total);
          else onProgress?.(null); // 总量未知：显示 indeterminant
        },
        (err) => reject(err)
      );
    });
  }

  // 平滑定位到某部件（只移动 target + 沿视线微调距离，不跳跃）
  function focusOn(point, keepDistanceFactor = 0.55) {
    const toTarget = point.clone();
    const dir = camera.position.clone().sub(controls.target);
    const dist = THREE.MathUtils.clamp(
      dir.length() * keepDistanceFactor,
      controls.minDistance * 1.05,
      controls.maxDistance
    );
    dir.setLength(dist);
    const toPos = toTarget.clone().add(dir);
    state.focusTween = {
      fromTarget: controls.target.clone(), toTarget,
      fromPos: camera.position.clone(), toPos,
      t: 0, dur: 0.7
    };
  }

  function resetView() {
    if (!state.sphere) return;
    const { center, radius } = state.sphere;
    const az = THREE.MathUtils.degToRad(CONFIG.camera.startAzimuthDeg);
    const pol = THREE.MathUtils.degToRad(CONFIG.camera.startPolarDeg);
    const dist = radius * 3.0;
    state.focusTween = {
      fromTarget: controls.target.clone(),
      toTarget: center.clone(),
      fromPos: camera.position.clone(),
      toPos: new THREE.Vector3(
        center.x + dist * Math.sin(pol) * Math.sin(az),
        center.y + dist * Math.cos(pol),
        center.z + dist * Math.sin(pol) * Math.cos(az)
      ),
      t: 0, dur: 0.7
    };
  }

  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.fov = (w < 768 ? CONFIG.camera.fovMobile : CONFIG.camera.fovDesktop);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.pixelRatioCap));
    renderer.setSize(w, h, false);
  }
  window.addEventListener('resize', resize);

  const clock = new THREE.Clock();
  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (state.focusTween) {
      const tw = state.focusTween;
      tw.t += dt / tw.dur;
      const k = tw.t >= 1 ? 1 : 1 - Math.pow(1 - tw.t, 3); // easeOutCubic
      controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
      camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
      if (tw.t >= 1) state.focusTween = null;
    }
    hooks.onTick?.(dt);
    controls.update();
    renderer.render(scene, camera);
  }

  return {
    renderer, scene, camera, controls, state,
    load, resize, tick, focusOn, resetView,
    setAutoRotate(v) { controls.autoRotate = v; },
    dispose() { window.removeEventListener('resize', resize); renderer.dispose(); }
  };
}
