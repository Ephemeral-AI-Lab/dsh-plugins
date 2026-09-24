# Mayfly Agent Team：可选插件与 TUI 演示稿

状态：设计已确认，运行时实现位于 `plugins/mayfly-agent-team`，配套 Mayfly 修改位于 `feat/optional-agent-team`。当前目录保留静态演示；演示内安装、发送、恢复仍只修改页面示例数据。

## 已确定的产品方向

- Agent Team 从 Mayfly 默认组合移出，通过我们自己的插件市场提供。
- 插件源代码归属 `dsh-plugins`，主要提供 Mayfly TUI 适配；协作域复用 Harness 原生服务。
- 安装只新增一个独立 preset，不更改默认 preset，也不让现有 preset 获得 Team 工具和提示词。
- 新 preset 基于常规编码 preset。当前 Mayfly 的这个 preset ID 是 `standard`；`normal` 则是与 `plan` 对应的执行模式。演示暂按“以 standard 为基础”设计，命名可调整。
- 先调整并确认演示稿，再实现运行时迁移。

建议命名（尚未发布）：

| 项目 | 候选值 |
| --- | --- |
| 市场显示名 / ID | Agent Team / `agent-team` |
| 插件目录 | `plugins/mayfly-agent-team/` |
| 包名 | `dsh-mayfly-agent-team` |
| 新 preset 显示名 / ID | Agent Team / `team` |
| 市场能力 | `server` + `tui` |
| 安装激活方式 | bundle；重启后在新会话选择 preset |

## 演示方式

在本目录启动静态服务器：

```sh
python3 -m http.server 4190 --bind 0.0.0.0 --directory docs/design/agent-team
```

浏览器打开服务器的 LAN 地址。页面支持：

- 五个场景：市场、preset 选择、团队总览、任务详情、队友会话。
- 100 / 80 / 40 列切换，40 列使用与宽屏相同的示例数据。
- 单击成员/任务，或聚焦终端后用方向键、Tab、Enter 操作。
- `/` 聚焦搜索；成员名、任务标题、负责人均可筛选。
- `Esc` 返回，`i` 打开回复，F7 在 Lead/辅助会话间切换，F8 关闭辅助会话。
- 右侧状态选择器展示空团队、加载、创建失败、普通 preset、阻塞任务、未加载队友与发送失败。
- 回复支持排队/引导选择；未加载队友显示“发送并恢复”。输入为空时拒绝发送，发送失败保留草稿。

页面外框是评审工具；仅深色终端区域是拟实现的产品界面。鼠标点击辅助评审，终端交互必须可通过键盘完成。演示场景可直接跳转，不代表已经真实完成安装或已有真实 Team 数据。

## 拟采用的交互

### 安装与选择

1. `/plugin` 中找到 Agent Team，明确显示它新增一个 preset 和终端界面。
2. 安装完成提示重启；重启后新建空会话，通过现有 `/preset` 选择 Agent Team。
3. standard 仍是默认值；Team 只是可选项，不自动进入、不自动组队。
4. 用户在 Team 会话中明确要求 Lead 创建队友。只切换 preset 不产生模型调用或队友。

### 团队总览

- 100 列：成员在左、共享任务在右，Tab 切换焦点。
- 80 / 40 列：成员与任务使用页签，不强行压缩两列。
- 成员显示名称、角色、运行状态、当前会话标记；模型信息放在成员会话或详情，避免总览拥挤。
- 总览顶部显示人数、未完成任务数，以及需要协调的写入范围重叠。
- 任务列表显示任务 ID、标题、状态与负责人；详情补充描述、依赖和范围。
- 面板和任务详情只读；任务写操作继续通过 Agent 工具执行。
- 导航与窗口变化不得重置当前筛选或选中项。原型中的侧边场景切换可重置场景，用于评审。

### 队友会话

- 沿用现有 Mayfly 会话和辅助视图，不增加第二套消息记录或 Team 自有输入运行时。
- 显示当前队友、父 Lead 和返回团队入口。
- 在线队友回复可显式选择 Queue 或 Steer，默认 Queue。按钮旁说明投递时机。
- 未加载队友先显示历史。打开、滚动、写草稿都不唤醒 Agent；“发送并恢复”才调用原生 addressed-subagent 路径。
- 输入失败保留草稿；切换目标防止误发；渲染器重载保留未提交内容。
- 关闭视图不停止 Agent。Team 面板不新增重命名、删除、任务编辑或停止按钮。

### 信息状态

