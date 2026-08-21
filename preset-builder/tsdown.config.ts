import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'
import { transform } from 'lightningcss'

const packageId = 'dsh-preset-builder'
const prefix = '\0preset-builder-css:'
const suffix = '.mjs'
const files = new Map<string, string>()

export default {
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  noExternal: (id: string) => id.startsWith('react') ? undefined : true,
  plugins: [{
    name: 'preset-builder-css',
    resolveId(source: string, importer?: string) {
      if (!source.endsWith('.module.css') || importer === undefined) return null
      const file = resolve(dirname(importer), source)
      const id = `${prefix}${relative(process.cwd(), file).replaceAll('\\', '/')}${suffix}`
      files.set(id, file)
      return id
    },
    async load(this: { addWatchFile: (file: string) => void }, id: string) {
      if (!id.startsWith(prefix)) return null
      const file = files.get(id)
      if (file === undefined || !existsSync(file)) return null
      this.addWatchFile(file)
      const result = transform({
        filename: id.slice(prefix.length, -suffix.length),
        code: await readFile(file),
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classes = Object.fromEntries(Object.entries(result.exports ?? {})
        .map(([key, value]) => [key, value.name] as const))
      const styleId = `${packageId}/${basename(file)}`
      return `const css=${JSON.stringify(result.code.toString())};
const id=${JSON.stringify(styleId)};
if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + id + '"]') === null) {
  const tag=document.createElement('style'); tag.dataset.pluginCss=id; tag.textContent=css; document.head.appendChild(tag);
}
export default ${JSON.stringify(classes)};`
    },
  }],
  outputOptions: {
    codeSplitting: false,
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageId)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}
