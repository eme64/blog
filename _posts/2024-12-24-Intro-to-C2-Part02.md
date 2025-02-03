---
title: "Introduction to HotSpot JVM C2 JIT Compiler, Part 2"
date: 2024-12-24
---

I assume that you have already looked at
[Part 0](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part00.html) and
[Part 1](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part01.html).

In Part 2, we look at:
- Inlining and GVN (global value numbering) during parsing.
- Using IGV (Ideal Graph Visualizer) and rr (debugger) to look at the IR and transformations of it.
- A simple "idealization" of `101 * a + 202 * a` to `303 * a`.
- Exercises for the Reader: a few more transformations for the reader to explore (please discuss them in the comments section!).

[Skip forward to Part 3](https://eme64.github.io/blog/2025/01/23/Intro-to-C2-Part03.html)

**A new Example: inlining and GVN during parsing**

I slightly expanded the example from Part 1:
```java
public class Test {
    public static void main(String[] args) {
        // Especially with a debug build, the JVM startup can take a while,
        // so it can take a while until our code is executed.
        System.out.println("Run");

        // Repeatedly call the test method, so that it can become hot and
        // get JIT compiled.
        for (int i = 0; i < 10_000; i++) {
            test(i, i + 1);
        }
        System.out.println("Done");
    }
    
    // The test method we will focus on. 
    public static int test(int a, int b) {
        return multiply(101, a) + multiply(202, a) + multiply(53, b);
    }

    public static int multiply(int a, int b) {
        return a * b;
    }
}
```
We see that `Test.test` calls `Test.multiply` 3 times, and adds up the results.
If we manually evaluate the code, we see that it computes `101 * a + 202 * a + 53 * b`, which could be simplified to `303 * a + 53 * b`.

We run the example like this, to see the generated IR:
```
$ java -XX:CompileCommand=printcompilation,Test::* -XX:CompileCommand=compileonly,Test::test -Xbatch -XX:-TieredCompilation -XX:+PrintIdeal Test.java
CompileCommand: PrintCompilation Test.* bool PrintCompilation = true
CompileCommand: compileonly Test.test bool compileonly = true
Run
8130   85    b        Test::test (22 bytes)
AFTER: print_ideal
  0  Root  === 0 66  [[ 0 1 3 52 50 ]] inner 
  3  Start  === 3 0  [[ 3 5 6 7 8 9 10 11 ]]  #{0:control, 1:abIO, 2:memory, 3:rawptr:BotPTR, 4:return_address, 5:int, 6:int}
  5  Parm  === 3  [[ 66 ]] Control !jvms: Test::test @ bci:-1 (line 17)
  6  Parm  === 3  [[ 66 ]] I_O !jvms: Test::test @ bci:-1 (line 17)
  7  Parm  === 3  [[ 66 ]] Memory  Memory: @BotPTR *+bot, idx=Bot; !jvms: Test::test @ bci:-1 (line 17)
  8  Parm  === 3  [[ 66 ]] FramePtr !jvms: Test::test @ bci:-1 (line 17)
  9  Parm  === 3  [[ 66 ]] ReturnAdr !jvms: Test::test @ bci:-1 (line 17)
 10  Parm  === 3  [[ 51 ]] Parm0: int !jvms: Test::test @ bci:-1 (line 17)
 11  Parm  === 3  [[ 64 ]] Parm1: int !jvms: Test::test @ bci:-1 (line 17)
 50  ConI  === 0  [[ 51 ]]  #int:303
 51  MulI  === _ 10 50  [[ 65 ]]  !jvms: Test::test @ bci:13 (line 17)
 52  ConI  === 0  [[ 64 ]]  #int:53
 64  MulI  === _ 11 52  [[ 65 ]]  !jvms: Test::multiply @ bci:2 (line 21) Test::test @ bci:17 (line 17)
 65  AddI  === _ 51 64  [[ 66 ]]  !jvms: Test::test @ bci:20 (line 17)
 66  Return  === 5 6 7 8 9 returns 65  [[ 0 ]] 
Done
```
Here a visualization of the graph (not using IGV, but my own tool):

![image](https://github.com/user-attachments/assets/bad657eb-da3c-4388-adcc-79a1190c476f)

Note: for now just ignore the many `Parm`, `Root` and `Start` nodes, we will look at that later.

And with `-XX:CompileCommand=print,Test::test` we can find the corresponding assembly instructions:
```
------------------------ OptoAssembly for Compile_id = 85 -----------------------
...
01a     imull   RAX, RSI, #303	# int
020     imull   R11, RDX, #53	# int
024     addl    RAX, R11	# int
...
036     ret
...

----------------------------------- Assembly -----------------------------------
  # {method} {0x00007f9bed094400} 'test' '(II)I' in 'Test'
  # parm0:    rsi       = int
  # parm1:    rdx       = int
...
  0x00007f9c1118799a:   imul   $0x12f,%esi,%eax
  0x00007f9c111879a0:   imul   $0x35,%edx,%r11d
  0x00007f9c111879a4:   add    %r11d,%eax
...
  0x00007f9c111879b6:   retq
```

We can see that the compilation indeed was simplified to `303 * a + 53 * b`. How did that happen?

**CompileCommand PrintInlining**

We can see in the `PrintIdeal` dump above that the annotations on the right indicate that the code originates from both `Test::test` and `Test::multiply`.
Hence, we can conclude that the `Test::multiply` code was inlined into the compilation of `Test::test`.

We confirm this with the `PrintInlining` flag:
```
$ java -XX:CompileCommand=printcompilation,Test::* -XX:CompileCommand=compileonly,Test::test -Xbatch -XX:-TieredCompilation -XX:CompileCommand=printinlining,Test::test Test.java
CompileCommand: PrintCompilation Test.* bool PrintCompilation = true
CompileCommand: compileonly Test.test bool compileonly = true
CompileCommand: PrintInlining Test.test bool PrintInlining = true
Run
8233   85    b        Test::test (22 bytes)
                            @ 3   Test::multiply (4 bytes)   inline (hot)
                            @ 10   Test::multiply (4 bytes)   inline (hot)
                            @ 17   Test::multiply (4 bytes)   inline (hot)
Done
```
We see that the `multiply` is inlined 3 times (at bytecodes 3, 10 and 17 of `test`). Note that we can also see the reason why a method was inlined. In this case, we found that the method is hot enough to be inlined.

We can also explicitely disable inlining with `-XX:CompileCommand=dontinline,Test::test`.
```
$ java -XX:CompileCommand=printcompilation,Test::* -XX:CompileCommand=compileonly,Test::test -Xbatch -XX:-TieredCompilation -XX:CompileCommand=printinlining,Test::test -XX:CompileCommand=dontinline,Test::* Test.java
CompileCommand: PrintCompilation Test.* bool PrintCompilation = true
CompileCommand: compileonly Test.test bool compileonly = true
CompileCommand: PrintInlining Test.test bool PrintInlining = true
CompileCommand: dontinline Test.* bool dontinline = true
Run
8263   85    b        Test::test (22 bytes)
                            @ 3   Test::multiply (4 bytes)   failed to inline: disallowed by CompileCommand
                            @ 10   Test::multiply (4 bytes)   failed to inline: disallowed by CompileCommand
                            @ 17   Test::multiply (4 bytes)   failed to inline: disallowed by CompileCommand
Done
```
This is, for example, useful when analyzing the IR of a method with a lot of inlined code and trying to reduce the complexity of the graph.
In this example, however, the corresponding IR became more complex without inlining, because we get all the call nodes with their projections.

The corresponding IR is now complex, because instead of inlining the code, we have 3 calls to `multiply`. I simplified the graph a little:

![image](https://github.com/user-attachments/assets/08ac97bc-59b1-4a07-ad53-3a6255833ec2)

We can see the light-blue `ConI`, which pass the arguments 101, 202, and 53 into a `CallStaticJava` node each, which represent the individual calls to `multiply`.
After the calls, we must check for exceptions - since we are not inlining the method we cannot know that they actually never throw any exceptions.
Note that when inlining is not performed, a method call basically becomes a black box for the current compilation.
The green `Proj` nodes take the return values of the calls, and feed into the `AddI` which sum up the return value.
The `Catch`, `CatchProj` and `CreateEx` feed to the `Rethrow`, which is taken if there was an exception.
If there is no exception, we take the path to the next `CallStaticJava`, and eventually to `Return`.

This all looks a little complicated, but you do not need to fully grasp everything, yet. We will look at simpler examples with control-flow later.
Often the IR can look quite complicated, and it takes a while to understand the meaning of all nodes.

Ok, now we have seen that inlining gets us from:
```java
return multiply(101, a) + multiply(202, a) + multiply(53, b);
```
to
```java
return 101 * a + 202 * a + 53 * b;
```
But how do we get to `303 * a + 53 * b`?

We will trace the steps first in IGV, then in the debugger.

**Using IGV, the Ideal Graph Visualizer**

The [IdealGraphVisualizer](https://github.com/openjdk/jdk/tree/master/src/utils/IdealGraphVisualizer)
is a visualizer for C2 IR.
See also [Roberto's blog post](https://robcasloz.github.io/blog/2021/04/22/improving-the-ideal-graph-visualizer.html).

I usually get it to run like this:
```
cd src/utils/IdealGraphVisualizer/
echo $JAVA_HOME
// If that prints nothing, you must set it to a JDK version between 17 and 21
// For example, I do:
// export JAVA_HOME=/oracle-work/jdk-17.0.8/
mvn clean install
// The install takes a while... and once complete we can launch IGV:
bash ./igv.sh
```

At first, you should get a window like this (it may look a little different by now, as we are continually improving IGV):
![image](https://github.com/user-attachments/assets/17052bf5-e33c-4347-8544-4410e83833c3)

Then, you can sent the graph from our test execution to IGV, using `-XX:PrintIdealGraphLevel=1` (only works on debug build, not on product):
```
java -XX:CompileCommand=printcompilation,Test::* -XX:CompileCommand=compileonly,Test::test -Xbatch -XX:-TieredCompilation -XX:CompileCommand=printinlining,Test::test -XX:PrintIdealGraphLevel=1 Test.java
```

Now a first folder should have arrived in IGV, which contains a sequence of 3 graphs:
![image](https://github.com/user-attachments/assets/92193df6-0a2e-4809-b14e-760b075adf54)

We can see that the graph was already folded during parsing (see `51 MulI` node with `50 ConI` input that has value `int:303`):
![image](https://github.com/user-attachments/assets/22bfd931-26f9-4cf4-bd5f-02649aaef850)

Some constant-folding has already taken place during parsing. We can make the graph printing more fine-grained with `-XX:PrintIdealGraphLevel=6`, and get a second folder with more graphs:
![image](https://github.com/user-attachments/assets/77f317c2-a344-4db8-8f1a-2f9d3127fc53)
We can now see the graph after each bytecode is parsed. The graphs look quite large and a little messy, as they are not yet cleaned up.
Personally, I find IGV good to get an overview over the graph, but when it comes to specific questions I prefer to debug directly using rr, where I have more fine-grained
control and see how it links to the C++ code of the compiler.

**Using the rr Debugger**

Many are familiar with [gdb](https://en.wikipedia.org/wiki/GNU_Debugger), a commonly used debugger for C / C++ / assembly.
[rr](https://github.com/rr-debugger/rr) provides an enhancement to gdb, by allowing reverse-execution.
This has been an essencial tool when debugging the C2 compiler:
I often see a state of the IR, and wonder how we got there.
Then I can set watchpoints or breakpoints, and let rr reverse execute, leading
me to an earlier state that hopefully gives me more information about what happened
and why.

You should probably consult an online tutorial if you have never used it.
Essencially, it supports the "navigation" commands from gdb, but you can put `reverse-` in from to go backwards (e.g. `reverse-step`, `reverse-continue`, `reverse-next` - or the corresponding shortcuts: `rs`, `rc`, and `rn`, respectively).
I will simply present how I use rr below, but that
will not give you a complete picture of what you can do with rr.

Personally, I have made the experience that the `fastdebug` build of Hotspot is much faster than the `slowdebug`, but for debugging
I prefer to use `slowdebug` because it seems to work more reliably, i.e. fewer things are optimized away.
`slowdebug` also allows you to call any methods as found in the source code which is often not the case with `fastdebug` because they are directly inlined.
Local variables are also not optimized away with `slowdebug`.

Let us now record a run with rr:
```
rr ./java -XX:CompileCommand=printcompilation,Test::* -XX:CompileCommand=compileonly,Test::test -Xbatch -XX:-TieredCompilation -XX:CompileCommand=printinlining,Test::test Test.java
```

Once recorded, we can `rr replay` this run as many times as we would like, and it is always exactly the same.
The recording allows us also to do reverse execution, since
the debugger has a history it can traverse forward and backward.
Note that you can still call state modifying methods at a breakpoint or modify variables, memory etc. But as soon as you leave the breakpoint by going forward or backward, everything is reset to the state found in the recorded execution.
On my system, this looks like this:
```
$ rr replay
GNU gdb (Ubuntu 9.2-0ubuntu1~20.04.2) 9.2
Copyright (C) 2020 Free Software Foundation, Inc.
License GPLv3+: GNU GPL version 3 or later <http://gnu.org/licenses/gpl.html>
This is free software: you are free to change and redistribute it.
There is NO WARRANTY, to the extent permitted by law.
Type "show copying" and "show warranty" for details.
This GDB was configured as "x86_64-linux-gnu".
Type "show configuration" for configuration details.
For bug reporting instructions, please see:
<http://www.gnu.org/software/gdb/bugs/>.
Find the GDB manual and other documentation resources online at:
    <http://www.gnu.org/software/gdb/documentation/>.

For help, type "help".
Type "apropos word" to search for commands related to "word"...
Reading symbols from /oracle-work/jdk-fork0/build/linux-x64-slowdebug/jdk/bin/java...
Reading symbols from /oracle-work/jdk-fork0/build/linux-x64-slowdebug/jdk/bin/java.debuginfo...
Really redefine built-in command "restart"? (y or n) [answered Y; input not from terminal]
Really redefine built-in command "jump"? (y or n) [answered Y; input not from terminal]
Remote debugging using 127.0.0.1:48849
Reading symbols from /lib64/ld-linux-x86-64.so.2...
Reading symbols from /usr/lib/debug/.build-id/db/0420f708b806cf03260aadb916c330049580b7.debug...
0x00007f0d32dfd100 in _start () from /lib64/ld-linux-x86-64.so.2
(rr) c
Continuing.
[New Thread 244952.244953]

Thread 2 received signal SIGSEGV, Segmentation fault.
[Switching to Thread 244952.244953]
0x00007f0d2cb3966c in ?? ()
(rr) b Optimize
Breakpoint 1 at 0x7f0d30a3b3ad: file /oracle-work/jdk-fork0/open/src/hotspot/share/opto/compile.cpp, line 2220.
(rr) c
Continuing.
CompileCommand: PrintCompilation Test.* bool PrintCompilation = true
CompileCommand: compileonly Test.test bool compileonly = true
CompileCommand: PrintInlining Test.test bool PrintInlining = true
[New Thread 244952.244961]
Run
9897   85    b        Test::test (22 bytes)
[New Thread 244952.244954]
[New Thread 244952.244955]
[New Thread 244952.244956]
[New Thread 244952.244957]
[New Thread 244952.244958]
[New Thread 244952.244959]
[New Thread 244952.244960]
[New Thread 244952.244962]
[New Thread 244952.244963]
[Switching to Thread 244952.244961]

Thread 3 hit Breakpoint 1, Compile::Optimize (this=0x7f0d2556a870) at /oracle-work/jdk-fork0/open/src/hotspot/share/opto/compile.cpp:2220
warning: Source file is more recent than executable.
2220	  TracePhase tp(_t_optimizer);
(rr) 
```
Once `rr replay` starts for `java`, it tends to break at `_start`. At this point it has not yet loaded the JVM code, and so we can not yet
set breakpoints. So I `continue` (or simply `c`) once. Now it traps at a `SIGSEGV`, which is expected (the JVM for example uses implicit null-checks,
i.e. assumes a reference is not null, but when it happens to be null the signal-handler catches this and takes the exception path).
If you get too many `SIGSEGV`, you can skip and silence them with `handle SIGSEGV nostop noprint` (you can also create a `.gdbinit` file with that line in your home directory to always apply this in your next debugging session).
Since the symbols are now all
available, I can set a breakpoint at `Compile::Optimize` with `b Optimize` (you can set breakpoints earlier, rr will just complain about it).
Continuing forward once more with `c`, we hit the `Breakpoint 1`
at `Compile::Optimize`.

We see that we are on this line:
```
2220	  TracePhase tp(_t_optimizer);
```

We cannot immediatly see the surrounding code. One could use the gdb `list` command to quickly show the surrounding code:
```
(rr) list
2215	}
2216
2217	//------------------------------Optimize---------------------------------------
2218	// Given a graph, optimize it.
2219	void Compile::Optimize() {
2220	  TracePhase tp(_t_optimizer);
2221
2222	#ifndef PRODUCT
2223	  if (env()->break_at_compile()) {
2224	    BREAKPOINT;
```

What I usually do is using gdb's [TUI](https://sourceware.org/gdb/current/onlinedocs/gdb.html/TUI.html) (Text User Interface) as a visual guide which can be enabled with `Ctrl-x-a`:
![image](https://github.com/user-attachments/assets/ce41a49e-cb9f-4878-a000-a80862236cef)

We can also get a backtrace/stacktrace:
```
(rr) bt
#0  Compile::Optimize (this=0x7f0d2556a870) at /oracle-work/jdk-fork0/open/src/hotspot/share/opto/compile.cpp:2220
#1  0x00007f0d30a34a28 in Compile::Compile (this=0x7f0d2556a870, ci_env=0x7f0d2556b6e0, target=0x7f0d284cc758, 
    osr_bci=-1, options=..., directive=0x7f0d283b3440)
    at /oracle-work/jdk-fork0/open/src/hotspot/share/opto/compile.cpp:852
#2  0x00007f0d309003af in C2Compiler::compile_method (this=0x7f0d2813daa0, env=0x7f0d2556b6e0, target=0x7f0d284cc758, 
    entry_bci=-1, install_code=true, directive=0x7f0d283b3440)
    at /oracle-work/jdk-fork0/open/src/hotspot/share/opto/c2compiler.cpp:142
#3  0x00007f0d30a57fc3 in CompileBroker::invoke_compiler_on_method (task=0x7f0d286a86d0)
    at /oracle-work/jdk-fork0/open/src/hotspot/share/compiler/compileBroker.cpp:2319
#4  0x00007f0d30a56a44 in CompileBroker::compiler_thread_loop ()
    at /oracle-work/jdk-fork0/open/src/hotspot/share/compiler/compileBroker.cpp:1977
#5  0x00007f0d30a76aab in CompilerThread::thread_entry (thread=0x7f0d28188ff0, __the_thread__=0x7f0d28188ff0)
    at /oracle-work/jdk-fork0/open/src/hotspot/share/compiler/compilerThread.cpp:68
#6  0x00007f0d30ed61fa in JavaThread::thread_main_inner (this=0x7f0d28188ff0)
    at /oracle-work/jdk-fork0/open/src/hotspot/share/runtime/javaThread.cpp:772
#7  0x00007f0d30ed608f in JavaThread::run (this=0x7f0d28188ff0)
    at /oracle-work/jdk-fork0/open/src/hotspot/share/runtime/javaThread.cpp:757
#8  0x00007f0d31682995 in Thread::call_run (this=0x7f0d28188ff0)
    at /oracle-work/jdk-fork0/open/src/hotspot/share/runtime/thread.cpp:232
#9  0x00007f0d313fc5d0 in thread_native_entry (thread=0x7f0d28188ff0)
    at /oracle-work/jdk-fork0/open/src/hotspot/os/linux/os_linux.cpp:849
#10 0x00007f0d32b74609 in start_thread (arg=<optimized out>) at pthread_create.c:477
#11 0x00007f0d32a97353 in clone () at ../sysdeps/unix/sysv/linux/x86_64/clone.S:95
(rr)
```

We can navigate up and down the backtrace with `up` and `down`. If we go `up` one level, we see that in `Compile::Compile`
there is a lot of code, but essentially we get a `ciMethod* target`, for which we:
- Parse and potentially inline code recursively. This gives us the C2 IR.
- `Optimize`: this is where the heavier optimizations take place.
- `Code_Gen`: we generate machine code from the optimized IR.

Let us look at the IR at the start of `Compile::Optimize`:
```
(rr) p find_nodes_by_dump("")
  0  Root  === 0 66  [[ 0 1 3 52 50 ]] 
  1  Con  === 0  [[ ]]  #top
  3  Start  === 3 0  [[ 3 5 6 7 8 9 10 11 ]]  #{0:control, 1:abIO, 2:memory, 3:rawptr:BotPTR, 4:return_address, 5:int, 6:int}
  5  Parm  === 3  [[ 66 ]] Control !jvms: Test::test @ bci:-1 (line 17)
  6  Parm  === 3  [[ 66 ]] I_O !jvms: Test::test @ bci:-1 (line 17)
  7  Parm  === 3  [[ 66 ]] Memory  Memory: @BotPTR *+bot, idx=Bot; !jvms: Test::test @ bci:-1 (line 17)
  8  Parm  === 3  [[ 66 ]] FramePtr !jvms: Test::test @ bci:-1 (line 17)
  9  Parm  === 3  [[ 66 ]] ReturnAdr !jvms: Test::test @ bci:-1 (line 17)
 10  Parm  === 3  [[ 51 ]] Parm0: int !jvms: Test::test @ bci:-1 (line 17)
 11  Parm  === 3  [[ 64 ]] Parm1: int !jvms: Test::test @ bci:-1 (line 17)
 50  ConI  === 0  [[ 51 ]]  #int:303
 51  MulI  === _ 10 50  [[ 65 ]]  !jvms: Test::test @ bci:13 (line 17)
 52  ConI  === 0  [[ 64 ]]  #int:53
 64  MulI  === _ 11 52  [[ 65 ]]  !jvms: Test::multiply @ bci:2 (line 21) Test::test @ bci:17 (line 17)
 65  AddI  === _ 51 64  [[ 66 ]]  !jvms: Test::test @ bci:20 (line 17)
 66  Return  === 5 6 7 8 9 returns 65  [[ 0 ]] 
$1 = void
(rr) 
```
The command `find_nodes_by_dump("")` traverses all IR nodes and prints those that match the search string.
With an empty string, we match all nodes, and print the whole graph.
Note that we could also inspect the current graph in IGV by executing `p igv_print(true)` at this breakpoint.
This sends the current graph directly to IGV which is then listed in a new folder on the left.
But for the remainder of this blog article, we will focus on examining the graph directly within rr.

We can also print a subgraph like this:
```
(rr) p find_node(65)->dump_bfs(2, 0, "#")
dist dump
---------------------------------------------
   2  52  ConI  === 0  [[ 64 ]]  #int:53
   2  11  Parm  === 3  [[ 64 ]] Parm1: int !jvms: Test::test @ bci:-1 (line 17)
   2  50  ConI  === 0  [[ 51 ]]  #int:303
   2  10  Parm  === 3  [[ 51 ]] Parm0: int !jvms: Test::test @ bci:-1 (line 17)
   1  64  MulI  === _ 11 52  [[ 65 ]]  !jvms: Test::multiply @ bci:2 (line 21) Test::test @ bci:17 (line 17)
   1  51  MulI  === _ 10 50  [[ 65 ]]  !jvms: Test::test @ bci:13 (line 17)
   0  65  AddI  === _ 51 64  [[ 66 ]]  !jvms: Test::test @ bci:20 (line 17)
$3 = void
(rr)
```
With `find_node(65)` we can search the graph for a node with index 65.
If it is found, it is returned and we can perform a `dump_bfs()` query on it (note that if you use a non-existing node index, a nullptr is returned and rr hangs when trying to execute `dump_bfs()` on the nullptr).
`dump_bfs()` is a powerful tool to print various subgraphs from any arbitrary starting node, as for example `65 AddI`.
If you want to find out more about the supported features, use `dump_bfs(0,0,"h").
Note that the `#` character enables colored printing which I almost always use.
The `#` character enables colored printing for example.

When you are only interested in a single node, you can directly call `dump()` on a node:
```
(rr) p find_node(50)->dump()
 50  ConI  === 0  [[ 51 ]]  #int:303
```

We can also look at inputs of a node by either using `dump(1)`:
```
 10  Parm  === 3  [[ 51 ]] Parm0: int !jvms: Test::test @ bci:-1 (line 17)
 50  ConI  === 0  [[ 51 ]]  #int:303
 51  MulI  === _ 10 50  [[ 65 ]]  !jvms: Test::test @ bci:13 (line 17)
```

Or by directly selecting specific inputs of a node by querying their inputs with `in(input_index)`. For example, this will print the input at index 2:
```
(rr) p find_node(51)->in(2)->dump()
 50  ConI  === 0  [[ 51 ]]  #int:303
```

When looking at the entire IR dump above, we can see that we have already constant-folded the expression to `303 * a + 53 * b` at this point. Let's find out how this happened by stepping backwards in rr.
But manually stepping backwards would be extremely tedious.

But we know that the constant `303` is introduced from the addition `202 + 101` and is represented as a new `50 ConI` node that's an input into `51 MulI`.
We can conclude that `50 ConI` must be set as a new input of `51 MulI` right after the constant folding.
Can we find out where this link was changed? In the JVM C++ code of `node.hpp`,
we can see that the input-edges of a `Node` are stored in the `_in` array. I can track changes on such
an input edge by setting a watchpoint on the memory location of `_in[2]` like this:

```
### Get the second input of 51 MulI which is 50 ConI
(rr) p find_node(51)->in(2)
$6 = (Node *) 0x7f0d284be0c8    <--- 50 ConI
### Get the same second input of 51 MulI but by directly fetching it from the input edge storing array
(rr) p find_node(51)->_in[2]
$7 = (Node *) 0x7f0d284be0c8    <--- 50 ConI
### Grab the memory location where the second input of 51 MulI (i.e. 50 ConI)
    is currently stored as a pointer.
(rr) p &find_node(51)->_in[2]
$8 = (Node **) 0x7f0d284be1b8   <--- Memory location of the pointer to 50 ConI
### Set a watchpoint to break whenever this memory location changes.
    This happens when we store 50 ConI as new second input to 51 MulI
(rr) watch *0x7f0d284be1b8
Hardware watchpoint 2: *0x7f0d284be1b8
### Reverse continue to the point where this change happens (i.e. the watchpoint triggers)
(rr) rc
Continuing.

Thread 3 hit Hardware watchpoint 2: *0x7f0d284be1b8

Old value = 676061384
New value = -1414812757
0x00007f0d313a71b8 in Node::Node (this=0x7f0d284be140, n0=0x0, n1=0x7f0d284bbea0, n2=0x7f0d284be0c8) at /oracle-work/jdk-fork0/open/src/hotspot/share/opto/node.cpp:380
380	  _in[2] = n2; if (n2 != nullptr) n2->add_out((Node *)this);
(rr) bt
#0  0x00007f0d313a71b8 in Node::Node (this=0x7f0d284be140, n0=0x0, n1=0x7f0d284bbea0, n2=0x7f0d284be0c8) at /oracle-work/jdk-fork0/open/src/hotspot/share/opto/node.cpp:380
#1  0x00007f0d3068d693 in MulNode::MulNode (this=0x7f0d284be140, in1=0x7f0d284bbea0, in2=0x7f0d284be0c8) at /oracle-work/jdk-fork0/open/src/hotspot/share/opto/mulnode.hpp:44
#2  0x00007f0d3068d6e5 in MulINode::MulINode (this=0x7f0d284be140, in1=0x7f0d284bbea0, in2=0x7f0d284be0c8) at /oracle-work/jdk-fork0/open/src/hotspot/share/opto/mulnode.hpp:94
#3  0x00007f0d31374463 in MulNode::make (in1=0x7f0d284bbea0, in2=0x7f0d284be0c8, bt=T_INT) at /oracle-work/jdk-fork0/open/src/hotspot/share/opto/mulnode.cpp:218
#4  0x00007f0d30686d45 in AddNode::IdealIL (this=0x7f0d284bdfc8, phase=0x7f0d25569dc0, can_reshape=false, bt=T_INT) at /oracle-work/jdk-fork0/open/src/hotspot/share/opto/addnode.cpp:375
#5  0x00007f0d3068796a in AddINode::Ideal (this=0x7f0d284bdfc8, phase=0x7f0d25569dc0, can_reshape=false) at /oracle-work/jdk-fork0/open/src/hotspot/share/opto/addnode.cpp:583
#6  0x00007f0d31462fc4 in PhaseGVN::apply_ideal (this=0x7f0d25569dc0, k=0x7f0d284bdfc8, can_reshape=false) at /oracle-work/jdk-fork0/open/src/hotspot/share/opto/phaseX.cpp:669
#7  0x00007f0d3146300b in PhaseGVN::transform (this=0x7f0d25569dc0, n=0x7f0d284bdfc8) at /oracle-work/jdk-fork0/open/src/hotspot/share/opto/phaseX.cpp:682
#8  0x00007f0d3144bbaa in Parse::do_one_bytecode (this=0x7f0d25569990) at /oracle-work/jdk-fork0/open/src/hotspot/share/opto/parse2.cpp:2232
#9  0x00007f0d3143c9a5 in Parse::do_one_block (this=0x7f0d25569990) at /oracle-work/jdk-fork0/open/src/hotspot/share/opto/parse1.cpp:1587
#10 0x00007f0d314388fd in Parse::do_all_blocks (this=0x7f0d25569990) at /oracle-work/jdk-fork0/open/src/hotspot/share/opto/parse1.cpp:725
#11 0x00007f0d3143841f in Parse::Parse (this=0x7f0d25569990, caller=0x7f0d284c78b0, parse_method=0x7f0d284cc758, expected_uses=6784)
    at /oracle-work/jdk-fork0/open/src/hotspot/share/opto/parse1.cpp:629
#12 0x00007f0d30902bb1 in ParseGenerator::generate (this=0x7f0d284c7898, jvms=0x7f0d284c78b0) at /oracle-work/jdk-fork0/open/src/hotspot/share/opto/callGenerator.cpp:99
#13 0x00007f0d30a34600 in Compile::Compile (this=0x7f0d2556a870, ci_env=0x7f0d2556b6e0, target=0x7f0d284cc758, osr_bci=-1, options=..., directive=0x7f0d283b3440)
    at /oracle-work/jdk-fork0/open/src/hotspot/share/opto/compile.cpp:797
#14 0x00007f0d309003af in C2Compiler::compile_method (this=0x7f0d2813daa0, env=0x7f0d2556b6e0, target=0x7f0d284cc758, entry_bci=-1, install_code=true, directive=0x7f0d283b3440)
    at /oracle-work/jdk-fork0/open/src/hotspot/share/opto/c2compiler.cpp:142
#15 0x00007f0d30a57fc3 in CompileBroker::invoke_compiler_on_method (task=0x7f0d286a86d0) at /oracle-work/jdk-fork0/open/src/hotspot/share/compiler/compileBroker.cpp:2319
#16 0x00007f0d30a56a44 in CompileBroker::compiler_thread_loop () at /oracle-work/jdk-fork0/open/src/hotspot/share/compiler/compileBroker.cpp:1977
#17 0x00007f0d30a76aab in CompilerThread::thread_entry (thread=0x7f0d28188ff0, __the_thread__=0x7f0d28188ff0)
    at /oracle-work/jdk-fork0/open/src/hotspot/share/compiler/compilerThread.cpp:68
#18 0x00007f0d30ed61fa in JavaThread::thread_main_inner (this=0x7f0d28188ff0) at /oracle-work/jdk-fork0/open/src/hotspot/share/runtime/javaThread.cpp:772
#19 0x00007f0d30ed608f in JavaThread::run (this=0x7f0d28188ff0) at /oracle-work/jdk-fork0/open/src/hotspot/share/runtime/javaThread.cpp:757
#20 0x00007f0d31682995 in Thread::call_run (this=0x7f0d28188ff0) at /oracle-work/jdk-fork0/open/src/hotspot/share/runtime/thread.cpp:232
#21 0x00007f0d313fc5d0 in thread_native_entry (thread=0x7f0d28188ff0) at /oracle-work/jdk-fork0/open/src/hotspot/os/linux/os_linux.cpp:849
#22 0x00007f0d32b74609 in start_thread (arg=<optimized out>) at pthread_create.c:477
#23 0x00007f0d32a97353 in clone () at ../sysdeps/unix/sysv/linux/x86_64/clone.S:95
(rr) 
```
We see that this edge was set in `MulINode::MulINode`, the construction of `51  MulI`. Going further up the backtrace, we see
that this happened in `AddINode::Ideal` (the idealization of some `AddI` - we will look at this below).
Even further up, we see that this happens during `PhaseGVN::transform` (we are doing GVN - global value numbering).
And further up from that we see that this happens during `Parse::do_one_bytecode` (bytecode parsing) and finally inside `Compile::Compile`.

Let's look at all these steps in turn.

In `Parse::do_one_bytecode`, we seem to be parsing an `iadd` bytecode ([see parse2.cpp](https://github.com/openjdk/jdk/blob/cede30416f9730b0ca106e97b3ed9a25a09d3386/src/hotspot/share/opto/parse2.cpp#L2230-L2233)):
```cpp
case Bytecodes::_iadd:
  b = pop(); a = pop();
  push( _gvn.transform( new AddINode(a,b) ) );
  break;
```
This applies the semantics of the `iadd` bytecode:
- `pop` two arguments from the stack.
- Compute the addition: here we create an `AddINode`, and already GVN transform it.
- `push` the result back onto the stack.

In `PhaseGVN::transform` we already perform some local optimizations ([see phaseX.hpp](https://github.com/openjdk/jdk/blob/cede30416f9730b0ca106e97b3ed9a25a09d3386/src/hotspot/share/opto/phaseX.cpp#L674-L741)):
- `apply_ideal` iteratively calls `Node::Ideal` (with `can_reshape` disabled, more about that later): this tries to construct a more "ideal" (canonicalized and/or cheaper) subgraph.
- `Node::Value`: compute a tighter type, possibly constant folding the node (see `singleton`).
- `Node::Identity`: tries to find another node that "does the same thing", and replaces the node with that node.

GVN is very important, as it canonicalizes the graph in preparation for other optimizations (they now only need to match canonical patterns, which makes writing optimizations easier).
And it performs local optimizations, such as constant folding.

Now let us look at the lowest part of the backtrace, where the idealization happens.
In `AddNode::IdealIL`, we see that we have matched some `Associative` pattern ([see addnode.cpp](https://github.com/openjdk/jdk/blob/cede30416f9730b0ca106e97b3ed9a25a09d3386/src/hotspot/share/opto/addnode.cpp#L345-L377)).
```
(rr) p this->dump_bfs(2,0,"#")
dist dump
---------------------------------------------
   2  35  ConI  === 0  [[ 25 43 47 49 ]]  #int:202
   2  23  ConI  === 0  [[ 22 31 34 49 ]]  #int:101
   2  10  Parm  === 3  [[ 4 19 22 22 25 31 34 43 47 51 ]] Parm0: int !jvms: Test::test @ bci:-1 (line 17)
   1  47  MulI  === _ 10 35  [[ 42 37 48 ]]  !jvms: Test::multiply @ bci:2 (line 21) Test::test @ bci:10 (line 17)
   1  34  MulI  === _ 10 23  [[ 30 25 37 48 ]]  !jvms: Test::multiply @ bci:2 (line 21) Test::test @ bci:3 (line 17)
   0  48  AddI  === _ 34 47  [[ ]]  !jvms: Test::test @ bci:13 (line 17)
```
This is `(a * 101) + (a * 202)`, matching the pattern `Convert "a*b+a*c into a*(b+c)` in the code.
Printing the local results, we get:
```
(rr) p add_in2->dump()
 35  ConI  === 0  [[ 25 43 47 49 ]]  #int:202
(rr) p add_in1->dump()
 23  ConI  === 0  [[ 22 31 34 49 ]]  #int:101
(rr) p add_in2->dump()
 35  ConI  === 0  [[ 25 43 47 49 ]]  #int:202
(rr) p add->dump()
 50  ConI  === 0  [[ ]]  #int:303
(rr) p mul_in->dump()
 10  Parm  === 3  [[ 4 19 22 22 25 31 34 43 47 51 ]] Parm0: int !jvms: Test::test @ bci:-1 (line 17)
```
It turns out that in `Node* add = phase->transform(AddNode::make(add_in1, add_in2, bt));`, the GVN transform has already
converted the `b + c = 202 + 101` into `303`.

Finally, `AddNode::IdealIL` does `return MulNode::make(mul_in, add, bt);`, which gives us `a * 303`.
This is the `51 MulI` with the `303` constant input we have set the watchpoint for earlier.

Note: it took me a long time to get comfortable stepping arount the C2 code with rr, and
tracing around such graph transformations. So do not be discouraged if this feels hard to
replicate. It helped me a lot to draw IR graphs on paper, and map out the different steps.

 I also want to mention here that I only presented one possible way to find out where the constant folding was done with rr.
 There are many other tricks to achieve this with rr, for example, by finding out where a new node with a certain index was created.
 I will not go into that further now but I will possibly follow up with a blog post about common rr tricks at some point.

**Exercises for the Reader**

I encourage you to replay the steps from above, and see if you can follow the steps in the code.
Below, I give you a few more examples of such GVN transformations, so you can step through the code
and find yourself where the transformations are done.

```java
public class Test2 {
    public static void main(String[] args) {
        System.out.println("Run test1");
        for (int i = 0; i < 10_000; i++) {
            test1(i, i + 1);
        }

        System.out.println("Run test2");
        for (int i = 0; i < 10_000; i++) {
            test2(i);
        }

        System.out.println("Run test3");
        for (int i = 0; i < 10_000; i++) {
            test3(i);
        }

        System.out.println("Done");
    }

    public static int test1(int a, int b) {
        // Transformed into: a + b
        return ((42 + a) + b) - 42;
    }

    public static int var2 = 0;
    public static int test2(int a) {
        // putstatic / StoreI to var2
        var2 = a;
        // loadstatic / LoadI from var2
        // -> is replaced with "a", we forward the stored value. The load is optimized away.
        return var2;
    }

    public static int test3(int a) {
        // Transformed into: (a << 6) + a
        // Bonus question: why might this be better?
        return a * 65;
    }
}
```

Here the generated bytecode:
```
javac Test2.java
javap -c Test2.class

public class Test2 {
  public static int var2;
...
  public static int test1(int, int);
    Code:
       0: bipush        42
       2: iload_0
       3: iadd
       4: iload_1
       5: iadd
       6: bipush        42
       8: isub
       9: ireturn

  public static int test2(int);
    Code:
       0: iload_0
       1: putstatic     #40                 // Field var2:I
       4: getstatic     #40                 // Field var2:I
       7: ireturn

  public static int test3(int);
    Code:
       0: iload_0
       1: bipush        65
       3: imul
       4: ireturn

  static {};
    Code:
       0: iconst_0
       1: putstatic     #40                 // Field var2:I
       4: return
}
```
This is just to show that `javac` did not yet do any of the transformations ;)

And here the generated IR after the transformations:
```
java -XX:CompileCommand=printcompilation,Test2::* -XX:CompileCommand=compileonly,Test2::test* -Xbatch -XX:-TieredCompilation -XX:+PrintIdeal Test2.java
CompileCommand: PrintCompilation Test2.* bool PrintCompilation = true
CompileCommand: compileonly Test2.test* bool compileonly = true
Run test1
8461   85    b        Test2::test1 (10 bytes)
AFTER: print_ideal
  0  Root  === 0 31  [[ 0 1 3 ]] inner 
  3  Start  === 3 0  [[ 3 5 6 7 8 9 10 11 ]]  #{0:control, 1:abIO, 2:memory, 3:rawptr:BotPTR, 4:return_address, 5:int, 6:int}
  5  Parm  === 3  [[ 31 ]] Control !jvms: Test2::test1 @ bci:-1 (line 23)
  6  Parm  === 3  [[ 31 ]] I_O !jvms: Test2::test1 @ bci:-1 (line 23)
  7  Parm  === 3  [[ 31 ]] Memory  Memory: @BotPTR *+bot, idx=Bot; !jvms: Test2::test1 @ bci:-1 (line 23)
  8  Parm  === 3  [[ 31 ]] FramePtr !jvms: Test2::test1 @ bci:-1 (line 23)
  9  Parm  === 3  [[ 31 ]] ReturnAdr !jvms: Test2::test1 @ bci:-1 (line 23)
 10  Parm  === 3  [[ 26 ]] Parm0: int !jvms: Test2::test1 @ bci:-1 (line 23)
 11  Parm  === 3  [[ 26 ]] Parm1: int !jvms: Test2::test1 @ bci:-1 (line 23)
 26  AddI  === _ 10 11  [[ 31 ]]  !orig=24 !jvms: Test2::test1 @ bci:3 (line 23)
 31  Return  === 5 6 7 8 9 returns 26  [[ 0 ]] 
Run test2
8462   86    b        Test2::test2 (8 bytes)
AFTER: print_ideal
  0  Root  === 0 30  [[ 0 1 3 22 23 ]] inner 
  1  Con  === 0  [[ ]]  #top
  3  Start  === 3 0  [[ 3 5 6 7 8 9 10 ]]  #{0:control, 1:abIO, 2:memory, 3:rawptr:BotPTR, 4:return_address, 5:int}
  5  Parm  === 3  [[ 30 26 ]] Control !jvms: Test2::test2 @ bci:-1 (line 29)
  6  Parm  === 3  [[ 30 ]] I_O !jvms: Test2::test2 @ bci:-1 (line 29)
  7  Parm  === 3  [[ 16 26 ]] Memory  Memory: @BotPTR *+bot, idx=Bot; !jvms: Test2::test2 @ bci:-1 (line 29)
  8  Parm  === 3  [[ 30 ]] FramePtr !jvms: Test2::test2 @ bci:-1 (line 29)
  9  Parm  === 3  [[ 30 ]] ReturnAdr !jvms: Test2::test2 @ bci:-1 (line 29)
 10  Parm  === 3  [[ 30 26 ]] Parm0: int !jvms: Test2::test2 @ bci:-1 (line 29)
 16  MergeMem  === _ 1 7 1 26  [[ 30 ]]  { - N26:java/lang/Class (java/io/Serializable,java/lang/constant/Constable,java/lang/reflect/AnnotatedElement,java/lang/invoke/TypeDescriptor,java/lang/reflect/GenericDeclaration,java/lang/reflect/Type,java/lang/invoke/TypeDescriptor$OfField):exact+112 * }  Memory: @BotPTR *+bot, idx=Bot;
 22  ConP  === 0  [[ 25 25 ]]  #java/lang/Class (java/io/Serializable,java/lang/constant/Constable,java/lang/reflect/AnnotatedElement,java/lang/invoke/TypeDescriptor,java/lang/reflect/GenericDeclaration,java/lang/reflect/Type,java/lang/invoke/TypeDescriptor$OfField):exact *  Oop:java/lang/Class (java/io/Serializable,java/lang/constant/Constable,java/lang/reflect/AnnotatedElement,java/lang/invoke/TypeDescriptor,java/lang/reflect/GenericDeclaration,java/lang/reflect/Type,java/lang/invoke/TypeDescriptor$OfField):exact *
 23  ConL  === 0  [[ 25 ]]  #long:112
 25  AddP  === _ 22 22 23  [[ 26 ]]   Oop:java/lang/Class (java/io/Serializable,java/lang/constant/Constable,java/lang/reflect/AnnotatedElement,java/lang/invoke/TypeDescriptor,java/lang/reflect/GenericDeclaration,java/lang/reflect/Type,java/lang/invoke/TypeDescriptor$OfField):exact+112 * !jvms: Test2::test2 @ bci:1 (line 29)
 26  StoreI  === 5 7 25 10  [[ 16 ]]  @java/lang/Class (java/io/Serializable,java/lang/constant/Constable,java/lang/reflect/AnnotatedElement,java/lang/invoke/TypeDescriptor,java/lang/reflect/GenericDeclaration,java/lang/reflect/Type,java/lang/invoke/TypeDescriptor$OfField):exact+112 *, name=var2, idx=4;  Memory: @java/lang/Class (java/io/Serializable,java/lang/constant/Constable,java/lang/reflect/AnnotatedElement,java/lang/invoke/TypeDescriptor,java/lang/reflect/GenericDeclaration,java/lang/reflect/Type,java/lang/invoke/TypeDescriptor$OfField):exact+112 *, name=var2, idx=4; !jvms: Test2::test2 @ bci:1 (line 29)
 30  Return  === 5 6 16 8 9 returns 10  [[ 0 ]] 
Run test3
8463   87    b        Test2::test3 (5 bytes)
AFTER: print_ideal
  0  Root  === 0 29  [[ 0 1 3 26 ]] inner 
  3  Start  === 3 0  [[ 3 5 6 7 8 9 10 ]]  #{0:control, 1:abIO, 2:memory, 3:rawptr:BotPTR, 4:return_address, 5:int}
  5  Parm  === 3  [[ 29 ]] Control !jvms: Test2::test3 @ bci:-1 (line 37)
  6  Parm  === 3  [[ 29 ]] I_O !jvms: Test2::test3 @ bci:-1 (line 37)
  7  Parm  === 3  [[ 29 ]] Memory  Memory: @BotPTR *+bot, idx=Bot; !jvms: Test2::test3 @ bci:-1 (line 37)
  8  Parm  === 3  [[ 29 ]] FramePtr !jvms: Test2::test3 @ bci:-1 (line 37)
  9  Parm  === 3  [[ 29 ]] ReturnAdr !jvms: Test2::test3 @ bci:-1 (line 37)
 10  Parm  === 3  [[ 28 27 ]] Parm0: int !jvms: Test2::test3 @ bci:-1 (line 37)
 26  ConI  === 0  [[ 27 ]]  #int:6
 27  LShiftI  === _ 10 26  [[ 28 ]]  !jvms: Test2::test3 @ bci:3 (line 37)
 28  AddI  === _ 27 10  [[ 29 ]]  !jvms: Test2::test3 @ bci:3 (line 37)
 29  Return  === 5 6 7 8 9 returns 28  [[ 0 ]] 
Done
```

Your task is now to look at each of these 3 methods in turn. Restrict compilation for only that method, record it with rr,
and step through the code.

You can put your observations in the comment section below, and discuss the solutions.

[Continue with Part 3](https://eme64.github.io/blog/2025/01/23/Intro-to-C2-Part03.html)

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
