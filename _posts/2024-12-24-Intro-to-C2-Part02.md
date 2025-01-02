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
If we manually evaluate the code, we see that it computes `101 * a + 202 * a + 53 * a`, which could be simplified to `303 * a + 53 * b`.

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

We can see that the compilation indeed was simplified to `303 * a + 53 * b`. How did that happen?

**CompileCommand PrintInlining**

We can see that the annotations on the right indicate that the code originates from both `Test::test` and `Test::testHelper`.
Hence, we can conclude that the `Test::testHelper` code was inlined into the compilation of `Test::test`.

```bash
TODO
```

```bash
TODO
```

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
