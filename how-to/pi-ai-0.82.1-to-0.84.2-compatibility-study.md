# pi-ai 0.82.1 → 0.84.2 兼容性研究

日期：2026-08-21

## 结论

这不是一次可以直接修改版本号的普通依赖升级。

@earendil-works/pi-ai@0.82.1 到 0.84.2 的兼容压力主要来自 0.83.0 和 0.84.0 的累积 API 变化，0.84.1 和 0.84.2 又继续增加了 provider、tool、retry、Responses 和 Codex 相关行为。

当前推荐保持：

~~~text
DSH llm-pi-ai @ 0.82.1
        │
        └── xai-grok-4-6 → grok-4.6
~~~

这个显式 route 已通过真实 DSH smoke test，可以稳定调用 Grok 4.6，并能够向 DSH UI 暴露 low、medium、high 三档 thinking effort。

0.84.2 升级仍然有价值，但应当作为一次独立的 DSH host adapter migration；不应为了把 Grok 4.6 合并进原生 xai 分组，就把当前稳定运行时一起升级。

## 1. 版本范围

本研究对比：

~~~text
@earendil-works/pi-ai@0.82.1
    ↓
@earendil-works/pi-ai@0.83.0
    ↓
@earendil-works/pi-ai@0.84.0
    ↓
@earendil-works/pi-ai@0.84.1
    ↓
@earendil-works/pi-ai@0.84.2
~~~

关键时间点：

| 版本 | 时间 | 与 DSH 相关的主要变化 |
| --- | --- | --- |
| 0.82.1 | 2026-07-25 | 旧 catalog、旧 stop-reason union、旧 provider refresh/auth 契约 |
| 0.83.0 | 2026-07-29 | TypeBox breaking change、pending stop reason、raw stop reason、OAuth 提前刷新 |
| 0.84.0 | 2026-08-06 | 主要兼容断点：refresh/auth signal、catalog publication、deferred request、compat 字段、tool loading |
| 0.84.1 | 2026-08-07 | Qwen Token Plan、pi auth check、blocked tool termination 等，主要不是本次根因 |
| 0.84.2 | 2026-08-14 | Grok 4.6 catalog、endTurn、strict tool schema、additional_tools、max_tokens 修复、retry 和 Responses replay 修复 |

官方版本资料：

