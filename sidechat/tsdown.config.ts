import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'
import { transform } from 'lightningcss'

const packageId = 'dsh-sidechat'
const cssPrefix = '\0dsh-sidechat-css:'
const cssSuffix = '.mjs'
const externals = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']
const cssFiles = new Map<string, string>()

export default {
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: externals,
  noExternal: (id: string) => externals.includes(id) ? undefined : true,
  plugins: [{
    name: 'sidechat-css-modules',
    resolveId(source: string, importer?: string) {
      if (!source.endsWith('.module.css') || importer === undefined) return null
      const file = resolve(dirname(importer), source)
      const id = `${cssPrefix}${relative(process.cwd(), file).replaceAll('\\', '/')}${cssSuffix}`
      cssFiles.set(id, file)
      return id
    },
    async load(this: { addWatchFile: (file: string) => void }, id: string) {
      if (!id.startsWith(cssPrefix)) return null
      const file = cssFiles.get(id)
      if (file === undefined || !existsSync(file)) return null
      this.addWatchFile(file)
      const result = transform({
        filename: id.slice(cssPrefix.length, -cssSuffix.length),
        code: await readFile(file),
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classes = Object.fromEntries(Object.entries(result.exports ?? {})
        .map(([key, value]) => [key, value.name] as const)
        .sort(([left], [right]) => left.localeCompare(right, 'en')))
      const styleId = `${packageId}/${basename(file)}`
      return `const css=${JSON.stringify(result.code.toString())};
const id=${JSON.stringify(styleId)};
if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + id + '"]') === null) {
  const tag=document.createElement('style'); tag.dataset.plugin=${JSON.stringify(packageId)}; tag.dataset.pluginCss=id; tag.textContent=css; document.head.appendChild(tag);
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
