import {
  Box,
  Button,
  Chip,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import type { OmSnapshot, Proposal, User, WorkPage } from "../types";
import type { Navigation } from "../navigation";
import { useResource } from "../hooks";
import { PageHeading, ResourceState } from "../ui";
export function DashboardPage({
  user,
  navigation: n,
  openOm,
  openProposal,
}: {
  user: User;
  navigation: Navigation;
  openOm: () => void;
  openProposal: (p: Proposal) => void;
}) {
  const om = useResource<OmSnapshot>(
    `/api/v1/om/users/${encodeURIComponent(user.id)}`,
  );
  const works = useResource<WorkPage>(
    `/api/v1/users/${encodeURIComponent(user.id)}/works?page=1`,
  );
  const proposals = useResource<{
    proposals: Proposal[];
  }>(`/api/v1/users/${encodeURIComponent(user.id)}/proposals`);
  const open =
    proposals.data?.proposals.filter((p) => p.status === "open").slice(0, 5) ??
    [];
  return (
    <Stack spacing={3}>
      <PageHeading
        title={`你好，${user.email}`}
        description="继续你的 Work，处理待审阅的 Proposal，或查看当前生效的个人 OM。"
      />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "2fr 1fr" },
          gap: 3,
        }}
      >
        <Paper sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h6">当前 active OM</Typography>
            <ResourceState {...om} retry={om.reload} />
            {om.data && (
              <>
                <Typography sx={{ overflowWrap: "anywhere" }}>
                  {om.data.activeRevision}
                </Typography>
                <Typography color="text.secondary">
                  {om.data.branch} · {om.data.files.length} 个文件
                </Typography>
                <Stack
                  direction="row"
                  sx={{
                    gap: 1,
                    flexWrap: "wrap",
                  }}
                >
                  {[
                    ...new Set(
                      om.data.files
                        .filter((p) => p.endsWith("/work.yml"))
                        .map((p) => p.split("/")[1]),
                    ),
                  ].map((value) => (
                    <Chip key={value} label={value} />
                  ))}
                </Stack>
              </>
            )}
            <Button onClick={openOm}>浏览个人 OM</Button>
          </Stack>
        </Paper>
        <Paper sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h6">在 App 中继续</Typography>
            <Typography>
              从 CertLab 的报告评估工作台打开 Copilot，继续已绑定的 Work。
            </Typography>
            <Button onClick={() => n.list({ owner: user.id, page: 1 })}>
              查看我的 Work
            </Button>
          </Stack>
        </Paper>
      </Box>
      <Paper sx={{ p: 3 }}>
        <Stack
          direction="row"
          sx={{
            justifyContent: "space-between",
          }}
        >
          <Typography variant="h6">需要继续处理的 Proposal</Typography>
          <Button onClick={() => n.navigate("proposals")}>全部提议</Button>
        </Stack>
        <ResourceState {...proposals} retry={proposals.reload} />
        <List>
          {open.map((p) => (
            <ListItemButton key={p.id} onClick={() => openProposal(p)}>
              <ListItemText
                primary={p.reason}
                secondary={`${p.id} · ${p.source}`}
              />
              <Chip label="待采纳" color="warning" />
            </ListItemButton>
          ))}
        </List>
        {proposals.data && !open.length && (
          <Typography color="text.secondary">没有待审阅的 Proposal</Typography>
        )}
      </Paper>
      <Paper sx={{ p: 3 }}>
        <Stack
          direction="row"
          sx={{
            justifyContent: "space-between",
          }}
        >
          <Typography variant="h6">最近 Work</Typography>
          <Button onClick={() => n.list({ owner: user.id, page: 1 })}>
            全部 Work
          </Button>
        </Stack>
        <ResourceState {...works} retry={works.reload} />
        <List>
          {works.data?.works.slice(0, 5).map((work) => (
            <ListItemButton key={work.id} onClick={() => n.openWork(work.id)}>
              <ListItemText
                primary={`${work.workType} · ${work.entityId}`}
                secondary={`${work.id} · ${new Date(work.updatedAt).toLocaleString()}`}
              />
              <Chip label={work.status === "active" ? "进行中" : "已结束"} />
            </ListItemButton>
          ))}
        </List>
        {works.data && !works.data.works.length && (
          <Typography color="text.secondary">暂无 Work</Typography>
        )}
      </Paper>
    </Stack>
  );
}
