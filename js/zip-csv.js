// Minimal in-browser ZIP entry extractor + streaming CSV parser.
// Uses native DecompressionStream('deflate-raw'); no external dependencies.
//
// Insee Melodi ZIPs use the "data descriptor" flag (bit 3 of local file header
// flags), which means the local headers don't carry compressed/uncompressed
// sizes — those values are written *after* the compressed data and only the
// central directory (at the end of the archive) has reliable offsets. So we
// parse the central directory.

const SIG_EOCD  = 0x06054b50;
const SIG_CDFH  = 0x02014b50;
const SIG_LFH   = 0x04034b50;

// Find End of Central Directory record. It sits near the end, before an
// optional comment (max 65535 bytes), so we scan the trailing chunk.
function findEOCD(buffer) {
  const dv = new DataView(buffer);
  const len = buffer.byteLength;
  const scanStart = Math.max(0, len - 65557); // 22 (EOCD min) + 65535 (max comment)
  for (let i = len - 22; i >= scanStart; i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) {
      // Sanity: comment length must place EOCD end exactly at file end.
      const commentLen = dv.getUint16(i + 20, true);
      if (i + 22 + commentLen === len) return i;
    }
  }
  throw new Error('ZIP : End of Central Directory introuvable');
}

// Parse central directory → array of { filename, method, csize, lfhOffset }.
function parseCentralDirectory(buffer) {
  const dv = new DataView(buffer);
  const eocd = findEOCD(buffer);
  const totalEntries = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);

  // ZIP64 sentinel — we don't support files > 4 GB but Insee CSVs are small.
  if (cdOffset === 0xffffffff) {
    throw new Error('ZIP64 non supporté');
  }

  const entries = [];
  let p = cdOffset;
  const cdEnd = cdOffset + cdSize;
  for (let i = 0; i < totalEntries && p < cdEnd; i++) {
    if (dv.getUint32(p, true) !== SIG_CDFH) {
      throw new Error(`Central directory: signature manquante à offset ${p}`);
    }
    const method  = dv.getUint16(p + 10, true);
    const csize   = dv.getUint32(p + 20, true);
    const namelen = dv.getUint16(p + 28, true);
    const extralen = dv.getUint16(p + 30, true);
    const commentlen = dv.getUint16(p + 32, true);
    const lfhOffset = dv.getUint32(p + 42, true);
    const filename = new TextDecoder('utf-8').decode(
      new Uint8Array(buffer, p + 46, namelen)
    );
    entries.push({ filename, method, csize, lfhOffset });
    p += 46 + namelen + extralen + commentlen;
  }
  return entries;
}

// Compute the byte offset where the actual compressed data begins for an
// entry, by reading the corresponding local file header.
function dataOffsetOf(buffer, lfhOffset) {
  const dv = new DataView(buffer);
  if (dv.getUint32(lfhOffset, true) !== SIG_LFH) {
    throw new Error(`Local file header attendu à offset ${lfhOffset}`);
  }
  const namelen = dv.getUint16(lfhOffset + 26, true);
  const extralen = dv.getUint16(lfhOffset + 28, true);
  return lfhOffset + 30 + namelen + extralen;
}

// Wrap a Uint8Array of raw deflate bytes into a ReadableStream<string> of UTF-8 lines
// (without terminators).
function inflateToLines(compressedBytes, method) {
  if (method === 0) {
    // Stored — decode bytes directly.
    return new ReadableStream({
      start(controller) {
        const text = new TextDecoder('utf-8').decode(compressedBytes);
        let start = 0;
        for (let i = 0; i < text.length; i++) {
          if (text.charCodeAt(i) === 10) {
            let s = text.slice(start, i);
            if (s.length && s.charCodeAt(s.length - 1) === 13) s = s.slice(0, -1);
            controller.enqueue(s);
            start = i + 1;
          }
        }
        if (start < text.length) {
          let s = text.slice(start);
          if (s.length && s.charCodeAt(s.length - 1) === 13) s = s.slice(0, -1);
          controller.enqueue(s);
        }
        controller.close();
      }
    });
  }
  if (method !== 8) throw new Error(`Méthode ZIP ${method} non supportée`);

  const inflated = new Blob([compressedBytes]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .pipeThrough(new TextDecoderStream('utf-8'));

  let buf = '';
  return new ReadableStream({
    async start(controller) {
      const reader = inflated.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let i = 0;
          while (true) {
            const j = buf.indexOf('\n', i);
            if (j < 0) break;
            let line = buf.slice(i, j);
            if (line.length && line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
            controller.enqueue(line);
            i = j + 1;
          }
          buf = buf.slice(i);
        }
        if (buf) {
          if (buf.length && buf.charCodeAt(buf.length - 1) === 13) buf = buf.slice(0, -1);
          controller.enqueue(buf);
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    }
  });
}

// Stream rows from the matching ZIP entry.
//
// `zipBuffer`         : ArrayBuffer of full ZIP
// `filenamePattern`   : RegExp matched against ZIP entry filename
// `handlers`:
//   onHeader(header, headerIdx)  — called once before any data row. `headerIdx`
//                                  maps column name → index for fast row[h.X] access
//   onRow(row, idx)              — called per parsed data row
//   onProgress(rowCount)         — optional, periodic with cumulative count
export async function streamCsvFromZip(zipBuffer, filenamePattern, handlers) {
  const { onHeader, onRow, onProgress } = handlers;
  const entries = parseCentralDirectory(zipBuffer);
  const entry = entries.find(e => filenamePattern.test(e.filename));
  if (!entry) {
    throw new Error(`Aucune entrée ${filenamePattern} dans le ZIP (entrées : ${entries.map(e => e.filename).join(', ')})`);
  }

  const dataStart = dataOffsetOf(zipBuffer, entry.lfhOffset);
  const compressed = new Uint8Array(zipBuffer, dataStart, entry.csize);

  const stream = inflateToLines(compressed, entry.method);
  const reader = stream.getReader();

  let header = null;
  let count = 0;
  const progressEvery = 50000;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (!header) {
      header = parseCsvLine(value);
      if (onHeader) onHeader(header, headerIndex(header));
      continue;
    }
    if (onRow) onRow(parseCsvLine(value), count);
    count++;
    if (onProgress && (count % progressEvery === 0)) onProgress(count);
  }
  if (onProgress) onProgress(count);
  return { header, count };
}

// Parse a CSV line. Insee Melodi exports use `;` separator with optional
// double quotes around string fields; numbers are unquoted; fields are
// guaranteed not to contain embedded `;` or newlines.
export function parseCsvLine(line) {
  const parts = line.split(';');
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    if (s.length >= 2 && s.charCodeAt(0) === 34 && s.charCodeAt(s.length - 1) === 34) {
      parts[i] = s.slice(1, -1);
    }
  }
  return parts;
}

// Map header column names to indices.
export function headerIndex(header) {
  const idx = {};
  header.forEach((h, i) => { idx[h] = i; });
  return idx;
}
