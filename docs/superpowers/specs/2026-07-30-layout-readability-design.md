# Sub-project B: layout readability

Status: approved, ready for implementation plan. Independent of A and C, can run in parallel, no dependency on either.

## Standing rules

Same as sub-project A: commits as Nicolas Sanchez, zero AI attribution, no em-dashes anywhere, file a PR and do not merge or deploy without approval, verification means observed proof not source inspection, own PR, not combined with A or C.

## Scope

Four fixes, all confirmed as wanted:

1. **Layers panel type scale.** The panel header ("LAYERS 1772/1772") and severity filter chips ("All", "2+", "3+", "Crit") currently render at 10px, measured live via computed style at a 1440x900 viewport. Raise to 12 to 13px. Category rows already render at 14px and are unaffected.
2. **Empty-domain de-emphasis.** This is not a Layers panel (`LayerControl.tsx`) problem: that panel already filters zero-count object types out entirely (`present = types.filter((t) => (counts.get(t.id) ?? 0) > 0)`), so it never shows an empty entry. The real target is `FeedView.tsx`'s domain filter chip row, which maps every entry in `ALL_DOMAINS` (`web/src/feed/domains.ts`) as an identical toggle chip with no count-awareness at all, populated or not. `ALL_DOMAINS` is also currently out of sync with the 16-domain list in `shared/types.ts` (missing transport, sports, civic, political), which needs fixing regardless of this item since financial, cyber, and sports are being removed from `Domain` there (decision 2, resolved 2026-07-30). After that removal, 13 domains remain; several (conflict, civic, political, maritime, aviation) have zero D1 ontology objects by design (maritime/aviation are live overlays already, and conflict/civic/political will be too, once sub-project A ships as an overlay per decision 1). Those chips should visually de-emphasize (dimmed) in `FeedView.tsx` rather than rendering identically to populated domains, so the gap reads as roadmap, not breakage. (Corrected 2026-07-30 after reading `LayerControl.tsx` and `FeedView.tsx` in full; the original draft of this item pointed at the wrong component.)
3. **Feed ticker presence on wide desktop.** Above a desktop breakpoint, give the collapsed feed ticker more visual weight, either a taller default open state or a larger ticker row height. Do not touch the mobile bottom-sheet behavior in `FeedSheet.tsx`, which was tuned recently (`Fix mobile feed chip rows to single scroll line`) and is working; any change must be scoped inside a desktop-only media query or breakpoint check, verified not to alter the mobile DOM/CSS path.
4. **Global-zoom sparseness.** Lightest-touch treatment only: a small persistent stat or context readout (the navbar already carries object/link counts; this is about whether that's sufficient or needs a modest addition). Explicitly not a map-rendering redesign. The real fix for the "empty map" perception is sub-project A and future feed work, not a visual trick; this item should not grow beyond a small, reversible change.

## Verification required before this is called done

DOM computed-style measurements at a 1440x900 viewport, reported as actual numbers (e.g. "Layers panel header: 10px before, 12px after," not "looks better now"). For item 3, confirm via computed style or a mobile-viewport screenshot that the mobile path is unchanged. For item 2, confirm the zero-count domains actually show 0 and are visually distinct (e.g. opacity or color values), not just "should look greyed."
