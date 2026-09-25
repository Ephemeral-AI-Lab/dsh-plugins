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
import type { SkillProvider } from '@deepseek-ai/dsh-skill';
import type { HerdrEnv } from './transport.js';
/** How the skill body is sourced when `get()` runs. */
export type SkillMode = 'auto' | 'bundled';
/** Options for {@link makeHerdrSkillProvider}. */
export interface HerdrSkillOptions {
    env: HerdrEnv;
    mode: SkillMode;
    /** Override for the bundled `skills/` directory URL; used by tests. */
    skillsUrl?: URL;
}
/** Strip a leading YAML frontmatter block (`---\n...\n---\n`) if present. */
export declare function stripFrontmatter(body: string): string;
/**
 * Build the provider that contributes the `herdr` skill.
 * @param options - pane environment and body-source mode.
 * @returns a `SkillProvider` whose `list()` is allocation-free and whose
 *   `get()` lazily loads the body plus the addendum.
 */
export declare function makeHerdrSkillProvider(options: HerdrSkillOptions): SkillProvider;
//# sourceMappingURL=skill.d.ts.map