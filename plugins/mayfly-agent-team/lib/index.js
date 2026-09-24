import * as runtime from "./runtime.js";
export const name = 'mayfly-agent-team';
export const inject = runtime.inject;
export async function apply(ctx) {
    await ctx.plugin(runtime);
    ctx.inject(['mayflyCurrentAgent', 'mayflyLocale', 'mayflyOverlays', 'mayflyStatus', 'mayflyEditorExtensions'], async (owner) => {
        await owner.plugin(await import("./tui.js"));
    });
}
