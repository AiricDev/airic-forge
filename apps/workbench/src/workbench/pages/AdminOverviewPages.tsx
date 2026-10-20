import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Link,
  List,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import type {
  Baseline,
  CatalogOverview,
  InstanceSettings,
  OmSnapshot,
  User,
} from "../types";
import { api, command } from "../api";
import { useResource, useCommand } from "../hooks";
import { ConfirmDialog, Feedback, PageHeading, ResourceState } from "../ui";
import { activityLabel, baselineValue, feedbackLabel } from "../labels";
import type { WorkFeedbackKind } from "../types";
export function UsersPage({
  users,
  openOm,
  openWorks,
}: {
  users: User[];
  openOm: (id: string) => void;
  openWorks: (id: string) => void;
}) {
  const [heads, setHeads] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    void Promise.all(
      users.map(
        async (u) =>
          [
            u.id,
            (
              await api<OmSnapshot>(
                `/api/v1/om/users/${encodeURIComponent(u.id)}`,
              )
            ).activeRevision,
          ] as const,
      ),
    )
      .then((rows) => {
        if (current) setHeads(Object.fromEntries(rows));
      })
      .catch((cause) => {
        if (current) setError(String(cause));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [users, retry]);
  return (
    <Stack spacing={3}>
      <PageHeading
        title="用户与资源"
        description="管理员查看不会改变资源所有者。"
      />
      <ResourceState
        loading={loading}
        error={error}
        retry={() => setRetry((v) => v + 1)}
      />
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>用户</TableCell>
              <TableCell>角色</TableCell>
              <TableCell>OM 分支</TableCell>
              <TableCell>active OM</TableCell>
              <TableCell>资源</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  {u.role === "admin" ? "管理员" : "普通用户"}
                </TableCell>
                <TableCell>{u.activeBranch}</TableCell>
                <TableCell>{heads[u.id]?.slice(0, 12) || "—"}</TableCell>
                <TableCell>
                  <Button onClick={() => openOm(u.id)}>OM</Button>
                  <Button onClick={() => openWorks(u.id)}>Work</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
function CatalogPage() {
  const resource = useResource<CatalogOverview>("/api/v1/catalog");
  const c = useCommand();
  const [candidate, setCandidate] = useState("");
  const [confirm, setConfirm] = useState(false);
  const data = resource.data;
  const selected =
    data?.candidates.find((item) => item.digest === candidate) ??
    data?.candidates[0];
  const proposed = selected?.capabilities ?? data?.accepted?.capabilities ?? [];
  const rows = [
    ...proposed,
    ...(selected
      ? (data?.accepted?.capabilities.filter(
          (cap) => !proposed.some((p) => p.id === cap.id),
        ) ?? [])
      : []),
  ];
  return (
    <Stack spacing={3}>
      <Typography variant="h5" component="h2">
        能力目录
      </Typography>
      <Typography color="text.secondary">
        能力列表来自 App Manifest，OpenAPI 用于校验接口。接受目录不会自动修改
        Work Definition 的允许能力。
      </Typography>
      <ResourceState {...resource} retry={resource.reload} />
      <Feedback {...c} />
      {data && (
        <>
          <Paper sx={{ p: 2 }}>
            <Stack
              direction="row"
              sx={{
                gap: 2,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <Typography sx={{ overflowWrap: "anywhere" }}>
                已接受 {data.accepted?.digest || "无"}
              </Typography>
              <Typography>
                {data.accepted?.capabilities.length ?? 0} 项已接受能力 ·{" "}
                {data.candidates.length} 个候选目录
              </Typography>
              {data.candidates.length > 0 && (
                <>
                  <TextField
                    select
                    label="候选能力目录"
                    value={selected?.digest ?? ""}
                    onChange={(e) => setCandidate(e.target.value)}
                    sx={{ minWidth: 240, flex: 1 }}
                  >
                    {data.candidates.map((item) => (
                      <MenuItem key={item.digest} value={item.digest}>
                        {item.digest}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button
                    variant="contained"
                    disabled={c.busy}
                    onClick={() => setConfirm(true)}
                  >
                    接受候选目录
                  </Button>
                </>
              )}
            </Stack>
          </Paper>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>能力</TableCell>
                  <TableCell>变化</TableCell>
                  <TableCell>用途 / 输入输出</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((cap) => {
                  const before = data.accepted?.capabilities.find(
                    (item) => item.id === cap.id,
                  );
                  const removed = !proposed.some((p) => p.id === cap.id);
                  const change = !selected
                    ? "已接受"
                    : removed
                      ? "移除"
                      : !before
                        ? "新增"
                        : JSON.stringify(before) === JSON.stringify(cap)
                          ? "未变"
                          : "修改";
                  return (
                    <TableRow key={cap.id}>
                      <TableCell>
                        {cap.title}
                        <Typography
                          variant="caption"
                          sx={{
                            display: "block",
                          }}
                        >
                          {cap.id}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip label={change} />
                      </TableCell>
                      <TableCell>
                        {cap.description}
                        <Typography
                          variant="caption"
                          sx={{
                            display: "block",
                          }}
                        >
                          {cap.kind} · 输入{" "}
                          {Object.keys(cap.inputSchema).length} 项 · 输出{" "}
                          {Object.keys(cap.outputSchema).length} 项
                        </Typography>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!rows.length && (
                  <TableRow>
                    <TableCell colSpan={3}>暂无能力目录</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
      <ConfirmDialog
        open={confirm}
        title="接受候选能力目录"
        description={`接受 ${selected?.digest ?? ""} 后，该目录成为当前生效目录。Work Definition 仍须显式允许能力。`}
        confirmLabel="接受目录"
        busy={c.busy}
        error={c.error}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          if (selected)
            void c.run(async () => {
              await command(
                `/api/v1/catalog/${encodeURIComponent(selected.digest)}/accept-from-workspace`,
              );
              setConfirm(false);
              resource.reload();
            }, "能力目录已接受。");
        }}
      />
    </Stack>
  );
}
export function MeasurementsPage() {
  const resource = useResource<Baseline>("/api/v1/measurements/baseline");
  return (
    <Stack spacing={3}>
      <PageHeading title="成效基线" />
      <ResourceState {...resource} retry={resource.reload} />
      {resource.data && (
        <>
          <Typography>{resource.data.interpretation}</Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
              gap: 3,
            }}
          >
            {[
              ["活动与治理", resource.data.activity],
              ["用户反馈与实际结果", resource.data.feedback],
            ].map(([label, values]) => (
              <Paper key={String(label)} sx={{ p: 3 }}>
                <Typography variant="h6">{String(label)}</Typography>
                <List>
                  {Object.entries(values).map(([key, value]) => (
                    <Stack
                      key={key}
                      direction="row"
                      sx={{
                        justifyContent: "space-between",
                        gap: 2,
                        ...{ py: 1 },
                      }}
                    >
                      <Typography>
                        {activityLabel[key] ??
                          feedbackLabel[key as WorkFeedbackKind] ??
                          key}
                      </Typography>
                      <Typography>
                        {baselineValue(key, value as number | null)}
                      </Typography>
                    </Stack>
                  ))}
                </List>
              </Paper>
            ))}
          </Box>
        </>
      )}
    </Stack>
  );
}
export function SettingsPage() {
  const settings = useResource<InstanceSettings>("/api/v1/instance-settings");
  const [section, setSection] = useState<"integration" | "catalog">(
    "integration",
  );
  const data = settings.data;
  return (
    <Stack spacing={3}>
      <PageHeading
        title="实例设置"
        description="查看实际生效的系统对接、OM 存储位置，并管理集成 App 的能力目录。"
      />
      <Tabs
        value={section}
        onChange={(_, value: "integration" | "catalog") => setSection(value)}
        aria-label="实例设置分类"
      >
        <Tab
          value="integration"
          label="系统对接与存储"
          id="settings-integration-tab"
          aria-controls="settings-integration-panel"
        />
        <Tab
          value="catalog"
          label="能力目录"
          id="settings-catalog-tab"
          aria-controls="settings-catalog-panel"
        />
      </Tabs>
      {section === "integration" ? (
        <Stack
          role="tabpanel"
          id="settings-integration-panel"
          aria-labelledby="settings-integration-tab"
          spacing={3}
        >
          <ResourceState {...settings} retry={settings.reload} />
          {data && (
            <>
              <Paper sx={{ p: 3 }}>
                <Stack spacing={2}>
                  <Typography variant="h6" component="h2">
                    App 实例对接
                  </Typography>
                  <Typography>
                    App：{data.integration.appId} · 组织：
                    {data.integration.organizationId || "未配置"}
                  </Typography>
                  {[
                    ["App 实例地址", data.integration.baseUrl],
                    ["能力 Manifest 地址", data.integration.manifestUrl],
                    ["OpenAPI 文档地址", data.integration.openApiUrl],
                  ].map(([label, url]) => (
                    <Box key={label}>
                      <Typography variant="subtitle2">{label}</Typography>
                      <Link
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{ overflowWrap: "anywhere" }}
                      >
                        {url}
                      </Link>
                    </Box>
                  ))}
                  <Typography color="text.secondary">
                    能力列表与输入输出定义来自 App Manifest；导入时使用 OpenAPI
                    校验对应接口。以上文档可能需要 App 身份认证，AiricForge
                    不会将访问令牌附加到链接。
                  </Typography>
                </Stack>
              </Paper>
              <Paper sx={{ p: 3 }}>
                <Stack spacing={2}>
                  <Typography variant="h6" component="h2">
                    OM 数据存储
                  </Typography>
                  {[
                    ["OM Git 仓库", data.operatingModel.repositoryPath],
                    ["运行数据目录", data.operatingModel.dataPath],
                    [
                      "个人 worktree 根目录",
                      data.operatingModel.personalWorktreesPath,
                    ],
                  ].map(([label, path]) => (
                    <Box key={label}>
                      <Typography variant="subtitle2">{label}</Typography>
                      <Typography
                        sx={{
                          fontFamily: "monospace",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {path}
                      </Typography>
                    </Box>
                  ))}
                  <Typography color="text.secondary">
                    以上为服务端实际路径，只读展示。组织 OM 位于仓库 main
                    分支；各用户在个人 worktree 中维护自己的 OM。
                  </Typography>
                </Stack>
              </Paper>
            </>
          )}
        </Stack>
      ) : (
        <Box
          role="tabpanel"
          id="settings-catalog-panel"
          aria-labelledby="settings-catalog-tab"
        >
          <CatalogPage />
        </Box>
      )}
    </Stack>
  );
}
