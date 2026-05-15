/**
 * oppo.c - OPPO Live Photo Format Implementation
 */

#include "oppo.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

/* ─── 内存管理 ─── */

oppo_buffer_t *oppo_buffer_alloc(size_t initial_capacity)
{
    oppo_buffer_t *buf = (oppo_buffer_t *)calloc(1, sizeof(oppo_buffer_t));
    if (!buf) return NULL;

    if (initial_capacity > 0) {
        buf->data = (uint8_t *)malloc(initial_capacity);
        if (!buf->data) {
            free(buf);
            return NULL;
        }
        buf->capacity = initial_capacity;
    }
    buf->size = 0;
    return buf;
}

void oppo_buffer_free(oppo_buffer_t *buf)
{
    if (buf) {
        free(buf->data);
        free(buf);
    }
}

oppo_error_t oppo_buffer_append(oppo_buffer_t *buf, const uint8_t *data, size_t size)
{
    if (!buf || !data) return OPPO_ERR_NULL_PTR;
    if (size == 0) return OPPO_OK;

    size_t needed = buf->size + size;
    if (needed > buf->capacity) {
        size_t new_cap = buf->capacity ? buf->capacity * 2 : 4096;
        while (new_cap < needed) new_cap *= 2;

        uint8_t *new_data = (uint8_t *)realloc(buf->data, new_cap);
        if (!new_data) return OPPO_ERR_MEMORY;

        buf->data = new_data;
        buf->capacity = new_cap;
    }

    memcpy(buf->data + buf->size, data, size);
    buf->size = needed;
    return OPPO_OK;
}

/* ─── 文件I/O ─── */

oppo_error_t oppo_read_file(const char *filename, uint8_t **out_data, size_t *out_size)
{
    if (!filename || !out_data || !out_size) return OPPO_ERR_NULL_PTR;

    FILE *fp = fopen(filename, "rb");
    if (!fp) return OPPO_ERR_FILE_IO;

    fseek(fp, 0, SEEK_END);
    long fsize = ftell(fp);
    fseek(fp, 0, SEEK_SET);

    if (fsize <= 0) {
        fclose(fp);
        return OPPO_ERR_FILE_IO;
    }

    uint8_t *data = (uint8_t *)malloc((size_t)fsize);
    if (!data) {
        fclose(fp);
        return OPPO_ERR_MEMORY;
    }

    size_t read_size = fread(data, 1, (size_t)fsize, fp);
    fclose(fp);

    if (read_size != (size_t)fsize) {
        free(data);
        return OPPO_ERR_FILE_IO;
    }

    *out_data = data;
    *out_size = (size_t)fsize;
    return OPPO_OK;
}

oppo_error_t oppo_write_file(const char *filename, const uint8_t *data, size_t size)
{
    if (!filename || !data) return OPPO_ERR_NULL_PTR;

    FILE *fp = fopen(filename, "wb");
    if (!fp) return OPPO_ERR_FILE_IO;

    size_t written = fwrite(data, 1, size, fp);
    fclose(fp);

    return (written == size) ? OPPO_OK : OPPO_ERR_FILE_IO;
}

/* ─── 格式检测 ─── */

int oppo_is_gif(const uint8_t *data, size_t size)
{
    if (!data || size < 4) return 0;
    return (data[0] == 'G' && data[1] == 'I' && data[2] == 'F' && data[3] == '8');
}

int oppo_is_mp4(const uint8_t *data, size_t size)
{
    if (!data || size < 12) return 0;
    /* Check ftyp box: [size 4B] [ftyp 4B] */
    if (data[4] == 'f' && data[5] == 't' && data[6] == 'y' && data[7] == 'p') {
        return 1;
    }
    return 0;
}

int oppo_is_jpeg(const uint8_t *data, size_t size)
{
    if (!data || size < 2) return 0;
    return (data[0] == 0xFF && data[1] == 0xD8);
}

/* ─── 辅助函数 ─── */

int oppo_find_pattern(const uint8_t *data, size_t size,
                      const uint8_t *pattern, size_t pattern_len)
{
    if (!data || !pattern || pattern_len == 0 || size < pattern_len) return -1;

    for (size_t i = 0; i <= size - pattern_len; i++) {
        int match = 1;
        for (size_t j = 0; j < pattern_len; j++) {
            if (data[i + j] != pattern[j]) {
                match = 0;
                break;
            }
        }
        if (match) return (int)i;
    }
    return -1;
}

