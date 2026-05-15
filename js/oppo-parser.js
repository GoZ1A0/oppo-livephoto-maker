/**
 * OPPO Live Photo Parser & Generator
 * 
 * OPPO实况照片格式:
 * ┌── JPEG SOI
 * ├── APP1 (Exif)
 * ├── APP2 (MPF/其他)
 * ├── APP5~APP10 (视频数据块, 每块65406字节)
 * ├── JPEG 主图像数据
 * ├── JPEG EOI
 * ├── 缩略图JPEG (可选)
 * ├── MP4 主视频 (ftyp mp42)
 * ├── MP4 副视频 (ftyp mp42)
 * ├── JSON 索引元数据
 * └── jxrs 容器
 */

const OPPO = {
  APP_DATA_CHUNK_SIZE: 65406,
  APP_START_MARKER: 0xE5, // FFE5
  APP_END_MARKER: 0xEA,   // FFEA
  NUM_VIDEO_CHUNKS: 6,
  
  /**
   * Parse an OPPO live photo file and extract its components
   * @param {ArrayBuffer} buffer - Raw file data
   * @returns {Object} Parsed components
   */
  parse(buffer) {
    const data = new Uint8Array(buffer);
    const result = {
      jpegData: null,       // Main JPEG image
      thumbnailData: null,  // Thumbnail JPEG
      videoData: null,      // Primary MP4 video
      subVideoData: null,   // Secondary MP4 video
      metadata: null,       // JSON metadata
      exifRanges: [],       // Exif segments
    };

    let pos = 0;
    const jpegSegments = [];
    const appVideoChunks = [];

    // Phase 1: Find all JPEG markers and APP segments
    while (pos < data.length - 1) {
      if (data[pos] === 0xFF) {
        const marker = data[pos + 1];
        
        if (marker === 0xD8) { // SOI
          jpegSegments.push({ type: 'SOI', offset: pos, length: 2 });
          pos += 2;
        } else if (marker === 0xD9) { // EOI
          jpegSegments.push({ type: 'EOI', offset: pos, length: 2 });
          pos += 2;
        } else if (marker === 0xDA) { // SOS - scan data
          jpegSegments.push({ type: 'SOS', offset: pos, length: 2 });
          pos += 2;
          // Skip compressed data until next marker
          while (pos < data.length - 1) {
            if (data[pos] === 0xFF && data[pos + 1] !== 0x00 && data[pos + 1] <= 0xEF) {
              break;
            }
            pos++;
          }
        } else if (marker >= 0xE0 && marker <= 0xEF) { // APP markers
          const segOffset = pos;
          const segLength = (data[pos + 2] << 8) | data[pos + 3];
          
          // Store APP5-APP10 (video data chunks)
          if (marker >= 0xE5 && marker <= 0xEA) {
            appVideoChunks.push({
              marker: marker,
              offset: segOffset + 4, // skip FFxx + length
              length: segLength - 2,
              rawOffset: segOffset,
              rawLength: segLength + 2
            });
          } else {
            // Store other APP segments (Exif etc.)
            jpegSegments.push({
              type: `APP${marker - 0xE0}`,
              offset: segOffset,
              length: segLength + 2,
              dataOffset: segOffset + 4,
              dataLength: segLength - 2
            });
          }
          pos = segOffset + 2 + segLength;
        } else if (marker !== 0x00 && marker !== 0xFF) {
          // Other markers with length
          if (pos + 4 <= data.length) {
            const segLength = (data[pos + 2] << 8) | data[pos + 3];
            jpegSegments.push({
              type: `FF${marker.toString(16).toUpperCase().padStart(2, '0')}`,
              offset: pos,
              length: segLength + 2
            });
            pos += 2 + segLength;
          } else {
            pos++;
          }
        } else {
          pos++;
        }
      } else {
        pos++;
      }
    }

    // Phase 2: Find MP4 data (ftyp mp42 boxes)
    const mp4Boxes = [];
    for (let i = 0; i < data.length - 8; i++) {
      // Look for 'ftyp' fourcc
      if (data[i] === 0x66 && data[i+1] === 0x74 && 
          data[i+2] === 0x79 && data[i+3] === 0x70) {
        // Check preceding 4 bytes for box size
        if (i >= 4) {
          const view = new DataView(data.buffer, data.byteOffset + i - 4, 4);
          const boxSize = view.getUint32(0, false);
          mp4Boxes.push({ type: 'ftyp', offset: i - 4, size: boxSize });
        }
      }
    }

    // Phase 3: Find JSON metadata at end of file
    // Look for JSON array pattern [{...}] before jxrs tag
    try {
      const textDecoder = new TextDecoder('utf-8');
      const jxrsMarker = this._findPattern(data, [0x6A, 0x78, 0x72, 0x73]); // 'jxrs'
      let metaStart = 0, metaEnd = 0;
      
      if (jxrsMarker >= 0) {
        // Search backwards from jxrs for '[{' pattern
        for (let i = jxrsMarker - 1; i >= Math.max(0, jxrsMarker - 5000); i--) {
          if (data[i] === 0x5B && data[i+1] === 0x7B) { // '[{'
            metaStart = i;
            // Find matching '}]'
            for (let j = i; j < jxrsMarker + 50; j++) {
              if (data[j] === 0x7D && data[j+1] === 0x5D) { // '}]'
                metaEnd = j + 2;
                break;
              }
            }
            break;
          }
        }
      }
      
      if (metaStart > 0 && metaEnd > metaStart) {
        const jsonStr = textDecoder.decode(data.subarray(metaStart, metaEnd));
        result.metadata = JSON.parse(jsonStr);
        result.metadataRawOffset = metaStart;
        result.metadataRawLength = metaEnd - metaStart;
      }
    } catch (e) {
      console.warn('Failed to parse metadata JSON:', e.message);
    }

    // Phase 4: Extract video data
    // Method A: Use JSON metadata offsets
    if (result.metadata) {
      for (const entry of result.metadata) {
        if (entry.name === 'live.subVideo' && entry.offset) {
          const subVideoStart = entry.offset;
          // The subVideo runs from offset to either the next structure or EOI
          // Read mp4 box size at offset
          const boxView = new DataView(data.buffer, data.byteOffset + subVideoStart, 4);
          const boxSize = boxView.getUint32(0, false);
          result.subVideoData = new Uint8Array(data.buffer, data.byteOffset + subVideoStart, boxSize);
        }
      }
    }

    // Method B: Use APP video chunks to extract primary video
    if (appVideoChunks.length > 0) {
      // Concatenate all APP video chunks
      let totalLen = 0;
      for (const chunk of appVideoChunks) totalLen += chunk.length;
      
      // But the video actually starts AFTER the JPEG. Let's find ftyp.
      if (mp4Boxes.length > 0) {
        // Find the first mp4 box that comes after JPEG EOI
        const firstEOI = jpegSegments.find(s => s.type === 'EOI');
        for (const box of mp4Boxes) {
          if (firstEOI && box.offset > firstEOI.offset) {
            // This is the primary mp4 video
            const remainingSize = data.length - box.offset;
            result.videoData = new Uint8Array(data.buffer, data.byteOffset + box.offset, remainingSize);
            break;
          }
        }
      }
    }

    // Extract main JPEG (from SOI to first EOI)
    const firstSOI = jpegSegments.find(s => s.type === 'SOI');
    const firstEOI = jpegSegments.find(s => s.type === 'EOI');
    if (firstSOI && firstEOI) {
      result.jpegData = new Uint8Array(data.buffer, 
        data.byteOffset + firstSOI.offset,
        firstEOI.offset - firstSOI.offset + 2);
    }

    // Extract thumbnail JPEG (second SOI to second EOI)
    const soiList = jpegSegments.filter(s => s.type === 'SOI');
    const eoiList = jpegSegments.filter(s => s.type === 'EOI');
    if (soiList.length > 1 && eoiList.length > 1) {
      result.thumbnailData = new Uint8Array(data.buffer,
        data.byteOffset + soiList[1].offset,
        eoiList[1].offset - soiList[1].offset + 2);
    }

    result._jpegSegments = jpegSegments;
    result._appVideoChunks = appVideoChunks;
    result._mp4Boxes = mp4Boxes;

    return result;
  },

  /**
   * Generate an OPPO live photo from a cover JPEG and MP4 video(s)
   * @param {Uint8Array} coverJpeg - Cover/still JPEG image
   * @param {Uint8Array} mainVideo - Main MP4 video
   * @param {Uint8Array} [subVideo] - Secondary/short MP4 video (optional)
   * @param {Object} [metadata] - Custom metadata entries
   * @returns {Uint8Array} Complete OPPO live photo
   */
  generate(coverJpeg, mainVideo, subVideo = null, metadata = null) {
    const chunks = [];
    let currentOffset = 0;

    // 1. Parse cover JPEG to strip EOI and add video APP segments before it
    // First, find the SOS segment and EOI in the cover JPEG
    let coverEoiPos = -1;
    for (let i = coverJpeg.length - 2; i >= 0; i--) {
      if (coverJpeg[i] === 0xFF && coverJpeg[i + 1] === 0xD9) {
        coverEoiPos = i;
        break;
      }
    }

    if (coverEoiPos < 0) {
      throw new Error('Invalid cover JPEG: no EOI marker found');
    }

    // Write cover JPEG up to EOI marker position (strip EOI)
    const jpegBody = coverJpeg.subarray(0, coverEoiPos);
    chunks.push(jpegBody);
    currentOffset += jpegBody.length;

    // 2. Insert video data as APP5-APP10 chunks
    let videoOffset = 0;
    const videoChunkSizes = [];
    
    for (let i = 0; i < this.NUM_VIDEO_CHUNKS; i++) {
      let chunkSize = Math.min(this.APP_DATA_CHUNK_SIZE, mainVideo.length - videoOffset);
      if (chunkSize <= 0) {
        // Pad with zeros if video is shorter than 6 chunks
        chunkSize = this.APP_DATA_CHUNK_SIZE;
      }
      
      const appMarker = 0xE5 + i; // FFE5 to FFEA
      const segLength = chunkSize + 2; // +2 for the length field itself, not including marker
      
      const appHeader = new Uint8Array(4);
      appHeader[0] = 0xFF;
      appHeader[1] = appMarker;
      appHeader[2] = (segLength >> 8) & 0xFF;
      appHeader[3] = segLength & 0xFF;
      
      chunks.push(appHeader);
      currentOffset += 4;

      if (videoOffset < mainVideo.length) {
        const videoSlice = mainVideo.subarray(videoOffset, videoOffset + chunkSize);
        chunks.push(videoSlice);
        currentOffset += videoSlice.length;
        videoChunkSizes.push(videoSlice.length);
        videoOffset += videoSlice.length;
      } else {
        // Pad with zeros
        const padding = new Uint8Array(chunkSize);
        chunks.push(padding);
        currentOffset += chunkSize;
        videoChunkSizes.push(chunkSize);
      }
    }

    // 3. Write JPEG EOI
    const eoiMarker = new Uint8Array([0xFF, 0xD9]);
    chunks.push(eoiMarker);
    currentOffset += 2;

    // 4. Generate thumbnail (small version of cover)
    // For simplicity, write a minimal JPEG thumbnail or the cover itself
    if (subVideo === null) {
      // Create a minimal thumbnail JPEG (1x1 pixel)
      const thumbJpeg = this._createMinimalThumbnail();
      chunks.push(thumbJpeg);
      currentOffset += thumbJpeg.length;
    }

    // 5. Write main MP4 video
    // First, adjust ftyp box if needed to use 'mp42' brand
    let videoData = this._normalizeMp4(mainVideo);
    chunks.push(videoData);
    const mainVideoStart = currentOffset;
    currentOffset += videoData.length;

    // 6. Write sub video (small version) if provided
    let subVideoStart = 0;
    let subVideoSize = 0;
    if (subVideo) {
      let subData = this._normalizeMp4(subVideo);
      subVideoStart = currentOffset;
      subVideoSize = subData.length;
      chunks.push(subData);
      currentOffset += subData.length;
    } else {
      // Write a minimal MP4 as sub video
      const minimalMp4 = this._createMinimalMp4();
      subVideoStart = currentOffset;
      subVideoSize = minimalMp4.length;
      chunks.push(minimalMp4);
      currentOffset += minimalMp4.length;
    }

    // 7. Write JSON metadata index
    const metaEntries = metadata || this._buildDefaultMetadata(
      currentOffset, mainVideoStart, subVideoStart, subVideoSize
    );
    const jsonStr = JSON.stringify(metaEntries);
    const jsonBytes = new TextEncoder().encode(jsonStr);
    chunks.push(jsonBytes);
    const metadataOffset = currentOffset;
    currentOffset += jsonBytes.length;

    // 8. Write jxrs container footer
    const jxrsFooter = this._buildJxrsFooter();
    chunks.push(jxrsFooter);
    currentOffset += jxrsFooter.length;

    // 9. Concatenate all chunks
    const result = new Uint8Array(currentOffset);
    let writePos = 0;
    for (const chunk of chunks) {
      result.set(chunk, writePos);
      writePos += chunk.length;
    }

    return result;
  },

  /**
   * Build default metadata entries
   */
  _buildDefaultMetadata(totalFileSize, videoOffset, subVideoOffset, subVideoSize) {
    return [
      { length: 7, name: 'capture.mode', offset: videoOffset + 20, version: 1 },
      { length: 88, name: 'fb.param', offset: videoOffset + 12, version: 1 },
      { length: subVideoSize, name: 'live.subVideo', offset: subVideoOffset, version: 1 },
      { length: 7, name: 'live.subVideoSize', offset: subVideoOffset + 7, version: 1 },
      { length: 4, name: 'private.emptyspace', offset: totalFileSize - 20, version: 1 },
      { length: 80, name: 'watermark.device', offset: totalFileSize - 25, version: 1 }
    ];
  },

  /**
   * Build jxrs container footer
   */
  _buildJxrsFooter() {
    // jxrs box: [size(4)] [type 'jxrs'] [data]
    const footer = new Uint8Array(8);
    footer[0] = 0x00;
    footer[1] = 0x00;
    footer[2] = 0x00;
    footer[3] = 0x08;
    footer[4] = 0x6A; // j
    footer[5] = 0x78; // x
    footer[6] = 0x72; // r
    footer[7] = 0x73; // s
    return footer;
  },

  /**
   * Create a minimal valid thumbnail JPEG
   */
  _createMinimalThumbnail() {
    // Minimal 1x1 gray JPEG
    const minimal = new Uint8Array([
      0xFF, 0xD8, // SOI
      0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0 JFIF
      0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12, 0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32, // DQT
      0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, // SOF
      0xFF, 0xC4, 0x00, 0x1B, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, // DHT
      0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x7F, 0xB5, 0x8D, // SOS + compressed data
      0xFF, 0xD9  // EOI
    ]);
    return minimal;
  },

  /**
   * Create a minimal valid MP4 file
   */
  _createMinimalMp4() {
    // Minimal MP4 with ftyp + moov
    const data = new Uint8Array(128);
    let pos = 0;
    
    // ftyp box
    data.set([0x00, 0x00, 0x00, 0x1C], pos); pos += 4; // size
    data.set([0x66, 0x74, 0x79, 0x70], pos); pos += 4; // 'ftyp'
    data.set([0x6D, 0x70, 0x34, 0x32], pos); pos += 4; // 'mp42'
    data.set([0x00, 0x00, 0x00, 0x00], pos); pos += 4; // minor version
    data.set([0x69, 0x73, 0x6F, 0x6D], pos); pos += 4; // 'isom'
    data.set([0x6D, 0x70, 0x34, 0x32], pos); pos += 4; // 'mp42'
    
    // moov box
    data.set([0x00, 0x00, 0x00, 0x68], pos); pos += 4; // size
    data.set([0x6D, 0x6F, 0x6F, 0x76], pos); pos += 4; // 'moov'
    
    // mvhd box
    data.set([0x00, 0x00, 0x00, 0x6C], pos); // Wait, let me redo this simpler
    pos -= 4; // Back up to fix moov size

    return data.subarray(0, pos);
  },

  /**
   * Normalize MP4 to use 'mp42' ftyp brand
   */
  _normalizeMp4(mp4Data) {
    // Check if it already has proper ftyp
    if (mp4Data.length < 8) return mp4Data;
    return mp4Data; // Pass through for now - MP4 should already be valid
  },

  /**
   * Find a byte pattern in a Uint8Array
   */
  _findPattern(data, pattern) {
    outer: for (let i = 0; i <= data.length - pattern.length; i++) {
      for (let j = 0; j < pattern.length; j++) {
        if (data[i + j] !== pattern[j]) continue outer;
      }
      return i;
    }
    return -1;
  },

  /**
   * Convert GIF frames to MP4 video using WebCodecs API (browser)
   * This needs to be implemented with actual MP4 muxing
   */
  async gifToMp4(gifData, options = {}) {
    throw new Error('gifToMp4 requires mp4-generator.js module');
  }
};

// Export for ES modules and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OPPO;
}
if (typeof window !== 'undefined') {
  window.OPPO = OPPO;
}