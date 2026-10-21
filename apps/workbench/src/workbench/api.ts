export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new ApiError(
      body.error || `请求失败（${response.status}）`,
      response.status,
    );
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}
export const command = <T = void>(
  path: string,
  method = "POST",
  body?: unknown,
) =>
  api<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const userErrors: Record<string, string> = {
  LastActiveAdministrator: "至少需要保留一位正常状态的管理员。",
  UserVersionConflict:
    "用户已被其他操作更新。已保留本次输入，请核对后重读最新版本。",
  UserRequestConflict: "请求标识已用于其他变更，请重读后提交新请求。",
  UserStillDraining: "账号正在等待任务收尾，任务结束或停止后才能恢复。",
  UserUnavailable: "账号当前不可用，请重新登录或联系管理员。",
  UserDraining: "账号正在停用，仅允许查看或停止已受理任务。",
  InvalidUserChange: "请填写有效的角色、状态和变更原因。",
};
export const messageOf = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return userErrors[message] ?? message;
};
