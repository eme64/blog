---
title: "Vectorizing Reductions: from JDK9 to JDK26 and beyond"
date: 2026-01-13
---



TODO

```java
for (int i = 0; i < limit; i ++) {
}
```

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
