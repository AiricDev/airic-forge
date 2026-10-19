/**
 * Minimal YAML reader for WorkDefinition manifests (work.yml).
 * Supports nested maps, block lists, lists of maps and inline [a, b] arrays — the subset used by manifests.
 */
export type YamlValue =
  string | number | boolean | YamlValue[] | { [key: string]: YamlValue };
export type YamlMap = { [key: string]: YamlValue };

interface Line {
  indent: number;
  text: string;
  no: number;
}

class YamlError extends Error {
  constructor(
    message: string,
    public line: number,
  ) {
    super(message);
  }
}

function scalar(raw: string): YamlValue {
  const s = raw.trim();
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    return inner ? inner.split(",").map((x) => scalar(x)) : [];
  }
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  )
    return s.slice(1, -1);
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

const KEY = /^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/;

function parseBlock(
  lines: Line[],
  i: number,
  indent: number,
): [YamlValue, number] {
  return lines[i].text.startsWith("- ")
    ? parseList(lines, i, indent)
    : parseMap(lines, i, indent);
}

function parseMap(
  lines: Line[],
  start: number,
  indent: number,
): [YamlMap, number] {
  const obj: YamlMap = {};
  let i = start;
  while (
    i < lines.length &&
    lines[i].indent === indent &&
    !lines[i].text.startsWith("- ")
  ) {
    const line = lines[i];
    const m = KEY.exec(line.text);
    if (!m)
      throw new YamlError(
        `第 ${line.no} 行无法解析：「${line.text}」`,
        line.no,
      );
    const [, key, rest] = m;
    if (rest === undefined || rest === "") {
      const next = lines[i + 1];
      if (next && next.indent > indent) {
        const [v, ni] = parseBlock(lines, i + 1, next.indent);
        obj[key] = v;
        i = ni;
      } else {
        obj[key] = "";
        i++;
      }
    } else {
      obj[key] = scalar(rest);
      i++;
    }
    if (i < lines.length && lines[i].indent > indent)
      throw new YamlError(`第 ${lines[i].no} 行缩进不正确`, lines[i].no);
  }
  return [obj, i];
}

function parseList(
  lines: Line[],
  start: number,
  indent: number,
): [YamlValue[], number] {
  const arr: YamlValue[] = [];
  let i = start;
  while (
    i < lines.length &&
    lines[i].indent === indent &&
    lines[i].text.startsWith("- ")
  ) {
    const rest = lines[i].text.slice(2).trim();
    if (KEY.test(rest)) {
      lines[i] = { indent: indent + 2, text: rest, no: lines[i].no };
      const [v, ni] = parseMap(lines, i, indent + 2);
      arr.push(v);
      i = ni;
    } else {
      arr.push(scalar(rest));
      i++;
    }
  }
  return [arr, i];
}

export function parseYaml(src: string): YamlMap {
  const lines: Line[] = [];
  src.split("\n").forEach((raw, idx) => {
    if (!raw.trim() || raw.trim().startsWith("#")) return;
    if (raw.includes("\t"))
      throw new YamlError(
        `第 ${idx + 1} 行包含制表符，请使用空格缩进`,
        idx + 1,
      );
    lines.push({
      indent: raw.length - raw.trimStart().length,
      text: raw.trim(),
      no: idx + 1,
    });
  });
  if (!lines.length) return {};
  if (lines[0].indent !== 0)
    throw new YamlError(`第 ${lines[0].no} 行缩进不正确`, lines[0].no);
  const [value, i] = parseMap(lines, 0, 0);
  if (i < lines.length)
    throw new YamlError(
      `第 ${lines[i].no} 行无法解析：「${lines[i].text}」`,
      lines[i].no,
    );
  return value;
}
