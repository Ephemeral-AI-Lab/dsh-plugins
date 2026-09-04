# Review checklist

Machine gates (CI runs these automatically on every registry PR):

- [ ] `node scripts/validate-manifests.mjs` passes (schema, unique ids, source
      matches directory, `engines.mayfly` present for `surfaces.tui`).
- [ ] ajv validates every manifest against
      `registry/schema/plugin-manifest.v1.json`.
- [ ] `node scripts/verify-packages.mjs` passes: every npm row exists on the
      registry and its requested tarball is a real dsh plugin (or the row is
      `activation: profile-patch`); every GitHub row scratch-installs and the
      installed package declares an existing `dsh.bundle.patch` file.
- [ ] No new warnings without justification: install lifecycle scripts,
      native binaries, stale version pins.

Human review (maintainer, before merge):

- [ ] The PR author controls the package (issue/comment link in the plugin's
      own repository), or the author explicitly approved the listing.
- [ ] `displayName`/`description`/`descriptionZh` are accurate and not
      misleading about what runs locally.
- [ ] `surfaces` is honest: `server` only if it contributes tools/services;
      `web`/`tui` only if the client module / Mayfly contributions exist.
- [ ] `provides` lists real tool and command names (grep the source).
- [ ] `capabilities` discloses everything a reviewer would want flagged:
      shell execution, network, credential access, session writes.
- [ ] Unload behavior: the plugin's registrations (commands, UI, listeners)
      disappear when its Cordis fiber unloads — check the source uses
      `ctx.effect`/disposers rather than global state.
- [ ] `verified.at` is today and `verified.packages` records the exact
      reviewed versions; a GitHub-only entry pins a commit `ref`.
- [ ] README of the plugin documents injected services and install steps.

Post-merge:

- [ ] `index-publish` workflow rebuilt `dist/` and the auto-PR was merged.
- [ ] Weekly re-verification flags `updateAvailable` on new upstream
      versions; re-review the diff before clearing the flag.

Deprecation / removal:

- [ ] Set `status` to `deprecated` or `removed` plus a `statusNote`; never
      delete the manifest file.
- [ ] If removed for security reasons, say so plainly in the note.
