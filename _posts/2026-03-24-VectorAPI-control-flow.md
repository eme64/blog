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

Here a diagram that visualises the scalar branching computation
as well as the vector computation with masks:

<img width="700" alt="visualisation" src="https://github.com/user-attachments/assets/2eb10654-f8db-40f3-9882-a10c8ef9b42a" />

Running on an `x64 AVX512` and an `aarch64 NEON` machine:

<img width="700" alt="lowerCase all" src="https://github.com/user-attachments/assets/5af7e58c-b50b-4672-953e-5362183d56d5" />

Focusing on only the Vector API implementations:

<img width="700" alt="lowerCase focused" src="https://github.com/user-attachments/assets/f26e76ac-f80a-442a-ab8a-9505f64fa1e3" />

We see that the Vector API implementations are clearly faster than the scalar implementation.
On AVX512 the speedup is 16x - 28x. On NEON the speedup is 12x - 26x.
Consider that on AVX512 a vector holds 64 byte elements, and on NEON a vector holds 16 byte elements.

While the x-axis shows the time, the y-axis shows the branch probability.
We generate the input randomly, but accordingly to the branch probability:

- If the branch probability is high, we mostly have upper case characters (if-branch).
- If the branch probability is low, we mostly have lower case characters (else-branch).
- If the branch probability is in the middle (`0.5`), we have a random mix of upper and lower case characters.

Let's first focus on the performance characteristic of the scalar implementation.
We see that the performance depends on the branch probability:

- Low (lower case): fastest. The branch predictor works very well, and we don't have to do any additions.
- High (upper case): fast. The branch predictor works very well, but we have do to additions which has some extra cost.
- Middle (mixed): slow. The branch predictor fails 50% of the time, we suffer the branch prediction penalty.

The branch predictor is amazing: it allows the CPU to speculate if a branch is taken, based on the history.
The CPU speculatively assumes one side of the branch is taken, and already executes down that road.
Only later, the check is actually performed. If it goes as speculated: great, we win!
Not having to wait for the check to be completed means we save some CPU cycles, it cuts the latency link between
the check and the computations of the branch.
If the speculation was wrong, the CPU needs to throw away all the results after the wrong branch (pipeline flush),
and resume computation at the right branch.
This means we just wasted some CPU cycles on the wrong branch, this can be costly.

