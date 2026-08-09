# DSD Pilot Measurement Protocol

- Protocol version: **1.0-draft**
- Status: **AWAITING PRODUCT/OPERATIONS APPROVAL**
- Applies to: Task 19 inventory and the 500-entry Tasks 20–22 pilot

No pilot schedule or v1 delivery date may be derived until this protocol is
approved and the complete pilot has been measured.

## Measurement unit

Use one timing event per contributor, record, activity, and work session. Store
durations as integer seconds and derive minutes only in reports. Do not ask
contributors to reconstruct time from memory at the end of a batch.

Required event fields:

```text
event_id,batch_id,entry_id,record_kind,record_id,activity,contributor_id,
started_at,ended_at,duration_seconds,outcome,rework_reason,policy_version
```

Allowed activities:

- `inventory_select`, `inventory_review`
- `author_definition`, `author_translation`, `author_example`
- `review_definition`, `review_translation`, `review_example`
- `similarity_review`, `rewrite`
- `author_ipa`, `review_ipa`
- `generate_audio`, `automated_audio_qa`, `listen_audio`, `regenerate_audio`

Allowed outcomes are `accepted`, `rework_required`, `rejected`, and
`interrupted`. Rework reasons use a controlled list: `linguistic`,
`translation`, `example_fit`, `similarity`, `provenance`, `ipa`, `audio_noise`,
`audio_pronunciation`, `audio_level`, `rights`, or `other_with_note`.

## Timer rules

1. Start immediately before the measured activity and stop immediately after.
2. Pause for breaks, meetings, unrelated research, and technical outages.
3. Record interrupted sessions; do not silently discard them.
4. Tool runtime is measured separately from human review time.
5. The author and reviewer record their own sessions independently.
6. A correction is a new event linked to the same record, never an edit to an
   earlier timing event.

## Required pilot metrics

Report median, p75, p90, mean, and sample count for:

- inventory minutes per accepted headword;
- authoring and independent-review minutes per record kind;
- total human minutes per complete entry;
- IPA authoring/review minutes per entry;
- audio generation, automated-QA, and listening minutes per asset;
- rework events and minutes by reason;
- first-pass acceptance and final rejection rates;
- similarity manual-review rate and minutes;
- similarity false positives by record kind and match class.

Do not blend automated runtime with paid human time. Report both so staffing
and infrastructure costs can be modeled separately.

## Quality and exclusion rules

- Include all pilot attempts, including records later rejected or quarantined.
- Exclude only documented platform outages from human throughput; report them
  separately as operational downtime.
- Never exclude a slow contributor or failed batch merely because it worsens
  the estimate.
- Segment author and reviewer results without publishing identity mappings.
- Suppress any subgroup report with fewer than five observations.

## Re-estimation

After the signed internal pilot drill, calculate:

```text
human_hours_per_entry = total_included_human_seconds / accepted_complete_entries / 3600
v1_human_hours         = human_hours_per_entry * 5000
extended_human_hours   = human_hours_per_entry * 20000
calendar_weeks         = human_hours / committed_team_hours_per_week
```

Add measured project-management, legal, engineering, and operations capacity
separately; the content throughput number does not include them. Publish a
range using the median and p75 result rather than one optimistic date.

## Approval

| Role | Evidence ID | Date |
| --- | --- | --- |
| Product owner | — | — |
| Content operations owner | — | — |

Task 19 may begin only after both rows contain real evidence IDs and the status
above is changed to `APPROVED`.