const char *oppo_error_string(oppo_error_t err)
{
    switch (err) {
        case OPPO_OK:                return "Success";
        case OPPO_ERR_NULL_PTR:      return "Null pointer";
        case OPPO_ERR_INVALID_JPEG:  return "Invalid JPEG";
        case OPPO_ERR_INVALID_MP4:   return "Invalid MP4";
        case OPPO_ERR_MEMORY:        return "Memory allocation failed";
        case OPPO_ERR_INVALID_PARAM: return "Invalid parameter";
        case OPPO_ERR_FILE_IO:       return "File I/O error";
        case OPPO_ERR_UNSUPPORTED:   return "Unsupported format";
        default:                     return "Unknown error";
    }
}

/* ─── 内部辅助函数 ─── */

/**
 * 查找JPEG EOI标记位置
 */
static int find_eoi(const uint8_t *data, size_t size)
{
    if (size < 2) return -1;
    for (size_t i = size - 2; i > 0; i--) {
        if (data[i] == 0xFF && data[i + 1] == 0xD9) {
            return (int)i;
        }
    }
    return -1;
}

/**
 * 生成最小JPEG缩略图 (1x1 灰色像素)
 */
static const uint8_t MINIMAL_JPEG[] = {
    0xFF, 0xD8, /* SOI */
    0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00, /* APP0 JFIF */
    0xFF, 0xDB, 0x00, 0x43,             /* DQT */
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07,
    0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C,
    0x19, 0x12, 0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A,
    0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C,
    0x1C, 0x28, 0x37, 0x29, 0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F,
    0x27, 0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32,
    0xFF, 0xC0, 0x00, 0x0B,             /* SOF */
    0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xFF, 0xC4, 0x00, 0x1B,             /* DHT */
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x01,
    0x00, 0x00, 0x00, 0x00, 0x00,
    0xFF, 0xDA, 0x00, 0x08,             /* SOS + compressed data */
    0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x7F, 0xB5, 0x8D,
    0xFF, 0xD9  /* EOI */
};
#define MINIMAL_JPEG_SIZE (sizeof(MINIMAL_JPEG))

/**
 * 生成最小MP4 (ftyp + moov)
 */
static const uint8_t MINIMAL_MP4[] = {
    /* ftyp box */
    0x00, 0x00, 0x00, 0x1C,  /* size=28 */
    0x66, 0x74, 0x79, 0x70,  /* 'ftyp' */
    0x6D, 0x70, 0x34, 0x32,  /* 'mp42' */
    0x00, 0x00, 0x00, 0x00,  /* minor version */
    0x69, 0x73, 0x6F, 0x6D,  /* 'isom' */
    0x6D, 0x70, 0x34, 0x32,  /* 'mp42' */
};
#define MINIMAL_MP4_SIZE (sizeof(MINIMAL_MP4))

/**
 * jxrs 容器尾部
 */
static const uint8_t JXRS_FOOTER[] = {
    0x00, 0x00, 0x00, 0x08,  /* size=8 */
    0x6A, 0x78, 0x72, 0x73,  /* 'jxrs' */
};
#define JXRS_FOOTER_SIZE (sizeof(JXRS_FOOTER))

/**
 * 构建默认JSON元数据
 */
static size_t build_metadata_json(
    const uint8_t *cover_jpeg, size_t cover_size,
    size_t video_offset,
    size_t sub_video_offset, size_t sub_video_size,
    size_t total_size,
    char *out, size_t out_capacity)
{
    /* 
     * OPPO metadata is a compact JSON array:
     * [
     *   {"length":7,"name":"capture.mode","offset":xxx,"version":1},
     *   {"length":88,"name":"fb.param","offset":xxx,"version":1},
     *   {"length":xxx,"name":"live.subVideo","offset":xxx,"version":1},
     *   {"length":7,"name":"live.subVideoSize","offset":xxx,"version":1},
     *   {"length":4,"name":"private.emptyspace","offset":xxx,"version":1},
     *   {"length":80,"name":"watermark.device","offset":xxx,"version":1}
     * ]
     */
    return snprintf(out, out_capacity,
        "["
        "{\"length\":7,\"name\":\"capture.mode\",\"offset\":%zu,\"version\":1},"
        "{\"length\":88,\"name\":\"fb.param\",\"offset\":%zu,\"version\":1},"
        "{\"length\":%zu,\"name\":\"live.subVideo\",\"offset\":%zu,\"version\":1},"
        "{\"length\":7,\"name\":\"live.subVideoSize\",\"offset\":%zu,\"version\":1},"
        "{\"length\":4,\"name\":\"private.emptyspace\",\"offset\":%zu,\"version\":1},"
        "{\"length\":80,\"name\":\"watermark.device\",\"offset\":%zu,\"version\":1}"
        "]",
        video_offset + 20,
        video_offset + 12,
        sub_video_size, sub_video_offset,
        sub_video_offset + 7,
        total_size > 20 ? total_size - 20 : 0,
        total_size > 25 ? total_size - 25 : 0
    );
}

