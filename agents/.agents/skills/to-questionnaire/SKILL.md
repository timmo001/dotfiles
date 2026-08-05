---
name: to-questionnaire
description: Turn a decision the user cannot answer alone into a channel-aware questionnaire draft for one other person. Use when missing knowledge belongs to a colleague, maintainer, or domain expert and the user needs questions for GitHub, Slack, Discord, or a document.
# origin: https://github.com/mattpocock/skills/tree/main/skills/productivity/to-questionnaire
# upstream-sha: 0f2bdbdb06220d2df3718b8f0483157c6c8a8600
# local-edits:
#   - draft in chat by default instead of always writing a Markdown file
#   - adapt output for GitHub comments, Slack/Discord messages, or a full document
#   - require explicit permission before writing a file or posting a GitHub comment; Slack/Discord remain draft-only
---

# To Questionnaire

Turn something the user cannot answer alone into questions for the one person who holds the missing knowledge. Grill the send, not the subject: ask only what the user can answer about the recipient and the result they need.

1. **Identify the recipient.** Ask for their role, expertise, relationship to the user, and destination channel. Done when the tone, assumed context, and output shape are clear.
2. **Identify the needed result.** Ask which facts or decisions the user must get back and what those answers will unblock. Done when every required outcome is concrete.
3. **Draft for the channel.** Put the most important questions first, make each question cover one idea, and add a short reason only when it prevents a weak or ambiguous answer.

## Channel Shapes

- **GitHub comment:** concise Markdown that fits one issue, pull request, or discussion comment. Include enough context for readers who were not in the conversation. Do not include answer stubs.
- **Slack or Discord:** a short context message followed by individually answerable numbered questions. Split into several draft messages when one message would be hard to answer.
- **Document:** title, purpose, sender and recipient, one context paragraph, answer guidance, themed question sections, and a final "Anything else?" question.

Return the draft in chat by default. Do not write a file, create or edit a GitHub comment, or perform any other external action unless the user explicitly requests that specific action. Slack and Discord output is always draft-only because no integration is available.
