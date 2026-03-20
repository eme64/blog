---
title: "Vectorizing Simple Algorithms with Auto Vectorization, Vectorized Intrinsics and the Vector API"
date: 2026-03-20
---

In this blog post, we will look at some very simple algorithms like `fill`, `copy`, `map` and `iota`,
and see how we can vectorize them to get speedups.
I will assume that you already have some basic understanding of automatic vectorization,
vectorized intrinsics and the Vector API, otherwise
[please read this blog post first](https://eme64.github.io/blog/2026/03/19/Hotspot-JVM-Vectorization.html).

For each of the examples, we will follow these steps:

- Reference Implementation: the simplest implementation, just a simple loop. That gives us a ground truth to test other implementations, as well as a performance baseline. We should also check if this simple implementation already is auto vectorized - it may already give us really good performance.
- Core library method: see if we can find one with a vectorized intrinsic.
- Vector API: only now do we invest the additional time it takes to rewrite the algorithm using the Vector API. In these very simple cases, we will probably not get any speedup, because the reference implenetation is already auto vectorized, or the vectorized intrinsic is at least as performant.

Note: all of the benchmarks are [integrated in the OpenJDK github repository](https://github.com/openjdk/jdk/pull/28639).
Below, I will slightly simplify some of the code so it is easier to read.

It is also important to note: I present the some performance numbers for two different machines.
We can see that the results differ significantly, and may be different again on your machine.

**Algorithm 1: Fill**

We fill every element in the int array `r` with the value `42`.

Reference implementation (special case: detected as fill loop, and replaced with call to vectorized fill intrinsic):
```java
for (int i = 0; i < r.length; i++) {
    r[i] = 42;
}
```

Core library method (backed by vectorized intrinsic):
```java
Arrays.fill(r, 42);
```

Vector API implementation:
```java
var v = IntVector.broadcast(SPECIES_I, 42);
int i = 0;
for (; i < SPECIES_I.loopBound(r.length); i += SPECIES_I.length()) {
    v.intoArray(r, i);
}
for (; i < r.length; i++) {
    r[i] = 42;
}
```
We broadcast the number `42` to all elements of the vector, and are now able to fill multiple elements
of the array with a single vector store (`intoArray`).
We have to use two loops: the length of the array `r` may not be evenly divisible by the
length of the vector `v`. We use `loopBound` to determine up to where we can use
vectors, and handle the remaining iterations in the scalar cleanup loop.
Writing two loops is cumbersome. You could use [VectorMask.indexInRange](https://docs.oracle.com/en/java/javase/26/docs/api/jdk.incubator.vector/jdk/incubator/vector/VectorMask.html#indexInRange(int,int)),
to generate a mask that is always on except for when you are about to step over the loop bound.
But always running with masked operations is expensive.
For now, you will get best performance with two loops, but
[in the future we might find ways to optimize](https://bugs.openjdk.org/browse/JDK-8378315)
`VectorMask.indexInRange` for such loops.

Running the benchmark on an array with `10000` elements on my `x64 AVX512` laptop, and a `aarch64 NEON` OCI machine:

<img width="700" alt="fill performance results 10000 elements" src="https://github.com/user-attachments/assets/0ae3f043-560e-4d2d-b93e-cc9f3545f98f" />

Comment: the compiler detects that the reference implementation loop is an array fill operation, and automatically replaces it with a call to the intrinsic!
This is a bit of a special case - usually the JVM only uses intriniscs for core library methods, and not hand-written Java loops.
We can disable the intrinsic for the loop and also the `Arrays.fill` with the VM flag `-XX:-OptimizeFill`.
With the intrinsic disabled, now the auto vectorizer kicks in.
We can disable the auto vectorizer with the VM flag `-XX:-UseSuperWord`.
Now we get the pure scalar performance.

Observations:

- Vectorization is always better compared to scalar performance, but the exact speedup varies.
- For `fill` and this input size, it does not seem to make a difference if we use the intrinsic or auto vectorize.
- The Vector API implementaiton is sensitive to alignment on AVX512: we get a bimodal performance distribution - if the first element of the array is cacheline aligned we get the best performance, but if it is not aligned we get significantly worse performance. Array alignment is essentially random, and so sometimes you get good performance and sometimes not. Auto vectorization and vectorized intrinsics are not sensitive to alignment, because they have an automatic alignment feature. [Read more about alignment here](https://eme64.github.io/blog/2026/01/12/Alignment-Performance.html). Recommendation for benchmarking: make sure you run the benchmark multiple times, with new allocations of the arrays, so you get the average performance.

Running the same experiment with a smaller array with only `300` elements:

<img width="700" alt="fill performance results 300" src="https://github.com/user-attachments/assets/cb6b45b2-4c60-4e86-b444-610ceac4bccd" />

The general trends are the same, but with a smaller number of loop iterations the speedup is a little less strong.
On AVX512, the intrinisic seems to perform a bit better than the auto vectorizer.

**Algorithm 2: Copy**

We copy data from array `a` to array `r`.

We assume that the two arrays are different arrays.
Read [this blog post about aliasing](https://eme64.github.io/blog/2026/01/14/Aliasing.html),
that discusses what we have to do
if the arrays might be the same, and the memory that we copy from
and to might overlap. There have been some JDK26 improvements
in the auto vectorizer to enable the optimization of such possibly
aliasing cases.

Reference implementation (should be auto vectorized):
```java
for (int i = 0; i < r.length; i++) {
    r[i] = a[i];
}
```

Core library method (backed by vectorized intrinsic):
```java
System.arraycopy(a, 0, r, 0, a.length);
```

Vector API implementation:
```java
int i = 0;
for (; i < SPECIES_I.loopBound(r.length); i += SPECIES_I.length()) {
    IntVector v = IntVector.fromArray(SPECIES_I, a, i);
    v.intoArray(r, i);
}
for (; i < r.length; i++) {
    r[i] = a[i];
}
```

Running the benchmark on an array with `10000` elements on my `x64 AVX512` laptop, and a `aarch64 NEON` OCI machine:

<img width="700" alt="copy performance 10000" src="https://github.com/user-attachments/assets/74db8491-7e4a-4749-a8d6-986acf5dd7e8" />

Running the same experiment with a smaller array with only `300` elements:

<img width="700" alt="copy performance 300" src="https://github.com/user-attachments/assets/c17f6323-59d9-486f-8545-d60ed7cd682b" />

The gains from vectorization are significant. The difference between the vectorized alternatives only marginal - at least for
the sizes of arrays we chose here.

**Algorithm 3: Map**

This is a generalization of `copy`: we perform some element-wise operation to every element
of the input array `a`, and store the results in an output array `r`.
Here, we multiply by `42`, but there is a large range of operators and expressions that
can be vectorized. If you find a shape that is not auto vectorized, please report it to us!

Reference implementation (should be auto vectorized):
```java
for (int i = 0; i < r.length; i++) {
    r[i] = a[i] * 42;
}
```

Vector API implementation:
```java
int i = 0;
for (; i < SPECIES_I.loopBound(r.length); i += SPECIES_I.length()) {
    IntVector v = IntVector.fromArray(SPECIES_I, a, i);
    v = v.mul(42);
    v.intoArray(r, i);
}
for (; i < r.length; i++) {
    r[i] = a[i] * 42;
}
```

Running the benchmark on an array with `300` elements on my `x64 AVX512` laptop, and a `aarch64 NEON` OCI machine:

<img width="550" alt="map performance 300" src="https://github.com/user-attachments/assets/0cb8b03e-c264-4e9e-b14a-73cc3f8036a2" />


**Algorithm 4: Iota ()**

Reference implementation (should be auto vectorized):
```java
for (int i = 0; i < r.length; i++) {
    r[i] = i;
}
```

Vector API implementation:
```java
var iota = IntVector.broadcast(SPECIES_I, 0).addIndex(1);
int i = 0;
for (; i < SPECIES_I.loopBound(r.length); i += SPECIES_I.length()) {
    iota.intoArray(r, i);
    iota = iota.add(SPECIES_I.length());
}
for (; i < r.length; i++) {
    r[i] = i;
}
```

Running the benchmark on an array with `10000` elements on my `x64 AVX512` laptop, and a `aarch64 NEON` OCI machine:

TODO

**Conclusion**

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
