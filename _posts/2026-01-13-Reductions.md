---
title: "Vectorizing Reductions: from JDK9 to JDK26 and beyond"
date: 2026-01-13
---

There are a lot of examples for reductions: computing the `sum`, `product` or `min` over some list of numbers,
the [dot product](https://en.wikipedia.org/wiki/Dot_product) (sum of element-wise products),
or even the [polynomial hash over a string](https://lemire.me/blog/2015/10/22/faster-hashing-without-effort/).

I have heard that the term "reduction" comes from "dimensionality reduction", of crunching down a higher-dimensianal
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
However, there are some that do not, for example: floating-point addition and multiplication. The reasond is the rounding error:

- `a = 1e30f`, `b = -1e30f` and `c = 1e-30f`
- `a + b + c = 1e-30f`: `a + b = 0` without any rounding. `0 + c = 1e-30f` without any rounding.
- `a + c + b = 0`: `a + c` gets rounded back to `a` because `c` is too small relative to `a`.

That does not stop us from _pretending_ that the operation is associative and commutative, we may just have to live with the rounding errors
(see [DoubleStream.sum](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/DoubleStream.html#sum())
or [clang -ffast-math](https://clang.llvm.org/docs/UsersManual.html#cmdoption-ffast-math)).

**Vectorizing Reductions**

While we can get speedups for reductions using multiple threads, we can also use our CPU's SIMD vector registers,
which open parallelism within a single thread.

Let's look the sum over an array of ints. Below, I show the
C2 intermediate representation of the loop. We initialize our `sum` variable with a `0`, and in each iteration,
we add a new value `v` (the i'th array element) to our `sum`.
But this is a completely sequential implementation of our sum, and the execution time would be dominated
by the latency of the sequential reduction chain.
In an attempt to optimimize, we could unroll the loop (e.g. by a factor of 4):

<img width="700" alt="image" src="https://github.com/user-attachments/assets/d18da4c6-eebb-4d2c-8172-19d19f765ed5" />

However, so far we still have a sequential reduction chain.
We can probably vectorize the values `[v0, v1, v2, v3]`, since they can be computed in parallel (element-wise).
But what can we do about the additions of the reduction?
They are decidedly not parallel, and clearly their operations would cross lanes!

A naive implementation would be to load our `v` values with a vector load operation `LoadV`,
and then sequentially extract every element from the vector, and adding up the values in sequential order.
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

TODO: do the same with VectorAPI, show performance results. And then continue the story.

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
