/**
 * cli.c - OPPO Live Photo CLI Tool
 * 
 * Usage:
 *   oppo_cli combine <cover.jpg> <video.mp4> [-o output.jpg] [-s sub_video.mp4]
 *   oppo_cli parse   <livephoto.jpg> [-o output_dir] [-v]
 *   oppo_cli info    <livephoto.jpg>
 *   oppo_cli help
 *
 * Build:
 *   gcc -o oppo_cli cli.c oppo.c -Wall -O2
 *   or use CMake / Makefile
 */

#include "oppo.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define VERSION "1.0.0"

static void print_usage(void)
{
    printf("OPPO Live Photo CLI Tool v%s\n\n", VERSION);
    printf("Usage:\n");
    printf("  oppo_cli combine <cover.jpg> <video.mp4> [options]\n");
    printf("    Create OPPO live photo from cover image + video\n");
    printf("    Options:\n");
    printf("      -o <output.jpg>   Output filename (default: output_livephoto.jpg)\n");
    printf("      -s <sub.mp4>      Sub-video file (optional)\n");
    printf("\n");
    printf("  oppo_cli parse <livephoto.jpg> [options]\n");
    printf("    Extract components from OPPO live photo\n");
    printf("    Options:\n");
    printf("      -o <output_dir>   Output directory (default: current dir)\n");
    printf("      -v                Verbose output\n");
    printf("\n");
    printf("  oppo_cli info <livephoto.jpg>\n");
    printf("    Display information about an OPPO live photo\n");
    printf("\n");
    printf("  oppo_cli help\n");
    printf("    Show this help message\n");
    printf("\n");
    printf("Examples:\n");
    printf("  oppo_cli combine cover.jpg video.mp4 -o myphoto.jpg\n");
    printf("  oppo_cli parse myphoto.jpg -o ./extracted -v\n");
    printf("  oppo_cli info myphoto.jpg\n");
}

/**
 * Format file size for display
 */
static const char *format_size(size_t bytes)
{
    static char buf[32];
    if (bytes >= 1024 * 1024) {
        snprintf(buf, sizeof(buf), "%.2f MB", (double)bytes / (1024 * 1024));
    } else if (bytes >= 1024) {
        snprintf(buf, sizeof(buf), "%.2f KB", (double)bytes / 1024);
    } else {
        snprintf(buf, sizeof(buf), "%zu B", bytes);
    }
    return buf;
}

/* ─── Combine command ─── */
static int cmd_combine(int argc, char *argv[])
{
    const char *cover_path = NULL;
    const char *video_path = NULL;
    const char *output_path = "output_livephoto.jpg";
    const char *sub_video_path = NULL;

    /* Parse arguments */
    int i = 0;
    for (; i < argc; i++) {
        if (cover_path == NULL) {
            cover_path = argv[i];
        } else if (video_path == NULL) {
            video_path = argv[i];
        } else if (strcmp(argv[i], "-o") == 0 && i + 1 < argc) {
            output_path = argv[++i];
        } else if (strcmp(argv[i], "-s") == 0 && i + 1 < argc) {
            sub_video_path = argv[++i];
        }
    }

    if (!cover_path || !video_path) {
        fprintf(stderr, "Error: Missing cover JPEG or video file\n\n");
        print_usage();
        return 1;
    }

    printf("Creating OPPO live photo...\n");
    printf("  Cover: %s\n", cover_path);
    printf("  Video: %s\n", video_path);
    if (sub_video_path) {
        printf("  Sub-video: %s\n", sub_video_path);
    }
    printf("  Output: %s\n", output_path);

    /* Read cover */
    uint8_t *cover_data = NULL;
    size_t cover_size = 0;
    oppo_error_t err = oppo_read_file(cover_path, &cover_data, &cover_size);
    if (err != OPPO_OK) {
        fprintf(stderr, "Error reading cover: %s\n", oppo_error_string(err));
        return 1;
    }

    if (!oppo_is_jpeg(cover_data, cover_size)) {
        fprintf(stderr, "Error: Cover file is not a valid JPEG\n");
        free(cover_data);
        return 1;
    }
    printf("  Cover size: %s\n", format_size(cover_size));

    /* Read video */
    uint8_t *video_data = NULL;
    size_t video_size = 0;
    err = oppo_read_file(video_path, &video_data, &video_size);
    if (err != OPPO_OK) {
        fprintf(stderr, "Error reading video: %s\n", oppo_error_string(err));
        free(cover_data);
        return 1;
    }
    printf("  Video size: %s\n", format_size(video_size));

    /* Read sub-video if provided */
    uint8_t *sub_data = NULL;
    size_t sub_size = 0;
    if (sub_video_path) {
        err = oppo_read_file(sub_video_path, &sub_data, &sub_size);
        if (err != OPPO_OK) {
            fprintf(stderr, "Error reading sub-video: %s\n", oppo_error_string(err));
            free(cover_data);
            free(video_data);
            return 1;
        }
        printf("  Sub-video size: %s\n", format_size(sub_size));
    }

    /* Generate OPPO live photo */
    uint8_t *out_data = NULL;
    size_t out_size = 0;

    printf("Generating...\n");
    err = oppo_generate(cover_data, cover_size,
                        video_data, video_size,
                        sub_data, sub_size,
                        &out_data, &out_size);

    free(cover_data);
    free(video_data);
    free(sub_data);

    if (err != OPPO_OK) {
        fprintf(stderr, "Error generating OPPO live photo: %s\n", oppo_error_string(err));
        return 1;
    }

    /* Write output */
    err = oppo_write_file(output_path, out_data, out_size);
    free(out_data);

    if (err != OPPO_OK) {
        fprintf(stderr, "Error writing output: %s\n", oppo_error_string(err));
        return 1;
    }

    printf("\n✓ Success!\n");
    printf("  Output: %s (%s)\n", output_path, format_size(out_size));

    return 0;
}

