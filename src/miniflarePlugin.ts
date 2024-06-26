import { CloudflareSpaConfig } from './CloudflareSpaConfig';
import { UnstableDevWorker, unstable_dev } from 'wrangler';
import { convertWranglerResponse, makeWranglerFetch } from './utils';
import { getViteConfig } from './utils';
import type { Plugin, PluginOption } from 'vite';

export const miniflarePlugin: (config?: CloudflareSpaConfig) => PluginOption = (config?: CloudflareSpaConfig) => {
  let wranglerDevServer: UnstableDevWorker;

  const functionEntrypoint = config?.functionEntrypoint || 'functions/index.ts';
  const wranglerConfig = config?.wranglerConfig || {
    logLevel: 'log',
  };

  // force these Wrangler settings so HMR works for pages functions
  wranglerConfig.experimental = {
    liveReload: true,
    testMode: false,
    disableExperimentalWarning: true, //disable because it's annoying
  };

  const allowedApiPaths = config?.allowedApiPaths || ['/api/*'];
  const excludedApiPaths = config?.excludedApiPaths || [];

  const plugin = {
    name: 'vite-plugin-wrangler-spa:miniflare',
    config: (_, { command }) => {
      if (command === 'serve') return getViteConfig(config);
    },
    configureServer: async (devServer) => {
      if (!wranglerDevServer) wranglerDevServer = await unstable_dev(functionEntrypoint, wranglerConfig);

      devServer.middlewares.use(async (req, res, next) => {
        const { url } = req;

        if (url === undefined) throw new Error('url is undefined!');
        if (excludedApiPaths.find((x) => new RegExp(x).test(url))) return next();
        if (allowedApiPaths.find((x) => new RegExp(x).test(url))) {
          const resp = await makeWranglerFetch(req, wranglerDevServer);
          convertWranglerResponse(resp, res);
          return res;
        }

        return next();
      });
    },
    handleHotUpdate: async (ctx) => {
      if (ctx.file.includes(functionEntrypoint.split('/')[0]))
        ctx.server.hot.send({
          type: 'custom',
          event: 'function-update',
          data: { file: ctx.file },
        });
    },
    transformIndexHtml: {
      order: 'pre',
      handler: () => [
        {
          tag: 'script',
          attrs: { type: 'module' },
          children: browserHmrNotification,
        },
      ],
    },
  } as Plugin;

  return plugin;
};

const browserHmrNotification = `
if (import.meta.hot) {
  let outputColor = "color:cyan; font-weight:bold;"
  import.meta.hot.on('function-update', (data) => {
    console.log(\`%c 🔥 Cloudflare Pages Function - update detected in file: '\${data.file}'\`, outputColor);
    location.reload(true);
  }); 
}`;
