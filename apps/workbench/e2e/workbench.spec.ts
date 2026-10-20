import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const password = "MUI-browser-password-123";
const images = resolve("test-results/visual");
async function login(page: Page, role: "owner" | "admin" | "member" = "owner") {
  await page.goto("/");
  await page.getByLabel(/^Email/).fill(`mui-${role}@example.invalid`);
  await page.getByLabel(/^密码/).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: `你好，mui-${role}@example.invalid` }),
  ).toBeVisible();
}
async function nav(page: Page, name: string) {
  if (name === "能力目录") {
    await nav(page, "实例设置");
    await page.getByRole("tab", { name: "能力目录", exact: true }).click();
    return;
  }
  await page.getByRole("button", { name, exact: true }).click();
}
async function work(page: Page, entity: string) {
  for (let index = 1; index <= 3; index++) {
    const me = await (await page.request.get("/api/v1/auth/me")).json();
    const response = await page.request.get(
      `/api/v1/works?page=${index}&ownerId=${me.user.id}`,
    );
    expect(response.ok()).toBeTruthy();
    const data = (await response.json()) as {
      works: Array<{ id: string; entityId: string }>;
    };
    const found = data.works.find((item) => item.entityId === entity);
    if (found) return found.id;
  }
  throw new Error(`Missing fixture ${entity}`);
}
async function screenshot(page: Page, name: string) {
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.locator(".MuiDrawer-modal")).not.toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(images, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

test("real API pagination, filters, detail refresh and return location", async ({
  page,
}) => {
  await login(page);
  await nav(page, "Work 与轨迹");
  await expect(page.getByText("共 45 条 · 第 1 / 3 页")).toBeVisible();
  await page.getByRole("button", { name: "转到第 2 页" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText("共 45 条 · 第 2 / 3 页")).toBeVisible();
  const row = page.getByRole("row").nth(1);
  const id = await row.locator("span").first().textContent();
  await row.getByRole("link").click();
  await expect(page).toHaveURL(/\/works\/.+page=2/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Work 详情" })).toBeVisible();
  if (id)
    await expect(page.getByText(id, { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "返回 Work 列表" }).click();
  await expect(page.getByText("共 45 条 · 第 2 / 3 页")).toBeVisible();
  await page.getByRole("combobox", { name: "筛选 Work 类型" }).click();
  await page.getByRole("option", { name: "报告编制" }).click();
  await expect(page).toHaveURL(/page=1.*workType=report-authoring/);
  await expect(page.getByText("共 23 条 · 第 1 / 2 页")).toBeVisible();
  await screenshot(page, "work-list");
});

test("Reflection citations reveal earlier Turns and commit confirmed draft changes", async ({
  page,
}) => {
  await login(page);
  const id = await work(page, "mui-report-0");
  await page.goto(`/works/${id}?owner=all&page=2&tab=reflection`);
  await expect(
    page.getByRole("heading", { name: "这个 Work 的 Reflection" }),
  ).toBeVisible();
  await screenshot(page, "reflection");
  const source = page.getByRole("link", {
    name: "来源 event-0-0",
    exact: true,
  });
  await source.click();
  await expect(page).toHaveURL(/event=event-0-0/);
  await expect(page.locator("#trajectory-event-event-0-0")).toContainText(
    "检查证据位置 0-0",
  );
  await screenshot(page, "work-detail");
  await page.getByRole("button", { name: "返回 Reflection 对话" }).click();
  await expect(source).toBeVisible();
  await expect(page.getByLabel("提交后内容")).toBeVisible();
  await page.getByRole("button", { name: "确认并提交", exact: true }).click();
  await expect(
    page.getByText("OM 已提交，后续工作将使用新版本。"),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("暂无未提交改动。")).toBeVisible();
});

test("OM drafts keep HEAD, guard navigation, restore focus and support keyboard tree navigation", async ({
  page,
}) => {
  await login(page);
  await nav(page, "Operating Model");
  await expect(page.getByRole("tree", { name: "OM 仓库" })).toBeVisible();
  const tree = page.getByRole("tree");
  await tree.getByRole("treeitem").first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(tree.getByRole("treeitem").nth(1)).toBeFocused();
  await page.getByRole("button", { name: "编辑草稿", exact: true }).click();
  const input = page.getByLabel(/^编辑 work-definitions/);
  const before = await input.inputValue();
  await input.fill(`${before}\n# 私有草稿\n`);
  await nav(page, "Work 与轨迹");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "继续编辑" }).click();
  await expect(input).toHaveValue(`${before}\n# 私有草稿\n`);
  const omBefore = await (await page.request.get("/api/v1/auth/me")).json();
  const headBefore = await (
    await page.request.get(`/api/v1/om/users/${omBefore.user.id}`)
  ).json();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    page.getByText("草稿已保存；个人 OM 的 active HEAD 未改变。"),
  ).toBeVisible();
  const headAfter = await (
    await page.request.get(`/api/v1/om/users/${omBefore.user.id}`)
  ).json();
  expect(headAfter.activeRevision).toBe(headBefore.activeRevision);
  await nav(page, "Work 与轨迹");
  await nav(page, "Operating Model");
  await expect(page.getByText("有未提交草稿")).toBeVisible();
  await screenshot(page, "personal-om");
  await page.getByRole("button", { name: "编辑草稿", exact: true }).click();
  await page.getByLabel(/^编辑 work-definitions/).fill("uncommitted");
  await nav(page, "改进工作方式");
  await page.getByRole("button", { name: "放弃修改" }).click();
  await expect(
    page.getByRole("heading", { name: "改进工作方式", exact: true }),
  ).toBeVisible();
});

test("failed reads retry, rejected questions keep input, interrupted answers remain incomplete", async ({
  page,
}) => {
  await login(page);
  let fail = true;
  await page.route("**/api/v1/works?*", async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        json: { error: "FixtureUnavailable" },
      });
    } else await route.continue();
  });
  await nav(page, "Work 与轨迹");
  await expect(page.getByRole("alert")).toContainText("FixtureUnavailable");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByText("共 45 条 · 第 1 / 3 页")).toBeVisible();
  const id = await work(page, "mui-report-1");
  await page.goto(`/works/${id}?tab=reflection`);
  const input = page.getByLabel("继续 Reflection");
  await input.fill("/unknown-lens 检查证据");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByRole("alert")).toContainText("UnknownReflectionLens");
  await expect(input).toHaveValue("/unknown-lens 检查证据");
  await input.fill("fixture-failure");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "ReflectionExecutionFailed",
  );
  await expect(page.getByText("未完成的回复", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("");
  await expect(input).toBeEnabled();
  await input.fill("继续讨论");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(input).toHaveValue("");
  await page.getByRole("button", { name: /工作结果评价/ }).click();
  await page.getByLabel("评价依据").fill("证据位置仍需要人工补充");
  await page.getByRole("button", { name: "记录结果评价" }).click();
  await expect(
    page.getByText("证据位置仍需要人工补充", { exact: false }),
  ).toBeVisible();
});

