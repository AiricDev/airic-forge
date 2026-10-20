import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type {
  Comparison,
  Contribution,
  ContributionDetail,
  User,
} from "../types";
import { api, command } from "../api";
import { useCommand, useResource } from "../hooks";
import {
  CodeBlock,
  ConfirmDialog,
  Feedback,
  PageHeading,
  ResourceState,
} from "../ui";
import { useDirty, useUnsavedChanges } from "../UnsavedChanges";
export function ContributionsPage({ users }: { users: User[] }) {
  const list = useResource<{
    contributions: Contribution[];
  }>("/api/v1/organization/contributions");
  const [selected, setSelected] = useState("");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [originalPaths, setOriginalPaths] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const detail = useResource<ContributionDetail>(
    selected
      ? `/api/v1/organization/contributions/${encodeURIComponent(selected)}`
      : null,
  );
  const c = useCommand();
  const { guard } = useUnsavedChanges();
  useEffect(() => {
    if (detail.data) {
      const value = detail.data.record.selectedPaths.length
        ? detail.data.record.selectedPaths
        : detail.data.changedPaths;
      setPaths(value);
      setOriginalPaths(value);
    }
  }, [detail.data]);
  useDirty(
    Boolean(
      (!selected && (reason.trim() || evidence.trim())) ||
      (detail.data?.record.status === "open" &&
        JSON.stringify(paths) !== JSON.stringify(originalPaths)),
    ),
  );
  const change = async (kind: "review" | "accept") => {
    if (!detail.data) return;
    const ok = await c.run(
      async () => {
        await command(
          `/api/v1/organization/contributions/${encodeURIComponent(selected)}/${kind}`,
          "POST",
          kind === "review"
            ? { selectedPaths: paths }
            : { reviewedRevision: detail.data!.record.reviewedRevision },
        );
        setOriginalPaths(paths);
        setConfirm(false);
        detail.reload();
        list.reload();
      },
      kind === "review"
        ? "候选 OM 已校验；请核对差异后采纳。"
        : "选定内容已纳入组织 main；成员可自主同步。",
    );
    return ok;
  };
  return (
    <Stack spacing={3}>
      <PageHeading
        title="组织贡献"
        description="固定个人来源版本，选择可复用内容并审阅后吸收。"
      />
      <Feedback {...c} />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "300px minmax(0,1fr)" },
          gap: 3,
        }}
      >
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6">比较个人与组织版本</Typography>
          <List>
            {users.map((u) => (
              <ListItemButton
                key={u.id}
                disabled={c.busy}
                onClick={() =>
                  guard(() => {
                    void c.run(async () => {
                      const value = await api<Comparison>(
                        `/api/v1/organization/compare/${encodeURIComponent(u.id)}`,
                      );
                      setComparison(value);
                      setSelected("");
                      setReason("");
                      setEvidence("");
                    });
                  })
                }
              >
                <ListItemText primary={u.email} />
              </ListItemButton>
            ))}
          </List>
          <Typography variant="h6">贡献记录</Typography>
          <ResourceState {...list} retry={list.reload} />
          <List>
            {list.data?.contributions.map((item) => (
              <ListItemButton
                key={item.id}
                selected={item.id === selected}
                onClick={() =>
                  guard(() => {
                    setSelected(item.id);
                    setReason("");
                    setEvidence("");
                  })
                }
              >
                <ListItemText
                  primary={item.reason || item.id}
                  secondary={`${item.status} · ${item.authorEmail ?? item.authorUserId}`}
                />
              </ListItemButton>
            ))}
          </List>
          {list.data && !list.data.contributions.length && (
            <Typography color="text.secondary">暂无贡献记录</Typography>
          )}
        </Paper>
        <Paper sx={{ p: 3, minWidth: 0 }}>
          <Stack spacing={3}>
            <ResourceState {...detail} retry={detail.reload} />
            {comparison && !selected && (
              <>
                <Typography variant="h6">
                  {comparison.author.email} 相对组织 main
                </Typography>
                <Typography sx={{ overflowWrap: "anywhere" }}>
                  来源 {comparison.sourceRevision}
                  <br />
                  main {comparison.mainRevision}
                  <br />
                  共同基准 {comparison.baseRevision}
                </Typography>
                <Typography>
                  变更文件：{comparison.changedPaths.join("、") || "无"}
                </Typography>
                <CodeBlock>{comparison.diff}</CodeBlock>
                <TextField
                  label="组织吸收理由"
                  multiline
                  minRows={2}
                  value={reason}
                  disabled={c.busy}
                  onChange={(e) => setReason(e.target.value)}
                />
                <TextField
                  label="组织贡献证据"
                  multiline
                  minRows={2}
                  helperText="可分享的证据引用；私人轨迹仅管理员可查看。"
                  value={evidence}
                  disabled={c.busy}
                  onChange={(e) => setEvidence(e.target.value)}
                />
                <Button
                  variant="contained"
                  disabled={
                    c.busy || !reason.trim() || !comparison.changedPaths.length
                  }
                  onClick={() =>
                    void c.run(async () => {
                      const record = await command<Contribution>(
                        "/api/v1/organization/contributions",
                        "POST",
                        {
                          authorUserId: comparison.author.id,
                          reason,
                          evidence,
                        },
                      );
                      setSelected(record.id);
                      setReason("");
                      setEvidence("");
                      list.reload();
                    }, "已固定作者版本和组织基准；现在选择要吸收的文件。")
                  }
                >
                  固定贡献来源
                </Button>
              </>
            )}
            {detail.data && (
              <>
                <Typography variant="h6">
                  贡献 {detail.data.record.id} · {detail.data.record.status}
                </Typography>
                <Typography sx={{ overflowWrap: "anywhere" }}>
                  作者 {detail.data.authorEmail}
                  <br />
                  来源 {detail.data.record.sourceRevision}
                  <br />
                  组织基准 {detail.data.record.baseMainRevision}
                </Typography>
                <Typography>理由：{detail.data.record.reason}</Typography>
                <Typography>
                  证据：{detail.data.record.evidence || "未记录"}
                </Typography>
                <Typography variant="h6">选择文件与依赖</Typography>
                <Stack>
                  {detail.data.changedPaths.map((path) => (
                    <FormControlLabel
                      key={path}
                      label={path}
                      sx={{ overflowWrap: "anywhere" }}
                      control={
                        <Checkbox
                          checked={paths.includes(path)}
                          disabled={
                            c.busy || detail.data!.record.status !== "open"
                          }
                          onChange={(_, checked) =>
                            setPaths((values) =>
                              checked
                                ? [...values, path]
                                : values.filter((value) => value !== path),
                            )
                          }
                        />
                      }
                    />
                  ))}
                </Stack>
                <Typography variant="h6">
                  {detail.data.candidateDiff ? "实际吸收差异" : "个人来源差异"}
                </Typography>
                <CodeBlock>
                  {detail.data.candidateDiff ?? detail.data.diff}
                </CodeBlock>
                {detail.data.record.status === "open" && (
                  <Button
                    disabled={c.busy || !paths.length}
                    onClick={() => void change("review")}
                  >
                    校验并审阅选定内容
                  </Button>
                )}
                {detail.data.record.status === "reviewed" && (
                  <Button
                    variant="contained"
                    disabled={c.busy}
                    onClick={() => setConfirm(true)}
                  >
                    采纳到组织 main
                  </Button>
                )}
                {detail.data.record.acceptedRevision && (
                  <Typography sx={{ overflowWrap: "anywhere" }}>
                    组织修订 {detail.data.record.acceptedRevision}
                  </Typography>
                )}
              </>
            )}
            {!comparison && !selected && (
              <Typography color="text.secondary">
                选择用户比较版本，或打开已有贡献记录。
              </Typography>
            )}
          </Stack>
        </Paper>
      </Box>
      <ConfirmDialog
        open={confirm}
        title="采纳组织贡献"
        description="将已审阅的选定内容纳入组织 main，成员随后可自主同步。"
        confirmLabel="采纳到组织 main"
        busy={c.busy}
        error={c.error}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void change("accept")}
      />
    </Stack>
  );
}
