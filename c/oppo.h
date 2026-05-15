/**
 * oppo.h - OPPO Live Photo Format Library
 * 
 * OPPO实况照片格式定义和操作函数
 * 
 * 文件结构:
 * ┌── JPEG SOI (0xFFD8)
 * ├── APP1 (Exif)  
 * ├── APP2 (MPF/其他)
 * ├── APP5~APP10 (视频元数据块, 每块≤65406字节)
 * ├── JPEG 主体图像数据
 * ├── JPEG EOI (0xFFD9)
 * ├── 缩略图JPEG (可选)
 * ├── MP4 主视频
 * ├── MP4 副视频 (可选, 小型预览用)
 * ├── JSON 索引元数据
 * └── jxrs 容器结束标记
 */

#ifndef OPPO_H
#define OPPO_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* 常量定义 */
#define OPPO_APP_CHUNK_SIZE     65406
#define OPPO_APP_START          0xE5
#define OPPO_APP_END            0xEA
#define OPPO_NUM_APP_CHUNKS     6

#define OPPO_SOI                0xFFD8
#define OPPO_EOI                0xFFD9
#define OPPO_APP0               0xFFE0
#define OPPO_APP1               0xFFE1

/* FTYP 品牌 */
#define FTYP_MP42               0x6D703432

/* 错误码 */
typedef enum {
    OPPO_OK = 0,
    OPPO_ERR_NULL_PTR = -1,
    OPPO_ERR_INVALID_JPEG = -2,
    OPPO_ERR_INVALID_MP4 = -3,
    OPPO_ERR_MEMORY = -4,
    OPPO_ERR_INVALID_PARAM = -5,
    OPPO_ERR_FILE_IO = -6,
    OPPO_ERR_UNSUPPORTED = -7,
} oppo_error_t;

/* 缓冲区 */
typedef struct {
    uint8_t *data;
    size_t   size;
    size_t   capacity;
} oppo_buffer_t;

/* OPPO实况照片组件 */
typedef struct {
    uint8_t *jpeg_data;         /* 主JPEG图像 */
    size_t   jpeg_size;

    uint8_t *thumbnail_data;    /* 缩略图JPEG */
    size_t   thumbnail_size;

    uint8_t *main_video;        /* 主MP4视频 */
    size_t   main_video_size;

    uint8_t *sub_video;         /* 副MP4视频 */
    size_t   sub_video_size;

    uint8_t *metadata_json;     /* JSON元数据 */
    size_t   metadata_size;

    uint8_t *jxrs_footer;       /* jxrs容器尾部 */
    size_t   jxrs_size;
} oppo_components_t;

/* 元数据条目 */
typedef struct {
    const char *name;
    uint32_t    offset;
    uint32_t    length;
    uint32_t    version;
} oppo_meta_entry_t;

/* ─── 内存管理 ─── */

/** 分配缓冲区 */
oppo_buffer_t *oppo_buffer_alloc(size_t initial_capacity);
/** 释放缓冲区 */
void oppo_buffer_free(oppo_buffer_t *buf);
/** 追加数据到缓冲区 */
oppo_error_t oppo_buffer_append(oppo_buffer_t *buf, const uint8_t *data, size_t size);

/* ─── 文件I/O ─── */

/** 读取整个文件到内存 */
oppo_error_t oppo_read_file(const char *filename, uint8_t **out_data, size_t *out_size);
/** 写入数据到文件 */
oppo_error_t oppo_write_file(const char *filename, const uint8_t *data, size_t size);

/* ─── 格式检测 ─── */

/** 检测是否为GIF文件 */
int oppo_is_gif(const uint8_t *data, size_t size);
/** 检测是否为MP4文件 */
int oppo_is_mp4(const uint8_t *data, size_t size);
/** 检测是否为JPEG文件 */
int oppo_is_jpeg(const uint8_t *data, size_t size);

/* ─── 生成OPPO实况照片 ─── */

/**
 * 从封面JPEG和视频数据生成OPPO实况照片
 *
 * @param cover_jpeg      封面JPEG数据
 * @param cover_size      封面JPEG大小
 * @param video_data      视频数据 (MP4格式)
 * @param video_size      视频大小
 * @param sub_video_data  副视频数据 (可选, 传NULL则自动生成最小视频)
 * @param sub_video_size  副视频大小
 * @param out_data        输出缓冲区指针
 * @param out_size        输出大小指针
 * @return OPPO_OK 成功, 其他为错误码
 */
oppo_error_t oppo_generate(
    const uint8_t *cover_jpeg, size_t cover_size,
    const uint8_t *video_data, size_t video_size,
    const uint8_t *sub_video_data, size_t sub_video_size,
    uint8_t **out_data, size_t *out_size
);

/**
 * 解析OPPO实况照片文件
 *
 * @param data       输入文件数据
 * @param size       输入文件大小
 * @param components 输出解析后的组件
 * @return OPPO_OK 成功, 其他为错误码
 */
oppo_error_t oppo_parse(
    const uint8_t *data, size_t size,
    oppo_components_t *components
);

/**
 * 释放解析结果
 */
void oppo_components_free(oppo_components_t *components);

/* ─── 辅助函数 ─── */

/** 查找字节模式 */
int oppo_find_pattern(const uint8_t *data, size_t size, 
                      const uint8_t *pattern, size_t pattern_len);

/** 获取错误描述 */
const char *oppo_error_string(oppo_error_t err);

#ifdef __cplusplus
}
#endif

#endif /* OPPO_H */