---
title: "Introduction to HotSpot JVM C2 JIT Compiler, Part 1"
date: 2024-12-24
---

I assume that you have already looked at [Part 0](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part00.html),
and that you have already cloned and [build the JDK](https://openjdk.org/groups/build/doc/building.html).

In Part 1, we look at:
- Running a simple Java example.
- Compilation to Java bytecode with `javac`.
- Product vs Debug builds.
- Tiered Compilation.
- Inspecting C2 IR and generated assembly code.

Related articles:
- By Roland Westrelin: [How the JIT compiler boosts Java performance in OpenJDK](https://developers.redhat.com/articles/2021/06/23/how-jit-compiler-boosts-java-performance-openjdk#).
- By Chris Newland [Developers disassemble! Use Java and hsdis to see it all.](https://blogs.oracle.com/javamagazine/post/java-hotspot-hsdis-disassembler)

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
$ java Test.java
Run
Done
```

**Compilation of Java code to Java bytecode**

Java (and other JVM programming languages) are first compiled to [Java Bytecode](https://en.wikipedia.org/wiki/List_of_Java_bytecode_instructions).
This bytecode is still platform agnostic, and needs to be executed by the JVM.
The JVM can interpret the bytecode, or further compile it to platform specific machine code.

We can explicitly compile our test file to bytecode in a class-file:
```bash
$ javac Test.java
```

This generates a `Test.class`. We can inspect its content:
```bash
$ javap -c Test.class
Compiled from "Test.java"
public class Test {
  public Test();
    Code:
         0: aload_0
         1: invokespecial #1                  // Method java/lang/Object."<init>":()V
         4: return

  public static void main(java.lang.String[]);
    Code:
         0: getstatic     #7                  // Field java/lang/System.out:Ljava/io/PrintStream;
         3: ldc           #13                 // String Run
         5: invokevirtual #15                 // Method java/io/PrintStream.println:(Ljava/lang/String;)V
         8: iconst_0
         9: istore_1
        10: iload_1
        11: sipush        10000
        14: if_icmpge     31
        17: iload_1
        18: iload_1
        19: iconst_1
        20: iadd
        21: invokestatic  #21                 // Method test:(II)I
        24: pop
        25: iinc          1, 1
        28: goto          10
        31: getstatic     #7                  // Field java/lang/System.out:Ljava/io/PrintStream;
        34: ldc           #27                 // String Done
        36: invokevirtual #15                 // Method java/io/PrintStream.println:(Ljava/lang/String;)V
        39: return

  public static int test(int, int);
    Code:
         0: iload_0
         1: iload_1
         2: iadd
         3: ireturn
}
```
For now, you do not need to understand this code. We see that there are 3 methods defined in the `Test` class:
- `<init>`: This is the code of the default constructor, which calls the super-class `Object` constructor.
- `main`:  We see some `invokevirtual` for `println`, an `invokestatic` for `test`, and a `goto 10` for the loop backedge.
- `test`: The two `int` arguments are put into registers `0` and `1`. The `iload_0` and `iload_1` take those arguments from the registers, and push them onto the stack. `iadd` takes the two values from the stack, and puts their addition back on the stack. `ireturn` pops that value off the stack again, and returns it.

If you are interested to learn more about Java Bytecode:
- [Java Bytecode (Wikipedia)](https://en.wikipedia.org/wiki/List_of_Java_bytecode_instructions): helpful reference for all the bytecodes.
- [asmtools](https://github.com/openjdk/asmtools): tool to assemble / disassemble class-files. When I am working on a bug where I am only provided a class-file, I often inspect the class-file with `jdis`, modify it, and compile it again with `jasm`. That way I can often even reconstruct the reproducer with Java code eventually.

Note 1: When we directly execute the `Test.java`, the JVM implicitly compiles the file to bytecode first, and directly executes that class-file.

Note 2: `.jar` files are simply a zip-directory of various `.class` files.

**Types of JDK Builds**

Simplifying, there are 3 types of builds:
- product: fast, but harder to debug with. Does not execute any asserts in the C++ VM code.
- (fast)debug: runs slower than product, but executes asserts, and allows debug VM flags.
- slowdebug: runs slower than fastdebug, but has more symbols available which enables a better debugging esperience with GDB / RR.

I tend to work with fastdebug by default, but then switch to slowdebug if GDB / RR behave in unexpected ways (e.g. if they do not break at the expected line).

**VM CompileCommand printcompilation**

Let us now continue with the example, and inspect which methods are compiled:

```bash
$ java -XX:CompileCommand=printcompilation,*::* Test.java
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
$ java -XX:CompileCommand=printcompilation,Test::* Test.java
CompileCommand: PrintCompilation Test.* bool PrintCompilation = true
Run
10405 1983       3       Test::test (4 bytes)
Done
```

**Tiered Compilation, VM flags to control compilation**

In our execution above, we notice that from our `Test.java` only `Test::test` was ever compiled, and only with C1 (tier 1, 2, or 3).
But we obviously are also running `Test::main`, so why does that method not get compiled?

The HotSpot JVM executes your Java code in one of these ways:
- Interpreter: initially all code is executed in the interpreter. This means we can start executing code immediately, but not at a high speed. We profile which code is executed, by counting how many times a method is invoked for example. If we reach a certain threshold, we decide that this method should be compiled, so we add the method to the compilation queue. But in the meantime we continue executing in the interpreter. If we ever enter that method again, and the compilation is complete, then we can execute the compiled code.
- C1: Once profiling has determined that the code is hot enough (e.g. has been called a lot), we compile the method with C1. The goal of C1 is to generate machine code quickly, which is already much faster than the interpreter. C1 does not optimize the code, because that would take additional time which we do not want to spend at this stage yet. C1 also adds profiling code to the machine code, so that we can keep counting the number of invocations. If we detect that the code has been called a lot more, we eventually would like to generate more optimized machine code. If a certain invocation count is exceeded, we enqueue the method for compilation again, but this time with C2.
- C2: Once profiling has determined that the code is very hot, we want to generate highly optimized machine code. We are willing to pay the higher compilation time, because we expect the code to be executed a lot in the future. The win of execution time with faster code outweighs the cost of time we spend on optimizations.

Back to our example. We saw that `Test::main` was never compiled, thus must have exclusively been executed in the interpreter. `Test::test` is first executed in the interpreter, then is deemed hot enough for a C1 Compilation.

We can force all executions to be run in the interpreter:
```bash
$ java -XX:CompileCommand=printcompilation,Test::* -Xint Test.java
CompileCommand: PrintCompilation Test.* bool PrintCompilation = true
Run
Done
```

Normally, compilation happens in the background, which means that when a compilation is enqueued, we continue with the old mode of execution until the new compilation is completed.
The asynchronous behaviour can sometimes make compilation a little unpredictable. It can be beneficial for debugging to disable background compilation with `-Xbatch`:
```bash
$ java -XX:CompileCommand=printcompilation,Test::* -Xbatch Test.java
CompileCommand: PrintCompilation Test.* bool PrintCompilation = true
Run
25090 1835    b  3       Test::test (4 bytes)
25090 1836    b  4       Test::test (4 bytes)
Done
```
We see that the code is now compiled first with C1, and then with C2. We also see that the blocking behaviour has made the execution much slower.
This is because the VM now blocks the execution any time a compilation needs to be made - and not just in our `Test` class but also during the JVM startup.

It can be useful to limit the compilation to some classes or methods:
```bash
$ java -XX:CompileCommand=printcompilation,Test::* -Xbatch -XX:CompileCommand=compileonly,Test::test Test.java
CompileCommand: PrintCompilation Test.* bool PrintCompilation = true
CompileCommand: compileonly Test.test bool compileonly = true
Run
7680   85    b  3       Test::test (4 bytes)
7680   86    b  4       Test::test (4 bytes)
Done
```

With `-XX:-TieredCompilation`, we can disable tiered compilation, and only C2 is used:
```bash
$ java -XX:CompileCommand=printcompilation,Test::* -XX:CompileCommand=compileonly,Test::test -Xbatch -XX:-TieredCompilation Test.java
CompileCommand: PrintCompilation Test.* bool PrintCompilation = true
CompileCommand: compileonly Test.test bool compileonly = true
Run
8236   85    b        Test::test (4 bytes)
Done
```

Alternatively, we can stop tiered compilation at a certain tier, for example to avoid any C2 compilations and only allow C1:
```bash
$ java -XX:CompileCommand=printcompilation,Test::* -XX:CompileCommand=compileonly,Test::test -Xbatch -XX:TieredStopAtLevel=3 Test.java
CompileCommand: PrintCompilation Test.* bool PrintCompilation = true
CompileCommand: compileonly Test.test bool compileonly = true
Run
7580   85    b  3       Test::test (4 bytes)
Done
```

**A first Look at C2 IR**

With `-XX:+PrintIdeal`, we can display the C2 IR (internal representation) after most optimizations are done, and before code generation:
```bash
$ java -XX:CompileCommand=printcompilation,Test::* -XX:CompileCommand=compileonly,Test::test -Xbatch -XX:-TieredCompilation -XX:+PrintIdeal Test.java
CompileCommand: PrintCompilation Test.* bool PrintCompilation = true
CompileCommand: compileonly Test.test bool compileonly = true
Run
8211   85    b        Test::test (4 bytes)
AFTER: print_ideal
  0  Root  === 0 24  [[ 0 1 3 ]] inner 
  3  Start  === 3 0  [[ 3 5 6 7 8 9 10 11 ]]  #{0:control, 1:abIO, 2:memory, 3:rawptr:BotPTR, 4:return_address, 5:int, 6:int}
  5  Parm  === 3  [[ 24 ]] Control !jvms: Test::test @ bci:-1 (line 17)
  6  Parm  === 3  [[ 24 ]] I_O !jvms: Test::test @ bci:-1 (line 17)
  7  Parm  === 3  [[ 24 ]] Memory  Memory: @BotPTR *+bot, idx=Bot; !jvms: Test::test @ bci:-1 (line 17)
  8  Parm  === 3  [[ 24 ]] FramePtr !jvms: Test::test @ bci:-1 (line 17)
  9  Parm  === 3  [[ 24 ]] ReturnAdr !jvms: Test::test @ bci:-1 (line 17)
 10  Parm  === 3  [[ 23 ]] Parm0: int !jvms: Test::test @ bci:-1 (line 17)
 11  Parm  === 3  [[ 23 ]] Parm1: int !jvms: Test::test @ bci:-1 (line 17)
 23  AddI  === _ 10 11  [[ 24 ]]  !jvms: Test::test @ bci:2 (line 17)
 24  Return  === 5 6 7 8 9 returns 23  [[ 0 ]] 
Done
```
This represents our Java code from the example:
```java
    public static int test(int a, int b) {
        return a + b;
    }
```
Let's look at it backwards: we have a `return` statement, that returns the `+` (addition) of two method parameters `a` and `b`.
We can find the same steps in the IR from `-XX:+PrintIdeal`: `24 Return` returns the value received from IR node `23 AddI`. `23 AddI` adds the two parameters `10 Param` and `11 Param`.
The other nodes are not relevant for us now, and we will come back to some of them at a later point.

**A first Look at generated Assembly Code**

With `-XX:CompileCommand=print,Test::test` we can print a lot of interesting information from the compilation:
```bash
$ java -XX:CompileCommand=printcompilation,Test::* -XX:CompileCommand=compileonly,Test::test -Xbatch -XX:-TieredCompilation -XX:CompileCommand=print,Test::test Test.java
CompileCommand: PrintCompilation Test.* bool PrintCompilation = true
CompileCommand: compileonly Test.test bool compileonly = true
CompileCommand: print Test.test bool print = true
Run
8254   85    b        Test::test (4 bytes)

============================= C2-compiled nmethod ==============================
#r018 rsi   : parm 0: int
#r016 rdx   : parm 1: int
# -- Old rsp -- Framesize: 32 --
#r623 rsp+28: in_preserve
#r622 rsp+24: return address
#r621 rsp+20: in_preserve
#r620 rsp+16: saved fp register
#r619 rsp+12: pad2, stack alignment
#r618 rsp+ 8: pad2, stack alignment
#r617 rsp+ 4: Fixed slot 1
#r616 rsp+ 0: Fixed slot 0
#
----------------------- MetaData before Compile_id = 85 ------------------------
{method}
 - this oop:          0x00007fc87d0943c8
 - method holder:     'Test'
 - constants:         0x00007fc87d094030 constant pool [36] {0x00007fc87d094030} for 'Test' cache=0x00007fc87d0944d8
 - access:            0x9  public static 
 - flags:             0x4080  queued_for_compilation has_loops_flag_init 
 - name:              'test'
 - signature:         '(II)I'
 - max stack:         3
 - max locals:        2
 - size of params:    2
 - method size:       14
 - vtable index:      -2
 - i2i entry:         0x00007fc8ac3ecf00
 - adapters:          AHE@0x00007fc8a8238520: 0xaa i2c: 0x00007fc8ac454380 c2i: 0x00007fc8ac45445e c2iUV: 0x00007fc8ac45443d c2iNCI: 0x00007fc8ac454498
 - compiled entry     0x00007fc8ac45445e
 - code size:         4
 - code start:        0x00007fc87d0943c0
 - code end (excl):   0x00007fc87d0943c4
 - method data:       0x00007fc87d094578
 - checked ex length: 0
 - linenumber start:  0x00007fc87d0943c4
 - localvar length:   0

------------------------ OptoAssembly for Compile_id = 85 -----------------------
#
#  int ( int, int )
#
000     N1: #	out( B1 ) <- in( B1 )  Freq: 1

000     B1: #	out( N1 ) <- BLOCK HEAD IS JUNK  Freq: 1
000     # stack bang (96 bytes)
	pushq   rbp	# Save rbp
	subq    rsp, #16	# Create frame

01a     leal    RAX, [RSI + RDX]
01d     addq    rsp, 16	# Destroy frame
	popq    rbp
	cmpq    rsp, poll_offset[r15_thread] 
	ja      #safepoint_stub	# Safepoint: poll for GC

02c     ret

--------------------------------------------------------------------------------
----------------------------------- Assembly -----------------------------------

Compiled method (c2) 8266   85             Test::test (4 bytes)
 total in heap  [0x00007fc8ac567888,0x00007fc8ac5679f8] = 368
 relocation     [0x00007fc8ac567970,0x00007fc8ac567980] = 16
 main code      [0x00007fc8ac567980,0x00007fc8ac5679d0] = 80
 stub code      [0x00007fc8ac5679d0,0x00007fc8ac5679e8] = 24
 oops           [0x00007fc8ac5679e8,0x00007fc8ac5679f0] = 8
 metadata       [0x00007fc8ac5679f0,0x00007fc8ac5679f8] = 8
 immutable data [0x00007fc85c085a10,0x00007fc85c085a50] = 64
 dependencies   [0x00007fc85c085a10,0x00007fc85c085a18] = 8
 scopes pcs     [0x00007fc85c085a18,0x00007fc85c085a48] = 48
 scopes data    [0x00007fc85c085a48,0x00007fc85c085a50] = 8

[Disassembly]
--------------------------------------------------------------------------------
[Constant Pool (empty)]

--------------------------------------------------------------------------------

[Verified Entry Point]
  # {method} {0x00007fc87d0943c8} 'test' '(II)I' in 'Test'
  # parm0:    rsi       = int
  # parm1:    rdx       = int
  #           [sp+0x20]  (sp of caller)
 ;; N1: #	out( B1 ) <- in( B1 )  Freq: 1
 ;; B1: #	out( N1 ) <- BLOCK HEAD IS JUNK  Freq: 1
  0x00007fc8ac567980:   mov    %eax,-0x18000(%rsp)
  0x00007fc8ac567987:   push   %rbp
  0x00007fc8ac567988:   sub    $0x10,%rsp
  0x00007fc8ac56798c:   cmpl   $0x0,0x20(%r15)
  0x00007fc8ac567994:   jne    0x00007fc8ac5679c3           ;*synchronization entry
                                                            ; - Test::test@-1 (line 17)
  0x00007fc8ac56799a:   lea    (%rsi,%rdx,1),%eax
  0x00007fc8ac56799d:   add    $0x10,%rsp
  0x00007fc8ac5679a1:   pop    %rbp
  0x00007fc8ac5679a2:   cmp    0x28(%r15),%rsp              ;   {poll_return}
  0x00007fc8ac5679a6:   ja     0x00007fc8ac5679ad
  0x00007fc8ac5679ac:   retq   
  0x00007fc8ac5679ad:   movabs $0x7fc8ac5679a2,%r10         ;   {internal_word}
  0x00007fc8ac5679b7:   mov    %r10,0x498(%r15)
  0x00007fc8ac5679be:   jmpq   0x00007fc8ac500760           ;   {runtime_call SafepointBlob}
  0x00007fc8ac5679c3:   callq  Stub::nmethod_entry_barrier  ;   {runtime_call StubRoutines (final stubs)}
  0x00007fc8ac5679c8:   jmpq   0x00007fc8ac56799a
  0x00007fc8ac5679cd:   hlt    
  0x00007fc8ac5679ce:   hlt    
  0x00007fc8ac5679cf:   hlt    
[Exception Handler]
  0x00007fc8ac5679d0:   jmpq   0x00007fc8ac500c60           ;   {no_reloc}
[Deopt Handler Code]
  0x00007fc8ac5679d5:   callq  0x00007fc8ac5679da
  0x00007fc8ac5679da:   subq   $0x5,(%rsp)
  0x00007fc8ac5679df:   jmpq   0x00007fc8ac501ba0           ;   {runtime_call DeoptimizationBlob}
  0x00007fc8ac5679e4:   hlt    
  0x00007fc8ac5679e5:   hlt    
  0x00007fc8ac5679e6:   hlt    
  0x00007fc8ac5679e7:   hlt    
--------------------------------------------------------------------------------
[/Disassembly]
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - 
Oops:
  0x00007fc8ac5679e8:   0x00000006357f0c98 a 'com/sun/tools/javac/launcher/MemoryClassLoader'{0x00000006357f0c98}
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - 
Metadata:
  0x00007fc8ac5679f0:   0x00007fc87d0943c8 {method} {0x00007fc87d0943c8} 'test' '(II)I' in 'Test'
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - 
pc-bytecode offsets:
PcDesc(pc=0x00007fc8ac56797f offset=ffffffff bits=0):
PcDesc(pc=0x00007fc8ac56799a offset=1a bits=0):
   Test::test@-1 (line 17)
PcDesc(pc=0x00007fc8ac5679e9 offset=69 bits=0):
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - 
oop maps:ImmutableOopMapSet contains 0 OopMaps

- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - 
scopes:
ScopeDesc(pc=0x00007fc8ac56799a offset=1a):
   Test::test@-1 (line 17)
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - 
relocations:
         @0x00007fc8ac567970: 5822
relocInfo@0x00007fc8ac567970 [type=11(poll_return) addr=0x00007fc8ac5679a2 offset=34]
         @0x00007fc8ac567972: 780b400b
relocInfo@0x00007fc8ac567974 [type=8(internal_word) addr=0x00007fc8ac5679ad offset=11 data=11] | [target=0x00007fc8ac5679a2]
         @0x00007fc8ac567976: 3111
relocInfo@0x00007fc8ac567976 [type=6(runtime_call) addr=0x00007fc8ac5679be offset=17 format=1] | [destination=0x00007fc8ac500760]
         @0x00007fc8ac567978: 3105
relocInfo@0x00007fc8ac567978 [type=6(runtime_call) addr=0x00007fc8ac5679c3 offset=5 format=1] | [destination=0x00007fc8ac45ece0]
         @0x00007fc8ac56797a: 000d
relocInfo@0x00007fc8ac56797a [type=0(none) addr=0x00007fc8ac5679d0 offset=13]
         @0x00007fc8ac56797c: 3100
relocInfo@0x00007fc8ac56797c [type=6(runtime_call) addr=0x00007fc8ac5679d0 offset=0 format=1] | [destination=0x00007fc8ac500c60]
         @0x00007fc8ac56797e: 310f
relocInfo@0x00007fc8ac56797e [type=6(runtime_call) addr=0x00007fc8ac5679df offset=15 format=1] | [destination=0x00007fc8ac501ba0]
         @0x00007fc8ac567980: 
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - 
Dependencies:
Dependency of type evol_method
  method  = *{method} {0x00007fc87d0943c8} 'test' '(II)I' in 'Test'
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - 
ExceptionHandlerTable (size = 0 bytes)
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - 
ImplicitExceptionTable is empty
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - 
Recorded oops:
#0: 0x0000000000000000 nullptr-oop
#1: 0x00000006357f0c98 a 'com/sun/tools/javac/launcher/MemoryClassLoader'{0x00000006357f0c98}
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - 
Recorded metadata:
#0: 0x0000000000000000 nullptr-oop
#1: 0x00007fc87d0943c8 {method} {0x00007fc87d0943c8} 'test' '(II)I' in 'Test'
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - 
Done
------------------------------------------------------------------------
static Test::test(II)I
  interpreter_invocation_count:        6784
  invocation_counter:                  6784
  backedge_counter:                       0
  decompile_count:                        0
  mdo size: 384 bytes

   0 iload_0
   1 iload_1
   2 iadd
   3 ireturn
------------------------------------------------------------------------
Total MDO size: 384 bytes
```

Let us look at a few details.
```
#r018 rsi   : parm 0: int
#r016 rdx   : parm 1: int
```
We see that the two int arguments are compiled to be in the CPU registers `rsi` and `rdx`. This will be interesting when looking at the assembly.
Let us first look at the `OptoAssembly`, which is an intermediate assembly-like form before machine-code generation:
```
------------------------ OptoAssembly for Compile_id = 85 -----------------------
#
#  int ( int, int )
#
000     N1: #	out( B1 ) <- in( B1 )  Freq: 1

000     B1: #	out( N1 ) <- BLOCK HEAD IS JUNK  Freq: 1
000     # stack bang (96 bytes)
	pushq   rbp	# Save rbp
	subq    rsp, #16	# Create frame

01a     leal    RAX, [RSI + RDX]
01d     addq    rsp, 16	# Destroy frame
	popq    rbp
	cmpq    rsp, poll_offset[r15_thread] 
	ja      #safepoint_stub	# Safepoint: poll for GC

02c     ret
```
The important instructions to look at here are:
- `leal    RAX, [RSI + RDX]`: basically does `rax = rsi + rdx`, i.e. it adds the two method arguments.
- `ret` returns the value in `rax`.

The other instructions all have to do with maintaining the stack-frames, and performing a safepoint-poll.

We find the actual `x64` machine code in a later block:
```
[Verified Entry Point]
  # {method} {0x00007fc87d0943c8} 'test' '(II)I' in 'Test'
  # parm0:    rsi       = int
  # parm1:    rdx       = int
  #           [sp+0x20]  (sp of caller)
 ;; N1: #	out( B1 ) <- in( B1 )  Freq: 1
 ;; B1: #	out( N1 ) <- BLOCK HEAD IS JUNK  Freq: 1
  0x00007fc8ac567980:   mov    %eax,-0x18000(%rsp)
  0x00007fc8ac567987:   push   %rbp
  0x00007fc8ac567988:   sub    $0x10,%rsp
  0x00007fc8ac56798c:   cmpl   $0x0,0x20(%r15)
  0x00007fc8ac567994:   jne    0x00007fc8ac5679c3           ;*synchronization entry
                                                            ; - Test::test@-1 (line 17)
  0x00007fc8ac56799a:   lea    (%rsi,%rdx,1),%eax
  0x00007fc8ac56799d:   add    $0x10,%rsp
  0x00007fc8ac5679a1:   pop    %rbp
  0x00007fc8ac5679a2:   cmp    0x28(%r15),%rsp              ;   {poll_return}
  0x00007fc8ac5679a6:   ja     0x00007fc8ac5679ad
  0x00007fc8ac5679ac:   retq   
  0x00007fc8ac5679ad:   movabs $0x7fc8ac5679a2,%r10         ;   {internal_word}
  0x00007fc8ac5679b7:   mov    %r10,0x498(%r15)
  0x00007fc8ac5679be:   jmpq   0x00007fc8ac500760           ;   {runtime_call SafepointBlob}
  0x00007fc8ac5679c3:   callq  Stub::nmethod_entry_barrier  ;   {runtime_call StubRoutines (final stubs)}
  0x00007fc8ac5679c8:   jmpq   0x00007fc8ac56799a
  0x00007fc8ac5679cd:   hlt    
  0x00007fc8ac5679ce:   hlt    
  0x00007fc8ac5679cf:   hlt    
[Exception Handler]
  0x00007fc8ac5679d0:   jmpq   0x00007fc8ac500c60           ;   {no_reloc}
[Deopt Handler Code]
  0x00007fc8ac5679d5:   callq  0x00007fc8ac5679da
  0x00007fc8ac5679da:   subq   $0x5,(%rsp)
  0x00007fc8ac5679df:   jmpq   0x00007fc8ac501ba0           ;   {runtime_call DeoptimizationBlob}
```
You may have to install the `hsdis` disassembler, otherwise you will only see bytes here
(see
[this blog-post](https://blogs.oracle.com/javamagazine/post/java-hotspot-hsdis-disassembler)
and
[this wiki](https://wiki.openjdk.org/display/HotSpot/PrintAssembly)
).

This is now more verbose, but also represents directly what happens on the CPU. Again, the most relevant instructions are:
- `lea    (%rsi,%rdx,1),%eax`
- `retq`

Somewhere at the end, we find the bytecode again:
```
   0 iload_0
   1 iload_1
   2 iadd
   3 ireturn
```

I encourage you to take this example, and play around a little with it. See how changes to the `Test::test` method affect the compiled bytecode, and the compiled assembly code.

[Continue with Part 2](https://github.com/eme64/blog/edit/main/_posts/2024-12-24-Intro-to-C2-Part02.md)
