/**
 * MP4 Generator - Converts GIF frames to MP4 video
 * Uses FFmpeg.wasm for reliable MP4 encoding in browser
 */

const MP4Generator = {
  _ffmpeg: null,
  _ffmpegReady: false,

  /**
   * Load FFmpeg.wasm (lazy loading)
   */
  async loadFFmpeg() {
    if (this._ffmpegReady) return this._ffmpeg;
    
    // Dynamic import of FFmpeg.wasm
    const { createFFmpeg, fetchFile } = await import(
      'https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/ffmpeg.min.js'
    );
    
    this._ffmpeg = createFFmpeg({
      log: false,
      corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
    });
    
    await this._ffmpeg.load();
    this._ffmpegReady = true;
    return this._ffmpeg;
  },

  /**
   * Convert GIF file to MP4 video
   * @param {Uint8Array|ArrayBuffer} gifData - Raw GIF file data
   * @param {Object} options - Conversion options
   * @param {number} options.fps - Output framerate (default: 10)
   * @param {number} options.width - Output width (default: auto)
   * @param {number} options.height - Output height (default: auto)
   * @param {number} options.quality - CRF quality (default: 23, lower=better)
   * @param {number} options.duration - Force duration in seconds (optional)
   * @returns {Promise<Uint8Array>} MP4 file data
   */
  async gifToMp4(gifData, options = {}) {
    const ffmpeg = await this.loadFFmpeg();
    const {
      fps = 10,
      width = -1,
      height = -1,
      quality = 23,
      duration = null,
    } = options;

    // Write input GIF to ffmpeg virtual FS
    const inputName = 'input.gif';
    const outputName = 'output.mp4';
    
    ffmpeg.FS('writeFile', inputName, await fetchFile(gifData));

    // Build ffmpeg arguments
    const args = [
      '-i', inputName,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', String(quality),
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an', // No audio
    ];

    // Apply fps filter if GIF frame delay info is unreliable
    if (fps > 0) {
      args.push('-filter:v', `fps=${fps}`);
    }

    // Apply resolution if specified
    if (width > 0 && height > 0) {
      args.push('-vf', `scale=${width}:${height}`);
    } else if (width > 0) {
      args.push('-vf', `scale=${width}:-1`);
    } else if (height > 0) {
      args.push('-vf', `scale=-1:${height}`);
    }

    // Force duration if specified
    if (duration !== null) {
      args.push('-t', String(duration));
    }

    // Loop GIF if needed
    args.push('-ignore_loop', '0');

    args.push(outputName);

    // Run conversion
    await ffmpeg.run(...args);

    // Read output
    const outputData = ffmpeg.FS('readFile', outputName);
    
    // Cleanup
    ffmpeg.FS('unlink', inputName);
    ffmpeg.FS('unlink', outputName);

    return new Uint8Array(outputData.buffer);
  },

  /**
   * Convert MP4 video with re-encoding to ensure compatibility
   * @param {Uint8Array|ArrayBuffer} mp4Data - Raw MP4 file data
   * @param {Object} options - Conversion options
   * @returns {Promise<Uint8Array>} Re-encoded MP4
   */
  async normalizeMp4(mp4Data, options = {}) {
    const ffmpeg = await this.loadFFmpeg();
    const {
      quality = 23,
      width = -1,
      height = -1,
      fps = 0,
    } = options;

    const inputName = 'input.mp4';
    const outputName = 'output.mp4';
    
    ffmpeg.FS('writeFile', inputName, await fetchFile(mp4Data));

    const args = [
      '-i', inputName,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', String(quality),
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an', // Strip audio
    ];

    if (fps > 0) {
      args.push('-filter:v', `fps=${fps}`);
    }

    if (width > 0 && height > 0) {
      args.push('-vf', `scale=${width}:${height}`);
    }

    args.push(outputName);

    await ffmpeg.run(...args);

    const outputData = ffmpeg.FS('readFile', outputName);
    
    ffmpeg.FS('unlink', inputName);
    ffmpeg.FS('unlink', outputName);

    return new Uint8Array(outputData.buffer);
  },

  /**
   * Extract first frame from video as JPEG
   * @param {Uint8Array|ArrayBuffer} videoData - Raw video file data
   * @returns {Promise<Uint8Array>} JPEG image data
   */
  async extractFirstFrame(videoData) {
    const ffmpeg = await this.loadFFmpeg();
    
    const inputName = 'input.mp4';
    const outputName = 'frame.jpg';
    
    ffmpeg.FS('writeFile', inputName, await fetchFile(videoData));

    await ffmpeg.run(
      '-i', inputName,
      '-vframes', '1',
      '-q:v', '2',
      outputName
    );

    const outputData = ffmpeg.FS('readFile', outputName);
    
    ffmpeg.FS('unlink', inputName);
    ffmpeg.FS('unlink', outputName);

    return new Uint8Array(outputData.buffer);
  },

  /**
   * Scale JPEG image to target dimensions
   * @param {Uint8Array|ArrayBuffer} jpegData - Raw JPEG data
   * @param {number} maxWidth - Maximum width
   * @param {number} maxHeight - Maximum height
   * @returns {Promise<Uint8Array>} Scaled JPEG
   */
  async scaleJpeg(jpegData, maxWidth = 1920, maxHeight = 1920) {
    const ffmpeg = await this.loadFFmpeg();
    
    const inputName = 'input.jpg';
    const outputName = 'output.jpg';
    
    ffmpeg.FS('writeFile', inputName, await fetchFile(jpegData));

    await ffmpeg.run(
      '-i', inputName,
      '-vf', `scale='min(${maxWidth},iw)':'min(${maxHeight},ih)':force_original_aspect_ratio=decrease`,
      '-q:v', '2',
      outputName
    );

    const outputData = ffmpeg.FS('readFile', outputName);
    
    ffmpeg.FS('unlink', inputName);
    ffmpeg.FS('unlink', outputName);

    return new Uint8Array(outputData.buffer);
  },

  /**
   * Get GIF metadata (dimensions, frame count, delays)
   * @param {Uint8Array} gifData - Raw GIF file data
   * @returns {Object} GIF metadata
   */
  parseGifMetadata(gifData) {
    const view = new DataView(gifData.buffer, gifData.byteOffset, gifData.byteLength);
    
    // Read Logical Screen Descriptor
    const width = view.getUint16(6, true);  // bytes 6-7
    const height = view.getUint16(8, true); // bytes 8-9
    
    // Read Global Color Table flag
    const packed = view.getUint8(10);
    const hasGlobalColorTable = (packed & 0x80) !== 0;
    const gctSize = hasGlobalColorTable ? 3 * (1 << ((packed & 0x07) + 1)) : 0;
    
    // Count frames
    let frameCount = 0;
    let totalDuration = 0;
    let pos = 13 + gctSize; // After LSD + GCT

    while (pos < gifData.length) {
      const blockType = gifData[pos];
      
      if (blockType === 0x21) { // Extension
        const extType = gifData[pos + 1];
        if (extType === 0xF9) { // Graphics Control Extension
          const delay = view.getUint16(pos + 4, true);
          totalDuration += delay * 10; // delay in centiseconds → ms
          pos += 8; // GCE is 8 bytes
        } else if (extType === 0xFF) { // Application Extension
          const blockSize = gifData[pos + 2];
          pos += 3 + blockSize;
          while (pos < gifData.length && gifData[pos] !== 0x00) {
            pos += 1 + gifData[pos];
          }
          pos++; // skip 0x00 terminator
        } else {
          pos += 2;
          while (pos < gifData.length && gifData[pos] !== 0x00) {
            pos += 1 + gifData[pos];
          }
          pos++;
        }
      } else if (blockType === 0x2C) { // Image Descriptor
        frameCount++;
        pos += 10; // Image descriptor header
        // Check for local color table
        const localPacked = gifData[pos - 1];
        const hasLCT = (localPacked & 0x80) !== 0;
        if (hasLCT) {
          const lctSize = 3 * (1 << ((localPacked & 0x07) + 1));
          pos += lctSize;
        }
        // Skip LZW data
        pos++; // LZW minimum code size
        while (pos < gifData.length && gifData[pos] !== 0x00) {
          pos += 1 + gifData[pos];
        }
        pos++; // skip block terminator
      } else if (blockType === 0x3B) { // Trailer
        break;
      } else {
        pos++;
      }
    }

    return {
      width,
      height,
      frameCount,
      totalDurationMs: totalDuration,
      totalDurationSec: totalDuration / 1000,
    };
  },

  /**
   * Get video metadata from MP4 file using ffmpeg
   * @param {Uint8Array|ArrayBuffer} mp4Data - Raw MP4 data
   * @returns {Promise<Object>} Video metadata
   */
  async getVideoMetadata(mp4Data) {
    // Simple approach: use ffprobe or parse MP4 header manually
    // For now, return basic info from mp4 box structure
    const data = mp4Data instanceof Uint8Array ? mp4Data : new Uint8Array(mp4Data);
    
    let width = 0, height = 0;
    // Look for tkhd box to get dimensions
    const tkhdIdx = this._findFourCC(data, 'tkhd');
    if (tkhdIdx >= 0) {
      const view = new DataView(data.buffer, data.byteOffset + tkhdIdx + 88, 8);
      width = view.getUint32(0, false) >> 16;
      height = view.getUint32(4, false) >> 16;
    }

    return { width, height };
  },

  _findFourCC(data, fourcc) {
    const target = new TextEncoder().encode(fourcc);
    outer: for (let i = 0; i <= data.length - 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (data[i + j] !== target[j]) continue outer;
      }
      return i;
    }
    return -1;
  }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MP4Generator;
}
if (typeof window !== 'undefined') {
  window.MP4Generator = MP4Generator;
}