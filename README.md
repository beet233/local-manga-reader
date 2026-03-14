# 本地漫画 GPT 辅助阅读器

一个无需额外依赖的本地 Web 应用：
- 浏览本地漫画文件夹（JPG/PNG/WebP 等）
- 按整卷滚动阅读
- 单页翻页 / 双页模式
- 鼠标框选对白区域
- 调用 OpenAI API 做：
  - 日文原文抄写
  - 中文翻译
  - 汉字/词汇平假名读音
  - 语法讲解
  - 梗 / 背景说明

## 运行

```powershell
cd B:\workbench
npm start
```

默认会自动尝试可用端口，启动后看终端输出，例如：

```text
Manga translator app running at http://127.0.0.1:3321
```

## 使用

1. 左侧输入漫画根目录，例如：
   `B:\comic\DLRAW.AC_Nitengojigen_no_Ririsa vol 01-24\DLRAW.AC_Nitengojigen_no_Ririsa vol 01-24`
2. 逐级点进某一卷（包含 JPG 的文件夹）。
3. 点击“开启圈选翻译”。
4. 在图片上拖出一个框，框住对白/旁白区域。
5. 框选完成后会自动翻译并讲解。
6. 在左侧 OpenAI 设置里填写：
   - API Key
   - Model（默认 `gpt-4.1-mini`）
   - Base URL（默认 `https://api.openai.com/v1`）

## 自动读取 Codex 配置

应用会优先读取：

`C:\Users\Administrator\.codex\config.toml`

并自动预填：
- model
- base_url

同时服务端会优先尝试读取该 provider 对应的环境变量密钥（例如你当前配置里的 `CODEX_API_KEY`）。

页面上的输入框仍然可以手动覆盖这些值。

## 本地应用配置（app.config.json）

项目支持通过本地配置文件控制一些不适合直接写死进仓库的行为，例如笔记持久化路径。

仓库里提供了示例文件：

`app.config.sample.json`

你可以复制一份为：

`app.config.json`

然后按需修改。这个实际配置文件已经加入 `.gitignore`，不会被提交到 GitHub。

示例：

```json
{
  "persistence": {
    "enabled": true,
    "noteRootDir": "B:\\nihongo_note\\raw"
  }
}
```

字段说明：

- `persistence.enabled`
  - 是否开启圈选分析结果的本地持久化
  - 默认值：`true`
- `persistence.noteRootDir`
  - 持久化根目录
  - 服务端会自动按月份/日期追加写入：
    - `YYYY_MM/YYYY_MM_DD.md`

例如：

```text
B:\nihongo_note\raw\2026_03\2026_03_14.md
```

注意：

- 这是服务端后台静默写入，不会触发浏览器下载。
- 每次分析完成后只做 append，不会读取旧内容。

## 环境变量（可选）

如果不想每次在页面里填，可以先设置：

```powershell
$env:OPENAI_API_KEY="你的 key"
$env:OPENAI_MODEL="gpt-4.1-mini"
$env:OPENAI_BASE_URL="https://api.openai.com/v1"
npm start
```

## 手动指定端口（可选）

如果你想固定端口，可以先指定：

```powershell
$env:PORT=3321
npm start
```

如果某个端口被系统保留或占用，换一个即可，比如 `3322`、`8080`、`8787`。

## 说明

- 这是本地应用，图片由本机 Node 服务读取。
- 框选裁剪发生在浏览器端，只会把你圈出的区域发送给模型。
- 如果图像太糊、对白被遮挡、手写字太草，识别结果可能不稳定。
- 当前版本优先做“单次圈选分析”；后续可继续扩展成：
  - 自动 OCR 全页文本块
  - 生词本 / 导出 Anki
  - 阅读进度记忆
  - 双页模式 / 右开阅读
  - 一键整页逐段翻译