/* ─── 解析OPPO实况照片 ─── */

oppo_error_t oppo_parse(const uint8_t *data, size_t size,
                         oppo_components_t *components)
{
    if (!data || !components) return OPPO_ERR_NULL_PTR;
    if (!oppo_is_jpeg(data, size)) return OPPO_ERR_INVALID_JPEG;

    memset(components, 0, sizeof(oppo_components_t));

    int eoi1 = find_eoi(data, size);
    if (eoi1 < 0) return OPPO_ERR_INVALID_JPEG;

    /* 提取主JPEG (SOI到第一个EOI) */
    components->jpeg_size = (size_t)(eoi1 + 2);
    components->jpeg_data = (uint8_t *)malloc(components->jpeg_size);
    if (!components->jpeg_data) return OPPO_ERR_MEMORY;
    memcpy(components->jpeg_data, data, components->jpeg_size);

    /* 查找jxrs尾部 */
    const uint8_t jxrs_pat[] = { 'j', 'x', 'r', 's' };
    int jxrs_pos = oppo_find_pattern(data, size, jxrs_pat, 4);

    if (jxrs_pos >= 8) {
        /* 存储jxrs footer (含4字节size) */
        components->jxrs_size = 8;
        components->jxrs_data = (uint8_t *)malloc(8);
        if (components->jxrs_data) {
            memcpy(components->jxrs_data, data + jxrs_pos - 4, 8);
        }
    }

    /* 查找JSON元数据 (在jxrs前面找 "[{" 模式) */
    if (jxrs_pos > 5) {
        for (int i = jxrs_pos - 1; i >= 0 && i > jxrs_pos - 5000; i--) {
            if (data[i] == '[' && i + 1 < (int)size && data[i + 1] == '{') {
                /* 找到JSON起始, 找结束 "}]" */
                for (int j = i; j < jxrs_pos + 20 && j < (int)size; j++) {
                    if (data[j] == '}' && j + 1 < (int)size && data[j + 1] == ']') {
                        components->metadata_size = (size_t)(j - i + 2);
                        components->metadata_json = (uint8_t *)malloc(components->metadata_size + 1);
                        if (components->metadata_json) {
                            memcpy(components->metadata_json, data + i, components->metadata_size);
                            components->metadata_json[components->metadata_size] = '\0';
                        }
                        break;
                    }
                }
                break;
            }
        }
    }

    /* 查找MP4视频数据 (ftyp box) */
    const uint8_t ftyp_pat[] = { 'f', 't', 'y', 'p' };
    int first_ftyp = -1;

    for (size_t i = (size_t)(eoi1 + 2); i < size - 8; i++) {
        if (memcmp(data + i, ftyp_pat, 4) == 0) {
            if (i >= 4) {
                first_ftyp = (int)(i - 4); /* ftyp box开始于size字段 */
                break;
            }
        }
    }

    if (first_ftyp > eoi1) {
        /* 提取所有剩余的MP4数据 */
        components->main_video_size = size - (size_t)first_ftyp;
        components->main_video = (uint8_t *)malloc(components->main_video_size);
        if (components->main_video) {
            memcpy(components->main_video, data + first_ftyp, components->main_video_size);
        }
    }

    return OPPO_OK;
}

void oppo_components_free(oppo_components_t *components)
{
    if (components) {
        free(components->jpeg_data);
        free(components->thumbnail_data);
        free(components->main_video);
        free(components->sub_video);
        free(components->metadata_json);
        free(components->jxrs_data);
        memset(components, 0, sizeof(oppo_components_t));
    }
}

/* ─── 生成OPPO实况照片 ─── */

