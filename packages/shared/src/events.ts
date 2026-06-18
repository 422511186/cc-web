// ── 待答事项:Claude 抛出、需要用户在网页上回答的三类交互 ──

/** 答题(AskUserQuestion):一个或多个问题,每题若干选项,可单选或多选 */
export interface QuestionPrompt {
  kind: "question";
  /** 待答事项 id,前端提交答案时回传 */
  id: string;
  questions: {
    header: string;
    question: string;
    multiSelect: boolean;
    options: { label: string; description: string }[];
  }[];
}

/** 权限确认(canUseTool):Claude 要执行某工具,需用户允许/拒绝 */
export interface PermissionPrompt {
  kind: "permission";
  id: string;
  toolName: string;
  /** 人类可读标题,如 "Claude wants to run npm test";来自 SDK title 或回退拼装 */
  title: string;
  /** 工具入参的可读摘要(如 Bash 命令、要改的文件路径) */
  detail: string;
  /** 可选:Edit/Write 工具的 unified diff 预览 */
  diff?: string;
}

/** 计划审批(ExitPlanMode):Claude 提交一份计划,需用户批准/拒绝 */
export interface PlanPrompt {
  kind: "plan";
  id: string;
  /** 计划正文(Markdown) */
  plan: string;
}

/** 任意一类待答事项 */
export type PendingPrompt = QuestionPrompt | PermissionPrompt | PlanPrompt;

// ── 用户对待答事项的回答 ──

/** 答题回答:与 questions 等长,每项是选中的 option label 数组(单选则长度 1) */
export interface QuestionAnswer {
  kind: "question";
  id: string;
  answers: string[][];
}

/** 权限回答 */
export interface PermissionAnswer {
  kind: "permission";
  id: string;
  decision: "allow" | "deny";
}

/** 计划回答 */
export interface PlanAnswer {
  kind: "plan";
  id: string;
  decision: "approve" | "reject";
}

export type PromptAnswer = QuestionAnswer | PermissionAnswer | PlanAnswer;

// ── SSE 事件:服务端 → 前端 ──

/** 用户消息回显:用户发的提问由服务端回显进事件流,
 *  使重连(整段重放)后仍能看到自己发出的消息,也让多端/多订阅者一致。 */
export interface UserMessageEvent {
  type: "user_message";
  text: string;
}

/** 助手逐字增量(流式) */
export interface DeltaEvent {
  type: "delta";
  /** 追加的文本片段 */
  text: string;
}

/** 一个完整的内容块到达(text / thinking / tool_use)——用于落定与折叠区块渲染 */
export interface BlockEvent {
  type: "block";
  block:
    | { kind: "text"; text: string }
    | { kind: "thinking"; text: string }
    | { kind: "tool_use"; name: string; input: unknown; toolUseId: string };
}

/** 工具结果到达 */
export interface ToolResultEvent {
  type: "tool_result";
  toolUseId: string;
  text: string;
  isError: boolean;
}

/** 出现一个待答事项 */
export interface PromptEvent {
  type: "prompt";
  prompt: PendingPrompt;
}

/** 一轮对话结束(可继续输入) */
export interface TurnEndEvent {
  type: "turn_end";
  isError: boolean;
}

/** 会话级错误(子进程崩溃 / SDK 错误) */
export interface ErrorEvent {
  type: "error";
  message: string;
}

/** 会话被回收/关闭 */
export interface ClosedEvent {
  type: "closed";
  reason: "idle" | "aborted" | "exited" | "detached";
}

/** 执行状态:供前端明确展示「执行中 / 空闲可发下一条 / 等待你回答待答项」。
 *  重连整段重放后,最后一个 status 即当前真实状态。 */
export interface StatusEvent {
  type: "status";
  /** executing=有一轮在跑;waiting=出现待答项等用户回答;idle=空闲可发下一条 */
  state: "idle" | "executing" | "waiting";
}

/** 当前活跃 run 的模型与推理强度信息。
 *  注意:推理强度(effort)在 SDK 输出流与历史 JSONL 中均不可得(它只是输入项),
 *  故 effort 通常缺失,前端据此展示「不可用」。 */
export interface RunInfoEvent {
  type: "run_info";
  /** 模型标识,如 'claude-opus-4-8',来自首条 assistant SDK 消息的 message.model */
  model?: string;
  /** 推理强度('low'|'medium'|'high'|'xhigh'|'max');SDK 输出流不携带,通常缺失 */
  effort?: string;
}

export type ServerEvent =
  | UserMessageEvent
  | DeltaEvent
  | BlockEvent
  | ToolResultEvent
  | PromptEvent
  | TurnEndEvent
  | ErrorEvent
  | ClosedEvent
  | StatusEvent
  | RunInfoEvent;

// ── REST 请求/响应(续聊相关) ──

/** POST /api/sessions/:id/continue 或 /api/sessions/new 的响应 */
export interface StartSessionResponse {
  /** 活跃会话的运行时 id(新建时由服务端生成;续聊时等于原 session id) */
  runId: string;
}

/** POST /api/sessions/:runId/message 请求体 */
export interface SendMessageRequest {
  text: string;
  /** 已上传附件的引用(服务端返回的相对路径),可空 */
  attachments?: string[];
}

/** POST /api/uploads 的响应 */
export interface UploadResponse {
  /** 服务端保存的文件引用,放进 SendMessageRequest.attachments */
  ref: string;
  filename: string;
}
