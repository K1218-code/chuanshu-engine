# 全界面像素窗口系统与封面资产

## 封面映射

| 书籍 | 项目资产 | 来源 |
| --- | --- | --- |
| 被无情道小师弟倒追了 | `public/assets/covers/wqd-xiaoshidi.webp` | ImageGen 生成 |
| 我在修真界掏出了 AK47 | `public/assets/covers/ak47-xiuzhen.webp` | 用户提供 `Codex Image 2026年9月15日 04_28_57.png` |
| 凡人修仙传·凡人风起 | `public/assets/covers/fanren.webp` | 用户提供 `Codex Image 2026年9月15日 04_28_48.png` |
| 不提分就出不去的房间 | `public/assets/covers/btg-room.webp` | 用户提供 `Codex Image 2026年9月15日 04_29_05.png` |

项目内统一使用 900×1350 以内的 WebP，原始图片不覆盖、不删除。

## 第四张封面的最终生成提示词

生成方式：Codex 内置 ImageGen；前三张用户图片仅作为风格和竖版格式参考。

```text
Use case: stylized-concept
Asset type: portrait game book cover for the interactive novel 《被无情道小师弟倒追了》
Input images: Image 1, Image 2, and Image 3 are style and format references only; do not copy their characters or scenes.
Primary request: create a new vertical 2:3 anime pixel-painted fantasy cover. A determined young female sword cultivator in dark red and black robes stands in the foreground holding a simple wooden sword, having descended the mountain to rescue her junior disciple. Behind her, a mysterious handsome young male cultivator in pale ash and black robes emerges through smoke, half lit by fire, with an ambiguous teasing expression suggesting a hidden identity. The distant cultivation sect and mountain gate are burning under a dramatic dusk sky, with glowing embers and broken talisman fragments drifting through the air.
Style/medium: polished high-detail anime illustration with refined pixel-art texture, matching the visual family, sharp silhouettes, rich environmental detail, and cinematic lighting of the three reference covers.
Composition/framing: portrait 2:3, both characters clearly readable, female lead dominant in the lower-middle foreground, male junior behind and offset, burning sect forming a strong background frame; safe central crop for cards; no important face or hand near the edge.
Lighting/mood: firelight orange against deep plum night shadows; romantic tension, danger, mystery, determined rescue.
Color palette: deep wine red, charcoal, ash white, ember orange, small cyan magical highlights.
Constraints: no text, no title, no typography, no logos, no watermark, no modern objects, no guns; anatomically coherent hands; do not recreate any character from the reference images.
```

## UI 适配范围

- 首页：精选书库、玩过的书、结局图鉴使用真实封面。
- 全部故事：已拆解故事显示对应封面，其余故事保留编号。
- 游戏：封面作为舞台与身份/序章窗口的氛围背景。
- 创造世界、全部故事、游戏、旧入口跳转页：共享 `pixel-ui.css` 窗口语言。
- 所有页面保持原业务 ID、路由和数据协议。