| 状态 | 呈现 |
| --- | --- |
| 普通 preset | 不显示 Team 状态栏、不安装 Team 工具/策略、不提供活动 Team 面板 |
| Team 空会话 | 仅 Lead，提示通过对话明确创建队友 |
| 读取中 | 独立加载态，不能误报“未安装”或“不可用” |
| 成员 provisioning / failed | 分别标记准备中/失败；不可当作在线成员打开 |
| 成员 inactive | 表示没有轮次执行，不等价于完成任务 |
| 未加载成员 | 可读历史；显式发送才恢复 |
| 阻塞任务 | 展示具体 blocker ID |
| 写入范围重叠 | 总览提示、任务详情解释；这是建议，不是文件锁 |
| 发送失败 | 保留输入并显示错误；用户自行重试 |

## 后续代码归属与迁移边界

### Mayfly 仓库

- 撤出默认 bundle 中的 Team 服务和工具安装，以及 Team 专用命令、状态贡献。
- 恢复受此次默认 Team 集成影响的普通 preset 委派能力。不得连带撤销 #35 中的原生会话、MCP、文件交付、提醒和 transcript 功能。
- 通用的 current-Agent 选择、addressed-subagent 导航、历史浏览和回复能力继续归 Mayfly。
- 通过现有公开 native 服务和 Mayfly UI 服务提供插件所需访问；如缺少必要公开契约，单独设计、验证，不从外部插件引用 `src/` 或 `core/`。
- 移除 Team 专用依赖及默认宣传，更新中英文文档和边界说明。

### dsh-plugins 仓库

- 在候选插件目录实现 TUI 成员/任务展示和命令；通过 `mayflyOverlays`、`mayflyStatus` 等 renderer-neutral 服务贡献界面。
- 使用原生 `agentTeam` 只读投影；原生 Team 服务继续拥有 roster、mailbox、task DAG、权限和持久化。
- 新增独立 Team preset 定义，复用 standard 能力基线。Harness 0.1.7 的声明没有 `extends` 字段，不能写一个虚构的 `extends: standard`；采用受版本约束、可验证的基线组合方式。
- 市场条目使用 GitHub 子目录安装，声明 Mayfly/Harness 兼容范围，提交构建产物；`dist/` 仍由既有 workflow 生成。
- 插件卸载后新会话不再列出 Team preset；历史 Team 会话恢复时若缺插件，应给出重新安装提示，不静默降级成 standard，不删除日志。

### 必须先解决的 preset 隔离

原生 `dsh-experimental-tool-agent-team` 在 `apply` 内遍历 `ctx.agents.list()` 并监听 `agent/created`，为 `tryMembership()` 识别的成员安装工具。原生域把普通 root Agent 视为隐式 Lead。**因此只把安装位置移到新插件，甚至只把声明放进 preset，都不能未经验证就断言工具只影响 Team preset。**

实现阶段要基于 0.1.7-rc.1 的原生 scope/注册契约验证工具与 policy 的可见性：只绑定 Team preset 的 exact Agent 及其原生队友；普通 root 和 Workflow one-shot 子 Agent 均不得得到 Team 注册。服务可作为共享基础设施存在，但不得因此向普通会话暴露工具、Team 提示词、入口或状态栏。保持原生领域所有权，不引入平行 mailbox、任务库或自建 capability host。

这是实现必须满足的验收条件，原型没有假装解决运行时注册问题。

## 实现后验证范围

- 未安装、已安装但 standard、已安装且 Team 三种组合分别验证工具、system policy、命令与 UI 可见性。
- 五个现有 preset 的非 Team 能力回归，普通委派工具恢复。
- Team 创建、fresh/fork、原生消息、任务投影及 cold continuation。
- exact Agent 切换、same-ID 替换、晚到结果、插件卸载和 renderer reload。
- 100 / 80 / 40 列、长名字、长任务、筛选空结果、创建/发送失败。
- Queue/Steer 使用明确投递模式，不把人类回复误当 peer mailbox 消息。
- 两仓库包、构建、兼容和市场校验；运行时验证方式遵循用户已有“不用给我 profile 测试”的要求，不再安排人工 profile 验收。

## 当前证据基准

- Mayfly `72f4a72`：`team-command.ts`、`subagent-reply.ts`、`input-plugin.ts`、`current-agent.ts`、`standard.patch.yml`。
- Harness `dsh-v0.1.7-rc.1`：原生 Team service/tools、preset registry、Web Team UI。
- dsh-plugins `cb9ea00`：市场 schema、GitHub 安装和生成索引流程。

本设计已获用户授权进入实现。生产市场启用需先发布包含配套公开契约的 Mayfly 0.1.0-alpha.6；实现验证不要求人工 profile 测试。
