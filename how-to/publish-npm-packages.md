# How to Publish npm Packages

Publishing is npm's term for submitting a package to the registry. This guide
covers the complete release path: choosing a reusable name and version,
reviewing the exact tarball, authenticating securely, publishing directly or
through a staged release, and independently verifying what became public.

> Policy baseline: npm public-registry documentation checked on 2026-08-21.
> npm security and publishing rules change over time, so recheck the linked
> official documentation before changing a release workflow.

## Outcome

A successful release should leave evidence for every row:

| Check | Evidence |
|---|---|
| Identity | Exact `name@version` from `package.json` |
| Quality | Tests, typecheck, and build complete successfully |
| Contents | `npm pack --dry-run` contains only intended files |
| Authentication | Correct npm user with publishing 2FA or an authorized publishing mechanism |
| Publication | Registry reports the exact version and intended dist-tag |
| Ownership | Expected maintainers retain access |
| Artifact | Downloaded registry tarball contains the expected manifest, entry points, and configuration |
| Security | No token, key, password, private path, or unnecessary data was published |

Do not treat a zero exit code, browser confirmation, or npm package page by
itself as sufficient proof. Verify the public registry metadata and tarball.

## 1. Choose the publication path

npm supports three useful release paths:

| Path | Use it when | Important constraint |
|---|---|---|
| Direct publish | First release, ordinary manual release, or a simple one-off package | Requires account 2FA or a granular token allowed to bypass publishing 2FA |
| Staged publish | An existing package needs review and explicit approval before becoming public | Cannot create a brand-new package; approval always requires 2FA |
| Trusted publishing | A repeatable CI/CD workflow publishes from a supported hosted runner | Configure the package-to-workflow trust relationship first |

