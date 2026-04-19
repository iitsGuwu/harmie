import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    server: {
      proxy: {
        // Proxy Helius RPC requests through Vite dev server
        // The client hits /api/helius
        // This rewrites to https://mainnet.helius-rpc.com/?api-key=XXX
        // keeping the API key hidden from the browser
        '/api/helius': {
          target: 'https://mainnet.helius-rpc.com',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => {
            return `/?api-key=${env.HELIUS_API_KEY || ''}`;
          },
        },
        // Proxy Magic Eden API requests
        '/api/magiceden': {
          target: 'https://api-mainnet.magiceden.dev',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/magiceden/, ''),
        },
      },
    },
  };
});
