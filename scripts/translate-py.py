#!/usr/bin/env python3
"""
Translate Vietnamese meanings using deep_translator with provider rotation.
Rotates: GoogleTranslator → MyMemoryTranslator → back, spreading load.

Usage:
  python3 scripts/translate-py.py [--type definitions|examples|all] [--limit N] [--delay MS]
"""

import argparse
import time
import random
import json
import re
import sys
import psycopg2
import os
from pathlib import Path

# ── Load .env ─────────────────────────────────────────────────────────────────
env_path = Path(__file__).parent.parent / '.env'
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, _, v = line.partition('=')
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

from deep_translator import GoogleTranslator, MyMemoryTranslator

# ── Config ────────────────────────────────────────────────────────────────────
DB_CONFIG = {
    'host': os.environ.get('DB_HOST', 'localhost'),
    'port': int(os.environ.get('DB_PORT', '5432')),
    'dbname': os.environ.get('DB_NAME', 'english_learning_db'),
    'user': os.environ.get('DB_USERNAME', 'dictionary_user'),
    'password': os.environ.get('DB_PASSWORD', 'dictionary_pass'),
}
DB_FLUSH_EVERY = 50
MAX_TEXT_LEN = 480


# ── Helpers ───────────────────────────────────────────────────────────────────
def clean_text(text: str) -> str:
    text = re.sub(r'\|', ', ', text)
    text = re.sub(r'\s{2,}', ' ', text)
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', text)
    return text[:MAX_TEXT_LEN].strip()


def calc_eta(start: float, done: int, total: int) -> str:
    if done == 0:
        return '—'
    elapsed = time.time() - start
    remaining = (elapsed / done) * (total - done)
    if remaining < 60:
        return f'{int(remaining)}s'
    if remaining < 3600:
        return f'{int(remaining/60)}m'
    if remaining < 86400:
        return f'{remaining/3600:.1f}h'
    return f'{remaining/86400:.1f}d'


# ── Provider pool ─────────────────────────────────────────────────────────────
class ProviderPool:
    def __init__(self):
        self.providers = [
            {'name': 'Google', 'cooldown_until': 0, 'ok': 0, 'fail': 0,
             'fn': lambda t: GoogleTranslator(source='en', target='vi').translate(t)},
            {'name': 'MyMemory', 'cooldown_until': 0, 'ok': 0, 'fail': 0,
             'fn': lambda t: MyMemoryTranslator(source='en', target='vi').translate(t)},
        ]
        self.idx = 0

    def translate(self, text: str) -> str:
        now = time.time()
        available = [p for p in self.providers if p['cooldown_until'] <= now]

        if not available:
            earliest = min(p['cooldown_until'] for p in self.providers)
            wait = earliest - now + 1
            print(f' ⏳ all cooling ({wait:.0f}s)...', end='', flush=True)
            time.sleep(wait)
            return self.translate(text)

        provider = available[self.idx % len(available)]
        self.idx += 1

        try:
            result = provider['fn'](text)
            if not result or not result.strip():
                raise ValueError('Empty translation')
            provider['ok'] += 1
            provider['fail'] = 0
            return result.strip()
        except Exception as e:
            provider['fail'] += 1
            msg = str(e).lower()
            is_rate = '429' in msg or 'too many' in msg or 'quota' in msg or 'limit' in msg

            if is_rate:
                # Progressive: 10min, 20min, 40min...
                cooldown = min(10 * 60 * (2 ** (provider['fail'] - 1)), 120 * 60)
                provider['cooldown_until'] = time.time() + cooldown
                print(f' 🚦{provider["name"]} →cooldown {cooldown//60:.0f}m', end='', flush=True)
            elif provider['fail'] >= 3:
                provider['cooldown_until'] = time.time() + 60

            # Fallback to other provider
            others = [p for p in available if p is not provider and p['cooldown_until'] <= time.time()]
            if others:
                try:
                    result = others[0]['fn'](text)
                    if result and result.strip():
                        others[0]['ok'] += 1
                        return result.strip()
                except Exception:
                    pass

            raise

    def print_status(self):
        now = time.time()
        for p in self.providers:
            status = f"🔴 cooldown {(p['cooldown_until']-now)/60:.0f}m" if p['cooldown_until'] > now else '🟢 ok'
            print(f"   {p['name']:<15} {status} (✅{p['ok']} ❌{p['fail']})")


# ── DB helpers ────────────────────────────────────────────────────────────────
def get_connection():
    return psycopg2.connect(**DB_CONFIG)


def fetch_untranslated_definitions(conn, limit=0, word=None):
    sql = """
        SELECT d.id, w.word, d.part_of_speech, d.definition_en
        FROM definitions d
        JOIN words w ON w.id = d.word_id
        WHERE d.definition_vi IS NULL AND d.definition_en IS NOT NULL
        ORDER BY w.frequency_rank ASC NULLS LAST, d.id ASC
    """
    if limit > 0:
        sql += f' LIMIT {limit}'
    with conn.cursor() as cur:
        cur.execute(sql)
        return [{'id': r[0], 'word': r[1], 'pos': r[2], 'en': r[3]} for r in cur.fetchall()]


def fetch_untranslated_examples(conn, limit=0, word=None):
    sql = """
        SELECT e.id, w.word, e.example_en
        FROM examples e
        JOIN definitions d ON d.id = e.definition_id
        JOIN words w ON w.id = d.word_id
        WHERE e.example_vi IS NULL AND e.example_en IS NOT NULL
        ORDER BY w.frequency_rank ASC NULLS LAST, e.id ASC
    """
    if limit > 0:
        sql += f' LIMIT {limit}'
    with conn.cursor() as cur:
        cur.execute(sql)
        return [{'id': r[0], 'word': r[1], 'en': r[2]} for r in cur.fetchall()]


def ensure_connected(conn):
    """Reconnect if the connection was dropped."""
    try:
        conn.cursor().execute('SELECT 1')
        return conn
    except Exception:
        try:
            conn.close()
        except Exception:
            pass
        print('\n   🔄 DB reconnecting...', end='', flush=True)
        new_conn = get_connection()
        print(' ✅', flush=True)
        return new_conn


def flush_definitions(conn, updates):
    if not updates:
        return conn
    conn = ensure_connected(conn)
    try:
        with conn.cursor() as cur:
            for u in updates:
                cur.execute(
                    "UPDATE definitions SET definition_vi = %s, review_status = 'raw', is_learner_visible = false WHERE id = %s",
                    (u['vi'], u['id']),
                )
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f'\n   ⚠️  Flush error: {e}', flush=True)
    return conn


def flush_examples(conn, updates):
    if not updates:
        return conn
    conn = ensure_connected(conn)
    try:
        with conn.cursor() as cur:
            for u in updates:
                cur.execute(
                    "UPDATE examples SET example_vi = %s, review_status = 'raw', is_learner_visible = false WHERE id = %s",
                    (u['vi'], u['id']),
                )
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f'\n   ⚠️  Flush error: {e}', flush=True)
    return conn


def get_stats(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*), COUNT(definition_vi) FROM definitions")
        total_defs, defs_vi = cur.fetchone()
        cur.execute("SELECT COUNT(*), COUNT(example_vi) FROM examples")
        total_ex, ex_vi = cur.fetchone()
    return total_defs, defs_vi, total_ex, ex_vi


# ── Translation runner ────────────────────────────────────────────────────────
def run_translation(kind: str, conn, pool: ProviderPool, args):
    label = 'definitions' if kind == 'definitions' else 'examples'
    print(f'\n📝 Translating {label}...')

    items = (fetch_untranslated_definitions(conn, args.limit)
             if kind == 'definitions'
             else fetch_untranslated_examples(conn, args.limit))

    if not items:
        print(f'   ✨ All {label} already have Vietnamese!\n')
        return 0, 0, conn

    print(f'   📊 Found {len(items):,} {label} to translate\n')

    translated = 0
    failed = 0
    pending = []
    start = time.time()

    try:
        for i, item in enumerate(items):
            text = clean_text(item['en'])

            if i % 50 == 0:
                print(
                    f'\r   [{i+1:,}/{len(items):,}] ({100*i/len(items):.1f}%) | '
                    f'{translated} ✅ {failed} ❌ | ETA: {calc_eta(start, i, len(items))}    ',
                    end='', flush=True
                )

            try:
                vi = pool.translate(text)
                pending.append({'id': item['id'], 'vi': vi})
                translated += 1
            except Exception as e:
                print(f'\n   ⚠️  translate error item {item["id"]}: {e}', file=sys.stderr, flush=True)
                failed += 1

            # Flush to DB
            if len(pending) >= DB_FLUSH_EVERY:
                if kind == 'definitions':
                    conn = flush_definitions(conn, pending)
                else:
                    conn = flush_examples(conn, pending)
                pending.clear()

            # Delay with jitter
            delay = args.delay / 1000.0
            jitter = random.uniform(-0.3, 0.3) * delay
            time.sleep(max(0.5, delay + jitter))

    except KeyboardInterrupt:
        print('\n\n🛑 Stopped. Re-run to resume.')

    # Final flush
    if pending:
        if kind == 'definitions':
            conn = flush_definitions(conn, pending)
        else:
            conn = flush_examples(conn, pending)

    print()
    return translated, failed, conn


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--type', default='all', choices=['definitions', 'examples', 'all'])
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--word', default=None)
    parser.add_argument('--stats', action='store_true')
    parser.add_argument('--delay', type=int, default=3000, help='ms between requests (default: 3000)')
    args = parser.parse_args()

    print('\n🇻🇳 Vietnamese Translation — Python / deep_translator')
    print('═══════════════════════════════════════════════════════')
    print(f'   Type:    {args.type}')
    print(f'   Delay:   {args.delay}ms between requests')
    if args.limit:
        print(f'   Limit:   {args.limit}')

    conn = get_connection()
    print('   ✅ Connected to PostgreSQL')

    if args.stats:
        td, dv, te, ev = get_stats(conn)
        print(f'\n📊 Stats:')
        print(f'   Definitions: {dv:,} / {td:,} ({100*dv/td:.1f}%)')
        print(f'   Examples:    {ev:,} / {te:,} ({100*ev/te:.1f}%)')
        conn.close()
        return

    pool = ProviderPool()
    start = time.time()
    total_ok = 0
    total_fail = 0

    if args.type in ('definitions', 'all'):
        ok, fail, conn = run_translation('definitions', conn, pool, args)
        total_ok += ok
        total_fail += fail

    if args.type in ('examples', 'all'):
        ok, fail, conn = run_translation('examples', conn, pool, args)
        total_ok += ok
        total_fail += fail

    conn.close()

    elapsed = int(time.time() - start)
    print('\n' + '═' * 55)
    print('📋 Summary:')
    print(f'   Translated: {total_ok:,} ✅')
    print(f'   Failed:     {total_fail:,} ❌')
    print(f'   Time:       {elapsed}s')
    print('\n📡 Provider stats:')
    pool.print_status()
    print('═' * 55 + '\n')


if __name__ == '__main__':
    main()