/* ─── Parse command ─── */
static int cmd_parse(int argc, char *argv[])
{
    const char *input_path = NULL;
    const char *output_dir = ".";
    int verbose = 0;

    /* Parse arguments */
    int i = 0;
    for (; i < argc; i++) {
        if (input_path == NULL) {
            input_path = argv[i];
        } else if (strcmp(argv[i], "-o") == 0 && i + 1 < argc) {
            output_dir = argv[++i];
        } else if (strcmp(argv[i], "-v") == 0) {
            verbose = 1;
        }
    }

    if (!input_path) {
        fprintf(stderr, "Error: Missing input file\n\n");
        print_usage();
        return 1;
    }

    printf("Parsing OPPO live photo: %s\n", input_path);

    /* Read input */
    uint8_t *data = NULL;
    size_t size = 0;
    oppo_error_t err = oppo_read_file(input_path, &data, &size);
    if (err != OPPO_OK) {
        fprintf(stderr, "Error reading file: %s\n", oppo_error_string(err));
        return 1;
    }
    printf("  File size: %s\n", format_size(size));

    /* Parse */
    oppo_components_t comp;
    memset(&comp, 0, sizeof(comp));

    err = oppo_parse(data, size, &comp);
    free(data);

    if (err != OPPO_OK) {
        fprintf(stderr, "Error parsing: %s\n", oppo_error_string(err));
        return 1;
    }

    /* Extract components */
    char output_path[1024];

    if (comp.jpeg_data && comp.jpeg_size > 0) {
        snprintf(output_path, sizeof(output_path), "%s/cover.jpg", output_dir);
        oppo_write_file(output_path, comp.jpeg_data, comp.jpeg_size);
        printf("  Extracted: cover.jpg (%s)\n", format_size(comp.jpeg_size));
    }

    if (comp.main_video && comp.main_video_size > 0) {
        snprintf(output_path, sizeof(output_path), "%s/video.mp4", output_dir);
        oppo_write_file(output_path, comp.main_video, comp.main_video_size);
        printf("  Extracted: video.mp4 (%s)\n", format_size(comp.main_video_size));
    }

    if (comp.sub_video && comp.sub_video_size > 0) {
        snprintf(output_path, sizeof(output_path), "%s/sub_video.mp4", output_dir);
        oppo_write_file(output_path, comp.sub_video, comp.sub_video_size);
        printf("  Extracted: sub_video.mp4 (%s)\n", format_size(comp.sub_video_size));
    }

    if (comp.metadata_json && comp.metadata_size > 0) {
        snprintf(output_path, sizeof(output_path), "%s/metadata.json", output_dir);
        oppo_write_file(output_path, comp.metadata_json, comp.metadata_size);
        printf("  Extracted: metadata.json (%s)\n", format_size(comp.metadata_size));
    }

    if (comp.thumbnail_data && comp.thumbnail_size > 0) {
        snprintf(output_path, sizeof(output_path), "%s/thumbnail.jpg", output_dir);
        oppo_write_file(output_path, comp.thumbnail_data, comp.thumbnail_size);
        printf("  Extracted: thumbnail.jpg (%s)\n", format_size(comp.thumbnail_size));
    }

    if (verbose && comp.jxrs_data && comp.jxrs_size > 0) {
        printf("  jxrs footer: present (8 bytes)\n");
    }

    oppo_components_free(&comp);
    printf("\n✓ Extraction complete!\n");
    return 0;
}

