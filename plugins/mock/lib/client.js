window.__ModuleLoader__.load({
	id: "dsh-mock",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-mock-css:src/client/MockStatusRow.module.css.mjs
		const css = ".XTi1oq_dock{width:min(var(--dsh-composer-card-max-width,720px), calc(100% - 32px));color:var(--dsw-alias-label-secondary,#69727d);margin:0 auto 6px;font-size:12px;line-height:18px}.XTi1oq_row{border:1px solid var(--dsw-alias-border-l1,#edf0f2);background:var(--dsw-alias-bg-fill-secondary,#f7f8f9);border-radius:8px;grid-template-columns:auto auto minmax(72px,1fr);align-items:center;gap:8px;min-height:28px;padding:5px 10px;display:grid}.XTi1oq_label{color:var(--dsw-alias-label-primary,#1f2329);white-space:nowrap;font-weight:600}.XTi1oq_counter{font-variant-numeric:tabular-nums;white-space:nowrap}.XTi1oq_track{background:var(--dsw-alias-fill-l2,#e4e8ec);border-radius:999px;height:4px;overflow:hidden}.XTi1oq_fill{border-radius:inherit;background:var(--dsw-alias-state-business-primary,#2f81f7);height:100%;transition:width .16s ease-out}.XTi1oq_waiting .XTi1oq_fill{opacity:.65}.XTi1oq_terminal{border-color:var(--dsw-alias-border-l1,#edf0f2)}.XTi1oq_failed{border-color:color-mix(in srgb, var(--dsw-alias-state-danger,#d14343) 32%, transparent)}.XTi1oq_context{color:var(--dsw-alias-label-secondary,#69727d);grid-column:1/-1}.XTi1oq_error{color:var(--dsw-alias-state-danger,#d14343);text-overflow:ellipsis;white-space:nowrap;grid-column:1/-1;display:block;overflow:hidden}";
		const id = "dsh-mock/MockStatusRow.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"dsh-mock/MockStatusRow.module.css\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-mock";
			tag.dataset.pluginCss = id;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var MockStatusRow_module_css_default = {
			"context": "XTi1oq_context",
			"counter": "XTi1oq_counter",
			"dock": "XTi1oq_dock",
			"error": "XTi1oq_error",
			"failed": "XTi1oq_failed",
			"fill": "XTi1oq_fill",
			"label": "XTi1oq_label",
			"row": "XTi1oq_row",
			"terminal": "XTi1oq_terminal",
			"track": "XTi1oq_track",
			"waiting": "XTi1oq_waiting"
		};
		//#endregion
		//#region src/client/MockStatusRow.tsx
		function labelFor(state, t) {
			return t(state.mode === "replay" ? "replay.label" : "run.label");
		}
		function statusTextFor(state, t) {
			const label = labelFor(state, t);
			switch (state.phase) {
				case "queued": return t("status.queued", { label });
				case "running": return t("status.running", { label });
				case "waiting": return t("status.waiting", { label });
				case "failed": return t("status.failed", { label });
				case "completed": return t("status.completed", { label });
				case "cancelled": return t("status.cancelled", { label });
			}
		}
		function MockStatusRow({ state, t }) {
			if (state === void 0 || state === null) return null;
			const label = labelFor(state, t);
			const statusText = statusTextFor(state, t);
			const terminal = state.phase === "completed" || state.phase === "cancelled";
			const failed = state.phase === "failed";
			const rowClass = [
				MockStatusRow_module_css_default.row,
				state.phase === "waiting" ? MockStatusRow_module_css_default.waiting : "",
				terminal ? MockStatusRow_module_css_default.terminal : "",
				failed ? MockStatusRow_module_css_default.failed : ""
			].filter(Boolean).join(" ");
			const total = Math.max(state.totalSteps, 0);
			const current = Math.min(Math.max(state.currentStep, 0), total);
			const ariaMax = Math.max(total, 1);
			const percentage = total === 0 ? 0 : Math.round(current / total * 100);
			if (state.phase === "failed") {
				const message = state.errorMessage ?? state.errorCode ?? "Unknown error";
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: MockStatusRow_module_css_default.dock,
					"data-mock-status": state.phase,
					role: "alert",
					"aria-live": "assertive",
					"aria-atomic": "true",
					title: message,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: rowClass,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: MockStatusRow_module_css_default.label,
								children: statusText
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: MockStatusRow_module_css_default.counter,
								children: [
									current,
									"/",
									total
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: MockStatusRow_module_css_default.track,
								role: "progressbar",
								"aria-label": t("progress.aria", { label }),
								"aria-valuemin": 0,
								"aria-valuemax": ariaMax,
								"aria-valuenow": Math.min(current, ariaMax),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: MockStatusRow_module_css_default.fill,
									style: { width: `${percentage}%` }
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: MockStatusRow_module_css_default.error,
								children: message
							})
						]
					})
				});
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: MockStatusRow_module_css_default.dock,
				"data-mock-status": state.phase,
				role: "status",
				"aria-live": "polite",
				"aria-atomic": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: rowClass,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MockStatusRow_module_css_default.label,
							children: statusText
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: MockStatusRow_module_css_default.counter,
							children: [
								current,
								"/",
								total
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: MockStatusRow_module_css_default.track,
							role: "progressbar",
							"aria-label": t("progress.aria", { label }),
							"aria-valuemin": 0,
							"aria-valuemax": ariaMax,
							"aria-valuenow": Math.min(current, ariaMax),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: MockStatusRow_module_css_default.fill,
								style: { width: `${percentage}%` }
							})
						}),
						state.phase === "waiting" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MockStatusRow_module_css_default.context,
							children: t("waiting.detail")
						})
					]
				})
			});
		}
		function MockStatusDock({ useProjection, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MockStatusRow, {
				state: useProjection("mockStatus"),
				t
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** Browser copy for the compact mock status row. */
		const NS = "mockAgent";
		const zh = {
			"run.label": "Mock run",
			"replay.label": "Mock replay",
			"progress.aria": "{label} progress",
			"status.queued": "{label} queued",
			"status.running": "{label} running",
			"status.waiting": "{label} waiting for tool result",
			"status.failed": "{label} failed",
			"status.completed": "{label} completed",
			"status.cancelled": "{label} cancelled",
			"waiting.detail": "Waiting for the tool to finish…"
		};
		const en = { ...zh };
		en["run.label"] = "Mock run";
		en["replay.label"] = "Mock replay";
		en["progress.aria"] = "{label} progress";
		en["status.queued"] = "{label} queued";
		en["status.running"] = "{label} running";
		en["status.waiting"] = "{label} waiting for tool result";
		en["status.failed"] = "{label} failed";
		en["status.completed"] = "{label} completed";
		en["status.cancelled"] = "{label} cancelled";
		en["waiting.detail"] = "Waiting for the tool to finish…";
		//#endregion
		//#region src/client/index.ts
		/** Services required by the session-scoped composer status entry. */
		const inject = ["slots", "locale"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "mock: dictionaries");
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "mock-status",
				order: -100,
				locale: NS
			}, MockStatusDock));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map