oppo_error_t oppo_generate(
    const uint8_t *cover_jpeg, size_t cover_size,
    const uint8_t *video_data, size_t video_size,
    const uint8_t *sub_video_data, size_t sub_video_size,
    uint8_t **out_data, size_t *out_size)
{
    if (!cover_jpeg || !video_data || !out_data || !out_size)
        return OPPO_ERR_NULL_PTR;

    oppo_buffer_t *buf = oppo_buffer_alloc(cover_size + video_size + 65536);
    if (!buf) return OPPO_ERR_MEMORY;

    oppo_error_t err = OPPO_OK;
    int eoi = find_eoi(cover_jpeg, cover_size);
    if (eoi < 0) {
        oppo_buffer_free(buf);
        return OPPO_ERR_INVALID_JPEG;
    }

    /* 1. 写入封面JPEG主体 (去掉EOI) */
    err = oppo_buffer_append(buf, cover_jpeg, (size_t)eoi);
    if (err != OPPO_OK) goto cleanup;

    /* 2. 填入APP5-APP10视频数据块 */
    size_t video_offset = 0;
    for (int i = 0; i < OPPO_NUM_APP_CHUNKS; i++) {
        size_t chunk_size = OPPO_APP_CHUNK_SIZE;
        if (video_offset + chunk_size > video_size) {
            chunk_size = video_size - video_offset;
            if (chunk_size == 0) {
                chunk_size = OPPO_APP_CHUNK_SIZE;
            }
        }

        uint16_t seg_length = (uint16_t)(chunk_size + 2);
        uint8_t app_header[4];
        app_header[0] = 0xFF;
        app_header[1] = (uint8_t)(0xE5 + i);
        app_header[2] = (seg_length >> 8) & 0xFF;
        app_header[3] = seg_length & 0xFF;

        err = oppo_buffer_append(buf, app_header, 4);
        if (err != OPPO_OK) goto cleanup;

        if (video_offset < video_size) {
            size_t to_copy = chunk_size;
            if (video_offset + to_copy > video_size) {
                to_copy = video_size - video_offset;
            }
            err = oppo_buffer_append(buf, video_data + video_offset, to_copy);
            if (err != OPPO_OK) goto cleanup;
            video_offset += to_copy;

            /* 如果chunk_size > to_copy, 补零 */
            if (to_copy < chunk_size) {
                uint8_t *zeros = (uint8_t *)calloc(chunk_size - to_copy, 1);
                err = oppo_buffer_append(buf, zeros, chunk_size - to_copy);
                free(zeros);
                if (err != OPPO_OK) goto cleanup;
            }
        } else {
            /* 视频数据已用完, 补零 */
            uint8_t *zeros = (uint8_t *)calloc(chunk_size, 1);
            err = oppo_buffer_append(buf, zeros, chunk_size);
            free(zeros);
            if (err != OPPO_OK) goto cleanup;
        }
    }

    /* 3. 写入JPEG EOI */
    {
        uint8_t eoi_marker[] = { 0xFF, 0xD9 };
        err = oppo_buffer_append(buf, eoi_marker, 2);
        if (err != OPPO_OK) goto cleanup;
    }

    /* 4. 写入缩略图JPEG */
    err = oppo_buffer_append(buf, MINIMAL_JPEG, MINIMAL_JPEG_SIZE);
    if (err != OPPO_OK) goto cleanup;

    /* 5. 写入主MP4视频 */
    size_t main_video_offset = buf->size;
    err = oppo_buffer_append(buf, video_data, video_size);
    if (err != OPPO_OK) goto cleanup;

    /* 6. 写入副视频 */
    size_t sub_video_offset_local = buf->size;
    size_t actual_sub_size;
    
    if (sub_video_data && sub_video_size > 0) {
        err = oppo_buffer_append(buf, sub_video_data, sub_video_size);
        if (err != OPPO_OK) goto cleanup;
        actual_sub_size = sub_video_size;
    } else {
        err = oppo_buffer_append(buf, MINIMAL_MP4, MINIMAL_MP4_SIZE);
        if (err != OPPO_OK) goto cleanup;
        actual_sub_size = MINIMAL_MP4_SIZE;
    }

    /* 7. 构建并写入JSON元数据 */
    {
        char metadata[2048];
        size_t total_current = buf->size; /* 写入元数据前的大小 */
        size_t meta_len = build_metadata_json(
            cover_jpeg, cover_size,
            main_video_offset,
            sub_video_offset_local, actual_sub_size,
            total_current + 2048,
            metadata, sizeof(metadata)
        );
        err = oppo_buffer_append(buf, (const uint8_t *)metadata, meta_len);
        if (err != OPPO_OK) goto cleanup;
    }

    /* 8. 写入jxrs容器尾部 */
    err = oppo_buffer_append(buf, JXRS_FOOTER, JXRS_FOOTER_SIZE);
    if (err != OPPO_OK) goto cleanup;

    /* 输出 */
    *out_data = buf->data;
    *out_size = buf->size;
    buf->data = NULL; /* 转移所有权, 防止被free */
    oppo_buffer_free(buf);
    return OPPO_OK;

cleanup:
    oppo_buffer_free(buf);
    return err;
}