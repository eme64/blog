---
title: "SuperWord (Auto-Vectorization) - Scheduling"
date: 2023-05-16
---

**Motivation for this post**

I recently re-wrote the scheduling algorithm:
- [JDK-8304042](https://bugs.openjdk.org/browse/JDK-8304042): C2 SuperWord: schedule must remove packs with cyclic dependencies ([PR](https://github.com/openjdk/jdk/pull/13078))
  - Build the `PacksetGraph`, and linearize it (schedule it to a list, such that all edges in the PacksetGraph are restricted). If linearization fails, we have a cyclic dependency and must bail out of vectorization.
- [JDK-8304720](https://bugs.openjdk.org/browse/JDK-8304720): SuperWord::schedule should rebuild C2-graph from SuperWord dependency-graph ([PR](https://github.com/openjdk/jdk/pull/13354))
  - Use the `PacksetGraph` to re-order the memory slices.

**Background**

I assume you have read this post already ([Introduction to SuperWord](https://eme64.github.io/blog/2023/02/23/SuperWord-Introduction.html)).

But here a quick recap:
- We have a improved dependency graph on our DAG. It has these two types of edges:
  - Data-edges, so that data defs come before data uses.
  - Memory-edges, but not any where the two memops provably reference different memory.
- We have a packset:
  - Nodes in a pack are:
    - `isomorphic` (they do the same operaton on the same type).
    - `independent` (none of the pack's members has another pack member in its (recursive) inputs).
    - Currently, memops packs are also restricted to be `adjacent`, but we may be able to relax this in the future.
  - Before scheduling, we have already checked that:
    - All packs are `implementable` (the vector operations exist on the platform).
    - All packs are `profitable` (it is worth vectorizing them, rather than leaving them as scalars).



**Problem statement: what does the schheduling need to do?**

Given the `packset` and the `dependency-graph`, we must do the following now:
- Re-order the memory slices.
- Replace the scalar nodes with vector nodes.

TODO more
