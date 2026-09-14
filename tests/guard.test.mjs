// 出站 URL 守卫（SSRF 防护）回归：内网/回环/保留地址一律拒绝，公网 http(s) 放行
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicHttpUrl } from '../worker/guard.js';

test('守卫：拒绝本地回环与内网地址', () => {
  for (const bad of [
    'http://localhost/v1',
    'http://localhost:8080/v1',
    'http://127.0.0.1/v1',
    'http://10.0.0.5/v1',
    'http://192.168.1.1/v1',
    'http://172.16.0.1/v1',
    'http://172.31.255.255/v1',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/v1',
    'file:///etc/passwd',
    'ftp://example.com',
  ]) {
    assert.throws(() => assertPublicHttpUrl(bad), `${bad} 应被拒绝`);
  }
});

test('守卫：拒绝 172.32+ 误报之外的正确放行边界', () => {
  // 172.16-31 是私有段，172.32 及以上是公网（不拒绝）
  assert.doesNotThrow(() => assertPublicHttpUrl('https://172.32.0.1/v1'));
});

test('守卫：放行合法公网 http(s)', () => {
  for (const good of [
    'https://api.openai-next.com/v1/chat/completions',
    'https://openapi.zhihu.com/access_token',
    'http://example.com/path',
  ]) {
    assert.doesNotThrow(() => assertPublicHttpUrl(good));
  }
});
