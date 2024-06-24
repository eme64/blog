---
title: "Auto-Vectorization and Store-to-Load-Forwarding"
date: 2024-06-24
---

I habe been working a lot on Hotspot JVM C2's autovectorization, and intend to continue with that.
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
        a[i] = (int)(b[i] + a[i+1]);
    }
```

Allowing more loops to vectorize generally unlocks speedups, but there is always a risk that there are
some special-cases where vectorization leads to a regression, and that is what happened here.

**Auto-Vectorization**

This is just a quick recap - feel free to read more in my other blog posts about how SuperWord works.
The basic idea is to pack many scalar operations into a vercot operation, and thus reduce the number
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
memory. But even more interestingly: we can already load values from the store-buffer in
some cases. This can cut down the store-load latency drastically. For example:

```
    store(adr, val);
    val = load(adr);
```

If the store would first have to complete before the load could be executed, we may have to wait many
CPU cycles before the store reaches the L1 cache. But the store is already in the store-buffer, and
we can direcly forward the value from there, completing the load much quicker, possibly before the
store even reaches the L1 cache. This optimization, of loading from the store-buffer directly, is called
store-to-load-forwarding.
You can reference the [Intel Software Optimization Manual](https://cdrdv2.intel.com/v1/dl/getContent/671488)
from [here](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html),
section 3.6.4, and 3.6.4.1 for restrictions on size and alignment.

There are some limitations to this optimization. Generally, there are two rules:
- The load must have the same starting address as the earlier store.
- The loaded data must be fully contained in the stored data.

TODO: explain it, and the restrictions. Mention Intel manual, and maybe ARMs?

**Performance Regression when Vectorization incurs penalty due to failed store-forward**

TODO: show example, and some benchmarks.


