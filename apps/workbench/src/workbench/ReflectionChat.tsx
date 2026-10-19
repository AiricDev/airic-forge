import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import StopIcon from "@mui/icons-material/Stop";
import type {
  ReflectionDetail,
  ReflectionLens,
  TrajectoryEvent,
} from "./types";
import { useResource } from "./hooks";
import { useDirty } from "./UnsavedChanges";
import { useReflectionRun } from "./reflection-stream";
import { ResourceState } from "./ui";

const Sources = createContext<{
  events: TrajectoryEvent[];
  href: (id: string) => string;
  select: (id: string) => void;
}>({ events: [], href: () => "", select: () => {} });
const markdown = {
  img: () => null,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) =>
    href && /^(https?:\/\/|\/(?!\/)|#)/i.test(href) ? (
      <Link href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </Link>
    ) : (
      <span>{children}</span>
    ),
};
const Markdown = () => (
  <MarkdownTextPrimitive skipHtml smooth={false} components={markdown} />
);

function CitationLinks({ ids }: { ids: string[] }) {
  const source = useContext(Sources);
  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, mt: 1 }}>
      {[...new Set(ids)].map((id) =>
        source.events.some((event) => event.id === id) ? (
          <Link
            key={id}
            href={source.href(id)}
            onClick={(event) => {
              if (!event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                source.select(id);
              }
            }}
          >
            来源 {id}
          </Link>
        ) : (
          <Chip key={id} size="small" label="来源暂不可定位" />
        ),
      )}
    </Stack>
  );
}

function ChatMessage({ user }: { user: boolean }) {
  const metadata = useAuiState((state) => state.message.metadata.custom);
  const citations = Array.isArray(metadata.citations)
    ? metadata.citations.filter((id): id is string => typeof id === "string")
    : [];
  return (
    <MessagePrimitive.Root asChild>
      <Paper
        component="article"
        variant="outlined"
        aria-label={user ? "你发送的消息" : "Reflection Agent 的消息"}
        sx={{
          p: 2,
          my: 2,
          ml: user ? "auto" : 0,
          maxWidth: user ? "90%" : "100%",
          bgcolor: user ? "action.selected" : "background.paper",
          overflowWrap: "anywhere",
          "& p": { my: 1 },
          "& table": { display: "block", overflowX: "auto" },
          ...(metadata.incomplete ? { borderColor: "warning.main" } : {}),
        }}
      >
        <Typography
          variant="caption"
          color={user ? "primary" : "text.secondary"}
        >
          {user ? "你" : "Reflection Agent"} · {String(metadata.at ?? "")}
        </Typography>
        <MessagePrimitive.Parts components={{ Text: Markdown }} />
        {metadata.incomplete === true && (
          <Chip size="small" color="warning" label="未完成的回复" />
        )}
        {metadata.lens ? (
          <Typography variant="caption">{String(metadata.lens)}</Typography>
        ) : null}
        <CitationLinks ids={citations} />
      </Paper>
    </MessagePrimitive.Root>
  );
}
const UserMessage = () => <ChatMessage user />;
const AgentMessage = () => <ChatMessage user={false} />;

const toolName: Record<string, string> = {
  read_work_trajectory: "读取 Work 轨迹",
  read_candidate_file: "读取候选文件",
  write_candidate_file: "更新 Proposal 候选",
};

