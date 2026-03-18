---
title: "How the Hotspot JVM speeds up computation with SIMD Vectorization"
date: 2026-03-20
---

Parallel processing is used in many places to speed up computation.
We use multiple CPU cores, GPUs with massive parrallel threading capabilities,
and we even scale out to many machines and even to data centers distributed
all over the world.

But hardware (and the power required to run them) is
expensive, and so we would like to squeeze
out every last drop of the juicy performance our machines can deliver to us.
You might be surprised how much computation power a single CPU has, and in
some cases you might even be able to avoid scaling out if you optimize your
code enough so that it can run on a single machine or even a single CPU.

**Every individual CPU is an amazing Parallel Processing Machine**

Did you know that every CPU is itself can compute many operations in parallel
per cycle? Our modern CPUs with their pipeline design and multiple arithmetic
units and usually multiple memory ports can thus schedule multiple instructions
every cycle (one per arithmetic unit or memory port). But the instructions of
previous cycles are still running in parallel to the instructions that are just
now scheduled in the current cycle.

But even individual instructions can perform multiple operations:
Virtually all modern CPUs have so called "SIMD vector registers and instructions".
SIMD stands for "Single Instruction Multiple Data". We issue a single instruction which
gets distributed over multiple pieces of data - the elements of the vector.
For example, `x64 AVX2` machines have 256 bit vectors, and can thus hold
8 Java `int` elements, or 32 `byte` elements. And ARM `aarch64 NEON` machines have
128 bit vectors that can hold 4 `int` or 16 `byte` elements.
Vectorized load and store instructions can load and store whole vectors of data,
and vectorized arithmetic instructions can be used to perform element-wise
additions, multiplications, etc. This means we perform multiple operations per
instructions - the number of operations depends on how many elements the vector
holds. Hence SIMD: a Single Instruction (e.g. addition) is distributed over
Multiple Data - all the elements in the vector.

<img width="700" alt="Vector Species" src="https://github.com/user-attachments/assets/a0123abc-a511-475f-8bca-c3d86295e0ac" />

To use the terminology of the [Java Vector API](https://openjdk.org/jeps/529):
the vector registers come in various _Vector Species_. A _Vector Species_ is
defined by the element type and the total size of the vector in bits.
In the context of Java, the element types are primitive types like `byte`,
`char`, `short`, `int`, `long`, `float` and `double` - they range from 1 to 8 bytes (8 to 64 bits).

There are various hardware implementations of SIMD vectors
(e.g. x86: SSE, AVX, AVX2, AVX512. ARM: NEON, SVE).
Different platforms and even micro architectures
can have different register sizes and instruction sets.
In the context of Java, it is the task of the JVM to abstract
over the complexity and differences of the individual CPUs
and to provide a cross-platform compatible experience.

**Why Vectorize?**

TODO continue here

****

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
