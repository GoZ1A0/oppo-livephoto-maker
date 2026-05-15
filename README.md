# GIF/MP4 → OPPO Live Photo Converter

将 GIF 动图或 MP4 视频转换为 OPPO 实况照片格式。同时提供 C 语言和 JavaScript 两种实现。

## 项目结构

```
giftojpg/
├── index.html               # Web 界面 (拖放转换)
├── js/
│   ├── converter.js         # 单文件转换入口
│   ├── mp4-generator.js     # GIF → MP4 编码器 (基于 FFmpeg.wasm)
│   ├── oppo-parser.js       # OPPO 实况照片格式解析/生成
│   └── batch-processor.js   # 批量转换队列 + Workers
├── c/
│   ├── oppo.h               # C 库头文件
│   ├── oppo.c               # OPPO 格式核心实现
│   ├── cli.c                # CLI 工具
│   ├── Makefile              # 编译配置
│   └── CMakeLists.txt       # CMake 配置
└── README.md
```

## OPPO 实况照片格式

OPPO 实况照片文件是一个遵循 `.jpg` 扩展名的多项式容器，结构如下：

```
┌── JPEG SOI (0xFFD8)
├── APP1 (Exif)
├── APP2 (MPF/其他)
├── APP5 ~ APP10 (视频冗余块，每个 ≤ 65406 字节)
├── JPEG 主体图像数据
├── JPEG EOI (0xFFD9)
├── 缩略图 JPEG (可选)
├── MP4 主视频 (ftyp + moov + mdat)
├── MP4 副视频 (可选，最小预览)
├── JSON 索引元数据
└── jxrs 容器尾部 (4字节 size + "jxrs")
```

### 核心原理

OPPO 相册通过以下特征识别实况照片：

1. **APP5-APP10 标记段** — JPEG APPn 标记 (0xFFE5 ~ 0xFFEA) 中嵌入了视频数据的索引摘要
2. **尾附 MP4 数据** — 完整的 MP4 视频数据直接追加在 JPEG 数据之后
3. **JSON 元数据表** — 文件末尾 (jxrs 之前) 记录各组件的 offset/length，包含 `live.subVideo` 等字段
4. **jxrs 结束标记** — 文件最后 8 字节为 `[00 00 00 08] "jxrs"`

## JavaScript 版本

### 使用方法

直接在浏览器中打开 `index.html`，拖放 GIF/MP4 文件即可转换。

或者通过 API 调用：

```javascript
import { Converter } from './js/converter.js';

const converter = new Converter();

// 转换 GIF → OPPO 实况照片
await converter.convertGIF(gifFile, {
  quality: 0.9,
  fps: 15
}).then(blob => {
  // blob 为 OPPO 实况照片 Blob
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'livephoto.jpg';
  a.click();
});

// 转换 MP4 + 封面 → OPPO 实况照片
await converter.convertMP4(mp4File, coverImageFile, {
  hasSubVideo: false
}).then(blob => { ... });
```

### 批量转换

```javascript
import { BatchProcessor } from './js/batch-processor.js';

const processor = new BatchProcessor();
processor.onProgress = (current, total, filename) => {
  console.log(`Processing: ${current}/${total} - ${filename}`);
};

processor.addFiles([file1, file2, file3]);
await processor.process();
```

## C 语言版本

### 编译

**GCC/MinGW:**
```bash
cd c
make
```

**MSVC:**
```bash
cd c
cl /Fe:oppo_cli.exe cli.c oppo.c
```

**CMake:**
```bash
cd c
mkdir build && cd build
cmake .. -G "MinGW Makefiles"
make
```

### 命令行使用

**创建实况照片:**
```bash
oppo_cli combine cover.jpg video.mp4 -o output.jpg
oppo_cli combine cover.jpg video.mp4 -s sub.mp4 -o output.jpg
```

**解析实况照片:**
```bash
oppo_cli parse livephoto.jpg -o ./extracted -v
```

**查看信息:**
```bash
oppo_cli info livephoto.jpg
```

### C API

```c
#include "oppo.h"

// 生成 OPPO 实况照片
uint8_t *output = NULL;
size_t output_size = 0;

oppo_error_t err = oppo_generate(
    cover_jpeg_data, cover_jpeg_size,
    main_video_data, main_video_size,
    sub_video_data, sub_video_size,  // NULL 则自动生成
    &output, &output_size
);

if (err == OPPO_OK) {
    oppo_write_file("output.jpg", output, output_size);
    free(output);
}

// 解析实况照片
oppo_components_t comp;
oppo_parse(data, size, &comp);

// comp.jpeg_data    → 封面 JPEG
// comp.main_video   → 主视频 MP4
// comp.sub_video    → 副视频 MP4
// comp.metadata_json → JSON 元数据

oppo_components_free(&comp);
```

## 依赖项

### JavaScript 版本
- [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) — GIF 转 MP4 编码
- 现代浏览器 (支持 Web Workers, SharedArrayBuffer, COEP)

### C 版本
- C99 标准库 (stdio, stdlib, string)

## 注意事项

- 生成的实况照片只能在 OPPO ColorOS 12+ 的相册中识别为实况照片
- GIF 转换需要 ffmpeg.wasm 运行时 (首次加载约 31MB)
- 文件大小限制：浏览器版本受内存限制，C 版本无此限制
- C 版本的封面 JPEG 必须是有效的 JPEG 文件，视频必须是 MP4 格式

## License

MIT