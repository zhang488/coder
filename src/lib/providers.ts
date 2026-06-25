/** Provider 配置：标签展示名与对应的可执行程序名 */
export interface ProviderConfig {
  label: string;
  program: string;
}

export const PROVIDERS: Record<string, ProviderConfig> = {
  claude: { label: "Claude Code", program: "claude" },
  gemini: { label: "Gemini", program: "gemini" },
};

export function providerProgram(provider: string): string {
  return PROVIDERS[provider]?.program ?? provider;
}

/** 启动模式：new=以指定 session 新建；resume=续接已有对话 */
export type LaunchMode = "new" | "resume";

/**
 * 根据 provider / session / 模式构造 CLI 启动参数。
 * - claude 新建：`--session-id <id>`（用我们生成的 id 创建会话）
 * - claude 恢复：`--resume <id>`（续接上次对话）
 * - gemini：暂不支持按 id 续接，统一无参启动（第三期完善）
 */
export function buildArgs(
  provider: string,
  sessionId: string | null,
  mode: LaunchMode,
): string[] {
  if (provider === "claude" && sessionId) {
    return mode === "resume"
      ? ["--resume", sessionId]
      : ["--session-id", sessionId];
  }
  return [];
}
