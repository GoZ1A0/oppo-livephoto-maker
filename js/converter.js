/**
 * Converter - Single file conversion orchestrator
 * Converts GIF/MP4 → OPPO Live Photo (.jpg)
 */
class Converter {
  constructor() {
    this.onProgress = null;
  }

  /**
   * Convert a GIF file to OPPO live photo
   * @param {Object} params
   * @param {Uint8Array} params.gifData - GIF input data
   * @param {Uint8Array} [params.coverJpeg=null] - Optional cover image
   * @param {Object} [params.options={}] - Conversion options
   * @returns {Promise<{output: Uint8Array, metadata: Object}>}
   */
  async convertGif({ gifData, coverJpeg = null, options = {} }) {
    const {
      fps = 10,
      quality = 23,
      width = -1,
      height = -1,
    } = options;

    this._progress('extracting_metadata', '解析GIF元数据...');
    
    // Parse GIF metadata
    const gifMeta = MP4Generator.parseGifMetadata(gifData);

    this._progress('converting_to_mp4', `转换GIF→MP4 (${gifMeta.frameCount}帧, ${gifMeta.totalDurationSec.toFixed(1)}s)...`);

    // Convert GIF to MP4
    const mp4Data = await MP4Generator.gifToMp4(gifData, {
      fps,
      width,
      height,
      quality,
    });

    this._progress('preparing_cover', '准备封面图...');

    // Use provided cover or extract first frame from MP4
    let finalCoverJpeg;
    if (coverJpeg) {
      finalCoverJpeg = await MP4Generator.scaleJpeg(coverJpeg);
    } else {
      // Extract first frame from the MP4 we just created
      finalCoverJpeg = await MP4Generator.extractFirstFrame(mp4Data);
    }

    this._progress('building_livephoto', '合成OPPO实况照片...');

    // Build OPPO live photo
    const output = OPPO.generate(finalCoverJpeg, mp4Data);

    this._progress('done', '完成！');

    return {
      output,
      metadata: {
        sourceType: 'gif',
        gifFrames: gifMeta.frameCount,
        gifDuration: gifMeta.totalDurationSec,
        width: gifMeta.width,
        height: gifMeta.height,
        mp4Size: mp4Data.length,
        outputSize: output.length,
      }
    };
  }

  /**
   * Convert an MP4 file to OPPO live photo
   * @param {Object} params
   * @param {Uint8Array} params.mp4Data - MP4 input data
   * @param {Uint8Array} [params.coverJpeg=null] - Optional cover image
   * @param {Object} [params.options={}] - Conversion options
   * @returns {Promise<{output: Uint8Array, metadata: Object}>}
   */
  async convertMp4({ mp4Data, coverJpeg = null, options = {} }) {
    const {
      fps = 0,          // 0 = keep original
      quality = 23,
      width = -1,
      height = -1,
    } = options;

    this._progress('normalizing_mp4', '规范化MP4视频...');

    // Normalize MP4 (re-encode to ensure compatibility)
    const normalizedMp4 = await MP4Generator.normalizeMp4(mp4Data, {
      fps,
      width,
      height,
      quality,
    });

    this._progress('extracting_metadata', '解析视频元数据...');

    // Get video metadata
    const videoMeta = await MP4Generator.getVideoMetadata(normalizedMp4);

    this._progress('preparing_cover', '准备封面图...');

    // Use provided cover or extract first frame
    let finalCoverJpeg;
    if (coverJpeg) {
      finalCoverJpeg = await MP4Generator.scaleJpeg(coverJpeg);
    } else {
      finalCoverJpeg = await MP4Generator.extractFirstFrame(mp4Data);
    }

    this._progress('building_livephoto', '合成OPPO实况照片...');

    // Build OPPO live photo
    const output = OPPO.generate(finalCoverJpeg, normalizedMp4);

    this._progress('done', '完成！');

    return {
      output,
      metadata: {
        sourceType: 'mp4',
        originalSize: mp4Data.length,
        normalizedSize: normalizedMp4.length,
        width: videoMeta.width,
        height: videoMeta.height,
        outputSize: output.length,
      }
    };
  }

  /**
   * Auto-detect file type and convert
   * @param {Uint8Array} inputData - Input file data
   * @param {Object} params
   * @returns {Promise<{output: Uint8Array, metadata: Object}>}
   */
  async convert(inputData, { coverJpeg = null, options = {} } = {}) {
    const fileType = this._detectType(inputData);

    if (fileType === 'gif') {
      return this.convertGif({ gifData: inputData, coverJpeg, options });
    } else if (fileType === 'mp4') {
      return this.convertMp4({ mp4Data: inputData, coverJpeg, options });
    } else {
      throw new Error(`Unsupported file type: ${fileType}`);
    }
  }

  /**
   * Convert from File objects (browser API)
   * @param {File} inputFile - Input GIF or MP4 file
   * @param {File|null} coverFile - Optional cover JPEG file
   * @param {Object} options - Conversion options
   * @returns {Promise<{output: Uint8Array, filename: string, metadata: Object}>}
   */
  async convertFromFiles(inputFile, coverFile = null, options = {}) {
    this._progress('reading_input', `读取 ${inputFile.name}...`);
    const inputData = new Uint8Array(await inputFile.arrayBuffer());

    let coverData = null;
    if (coverFile) {
      coverData = new Uint8Array(await coverFile.arrayBuffer());
    }

    const result = await this.convert(inputData, {
      coverJpeg: coverData,
      options,
    });

    const outputFilename = this._generateOutputName(inputFile.name);

    return {
      ...result,
      filename: outputFilename,
      inputFilename: inputFile.name,
    };
  }

  /**
   * Detect file type from magic bytes
   */
  _detectType(data) {
    if (data.length < 4) return 'unknown';
    
    // Check GIF: 'GIF8'
    if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) {
      return 'gif';
    }
    
    // Check MP4: ftyp box at offset 4
    if (data.length >= 12) {
      const size = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
      if (size > 0 && data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) {
        return 'mp4';
      }
    }

    // Check JPEG: SOI marker
    if (data[0] === 0xFF && data[1] === 0xD8) {
      return 'jpeg';
    }

    // Check OPPO live photo (it starts with JPEG SOI too)
    return 'unknown';
  }

  /**
   * Generate output filename
   */
  _generateOutputName(inputName) {
    const baseName = inputName.replace(/\.[^.]+$/, '');
    return `${baseName}_livephoto.jpg`;
  }

  /**
   * Report progress
   */
  _progress(stage, message, percent = 0) {
    if (this.onProgress) {
      this.onProgress({ stage, message, percent });
    }
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Converter;
}
if (typeof window !== 'undefined') {
  window.Converter = Converter;
}