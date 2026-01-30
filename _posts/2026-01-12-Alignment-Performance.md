---
title: "Performance impact of Alignment"
date: 2026-01-12
---

An important topic in SIMD vectorization is alignment of memory accesses, i.e. loads and stores.
There is an impact on any form of vectorization, including auto-vectorization and explicit vectorization (e.g. with the Vector API).

**Definition: Alignment**

Given some `address` of a memory access, and some `alignment_size`, we say that the `address` is `alignment_size`-aligned if `address % alignment_size = 0`.
If a `alignment_size` is not explicitly stated, we usually either refer to an access being aligned to the size of the access
(4-byte `int` access with 4-byte alignment and 8-byte Object pointers with an 8-byte alignment).
We can also talk about cacheline-alignment, usually referring to an `alignment_size = 64` byte alignment.
Note that the alignment size is a power of 2, because all relevant sizes are powers of 2.

**Some architectures allow only aligned access**

Some architectures, and especially older ones, only allow aligned access. If the address is unaligned on such a platform, then one either gets an error
(e.g. SIGBUS) or a wrong execution (e.g. address is truncated, and the access happens at an unexpected location).
Some of these platforms have specific 4-byte or 8-byte alignment requirements, others only require that an access be aligned by the access size.

This makes vectorization substantially more difficult. For program correctness, the compiler must be able to prove that the address
is aligned, otherwise it cannot use vector instructions. Personally, I've had to spend quite a bit of time on re-thinking and
proving our implementation of alignment for platforms with strict alignment requirements
(see [Bug-Fix PR](https://github.com/openjdk/jdk/pull/14785)).

**Most modern CPUs have fast unaligned access**

That said: most modern CPUs allow unaligned access, and the performance is often as fast or only a little slower than aligned access.
Every platform and miro-architecture behaves a little differently. But often unaligned accesses that do not cross cacheline boundaries
are as fast as aligned accesses.

**Problem: crossing cacheline boundary**

When a memory access crosses a cacheline boundary, it is split into two accesses, one per cacheline.
The split happens in the CPU's memory subsystem (details may vary on different architectures):
First, the load/store is decoded from the machine code, and the address width is determined.
The memory unit receives (or calculates) the address, and checks if the address is aligned for the access size.
If it is not aligned, it is checked if memory boundaries (e.g. cacheline boundaries) are crossed,
in which case the access is split into two. If it is a store, the store value is split accordingly.
If it is a load, the fragments are combined.

<img width="400" alt="image" src="https://github.com/user-attachments/assets/071ef882-19ce-4417-a27f-6e2fafe440dc" />

Split accesses means that one now has more memory accesses going through the memory unit of the CPU, and that can slow down execution.
The amount by which this affects performance depends on a few factors.
Simply put, it depends on the fraction of memory accesses that are split, and if memory accesses are the bottleneck.
If there are only very few memory accesses, and we are heavily compute-bound, then splitting those few memory accesses probably has very little impact on performance.
However, if the memory units are already the bottleneck, and we split all memory accesses we could in theory get only half the execution speed.
Most of the time, reality lies somewhere in between.

In my experience, cacheline boundaries are the most impactful for alignment. However, there are also platforms with additional memory boundaries.
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

<img width="700" alt="image" src="https://github.com/user-attachments/assets/71bfce7e-cbb8-4587-811f-001c102e8b26" />

I measured this on an `x64` machine with `AVX512` support. The vectors are 64 bytes long, and contain 16 ints of 4 bytes each.
A cacheline is also 64 bytes long. This explains the repetitive pattern in both directions: every 16 elements we have alignment
and in between we have misalignment.
We get the best performance if we have both loads and stores aligned (green).
And we get the worst performance if both loads and stores are misaligned (red).
The performance impact is `50%` between the worst and best case.
If we could only have loads aligned or only stores aligned, we should pick aligning stores, with a `20%` performance difference.

But the exact behavior depends on the vector length and your specific CPU.
I ran [this benchmark](https://github.com/openjdk/jdk/pull/25065) `java Benchmark.java test1L1SVector 8 2560 oneArray`,
but with different sizes.
In the 2D plots below, I tried to show the pattern with maximum contrast (green=min, red=max).
But it is just as important to look at the difference between best and worst performance:
they are not always equally extreme.

On my `AVX512` laptop with 64-byte (16 ints) vector:

<img width="400" alt="image" src="https://github.com/user-attachments/assets/c82f80b2-d45c-45a5-a7ec-4fe863c7c5c2" />

On my `AVX512` laptop with 16-byte (4 ints) vector:

<img width="400" alt="image" src="https://github.com/user-attachments/assets/52d6b050-24b4-4624-bbc3-002d8c934aca" />

On my `AVX512` laptop with 8-byte (2 ints) vector (a bit noisy, but the pattern is still quite clear):

<img width="400" alt="image" src="https://github.com/user-attachments/assets/0081c69a-28d0-4d38-981b-a79b570ed3aa" />

It seems that store-alignment generally leads to better performance than load-alignment.
We see that especially with large vectors (e.g. 64 byte) the performance difference between alignment and non-alignment
can make a difference of more than `100%`. With smaller vectors (e.g. 8 byte) the difference is only `20%`.
The explanation is that with larger vectors, more of those cross cache line boundaries. For example, if all 64 byte
vectors are misaligned, all of them must cross the 64 byte boundaries, and are thus turned into two accesses.
If the vectors are smaller, only a fraction of them is split, leading to a lower overhead.

However, on some Aarch64 `NEON` machine, and a 16-byte (4 int) vector, I seem to get (very!) slight better performance with
load-alignment, i.e. the green lines go vertical:

<img width="400" alt="image" src="https://github.com/user-attachments/assets/36f49623-a0ae-47f7-93e1-eeb9f2b21862" />

And very similarly on `NEON` with 8-byte (2 int) vectors (though more noisy):

<img width="400" alt="image" src="https://github.com/user-attachments/assets/62249de7-eb34-48ec-8fd6-09c4f564caee" />

Generally, it seems that on this `NEON` machine, alignment only can make about a `10%` performance difference.

The attentive reader may have noticed that the 2D "alignment-maps" are shifted around,
the best performance rows and columns are not always the first column or row,
they are seemingly at arbitrary placed. The reason is that the underlaying data is based on arrays,
and those are not necessarily aligned to the vector length. Every time one runs the visualization benchmark,
the arrays are aligned differently, and the most performance columns and rows are accoringly different.

**Impact on Auto Vectorization**

My personal motivation for diving deeper into alignment was a performance regression in the auto vectorizer
(see [Bug-Fix PR](https://github.com/openjdk/jdk/pull/25065)).
In the C2 auto vectorizer, we use a scalar (non-vectorized) pre-loop to align the memory address, such that the
vectorized main-loop has the address aligned and gets better performance.
However, if there are multiple accesses, we can only pick one for alignment.
For example, if we have a load and a store access, we can only guarantee the alignment of the load or the store.
Especially on `x64` machines, the performance penalty for misaligned stores is much worse than for misaligned loads.
Unfortunately, I had accidentally swapped to aligning loads rather than stores and that led to a `20%` regression.

**Impact on the Vector API**

With the Vector API, alignment is the responsibility of the user.
The compiler cannot auto-align the vectors in memory (at least not without some extreme compiler heroics like scalarizing and re-vectorizing).

However, as of JDK26, the user has no way to know the alignment of arrays.
Generally, the headers of arrays are 8 byte aligned just like any other Objects in Java.
But the payload (the 0th element) is at some offset of 12 or 16 bytes depending on JVM configuration and on element type.
Additionally, the Garbage Collector can move the array at any point, and change the alignment to a different 8 byte alignment.
If one is stuck using arrays, it is generally still worth vectorizing: the cost of misalignment does not outweigh the performance gain on vectorization in almost all cases.
But you may get slightly unpredictable performance: sometimes the accesses are aligned and sometimes not.
If you really must get the absolute maximum performance, then the recommendation is to use
[off-heap (native) memory](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/Arena.html#allocate(long,long)),
and provide the required alignment size for the allocated memory.

Below a small demo, using a MemorySegment that either wraps an array or native (off-heap) memory.

```java
// java Test.java 16 100000 array 10000
// java Test.java 16 100000 native 10000
// java -XX:+UseCompactObjectHeaders Test.java 16 100000 array 10000

import jdk.incubator.vector.*;
import java.lang.foreign.*;
import java.nio.ByteOrder;

public class Test {
    public static VectorSpecies<Integer> SPECIES;
    public static String ALLOCATE;
    public static int SIZE;
    public static int REPS;

    public static void main(String[] args) {
        int vectorElements = Integer.parseInt(args[0]);
        SPECIES = VectorSpecies.of(int.class, VectorShape.forBitSize(vectorElements * 4 * 8));
        SIZE = Integer.parseInt(args[1]);
        ALLOCATE = args[2];
        REPS = Integer.parseInt(args[3]);
        System.out.println("Welcome.");
        System.out.println("SPECIES: " + SPECIES);
        System.out.println("SIZE: " + SIZE);
        System.out.println("ALLOCATE: " + ALLOCATE);
        System.out.println("REPS: " + REPS);

        for (int i = 0; i < 100; i++) {
            run();
        }
    }

    public static MemorySegment allocate() {
        return switch (ALLOCATE) {
            case "native" -> Arena.ofAuto().allocate(4 * SIZE, /* cacheline aligned*/ 64);
            case "array" -> MemorySegment.ofArray(new int[SIZE]); // unknown alignment
            default -> throw new RuntimeException("ALLOCATE: must be native or array");
        };
    }

    public static void run() {
        MemorySegment ms = allocate();
        for (int i = 0; i < 3; i++) {
            test(ms); // small warmup
        }
        long t0 = System.nanoTime();
        for (int i = 0; i < REPS; i++) {
            test(ms); // measurement
        }
        long t1 = System.nanoTime();
        float t = (t1 - t0) * 1e-6f;
        System.out.println("time: " + t);
    }

    public static void test(MemorySegment ms) {
        // We are going to be lazy here, and ignore if SIZE is not divisible by the element number.
        for (int i = 0; i < SPECIES.loopBound(SIZE); i += SPECIES.length()) {
            var v = IntVector.fromMemorySegment(SPECIES, ms, 4L * i, ByteOrder.nativeOrder());
            v = v.add(1);
            v.intoMemorySegment(ms, 4L * i, ByteOrder.nativeOrder());
        }
    }
}
```

I ran the benchmark in 3 configurations, always with 16 element vectors, so loading and storing vectors the size of a 64-byte cacheline:

- Once with `native` memory, which is always cacheline aligned, and performance is always best.
- Once with `array`. This array is 8-byte aligned, and the 0th element is at an offset of 16 bytes, so also 8-byte aligned. We expect a certain fraction of the arrays to have the 0th element aligned, and the others misaligned. Matching with this expectation, we see that most samples are slower, but some are faster.
- Once with `array`, but compact object headers enabled (`-XX:+UseCompactObjectHeaders`). The array itself is also 8-byte aligned, but the offset to the 0th element is now only 12 bytes. This means the 0th element is 4-bytes off of the 8-byte alignment, and we will never have cacheline alignment. Matching with this expectation, the performance is always slow.

<img width="700" alt="image" src="https://github.com/user-attachments/assets/b04a8f7d-6243-4d3c-bc2c-9b3b42579e8e" />

If we instead run with 8 element vectors, the performance difference is still visible, but less drastic. And the array is aligned with a higher probability.

<img width="700" alt="image" src="https://github.com/user-attachments/assets/ee7ed210-36e9-4a96-9d8d-df69778b6a5a" />

**Vectorization is usually Profitable even without Alignment**

Vectorization usually leads to speedups of large factors.
And the loss in performance due to misalignment is usually rather a small percentage.
Thus, it is reasonable to worry about vectorizing first, and only worry about alignment if even more performance is required.

**Links**

A while ago, I worked on a performance regression that was due to accidentally aligning to
loads rather than stores. The PR contains lots of plots, explanations and further related topics:
[PR Auto Vectorization Alignment Performance Regression](https://github.com/openjdk/jdk/pull/25065)

My JVMLS 2025 talk also mentions the performance impact of alignment:
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
