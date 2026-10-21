import { Box, Link, List, Paper, Stack, Typography } from "@mui/material";
import type { Baseline, InstanceSettings } from "../types";
import { useResource } from "../hooks";
import { PageHeading, ResourceState } from "../ui";
import { activityLabel, baselineValue, feedbackLabel } from "../labels";
import type { WorkFeedbackKind } from "../types";
export { UsersPage } from "./UsersPage";

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
  const data = settings.data;
  return (
    <Stack spacing={3}>
      <PageHeading
        title="实例设置"
        description="查看实际生效的系统对接与 OM 存储位置。"
      />
      <Stack spacing={3}>
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
                <Typography>传输类型：{data.integration.transport}</Typography>
                {[
                  ["App 实例地址", data.integration.baseUrl],
                  ["MCP 地址", data.integration.mcpUrl],
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
                  能力列表与输入输出定义来自 App 的 MCP 工具。连接需要 App
                  身份认证，AiricForge 不会将访问令牌附加到链接。
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
    </Stack>
  );
}
