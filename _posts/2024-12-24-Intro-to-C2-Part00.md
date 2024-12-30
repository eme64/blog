---
title: "Introduction to HotSpot JVM C2 JIT Compiler, Part 0"
date: 2024-12-24
---

I have now worked at Oracle for 3 years. I learned a lot during this time, especially considering that I focused mostly on
HPC (high-performance computing) and theoretical computer science in my education at ETH, and had no formal education in
compilers. Over the last years, I had the opportunity to learn a lot from my fellow C2 engineers, at Oracle but also from
other companies and even individual contributors working on OpenJDK. I would now like to summarize my understanding of the
C2 Compiler in the HotSpot JVM, and hopefully make it easier for others to break into C2.

Target audiences:
- New hires working on HotSpot's C2 Compiler.
- People working on the JVM that want to learn more about C2.
- Anybody interested about the JVM and (JIT) Compilers.

Topics I hope to address in this series:
- Parsing Java bytecode into IR (see-of-nodes).
- IGVN and CCP (canonicalization and local optimizations).
- Loop optimizations.
- Matching in the backend for specific CPUs.

Additionally:
- Debugging C2 using RR (or GDB), and the help of JVM flags.
- Analyzing the generated Assembly code: what did C2 do with my Java code?
- Benchmarks: stand-alone (just a single Java file) or using JMH.
- Testing: how to write good tests to verify optimizations are applied and create correct Assembly code (using IR framework, random inputs, etc).

**A note to new individual External Contributors**

The HotSpot JVM is part of the OpenJDK, which means anybody is welcome to contribute. In fact, I regularly review code contributions from individuals at other
companies involved with OpenJDK, but also individual contributors who work on C2 in their free time.

You are very welcome to join the communal effort to improve HotSpot, and improve your own skills in the process. I personally can help you mostly with C2, because
that is what I have been working on over the last years.
People often have their own ideas: that is fantastic. But it is important to first discuss ideas, so you don't put a lot of time into something that then will be
rejected in the code review. I would suggest you start by reaching out to us, and ask if there are any simple tasks where you can make a helpful contribution, and
learn the processes of code review.

**Helpful Links**

Here some other *links to get you started*:
- The official [Contributing to OpenJDK](https://dev.java/contribute/openjdk/) site.
- The [Developers Guide](https://openjdk.org/guide/): has a lot of very important information about the processes and rules. Make sure you read at least about [Contributing to an OpenJDK Project](https://openjdk.org/guide/#contributing-to-an-openjdk-project).
- There is a lot of good information on the [OpenJDK](https://openjdk.org/) site.
- [HotSpot code style-guide](https://github.com/openjdk/jdk/blob/master/doc/hotspot-style.md).
- [Java Youtube Channel](https://www.youtube.com/Java): talks about projects, releases, etc. Good if you want to stay informed about the bigger picture.
- The [OpenJDK GitHub](https://github.com/openjdk/jdk). I suggest you fork it and follow the instructions to build it yourself. That allows you to make changes to the JVM, and inspect its inner working with a debugger.

Links to read more about the inner workings of C2:
- [OpenJDK Wiki on C2 IR](https://wiki.openjdk.org/display/HotSpot/C2+IR+Graph+and+Nodes)
- High-level article about [How the JIT compiler boosts Java performance in OpenJDK (Roland Westrelin)](https://developers.redhat.com/articles/2021/06/23/how-jit-compiler-boosts-java-performance-openjdk#)
- [Master thesis by Thomas Würthinger in 2007](https://ssw.jku.at/Research/Papers/Wuerthinger07Master/Wuerthinger07Master.pdf) (now works on GraalVM). Section 3 gives a good overview over the HotSpot compilation, though since 2007 tiered compilation is now the default (client compiler = C1, server compiler = C2).
- [Slides about debugging C2 by Tobias Hartmann in 2020](https://cr.openjdk.org/~thartmann/talks/2020-Debugging_HotSpot.pdf). I hope to cover a lot of that material in this series as well.
- [Blog by Aleksey Shipilev](https://shipilev.net/jvm/anatomy-quarks/).
- [Blog by Roland Westrelin](https://developers.redhat.com/author/roland-westrelin).
- And of course [my own blog](https://eme64.github.io/blog/).

**Conclusion for Part 0**

Ok. Now that we have discussed some preliminary things, we can get started with the technical material :)

[Continue with Part 1](https://eme64.github.io/blog/2024/12/24/Intro-to-C2-Part01.html)