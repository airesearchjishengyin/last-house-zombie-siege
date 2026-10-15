# Last House

一个 AI 驱动的战术生存游戏，目前处于原型迭代阶段。

## 这是一个什么游戏

游戏当前版本是一个浏览器内的战术模拟：AI控制的人类小队与僵尸对抗，玩家通过战术牌干预，决策层由开源 Laya 模型驱动，底层是可进化的 utility function 规则系统。

**我们正在探索的下一个方向：将军指挥模式。**

玩家不再直接操控单位，而是扮演指挥官，通过自然语言命令和手绘路线向约10人的小队发出意图性指令。士兵有名字、专长和个性，会自主判断、有时抗命，也会通过无线电报告前线情况。核心快感不是操作精度，而是战略判断——你的命令导致了这个结果，好的或坏的。

这个方向填补了一个目前市场上的空白：没有任何游戏同时做到将军视角 + 自然语言命令 + 休闲定位。

详细设计见 [GAME_DESIGN.md](GAME_DESIGN.md)，竞品分析见 [MARKET_RESEARCH.md](MARKET_RESEARCH.md)，开发计划见 [TODO.md](TODO.md)。

## 现在就体验

公网试玩：**https://games.macagents.org/**（由项目维护者 MacBook 通过 Cloudflare Tunnel 提供，主机休眠时不可用）

本地运行：

```sh
PORT=8001 python3 server.py
```

打开 http://127.0.0.1:8001。不需要安装模型就能玩；启用 Laya 决策模型见 [models/README.md](models/README.md)。

桌面版：GitHub Actions 构建 macOS/Windows 包，在 Actions 运行记录中下载。

## 技术架构

命令决策采用三层结构：LLM 解析自然语言意图 → decision model 翻译为结构化战术指令 → rule-based 代码执行具体行为。Utility function 跨局进化，每局结束后根据表现更新各兵种的权重参数。

运行检查：

```sh
node --check game.js
python3 -m py_compile server.py
node tests/simulation.cjs
node tests/audio.cjs
python3 -m unittest discover -s tests -p 'server_security.py'
```

详细技术文档见 [docs/TECHNICAL_REFERENCE.md](docs/TECHNICAL_REFERENCE.md)。

## 项目文件

| 文件 | 说明 |
|---|---|
| `game.js` `maps.js` | 战斗模拟、地图、决策映射与绘制 |
| `server.py` | 静态文件服务与本地模型 API 代理 |
| `audio.js` | 合成音乐、战斗音效与音量管理 |
| `visual.css` | 军事前哨站界面主题与响应式样式 |
| `models/README.md` | 模型来源、许可与本机启动步骤 |
| `tests/` | 模拟回归、音频与安全检查 |
| `marketing/xiaohongshu/` | 小红书图文素材与文案 |
| `style-lab/` | 视觉风格实验 |
| `GAME_DESIGN.md` | 将军指挥模式的完整设计文档 |
| `MARKET_RESEARCH.md` | 战术游戏市场调研与竞品分析 |
| `TODO.md` | 开发优先级与待办事项 |
| `docs/TECHNICAL_REFERENCE.md` | 完整技术参考：武器参数、AI系统、地图规则 |

## 许可

项目代码按 MIT License 发布。Laya 模型与依赖各自遵循上游许可；详见 [models/README.md](models/README.md)。
