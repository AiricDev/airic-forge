import { useId } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <Stack spacing={1}>
      <Stack
        direction="row"
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
          flexWrap: "wrap",
        }}
      >
        <Typography variant="h4" component="h1">
          {title}
        </Typography>
        {children}
      </Stack>
      {description && (
        <Typography color="text.secondary">{description}</Typography>
      )}
    </Stack>
  );
}
export function ResourceState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
}) {
  return loading ? (
    <Stack
      direction="row"
      spacing={2}
      role="status"
      sx={{
        alignItems: "center",
      }}
    >
      <CircularProgress size={24} />
      <Typography>正在读取…</Typography>
    </Stack>
  ) : error ? (
    <Alert
      severity="error"
      action={
        <Button color="inherit" onClick={retry}>
          重试
        </Button>
      }
    >
      {error}
    </Alert>
  ) : null;
}
export function Feedback({
  error,
  notice,
  clearNotice,
}: {
  error: string;
  notice: string;
  clearNotice: () => void;
}) {
  return (
    <>
      {error && <Alert severity="error">{error}</Alert>}
      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={6000}
        onClose={(_, reason) => {
          if (reason !== "clickaway") clearNotice();
        }}
        message={notice}
      />
    </>
  );
}
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  busy = false,
  error = "",
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const id = useId();
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onCancel();
      }}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle id={`${id}-title`}>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText id={`${id}-description`}>
          {description}
        </DialogContentText>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button autoFocus disabled={busy} onClick={onCancel}>
          取消
        </Button>
        <Button variant="contained" disabled={busy} onClick={onConfirm}>
          {busy ? "处理中…" : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
export function CodeBlock({ children }: { children: ReactNode }) {
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 2,
        maxHeight: 680,
        overflow: "auto",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        fontFamily: "monospace",
        fontSize: "0.875rem",
        bgcolor: "action.hover",
        borderRadius: 1,
      }}
    >
      {children}
    </Box>
  );
}
