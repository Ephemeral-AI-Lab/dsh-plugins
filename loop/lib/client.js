window.__ModuleLoader__.load({
	id: "loop",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0loop-css:src/ui/LoopsView.module.css.mjs
		const css = ".vrgiiq_root{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));color:var(--dsw-alias-label-primary);margin:0 auto}.vrgiiq_summary,.vrgiiq_row{box-sizing:border-box;width:100%;max-width:calc(var(--dsh-composer-card-max-width) - 4 * var(--dsh-composer-dock-inset));border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-tip);border-radius:12px;align-items:center;gap:10px;height:36px;margin:0 auto;padding:4px 5px 4px 12px;display:flex}.vrgiiq_summary{color:var(--dsw-alias-label-secondary)}.vrgiiq_summaryText{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-secondary);flex:1;font-size:13px;overflow:hidden}.vrgiiq_list{flex-direction:column;gap:8px;max-height:min(30vh,280px);margin:0;padding:0;list-style:none;display:flex;overflow:auto}.vrgiiq_row{flex-wrap:wrap;min-width:0;height:auto;min-height:36px;font-size:13px}.vrgiiq_glyph{color:var(--dsw-alias-label-tertiary);flex:none;line-height:1;display:inline-flex}.vrgiiq_interval,.vrgiiq_status,.vrgiiq_statusDue{white-space:nowrap;flex:none}.vrgiiq_interval{color:var(--dsw-alias-label-primary);flex:none;font-weight:500}.vrgiiq_status,.vrgiiq_statusDue{color:var(--dsw-alias-label-caption)}.vrgiiq_statusDue{color:var(--dsw-alias-state-warn-label)}.vrgiiq_prompt{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-primary);flex:1;overflow:hidden}.vrgiiq_actions{flex:none;align-items:center;gap:10px;display:flex}.vrgiiq_button,.vrgiiq_iconButton{min-width:44px;min-height:44px;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:7px;padding:0 10px;font-size:13px}.vrgiiq_button{color:var(--dsw-alias-label-primary);background:0 0}.vrgiiq_button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.vrgiiq_iconButton{width:28px;min-width:28px;height:28px;min-height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:999px;justify-content:center;align-items:center;padding:0;display:inline-flex}.vrgiiq_iconButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.vrgiiq_button:focus-visible,.vrgiiq_iconButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.vrgiiq_button:disabled,.vrgiiq_iconButton:disabled{cursor:wait;opacity:.55}.vrgiiq_error{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-state-error-primary);border-radius:7px;margin:0;padding:8px 10px;font-size:12px}@media (prefers-reduced-motion:reduce){*,:before,:after{scroll-behavior:auto!important;transition-duration:.01ms!important}}";
		const id = "loop/LoopsView.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"loop/LoopsView.module.css\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "loop";
			tag.dataset.pluginCss = id;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var LoopsView_module_css_default = {
			"actions": "vrgiiq_actions",
			"button": "vrgiiq_button",
			"error": "vrgiiq_error",
			"glyph": "vrgiiq_glyph",
			"iconButton": "vrgiiq_iconButton",
			"interval": "vrgiiq_interval",
			"list": "vrgiiq_list",
			"prompt": "vrgiiq_prompt",
			"root": "vrgiiq_root",
			"row": "vrgiiq_row",
			"status": "vrgiiq_status",
			"statusDue": "vrgiiq_statusDue",
			"summary": "vrgiiq_summary",
			"summaryText": "vrgiiq_summaryText"
		};
		//#endregion
		//#region src/ui/LoopsView.tsx
		function LoopsView({ useProjection, execute }) {
			const projection = useProjection("loop");
			const loops = (0, react.useMemo)(() => [...projection?.loops ?? []].sort((a, b) => a.next_at - b.next_at), [projection?.loops]);
			const [now, setNow] = (0, react.useState)(() => Date.now());
			const [expanded, setExpanded] = (0, react.useState)(false);
			const [pending, setPending] = (0, react.useState)(null);
			const [awaiting, setAwaiting] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const rootRef = (0, react.useRef)(null);
			const listId = (0, react.useId)();
			(0, react.useEffect)(() => {
				if (loops.length === 0) return;
				const timer = setInterval(() => setNow(Date.now()), 1e3);
				return () => clearInterval(timer);
			}, [loops.length]);
			(0, react.useEffect)(() => {
				setNow(Date.now());
			}, [projection?.loops]);
			(0, react.useEffect)(() => {
				if (loops.length < 3 && expanded) setExpanded(false);
			}, [expanded, loops.length]);
			(0, react.useEffect)(() => {
				if (!expanded || loops.length < 3) return;
				const onPointerDown = (event) => {
					if (event.target instanceof Node && rootRef.current?.contains(event.target) === true) return;
					setExpanded(false);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") setExpanded(false);
				};
				document.addEventListener("pointerdown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [expanded, loops.length]);
			(0, react.useEffect)(() => {
				const watchedId = awaiting?.id ?? pending;
				if (watchedId !== null && !loops.some((loop) => loop.id === watchedId)) {
					setAwaiting(null);
					setPending(null);
					setError(null);
				}
			}, [
				awaiting,
				loops,
				pending
			]);
			const remove = async (id) => {
				setPending(id);
				setError(null);
				try {
					assertCommandSucceeded(await execute(`/loop delete ${id}`));
					setAwaiting({ id });
				} catch (reason) {
					setError(errorText(reason));
					setPending(null);
				}
			};
			if (loops.length === 0) return null;
			const collapsed = loops.length >= 3 && !expanded;
			const showList = loops.length < 3 || expanded;
			const nearest = loops[0];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				ref: rootRef,
				className: LoopsView_module_css_default.root,
				"data-testid": "loop-dock",
				"data-loop-dock": "",
				"aria-label": "Active loops",
				children: [
					loops.length >= 3 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: LoopsView_module_css_default.summary,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoopGlyph, {}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: LoopsView_module_css_default.summaryText,
								children: [
									loops.length,
									" active loops · ",
									formatNext(nearest.next_at, now)
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: LoopsView_module_css_default.button,
								"aria-controls": listId,
								"aria-expanded": !collapsed,
								"aria-label": collapsed ? "Expand loops" : "Collapse loops",
								onClick: () => setExpanded((value) => !value),
								children: collapsed ? "Expand" : "Collapse"
							})
						]
					}),
					showList && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						id: listId,
						className: LoopsView_module_css_default.list,
						"aria-label": "Loop list",
						children: loops.map((loop) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoopRow, {
							loop,
							now,
							busy: pending === loop.id,
							onDelete: () => void remove(loop.id)
						}, loop.id))
					}),
					error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: LoopsView_module_css_default.error,
						role: "alert",
						children: error
					})
				]
			});
		}
		function LoopRow({ loop, now, busy, onDelete }) {
			const overdue = loop.next_at <= now;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: LoopsView_module_css_default.row,
				"data-loop-id": loop.id,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoopGlyph, {}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: LoopsView_module_css_default.interval,
						children: ["every ", formatInterval(loop.time_in_seconds)]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: overdue ? LoopsView_module_css_default.statusDue : LoopsView_module_css_default.status,
						"aria-label": overdue ? "overdue" : formatNext(loop.next_at, now),
						children: overdue ? "overdue" : formatNext(loop.next_at, now)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: LoopsView_module_css_default.prompt,
						title: loop.prompt,
						"aria-label": loop.prompt,
						children: loop.prompt
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: LoopsView_module_css_default.actions,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: LoopsView_module_css_default.iconButton,
							onClick: onDelete,
							disabled: busy,
							"aria-label": "Delete",
							title: "Delete",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TrashGlyph, {})
						})
					})
				]
			});
		}
		function LoopGlyph() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: LoopsView_module_css_default.glyph,
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
					width: "14",
					height: "14",
					viewBox: "0 0 16 16",
					fill: "none",
					xmlns: "http://www.w3.org/2000/svg",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M7.92 1.05a6.95 6.95 0 0 1 5.8 3.12l1.01-1.01v3.18h-3.18l1.13-1.13A5.55 5.55 0 1 0 13.48 8h1.39a6.95 6.95 0 1 1-6.95-6.95Z",
						fill: "currentColor"
					})
				})
			});
		}
		function TrashGlyph() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "14",
				height: "14",
				viewBox: "0 0 16 16",
				fill: "none",
				xmlns: "http://www.w3.org/2000/svg",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M4.25 4.5h7.5l-.42 9.05H4.67L4.25 4.5ZM6 6v6.25h1V6H6Zm3 0v6.25h1V6H9ZM3 2.75h3.1l.58-1h2.64l.58 1H13v1H3v-1Z",
					fill: "currentColor"
				})
			});
		}
		function formatInterval(seconds) {
			if (seconds < 60) return `${seconds}s`;
			if (seconds % 60 === 0 && seconds < 3600) return `${seconds / 60}m`;
			if (seconds % 3600 === 0) return `${seconds / 3600}h`;
			return `${seconds}s`;
		}
		function formatNext(nextAt, now) {
			if (nextAt <= now) return "overdue";
			return `next in ${formatRemaining(Math.max(1, Math.ceil((nextAt - now) / 1e3)))}`;
		}
		function formatRemaining(seconds) {
			if (seconds < 60) return `${seconds}s`;
			if (seconds % 60 === 0 && seconds < 3600) return `${seconds / 60}m`;
			if (seconds % 3600 === 0) return `${seconds / 3600}h`;
			return `${seconds}s`;
		}
		function assertCommandSucceeded(result) {
			if (!isRecord(result)) throw new Error("The loop command did not return a result.");
			if (result.ok === false) {
				const error = isRecord(result.error) ? result.error.message : void 0;
				throw new Error(typeof error === "string" ? error : "The loop command failed.");
			}
			if (result.ok !== true || result.value === void 0) throw new Error("The loop command was not recognized.");
			if (!isRecord(result.value) || !isRecord(result.value.result)) throw new Error("The loop command failed.");
			if (result.value.result.kind === "error") {
				const text = result.value.result.text;
				throw new Error(typeof text === "string" ? text : "The loop command failed.");
			}
			if (result.value.result.kind !== "success") throw new Error("The loop command failed.");
		}
		function errorText(reason) {
			return reason instanceof Error ? reason.message : String(reason);
		}
		function isRecord(value) {
			return typeof value === "object" && value !== null;
		}
		//#endregion
		//#region src/ui/index.ts
		const inject = [
			"slots",
			"remote",
			"remote.commands"
		];
		function apply(ctx) {
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "loops",
				order: 30,
				inject: (sessionId) => ({ execute: (line) => ctx.remote.commands.execute(sessionId, line) })
			}, LoopsView));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map