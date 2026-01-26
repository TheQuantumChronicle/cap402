import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['index.ts', 'client.ts', 'agent.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['@solana/web3.js'],
  treeshake: true,
  minify: false,
});
