---
title: "Vectorizing Reductions: from JDK9 to JDK26 and beyond"
date: 2026-01-13
---

There are a lot of examples for reductions: computing the `sum`, `product` or `min` over some list of numbers,
the [dot product](https://en.wikipedia.org/wiki/Dot_product) (sum of element-wise products),
or even the [polynomial hash over a string](https://lemire.me/blog/2015/10/22/faster-hashing-without-effort/).

I have heard that the term "reduction" comes from "dimensionality reduction", of crunching down a higher-dimensional
collection of numbers to a lower-dimensional one. We may for example reduce a 2-dimensional matrix to a 1-dimensional
vector. In this post here, we are interested in reducing 1-dimensional collections (list, vector, array) to
a 0-dimensional scalar.

**Examples**

We may want to take the sum of the elements in an array:
```java
for (int i = 0; i < a.length; i++) {
    sum += a[i];
}
```

Similarly, we can compute the dot-product of two arrays:
```java
for (int i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
}
```

**Parallel Reductions**

Computing such a reduction looks like a very sequential task: we can only compute the next addition if all the previous
additions are complete. We get this very long sequential chain of reduction operations, and this chain completely
determines the latency of our computation.
However, one can compute some reductions in parallel.

If we have `N` threads, we can chop our array into `N` chunks, and each thread computes the sum over its chunk.
Now, we only need to sum up the `N` partial sums to get the total sum.
This can speed up our computation by a factor of up to `N`, since the partial sums from the chunks can be computed in parallel,
and we only have some (hopefully negligible) coordination effort at the beginning (chunking) and end (reduce partial sums to total sum).
Here [some examples using Java Parallel Streams](https://medium.com/@AlexanderObregon/javas-doublestream-parallel-method-explained-8884ecaf25b1)
that do some interesting numerical work.

However, there is a necessary condition for parallelizing reductions: **the reduction operator must be associative**, and as we will see
it also needs to be commutative for some optimizations. At least if we want to get the exact same results if we compute sequentially
or in parallel. As a reminder:

- Associative: `(x + y) + z = x + (y + z)`
- Commutative: `x + y = y + x`

Or simply put: we must be able to re-order the reduction. In our example with `N=2` threads, we have done the following transformation:

- Sequential: `((x0 + x1) + x2) + x3`
- Parallel: `(x0 + x1) + (x2 + x3)`

There are a lot of operators that satisfy these properties, for example: integer addition/multiplication, min/max, logical and/or/xor.
However, there are some that do not, for example: floating-point addition and multiplication. The reason is the rounding error:

- `a = 1e30f`, `b = -1e30f` and `c = 1e-30f`
- `a + b + c = 1e-30f`: `a + b = 0` without any rounding. `0 + c = 1e-30f` without any rounding.
- `a + c + b = 0`: `a + c` gets rounded back to `a` because `c` is too small relative to `a`.

That does not stop someone from _pretending_ that the operation is associative and commutative: one can gain speedups but at the price of different rounding errors.
The C2 auto vectorizer must adhere to the Java specification, which does not
allow for such "fast math" tricks, the result of floating point addition and multiplication
must always have the same rounding result.
However, there are some Java library methods that allow reordering
([DoubleStream.sum](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/DoubleStream.html#sum())).
And some compilers have special flags to enable these "fast math" tricks
([clang -ffast-math](https://clang.llvm.org/docs/UsersManual.html#cmdoption-ffast-math)).

**Vectorizing Reductions**

While we can get speedups for reductions using multiple threads, we can also use our CPU's SIMD vector registers,
which allows for parallelism within a single thread.

Let's look at the sum over an array of ints. Below, I show the
C2 intermediate representation of the loop. We initialize our `sum` variable with a `0`, and in each iteration,
we add a new value `v` (the i'th array element) to our `sum`.
But this is a completely sequential implementation of our sum, and the execution time would be dominated
by the latency of the sequential reduction chain.
In an attempt to optimize, we could unroll the loop (e.g. by a factor of 4):

<img width="700" alt="image" src="https://github.com/user-attachments/assets/d18da4c6-eebb-4d2c-8172-19d19f765ed5" />

However, so far we still have a sequential reduction chain.
We can probably vectorize the values `[v0, v1, v2, v3]`, since they can be computed in parallel (element-wise).
For example, they may be four adjacent loads that can be packed into a single
vectorized load.
But what can we do about the additions of the reduction?
They are decidedly not parallel, and clearly their operations would cross lanes!

A naive implementation would be to load our `v` values with a vector load operation `LoadV`,
and then sequentially extract every element from the vector, and add up the values in sequential order.
This has one benefit: we have not had to reorder the reduction, and so this approach can be used for any
operator (including floating-point addition and multiplication). But the downsides are quite severe:
rather than decreasing the number of instructions, we have increased them (`n` additions vs `n` additions and `n` extracts).
And we still have the same issue with the latency of the sequential reduction.

<img width="700" alt="image" src="https://github.com/user-attachments/assets/561b62c4-6146-40f9-b738-e45dc2739704" />

A more performant approach is the recursive folding reduction: we load our values into a single vector register,
and then split into two halves and add the two halves element-wise. This gives us a new register with
only half the number of elements. We repeat the split-and-element-wise-add approach, reducing the number
of elements in every step, until we have a single element left.
This allows us to reduce the `n`-element vector to its partial sum in `log(n)` steps.
Our scalar loop variable `sum` now only needs a single addition for each partial sum.
This helps us with our latency problem: we now only have `1/n`'th as many addition operations
on the critical latency path of the `sum` variable.

In JDK9, reductions were first auto vectorized ([JDK-8074981](https://bugs.openjdk.org/browse/JDK-8074981)).
For the operations that permit it, the recursive folding was used. For the other operations
(float/double add/mul) we use the sequential reduction, where all elements have to be extracted
from the vector. But once the patch was integrated, it was discovered that there were some
speedups, but sadly also some performance regressions:

<img width="700" alt="image" src="https://github.com/user-attachments/assets/4c55c095-c61a-46ee-9857-6b89a4071d50" />

In the plot above, we can see the performance numbers for `add` and `mul` reductions on `int`, `long`, `float` and `double` arrays.
Any performance below `1` indicates a speedup for vectorization, and performance above `1` indicates a slowdown
(scalar would have been faster).
Still in JDK9, it was therefore determined that "simple" reductions and 2-element vector reductions are not all profitable,
and their vectorization was disabled ([JDK-8078563](https://bugs.openjdk.org/browse/JDK-8078563)).
Any further analysis was postponed at this time, and not taken up for a long time.
Only "non-simple" reductions were now vectorized, these are reductions that do more than just load
and accumulate: for example compute a dot-product (2 loads, 1 mul, and accumulation).
For "simple" reductions, the expensive reduction operation dominates the runtime, the vectorized
code can have more instructions than the scalar code. But with "non-simple" reductions, the
additional operations are also vectorized, which can outweigh the cost of the expensive
reduction operation.

**Further Optimizing Reduction Vectorization**

In JDK21, I was able to optimize some vectorized reductions, by moving the expensive cross-lane
reduction after the loop, and using lane-wise vector accumulators inside the loop
([JDK-8302652](https://github.com/openjdk/jdk/pull/13056)).
The idea is to use a vector-accumulator instead of a scalar `sum` variable.
We accumulate partial sums in the elements, and only after the loop do we reduce the partial
sums of the elements down to the total sum.
This means that the expensive cross-lane reduction operation can be moved outside the loop
and is only executed once, and inside the loop we can simply use element-wise operations.

Below, we see how this works on an add-reduction. The left illustrates the vectorized reduction
with the `AddReductionV` (reduction across lanes using recursive folding) inside the loop.
The `AddReductionV` is implemented with many assembly instructions which makes it expensive/slow.

The right illustrates the optimized vectorized reduction. Instead of a scalar `sum` variable,
we have a vectorized `accV` register that holds the partial sums. We initialize the vector
to all zeros, and element-wise add (`AddV`) the vector `v` of new values to our `accV`.
Once the loop has completed, the `accV` needs to be reduced down to a single value
using `AddReductionV` only once. This makes the execution of the loop much faster,
because instead of executing many instructions per iteration for a `AddReductionV`,
we only have a single assembly instruction for `AddV`.

<img width="700" alt="image" src="https://github.com/user-attachments/assets/07ff9d0a-d36e-42aa-9e14-f71d93c6db32" />

**JDK26: Finally Vectorizing Simple Reductions**

With JDK26, C2 is finally auto vectorizing simple reductions by default, using a cost-model that ensures we only
vectorize reductions when it is profitable ([JDK-8340093](https://github.com/openjdk/jdk/pull/27803)).
The cost-model adds up the cost of every IR node inside the loop. In the cases where we were able
to move the `AddReductionV` outside the loop, we do not have to count its cost (it would be high!),
and instead only count the cost of the much cheaper `AddV`.

As a consequence, we can now expect really good performance for reductions with primitive types
`int`, `long`, `float` and `double`, and the operators `min`, `max`, `and`, `or` and `xor`.
And for `add` and `mul` we get good fast performance for `int` and `long`.
But for `float` and `double` we cannot make `add` and `mul` faster than the scalar performance,
because we cannot reorder the reduction due to rounding issues.
There is still a small caveat: the input values to the reduction must also be auto vectorizable.

Below, I measured the performance of `int` addition reductions, for different JDK versions.
We can see that with the introduction of reduction vectorization in JDK9 we get speedups
for non-simple reductions (i.e. `dotProduct` and `big`). And then in JDK21 we could further speed up
those non-simple reductions by moving the reduction out of the loop and using a vector accumulator
instead. And finally in JDK26 we also get fast simple reductions. The results below are measured
on my `AVX512` laptop, with `2048` elements in the array.

<img width="700" alt="image" src="https://github.com/user-attachments/assets/696e9134-eddf-48ef-8953-991fb1e4f42c" />

**Beyond JDK26: more Reductions and on to Scans**

Getting simple reductions to be auto vectorized was a priority.
But there is more work to do.
We could vectorize more reduction operators (e.g. unsigned multiplication, saturated add/mul).
Also polynomial reductions such as `hashCode` could be auto vectorized, possibly removing the need for intrinsics ([JDK-8345107](https://bugs.openjdk.org/browse/JDK-8345107)).

A related operation is the `scan`, with the example of a `prefix-sum`.
Where a reduction computes only the final accumulation of all values, the scan computes also all intermediate results along the way.
There are plans to extend both the Vector API ([JDK-8339348](https://bugs.openjdk.org/browse/JDK-8339348))
and the auto vectorizer ([JDK-8345549](https://bugs.openjdk.org/browse/JDK-8345549)) with scans.
Even further beyond: segmented scans.

**Vectorized Reductions in the Vector API**

Since JDK16, the Vector API is available in incubator state.
The [reduceLanes](https://download.java.net/java/early_access/jdk26/docs/api/jdk.incubator.vector/jdk/incubator/vector/IntVector.html#reduceLanes(jdk.incubator.vector.VectorOperators.Associative))
operation allows us to reduce a vector to a scalar.
For most operations, the recursive folding approach is used, even for floating-point reductions
(see [reduceLanes](https://download.java.net/java/early_access/jdk26/docs/api/jdk.incubator.vector/jdk/incubator/vector/IntVector.html#reduceLanes(jdk.incubator.vector.VectorOperators.Associative))).
The implication for `float` and `double` reductions for `add` and `mul` is that the order of reduction
is explicitly not specified, and the result may be computed with a different order each time,
delivering different rounding results for different invocations.
For example, if executed with the interpreter, the reduction order may be sequential, but when compiled
the order could be a recursive folding order.

Below, I have 3 implementations of a dot product.
The inputs are random, so the outputs are random as well.
`test1` is implemented in regular scalar Java, with normal array accesses.
The auto vectorizer cannot change the order of operations, because the rounding results must always adhere to the Java spec.
`test2` and `test3` are implemented with the Vector API, using `reduceLanes` that allows recursive folding.
Thus, the rounding results can be different in different invocations.

```java
import java.util.Random;
import jdk.incubator.vector.*;

public class Test {
    public static Random RANDOM = new Random();
    private static final VectorSpecies<Float> SPECIES = FloatVector.SPECIES_PREFERRED;

    public static void main(String[] args) {
        float[] a = new float[1024];
        float[] b = new float[1024];
        for (int i = 0; i < 1024; i++) {
            a[i] = RANDOM.nextFloat();
            b[i] = RANDOM.nextFloat();
        }
        // A first invocation of every implementation, should execute in interpreter.
        float gold1 = test1(a, b);
        float gold2 = test2(a, b);
        float gold3 = test3(a, b);
        // Repeat many times so compilation kicks in.
        for (int i = 0; i < 10_000; i++) {
            test1(a, b);
            test2(a, b);
            test3(a, b);
        }
        // A last invocation, hopefully done in compiled code.
        float result1 = test1(a, b);
        float result2 = test2(a, b);
        float result3 = test3(a, b);
        System.out.println("test1: " + gold1 + " vs " + result1 + ", diff: " + (gold1 - result1));
        System.out.println("test2: " + gold2 + " vs " + result2 + ", diff: " + (gold2 - result2));
        System.out.println("test3: " + gold3 + " vs " + result3 + ", diff: " + (gold3 - result3));
    }

    // Scalar implementation. Reordering of reduction not permitted by Java spec.
    public static float test1(float[] a, float[] b) {
        float sum = 0;
        for (int i = 0; i < a.length; i++) {
            sum += a[i] * b[i];
        }
        return sum;
    }

    // Vector API implementation, reduceLanes inside loop.
    public static float test2(float[] a, float[] b) {
        float sum = 0;
        for (int i = 0; i < SPECIES.loopBound(a.length); i += SPECIES.length()) {
            var va = FloatVector.fromArray(SPECIES, a, i);
            var vb = FloatVector.fromArray(SPECIES, b, i);
            sum += va.mul(vb).reduceLanes(VectorOperators.ADD);
        }
        return sum;
    }

    // Vector API implementation, reduceLanes after loop.
    public static float test3(float[] a, float[] b) {
        var sums = FloatVector.broadcast(SPECIES, 0.0f);
        for (int i = 0; i < SPECIES.loopBound(a.length); i += SPECIES.length()) {
            var va = FloatVector.fromArray(SPECIES, a, i);
            var vb = FloatVector.fromArray(SPECIES, b, i);
            sums = sums.add(va.mul(vb));
        }
        return sums.reduceLanes(VectorOperators.ADD);
    }
}
```

As I said above: the results are different every time. But `test1` always has the same result
for both invocations.
`test2` and `test3` can have slight differences due to reordering inside `reduceLanes`, allowed by its spec.
```
java Test.java
test1: 252.9073 vs 252.9073, diff: 0.0
test2: 252.90741 vs 252.9074, diff: 1.5258789E-5
test3: 252.90736 vs 252.90738, diff: -1.5258789E-5
```

In the code above, you might be wondering: "what if the array size is not a multiple of the vector length"?
You would have to add a "scalar tail-loop", see the `dotProductF` example in [JDK-8373026](https://github.com/openjdk/jdk/pull/28639).
I ran those benchmarks on my AVX512 machine, with an array with `2048` elements.
We see a very similar speedup as with the `int` addition auto vectorization results from above.
The `Java loop = test1` is very slow because the JIT compiler is not allowed
to reorder the operations of the reduction and must maintain the semantics of
the program with respect to the floating-point rounding.
The Vector API explicitly allows the reordering of the reduction operations,
and this relaxation in the semantics allows for faster performance.
The `v1 = test2` implementation keeps the `reduceLane` operation in the loop.
If we move it out of the loop, we get even better performance, see `v2 = test3`:

<img width="700" alt="image" src="https://github.com/user-attachments/assets/e0232842-0ef7-403d-b039-160521253824" />

**Links**

In JDK9, reductions were first auto vectorized ([JDK-8074981](https://bugs.openjdk.org/browse/JDK-8074981)).
But immediately, some performance regressions were discovered, and so auto vectorization for simple reductions
and 2-element-vector reductions were disabled ([JDK-8078563](https://bugs.openjdk.org/browse/JDK-8078563)).

In JDK21, I was able to optimize some vectorized reductions, by moving the expensive cross-lane
reduction after the loop, and using lane-wise vector accumulators inside the loop
([JDK-8302652](https://github.com/openjdk/jdk/pull/13056)).

With JDK26, C2 is finally vectorizing simple reductions by default, using a cost-model that ensures we only
vectorize reductions when it is profitable ([JDK-8340093](https://github.com/openjdk/jdk/pull/27803)).

YouTube video that covers the same material as this blog post:
[Section on Reductions in JVMLS 2025 Talk](https://www.youtube.com/watch?v=UVsevEdYSwI&t=710s)

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