/* ─── Info command ─── */
static int cmd_info(int argc, char *argv[])
{
    const char *input_path = NULL;

    for (int i = 0; i < argc; i++) {
        if (strncmp(argv[i], "-", 1) != 0) {
            input_path = argv[i];
            break;
        }
    }

    if (!input_path) {
        fprintf(stderr, "Error: Missing input file\n\n");
        print_usage();
        return 1;
    }

    uint8_t *data = NULL;
    size_t size = 0;
    oppo_error_t err = oppo_read_file(input_path, &data, &size);
    if (err != OPPO_OK) {
        fprintf(stderr, "Error reading file: %s\n", oppo_error_string(err));
        return 1;
    }

    printf("File: %s\n", input_path);
    printf("Size: %s\n", format_size(size));
    printf("──────────────────────────────────\n");

    if (oppo_is_jpeg(data, size)) {
        printf("Type: JPEG (potentially OPPO live photo)\n");
    } else {
        printf("Type: Unknown (not a valid JPEG)\n");
        free(data);
        return 1;
    }

    /* Parse and show components */
    oppo_components_t comp;
    memset(&comp, 0, sizeof(comp));

    err = oppo_parse(data, size, &comp);
    free(data);

    if (err == OPPO_OK) {
        printf("\nComponents:\n");
        if (comp.jpeg_data) {
            printf("  Cover JPEG:     %s\n", format_size(comp.jpeg_size));
        }
        if (comp.thumbnail_data) {
            printf("  Thumbnail:      %s\n", format_size(comp.thumbnail_size));
        }
        if (comp.main_video) {
            printf("  Main Video:     %s  (MP4)\n", format_size(comp.main_video_size));
        }
        if (comp.sub_video) {
            printf("  Sub Video:      %s  (MP4)\n", format_size(comp.sub_video_size));
        }
        if (comp.metadata_json) {
            printf("  Metadata JSON:  %s\n", format_size(comp.metadata_size));
            printf("  Metadata content:\n");
            printf("    %s\n", (const char *)comp.metadata_json);
        }
        if (comp.jxrs_data) {
            printf("  jxrs footer:    present\n");
        }

        /* Summary */
        printf("\nSummary:\n");
        printf("  Has video:   %s\n", comp.main_video ? "✓ YES" : "✗ NO");
        printf("  Has metadata: %s\n", comp.metadata_json ? "✓ YES" : "✗ NO");
        printf("  Is live photo: %s\n",
               (comp.main_video && comp.metadata_json) ? "✓ YES" : "✗ NO (incomplete)");
    } else {
        printf("\nNot a valid OPPO live photo format\n");
    }

    oppo_components_free(&comp);
    return 0;
}

/* ─── Main ─── */
int main(int argc, char *argv[])
{
    if (argc < 2) {
        print_usage();
        return 1;
    }

    const char *command = argv[1];

    if (strcmp(command, "help") == 0 || strcmp(command, "-h") == 0 || strcmp(command, "--help") == 0) {
        print_usage();
        return 0;
    } else if (strcmp(command, "combine") == 0) {
        return cmd_combine(argc - 2, argv + 2);
    } else if (strcmp(command, "parse") == 0) {
        return cmd_parse(argc - 2, argv + 2);
    } else if (strcmp(command, "info") == 0) {
        return cmd_info(argc - 2, argv + 2);
    } else {
        fprintf(stderr, "Unknown command: %s\n\n", command);
        print_usage();
        return 1;
    }
}