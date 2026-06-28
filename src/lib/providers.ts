/** Provider 配置：展示名、可执行程序名、品牌色与徽标短字 */
export interface ProviderConfig {
  label: string;
  /** 切换器上的短名 */
  short: string;
  program: string;
  /** 品牌强调色 */
  color: string;
  /** 圆形徽标里的字符 */
  badge: string;
}

export const PROVIDERS: Record<string, ProviderConfig> = {
  claude: {
    label: "Claude Code",
    short: "Claude",
    program: "claude",
    color: "#d97757",
    badge: "C",
  },
  antigravity: {
    label: "Antigravity",
    short: "Antigravity",
    program: "agy",
    color: "#7c4dff",
    badge: "A",
  },
};

/** 切换器中按顺序展示的 provider key */
export const PROVIDER_KEYS = ["claude", "antigravity"] as const;

export function providerProgram(provider: string): string {
  return PROVIDERS[provider]?.program ?? provider;
}

/** 启动模式：new=以指定 session 新建；resume=续接已有对话 */
export type LaunchMode = "new" | "resume";

/**
 * 根据 provider / session / 模式构造 CLI 启动参数。
 * - claude 新建：`--session-id <id>`（用我们生成的 id 创建会话）
 * - claude 恢复：`--resume <id>`（续接上次对话）
 * - antigravity(agy) 恢复：有解析到的会话 id 则 `--conversation <id>` 精确续接，
 *   否则 `--continue` 接该工作目录最近一次；新建直接启动。
 *
 * 注意：antigravity 的 sessionId 必须是从 agy projects.json 解析出的真实会话 id，
 * 而非我们 DB 里自动生成的 uuid（调用前需在 store 中解析覆盖）。
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
  if (provider === "antigravity") {
    if (mode !== "resume") return [];
    return sessionId ? ["--conversation", sessionId] : ["--continue"];
  }
  return [];
}
