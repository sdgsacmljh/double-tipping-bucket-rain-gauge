import { defineConfig } from 'vite';

// 纯静态部署：相对路径 base，dist/ 可直接上传 Netlify / Cloudflare Pages。
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200
  },
  server: {
    port: 5173
  }
});
