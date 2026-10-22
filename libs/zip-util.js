/**
 * Simple ZIP file generator for Chrome Extensions
 * Creates ZIP files without external dependencies
 */

class SimpleZip {
  constructor() {
    this.files = [];
  }

  /**
   * Add a file to the ZIP
   * @param {string} filename - Name of the file in the ZIP
   * @param {Blob|ArrayBuffer|Uint8Array} content - File content
   */
  async addFile(filename, content) {
    let data;
    if (content instanceof Blob) {
      data = new Uint8Array(await content.arrayBuffer());
    } else if (content instanceof ArrayBuffer) {
      data = new Uint8Array(content);
    } else if (content instanceof Uint8Array) {
      data = content;
    } else {
      throw new Error('Content must be Blob, ArrayBuffer, or Uint8Array');
    }

    this.files.push({
      name: filename,
      data: data,
      date: new Date()
    });
  }

  /**
   * Generate the ZIP file
   * @returns {Blob} The ZIP file as a Blob
   */
  generate() {
    const localFiles = [];
    const centralDirectory = [];
    let offset = 0;

    // Process each file
    for (const file of this.files) {
      const nameBytes = new TextEncoder().encode(file.name);
      const crc = this._crc32(file.data);
      const dosTime = this._dateToDos(file.date);

      // Local file header
      const localHeader = this._createLocalFileHeader(nameBytes, file.data, crc, dosTime);
      localFiles.push(localHeader, nameBytes, file.data);

      // Central directory entry (header + filename)
      const centralHeader = this._createCentralDirectoryEntry(nameBytes, file.data, crc, dosTime, offset);
      centralDirectory.push(centralHeader, nameBytes);

      offset += localHeader.byteLength + nameBytes.byteLength + file.data.byteLength;
    }

    // End of central directory - size must include filenames
    let centralDirSize = 0;
    for (let i = 0; i < centralDirectory.length; i++) {
      centralDirSize += centralDirectory[i].byteLength;
    }
    const endOfCentralDir = this._createEndOfCentralDirectory(this.files.length, centralDirSize, offset);

    // Combine all parts
    const parts = [...localFiles, ...centralDirectory, endOfCentralDir];
    return new Blob(parts, { type: 'application/zip' });
  }

  _createLocalFileHeader(nameBytes, data, crc, dosTime) {
    const header = new ArrayBuffer(30);
    const view = new DataView(header);

    view.setUint32(0, 0x04034b50, true);     // Local file header signature
    view.setUint16(4, 20, true);              // Version needed to extract
    view.setUint16(6, 0, true);               // General purpose bit flag
    view.setUint16(8, 0, true);               // Compression method (store)
    view.setUint16(10, dosTime.time, true);   // Last mod file time
    view.setUint16(12, dosTime.date, true);   // Last mod file date
    view.setUint32(14, crc, true);            // CRC-32
    view.setUint32(18, data.byteLength, true); // Compressed size
    view.setUint32(22, data.byteLength, true); // Uncompressed size
    view.setUint16(26, nameBytes.byteLength, true); // File name length
    view.setUint16(28, 0, true);              // Extra field length

    return new Uint8Array(header);
  }

  _createCentralDirectoryEntry(nameBytes, data, crc, dosTime, localHeaderOffset) {
    const entry = new ArrayBuffer(46);
    const view = new DataView(entry);

    view.setUint32(0, 0x02014b50, true);      // Central directory signature
    view.setUint16(4, 20, true);               // Version made by
    view.setUint16(6, 20, true);               // Version needed to extract
    view.setUint16(8, 0, true);                // General purpose bit flag
    view.setUint16(10, 0, true);               // Compression method
    view.setUint16(12, dosTime.time, true);    // Last mod file time
    view.setUint16(14, dosTime.date, true);    // Last mod file date
    view.setUint32(16, crc, true);             // CRC-32
    view.setUint32(20, data.byteLength, true); // Compressed size
    view.setUint32(24, data.byteLength, true); // Uncompressed size
    view.setUint16(28, nameBytes.byteLength, true); // File name length
    view.setUint16(30, 0, true);               // Extra field length
    view.setUint16(32, 0, true);               // File comment length
    view.setUint16(34, 0, true);               // Disk number start
    view.setUint16(36, 0, true);               // Internal file attributes
    view.setUint32(38, 0, true);               // External file attributes
    view.setUint32(42, localHeaderOffset, true); // Relative offset of local header

    return new Uint8Array(entry).slice(0, 46);
  }

  _createEndOfCentralDirectory(fileCount, centralDirSize, centralDirOffset) {
    const record = new ArrayBuffer(22);
    const view = new DataView(record);

    view.setUint32(0, 0x06054b50, true);       // End of central directory signature
    view.setUint16(4, 0, true);                 // Number of this disk
    view.setUint16(6, 0, true);                 // Disk where central directory starts
    view.setUint16(8, fileCount, true);         // Number of central directory records on this disk
    view.setUint16(10, fileCount, true);        // Total number of central directory records
    view.setUint32(12, centralDirSize, true);   // Size of central directory
    view.setUint32(16, centralDirOffset, true); // Offset of start of central directory
    view.setUint16(20, 0, true);                // Comment length

    return new Uint8Array(record);
  }

  _dateToDos(date) {
    return {
      time: (date.getSeconds() >> 1) | (date.getMinutes() << 5) | (date.getHours() << 11),
      date: date.getDate() | ((date.getMonth() + 1) << 5) | ((date.getFullYear() - 1980) << 9)
    };
  }

  _crc32(data) {
    let crc = 0xFFFFFFFF;
    const table = this._getCrc32Table();

    for (let i = 0; i < data.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
    }

    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  _getCrc32Table() {
    if (!SimpleZip._crc32Table) {
      const table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c;
      }
      SimpleZip._crc32Table = table;
    }
    return SimpleZip._crc32Table;
  }
}

// Export for use in popup.js
window.SimpleZip = SimpleZip;
