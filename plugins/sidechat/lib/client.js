window.__ModuleLoader__.load({
	id: "dsh-sidechat",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-sidechat-css:src/client/SideChatPanel.module.css.mjs
		const css = ".Wborea_root{width:100%;min-width:0;height:100%;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-menu);flex-direction:column;display:flex;overflow:hidden}.Wborea_tabs{border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;align-items:center;gap:6px;min-width:0;padding:8px;display:flex}.Wborea_tabList{flex:1;gap:4px;min-width:0;display:flex;overflow-x:auto}.Wborea_tabShell{min-width:110px;max-width:220px;height:40px;color:var(--dsw-alias-label-secondary);background:0 0;border-radius:10px;align-items:center;display:flex}.Wborea_tabShell:hover,.Wborea_tabShell[data-active]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.Wborea_tab{min-width:0;height:40px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;flex:1;padding:0 4px 0 12px;overflow:hidden}.Wborea_tabTitle{text-overflow:ellipsis;white-space:nowrap;font-size:13px;display:block;overflow:hidden}.Wborea_tabClose,.Wborea_newTab,.Wborea_iconButton{width:40px;height:40px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:9px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.Wborea_tabClose{width:36px;height:36px}.Wborea_tabClose:hover,.Wborea_newTab:hover,.Wborea_iconButton:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.Wborea_tabClose svg,.Wborea_newTab svg,.Wborea_iconButton svg{fill:none;stroke:currentColor;stroke-width:1.5px;stroke-linecap:round;stroke-linejoin:round;width:16px;height:16px}.Wborea_anchor{border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-menu);flex:none;align-items:center;gap:10px;padding:10px 12px;display:flex}.Wborea_anchor>div{flex-direction:column;flex:1;min-width:0;display:flex}.Wborea_anchorLabel,.Wborea_anchorMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.Wborea_anchor strong{text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:18px;overflow:hidden}.Wborea_anchorMeta{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.Wborea_conversation{scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent;flex:1;min-height:0;padding:18px 16px 24px;overflow-y:auto}.Wborea_emptyPanel,.Wborea_emptyConversation{text-align:center;flex-direction:column;flex:1;justify-content:center;align-items:center;min-height:0;padding:36px 24px;display:flex}.Wborea_emptyConversation{min-height:280px;padding:24px}.Wborea_emptyPanel h3,.Wborea_emptyConversation h3{margin:12px 0 6px;font-size:18px;line-height:24px}.Wborea_emptyPanel p,.Wborea_emptyConversation p{max-width:380px;color:var(--dsw-alias-label-secondary);margin:0;font-size:14px;line-height:22px}.Wborea_emptyConversation span{color:var(--dsw-alias-label-tertiary);margin-top:6px;font-size:12px}.Wborea_emptyPanel button{border:1px solid var(--dsw-alias-border-l2);min-height:40px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-elevated-fill);font:inherit;cursor:pointer;border-radius:10px;margin-top:18px;padding:0 16px}.Wborea_chatIcon{fill:none;width:42px;height:42px;stroke:var(--dsw-alias-label-tertiary);stroke-width:1.5px;stroke-linecap:round;stroke-linejoin:round}.Wborea_message{max-width:92%;margin-bottom:18px}.Wborea_user{background:var(--dsw-alias-interactive-bg-hover);border-radius:14px 14px 4px;margin-left:auto;padding:10px 12px}.Wborea_assistant{margin-right:auto}.Wborea_message[data-streaming]:after{content:\"\";vertical-align:-2px;background:var(--dsw-alias-brand-primary);border-radius:2px;width:6px;height:14px;margin-left:3px;animation:.9s ease-in-out infinite Wborea_blink;display:inline-block}.Wborea_messageLabel{color:var(--dsw-alias-label-tertiary);margin-bottom:4px;font-size:11px;font-weight:600;line-height:16px}.Wborea_message p,.Wborea_reasoning pre{color:var(--dsw-alias-label-primary);font:inherit;overflow-wrap:anywhere;white-space:pre-wrap;margin:0 0 8px;font-size:14px;line-height:22px}.Wborea_message p:last-child,.Wborea_reasoning pre:last-child{margin-bottom:0}.Wborea_reasoning{color:var(--dsw-alias-label-secondary);margin:6px 0;font-size:12px}.Wborea_reasoning summary{cursor:pointer}.Wborea_reasoning pre{color:var(--dsw-alias-label-secondary);margin-top:6px;font-size:12px}.Wborea_interrupted,.Wborea_queued{color:var(--dsw-alias-label-tertiary);margin-top:5px;font-size:11px;font-style:italic;display:inline-block}.Wborea_queued{text-align:center;margin:-6px 0 14px;display:block}.Wborea_error{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border-radius:10px;margin:10px 0;padding:10px 12px;font-size:12px;line-height:18px}.Wborea_composer{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-menu);border-radius:14px;flex:none;margin:0 10px 10px;padding:10px}.Wborea_composer textarea{resize:vertical;box-sizing:border-box;width:100%;min-height:66px;max-height:180px;color:var(--dsw-alias-label-primary);font:inherit;background:0 0;border:0;outline:0;padding:2px;font-size:14px;line-height:21px;display:block}.Wborea_composer textarea::placeholder{color:var(--dsw-alias-label-tertiary)}.Wborea_composerActions{justify-content:space-between;align-items:center;gap:8px;margin-top:8px;display:flex}.Wborea_composerActions>span{color:var(--dsw-alias-label-tertiary);font-size:11px}.Wborea_composerActions>div{gap:6px;display:flex}.Wborea_primaryButton,.Wborea_secondaryButton{min-height:36px;font:inherit;cursor:pointer;border-radius:9px;padding:0 12px;font-size:12px}.Wborea_primaryButton{border:1px solid var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-button-primary-fill)}.Wborea_secondaryButton{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:0 0}.Wborea_secondaryButton:hover,.Wborea_emptyPanel button:hover{filter:brightness(.96)}.Wborea_primaryButton:hover{background:var(--dsw-alias-button-primary-hover)}button:disabled{cursor:not-allowed;opacity:.45}.Wborea_tab:focus-visible,.Wborea_tabClose:focus-visible,.Wborea_newTab:focus-visible,.Wborea_iconButton:focus-visible,.Wborea_emptyPanel button:focus-visible,.Wborea_primaryButton:focus-visible,.Wborea_secondaryButton:focus-visible,.Wborea_composer textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.Wborea_srOnly{clip:rect(0, 0, 0, 0);white-space:nowrap;border:0;width:1px;height:1px;padding:0;position:absolute;overflow:hidden}@keyframes Wborea_blink{0%,to{opacity:.25}50%{opacity:1}}@media (width<=520px){.Wborea_anchorMeta{display:none}.Wborea_message{max-width:100%}.Wborea_composerActions{align-items:flex-end}.Wborea_composerActions>span{display:none}.Wborea_primaryButton,.Wborea_secondaryButton{min-height:40px}}@media (prefers-reduced-motion:reduce){.Wborea_message[data-streaming]:after{animation:none}}";
		const id = "dsh-sidechat/SideChatPanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + id + "\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-sidechat";
			tag.dataset.pluginCss = id;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var SideChatPanel_module_css_default = {
			"anchor": "Wborea_anchor",
			"anchorLabel": "Wborea_anchorLabel",
			"anchorMeta": "Wborea_anchorMeta",
			"assistant": "Wborea_assistant",
			"blink": "Wborea_blink",
			"chatIcon": "Wborea_chatIcon",
			"composer": "Wborea_composer",
			"composerActions": "Wborea_composerActions",
			"conversation": "Wborea_conversation",
			"emptyConversation": "Wborea_emptyConversation",
			"emptyPanel": "Wborea_emptyPanel",
			"error": "Wborea_error",
			"iconButton": "Wborea_iconButton",
			"interrupted": "Wborea_interrupted",
			"message": "Wborea_message",
			"messageLabel": "Wborea_messageLabel",
			"newTab": "Wborea_newTab",
			"primaryButton": "Wborea_primaryButton",
			"queued": "Wborea_queued",
			"reasoning": "Wborea_reasoning",
			"root": "Wborea_root",
			"secondaryButton": "Wborea_secondaryButton",
			"srOnly": "Wborea_srOnly",
			"tab": "Wborea_tab",
			"tabClose": "Wborea_tabClose",
			"tabList": "Wborea_tabList",
			"tabs": "Wborea_tabs",
			"tabShell": "Wborea_tabShell",
			"tabTitle": "Wborea_tabTitle",
			"user": "Wborea_user"
		};
		//#endregion
		//#region src/client/SideChatPanel.tsx
		function SideChatPanel({ store, sessions, close: _close }) {
			const state = (0, react.useSyncExternalStore)(store.subscribe, store.getSnapshot, store.getSnapshot);
			const list = (0, react.useSyncExternalStore)(sessions.list.subscribe, sessions.list.getSnapshot, sessions.list.getSnapshot);
			const active = state.activeId === null ? void 0 : state.tabs.find((tab) => tab.id === state.activeId);
			const centeredId = list.current;
			const centeredTitle = centeredId === void 0 ? void 0 : list.byId[centeredId]?.displayTitle ?? centeredId;
			const opened = (0, react.useRef)(false);
			const [drafts, setDrafts] = (0, react.useState)({});
			const bottomRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (opened.current || centeredId === void 0 || centeredTitle === void 0) return;
				opened.current = true;
				store.create(String(centeredId), centeredTitle).catch(() => {});
			}, [
				centeredId,
				centeredTitle,
				store
			]);
			(0, react.useEffect)(() => {
				if (active?.remote.status !== "running") return;
				store.pull(active.id);
				const timer = setInterval(() => {
					store.pull(active.id);
				}, 350);
				return () => {
					clearInterval(timer);
				};
			}, [
				active?.id,
				active?.remote.status,
				store
			]);
			(0, react.useEffect)(() => {
				bottomRef.current?.scrollIntoView?.({ block: "end" });
			}, [active?.remote.messages.length, active?.remote.partialAssistant]);
			const draft = active === void 0 ? "" : drafts[active.id] ?? "";
			const setDraft = (value) => {
				if (active === void 0) return;
				setDrafts((current) => ({
					...current,
					[active.id]: value
				}));
			};
			const submit = (delivery) => {
				if (active === void 0 || draft.trim().length === 0) return;
				const text = draft.trim();
				setDraft("");
				store.submit(active.id, text, delivery);
			};
			const create = () => {
				if (centeredId === void 0 || centeredTitle === void 0) return;
				store.create(String(centeredId), centeredTitle).catch(() => {});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: SideChatPanel_module_css_default.root,
				"aria-label": "Side chat",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
					className: SideChatPanel_module_css_default.tabs,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: SideChatPanel_module_css_default.tabList,
						role: "tablist",
						"aria-label": "Side chats",
						children: state.tabs.map((tab) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: SideChatPanel_module_css_default.tabShell,
							"data-active": tab.id === state.activeId || void 0,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								role: "tab",
								"aria-selected": tab.id === state.activeId,
								className: SideChatPanel_module_css_default.tab,
								onClick: () => {
									store.select(tab.id);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: SideChatPanel_module_css_default.tabTitle,
									children: tab.title
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: SideChatPanel_module_css_default.tabClose,
								"aria-label": `Close side chat ${tab.title}`,
								onClick: () => {
									store.close(tab.id);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CloseIcon, {})
							})]
						}, tab.id))
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: SideChatPanel_module_css_default.newTab,
						"aria-label": "New side chat for centered conversation",
						title: "New side chat",
						disabled: centeredId === void 0 || state.opening,
						onClick: create,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlusIcon, {})
					})]
				}), active === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyPanel, {
					canCreate: centeredId !== void 0,
					opening: state.opening,
					onCreate: create
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AnchorBar, {
						tab: active,
						refresh: () => {
							store.refreshAnchor(active.id);
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Conversation, {
						tab: active,
						bottomRef
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Composer, {
						tab: active,
						draft,
						setDraft,
						submit,
						stop: () => {
							store.stop(active.id);
						}
					})
				] })]
			});
		}
		function EmptyPanel({ canCreate, opening, onCreate }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: SideChatPanel_module_css_default.emptyPanel,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChatIcon, {}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Side chat" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Temporary, read-only conversation context. Nothing is added to session history." }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: !canCreate || opening,
						onClick: onCreate,
						children: opening ? "Opening…" : "New side chat"
					})
				]
			});
		}
		function AnchorBar({ tab, refresh }) {
			const captured = (0, react.useMemo)(() => new Date(tab.anchor.capturedAt).toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit"
			}), [tab.anchor.capturedAt]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: SideChatPanel_module_css_default.anchor,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: SideChatPanel_module_css_default.anchorLabel,
						children: "Read-only context"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: tab.title }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: SideChatPanel_module_css_default.anchorMeta,
						children: [
							tab.anchor.kind,
							" · ",
							tab.anchor.provider,
							"/",
							tab.anchor.model,
							" · captured ",
							captured
						]
					})
				] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: SideChatPanel_module_css_default.iconButton,
					"aria-label": "Refresh read-only context",
					title: "Refresh context",
					disabled: tab.loading,
					onClick: refresh,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RefreshIcon, {})
				})]
			});
		}
		function Conversation({ tab, bottomRef }) {
			const empty = tab.remote.messages.length === 0 && tab.remote.partialAssistant === void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: SideChatPanel_module_css_default.conversation,
				"aria-live": "polite",
				children: [
					empty && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SideChatPanel_module_css_default.emptyConversation,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChatIcon, {}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Side chat" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "This chat starts empty with a frozen, read-only view of the centered conversation." }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "It disappears when closed or DSH restarts." })
						]
					}),
					tab.remote.messages.map((message) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageBubble, { message }, message.id)),
					tab.remote.partialAssistant !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: `${SideChatPanel_module_css_default.message} ${SideChatPanel_module_css_default.assistant}`,
						"data-streaming": "",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: SideChatPanel_module_css_default.messageLabel,
							children: "Side chat"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Blocks, { blocks: tab.remote.partialAssistant })]
					}),
					tab.remote.queuedCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SideChatPanel_module_css_default.queued,
						children: [
							tab.remote.queuedCount,
							" follow-up",
							tab.remote.queuedCount === 1 ? "" : "s",
							" queued"
						]
					}),
					tab.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: SideChatPanel_module_css_default.error,
						role: "alert",
						children: tab.error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { ref: bottomRef })
				]
			});
		}
		function MessageBubble({ message }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `${SideChatPanel_module_css_default.message} ${message.role === "user" ? SideChatPanel_module_css_default.user : SideChatPanel_module_css_default.assistant}`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: SideChatPanel_module_css_default.messageLabel,
						children: message.role === "user" ? "You" : "Side chat"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Blocks, { blocks: message.content }),
					message.interrupted && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: SideChatPanel_module_css_default.interrupted,
						children: "Interrupted"
					})
				]
			});
		}
		function Blocks({ blocks }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: blocks.map((block, index) => block.type === "reasoning" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
				className: SideChatPanel_module_css_default.reasoning,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "Reasoning" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: block.text })]
			}, index) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: block.text }, index)) });
		}
		function Composer({ tab, draft, setDraft, submit, stop }) {
			const running = tab.remote.status === "running";
			const submitForm = (event) => {
				event.preventDefault();
				submit("followup");
			};
			const keyDown = (event) => {
				if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
				event.preventDefault();
				submit("followup");
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				className: SideChatPanel_module_css_default.composer,
				onSubmit: submitForm,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
						htmlFor: `sidechat-input-${tab.id}`,
						className: SideChatPanel_module_css_default.srOnly,
						children: "Message side chat"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						id: `sidechat-input-${tab.id}`,
						value: draft,
						rows: 3,
						placeholder: running ? "Queue a follow-up or steer…" : "Ask about this conversation…",
						onChange: (event) => {
							setDraft(event.target.value);
						},
						onKeyDown: keyDown
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SideChatPanel_module_css_default.composerActions,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: running ? "Responding" : "Read-only · memory only" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
							running && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: SideChatPanel_module_css_default.secondaryButton,
								onClick: stop,
								children: "Stop"
							}),
							running && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: SideChatPanel_module_css_default.secondaryButton,
								disabled: draft.trim().length === 0,
								onClick: () => {
									submit("steer");
								},
								children: "Steer"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "submit",
								className: SideChatPanel_module_css_default.primaryButton,
								disabled: draft.trim().length === 0,
								children: running ? "Queue follow-up" : "Send"
							})
						] })]
					})
				]
			});
		}
		function PlusIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 16 16",
				"aria-hidden": true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8 3v10M3 8h10" })
			});
		}
		function CloseIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 16 16",
				"aria-hidden": true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m4 4 8 8m0-8-8 8" })
			});
		}
		function RefreshIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 16 16",
				"aria-hidden": true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M13 6a5 5 0 1 0 .2 3M13 3v3h-3" })
			});
		}
		function ChatIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className: SideChatPanel_module_css_default.chatIcon,
				viewBox: "0 0 24 24",
				"aria-hidden": true,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M5 18.5A8 8 0 1 1 19.5 14L21 20l-6-1.5A8 8 0 0 1 5 18.5Z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 8v6M9 11h6" })]
			});
		}
		//#endregion
		//#region src/client/store.ts
		const EMPTY = Object.freeze({
			tabs: Object.freeze([]),
			activeId: null,
			opening: false
		});
		var SideChatClientError = class extends Error {};
		var SideChatClient = class {
			rpc;
			constructor(rpc) {
				this.rpc = rpc;
			}
			async call(endpoint, payload, signal) {
				const outer = await this.rpc.call("/sidechat", endpoint, payload, signal);
				if (!outer.ok) throw new SideChatClientError(outer.error.message);
				const inner = outer.value;
				if (inner === void 0 || typeof inner !== "object" || typeof inner.ok !== "boolean") throw new SideChatClientError("sidechat returned an invalid response");
				if (!inner.ok) throw new SideChatClientError(inner.error.message);
				return inner.value;
			}
		};
		var SideChatStore = class {
			client;
			listeners = /* @__PURE__ */ new Set();
			snapshot = EMPTY;
			constructor(client) {
				this.client = client;
			}
			getSnapshot = () => this.snapshot;
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			async create(anchorSessionId, title) {
				if (this.snapshot.opening) return;
				this.publish({
					...this.snapshot,
					opening: true
				});
				try {
					const opened = await this.client.call("open", {
						anchorSessionId,
						anchorTitle: title
					});
					const tab = {
						id: opened.sideChatId,
						capability: opened.capability,
						title,
						anchor: opened.anchor,
						remote: {
							status: "idle",
							messages: [],
							queuedCount: 0,
							anchor: opened.anchor
						},
						loading: false,
						error: void 0
					};
					this.publish({
						tabs: [...this.snapshot.tabs, tab],
						activeId: tab.id,
						opening: false
					});
				} catch (error) {
					this.publish({
						...this.snapshot,
						opening: false
					});
					throw error;
				}
			}
			select(id) {
				if (!this.snapshot.tabs.some((tab) => tab.id === id)) return;
				this.publish({
					...this.snapshot,
					activeId: id
				});
			}
			async submit(id, text, delivery) {
				const tab = this.find(id);
				if (tab === void 0) return;
				this.patch(id, {
					loading: true,
					error: void 0
				});
				try {
					await this.client.call("submit", {
						...address(tab),
						content: [{
							type: "text",
							text
						}],
						delivery
					});
					await this.pull(id);
				} catch (error) {
					this.patch(id, {
						loading: false,
						error: messageOf(error)
					});
				}
			}
			async pull(id) {
				const tab = this.find(id);
				if (tab === void 0) return;
				try {
					const remote = await this.client.call("snapshot", address(tab));
					this.patch(id, {
						remote,
						anchor: remote.anchor,
						loading: false,
						error: remote.error
					});
				} catch (error) {
					this.patch(id, {
						loading: false,
						error: messageOf(error)
					});
				}
			}
			async refreshAnchor(id) {
				const tab = this.find(id);
				if (tab === void 0) return;
				this.patch(id, {
					loading: true,
					error: void 0
				});
				try {
					const anchor = await this.client.call("refresh", address(tab));
					this.patch(id, {
						anchor,
						remote: {
							...tab.remote,
							anchor
						},
						loading: false
					});
				} catch (error) {
					this.patch(id, {
						loading: false,
						error: messageOf(error)
					});
				}
			}
			async stop(id) {
				const tab = this.find(id);
				if (tab === void 0) return;
				try {
					await this.client.call("stop", address(tab));
					await this.pull(id);
				} catch (error) {
					this.patch(id, { error: messageOf(error) });
				}
			}
			async close(id) {
				const tab = this.find(id);
				if (tab === void 0) return;
				const tabs = this.snapshot.tabs.filter((candidate) => candidate.id !== id);
				const activeId = this.snapshot.activeId === id ? tabs.at(-1)?.id ?? null : this.snapshot.activeId;
				this.publish({
					...this.snapshot,
					tabs,
					activeId
				});
				try {
					await this.client.call("close", address(tab));
				} catch {}
			}
			async dispose() {
				await Promise.allSettled(this.snapshot.tabs.map((tab) => this.client.call("close", address(tab))));
				this.publish(EMPTY);
			}
			find(id) {
				return this.snapshot.tabs.find((tab) => tab.id === id);
			}
			patch(id, patch) {
				const tabs = this.snapshot.tabs.map((tab) => tab.id === id ? {
					...tab,
					...patch
				} : tab);
				this.publish({
					...this.snapshot,
					tabs
				});
			}
			publish(next) {
				this.snapshot = Object.freeze({
					...next,
					tabs: Object.freeze([...next.tabs])
				});
				for (const listener of this.listeners) listener();
			}
		};
		function address(tab) {
			return {
				sideChatId: tab.id,
				capability: tab.capability
			};
		}
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		//#endregion
		//#region src/client/index.ts
		const inject = [
			"workbench",
			"sessions",
			"connection"
		];
		function apply(ctx) {
			const workbench = ctx.get("workbench");
			const sessions = ctx.get("sessions");
			const store = new SideChatStore(new SideChatClient(ctx.get("connection").rpc));
			const component = (props) => (0, react.createElement)(SideChatPanel, {
				...props,
				store,
				sessions
			});
			ctx.effect(() => workbench.register({
				id: "sidechat",
				label: "Side chat",
				component,
				order: 0
			}), "sidechat: Workbench panel");
			ctx.effect(() => () => store.dispose(), "sidechat: client memory");
		}
		//#endregion
		exports.SideChatClient = SideChatClient;
		exports.SideChatPanel = SideChatPanel;
		exports.SideChatStore = SideChatStore;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map