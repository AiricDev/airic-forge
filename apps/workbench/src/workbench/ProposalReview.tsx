import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { ProposalDetail } from "./types";
import { command } from "./api";
import { useCommand, useResource } from "./hooks";
import { CodeBlock, ConfirmDialog, Feedback, ResourceState } from "./ui";
import { useDirty, useUnsavedChanges } from "./UnsavedChanges";
export function ProposalReview({
  id,
  canWrite,
  onChanged,
}: {
  id: string;
  canWrite: boolean;
  onChanged?: () => void;
}) {
  const resource = useResource<ProposalDetail>(
    `/api/v1/proposals/${encodeURIComponent(id)}`,
  );
  const c = useCommand();
  const [confirm, setConfirm] = useState<"adopt" | "abandon" | null>(null);
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [title, setTitle] = useState("采纳个人 OM 改进");
  const { guard } = useUnsavedChanges();
  const d = resource.data;
  const p = d?.proposal;
  useEffect(() => {
    setPath(resource.data?.changedPaths[0] || "");
  }, [resource.data]);
  const file = useResource<{
    content: string;
  }>(
    p && !p.reflectionId && path
      ? `/api/v1/proposals/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}`
      : null,
  );
  useEffect(() => {
    if (file.data) {
      setContent(file.data.content);
      setSaved(file.data.content);
    }
  }, [file.data]);
  useDirty(
    Boolean(p && !p.reflectionId && p.status === "open" && content !== saved),
  );
  const action = async (kind: "review" | "rebase" | "adopt" | "abandon") => {
    if (!p) return;
    const ok = await c.run(
      async () => {
        try {
          await command(
            `/api/v1/proposals/${encodeURIComponent(id)}/${kind}`,
            "POST",
            kind === "adopt"
              ? {
                  title: p.reflectionId ? p.reason : title,
                  reviewedRevision: p.reviewedRevision,
                }
              : undefined,
          );
        } catch (error) {
          if (kind === "rebase") resource.reload();
          throw error;
        }
        setConfirm(null);
        resource.reload();
        onChanged?.();
      },
      kind === "adopt"
        ? "已采纳；新的个人 HEAD 从下一 Turn 生效。"
        : kind === "abandon"
          ? "Proposal 已放弃；Reflection 对话仍可查看。"
          : kind === "rebase"
            ? "基准已更新；请重新审阅。"
            : "结构、引用和能力检查通过；请核对差异后采纳。",
    );
    return ok;
  };
  return (
    <Stack spacing={2}>
      <ResourceState {...resource} retry={resource.reload} />
      <Feedback {...c} />
      {d && p && (
        <>
          <Typography variant="h6">Proposal 审阅</Typography>
          <Stack
            direction="row"
            sx={{
              gap: 1,
              flexWrap: "wrap",
            }}
          >
            <Chip
              label={
                p.status === "open"
                  ? "待采纳"
                  : p.status === "adopted"
                    ? "已采纳"
                    : "已放弃"
              }
            />
            <Typography sx={{ overflowWrap: "anywhere" }}>{p.id}</Typography>
          </Stack>
          <Typography>{p.reason}</Typography>
          <Typography>证据：{p.evidence || "未记录"}</Typography>
          <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
            基准 {p.baseRevision} · active HEAD {d.activeRevision}
          </Typography>
          {d.conflicts.length > 0 && (
            <Alert severity="warning">冲突文件：{d.conflicts.join("、")}</Alert>
          )}
          {d.activeRevision !== p.baseRevision && p.status === "open" && (
            <Alert severity="warning">
              基准已变化；需要 Rebase 到当前 HEAD 并重新审阅。
            </Alert>
          )}
          <Typography variant="subtitle2">
            变更文件：{d.changedPaths.join("、") || "无"}
          </Typography>
          <CodeBlock>{d.diff || "暂无差异"}</CodeBlock>
          {!p.reflectionId && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={2}>
                <Typography variant="subtitle2">历史 Proposal 文件</Typography>
                <TextField
                  select
                  label="OM 文件路径"
                  value={path}
                  onChange={(e) => guard(() => setPath(e.target.value))}
                >
                  {d.changedPaths.map((value) => (
                    <MenuItem key={value} value={value}>
                      {value}
                    </MenuItem>
                  ))}
                </TextField>
                <ResourceState {...file} retry={file.reload} />
                {file.data && (
                  <TextField
                    label="OM 文件内容"
                    multiline
                    minRows={8}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    slotProps={{
                      input: { readOnly: !canWrite || p.status !== "open" },
                    }}
                  />
                )}
                {canWrite && p.status === "open" && (
                  <Button
                    disabled={c.busy || file.loading}
                    onClick={() =>
                      void c.run(async () => {
                        await command(
                          `/api/v1/proposals/${encodeURIComponent(id)}/files`,
                          "PATCH",
                          { path, content },
                        );
                        setSaved(content);
                        resource.reload();
                      }, "Proposal 文件已保存；active OM 未改变。")
                    }
                  >
                    保存草稿
                  </Button>
                )}
              </Stack>
            </Paper>
          )}
          {canWrite && p.status === "open" && (
            <Stack
              direction="row"
              sx={{
                flexWrap: "wrap",
                gap: 2,
              }}
            >
              {d.activeRevision !== p.baseRevision ? (
                <Button disabled={c.busy} onClick={() => void action("rebase")}>
                  Rebase 到当前 HEAD
                </Button>
              ) : (
                <Button
                  disabled={c.busy || content !== saved}
                  onClick={() => void action("review")}
                >
                  校验并审阅
                </Button>
              )}
              {p.reviewedRevision && (
                <>
                  {!p.reflectionId && (
                    <TextField
                      label="采纳标题"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  )}
                  <Button
                    variant="contained"
                    disabled={
                      c.busy ||
                      d.activeRevision !== p.baseRevision ||
                      content !== saved
                    }
                    onClick={() => setConfirm("adopt")}
                  >
                    确认采纳
                  </Button>
                </>
              )}
              {p.reflectionId && (
                <Button
                  color="warning"
                  disabled={c.busy}
                  onClick={() => setConfirm("abandon")}
                >
                  放弃 Proposal
                </Button>
              )}
            </Stack>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "adopt" ? "采纳 Proposal" : "放弃 Proposal"}
        description={
          confirm === "adopt"
            ? "采纳后形成新的个人 OM 版本，从下一 Turn 生效。当前 Work 的历史版本保持可追溯。"
            : "对话与历史会保留，OM 不会改变。"
        }
        confirmLabel={confirm === "adopt" ? "确认采纳" : "确认放弃"}
        busy={c.busy}
        error={c.error}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void action(confirm);
        }}
      />
    </Stack>
  );
}
