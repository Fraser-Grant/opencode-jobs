# Roadmap

The roadmap records outcomes and sequencing, not a fixed feature contract.
GitHub issues hold acceptance criteria and implementation discussion; milestones
group issues into releasable outcomes. Dates are added only when work is
actually committed.

## Now: dependable delivery

- Establish the standalone repository as the source of truth and keep the
  `codeagentconfig` mirror synchronized.
- Automate versioning, changelog generation, GitHub releases, and npm
  publication without long-lived credentials.
- Require CI and behavioral smoke coverage for every behavior change.
- Keep job definitions and persisted scheduler state strictly validated while
  preserving deliberate recovery from partial history corruption.

## Next: operational confidence

- Turn repeated support or dogfooding failures into reproducible smoke cases.
- Improve diagnostics for skipped, failed, timed-out, and recovered runs before
  adding scheduler surface area.
- Define compatibility and migration policy before changing persisted job,
  registry, run-history, or session-state formats.

## Later: evidence-led expansion

- Consider additional scheduling backends only when concrete non-systemd
  demand justifies the maintenance cost.
- Consider richer coordination and retention controls after reliability and
  observability are measured in normal use.

## Planning cadence

- Triage new issues into `now`, `next`, or `later`; close requests that do not
  have a clear user outcome.
- Review the roadmap after each minor release and whenever evidence changes the
  ordering.
- Promote work into a milestone only when its acceptance criteria and release
  impact are understood.
- Record durable architectural decisions in the pull request or a focused ADR;
  do not overload this roadmap with implementation detail.
