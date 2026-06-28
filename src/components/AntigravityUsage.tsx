import { useEffect, useState } from "react";
import { agyUsage, type QuotaBucket } from "../lib/antigravity";

/** 短模型名：去掉 gemini- 前缀，便于状态栏紧凑展示 */
const shortModel = (id: string) => id.replace(/^gemini-/, "");

/** 剩余比例对应颜色 */
const fracColor = (f: number) =>
  f > 0.3 ? "#4ec9b0" : f > 0.1 ? "#d7ba7d" : "#f14c4c";

const fmtReset = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * Antigravity 订阅用量：调 Google Code Assist 配额接口，
 * 在底部状态栏展示各模型剩余额度与重置时间，定时刷新。
 */
export default function AntigravityUsage() {
  const [buckets, setBuckets] = useState<QuotaBucket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await agyUsage();
      setBuckets(data);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000); // 每分钟刷新
    return () => clearInterval(timer);
  }, []);

  if (error) {
    return (
      <span
        className="seg usage err"
        title={error}
        onClick={load}
        style={{ cursor: "pointer" }}
      >
        ⚡ 用量不可用（点击重试）
      </span>
    );
  }

  if (!buckets) {
    return <span className="seg muted">⚡ 用量加载中…</span>;
  }

  if (buckets.length === 0) {
    return <span className="seg muted">⚡ 无配额数据</span>;
  }

  // 取剩余最少的桶作为「最紧的限额」突出显示
  const tight = [...buckets].sort(
    (a, b) => a.remainingFraction - b.remainingFraction,
  )[0];
  const tooltip = buckets
    .map(
      (b) =>
        `${shortModel(b.modelId)}: 剩 ${Math.round(b.remainingFraction * 100)}%` +
        (b.resetTime ? ` · 重置 ${fmtReset(b.resetTime)}` : ""),
    )
    .join("\n");

  return (
    <span
      className="seg usage"
      title={tooltip}
      onClick={load}
      style={{ cursor: "pointer", opacity: loading ? 0.6 : 1 }}
    >
      ⚡ 额度{" "}
      <span style={{ color: fracColor(tight.remainingFraction), fontWeight: 600 }}>
        {Math.round(tight.remainingFraction * 100)}%
      </span>{" "}
      <span className="muted">{shortModel(tight.modelId)}</span>
      {tight.resetTime && (
        <span className="muted"> · 重置 {fmtReset(tight.resetTime)}</span>
      )}
    </span>
  );
}
