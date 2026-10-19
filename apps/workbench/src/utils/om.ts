export type TreeNode =
  | { type: "folder"; path: string; name: string; children: TreeNode[] }
  | { type: "file"; path: string; name: string };

function sortNodes(nodes: TreeNode[]) {
  const rank = (n: TreeNode) =>
    n.type === "file" && n.name === "work.yml"
      ? 0
      : n.type === "file" && n.name === "README.md"
        ? 3
        : n.type === "folder"
          ? 1
          : 2;
  nodes.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  nodes.forEach((n) => n.type === "folder" && sortNodes(n.children));
}

export function buildTree(files: ReadonlyArray<{ path: string }>): TreeNode[] {
  const root: TreeNode[] = [];
  for (const file of files) {
    const segments = file.path.split("/");
    let level = root;
    let acc = "";
    for (const seg of segments.slice(0, -1)) {
      acc = acc ? `${acc}/${seg}` : seg;
      let folder = level.find(
        (n): n is Extract<TreeNode, { type: "folder" }> =>
          n.type === "folder" && n.path === acc,
      );
      if (!folder) {
        folder = { type: "folder", path: acc, name: seg, children: [] };
        level.push(folder);
      }
      level = folder.children;
    }
    level.push({
      type: "file",
      path: file.path,
      name: segments[segments.length - 1],
    });
  }
  const order = ["work-definitions", "subject-knowledge"];
  root.sort((a, b) => {
    const ia = order.indexOf(a.path);
    const ib = order.indexOf(b.path);
    return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib);
  });
  root.forEach((n) => n.type === "folder" && sortNodes(n.children));
  return root;
}
