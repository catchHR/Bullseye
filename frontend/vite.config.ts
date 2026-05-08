import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  /** Relativ zum Mount-Pfad; passt zu jedem `basePath` ohne Neu-Build. */
  base: './',
  optimizeDeps: {
    include: ['quill', 'react-quill'],
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }
          if (id.includes('recharts')) {
            return 'recharts';
          }
          if (id.includes('react-quill') || id.includes('node_modules/quill')) {
            return 'quill';
          }
          if (id.includes('@radix-ui')) {
            return 'radix-ui';
          }
          if (id.includes('lucide-react')) {
            return 'lucide';
          }
          if (id.includes('cmdk')) {
            return 'cmdk';
          }
          if (id.includes('sonner')) {
            return 'sonner';
          }
          if (
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/react/') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'react-vendor';
          }
          return 'vendor';
        },
      },
    },
  },
});
