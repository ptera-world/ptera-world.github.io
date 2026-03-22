#!/bin/sh
# Detects the **Bold label.** pattern in content markdown files.
# This is an AI writing tell: "Term. Definition." lists that read like a
# glossary rather than a person thinking. The bold is the detectable surface,
# but the real problem is the structure — just removing bold isn't enough.
# Rewrite so ideas emerge from flowing prose or varied-structure lists.
#
# Two variants:
#   1. **Label.** followed by text  (standalone or in list)
#   2. - **Label** - followed by text  (dash-separated list item)
#
# Usage:
#   scripts/lint-bold-labels.sh              # check all content files
#   scripts/lint-bold-labels.sh file1 file2  # check specific files

set -e

if [ $# -gt 0 ]; then
  files="$@"
else
  files=$(find public/content -name '*.md' -not -path '*/cluster/*' -not -path '*/_index.md')
fi

found=0

for f in $files; do
  # Skip non-content files
  case "$f" in
    public/content/*) ;;
    *) continue ;;
  esac

  # Pattern 1: **Word(s).** followed by text
  matches=$(grep -n '\*\*[^*]\+\.\*\*\s' "$f" 2>/dev/null || true)
  if [ -n "$matches" ]; then
    echo "$f"
    echo "$matches" | while IFS= read -r line; do
      echo "  $line"
    done
    found=1
  fi

  # Pattern 2: - **Word(s)** - text (dash separator, no period in bold)
  matches=$(grep -n '^[[:space:]]*- \*\*[^*.]\+\*\* -' "$f" 2>/dev/null || true)
  if [ -n "$matches" ]; then
    # Only print filename if pattern 1 didn't already
    if ! grep -q '\*\*[^*]\+\.\*\*\s' "$f" 2>/dev/null; then
      echo "$f"
    fi
    echo "$matches" | while IFS= read -r line; do
      echo "  $line"
    done
    found=1
  fi
done

if [ "$found" = "1" ]; then
  echo ""
  echo "Bold-label pattern detected (AI writing tell: glossary-style 'Term. Definition.' lists)."
  echo "Don't just remove the bold — restructure so ideas emerge from prose or varied lists."
  echo "See TELLS.md §7 for details."
  exit 1
fi
