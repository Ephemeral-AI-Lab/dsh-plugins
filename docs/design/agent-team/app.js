/** Interactive, fixture-only terminal storyboard. No Harness or plugin calls. */
const terminal = document.querySelector('#terminal')
const scenes = ['market', 'preset', 'team', 'task', 'chat']
const labels = { market: '插件市场', preset: '选择预设', team: '团队总览', task: '任务详情', chat: '队友会话' }
const state = {
  scene: scenes.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'team',
  width: innerWidth < 600 ? 40 : 100,
  variant: 'running', installed: false, restarted: false, preset: 'standard',
  member: 1, task: 1, focus: 'members', query: '', current: 'lead',
  reply: false, draft: '', delivery: 'queue', feedback: '', chatState: 'running',
}
const members = [
  { id: 'lead', role: 'Lead', status: '协调中', model: 'deepseek-v4', description: '拆分工作，审查结果，给出最终答复。' },
  { id: 'reviewer', role: '队友', status: '运行中', model: 'deepseek-v4', description: '检查登录链路与权限边界。' },
  { id: 'tester', role: '队友', status: '运行中', model: 'deepseek-v4', description: '补充失败路径与会话恢复测试。' },
  { id: 'researcher', role: '队友', status: '未加载', model: 'deepseek-v4', description: '整理参考资料；历史可查看、可续聊。' },
]
const tasks = [
  { id: 'task-1', title: '梳理认证调用链', status: '已完成', owner: 'lead', scope: '—', blockers: '—', description: '梳理登录、刷新和退出的调用关系，记录边界。', warning: false },
  { id: 'task-2', title: '审查权限边界', status: '进行中', owner: 'reviewer', scope: 'src/auth/', blockers: '—', description: '检查登录重试、令牌失效和权限降级。标出风险位置，并给出最小修复建议。', warning: true },
  { id: 'task-3', title: '补充回归与测试桩', status: '进行中', owner: 'tester', scope: 'src/auth/, tests/auth/', blockers: '—', description: '补充授权失败和续期测试，必要时增加认证模块测试桩。', warning: true },
  { id: 'task-4', title: '汇总结果并验证修复', status: '已阻塞', owner: 'lead', scope: '—', blockers: 'task-2, task-3', description: '等待审查和回归测试完成，再汇总最终结论。', warning: false },
]
const notes = {
  market: ['安装只增加选择', '在我们自己的插件市场提供 Agent Team。安装与启用是两步。', ['插件标明“新增预设 + 终端界面”。', '安装后提示重启并新建会话。', '默认预设、已有会话都不会被自动切换。'], '点击“安装”，再点“重启演示”，进入预设选择。'],
  preset: ['只为这次会话选 Team', 'Agent Team 以 standard 的常规能力为基础，作为独立预设出现在列表中。', ['standard 继续作为默认项。', '选择 Team 后也需要明确要求模型创建队友。', 'preset 与 normal / plan 是两种不同的选择。'], '点击 Agent Team，进入一个示例团队；选择 standard 可看关闭状态。'],
  team: ['总览先看人，再看任务', '宽终端同时显示成员与任务。收窄后变成两个页签，保留同一组选中项。', ['状态栏常驻简短团队摘要。', '写入范围重叠在总览就提示。', 'Enter 打开会话或任务；任务板保持只读。'], '点击成员或任务；↑↓ 选择，Tab 切换区域，Enter 打开，/ 筛选。'],
  task: ['先看到阻塞，再看细节', '独立详情页展示任务描述、负责人、依赖和写入范围。', ['重叠提示说明涉及哪位队友。', '依赖使用明确的 task ID。', '“打开负责人会话”可直接进入讨论。'], '点击“打开负责人会话”，或按 Esc 回到任务列表。'],
  chat: ['与队友对话，保持上下文', '沿用 Mayfly 的会话视图；始终标明当前队友、Team 归属与返回入口。', ['在线成员可选“排队”或“引导”。', '未加载成员先看历史，发送才恢复。', '关闭视图不会中断成员的工作。'], '点击“回复”输入内容；切换发送方式后发送。F7 切回 Lead，F8 关闭辅助视图。'],
}
const variants = {
  market: [['running', '尚未安装'], ['installed', '已安装，待重启']],
  preset: [['running', '插件已安装 · 新会话'], ['off', '未安装插件']],
  team: [['running', '协作进行中'], ['empty', '尚未创建队友'], ['failure', '成员创建失败'], ['loading', '正在读取团队'], ['off', '普通 preset · Team 关闭']],
  task: [['running', '写入范围重叠'], ['blocked', '前置任务未完成'], ['done', '任务已完成']],
  chat: [['running', '在线队友'], ['cold', '未加载 · 可续聊'], ['failed', '发送失败 · 保留草稿']],
}
const seg = (text, tone = '', action = '') => ({ text: String(text), tone, action })
const charWidth = char => /\p{Mark}/u.test(char) ? 0 : /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6]/u.test(char) || /\p{Extended_Pictographic}/u.test(char) ? 2 : 1
const textWidth = text => [...text].reduce((sum, char) => sum + charWidth(char), 0)
const pieceWidth = pieces => pieces.reduce((sum, item) => sum + textWidth(item.text), 0)
function crop(text, width, ellipsis = false) {
  if (textWidth(text) <= width) return text
  let result = '', cells = 0
  for (const char of text) {
    if (cells + charWidth(char) > width - (ellipsis ? 1 : 0)) break
    result += char
    cells += charWidth(char)
  }
  return result + (ellipsis ? '…' : '')
}
function fit(pieces, width) {
  const result = []
  let remaining = width
  for (const item of pieces) {
    if (remaining <= 0) break
    const text = crop(item.text, remaining)
    result.push({ ...item, text })
    remaining -= textWidth(text)
  }
  if (remaining) result.push(seg(' '.repeat(remaining)))
  return result
}
function wrap(text, width) {
  const rows = []
  let part = '', cells = 0
  for (const char of text) {
    if (char === '\n' || cells + charWidth(char) > width) {
      rows.push(part)
      part = ''; cells = 0
      if (char === '\n') continue
    }
    part += char; cells += charWidth(char)
  }
  if (part) rows.push(part)
  return rows
}
let rows = []
const add = (...pieces) => rows.push(pieces.map(item => typeof item === 'string' ? seg(item) : item))
function border(title = '', bottom = false) {
  const label = title ? ` ${title} ` : ''
  add(seg(`${bottom ? '╰' : '╭'}─${label}${'─'.repeat(Math.max(0, state.width - textWidth(label) - 3))}${bottom ? '╯' : '╮'}`, 'rule'))
}
function inside(...pieces) {
  const values = pieces.map(item => typeof item === 'string' ? seg(item) : item)
  add(seg('│ ', 'rule'), ...fit(values, state.width - 4), seg(' │', 'rule'))
}
function paragraph(text, tone = 'muted') { for (const line of wrap(text, state.width - 6)) inside(seg(line, tone)) }
function blank() { inside('') }
function rule() { inside(seg('─'.repeat(state.width - 4), 'rule')) }
function header(preset = 'team') {
  add(seg(' mayfly ', 'accent'), seg('~/workspace/mayfly', 'muted'))
  add(seg(` ${preset === 'team' ? 'Agent Team' : 'standard'}  ·  normal  ·  deepseek-v4`, 'muted'))
  add('')
}
function footer(hint = 'Enter 打开  ·  Esc 返回') {
  add('')
  for (const line of wrap(` ${hint}`, state.width - 1)) add(seg(line, 'muted'))
  add(seg('─'.repeat(state.width), 'rule'))
  const count = state.variant === 'empty' ? '1 人 · 0 任务' : '4 人 · 3 任务未完成'
  add(seg(` ${state.scene === 'market' || state.scene === 'preset' || state.variant === 'off' ? 'standard · normal' : `team · ${count}`}`, 'accent'))
}
function market() {
  header('standard')
  border('插件市场 / Agent Team')
  blank(); inside(seg('Agent Team', 'bright')); inside(seg('Ephemeral AI Lab  ·  实验功能', 'muted')); blank()
  paragraph('为 Mayfly 增加团队协作预设、成员视图和共享任务板。')
  blank(); inside(seg('新增预设', 'muted'), seg('   Agent Team', 'accent'))
  inside(seg('基础能力', 'muted'), '   standard')
  inside(seg('界面入口', 'muted'), '   /team')
  blank(); paragraph('只在选用 Agent Team 的会话中启用。现有预设保持原样。', 'bright')
  rule()
  if (state.installed) {
    paragraph('✓ 安装完成。重启 Mayfly 后，在新会话中选择 Agent Team。', 'green')
    blank(); inside(seg('[ 重启演示 ]', 'accent', 'restart'), '  ', seg('[ 返回 ]', 'muted', 'scene:preset'))
  } else {
    paragraph('安装后需重启并新建会话。', 'muted')
    blank(); inside(seg('[ 安装 ]', 'selected', 'install'))
  }
  blank(); border('', true); footer('Enter 安装  ·  Esc 关闭')
}
function presets() {
  header('standard'); border('选择预设 / 新会话'); blank()
  paragraph('为这次会话选择一组能力。', 'muted'); blank()
  inside(seg(' standard    默认', 'accent', 'choose:standard'))
  paragraph('常规编码、文件操作、工具与规划。')
  rule()
  if (state.variant !== 'off') {
    inside(seg('› Agent Team', 'selected', 'choose:team'))
    paragraph('standard + 原生团队协作', 'bright')
    paragraph('成员会话 · 共享任务 · /team')
    blank(); paragraph('选择后，在对话中明确要求创建队友。')
    blank(); inside(seg('[ 使用 Agent Team ]', 'accent', 'choose:team'))
  } else {
    paragraph('尚未安装 Agent Team 插件。')
    blank(); inside(seg('[ 前往插件市场 ]', 'accent', 'scene:market'))
  }
  blank(); border('', true); footer('Enter 选择  ·  仅作用于新会话')
}
const filteredMembers = () => members.map((member, index) => ({ ...member, index })).filter(member => `${member.id} ${member.role}`.toLowerCase().includes(state.query.toLowerCase()))
const filteredTasks = () => tasks.map((task, index) => ({ ...task, index })).filter(task => `${task.id} ${task.title} ${task.owner}`.toLowerCase().includes(state.query.toLowerCase()))
function memberRows(member, compact = false) {
  const failed = state.variant === 'failure' && member.id === 'researcher'
  const chosen = state.member === member.index && state.focus === 'members'
  const status = failed ? '创建失败' : member.status
  const tone = failed ? 'danger' : chosen ? 'selected' : member.id === 'researcher' ? 'muted' : 'bright'
  return [
    [seg(`${chosen ? '›' : ' '} ${member.id}${member.id === state.current ? '  当前' : ''}`, tone, failed ? '' : `member:${member.index}`)],
    [seg(`  ${status}${compact ? '' : ` · ${member.role}`}`, failed ? 'danger' : 'muted')],
  ]
}
function taskRows(task, compact = false) {
  const chosen = state.task === task.index && state.focus === 'tasks'
  const statusTone = task.status === '已完成' ? 'green' : task.status === '已阻塞' ? 'warn' : 'accent'
  return [
    [seg(`${chosen ? '›' : ' '} ${task.id}  ${task.title}`, chosen ? 'selected' : 'bright', `task:${task.index}`)],
    [seg(`  ${task.status}`, statusTone), seg(` · ${task.owner}${!compact && task.warning ? ' · ! 写入重叠' : ''}`, task.warning && !compact ? 'warn' : 'muted')],
  ]
}
function team() {
  header(state.variant === 'off' ? 'standard' : 'team')
  if (state.variant === 'off') {
    border('standard / 普通会话'); blank(); paragraph('当前会话使用 standard。', 'bright'); blank()
    paragraph('需要团队协作时，请新建会话并选择 Agent Team 预设。'); blank()
    inside(seg('[ 查看预设 ]', 'accent', 'scene:preset')); blank(); border('', true)
    footer('当前无 Team 状态栏或团队工具'); return
  }
  border('Agent Team'); blank()
  if (state.variant === 'loading') {
    paragraph('◌ 正在读取团队…', 'accent'); blank(); paragraph('读取成员与任务不会自动创建队友。')
  } else if (state.variant === 'empty') {
    inside(seg('lead  当前', 'accent')); inside(seg('未运行 · Lead', 'muted')); rule()
    paragraph('还没有队友或共享任务。', 'bright'); blank(); paragraph('在对话中明确委派，例如：')
    paragraph('“请用 Agent Team，请 reviewer 审查权限，请 tester 检查测试，完成后汇总。”')
    blank(); inside(seg('[ 回到 Lead 对话 ]', 'accent', 'lead'))
  } else {
    inside(seg(`${members.length} 位成员`, 'bright'), seg('  ·  3 个未完成任务', 'muted'))
    paragraph('! task-2 与 task-3 写入范围重叠', 'warn')
    if (state.variant === 'failure') paragraph('! researcher 创建失败：模型暂不可用。', 'danger')
    blank()
    rows.push({ input: 'search', placeholder: '搜索成员、任务或负责人…', value: state.query })
    blank()
    const people = filteredMembers(), work = filteredTasks()
    if (state.width >= 100) {
      const leftWidth = 29, rightWidth = state.width - 7 - leftWidth
      inside(...fit([seg('成员', state.focus === 'members' ? 'accent' : 'muted', 'focus:members')], leftWidth), seg(' │ ', 'rule'), seg('共享任务', state.focus === 'tasks' ? 'accent' : 'muted', 'focus:tasks'))
      inside(seg('─'.repeat(leftWidth), 'rule'), seg('─┼─', 'rule'), seg('─'.repeat(rightWidth), 'rule'))
      for (let i = 0; i < Math.max(people.length, work.length); i++) {
        const left = people[i] ? memberRows(people[i]) : [[], []]
        const right = work[i] ? taskRows(work[i]) : [[], []]
        for (let j = 0; j < 2; j++) inside(...fit(left[j], leftWidth), seg(' │ ', 'rule'), ...fit(right[j], rightWidth))
        if (i < 3) inside(...fit([], leftWidth), seg(' │ ', 'rule'))
      }
      if (!people.length && !work.length) paragraph('没有匹配的成员或任务。')
    } else {
      inside(seg(' 成员 ', state.focus === 'members' ? 'selected' : 'muted', 'focus:members'), '  ', seg(' 任务 ', state.focus === 'tasks' ? 'selected' : 'muted', 'focus:tasks'))
      rule()
      const list = state.focus === 'members' ? people : work
      for (const item of list) {
        const contents = state.focus === 'members' ? memberRows(item, true) : taskRows(item, true)
        contents.forEach(row => inside(...row)); blank()
      }
      if (!list.length) paragraph('没有匹配结果。')
    }
  }
  blank(); inside(seg('[ 回到对话 ]', 'muted', 'lead')); border('', true)
  footer('↑↓ 选择  Tab 切换  Enter 打开\n / 搜索  Esc 返回')
}
function task() {
  const item = tasks[state.task]
  header(); border(`${item.id} / 任务详情`); blank()
  paragraph(item.title, 'bright'); blank()
  inside(seg('状态  ', 'muted'), seg(item.status, item.status === '已阻塞' ? 'warn' : 'accent'))
  inside(seg('负责  ', 'muted'), seg(item.owner, 'bright', `owner:${item.owner}`))
  inside(seg('依赖  ', 'muted'), item.blockers)
  rule(); paragraph(item.description, 'bright'); blank()
  inside(seg('写入范围', 'muted')); paragraph(item.scope, 'accent')
  if (item.warning) {
    blank(); paragraph(`! 与 ${item.owner === 'reviewer' ? 'tester / task-3' : 'reviewer / task-2'} 重叠`, 'warn')
    paragraph('src/auth/  ·  请先协调修改顺序', 'warn')
    paragraph('写入范围为协作提示，不会锁定文件。')
  }
  if (item.status === '已阻塞') { blank(); paragraph('等待 task-2、task-3 完成后可开始。', 'warn') }
  blank(); inside(seg('[ 打开负责人会话 ]', 'accent', `owner:${item.owner}`))
  inside(seg('[ 返回任务列表 ]', 'muted', 'back:tasks')); blank(); border('', true)
  footer('Enter 打开负责人  ·  Esc 返回')
}
function chat() {
  const current = members.find(member => member.id === state.current) ?? members[1]
  const cold = state.chatState === 'cold' && current.id !== 'lead'
  header(); border(`${current.id} / ${current.id === 'lead' ? 'Lead' : '队友会话'}`)
  inside(seg(cold ? '○ 未加载 · 浏览历史' : `● ${current.id === 'lead' ? '协调中' : '运行中'}`, cold ? 'muted' : 'green'))
  inside(seg('Lead: lead', 'muted'), '  ', seg('[ 团队总览 ]', 'accent', 'scene:team')); rule()
  inside(seg('你', 'muted')); paragraph(current.id === 'lead' ? '请用 Agent Team 分别审查权限与测试，完成后汇总。' : '检查登录与权限边界，给出最小修复建议。', 'bright'); blank()
  inside(seg(current.id, 'accent'))
  paragraph(current.id === 'lead' ? 'reviewer 负责权限审查，tester 负责回归测试。我会等待他们完成，再核对修改并汇总。' : '已发现刷新失败后仍沿用旧权限的路径。我正在核对调用链，并和 tester 确认复现步骤。', 'bright')
  blank(); inside(seg('  › read src/auth/session.ts', 'muted')); inside(seg('  › read tests/auth/session.spec.ts', 'muted'))
  blank()
  if (state.feedback) paragraph(state.feedback, state.chatState === 'failed' ? 'danger' : 'green')
  if (!state.reply) {
    if (cold) { paragraph('仅查看历史，不会启动这个队友。'); blank() }
    inside(seg(`[ ${cold ? '回复并恢复' : '回复'} ]`, 'accent', 'reply'))
  } else {
    rule(); inside(seg(cold ? `回复 ${current.id} · 发送后恢复` : `回复 ${current.id}`, 'bright'))
    rows.push({ input: 'message', placeholder: '输入给这位成员的消息…', value: state.draft })
    blank()
    if (!cold && current.id !== 'lead') {
      inside(seg(' 排队 ', state.delivery === 'queue' ? 'selected' : 'muted', 'delivery:queue'), '  ', seg(' 引导 ', state.delivery === 'steer' ? 'selected' : 'muted', 'delivery:steer'))
      paragraph(state.delivery === 'queue' ? '本轮完成后处理这条消息。' : '在下一个步骤边界处理这条消息。')
    }
    if (cold) paragraph('发送后恢复此成员，不会新建队友。')
    blank(); inside(seg(`[ ${cold ? '发送并恢复' : '发送'} ]`, 'accent', 'send'), '  ', seg('[ 取消 ]', 'muted', 'cancel-reply'))
  }
  blank(); border('', true); footer('i 回复  F7 切换 Lead  F8 关闭\n Esc 团队总览')
}
function renderPiece(item) {
  const el = document.createElement(item.action ? 'button' : 'span')
  el.className = `piece${item.tone ? ` tone-${item.tone}` : ''}${item.action ? ' clickable' : ''}`
  if (item.action) { el.dataset.action = item.action; el.setAttribute('aria-label', item.text.trim()); el.tabIndex = -1 }
  for (const char of item.text) {
    const glyph = document.createElement('span')
    glyph.className = 'glyph'; glyph.style.width = `calc(${charWidth(char)} * var(--cw))`; glyph.textContent = char
    el.append(glyph)
  }
  return el
}
function render() {
  const activeInput = document.activeElement?.dataset?.input
  const caret = activeInput ? document.activeElement.selectionStart : undefined
  rows = []
  ;({ market, preset: presets, team, task, chat })[state.scene]()
  const minimum = state.width === 40 ? 30 : 29
  while (rows.length < minimum) rows.push([])
  terminal.replaceChildren()
  for (const content of rows) {
    const el = document.createElement('div'); el.className = 'trow'
    if (content.input) {
      el.classList.add('input-row')
      el.append(renderPiece(seg('│ ', 'rule')))
      const input = document.createElement('input')
      input.dataset.input = content.input; input.value = content.value; input.placeholder = content.placeholder
      input.setAttribute('aria-label', content.input === 'search' ? '搜索成员、任务或负责人' : '给成员的消息')
      input.autocomplete = 'off'; input.spellcheck = false
      input.style.width = `calc(${state.width - 4} * var(--cw))`
      el.append(input, renderPiece(seg(' │', 'rule')))
    } else {
      el.dataset.cells = pieceWidth(fit(content, state.width))
      el.append(...fit(content, state.width).map(renderPiece))
    }
    terminal.append(el)
  }
  document.querySelector('#terminal-shell').style.setProperty('--cols', state.width)
  document.querySelector('#dimensions').textContent = `${state.width} × ${rows.length}`
  document.querySelector('#scene-title').textContent = labels[state.scene]
  document.querySelectorAll('[data-width]').forEach(button => { button.classList.toggle('active', Number(button.dataset.width) === state.width); button.setAttribute('aria-pressed', String(Number(button.dataset.width) === state.width)) })
  document.querySelectorAll('[data-scene]').forEach(button => { button.classList.toggle('active', button.dataset.scene === state.scene); button.setAttribute('aria-current', button.dataset.scene === state.scene ? 'step' : 'false') })
  const [title, copy, points, attempt] = notes[state.scene]
  document.querySelector('#note-title').textContent = title
  document.querySelector('#note-copy').textContent = copy
  document.querySelector('#note-points').replaceChildren(...points.map(text => { const li = document.createElement('li'); li.textContent = text; return li }))
  document.querySelector('#try-copy').textContent = attempt
  const selector = document.querySelector('#demo-state')
  selector.replaceChildren(...variants[state.scene].map(([value, label]) => { const option = new Option(label, value); option.selected = state.variant === value; return option }))
  if (activeInput) {
    const input = terminal.querySelector(`[data-input="${activeInput}"]`)
    if (input) { input.focus(); input.setSelectionRange(caret, caret) }
  }
  history.replaceState(null, '', `#${state.scene}`)
}
function navigate(scene) {
  state.scene = scene; state.variant = 'running'; state.query = ''; state.reply = false; state.feedback = ''
  if (scene === 'chat') { state.current = 'reviewer'; state.chatState = 'running' }
  if (scene === 'task') state.task = 1
  render()
}
function action(value) {
  const [verb, arg] = value.split(':')
  if (verb === 'scene') { navigate(arg); terminal.focus(); return }
  if (verb === 'install') { state.installed = true; state.variant = 'installed' }
  if (verb === 'restart') { state.restarted = true; navigate('preset'); return }
  if (verb === 'choose') { state.preset = arg; navigate('team'); state.variant = arg === 'team' ? 'empty' : 'off' }
  if (verb === 'focus') state.focus = arg
  if (verb === 'task') { state.task = Number(arg); state.scene = 'task'; state.variant = 'running' }
  if (verb === 'back') { state.scene = 'team'; state.variant = 'running'; state.focus = arg }
  if (verb === 'member' || verb === 'owner') {
    state.member = verb === 'member' ? Number(arg) : Math.max(0, members.findIndex(member => member.id === arg))
    state.current = members[state.member].id; state.scene = 'chat'
    state.chatState = state.current === 'researcher' ? 'cold' : 'running'; state.variant = state.chatState
    state.reply = false; state.feedback = ''
  }
  if (verb === 'lead') { state.scene = 'chat'; state.current = 'lead'; state.chatState = 'running'; state.reply = false; state.feedback = '' }
  if (verb === 'reply') state.reply = true
  if (verb === 'delivery') state.delivery = arg
  if (verb === 'cancel-reply') { state.reply = false; state.feedback = '' }
  if (verb === 'send') {
    if (!state.draft.trim()) state.feedback = '请输入消息。'
    else if (state.chatState === 'failed') state.feedback = '发送失败，草稿已保留。请稍后重试。'
    else {
      state.feedback = state.chatState === 'cold' ? `✓ 已恢复 ${state.current}，消息已发送。` : state.delivery === 'steer' ? '✓ 已提交引导，等待下一个步骤边界。' : '✓ 已排队，将在当前轮次结束后处理。'
      state.chatState = 'running'; state.variant = 'running'; state.reply = false; state.draft = ''
    }
  }
  render()
  if (verb === 'reply') terminal.querySelector('[data-input="message"]')?.focus()
  else if (verb !== 'delivery') terminal.focus()
}
document.addEventListener('click', event => {
  const actionButton = event.target.closest('[data-action]')
  if (actionButton) action(actionButton.dataset.action)
  const sceneButton = event.target.closest('[data-scene]')
  if (sceneButton) navigate(sceneButton.dataset.scene)
  const widthButton = event.target.closest('[data-width]')
  if (widthButton) { state.width = Number(widthButton.dataset.width); render() }
})
terminal.addEventListener('input', event => {
  if (event.target.dataset.input === 'search') { state.query = event.target.value; render() }
  if (event.target.dataset.input === 'message') state.draft = event.target.value
})
terminal.addEventListener('keydown', event => {
  const typing = event.target.tagName === 'INPUT'
  if (typing && event.key !== 'Escape' && event.key !== 'Enter') return
  if (event.key === 'Escape') {
    event.preventDefault()
    if (state.reply) action('cancel-reply')
    else if (state.scene === 'task') action('back:tasks')
    else if (state.scene === 'team') action('lead')
    else navigate('team')
  } else if (event.key === 'Enter') {
    event.preventDefault()
    if (state.scene === 'market') action(state.installed ? 'restart' : 'install')
    else if (state.scene === 'preset') action(state.variant === 'off' ? 'scene:market' : 'choose:team')
    else if (state.scene === 'team' && !['empty', 'off', 'loading'].includes(state.variant)) {
      const list = state.focus === 'members' ? filteredMembers() : filteredTasks()
      const selected = list.find(item => item.index === (state.focus === 'members' ? state.member : state.task)) ?? list[0]
      if (selected && !(state.focus === 'members' && state.variant === 'failure' && selected.id === 'researcher')) action(`${state.focus === 'members' ? 'member' : 'task'}:${selected.index}`)
    } else if (state.scene === 'task') action(`owner:${tasks[state.task].owner}`)
    else if (state.scene === 'chat') action(state.reply ? 'send' : 'reply')
  } else if (state.scene === 'team' && ['ArrowDown', 'ArrowUp', 'Tab', '/'].includes(event.key)) {
    event.preventDefault()
    if (event.key === '/') { terminal.querySelector('[data-input="search"]')?.focus(); return }
    if (event.key === 'Tab') state.focus = state.focus === 'members' ? 'tasks' : 'members'
    else {
      const key = state.focus === 'members' ? 'member' : 'task'
      const list = state.focus === 'members' ? filteredMembers() : filteredTasks()
      const position = Math.max(0, list.findIndex(item => item.index === state[key]))
      if (list.length) state[key] = list[(position + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].index
    }
    render(); terminal.focus()
  } else if (state.scene === 'chat' && ['i', 'F7', 'F8'].includes(event.key)) {
    event.preventDefault()
    if (event.key === 'i') action('reply')
    else if (event.key === 'F8') action('lead')
    else { state.current = state.current === 'lead' ? members[state.member || 1].id : 'lead'; state.reply = false; render() }
  }
})
document.querySelector('#demo-state').addEventListener('change', event => {
  state.variant = event.target.value; state.feedback = ''; state.query = ''
  if (state.scene === 'market') state.installed = state.variant === 'installed'
  if (state.scene === 'task') state.task = state.variant === 'blocked' ? 3 : state.variant === 'done' ? 0 : 1
  if (state.scene === 'chat') {
    state.chatState = state.variant; state.current = state.variant === 'cold' ? 'researcher' : 'reviewer'
    state.member = state.variant === 'cold' ? 3 : 1
    state.reply = state.variant === 'failed'; state.draft = state.variant === 'failed' ? '先暂停修改，确认测试覆盖后再继续。' : ''
    state.feedback = state.variant === 'failed' ? '发送失败，草稿已保留。' : ''
  }
  render()
})
document.querySelector('#reset').addEventListener('click', () => {
  Object.assign(state, { installed: false, restarted: false, preset: 'standard', member: 1, task: 1, focus: 'members', current: 'lead', draft: '', delivery: 'queue', chatState: 'running' })
  navigate('team')
})
if (state.scene === 'chat') state.current = 'reviewer'
render()
