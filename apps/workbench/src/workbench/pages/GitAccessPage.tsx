import { useState } from "react";
import {
  Alert,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useCommand, useResource } from "../hooks";
import { command } from "../api";
import { CodeBlock, Feedback, PageHeading, ResourceState } from "../ui";
type Token = {
  id: string;
  name: string;
  expiresAt: string;
  revokedAt?: string;
};
export function GitAccessPage() {
  const data = useResource<{ cloneUrl: string; tokens: Token[] }>(
    "/api/v1/git/tokens",
  );
  const c = useCommand();
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  return (
    <Stack spacing={3}>
      <PageHeading
        title="本地 agent 与 Git"
        description="把个人 OM 克隆到本地，用你选择的 agent 改进工作方式，提交并 push 即可在服务器生效。"
      />
      <ResourceState {...data} retry={data.reload} />
      <Feedback {...c} />
      <Paper sx={{ p: 3 }}>
        <Stack spacing={2}>
          <CodeBlock>{`git clone ${data.data?.cloneUrl ?? "<个人 OM 地址>"} my-om\ncd my-om\n# 本地讨论、修改后\ngit add work-definitions subject-knowledge precedents\ngit commit -m "改进工作方法"\ngit push origin main`}</CodeBlock>
          <Typography>
            Git 提示身份时填写任意用户名，以访问令牌作为密码。建议使用系统
            credential helper，不把令牌写入地址或 OM。令牌只能读写你自己的
            OM，不能写组织版本或其他分支。
          </Typography>
          <Alert severity="info">
            只有成功 push 才在服务器生效。网页提交后请先
            pull；不支持强推。报告原件、讨论记录和凭据不要提交到 OM。
          </Alert>
          <TextField
            label="令牌名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            disabled={c.busy || !name.trim()}
            onClick={() =>
              void c.run(async () => {
                const result = await command<{ secret: string }>(
                  "/api/v1/git/tokens",
                  "POST",
                  { name, days: 90 },
                );
                setSecret(result.secret);
                setName("");
                data.reload();
              })
            }
          >
            创建 90 天访问令牌
          </Button>
          {secret && (
            <Alert severity="warning">
              <Typography>令牌仅显示这一次，请安全保存。</Typography>
              <CodeBlock>{secret}</CodeBlock>
              <Button onClick={() => setSecret("")}>已保存，隐藏令牌</Button>
            </Alert>
          )}
          {data.data?.tokens.map((token) => (
            <Stack
              key={token.id}
              direction="row"
              sx={{ gap: 2, alignItems: "center" }}
            >
              <Typography>
                {token.name} ·{" "}
                {token.revokedAt ? "已撤销" : `到期 ${token.expiresAt}`}
              </Typography>
              <Button
                disabled={c.busy || !!token.revokedAt}
                onClick={() =>
                  void c.run(async () => {
                    await command(`/api/v1/git/tokens/${token.id}`, "DELETE");
                    data.reload();
                  })
                }
              >
                撤销
              </Button>
            </Stack>
          ))}
        </Stack>
      </Paper>
    </Stack>
  );
}
