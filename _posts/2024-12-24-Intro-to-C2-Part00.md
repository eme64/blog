---
title: "Introduction to HotSpot JVM C2 JIT Compiler, Part 0"
date: 2024-12-24
---

I have now worked at Oracle for 3 years. I've been learning a lot during this time, especially considering that I focused mostly on
HPC (high-performance computing) and theoretical computer science in my education at ETH Zürich, and had no formal education in
compilers. Over the last years, I had the opportunity to learn a lot from my fellow C2 engineers at Oracle but also from
other companies and even individual contributors working on OpenJDK. In this blog series, I summarize my understanding of the
C2 Compiler in the HotSpot JVM, and hopefully make it easier for others to dive into C2.

Target audiences:
- New hires working on HotSpot's C2 Compiler.
- People working on the JVM that want to learn more about C2.
- Anybody interested about the JVM and (JIT) Compilers.

Topics I hope to address in this series:
- Parsing Java bytecode into IR (sea-of-nodes).
- Understanding C2 with visualization and through the rr-debugger.
- Intermediate Representation (IR) canonicalization and optimization: Iterative Global Value Numbering (IGVN) and Conditional Constant Propagation (CCP).
- Loop optimizations.
- Instruction scheduling (called matching in C2) in the backend for specific CPUs.

Additionally:
- Debugging C2 using [rr](https://github.com/rr-debugger/rr) (or GDB), and with the help of JVM flags.
- Analyzing the generated Assembly code: what did C2 do with my Java code?
- Benchmarks: stand-alone (just a single Java file) or using the [Java Microbenchmark Harness (JMH)](https://github.com/openjdk/jmh).
- Testing: how to write good tests to verify that optimizations are applied correctly on the IR and eventually produce correct Assembly code.

**A note to new individual External Contributors**

The HotSpot JVM is part of the OpenJDK, which means anybody is welcome to contribute. In fact, I regularly review code contributions from individuals at other
companies involved with OpenJDK, and also from individual contributors who work on C2 in their free time.

You are very welcome to join the communal effort to improve HotSpot, and improve your own skills in the process. I personally can help you mostly with C2, because
that is what I have been working on over the last years.
People often have their own ideas: that is fantastic. But it is important to first discuss ideas, so you don't put a lot of effort into something that will potentially be rejected in the code review.

We highly encourage you to reach out to us, and ask if there are any simple tasks where you can make a helpful contribution, and
learn the processes of code review.

**Blog Series Index**

- [Part 0](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part00.html): This introduction.
- [Part 1](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part01.html): Basics of JIT compilation (`javac`, bytecode, debug-builds, TieredCompilation, C2 IR, generated assembly).
- [Part 2](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part02.html): Helpful tools (IGV, rr) and Global Value Numbering during parsing. Plus exercises for the reader.
- [Part 3](https://eme64.github.io/blog/2025/01/23/Intro-to-C2-Part03.html): Overview of the optimization phases and On Stack Replacement (OSR).
- [Part 4](https://eme64.github.io/blog/2025/01/23/Intro-to-C2-Part04.html): Loop Optimizations.

**Helpful Links**

Here some other *links to get you started*:
- The official [Contributing to OpenJDK](https://dev.java/contribute/openjdk/) site.
- The [Developers Guide](https://openjdk.org/guide/): has a lot of very important information about the processes and rules. Make sure you read at least about [Contributing to an OpenJDK Project](https://openjdk.org/guide/#contributing-to-an-openjdk-project).
- There is a lot of good information on the [OpenJDK](https://openjdk.org/) site.
- [HotSpot code style-guide](https://github.com/openjdk/jdk/blob/master/doc/hotspot-style.md).
- [Java Youtube Channel](https://www.youtube.com/Java): talks about projects, releases, etc. Good if you want to stay informed about the bigger picture. Here a personal selection:
  - [Java in 2024 - #JVMLS keynote (Georges Saab, SVP Java Plagform Group, Oracle)](https://www.youtube.com/watch?v=NV4v7KXKQ-c) About the Java 6 month release cycle.
  - [Java Performance Update (2024, Per Minborg)](https://www.youtube.com/watch?v=rXv2-lN5Xgk&t=2567s)
  - [Valhalla - Java's Epic Refactor (2024, Brian Goetz)](https://www.youtube.com/watch?v=Dhn-JgZaBWo) About value types.
  - [Project Leyden Update (JVMLS 2024)](https://www.youtube.com/watch?v=OOPSU4LnKg0) About using training runs / AOT to improve startup time.
  - [Foreign Function & Memory API - A (Quick) Peek Under the Hood (2024, Maurizio Cimadamore)](https://www.youtube.com/watch?v=iwmVbeiA42E&t=3s) About FFM, improved interoperability with native (C/C++) code and memory.
  - [Project Lilliput - Beyond Compact Headers (2024, Roman Kennke)](https://www.youtube.com/watch?v=kHJ1moNLwao&t=43s)
  - [Project Babylon - Code Reflection (2024, Paul Sandoz)](https://www.youtube.com/watch?v=6c0DB2kwF_Q&t=8s)
  - [[VDT19] Java - Quo Vadis? by Tobias Hartmann](https://www.youtube.com/watch?v=149Q1Xbud2I) ([slides](http://cr.openjdk.java.net/~thartmann/talks/2019-Voxxed_days.pdf)) Also covers Valhalla.
- The [OpenJDK GitHub](https://github.com/openjdk/jdk). I suggest you fork it and follow the instructions to build it yourself. That allows you to make changes to the JVM, and inspect its inner working with a debugger.

Links to read more about the inner workings of C2:
- [OpenJDK Wiki on C2 IR](https://wiki.openjdk.org/display/HotSpot/C2+IR+Graph+and+Nodes)
- High-level article about [How the JIT compiler boosts Java performance in OpenJDK (Roland Westrelin)](https://developers.redhat.com/articles/2021/06/23/how-jit-compiler-boosts-java-performance-openjdk#)
- [Master thesis by Thomas Würthinger in 2007](https://ssw.jku.at/Research/Papers/Wuerthinger07Master/Wuerthinger07Master.pdf) (now works on GraalVM). Section 3 gives a good overview over the HotSpot compilation, though since JDK-8008938 (JDK8 / 2014) tiered compilation is now the default (client compiler = C1, server compiler = C2).
- [Slides about debugging C2 by Tobias Hartmann in 2020](https://cr.openjdk.org/~thartmann/talks/2020-Debugging_HotSpot.pdf) and the [Video](https://drive.google.com/file/d/100v6iYLTHdImdEQxeBu1YNtys8rSfVff/view). I hope to cover a lot of that material in this series as well.
- [Cliff Click's talk on C2](https://www.youtube.com/watch?v=9epgZ-e6DUU)
- [Blog by Aleksey Shipilev](https://shipilev.net/jvm/anatomy-quarks/).
- [Blog by Roland Westrelin](https://developers.redhat.com/author/roland-westrelin).
- And of course [my own blog](https://eme64.github.io/blog/).

**Credits**

At this point, I would like to thank [Tobias Hartmann](https://github.com/TobiHartmann) and [Christian Hagedorn](https://github.com/chhagedorn) from the Swiss Compiler Team
for mentoring me over the last years, and for their contributions to this blog series.
They have made countless suggestions and corrections. If you find any errors, that's still on me ;)

**Conclusion for Part 0**

Ok. Now that we have discussed some preliminary things, we can get started with the technical material :)

[Continue with Part 1](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part01.html)

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
