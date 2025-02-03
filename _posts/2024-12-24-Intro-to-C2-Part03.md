---
title: "Introduction to HotSpot JVM C2 JIT Compiler, Part 3"
date: 2025-01-23
---

I assume that you have already looked at
[Part 0](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part00.html),
[Part 1](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part01.html), and
[Part 2](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part02.html).

In Part 3, we look at:
- `CITime` flag: measure compile time, split up into different phases.
- Overview of the optimization phases (i.e. `Compile::Optimize`).
- On Stack Replacement (OSR).

[Skip forward to Part 4](https://eme64.github.io/blog/2025/01/23/Intro-to-C2-Part04.html)

**Recap from Part 2**

In [Part 2](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part02.html), we saw that a C2 compilation has essentially 3 steps (see `Compile::Compile`):
- Parse and potentially inline code recursively. This gives us the C2 IR.
- `Optimize`: this is where the heavier optimizations take place.
- `Code_Gen`: we generate machine code from the optimized IR.

We also saw that during parsing, we already perform some local optimizations / Global Value Numbering (see `PhaseGVN::transform` in
[phaseX.hpp](https://github.com/openjdk/jdk/blob/cede30416f9730b0ca106e97b3ed9a25a09d3386/src/hotspot/share/opto/phaseX.cpp#L674-L741)):
- `apply_ideal` iteratively calls `Node::Ideal` (with `can_reshape` disabled, more about that later): this tries to construct a more “ideal” (canonicalized and/or cheaper) subgraph.
- `Node::Value`: compute a tighter type, possibly constant folding the node (see `singleton`).
- `Node::Identity`: tries to find another node that “does the same thing”, and replaces the node with that node.

GVN is very important, as it canonicalizes the graph in preparation for other optimizations (they now only need to match canonical patterns, which makes writing optimizations easier). And it performs local optimizations, such as constant folding.
Further, it already simplifies the IR graph, and keeps it smaller.

**Getting an overview of a C2 compilation with the CITime flag**

The `-XX:+CITime` flag collects timing information about a compilation, i.e. it measures how much time was spent in individual compilation phases and optimization passes.
A JIT compiler should perform a compilation of a method reasonably fast such that we do not spend too much resources on it that we could otherwise spend on the actual program execution.
The `CITime` flag can support us in this matter but also serves at giving us a nice overview over the different C2 compilation steps

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

We execute it with `-XX: CompileCommand=compileonly,Test::test` to only focus on the compilation of Test::test (as seen in part 1).
We now additionlly use `-XX:+CITime`, and `-XX:RepeatCompilation=1000` to artificially repeat the compilation of Test::test 1000 times, so that we get a more stable measurement of the compile times:
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

In the logs, we can find a few interesting things:
- There are 2 compilations of `Test::test`:
  - One `On stack replacement`, see `4603   85 %  b        Test::test @ 2 (23 bytes)` (more about OSR that later).
  - One `Standard compilation`, see `15492   86    b        Test::test (23 bytes)`
  - Note that our 1000 repetitions apply to both compilations, but that is not explicitly mentioned in the logs.
- We see that the `C2 Compile Time` is broken down into multiple phases, and those are broken down recursively.
  - `Parse`: parsing of bytecode to C2 IR graph, including GVN.
  - `Optimize`: we will look at that in more details below.
  - `Matcher`: Map the machine *in*dependent IR (which we simply called C2 IR before) to a different machine dependant IR, which we call the Mach graph (we may revisit the Mach graph, its Mach nodes, and everything that follows afterwards as part of the `Compile::Code_Gen` phases in a future blog post).
  - `Scheduler`: `PhaseCFG`, create a CFG graph of blocks.
  - `Regalloc`: `PhaseChaitin`, register allocation.
  - `Block Ordering`: `PhaseBlockLayout` / `PhaseCFG`, remove empty blocks and order the blocks.
  - `Peephole`: peephole (local) optimizations on register allocated basic blocks - only works on mach nodes.
  - `Code Emission`: Convert the Mach nodes to machine/assembly instructions and store them in a dedicated code buffer.
- Most time is spent on `C2 Compile Time` -> `Optimize` -> `IdealLoop`, i.e. loop optimizations. This is not surprising given that our example `Test::test` consists only of a single loop.

**Overview for Compile::Optimize**

Let us now turn our attention to the C2 optimization part, i.e. `Compile::Optimize` in
[compile.cpp](https://github.com/openjdk/jdk/blob/cede30416f9730b0ca106e97b3ed9a25a09d3386/src/hotspot/share/opto/compile.cpp#L2219-L2505).
I will walk through the different phases in `Compile::Optimize`. Unfortunately, the order is slightly different to that shown in the output of `CITime` - so bear with me :-)


The very first line in `Compile::Optimize` creates a `TracePhase` object.
This class is responsible to log all measurements shown with CITime.
Every time we create a new object of `TracePhase`, we log the current time for the provided phase in the parameter (e.g. `_t_optimizer`, `_t_parser` etc.).
We can easily grep for them to map the `CITime` output back to the code locations:
You can easily `grep` for them:
```
grep _t_optimizer src/hotspot/share/ -r
...
src/hotspot/share/opto/phase.cpp:    tty->print_cr ("       Optimize:            %7.3f s", timers[_t_optimizer].seconds());
...
grep _t_iterGVN src/hotspot/share/ -r
...
src/hotspot/share/opto/phase.cpp:    tty->print_cr ("         GVN 1:               %7.3f s", timers[_t_iterGVN].seconds());
src/hotspot/share/opto/phase.cpp:    tty->print_cr ("         GVN 2:               %7.3f s", timers[_t_iterGVN2].seconds());
...
```

After parsing the bytecode and creating our initial C2 IR, we start with a first round of `PhaseIterGVN` (or just `IGVN`). This is essentially an extended version of GVN (`PhaseGVN`).
Compared to `PhaseGVN`, the `can_reshape` flag is enabled for `IGVN`, which allows `Node::Ideal` optimizations to perform
additional "reshaping" optimizations.
Further, `IGVN` is iterative. We have a `igvn_worklist`, that holds all nodes that we should still transform.
And when a node is transformed (using `Ideal`, `Value`, or `Identity`), then its neighbours (the transitive useses) are added to the `igvn_worklist`,
since they may now have new optimization opportunities (hence the name "iterative"). For example, constants can propagate through the graph this way.
`IGVN` is also used after most other major optimizations (e.g. escape analysis, and loop optimizations), to clean up the graph,
and bring it into a canonical form again.
This allows most optimizations to avoid risky graph surgery that IGVN is also capable of doing.
For example, when an optimization wants to remove an if-statement because it is always true, we can simply replace the if-condition with true in the IR.
IGVN will then take care of safely removing all nodes on the else path and the if-node itself and ensures that the graph is in a sane state again afterwards.
As an additional bonus, IGVN will bring the graph back into a canonical state again which is important, because other optimizations rely on a canonical state of the graph:
this simplifies the patterns the optimizations need to look for.

In the list below, I will explain some of the steps, and others I will simply skip, since I do not know enough about them yet.

- `process_for_unstable_if_traps`: skip.
- Incremental inlining (aka late inlining): `inline_incrementally`: we already inlined some code during parsing. But we can now decide to inline even more methods, by replacing the calls in the IR with the IR nodes from the call.
- Boxing Elimination: `eliminate_boxing` / `inline_boxing_calls`: special case of incremental inlining for `valueOf` methods. For example, it helps unbox `Integer` to `int`.
- `remove_speculative_types`: skip.
- `cleanup_expensive_nodes`: skip.
- `PhaseVector`: helps to unbox the vector operations from the VectorAPI.
- `PhaseRenumberLive`: remove useless nodes, and renumber the node indices stored in `Node::_idx` for each node. Up to now, a lot of nodes were created, so the highest `_idx` can be quite high. But also a lot of nodes were removed. Renumbmering allows us to make the node index range more compact again since we could have already removed a lot of nodes. This also allows the data-structures based on `_idx` indexing to be smaller in the following optimizations. For debugging, it can often be helpful to disable the renumbering with `-XX:-RenumberLiveNodes`.
- `remove_root_to_sfpts_edges`: skip.
- Escape Analysis: `do_escape_analysis` / `ConnectionGraph`: detects allocations of Java objects that do not escape the scope of the compilation, and can thus be eliminated. All fields can become local variables instead.
- Loop Optimizations: `PhaseIdealLoop` (first 3 rounds): it analyzes the loop structures and reshapes them. See [Part 4](https://eme64.github.io/blog/2025/01/23/Intro-to-C2-Part04.html) for an introduction to loop optimizations. Some example optimizations are:
  - Detection of loops and attempts to canonicalize all loops that follow a simple "counted loop" form where we can predict the value of the loop induction variable `i` in each iteration while `i` never overflows.
  - Turning long-counted-loops into int counted-loops.
  - Remove empty loops.
  - Peeling: make a single-iteration copy of the loop, which is executed as straight-line code before the loop. That allows for some invariant checks to only be executed in the peeled iteration, and removed from the loop body.
  - Loop Predication: move some checks (e.g. null-checks, range checks) before the loop.
  - Loop Unswitching: move a loop-invariant check before the loop by copying the loop: One loop version contains the true-path of the loop-invariant check and the other one the false-path only.
  - Pre-Main-Post-loop: We split a loop into a pre, a main, and a post loop. This has various applications:
    - Unrolling of main-loop.
    - Pre-loop used for alignment (on architectures where strict alignment for vectorization is required).
    - Post-loop used to handle left-over iterations.
    - Range Check Elimination: Let the main-loop handle those loop iterations where a range check is known to pass (i.e. we can get rid of it), while the pre and post loop handle those iteration before or afterwards where we don't know if the range check will pass (i.e. we keep the range check).
  - Auto Vectorization of the main-loop.
- Conditional Constant Propagation (CCP): `PhaseCCP`, followed by IGVN. Note that both phases try to improve the type of nodes but take a different approach:
  - We have not looked at types in more details, yet. Each node in the IR has a type assigned which tells us what value a node could take during runtime. For example, an `AddI` node could have a type `[5..10]` which means that during runtime, the addition will result in any value between 5 and 10 (inclusive).
  - IGVN is pessimistic by first assuming nothing about a node. This means we start with a type that covers the whole range of values. For example, an AddI node starts with type `int` which means any integer (for those who studied lattices before, we oddly call this whole range of values BOTTOM and not TOP, and vice verca). IGVN then tries to narrow a node's type iteratively.
  - CCP is optimistic by starting with an empty type for each node (we confusingly call that empty type TOP). We then try to widen the types of all nodes by propagate the updated types through the graph in an iterative way until a fixed point is reached.
- More Loop Optimizations: `optimize_loops`: many rounds of `PhaseIdealLoop`.
- `process_for_post_loop_opts_igvn`: Some nodes have delayed some IGVN optimizations until after loop opts, for various reasons, including:
  - Some optimizations would make loop optimizations impossible or more difficult.
  - Some nodes are needed for loop opts only and can be removed afterwards (e.g. some `Opaque` nodes).
- Macro Expansion: `PhaseMacroExpand`: Expands or removes macro nodes. Macro nodes are special nodes that represent complex operations that cannot directly be mapped to machine (mach) nodes by the Matcher. Instead, they need to be expanded to other nodes first.
- Barrier Expansion: `expand_barriers`: Expand GC barriers which are special instructions inserted to support garbage collection. These include write barriers to track modified references and read barriers to ensure objects are correctly loaded before reading from them. For more information, see [this great blog post by Alexey Ragozin](https://blog.ragozin.info/2011/06/understanding-gc-pauses-in-jvm-hotspots.html).
- `optimize_logic_cones`: Optimization for vector logic operations.
- `process_late_inline_calls_no_inline`: post-parse call devirtualization, where we strength-reduce a virtual call to a static call very late (usually we would do that at parsing time already) because we now got more information (a narrow receiver type) from optimizations that happened after parsing. See [JDK-8257211](https://bugs.openjdk.org/browse/JDK-8257211).
- `final_graph_reshaping`: Some final reshaping before we continue to create the Mach graph in `Compile::Code_Gen`.

**On Stack Replacement (OSR)**

Consider a method that is invoked only a few times and then spends a lot of time in a long running loop with many iterations.
Our method invocation based counting heuristic would not find that this method is actually quite hot.
It would be great if this method is still compiled to speed up the execution.
We could just enqueue a compilation and get the benefit when the method is called the next time.
But what if finishing the execution in this method takes a long time?

We use a technique called OSR (On Stack Replacement) by counting how many times a loop backedge is taken.
If we find a loop with a lot of iterations, we compile the method from the start of the loop.
Everything unreachable before the loop was already executed and can be considered irrelevant.
While we compile the method, the interpreter keeps executing iterations of the loop.
When the compilation is complete, we enter the compiled code once we take the backedge again in the interpreter.
The very next iteration is then performed in the compiled code. This can speed up the rest of the method significantly. 

Note that we also schedule a normal compilation of the method once we OSR-compile a method.
This allows us to take that full version whenever we enter the method again from top.

OSR compilations can be recognized by the `%` in the `printcompilation` logs:
```
4603   85 %  b        Test::test @ 2 (23 bytes)
```

[In Part 4 we look at Loop Optimizations.](https://eme64.github.io/blog/2025/01/23/Intro-to-C2-Part04.html)


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
