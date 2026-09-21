"""Keep historical authoring drafts from overwriting the reviewed course."""
import sys


def require_historical_restore():
    if '--restore-2026-09-20' not in sys.argv:
        raise SystemExit(
            'This is the historical authoring draft from 2026-09-20. '
            'The reviewed course now lives in app/content/*.json. No files changed. '
            'For deliberate recovery only, --restore-2026-09-20 replaces newer editorial work. '
            'See app/docs/COURSE-EDITORIAL-2026-09-21.md.'
        )
