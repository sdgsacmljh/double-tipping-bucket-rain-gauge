# 双翻斗雨量传感器 · 3D 科普展品

手机扫码即看的交互式数字科普展品：Three.js + GLB + 纯静态部署，无后端。

## 本地运行

```bash
npm install
npm run dev
```

浏览器打开终端显示的地址（一般为 http://localhost:5173）。

## 生产构建

```bash
npm run build
```

生成 `dist/` 目录（纯静态），可直接上传 Netlify / Cloudflare Pages / 任意静态托管。

## GitHub Pages

仓库内置 `.github/workflows/pages.yml`。推送到 `main` 后会自动构建并部署到：

`https://sdgsacmljh.github.io/double-tipping-bucket-rain-gauge/`

首次部署时，如果 GitHub 提示尚未启用 Pages，请在仓库 **Settings → Pages → Source** 选择 **GitHub Actions**，然后重新运行 `Deploy showcase to GitHub Pages` 工作流。

## Netlify 部署

- Build Command：`npm run build`
- Publish Directory：`dist`
- 仓库根若是上级工作区目录，则 Base directory 填 `rain-gauge-web`，
  Publish Directory 仍为 `dist`。`netlify.toml` 已随项目提供。

## 项目结构

```
rain-gauge-web/
├─ public/models/rain-gauge.glb   # 由 animation_delivery/rainfall_science.glb 拷贝
├─ src/
│  ├─ main.js        # 装配：viewer + 动画 + 零件说明 + UI 接线
│  ├─ viewer.js      # Renderer/Scene/相机/灯光/OrbitControls/GLB加载/自适应取景
│  ├─ animation.js   # AnimationMixer 控制器（播放/暂停/继续/重播/慢动作/脉冲计数）
│  ├─ components.js  # 零件点击说明/高亮/查看内部（外壳半透明）
│  ├─ config.js      # ★集中配置：脉冲时刻/阶段轴/外壳名单/部件知识库，全改这里
│  └─ style.css      # 手机竖屏优先样式
├─ index.html
├─ vite.config.js    # base './'，保证子路径部署可用
└─ netlify.toml
```

## 模型与动画（实测值）

- GLB：`rain-gauge.glb`（源文件 `animation_delivery/双翻斗雨量传感器_白色翻斗_矩形汇集漏斗_防虫网_V2.glb`，
  与 `rainfall_science.glb` 内容一致），约 4.6 MB。URL 带 `?v=white-rect-mesh-V2-20260909` 版本参数以刷新缓存。
- 白色翻斗V2（2026-09-09）：上下翻斗+计数翻斗改为白色不透明材质；中间汇集漏斗改为
  13.5×4.5 cm矩形敞口、四面向下收拢、无圆筒盛水段，下接矩形出口短颈；底部增加
  中央开孔铁垫板（14×6.1 cm，孔11.8×4.4 cm）和不锈钢交叉丝网防虫网。三角平底
  3.5×2 cm、浅蓝中央挡板、±29.74°端位、磁钢/干簧管结构保持不变。
- 三角平底修正（2026-09-09）：上下翻斗共四个半斗改为侧视三角形、平底 3.5×2 cm，
  上下各一块浅蓝中央挡板随转轴摆动；端位约 ±29.74°。脉冲时刻、0.5 mm 总量、
  约 30 秒时长均保持不变。
- 磁控计数修正（2026-09-09）：计数翻斗连接梁上加竖直磁钢；干簧管改为横向绿色
  玻璃管（内含两片簧片），两端经金属引脚→连接钢管→正面螺丝引脚接出，对应背面
  红黑接口，不增加外接线。旧的干簧管固定座与检测引线副本已删除。脉冲方案不变。
- Animation Clip：`Full_Demo`（唯一完整 Clip），时长 29.958 s（24 fps × 720 帧）
- 脉冲：5 次，`pulseTimes = [12.0, 16.333, 20.333, 24.333, 28.333]`（秒）
- 计数规则：1 脉冲 = 0.1 mm，演示结束累计 0.5 mm
- 六阶段时间轴见 `src/config.js` 的 `stageTimeline`

