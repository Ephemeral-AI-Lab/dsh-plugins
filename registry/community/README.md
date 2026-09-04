# Community submissions

This directory holds marketplace manifests for third-party plugins. A manifest
is discovery- and install-time metadata only — the runtime contract remains
your npm package (or GitHub repo) plus its `cordis.patch.yml`.

## How to submit

1. Publish your plugin as an ordinary Cordis package (see the Mayfly plugin
   docs and `docs/market.md` here). It must:
   - declare `dsh.bundle.patch` in `package.json` (self-activating bundle), or
     be installable through installer-inserted profile patch rows;
   - ship its build output and `cordis.patch.yml` in the installed artifact.
2. Copy `registry/submission-template.json` to
   `registry/community/<your-slug>.json`, fill it in, and open a PR.
3. Open an issue or comment in **your** repository linking the PR, as evidence
   you authorize the listing (prevents impersonation).
4. CI validates the manifest and scratch-installs every declared source.
   A maintainer then reviews against `registry/review-checklist.md`.

## Rules

- One manifest per plugin; the `id` is permanent — never reuse a removed id.
- npm source is preferred. GitHub source is accepted for unpublished packages:
  pin a commit `ref` (see `docs/market.md` for the spec grammar) and ship
  committed build output, because git installs fetch sources.
- Declare `surfaces` honestly: `server` for dsh tools/services any frontend
  can use, `web` for a dsh Web client module, `tui` for Mayfly pane / status /
  overlay / editor-extension contributions.
- To withdraw a plugin, do not delete the manifest — set `status` to
  `removed` with a `statusNote`. Users who installed it see why.
