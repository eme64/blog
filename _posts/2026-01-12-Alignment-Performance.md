---
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

TODO

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
