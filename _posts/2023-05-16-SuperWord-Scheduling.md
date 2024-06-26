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
    - This packset was build by "seeding" with adjacent memory ops, and then extending this seed via non-memory ops.
  - Before scheduling, we have already checked that:
    - All packs are `implementable` (the vector operations exist on the platform).
    - All packs are `profitable` (it is worth vectorizing them, rather than leaving them as scalars).

**Problem statement: what does the schheduling need to do?**

Given the `packset` and the `dependency-graph`, we must do the following now:
- Build the `PacksetGraph`, which respects both the constraints from:
  - the `dependency-graph` (the edges)
  - and the `packset` (packed nodes are now forced to be executed in parallel, thus they must also be constrained by the edges of all other pack members).
- Linearize this `PacksetGraph` (eg with topsort). If it fails, we must have a cycle introduced by some packs. We bail out of vectorization.
- Re-order the memory slices: packed loads and stores must have the same memory state.
- Replace the scalar nodes with vector nodes.

Let us look into each of these steps in more detail.

**Building the PacksetGraph**

The idea is to compute the dependency graph after vectorization.
The `PacksetGraph` basically maps the dependence-graph from the pre-vectorization graph to the vectorized graph.
For this, we merge the scalar ops of a pack into a one pack-node, while all non packed nodes are represented by a scalar-node.
The merging of packed nodes means that all dependencies of all members are merged too: whatever is an input of one of them
needs to be executed before all of them, and whatever is an output of one of them needs to be executed after all of them.

**Linearizing (scheduling) the PacksetGraph**

We sort the PacksetGraph topologically (find a linear order of all PacksetGraph nodes, such that all edges point forward).
If there is a cycle in the PacksetGraph, then the linearization fails, and we cannot vectorize with the given packset.
Currently, we bail out of vectorization, but one could also just remove some packs, filter again (to check `implemented` and `profitable`),
rebuild the PacksetGraph and see if it can be scheduled then.

See implementation and more details here (also more details about why `independence` at pack level can still lead to cycles in the PacksetGraph):
[JDK-8304042](https://bugs.openjdk.org/browse/JDK-8304042): C2 SuperWord: schedule must remove packs with cyclic dependencies ([PR](https://github.com/openjdk/jdk/pull/13078))

The linearization ensures that packed memops are now directly succeeding each other, with no other ops in between (and specifically no memops).
This will come in handy in the next step.

**Re-ordering the memory slices**

After replacing the packed nodes with a single vector operation, they are executed in parallel, which has the same effect
as loading them in immediate succession.
Therefore, we want to rebuild the memory slice order accordingly.
We want the order of the memory slice to represent the sub-order of those memory ops in the PacksetGraph linearization.

See implementation and more details here:
[JDK-8304720](https://bugs.openjdk.org/browse/JDK-8304720): SuperWord::schedule should rebuild C2-graph from SuperWord dependency-graph ([PR](https://github.com/openjdk/jdk/pull/13354))

**Replacing the scalar nodes with vector nodes**

Now we iterate over the packset, generate the corresponding vector node, and subsume all pack members with that new node.
Since the memops of a pack are now in direct succession, it is now easy to pick the correct memory state for memops:
we know that the first member's input memory state is the memory state for the vector operation.


<script src="https://utteranc.es/client.js"
        repo="eme64/blog"
        issue-term="pathname"
        theme="github-light"
        crossorigin="anonymous"
        async>
</script>
