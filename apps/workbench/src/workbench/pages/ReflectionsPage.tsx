import { useEffect, useState } from "react";
import {
  Box,
  Button,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
} from "@mui/material";
import type { Navigation } from "../navigation";
import type { Reflection, ReflectionDetail, User } from "../types";
import { useCommand, useResource } from "../hooks";
import { command } from "../api";
import { Feedback, PageHeading, ResourceState } from "../ui";
import { ReflectionChat } from "../ReflectionChat";
import { OmDraftReview } from "../OmDraftReview";
export function ReflectionsPage({
  navigation: n,
}: {
  navigation: Navigation;
  user: User;
}) {
  const list = useResource<{ reflections: Reflection[] }>(
    "/api/v1/reflections",
  );
  const id = n.route.reflectionId ?? "";
  const detail = useResource<ReflectionDetail>(
    id ? `/api/v1/reflections/${id}` : null,
  );
  const [loaded, setLoaded] = useState<ReflectionDetail>();
  useEffect(() => {
    if (detail.data) setLoaded(detail.data);
  }, [detail.data]);
  const selected =
    detail.data ?? (loaded?.reflection.id === id ? loaded : undefined);
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const c = useCommand();
  const open = (reflectionId: string) =>
    n.navigate("reflections", { ...n.route, reflectionId });
  return (
    <Stack spacing={3}>
      <PageHeading
        title="改进工作方式"
        description="独立讨论个人 OM，也可以继续从 Work 发起的反思。草稿只有确认提交后才会生效。"
      />
      <Feedback {...c} />
      <TextField
        label="新讨论主题"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
      />
      <Button
        disabled={c.busy || !question.trim()}
        onClick={() =>
          void c.run(async () => {
            const value = await command<ReflectionDetail>(
              "/api/v1/reflections",
              "POST",
              { question },
            );
            setQuestion("");
            list.reload();
            open(value.reflection.id);
          })
        }
      >
        开始讨论
      </Button>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "260px minmax(0,1fr)" },
          gap: 2,
        }}
      >
        <Paper sx={{ p: 2 }}>
          <ResourceState {...list} retry={list.reload} />
          <List>
            {list.data?.reflections.map((reflection) => (
              <ListItemButton
                key={reflection.id}
                selected={id === reflection.id}
                onClick={() => open(reflection.id)}
              >
                <ListItemText
                  primary={
                    reflection.question ||
                    (reflection.workId ? "Work Reflection" : "OM 讨论")
                  }
                  secondary={reflection.id}
                />
              </ListItemButton>
            ))}
          </List>
        </Paper>
        <Paper sx={{ p: 2 }}>
          <ResourceState {...detail} retry={detail.reload} />
          {selected && (
            <Stack spacing={3}>
              {selected.reflection.workId && (
                <Button
                  onClick={() =>
                    n.openWork(selected.reflection.workId!, "reflection")
                  }
                >
                  查看关联 Work 与来源
                </Button>
              )}
              <ReflectionChat
                key={`chat:${id}`}
                detail={selected}
                events={[]}
                canWrite={true}
                href={() => "#"}
                select={() => {}}
                onChanged={detail.reload}
                onRunningChange={setRunning}
              />
              <OmDraftReview
                key={`draft:${id}`}
                scope={`reflection:${id}`}
                canWrite={true}
                busy={running}
                refreshKey={selected}
                onChanged={detail.reload}
              />
            </Stack>
          )}
        </Paper>
      </Box>
    </Stack>
  );
}
