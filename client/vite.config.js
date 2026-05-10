import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Allow imports from the sibling `shared/` package (one level above the
  // client root). Without this, the dev server refuses to serve files
  // outside the workspace root.
  server: { port: 5173, fs: { allow: ['..'] } },
});
