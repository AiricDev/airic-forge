import { Fragment } from "react";
import type { ReactNode } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  List,
  ListItem,
  Stack,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { parseYaml, type YamlValue } from "../utils/manifest";
import { CodeBlock } from "./ui";
import type { LiveWorkDefinition } from "./types";
function object(value: YamlValue | undefined): Record<string, YamlValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
function strings(value: YamlValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
export function draftWorkDefinition(
  content: string,
): LiveWorkDefinition | null {
  try {
    const raw = parseYaml(content);
    const knowledge = object(raw.knowledge);
    const completion = object(raw.completion);
    if (
      typeof raw.id !== "string" ||
      typeof raw.title !== "string" ||
      !Array.isArray(raw.documents)
    )
      return null;
    const documents = raw.documents
      .map((item) => object(item))
      .map((item) => ({
        id: item.id,
        path: item.path,
        title: item.title,
        role: item.role,
        load: item.load,
      }));
    if (
      documents.some((item) =>
        Object.values(item).some((value) => typeof value !== "string"),
      )
    )
      return null;
    return {
      schemaVersion:
        typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0,
      id: raw.id,
      title: raw.title,
      description: typeof raw.description === "string" ? raw.description : "",
      documents: documents as LiveWorkDefinition["documents"],
      knowledge: {
        bootstrap: strings(knowledge.bootstrap),
        available: strings(knowledge.available),
      },
      completion: {
        mode: typeof completion.mode === "string" ? completion.mode : undefined,
      },
    };
  } catch {
    return null;
  }
}
export function ManifestPreview({
  path,
  content,
  definition: d,
  files,
  select,
}: {
  path: string;
  content: string;
  definition: LiveWorkDefinition;
  files: string[];
  select: (path: string) => void;
}) {
  const root = path.slice(0, -"/work.yml".length);
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5">{d.title}</Typography>
        <Typography color="text.secondary">
          {d.id} · schema v{d.schemaVersion}
        </Typography>
        <Typography sx={{ mt: 1 }}>{d.description}</Typography>
      </Box>
      <Box>
        <Typography variant="h6">工作文档（{d.documents.length}）</Typography>
        <List>
          {d.documents.map((doc) => (
            <ListItem
              key={doc.id}
              disableGutters
              sx={{ gap: 1, flexWrap: "wrap" }}
            >
              <Button
                disabled={!files.includes(`${root}/${doc.path}`)}
                onClick={() => select(`${root}/${doc.path}`)}
              >
                {doc.title}
              </Button>
              <Typography variant="body2">
                {doc.path} · {doc.role} ·{" "}
                {doc.load === "required" ? "必需" : "按需"}
              </Typography>
              {!files.includes(`${root}/${doc.path}`) && (
                <Chip label="文件缺失" color="error" />
              )}
            </ListItem>
          ))}
        </List>
      </Box>
      <Alert severity="info">
        工具由 App MCP 按当前身份提供，WD 不限制工具范围。
      </Alert>
      <Box>
        <Typography variant="h6">Subject Knowledge</Typography>
        <Typography>
          启动加载：{d.knowledge.bootstrap.join("、") || "无"}
        </Typography>
        <Typography>
          按需可用：{d.knowledge.available.join("、") || "无"}
        </Typography>
      </Box>
      <Box>
        <Typography variant="h6">完成判定</Typography>
        <Typography>
          {d.completion.mode === "user"
            ? "由用户结束 Work"
            : d.completion.mode || "未声明"}{" "}
        </Typography>
      </Box>
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          YAML 源文档
        </AccordionSummary>
        <AccordionDetails>
          <CodeBlock>{content}</CodeBlock>
        </AccordionDetails>
      </Accordion>
    </Stack>
  );
}
function inline(
  text: string,
  files: string[],
  select: (path: string) => void,
): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\[\[(?:cap|doc):[^\]]+\]\])/g)
    .map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**"))
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("`") && part.endsWith("`"))
        return (
          <Box
            component="code"
            key={i}
            sx={{ fontFamily: "monospace", bgcolor: "action.hover", px: 0.5 }}
          >
            {part.slice(1, -1)}
          </Box>
        );
      const ref = /^\[\[(cap|doc):([^\]]+)\]\]$/.exec(part);
      if (ref?.[1] === "cap")
        return <Chip key={i} label={ref[2]} size="small" />;
      if (ref?.[1] === "doc")
        return (
          <Button
            key={i}
            disabled={!files.includes(ref[2])}
            onClick={() => select(ref[2])}
          >
            {ref[2]}
          </Button>
        );
      return <Fragment key={i}>{part}</Fragment>;
    });
}
export function MarkdownPreview({
  content,
  files,
  select,
}: {
  content: string;
  files: string[];
  select: (path: string) => void;
}) {
  return (
    <Stack spacing={2} sx={{ overflowWrap: "anywhere" }}>
      {content.split("\n").map((raw, i) => {
        const text = raw.trim();
        if (!text) return null;
        const heading = /^(#{1,3}) (.*)$/.exec(text);
        if (heading)
          return (
            <Typography
              key={i}
              variant={
                heading[1].length === 1
                  ? "h5"
                  : heading[1].length === 2
                    ? "h6"
                    : "subtitle1"
              }
              component={
                heading[1].length === 1
                  ? "h2"
                  : heading[1].length === 2
                    ? "h3"
                    : "h4"
              }
            >
              {inline(heading[2], files, select)}
            </Typography>
          );
        return (
          <Typography key={i}>
            {/^[-*] /.test(text) ? "• " : ""}
            {inline(/^[-*] /.test(text) ? text.slice(2) : text, files, select)}
          </Typography>
        );
      })}
    </Stack>
  );
}