For a brand-new package, start with direct publishing. After the first release,
consider [trusted publishing](https://docs.npmjs.com/trusted-publishers/) for
repeatable CI/CD releases or
[staged publishing](https://docs.npmjs.com/staged-publishing/) when a human must
approve each prepared artifact.

## 2. Fix the package identity before building

Run every release command from the package directory, not merely the
repository root:

```sh
cd /absolute/path/to/package
```

Read the identity directly from `package.json`:

```sh
npm pkg get name version private publishConfig
```

Or fail a script when the identity is not the intended release:

```sh
node -e '
  const packageJson = require("./package.json")
  if (packageJson.name !== "example-package") throw new Error("wrong package name")
  if (packageJson.version !== "1.2.3") throw new Error("wrong package version")
  if (packageJson.private === true) throw new Error("package is private")
  console.log(`${packageJson.name}@${packageJson.version}`)
'
```

### Name and access rules

| Package form | Example | Default visibility | Publish command |
|---|---|---|---|
| Unscoped | `example-package` | Always public | `npm publish` |
| Public user-scoped | `@username/example-package` | Scoped packages are restricted by default | `npm publish --access public` |
| Public organization-scoped | `@organization/example-package` | Scoped packages are restricted by default | `npm publish --access public` |
| Private scoped | `@organization/example-package` | Restricted; paid/private-package access may be required | `npm publish` or `npm publish --access restricted` |

Unscoped packages occupy the global namespace. A scope gives a user or
organization its own namespace. See npm's official
[scope and visibility rules](https://docs.npmjs.com/about-scopes/) and
[organization-scoped publishing guide](https://docs.npmjs.com/creating-and-publishing-an-organization-scoped-package/).

For a public package, make the intent durable when appropriate:

```json
{
  "publishConfig": {
    "access": "public"
  }
}
```

The CLI flag is still useful during the first scoped publication because it
makes the action explicit.

### Versions are immutable

Treat every `package-name@version` as permanent. Once npm has accepted that
combination, it can never be reused, even if the version or entire package is
later unpublished.

Check both the exact target and existing version history:

```sh
npm view example-package@1.2.3 name version
npm view example-package versions --json
```

Interpret the result carefully:

| Result | Meaning |
|---|---|
| Exact version exists | Choose a new version; never overwrite it |
| Package exists but exact version does not | Confirm your account owns it, then publish the new version |
| `E404` for a new name | The name may be available; continue the other checks |
| Package was completely unpublished recently | Wait through npm's 24-hour name block and use a new version |

An `E404` is not an ownership guarantee. Recheck immediately before the real
publish because another user may claim an unscoped name.

## 3. Make the manifest publishable

A practical ESM library manifest commonly contains:

```json
{
  "name": "example-package",
  "version": "1.2.3",
  "description": "A short, accurate description",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/index.d.ts",
      "default": "./lib/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": [
    "lib",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "prepare": "npm run build",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

Adapt the entry points and scripts to the package. Do not add placeholder
fields or publish generated files that consumers do not need.

Before releasing, verify at least:

- `private` is absent or `false`.
- `name` and `version` are exact.
- `main`, `module`, `types`, and `exports` point to files produced by the build.
- Runtime requirements are in `dependencies` or `peerDependencies`, not only
  `devDependencies`.
- `files` is an allowlist whenever practical.
- `README.md`, license information, repository URL, and changelog are accurate.
- `prepare` cannot silently publish stale compiled output.

### DeepSeek Harness plugin check

A packaged DSH bundle can point to a Cordis patch:

```json
{
  "name": "dsh-example-plugin",
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },
  "files": [
    "lib",
    "cordis.patch.yml",
    "README.md"
  ]
}
```

The patch must use the npm package name that consumers will install:

```yaml
- insert:
    - id: example-plugin
      name: 'dsh-example-plugin'
```

Check the manifest and patch together:

```sh
node -e '
  const packageJson = require("./package.json")
  if (packageJson.dsh?.bundle?.patch !== "./cordis.patch.yml") {
    throw new Error("wrong DSH bundle patch")
  }
  console.log(packageJson.name)
'

sed -n '1,20p' cordis.patch.yml
```

The Cordis row `id` and npm package `name` may differ, but the difference must
be deliberate and reflected in presets, tests, and documentation.

## 4. Build and test the exact release source

Use the package manager and lockfile committed by the project. A typical npm
release check is:

```sh
npm ci
npm test
npm run typecheck --if-present
npm run build --if-present
```

For a pnpm-managed package, use the repository's pinned pnpm version:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

If the package has operating-system-specific process, native-module, or path
behavior, run the relevant platform checks before publishing. A successful
TypeScript compile does not prove that native modules load or that the runtime
entry point works.

Smoke-test the built entry point directly:

```sh
node --input-type=module -e '
  const packageModule = await import("./lib/index.js")
  console.log(Object.keys(packageModule))
'
```

Use assertions for known exported values rather than accepting any successful
import as proof.

## 5. Inspect the exact npm tarball

`npm publish` uploads a packed tarball, not an abstract view of the working
tree. Inspect that tarball before authenticating:

```sh
npm pack --dry-run
```

For machine-readable evidence:

```sh
npm pack --dry-run --json \
  | jq '.[0] | {
      id,
      filename,
      size,
      unpackedSize,
      entryCount,
      files: [.files[].path]
    }'
```

Confirm that:

- The reported `id` is the intended `name@version`.
- The tarball filename contains the intended name and version.
- Compiled entry points and declarations are present.
- Required runtime configuration is present.
- Tests, fixtures, source maps, screenshots, and documentation are included
  only when intended.
- `.env`, credentials, private keys, local databases, editor state, and
  machine-specific files are absent.

Search by filename rather than printing possible secrets into a terminal log:

```sh
rg -l --hidden \
  --glob '!node_modules/**' \
  --glob '!.git/**' \
  '(BEGIN [A-Z ]*PRIVATE KEY|npm_[A-Za-z0-9]+|AKIA[0-9A-Z]{16}|/User[s]/|C:\\User[s]\\)' \
  .
```

Every reported file requires review. A secret that has entered Git history or
chat must be revoked even if it is removed from the final tarball.

## 6. Verify npm authentication and ownership

Confirm the registry and authenticated identity:

```sh
npm config get registry
npm whoami
npm profile get --json | jq '{name,tfa}'
```

Expected registry:

```text
https://registry.npmjs.org/
```

For an existing package, confirm ownership before trying to publish:

```sh
npm owner ls example-package
```

Do not assume that repository ownership, a recovered npm account, or previous
organization membership still grants registry access. Registry maintainers are
the authoritative list.

### Direct-publish authentication

npm requires one of these for direct publishing:

1. Account-level 2FA enabled for authorization and writes, with interactive
   proof during the publish; or
2. A granular access token with read/write permission and **Bypass 2FA**
   enabled for publishing.

See npm's current
[publishing 2FA requirements](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/)
and [granular-token behavior](https://docs.npmjs.com/about-access-tokens/).

Security rules:

- Never paste a token into chat, an issue, a pull request, a command example,
  or a committed `.npmrc`.
- Never pass a long-lived token as a literal shell argument when a secret
  store or protected environment variable is available.
- Give a token the narrowest package/scope and shortest practical lifetime.
- Prefer trusted publishing for repeat CI/CD releases.
- Revoke a token immediately after any accidental disclosure; do not test
  whether a disclosed token still works.
- Store recovery codes separately from the npm password and authenticator.

For CI, a project `.npmrc` can reference an environment variable without
containing the resolved token:

```ini
//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}
```

Set `NODE_AUTH_TOKEN` in the CI platform's protected secret store, not in the
workflow file.

## 7. Publish directly

Immediately before the real write, rerun the identity and tarball checks:

```sh
npm whoami
npm pkg get name version private
npm publish --dry-run --access public
```

Then publish once:

```sh
npm publish --access public
```

The explicit access flag is required for a new public scoped package and is
harmlessly explicit for a public release workflow.

For a prerelease, use a non-`latest` tag:

```sh
npm publish --access public --tag next
```

Do not place an alpha, beta, or release candidate on `latest` unless that is
the intended default installation.

### Interactive web authentication

The CLI may print an npm authentication URL and wait for browser approval.
Complete the approval in the account that `npm whoami` reported.

If the CLI crashes, times out, or prints an ambiguous result after approval,
do **not** immediately rerun the publish. First query the registry:

```sh
npm view example-package@1.2.3 name version dist-tags --json
```

If the version exists, the publication succeeded despite the local error. If
it does not exist, diagnose authentication or the CLI before retrying.

## 8. Use staged publishing for an existing package

Staged publishing separates artifact submission from the public release.

Prerequisites:

- npm CLI 11.15.0 or later.
- Node.js 22.14.0 or later.
- The package already exists on npm.
- The user has publish access.
- Account 2FA is enabled.

A brand-new package cannot be staged. Publish its first version directly.

Stage an existing package version:

```sh
npm stage publish
```

Review it:

```sh
npm stage list example-package
npm stage view STAGE_ID
npm stage download STAGE_ID
```

Approve and make it public:

```sh
npm stage approve STAGE_ID
```

Or reject it permanently:

```sh
npm stage reject STAGE_ID
```

Important behavior:

- Staging itself does not require a 2FA prompt.
- Approval or rejection requires interactive 2FA.
- A staged `name@version` reserves that immutable version.
- The selected dist-tag is fixed when the package is staged.
- A granular token's bypass setting does not bypass staged approval.

## 9. Prefer trusted publishing for repeat releases

Trusted publishing uses OIDC from a configured CI/CD workflow instead of a
long-lived write token. npm currently supports designated hosted environments
including GitHub Actions, GitLab.com shared runners, and CircleCI cloud; check
the [current trusted-publisher requirements](https://docs.npmjs.com/trusted-publishers/)
before configuring a workflow.

For GitHub Actions, the essential permission is:

```yaml
permissions:
  id-token: write
  contents: read
```

The package's npm settings must name the exact repository and workflow file.
The workflow then installs, tests, builds, and calls `npm publish` without a
long-lived publishing token.

Trusted publishing is best configured after the first direct release because
the package settings must already exist. After a successful OIDC release,
remove obsolete write tokens.

## 10. Verify the public release independently

Query the exact version, not only the `latest` tag:

```sh
npm view example-package@1.2.3 \
  name version dist-tags maintainers dist.shasum dist.integrity \
  --json
```

Check the current owner list:

```sh
npm owner ls example-package
```

Inspect the public tarball without trusting the local build directory:

```sh
release_spec='example-package@1.2.3'
release_tarball=$(npm view "$release_spec" dist.tarball)
curl --fail --silent --show-error "$release_tarball" | tar -tzf -
```

Inspect a specific file from the published artifact:

```sh
curl --fail --silent --show-error "$release_tarball" \
  | tar -xzOf - package/package.json
```

For a DSH plugin, verify its published Cordis patch:

```sh
curl --fail --silent --show-error "$release_tarball" \
  | tar -xzOf - package/cordis.patch.yml
```

Expected pattern:

```yaml
- insert:
    - id: example-plugin
      name: 'dsh-example-plugin'
```

Finally, install the registry version in a clean disposable directory or test
environment and exercise its public entry point. Do not let a workspace link
or local package-manager override substitute the source checkout for the
registry artifact.

## 11. Publish several packages safely

For a multi-package release:

1. Determine dependency order. Publish shared libraries before packages that
   require their new versions.
2. Record the exact name, version, directory, access, and intended tag for
   every package.
3. Test and dry-run all packages before publishing the first one.
4. Publish one package at a time.
5. Verify that package from the registry before proceeding.
6. Stop on the first unexpected result; do not continue with a partially
   understood release.

Use a release table:

| Directory | Target | Tag | Dry-run | Published | Registry verified |
|---|---|---|---|---|---|
| `packages/core` | `example-core@1.2.3` | `latest` | Yes |  |  |
| `packages/plugin` | `example-plugin@2.0.0` | `latest` | Yes |  |  |

Do not run an unreviewed recursive publish command over every workspace
package. It can include private examples, fixtures, stale versions, or packages
that need a different tag.

## 12. Understand unpublishing and organization deletion

npm registry data is immutable. Unpublishing removes installability; it does
not make an old `name@version` reusable.

According to npm's current
[unpublish policy](https://docs.npmjs.com/policies/unpublish/):

- A previously used exact version can never be published again.
- Completely unpublishing a package blocks its name from new publication for
  24 hours.
- After the block expires, use a version higher than every removed version.
- Name reuse can become a race in the global unscoped namespace.

Example:

```text
Removed versions: example-package@0.1.0 through 0.1.3
Earliest reusable version: 0.1.4
Name reuse: only after the 24-hour package-name block expires
```

Deleting an organization can delete packages that satisfy npm's unpublish
requirements; packages that cannot be unpublished may remain or be deprecated.
Review npm's
[organization deletion behavior](https://docs.npmjs.com/deleting-an-organization/)
before deleting an organization.

If a package remains but its maintainer becomes `npm-support`, waiting will not
release the name. Open an npm Support request with the package name, previous
account, organization, source repository, historical email, and proof of
control. Account recovery and package-ownership recovery are separate tasks.

## 13. Troubleshooting

| Error or symptom | Likely cause | Safe response |
|---|---|---|
| `E403` requiring 2FA or a bypass token | Account 2FA is disabled, the publish was not interactively approved, or the token lacks bypass permission | Enable authorization-and-writes 2FA or replace the token with an appropriately scoped publishing credential |
| `E403` no permission to publish | Authenticated user is not a maintainer, organization access is missing, or the name belongs to someone else | Run `npm whoami` and `npm owner ls`; contact the owner or npm Support |
| `E404` before a first release | Package does not exist | Recheck the intended name and proceed only after all other release checks |
| `E404` after a reported success | Registry propagation delay, wrong registry, wrong name, or publication actually failed | Check `npm config get registry`, wait briefly, and query the raw public registry |
| `EPUBLISHCONFLICT` | Exact version already exists or is staged | Inspect versions and publish a new version; never try to overwrite |
| Name blocked after complete unpublish | npm's 24-hour name lock is active | Wait until the recorded unpublish time plus 24 hours and use a new version |
| Browser approval completed but CLI fails | CLI/runtime issue or ambiguous settlement | Query the exact registry version before retrying; update the CLI only after confirming package state |
| Wrong files in dry-run | `files`, `.npmignore`, build output, or package root is wrong | Fix packaging and rerun the complete check; do not publish |
| Correct source but wrong published patch | Stale build or package allowlist/config mismatch | Bump to a new version, correct the artifact, test, and publish; an accepted version is immutable |

## 14. Credential incident response

If any npm token appears in chat, logs, source code, shell history, a screenshot,
or an uploaded artifact:

1. Treat it as compromised immediately.
2. Revoke it from npm; do not merely delete the visible copy.
3. Create a replacement with narrower permissions and a short expiration.
4. Replace it in every CI secret store or local configuration that used it.
5. Review npm token activity and recent package versions.
6. Verify that no unexpected owners, versions, or dist-tags were added.
7. Remove the secret from source history where practical, while remembering
   that history cleanup does not replace revocation.

Never ask whether an exposed token still works by using it against production.
Revocation is the safe answer.

## Release checklist

### Before the write

- [ ] Correct package directory selected.
- [ ] Exact `name@version` confirmed.
- [ ] Package name and version are available for the intended owner.
- [ ] Visibility and dist-tag are intentional.
- [ ] `private` is not `true`.
- [ ] Entry points and runtime dependencies are correct.
- [ ] Tests, typecheck, build, and smoke import pass.
- [ ] `npm pack --dry-run --json` reviewed.
- [ ] No credentials, private paths, or unwanted files found.
- [ ] Correct registry and `npm whoami` confirmed.
- [ ] Existing-package ownership confirmed.
- [ ] 2FA, granular-token, or trusted-publisher path is ready.

### After the write

- [ ] Exact version appears in the public registry.
- [ ] Intended dist-tag points to the version.
- [ ] Maintainer list is correct.
- [ ] Registry tarball checksum and contents inspected.
- [ ] Published package installs in a clean environment.
- [ ] DSH Cordis patch or equivalent runtime configuration verified.
- [ ] Repository documentation updated from planned to published.
- [ ] Release commit and tag created according to the repository policy.
- [ ] Temporary credentials removed and exposed credentials revoked.

## Official npm references

- [Creating and publishing unscoped public packages](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/)
- [Creating and publishing organization-scoped packages](https://docs.npmjs.com/creating-and-publishing-an-organization-scoped-package/)
- [Requiring 2FA for publishing](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/)
- [About granular access tokens](https://docs.npmjs.com/about-access-tokens/)
- [Staged publishing](https://docs.npmjs.com/staged-publishing/)
- [Trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm unpublish policy](https://docs.npmjs.com/policies/unpublish/)
- [Deleting an organization](https://docs.npmjs.com/deleting-an-organization/)
