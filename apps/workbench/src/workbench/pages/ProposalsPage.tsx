import { useState } from "react";
import {
  Button,
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
import type { ProposalPage, User } from "../types";
import type { Navigation } from "../navigation";
import { useResource } from "../hooks";
import { PageHeading, ResourceState } from "../ui";
import { ProposalReview } from "../ProposalReview";
import { useUnsavedChanges } from "../UnsavedChanges";
export function ProposalsPage({
  user,
  users,
  navigation: n,
  initialId,
}: {
  user: User;
  users: User[];
  navigation: Navigation;
  initialId?: string;
}) {
  const [owner, setOwner] = useState(
    user.role === "admin" && !initialId ? "all" : user.id,
  );
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(initialId ?? "");
  const { guard } = useUnsavedChanges();
  const query = new URLSearchParams({ page: String(page) });
  if (owner !== "all") query.set("ownerId", owner);
  if (status) query.set("status", status);
  if (source) query.set("source", source);
  const resource = useResource<ProposalPage>(`/api/v1/proposals?${query}`);
  const filter = (action: () => void) =>
    guard(() => {
      action();
      setPage(1);
      setSelected("");
    });
  const proposal = resource.data?.proposals.find((p) => p.id === selected);
  return (
    <Stack spacing={3}>
      <PageHeading
        title="提议"
        description="浏览 Work Reflection、组织同步与既有历史记录。"
      />
      <Paper sx={{ p: 2 }}>
        <Stack
          direction="row"
          aria-label="Proposal 筛选器"
          sx={{
            flexWrap: "wrap",
            gap: 2,
          }}
        >
          {user.role === "admin" && (
            <TextField
              select
              label="筛选 Proposal 用户"
              value={owner}
              onChange={(e) => filter(() => setOwner(e.target.value))}
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
            label="筛选 Proposal 状态"
            value={status}
            onChange={(e) => filter(() => setStatus(e.target.value))}
            sx={{ minWidth: 180, flex: 1 }}
          >
            <MenuItem value="">全部状态</MenuItem>
            <MenuItem value="open">待采纳</MenuItem>
            <MenuItem value="adopted">已采纳</MenuItem>
            <MenuItem value="abandoned">已放弃</MenuItem>
          </TextField>
          <TextField
            select
            label="筛选 Proposal 来源"
            value={source}
            onChange={(e) => filter(() => setSource(e.target.value))}
            sx={{ minWidth: 180, flex: 1 }}
          >
            <MenuItem value="">全部来源</MenuItem>
            <MenuItem value="personal">历史个人编辑</MenuItem>
            <MenuItem value="reflection">Work Reflection</MenuItem>
            <MenuItem value="organization-sync">组织同步</MenuItem>
          </TextField>
          <Button
            onClick={() =>
              filter(() => {
                setOwner(user.role === "admin" ? "all" : user.id);
                setStatus("");
                setSource("");
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
                  <TableCell>Proposal</TableCell>
                  <TableCell>来源</TableCell>
                  <TableCell>状态</TableCell>
                  {user.role === "admin" && <TableCell>所有者</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {resource.data.proposals.map((p) => (
                  <TableRow key={p.id} hover>
                    <TableCell>
                      <Button
                        onClick={() =>
                          p.reflectionId && p.workId
                            ? n.openWork(p.workId, "reflection")
                            : guard(() => setSelected(p.id))
                        }
                      >
                        {p.reason}
                      </Button>
                      <Typography
                        variant="caption"
                        sx={{
                          display: "block",
                        }}
                      >
                        {p.id}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {p.source.startsWith("reflection:")
                        ? "Work Reflection"
                        : p.source === "organization-sync"
                          ? "组织同步"
                          : "历史个人编辑"}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={
                          p.status === "open"
                            ? "待采纳"
                            : p.status === "adopted"
                              ? "已采纳"
                              : "已放弃"
                        }
                        color={
                          p.status === "open"
                            ? "warning"
                            : p.status === "adopted"
                              ? "success"
                              : "default"
                        }
                      />
                    </TableCell>
                    {user.role === "admin" && (
                      <TableCell>
                        {users.find((u) => u.id === p.ownerUserId)?.email ??
                          p.ownerUserId}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {!resource.data.proposals.length && (
                  <TableRow>
                    <TableCell colSpan={user.role === "admin" ? 4 : 3}>
                      没有符合筛选条件的 Proposal
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <Stack
            direction="row"
            sx={{
              gap: 2,
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              ...{ p: 2 },
            }}
          >
            <Typography>
              共 {resource.data.total} 条 · 第 {page} /{" "}
              {resource.data.totalPages} 页
            </Typography>
            <Pagination
              aria-label="Proposal 分页"
              count={resource.data.totalPages}
              page={page}
              onChange={(_, value) =>
                guard(() => {
                  setPage(value);
                  setSelected("");
                })
              }
            />
          </Stack>
        </Paper>
      )}
      {selected && (
        <Paper sx={{ p: 3, minWidth: 0 }}>
          <Button onClick={() => guard(() => setSelected(""))}>关闭详情</Button>
          <ProposalReview
            key={selected}
            id={selected}
            canWrite={
              proposal?.ownerUserId === user.id ||
              Boolean(initialId === selected)
            }
            onChanged={resource.reload}
          />
        </Paper>
      )}
    </Stack>
  );
}
