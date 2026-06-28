import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { spawnPty, writePty, resizePty, killPty } from "../lib/pty";
import { acquireAntigravitySlot } from "../lib/launchQueue";
import { useTabsStore } from "../stores/tabs";

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
      // 使用 Windows 必装的 Consolas，避免测量字体与渲染字体不一致导致抖动
      fontFamily: '"Consolas", "Courier New", monospace',
      fontSize: 14,
      cursorBlink: true,
      allowProposedApi: true,
      theme: { background: "#1e1e1e", foreground: "#e0e0e0" },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(hostRef.current);
    termRef.current = term;
    fitRef.current = fitAddon;

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
            term.write(new Uint8Array(ev.data));
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
