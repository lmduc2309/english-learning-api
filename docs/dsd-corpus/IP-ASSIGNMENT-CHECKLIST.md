# IP Assignment Checklist

Nobody authors publishable DSD content before this is complete for them.

## Why this gates everything

OEWN was excluded to avoid a third-party attribution chain, at an accepted cost
of roughly double the authoring effort. If contributors do not assign their
rights, authorship stays with the authors and DSD has traded a *known,
documented* CC BY 4.0 chain for an *unknown, undocumented* contributor-rights
chain.

That is strictly worse than the position the exclusion was meant to escape: at
least CC BY 4.0 is written down and can be complied with. An unassigned
contribution from a contractor who has moved on, in a jurisdiction where
work-for-hire does not apply to them, is a defect a purchaser's counsel will
find during diligence.

The cost is paid at authoring time. The benefit only arrives if this checklist
is complete.

---

## Per contributor, before their first authored record

- [ ] Counsel-approved contributor agreement executed.
- [ ] **Present assignment** of relevant rights — assigning rights *now*, not a
      promise to assign later. A promise is a contract claim; an assignment is
      ownership.
- [ ] **Assignment fallback** for jurisdictions where work-for-hire does not
      apply to the engagement type. Do not assume the doctrine travels.
- [ ] **Originality and non-infringement warranty** from the contributor.
- [ ] **Disclosure obligation** covering tools used and sources consulted,
      matching the clean-room declaration.
- [ ] **Confidentiality**, covering unreleased corpus content.
- [ ] **Moral-rights waiver or consent**, to the extent the governing
      jurisdiction permits. Some jurisdictions do not permit waiver; record what
      was achievable rather than assuming the clause worked.
- [ ] Governing law and jurisdiction recorded.
- [ ] Evidence ID issued and recorded in `data/dsd/contributor-registry.json`.
- [ ] Pseudonymous contributor ID allocated (`DSD-A-nnn`, `DSD-R-nnn`).
- [ ] **Personal data stored outside Git.** Only the evidence ID and approval
      status are committed. The registry validator rejects `name`, `email`,
      `signature` and similar fields, so this is enforced.

## Per engagement type

**Employee.** Confirm the employment agreement actually covers work product for
this project. Many do not cover work outside the employee's normal duties.

**Contractor or freelancer.** Work-for-hire frequently does **not** apply. The
present assignment is doing the real work here — verify it is present, in scope,
and governed by a law where it is effective.

**Agency or vendor.** Confirm the agency holds assignable rights from the
individuals who actually did the work. An agency cannot assign what it does not
hold. Ask for evidence, not assurance.

**Volunteer or trial contributor.** Same requirements. Content authored during
an unpaid trial is the most commonly missed category, and it tends to enter the
corpus without anyone deciding that it should.

---

## Registry effect

`dsd-english-original`, `dsd-vietnamese-original` and `dsd-ipa-original` are
`blocked` in the source registry, with a recorded reason, until at least one
contributor holds executed assignment evidence.

Unblocking is a deliberate act: update the source registry `status` and
`approvedScopes`, add the evidence ID, and re-run the validator. Do not unblock
in anticipation of a signature.

## Review checkpoint

Gate A1 requires the product owner and legal reviewer to approve the agreement
template, the release-territory list, and who may sign each class of approval,
with evidence IDs recorded.