test("streaming Reflection survives reload and records one final assistant message", async ({
  page,
}) => {
  await login(page);
  const id = await work(page, "mui-report-4");
  await page.goto(`/works/${id}?tab=reflection`);
  let submissions = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/reflections\/[^/]+\/runs$/.test(request.url())
    )
      submissions++;
  });
  const input = page.getByLabel("继续 Reflection");
  await expect(input).toBeEnabled();
  await input.fill("fixture-stream 请逐步反馈");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(
    page.getByText("逐步回复：第一段", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("读取 Work 轨迹 · 完成")).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("逐步回复：第一段，第二段。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("article").filter({ hasText: "逐步回复：第一段" }),
  ).toHaveCount(1);
  await expect(input).toBeEnabled();
  expect(submissions).toBe(1);
  await screenshot(page, "reflection-stream-restored");
});

test("a lost send response reconciles the same run instead of resubmitting", async ({
  page,
}) => {
  await login(page);
  const id = await work(page, "mui-report-5");
  await page.goto(`/works/${id}?tab=reflection`);
  let submissions = 0;
  await page.route("**/api/v1/reflections/*/runs", async (route) => {
    submissions++;
    await route.fetch();
    await route.abort("failed");
  });
  const input = page.getByLabel("继续 Reflection");
  await expect(input).toBeEnabled();
  await input.fill("fixture-stream 核对原请求");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(
    page
      .getByRole("log", { name: "Reflection 对话" })
      .getByRole("alert")
      .filter({ hasText: "请求结果未知" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重新连接 / 核对状态" }).click();
  await expect(input).toHaveValue("");
  await expect(
    page.getByText("逐步回复：第一段，第二段。", { exact: true }),
  ).toBeVisible();
  expect(submissions).toBe(1);
});

test("explicit stop keeps a partial answer and administrator observation cannot take authorship", async ({
  page,
}) => {
  await login(page);
  const id = await work(page, "mui-report-6");
  await page.goto(`/works/${id}?tab=reflection`);
  const input = page.getByLabel("继续 Reflection");
  await expect(input).toBeEnabled();
  await input.fill("fixture-stop 等待停止");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(
    page.getByText("逐步回复：第一段", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "停止生成" }).click();
  await expect(page.getByText("未完成的回复", { exact: true })).toBeVisible();
  await expect(input).toBeEnabled();
  await page.request.post("/api/v1/auth/logout");
  await login(page, "admin");
  await page.goto(`/works/${id}?tab=reflection`);
  await expect(page.getByText(/当前为只读查看/)).toBeVisible();
  await expect(page.getByText("未完成的回复", { exact: true })).toBeVisible();
  await expect(page.getByLabel("继续 Reflection")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "停止生成" })).toHaveCount(0);
  await screenshot(page, "reflection-admin-readonly");
});

test("catalog failure retains Dialog and restores focus; all administrative pages have visual evidence", async ({
  page,
}) => {
  await login(page, "admin");
  await screenshot(page, "dashboard");
  for (const [label, name] of [
    ["能力目录", "catalog"],
    ["组织贡献", "contributions"],
    ["用户与资源", "users"],
    ["实例设置", "settings"],
    ["成效基线", "measurements"],
    ["Lens 管理", "lenses"],
    ["改进工作方式", "reflections"],
  ] as const) {
    await nav(page, label);
    await expect(
      page.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
    if (label === "Lens 管理")
      await page.getByRole("button", { name: /Domain Knowledge/ }).click();
    await screenshot(page, name);
  }
  await nav(page, "能力目录");
  const accept = page.getByRole("button", { name: "接受候选目录" });
  await accept.click();
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();
  await expect(accept).toBeFocused();
  await page.route("**/accept-from-workspace", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "FixtureCatalogUnavailable" },
    }),
  );
  await accept.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "接受目录" })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "FixtureCatalogUnavailable",
  );
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();
  await page.unroute("**/accept-from-workspace");
  await nav(page, "Operating Model");
  await page.getByRole("combobox", { name: "OM 分支" }).click();
  await page
    .getByRole("option", { name: "main · 组织 OM", exact: true })
    .click();
  await expect(page.getByRole("tree")).toBeVisible();
  await screenshot(page, "organization-om");
  await nav(page, "Lens 管理");
  await page.getByRole("button", { name: /Domain Knowledge/ }).click();
  await page.getByLabel("Lens 提示词").fill("分析证据归因并保留来源。");
  await page.getByRole("button", { name: "保存新版本" }).click();
  await expect(
    page.getByText("Lens 配置已保存；新调用使用更新后的版本。"),
  ).toBeVisible();
});