- [pi-ai CHANGELOG](https://raw.githubusercontent.com/earendil-works/pi/refs/heads/main/packages/ai/CHANGELOG.md)
- [Pi 0.83.0 release](https://github.com/earendil-works/pi/releases/tag/v0.83.0)
- [Pi 0.84.0 release](https://pi.dev/news/releases/0.84.0)
- [Pi 0.84.1 release](https://github.com/earendil-works/pi/releases/tag/v0.84.1)
- [Pi 0.84.2 release](https://github.com/earendil-works/pi/releases/tag/v0.84.2)

## 2. 最大的类型变化：StopReason

### 2.1 0.82.1

旧版 StopReason 是五个值：

~~~ts
type StopReason =
  | "stop"
  | "length"
  | "toolUse"
  | "error"
  | "aborted"
~~~

### 2.2 0.84.2

新版增加了两个值：

~~~ts
type StopReason =
  | "pending"
  | "stop"
  | "length"
  | "toolUse"
  | "error"
  | "aborted"
  | "deferred"
~~~

### 2.3 pending

pending 表示 assistant message 仍然是部分流或中间状态，不是最终完成。它不能简单映射成 DSH 的成功或失败：

~~~text
partial provider stream
        ↓
pending assistant message
        ↓
继续接收事件
        ↓
stop / length / toolUse / error
~~~

当前 DSH 的 [stream.ts](../../deepseek-harness/packages/llm/llm-pi-ai/src/stream.ts) 只处理旧的五个值。升级后必须明确 pending 的生命周期，否则可能出现提前结束 DSH stream 的问题。

### 2.4 deferred

deferred 对应新的 deferred provider request。provider 可以先返回一个 handle，之后再 poll、resolve 或 cancel：

~~~text
第一次请求
    ↓
deferred handle
    ↓
poll / resolve / cancel
    ↓
最终 assistant response
~~~

这不是普通的一次性 stream。DSH 当前的 LLM seam 主要假设一次请求最终产出 usage 和 finish。如果真正支持 deferred，还需要决定：

- deferred 是否成为 DSH durable operation；
- handle 是否写入 replay/session；
- 重启后是否可以恢复 poll；
- cancel 和 timeout 如何映射；
- provider 完成后如何重新进入当前 turn。

## 3. AssistantMessage 变化

0.84.2 的 AssistantMessage 增加了：

~~~ts
deferred?: DeferredHandle
rawStopReason?: string
endTurn?: boolean
~~~

含义分别是：

| 字段 | 作用 | DSH 影响 |
| --- | --- | --- |
| deferred | 延迟请求的 provider handle | 需要新的 operation、retry、cancel、replay 设计 |
| rawStopReason | 保留 provider 原始结束原因 | 有助诊断；replay schema 需要决定是否持久化 |
| endTurn | 保留 OpenAI Codex 的原生 end_turn 信号 | Codex Responses replay/诊断可能需要保留 |

当前 DSH 的 [replay.ts](../../deepseek-harness/packages/llm/llm-pi-ai/src/replay.ts) 只允许旧 stop reason：

~~~ts
['stop', 'length', 'toolUse', 'error', 'aborted']
~~~

如果只修 TypeScript 类型而不升级 replay 校验，运行时新消息可能产生，但持久化 replay 会拒绝。

## 4. Catalog 和 compat 字段变化

当前 DSH 的 [catalog.ts](../../deepseek-harness/packages/llm/llm-pi-ai/src/catalog.ts) 使用强类型 drift gate，要求每一个 pi-ai 新字段都被明确分类。这个设计可以防止新 capability 被静默丢弃，但也意味着 pi-ai 类型一变化，DSH 必须同步。

### 4.1 OpenAI Completions 新字段

0.84.2 相比 0.82.1 增加或扩展了：

~~~ts
supportsFinishReason?: boolean
chatTemplateArgs?: Record<string, ChatTemplateKwargValue>
supportsThinkingTokenBudget?: boolean
~~~

它们分别用于：

- supportsFinishReason：provider 不返回 streamed finish_reason 时，pi-ai 是否可以推断 stop 或 toolUse；
- chatTemplateArgs：Baseten 等模型的 chat_template_args thinking 参数；
- supportsThinkingTokenBudget：vLLM/OpenAI-compatible endpoint 是否支持 thinking_token_budget。

### 4.2 Thinking format 增加 baseten

新版 reasoning format 集合增加了：

~~~text
baseten
~~~

当前 DSH 的 THINKING_FORMAT_GATE 需要为新格式增加显式处理，否则编译会失败。这不是 Grok 特有的变化，而是 catalog capability vocabulary 扩展。

### 4.3 OpenAI Responses 新字段

Responses compat 增加了：

~~~ts
supportsAdditionalTools?: boolean
~~~

这会影响 deferred tools 的投递位置。新版优先使用 message-anchored additional_tools，同时保留 tool-search 和 top-level fallback。

对于 DSH 的 Codex route，这会影响：

- tool loading；
- tool namespace；
- stream 中的 tool call；
- replay；
- 跨模型或跨 provider 的 tool history。

## 5. Thinking levels 不是简单的全局新增或删除

“thinking levels 变了”这个说法方向正确，但不够精确。新版 pi-ai 更明确地把 thinking capability 拆成 provider/model-specific 的 wire format。

同一个 DSH 层的 low、medium、high、max，可能分别对应：

~~~json
{ "reasoning_effort": "high" }
~~~

或者：

~~~json
{ "thinking": { "type": "enabled" } }
~~~

或者：

~~~json
{
  "chat_template_args": {
    "thinking": true
  }
}
~~~

或者：

~~~json
{ "thinking_token_budget": 2048 }
~~~

因此 DSH 不能只看到 reasoning: true，就假设一定可以发送 reasoning_effort。

## 6. Grok 4.6 的真实 catalog 对比

我们把 npm tarball 中的 xAI catalog 做了实际对比。

### 6.1 0.82.1 的 xAI catalog

原生 xai 包含：

~~~text
grok-4.3
grok-4.5
grok-build-0.1
~~~

其中：

~~~text
grok-4.3        → openai-completions
grok-4.5        → openai-responses
grok-build-0.1  → openai-completions
~~~

没有原生 grok-4.6。

### 6.2 0.84.2 的 xAI catalog

新版原生增加：

~~~json
{
  "id": "grok-4.6",
  "api": "openai-completions",
  "provider": "xai",
  "baseUrl": "https://api.x.ai/v1",
  "reasoning": true,
  "input": ["text", "image"],
  "contextWindow": 500000,
  "maxTokens": 500000,
  "compat": {
    "supportsStore": false,
    "supportsDeveloperRole": false,
    "supportsReasoningEffort": false
  }
}
~~~

这里有一个关键区别：

~~~text
0.84.2 原生识别 Grok 4.6
但原生 catalog 没有提供 thinkingLevelMap
而且 supportsReasoningEffort = false
~~~

所以：

~~~text
升级到 0.84.2
    ≠
UI 一定自动显示 low/medium/high
~~~

新版可以让模型原生出现在 xai，但不一定提供当前 explicit route 提供的 effort 选择。

## 7. 当前 Grok 4.6 patch 做了什么

当前 patch 位于：

- [grok/cordis.patch.yml](../../dsh-plugins/coding-plan/grok/cordis.patch.yml)
- [codex/cordis.patch.yml](../../dsh-plugins/coding-plan/codex/cordis.patch.yml)

它不是修改 pi-ai 源码，而是增加一个 DSH explicit route：

~~~yaml
xai-grok-4-6:
  displayName: Grok Coding Plan · Grok 4.6
  apiKeyEnv: GROK_CODING_PLAN_ACCESS_TOKEN
  api: openai-completions
  baseURL: https://api.x.ai/v1
  models:
    - id: grok-4.6
      name: Grok 4.6
      contextWindow: 1000000
      maxTokens: 131072
      reasoningEfforts:
        low: low
        medium: medium
        high: high
~~~

它做了四件事：

1. 在 0.82.1 catalog 没有模型时声明 grok-4.6；
2. 明确使用 openai-completions；
3. 明确使用 https://api.x.ai/v1；
4. 显式向 DSH UI 提供 low、medium、high。

因此当前结构是：

~~~text
共享 pi-ai 运行时
        +
DSH explicit model route
        +
Grok OAuth credential
        +
显式 reasoning policy
~~~

这不是第二个 LLM engine，也不是绕开 pi-ai。

注意：explicit route 中的 contextWindow、maxTokens 和 effort 列表是当前 DSH deployment metadata，不等于 0.84.2 原生 catalog 的字段。未来 native merge 时不能无脑覆盖，应逐项验证。

## 8. DSH 为什么会在升级时出问题

### 8.1 Catalog drift gate

DSH 的 catalog 层把 pi-ai 的 compat fields 明确列出来。好处是新字段不会被静默忽略；代价是每次 pi-ai 扩展类型，DSH 必须回答：

~~~text
这个字段是否暴露给 DSH？
是否允许 route-level 配置？
是否允许 model-level 配置？
是否只继承 catalog？
是否暂时 withhold？
~~~

### 8.2 Stream exhaustive switch

DSH 当前 [stream.ts](../../deepseek-harness/packages/llm/llm-pi-ai/src/stream.ts) 将 pi-ai terminal message 映射成 DSH finish reason。新增 pending/deferred 后，必须定义新的生命周期语义，不能只把两个字符串补到 union。

### 8.3 Replay schema

DSH 当前 [replay.ts](../../deepseek-harness/packages/llm/llm-pi-ai/src/replay.ts) 只接受旧 stop reason。如果新 runtime 产生了 deferred 或 raw stop metadata，replay 要么丢信息，要么拒绝历史。

### 8.4 Request body

DSH 的 [adapter.ts](../../deepseek-harness/packages/llm/llm-pi-ai/src/adapter.ts) 将 DSH options 交给 pi-ai streamSimple。新版根据 model compat 决定：

~~~text
max_tokens
max_completion_tokens
reasoning_effort
thinking
chat_template_args
samplingParams
~~~

因此同一份 DSH 请求在两个版本中可能产生不同的 provider body。maxTokens 不是从无到有的字段：旧版已经有 maxTokensField；变化主要是 catalog 检测、provider-specific defaults 和新版对 DeepSeek max_tokens 的修正。

## 9. 我们实验升级时实际观察到的变化

我们曾把 DSH host 的 pi-ai 从：

~~~diff
- @earendil-works/pi-ai: ^0.82.1
+ @earendil-works/pi-ai: ^0.84.2
~~~

临时升级，并尝试修正编译问题。观察到：

- catalog 类型需要新增 Baseten thinking format；
- compat gate 需要新增 supportsFinishReason、chatTemplateArgs、supportsThinkingTokenBudget 和 Responses 的 supportsAdditionalTools；
- stream 类型需要面对 pending/deferred；
- replay stop-reason allowlist 需要扩展；
- 现有测试在 thinking levels、max-token request shape、abort/stream termination 等方面失败。

这些 host source patch 没有保留，最后恢复到 0.82.1。当前生效的 Grok 4.6 支持来自显式 DSH route，而不是来自修改过的 pi-ai host adapter。

## 10. 推荐方案

### 稳定路径

继续使用：

~~~text
DSH llm-pi-ai @ 0.82.1
        │
        └── xai-grok-4-6 → grok-4.6
~~~

优点：

- 当前真实 DSH smoke test 已通过；
- Grok 4.6 可以在 UI 选择；
- low、medium、high 可用；
- 不需要引入 deferred request 生命周期；
- 不需要修改 Codex Responses replay；
- 不会把 DSH host 的稳定适配器和新 catalog 一起冒险升级。

### 升级路径

如果要升级到 0.84.2，应当作为独立兼容性分支：

1. DSH host 和 coding-plan 统一固定到同一个精确 pi-ai 版本；
2. 更新 catalog compat drift gates；
3. 明确定义 pending/deferred 到 DSH stream/operation 的映射；
4. 升级 replay envelope；
5. 复测 Codex Responses tool call、namespace、endTurn 和 replay；
6. 复测 Grok completions 的 max_tokens、thinking 和 finish reason；
7. 复测 auth refresh、catalog refresh、abort 和 retry；
8. 跑完整 DSH llm-pi-ai 测试集；
9. 运行 Codex 和 Grok 4.6 真实 smoke test；
10. 最后再决定是否把 Grok 4.6 从 xai-grok-4-6 合并到原生 xai。

升级通过后仍然需要确认：原生 xai/grok-4.6 的 catalog 没有 thinkingLevelMap 且声明 supportsReasoningEffort: false，所以 native merge 可能需要保留 explicit compat override，才能继续提供当前 UI 的 effort 选择。

## 11. 最终判断

~~~text
Grok 4.6 功能现在已经可用
0.84.2 migration 仍然值得做
但它是 DSH host adapter migration，不是 Grok patch
~~~

下一次新模型到来时，应优先采用：

~~~text
新模型 ID + JSON offering manifest + explicit route
~~~

只有当新模型引入新的 wire protocol、stop lifecycle 或 compat capability 时，才把它升级为 host adapter migration，而不是每个模型都强迫 DSH 整体升级。

