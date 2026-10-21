import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Pagination,
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
import type { User } from "../types";
import { api, command } from "../api";
import { useCommand, useResource } from "../hooks";
import { Feedback, PageHeading, ResourceState } from "../ui";
const statuses = { active: "正常", draining: "停用中", disabled: "已停用" };
type Event = {
  id: string;
  actorUserId: string | null;
  reason: string;
  at: string;
  before: { role: User["role"]; status: User["status"]; version: number };
  after: { role: User["role"]; status: User["status"]; version: number };
};
type Detail = {
  user: User;
  identities: { appId: string; appUserId: string; email: string }[];
  history: Event[];
  page: number;
  total: number;
};
export function UsersPage({
  users,
  openOm,
  openWorks,
  changed,
}: {
  users: User[];
  openOm: (id: string) => void;
  openWorks: (id: string) => void;
  changed: () => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<User | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  const [page, setPage] = useState(1);
  const rows = users.filter(
    (user) =>
      user.email.toLowerCase().includes(search.trim().toLowerCase()) &&
      (!role || user.role === role) &&
      (!status || user.status === status),
  );
  const detail = useResource<Detail>(
    selected
      ? `/api/v1/users/${encodeURIComponent(selected.id)}?page=${page}`
      : null,
  );
  return (
    <Stack spacing={3}>
      <PageHeading
        title="用户与资源"
        description="管理 Forge 用户角色和访问状态，保留其 OM、Work 与历史。"
      />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          label="搜索邮箱"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <TextField
          select
          label="角色筛选"
          value={role}
          onChange={(event) => setRole(event.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">全部角色</MenuItem>
          <MenuItem value="admin">管理员</MenuItem>
          <MenuItem value="user">普通用户</MenuItem>
        </TextField>
        <TextField
          select
          label="状态筛选"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">全部状态</MenuItem>
          {Object.entries(statuses).map(([key, label]) => (
            <MenuItem key={key} value={key}>
              {label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <TableContainer component={Paper}>
        <Table
          sx={{
            "& th, & td:nth-of-type(2), & td:nth-of-type(4)": {
              whiteSpace: "nowrap",
            },
          }}
        >
          <TableHead>
            <TableRow>
              {["用户", "角色", "状态", "独立密码", "OM 分支", "操作"].map(
                (label) => (
                  <TableCell key={label}>{label}</TableCell>
                ),
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((user) => (
              <TableRow key={user.id}>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  {user.role === "admin" ? "管理员" : "普通用户"}
                </TableCell>
                <TableCell>
                  <Chip size="small" label={statuses[user.status]} />
                </TableCell>
                <TableCell>
                  {user.passwordConfigured ? "已设置" : "未设置"}
                </TableCell>
                <TableCell>{user.activeBranch}</TableCell>
                <TableCell>
                  <Button
                    onClick={() => {
                      setPage(1);
                      setSelected(user);
                    }}
                  >
                    详情与历史
                  </Button>
                  <Button onClick={() => setEditing(user)}>管理</Button>
                  <Button onClick={() => openOm(user.id)}>OM</Button>
                  <Button onClick={() => openWorks(user.id)}>Work</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {!rows.length && <Typography>没有匹配的用户。</Typography>}
      <Dialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>用户详情与管理历史</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <ResourceState {...detail} retry={detail.reload} />
            {detail.data && (
              <>
                <Typography>
                  {detail.data.user.email} · {statuses[detail.data.user.status]}{" "}
                  · 版本 {detail.data.user.version}
                </Typography>
                <Typography variant="h6">关联 App 身份</Typography>
                {detail.data.identities.map((identity) => (
                  <Typography key={`${identity.appId}:${identity.appUserId}`}>
                    {identity.appId} · {identity.appUserId} · {identity.email}
                  </Typography>
                ))}
                <Typography variant="h6">管理历史</Typography>
                {detail.data.history.map((event) => (
                  <Paper variant="outlined" sx={{ p: 2 }} key={event.id}>
                    <Typography>
                      {event.at} · 操作者：
                      {users.find((user) => user.id === event.actorUserId)
                        ?.email ??
                        event.actorUserId ??
                        "系统初始化 / 任务收尾"}
                    </Typography>
                    <Typography>
                      {event.before.role} / {statuses[event.before.status]} →{" "}
                      {event.after.role} / {statuses[event.after.status]}
                    </Typography>
                    <Typography>{event.reason}</Typography>
                  </Paper>
                ))}
                <Pagination
                  page={page}
                  count={Math.max(1, Math.ceil(detail.data.total / 20))}
                  onChange={(_, value) => setPage(value)}
                />
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelected(null)}>关闭</Button>
        </DialogActions>
      </Dialog>
      {editing && (
        <EditUser
          key={editing.id}
          user={editing}
          close={() => setEditing(null)}
          saved={async () => {
            await changed();
            detail.reload();
          }}
        />
      )}
    </Stack>
  );
}
function EditUser({
  user,
  close,
  saved,
}: {
  user: User;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [base, setBase] = useState(user);
  const [role, setRole] = useState(user.role);
  const [enabled, setEnabled] = useState(user.status === "active");
  const [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState(crypto.randomUUID());
  const [uncertain, setUncertain] = useState(false);
  const c = useCommand();
  const body = {
    expectedVersion: base.version,
    requestId,
    reason,
    role,
    ...(base.status === "draining" ? {} : { enabled }),
  };
  return (
    <Dialog open onClose={c.busy ? undefined : close} fullWidth maxWidth="sm">
      <DialogTitle>管理用户</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography>
            {user.email} · 编辑版本 {base.version}
          </Typography>
          <Feedback {...c} />
          <TextField
            label="用户角色"
            select
            value={role}
            disabled={c.busy || uncertain}
            onChange={(event) => {
              setRole(event.target.value as User["role"]);
              setRequestId(crypto.randomUUID());
            }}
          >
            <MenuItem value="user">普通用户</MenuItem>
            <MenuItem value="admin">管理员</MenuItem>
          </TextField>
          <TextField
            label="账号状态"
            select
            value={
              base.status === "draining"
                ? "draining"
                : enabled
                  ? "active"
                  : "disabled"
            }
            disabled={c.busy || uncertain || base.status === "draining"}
            onChange={(event) => {
              setEnabled(event.target.value === "active");
              setRequestId(crypto.randomUUID());
            }}
          >
            <MenuItem value="active">正常</MenuItem>
            <MenuItem value="disabled">停用</MenuItem>
            {base.status === "draining" && (
              <MenuItem value="draining">停用中</MenuItem>
            )}
          </TextField>
          <Alert severity="info">
            停用后禁止新登录和新任务；已受理任务允许结束，再撤销会话。停用中需等待任务结束或主动停止后恢复。不会删除用户资源。
          </Alert>
          <TextField
            label="变更原因"
            required
            multiline
            minRows={2}
            value={reason}
            disabled={c.busy || uncertain}
            onChange={(event) => {
              setReason(event.target.value);
              setRequestId(crypto.randomUUID());
            }}
          />
          <Button
            disabled={c.busy}
            onClick={() =>
              void c.run(async () => {
                const current = await api<Detail>(
                  `/api/v1/users/${encodeURIComponent(user.id)}`,
                );
                setBase(current.user);
                setRole(current.user.role);
                setEnabled(current.user.status === "active");
                setReason("");
                setRequestId(crypto.randomUUID());
                setUncertain(false);
              })
            }
          >
            放弃本次输入并重读
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={c.busy}>
          取消
        </Button>
        <Button
          variant="contained"
          disabled={c.busy || !reason.trim()}
          onClick={() =>
            void c.run(async () => {
              setUncertain(true);
              await command(
                `/api/v1/users/${encodeURIComponent(user.id)}`,
                "PATCH",
                body,
              );
              await saved();
              close();
            })
          }
        >
          {uncertain ? "核对 / 重试原请求" : "确认变更"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
