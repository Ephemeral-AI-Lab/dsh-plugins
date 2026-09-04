# Marketplace & manifest spec

This document defines the plugin marketplace: the manifest format, the
activation model, the generated index, and the trust model.

## Boundaries

The manifest is **discovery- and install-time metadata only**. It never
participates in runtime loading, capability negotiation, or admission — the
runtime contract of every plugin remains:

1. an installable package (npm or GitHub) understood by
   `dsh plugin --profile <name> add <spec>`, which forwards verbatim to pnpm;
2. the package's own `cordis.patch.yml`, declared via the `dsh.bundle.patch`
   field in its `package.json` — or rows the installer inserts into the
   profile's `cordis.patch.yml` (see [Activation](#activation)).

Mayfly intentionally has no runtime manifest; nothing here changes that.

## Manifest format

One JSON file per listing, validated against
[`registry/schema/plugin-manifest.v1.json`](../registry/schema/plugin-manifest.v1.json):

| field | required | meaning |
| --- | --- | --- |
| `schemaVersion` | ✓ | currently `1` |
| `id` | ✓ | unique slug; `/plugin install <id>` |
| `source` | ✓ | `official` \| `dsh` \| `community` — must match the directory under `registry/` |
| `displayName` | ✓ | shown in lists |
| `description` / `descriptionZh` | ✓ | one-liners, English and Chinese |
| `author` | ✓ | `{ name, url? }` |
| `links` | ✓ | `{ repo, docs, npm }` |
| `license` | ✓ | SPDX string |
| `category` | ✓ | `tools` `ui` `provider` `workflow` `testing` `integration` |
| `status` | ✓ | `stable` `beta` `unstable` `deprecated` `removed`; `deprecated`/`removed` require `statusNote` |
| `surfaces` | ✓ | what the plugin **contributes** — see below |
| `provides` |  | `{ tools: [...], commands: ["/..."] }` for display and search |
| `install.rows[]` | ✓ | ordered install units — see below |
| `engines` |  | `{ dsh, mayfly, node }` ranges; `mayfly` required with `surfaces.tui` |
| `capabilities` |  | review disclosure (`shell`, `network`, `credentials`, …) — not a runtime permission |
| `verified` | ✓ | `{ at, packages: [{ name, version, integrity? }] }` recorded at review time |

### Surfaces

```jsonc
"surfaces": {
  "server": {},                                    // dsh tools/services — any frontend
  "web":  { "clientModule": true },               // dsh Web React client module
  "tui":  { "contributions": ["panes", "status"] } // Mayfly UI contributions
}
```

The manifest declares what a plugin *contributes*. Value in a given frontend
is derived: **useful in frontend X = has `server` OR has X's own
contribution**. A `server + web` plugin in Mayfly shows "tools work, panel is
dsh-Web-only"; a `web`-only plugin warns on install from a TUI.

### Install rows

```jsonc
"install": {
  "rows": [
    {
      "id": "loop",                  // cordis patch row id (required for profile-patch)
      "name": "dsh-loop",            // runtime package name (reconcile key)
      "activation": "bundle",        // "bundle" (default) | "profile-patch"
      "config": { },                 // default config for profile-patch rows
      "npm":    { "spec": "dsh-loop" },
      "github": { "repo": "Ephemeral-AI-Lab/dsh-plugins", "ref": "main", "subdir": "plugins/loop" }
    }
  ]
}
```

- At least one of `npm` / `github` per row. `npm` is preferred when the
  package is published; `github` covers unpublished packages and monorepo
  subdirectories.
- pnpm spec grammar (dsh forwards verbatim):
  - npm: `name`, `name@version`, `name@tag`
  - GitHub: `github:<owner>/<repo>#<ref>` and, for monorepos,
    `github:<owner>/<repo>#<ref>&path:<subdir>`
- Community entries should pin `ref` to a commit SHA. Git installs fetch
  **sources**, so the referenced tree must contain build output (committed
  `lib/`) — CI scratch-installs every row and fails otherwise.
- All rows of an entry install together (`dsh plugin add a b ...`) and are
  removed together.
- `install.allowBuilds: ["node-pty"]` names packages whose install scripts
  pnpm may run. pnpm >= 10 blocks dependency build scripts by default; the
  installer writes these into the profile's `pnpm-workspace.yaml` before
  `pnpm add` (native addons like `node-pty` need this). Declare only what the
  plugin genuinely needs — reviewers scrutinize this list.

### Activation

Two ways an installed package becomes part of a profile:

1. **`bundle` (default)** — the package's `package.json` declares
   `dsh.bundle.patch`; dsh appends it to `dsh.profile.bundles` automatically
   after `pnpm add`. Nothing else to do.
2. **`profile-patch`** — used by `@deepseek-ai` optional plugins that ship no
   patch of their own. The installer must additionally append a row to the
   profile's `cordis.patch.yml` after installation:

   ```yaml
   - id: terminal-bash
     name: '@deepseek-ai/dsh-terminal-bash'
   ```

   The `/plugin` command writes these rows for you; manually, edit
   `$DSH_HOME/profiles/<name>/cordis.patch.yml` and let the patch watcher
   reload.

Bundle membership is a startup boundary in both cases: **restart the profile
and start a new session** after install or removal.

## Generated index

`scripts/build-index.mjs` aggregates every manifest into:

- `dist/index.json` — what Mayfly's `/plugin` consumes: all entries plus
  npm enrichment (latest version, integrity, publish date, month downloads)
  and a README excerpt.
- `dist/catalog.json` — the web catalog: the same entries plus full READMEs.

When `--offline` is passed, npm enrichment is emitted as null metadata and the
index is still generated. The normal online build records `updateAvailable`
when the latest npm version differs from the manifest's reviewed version.

Stable URLs: `raw.githubusercontent.com/Ephemeral-AI-Lab/dsh-plugins/main/dist/index.json`
(primary) and the jsDelivr mirror. Mayfly caches locally and falls back to
cached data when offline. `dist/` only changes through the `index-publish`
workflow's auto-merged PR.

## Trust model

Three tiers, recorded in `source`:

- **official** — source lives in this repository (Ephemeral AI Lab).
- **dsh** — DeepSeek's own optional plugins, listed with their docs.
- **community** — third-party listings that passed machine gates + human
  review ([review checklist](../registry/review-checklist.md)).

`verified` records what was reviewed and when (lightweight tier: entries
track the latest version after review; a weekly scheduled re-verification
flags new upstream versions). This is **disclosure and review, not a
sandbox**: plugins run with your user privileges. Installing a third-party
plugin is equivalent to installing an arbitrary npm package — read the
`capabilities` field.

To withdraw a listing, set `status: "removed"` with a `statusNote` — files
are never deleted, so installed users see why it disappeared.
