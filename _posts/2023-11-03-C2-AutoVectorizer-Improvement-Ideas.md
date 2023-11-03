---
title: "C2 AutoVectorizer Improvement Ideas"
date: 2023-11-03
---

**Motivation**

I want to quickly summarize my ideas for improving Hotspot JVM C2's autovectorization capabilities, and some that others have brought up to me.

Recently, I have gained quite a bit of experience with SuperWord, about which I have written previous posts.
I mostly worked on fixing bugs, but also added some improvements of my own.
In [JDK-8317424](https://bugs.openjdk.org/browse/JDK-8317424) I track the progress on SuperWord,
the current AutoVectorization algorithm in C2.

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

![image](https://github.com/eme64/blog/assets/32593061/c66a9614-e650-4206-8210-bfbf91eb0a5a)

The main-loop is strip-mined (cut main-loop into strips, only SafePoint after every strip).
Then, the main-loop is unrolled (depending on the array element types, such that we
hopefully can fill the vector registers). Now the main-loop hopefully has enough parallelism
for SuperWord to vectorize the loop. We then make a copy of this vectorized loop, and call
it the "vectorized drain loop". We further super-unroll the main-loop, so that the CPU
pipeline can be more saturated.
A general execution of the loop spends a few iterations in the pre-loop (e.g. 3x), to reach alignment,
then performs many iterations in the main-loop (e.g. 1000x with stride 64).
Since the stride in the main-loop is now quite large
(64, because 8x unroll/vectorized, and again 8x super-unrolled),
there are still many iterations left at afterwards (eg. 63).
We execute as many as possible in the "vectorized drain loop" (e.g. 7x with stride 8),
and the rest is executed by the post-loop (e.g. 7x).

There used to be a post-loop vectorizer, but it was badly broken and is currently being re-designed.
The idea is to use masked instructions to be able to execute all the post-loop iterations at once.

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
In some loops we also cannot eliminate the RangeChecks, for example because the indices
are not depending linearly on the induction variable. This may be because the index
is non-linear, or depends on a load. An example may be a gather-reduce loop.

4. Only have one attempt at vectorizing.
Sometimes, it would be beneficial to try different strategies for vectorization.
One would have to model the transformation. One would then filter out which ones succeed,
and chose the one that is most profitable.

5. *No cost-model*.
There are some local cost considerations in SuperWord.
But we require a const model that can compare different vectorization strategies,
and determine if any of them are better than not vectorizing.
This is especially relevant if there are any reductions
(the cost varies greatly on the type of reduction,
and especially depending on whether the reduction order matters),
shuffles (lane swaps, or reversal of order), packing or extracting.

6. *Aliasing Analysis* can be improved.
When we encounter two array references, we always have to assume that they could be the same array.
This causes there to be more memory dependencies which can prevent vectorization.

7. *Interpretability*: why did my loop not vectorize?
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

![image](https://github.com/eme64/blog/assets/32593061/5e9afaab-3fdc-453c-beb3-518e533074b9)

1. *Vectorize single-iteration loops*.
We should attempt to vectorize main-loops before unrolling.
We can do this by simply attempting to widen all instructions to multiple iterations.
If there is already SuperWord level parallelism in the single-iteration loop
(e.g. hand-unrolling, or rgba color computation, etc) then we can pack these
instructions already, and then further widen the packs to multiple iterations.
We can call this the *hybrid* approach (SLP + widening).
If vectorization fails at this point, or is not profitable, we can still unroll,
and retry vectorization after that.

2. *Introduce a cost-model*.
We must be able to tell if vectorization is profitable.
I propose that every IR node should be assigned with a cost,
and the cost of the loop is simply the sum of all node costs.
The cost model will most likely be platform dependent.

3. *Model vectorization in a VectorTransform IR*.
This would be the C2 equivalent to LLVM's VPlan.
Every vectorization strategy creates such a VectorTransform, which describes how the
current pre-vectorized C2 IR can be vectorized.
A VectorTransform must be able to estimate the cost of the vectorized code it would produce.
And it must be able to "apply" the vectorization, making all the required changes to the IR.
But before we apply a VectorTransform, the C2 IR must not be mutated at all.
This ensures that we can have multiple candidate VectorTransforms in parallel,
and only apply one, or none if the pre-vectorized IR is cheaper according to the cost-model.
A VectorTransform is represented by a graph, where the nodes correspond to post-vectorized
IR nodes.

4. *VectorTransform Creation*
I imagine there being these "on-ramps":
(a) Via SLP, if there is such parallelism in the single-iteration loop.
(b) Directly packing every single-iteration operation into its own node,
with the hope of being able to later widening all (or at least sufficiently many).
(c) Via SLP after unrolling, if the other methods have failed.

5. *VectorTransform Improvement*.
There would be multiple "steps" to complete and improve the candidate VectorTransforms.
Here some examples:
(a) Widen the nodes, if possible such that the vector registers can be filled.
(b) Add shuffle / pack / extract nodes between VectorTransform nodes that do not yet
match (e.g. the order of vector lanes is off, a node packs multiple instructions that
use the same value and we need to replicate that value now, or a node uses a single value
from an input and  we need to extract it now, etc.)
(c) If-Conversion: we may at first pack control flow, pretending that multiple Ifs can be
executed in parallel. At some point, this control flow has to either be flattened (CMove),
or turned into "if-all-true" and "if-all-false" checks. Additionally, we may have multiple
exits to the loop (e.g. search-loops). We need to ensure that we exit the loop before
undesired side-effects.
(d) Idealization: improve the graph similar to IGVN, by reshaping local parts of the graph.
We need to this as part of the vectorizer, since this may improve cost of the candidate
vectorization.

6. *VectorTransform Verification*.
If we allow the creation of incomplete VectorTransforms, then an improvement step may
or may not be able to "complete" it, and make it an executable VectorTransform.
We need to verify if all node inputs match, and if the packing and widening and
if conversion does not introduce circular dependencies.
We must also be able to check if all C2 IR nodes a VectorTransform would generate
if it were to be executed can are actually implemented.
This verification will allow us to simplify the creation and improvement steps,
and simply speculatively perform those steps, and then just verify if the step was legal.

**Proposal Roadmap**

1. *Refactor SuperWord*.
Move all the loop analysis part to a separate class.
This includes type analysis, dependency analysis and dependency graph creation etc.
We only want to perform this work once and then try out different vectorization
strategies based on the created data structures.

2. *Introduce VectorTransform to SuperWord*.
Once the packs are generated by SuperWord, we create a VectorTransform graph.
And the VectorTransform Graph is then verified, and "applied", i.e. generate
the new C2 nodes.

3. *Cost Model*.
The cost model evaluates the cost of a VectorTransform. This enables us to
decide if we should "apply" this VectorTransform, or another, or none at all
because not vectorizing is even cheaper.

4. *If-Conversion*.
This is the main goal of the Proposal, and I want to do it as soon as I can.
The previous steps are required for this to work.
If-Conversion can be developped over multiple steps:
(a) Handle loop-internal control-flow without side-effects and flatten it (CMove).
(b) Add "if-all-true/false" logic for branches that are highly predictable.
(c) Handle loop-internal control-flow with side-effects (masked loads/stores).
(d) Handle additional loop-exits (search-loops).

5. *Widen single-iteration loop*.
Directly vectorize single-iteration loops. With or without SLP.
This requires improving the dependency analysis,
since we now in essence unroll and pack at the same time.
This will allow us to vectorize loops with larger bodies,
and avoid some unrolling overheads.

6. *Apply single-iteration vectorizer to pre and post loop*.
Using masked instructions.
This could be an alternative to having a dedicated post-loop vectorizer.

7. *VectorTransform improvements*.
Adding shuffle / pack / unpack instructions.
Possibly some Idealizations on the VectorTransform Graph.

**Additional Proposals**

Here are some other ideas which are related to this proposal:

1. *Post-loop vectorization with masked vector instructions*.
This is limited to platforms that implement these vector instructions.
But when available this can improve the performance, especially if there are many iterations left.

2. *Type issues for byte/short operations because of Shifts*.
Some loops do not vectorize because the *velt* cannot be rightly determined.

3. *Improving Reductions*.
(a) I already moved reductions outside the loop (for reductions where the reduction order does not matter),
and converted the scalar phis into vector phis. Vladimir Ivanov proposed that one should
have multiple vector phis when super-unrolling: this removes some dependencies and lowers the latency.
(b) We should try to handle more complicated reductions (not just add/mul).
One such example is a "polynomial reduction" (e.g. `result = 31 * result + a[i]`)

4. *Aliasing Analysis*.
We should improve the aliasing analysis. We should detect if two array references can be proven to be
different, and move them to separate slices, or in some other way separate them and avoid unnecessary
memory dependencies that can prevent vectorization.
In some cases we can also do this speculatively, and either have a trap that leads to
decompilation or a "slow" loop.

5. "Parallel Streams".
We could try to use parallel streams, where we know that iterations are guaranteed not to have dependencies.
However, we need a way to separate them from sequential streams where the order of iterations matters.
We might want to annotate a loop as "parallel".

6. *Strided and Gather/Scatter Memory Access*.
There are currently some alignment assumptions in the SuperWord code that need to be
changed to allow for strided access, otherwise those nodes are not packed.
Gather / Scatter operations are more tricky because their RangeChecks can presumably not be
eliminated (i.e. moved out of the loop). Hence we require if-conversion, unless we are
using Unsafe operations which do not have RangeChecks.

**General Principles**

These are some general principles that I would like to work towards:

1. *Modularity*.
I want clear separation between different parts of vectorization.
The current SuperWord algorithm is quite convoluted, though I have already tried to improve this.
We should have different "phases" or "steps".
First loop-analysis (loop membership, types, dependencies, etc).
Create packs with SLP (substeps: find adjacent memrefs, extend, cobine, etc).
Then create a VectorTransform "draft" (incomplete).
Widen the graph to additional iterations.
Complete the VectorTransform (shuffle, pack, extract, etc).
If-Conversion (multiple options).
Verify the VectorTransform (cyclic dependencies, implementability, completeness).
Evaluate cost.
And only in the very end, and optionally: "apply".
The advantage of modularity is that it is clearer what each step is supposed to do.
The algorithm becomes more testable, maintainable and extendable.

2. *Composability*.
Some optimizations are only profitable in combination.
Hence, I want to have a series of composable "steps".

3. *Transactional*.
There should be no side-effect until we "apply" the VectorTransform.

4. *Correctness*.
This seems obvious. But we need to invest in testing.
Any "step" that is optional, or any heuristic should be stress-testable,
i.e. we should be able to randomize if we do the optimization, and the result
should be identical (apart from performance).

5. *Profitability*.
We need a cost-model that predicts which of the candidate is to be "applied".
Performance should also be predictable / corrleate strongly with the cost-model.
We can do this by predicting relative runtime with the cost-model,
and measuring the real runtime with benchmark, and then correct the cost-model.

6. *Powerful*.
We want to vectorize more code.
More code patterns, larger methods, etc.
Still, we need to be careful not to have an explosion in complexity in the compiler.
Not every optimization is worth it.

7. *Interpretability*.
We need to improve logging.
The logs should be reasonably interpretable by a non-expert with at least basic
understanding of vectorization. There should be different levels of detail,
and possibly different sub-domains.

8. *Testing*.
We need to be careful to have enough test coverage.
We should probably invest in a fuzzer that targets loops,
and vectorizable code, and code that is almost vectorizable (but not really).
We must make sure to write IR tests, but also verify the output.

**Conclusion**

I wanted to post about this so that others are aware of my plans.
These plans are still under development, and I do not guarantee that all or any of it will be realized.
I'm open for feeback and additional ideas.
If you are looking to contribute or collaborate, then feel free to contact me.
