/**
 * Antigravity(agy) 启动串行闸门。
 *
 * agy 每个实例启动会访问 Windows 凭据库并刷新 OAuth token，多个实例并发启动会
 * 发生 keyring 抢占与 refresh_token 轮换竞争，导致部分实例被登出、要求重新登录。
 * 此闸门把 antigravity 的启动串行化：上一个放行后至少间隔 GAP_MS 再放行下一个，
 * 从而避开并发认证竞争。claude 等其它 provider 不经过此闸门、立即启动。
 */

/** 相邻两个 antigravity 启动的最小间隔（毫秒），可按需调整 */
export const ANTIGRAVITY_LAUNCH_GAP_MS = 3500;

let chainTail: Promise<void> = Promise.resolve();

/**
 * 申请一个 antigravity 启动名额。返回的 Promise resolve 时即可启动；
 * 队列中下一个名额会在本次之后至少 GAP_MS 才放行。
 */
export function acquireAntigravitySlot(): Promise<void> {
  // 轮到自己：等到队尾（上一个的间隔结束）
  const myTurn = chainTail;
  // 队尾后移：本次放行后再等 GAP_MS 才轮到下一个
  chainTail = chainTail.then(
    () => new Promise((r) => setTimeout(r, ANTIGRAVITY_LAUNCH_GAP_MS)),
  );
  return myTurn;
}