export function ReflectionChat({
  detail,
  events,
  canWrite,
  href,
  select,
  onChanged,
  onRunningChange,
}: {
  detail: ReflectionDetail;
  events: TrajectoryEvent[];
  canWrite: boolean;
  href: (id: string) => string;
  select: (id: string) => void;
  onChanged: () => void;
  onRunningChange: (running: boolean) => void;
}) {
  const state = useReflectionRun(detail.reflection.id, onChanged);
  const [input, setInput] = useState("");
  const pending = useRef(state.pending);
  const lenses = useResource<{ lenses: ReflectionLens[] }>(
    "/api/v1/reflection-lenses",
  );
  const closed = ["completed", "abandoned"].includes(detail.reflection.status);
  useDirty(Boolean(input.trim()), () => setInput(""));
  useEffect(() => {
    onRunningChange(state.active || state.busy || state.loading);
  }, [state.active, state.busy, state.loading, onRunningChange]);
  useEffect(() => {
    if (
      pending.current &&
      !state.pending &&
      state.run?.requestId === pending.current.requestId
    ) {
      const message = pending.current.message;
      setInput((current) => (current.trim() === message ? "" : current));
    }
    pending.current = state.pending;
  }, [state.pending, state.run?.requestId]);
  const chat = useMemo((): ThreadMessageLike[] => {
    const messages = [...detail.messages];
    const run = state.run;
    if (run && !messages.some((m) => m.id === run.userMessage.id))
      messages.push(run.userMessage);
    const result: ThreadMessageLike[] = messages.map((message) => ({
      id: message.id,
      role: message.role === "user" ? "user" : "assistant",
      content: [{ type: "text", text: message.content }],
      createdAt: new Date(message.at),
      metadata: {
        custom: {
          at: new Date(message.at).toLocaleString(),
          citations: message.citedEventIds ?? [],
          lens: message.lensId
            ? `${message.lensId} · v${message.lensVersion}`
            : "",
        },
      },
    }));
    if (
      run?.text &&
      (!run.agentMessageId ||
        !messages.some((m) => m.id === run.agentMessageId))
    )
      result.push({
        id: `${run.id}-answer`,
        role: "assistant",
        content: [{ type: "text", text: run.text }],
        status: state.active
          ? { type: "running" }
          : { type: "complete", reason: "stop" },
        metadata: {
          custom: {
            at: new Date(run.updatedAt).toLocaleString(),
            incomplete: !state.active && run.status !== "completed",
          },
        },
      });
    return result;
  }, [detail.messages, state.run, state.active]);
  const send = async (text: string) => {
    if (canWrite && !closed && (await state.send(text))) setInput("");
  };
  const runtime = useExternalStoreRuntime({
    messages: chat,
    convertMessage: (message: ThreadMessageLike) => message,
    isRunning: state.active,
    isDisabled: !canWrite || closed,
    onNew: async (message) =>
      send(
        message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(""),
      ),
  });
  const run = state.run;
  return (
    <Sources.Provider value={{ events, href, select }}>
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root asChild>
          <Stack spacing={2}>
            {!canWrite && (
              <Alert severity="info">
                当前为只读查看。请由这个 Work 的原作者发起
                Reflection、发送消息及采纳个人提议。
              </Alert>
            )}
            <ThreadPrimitive.Viewport asChild autoScroll>
              <Box
                role="log"
                aria-label="Reflection 对话"
                sx={{
                  maxHeight: "58vh",
                  minHeight: 220,
                  overflowY: "auto",
                  px: 0.5,
                }}
              >
                <ThreadPrimitive.Messages
                  components={{ UserMessage, AssistantMessage: AgentMessage }}
                />
                {!detail.messages.some((m) => m.citedEventIds?.length) && (
                  <CitationLinks ids={detail.reflection.evidenceEventIds} />
                )}
                {(state.active || state.loading || state.busy) && (
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center" }}
                    role="status"
                  >
                    <CircularProgress size={16} />
                    <Typography variant="body2">
                      {state.loading
                        ? "核对运行状态…"
                        : state.busy && !state.active
                          ? "正在提交请求…"
                          : run?.status === "cancelling"
                            ? "正在停止，等待进行中的操作结束…"
                            : "Reflection Agent 正在工作…"}
                    </Typography>
                  </Stack>
                )}
                {run?.tools.length ? (
                  <Stack
                    direction="row"
                    sx={{ flexWrap: "wrap", gap: 1, my: 1 }}
                  >
                    {run.tools.map((tool) => (
                      <Chip
                        key={tool.id}
                        size="small"
                        label={`${toolName[tool.name] ?? tool.name} · ${tool.status === "running" ? "进行中" : tool.status === "completed" ? "完成" : "失败"}`}
                      />
                    ))}
                  </Stack>
                ) : null}
                {state.active && (
                  <Typography variant="caption" color="text.secondary">
                    {state.connection}
                  </Typography>
                )}
                {run &&
                  !state.active &&
                  ["cancelled", "interrupted", "failed"].includes(
                    run.status,
                  ) && (
                    <Alert severity="warning">
                      {run.status === "cancelled"
                        ? "运行已停止；已保存的候选改动仍可查看。"
                        : run.status === "interrupted"
                          ? "服务中断了这次运行；不会自动重发。"
                          : `运行失败：${run.error ?? "请核对状态后继续"}`}
                    </Alert>
                  )}
                {state.error && (
                  <Alert severity="warning" sx={{ my: 1 }}>
                    {state.error}
                  </Alert>
                )}
                {state.pending && !state.busy && !state.error && (
                  <Alert severity="info">
                    上一条请求仍待核对。可以重新连接，或使用相同的原请求重试。
                  </Alert>
                )}
              </Box>
            </ThreadPrimitive.Viewport>
            <Stack direction="row" spacing={1}>
              <ThreadPrimitive.ScrollToBottom asChild>
                <Button size="small">跳到最新消息</Button>
              </ThreadPrimitive.ScrollToBottom>
              <Button
                size="small"
                onClick={() => void state.reconcile()}
                disabled={state.loading || state.busy}
              >
                重新连接 / 核对状态
              </Button>
              {canWrite && state.active && (
                <Button
                  color="warning"
                  startIcon={<StopIcon />}
                  disabled={state.busy || run?.status === "cancelling"}
                  onClick={() => void state.cancel()}
                >
                  停止生成
                </Button>
              )}
            </Stack>
            {canWrite && !closed && (
              <>
                <ResourceState {...lenses} retry={lenses.reload} />
                <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
                  {lenses.data?.lenses
                    .filter((lens) => lens.enabled)
                    .map((lens) => (
                      <Button
                        key={lens.id}
                        size="small"
                        disabled={
                          state.active || state.busy || Boolean(state.pending)
                        }
                        onClick={() =>
                          setInput(
                            (text) =>
                              `/${lens.id} ${text.replace(/^\/(?:lens\s+)?[\w-]+\s*/, "")}`,
                          )
                        }
                      >
                        /{lens.id}
                      </Button>
                    ))}
                </Stack>
                <Box
                  component="form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void send(input);
                  }}
                >
                  <TextField
                    label="继续 Reflection"
                    multiline
                    minRows={2}
                    fullWidth
                    value={input}
                    disabled={
                      state.active || state.busy || Boolean(state.pending)
                    }
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        if (input.trim()) void send(input);
                      }
                    }}
                  />
                  <Stack
                    direction="row"
                    sx={{ justifyContent: "flex-end", mt: 1 }}
                  >
                    <Button
                      type="submit"
                      variant="contained"
                      startIcon={<SendIcon />}
                      disabled={
                        state.active ||
                        state.busy ||
                        state.loading ||
                        !input.trim()
                      }
                    >
                      {state.busy
                        ? "处理中…"
                        : state.pending
                          ? "重试原请求"
                          : "发送消息"}
                    </Button>
                  </Stack>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  Enter 发送 · Shift+Enter 换行。离开页面不会停止运行；Proposal
                  需要作者审阅和确认采纳。
                </Typography>
              </>
            )}
          </Stack>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </Sources.Provider>
  );
}
