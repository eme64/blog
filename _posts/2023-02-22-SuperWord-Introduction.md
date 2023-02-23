---
title: "SuperWord (Auto-Vectorization) - An Introduction"
date: 2023-02-23
---

In 2000, Samuel Larsen and Saman Amarasinghe presented [Exploiting Superword Level Parallelism with Multimedia Instruction Sets](https://groups.csail.mit.edu/cag/slp/SLP-PLDI-2000.pdf). They auto-vectorize loops, so that multiple scalar operations can be packed into a SIMD vector instruction.

TODO: more intro here!!!

Let's look at a simple example (`Test.java`):
```
public class Test {
    static int N = 100;

    public static void main(String[] strArr) {
        float[] data0 = new float[N];
        for (int i = 0; i < 10_000; i++){
            init(data0);
            test(data0);
        }
    }

    static void test(float[] data) {
        for (int j = 0; j < N; j++) {
            data[j] = 2 * data[j]; // ------- this is vectorized
        }
    }

    static void init(float[] data) {
        for (int j = 0; j < N; j++) {
            data[j] = j;
        }
    }
}
```

Execute it like this (with a debug build), and you should see that `SuperWord` was performed, among many other loop optimizations:
```
./java -XX:CompileCommand=printcompilation,Test::test -XX:CompileCommand=compileonly,Test::test -Xbatch -XX:+TraceLoopOpts Test.java
```

Run this to see more details about the SuperWord algorithm, and its steps:
```
./java -XX:CompileCommand=printcompilation,Test::test -XX:CompileCommand=compileonly,Test::test -Xbatch -XX:+TraceSuperWord Test.java
```

I ran it with this command, and recorded it with `rr`:
```
// -XX:LoopMaxUnroll=5 limits the unrolling factor to 4x.
rr ./java -XX:CompileCommand=printcompilation,Test::test -XX:CompileCommand=compileonly,Test::test -Xbatch -XX:+TraceSuperWord -XX:+TraceLoopOpts -XX:LoopMaxUnroll=5 Test.java
rr replay

// Set breakpoint before SuperWord is applied:
(rr) b SuperWord::SLP_extract

// Extract all nodes of the loop before SuperWord is applied:
(rr) p lpt()->_head->dump_bfs(1000,lpt()->_head, "#A+$")

// Run SuperWord:
(rr) finish

// Extract all nodes of loop after SuperWord:
(rr) p cl->dump_bfs(1000,cl, "#A+$")
```

The two dumps I visualize nicely:
