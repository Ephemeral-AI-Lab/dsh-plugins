/**
 * `herdr` skill provider.
 *
 * Serves Herdr's own `SKILL.md` — preferring the installed binary's
 * `herdr --skill` output so the body always matches the deployed Herdr
 * version — with a bundled fallback copy, plus a `dsh-sessions` addendum that
 * covers orchestrating sibling dsh/Mayfly sessions over the pane surface
 * (dsh is not a built-in Herdr agent kind, so `agent start`/`agent prompt`
 * do not apply). The module keeps no runtime imports from `@deepseek-ai`
 * packages so a profile without the skills service can still load the
 * plugin's reporter.
 *
 * @module dsh-herdr-plus/skill
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runHerdrText } from './cli.js';
/** Bundled-provider precedence; mirrors `BUNDLED_SKILL_RANK` in `dsh-skill`. */
const SKILL_RANK = 600;
/** URL of `skills/` — `lib/skill.js` and `src/skill.ts` both sit one level down. */
const SKILLS_URL = new URL('../skills/', import.meta.url);
/** Strip a leading YAML frontmatter block (`---\n...\n---\n`) if present. */
export function stripFrontmatter(body) {
    return body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}
function candidate(skillsUrl) {
    return {
        name: 'herdr',
        description: 'Control Herdr workspaces, tabs, panes, and agents from inside a Herdr pane, ' +
            'and launch or coordinate sibling dsh/Mayfly sessions in their own panes.',
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'bundled',
        provider: 'dsh-herdr-plus',
        rank: SKILL_RANK,
        locator: null,
        resourceBase: { kind: 'directory', path: fileURLToPath(skillsUrl) },
    };
}
async function loadBody(options, signal) {
    const skillsUrl = options.skillsUrl ?? SKILLS_URL;
    if (options.mode === 'auto') {
        const out = await runHerdrText(options.env, ['--skill'], { timeoutMs: 5_000, signal });
        // Sanity gate: the real skill body always carries the HERDR_ENV guard.
        if (out.ok && out.text.includes('HERDR_ENV'))
            return out.text;
    }
    try {
        return await readFile(new URL('herdr/SKILL.md', skillsUrl), { encoding: 'utf8', signal });
    }
    catch {
        // Vendored copy missing or unreadable: the skill simply does not load.
        return undefined;
    }
}
async function loadAddendum(options, signal) {
    try {
        const skillsUrl = options.skillsUrl ?? SKILLS_URL;
        return (await readFile(new URL('dsh-sessions.md', skillsUrl), { encoding: 'utf8', signal })).trim();
    }
    catch {
        // The addendum is supplementary; a missing file must not break the skill.
        return '';
    }
}
/**
 * Build the provider that contributes the `herdr` skill.
 * @param options - pane environment and body-source mode.
 * @returns a `SkillProvider` whose `list()` is allocation-free and whose
 *   `get()` lazily loads the body plus the addendum.
 */
export function makeHerdrSkillProvider(options) {
    const entry = candidate(options.skillsUrl ?? SKILLS_URL);
    return {
        name: 'dsh-herdr-plus',
        list: () => Promise.resolve([entry]),
        async get(_candidate, lookup) {
            const [body, addendum] = await Promise.all([
                loadBody(options, lookup.signal),
                loadAddendum(options, lookup.signal),
            ]);
            if (body === undefined)
                return undefined;
            const content = addendum === '' ? stripFrontmatter(body) : `${stripFrontmatter(body)}\n\n${addendum}`;
            return { ...entry, content };
        },
    };
}
//# sourceMappingURL=skill.js.map