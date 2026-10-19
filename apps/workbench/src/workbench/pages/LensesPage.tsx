import { useState } from "react";
import {
  Box,
  Button,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import type { ReflectionLens } from "../types";
import { command } from "../api";
import { useResource, useCommand } from "../hooks";
import { Feedback, PageHeading, ResourceState } from "../ui";
import { useDirty, useUnsavedChanges } from "../UnsavedChanges";
import { lensName } from "../labels";
export function LensesPage() {
  const resource = useResource<{
    lenses: ReflectionLens[];
  }>("/api/v1/reflection-lenses");
  const c = useCommand();
  const [editor, setEditor] = useState<ReflectionLens | null>(null);
  const [original, setOriginal] = useState("");
  const { guard } = useUnsavedChanges();
  useDirty(Boolean(editor && JSON.stringify(editor) !== original));
  return (
    <Stack spacing={3}>
      <PageHeading
        title="Lens 管理"
        description="启停内置 lens，并保存版本化提示词。"
      />
      <ResourceState {...resource} retry={resource.reload} />
      <Feedback {...c} />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "280px minmax(0,1fr)" },
          gap: 3,
        }}
      >
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6">三种内置 lens</Typography>
          <List>
            {resource.data?.lenses.map((lens) => (
              <ListItemButton
                key={lens.id}
                selected={editor?.id === lens.id}
                onClick={() =>
                  guard(() => {
                    setEditor({ ...lens });
                    setOriginal(JSON.stringify(lens));
                  })
                }
              >
                <ListItemText
                  primary={lensName[lens.id]}
                  secondary={`v${lens.version} · ${lens.enabled ? "启用" : "停用"}`}
                />
              </ListItemButton>
            ))}
          </List>
        </Paper>
        <Paper sx={{ p: 3, minWidth: 0 }}>
          {editor ? (
            <Stack spacing={3}>
              <Typography variant="h6">{lensName[editor.id]}</Typography>
              <FormControlLabel
                label="启用"
                control={
                  <Switch
                    checked={editor.enabled}
                    disabled={c.busy}
                    onChange={(_, enabled) => setEditor({ ...editor, enabled })}
                  />
                }
              />
              <TextField
                label="Lens 提示词"
                multiline
                minRows={10}
                value={editor.prompt}
                disabled={c.busy}
                onChange={(e) =>
                  setEditor({ ...editor, prompt: e.target.value })
                }
              />
              <Button
                variant="contained"
                disabled={c.busy}
                onClick={() =>
                  void c.run(async () => {
                    const saved = await command<ReflectionLens>(
                      `/api/v1/reflection-lenses/${editor.id}`,
                      "PATCH",
                      { enabled: editor.enabled, prompt: editor.prompt },
                    );
                    setEditor(saved);
                    setOriginal(JSON.stringify(saved));
                    resource.reload();
                  }, "Lens 配置已保存；新调用使用更新后的版本。")
                }
              >
                保存新版本
              </Button>
            </Stack>
          ) : (
            <Typography color="text.secondary">
              选择 lens 查看和编辑提示词。
            </Typography>
          )}
        </Paper>
      </Box>
    </Stack>
  );
}
