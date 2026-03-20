---
title: "Vectorizing Simple Algorithms with Auto Vectorization, Vectorized Intrinsics and the Vector API"
date: 2026-03-20
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

We fill every element in the int array `r` with the value `42`.

Reference implementation (should be auto vectorized):
```java
for (int i = 0; i < r.length; i++) {
    r[i] = 42;
}
```

Core library method (backed by vectorized intrinsic):
```java
Arrays.fill(r, 42);
```

Vector API implementation:
```java
var v = IntVector.broadcast(SPECIES_I, 42);
int i = 0;
for (; i < SPECIES_I.loopBound(r.length); i += SPECIES_I.length()) {
    v.intoArray(r, i);
}
for (; i < r.length; i++) {
    r[i] = 42;
}
```
We have to use two loops: the length of the array `r` may not be evenly divisible by the
length of the vector `v`. We use `loopBound` to determine up to where we can use
vectors, and handle the remaining iterations in the scalar cleanup loop.

Running the benchmark on an array with `10000` elements on my `x64 AVX512` laptop, and a `aarch64 NEON` OCI machine:

<img width="700" alt="fill performance results" src="https://github.com/user-attachments/assets/0ae3f043-560e-4d2d-b93e-cc9f3545f98f" />

Observations:

- Vectorization is always better compared to scalar performance, but the exact speedup varies.
- For `fill` and this input size, it does not seem to make a difference if we use the intrinsic or auto vectorize.
- The Vector API implementaiton is sensitive to alignment on AVX512: we get a bimodal performance distribution - if the first element of the array is cacheline aligned we get the best performance, but if it is not aligned we get significantly worse performance. Array alignment is essentially random, and so sometimes you get good performance and sometimes not. Auto vectorization and vectorized intrinsics are not sensitive to alignment, because they have an automatic alignment feature. [Read more about alignment here](https://eme64.github.io/blog/2026/01/12/Alignment-Performance.html).

**Algorithm 2: Copy**

TODO

```java
x
```

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
