---
title: "How the HotSpot JVM speeds up computation with SIMD Vectorization"
date: 2026-03-20
---

Parallel processing is used in many places to speed up computation.
We use multiple CPU cores, GPUs with massive parallel threading capabilities,
and we even scale out to many machines and even to data centers distributed
all over the world.

But hardware (and the power required to run them) is
expensive, and so we would like to squeeze
out every last drop of the juicy performance our machines can deliver to us.
You might be surprised how much computation power a single CPU has, and in
some cases you might even be able to avoid scaling out if you optimize your
code enough so that it can run on a single machine or even a single CPU.

**Every individual CPU is an amazing Parallel Processing Machine**

Did you know that every CPU itself can compute many operations in parallel
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
Of course it requires that the computation has some inherent parallelism,
so it can be distributed over the SIMD vector elements.
The speedup will be limited by the vector length (number of elements in the vector):
if a vector can hold 8 `floats`, we can expect at most a 8x speedup.
But often we get a bit less than this theoretical maximum speedup,
especially if our computation is not compute-bound but memory-bound:
at some point the memory throughput will be the bottleneck.
Further, in most applications not everything can be parallelized,
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
  - Cons: Writing algorithms using SIMD vectors does require rethinking your algorithms, it is more effort than just writing regular scalar (single-element) code.
- _Automatic_: Modern compilers often contain optimization phases that automatically vectorize code.
  - Pros: This happens automatically - no effort required by the programmer. On average, many programs are sped up.
  - Cons: Every compiler optimzation is limited - their pattern matching capabilities will never cover all possible code shapes. This means that small source code changes to the Java program might make the difference between the code shape being recognized and vectorized leading to faster code or not being recognized leading to slower code. We call this the "brittleness problem": it can be hard for the user to predict or understand if automatic vectorization succeeds for a specific code shape.
- _Intrinsics_: Some operations are very performance critical that they deserve special treatment. For example, there are some array, string and crypto operations that the JVM engineers decided to power them by hand-written assembly snippets (so-called intrinsics). A lot of time and effort has been invested to tune and perfect these assembly snippets - and this has to be done for each CPU micro architectures.
  - Pros: intrinsics allow us to speed up some performance critical core library methods of the JDK. Automatic vectorization either does not succeed in these cases or simply does not (yet) achieve perfect performance.
  - Cons: this comes at an immense additional effort for JVM engineers, to write, test, benchmark and maintain all these assembly snippets for the large variety of critical core library methods and CPU micro architectures.
 
Some observations and recommendations:

- If performance is not your primary concern, then you do not have to change your source code - and your code may still be optimized by automatic vectorization and the core library methods you use will be powered by fast intrinsics.
- If you do care about performance:
  - You should benchmark your application and see where the bottleneck lies.
  - Then optimize your algorithms and data structures - this usually allows much greater speedups than SIMD vectorization.
  - If you still need more performance, inspect the generated assembly code using a profiler, and see if vectorization happens as expected.
  - If not, see if you can replace some loops with core library methods (e.g. `Arrays.fill`, `System.arraycopy`, ...) and see if this improves performance. Some of the core library methods are powered by intrinsics which should give you optimal performance - but always benchmark anyway to be sure!
  - If performance is still not as you want, and are willing to invest more time, then the Vector API may be the solution for you. In the future, there might be vectorized algorithm libraries powered by the Vector API and written by the Java community - consider those as well.
- Automatic vectorization is limited, and can still be improved. But it will never cover all possible code shapes. If you have important use-cases where automatic vectorization does not yet succeed, then please report them with a benchmark, so we can investigate and consider improvements to cover those use-cases.
- Updating to a newer JDK version means you profit from improved intrinsics, more code shapes being optimized by automatic vectorization, and better support for the Vector API.

Let us now look at the three models in a bit more detail.

**Core Library Methods powered by Vectorized Intrinsics**

