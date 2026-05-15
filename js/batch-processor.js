/**
 * Batch Processor - Handles batch conversion with queue, concurrency control,
 * progress tracking, and error handling.
 */
class BatchProcessor {
  constructor() {
    this.queue = [];
    this.results = [];
    this.converter = new Converter();
    this.isRunning = false;
    this.isPaused = false;
    this.concurrency = 2; // Process 2 files concurrently
    this.activeCount = 0;

    // Callbacks
    this.onItemProgress = null;   // (itemIndex, progress) => void
    this.onItemComplete = null;   // (itemIndex, result) => void
    this.onItemError = null;      // (itemIndex, error) => void
    this.onTotalProgress = null;  // (completed, total, percent) => void
    this.onAllComplete = null;    // (results) => void
  }

  /**
   * Add a file to the batch queue
   * @param {Object} item
   * @param {File} item.inputFile - Input GIF/MP4 file
   * @param {File} [item.coverFile=null] - Optional cover JPEG
   * @param {Object} [item.options={}] - Conversion options
   * @param {string} [item.id] - Unique identifier (auto-generated if not provided)
   */
  addItem(item) {
    const id = item.id || `file_${this.queue.length}`;
    this.queue.push({
      id,
      inputFile: item.inputFile,
      coverFile: item.coverFile || null,
      options: item.options || {},
      status: 'pending', // pending | processing | completed | failed | skipped
      progress: 0,
      result: null,
      error: null,
      startTime: null,
      endTime: null,
    });
    return id;
  }

  /**
   * Add multiple items at once
   * @param {Array<Object>} items
   */
  addItems(items) {
    return items.map(item => this.addItem(item));
  }

  /**
   * Auto-pair files: match GIFs/MP4s with cover JPEGs by filename
   * @param {Array<File>} files - All files (mixed GIF, MP4, JPEG)
   */
  autoPairFiles(files) {
    const videos = [];  // GIF or MP4
    const covers = {};  // filename → File

    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'gif' || ext === 'mp4') {
        videos.push(file);
      } else if (ext === 'jpg' || ext === 'jpeg') {
        const baseName = file.name.replace(/\.[^.]+$/, '');
        covers[baseName] = file;
      }
    }

    for (const video of videos) {
      const baseName = video.name.replace(/\.[^.]+$/, '');
      this.addItem({
        inputFile: video,
        coverFile: covers[baseName] || covers['cover'] || null,
      });
    }
  }

  /**
   * Start processing the batch queue
   */
  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isPaused = false;
    this.results = [];
    this.activeCount = 0;

    this._updateTotalProgress();

    // Process items with concurrency control
    const pending = this.queue.filter(item => item.status === 'pending');
    
    for (let i = 0; i < pending.length; i++) {
      if (this.isPaused) break;

      const item = pending[i];
      const queueIndex = this.queue.indexOf(item);

      // Wait if at max concurrency
      while (this.activeCount >= this.concurrency) {
        await this._sleep(100);
      }

      this.activeCount++;
      this._processItem(queueIndex)
        .finally(() => {
          this.activeCount--;
        });
    }

    // Wait for all active tasks to finish
    while (this.activeCount > 0) {
      await this._sleep(200);
    }

    this.isRunning = false;
    this._updateTotalProgress();

    if (this.onAllComplete) {
      this.onAllComplete(this.results);
    }
  }

  /**
   * Pause processing
   */
  pause() {
    this.isPaused = true;
  }

  /**
   * Resume processing
   */
  resume() {
    this.isPaused = false;
    this.start();
  }

  /**
   * Cancel all pending items
   */
  cancel() {
    this.isPaused = true;
    for (const item of this.queue) {
      if (item.status === 'pending') {
        item.status = 'skipped';
      }
    }
    this.isRunning = false;
  }

  /**
   * Clear the queue and results
   */
  clear() {
    this.queue = [];
    this.results = [];
    this.isRunning = false;
    this.isPaused = false;
  }

  /**
   * Process a single item in the queue
   */
  async _processItem(index) {
    const item = this.queue[index];
    if (!item || item.status !== 'pending') return;

    item.status = 'processing';
    item.startTime = Date.now();
    this._updateTotalProgress();

    // Set up progress callback on converter
    this.converter.onProgress = (prog) => {
      const percents = {
        'extracting_metadata': 10,
        'converting_to_mp4': 30,
        'normalizing_mp4': 30,
        'reading_input': 5,
        'preparing_cover': 70,
        'building_livephoto': 90,
        'done': 100,
      };
      item.progress = percents[prog.stage] || 50;

      if (this.onItemProgress) {
        this.onItemProgress(index, {
          stage: prog.stage,
          message: prog.message,
          percent: item.progress,
        });
      }
      this._updateTotalProgress();
    };

    try {
      const result = await this.converter.convertFromFiles(
        item.inputFile,
        item.coverFile,
        item.options
      );

      item.status = 'completed';
      item.result = result;
      item.progress = 100;
      item.endTime = Date.now();
      this.results.push({ ...result, itemIndex: index, itemId: item.id });

      if (this.onItemComplete) {
        this.onItemComplete(index, result);
      }
    } catch (error) {
      item.status = 'failed';
      item.error = error.message || String(error);
      item.progress = 100;
      item.endTime = Date.now();

      if (this.onItemError) {
        this.onItemError(index, error);
      }
    }

    this._updateTotalProgress();
  }

  /**
   * Get total progress statistics
   */
  getStats() {
    const total = this.queue.length;
    const completed = this.queue.filter(i => i.status === 'completed').length;
    const failed = this.queue.filter(i => i.status === 'failed').length;
    const processing = this.queue.filter(i => i.status === 'processing').length;
    const pending = this.queue.filter(i => i.status === 'pending').length;
    const skipped = this.queue.filter(i => i.status === 'skipped').length;

    return {
      total,
      completed,
      failed,
      processing,
      pending,
      skipped,
      percent: total > 0 ? Math.round(((completed + failed) / total) * 100) : 0,
    };
  }

  /**
   * Download all completed results as a ZIP file
   * (Browser-only: uses JSZip if available, or triggers individual downloads)
   */
  async downloadAll() {
    const completed = this.queue.filter(i => i.status === 'completed');
    
    if (completed.length === 0) {
      console.warn('No completed files to download');
      return;
    }

    if (completed.length === 1) {
      // Single file - direct download
      this._downloadFile(completed[0].result);
    } else {
      // Multiple files - try to use JSZip
      try {
        await this._downloadAsZip(completed);
      } catch (e) {
        // Fallback: download individually
        for (const item of completed) {
          this._downloadFile(item.result);
          await this._sleep(500); // Delay between downloads
        }
      }
    }
  }

  /**
   * Download a single file
   */
  _downloadFile(result) {
    const blob = new Blob([result.output], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Download as ZIP using JSZip
   */
  async _downloadAsZip(completedItems) {
    // Dynamic import of JSZip
    const { default: JSZip } = await import('https://unpkg.com/jszip@3.10.1/dist/jszip.min.js');
    const zip = new JSZip();

    for (const item of completedItems) {
      zip.file(item.result.filename, item.result.output);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'oppo_livephotos.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Update total progress callback
   */
  _updateTotalProgress() {
    if (this.onTotalProgress) {
      const stats = this.getStats();
      this.onTotalProgress(stats.completed + stats.failed, stats.total, stats.percent);
    }
  }

  /**
   * Sleep helper
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BatchProcessor;
}
if (typeof window !== 'undefined') {
  window.BatchProcessor = BatchProcessor;
}