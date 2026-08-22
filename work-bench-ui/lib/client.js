window.__ModuleLoader__.load({
	id: "dsh-workbench-ui",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-workbench-ui-css:src/client/Workbench.module.css.mjs
		const css = ".z9D_JW_headerButton{width:32px;min-width:32px;height:32px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:0;border-radius:10px;justify-content:center;align-items:center;padding:0;display:inline-flex}.z9D_JW_headerButton:hover,.z9D_JW_headerButton[data-open],.z9D_JW_tab:hover,.z9D_JW_close:hover{background:var(--dsw-alias-interactive-bg-hover)}.z9D_JW_panel{box-sizing:border-box;background:var(--dsw-specific-menu);width:100%;min-width:0;height:100%;color:var(--dsw-alias-label-primary);flex-direction:column;display:flex;overflow:hidden}.z9D_JW_header{border-bottom:1px solid var(--dsw-alias-border-l1);justify-content:space-between;align-items:flex-start;gap:12px;padding:14px;display:flex}.z9D_JW_header h2{margin:0;font-size:15px;line-height:20px}.z9D_JW_header span{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.z9D_JW_close{width:32px;height:32px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:8px;padding:0;font-size:22px;line-height:1}.z9D_JW_tabs{border-bottom:1px solid var(--dsw-alias-border-l1);gap:4px;padding:8px;display:flex;overflow-x:auto}.z9D_JW_tab{min-height:36px;color:var(--dsw-alias-label-secondary);font:inherit;white-space:nowrap;cursor:pointer;background:0 0;border:0;border-radius:8px;justify-content:center;align-items:center;gap:6px;padding:0 10px;font-size:13px;display:inline-flex}.z9D_JW_activeTab{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.z9D_JW_icon{display:inline-flex}.z9D_JW_body{flex:1;min-height:0;overflow:auto}.z9D_JW_empty{color:var(--dsw-alias-label-tertiary);margin:0;padding:18px;font-size:13px;line-height:20px}.z9D_JW_headerButton:focus-visible,.z9D_JW_tab:focus-visible,.z9D_JW_close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}@media (prefers-reduced-motion:reduce){.z9D_JW_headerButton,.z9D_JW_tab,.z9D_JW_close{transition:none}}";
		const id = "dsh-workbench-ui/Workbench.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + id + "\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-workbench-ui";
			tag.dataset.pluginCss = id;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var Workbench_module_css_default = {
			"activeTab": "z9D_JW_activeTab",
			"body": "z9D_JW_body",
			"close": "z9D_JW_close",
			"empty": "z9D_JW_empty",
			"header": "z9D_JW_header",
			"headerButton": "z9D_JW_headerButton",
			"icon": "z9D_JW_icon",
			"panel": "z9D_JW_panel",
			"tab": "z9D_JW_tab",
			"tabs": "z9D_JW_tabs"
		};
		//#endregion
		//#region src/client/Workbench.tsx
		function WorkbenchHeaderAction({ workbench }) {
			const snapshot = (0, react.useSyncExternalStore)(workbench.subscribe, workbench.getSnapshot, workbench.getSnapshot);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: Workbench_module_css_default.headerButton,
				"aria-label": snapshot.open ? "Close Workbench" : "Open Workbench",
				title: "Workbench",
				"aria-pressed": snapshot.open,
				"data-open": snapshot.open || void 0,
				onClick: () => {
					workbench.toggle();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPanelLeftOutline16, { size: 16 })
			});
		}
		function ExportHeaderAction({ sessionId, sessionExport }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: Workbench_module_css_default.headerButton,
				"aria-label": "Export session",
				title: "Export session",
				onClick: () => {
					sessionExport.download(sessionId);
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutline16, { size: 16 })
			});
		}
		function WorkbenchPanel({ workbench }) {
			const snapshot = (0, react.useSyncExternalStore)(workbench.subscribe, workbench.getSnapshot, workbench.getSnapshot);
			const first = snapshot.items[0];
			const active = snapshot.items.find((item) => item.id === snapshot.activeId) ?? first;
			if (!snapshot.open) return null;
			const Active = active?.component;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: Workbench_module_css_default.panel,
				"aria-label": "Workbench",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: Workbench_module_css_default.header,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "Workbench" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							snapshot.items.length,
							" tool",
							snapshot.items.length === 1 ? "" : "s"
						] })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: Workbench_module_css_default.close,
							"aria-label": "Close Workbench",
							onClick: () => {
								workbench.close();
							},
							children: "×"
						})]
					}),
					active !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: Workbench_module_css_default.tabs,
						role: "tablist",
						"aria-label": "Workbench tools",
						children: snapshot.items.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							role: "tab",
							"aria-selected": item.id === active.id,
							className: item.id === active.id ? `${Workbench_module_css_default.tab} ${Workbench_module_css_default.activeTab}` : Workbench_module_css_default.tab,
							onClick: () => {
								workbench.open(item.id);
							},
							children: [item.icon !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Workbench_module_css_default.icon,
								"aria-hidden": "true",
								children: item.icon
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.label })]
						}, item.id))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
						className: Workbench_module_css_default.body,
						role: "tabpanel",
						"aria-label": active?.label ?? "Workbench",
						children: Active === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: Workbench_module_css_default.empty,
							children: "No tools registered yet."
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Active, { close: () => {
							workbench.close();
						} })
					})
				]
			});
		}
		//#endregion
		//#region src/client/registry.ts
		const EMPTY = Object.freeze({
			open: false,
			activeId: null,
			items: Object.freeze([])
		});
		var WorkbenchRegistry = class {
			options;
			entries = /* @__PURE__ */ new Map();
			listeners = /* @__PURE__ */ new Set();
			snapshot = EMPTY;
			constructor(options = {}) {
				this.options = options;
			}
			register(item) {
				if (item.id.length === 0) throw new Error("workbench item id must not be empty");
				if (this.entries.has(item.id)) throw new Error(`workbench item already registered: ${item.id}`);
				this.entries.set(item.id, item);
				this.publish(this.snapshot.open, this.snapshot.activeId);
				let disposed = false;
				return () => {
					if (disposed) return;
					disposed = true;
					this.entries.delete(item.id);
					const activeId = this.snapshot.activeId === item.id ? null : this.snapshot.activeId;
					if (activeId === null && this.snapshot.open) this.close();
					else this.publish(this.snapshot.open, activeId);
				};
			}
			open(id) {
				if (!this.entries.has(id)) return;
				this.publish(true, id);
				this.options.onOpen?.();
			}
			close() {
				if (!this.snapshot.open) return;
				this.publish(false, null);
				this.options.onClose?.();
			}
			toggle(id) {
				if (this.snapshot.open) {
					this.close();
					return;
				}
				const target = id ?? this.snapshot.activeId ?? this.snapshot.items[0]?.id;
				if (target === void 0) {
					this.publish(true, null);
					this.options.onOpen?.();
				} else this.open(target);
			}
			getSnapshot = () => this.snapshot;
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			publish(open, activeId) {
				const items = [...this.entries.values()].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
				this.snapshot = Object.freeze({
					open,
					activeId,
					items: Object.freeze(items)
				});
				for (const listener of this.listeners) listener();
			}
		};
		//#endregion
		//#region src/client/index.ts
		const inject = [
			"slots",
			"layout",
			"sessionLogDownload"
		];
		function apply(ctx) {
			const layout = ctx.get("layout");
			const sessionExport = ctx.get("sessionLogDownload");
			const workbench = new WorkbenchRegistry({
				onOpen: () => {
					layout.openDetails();
				},
				onClose: () => {
					layout.closeDetails();
				}
			});
			ctx.provide("workbench", workbench);
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "session-log-download",
				order: 0,
				priority: -100,
				inject: () => ({ sessionExport })
			}, ExportHeaderAction));
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "workbench",
				order: 10,
				inject: () => ({ workbench })
			}, WorkbenchHeaderAction));
			ctx.slots.inject("details", () => ctx.slots.register({
				name: "details",
				priority: -100,
				inject: (_sessionId) => ({ workbench })
			}, WorkbenchPanel));
		}
		//#endregion
		exports.WorkbenchRegistry = WorkbenchRegistry;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map