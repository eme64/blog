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

The benchmarks for all the algorithms can be found in the [OpenJDK repository](https://github.com/openjdk/jdk/pull/29522).
For each algorithm, we first consider the scalar reference implementation,
and then look at one or more optimized implementations that use the Vector API.
All of the benchmarks use arrays with `10000` elements.

**Algorithm 1: lowerCase**

This first example is inspired by
[String::toLowerCase](https://docs.oracle.com/en/java/javase/26/docs/api/java.base/java/lang/String.html#toLowerCase()):
it converts all characters to lower case.
The input is a `byte[]` array `a` with ASCII characters, and the goal is to convert all upper case
characters to lower case characters, and leave all others unchanged. The result is stored in
a separate `byte[]` array `r`.

We determine if a character is an upper case character by checking if it is within the range
of upper case characters, with a lower bound of `'A'` and an upper bound of `'Z'`.
The transformation to lower case character happens with an addition of `32`,
which is the difference between the characters `'A'` and `'a'`.

Reference implementation:
```java
for (int i = 0; i < a.length; i++) {
    byte c = a[i];
    if (c >= 'A' && c <= 'Z') {
        c += ('a' - 'A'); // c += 32
    }
    r[i] = c;
}
```

Vector API implementation (v1), check lower and upper bound separately:
```java
for (i = 0; i < SPECIES_B.loopBound(a.length); i += SPECIES_B.length()) {
    var vc = ByteVector.fromArray(SPECIES_B, a, i);
    var maskA = vc.compare(VectorOperators.GE, (byte)'A');
    var maskZ = vc.compare(VectorOperators.LE, (byte)'Z');
    var mask = maskA.and(maskZ);
    vc = vc.add((byte)32, mask);
    vc.intoArray(r, i);
}
// omitting scalar cleanup
```

Vector API implementation (v2), transform input so we only need one bound check:
```java
for (i = 0; i < SPECIES_B.loopBound(a.length); i += SPECIES_B.length()) {
    var vc = ByteVector.fromArray(SPECIES_B, a, i);
    // We can convert the range 65..90 (represents ascii A..Z) into a range 0..25.
    // This allows us to only use a single unsigned comparison.
    var vt = vc.add((byte)-'A');
    var mask = vt.compare(VectorOperators.ULE, (byte)25);
    vc = vc.add((byte)32, mask);
    vc.intoArray(r, i);
}
// omitting scalar cleanup
```

Running on an `x64 AVX512` and an `aarch64 NEON` machine:

<img width="700" alt="lowerCase all" src="https://github.com/user-attachments/assets/5af7e58c-b50b-4672-953e-5362183d56d5" />

Focusing on only the Vector API implementations:

<img width="700" alt="lowerCase focused" src="https://github.com/user-attachments/assets/f26e76ac-f80a-442a-ab8a-9505f64fa1e3" />

We see that the Vector API implementations are clearly faster than the scalar implementation.
On AVX512 the speedup is 16x - 28x. On NEON the speedup is 12x - 26x.
Consider that on AVX512 a vector holds 64 byte elements, and on NEON a vector holds 16 byte elements.

While the x-axis shows the time, the y-axis shows the branch probability.
We generate the input randomly, but accordingly to the branch probability.
If the branch probability is high, we mostly have upper case characters (if-branch).
If the branch probability is low, we mostly have lower case characters (else-branch).
If the branch probability is in the middle, we have a random mix of upper and lower case characters.

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
