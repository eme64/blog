---
title: "Vectorizing Loops with Control-Flow using the Vector API"
date: 2026-03-24
---

Many algorithms require control-flow.
As of JDK26, the HotSpot JVM does not auto vectorize loops with control-flow (other than the loop exit check).
That will hopefully change in the future, but auto vectorization will always be limited.
It is a pattern matching engine and can never cover all cases.
That's where the Vector API ([JEP](https://openjdk.org/jeps/529)) comes to the rescue:
it allows us to express vectorized computations directly in Java,
and compiles down to fast SIMD vector instructions.
In this blog post, we will look at some relatively simple but powerful and often used
algorithms that contain control-flow in the loop iterations.

For this blog post, I assume you are familiar with the
basics of vectorization in Java
(auto vectorization, vectorized intrinsics and the Vector API).
Otherwise, please read
[this](https://eme64.github.io/blog/2026/03/19/Hotspot-JVM-Vectorization.html)
and
[this](https://eme64.github.io/blog/2026/03/20/Simple-Vectorized-Algorithms.html).

**Algorithm 1: lowerCase**

TODO

**Algorithm 2: pieceWise**

TODO

**Algorithm 3: find**

TODO

**Algorithm 4: mismatch**

TODO

**Algorithm 5: filter**

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
