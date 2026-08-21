import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { en, NS, zh, type Key } from './locales.js'
import css from './style.module.css'

type Api = ConnectionHandle['api'] & { agentPresets: ConnectionHandle['api']['agentPresets'] & {
  mutate(payload: { agentPreset: string; expectedRevision: string; mutation:
    | { op: 'set-disabled'; pluginId: string; disabled: boolean }
    | { op: 'set-config'; pluginId: string; config: unknown }
  }): Promise<{ result: { ok: true; value: { agentPreset: string } } | { ok: false; error: { message: string } } }>
} }
interface Preset { readonly id: string; readonly trust: 'system' | 'user'; readonly isDefault: boolean; readonly name?: string; readonly description?: string; readonly broken?: string }
interface Plugin { readonly id: string; readonly name: string; readonly disabled: boolean; readonly config?: unknown }
interface Tool { readonly name: string; readonly description: string }
interface Detail { readonly content: string; readonly revision: string; readonly plugins: readonly Plugin[]; readonly tools: readonly Tool[] }

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { presetBuilder: Key } }
interface Injected { api: Api }
type Props = PropsRuntime<'settings.section'> & PropsLocale<'presetBuilder'> & Injected

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function displayPlugin(plugin: Plugin): string {
  return plugin.id.replace(/^tool-/, '').replaceAll('-', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

export function PresetDetails({ api, t }: Props): ReactNode {
  const [presets, setPresets] = useState<readonly Preset[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [selectedPluginId, setSelectedPluginId] = useState('')
  const [configDraft, setConfigDraft] = useState('{}')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [error, setError] = useState('')
  const selectedPreset = presets.find(preset => preset.id === selectedId)
  const selectedPlugin = detail?.plugins.find(plugin => plugin.id === selectedPluginId)

  const readPreset = async (id: string): Promise<void> => {
    setStatus('loading'); setError('')
    try {
      const response = await api.agentPresets.read({ agentPreset: id })
      if (!response.result.ok) throw new Error(response.result.error.message)
      const value = response.result.value as typeof response.result.value & Detail
      setDetail({ content: value.content, revision: value.revision, plugins: value.plugins, tools: value.tools })
      setSelectedPluginId(value.plugins[0]?.id ?? '')
      setStatus('ready')
    } catch (cause) { setError(messageOf(cause)); setStatus('error') }
  }

  const load = async (): Promise<void> => {
    setStatus('loading')
    try {
      const response = await api.agentPresets.list({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      const rows = response.result.value.presets as readonly Preset[]
      const id = rows.find(preset => preset.isDefault)?.id ?? rows[0]?.id ?? ''
      setPresets(rows); setSelectedId(id)
      if (id !== '') await readPreset(id); else setStatus('ready')
    } catch (cause) { setError(messageOf(cause)); setStatus('error') }
  }

  const mutate = async (mutation: Parameters<Api['agentPresets']['mutate']>[0]['mutation']): Promise<void> => {
    if (detail === null || selectedPreset?.trust !== 'user') return
    setStatus('saving'); setError('')
    try {
      const response = await api.agentPresets.mutate({ agentPreset: selectedPreset.id, expectedRevision: detail.revision, mutation })
      if (!response.result.ok) throw new Error(response.result.error.message)
      await readPreset(selectedPreset.id)
    } catch (cause) { setError(messageOf(cause)); setStatus('error') }
  }

  useEffect(() => { void load() }, [api])
  useEffect(() => { setConfigDraft(JSON.stringify(selectedPlugin?.config ?? {}, null, 2)) }, [selectedPlugin])
  const visibleTools = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (detail?.tools ?? []).filter(tool => needle === '' || tool.name.toLowerCase().includes(needle) || tool.description.toLowerCase().includes(needle))
  }, [detail, query])

  if (status === 'loading' && detail === null) return <p className={css.muted}>{t('loading')}</p>
  if (status === 'error' && detail === null) return <div className={css.section}><p className={css.error}>{error}</p><button className={css.button} onClick={() => { void load() }}>{t('retry')}</button></div>
  const editable = selectedPreset?.trust === 'user'
  const enabled = detail?.plugins.filter(plugin => !plugin.disabled).length ?? 0

  return <div className={css.section}>
    <header className={css.header}>
      <div><span className={css.eyebrow}>{t('nav')}</span><h2>{selectedPreset?.name ?? selectedPreset?.id ?? t('title')}</h2><p>{selectedPreset?.description ?? t('intro')}</p></div>
      <div className={css.headerActions}>
        <label><span>{t('preset')}</span><select value={selectedId} onChange={event => { setSelectedId(event.target.value); void readPreset(event.target.value) }}>{presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name ?? preset.id}</option>)}</select></label>
        <span className={status === 'saving' ? css.saving : css.saved}>{status === 'saving' ? t('saving') : t('saved')}</span>
      </div>
    </header>
    {error === '' ? null : <p className={css.error} role="alert">{error}</p>}
    {!editable && selectedPreset !== undefined ? <p className={css.notice}>{t('readOnly')}</p> : null}

    <section className={css.toolSurface}>
      <div className={css.surfaceHead}><div><h3>{t('effectiveTools')}</h3><p>{t('toolSummary').replace('{tools}', String(detail?.tools.length ?? 0)).replace('{plugins}', String(enabled))}</p></div><input value={query} onChange={event => { setQuery(event.target.value) }} placeholder={t('searchTools')} aria-label={t('searchTools')} /></div>
      <ul className={css.tools}>{visibleTools.map(tool => <li key={tool.name} title={tool.description}><span className={css.toolDot} /><code>{tool.name}</code><span>{tool.description}</span></li>)}</ul>
    </section>

    <div className={css.workbench}>
      <section className={css.pluginStack}>
        <div className={css.panelHead}><div><h3>{t('plugins')}</h3><p>{t('pluginSummary').replace('{enabled}', String(enabled)).replace('{all}', String(detail?.plugins.length ?? 0))}</p></div></div>
        <ul>{(detail?.plugins ?? []).map(plugin => <li key={plugin.id} className={plugin.id === selectedPluginId ? css.pluginSelected : ''}>
          <button type="button" className={css.pluginMain} onClick={() => { setSelectedPluginId(plugin.id) }}><strong>{displayPlugin(plugin)}</strong><code>{plugin.name}</code></button>
          <label className={css.switch} title={editable ? t('togglePlugin') : t('readOnly')}><input type="checkbox" checked={!plugin.disabled} disabled={!editable || status === 'saving'} onChange={event => { void mutate({ op: 'set-disabled', pluginId: plugin.id, disabled: !event.target.checked }) }} /><span /></label>
        </li>)}</ul>
      </section>

      <aside className={css.configPanel}>{selectedPlugin === undefined ? <p className={css.muted}>{t('selectPlugin')}</p> : <>
        <div className={css.panelHead}><div><span className={css.eyebrow}>{t('configuration')}</span><h3>{displayPlugin(selectedPlugin)}</h3><code>{selectedPlugin.id}</code></div></div>
        <label className={css.configField}><span>{t('configJson')}</span><textarea value={configDraft} spellCheck={false} disabled={!editable} onChange={event => { setConfigDraft(event.target.value) }} /></label>
        <button className={css.primaryButton} type="button" disabled={!editable || status === 'saving'} onClick={() => { try { void mutate({ op: 'set-config', pluginId: selectedPlugin.id, config: JSON.parse(configDraft) }) } catch (cause) { setError(messageOf(cause)) } }}>{t('saveValidate')}</button>
      </>}</aside>
    </div>

    <details className={css.advanced}><summary>{t('rawConfig')}</summary><pre>{detail?.content}</pre></details>
  </div>
}

export const inject = ['slots', 'locale', 'connection']
export function apply(ctx: ClientContext): void {
  const { api } = ctx.get('connection') as ConnectionHandle
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'preset-builder: dictionaries')
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'preset-details', order: 21, label: () => ctx.locale.bind(NS)('nav'), locale: NS, inject: () => ({ api: api as Api }) }, PresetDetails))
}
