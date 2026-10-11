import archiver from 'archiver';
import type { Response } from 'express';

export interface ZipEntry {
  /** Name inside the zip, may contain folders. */
  name: string;
  /** Absolute file path, or text content. */
  file?: string;
  text?: string;
}

/** Streams a zip straight to the response; nothing is written to disk. */
export async function sendZip(res: Response, fileName: string, entries: ZipEntry[]): Promise<void> {
  res.attachment(fileName);
  res.setHeader('Content-Type', 'application/zip');
  const archive = archiver('zip', { zlib: { level: 1 } }); // images are already compressed
  const done = new Promise<void>((resolve, reject) => {
    archive.on('error', reject);
    res.on('close', resolve);
  });
  archive.pipe(res);
  for (const entry of entries) {
    if (entry.file) archive.file(entry.file, { name: entry.name });
    else archive.append(entry.text ?? '', { name: entry.name });
  }
  await archive.finalize();
  await done;
}

export function safeName(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 40) || 'project';
}
