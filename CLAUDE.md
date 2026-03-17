# CLAUDE.md — phishPhinger

## Project Overview

**phishPhinger** is a Python tool for flagging suspect (phishing/malicious) web domains. It uses Cloudflare Radar's top-domain datasets as a baseline of known-legitimate domains and compares candidate domains against that baseline to surface anomalies.

---

## Architecture Plan

### Core Components

1. **Domain Loader** (`data/`)
   - Ingests Cloudflare Radar CSV files (`rank`, `domain`, `categories`)
   - Builds a set/dict of trusted domains with their rank and category metadata

2. **Domain Analyzer** (`phishphinger/analyzer.py`)
   - Accepts a list of candidate domains (from stdin, file, or URL)
   - Checks each domain against the trusted set
   - Applies heuristics to flag suspicious domains

3. **Heuristics Engine** (`phishphinger/heuristics.py`)
   - Typosquatting detection: Levenshtein distance against top-N legitimate domains
   - Homoglyph/IDN detection: Unicode lookalike characters
   - Subdomain abuse: Legit domain used as a subdomain of a suspicious root
   - Brand impersonation: Known brand keywords appearing in untrusted domains
   - TLD mismatch: Common domains on unexpected TLDs (e.g., `google.tk`)

4. **CLI Interface** (`phishphinger/cli.py`)
   - Entry point: `python -m phishphinger` or `phishphinger` command
   - Flags: `--input`, `--threshold`, `--output`, `--format (json|csv|text)`

5. **Tests** (`tests/`)
   - Unit tests for each heuristic
   - Integration tests with sample domain lists

### Data Files

Located in `data/` (move from repo root):
- `cloudflare-radar_top-100-domains_*.csv` — high-confidence trusted set
- `cloudflare-radar_top-200-domains_*.csv`
- `cloudflare-radar_top-500-domains_*.csv`

---

## Development Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Running

```bash
# Check a list of domains
phishphinger --input domains.txt

# Check a single domain
echo "g00gle.com" | phishphinger
```

## Testing

```bash
pytest tests/
```

---

## Implementation Priorities

1. Set up Python package structure (`pyproject.toml` / `setup.py`, `requirements.txt`)
2. Implement domain loader from CSV data files
3. Implement basic trusted-domain lookup (exact match)
4. Implement typosquatting heuristic (Levenshtein distance)
5. Implement homoglyph detection
6. Build CLI interface
7. Add tests for each heuristic
8. Add CI via GitHub Actions

---

## Key Conventions

- Python 3.10+
- Use `pathlib` for file paths, not `os.path`
- Type hints on all public functions
- Heuristics return a scored result (`0.0`–`1.0` suspicion score) so callers can apply their own threshold
- CSV data files live in `data/`; never hardcode paths
- No external API calls — fully offline by default
