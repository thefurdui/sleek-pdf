const esbuild = require('esbuild')

const watch = process.argv.includes('--watch')

const buildOptions = {
  entryPoints: ['./pdfViewer.js'],
  bundle: true,
  outdir: 'dist',
  minify: !watch,
  sourcemap: watch,
  loader: {
    '.js': 'jsx',
    '.css': 'css',
    '.woff': 'file',
    '.woff2': 'file'
  }
}

if (watch) {
  // Watch mode
  esbuild.context(buildOptions).then((context) => {
    context.watch()
    console.log('Watching for changes...')
  })
} else {
  // Single build
  esbuild.build(buildOptions).catch(() => process.exit(1))
}