test("real organization review enables a directly committed member sync", async ({
  page,
  browser,
}) => {
  await login(page, "admin");
  await nav(page, "组织贡献");
  await page.getByRole("button", { name: /分享证据定位方法.*open/ }).click();
  await page.getByRole("button", { name: "保存选定文件到贡献分支" }).click();
  await page.getByRole("button", { name: "采纳到组织 main" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "采纳到组织 main" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(/组织修订 /)).toBeVisible();
  const context = await browser.newContext();
  const member = await context.newPage();
  await login(member, "member");
  await nav(member, "Operating Model");
  await member.getByRole("combobox", { name: "OM 分支" }).click();
  await member.getByRole("option", { name: "main · 组织 OM" }).click();
  await member.getByRole("button", { name: "同步到我的 OM 草稿" }).click();
  await expect(member.getByRole("heading", { name: "OM 改动" })).toBeVisible();
  await member.getByRole("button", { name: "确认并提交", exact: true }).click();
  await expect(
    member.getByText("OM 已提交，后续工作将使用新版本。"),
  ).toBeVisible();
  await context.close();
});

test("ordinary user ownership and narrow-screen navigation remain accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await screenshot(page, "login-mobile");
  await login(page, "member");
  await page.getByRole("button", { name: "打开导航" }).click();
  await expect(
    page.getByRole("button", { name: "成效基线", exact: true }),
  ).toHaveCount(0);
  await nav(page, "Work 与轨迹");
  await expect(page.getByText("共 1 条 · 第 1 / 1 页")).toBeVisible();
  await screenshot(page, "work-list-mobile");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  const adminContext = await page.context().browser()!.newContext();
  const adminPage = await adminContext.newPage();
  await login(adminPage, "admin");
  const all = await (await adminPage.request.get("/api/v1/works")).json();
  const forbiddenId = all.works.find((w: { entityId: string }) =>
    w.entityId.startsWith("mui-report-"),
  ).id;
  const response = await page.request.get(`/api/v1/works/${forbiddenId}`);
  expect(response.status()).toBe(403);
  await page.goto(`/works/${forbiddenId}`);
  await expect(page.getByRole("alert")).toContainText("Forbidden");
  await adminContext.close();
});

