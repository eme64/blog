---
title: "C2 AutoVectorizer Improvement Ideas"
date: 2023-11-03
---

**Motivation**

I want to quickly summarize my ideas for improving C2's autovectorization capabilities, and some that others have brought up to me.

Recently, I have gained quite a bit of experience with SuperWord, about which I have written previous posts.
I mostly worked on fixing bugs, but also added some improvements of my own.

**AutoVectorization: Background**

From what I know, there are different types of vectorizers:

- Innermost loop vectorization: take a single-iteration loop (not unrolled), and widen all scalar operations to cover multiple iterations.
- Outer-loop vectorization: take for example 8 iterations of the outer loop, which gives you 8 full executions of the inner loop. Co-iterate over those 8 executions in a vectorized way.
- SuperWord Level Parallelism: Find parallel code shapes that can be packed into vector instructions. This can be used for any segment (eg basic blocks) of code that has enough parallelism, not just loops.

**Considerations for the JVM**

In C2 (Hotspot JVM) we apply the SuperWord algorithm to an unrolled loop body, though only if there is no control flow in the loop.
If there is parallelism between the loop iterations, then unrolling brings this into a basic block, and SuperWord can vectorize that basic block.

In the JVM, we must ensure to "SafePoint" frequently, so that the execution of the compiled code can be interrupted.
There are multiple reasons for such interruptions, but one is the GC, or if we need to jump back to the interpreter for some reason.
At such a SafePoint, we must be at an exact bytecode, and the state must be consistent.
After all, we might have to go back to the interpreter at that point.

This makes things like loop fusion and outer-loop vectorization difficult.
We could only have a SafePoint before of after fused loops, and not during
(otherwise we may have all loops half-executed, and this does not leave us at any specific bytecode).
Hence, one would have to guarantee that the inner loops are short enough, such that the latency does not get too high.

Frequent SafePointing is also the reason for "Strip-Mining" the loops: we cut a loop into multiple strips of a limited
number of iterations. Between each such strip, we place a SafePoint. This ensures that the latency is low enough, while
still having long enough strips without SafePoints, such that we can freely rearrange operations for vectorization.

As said above, we currently only apply SuperWord to the basic block of a control-free innermost loop.
SuperWord could in principle be used on any basic block (or in an extended way to multiple blocks).
But for a JIT, this would create a higher compile-time cost, and only benefit very few cases in runtime.
Hence, we focus on loops, which are generally the hottest spots in the code.

**Current SuperWord Implementation: the Limitations**

1. Always first *Unrolled* before even attempt to vectorize.
This creates overhead (more nodes), and limits vectorization to small loops (node limit for unrolling).
What is missing is a loop-vectorizer that directly widens the scalar operations of a single-iteration loop.
Only if that fails should we unroll.

2. *No If-Conversion*.
We only allow control-free loops to be vectorized.
In some cases, control-flow can already be flattened before vectorization with CMove.
But usually flattening control flow is only profitable if one also vectorizes.
In C2, we have a number of intrinsics for "search-loops", which essentially search over an array,
and exit as soon as they find a specific value. It is very likely that the hand-crafted vectorization
in the intrinsics would be obsoleted if the auto-vectorizer could handle additional exit conditions
(other than the limit check).

3. Only have one attempt at vectorizing.
Sometimes, it would be beneficial to try different strategies for vectorization.
One would have to model the transformation. One would then filter out which ones succeed,
and chose the one that is most profitable.

4. *No cost-model*.
There are some local cost considerations in SuperWord.
But we require a const model that can compare different vectorization strategies,
and determine if any of them are better than not vectorizing.
This is especially relevant if there are any reductions
(the cost varies greatly on the type of reduction,
and especially depending on whether the reduction order matters),
shuffles (lane swaps, or reversal of order), packing or extracting.

5. *Aliasing Analysis* can be improved.
When we encounter two array references, we always have to assume that they could be the same array.
This causes there to be more memory dependencies which can prevent vectorization.

6. *Interpretability*: why did my loop not vectorize?
There are multiple compile flags (TraceSuperWord, TraceNewVectors, Verbose, VectorizeDebugOption, TraceLoopOptimizations)
which give information at very different levels of detail.
It basically requires an expert in SuperWord to understand why vectorization was prevented.
It would be very nice if an end-user with only a general understanding of vectorization could
have a way to query C2 to see what prevented vectorization.

**My Proposal: the Main Project**
TODO

**Additional Proposals**
TODO
