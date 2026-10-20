import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { command } from "./api";
import { useCommand, useResource } from "./hooks";
import { CodeBlock, Feedback, ResourceState } from "./ui";
import { useDirty, useUnsavedChanges } from "./UnsavedChanges";
export type OmWorkspace = {
  ownerUserId: string;
  scope: string;
  baseRevision: string;
  activeRevision: string;
  digest: string;
  edits: Array<{ path: string; content: string | null }>;
  summary: string;
  conflicts: string[];
  upstreamRevision?: string;
};
export function OmDraftReview({
  scope,
  canWrite,
  busy = false,
  refreshKey,
  onChanged,
  initialDraft,
}: {
  scope: string;
  canWrite: boolean;
  busy?: boolean;
  refreshKey?: unknown;
  onChanged?: () => void;
  initialDraft?: OmWorkspace;
}) {
  const base = `/api/v1/om/workspaces/${encodeURIComponent(scope)}`;
  const resource = useResource<OmWorkspace>(canWrite ? base : null);
  const c = useCommand();
  const { guard } = useUnsavedChanges();
  const blocked = c.busy || busy;
  const [path, setPath] = useState("");
  const [content, setContent] = useState<string | null>("");
  const [summary, setSummary] = useState("");
  const [editing, setEditing] = useState(false);
  const request = useRef({ digest: "", id: "" });
  const draft = canWrite ? resource.data : initialDraft;
  useEffect(() => {
    resource.reload();
  }, [refreshKey]);
  useEffect(() => {
    if (!draft || editing) return;
    const selected =
      draft.edits.find((edit) => edit.path === path) ?? draft.edits[0];
    setPath(selected?.path ?? "");
    setContent(selected?.content ?? "");
    setSummary(draft.summary);
    setEditing(false);
    if (request.current.digest !== draft.digest)
      request.current = { digest: draft.digest, id: crypto.randomUUID() };
  }, [draft]);
  useDirty(editing, () => setEditing(false));
  const previous = useResource<{ content: string }>(
    draft && path
      ? `/api/v1/om/users/${draft.ownerUserId}/file?path=${encodeURIComponent(path)}&revision=${draft.baseRevision}`
      : null,
  );
  if (!canWrite && !draft)
    return <Typography>只有 OM 所有者可以提交私有草稿。</Typography>;
  const changed = () => {
    resource.reload();
    onChanged?.();
  };
  return (
    <Stack spacing={2}>
      <Typography variant="h6">OM 改动</Typography>
      {!canWrite && (
        <Alert severity="info">只读：只有 OM 所有者可以提交。</Alert>
      )}
      <ResourceState {...resource} retry={resource.reload} />
      <Feedback {...c} />
      {draft && (
        <>
          {draft.baseRevision !== draft.activeRevision && (
            <Alert severity="warning">
              当前 OM 已更新。请合并最新版本，解决冲突后重新确认。
            </Alert>
          )}
          {!!draft.conflicts.length && (
            <Alert severity="warning">
              需要解决冲突：{draft.conflicts.join("、")}
            </Alert>
          )}
          {!!draft.edits.length ? (
            <>
              <TextField
                disabled={!canWrite || blocked}
                label="提交说明"
                value={summary}
                onChange={(e) => {
                  setSummary(e.target.value);
                  setEditing(true);
                }}
              />
              <TextField
                select
                label="改动文件"
                value={path}
                onChange={(e) => {
                  const next = e.target.value;
                  guard(() => {
                    const edit = draft.edits.find(
                      (edit) => edit.path === next,
                    )!;
                    setPath(edit.path);
                    setContent(edit.content);
                    setEditing(false);
                  });
                }}
              >
                {draft.edits.map((edit) => (
                  <MenuItem value={edit.path} key={edit.path}>
                    {edit.path}
                    {edit.content === null ? "（删除）" : ""}
                  </MenuItem>
                ))}
              </TextField>
              <Typography variant="subtitle2">提交前</Typography>
              <CodeBlock>
                {previous.data?.content ?? "此文件在基线中不存在"}
              </CodeBlock>
              <TextField
                label="提交后内容"
                multiline
                minRows={8}
                value={content ?? ""}
                disabled={!canWrite || blocked || content === null}
                onChange={(e) => {
                  setContent(e.target.value);
                  setEditing(true);
                }}
              />
              {content === null && (
                <Alert severity="warning">提交后将删除该文件。</Alert>
              )}
              {canWrite && (
                <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
                  <Button
                    disabled={blocked || !editing}
                    onClick={() =>
                      void c.run(async () => {
                        await command(base, "PUT", {
                          baseRevision: draft.baseRevision,
                          summary,
                          edits: draft.edits.map((edit) =>
                            edit.path === path ? { path, content } : edit,
                          ),
                        });
                        setEditing(false);
                        changed();
                      })
                    }
                  >
                    保存调整
                  </Button>
                  <Button
                    disabled={blocked || editing}
                    onClick={() => {
                      setContent(
                        content === null
                          ? (previous.data?.content ?? "")
                          : null,
                      );
                      setEditing(true);
                    }}
                  >
                    {content === null ? "取消删除" : "删除该文件"}
                  </Button>
                </Stack>
              )}
            </>
          ) : (
            <Typography color="text.secondary">暂无未提交改动。</Typography>
          )}
          {canWrite && (
            <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
              <Button
                variant="contained"
                disabled={
                  blocked ||
                  editing ||
                  (!draft.edits.length && !draft.upstreamRevision) ||
                  !!draft.conflicts.length ||
                  draft.baseRevision !== draft.activeRevision
                }
                onClick={() =>
                  void c.run(async () => {
                    await command(`${base}/commit`, "POST", {
                      digest: draft.digest,
                      requestId: request.current.id,
                    });
                    changed();
                  }, "OM 已提交，后续工作将使用新版本。")
                }
              >
                确认并提交
              </Button>
              <Button
                disabled={
                  blocked ||
                  editing ||
                  draft.baseRevision === draft.activeRevision
                }
                onClick={() =>
                  void c.run(async () => {
                    await command(`${base}/rebase`);
                    changed();
                  })
                }
              >
                合并最新版本
              </Button>
              <Button
                disabled={
                  blocked ||
                  editing ||
                  (!draft.edits.length && !draft.upstreamRevision)
                }
                onClick={() =>
                  void c.run(async () => {
                    await command(base, "DELETE");
                    changed();
                  })
                }
              >
                丢弃未提交改动
              </Button>
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}
