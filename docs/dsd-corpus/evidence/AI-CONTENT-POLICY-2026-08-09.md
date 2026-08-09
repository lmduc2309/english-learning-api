# AI Content Policy and Owner Approval — 2026-08-09

Evidence IDs:

- `EV-DSD-AI-POLICY-20260809-001`
- `EV-OWNER-DECLARATION-20260809-001`
- `EV-OPENAI-OUTPUT-TERMS-20260101`

## Product decision

The product owner directed DSD to create new dictionary content with AI rather
than adapt, paraphrase or translate the legacy corpus. The production model is:

- origin actor: `DSD-G-001` (`ai`, generator only);
- human approver: `DSD-O-001` (`human`, owner/reviewer);
- source: `openai-dsd-generated-v1`;
- tool: `openai-codex-text-generation`;
- generation input: blank DSD prompt containing only DSD inventory context and
  writing rules; no legacy or blocked dictionary wording;
- publication: never automatic; the owner reads each exact content hash.

## Commercial-use basis recorded

OpenAI's Services Agreement effective 2026-01-01 states that, as between the
customer and OpenAI and to the extent permitted by applicable law, the customer
owns Output and OpenAI assigns any interest it has in Output. It also states
that output may not be unique and that the customer is responsible for judging
accuracy, appropriateness and rights in its inputs and uses.

Official evidence URL:
`https://openai.com/policies/services-agreement/`

This record does not claim that AI output necessarily attracts copyright,
qualifies for registration, is unique, or cannot resemble third-party text.
DSD therefore keeps similarity auditing, content hashes, quality review and
blocked-source controls.

## Owner declaration

The project is operated by its owner as a solo development project. The owner
accepts responsibility for reviewing generated content before publication and
does not represent generated wording as personally authored. If the corpus is
later transferred to a separate company, investor or buyer, the ownership and
contract evidence must be reviewed for that transfer.
