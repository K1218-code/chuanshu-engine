// 造世界（create 模式）单元测试：类型映射 / story 合成 / 题材推断扩展
import test from 'node:test';
import assert from 'node:assert/strict';
import { TYPE_GENRE, buildWorldStory, assembleNovel } from '../worker/forge.js';
import { inferGenre, GENRE_THEMES } from '../public/js/engine.js';

test('造世界：类型白名单覆盖 create 页全部六类，genre 映射正确', () => {
  const pageTypes = ['修仙', '校园', '宫廷', '末世', '现代都市', '悬疑'];
  for (const t of pageTypes) assert.ok(TYPE_GENRE[t], `类型 ${t} 应在白名单`);
  assert.equal(TYPE_GENRE['末世'], 'apocalypse');
  assert.equal(TYPE_GENRE['悬疑'], 'suspense');
  assert.equal(TYPE_GENRE['校园'], 'romance');
});

test('造世界：buildWorldStory 合成（mode/genre/world_ 前缀/长度截断）', () => {
  const s1 = buildWorldStory('末世', '  末世第三年，我是唯一记得疫苗配方的人。  ');
  assert.equal(s1.mode, 'create');
  assert.equal(s1.genre, 'apocalypse');
  assert.ok(s1.work_id.startsWith('w_'));
  assert.ok(/^[a-f0-9]{12}$/.test(s1.work_id.slice(2)), 'work_id = w_ + 12位hex');
  assert.equal(s1.introduction, '末世第三年，我是唯一记得疫苗配方的人。'); // trim
  assert.ok(s1.content.includes('末世'));
  // 空 free 也合法（AI 自由创作）
  const s2 = buildWorldStory('悬疑', '');
  assert.equal(s2.genre, 'suspense');
  assert.equal(s2.introduction, '');
  // free 服务端 50000 字符上限（用户可长篇设定）
  const s3 = buildWorldStory('修仙', 'a'.repeat(90000));
  assert.ok(s3.introduction.length <= 50000);
  // 未知类型回落 default（服务端入口已用 TYPE_GENRE 白名单拦截，这里是兜底）
  assert.equal(buildWorldStory('科幻', '').genre, 'default');
  // work_id 唯一性
  assert.notEqual(s1.work_id, s2.work_id);
});

test('造世界：封面 dataURL 随 story 透传进 novel.meta.cover，无封面时字段缺省', () => {
  const story = buildWorldStory('校园', '测试设定');
  story.cover = 'data:image/jpeg;base64,' + 'A'.repeat(120);
  const withCover = assembleNovel(story, { chapterSummaries: [] });
  assert.ok(withCover.meta.cover.startsWith('data:image/jpeg;base64,'), 'meta.cover 应透传 data URL');
  const withoutCover = assembleNovel(buildWorldStory('校园', ''), { chapterSummaries: [] });
  assert.equal(withoutCover.meta.cover, undefined, '未上传封面时不应有 cover 字段');
});

test('造世界：inferGenre 识别末世/求生关键词 → apocalypse', () => {
  assert.equal(inferGenre({ meta: { tags: ['末世', '求生'], intro: '' } }), 'apocalypse');
  assert.equal(inferGenre({ meta: { intro: '废土之上，丧尸围城' } }), 'apocalypse');
  assert.ok(GENRE_THEMES.apocalypse, '末世主题已注册');
  assert.equal(GENRE_THEMES.apocalypse.dark, true);
});
