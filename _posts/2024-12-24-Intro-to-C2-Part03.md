---
title: "Introduction to HotSpot JVM C2 JIT Compiler, Part 3"
date: 2025-01-23
---

I assume that you have already looked at
[Part 0](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part00.html),
[Part 1](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part01.html), and
[Part 2](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part02.html).

In Part 3, we look at:
- TODO

[Skip forward to Part 4](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part04.html)


**Recap from Part 2**

In [Part 2](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part02.html), we saw that a C2 compilation has essencially 3 steps (see `Compile::Compile`):
- Parse and potentially inline code recursively. This gives us the C2 IR.
- `Optimize`: this is where the heavier optimizations take place.
- `Code_Gen`: we generate machine code from the IR.

We also saw that during parsing, we already perform some local optimizations / Global Value Numbering (see `PhaseGVN::transform` in
[phaseX.hpp](https://github.com/openjdk/jdk/blob/cede30416f9730b0ca106e97b3ed9a25a09d3386/src/hotspot/share/opto/phaseX.cpp#L674-L741)):
- `apply_ideal` iteratively calls `Node::Ideal` (with `can_reshape` disabled, more about that later): this tries to construct a more “ideal” (canonicalized and/or cheaper) subgraph.
- `Node::Value`: compute a tighter type, possibly constant folding the node (see `singleton`).
- `Node::Identity`: tries to find another node that “does the same thing”, and replaces the node with that node.

GVN is very important, as it canonicalizes the graph in preparation for other optimizations (they now only need to match canonical patterns, which makes writing optimizations easier). And it performs local optimizations, such as constant folding.
Further, it already simplifies the IR graph, and keeps it smaller.

**Getting an overview with the CITime flag**

The `-XX:+CITime` flag collects timing information about compilation, i.e. it measures how much time was spent on which optimizations.
A JIT compiler needs to have fast compilation, so that we do not spent too many compute resources on compilation that we could otherwise
spend on program execution.
But at this point, the flag also gives us a nice overview over the C2 compilation steps.

Let's work with an example:

```java
public class Test {
    public static void main(String[] args) {
        // Especially with a debug build, the JVM startup can take a while,
        // so it can take a while until our code is executed.
        System.out.println("Run");

        // Repeatedly call the test method, so that it can become hot and
        // get JIT compiled.
        int[] array = new int[10_000];
        for (int i = 0; i < 10_000; i++) {
            test(array);
        }
        System.out.println("Done");
    }

    public static void test(int[] array) {
        // Add 42 to every element in the array: load, add, store
        for (int i = 0; i < array.length; i++) {
            array[i] += 42;
        }
    }
}
```

We execute it with `XX:+CITime`, and `-XX:RepeatCompilation=1000` to artificially repeat each compilation 1000x, so that we get a more stable measurement of the compile times:
```
java -XX:CompileCommand=printcompilation,Test::* -XX:CompileCommand=compileonly,Test::test -Xbatch -XX:-TieredCompilation -XX:+CITime -XX:RepeatCompilation=1000 Test.java
CompileCommand: PrintCompilation Test.* bool PrintCompilation = true
CompileCommand: compileonly Test.test bool compileonly = true
Run
4603   85 %  b        Test::test @ 2 (23 bytes)
15492   86    b        Test::test (23 bytes)
Done

Individual compiler times (for compiled methods only)
------------------------------------------------

  C2 {speed:  2.087 bytes/s; standard: 11.158 s, 23 bytes, 1 methods; osr: 10.888 s, 23 bytes, 1 methods; nmethods_size: 2680 bytes; nmethods_code_size: 1488 bytes}

Individual compilation Tier times (for compiled methods only)
------------------------------------------------

  Tier1 {speed:  0.000 bytes/s; standard:  0.000 s, 0 bytes, 0 methods; osr:  0.000 s, 0 bytes, 0 methods; nmethods_size: 0 bytes; nmethods_code_size: 0 bytes}
  Tier2 {speed:  0.000 bytes/s; standard:  0.000 s, 0 bytes, 0 methods; osr:  0.000 s, 0 bytes, 0 methods; nmethods_size: 0 bytes; nmethods_code_size: 0 bytes}
  Tier3 {speed:  0.000 bytes/s; standard:  0.000 s, 0 bytes, 0 methods; osr:  0.000 s, 0 bytes, 0 methods; nmethods_size: 0 bytes; nmethods_code_size: 0 bytes}
  Tier4 {speed:  2.087 bytes/s; standard: 11.158 s, 23 bytes, 1 methods; osr: 10.888 s, 23 bytes, 1 methods; nmethods_size: 2680 bytes; nmethods_code_size: 1488 bytes}

Accumulated compiler times
----------------------------------------------------------
  Total compilation time   :  22.045 s
    Standard compilation   :  11.158 s, Average : 11.158 s
    Bailed out compilation :   0.000 s, Average : 0.000 s
    On stack replacement   :  10.888 s, Average : 10.888 s
    Invalidated            :   0.000 s, Average : 0.000 s

    C2 Compile Time:       21.914 s
       Parse:                 0.663 s
       Optimize:             16.682 s
         Escape Analysis:       0.000 s
           Conn Graph:            0.000 s
           Macro Eliminate:       0.000 s
         GVN 1:                 0.359 s
         Incremental Inline:    0.000 s
           IdealLoop:             0.000 s
          (IGVN:                  0.000 s)
          (Inline:                0.000 s)
          (Prune Useless:         0.000 s)
           Other:                 0.000 s
         Vector:                0.000 s
           Box elimination:     0.000 s
             IGVN:              0.000 s
             Prune Useless:     0.000 s
         Renumber Live:         0.000 s
         IdealLoop:            13.619 s
           AutoVectorize:       1.125 s
         IdealLoop Verify:      0.628 s
         Cond Const Prop:       0.082 s
         GVN 2:                 0.064 s
         Macro Expand:          0.238 s
         Barrier Expand:        0.028 s
         Graph Reshape:         0.102 s
         Other:                 1.560 s
       Matcher:                    0.876 s
         Post Selection Cleanup:   0.072 s
       Scheduler:                  0.851 s
       Regalloc:              1.786 s
         Ctor Chaitin:          0.002 s
         Build IFG (virt):      0.059 s
         Build IFG (phys):      0.709 s
         Compute Liveness:      0.648 s
         Regalloc Split:        0.067 s
         Postalloc Copy Rem:    0.130 s
         Merge multidefs:       0.052 s
         Fixup Spills:          0.010 s
         Compact:               0.003 s
         Coalesce 1:            0.069 s
         Coalesce 2:            0.013 s
         Coalesce 3:            0.007 s
         Cache LRG:             0.006 s
         Simplify:              0.016 s
         Select:                0.089 s
       Block Ordering:        0.046 s
       Peephole:              0.019 s
       Code Emission:           0.920 s
         Insn Scheduling:       0.000 s
         Shorten branches:      0.201 s
         Build OOP maps:        0.093 s
         Fill buffer:           0.381 s
         Code Installation:     0.000 s
         Other:                 0.245 s
       Other:                 0.071 s

  Total compiled methods    :        2 methods
    Standard compilation    :        1 methods
    On stack replacement    :        1 methods
  Total compiled bytecodes  :       46 bytes
    Standard compilation    :       23 bytes
    On stack replacement    :       23 bytes
  Average compilation speed :        2 bytes/s

  nmethod code size         :     1488 bytes
  nmethod total size        :     2680 bytes
```

In the logs we can find a few interesting things:
- There are 2 compilations of `Test::test`:
  - One `On stack replacement`, see `4603   85 %  b        Test::test @ 2 (23 bytes)` (more about OSR that later).
  - One `Standard compilation`, see `15492   86    b        Test::test (23 bytes)`
  - Note that our 1000x repetitions apply to both compilations, but that is not explicitly mentioned in the logs.
- We see that the `C2 Compile Time` is broken down into multiple parts, and those are broken down recursively.
  - `Parse`: parsing of bytecode to C2 IR graph, including GVN.
  - `Optimize`: we will look at more details below.
  - `Matcher`: TODO
  - `Scheduler`: TODO
  - `Regalloc`: register allocation.
  - `Block Ordering`: TODO
  - `Peephole`: TODO
  - `Code Emission`: TODO
- Most time is spent on `C2 Compile Time` -> `Optimize` -> `IdealLoop`, i.e. loop optimizations. This is not surprising given that our example `Test::test` consists only of a loop.

**Overview for Compile::Optimize**

Let us now turn our attention to the C2 optimization part, i.e. `Compile::Optimize` in
[compile.cpp](https://github.com/openjdk/jdk/blob/cede30416f9730b0ca106e97b3ed9a25a09d3386/src/hotspot/share/opto/compile.cpp#L2219-L2505).
First, we might notice the `TracePhase` all throughout `Compile::Optimize`.

TODO

[Continue with Part 4](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part04.html)

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
