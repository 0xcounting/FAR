# Governance

FAR exists because the alternative registries are either closed or unaccountable.
So the way it makes decisions has to be legible, or it is just another registry
asking to be trusted.

## The one principle

**A claim in this registry must be checkable by someone who does not trust us.**

Every mapping carries `evidence` and a `confidence`. Every curated link carries a
`rationale` and a `decidedIn` (the PR or issue where it was argued). CI rejects
entries that omit them. If a claim cannot be sourced, it does not go in at
`medium` or above — it goes in at `low` with a note saying why, or it stays in
the `unmapped` backlog where its absence is visible.

This is why the DTI links ship as `proposed` rather than quietly presented as
fact. We could publish 1,929 name matches and look complete. Publishing them as
guesses is less impressive and more useful.

## Roles

| Role | Who | Can |
|---|---|---|
| **Contributor** | anyone | open issues and PRs |
| **Maintainer** | listed in `.github/CODEOWNERS` | merge PRs, resolve disputes |
| **Steward** | the repo owner | add and remove maintainers, break ties |

Maintainers are added by a PR to `CODEOWNERS` that no existing maintainer
objects to within 7 days. The bar is demonstrated care with evidence, not volume
of contributions.

## How a change gets in

**Mechanical changes** — a new platform mapping, a native, a confirmed link.
One maintainer approval, CI green. Merged.

**Judgement changes** — changing a `high`-confidence mapping, changing an asset
namespace already published, altering a slug rule, anything that changes a URL
that has already been served. Two maintainer approvals and a 72-hour comment
window, because someone is depending on the old answer.

**Breaking changes** — the routing scheme, the record shape, removing a route.
See *Stability* below.

## Disputes

A dispute is a claim that the registry says something false. Anyone may raise
one, including the issuer of the asset in question.

1. **Open a dispute issue** (`.github/ISSUE_TEMPLATE/dispute.yml`). Name the
   exact route or table entry and say what is wrong.
2. **A maintainer marks the entry disputed within 7 days.** This is the important
   step and it happens *before* anyone is right: `disputed: true` is added to the
   entry and published in the next build. Consumers can see the contest while it
   is still running rather than after it resolves.
3. **Argument happens in the issue, on evidence.** "This is our token" is not
   evidence. A transaction, a contract deployment, a DTIF record, an official
   announcement is.
4. **A maintainer decides, in writing, in the issue**, and the decision is linked
   from the entry's `decidedIn`. Changing the decision later requires new
   evidence, not a new opinion.
5. **Unresolved after 30 days**, the steward decides.

**We will not resolve a dispute privately.** If you cannot say it in the issue,
it cannot decide the registry's content. This applies to us too: a maintainer
with a commercial interest in an outcome says so in the thread and does not cast
the deciding vote.

**What a dispute cannot do:** it cannot remove a true fact because someone
dislikes it. A CAIP-19 is derived from a chain ID and an address; it is not ours
to withdraw, and neither party to a naming fight owns it.

## Stability

These are promises, and breaking them silently would make the registry useless
for exactly the automated consumers it is for:

- **Routes are permanent.** A path that has been published keeps resolving. If an
  asset is reclassified, the old path stays and gains a `supersededBy`.
- **The slug function is frozen.** It is the URL scheme. Changing it renames every
  file. See `src/lib/slug.js`.
- **Fields are added, not repurposed.** A field's meaning never changes under a
  consumer. A field being removed requires a major version and 90 days' notice in
  the release notes and in `/index.json`.
- **`accepted` never silently becomes `proposed`.** A withdrawal is a change with
  a rationale, announced in the release notes.

A build that would break one of these fails CI.

## What this project will not do

- **Rank, rate, or score assets.** It maps identifiers. It does not tell you
  whether something is a scam, a security, or a good idea.
- **Accept payment for inclusion, position, or a faster decision.** There is
  nothing to buy. If someone claims otherwise, open an issue.
- **Gate reads.** No key, no quota, no logging of who asked what. If the hosting
  ever cannot meet that, the hosting changes.

## Forking

The data is CC0 and the build is one `node src/build.js` over files in `data/`.
If the maintainers become a problem, fork it — that outcome is a design goal, not
a threat. A registry you cannot leave is a registry that does not have to listen.
