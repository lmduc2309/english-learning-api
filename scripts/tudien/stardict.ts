import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

export interface IfoInfo {
  version: string;
  wordcount: number;
  sametypesequence: string;
  bookname: string;
}

export interface IdxRecord {
  word: string;
  offset: number;
  size: number;
}

export function parseIfo(text: string): IfoInfo {
  const get = (key: string): string => {
    const m = new RegExp('^' + key + '=(.*)$', 'm').exec(text);
    return m ? m[1].trim() : '';
  };
  return {
    version: get('version'),
    wordcount: parseInt(get('wordcount') || '0', 10),
    sametypesequence: get('sametypesequence'),
    bookname: get('bookname'),
  };
}

export function parseIdx(buf: Buffer): IdxRecord[] {
  const records: IdxRecord[] = [];
  let i = 0;
  while (i < buf.length) {
    let j = i;
    while (j < buf.length && buf[j] !== 0) j++;
    const word = buf.slice(i, j).toString('utf8');
    const offset = buf.readUInt32BE(j + 1);
    const size = buf.readUInt32BE(j + 5);
    records.push({ word, offset, size });
    i = j + 9;
  }
  return records;
}

function findStardictFiles(dir: string): { ifo: string; idx: string; dict: string | null; dictDz: string | null } {
  const entries = fs.readdirSync(dir);
  const find = (pred: (e: string) => boolean) => {
    const f = entries.find(pred);
    return f ? path.join(dir, f) : null;
  };
  const ifo = find(e => e.endsWith('.ifo'));
  const idx = find(e => e.endsWith('.idx'));
  const dictDz = find(e => e.endsWith('.dict.dz'));
  const dict = find(e => e.endsWith('.dict'));
  if (!ifo || !idx) throw new Error(`Missing .ifo/.idx StarDict files in ${dir}`);
  return { ifo, idx, dict, dictDz };
}

// Read the three StarDict files from a directory and return a map of
// lowercased headword → definition HTML. The .dict.dz (dictzip) is a valid
// gzip stream, so zlib decompresses it whole (~108 MB, acceptable for a
// one-off pipeline run). Duplicate keys are last-wins.
export function loadTudien(dir: string): Map<string, string> {
  const files = findStardictFiles(dir);
  const info = parseIfo(fs.readFileSync(files.ifo, 'utf8'));
  if (info.sametypesequence !== 'h') {
    throw new Error(`Unsupported sametypesequence "${info.sametypesequence}" (expected "h") in ${files.ifo}`);
  }
  const records = parseIdx(fs.readFileSync(files.idx));

  let dict: Buffer;
  if (files.dict) {
    dict = fs.readFileSync(files.dict);
  } else if (files.dictDz) {
    dict = zlib.gunzipSync(fs.readFileSync(files.dictDz));
  } else {
    throw new Error(`No .dict or .dict.dz found in ${dir}`);
  }

  const map = new Map<string, string>();
  for (const r of records) {
    map.set(r.word.toLowerCase(), dict.slice(r.offset, r.offset + r.size).toString('utf8'));
  }
  return map;
}