## 用户统计（第三方，后台直接看数）

本站是 Netlify 纯静态托管，无后端，所以访问人数与停留时长用第三方统计，
数据直接在第三方后台看，不需要在本工程里再做看板页。

- 代码：`src/analytics.js`（可插拔加载层）+ `src/config.js` 的 `CONFIG.analytics`
  + `src/main.js` 的互动埋点。未填 ID 时零开销、不加载任何外部脚本。
- 支持 5 家，可多家同时开：`umami` / `plausible` / `baidu` / `la51` / `clarity`。

| 观众为主 | 推荐 | 去哪里开通 | 填什么 | 看数位置 |
|---|---|---|---|---|
| 国内扫码 | 51.la（轻量） | https://www.51.la → 应用管理 | `la51: { id, ck }` | 概况（PV/UV）＋ 访问时长 ＋ 事件 |
| 国内＋百度生态 | 百度统计 | https://tongji.baidu.com → 新增站点 | `baidu: { id }` | 概况 ＋ 访问时长 ＋ 事件 |
| 海外/隐私合规 | Umami 或 Plausible（二选一） | Umami Cloud / Plausible.io | `umami: { src, websiteId }` / `plausible: { src, domain }` | Realtime/概况 ＋ Engagement/Visit duration ＋ Events |
| 想看热力图回放 | Clarity（免费，可叠加） | https://clarity.microsoft.com | `clarity: { id }` | 录制/热力图（看用户怎么点） |

步骤（以 51.la 为例）：

1. 注册并新增站点，拿到 `id` 和 `ck`。
2. 只改 `src/config.js`：`analytics: { la51: { id: '你的id', ck: '你的ck' } }`。
3. `npm run build` 后重新部署 Netlify（`dist/`）。
4. 手机扫码访问一次，几分钟后去 51.la 后台看 实时访客/PV/UV/平均停留时长。

互动事件（各家后台 Events/事件 里看“看到哪一步”）：
`model_loaded / model_load_failed / demo_start / demo_pause / demo_resume /
demo_replay / demo_complete / demo_reset / slow_on/off / shell_on/off /
rotate_on/off / part_view（带 part 名）/ cam_reset / visit_complete
（带 visible_s 可见停留秒数 + bucket 分桶）`。

注意：

- PV 由各家脚本自动采集，本模块不再手动发 `page_view`（防重复计数）。
- 停留时长取“页面可见时间”（切后台/锁屏不计入），离开页面时补发
  `visit_complete`，各家自带的访问时长也可直接看。
- 尊重 `Do Not Track`：浏览器开了 DNT=1 则不加载任何统计脚本。
- 广告拦截插件可能拦截统计脚本，属正常现象；模块已做静默失败，
  拦截时不影响 3D 主流程。

## 改时间点 / 改部件说明

只改 `src/config.js`：`pulseTimes`、`stageTimeline`、`shellObjectNames`、
`componentInfo`、`componentKeywordFallback`。改完 `npm run build` 重新部署即可。
GLB 更新时覆盖 `public/models/rain-gauge.glb`（建议带版本号命名以便缓存失效）。

## 注意事项（GLB 真实结构）

1. 本版 GLB 为**裸机**（无完整外罩，见交付说明），「查看内部」半透明化的是
   顶部漏斗 / 中间汇集漏斗 / 底座阶梯外壳 / 底部漏斗（`shellObjectNames`）。
2. Blender glTF 导出器会清洗名称（空格→下划线、小数点去掉），如
   `顶部漏斗 Ø8 高8` → `顶部漏斗_Ø8_高8`。`config.js` 中的 key 必须是
   Three.js **运行时**名称，已用脚本逐条校验。
3. 取景包围盒已排除 `Water_* / Rain_* / Pulse_* / GLB_*` 辅助对象，
   否则雨滴（y=30）会把相机拉远。
4. 脉冲计数按绝对播放时间重算（`已到达时刻数 × 0.1`），暂停/慢放/重置
   不会重复计数；另有 `Pulse_Trigger.userData.pulse_frames = [289,393,489,585,681]`
   与配置互相印证。
