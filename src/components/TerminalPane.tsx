import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import { spawnPty, writePty, resizePty, killPty } from "../lib/pty";
import { acquireAntigravitySlot } from "../lib/launchQueue";
import { useTabsStore } from "../stores/tabs";

/** 终端字体栈：完整 Nerd 字体优先，回退 Consolas */
const TERMINAL_FONT =
  '"Caskaydia Cove Nerd Font Mono", "Consolas", "Courier New", monospace';

/** 去除 ANSI CSI 转义序列（ESC [ ... 终止字母），便于文本解析 */
const ESC = String.fromCharCode(27);
const CSI_RE = new RegExp(ESC + "\\[[0-9;?]*[ -/]*[@-~]", "g");
function stripAnsi(input: string): string {
  return input.replace(CSI_RE, "");
}

/**
 * 从 agy `/context` 输出解析上下文用量。
 * 摘要行形如：`... · 54.5k/1.0M tokens` 紧随 `(5.2%)`。
 * 分类明细里的 `N tokens (X%)` 不含斜杠，故用斜杠 token 行精确定位总用量。
 */
function parseContextUsage(
  text: string,
): { used: string; total: string; percent: number | null } | null {
  const m = text.match(/([\d.]+[kKMm]?)\s*\/\s*([\d.]+[kKMm]?)\s*tokens/);
  if (!m) return null;
  const after = text.slice((m.index ?? 0) + m[0].length);
  const pm = after.match(/\(\s*([\d.]+)\s*%\s*\)/); // 紧随其后的总体百分比
  return {
    used: m[1],
    total: m[2],
    percent: pm ? parseFloat(pm[1]) : null,
  };
}

interface TerminalPaneProps {
  tabId: string;
  provider: string;
  program: string;
  args?: string[];
  cwd: string;
  /** 是否为当前激活标签：决定是否显示、聚焦与重新 fit */
  active: boolean;
}

/**
 * 单个标签的终端面板。多个面板同时常驻挂载，通过 `active` 控制显隐，
 * 让非激活标签的 PTY 进程保活。fit/resize 经 rAF 防抖且仅在尺寸真正
 * 变化时才同步，避免输入时列数横跳导致的画面抖动。
 */
