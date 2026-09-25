# Mayfly Agent Team

[English](README.md)

可选的 `team` preset，以 Mayfly 的 `standard` 编码能力为基础，提供原生 Harness
队友、持久成员消息和共享任务板。终端界面包含成员筛选、任务详情、写入重叠提示和成员会话导航。

## 安装与选择

需要 Harness **0.1.7-rc.1**，以及包含条件页签和公开子会话回复事件的
Mayfly / Mayfly UI **0.1.0-alpha.6 或更新的 0.1 版本**。
正式市场条目应在配套 Mayfly 版本发布后启用。

```text
/plugin install agent-team
```

重启 Mayfly，新建会话，然后选择：

```text
/preset team
```

安装只增加一个选项，不修改默认 preset，不切换已有会话，也不向普通 preset
添加 Team 工具或提示词。normal / plan 执行模式仍独立。请明确要求 Lead 创建队友并委派工作。

等效包来源：

```sh
dsh plugin --profile mayfly add 'github:Ephemeral-AI-Lab/dsh-plugins#main&path:plugins/mayfly-agent-team'
```

## 终端使用

- `/team` 显示成员表和只读任务板。宽屏并列两列，窄屏使用页签；缩放时筛选、焦点和
  选中项沿用相同的语义控件身份。列表和页签切换使用界面显示的原生快捷键。
- 总览直接显示写入重叠。打开任务查看描述、负责人、依赖和写入范围，并可进入负责人的会话。
  任务创建和修改继续由原生 Agent 工具执行。
- 选择成员进入 Mayfly 的 exact-Agent 会话。F7 切换保留的 Lead/辅助视图，F8 关闭辅助视图，
  关闭不会停止队友。会话扩展提供团队总览和回复入口。
- 回复使用 Mayfly 共用表单，支持排队或引导。排队等待本轮结束，引导在下一步骤边界处理。
  普通行内输入仍为排队；需要选择发送方式时使用回复入口。
- 未加载成员先显示历史，按 `i` 回复；只有发送才恢复同一个子会话。
  渲染器重载和发送失败时保留草稿。

界面跟随 Mayfly 的中英文设置；插件不导入 pi-tui 或直接操作终端对象。

## 所有权与隔离

`@deepseek-ai/dsh-experimental-agent-team` 继续拥有成员、持久化、消息、任务图和权限。
`src/tools.ts` 基于上游九个工具的 schema 与原生调用作注册适配，来源见 `NOTICE`。
只有使用 `team` 的实际存活 Agent，且其原生 Team root 是使用 `team` 的运行时根 Agent，
才获得 Team 工具。这也排除尚未发布 descriptor 的一次性 Workflow 子 Agent。

preset 切换、Agent 释放和插件卸载时注销工具与命令。Mayfly UI 服务存在时才挂载 TUI。
插件不维护第二套领域状态或 continuation provider。

`cordis.patch.yml` 包含原生服务、插件入口和生成的 Team 声明。
`scripts/sync-preset.mjs` 从固定版本的 Mayfly `standard` 生成声明，只移除重叠的普通委派项，
保留原生 `!!js` 表达式，不使用不存在的 preset 继承 API。

成员共享工作目录；write scopes 是建议，任务不会自动调度或释放。上游 Team 仍属实验功能。
移除插件保留日志，但新会话不再列出 Team。恢复保存的 `team` 会话前需重新安装插件，
不能静默替换其持久 preset。

## 开发

配套 Mayfly 发布后：

```sh
pnpm install
pnpm preset:check
pnpm typecheck
pnpm test:coverage
pnpm build
```

发布前先构建配套 Mayfly checkout，再用真实 tarball 验证外部消费者：

```sh
node scripts/with-mayfly.mjs /absolute/path/to/mayfly -- pnpm run check
```

脚本临时替换 Mayfly 及其传递 UI 依赖，结束后还原 manifest 和 lockfile；不创建 profile，
不替调用者构建 Mayfly。`lib/` 随 GitHub 安装提交，市场 `dist/` 由既有 workflow 生成。

测试覆盖真实原生 preset/Agent、九个工具、fresh/fork、任务版本拒绝、历史续聊、普通 preset
隔离、TUI 生命周期及公开渲染器宽度。仅使用临时会话存储与进程内 mock，不使用 profile 或远程模型。
