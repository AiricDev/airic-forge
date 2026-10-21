import { useEffect, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Link,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import type { Navigation } from "../navigation";
import { workUrl } from "../navigation";
import type {
  User,
  WorkHistory,
  WorkFeedback,
  WorkFeedbackKind,
  Reflection,
  ReflectionDetail,
} from "../types";
import { api, command } from "../api";
import { useResource, useCommand } from "../hooks";
import { PageHeading, ResourceState, Feedback, CodeBlock } from "../ui";
import { WorkConversation } from "../Conversation";
import { ReflectionChat } from "../ReflectionChat";
import { OmDraftReview } from "../OmDraftReview";
import { useDirty } from "../UnsavedChanges";
import { feedbackLabel } from "../labels";
export function WorkDetailPage({
  user,
  navigation: n,
}: {
  user: User;
  navigation: Navigation;
}) {
  const r = n.route;
  const history = useResource<WorkHistory>(
    `/api/v1/works/${encodeURIComponent(r.workId)}`,
  );
  const feedback = useResource<{
    feedback: WorkFeedback[];
  }>(`/api/v1/works/${encodeURIComponent(r.workId)}/feedback`);
  const reflections = useResource<{
    reflections: Reflection[];
  }>(`/api/v1/works/${encodeURIComponent(r.workId)}/reflections`);
  const [detail, setDetail] = useState<ReflectionDetail | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const [retry, setRetry] = useState(0);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<WorkFeedbackKind>("avoidable-correction");
  const [reflectionRunning, setReflectionRunning] = useState(false);
  const evaluation = useCommand();
  const owner = history.data?.work.ownerUserId === user.id;
  useDirty(Boolean(note.trim()), () => {
    setNote("");
  });
  useEffect(() => {
    if (r.tab !== "reflection" || !history.data || !reflections.data || detail)
      return;
    const first = reflections.data.reflections.at(-1);
    if (!first && !owner) return;
    let current = true;
    setOpening(true);
    setOpenError("");
    const request = first
      ? api<ReflectionDetail>(
          `/api/v1/reflections/${encodeURIComponent(first.id)}`,
        )
      : command<ReflectionDetail>(
          `/api/v1/works/${encodeURIComponent(r.workId)}/reflection/open`,
        );
    void request
      .then((value) => {
        if (current) setDetail(value);
      })
      .catch((cause) => {
        if (current)
          setOpenError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (current) setOpening(false);
      });
    return () => {
      current = false;
    };
  }, [r.tab, r.workId, history.data, reflections.data, owner, detail, retry]);
  const tab = (value: "conversation" | "reflection", event = "") =>
    n.navigate("work-detail", { ...r, tab: value, event });
  const refreshReflection = () => {
    if (detail)
      void api<ReflectionDetail>(
        `/api/v1/reflections/${encodeURIComponent(detail.reflection.id)}`,
      )
        .then(setDetail)
        .catch((cause) => setOpenError(String(cause)));
  };
  return (
    <Stack spacing={3}>
      <PageHeading title="Work 详情">
        <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
          <Button
            onClick={() => {
              history.reload();
              reflections.reload();
              refreshReflection();
            }}
          >
            刷新
          </Button>
          {r.tab === "conversation" && (
            <Button variant="contained" onClick={() => tab("reflection")}>
              打开 Reflection
            </Button>
          )}
          <Button onClick={() => n.list()}>返回 Work 列表</Button>
        </Stack>
      </PageHeading>
      <ResourceState {...history} retry={history.reload} />
      {history.data && (
        <>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6">
              {history.data.work.entityTitle || history.data.work.entityId}
            </Typography>
            <Typography
              color="text.secondary"
              sx={{ overflowWrap: "anywhere" }}
            >
              {history.data.work.id} · {history.data.work.status}
            </Typography>
            <Tabs
              value={r.tab}
              onChange={(_, value: "conversation" | "reflection") => tab(value)}
              aria-label="Work 内容"
            >
              <Tab
                value="conversation"
                id="work-tab-conversation"
                aria-controls="work-panel-conversation"
                label={`对话轨迹 ${history.data.turns.length}`}
              />
              <Tab
                value="reflection"
                id="work-tab-reflection"
                aria-controls="work-panel-reflection"
                label="Reflection"
              />
            </Tabs>
          </Paper>
          {r.tab === "conversation" ? (
            <Paper
              role="tabpanel"
              id="work-panel-conversation"
              aria-labelledby="work-tab-conversation"
              sx={{ p: { xs: 2, md: 3 }, minWidth: 0 }}
            >
              {r.event && (
                <Button onClick={() => tab("reflection")}>
                  返回 Reflection 对话
                </Button>
              )}
              <WorkConversation
                turns={history.data.turns}
                events={history.data.events}
                focusedEventId={r.event}
              />
            </Paper>
          ) : (
            <Stack
              role="tabpanel"
              id="work-panel-reflection"
              aria-labelledby="work-tab-reflection"
              spacing={3}
            >
              <ResourceState {...reflections} retry={reflections.reload} />
              <ResourceState
                loading={opening}
                error={openError}
                retry={() => setRetry((v) => v + 1)}
              />
              {!owner &&
                reflections.data &&
                !reflections.data.reflections.length && (
                  <Alert severity="info">
                    这个 Work 尚未开始 Reflection，需要由 Work 原作者发起。
                  </Alert>
                )}
              {detail && (
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: {
                      xs: "minmax(0,1fr)",
                      lg: "minmax(0,1fr) minmax(0,1fr)",
                    },
                    gap: 3,
                  }}
                >
                  <Paper sx={{ p: 2, minWidth: 0 }}>
                    <Stack spacing={2}>
                      <Typography variant="h6">
                        这个 Work 的 Reflection
                      </Typography>
                      <Typography>
                        每个 Work 有一个持续对话；OM 草稿
                        是该对话形成的工作成果。
                      </Typography>
                      <Chip
                        label={
                          detail.reflection.status === "completed"
                            ? "已完成"
                            : detail.reflection.status === "abandoned"
                              ? "已放弃"
                              : "进行中"
                        }
                        sx={{ alignSelf: "flex-start" }}
                      />
                      <Typography
                        variant="caption"
                        sx={{ overflowWrap: "anywhere" }}
                      >
                        {detail.reflection.id} · OM{" "}
                        {detail.reflection.omRevision}
                      </Typography>
                      <ReflectionChat
                        detail={detail}
                        events={history.data.events}
                        canWrite={owner && user.status === "active"}
                        canCancel={owner}
                        href={(id) =>
                          workUrl({ ...r, tab: "conversation", event: id })
                        }
                        select={(id) => tab("conversation", id)}
                        onChanged={refreshReflection}
                        onRunningChange={setReflectionRunning}
                      />
                    </Stack>
                  </Paper>
                  <Paper sx={{ p: 2, minWidth: 0 }}>
                    <Stack spacing={2}>
                      <OmDraftReview
                        scope={`reflection:${detail.reflection.id}`}
                        initialDraft={detail.draft}
                        canWrite={owner && user.status === "active"}
                        busy={reflectionRunning}
                        refreshKey={detail}
                        onChanged={refreshReflection}
                      />
                      {detail.reflection.suggestionMarkdown && (
                        <>
                          <Typography variant="h6">API Suggestion</Typography>
                          <CodeBlock>
                            {detail.reflection.suggestionMarkdown}
                          </CodeBlock>
                          <Link
                            href={`/api/v1/reflections/${encodeURIComponent(detail.reflection.id)}/suggestion.md`}
                            download
                          >
                            导出 Markdown
                          </Link>
                        </>
                      )}
                    </Stack>
                  </Paper>
                </Box>
              )}
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  工作结果评价 · {feedback.data?.feedback.length ?? 0} 条
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={2}>
                    <Typography>
                      这是 Work
                      所有者手动记录的结构化结果，用于成效基线。Reflection Agent
                      不会自动代填评价。
                    </Typography>
                    <ResourceState {...feedback} retry={feedback.reload} />
                    {feedback.data?.feedback.map((item) => (
                      <Paper key={item.id} variant="outlined" sx={{ p: 2 }}>
                        <Typography>
                          {feedbackLabel[item.kind]} · {item.note}
                        </Typography>
                        <Typography variant="caption">{item.at}</Typography>
                      </Paper>
                    ))}
                    {owner && user.status === "active" && (
                      <>
                        <Feedback {...evaluation} />
                        <TextField
                          select
                          label="评价类别"
                          value={kind}
                          onChange={(e) =>
                            setKind(e.target.value as WorkFeedbackKind)
                          }
                        >
                          {Object.entries(feedbackLabel).map(
                            ([value, label]) => (
                              <MenuItem key={value} value={value}>
                                {label}
                              </MenuItem>
                            ),
                          )}
                        </TextField>
                        <TextField
                          label="评价依据"
                          multiline
                          minRows={2}
                          value={note}
                          disabled={evaluation.busy}
                          onChange={(e) => setNote(e.target.value)}
                        />
                        <Button
                          disabled={evaluation.busy || !note.trim()}
                          onClick={() =>
                            void evaluation.run(async () => {
                              await command(
                                `/api/v1/works/${encodeURIComponent(r.workId)}/feedback`,
                                "POST",
                                { kind, note },
                              );
                              setNote("");
                              feedback.reload();
                            }, "结果评价已记录。")
                          }
                        >
                          记录结果评价
                        </Button>
                      </>
                    )}
                  </Stack>
                </AccordionDetails>
              </Accordion>
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}
