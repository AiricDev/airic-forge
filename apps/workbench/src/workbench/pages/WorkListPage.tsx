import {
  Button,
  Link,
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
  Chip,
} from "@mui/material";
import type { User, WorkPage } from "../types";
import type { Navigation } from "../navigation";
import { useResource } from "../hooks";
import { PageHeading, ResourceState } from "../ui";
export function WorkListPage({
  user,
  users,
  navigation: n,
}: {
  user: User;
  users: User[];
  navigation: Navigation;
}) {
  const r = n.route;
  const owner = user.role === "admin" ? r.owner || "all" : user.id;
  const query = new URLSearchParams({ page: String(r.page) });
  if (owner !== "all") query.set("ownerId", owner);
  if (r.workType) query.set("workType", r.workType);
  if (r.status) query.set("status", r.status);
  const resource = useResource<WorkPage>(`/api/v1/works?${query}`);
  const filter = (changes: Partial<typeof r>) =>
    n.list({ ...changes, page: 1 });
  return (
    <Stack spacing={3}>
      <PageHeading
        title="Work 与轨迹"
        description="查看 App 工作、对话轨迹与 Reflection。"
      />
      <Paper sx={{ p: 2 }}>
        <Stack
          direction="row"
          aria-label="Work 筛选器"
          sx={{
            flexWrap: "wrap",
            gap: 2,
          }}
        >
          {user.role === "admin" && (
            <TextField
              select
              label="筛选 Work 用户"
              value={owner}
              onChange={(e) => filter({ owner: e.target.value })}
              sx={{ minWidth: 220, flex: 1 }}
            >
              <MenuItem value="all">全部用户</MenuItem>
              {users.map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  {u.email}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField
            select
            label="筛选 Work 类型"
            value={r.workType}
            onChange={(e) => filter({ workType: e.target.value })}
            sx={{ minWidth: 200, flex: 1 }}
          >
            <MenuItem value="">全部类型</MenuItem>
            <MenuItem value="report-authoring">报告编制</MenuItem>
            <MenuItem value="report-type-definition">Report Type 定义</MenuItem>
          </TextField>
          <TextField
            select
            label="筛选 Work 状态"
            value={r.status}
            onChange={(e) => filter({ status: e.target.value })}
            sx={{ minWidth: 180, flex: 1 }}
          >
            <MenuItem value="">全部状态</MenuItem>
            <MenuItem value="active">进行中</MenuItem>
            <MenuItem value="completed">已结束</MenuItem>
          </TextField>
          <Button
            onClick={() =>
              filter({
                owner: user.role === "admin" ? "all" : user.id,
                workType: "",
                status: "",
              })
            }
          >
            清除筛选
          </Button>
        </Stack>
      </Paper>
      <ResourceState {...resource} retry={resource.reload} />
      {resource.data && (
        <Paper>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Work</TableCell>
                  <TableCell>类型 / 业务对象</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>
                    最新活动
                  </TableCell>
                  {user.role === "admin" && <TableCell>所有者</TableCell>}
                  <TableCell
                    align="right"
                    sx={{ display: { xs: "none", sm: "table-cell" } }}
                  >
                    操作
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {resource.data.works.map((work) => (
                  <TableRow key={work.id} hover>
                    <TableCell>
                      <Link
                        href={n.workHref(work.id)}
                        onClick={(e) => {
                          if (
                            !e.ctrlKey &&
                            !e.metaKey &&
                            !e.shiftKey &&
                            e.button === 0
                          ) {
                            e.preventDefault();
                            n.openWork(work.id);
                          }
                        }}
                      >
                        {work.entityTitle || work.entityId}
                      </Link>
                      <Typography
                        variant="caption"
                        sx={{
                          display: { xs: "none", sm: "block" },
                          overflowWrap: "anywhere",
                        }}
                      >
                        {work.id}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {work.workType === "report-authoring"
                        ? "报告评估"
                        : "Report Type 定义"}
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          display: { xs: "none", sm: "block" },
                          overflowWrap: "anywhere",
                        }}
                      >
                        {work.entityId}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={work.status === "active" ? "进行中" : "已结束"}
                        color={work.status === "active" ? "primary" : "default"}
                      />
                    </TableCell>
                    <TableCell
                      sx={{ display: { xs: "none", sm: "table-cell" } }}
                    >
                      {new Date(work.updatedAt).toLocaleString()}
                    </TableCell>
                    {user.role === "admin" && (
                      <TableCell>
                        {users.find((u) => u.id === work.ownerUserId)?.email ??
                          work.ownerUserId}
                      </TableCell>
                    )}
                    <TableCell
                      align="right"
                      sx={{ display: { xs: "none", sm: "table-cell" } }}
                    >
                      <Button onClick={() => n.openWork(work.id, "reflection")}>
                        查看 Reflection
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!resource.data.works.length && (
                  <TableRow>
                    <TableCell colSpan={user.role === "admin" ? 6 : 5}>
                      没有符合筛选条件的 Work
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <Stack
            direction="row"
            sx={{
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 2,
              ...{ p: 2 },
            }}
          >
            <Typography>
              共 {resource.data.total} 条 · 第 {r.page} /{" "}
              {resource.data.totalPages} 页
            </Typography>
            <Pagination
              aria-label="Work 分页"
              count={resource.data.totalPages}
              page={r.page}
              onChange={(_, page) => n.list({ page })}
            />
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
