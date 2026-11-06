import { readFileSync, statSync } from 'node:fs';

/** Preserve multiline payloads exactly; never place contents in a shell command. */
export async function readRouterText(options, { input = process.stdin } = {}) {
  const selected = ['text', 'text-file', 'stdin'].filter(key => Object.hasOwn(options, key));
  if (selected.length !== 1) throw new Error('Choose exactly one of --text, --text-file, or --stdin.');
  let text;
  if (selected[0] === 'text') text = options.text;
  else {
    let bytes;
    if (selected[0] === 'text-file') {
      try {
        const file = options['text-file'];
        if (!statSync(file).isFile() || statSync(file).size > 65536) throw new Error();
        bytes = readFileSync(file);
      } catch { throw new Error('Cannot read --text-file; use a UTF-8 file no larger than 64 KiB.'); }
    } else {
      if (input.isTTY) throw new Error('--stdin requires piped UTF-8 input.');
      const chunks = []; let size = 0;
      for await (const chunk of input) {
        const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += part.byteLength;
        if (size > 65536) throw new Error('Piped message is larger than 64 KiB.');
        chunks.push(part);
      }
      bytes = Buffer.concat(chunks);
    }
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new Error('Message input must be valid UTF-8.'); }
  }
  if (typeof text !== 'string' || !text.trim() || text.length > 16000) throw new Error('Message text must contain 1–16000 characters.');
  return text;
}
