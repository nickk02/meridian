# Contributing to Meridian

Thanks for your interest in Meridian. Contributions are welcome, with one process note up front so everyone is clear on how the project stays both open and sustainable.

## License and the CLA

Meridian is open source under AGPL-3.0. The project also offers commercial licenses to organizations that need to use Meridian without AGPL obligations. To keep that dual-license model possible, the project needs to hold the rights to relicense all contributed code.

Because of that, **before your first contribution can be merged, you need to agree to the Contributor License Agreement (CLA)** in `CLA.md`. The CLA does not take your copyright away, you keep it. It grants the maintainer the rights needed to distribute your contribution under both AGPL-3.0 and a commercial license. This is the same arrangement used by many dual-licensed open-source projects.

In practice: open your pull request as normal. A maintainer will point you to the CLA on your first PR. Once you have agreed to it (a one-time step), your current and future contributions can be merged.

## Scope and ethics

Meridian uses official, public, legal, aggregate sources only. Contributions must stay inside that line. The project does not accept features that:

- track or identify named private individuals,
- scan, probe, or fingerprint infrastructure the operator does not own,
- ingest scanner audio, perform facial recognition, or collect license-plate or personal-social-media data.

This scope is the point of the project, not a limitation. Please do not open PRs that cross it.

## The honesty rule

Meridian's core promise is that nothing is presented as more certain than it is.

- Every object must carry its source, fetch time, and a confidence score.
- Every link must record its basis (shared entity, spatio-temporal proximity, or semantic similarity) and a confidence. A link with no basis is a bug.
- Correlations are labeled as correlations. Nothing in the UI, the data, or any generated text may assert that one event *caused* another.
- The same standard applies to docs: do not describe a capability as live if it is not. Provisioned or roadmap features are labeled as such.

PRs that weaken these guarantees will not be merged, even if the feature is otherwise good.

## How to contribute

1. Open an issue describing the change before large work, so we can agree on direction.
2. Fork, branch, and keep changes focused. One concern per PR.
3. Match the existing style. New feed adapters follow the adapter pattern in `worker/`; UI follows the existing console styling.
4. Verify before you submit: `npm run build` succeeds, and you have actually run the change against live or local data, not just typechecked it.
5. For new data sources: include the provider, an honest reliability weight, the source URL, and the source's license. Non-commercial-only sources must be marked as such.
6. Open the PR with a clear description of what changed and how you verified it.

## What gets prioritized

Highest-value contributions right now: new official data-source adapters (especially outside the US), correlation-engine quality, and cartography/UI polish. See the Roadmap in the README for direction.
