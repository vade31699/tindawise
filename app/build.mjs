import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  outfile: 'www/assets/js/backend.js',
  logLevel: 'info',
  minify: !watch,
  sourcemap: false,
  legalComments: 'none',
};

async function run() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('[build] watching src/ …');
    return;
  }
  const result = await esbuild.build(options);
  if (result.errors.length) process.exit(1);
  console.log('[build] wrote www/assets/js/backend.js');
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});