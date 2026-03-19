---
title: "Implementing a Fast Dot-Product using the Java Vector API"
date: 2026-03-19
---

The dot-product is one of the most fundamental Linear Algebra operations,
and it has many applications.

**AI Application of the Dot-Product at Netflix**

Earlier this month, [Netflix published a blog post](https://netflixtechblog.com/optimizing-recommendation-systems-with-jdks-vector-api-30d2830401ec)
on using the Vector API to optimize their recommendation system.
They use [vector embeddings ](https://en.wikipedia.org/wiki/Embedding_(machine_learning))
to map user histories and videos to a vector space.
The vector embedding maps semantically similar histories and videos close together,
and semantically different ones further apart.
We can now use the dot-product on the embedding vectors to tell how far apart
the points are, which tells us how similar the histories and videos are.
Computing the dot-products takes a significant part of time to run the ranker,
so it is worth it to optimize it. They used the Vector API to get significant speedups.

**The Dot-Product**

The code to compute the dot-product is very simple.
Given two arrays `a` and `b` that hold the two vectors,
we compute the sum over the element-wise products.

```java
float sum = 0;
for (int i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
}
```

However, this simple implementation is not going to give us maximum performance.

**Why is the Simple Implementation Slow?**

Let us illustrate the operations required in the following graph:

<img width="400" alt="sequential reduction - latency chain" src="https://github.com/user-attachments/assets/6f55f45b-55e5-41e7-a670-cfd3925477b5" />

We see that the multiplications (and the loads before that) can be executed independently, they do not depend on any prior computation.
The CPU can schedule multiplications in parallel.
But the additions depend on the result of the previous additions.
The CPU can only schedule the an addition if its inputs are available.
The the CPU needs to wait a few cycles for the addition to complete,
and then the result is ready as the input to the next addition.
This creates a rigid reduction chain, where the latency of the addition
operations dominates the performance.

**Solving the Latency Problem: Recursive Folding**

Let us assume that the addition operation is [associative](https://en.wikipedia.org/wiki/Associative_property),
i.e. we are able to rearrange the parenthesis: `(a + b) + c` = `a + (b + c)`.
This allows us to reassociate the additions and break down the latency chain.
This is exactly what the Vector API [reduceLanes](https://en.wikipedia.org/wiki/Associative_property) operation does when compiled by HotSpot.
It uses the recursive folding trick: it recursively splits the vector into two halves, and adds those up lane-wise,
until it ends up with a single element.

```java
for (i = 0; i < SPECIES_F.loopBound(a.length); i += SPECIES_F.length()) {
    var va = FloatVector.fromArray(SPECIES_F, a, i);
    var vb = FloatVector.fromArray(SPECIES_F, b, i);
    sum += va.mul(vb).reduceLanes(VectorOperators.ADD);
}
```

Assuming that our vector can hold 4 elements, the critical chain of additions now is only a 4th as long,
cutting the latency down by a (theoretical) factor of 4.

<img width="650" alt="recursive folding" src="https://github.com/user-attachments/assets/741d2af4-ca2e-4fc1-940c-336c0bc03e95" />

But this solution introduces a new problem: the recursive folding requires multiple assembly instructions
(recursively splitting and lane-wise adding).
Before, the latency chain was the bottleneck, now the large number of instructions becomes a throughput bottleneck,
the CPU is fully busy executing those recursive folding instructions.

**Solving the Throughput Problem: Vector Accumulator**

We can reassociate the sum one more time, and use a vector accumulator (`acc`) instead of a scalar accumulator (`sum`).

```java
var sums = FloatVector.broadcast(SPECIES_F, 0.0f);
for (int i = 0; i < SPECIES_F.loopBound(a.length); i += SPECIES_F.length()) {
    var va = FloatVector.fromArray(SPECIES_F, a, i);
    var vb = FloatVector.fromArray(SPECIES_F, b, i);
    sums = sums.add(va.mul(vb));
}
float sum = sums.reduceLanes(VectorOperators.ADD);
```

Every lane (element) of the vector accumulator `acc` holds a part of the total sum.
After the loop, we can simply sum up the partial results to obtain the total sum.
Executing the `reduceLanes` operation only once means it does not have a big performance impact.
Inside the loop, we are now only executing two loads, an element-wise multiplication and an element-wise addition.
This significantly improves the throughput, because we are now executing fewer assembly instructions per
vectorized iteration.

<img width="700" alt="vector accumulator" src="https://github.com/user-attachments/assets/a54c4441-5314-4753-b032-2fbb6f91b780" />

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
