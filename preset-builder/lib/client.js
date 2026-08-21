window.__ModuleLoader__.load({
	id: "dsh-preset-builder",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/locales.ts
		const NS = "presetBuilder";
		const en = {
			nav: "Preset Builder",
			title: "Preset Builder",
			intro: "Configure plugins and verify the tools the agent will receive.",
			loading: "Loading preset…",
			retry: "Retry",
			preset: "Preset",
			saving: "Saving…",
			saved: "Validated",
			readOnly: "Built-in presets are read-only. Duplicate this preset from Agent Presets to configure it.",
			effectiveTools: "Effective tools",
			toolSummary: "{tools} tools exposed by {plugins} enabled plugins",
			searchTools: "Search tools…",
			plugins: "Plugin composition",
			pluginSummary: "{enabled} of {all} enabled",
			togglePlugin: "Enable or disable plugin",
			configuration: "Plugin configuration",
			selectPlugin: "Select a plugin to configure it.",
			configJson: "Configuration",
			saveValidate: "Save and validate",
			rawConfig: "Advanced · Raw composition"
		};
		const zh = {
			nav: "预设构建器",
			title: "预设构建器",
			intro: "配置插件，并确认 Agent 最终获得的工具。",
			loading: "正在加载预设…",
			retry: "重试",
			preset: "预设",
			saving: "正在保存…",
			saved: "已验证",
			readOnly: "系统内置预设为只读。请先在 Agent 预设页面复制，再进行配置。",
			effectiveTools: "Agent 最终可用工具",
			toolSummary: "{plugins} 个已启用插件，共开放 {tools} 个工具",
			searchTools: "搜索工具…",
			plugins: "插件组成",
			pluginSummary: "已启用 {enabled} / {all}",
			togglePlugin: "启用或停用插件",
			configuration: "插件配置",
			selectPlugin: "选择一个插件进行配置。",
			configJson: "配置",
			saveValidate: "保存并验证",
			rawConfig: "高级 · 原始组成文件"
		};
		//#endregion
		//#region \0preset-builder-css:src/client/style.module.css.mjs
		const css = ".ihyV2W_section{max-width:920px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:16px;display:flex}.ihyV2W_header{justify-content:space-between;align-items:flex-start;gap:24px;display:flex}.ihyV2W_header h2{margin:3px 0 5px;font-size:20px;line-height:1.25}.ihyV2W_header p,.ihyV2W_panelHead p,.ihyV2W_surfaceHead p{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}.ihyV2W_eyebrow{color:var(--dsw-alias-label-tertiary);letter-spacing:.07em;text-transform:uppercase;font-size:10px;font-weight:650}.ihyV2W_headerActions{align-items:flex-end;gap:10px;display:flex}.ihyV2W_headerActions label{color:var(--dsw-alias-label-tertiary);gap:5px;font-size:11px;display:grid}.ihyV2W_headerActions select,.ihyV2W_surfaceHead input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);min-height:34px;color:var(--dsw-alias-label-primary);font:inherit;border-radius:8px;padding:0 10px;font-size:12px}.ihyV2W_saved,.ihyV2W_saving{white-space:nowrap;border-radius:999px;padding:7px 10px;font-size:11px}.ihyV2W_saved{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}.ihyV2W_saving{background:var(--dsw-alias-interactive-bg-active)}.ihyV2W_notice{border-left:3px solid var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);margin:0;padding:10px 12px;font-size:12px;line-height:1.5}.ihyV2W_error{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;margin:0;font-size:12px}.ihyV2W_muted{color:var(--dsw-alias-label-tertiary);font-size:12px}.ihyV2W_button,.ihyV2W_primaryButton{appearance:none;min-height:34px;font:inherit;cursor:pointer;border-radius:8px;padding:0 12px;font-size:12px}.ihyV2W_button{border:1px solid var(--dsw-alias-border-l2);color:inherit;background:0 0}.ihyV2W_primaryButton{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border:0;font-weight:600}.ihyV2W_button:focus-visible,.ihyV2W_primaryButton:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible,.ihyV2W_pluginMain:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.ihyV2W_button:disabled,.ihyV2W_primaryButton:disabled{cursor:default;opacity:.45}.ihyV2W_button:hover:not(:disabled),.ihyV2W_pluginMain:hover{background:var(--dsw-alias-interactive-bg-hover)}.ihyV2W_button:active:not(:disabled),.ihyV2W_pluginMain:active{background:var(--dsw-alias-interactive-bg-active)}.ihyV2W_primaryButton:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}.ihyV2W_primaryButton:active:not(:disabled){opacity:.86}.ihyV2W_toolSurface{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;gap:12px;padding:14px;display:grid}.ihyV2W_surfaceHead{justify-content:space-between;align-items:end;gap:16px;display:flex}.ihyV2W_surfaceHead h3,.ihyV2W_panelHead h3{margin:0 0 3px;font-size:14px}.ihyV2W_surfaceHead input{width:min(220px,40%)}.ihyV2W_tools{grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 12px;max-height:218px;margin:0;padding:0;list-style:none;display:grid;overflow:auto}.ihyV2W_tools li{border-bottom:1px solid var(--dsw-alias-border-l1);grid-template-columns:8px minmax(112px,.55fr) minmax(0,1fr);align-items:baseline;gap:7px;min-width:0;padding:7px 5px;display:grid}.ihyV2W_tools code{text-overflow:ellipsis;color:var(--dsw-alias-label-primary);font:11px/1.4 var(--ds-font-family-code);overflow:hidden}.ihyV2W_tools li>span:last-child{text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:11px;overflow:hidden}.ihyV2W_toolDot{background:var(--dsw-alias-state-success-primary);border-radius:50%;width:6px;height:6px}.ihyV2W_workbench{grid-template-columns:minmax(260px,.85fr) minmax(300px,1.15fr);align-items:start;gap:12px;display:grid}.ihyV2W_pluginStack,.ihyV2W_configPanel{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;min-width:0;overflow:hidden}.ihyV2W_panelHead{border-bottom:1px solid var(--dsw-alias-border-l2);padding:14px}.ihyV2W_panelHead code{color:var(--dsw-alias-label-dimmed);font:10px var(--ds-font-family-code)}.ihyV2W_pluginStack>ul{max-height:410px;margin:0;padding:0;list-style:none;overflow:auto}.ihyV2W_pluginStack li{border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center;gap:10px;min-height:58px;padding:4px 12px;display:flex}.ihyV2W_pluginStack li:last-child{border-bottom:0}.ihyV2W_pluginSelected{background:var(--dsw-alias-bg-layer-2);box-shadow:inset 2px 0 0 var(--dsw-alias-label-primary)}.ihyV2W_pluginMain{min-width:0;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;flex:1;gap:3px;padding:8px 0;display:grid}.ihyV2W_pluginMain strong{font-size:12px}.ihyV2W_pluginMain code{text-overflow:ellipsis;color:var(--dsw-alias-label-dimmed);font:10px var(--ds-font-family-code);white-space:nowrap;overflow:hidden}.ihyV2W_switch{flex:none;width:34px;height:20px;position:relative}.ihyV2W_switch input{opacity:0;position:absolute}.ihyV2W_switch span{background:var(--dsw-alias-border-l3);cursor:pointer;border-radius:999px;width:100%;height:100%;transition:background .16s;display:block}.ihyV2W_switch span:after{content:\"\";background:var(--dsw-alias-bg-layer-3);border-radius:50%;width:14px;height:14px;transition:transform .16s;position:absolute;top:3px;left:3px}.ihyV2W_switch input:checked+span{background:var(--dsw-alias-label-primary)}.ihyV2W_switch input:checked+span:after{transform:translate(14px)}.ihyV2W_switch input:focus-visible+span{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.ihyV2W_switch input:disabled+span{cursor:default;opacity:.45}.ihyV2W_configPanel{flex-direction:column;min-height:300px;display:flex}.ihyV2W_configField{color:var(--dsw-alias-label-secondary);gap:7px;padding:14px;font-size:11px;display:grid}.ihyV2W_configField textarea{box-sizing:border-box;resize:vertical;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);width:100%;min-height:180px;color:var(--dsw-alias-label-primary);font:11px/1.55 var(--ds-font-family-code);border-radius:8px;padding:10px}.ihyV2W_configPanel .ihyV2W_primaryButton{align-self:flex-end;margin:0 14px 14px}.ihyV2W_configPanel>.ihyV2W_muted{margin:14px}.ihyV2W_advanced{border:1px solid var(--dsw-alias-border-l2);border-radius:10px}.ihyV2W_advanced summary{cursor:pointer;color:var(--dsw-alias-label-secondary);padding:10px 12px;font-size:12px}.ihyV2W_advanced pre{border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);max-height:360px;color:var(--dsw-alias-label-secondary);font:11px/1.55 var(--ds-font-family-code);white-space:pre;margin:0;padding:12px;overflow:auto}@media (width<=800px){.ihyV2W_header,.ihyV2W_surfaceHead{flex-direction:column;align-items:stretch}.ihyV2W_headerActions{justify-content:space-between}.ihyV2W_surfaceHead input{box-sizing:border-box;width:100%}.ihyV2W_tools,.ihyV2W_workbench{grid-template-columns:1fr}.ihyV2W_pluginStack>ul{max-height:300px}}@media (prefers-reduced-motion:reduce){.ihyV2W_switch span,.ihyV2W_switch span:after{transition:none}}";
		const id = "dsh-preset-builder/style.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + id + "\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = id;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var style_module_css_default = {
			"pluginMain": "ihyV2W_pluginMain",
			"tools": "ihyV2W_tools",
			"toolSurface": "ihyV2W_toolSurface",
			"header": "ihyV2W_header",
			"eyebrow": "ihyV2W_eyebrow",
			"muted": "ihyV2W_muted",
			"configPanel": "ihyV2W_configPanel",
			"section": "ihyV2W_section",
			"notice": "ihyV2W_notice",
			"saving": "ihyV2W_saving",
			"panelHead": "ihyV2W_panelHead",
			"headerActions": "ihyV2W_headerActions",
			"primaryButton": "ihyV2W_primaryButton",
			"error": "ihyV2W_error",
			"saved": "ihyV2W_saved",
			"button": "ihyV2W_button",
			"toolDot": "ihyV2W_toolDot",
			"workbench": "ihyV2W_workbench",
			"advanced": "ihyV2W_advanced",
			"pluginStack": "ihyV2W_pluginStack",
			"switch": "ihyV2W_switch",
			"configField": "ihyV2W_configField",
			"surfaceHead": "ihyV2W_surfaceHead",
			"pluginSelected": "ihyV2W_pluginSelected"
		};
		//#endregion
		//#region src/client/index.tsx
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		function displayPlugin(plugin) {
			return plugin.id.replace(/^tool-/, "").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
		}
		function PresetDetails({ api, t }) {
			const [presets, setPresets] = (0, react.useState)([]);
			const [selectedId, setSelectedId] = (0, react.useState)("");
			const [detail, setDetail] = (0, react.useState)(null);
			const [selectedPluginId, setSelectedPluginId] = (0, react.useState)("");
			const [configDraft, setConfigDraft] = (0, react.useState)("{}");
			const [query, setQuery] = (0, react.useState)("");
			const [status, setStatus] = (0, react.useState)("loading");
			const [error, setError] = (0, react.useState)("");
			const selectedPreset = presets.find((preset) => preset.id === selectedId);
			const selectedPlugin = detail?.plugins.find((plugin) => plugin.id === selectedPluginId);
			const readPreset = async (id) => {
				setStatus("loading");
				setError("");
				try {
					const response = await api.agentPresets.read({ agentPreset: id });
					if (!response.result.ok) throw new Error(response.result.error.message);
					const value = response.result.value;
					setDetail({
						content: value.content,
						revision: value.revision,
						plugins: value.plugins,
						tools: value.tools
					});
					setSelectedPluginId(value.plugins[0]?.id ?? "");
					setStatus("ready");
				} catch (cause) {
					setError(messageOf(cause));
					setStatus("error");
				}
			};
			const load = async () => {
				setStatus("loading");
				try {
					const response = await api.agentPresets.list({});
					if (!response.result.ok) throw new Error(response.result.error.message);
					const rows = response.result.value.presets;
					const id = rows.find((preset) => preset.isDefault)?.id ?? rows[0]?.id ?? "";
					setPresets(rows);
					setSelectedId(id);
					if (id !== "") await readPreset(id);
					else setStatus("ready");
				} catch (cause) {
					setError(messageOf(cause));
					setStatus("error");
				}
			};
			const mutate = async (mutation) => {
				if (detail === null || selectedPreset?.trust !== "user") return;
				setStatus("saving");
				setError("");
				try {
					const response = await api.agentPresets.mutate({
						agentPreset: selectedPreset.id,
						expectedRevision: detail.revision,
						mutation
					});
					if (!response.result.ok) throw new Error(response.result.error.message);
					await readPreset(selectedPreset.id);
				} catch (cause) {
					setError(messageOf(cause));
					setStatus("error");
				}
			};
			(0, react.useEffect)(() => {
				load();
			}, [api]);
			(0, react.useEffect)(() => {
				setConfigDraft(JSON.stringify(selectedPlugin?.config ?? {}, null, 2));
			}, [selectedPlugin]);
			const visibleTools = (0, react.useMemo)(() => {
				const needle = query.trim().toLowerCase();
				return (detail?.tools ?? []).filter((tool) => needle === "" || tool.name.toLowerCase().includes(needle) || tool.description.toLowerCase().includes(needle));
			}, [detail, query]);
			if (status === "loading" && detail === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: style_module_css_default.muted,
				children: t("loading")
			});
			if (status === "error" && detail === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: style_module_css_default.section,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: style_module_css_default.error,
					children: error
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					className: style_module_css_default.button,
					onClick: () => {
						load();
					},
					children: t("retry")
				})]
			});
			const editable = selectedPreset?.trust === "user";
			const enabled = detail?.plugins.filter((plugin) => !plugin.disabled).length ?? 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: style_module_css_default.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: style_module_css_default.header,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: style_module_css_default.eyebrow,
								children: t("nav")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: selectedPreset?.name ?? selectedPreset?.id ?? t("title") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: selectedPreset?.description ?? t("intro") })
						] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: style_module_css_default.headerActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("preset") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
								value: selectedId,
								onChange: (event) => {
									setSelectedId(event.target.value);
									readPreset(event.target.value);
								},
								children: presets.map((preset) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: preset.id,
									children: preset.name ?? preset.id
								}, preset.id))
							})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: status === "saving" ? style_module_css_default.saving : style_module_css_default.saved,
								children: status === "saving" ? t("saving") : t("saved")
							})]
						})]
					}),
					error === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: style_module_css_default.error,
						role: "alert",
						children: error
					}),
					!editable && selectedPreset !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: style_module_css_default.notice,
						children: t("readOnly")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: style_module_css_default.toolSurface,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: style_module_css_default.surfaceHead,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("effectiveTools") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("toolSummary").replace("{tools}", String(detail?.tools.length ?? 0)).replace("{plugins}", String(enabled)) })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								value: query,
								onChange: (event) => {
									setQuery(event.target.value);
								},
								placeholder: t("searchTools"),
								"aria-label": t("searchTools")
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: style_module_css_default.tools,
							children: visibleTools.map((tool) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								title: tool.description,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: style_module_css_default.toolDot }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: tool.name }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: tool.description })
								]
							}, tool.name))
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: style_module_css_default.workbench,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: style_module_css_default.pluginStack,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: style_module_css_default.panelHead,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("plugins") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("pluginSummary").replace("{enabled}", String(enabled)).replace("{all}", String(detail?.plugins.length ?? 0)) })] })
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: (detail?.plugins ?? []).map((plugin) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: plugin.id === selectedPluginId ? style_module_css_default.pluginSelected : "",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: style_module_css_default.pluginMain,
									onClick: () => {
										setSelectedPluginId(plugin.id);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: displayPlugin(plugin) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: plugin.name })]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: style_module_css_default.switch,
									title: editable ? t("togglePlugin") : t("readOnly"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: !plugin.disabled,
										disabled: !editable || status === "saving",
										onChange: (event) => {
											mutate({
												op: "set-disabled",
												pluginId: plugin.id,
												disabled: !event.target.checked
											});
										}
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {})]
								})]
							}, plugin.id)) })]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("aside", {
							className: style_module_css_default.configPanel,
							children: selectedPlugin === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: style_module_css_default.muted,
								children: t("selectPlugin")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: style_module_css_default.panelHead,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: style_module_css_default.eyebrow,
											children: t("configuration")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: displayPlugin(selectedPlugin) }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: selectedPlugin.id })
									] })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: style_module_css_default.configField,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("configJson") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										value: configDraft,
										spellCheck: false,
										disabled: !editable,
										onChange: (event) => {
											setConfigDraft(event.target.value);
										}
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: style_module_css_default.primaryButton,
									type: "button",
									disabled: !editable || status === "saving",
									onClick: () => {
										try {
											mutate({
												op: "set-config",
												pluginId: selectedPlugin.id,
												config: JSON.parse(configDraft)
											});
										} catch (cause) {
											setError(messageOf(cause));
										}
									},
									children: t("saveValidate")
								})
							] })
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: style_module_css_default.advanced,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: t("rawConfig") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: detail?.content })]
					})
				]
			});
		}
		const inject = [
			"slots",
			"locale",
			"connection"
		];
		function apply(ctx) {
			const { api } = ctx.get("connection");
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "preset-builder: dictionaries");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "preset-details",
				order: 21,
				label: () => ctx.locale.bind(NS)("nav"),
				locale: NS,
				inject: () => ({ api })
			}, PresetDetails));
		}
		//#endregion
		exports.PresetDetails = PresetDetails;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map