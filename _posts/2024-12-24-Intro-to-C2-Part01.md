---
title: "Introduction to HotSpot JVM C2 JIT Compiler, Part 1"
date: 2024-12-24
---

I assume that you have already looked at [Part 0](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part01.html),
and that you have already cloned and built the JDK ([Build the JDK](https://openjdk.org/groups/build/doc/building.html)).

In Part 1, we look at:
- Running a simple Java example.
- Product vs Debug builds.
- Tiered Compilation.

Related article by Roland Westrelin: [How the JIT compiler boosts Java performance in OpenJDK](https://developers.redhat.com/articles/2021/06/23/how-jit-compiler-boosts-java-performance-openjdk#).

TODO link to part 2.

**Our First Example**

We start with a very simple example file `Test.java`:
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
        return a + b;
    }
}
```

We can run it like this:

```bash
$ ./java Test.java
Run
Done
```

**Types of JDK Builds**

Simplifying, there are 3 types of builds:
- product: fast, but harder to debug with. Does not execute any asserts in the C++ VM code.
- (fast)debug: runs slower than product, but executes asserts, and allows debug VM flags.
- slowdebug: runs slower than fastdebug, but has more symbols available which enables a better debugging esperience with GDB / RR.

I tend to work with fastdebug by default, but then switch to slowdebug if GDB / RR behave in unexpected ways (e.g. if they do not break at the expected line).

**VM CompileCommand printcompilation**

Let us now continue with the example, and inspect which methods are compiled:

```bash
$ ./java -XX:CompileCommand=printcompilation,*::* Test.java
CompileCommand: PrintCompilation *.* bool PrintCompilation = true
360    1       3       java.lang.Byte::toUnsignedInt (6 bytes)
363    2       3       java.lang.Object::<init> (1 bytes)
390    3       4       java.lang.Byte::toUnsignedInt (6 bytes)
...
it continues for a while, and ends with
...
10874 2000       3       java.lang.invoke.InvokerBytecodeGenerator::isStaticallyInvocable (168 bytes)
10874 2005       3       sun.nio.fs.UnixPath::getPathForExceptionMessage (5 bytes)
Run
10876 2007       2       Test::test (4 bytes)
Done
10881 2006       3       sun.nio.fs.UnixException::translateToIOException (133 bytes)
```

From this log, we can already see a lot about how HotSpot compiles and executes our code:
- There are a lot of compilations that are not from our `Test.java`. It comes from the JVM initialization, which itself loads a number of classes, runs code and compiles some of it.
- The first column displays the time, when the compilation is issues in milli-seconds. `Test::test` is executed after `10876` milli-seconds.
- The second column is the unique id of the compilation, which we can see counting up. It is not always perfectly in order.
- The third column indicates which compiler was used. Tier 1-3 are used for C1, tier 4 is used for C2.
- The fourth column display the name of the compiled method, and the size of its bytecode.

Usually, we are only interested in the compilations of certain classes, here of `Test`.
We can limit for which classes we enable `printcompilation`:

```bash
$ ./java -XX:CompileCommand=printcompilation,Test::* Test.java
CompileCommand: PrintCompilation Test.* bool PrintCompilation = true
Run
10405 1983       3       Test::test (4 bytes)
Done
```

**Tiered Compilation**

In our execution above, we notice that from our `Test.java` only `Test::test` was ever compiled, and only with C1 (tier 1, 2, or 3).
But we obviously are also running `Test::main`, so why does that method not get compiled?

The HotSpot JVM executes your Java code in one of these ways:
- Interpreter: initially all code is executed in the interpreter. This means we can start executing code immediately, but not at a high speed. We profile which code is executed, by counting how many times a method is invoked for example. If we reach a certain threshold, we decide that this method should be compiled, so we add the method to the compilation queue. But in the meantime we continue executing in the interpreter. If we ever enter that method again, and the compilation is complete, then we can execute the compiled code.
- C1: Once profiling has determined that the code is hot enough (e.g. has been called a lot), we compile the method with C1. The goal of C1 is to generate machine code quickly, which is already much faster than the interpreter. C1 does not optimize the code, because that would take additional time which we do not want to spend at this stage yet. C1 also adds profiling code to the machine code, so that we can keep counting the number of invocations. If we detect that the code has been called a lot more, we eventually would like to generate more optimized machine code. If a certain invocation count is exceeded, we enqueue the method for compilation again, but this time with C2.
- C2: Once profiling has determined that the code is very hot, we want to generate highly optimized machine code. We are willing to pay the higher compilation time, because we expect the code to be executed a lot in the future. The win of execution time with faster code outweighs the cost of time we spend on optimizations.

Back to our example. We saw that `Test::main` was never compiled, thus must have exclusively been executed in the interpreter. `Test::test` is first executed in the interpreter, then is deemed hot enough for a C1 Compilation.

We can force all executions to be run in the interpreter:
```bash
$ ./java -XX:CompileCommand=printcompilation,Test::* -Xint Test.java
CompileCommand: PrintCompilation Test.* bool PrintCompilation = true
Run
Done
```

Normally, compilation happens in the background, which means that when a compilation is enqueued, we continue with the old mode of execution until the new compilation is completed.
The asynchronous behaviour can sometimes make compilation a little unpredictable. It can be beneficial for debugging to disable background compilation with `-Xbatch`:
```bash
./java -XX:CompileCommand=printcompilation,Test::* -Xbatch Test.java
CompileCommand: PrintCompilation Test.* bool PrintCompilation = true
Run
25090 1835    b  3       Test::test (4 bytes)
25090 1836    b  4       Test::test (4 bytes)
Done
```
We see that the code is now compiled first with C1, and then with C2. We also see that the blocking behaviour has made the execution much slower.

```bash
TODO
```
TODO
