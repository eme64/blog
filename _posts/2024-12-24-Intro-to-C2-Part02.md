---
title: "Introduction to HotSpot JVM C2 JIT Compiler, Part 2"
date: 2024-12-24
---

I assume that you have already looked at
[Part 0](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part00.html) and
[Part 1](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part01.html).

In Part 2, we look at:
- TODO

[Skip forward to Part 3](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part03.html)

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
        return testHelper(101, a) + testHelper(202, a) + testHelper(53, b);
    }

    public static int testHelper(int a, int b) {
        return a * b;
    }
}
```
We see that `Test.test` calls `Test.testHelper` 3 times, and adds up the results.
If we manually evaluate the code, we see that it computes `101 * a + 202 * a + 53 * b`, which could be simplified to `303 * a + 53 * b`.

We run the example like this, to see the generated IR:
```bash
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
 64  MulI  === _ 11 52  [[ 65 ]]  !jvms: Test::testHelper @ bci:2 (line 21) Test::test @ bci:17 (line 17)
 65  AddI  === _ 51 64  [[ 66 ]]  !jvms: Test::test @ bci:20 (line 17)
 66  Return  === 5 6 7 8 9 returns 65  [[ 0 ]] 
Done
```
Here a visualization of the graph:

![image](https://github.com/user-attachments/assets/bad657eb-da3c-4388-adcc-79a1190c476f)

And with `-XX:CompileCommand=print,Test::test` we can find the corresponding assemlby instructions:
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

We can see that the annotations on the right indicate that the code originates from both `Test::test` and `Test::testHelper`.
Hence, we can conclude that the `Test::testHelper` code was inlined into the compilation of `Test::test`.

We confirm this with the `PrintInlining` flag:
```bash
$ java -XX:CompileCommand=printcompilation,Test::* -XX:CompileCommand=compileonly,Test::test -Xbatch -XX:-TieredCompilation -XX:CompileCommand=printinlining,Test::test Test.java
CompileCommand: PrintCompilation Test.* bool PrintCompilation = true
CompileCommand: compileonly Test.test bool compileonly = true
CompileCommand: PrintInlining Test.test bool PrintInlining = true
Run
8233   85    b        Test::test (22 bytes)
                            @ 3   Test::testHelper (4 bytes)   inline (hot)
                            @ 10   Test::testHelper (4 bytes)   inline (hot)
                            @ 17   Test::testHelper (4 bytes)   inline (hot)
Done
```
We see that the `testHelper` is inlined 3 times (at bytecodes 3, 10 and 17 of `test`).

We can explicitly disable inlining:
```bash
$ java -XX:CompileCommand=printcompilation,Test::* -XX:CompileCommand=compileonly,Test::test -Xbatch -XX:-TieredCompilation -XX:CompileCommand=printinlining,Test::test -XX:CompileCommand=dontinline,Test::* Test.java
CompileCommand: PrintCompilation Test.* bool PrintCompilation = true
CompileCommand: compileonly Test.test bool compileonly = true
CompileCommand: PrintInlining Test.test bool PrintInlining = true
CompileCommand: dontinline Test.* bool dontinline = true
Run
8263   85    b        Test::test (22 bytes)
                            @ 3   Test::testHelper (4 bytes)   failed to inline: disallowed by CompileCommand
                            @ 10   Test::testHelper (4 bytes)   failed to inline: disallowed by CompileCommand
                            @ 17   Test::testHelper (4 bytes)   failed to inline: disallowed by CompileCommand
Done
```

The corresponding IR is now complex, because instead of inlining the code, we have 3 calls to `testHelper`. I simplified the graph a little:

![image](https://github.com/user-attachments/assets/08ac97bc-59b1-4a07-ad53-3a6255833ec2)

We can see the light-blue `ConI`, which pass the arguments 101, 202, and 53 into the `CallStaticJava`, which call `testHelper`.
After the calls, we must check for exceptions - since we are not inlining the method we cannot know that it does never throw an exception.
The green `Proj` nodes take the return values of the calls, and lead into the `AddI` which sum up the return value.
The `Catch`, `CatchProj` and `CreateEx` lead to the `Rethrow`, which is taken if there was an exception.
If there is no exception, we take the path to the next `CallStaticJava`, and eventually to `Return`.

This all looks a little complicated, but you do not need to understand it all yet. We will look at simpler examples with control-flow later.
Often the IR can look quite complicated, and it takes a while to understand all the nodes.

Ok, now we have seen that inlining gets us from:
```java
return testHelper(101, a) + testHelper(202, a) + testHelper(53, b);
// to
return 101 * a + 202 * a + 53 * b;
```
But how do we get to `303 * a + 53 * b`?

We will trace the steps first in IGV, then in the debugger.

**Using IGV, the Ideal Graph Visualizer**

The [IdealGraphVisualizer](https://github.com/openjdk/jdk/tree/master/src/utils/IdealGraphVisualizer)
is a visualizer for C2 IR.

I usually get it to run like this:
```bash
cd src/utils/IdealGraphVisualizer/
echo $JAVA_HOME
// If that prints nothing, you must set it to a JDK version between 17 and 21
// For example, I do:
// export JAVA_HOME=/oracle-work/jdk-21.0.3/fastdebug/
// or
// export JAVA_HOME=/oracle-work/jdk-17.0.8/
mvn clean install
// The install takes a while... and once complete we can launch IGV:
bash ./igv.sh
```

At first, you should get a window like this:
![image](https://github.com/user-attachments/assets/17052bf5-e33c-4347-8544-4410e83833c3)

Then, you can sent the graph from our test execution to IGV, using `-XX:PrintIdealGraphLevel=1`:
```bash
java -XX:CompileCommand=printcompilation,Test::* -XX:CompileCommand=compileonly,Test::test -Xbatch -XX:-TieredCompilation -XX:CompileCommand=printinlining,Test::test -XX:PrintIdealGraphLevel=1 Test.java
```

Now a first folder should have arrived in IGV, which contains a sequence of 3 graphs:
![image](https://github.com/user-attachments/assets/92193df6-0a2e-4809-b14e-760b075adf54)

We can see that the graph was already folded during parsing (see `51 MulI` node with `50 ConI` input that has value `int:303`):
![image](https://github.com/user-attachments/assets/22bfd931-26f9-4cf4-bd5f-02649aaef850)

Some constant-folding has already during parsing, so we increase the number of graphs that are generated with `-XX:PrintIdealGraphLevel=6`, and get a second folder with more graphs:
![image](https://github.com/user-attachments/assets/77f317c2-a344-4db8-8f1a-2f9d3127fc53)
We can now see the graph after each bytecode is parsed. The graphs look quite large and a little messy, as they are not yet cleaned up.
Personally, I find IGV good to get an overview over the graph, but when it comes to specific questions I prefer to debug directly using RR, where I have more fine-grained
control and see how it links to the C++ code of the compiler.

**Using the RR Debugger**

TODO

[Continue with Part 3](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part03.html)

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
