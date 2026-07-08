import { EXCLUDE_SECTIONS } from './pos-map';

export interface ParsedExample {
  en: string;
  vi: string;
}
export interface ParsedPosBlock {
  vnPos: string;
  senses: string[];
  examples: ParsedExample[];
}
export interface ParsedEntry {
  headword: string;
  posBlocks: ParsedPosBlock[];
}

const HEADWORD_RE = /<b style="font-size:130%">(.*?)<\/b>/;
const SECTION_RE = /<b style="font-size:110%">■\s*([^<]+?)\s*<\/b>/g;
const INDENT_DIV_RE = /<div style="text-indent:(12|24)px">(.*?)<\/div>/g;
const ITALIC_RE = /<i[^>]*>(.*?)<\/i>/;

// Strip HTML tags, decode the handful of entities tudien uses, drop the
// zero-width joiner, and collapse whitespace.
export function cleanText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&bull;/g, '•')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/‍/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Remove middot syllable separators and the zero-width joiner from a headword.
export function stripSyllableDots(s: string): string {
  return s.replace(/[·‍]/g, '');
}

export function parseEntry(html: string): ParsedEntry {
  const hw = HEADWORD_RE.exec(html);
  const headword = hw ? stripSyllableDots(cleanText(hw[1])) : '';

  // Locate every section header ("■ <label>") and its span.
  const headers: Array<{ label: string; contentStart: number; markerStart: number }> = [];
  let m: RegExpExecArray | null;
  SECTION_RE.lastIndex = 0;
  while ((m = SECTION_RE.exec(html)) !== null) {
    headers.push({ label: m[1].trim(), markerStart: m.index, contentStart: SECTION_RE.lastIndex });
  }

  const posBlocks: ParsedPosBlock[] = [];
  for (let i = 0; i < headers.length; i++) {
    const label = headers[i].label;
    if (EXCLUDE_SECTIONS.has(label.toLowerCase())) continue;

    const start = headers[i].contentStart;
    const end = i + 1 < headers.length ? headers[i + 1].markerStart : html.length;
    const chunk = html.slice(start, end);

    const senses: string[] = [];
    const examples: ParsedExample[] = [];
    let d: RegExpExecArray | null;
    INDENT_DIV_RE.lastIndex = 0;
    while ((d = INDENT_DIV_RE.exec(chunk)) !== null) {
      const indent = d[1];
      const inner = d[2];
      if (indent === '12') {
        const text = cleanText(inner);
        const sm = /^(\d+)\.\s*(.+)$/.exec(text); // numbered senses only (skip ★/•)
        if (sm) senses.push(sm[2].trim());
      } else {
        const it = ITALIC_RE.exec(inner);
        const arrow = inner.indexOf('↔');
        if (!it || arrow === -1) continue;
        const en = cleanText(it[1]);
        const vi = cleanText(inner.slice(arrow + 1));
        if (en && vi) examples.push({ en, vi });
      }
    }
    posBlocks.push({ vnPos: label, senses, examples });
  }

  return { headword, posBlocks };
}
