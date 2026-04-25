import esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createRequire } from 'module';
import { copyFileSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const isWatch = process.argv.includes('--watch');

// Built-in Node.js modules that should not be resolved
const builtins = new Set([
  'fs', 'path', 'child_process', 'crypto', 'events', 'stream', 'util',
  'http', 'https', 'net', 'os', 'url', 'zlib', 'buffer', 'process',
  'assert', 'constants', 'dns', 'domain', 'dgram', 'querystring',
  'readline', 'repl', 'string_decoder', 'sys', 'timers', 'tls', 'tty', 'vm',
]);

// Plugin to resolve modules from local node_modules, bypassing Yarn PnP
const localNodeModulesPlugin = {
  name: 'local-node-modules',
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, args => {
      // Skip built-in modules
      if (builtins.has(args.path.split('/')[0])) {
        return null;
      }

      try {
        // Try to resolve from local node_modules
        const resolved = require.resolve(args.path, {
          paths: [resolve(__dirname, 'node_modules')]
        });
        return { path: resolved };
      } catch (e) {
        return null; // Let esbuild handle it
      }
    });
  },
};

const buildOptions = {
  entryPoints: ['./src/backend/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: './dist/backend.js',
  external: [], // Bundle everything, including cron-parser
  sourcemap: true,
  target: 'node18',
  plugins: [localNodeModulesPlugin],
};

// Ensure dist directory exists
mkdirSync(resolve(__dirname, 'dist'), { recursive: true });

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(buildOptions).catch(() => process.exit(1));

  // Copy frontend to dist
  copyFileSync(
    resolve(__dirname, 'src/frontend/index.js'),
    resolve(__dirname, 'dist/frontend.js')
  );
  console.log('Built backend.js and copied frontend.js to dist/');
}
