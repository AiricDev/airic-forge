import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { RichTreeView } from "@mui/x-tree-view/RichTreeView";
import type {
  OmCommit,
  OmDraft,
  OmFile,
  OmManifest,
  OmSnapshot,
  User,
} from "../types";
import { OmDraftReview } from "../OmDraftReview";
import { command } from "../api";
import { useCommand, useResource } from "../hooks";
import {
  CodeBlock,
  ConfirmDialog,
  Feedback,
  PageHeading,
  ResourceState,
} from "../ui";
import {
  draftWorkDefinition,
  ManifestPreview,
  MarkdownPreview,
} from "../DocumentPreview";
import { buildTree } from "../../utils/om";
import type { TreeNode } from "../../utils/om";
import { useDirty, useUnsavedChanges } from "../UnsavedChanges";
function items(
  nodes: TreeNode[],
  drafts: string[],
): Array<{
  id: string;
  label: string;
  children?: ReturnType<typeof items>;
}> {
  return nodes.map((node) => ({
    id: node.path,
    label: `${node.name}${drafts.includes(node.path) ? " · 有草稿" : ""}`,
    ...(node.type === "folder"
      ? { children: items(node.children, drafts) }
      : {}),
  }));
}
export function OmPage({
  user,
  users,
  branch,
  selectBranch,
}: {
  user: User;
  users: User[];
  branch: string;
  selectBranch: (value: string) => void;
}) {
  const [scope, setScope] = useState("manual");
  const [revision, setRevision] = useState("");
  const [path, setPath] = useState("");
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [discard, setDiscard] = useState(false);
  const { guard } = useUnsavedChanges();
  const c = useCommand();
  const base =
    branch === "main"
      ? "/api/v1/om/organization"
      : `/api/v1/om/users/${encodeURIComponent(branch)}`;
  const snapshot = useResource<OmSnapshot>(
    `${base}${revision ? `?revision=${encodeURIComponent(revision)}` : ""}`,
  );
  const history = useResource<{
    commits: OmCommit[];
  }>(`${base}/history`);
  const own = branch === user.id;
  const workspaces = useResource<{
    workspaces: Array<{ scope: string; summary: string }>;
  }>(own ? "/api/v1/om/workspaces" : null);
  const drafts = useResource<{
    drafts: OmDraft[];
  }>(own ? `${base}/drafts` : null);
  const s = snapshot.data;
  const active = s?.revision === s?.activeRevision;
  const file = useResource<OmFile>(
    s && path && s.files.includes(path)
      ? `${base}/file?path=${encodeURIComponent(path)}&revision=${encodeURIComponent(s.revision)}`
      : null,
  );
  const manifest = useResource<OmManifest>(
    s && path.endsWith("/work.yml") && s.files.includes(path)
      ? `${base}/manifest?path=${encodeURIComponent(path)}&revision=${encodeURIComponent(s.revision)}`
      : null,
  );
  const draft =
    own && active
      ? drafts.data?.drafts.find((d) => d.path === path)
      : undefined;
  const shown = draft?.content ?? file.data?.content ?? "";
  const definition = draft
    ? draftWorkDefinition(shown)
    : manifest.data?.definition;
  useEffect(() => {
    if (s && !s.files.includes(path))
      setPath(s.files.find((p) => p.endsWith("/work.yml")) || s.files[0] || "");
  }, [s, path]);
  useDirty(editing && content !== original);
  const select = (next: string) =>
    guard(() => {
      setPath(next);
      setEditing(false);
    });
  const changeRevision = (value: string) =>
    guard(() => {
      setRevision(value);
      setEditing(false);
    });
  return (
    <Stack spacing={3}>
      <PageHeading
        title="Operating Model"
        description="浏览当前版本、历史修订与私有草稿。"
      />
      <Paper sx={{ p: 2 }}>
        <Stack spacing={2}>
          <TextField
            select
            label="OM 分支"
            value={branch}
            onChange={(e) =>
              guard(() => {
                setRevision("");
                setPath("");
                setEditing(false);
                selectBranch(e.target.value);
              })
            }
          >
            <MenuItem value="main">main · 组织 OM</MenuItem>
            {(user.role === "admin"
              ? [user, ...users.filter((u) => u.id !== user.id)]
              : [user]
            ).map((u) => (
              <MenuItem key={u.id} value={u.id}>
                {u.activeBranch} · {u.email}
              </MenuItem>
            ))}
          </TextField>
          {s && (
            <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
              当前分支 {s.branch} · active HEAD {s.activeRevision}
            </Typography>
          )}
          {s && !active && (
            <Alert
              severity="info"
              action={
                <Button onClick={() => changeRevision("")}>返回当前版本</Button>
              }
            >
              正在查看历史修订 {s.revision}
            </Alert>
          )}
          {branch === "main" && s && (
            <Typography>
              {s.syncAvailable
                ? "组织 main 有可同步更新。"
                : "个人 OM 已包含当前组织版本。"}
            </Typography>
          )}
          {branch === "main" && s?.syncAvailable && (
            <Button
              disabled={c.busy}
              onClick={() =>
                void c.run(async () => {
                  await command("/api/v1/om/sync");
                  setScope("sync");
                  selectBranch(user.id);
                })
              }
            >
              同步到我的 OM 草稿
            </Button>
          )}
          <Feedback {...c} />
        </Stack>
      </Paper>
      <ResourceState {...snapshot} retry={snapshot.reload} />
      {s && (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "minmax(0,1fr)",
              md: "300px minmax(0,1fr)",
            },
            gap: 3,
          }}
        >
          <Paper sx={{ p: 2, minWidth: 0 }}>
            <Stack spacing={2}>
              <Typography variant="h6">文件</Typography>
              <RichTreeView
                aria-label="OM 仓库"
                items={items(
                  buildTree(s.files.map((value) => ({ path: value }))),
                  own && active
                    ? (drafts.data?.drafts.map((d) => d.path) ?? [])
                    : [],
                )}
                defaultExpandedItems={[
                  "work-definitions",
                  "subject-knowledge",
                  "work-definitions/report-authoring",
                  "work-definitions/report-type-definition",
                ]}
                selectedItems={path}
                onSelectedItemsChange={(_, value) => {
                  if (value && s.files.includes(value)) select(value);
                }}
              />
              <Typography variant="h6">版本历史</Typography>
              <ResourceState {...history} retry={history.reload} />
              <List>
                {history.data?.commits.map((commit) => (
                  <ListItemButton
                    key={commit.revision}
                    selected={commit.revision === s.revision}
                    onClick={() => changeRevision(commit.revision)}
                  >
                    <ListItemText
                      primary={commit.subject}
                      secondary={`${commit.revision.slice(0, 12)} · ${commit.at}`}
                    />
                  </ListItemButton>
                ))}
              </List>
              {own && (
                <>
                  <Typography variant="h6">我的 OM 草稿</Typography>
                  <ResourceState {...drafts} retry={drafts.reload} />
                  <List>
                    {drafts.data?.drafts.map((d) => (
                      <ListItemButton
                        key={d.path}
                        onClick={() => select(d.path)}
                      >
                        <ListItemText
                          primary={d.path}
                          secondary={
                            d.baseRevision === s.activeRevision
                              ? "当前版本"
                              : "基准已变化"
                          }
                          sx={{ overflowWrap: "anywhere" }}
                        />
                      </ListItemButton>
                    ))}
                  </List>
                  {drafts.data && !drafts.data.drafts.length && (
                    <Typography color="text.secondary">暂无草稿</Typography>
                  )}
                  <Typography variant="body2" color="text.secondary">
                    草稿不影响运行时，确认提交后才会形成新版本。
                  </Typography>
                </>
              )}
            </Stack>
          </Paper>
          <Paper sx={{ p: 3, minWidth: 0 }}>
            <Stack spacing={3}>
              <Stack
                direction="row"
                sx={{
                  gap: 2,
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                }}
              >
                <Box>
                  <Typography variant="h6" sx={{ overflowWrap: "anywhere" }}>
                    {path || "没有文件"}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ overflowWrap: "anywhere" }}
                  >
                    修订 {s.revision}
                  </Typography>
                  {draft && (
                    <Chip label="有未提交草稿" color="warning" sx={{ ml: 1 }} />
                  )}
                </Box>
                {own && active && file.data && (
                  <Stack
                    direction="row"
                    sx={{
                      gap: 1,
                    }}
                  >
                    {editing ? (
                      <>
                        <Button
                          disabled={c.busy}
                          onClick={() => guard(() => setEditing(false))}
                        >
                          预览
                        </Button>
                        <Button
                          variant="contained"
                          disabled={c.busy}
                          onClick={() =>
                            void c.run(async () => {
                              await command<OmDraft>(`${base}/drafts`, "PUT", {
                                path,
                                content,
                                baseRevision: s.activeRevision,
                              });
                              setOriginal(content);
                              setEditing(false);
                              drafts.reload();
                            }, "草稿已保存；个人 OM 的 active HEAD 未改变。")
                          }
                        >
                          保存草稿
                        </Button>
                      </>
                    ) : (
                      <>
                        {draft && (
                          <Button
                            disabled={c.busy}
                            onClick={() => setDiscard(true)}
                          >
                            丢弃草稿
                          </Button>
                        )}
                        <Button
                          onClick={() => {
                            setOriginal(shown);
                            setContent(shown);
                            setEditing(true);
                          }}
                        >
                          编辑草稿
                        </Button>
                      </>
                    )}
                  </Stack>
                )}
              </Stack>
              <ResourceState {...file} retry={file.reload} />
              {path.endsWith("/work.yml") && !draft && (
                <ResourceState {...manifest} retry={manifest.reload} />
              )}
              {editing ? (
                <>
                  <Alert severity="info">
                    草稿不影响运行时；确认提交后才会形成新 OM 版本。
                  </Alert>
                  <TextField
                    label={`编辑 ${path}`}
                    multiline
                    minRows={20}
                    value={content}
                    disabled={c.busy}
                    onChange={(e) => setContent(e.target.value)}
                    slotProps={{ input: { sx: { fontFamily: "monospace" } } }}
                  />
                </>
              ) : (
                file.data &&
                (draft && draft.baseRevision !== s.activeRevision ? (
                  <Alert severity="warning">
                    草稿基准已变化。请对照当前文件更新并重新保存。
                  </Alert>
                ) : path.endsWith("/work.yml") && definition ? (
                  <ManifestPreview
                    path={path}
                    content={shown}
                    definition={definition}
                    files={s.files}
                    select={select}
                  />
                ) : path.endsWith(".md") ? (
                  <MarkdownPreview
                    content={shown}
                    files={s.files}
                    select={select}
                  />
                ) : (
                  <CodeBlock>{shown}</CodeBlock>
                ))
              )}
            </Stack>
          </Paper>
        </Box>
      )}
      {own && (
        <Paper sx={{ p: 3 }}>
          <TextField
            select
            fullWidth
            label="草稿来源"
            value={scope}
            onChange={(event) => guard(() => setScope(event.target.value))}
          >
            <MenuItem value="manual">手动编辑草稿</MenuItem>
            <MenuItem value="sync">组织同步草稿</MenuItem>
            {workspaces.data?.workspaces
              .filter(
                (draft) => draft.scope !== "manual" && draft.scope !== "sync",
              )
              .map((draft) => (
                <MenuItem key={draft.scope} value={draft.scope}>
                  {draft.scope} · {draft.summary}
                </MenuItem>
              ))}
          </TextField>
          <OmDraftReview
            key={scope}
            scope={scope}
            canWrite={own}
            refreshKey={drafts.data}
            onChanged={() => {
              snapshot.reload();
              history.reload();
              drafts.reload();
              file.reload();
              workspaces.reload();
            }}
          />
        </Paper>
      )}
      <ConfirmDialog
        open={discard}
        title="丢弃已保存的草稿"
        description="删除这份私有草稿，当前生效 OM 不会改变。"
        confirmLabel="丢弃草稿"
        busy={c.busy}
        error={c.error}
        onCancel={() => setDiscard(false)}
        onConfirm={() =>
          void c.run(async () => {
            await command(
              `${base}/drafts?path=${encodeURIComponent(path)}`,
              "DELETE",
            );
            setDiscard(false);
            drafts.reload();
          }, "草稿已丢弃。")
        }
      />
    </Stack>
  );
}
