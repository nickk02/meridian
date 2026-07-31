# Sub-project B: layout readability

Status: approved, ready for implementation plan. Independent of A and C, can run in parallel, no dependency on either.

## Standing rules

Same as sub-project A: commits as Nicolas Sanchez, zero AI attribution, no em-dashes anywhere, file a PR and do not merge or deploy without approval, verification means observed proof not source inspection, own PR, not combined with A or C.

## Scope

Four fixes, all confirmed as wanted:

1. **Layers panel type scale.** The panel header ("LAYERS 1772/1772") and severity filter chips ("All", "2+", "3+", "Crit") currently render at 10px, measured live via computed style at a 1440x900 viewport. Raise to 12 to 13px. Category rows already render at 14px and are unaffected.
2. **Empty-domain de-emphasis.** With financial, cyber, and sports removed from the domain list (see decision 2, resolved 2026-07-30), the remaining 13 domains still include several with zero live objects until sub-project A and future feed work land. Domains with a live count of 0 should visually de-emphasize (greyed) in the Layers panel rather than rendering identically to populated domains, so the gap reads as roadmap, not breakage. The count itself still shows (0), it is not hidden.
3. **Feed ticker presence on wide desktop.** Above a desktop breakpoint, give the collapsed feed ticker more visual weight, either a taller default open state or a larger ticker row height. Do not touch the mobile bottom-sheet behavior in `FeedSheet.tsx`, which was tuned recently (`Fix mobile feed chip rows to single scroll line`) and is working; any change must be scoped inside a desktop-only media query or breakpoint check, verified not to alter the mobile DOM/CSS path.
4. **Global-zoom sparseness.** Lightest-touch treatment only: a small persistent stat or context readout (the navbar already carries object/link counts; this is about whether that's sufficient or needs a modest addition). Explicitly not a map-rendering redesign. The real fix for the "empty map" perception is sub-project A and future feed work, not a visual trick; this item should not grow beyond a small, reversible change.

## Verification required before this is called done

DOM computed-style measurements at a 1440x900 viewport, reported as actual numbers (e.g. "Layers panel header: 10px before, 12px after," not "looks better now"). For item 3, confirm via computed style or a mobile-viewport screenshot that the mobile path is unchanged. For item 2, confirm the zero-count domains actually show 0 and are visually distinct (e.g. opacity or color values), not just "should look greyed."
