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

**Current SuperWord Implementation: Overview**

A single-iteration loop is first Pre-Main-Post'ed (in same cases Peel-Main-Post).
The main-loop is supposed to perform the bulk of the work,
whereas the pre-loop is only used to allow memory accesses in the main-loop to be aligned,
and the post-loop executes the remaining iterations.

The main-loop is strip-mined (cut main-loop into strips, only SafePoint after every strip).
Then, the main-loop is unrolled (depending on the array element types, such that we
hopefully can fill the vector registers). Now the main-loop hopefully has enough parallelism
for SuperWord to vectorize the loop. We then make a copy of this vectorized loop, and call
it the "vectorized drain loop". We further super-unroll the main-loop, so that the CPU
pipeline can be more saturated.
A general execution of the loop spends a few iterations in the pre-loop, to reach alignment,
then performs many iterations in the main-loop. Since the stride in the main-loop is now quite
large, there are still many iterations left at afterwards. We execute as many as possible in
the "vectorized drain loop", and the rest is executed by the post-loop.

There used to be a post-loop vectorizer, but it was badly broken and is currently being re-designed.
The idea is to use masked instructions to be able to execute all the post-loop iterations at once.

![image](https://github.com/eme64/blog/assets/32593061/c66a9614-e650-4206-8210-bfbf91eb0a5a)


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

I was inspired by LLVM's VPlan project.
I like the idea of analyzing a loop, and creating multiple vectorization "plans", and then chosing the best one
with a cost model.
These "plans" can also be created iteratively: one starts some first versions, and then
iteratively improves them. Or maybe first creating an incomplete "draft plan", and then
attempting to complete and improve it over multiple steps
(e.g. adding pack/extract/shuffle nodes, if-conversion, etc).

TODO decription

![image](https://github.com/eme64/blog/assets/32593061/5e9afaab-3fdc-453c-beb3-518e533074b9)


**Additional Proposals**
TODO

Improved reductions:

Vladimir Ivanov: multiple vector phis for reduction.

result = 31 * result + a[i]; // "hash code" / polynomial reduction


Issues with byte / short and Shift operations -> often prevents packing.

