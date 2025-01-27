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
- Overview over `PhaseIdealLoop` / loop optimizations.

[Skip forward to Part 5](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part05.html)

**Introduction to Loop Optimizations**

In [Part 3](https://eme64.github.io/blog/2025/01/23/Intro-to-C2-Part03.html), I already presented a similar overview.

`PhaseLoopOpts` analyses the loop structures and reshapes them. We do this work in multiple loop opts phases, iteratively we analyze the loops and transform them, then let them be cleaned up by IGVN, and then attempt another loop opts phase.

Here some example optimizations:
- Detection of loops, canonicalization to `CountedLoop` (loop trip-count phi does not overflow).
- Turning long-counted-loops into int counted-loops, and long RangeChecks into int RangeChecks if possible.
- Remove empty loops.
- Peeling: make a single-iteration copy of the loop, which is executed as straight-line code before the loop. That allows for some invariant checks to only be executed in the peeled iteration, and removed from the loop body.
- Loop predication: move some checks (e.g. null-checks, RangeChecks) before the loop.
- Unswitching: move a loop-invariant check before the loop, copy the loop: one with the true-path, one with the false-path only.
- Pre-Main-Post-loop:
  - Unrolling of main-loop.
  - Pre-loop used for alignment (on architectures where strict alignment for vectorization is required).
  - Post-loop used to handle left-over iterations.
  - RangeCheck elimination: main-loop handles iterations where the RangeCheck is known to pass, pre and post loop handle the iterations before and after.
- Auto vectorization (main-loop).

**Example**

Let us look at the example from [Part 3](https://eme64.github.io/blog/2025/01/23/Intro-to-C2-Part03.html), and enable loop opts tracing.

```java
public class Test {
    public static void main(String[] args) {
        // Especially with a debug build, the JVM startup can take a while,
        // so it can take a while until our code is executed.
        System.out.println("Run");

        // Repeatedly call the test method, so that it can become hot and
        // get JIT compiled.
        int[] array = new int[10_000];
        for (int i = 0; i < 10_000; i++) {
            test(array);
        }
        System.out.println("Done");
    }
    
    public static void test(int[] array) {
        // Add 42 to every element in the array: load, add, store
        for (int i = 0; i < array.length; i++) {
            array[i] += 42;
        }
    }
}
```

We run it with `-XX:+TraceLoopOpts`:

```
java -XX:CompileCommand=printcompilation,Test::* -XX:CompileCommand=compileonly,Test::test -Xbatch -XX:-UseOnStackReplacement -XX:+TraceLoopOpts Test.java

Run
5101   85    b  3       Test::test (23 bytes)
5137   86    b  4       Test::test (23 bytes)
Counted          Loop: N180/N156  counted [0,int),+1 (-1 iters) 
Loop: N0/N0  has_sfpt
  Loop: N179/N178  limit_check profile_predicated predicated
    Loop: N180/N156  limit_check profile_predicated predicated counted [0,int),+1 (-1 iters)  has_sfpt strip_mined
Predicate RC     Loop: N180/N156  limit_check profile_predicated predicated counted [0,int),+1 (9998 iters)  has_sfpt rce strip_mined
Loop: N0/N0  has_sfpt
  Loop: N179/N178  limit_check profile_predicated predicated sfpts={ 181 }
    Loop: N180/N156  limit_check profile_predicated predicated counted [0,int),+1 (9998 iters)  has_sfpt strip_mined
PreMainPost      Loop: N180/N156  limit_check profile_predicated predicated counted [0,int),+1 (9998 iters)  has_sfpt strip_mined
Unroll 2         Loop: N180/N156  limit_check counted [int,int),+1 (9998 iters)  main has_sfpt strip_mined
Loop: N0/N0  has_sfpt
  Loop: N290/N295  limit_check profile_predicated predicated counted [0,int),+1 (4 iters)  pre
  Loop: N179/N178  limit_check sfpts={ 181 }
    Loop: N386/N156  limit_check counted [int,int),+2 (9998 iters)  main has_sfpt strip_mined
  Loop: N241/N246  limit_check counted [int,int),+1 (4 iters)  post
Unroll 4         Loop: N386/N156  limit_check counted [int,int),+2 (9998 iters)  main has_sfpt strip_mined
...
Unroll 8         Loop: N457/N156  limit_check counted [int,int),+4 (9998 iters)  main has_sfpt strip_mined
...
Unroll 16         Loop: N551/N156  limit_check counted [int,int),+8 (9998 iters)  main has_sfpt strip_mined
...
PredicatesOff
Loop: N0/N0  has_sfpt
  Loop: N290/N295  counted [0,int),+1 (4 iters)  pre
  Loop: N179/N178  limit_check sfpts={ 181 }
    Loop: N672/N156  limit_check counted [int,int),+16 (9998 iters)  main has_sfpt strip_mined
  Loop: N241/N246  limit_check counted [int,int),+1 (4 iters)  post

VTransform::apply:
    Loop: N672/N156  limit_check counted [int,int),+16 (9998 iters)  main has_sfpt strip_mined
 672  CountedLoop  === 672 179 156  [[ 623 626 629 632 635 638 642 645 672 521 675 684 524 528 531 447 444 143 380 175 ]] inner stride: 16 main of N672 strip mined !orig=[551],[457],[386],[180],[171],[91] !jvms: Test::test @ bci:8 (line 21)
Loop: N0/N0  has_sfpt
  Loop: N290/N295  predicated counted [0,int),+1 (4 iters)  pre
  Loop: N179/N178  limit_check sfpts={ 181 }
    Loop: N672/N156  limit_check counted [int,int),+16 (9998 iters)  main vector has_sfpt strip_mined
  Loop: N241/N246  limit_check counted [int,int),+1 (4 iters)  post
PostVector      Loop: N672/N156  limit_check counted [int,int),+16 (9998 iters)  main vector has_sfpt strip_mined
Unroll 32         Loop: N672/N156  limit_check counted [int,int),+16 (9998 iters)  main vector has_sfpt strip_mined
Loop: N0/N0  has_sfpt
  Loop: N290/N295  predicated counted [0,int),+1 (4 iters)  pre
  Loop: N179/N178  limit_check sfpts={ 181 }
    Loop: N832/N156  limit_check counted [int,int),+32 (9998 iters)  main vector has_sfpt strip_mined
  Loop: N786/N788  counted [int,int),+16 (16 iters)  post vector
  Loop: N241/N246  limit_check counted [int,int),+1 (4 iters)  post
Unroll 64         Loop: N832/N156  limit_check counted [int,int),+32 (9998 iters)  main vector has_sfpt strip_mined
...
Unroll 128         Loop: N898/N156  limit_check counted [int,int),+64 (9998 iters)  main vector has_sfpt strip_mined
Loop: N0/N0  has_sfpt
  Loop: N290/N295  predicated counted [0,int),+1 (4 iters)  pre
  Loop: N179/N178  limit_check sfpts={ 181 }
    Loop: N986/N156  limit_check counted [int,int),+128 (9998 iters)  main vector has_sfpt strip_mined
  Loop: N786/N788  counted [int,int),+16 (16 iters)  post vector
  Loop: N241/N246  limit_check counted [int,int),+1 (4 iters)  post
Done
```

Let us make a few observations about the logs above:
- `Counted          Loop: N180/N156  counted [0,int),+1 (-1 iters)`
  - We detect the loop as a counted loop. That is the prerequisite for many other loop optimizations. We see that it iterates over the range `[0,int)`, i.e. that it starts at zero up to some limit.
- `Predicate RC     Loop: N180/N156  limit_check profile_predicated predicated counted [0,int),+1 (9998 iters)  has_sfpt rce strip_mined`
  - RangeCheck elimination using predicates before the loop.
- `PreMainPost`: generation of pre, main and post loops. The pre loop prepares for the main loop, the post loop cleans up any remaining iterations. This has at least 2 purposes: the pre-loop can align vector memory accesses for the main loop, by changing the number of iterations spent in the pre-loop. And in some cases RangeCheck elimination requires us to spend all iterations where the RangeCheck cannot be eliminated in the pre and post loop, ensuring that we do not need to execute RangeChecks in the main loop.
- `Unroll 2` ... `Unroll 16`: we unroll the loop by doubling the number of iterations. Here, we pick an unrolling factor of 16 because I have an AVX512 machine that can fit 16 ints into a 64 byte vector register. On your machine this may differ, try it out!
- `VTransform::apply`: this is a note from the auto-vectorizer, showing that we are applying the `VTransform`, i.e. we are replacing scalar operations with vector operations.
- `Loop: N672/N156  limit_check counted [int,int),+16 (9998 iters)  main vector has_sfpt strip_mined`
  - We see that the main loop is now annotated with `vector`, since it has been vectorized.
- `PostVector`: we introduce a copy of the main loop, as the vectorized drain loop, that is useful when we later super-unroll the main loop.
- `Unroll 32`...`Unroll 128`: we further unroll the vectorized main loop, to saturate the CPU pipeline with more vector instructions.
- `Loop: N986/N156  limit_check counted [int,int),+128 (9998 iters)  main vector has_sfpt strip_mined`
  - The main loop now performs `16 * 8 = 128` iterations in one iteration.
- ` Loop: N786/N788  counted [int,int),+16 (16 iters)  post vector`
  - The drain loop performs `16` iterations in an iteration.

**More Details about Loop Optimizations**

At first, we only execute 3 rounds of loop optimizations.
Then we perform CCP + IGVN because the first loop optimizations such as peeling and unrolling can often
allow us to narrow down types or constant fold control flow inside the loop.
Then, we perform many more iterations of loop optimizations, until no loop can further be optimized or we hit
a loop optimization round limit.

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
