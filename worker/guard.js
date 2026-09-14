// 出站 URL 守卫（仅 http/https，拒绝本地/私有/保留地址）
// GM 对话与 forge 管线的所有服务端出站请求共用此基线（SSRF 防护）。
export function assertPublicHttpUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('仅允许 http/https 请求');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0') throw new Error('拒绝本地回环地址');
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) throw new Error('拒绝私有地址');
  const m172 = host.match(/^172\.(\d{1,3})\./);
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) throw new Error('拒绝私有地址');
  if (/^169\.254\./.test(host)) throw new Error('拒绝保留地址');
}
