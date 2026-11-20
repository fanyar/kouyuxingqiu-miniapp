# 文字与语音时间轴对接流程

这份文档定义每个章节的文字、原声、逐句高亮和点击朗读的标准流程。后面新增章节都按这个流程执行。

## 目标

每一章满足：

1. 使用课程原声，不使用 TTS 替代原声。
2. 播放整章时，当前句轻微放大并变色。
3. 点击任意一句，只读这一句，读完自动暂停。
4. 时间轴必须来自语音识别结果，不能只用音量波形估算。
5. 每章数据独立，方便后续新增章节。

## 文件规范

### 音频

每个章节一个独立音频文件：

```text
audio/A1.mp3
audio/A2.mp3
audio/B1.mp3
...
```

文件名与章节 `id` 一致。先确认音频可用和时长：

```bash
afinfo audio/A1.mp3
```

项目页面直接播放的仍是原始 MP3。语音识别用的 WAV 只作为临时分析文件，不放进项目。

### 文字

句子文本放在 `data/chapters.js`。每句使用 `[]` 标出需要红色的字母：

```js
{ id: 1, text: "This is [A]nnie's [a]pple tree.", start: 4.78, end: 7.15 }
```

规则：

1. `text` 必须和绘本句子一致。
2. `start` 是这句朗读开始前的时间。
3. `end` 是这句读完后的时间。
4. 句子顺序必须和音频朗读顺序一致。
5. 时间单位是秒，保留两位小数。

### 章节数据

每个章节的数据结构：

```js
{
  id: "A1",
  letter: "A",
  title: "Annie's Apple Tree",
  audio: "audio/A1.mp3",
  duration: 66.539,
  timingVersion: "speech-2026-11-18",
  timingNote: "recognized",
  sentences: []
}
```

`timingVersion` 必须更新。这样浏览器里旧的校准数据不会覆盖新的正式时间轴。

推荐值：

```text
timingVersion: "speech-YYYY-MM-DD"
timingNote: "recognized"
```

## 标准时间轴生成流程

### 1. 读取原声时长

```bash
afinfo audio/A1.mp3
```

记录 `estimated duration`，填到章节的 `duration`。

### 2. 准备语音识别用的 WAV

macOS 本机语音识别对 16kHz 单声道 WAV 最稳定。

用浏览器解码 MP3，并转换成：

```text
16kHz
mono
16-bit PCM WAV
```

临时输出：

```text
/private/tmp/{chapter}.wav
```

注意：不要修改项目里的原始 MP3。

### 3. 切成 4 秒小段

不要一次性识别整段长音频。macOS 离线识别在长音频上可能只保留最后一句。

标准切块规则：

```text
每个片段：4 秒
相邻片段重叠：2 秒
片段间隔：从 0 秒开始，每 2 秒一个
```

文件名用片段开始时间命名：

```text
{chapter}-000.0.wav
{chapter}-002.0.wav
{chapter}-004.0.wav
{chapter}-006.0.wav
...
```

### 4. 用 macOS 本地语音识别逐段识别

使用 `SFSpeechRecognizer`，语言设置为目标语言。英语章节使用：

```text
en-US
```

要求：

1. 使用本地离线识别。
2. 每个片段输出词级时间戳。
3. 片段时间戳加上片段开始时间，得到全音频时间。
4. 重复片段里的相同词取更稳定的结果。

识别结果应包含：

```js
{
  "status": "completed",
  "text": "This is Annie's apple tree",
  "segments": [
    { "time": 4.90, "duration": 0.51, "text": "This" },
    { "time": 5.41, "duration": 0.27, "text": "is" }
  ]
}
```

### 5. 合并识别结果

把所有片段的词时间按全音频时间排序，得到类似结果：

```text
4.90  This
5.41  is
5.68  Annie's
6.28  apple tree
...
```

再按绘本文本确定每句的首词和尾词：

```text
句首时间 = 这句第一个词的识别时间
句尾时间 = 这句最后一个词的识别结束时间
```

然后留一点音频余量：

```text
start = 句首时间 - 0.10 ~ 0.15
end   = 句尾时间 + 0.10 ~ 0.20
```

如果相邻两句太近，后一句 `start` 不能早于前一句 `end`。

### 6. 写入 data/chapters.js

将识别结果整理进章节：

```js
sentences: [
  { id: 1, text: "This is [A]nnie's [a]pple tree.", start: 4.78, end: 7.15 },
  { id: 2, text: "[A]nnie is on the m[a]t.", start: 10.45, end: 12.28 },
]
```

A1 的正式识别时间轴：

| id | sentence | start | end |
| --- | --- | ---: | ---: |
| 1 | This is Annie's apple tree. | 4.78 | 7.15 |
| 2 | Annie is on the mat. | 10.45 | 12.28 |
| 3 | Max loves apples. | 20.52 | 22.40 |
| 4 | Ants love apples, too. | 26.12 | 28.25 |
| 5 | Annie's cat is angry. | 36.01 | 38.02 |
| 6 | Dad is coming with a big bag. | 50.40 | 53.18 |
| 7 | Wow, snacks! | 58.55 | 60.25 |
| 8 | Max loves snacks, too. | 63.80 | 66.02 |

## 验证流程

### 1. 代码检查

```bash
node --check assets/app.js
node --check data/chapters.js
```

### 2. 播放高亮验证

打开页面后，用每句中间附近的时间点检查当前高亮句。

A1 验证点：

```text
5.8  -> This is Annie's apple tree.
11.3 -> Annie is on the mat.
21.4 -> Max loves apples.
27.2 -> Ants love apples, too.
37.1 -> Annie's cat is angry.
51.7 -> Dad is coming with a big bag.
59.1 -> Wow, snacks!
65.0 -> Max loves snacks, too.
```

每个时间点的高亮句必须完全对应。

### 3. 交互验证

至少检查：

1. 点击章节进入当前章节。
2. 播放整章时当前句放大。
3. 暂停后可以继续。
4. 点击任意一句，只读这一句并自动暂停。
5. 进度保存后刷新页面能恢复。
6. 移动端和桌面端没有横向溢出。

## 微调规则

如果识别结果整体正确，但某句仍偏差超过 0.3 秒：

1. 用页面右上角“校准”模式微调。
2. 播放到句子开头时点击该句。
3. 校准数据保存在浏览器本地。
4. 如果微调结果已经确认正确，把最终秒数回写到 `data/chapters.js`，并更新 `timingVersion`。

## 禁止事项

1. 不要用 TTS 替代课程原声。
2. 不要只靠波形音量推断正式时间轴。
3. 不要在音频内容不明时凭文本长度均分时间。
4. 不要复用旧章节的 `timingVersion`。
5. 不要把临时 WAV 和识别中间结果放进项目目录。

## 新章节最小清单

1. 放入 `audio/{chapterId}.mp3`。
2. 确认音频时长。
3. 整理该章句子和字母标红。
4. 生成 16kHz mono WAV。
5. 按 4 秒/2 秒重叠切块。
6. 逐段本地语音识别。
7. 合并词级时间并确定句边界。
8. 写入 `data/chapters.js`。
9. 更新 `timingVersion`。
10. 完成播放高亮和点击朗读验证。
