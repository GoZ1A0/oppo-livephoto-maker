/**
 * MP4 Generator - Converts GIF frames to MP4 video
 * Uses FFmpeg.wasm (v0.12.x) for reliable MP4 encoding in browser
 *
 * Note: Requires SharedArrayBuffer support (COOP/COEP headers).
 * Use a local web server (e.g. `npx serve .`) or open via localhost.
 */

const MP4Generator = {
  _ffmpeg: null,
  _ffmpegReady: false,

  /**
   * Load FFmpeg.wasm v0.12.x (ESM from jsdelivr CDN)
   */
  async loadFFmpeg() {
    if (this._ffmpegReady) return this._ffmpeg;

    const FFmpegModule = await import(
      'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/+esm'
    );
    const { FFmpeg } = FFmpegModule;

    this._ffmpeg = new FFmpeg();

    this._ffmpeg.on('log', ({ message }) => {
      // Uncomment for debugging: console.log('[ffmpeg]', message);
    });

    this._ffmpeg.on('progress', ({ progress, time }) => {
      // console.log(`[ffmpeg] Progress: ${Math.round(progress * 100)}%, time: ${time}`);
    });

    await this._ffmpeg.load({
      coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js',
    });

    this._ffmpegReady = true;
    return this._ffmpeg;
  },

  /**
   * Convert GIF file to MP4 video
   */
  async gifToMp4(gifData, options = {}) {
    const ffmpeg = await this.loadFFmpeg();
    const { fps = 10, width = -1, height = -1, quality = 23, duration = null } = options;

    const inputData = gifData instanceof ArrayBuffer ? new Uint8Array(gifData) : gifData;
    const inputName = 'input.gif';
    const outputName = 'output.mp4';

    await ffmpeg.writeFile(inputName, inputData);

    const args = [
      '-i', inputName,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', String(quality),
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an',
    ];

    if (fps > 0) {
      args.push('-filter:v', `fps=${fps}`);
    }
    if (width > 0 && height > 0) {
      args.push('-vf', `scale=${width}:${height}`);
    } else if (width > 0) {
      args.push('-vf', `scale=${width}:-1`);
    } else if (height > 0) {
      args.push('-vf', `scale=-1:${height}`);
    }
    if (duration !== null) {
      args.push('-t', String(duration));
    }
    if (!args.includes('-ignore_loop')) {
      args.push('-ignore_loop', '0');
    }
    args.push(outputName);

    await ffmpeg.exec(args);
    const outputData = await ffmpeg.readFile(outputName);
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    return new Uint8Array(outputData);
  },

  /**
   * Re-encode MP4 to ensure compatibility
   */
  async normalizeMp4(mp4Data, options = {}) {
    const ffmpeg = await this.loadFFmpeg();
    const { quality = 23, width = -1, height = -1, fps = 0 } = options;

    const inputData = mp4Data instanceof ArrayBuffer ? new Uint8Array(mp4Data) : mp4Data;
    const inputName = 'input.mp4';
    const outputName = 'output.mp4';

    await ffmpeg.writeFile(inputName, inputData);

    const args = [
      '-i', inputName,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', String(quality),
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an',
    ];

    if (fps > 0) args.push('-filter:v', `fps=${fps}`);
    if (width > 0 && height > 0) {
      args.push('-vf', `scale=${width}:${height}`);
    } else if (width > 0) {
      args.push('-vf', `scale=${width}:-1`);
    } else if (height > 0) {
      args.push('-vf', `scale=-1:${height}`);
    }
    args.push(outputName);

    await ffmpeg.exec(args);
    const outputData = await ffmpeg.readFile(outputName);
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    return new Uint8Array(outputData);
  },

  /**
   * Extract a single frame as JPEG
   */
  async extractFrame(inputData, options = {}) {
    const ffmpeg = await this.loadFFmpeg();
    const { frameIndex = 0, quality = 2 } = options;

    const data = inputData instanceof ArrayBuffer ? new Uint8Array(inputData) : inputData;
    const inputName = 'frame_input';
    const outputName = 'frame_output.jpg';

    await ffmpeg.writeFile(inputName, data);

    const args = [
      '-i', inputName,
      '-vf', `select=eq(n\\,${frameIndex})`,
      '-vframes', '1',
      '-q:v', String(quality),
      outputName,
    ];

    await ffmpeg.exec(args);
    const outputData = await ffmpeg.readFile(outputName);
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    return new Uint8Array(outputData);
  },

  /**
   * Convenience: extract first frame from MP4 as JPEG
   */
  async extractFirstFrame(mp4Data, quality = 3) {
    return this.extractFrame(mp4Data, { frameIndex: 0, quality });
  },

  /**
   * Get duration from video via ffmpeg log parsing
   */
  async getDuration(inputData) {
    const ffmpeg = await this.loadFFmpeg();
    const data = inputData instanceof ArrayBuffer ? new Uint8Array(inputData) : inputData;
    const inputName = 'dur_input';

    await ffmpeg.writeFile(inputName, data);
    const logMessages = [];

    const onLog = ({ message }) => { logMessages.push(message); };
    ffmpeg.on('log', onLog);

    let duration = 0;
    try {
      await ffmpeg.exec(['-i', inputName, '-f', 'null', '-']);
    } catch (e) { /* exit code may be non-zero but logs still have info */ }

    for (const msg of logMessages) {
      const match = msg.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
      if (match) {
        const h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        const s = parseInt(match[3], 10);
        const ms = parseInt(match[4].padEnd(2, '0'), 10) / 100;
        duration = h * 3600 + m * 60 + s + ms;
        break;
      }
    }

    await ffmpeg.deleteFile(inputName);
    return duration;
  },

  /**
   * Check if ffmpeg.wasm can be loaded
   */
  async checkAvailability() {
    try {
      if (typeof SharedArrayBuffer === 'undefined') {
        console.warn(
          'SharedArrayBuffer is not available. ' +
          'Opening this page via file:// protocol will not work. ' +
          'Please use a local web server (e.g. "npx serve .") to serve this page.'
        );
        return false;
      }
      await this.loadFFmpeg();
      return true;
    } catch (err) {
      console.error('FFmpeg.wasm failed to load:', err.message);
      return false;
    }
  },

  /**
   * Release FFmpeg resources
   */
  async destroy() {
    if (this._ffmpeg && this._ffmpegReady) {
      try { await this._ffmpeg.terminate(); } catch (e) { /* ignore */ }
      this._ffmpeg = null;
      this._ffmpegReady = false;
    }
  },

  /* ========== Pure JS utilities (no FFmpeg required) ========== */

  /**
   * Parse GIF metadata: dimensions, frame count, total duration
   */
  parseGifMetadata(gifData) {
    const data = new Uint8Array(gifData);
    if (data.length < 13) throw new Error('Not a valid GIF file');

    const header = String.fromCharCode(data[0], data[1], data[2]);
    if (header !== 'GIF') throw new Error('Not a GIF file');

    const width  = data[6]  | (data[7] << 8);
    const height = data[8]  | (data[9] << 8);
    const packed = data[10];
    const hasGCT = (packed & 0x80) !== 0;
    const gctSize = 2 << (packed & 0x07);

    let offset = 13;
    if (hasGCT) offset += gctSize * 3;

    let frameCount = 0;
    let totalDelayCs = 0;
    let imgW = width, imgH = height;

    while (offset < data.length) {
      const bt = data[offset];
      if (bt === 0x21) {
        if (data[offset + 1] === 0xF9) {
          totalDelayCs += data[offset + 4] | (data[offset + 5] << 8);
          offset += 8;
        } else {
          offset += 2;
          while (offset < data.length && data[offset] !== 0x00) {
            offset += 1 + data[offset];
          }
          if (offset < data.length) offset++;
        }
      } else if (bt === 0x2C) {
        frameCount++;
        const l = data[offset + 1] | (data[offset + 2] << 8);
        const t = data[offset + 3] | (data[offset + 4] << 8);
        imgW = Math.max(imgW, (data[offset + 5] | (data[offset + 6] << 8)) + l);
        imgH = Math.max(imgH, (data[offset + 7] | (data[offset + 8] << 8)) + t);
        const lPacked = data[offset + 9];
        offset += 10;
        if (lPacked & 0x80) offset += (2 << (lPacked & 0x07)) * 3;
        offset++; // LZW minimum code size
        while (offset < data.length && data[offset] !== 0x00) {
          offset += 1 + data[offset];
        }
        if (offset < data.length) offset++;
      } else if (bt === 0x3B) {
        break;
      } else {
        offset++;
      }
    }

    return {
      width, height,
      imgWidth: imgW, imgHeight: imgH,
      frameCount: Math.max(frameCount, 1),
      totalDelayCs,
      totalDurationSec: Math.max(totalDelayCs / 100, 0.1),
    };
  },

  /**
   * Parse MP4 metadata (width, height, duration) — Pure JS
   */
  getVideoMetadata(mp4Data) {
    const data = new Uint8Array(mp4Data);
    if (data.length < 8) return { width: 0, height: 0, duration: 0 };

    let width = 0, height = 0, duration = 0, timescale = 0;

    const read32 = (off) =>
      (data[off] << 24) | (data[off + 1] << 16) | (data[off + 2] << 8) | data[off + 3];

    const read16 = (off) => (data[off] << 8) | data[off + 1];

    const findBox = (start, end, boxType) => {
      let off = start;
      while (off < end - 8) {
        const sz = read32(off);
        if (sz < 8 || off + sz > end) break;
        const tp = String.fromCharCode(data[off + 4], data[off + 5], data[off + 6], data[off + 7]);
        if (tp === boxType) return { offset: off, size: sz };
        off += sz;
      }
      return null;
    };

    const moov = findBox(0, Math.min(data.length, 131072), 'moov');
    if (!moov) return { width: 0, height: 0, duration: 0 };

    const moovEnd = moov.offset + moov.size;

    const walk = (start, end) => {
      let o = start;
      while (o < end - 8) {
        const sz = read32(o);
        if (sz < 8 || o + sz > end) break;
        const tp = String.fromCharCode(data[o + 4], data[o + 5], data[o + 6], data[o + 7]);

        if (tp === 'mdhd' && timescale === 0) {
          if (data[o + 8] === 0) {
            timescale = read32(o + 20);
            duration  = read32(o + 24);
          }
        }

        if (tp === 'stsd' && width === 0) {
          const count = read32(o + 12);
          if (count > 0) {
            // sample entry starts at o+16
            width  = read16(o + 16 + 32);
            height = read16(o + 16 + 34);
          }
        }

        walk(o + 8, o + sz);
        o += sz;
      }
    };

    walk(moov.offset + 8, moovEnd);

    return {
      width, height,
      duration: timescale > 0 ? duration / timescale : 0,
      timescale,
    };
  },

  /**
   * Scale JPEG to a reasonable cover size (browser Canvas API)
   */
  async scaleJpeg(jpegData, maxW = 1280, maxH = 1280) {
    const blob = new Blob([jpegData], { type: 'image/jpeg' });
    const bitmap = await createImageBitmap(blob);

    let w = bitmap.width, h = bitmap.height;
    if (w <= maxW && h <= maxH) {
      bitmap.close();
      return jpegData;
    }

    const ratio = Math.min(maxW / w, maxH / h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const resizedBlob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    const buf = await resizedBlob.arrayBuffer();
    return new Uint8Array(buf);
  },
};

// Export for ES module / global usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MP4Generator;
}
if (typeof window !== 'undefined') {
  window.MP4Generator = MP4Generator;
}