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

Providing such a cross-platform compatible experience that still
tries to squeeze the most performance out of every different micro architecture
is not an easy task. But it can pay off with big performance gains.

Once we have optimized the code for individual threads, we can then still scale up
to use many threads so we can use every CPU core available on a machine, and scale
out to multiple machines. But we might not need quite as many machines any more.

**Why Vectorize?**

SIMD vectorization can significantly speed up computation.
Of course it requires that the compuatation has some inherent parallelism,
so it can be distributed over the SIMD vector elements.
The speedup will be limited by the vector length (number of elements in the vector):
if a vector can hold 8 `floats`, we can expect at most a 8x speedup.
But often we get a bit less than this theoretical maximum speedup,
especially if our computation is not compute-bound but memory-bound:
at some point the memory throughput will be the bottleneck.
Further, in most applications not everyting can be parallelized,
some parts are unavoidably sequential. And so we can only expect
to speed up the parallelizable parts.

There is a surprising amount of problems in a vast amount of domains that
have a large amount of inherent parallelism. And so SIMD vectorization
is a powerful tool to speed up the computations for those problems.
For example:

- Linear Algebra: vector, matrix, tensor computations. There are many applications, including Machine Learning, AI.
- Simulations: scientific models, games, physics engines.
- Graphics and Audio Processing: image processing, computing visualizations, processing/synthesizing sound, encoding/decoding.
- Cryptography: encryption and decryption, hashing, signatures.
- Finance: time series analysis, spreadsheet calculations.
- JDK core libraries: processing arrays, strings, crypto.

Java is a widely trusted platform in a vast number of domains.
Hence, the JVM is continuously extended and improved to enhance performance
for those domains.

**Three Vectorization Programming Models**

We can name three distinct vectorization models, that differ in how you write code and
their guarantees for performance.

- _Explicit_: The programmer directly uses _vector assembly instructions_, and hence gets the guarantee that the CPU runs SIMD operations. This is not a very nice programming experience, and does not scale well: you need to rewrite your code for every CPU micro architecture. To make the explicit model more pleasant, there are higher-level language APIs such as the [intel intrinsics](https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html) (though this one is limited to x86 CPUs). Java's mission is to run cross-platform, and so there has been a lot of work invested into the Java Vector API that models vectors in a clear and concise Java API, but which translates down reliably to vector assembly instructions - whenever available on the CPU.
  - Pros: The programmer has full control and freedom over the use of SIMD vectors. One does not need to rely on automatic vectorization or libraries, which all have their limitations.
  - Cons: Writing algorithms using SIMD vectors does require rethinking your algorithms, it is more effort than just writing regular scalar code.
- _Automatic_: Modern compilers often contain optimization phases that automatically vectorize code.
  - Pros: This happens automatically - no effort required by the programmer. On average, many programs are sped up.
  - Cons: Every compiler optimzation is limited - their pattern matching capabilities will never cover all possible code shapes. This means that small source code changes to the Java program might make the difference between the code shape being recognized and vectorized leading to faster code or not being recognized leading to slower code. We call this the "brittleness problem": it can be hard for the user to predict or understand if automatic vectorization succeeds for a specific code shape.
- _Intrinsics_: Some operations are very performance critical that they deserve special treatment. For example, there are some array, string and crypto operations that the JVM engineers decided to power them by hand-written assembly snippets (so-called intrinsics). A lot of time and effort has been invested to tune and perfect these assembly snippets - and this has to be done for each CPU micro architectures.
  - Pros: intrinsics allow us to speed up some performance critical core library methods of the JDK. Automatic vectorization either does not succeed in these cases or simply does not (yet) acheive perfect performance.
  - Cons: this comes at an immense additional effort for JVM engineers, to write, test, benchmark and maintain all these assembly snippets for the large variety of critical core library methods and CPU micro architectures.
 
Some observations and recommendations:

- If performance is not your primary concern, then you do not have to change your source code - and your code may still be optimized by automatic vectorization and the core library methods you use will be powered by fast intrinsics.
- If you do care about performance:
  - You should benchmark your application and see where the bottleneck lies.
  - Then optimize your algorithms and data structures - this usually allows much greater speedups than SIMD vectorization.
  - If you still need more performance, inspect the generated assembly code using a profiler, and see if vectorization happens as expected.
  - If not, see if you can replace some loops with core library methods (e.g. `Arrays.fill`, `System.arraycopy`, ...) and see if this improves performance.
  - If performance is still not as you want, and are willing to invest more time, then the Vector API may be the solution for you.

TODO continue here

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
