<img width="1754" height="830" alt="image" src="https://github.com/user-attachments/assets/3cd5cdbc-e723-4910-8e1f-30280d068dd1" />---
title: "Performance impact of Alignment"
date: 2026-01-12
---

An important topic in SIMD vectorization is alignment of memory accesses, i.e. loads and stores.
There is an impact on any form of vectorization, including auto-vectorization and explicit vectorization (e.g. with the Vector API).

**Some architectures allow only aligned access**

Some architectures, and especially older ones, only allow aligned access. If the address is unaligned on such a platform, then one either gets an error
(e.g. SIGBUS) or a wrong execution (e.g. address is truncated, and the access happens at an unexpected location).

This makes vectorization substantially more difficult. For program correctness, the compiler must be able to prove that the address
is aligned, otherwise it cannot use vector instructions. Personally, I've had to spend quite a bit of time on re-thinking and
proving our implementation of alignment for platforms with strict alignment requirements
(see [Bug-Fix PR](https://github.com/openjdk/jdk/pull/14785)).

**Most modern CPUs have fast unaligned access**

That said: most modern CPUs allow unaligned access, and the performance is often as fast or only a little slower than aligned access.
Every platform and miro-architecture behaves a litle different. But often unaligned accesses that do not cross cacheline boundaries
are as fast as aligned accesses.

**Problem: crossing cacheline boundary**

When a memory access crosses a cacheline boundary, it is split into two accesses, one per cacheline.

<img width="600" alt="image" src="https://github.com/user-attachments/assets/cc433569-d9ab-4997-8ade-9410e7296964" />

This means one now has more memory accesses going through the memory unit of the CPU, and that can slow down execution.
The amount by which this affects performance depends on a few factors.
Simply put, it depends on the fraction of memory accesses that are split, and if memory accesses are the bottleneck.
If there are only very few memory accesses, and we are heavily compute-bound, then splitting those few memory accesses probably has very little impact on performance.
However, if the memory units are already the bottleneck, and we split all memory accesses we cound in theory get only half the execution speed.
Most of the time, reality lies somewhere in between.

In my experience, cacheline boundaries are the most impactful. However, there are also platforms with additional constraints.
For example, the `aarch64 Neoverse N1` optimization guide talks about performance penalties not just for loads that cross cacheline
boundaries (64 byte) but also stores that cross 16 byte boundaries ([Section 4.5 Load/Store alignment](https://developer.arm.com/documentation/109896/latest/)).

**Visualizing the Performance Impact of (un)aligned Loads and Stores**

To visualize the performance impact of alignment, [I wrote some benchmarks](https://github.com/openjdk/jdk/pull/25065).
Below you can see a simplified version of it:
```java
for (int i = 0; i < limit; i += SPECIES.length()) {
    var v = IntVector.fromArray(SPECIES, arr1, i + offset_load);
    v.intoArray(arr0, i + offset_store);
}
```
In a loop, we load vectors from one array and store them into another array.
But we can configure the offset of the loads and stores.
If we visualize the performance numbers, we get something like this:

<img width="1754" height="830" alt="image" src="https://github.com/user-attachments/assets/71bfce7e-cbb8-4587-811f-001c102e8b26" />


**Links**

[PR Auto Vectorization Alignment Performance Regression](https://github.com/openjdk/jdk/pull/25065)

[Section on Alignment in JVMLS 2025 Talk](https://www.youtube.com/watch?v=UVsevEdYSwI&t=1576s)

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
