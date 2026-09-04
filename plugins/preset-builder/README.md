# dsh-preset-builder

A small DeepSeek Harness UI plugin that adds **Preset details** to Settings.
It makes preset inspection explicit and shows the exact `agent.cordis.yml`
returned by DSH's existing read-only preset API.

```sh
dsh plugin --profile web add ./preset-builder
```

Restart DSH after installation. The existing **Agent presets** page remains the
place to select, duplicate, edit, and delete presets; this plugin is deliberately
an inspection prototype, so it does not replace or regress those controls.
