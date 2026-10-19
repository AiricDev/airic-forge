import { useState } from "react";
import {
  Button,
  Container,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { AuthResult } from "./types";
import { command } from "./api";
import { useCommand } from "./hooks";
import { Feedback } from "./ui";
export function AuthPage({
  ticket,
  onLogin,
  onPasswordSet,
}: {
  ticket: string;
  onLogin: (result: AuthResult) => void;
  onPasswordSet: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const c = useCommand();
  return (
    <Container component="main" maxWidth="sm" sx={{ py: 8 }}>
      <Paper sx={{ p: { xs: 3, sm: 4 } }}>
        <Stack
          component="form"
          spacing={3}
          onSubmit={(event) => {
            event.preventDefault();
            void c.run(async () => {
              if (ticket) {
                if (password !== confirm)
                  throw new Error("两次输入的密码不一致");
                await command(
                  `/api/v1/app-sessions/${encodeURIComponent(ticket)}/password`,
                  "POST",
                  { password },
                );
                await command("/api/v1/auth/logout").catch(() => undefined);
                setPassword("");
                setConfirm("");
                onPasswordSet();
              } else {
                const result = await command<AuthResult>(
                  "/api/v1/auth/login",
                  "POST",
                  { email, password },
                );
                setPassword("");
                onLogin(result);
              }
            });
          }}
        >
          <Typography variant="h6">AiricForge</Typography>
          <Typography variant="h4" component="h1">
            {ticket ? "设置独立密码" : "登录工作台"}
          </Typography>
          <Typography color="text.secondary">
            {ticket
              ? "设置后即可登录 AiricForge 工作台。"
              : "使用 AiricForge 独立账户登录。"}
          </Typography>
          <Feedback {...c} />
          {!ticket && (
            <TextField
              label="Email"
              type="email"
              required
              autoComplete="username"
              value={email}
              disabled={c.busy}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
          <TextField
            label="密码"
            type="password"
            required
            autoComplete={ticket ? "new-password" : "current-password"}
            value={password}
            disabled={c.busy}
            onChange={(e) => setPassword(e.target.value)}
            slotProps={{ htmlInput: { minLength: ticket ? 12 : undefined } }}
          />
          {ticket && (
            <TextField
              label="确认密码"
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              disabled={c.busy}
              onChange={(e) => setConfirm(e.target.value)}
              slotProps={{ htmlInput: { minLength: 12 } }}
            />
          )}
          <Button variant="contained" type="submit" disabled={c.busy}>
            {c.busy ? "处理中…" : ticket ? "设置密码" : "登录"}
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}