Some core library methods are very performance critical, so much that HotSpot replaces calls to those methods with highly optimized hand-written assembly snippets.
So rather than interpreting the Java bytecode, or compiling it using the normal optimizations (like automatic vectorization), we just substitute the call to those
selected core library methods with those pre-defined assembly snippets.
Some examples:

- `System.arraycopy` and `Arrays.copyOf`
- `Arrays.equals`, `Arrays.mismatch` and `Arrays.compare`
- `Arrays.fill`
- `Arrays.hashCode`
- `String.equals` and `String.compareTo`
- `String.indexOf`
- `com.sun.crypto.provider.AESCrypt`

Use the core library methods like these when you can - don't hand-roll your own loops for these cases if you can avoid it.
For one, you will have to write and test less code. And on top: you most likely get better performance.

**Automatic Vectorization**

Automatic vectorization has been done for a long time, and is still an active research topic.
The goal is to detect parallelism in the code: for example when the iterations of a loop
are independent or if a straight-line piece of code contains some isomorphic ("same kind of shape")
instructions.
There is a vast variety of compilers with different capabilities for automatic vectorization.
The HotSpot JVM focuses on loops with primitive data types and independent loop iterations.

If you are interested in more details, please [watch my JVMLS 2025 presentation on Automatic Vectorization in HotSpot](https://inside.java/2025/08/16/jvmls-hotspot-auto-vectorization/).

**Expressing Vectorized Computation using the Vector API**

With JDK26, the Vector API is now in its 11th incubator (see [JEP](https://openjdk.org/jeps/529)).
The goal is to move it to preview sometime after Valhalla is in preview (we want to use the new `value class` features).

Its goals:

- _Cross-Platform_: in spirit with the general Java promise of "write once run anywhere".
- _Reliable Performance_: the Vector API code should be compiled down to those juicy vector assembly instructions - whenever they are available on the CPU.
- _Graceful Degregation_: if a specific CPU does not support some vector length or vector assembly instruction, the operations have to be simulated with scalar (single-element) operations. In that case, we cannot expect that an algorithm implemented with the Vector API is faster than an alternative scalar (single-element) implementation. But the goal is that the Vector API implementation is also not slower than the scalar implementation.
- _Clear and Concise API_: we want to be able to express a wide variety of vector compuatations. The vector lengths are generic, so that they can be adapted to the specific requirements of different hardware.

We have made large progress over the last years. More and more CPU architectures are supported, more and more operations of the Vector API are compiled to vector instructions.
A large extent of the work is done by hardware vendors these days: they ensure that the compiler knows about all the vector instructions available on the large variety of hardware.
In most cases, the Vector API already now provides massive speedups.

There is still some work to do: the implementation needs to be aligned with Valhalla. And the goal of Graceful Degregation has not yet been tackled.
If an operation is not supported, we currently resort to a Java fall-back implementation that allocates arrays for each operations,
requiring data to be copied around unnecessarily and also there are some issues with inlining, requiring an unnecessary overhead of additional calls.
Solutions to these issues are currently being discussed.

For now, the recommendation is to write both a scalar and vector implementation. Then benchmark those implementations on every platform you want to run,
and see which one is faster. This is good practice anyway: it allows you to test correctness, and to ensure performance is as you expect it to be.
You can use some kind of per-platform configuration to determine which of the implementations should be run.

If you are interested to learn more about the Vector API:

- Read the [JEP](https://openjdk.org/jeps/529) and the [documentation](https://docs.oracle.com/en/java/javase/26/docs/api/jdk.incubator.vector/jdk/incubator/vector/Vector.html)!
- [JEP Café #18: Learn how to write fast Java code with the Vector API](https://www.youtube.com/watch?v=42My8Yfzwbg)
- [Vectorizing Reductions](https://eme64.github.io/blog/2026/01/13/Reductions.html) (has a section about Vector API)
- [Performance impact of Alignment](https://eme64.github.io/blog/2026/01/12/Alignment-Performance.html)

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
