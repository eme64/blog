---
title: "Auto-Vectorization and Store-to-Load-Forwarding"
date: 2024-06-24
---

I have been working a lot on Hotspot JVM C2's auto vectorization, and intend to continue with that.
You can read more in my previous blog posts.

Today, I want to spend some time explaining a particular CPU-optimization (store-to-load-forwarding),
and its impact on Auto-Vectorization.

**Motivation**

I was investigating [JDK-8334431](https://bugs.openjdk.org/browse/JDK-8334431), which was filed because
of a performance regression after a recent improvement I made to SuperWord with
[JDK-8325155](https://bugs.openjdk.org/browse/JDK-8325155), which allows vectorization of more
loops, especially loops with multiple loads that have indices with different constant offsets.

Below, you can find an example of a loop that only vectorizes after
[JDK-8325155](https://bugs.openjdk.org/browse/JDK-8325155),
because of loads `b[i]` and `a[i+1]`, where the constant offset of the indices are different (`+0` and `+1`):

```
    for (int i = 0; i < a.length-1; i++) {
        a[i] = b[i] + a[i+1];
    }
```

Allowing more loops to vectorize generally unlocks speedups, like for the example above. But there is always
a risk that there are some special-cases where vectorization leads to a regression, and that is what happened
with [JDK-8334431](https://bugs.openjdk.org/browse/JDK-8334431), and I will come back to it at the end of
this blog post. But first some background.

**Auto-Vectorization**

This is just a quick recap - feel free to read more in my other blog posts about how SuperWord works.
The basic idea is to pack many scalar operations into a vector operation, and thus reduce the number
of instructions the CPU needs to execute to do the same work. This can speed up the execution time.
A simple example:

```
    for (int i = 0; i < a.length; i++) {
        a[i] = b[i] + c[i];
    }
```

This loop can be unrolled and vectorized to:

```
    for (int i = 0; i < a.length; i+=4) {
        a[i .. j+3] = element_wise_add(b[i .. j+3], c[i .. i+3]);
    }
```

Thus, for the 4x unrolling, there would have been 4x 2 loads, 4x 1 add, and 4x 1 store.
For the vectorized loop, there are 2 vector-loads, 1 vector-add, and 1 vector-store,
thus only a quarter of the instructions.

Generally, vectorizing a loop unlocks speedups, because instead of executing many scalar operations
we can execute fewer vector operations. This reduces the number of instructions the CPU needs to
execute to get the same work done. Executing fewer instructions generally means faster execution.

Some loops cannot be vectorized, here some common reasons (there are many more):
- Not all scalar operations have corresponding vector operations (e.g. division).
- Loop carried dependencies: if computations in iteration `i` depend on values from iteration `i-1`, then this can prevent the parallel execution of iterations `i-1` and `i`, i.e. the instructions cannot be packed in a vector instruction that executes all operations in parallel.
- Control-flow in loop body: not all vectorizers allow CFG in the loop body, or only support certain CFG shapes.

Some loops are faster in their scalar form, and slower when vectorized. Some example reasons:
- Reduction over floating-point numbers where order of reduction must be followed to avoid rounding differences. Float and double addition and multiplication cannot be reordered without changing the result. A scalar loop that linearly adds up 8 floats needs to perform 7 additions in sequence. If the loop was vectorized with 8 lanes per vector, we have a vector of 8 values. To linearly add these values, we first need to unpack/shuffle the values, and only then add up the extracted values with 7 sequential additions. The unpacking/shuffling can incur such a significant overhead that vectorization can make the loop slower.
- More generally: vectorization sometimes requires additional instructions, such as pack, unpack and shuffle operations. If vectorization is profitable depends on the gains made by parallelization versus the losses incurred by additional instructions.

**Store-to-Load-Forwarding**

When a store operation is executed on a CPU, this value is not directly written to main memory.
First, it is put in the store-buffer, from there it may go to a cache-line (e.g. in L1), move
to slower caches (e.g. L2) and eventually, it maybe written to main memory. If a later store
overwrites an earlier store, and the earlier store has not yet reached main memory, it could
be that the earlier store is already replaced with the later store in the store-buffer, or one
of the caches - and the earlier store may never reach the main memory, and maybe not even the
cache.

When a load is executed, the CPU thus also does not have to load from main memory if the data
is available in one of the caches. Loading from cache is much faster than loading from main
memory. But even more interestingly: the CPU can already load values from the store-buffer in
some cases. This can cut down the store-load latency drastically. For example:

```
    store(adr, val);
    val = load(adr);
```

If the store would first have to complete before the load could be executed, we may have to wait many
CPU cycles before the store reaches the L1 cache. But the store is already in the store-buffer, and
we can directly forward the value from there, completing the load much quicker, possibly before the
store even reaches the L1 cache. This optimization, of loading from the store-buffer directly, is called
store-to-load-forwarding, or store-forwarding.

Why would anyone load from the same address that they just stored to?
- Stack spilling and passing arguments via the stack. In both cases we cannot or do not want to carry the values with a register.
- Missing compiler optimization.
- Compiler cannot statically prove that the addresses are identical. But at runtime they happen to be identical, and the CPU can detect this and forward the store data to the load.

There are some limitations to this forwarding optimization. Generally, there are two rules:
- The load must have the same starting address as the earlier store.
- The loaded data must be fully contained in the stored data.

The rules are so restrictive to allow the implementation in the CPU to be very simple and fast.
For example, the starting address can be compared exactly, and if a store-to-load-forwarding
succeeds, all the forwarded data comes from the store value (possibly truncated).

A few examples:

```
    // 1) Store and load same number of bytes from same starting address -> expect success.
    store_8_bytes(adr, val_8_bytes);
    val_8_bytes = load_8_bytes(adr);

    // 2) Store and load not from same starting address -> expect failure.
    store_8_bytes(adr, val_8_bytes);
    val_8_bytes = load_8_bytes(adr + 1);

    // 3) Store and load from same starting address, store more bytes than load -> expect success.
    store_8_bytes(adr, val_8_bytes);
    val_4_bytes = load_4_bytes(adr);

    // 4) Store and load from same starting address, store fewer bytes than load -> expect failure.
    store_4_bytes(adr, val_4_bytes);
    val_8_bytes = load_8_bytes(adr);

    // 5) Load upper bytes from a larger store -> not same starting address -> expect failure.
    store_8_bytes(adr, val_8_bytes);
    val_4_bytes = load_4_bytes(adr + 4);
```

When the CPU detects a store-load dependency (because the memory regions overlap), but the
store-to-load-forwarding fails, then the load must stall until the store arrives at the L1
cache. This is a penalty of many CPU cycles and increases the load-latency significantly.

There are some ways to avoid this penalty:
- Avoid multiple small loads after a large store in the same area: the multiple small loads will not all have the same address as the store. The forwarding will fail and the loads will have a higher latency. Instead do a large load and then shift/mask and register copy the value.
- Make sure that the loads have the same alignment and size as the stores. It is better to recombine loads with mask/shift/register copy than to have the penalties of a failed store-forward.

Basically: it can be advantageous to add some extra shift/mask instructions. They do of course increase the
latency by a cycle or two, but this is much better than the many CPU cycles lost in the penalty of a failed
store-forward.

My source for this section is the
[Intel Software Optimization Manual](https://cdrdv2.intel.com/v1/dl/getContent/671488)
from [here](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html),
in section 3.6.4, and 3.6.4.1 for restrictions on size and alignment.

**Performance Regression when Vectorization incurs penalty of failed store-forward**

It turns out that the penalties of failed store-forward is yet another reason why vectorization is not always profitable.
Let us look at a benchmark and the performance measured on my `11th Gen Intel(R) Core(TM) i7-11850H @ 2.50GHz`, an x64
machine with Ubuntu. Though similar behaviour can be experienced on other x64 machines, and on aarch64 machines, and
probably on many other platforms that implement store-to-load-forwarding.

I ran the following benchmark for `OFFSET = 0 ... 20`, both with `UseSuperWord` enabled and disabled, i.e. `vector` and `scalar` loops.

```
    for (int i = 10; i < SIZE; i++) {
        aI[i] = aI[i - OFFSET] + 1;
    }
```

I am contributing this benchmark in [JDK-8335006](https://bugs.openjdk.org/browse/JDK-8335006).

Here are the results, for array length `size = 2048`:

![image](https://github.com/eme64/blog/assets/32593061/eeaf8653-ffcb-4dc5-ac33-5b40aa3701b1)

We can see that for both array lengths there are a similar trends:
- For `OFFSET = 0` we always get the lowest numbers, because there are no loop-carried dependencies, every iteration is completely independent.
- The scalar loops get slower with `OFFSET = 1` because the load of iteration `i` depends on the store of iteration `i-1`. It seems that store-to-load-forwarding is successful here, but none the less, all iterations are executed sequentially.
- The scalar loops are maximally slow at `OFFSET = 2`, where we have loop-carried dependencies at distance 2, i.e. the load of iteration `i` depends on the store of iteration `i-2`. I would have expected `OFFSET = 1` to be slower than `OFFSET = 2`, because iterations `i-1` and `i` can be executed in parallel. But `OFFSET = 2` is clearly slower, and I am not sure why.
- The scalar loops get faster and faster with `OFFSET = 3 .. 20`, asymptotically approaching the performance of `OFFSET = 0`. This is because the loop-carried dependencies are at greater and greater distances, allowing more and more iterations to be performed in parallel, utilizing the CPU pipeline more fully.
- The vector loops trivially have the best performance with `OFFSET = 0` because the iterations are fully parallel and maximal size vectors can be used (on my avx512 machine we can hold 64 bytes, or 16 ints in a single register).
- At `OFFSET = 1`, vectorization is roughly at parity with the scalar loop. There is no parallelization to be extracted because of the loop-carried dependency at distance 1.
- At `OFFSET = 2`, vectorization outperforms the scalar loop, because we can use vectors with 2 int-lanes. The loads from iterations `i, i+1` can perfectly be forwarded from the stores of iterations `i-2, i-1`.
- At `OFFSET = 3`, we see that vectorization suddenly is horribly slow compared to the scalar loop. Since we have a loop-carried dependency at distance 3, we can have vectors with at most 3 lanes, but we only use 2-lane-vectors because the number of vector lanes must be a power-of-2. Thus, we load from indices `[i-3, i-2]`, `[i-1, i]`, `[i+1, i+2]` ... and store to indices `[i, i+1]`, `[i+2, i+3]`, `[i+4, i+5]`. We see that the starting addresses of the loads and stores are never the same. The loads and stores always only partially overlap. This is the worst case: a load `[i+1, i+2]` depends on both stores `[i, i+1]` and `[i+2, i+3]`, but the load cannot be store-forwarded. This incurres the failed store-forward penalty, and the load stalls for those two stores to reach the L1 cache.
- At `OFFSET = 4, 8, 16` we see that vectorization outperforms the scalar loop. The loop-carried dependencies are exactly a power-of-2, which means we can use exactly that many vector lanes, and the stores align perfectly with the loads. Thus, store-to-load-forwarding always succeeds.
- At `OFFSET = 5..7, 9..15, 17..20`, we have loop-carried dependencies that are not power-of-2, thus we use vectors with 4, 8, 16 lanes. The loads and stores thus do not perfectly align, and store-forwarding fails. However, the larger the loop-carried distance, the less relevant is the increased latency between dependent stores and loads. We see three distinct blocks: `5..7`, `9..15`, and `17..20`, with better and better performance, as the loop-carried dependency distance and therefore the level of parallelism increase.

Thus, we see that vectorization is only beneficial for `OFFSET = 0, 1, 2, 4, 8, 16`, at least with the current SuperWord implementation.
The regression for `OFFSET = 3` is especially stark.

**A few details about JDK-8334431**

The regression discovered in [JDK-8334431](https://bugs.openjdk.org/browse/JDK-8334431) interestingly only seemed to impact machines that do not have
the `sha` CPU feature. That means they do not support the SHA intrinsics which are about 3x faster than the corresponding C2 compiled Java code.
In that Java code, there is
[this loop](https://github.com/openjdk/jdk/blob/642084629a9a793a055cba8a950fdb61b7450093/src/java.base/share/classes/sun/security/provider/SHA.java#L158):

```
    for (int t = 16; t <= 79; t++) {
        int temp = W[t-3] ^ W[t-8] ^ W[t-14] ^ W[t-16];
        W[t] = Integer.rotateLeft(temp, 1);
    }
```

Note in particular the load from `W[t-3]` and store to `W[t]`. This creates a loop-carried dependency at distance 3, which ends up with the same exact
regression as we got in the benchmark above with `OFFSET = 3`.
This loop only starts to be vectorized with [JDK-8325155](https://bugs.openjdk.org/browse/JDK-8325155), after which we allow the vectorization of
multiple loads with different constant offsets, here: `W[t-3] ^ W[t-8] ^ W[t-14] ^ W[t-16]`.

However, the benchmark above already has a "regression" with vectorization before [JDK-8325155](https://bugs.openjdk.org/browse/JDK-8325155), so
we should address this more holistically. Reverting [JDK-8325155](https://bugs.openjdk.org/browse/JDK-8325155) would only solve a few cases that
have now been revealed.

**Possible Solutions**

We should try to detect which store-load dependencies would fail store-to-load-forwarding.
This could be done relatively easily in SuperWord, and even in IGVN as well.

Possible Solutions:
- Integrate the additional latency of a load with filed store-forward into the cost-model I will soon introduce in the AutoVectorizer (SuperWord). This cost-model predicts the runtime of the scalar loop versus the vectorized loop, and only applies the vectorization if profitable. However, I had originally planned to only do throughput based cost modeling, i.e. adding up the individual cost per instruction. But we could, and maybe should also do latency based cost modeling, which determines the path with largest latency.
- Optimize the problematic load. Possibly replace it with other loads, or directly use the value from the stores, and recombine the values with mask/shift/copy. This is applicable to auto vectorization, but could additionally be an independent compiler optimization as well (e.g. in IGVN).

**Conclusion**

So far, I had only heard about the `store-buffer` in theory. It was a fascinating discovery that there can be a very heavy impact on vectorization if the store-to-load-forwarding fails, and loads are stalled until the stores are written from the `store-buffer` to L1 cache.
Loop-carried dependencies in a scalar loop usually have successful store-to-load-forwarding, because the loads and stores have the same size and are memory aligned in their byte size (e.g. ints are usually 4 byte aligned). But once we pack multiple scalar operations into vectors, we get larger loads and stores that are still only aligned at the scalar data size (e.g. 16 ints are only 4 byte aligned, and not 64 byte aligned). Whereas from 8 scalar int stores we can maybe forward 6 directly to the loads, once we have a vector store with 8 int lanes, the vector load
may only partially overlap the store data, and no data can be forwarded.

**Appendix: Generated Assembly**

I was asked to show the generated assembly.
I thought I can give you a simple stand-alone Java file with which you can experiment.

```
// Suggested to run like this:
//
//   java -XX:CompileCommand=compileonly,Benchmark::test* -Xbatch -Dsize=2048 -Doffset=0 -Diterations=1000000 Benchmark.java
//
// I often run it with additional arguments:
//
//   java -XX:CompileCommand=compileonly,Benchmark::test* -XX:CompileCommand=printcompilation,Benchmark::* -XX:CompileCommand=TraceAutoVectorization,*::*,PRECONDITIONS,BODY,POINTERS,SW_REJECTIONS,SW_INFO -Xbatch -XX:+TraceNewVectors -XX:+TraceLoopOpts -XX:+UseSuperWord -XX:CompileCommand=printassembly,Benchmark::test* -Dsize=2048 -Doffset=0 -Diterations=1000000 Benchmark.java
//
// The following arguments are interesting to play with:
//   - Enable / Disable Vectorization:     -XX:+UseSuperWord
//   - View generated assembly:            -XX:CompileCommand=printassembly,Benchmark::test*
//   - View SuperWord algorithm log:       -XX:CompileCommand=TraceAutoVectorization,*::*,PRECONDITIONS,BODY,POINTERS,SW_REJECTIONS,SW_INFO
//   - View generated vector instructions: -XX:+TraceNewVectors
//
public class Benchmark {
    static final int ITERATIONS = Integer.valueOf(System.getProperty("iterations")); // -Diterations=1000000
    static final int OFFSET     = Integer.valueOf(System.getProperty("offset"));     // -Doffset=3
    static final int SIZE       = Integer.valueOf(System.getProperty("size"));       // -Dsize=2048
    static final int START      = Math.max(0, OFFSET);
    static final int END        = Math.min(SIZE, SIZE+OFFSET);

    public static void main(String[] args) {
        int[] W = new int[SIZE];

        System.out.println("Warmup");
        for (int i = 0; i < 10_000; i++) {
            test(W);
        }

        System.out.println("Benchmark");
        long startTime = System.nanoTime();
        for (int i = 0; i < ITERATIONS; i++) {
            test(W);
        }
        long stopTime = System.nanoTime();
        System.out.println("Elapsed time (sec): " + 1e-9 * (float)(stopTime - startTime));
    }

    public static void test(int[] W) {
        for (int t = START; t < END; t++) {
            W[t] = W[t-OFFSET] + 1;
        }
    }
}
```

Here some interesting assembly snippets. I ran these with `-XX:UseAVX=2` on an x64 machine, in a debug build.
Of course the performance would be better on a product build.
I'm only showing the main-loops here, of course there is more code in the compiled method (e.g. pre and post loops).

```
// -XX:+UseSuperWord -Dsize=2048 -Doffset=0 -Diterations=10000000
// Loop is unrolled 8x.
// Full vectorization, using 32 byte ymm registers holding 8 ints each.
// Super-unrolling of vectorized loop another 8x -> total 64x unrolling.
// Elapsed time (sec): 1.294545152

 ;; B10: #	out( B11 ) <- in( B11 ) top-of-loop Freq: 2047.99
  0x00007ff73cbb3191:   mov    %r9d,%r8d                    ;*aload_0 {reexecute=0 rethrow=0 return_oop=0}
                                                            ; - Benchmark::test@11 (line 41)
 ;; B11: #	out( B10 B12 ) <- in( B9 B10 ) Loop( B11-B10 inner main of N56) Freq: 2048.99
  0x00007ff73cbb3194:   vpaddd 0x10(%rsi,%r8,4),%ymm0,%ymm1
  0x00007ff73cbb319b:   vmovdqu %ymm1,0x10(%rsi,%r8,4)
  0x00007ff73cbb31a2:   vpaddd 0x30(%rsi,%r8,4),%ymm0,%ymm1
  0x00007ff73cbb31a9:   vmovdqu %ymm1,0x30(%rsi,%r8,4)
  0x00007ff73cbb31b0:   vpaddd 0x50(%rsi,%r8,4),%ymm0,%ymm1
  0x00007ff73cbb31b7:   vmovdqu %ymm1,0x50(%rsi,%r8,4)
  0x00007ff73cbb31be:   vpaddd 0x70(%rsi,%r8,4),%ymm0,%ymm1
  0x00007ff73cbb31c5:   vmovdqu %ymm1,0x70(%rsi,%r8,4)
  0x00007ff73cbb31cc:   vpaddd 0x90(%rsi,%r8,4),%ymm0,%ymm1
  0x00007ff73cbb31d6:   vmovdqu %ymm1,0x90(%rsi,%r8,4)
  0x00007ff73cbb31e0:   vpaddd 0xb0(%rsi,%r8,4),%ymm0,%ymm1
  0x00007ff73cbb31ea:   vmovdqu %ymm1,0xb0(%rsi,%r8,4)
  0x00007ff73cbb31f4:   vpaddd 0xd0(%rsi,%r8,4),%ymm0,%ymm1
  0x00007ff73cbb31fe:   vmovdqu %ymm1,0xd0(%rsi,%r8,4)
  0x00007ff73cbb3208:   vpaddd 0xf0(%rsi,%r8,4),%ymm0,%ymm1
  0x00007ff73cbb3212:   vmovdqu %ymm1,0xf0(%rsi,%r8,4)      ;*iastore {reexecute=0 rethrow=0 return_oop=0}
                                                            ; - Benchmark::test@22 (line 41)
  0x00007ff73cbb321c:   lea    0x40(%r8),%r9d
  0x00007ff73cbb3220:   cmp    $0x7c1,%r9d
  0x00007ff73cbb3227:   jl     0x00007ff73cbb3191           ;*if_icmpge {reexecute=0 rethrow=0 return_oop=0}
                                                            ; - Benchmark::test@8 (line 40)
```

```
// -XX:-UseSuperWord -Dsize=2048 -Doffset=0 -Diterations=10000000
// Unrolled 8x scalar loop.
// We have 8 "incl" instructions that directly operate on a memory address: load, inc, store.
// Elapsed time (sec): 6.64991232

 ;; B7: #	out( B8 ) <- in( B8 ) top-of-loop Freq: 2047.99
  0x00007fca10bb3013:   mov    %r10d,%r8d                   ;*aload_0 {reexecute=0 rethrow=0 return_oop=0}
                                                            ; - Benchmark::test@11 (line 41)
 ;; B8: #	out( B7 B9 ) <- in( B6 B7 ) Loop( B8-B7 inner main of N40) Freq: 2048.99
  0x00007fca10bb3016:   incl   0x10(%rsi,%r8,4)
  0x00007fca10bb301b:   incl   0x14(%rsi,%r8,4)
  0x00007fca10bb3020:   incl   0x18(%rsi,%r8,4)
  0x00007fca10bb3025:   incl   0x1c(%rsi,%r8,4)
  0x00007fca10bb302a:   incl   0x20(%rsi,%r8,4)
  0x00007fca10bb302f:   incl   0x24(%rsi,%r8,4)
  0x00007fca10bb3034:   incl   0x28(%rsi,%r8,4)
  0x00007fca10bb3039:   incl   0x2c(%rsi,%r8,4)             ;*iastore {reexecute=0 rethrow=0 return_oop=0}
                                                            ; - Benchmark::test@22 (line 41)
  0x00007fca10bb303e:   lea    0x8(%r8),%r10d
  0x00007fca10bb3042:   cmp    $0x7f9,%r10d
  0x00007fca10bb3049:   jl     0x00007fca10bb3013           ;*goto {reexecute=0 rethrow=0 return_oop=0}
                                                            ; - Benchmark::test@26 (line 40)
```

```
// -XX:+UseSuperWord -Dsize=2048 -Doffset=3 -Diterations=10000000
// Loop unrolled 8x.
// Vectorization: because of loop-carried dependency at distance 3, only 2-element-vectors are used.
// vmovq: load/store 8 bytes.
// - loads at offsets: 0x4, 0xc, 0x14, 0x1c
// - stores at offsets: 0x10, 0x18, 0x20, 0x28
// -> all loads are 8 byte, and overlap with two stores, each only with a 4 byte overlap.
// -> this creates a store-load dependency, but store-to-load-forwarding-fails
// -> slow, because load stalls until store reaches L1 cache
// Elapsed time (sec): 88.33141964800001

 ;; B16: #	out( B17 ) <- in( B17 ) top-of-loop Freq: 2047.98
  0x00007f2d10bb3290:   mov    %r8d,%r10d                   ;*aload_0 {reexecute=0 rethrow=0 return_oop=0}
                                                            ; - Benchmark::test@11 (line 41)
 ;; B17: #	out( B16 B18 ) <- in( B15 B16 ) Loop( B17-B16 inner main of N62) Freq: 2048.98
  0x00007f2d10bb3293:   vmovq  0x4(%rsi,%r10,4),%xmm1
  0x00007f2d10bb329a:   vpaddd %xmm0,%xmm1,%xmm1
  0x00007f2d10bb329e:   vmovq  %xmm1,0x10(%rsi,%r10,4)
  0x00007f2d10bb32a5:   vmovq  0xc(%rsi,%r10,4),%xmm1
  0x00007f2d10bb32ac:   vpaddd %xmm0,%xmm1,%xmm1
  0x00007f2d10bb32b0:   vmovq  %xmm1,0x18(%rsi,%r10,4)
  0x00007f2d10bb32b7:   vmovq  0x14(%rsi,%r10,4),%xmm1
  0x00007f2d10bb32be:   vpaddd %xmm0,%xmm1,%xmm1
  0x00007f2d10bb32c2:   vmovq  %xmm1,0x20(%rsi,%r10,4)
  0x00007f2d10bb32c9:   vmovq  0x1c(%rsi,%r10,4),%xmm1
  0x00007f2d10bb32d0:   vpaddd %xmm0,%xmm1,%xmm1
  0x00007f2d10bb32d4:   vmovq  %xmm1,0x28(%rsi,%r10,4)      ;*iastore {reexecute=0 rethrow=0 return_oop=0}
                                                            ; - Benchmark::test@22 (line 41)
  0x00007f2d10bb32db:   lea    0x8(%r10),%r8d
  0x00007f2d10bb32df:   cmp    $0x7f9,%r8d
  0x00007f2d10bb32e6:   jl     0x00007f2d10bb3290           ;*goto {reexecute=0 rethrow=0 return_oop=0}
                                                            ; - Benchmark::test@26 (line 40)
```

```
// -XX:-UseSuperWord -Dsize=2048 -Doffset=3 -Diterations=10000000
// Scalar loop unrolled 8x
// mov: load/store 4 bytes
//  - load at offset:  0x4, 0x8, 0xc, 0x10, 0x14, 0x18, 0x1c, 0x20
//  - store at offset: 0x10, 0x14, 0x18, 0x1c, 0x20, 0x24, 0x28, 0x2c
// -> all loads align perfectly with a previous store -> perfect store-to-load-forwarding
// -> While this scalar loop has double as many instructions compared to the vectorized version
//    above (a priori fewer instructions is faster), avoiding the failed store-forward penalty
//    is more important.
// Elapsed time (sec): 20.517240832000002

 ;; B13: #	out( B14 ) <- in( B14 ) top-of-loop Freq: 2047.98
  0x00007f24f0bb31a0:   mov    %r11d,%r10d                  ;*aload_0 {reexecute=0 rethrow=0 return_oop=0}
                                                            ; - Benchmark::test@11 (line 41)
 ;; B14: #	out( B13 B15 ) <- in( B12 B13 ) Loop( B14-B13 inner main of N59) Freq: 2048.98
  0x00007f24f0bb31a3:   mov    0x4(%rsi,%r10,4),%r8d
  0x00007f24f0bb31a8:   inc    %r8d
  0x00007f24f0bb31ab:   mov    %r8d,0x10(%rsi,%r10,4)
  0x00007f24f0bb31b0:   mov    0x8(%rsi,%r10,4),%r8d
  0x00007f24f0bb31b5:   inc    %r8d
  0x00007f24f0bb31b8:   mov    %r8d,0x14(%rsi,%r10,4)
  0x00007f24f0bb31bd:   mov    0xc(%rsi,%r10,4),%r8d
  0x00007f24f0bb31c2:   inc    %r8d
  0x00007f24f0bb31c5:   mov    %r8d,0x18(%rsi,%r10,4)
  0x00007f24f0bb31ca:   mov    0x10(%rsi,%r10,4),%r8d
  0x00007f24f0bb31cf:   inc    %r8d
  0x00007f24f0bb31d2:   mov    %r8d,0x1c(%rsi,%r10,4)
  0x00007f24f0bb31d7:   mov    0x14(%rsi,%r10,4),%r8d
  0x00007f24f0bb31dc:   inc    %r8d
  0x00007f24f0bb31df:   mov    %r8d,0x20(%rsi,%r10,4)
  0x00007f24f0bb31e4:   mov    0x18(%rsi,%r10,4),%r8d
  0x00007f24f0bb31e9:   inc    %r8d
  0x00007f24f0bb31ec:   mov    %r8d,0x24(%rsi,%r10,4)
  0x00007f24f0bb31f1:   mov    0x1c(%rsi,%r10,4),%r8d
  0x00007f24f0bb31f6:   inc    %r8d
  0x00007f24f0bb31f9:   mov    %r8d,0x28(%rsi,%r10,4)
  0x00007f24f0bb31fe:   mov    0x20(%rsi,%r10,4),%r8d       ;   {no_reloc}
  0x00007f24f0bb3203:   inc    %r8d
  0x00007f24f0bb3206:   mov    %r8d,0x2c(%rsi,%r10,4)       ;*iastore {reexecute=0 rethrow=0 return_oop=0}
                                                            ; - Benchmark::test@22 (line 41)
  0x00007f24f0bb320b:   lea    0x8(%r10),%r11d
  0x00007f24f0bb320f:   cmp    $0x7f9,%r11d
  0x00007f24f0bb3216:   jl     0x00007f24f0bb31a0           ;*goto {reexecute=0 rethrow=0 return_oop=0}
                                                            ; - Benchmark::test@26 (line 40)
```

Feel free to play around with other parameters and other platforms.


<script src="https://utteranc.es/client.js"
        repo="blog"
        issue-term="pathname"
        theme="github-light"
        crossorigin="anonymous"
        async>
</script>
