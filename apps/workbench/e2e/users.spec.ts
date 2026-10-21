import { expect, test, type Page } from "@playwright/test";
async function login(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel(/^Email/).fill(`mui-${name}@example.invalid`);
  await page.getByLabel(/^密码/).fill("MUI-browser-password-123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: `你好，mui-${name}@example.invalid` }),
  ).toBeVisible();
}
const payload = (version: number, patch: object) => ({
  expectedVersion: version,
  requestId: crypto.randomUUID(),
  reason: "Browser account administration",
  ...patch,
});
test("initial admin manages roles, details, conflicts, disable and restore", async ({
  page,
}) => {
  await login(page, "initial-admin");
  await page.getByRole("button", { name: "用户与资源", exact: true }).click();
  await page.getByLabel("搜索邮箱").fill("mui-managed@");
  const row = page
    .getByRole("row")
    .filter({ hasText: "mui-managed@example.invalid" });
  await expect(row).toContainText("普通用户");
  await expect(row).toContainText("已设置");
  const users = (await (await page.request.get("/api/v1/users")).json()).users;
  const target = users.find(
    (user: { email: string }) => user.email === "mui-managed@example.invalid",
  );
  await row.getByRole("button", { name: "管理", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("变更原因").fill("Keep my conflict input");
  expect(
    (
      await page.request.patch(`/api/v1/users/${target.id}`, {
        data: payload(target.version, { role: "admin" }),
      })
    ).ok(),
  ).toBeTruthy();
  await dialog.getByRole("button", { name: "确认变更" }).click();
  await expect(dialog.getByRole("alert").first()).toContainText(
    "已保留本次输入",
  );
  await expect(dialog.getByLabel("变更原因")).toHaveValue(
    "Keep my conflict input",
  );
  await dialog.getByRole("button", { name: "放弃本次输入并重读" }).click();
  await expect(dialog.getByLabel("变更原因")).toHaveValue("");
  await dialog.getByLabel("用户角色").click();
  await page.getByRole("option", { name: "普通用户", exact: true }).click();
  await dialog.getByLabel("账号状态").click();
  await page.getByRole("option", { name: "停用", exact: true }).click();
  await dialog.getByLabel("变更原因").fill("Disable for browser verification");
  await dialog.getByRole("button", { name: "确认变更" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText("已停用");
  await row.getByRole("button", { name: "详情与历史" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Disable for browser verification",
  );
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await row.getByRole("button", { name: "管理", exact: true }).click();
  await dialog.getByLabel("账号状态").click();
  await page.getByRole("option", { name: "正常", exact: true }).click();
  await dialog.getByLabel("变更原因").fill("Restore after verification");
  await dialog.getByRole("button", { name: "确认变更" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText("正常");
  await page
    .getByRole("button", { name: "Operating Model", exact: true })
    .click();
  await page.getByRole("combobox", { name: "OM 分支" }).click();
  await expect(
    page.getByRole("option", { name: /组织/ }).first(),
  ).toBeVisible();
});
test("self-demotion immediately hides administration and direct requests are forbidden", async ({
  page,
}) => {
  await login(page, "manager");
  await page.getByRole("button", { name: "用户与资源", exact: true }).click();
  await page.getByLabel("搜索邮箱").fill("mui-manager@");
  await page
    .getByRole("row")
    .filter({ hasText: "mui-manager@example.invalid" })
    .getByRole("button", { name: "管理", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("用户角色").click();
  await page.getByRole("option", { name: "普通用户", exact: true }).click();
  await dialog.getByLabel("变更原因").fill("Self-demotion verification");
  await dialog.getByRole("button", { name: "确认变更" }).click();
  await expect(
    page.getByRole("button", { name: "用户与资源", exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/v1/users")).status()).toBe(403);
  const me = (await (await page.request.get("/api/v1/auth/me")).json()).user;
  expect(
    (
      await page.request.patch(`/api/v1/users/${me.id}`, {
        data: payload(me.version, { role: "admin" }),
      })
    ).status(),
  ).toBe(403);
});

test("draining is visible and permits stopping the accepted Reflection only", async ({
  page,
  browser,
}) => {
  await login(page, "managed");
  await page.getByRole("button", { name: "改进工作方式", exact: true }).click();
  await page.getByLabel("新讨论主题").fill("Draining browser verification");
  await page.getByRole("button", { name: "开始讨论", exact: true }).click();
  await page.getByLabel("继续 Reflection").fill("fixture-stop draining");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(
    page.getByText("逐步回复：第一段", { exact: true }),
  ).toBeVisible();
  const context = await browser.newContext();
  const admin = await context.newPage();
  try {
    await login(admin, "initial-admin");
    const users = (await (await admin.request.get("/api/v1/users")).json())
      .users;
    const target = users.find(
      (user: { email: string }) => user.email === "mui-managed@example.invalid",
    );
    const response = await admin.request.patch(`/api/v1/users/${target.id}`, {
      data: payload(target.version, { enabled: false }),
    });
    expect((await response.json()).user.status).toBe("draining");
    await admin
      .getByRole("button", { name: "用户与资源", exact: true })
      .click();
    await admin.getByLabel("搜索邮箱").fill("mui-managed@");
    await expect(
      admin.getByRole("row").filter({ hasText: "mui-managed@example.invalid" }),
    ).toContainText("停用中");
    await expect(
      page.getByText(/账号停用中。已受理任务允许结束/),
    ).toBeVisible();
    await expect(page.getByLabel("继续 Reflection")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "停止生成", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "停止生成", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    const current = (
      await (await admin.request.get(`/api/v1/users/${target.id}`)).json()
    ).user;
    expect(current.status).toBe("disabled");
    expect(
      (
        await admin.request.patch(`/api/v1/users/${target.id}`, {
          data: payload(current.version, { enabled: true }),
        })
      ).ok(),
    ).toBeTruthy();
    expect((await page.request.get("/api/v1/auth/me")).status()).toBe(401);
  } finally {
    await context.close();
  }
});
