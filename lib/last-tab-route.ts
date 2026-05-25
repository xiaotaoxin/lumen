/**
 * 每个一级 tab（创作 / 视频 / 画布 / …）记住上次访问的完整 URL（含 query），
 * 让用户在 tab 之间切换时回到自己最后看的那个会话/画布，而不是回到空白主页。
 *
 * 写在 localStorage：跨页面刷新依然有效；不跨设备 / 不跨浏览器。
 */

const PREFIX = "lumen:last-tab-route:";

export function getLastTabRoute(tabKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PREFIX + tabKey);
  } catch {
    return null;
  }
}

export function setLastTabRoute(tabKey: string, fullUrl: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (fullUrl) window.localStorage.setItem(PREFIX + tabKey, fullUrl);
    else window.localStorage.removeItem(PREFIX + tabKey);
  } catch {
    // 配额满了等错误：忽略，最差情况下退化为不记住
  }
}
