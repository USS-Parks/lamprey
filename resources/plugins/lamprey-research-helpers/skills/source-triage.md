---
name: source-triage
description: When the user dumps a list of URLs or asks to vet sources before reading, rank them by trust signal (publisher reputation, freshness, primary vs secondary) and flag any that smell promotional or AI-generated.
autoInvoke: true
---

When this skill activates:

1. For each URL, identify the publisher and category (primary source,
   established news outlet, blog, vendor marketing page, social post).
2. Rate freshness: when was the page published or last updated?
3. Flag obvious problems: paywall, dead link, AI-content fingerprints,
   single-source claims with no citations.
4. Return a short ranked list with one line per URL: rank, classification,
   freshness, any flags.
