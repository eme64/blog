---
title: "Vectorizing Simple Algorithms using Auto Vectorization, Intrinsics and the Vector API"
date: 2026-03-21
---

In this blog post, we will look at some very simple algorithms like `fill`, `copy`, `map` and `iota`,
and see how we can vectorize them to get speedups.
I will assume that you already have some basic understanding of automatic vectorization,
vectorized intrinsics and the Vector API, otherwise
[please read this blog post first](https://eme64.github.io/blog/2026/03/19/Hotspot-JVM-Vectorization.html).

For each of the examples, we will follow these steps:

- Reference Implementation: the simplest implementation, just a simple loop. That gives us a ground truth to test other implementations, as well as a performance baseline. We should also check if this simple implementation already is auto vectorized - it may already give us really good performance.
- Core library method: see if we can find one with a vectorized intrinsic.
- Vector API: only now do we invest the additional time it takes to rewrite the algorithm using the Vector API. In these very simple cases, we will probably not get any speedup, because the reference implenetation is already auto vectorized, or the vectorized intrinsic is at least as performant.

Note: all of the benchmarks are [integrated in the OpenJDK github repository](https://github.com/openjdk/jdk/pull/28639).
Below, I will slightly simplify some of the code so it is easier to read.

**Algorithm 1: Fill**

TODO

**Algorithm 2: Copy**

TODO

**Algorithm 3: Map**

TODO

**Algorithm 4: Iota**

TODO

**Conclusion**

TODO

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