test("stale Reflection drafts require merge and discarding preserves HEAD", async ({
  page,
}) => {
  await login(page);
  const id = await work(page, "mui-report-3");
  await page.goto(`/works/${id}?tab=reflection`);
  await expect(
    page.getByText("当前 OM 已更新。请合并最新版本，解决冲突后重新确认。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认并提交", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "合并最新版本" }).click();
  await expect(
    page.getByRole("button", { name: "确认并提交", exact: true }),
  ).toBeEnabled();
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  const before = await (
    await page.request.get(`/api/v1/om/users/${me.user.id}`)
  ).json();
  await page.getByRole("button", { name: "丢弃未提交改动" }).click();
  await expect(page.getByText("暂无未提交改动。")).toBeVisible();
  await page.reload();
  await expect(page.getByText("暂无未提交改动。")).toBeVisible();
  const after = await (
    await page.request.get(`/api/v1/om/users/${me.user.id}`)
  ).json();
  expect(after.activeRevision).toBe(before.activeRevision);
});

test("API Suggestion remains exportable without an OM Proposal", async ({
  page,
}) => {
  await login(page);
  const id = await work(page, "mui-report-2");
  await page.goto(`/works/${id}?tab=reflection`);
  await expect(
    page.getByRole("heading", { name: "API Suggestion", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看差异并审阅" }),
  ).toHaveCount(0);
  const exportUrl = await page
    .getByRole("link", { name: "导出 Markdown" })
    .getAttribute("href");
  const response = await page.request.get(exportUrl!);
  expect(response.ok()).toBeTruthy();
  expect(await response.text()).toContain("report.evidence-location");
  await screenshot(page, "api-suggestion");
});

test("browser Back preserves a dirty editor on cancel and leaves only after discard", async ({
  page,
}) => {
  await login(page);
  await nav(page, "Work 与轨迹");
  await nav(page, "Operating Model");
  await page.getByRole("button", { name: "编辑草稿", exact: true }).click();
  const input = page.getByLabel(/^编辑 work-definitions/);
  await input.fill("browser-back-unsaved");
  await page.goBack();
  await page.getByRole("button", { name: "继续编辑" }).click();
  await expect(
    page.getByRole("heading", { name: "Operating Model", exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue("browser-back-unsaved");
  await page.goBack();
  await page.getByRole("button", { name: "放弃修改" }).click();
  await expect(
    page.getByRole("heading", { name: "Work 与轨迹", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/works\?/);
});

test("initial password setup uses a real one-time ticket and then logs into the workbench", async ({
  page,
}) => {
  const metadata = JSON.parse(
    readFileSync(process.env.FORGE_E2E_METADATA!, "utf8"),
  ) as { setupTicket: string };
  await page.goto(`/#setup=${metadata.setupTicket}`);
  await expect(
    page.getByRole("heading", { name: "设置独立密码" }),
  ).toBeVisible();
  await screenshot(page, "password-setup");
  await page.getByLabel(/^密码/).fill(password);
  await page.getByLabel(/^确认密码/).fill(password);
  await page.getByRole("button", { name: "设置密码", exact: true }).click();
  await expect(page.getByRole("heading", { name: "登录工作台" })).toBeVisible();
  await expect(page).not.toHaveURL(/setup=/);
  await screenshot(page, "login");
  await page.getByLabel(/^Email/).fill("mui-setup@example.invalid");
  await page.getByLabel(/^密码/).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "你好，mui-setup@example.invalid" }),
  ).toBeVisible();
});

test("independent OM discussions survive reload and Git credentials can be revoked", async ({
  page,
}) => {
  await login(page);
  await nav(page, "改进工作方式");
  await page.getByLabel("新讨论主题").fill("改进样例分析方法");
  await page.getByRole("button", { name: "开始讨论", exact: true }).click();
  await expect(page).toHaveURL(/\/reflections\/rfl_/);
  await page
    .getByLabel("继续 Reflection")
    .fill("/domain-knowledge 请把讨论总结到 OM");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByLabel("提交后内容")).toBeVisible();
  await page.getByRole("button", { name: "确认并提交", exact: true }).click();
  await expect(
    page.getByText("OM 已提交，后续工作将使用新版本。"),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("暂无未提交改动。")).toBeVisible();
  await nav(page, "本地 agent 与 Git");
  await page.getByLabel("令牌名称").fill("浏览器测试电脑");
  await page.getByRole("button", { name: "创建 90 天访问令牌" }).click();
  await expect(page.getByText("令牌仅显示这一次，请安全保存。")).toBeVisible();
  await page.getByRole("button", { name: "已保存，隐藏令牌" }).click();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.getByText(/浏览器测试电脑.*已撤销/)).toBeVisible();
});

test("instance settings contain integration sources, OM paths and nested capability management", async ({
  page,
}) => {
  await login(page, "admin");
  await expect(
    page.getByRole("navigation").getByRole("button").first(),
  ).toHaveText("成效基线");
  await expect(
    page.getByRole("button", { name: "组织治理", exact: true }),
  ).toHaveCount(0);
  await nav(page, "成效基线");
  await expect(
    page.getByRole("heading", { name: "成效基线", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "能力目录", exact: true }),
  ).toHaveCount(0);
  await nav(page, "实例设置");
  const response = await page.request.get("/api/v1/instance-settings");
  expect(response.status()).toBe(200);
  const settings = await response.json();
  const panel = page.getByRole("tabpanel");
  await expect(
    panel.getByText(settings.operatingModel.repositoryPath, { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText(settings.operatingModel.dataPath, { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText(settings.operatingModel.personalWorktreesPath, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    panel.getByRole("link", {
      name: settings.integration.manifestUrl,
      exact: true,
    }),
  ).toHaveAttribute("href", settings.integration.manifestUrl);
  await expect(
    panel.getByRole("link", {
      name: settings.integration.openApiUrl,
      exact: true,
    }),
  ).toHaveAttribute("href", settings.integration.openApiUrl);
  await expect(panel.getByText(/Reflection lens|Lens 提示词/)).toHaveCount(0);
  await page.getByRole("tab", { name: "能力目录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "能力目录", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "接受候选目录" }),
  ).toBeVisible();
  await nav(page, "Lens 管理");
  await expect(
    page.getByRole("heading", { name: "Lens 管理", exact: true }),
  ).toBeVisible();
});
