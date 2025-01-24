---
title: "Introduction to HotSpot JVM C2 JIT Compiler, Part 4"
date: 2025-01-23
---

I assume that you have already looked at
[Part 0](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part00.html),
[Part 1](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part01.html),
[Part 2](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part02.html), and
[Part 3](https://eme64.github.io/blog/2025/01/23/Intro-to-C2-Part03.html).

In Part 4, we look at:
- TODO loop optimizations TODO

[Skip forward to Part 5](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part05.html)

TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO
This is a draft !!!!!!!!!!!!!!!!!!!!!!!!!!!!!
TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO

**Intro to Loop Optimizations**

`PhaseIdealLoop` - 3 specific individualt rounds, then CCP + IGVN, then `optimize_loops` with many rounds of loop-opts.

Here an overview for `PhaseIdealLoop::build_and_optimize`:
- `build_loop_tree`: analyze the loop structures: detect loops and compute dominator information.
- `beautify_loops`: canonicalize the loop structures, needs to rerun `build_loop_tree` afterwards.
- `build_loop_early`: Determine the `early` loop that a data node belongs to.
- `counted_loop`: calls `is_counted_loop` which tries to convert `LoopNode` loops to `CountedLoopNode` loops, i.e. they are converted to a canonical counted loop shape. A critical guarantee for counted loops is that the iv phi will never overflow at runtime.
- `eliminate_useless_zero_trip_guard`: If a post or main loop is removed due to an assert predicate, the opaque that guards the loop is not needed anymore.
- `process_expensive_nodes`: "expensive" nodes have a control input to force them to be only on certain paths and not slow down others. We need loop information to common up "expensive" nodes while not slowing down any path.
- `eliminate_useless_predicates`: Remove predicates that we know will never be used.
- `do_maximally_unroll`: take steps towards full unrolling of the loop, if the exact trip-count is known and low enough.
- `bs->optimize_loops`: GC barrier optimizations, skip.
- `reassociate_invariants`: reassociate invariants (a canonicalization) in preparation for `split_thru_phi` (later optimization).
- `split_if_with_blocks`: This is a large "grab-bag" set of split-trough optimizations, including `split_thru_phi` (e.g. `add(phi(x,y), z)` -> `phi(add(x, z), add(y, z))`).
- `loop_predication`: Insert hoisted check predicates for null checks and range checks etc.
- `do_intrinsify_fill`: Detect loops shapes that fill arrays, replace them with a call to an array fill intrinsic.
- `iteration_split`: perform various iteration splitting transformations:
  - `compute_trip_count`: TODO
  - `do_one_iteration_loop`: TODO
  - `do_remove_empty_loop`: remove loops that have nothing in the loop body.
  - `partial_peel`: TODO
  - `do_peeling`: TODO
  - `do_unswitching`: TODO
  - `duplicate_loop_backedge`: TODO
  - `create_loop_nest`: TODO
  - `compute_profile_trip_cnt`: TODO
  - `do_unswitching`: TODO
  - `do_maximally_unroll`: TODO
  - `duplicate_loop_backedge`: TODO
  - `insert_pre_post_loops`: TODO
  - `do_range_check`: TODO
  - `insert_vector_post_loop`: TODO
  - `insert_vector_post_loop`: TODO
- `auto_vectorize`: Auto-vectorize loops (must already have been pre-main-post-ed, and unrolled).
- `mark_parse_predicate_nodes_useless`: Up to now, all optimizations with predicates should have been performed. Remove the predicates, and maybe some loop optimizations that do not need predicates are now unlocked.
- Note: `major_progress` gets set as soon as a loop optimization is performed that breaks the loop structure, and would require IGVN to be rerun to clean the graph, and `build_loop_tree` to recompute the loop structures.


[Continue with Part 5](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part05.html)

**Please leave a comment below**

To edit/delete a comment: click on the `date` above your comment, e.g. `just now` or `5 minutes ago`.
This takes you to the GitHub issue page associated with this blog post. Find your comment, and edit/delete it
by clicking the three dots `...` on the top right.

<script src="https://utteranc.es/client.js"
        repo="eme64/blog"
        issue-term="pathname"
        theme="github-light"
        crossorigin="anonymous"
        async>
</script>
