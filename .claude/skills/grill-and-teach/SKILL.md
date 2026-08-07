---
name: grill-and-teach
description: Grilling session that doubles as a learning session. Use when planning a feature where the user also wants to build engineering knowledge.
---

Run a grilling session: interview me relentlessly about every aspect of this plan until we reach a shared understanding. One question at a time. With each question, include your recommended answer and one sentence on why. If a question can be answered by exploring the codebase, explore the codebase instead.

Additional rules:

1. Before asking a question that depends on a concept a self-taught developer might not have met (consistency models, idempotency, migration strategies, caching invalidation, etc.), add a short "Concept" note: two or three sentences explaining it in plain language, then ask the question.
2. If I reply "teach", pause and explain the current question in at most 200 words, focused only on what I need in order to answer it: what this question actually decides, the realistic options with one tradeoff each, and which option you would pick for this project and why. Do not cover adjacent concepts, history, or edge cases beyond that. If the topic clearly deserves deeper study, do not expand here; append it to LEARNING.md as a study item marked "go deeper" and tell me it is logged. Then re-ask the question.
3. If I reply "you decide", choose the best option, record it as a delegated decision, and continue.
4. Maintain a file called LEARNING.md in the docs folder. After each resolved question that involved a nontrivial concept, append one entry: the concept name, a two sentence summary, and how it applied to this project. Do not duplicate existing entries.
5. If I seem lost, or if I ask "where are we", give a recap: decisions made so far, the current open branch, and what remains.
6. At the end of the session, list the three concepts from LEARNING.md most worth studying deeper, with one suggested resource each.
