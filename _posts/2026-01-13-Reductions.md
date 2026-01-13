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
additions are complete. However, one can compute some reductions in parallel.
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

TODO

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