export default function TerminalPane({
  tabId,
  provider,
  program,
  args,
  cwd,
  active,
}: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const activeRef = useRef(active);
  const lastSize = useRef({ cols: 0, rows: 0 });
  const setRuntime = useTabsStore((s) => s.setRuntime);
  const setContextUsage = useTabsStore((s) => s.setContextUsage);
  // 解析 /context 输出的滚动文本缓冲（仅 antigravity 用）
  const scanBuf = useRef("");
  const decoder = useRef(new TextDecoder());

  // 仅在尺寸真正变化时才 fit + resize PTY，消除临界宽度下的列数横跳
  const sync = () => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    try {
      fit.fit();
    } catch {
      return;
    }
    const { cols, rows } = term;
    if (cols <= 0 || rows <= 0) return;
    if (cols === lastSize.current.cols && rows === lastSize.current.rows) return;
    lastSize.current = { cols, rows };
    const id = ptyIdRef.current;
    if (id) resizePty(id, cols, rows).catch(() => {});
  };

  // 挂载：创建 xterm + 启动 PTY（仅一次）
  useEffect(() => {
    if (!hostRef.current) return;

    const term = new XTerm({
      // 单一完整 Nerd 字体：文字与图标同源、等宽一致，CLI 状态栏对齐不漂移。
      // 不设 letterSpacing：DOM 渲染器在 letterSpacing≠0 时存在字符不重绘的
      // 缺陷，表现为「不选中不显示、选中才正常」。
      fontFamily: TERMINAL_FONT,
      fontSize: 14,
      cursorBlink: true,
      allowProposedApi: true,
      // 完整 ANSI 调色板：CLI 底部状态栏/统计信息大量用 ANSI 颜色与 dim，
      // 缺省调色板对比度差会发暗看不清，这里用一套高对比配色。
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
        selectionBackground: "#264f78",
        black: "#1e1e1e",
        red: "#f14c4c",
        green: "#4ec9b0",
        yellow: "#d7ba7d",
        blue: "#569cd6",
        magenta: "#c586c0",
        cyan: "#4fc1ff",
        white: "#d4d4d4",
        brightBlack: "#808080",
        brightRed: "#f14c4c",
        brightGreen: "#4ec9b0",
        brightYellow: "#d7ba7d",
        brightBlue: "#569cd6",
        brightMagenta: "#c586c0",
        brightCyan: "#4fc1ff",
        brightWhite: "#ffffff",
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    // Unicode 11 宽度表：让 emoji（📂🤖⏱ 等）按 2 格宽计算，与 CLI 排版一致，
    // 否则 xterm 按 1 格塞入 emoji 会强加大幅负字距导致重叠盖字。
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.open(hostRef.current);
    termRef.current = term;
    fitRef.current = fitAddon;

    // 使用默认 DOM 渲染器：真实 DOM 文本，原生字体回退与度量，
    // 始终如实反映 CLI 每次交互的实时刷新（无纹理图集，不会卡住更新）。

    // 中文输入法（IME）候选框跟随光标：
    // 持续把隐藏的 textarea 同步到终端光标位置，使系统候选框贴着光标弹出；
    // 中文合成（选字）期间冻结位置，避免 TUI 高频重绘把候选框带得乱跳（抖动）。
    const textarea = term.textarea;
    let composing = false;
    let imeRaf = 0;
    const placeTextarea = () => {
      imeRaf = 0;
      const screenEl = hostRef.current?.querySelector(
        ".xterm-screen",
      ) as HTMLElement | null;
      if (!textarea || !screenEl || term.cols <= 0 || term.rows <= 0) return;
      const cellW = screenEl.clientWidth / term.cols;
      const cellH = screenEl.clientHeight / term.rows;
      const buf = term.buffer.active;
      // 纵向钉在视口底部行：CLI（claude/gemini 等 TUI）输入框恒在底部，
      // 且其硬件光标常被 park 到顶部，不能直接用 cursorY。
      // 横向跟随 cursorX：普通 shell 时贴着光标，TUI 时为 0 即贴输入行左侧。
      const left = screenEl.offsetLeft + buf.cursorX * cellW;
      const top = screenEl.offsetTop + (term.rows - 1) * cellH;
      textarea.style.left = `${Math.round(left)}px`;
      textarea.style.top = `${Math.round(top)}px`;
    };
    const schedulePlace = () => {
      if (composing || imeRaf) return; // 合成期间冻结；每帧最多一次
      imeRaf = requestAnimationFrame(placeTextarea);
    };
    const onCursorMove = term.onCursorMove(schedulePlace);
    const onRenderEv = term.onRender(schedulePlace);
    const onCompStart = () => {
      composing = true;
      placeTextarea(); // 选字前定位一次，之后冻结
    };
    const onCompEnd = () => {
      composing = false;
    };
    textarea?.addEventListener("compositionstart", onCompStart);
    textarea?.addEventListener("compositionend", onCompEnd);

    try {
      fitAddon.fit();
    } catch {
      /* 容器未就绪 */
    }
    const cols = term.cols > 0 ? term.cols : 80;
    const rows = term.rows > 0 ? term.rows : 24;
    lastSize.current = { cols, rows };

    let disposed = false;

    // 字体可能在 open() 后才加载完成（用回退字体测量了字符尺寸）。
    // 字体就绪后重新 fit + 整体重绘，使排版按正确字体度量刷新。
    document.fonts?.ready?.then(() => {
      if (disposed) return;
      lastSize.current = { cols: 0, rows: 0 }; // 让 sync 必定重算尺寸
      sync();
      term.refresh(0, term.rows - 1);
    });

    const launch = async () => {
      // antigravity 经串行闸门错峰启动，避免多实例并发登录冲突
      if (provider === "antigravity") {
        term.write(
          "\x1b[2m正在排队启动 Antigravity（错峰以避免并发登录冲突）…\x1b[0m\r\n",
        );
        await acquireAntigravitySlot();
        if (disposed) return;
      }
      try {
        const id = await spawnPty({ program, args, cwd, cols, rows }, (ev) => {
          if (disposed) return;
          if (ev.event === "output") {
            const bytes = new Uint8Array(ev.data);
            term.write(bytes);
            // antigravity：被动解析 /context 输出里的上下文用量
            if (provider === "antigravity") {
              const chunk = decoder.current.decode(bytes, { stream: true });
              // 只在出现 tokens 关键词时才做较重的解析，降低开销
              let buf = scanBuf.current + chunk;
              if (buf.length > 6000) buf = buf.slice(-6000);
              scanBuf.current = buf;
              if (chunk.includes("token") || chunk.includes("%")) {
                const usage = parseContextUsage(stripAnsi(scanBuf.current));
                if (usage) setContextUsage(tabId, usage);
              }
            }
          } else if (ev.event === "exit") {
            term.write(
              `\r\n\x1b[33m[进程已退出，退出码 ${ev.code ?? "未知"}]\x1b[0m\r\n`,
            );
            setRuntime(tabId, { status: "exited", exitCode: ev.code ?? null });
          }
        });
        if (disposed) {
          killPty(id).catch(() => {});
          return;
        }
        ptyIdRef.current = id;
        setRuntime(tabId, { status: "running", ptyId: id });
      } catch (err) {
        term.write(`\r\n\x1b[31m[启动失败] ${err}\x1b[0m\r\n`);
        setRuntime(tabId, { status: "exited", exitCode: null });
      }
    };
    launch();

    const onData = term.onData((data) => {
      const id = ptyIdRef.current;
      if (id) writePty(id, data).catch(() => {});
    });

    // 容器尺寸变化 → rAF 防抖后同步（仅激活时）
    let raf = 0;
    const ro = new ResizeObserver(() => {
      if (!activeRef.current) return;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(sync);
    });
    ro.observe(hostRef.current);

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      if (imeRaf) cancelAnimationFrame(imeRaf);
      onData.dispose();
      onCursorMove.dispose();
      onRenderEv.dispose();
      textarea?.removeEventListener("compositionstart", onCompStart);
      textarea?.removeEventListener("compositionend", onCompEnd);
      ro.disconnect();
      if (ptyIdRef.current) killPty(ptyIdRef.current).catch(() => {});
      term.dispose();
    };
    // 仅挂载一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 激活时：display 切为可见后再 fit + 聚焦
  useEffect(() => {
    activeRef.current = active;
    if (!active) return;
    const raf = requestAnimationFrame(() => {
      sync();
      termRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div
      className="terminal-host"
      ref={hostRef}
      style={{ display: active ? "block" : "none" }}
    />
  );
}
