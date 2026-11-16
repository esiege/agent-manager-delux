import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

/**
 * In development, /answer serves answer.html, as the site's routes do in Azure
 * (staticwebapp.config.json). Everything else falls back to the app, as before.
 */
function answerPage(): Plugin {
  return {
    name: 'answer-page',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && /^\/answer(\?|$)/.test(req.url)) req.url = req.url.replace(/^\/answer/, '/answer.html');
        next();
      });
    },
  };
}

// In development the API runs locally under Azure Functions Core Tools (`npm run dev:api`).
// Two pages: the app (index.html), and the answer page feedback emails link to (answer.html),
// which works without signing in.
export default defineConfig({
  plugins: [react(), answerPage()],
  server: {
    proxy: {
      '/api': 'http://localhost:7071',
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: page('index.html'),
        answer: page('answer.html'),
      },
      output: {
        // Libraries change less often than the app, so they get their own cacheable files.
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client', 'react-router'],
          mantine: ['@mantine/core', '@mantine/hooks', '@mantine/notifications'],
          table: ['@tanstack/react-table'],
        },
      },
    },
  },
});
