---
title: "SuperWord (Auto-Vectorization) - Scheduling"
date: 2023-05-16
---

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

TODO more
