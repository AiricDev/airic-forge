import { useEffect, useRef, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Avatar,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import PersonIcon from "@mui/icons-material/Person";
import type { TrajectoryEvent, Turn } from "./types";
import { CodeBlock } from "./ui";
import { presentationEvents } from "./trajectory";
export function EventDetail({ event }: { event: TrajectoryEvent }) {
  const p = event.payload;
  const docs = Array.isArray(p.documents)
    ? (p.documents as Record<string, unknown>[])
    : [];
  const activity =
    p.activity && typeof p.activity === "object"
      ? (p.activity as Record<string, unknown>)
      : null;
  const statuses: Record<string, string> = {
    running: "进行中",
    completed: "完成",
    failed: "失败",
    cancelled: "已停止",
    unknown: "结果未知",
  };
  const heading =
    event.type === "context.assembled"
      ? `装配上下文 · ${docs.length} 份文档`
      : event.type === "context.document-loaded"
        ? "按需加载文档"
        : event.type === "action"
          ? `${String(p.capabilityId ?? "业务命令")} · ${String(p.status ?? "")}`
          : event.type === "error"
            ? `执行错误 · ${String(p.code ?? "")}`
            : event.type === "message" && p.evidence
              ? `附件 · ${String((p.evidence as Record<string, unknown>).filename ?? "")}`
              : activity
                ? `${String(activity.label ?? "工作进度")} · ${statuses[String(activity.status)] ?? String(activity.status ?? "")}`
                : p.contextStatus
                  ? `上下文状态 · ${{ organizing: "整理中", ready: "已就绪", failed: "失败" }[String(p.contextStatus)] ?? String(p.contextStatus)}`
                  : String(p.kind ?? event.type);
  return (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack>
          <Typography color={event.type === "error" ? "error" : "text.primary"}>
            {heading}
          </Typography>
          <Typography variant="caption">{event.at}</Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          {docs.map((d, i) => (
            <Typography key={i} sx={{ overflowWrap: "anywhere" }}>
              {String(d.id)} · {String(d.path)} · {String(d.reason)}
            </Typography>
          ))}
          <Typography variant="subtitle2">原始轨迹记录</Typography>
          <CodeBlock>{JSON.stringify(p, null, 2)}</CodeBlock>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
function Message({
  user,
  at,
  children,
}: {
  user: boolean;
  at: string;
  children: React.ReactNode;
}) {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{
        alignItems: "flex-start",
      }}
    >
      <Avatar>{user ? <PersonIcon /> : <SmartToyIcon />}</Avatar>
      <Paper variant="outlined" sx={{ p: 2, minWidth: 0, flex: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {user ? "用户" : "Airic"} · {at}
        </Typography>
        {children}
      </Paper>
    </Stack>
  );
}
export function WorkConversation({
  turns,
  events,
  focusedEventId,
}: {
  turns: Turn[];
  events: TrajectoryEvent[];
  focusedEventId?: string;
}) {
  const [visible, setVisible] = useState(10);
  const latest = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const event = events.find((e) => e.id === focusedEventId);
    const index = turns.findIndex((t) => t.id === event?.turnId);
    if (focusedEventId && index >= 0)
      setVisible((v) => Math.max(v, turns.length - index));
  }, [focusedEventId, events, turns]);
  useEffect(() => {
    if (!focusedEventId) return;
    const frame = requestAnimationFrame(() =>
      document
        .getElementById(`trajectory-event-${focusedEventId}`)
        ?.scrollIntoView({ block: "center" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [focusedEventId, visible]);
  const renderEvents = (items: TrajectoryEvent[]) => {
    const settled = new Set(
      items
        .filter((e) => e.type === "action" && e.payload.status !== "pending")
        .map((e) => e.payload.commandId),
    );
    return presentationEvents(items, focusedEventId)
      .filter(
        (e) =>
          e.id === focusedEventId ||
          !(
            e.type === "action" &&
            e.payload.status === "pending" &&
            settled.has(e.payload.commandId)
          ),
      )
      .map((event) => {
        const user =
          event.type === "turn.started" ||
          (event.type === "message" && event.payload.author === "user");
        const agent =
          event.type === "turn.completed" ||
          (event.type === "message" &&
            (event.payload.author === "agent" ||
              event.payload.partial === true));
        return (
          <Box
            key={event.id}
            id={`trajectory-event-${event.id}`}
            sx={{
              scrollMarginTop: 96,
              ...(event.id === focusedEventId
                ? {
                    outline: "2px solid",
                    outlineColor: "warning.main",
                    borderRadius: 1,
                  }
                : {}),
            }}
          >
            {user || agent ? (
              <Message user={user} at={event.at}>
                <Typography
                  sx={{
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    mt: 1,
                  }}
                >
                  {String(
                    user
                      ? (event.payload.userMessage ??
                          event.payload.text ??
                          "（无文字）")
                      : (event.payload.text ??
                          event.payload.agentTextDelta ??
                          "（无文字）"),
                  )}
                </Typography>
                {event.payload.partial === true && (
                  <Chip size="small" color="warning" label="未完成的回复" />
                )}
              </Message>
            ) : (
              <EventDetail event={event} />
            )}
          </Box>
        );
      });
  };
  return (
    <Stack spacing={3}>
      <Stack
        direction="row"
        sx={{
          justifyContent: "space-between",
          gap: 2,
        }}
      >
        <Typography variant="h6">对话轨迹</Typography>
        <Button
          onClick={() => latest.current?.scrollIntoView({ block: "end" })}
        >
          跳到最新 Turn
        </Button>
      </Stack>
      {turns.length > visible && (
        <Button onClick={() => setVisible((v) => v + 10)}>
          加载更早的 Turn
        </Button>
      )}
      {renderEvents(
        events.filter(
          (e) => !e.turnId || !turns.some((t) => t.id === e.turnId),
        ),
      )}
      {turns.slice(-visible).map((turn) => (
        <Stack key={turn.id} spacing={2}>
          <Typography variant="subtitle2" sx={{ overflowWrap: "anywhere" }}>
            Turn {turn.sequence} · {turn.status} · OM {turn.omRevision} · MCP
            工具快照 {turn.catalogDigest} · 上下文 {turn.contextDigest}
          </Typography>
          {renderEvents(events.filter((e) => e.turnId === turn.id))}
        </Stack>
      ))}
      {!turns.length && !events.length && (
        <Typography color="text.secondary">尚无对话轨迹</Typography>
      )}
      <div ref={latest} />
    </Stack>
  );
}