Now let's look at the Vector API performance:
Both implementations are roughly equally fast. On NEON `v2` is slightly faster than `v1`.
The branch probability has no impact on the performance
because all vectorized instructions are always executed.
The control-flow is simulated by masked operations, but there is no performance
impact if the mask entries are `true` or `false`.
On AVX512 we have some individual down-spikes.
I suspect this might be due to [(mis)alignment causing multimodal performance](https://eme64.github.io/blog/2026/01/12/Alignment-Performance.html).

What we learn from this example:
Generally, vectorization leads to speedups because of parallelization - but with a theoretical maximum of the vector length.
On NEON where we have 16 byte elements in a vector this would mean we could only gain at most a factor of 16.
But using masked vector operations, we can sometimes gain more performance:
especially if we can avoid the branch misprediction penalty that the scalar implementation suffers from
for some branch probabilities.

**Algorithm 2: pieceWise**

This example is a bit more contrived, but it shows a very interesting effect.
We want to apply a function `f(x)` to every input in the array `a`,
and store the results in the array `r`.
But the function `f` is piece-wise: for small input values we compute some multiplications, for high input values we compute some square roots.
Here a plot of the function:

<img width="600" alt="piece-wise function f" src="https://github.com/user-attachments/assets/fb587786-9dba-4333-b8b4-119a1994db5c" />

It is important to say:
computing square roots is very expensive compared to multiplications.

Reference implementation:
```java
for (int i = 0; i < a.length; i++) {
    float ai = a[i];
    if (ai < 1f) {
         float a2 = ai * ai;
         float a4 = a2 * a2;
         float a8 = a4 * a4;
         r[i] = a8;
     } else {
        float s2 = (float)Math.sqrt(ai);
        float s4 = (float)Math.sqrt(s2);
        float s8 = (float)Math.sqrt(s4);
        r[i] = s8;
    }
}
```

Vector API implementation (v1), unconditionally compute both branches for all lanes:
```java
for (i = 0; i < SPECIES_F.loopBound(a.length); i += SPECIES_F.length()) {
    var ai = FloatVector.fromArray(SPECIES_F, a, i);
    var mask = ai.compare(VectorOperators.LT, 1f);
    var a2 = ai.lanewise(VectorOperators.MUL, ai);
    var a4 = a2.lanewise(VectorOperators.MUL, a2);
    var a8 = a4.lanewise(VectorOperators.MUL, a4);
    var s2 = ai.lanewise(VectorOperators.SQRT);
    var s4 = s2.lanewise(VectorOperators.SQRT);
    var s8 = s4.lanewise(VectorOperators.SQRT);
    var v = s8.blend(a8, mask);
    v.intoArray(r, i);
}
// omitting scalar cleanup
```

Vector API implementation (v2), unconditionally compute the multiplications for all lanes, but only compute the square roots if at least one lane needs it:
```java
for (i = 0; i < SPECIES_F.loopBound(a.length); i += SPECIES_F.length()) {
    var ai = FloatVector.fromArray(SPECIES_F, a, i);
    var mask = ai.compare(VectorOperators.LT, 1f);
    var a2 = ai.lanewise(VectorOperators.MUL, ai);
    var a4 = a2.lanewise(VectorOperators.MUL, a2);
    var a8 = a4.lanewise(VectorOperators.MUL, a4);
    var v = a8;
    // SQRT is expensive, so only call if it necessary
    if (!mask.allTrue()) {
        var s2 = ai.lanewise(VectorOperators.SQRT);
        var s4 = s2.lanewise(VectorOperators.SQRT);
        var s8 = s4.lanewise(VectorOperators.SQRT);
        v = s8.blend(a8, mask);
    }
    v.intoArray(r, i);
}
// omitting scalar cleanup
```

Running on an `x64 AVX512` and an `aarch64 NEON` machine:

<img width="700" alt="piece-wise performance" src="https://github.com/user-attachments/assets/df288e08-e266-4ccc-9751-09aa7d38a34d" />

The scalar implementation has branches, so it is sensitive to the branch probability:

- Low (mostly `sqrt`): slow, becaue `sqrt` is slow.
- High (mostly `mul`): fast, because `mul` is fast.
- Middle (mixed): there is the classic branch misprediction penalty bump for NEON, though for AVX512 is is very faint.

The non-branching Vector API implementation (`v1`) is not sensitive to the branching probability.
It is faster than the scalar implementation for some but not all branching probabilities.

The branching Vector API implementation (`v2`) is the fastest implementation in almost all cases,
because it combines the benefits of vectorization with the benefits of branching to
avoid square root computation when possible.
But on NEON the scalar implementation seems to be slightly faster for branch probabilities around `0.125`.

What we can learn from this example:
We should not apply vectorization blindly.
Using masked vector operations sometimes means we have to execute both branches.
If one branch is much more expensive than the other, this can mean that
scalar branch prediction outperforms vectorized implementations,
at least for some branch probabilities.

**Algorithm 3: find**

We want to find the first occurance of some element `e` in an array `a`.
This is inspired by methods like
[String::indexOf](https://docs.oracle.com/en/java/javase/26/docs/api/java.base/java/lang/String.html#indexOf(int))
and
[List::indexOf](https://docs.oracle.com/en/java/javase/26/docs/api/java.base/java/util/List.html#indexOf(java.lang.Object)).

The previous two algorithms were both element-wise (i.e. lane-wise).
But here we have an algorithm with an early exit condition.

Reference implementation:
```java
for (int i = 0; i < a.length; i++) {
    if (a[i] == e) {
        return i;
    }
}
return -1;
```

Below we have an example with the string "voxxeddays", and we are looking for the first occurance of the character "d".
As long as we have no match we do nothing and keep going. As soon as we find the character "d" we return the current index `i`.

<img width="400" alt="find visualized" src="https://github.com/user-attachments/assets/25c1e0c2-bbe5-4f71-be61-e4c5a4b04fe8" />

Vector API implementation:
```java
int i = 0;
for (; i < SPECIES_I.loopBound(a.length); i += SPECIES_I.length()) {
    IntVector v = IntVector.fromArray(SPECIES_I, a, i);
    var mask = v.compare(VectorOperators.EQ, e);
    if (mask.anyTrue()) {
        return i + mask.firstTrue();
    }
}
// omitting scalar cleanup
return -1;
```

In our Vector API implementation, we now load a vector of input values,
possibly going beyond the first occurance of "d".
We get a mask that marks _all_ occurances of "d" (`compare`),
then check if we marked _any_ (`anyTrue`).
If we marked none, do nothing. If we marked some, find the first occurance (`firstTrue`).

<img width="400" height="find visualized Vector API" alt="image" src="https://github.com/user-attachments/assets/fa8b41a0-91a9-4d99-af54-ee73172afcaa" />

TODO perf

**Algorithm 4: mismatch**

TODO

```java
x
```

**Algorithm 5: filter**

The previous algorithms were either element-wise, where all lanes were independent,
or they had an early exit but no side-effects.
The `filter` example takes an input array `a` and keeps all elements that are at or above
the `threshold`, rejecting all other elements.
The elements that are kept are stored contiguously into an output array `r`.
The current position in the output array is tracked with the secondary
index variable `j`.

Reference implementation:
```java
int j = 0;
for (int i = 0; i < a.length; i++) {
    int ai = a[i];
    if (ai >= threshold) {
        r[j++] = ai;
    }
}
```

In the example below, we have a `threshold = 0`, so we are keeping all positive values (including zero).
Note, that the values are copied "down", we always have `j <= i`.
The secondary index variable `j` is only sometimes incremented, while the primary index variable `i` is always incremented.

<img width="400" alt="filter visualized" src="https://github.com/user-attachments/assets/9f7d2b68-0771-42fe-85e5-88cd70a47492" />

The variable `j` poses a challenge for parallelization, because it counts how many of the previous
iterations had a true-condition.
This is a so-called control-dependent loop-carried dependency: it depends on the result of
the control-flow of previous iterations.
Luckily, some CPUs have hardware instructions that perform such "filtering"
on a per-vector level, and they are available in the Vector API as `compress` operations.

Vector API implementation (`v1`), using `compress`:
```java
int j = 0;
int i = 0;
for (; i < SPECIES_I.loopBound(a.length); i += SPECIES_I.length()) {
    IntVector v = IntVector.fromArray(SPECIES_I, a, i);
    var mask = v.compare(VectorOperators.GE, threshold);
    v = v.compress(mask);
    var prefixMask = mask.compress();
    v.intoArray(r, j, prefixMask);
    j += mask.trueCount();
}
// omitting scalar cleanup
```

In the example below, we load a vector of 4 elements, and create a mask that marks which elements we want to keep.
We compress both the elements we want to keep, as well as the mask.
Now the elements we keep and the mask are "compressed" to the beginning of the vector,
and they are all adjacent.
Now that we have managent to make our elements adjacent, we can use
a masked store operation to only store those elements to the output.
Finally, we count how many elements we stored, so we can update our secondary index variable `j` accordingly.
Note: while we always consume a full vector of inputs (here 4 elements),
we may store an arbitrary number of elements (here 0-4).

<img width="350" alt="filter visualized compress" src="https://github.com/user-attachments/assets/dfd35627-4c9e-47d9-b010-49c1e595703a" />

Sadly, not all CPUs have those "filtering" assembly instructions,
and so `compress` is not (yet) handled well by the Vector API,
and we resort to a very slow fallback implementation.
Also, some CPUs don't even have masked store instructions.
Therefore, we also investigate an alternative approach below that does not require
any `compress` and also no masked store operation.

Vector API implementation (`v2_l2`), using a 2-element vector and only vectorizing the all-true case:
```java
int j = 0;
int i = 0;
for (; i < SPECIES_I64.loopBound(a.length); i += SPECIES_I64.length()) {
    IntVector v = IntVector.fromArray(SPECIES_I64, a, i);
    var mask = v.compare(VectorOperators.GE, threshold);
    if (mask.allTrue()) {
        v.intoArray(r, j);
        j += 2;
    } else if (mask.anyTrue()) {
        if (mask.laneIsSet(0)) { r[j++] = v.lane(0); }
        if (mask.laneIsSet(1)) { r[j++] = v.lane(1); }
    } else {
        // nothing
    }
}
```

Note: we can generalize the `v2` implementation to more elements (4-element: `v2_l4`, 8-element: `v2_l8`).
In each case, we have an all-true branch that can do a store without mask,
and an all-false branch that does nothing.
We call those two branches the _uniform_ branches, because the mask is either uniform-true or uniform-false.
The mixed branch we call _divergent_: we have a scalar implementation where every
lane is simulated with individual control flow. Some will take the respective true-branch,
others the respective false-branch (i.e. do nothing).

Running on an `x64 AVX512` and an `aarch64 NEON` machine:

<img width="700" alt="filter performance all" src="https://github.com/user-attachments/assets/d891238f-8a79-4296-be86-e4b6056b35c7" />

The results above show that some Vector API impelementations are significantly slower
than all other implementations. Observations on the slow cases:

- On x86 machines, we unfortunately do not yet allow 2-element masks,
and so the `v2_l2` implementation resorts to a slow scalar Java
fallback in the Vector API.
[We hope to allow 2-element masks in the future](https://bugs.openjdk.org/browse/JDK-8378589).

- On `aarch64 NEON`, the `compress` operation is not directly supported in hardware,
and we resort to a slow Java fallback implementation in the Vector API.
Also the `v2_l8` implementation resorts to the slow fallback,
because we requested a vector length of 256 bits but only 128 bit
vectors are available.
[We are currently considering solutions to these issues](https://bugs.openjdk.org/browse/JDK-8378373).

- For all of the slow cases, we can see that performance is sensitive to the branch probability
(i.e. how many elements we keep). This is because the fallback implementation in the Vector API
simulates all the vector operations with scalar operations, and uses control-flow to do so
(e.g. for `compress` and masked store operation).

Below, we focus on only the fast cases:

<img width="700" alt="filter performance fast" src="https://github.com/user-attachments/assets/2334f3b8-dff6-40d9-b289-9b5b4c022a3d" />

Observations:

- The scalar performance has the classic branch-prediction performance characteristic.
If most elements are rejected, it is fastest. If most elements are taken, it is slightly
slower because we need to store the elements. The worst performance happens with
Branch probability `0.5`, because of the branch misprediction penalty.
- The Vector API implementation (`v1`) that uses `compress` is the only implementation
that is not sensitive to the branch probability, as all operations are executed
unconditionally. It seems to generally be the most performant implementation,
except for `v2_l8` with very extreme branch probabilities.
- The `v2` implementations share the same general performance characteristics,
which are also similar to the scalar performance characteristic.
This is because `v2` has branches, and thus is sensitive to branch prediction
behavior. The longer the vector length, the better the perormance in the extreme
(high and low) branch probability region, because more elements can be taken
or rejected at a time. The 8-element vector `v2_l8` implementation thus can
even outperform the `compress` implementation, because `compress` and masked
store operations are more expensive than non-masked store operations.
- On `aarch64 NEON`, it seems the scalar performance is the best. I have
not yet investigated why, but suspect it might be that the vectorized
`allTrue` and `anyTrue` checks contribute to the overhead.

**Conclusion**

TODO

- Branch probability matters: distribution of the input values have an impact on performance.

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
