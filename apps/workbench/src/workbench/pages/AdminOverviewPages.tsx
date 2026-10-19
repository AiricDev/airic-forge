import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Chip,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
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
  Contribution,
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
export function CatalogPage() {
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
      <PageHeading
        title="能力目录"
        description="接受目录不会自动修改 Work Definition 的允许能力。"
      />
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
export function GovernancePage({
  navigate,
  openContribution,
}: {
  navigate: (view: "capabilities" | "contributions" | "organization") => void;
  openContribution: (id: string) => void;
}) {
  const catalog = useResource<CatalogOverview>("/api/v1/catalog");
  const contributions = useResource<{
    contributions: Contribution[];
  }>("/api/v1/organization/contributions");
  return (
    <Stack spacing={3}>
      <PageHeading
        title="组织治理"
        description="接受能力目录、审阅组织贡献，并查看组织 Operating Model。"
      />
      <ResourceState {...catalog} retry={catalog.reload} />
      <ResourceState {...contributions} retry={contributions.reload} />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "repeat(3,1fr)" },
          gap: 3,
        }}
      >
        {[
          ["capabilities", "待接受能力目录", catalog.data?.candidates.length],
          [
            "contributions",
            "待审阅组织贡献",
            contributions.data?.contributions.filter(
              (c) => c.status !== "accepted",
            ).length,
          ],
          ["organization", "组织 main", "浏览组织版本与 Work Definition"],
        ].map(([view, label, value]) => (
          <Paper key={view} sx={{ p: 3 }}>
            <Typography variant="h6">{label}</Typography>
            <Typography sx={{ my: 2 }}>{value ?? "—"}</Typography>
            <Button
              onClick={() =>
                navigate(
                  view as "capabilities" | "contributions" | "organization",
                )
              }
            >
              查看{label}
            </Button>
          </Paper>
        ))}
      </Box>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6">组织贡献</Typography>
        <List>
          {contributions.data?.contributions.slice(0, 8).map((item) => (
            <ListItemButton
              key={item.id}
              onClick={() => openContribution(item.id)}
            >
              <ListItemText
                primary={item.reason}
                secondary={`${item.authorEmail ?? item.authorUserId} · ${item.status}`}
              />
            </ListItemButton>
          ))}
        </List>
        {contributions.data && !contributions.data.contributions.length && (
          <Typography color="text.secondary">队列为空</Typography>
        )}
      </Paper>
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
  const catalog = useResource<CatalogOverview>("/api/v1/catalog");
  return (
    <Stack spacing={3}>
      <PageHeading
        title="实例设置"
        description="当前接入和治理配置的只读概览。"
      />
      <ResourceState {...catalog} retry={catalog.reload} />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "repeat(3,1fr)" },
          gap: 3,
        }}
      >
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6">App 接入</Typography>
          <Typography>{catalog.data?.accepted?.appId || "CertLab"}</Typography>
          <Typography color="text.secondary">
            嵌入式 Copilot · App Command API · 以 App 回执确认结果
          </Typography>
        </Paper>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6">能力目录</Typography>
          <Typography sx={{ overflowWrap: "anywhere" }}>
            {catalog.data?.accepted?.digest || "无"}
          </Typography>
          <Typography>
            {catalog.data?.accepted?.capabilities.length ?? 0} 项能力 ·{" "}
            {catalog.data?.candidates.length ?? 0} 个候选
          </Typography>
        </Paper>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6">Reflection lens</Typography>
          <Typography>三种内置 lens</Typography>
          <Typography color="text.secondary">
            管理员可在 Lens 管理中启停和版本化提示词。
          </Typography>
        </Paper>
      </Box>
    </Stack>
  );
}
