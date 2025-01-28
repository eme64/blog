---
title: "AutoVectorization (SuperWord) Status"
date: 2025-01-01
---

I present this graphical overview of the C2 AutoVectorizer (SuperWord). The goal is to help myself and others understand the different improvements and their dependencies.

Related blog post: [C2 AutoVectorizer Improvement Ideas](https://eme64.github.io/blog/2023/11/03/C2-AutoVectorizer-Improvement-Ideas.html).

**January 2025**

- Integrated: [JDK-8343685](https://bugs.openjdk.org/browse/JDK-8343685) C2 SuperWord: refactor VPointer with MemPointer
  - It generalizes the pointer parsing, and allows more patterns to be analyzed for static aliasing analysis (adjacency and overlap queries).
- In Review: [JDK-8323582](https://bugs.openjdk.org/browse/JDK-8323582) C2 SuperWord AlignVector: misaligned vector memory access with unaligned native memory
  - Runtime Check for alignment check when using `-XX:+AlignVector` (platforms that require strict alignment). Arrays, like all Java Objects, are `ObjectAlignmentInBytes` aligned (usually 8 byte alignment). But native memory (e.g. with MemorySegment) does not give us any such alignment guarantees. So I'm introducing a Predicate version (i.e. deopt when the runtime check fails) and a multiversioning approach (if the check passes enter the fast loop where we assume alignment, else take the slow loop where we have no alignment assumption and may not be able to vectorize as a result).
  - The Predicate and Multiversioning infrastructure can then be reused for [JDK-8324751](https://bugs.openjdk.org/browse/JDK-8324751) C2 SuperWord: Aliasing Analysis runtime check.
- WIP: [JDK-8340093](https://bugs.openjdk.org/browse/JDK-8340093) C2 SuperWord: implement cost model
  - With the goal to have a more accurate heuristic if we should vectorize reductions (can have additional cost in the loop body).
  - Will also allow the vectorization of other shapes: shuffle, pack, unpack etc inside the loop. We need to know if the vectorized loop body is expected to be faster (have overall fewer / cheaper instructions) than the scalar loop.
  - If-conversion would also require us to perform such cost-modeling.
- WIP: [JDK-8343597](https://bugs.openjdk.org/browse/JDK-8343597) C2 SuperWord: RelaxedMath for faster float reductions
- WIP: Investigate RangeCheck elimination and other issues for vectorization of MemorySegment loops ([JDK-8331659](https://bugs.openjdk.org/browse/JDK-8331659) and others).

Legend:
- Blue: RFE
- Red: Bug
- Gray: Future Work (RFE)
- Orange: Priority

<p>Navigate: [+/-] Zoom, [F] toggle Fullscreen</p>
<iframe id = "issue_graph" height="800px" width="100%" resize="both" overflow="auto">
</iframe>

<script>

  maxX = 100;
  maxY = 100;

  issues = {}
  tags = []

  graph_zoom = 1.0;

  graph_fullscreen = false;

  graph_document = undefined;

  function updateMax(x,y) {
    maxX = Math.max(maxX,x);
    maxY = Math.max(maxY,y);
  }

  function updateCanvas(overFocusId) {
    var universe = graph_document.getElementById("universe")
    var canv = graph_document.getElementById("mainCanvas")
    canv.width = maxX + 405;
    canv.height = maxY + 25;

    var ctx = canv.getContext("2d");
    ctx.clearRect(0, 0, canv.width, canv.height);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canv.width, canv.height);

    // Draw edges
    for (const [name, issue] of Object.entries(issues)) {
      for (var edge of issue.edges) {
        var issue2 = issues[edge.name];
        if (issue2 === undefined) {
          console.log("did not find " + edge.name + " from " + name);
          break;
        }
        var x1 = issue.x - 10;
        var y1 = issue.y + 10;
        var x2 = issue2.x - 10;
        var y2 = issue2.y + 10;

        switch (edge.style) {
          case "parent":
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.bezierCurveTo(x2, y1, x2, y1, x2, y2);
            ctx.strokeStyle = edge.color;
            ctx.stroke();
            break;
          case "after":
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.bezierCurveTo(x1, y2, x2, y1, x2, y2);
            ctx.strokeStyle = edge.color;
            ctx.stroke();
            break;
          default:
            console.log("edge style not handled: " + edge.style);
        }
      }
    }

    // Draw issues
    for (const [name, issue] of Object.entries(issues)) {
      var div = issue.div;

      if (overFocusId==div.id) {
        div.style.background = issue.color.highlight;
      } else {
        div.style.background = issue.color.background;
      }

      ctx.beginPath();
      ctx.arc(issue.x - 10, issue.y + 10, issue.radius, 0, 2 * Math.PI);
      ctx.fillStyle = issue.color.dot;
      ctx.fill();
    }
  }

  function addIssue(issue) {
    var universe = graph_document.getElementById('universe')
    universe.style.position = "absolute";
    var div = graph_document.createElement("myelement");
    div.style.position = "absolute";
    div.style.width = "400px";
    div.style.height = "20px";
    div.style.background = "#ffffff";
    div.style.color = "black";
    div.innerHTML = "<a href='https://bugs.openjdk.org/browse/JDK-" + issue.name
                    + "' style='font-size:14px;text-decoration:none' target='_blank'>"
                    + issue.name + ": " + issue.desc + "</a>";
    if (issue.pr != "") {
      div.innerHTML += " <a href='" + issue.pr
                       + "' style='font-size:14px;text-decoration:none' target='_blank'>[PR]</a>";
    }
    div.innerHTML += "<font size='1'> (" + issue.assigned + ")</font>";

    div.style.left = issue.x+"px";
    div.style.top  = issue.y+"px";
    updateMax(issue.x, issue.y);

    div.id = issue.name;
    universe.appendChild(div);

    div.onmouseover = function() {mouseOverIssue(div.id);}

    return div;
  }

  function mouseOverIssue(id) {
    updateCanvas(id);
  }

  function addTag(tag) {
    var universe = graph_document.getElementById('universe')
    var div = graph_document.createElement("myelement");
    div.style.position = "absolute";
    div.style.width = "400px";
    div.style.height = "20px";
    div.style.background = "#ffffff";
    div.style.color = "black";
    div.innerHTML += "<blub style='font-size:14px;" + tag.style + "'> " + tag.text + "</blub>";

    div.style.left = tag.x+"px";
    div.style.top  = tag.y+"px";
    updateMax(tag.x, tag.y);

    universe.appendChild(div);
    return div;
  }

  function init() {
    var graph_frame = document.getElementById("issue_graph")
    graph_document = graph_frame.contentWindow.document

    graph_document.body.style="margin:0;padding:0";

    var div = graph_document.createElement("div");
    graph_document.body.appendChild(div);

    var universe =  graph_document.createElement('universe');
    universe.id = "universe";
    div.appendChild(universe);

    var key_listener = (event) => {
      switch (event.key) {
        case "+":
          graph_zoom *= 1.05;
          graph_zoom = Math.min(1.0, graph_zoom);
          universe.style = "zoom:" + graph_zoom;
          console.log("plus");
          break;
        case "-":
          graph_zoom /= 1.05;
          graph_zoom = Math.max(0.1, graph_zoom);
          universe.style = "zoom:" + graph_zoom;
          break;
        case "f":
          graph_fullscreen = !graph_fullscreen;
          if (graph_fullscreen) {
            graph_frame.style.position = "absolute";
            graph_frame.style.left  = "0";
            graph_frame.style.right = "0";
            graph_frame.style.width =  "calc(100% - 20px)";
            graph_frame.style.height = "calc(100% - 100px)";
	  } else {
            graph_frame.style.position = "relative";
            graph_frame.style.left  = "0";
            graph_frame.style.right = "0";
            graph_frame.style.width =  "100%";
            graph_frame.style.height = "800px";
          }
          break;
        default:
          console.log("keydown " + event.key + " " + event.code);
      }
    };
    document.addEventListener("keydown", key_listener);
    graph_document.addEventListener("keydown", key_listener);

    var canv = graph_document.createElement('canvas');
    canv.id = 'mainCanvas';
    universe.appendChild(canv);

    issues = {};
    tags = [];

    var bug_open   = {dot: "#ff0000", background: "#ff9999", highlight: "#ff8888"}
    var bug_done   = {dot: "#ff9999", background: "#ffeeee", highlight: "#ffdddd"}
    var rfe_open   = {dot: "#999999", background: "#cccccc", highlight: "#dddddd"}
    var rfe_review = {dot: "#0000ff", background: "#bbbbff", highlight: "#aaaaff"}
    var rfe_done   = {dot: "#9999ff", background: "#eeeeff", highlight: "#ddddff"}

    var priority   = {dot: "#ff9900", background: "#ffddbb", highlight: "#ffeedd"}
    //var rfe_green   = {dot: "#00ff00", background: "#ccffcc", highlight: "#ddffdd"}

    var x = 0;
    var y = 0;

    //issues[""] = {desc:"",
    //                     assigned:"Emanuel",
    //                     jdk: 0,
    //                     pr: "https://github.com/openjdk/jdk/pull/",
    //                     x: x, y: y, color: rfe_done, radius: 5,
    //                     edges: []};
    y += 25;

    // -------------------------- General Bugs / RFE
    x = 30;
    y = 10;
    tags.push({text: "General Bugs and RFEs",
               x: x-20, y: y, style: "color=black;font-weight:bold"});
    y += 25;
    issues["8298935"] = {desc:"WR: independence bug",
                         assigned:"Emanuel",
                         jdk: 21,
                         pr: "https://github.com/openjdk/jdk/pull/12350",
                         x: x, y: y, color: bug_done, radius: 7,
                         edges: []};
    y += 25;
    issues["8305055"] = {desc:"IR failures on aarch64 (collateral damage)",
                         assigned:"Fei Gao",
                         jdk: 21,
                         pr: "https://github.com/openjdk/jdk/pull/13236",
                         x: x+20, y: y, color: bug_done, radius: 3,
                         edges: [{style: "parent", name: "8298935", color: "red"}]};
    y += 25;
    issues["8304720"] = {desc:"WR: schedule using dependency-graph",
                         assigned:"Emanuel",
                         jdk: 21,
                         pr: "https://github.com/openjdk/jdk/pull/13354",
                         x: x, y: y, color: bug_done, radius: 5,
                         edges: []};
    y += 25;
    issues["8304042"] = {desc:"WR: packs can introduce cycles",
                         assigned:"Emanuel",
                         jdk: 21,
                         pr: "https://github.com/openjdk/jdk/pull/13078",
                         x: x, y: y, color: bug_done, radius: 5,
                         edges: []};
    y += 25;
    issues["8308917"] = {desc:"assert before a bailout",
                         assigned:"Emanuel",
                         jdk: 21,
                         pr: "https://github.com/openjdk/jdk/pull/14168",
                         x: x, y: y, color: rfe_done, radius: 3,
                         edges: []};
    y += 25;
    issues["8260943"] = {desc:"rm _do_vector_loop_experimental",
                         assigned:"Emanuel",
                         jdk: 21,
                         pr: "https://github.com/openjdk/jdk/pull/13930",
                         x: x, y: y, color: rfe_done, radius: 3,
                         edges: []};
    y += 25;




    issues["8309204"] = {desc:"Obsolete DoReserveCopyInSuperWord",
                         assigned:"Emanuel",
                         jdk: 22,
                         pr: "https://github.com/openjdk/jdk/pull/16022",
                         x: x, y: y, color: rfe_done, radius: 5,
                         edges: []};
    y += 25;
    issues["8316679"] = {desc:"WR: load/store order",
                         assigned:"Emanuel",
                         jdk: 22,
                         pr: "https://github.com/openjdk/jdk/pull/15864",
                         x: x, y: y, color: bug_done, radius: 3,
                         edges: []};
    y += 25;
    issues["8316594"] = {desc:"WR: load/store order",
                         assigned:"Emanuel",
                         jdk: 22,
                         pr: "https://github.com/openjdk/jdk/pull/15866",
                         x: x, y: y, color: bug_done, radius: 3,
                         edges: []};
    y += 25;
    issues["8312332"] = {desc:"Refactor: SWPointer -> VPointer",
                         assigned:"Fei Gao",
                         jdk: 22,
                         pr: "https://github.com/openjdk/jdk/pull/15013",
                         x: x, y: y, color: rfe_done, radius: 5,
                         edges: []};

    y += 25;
    issues["8325159"] = {desc:"Add AutoVectorize to CITime",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/17683",
                         x: x, y: y, color: rfe_done, radius: 3,
                         edges: []};


    // Refactorings
    y += 25;
    issues["8315361"] = {desc:"Refactor: VLoopAnalyzer",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "",
                         x: x, y: y, color: rfe_done, radius: 7,
                         edges: []};
    y += 25;
    issues["8324750"] = {desc:"Refactor: renaming",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/17583",
                         x: x+20, y: y, color: rfe_done, radius: 3,
                         edges: [{style: "parent", name: "8315361", color: "black"}]};
    y += 25;
    issues["8324752"] = {desc:"Refactor: rm SuperWordRTDepCheck",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/17585",
                         x: x+20, y: y, color: rfe_done, radius: 3,
                         edges: [{style: "parent", name: "8315361", color: "black"}]};
    y += 25;
    issues["8317572"] = {desc:"Refactor: TraceAutoVectorization",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/17586",
                         x: x+20, y: y, color: rfe_done, radius: 5,
                         edges: [{style: "parent", name: "8315361", color: "black"}]};
    y += 25;
    issues["8324765"] = {desc:"Refactor: rm dead code (Extract)",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/17589",
                         x: x+20, y: y, color: rfe_done, radius: 3,
                         edges: [{style: "parent", name: "8315361", color: "black"}]};
    y += 25;
    issues["8324775"] = {desc:"Refactor: visited set (no reuse)",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/17594",
                         x: x+20, y: y, color: rfe_done, radius: 3,
                         edges: [{style: "parent", name: "8315361", color: "black"}]};
    y += 25;
    issues["8324794"] = {desc:"Refactor: unrolling_analysis/reductions",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/17604",
                         x: x+20, y: y, color: rfe_done, radius: 3,
                         edges: [{style: "parent", name: "8315361", color: "black"}]};
    y += 25;
    issues["8324890"] = {desc:"Refactor: VLoop",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/17624",
                         x: x+20, y: y, color: rfe_done, radius: 5,
                         edges: [{style: "parent", name: "8315361", color: "black"}]};
    y += 25;
    issues["8325064"] = {desc:"Refactor: construct_bb",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/17657",
                         x: x+20, y: y, color: rfe_done, radius: 5,
                         edges: [{style: "parent", name: "8315361", color: "black"}]};
    y += 25;
    issues["8325541"] = {desc:"Refactor: filter / split",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/17785",
                         x: x+20, y: y, color: rfe_done, radius: 5,
                         edges: [{style: "parent", name: "8315361", color: "black"}]};
    y += 25;
    issues["8325252"] = {desc:"Refactor: packset",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/18276",
                         x: x+20, y: y, color: rfe_done, radius: 5,
                         edges: [{style: "parent", name: "8315361", color: "black"}]};
    y += 25;
    issues["8325589"] = {desc:"Refactor: VLoopAnalyzer submodules",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/17800",
                         x: x+20, y: y, color: rfe_done, radius: 5,
                         edges: [{style: "parent", name: "8315361", color: "black"}]};
    y += 25;
    issues["8325651"] = {desc:"Refactor: dependency-graph",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/17812",
                         x: x+20, y: y, color: rfe_done, radius: 5,
                         edges: [{style: "parent", name: "8315361", color: "black"}]};
    y += 25;
    issues["8327978"] = {desc:"compile time regression (traversal)",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/18532",
                         x: x+40, y: y, color: bug_done, radius: 3,
                         edges: [{style: "parent", name: "8325651", color: "red"}]};
    y += 25;
    issues["8326139"] = {desc:"split packs to fit use/def packs, etc.",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/17848",
                         x: x, y: y, color: rfe_done, radius: 5,
                         edges: []};
    y += 25;
    issues["8326962"] = {desc:"Cache VPointer",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/18577",
                         x: x, y: y, color: rfe_done, radius: 3,
                         edges: []};


    issues["8332905"] = {desc:"bad AD with RotateRightV",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/19445",
                         x: x, y: y, color: bug_done, radius: 3,
                         edges: []};
    y += 25;
    issues["8330819"] = {desc:"bad dominance: CastLL after pre-loop",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/18892",
                         x: x, y: y, color: bug_done, radius: 3,
                         edges: []};
    y += 25;
    issues["8328938"] = {desc:"disable large stride/scale",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/18485",
                         x: x, y: y, color: bug_done, radius: 3,
                         edges: []};
    y += 25;


    issues["8332163"] = {desc:"VTransformGraph",
                         assigned:"Emanuel",
                         jdk: 24,
                         pr: "https://github.com/openjdk/jdk/pull/19719",
                         x: x, y: y, color: rfe_done, radius: 7,
                         edges: []};
    y += 25;
    issues["8333647"] = {desc:"More PopulateIndex tests",
                         assigned:"Emanuel",
                         jdk: 24,
                         pr: "https://github.com/openjdk/jdk/pull/19558",
                         x: x+20, y: y, color: rfe_done, radius: 3,
                         edges: [{style: "parent", name: "8332163", color: "black"}]};
    y += 25;
    issues["8333684"] = {desc:"Preparatory refactorings for JDK-8332163",
                         assigned:"Emanuel",
                         jdk: 24,
                         pr: "https://github.com/openjdk/jdk/pull/19573",
                         x: x+20, y: y, color: rfe_done, radius: 3,
                         edges: [{style: "parent", name: "8332163", color: "black"}]};
    y += 25;
    issues["8333713"] = {desc:"Cleanup in vectornode.cpp/hpp",
                         assigned:"Emanuel",
                         jdk: 24,
                         pr: "https://github.com/openjdk/jdk/pull/19575",
                         x: x+20, y: y, color: rfe_done, radius: 3,
                         edges: [{style: "parent", name: "8332163", color: "black"}]};


    y += 25;
    issues["8344085"] = {desc:"Performance small loops",
                         assigned:"Emanuel",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};
    y += 25;
    issues["8344118"] = {desc:"JMH VectorThroughputForIterationCount",
                         assigned:"Emanuel",
                         jdk: 24,
                         pr: "https://github.com/openjdk/jdk/pull/22070",
                         x: x+20, y: y, color: rfe_done, radius: 5,
                         edges: [{style: "parent", name: "8344085", color: "black"}]};
    y += 25;
    issues["8307084"] = {desc:"Use drain-loop more often",
                         assigned:"Fei Gao",
                         jdk: 0,
                         pr: "",
                         x: x+20, y: y, color: rfe_review, radius: 5,
                         edges: [{style: "parent", name: "8344085", color: "black"}]};
    y += 25;
    issues["8342692"] = {desc:"No loop-nest for small loops",
                         assigned:"Roland",
                         jdk: 0,
                         pr: "https://github.com/openjdk/jdk/pull/21630",
                         x: x+20, y: y, color: rfe_review, radius: 5,
                         edges: [{style: "parent", name: "8344085", color: "black"}]};

    y += 25;
    issues["8299808"] = {desc:"Investigate perf difference to ArrayFill",
                         assigned:"Emanuel",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};

    y += 25;
    issues["8329077"] = {desc:"Missing vectorization for MoveF2I etc",
                         assigned:"Galder",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};
    y += 25;
    issues["8332878"] = {desc:"missing vectorization with PopulateIndex L/F/D",
                         assigned:"Emanuel",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};
    y += 25;
    issues["8308994"] = {desc:"Post-loop vectorization (masked)",
                         assigned:"Fei Gao",
                         jdk: 0,
                         pr: "https://github.com/openjdk/jdk/pull/14581",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};
    y += 25;
    issues["8309908"] = {desc:"Improve packing strategy (lookahead?)",
                         assigned:"Emanuel",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};
    y += 25;
    issues["8303113"] = {desc:"Improve packing to remove _do_vector_loop",
                         assigned:"Emanuel",
                         jdk: 0,
                         pr: "",
                         x: x+20, y: y, color: rfe_open, radius: 5,
                         edges: [{style: "parent", name: "8309908", color: "black"}]};
    y += 25;
    issues["8342095"] = {desc:"Improve vectorization of subword casts",
                         assigned:"Jasmine",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};
    y += 25;
    // TODO comment

    issues["8328678"] = {desc:"Some hand-unrolled loops do not vectorize well",
                         assigned:"-",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};
    y += 25;
    issues["8305717"] = {desc:"Vectorize opposite direction mem access (shuffle)",
                         assigned:"-",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};
    y += 25;
    // TODO cost-model
    issues["8302662"] = {desc:"Extract element from last iteration",
                         assigned:"Jatin",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};
    y += 25;
    //TODO comment: after Cost-Model ?

    // -------------------------- Reductions
    x = 530;
    y = 10;
    tags.push({text: "Reductions",
               x: x-20, y: y, style: "color=black;font-weight:bold"});
    y += 25;
    issues["8302652"] = {desc:"Move unordered reduction out of loop",
                         assigned:"Emanuel",
                         jdk: 21,
                         pr: "https://github.com/openjdk/jdk/pull/13056",
                         x: x, y: y, color: rfe_done, radius: 5,
                         edges: []};
    y += 25;
    issues["8314612"] = {desc:"WR: unordered reductions",
                         assigned:"Emanuel",
                         jdk: 22,
                         pr: "https://github.com/openjdk/jdk/pull/15654",
                         x: x+20, y: y, color: bug_done, radius: 5,
                         edges: [{style: "parent", name: "8302652", color: "red"}]};
    y += 25;
    issues["8310130"] = {desc:"unordered reduction: bad assert",
                         assigned:"Emanuel",
                         jdk: 22,
                         pr: "https://github.com/openjdk/jdk/pull/14494",
                         x: x+20, y: y, color: bug_done, radius: 3,
                         edges: [{style: "parent", name: "8302652", color: "red"}]};
    y += 25;
    issues["8340272"] = {desc:"JMH benchmark for reductions",
                         assigned:"Emanuel",
                         jdk: 24,
                         pr: "https://github.com/openjdk/jdk/pull/21032",
                         x: x, y: y, color: rfe_done, radius: 5,
                         edges: []};
    // TODO comment
    y += 25;
    issues["8307513"] = {desc:"Intrinsify Math.min/max(long, long)",
                         assigned:"Galder",
                         jdk: 25,
                         pr: "https://github.com/openjdk/jdk/pull/20098",
                         x: x, y: y, color: rfe_review, radius: 5,
                         edges: []};
    y += 25;
    issues["8343597"] = {desc:"RelaxedMath for faster float reductions",
                         assigned:"Emanuel",
                         jdk: 0,
                         pr: "https://github.com/openjdk/jdk/pull/21895",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};
    y += 700;
    issues["8307516"] = {desc:"Rework reduction heuristic (cost-model)",
                         assigned:"Emanuel",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: priority, radius: 5,
                         edges: [{style: "after", name: "8340093", color: "orange"}]};
    y += 25;
    issues["8345044"] = {desc:"Report: simple sum does not vectorize",
                         assigned:"Galder",
                         jdk: 0,
                         pr: "",
                         x: x+20, y: y, color: rfe_open, radius: 3,
                         edges: [{style: "parent", name: "8307516", color: "black"}]};
    y += 25;
    issues["8188313"] = {desc:"Enable reduction vectorization disabled by 8078563",
                         assigned:"Ivanov",
                         jdk: 0,
                         pr: "",
                         x: x+20, y: y, color: rfe_open, radius: 3,
                         edges: [{style: "parent", name: "8307516", color: "black"}]};
    y += 25;
    issues["8336000"] = {desc:"Report: 2-element reductions do not vectorize",
                         assigned:"Hegarty",
                         jdk: 0,
                         pr: "",
                         x: x+20, y: y, color: rfe_open, radius: 3,
                         edges: [{style: "parent", name: "8307516", color: "black"}]};
    y += 25;
    issues["8305707"] = {desc:"Vectorize reverse-order reductions",
                         assigned:"Emanuel",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};
    y += 25;
    issues["8345245"] = {desc:"Reassociate reductions",
                         assigned:"Emanuel",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};
    y += 25;
    issues["8345107"] = {desc:"Vectorize polynomial reductions (hash)",
                         assigned:"Emanuel",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};
    y += 25;
    issues["8345549"] = {desc:"Vectorize prefix-sum",
                         assigned:"Emanuel",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};
    y += 25;



    // -------------------------- CMove
    x = 1030;
    y = 10;
    tags.push({text: "CMove",
               x: x-20, y: y, style: "color=black;font-weight:bold"});
    y += 25;
    issues["8306302"] = {desc:"assert with CMove: fix and refactor",
                         assigned:"Emanuel",
                         jdk: 21,
                         pr: "https://github.com/openjdk/jdk/pull/13493",
                         x: x, y: y, color: bug_done, radius: 5,
                         edges: []};
    y += 25;
    issues["8309268"] = {desc:"assert after JDK-8306302",
                         assigned:"Emanuel",
                         jdk: 21,
                         pr: "https://github.com/openjdk/jdk/pull/14268",
                         x: x+20, y: y, color: bug_done, radius: 3,
                         edges: [{style: "parent", name: "8306302", color: "red"}]};
    y += 25;
    issues["8313720"] = {desc:"WR: CMove",
                         assigned:"Emanuel",
                         jdk: 22,
                         pr: "https://github.com/openjdk/jdk/pull/15274",
                         x: x+20, y: y, color: bug_done, radius: 3,
                         edges: [{style: "parent", name: "8306302", color: "red"}]};
    y += 25;
    issues["8308841"] = {desc:"Vectorize integer CMove",
                         assigned:"Emanuel",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};

    y += 750;
    issues["8347116"] = {desc:"If-Conversion",
                         assigned:"Emanuel",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: priority, radius: 5,
                         edges: [{style: "after", name: "8340093", color: "orange"}]};



    // -------------------------- Alignment / AlignVector
    x = 1530;
    y = 10;
    tags.push({text: "Alignment",
               x: x-20, y: y, style: "color=black;font-weight:bold"});
    y += 25;
    issues["8308606"] = {desc:"Remove some alignment checks",
                         assigned:"Emanuel",
                         jdk: 22,
                         pr: "https://github.com/openjdk/jdk/pull/14096",
                         x: x, y: y, color: rfe_done, radius: 5,
                         edges: []};
    y += 25;
    issues["8310190"] = {desc:"AlignVector broken",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/14785",
                         x: x, y: y, color: bug_done, radius: 7,
                         edges: []};
    y += 25;
    issues["8323577"] = {desc:"Add IR rules back from JDK-8305055",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/17369",
                         x: x+20, y: y, color: rfe_done, radius: 3,
                         edges: [{style: "parent", name: "8310190", color: "blue"}]};
    y += 25;
    issues["8323641"] = {desc:"TestAlignVectorFuzzer.java timed out",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/17389",
                         x: x+20, y: y, color: bug_done, radius: 3,
                         edges: [{style: "parent", name: "8310190", color: "red"}]};
    y += 25;

    issues["8325155"] = {desc:"Remove alignment-boundaries",
                         assigned:"Emanuel",
                         jdk: 24,
                         pr: "https://github.com/openjdk/jdk/pull/18822",
                         x: x, y: y, color: rfe_done, radius: 5,
                         edges: []};
    y += 25;
    issues["8331764"] = {desc:"Refactor _align_to_ref",
                         assigned:"Emanuel",
                         jdk: 24,
                         pr: "https://github.com/openjdk/jdk/pull/19115",
                         x: x+20, y: y, color: rfe_done, radius: 3,
                         edges: [{style: "parent", name: "8325155", color: "blue"}]};
    y += 25;
    issues["8333876"] = {desc:"assert replaced with check",
                         assigned:"Emanuel",
                         jdk: 24,
                         pr: "https://github.com/openjdk/jdk/pull/19736",
                         x: x+20, y: y, color: bug_done, radius: 3,
                         edges: [{style: "parent", name: "8325155", color: "red"}]};
    y += 25;
    issues["8334228"] = {desc:"assert: fix sorting",
                         assigned:"Emanuel",
                         jdk: 24,
                         pr: "https://github.com/openjdk/jdk/pull/19696",
                         x: x+20, y: y, color: bug_done, radius: 5,
                         edges: [{style: "parent", name: "8325155", color: "red"}]};
    y += 25;
    issues["8334431"] = {desc:"perf-regr: store-to-load-fwd failure",
                         assigned:"Emanuel",
                         jdk: 24,
                         pr: "https://github.com/openjdk/jdk/pull/21521",
                         x: x+20, y: y, color: bug_done, radius: 5,
                         edges: [{style: "parent", name: "8325155", color: "red"}]};
    y += 25;
    issues["8335006"] = {desc:"JMH VectorStoreToLoadForwarding.java",
                         assigned:"Emanuel",
                         jdk: 24,
                         pr: "https://github.com/openjdk/jdk/pull/",
                         x: x+40, y: y, color: rfe_done, radius: 5,
                         edges: [{style: "parent", name: "8334431", color: "blue"}]};
    y += 25;
    issues["8334083"] = {desc:"test bug with AlignVector",
                         assigned:"Emanuel",
                         jdk: 24,
                         pr: "https://github.com/openjdk/jdk/pull/19801",
                         x: x+20, y: y, color: bug_done, radius: 3,
                         edges: [{style: "parent", name: "8325155", color: "red"}]};
    y += 25;
    issues["8335628"] = {desc:"Cleanup longer_type_for_conversion",
                         assigned:"Emanuel",
                         jdk: 24,
                         pr: "https://github.com/openjdk/jdk/pull/20009",
                         x: x+20, y: y, color: rfe_done, radius: 3,
                         edges: [{style: "parent", name: "8325155", color: "blue"}]};
    y += 25;

    issues["8344424"] = {desc:"Some loop do not vectorize after Lilliput",
                         assigned:"-",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: bug_open, radius: 3,
                         edges: []};

    y += 100;
    issues["8323582"] = {desc:"AlignVector misaligned native memory",
                         assigned:"Emanuel",
                         jdk: 0,
                         pr: "https://github.com/openjdk/jdk/pull/22016",
                         x: x, y: y, color: bug_open, radius: 5,
                         edges: [{style: "after", name: "8343685", color: "orange"}]};
    tags.push({text: "Multi-version: runtime check for alignment. Infrastructure can then be used for Aliasing Analysis runtime check.",
               x: x, y: y+25, style: "color=black"});
    y += 25;

    // -------------------------- MemorySegment
    x = 2030;
    y = 10;
    tags.push({text: "MemorySegment: Unsafe, native, VPointer",
               x: x-20, y: y, style: "color=black;font-weight:bold"});
    y += 25;
    issues["8286197"] = {desc:"Optimize MemorySegment in int loop",
                         assigned:"Roland",
                         jdk: 20,
                         pr: "https://github.com/openjdk/jdk/pull/8555",
                         x: x, y: y, color: rfe_done, radius: 5,
                         edges: []};
    y += 25;
    issues["8300257"] = {desc:"Improve SWPointer: multiple invar",
                         assigned:"Roland",
                         jdk: 21,
                         pr: "https://github.com/openjdk/jdk/pull/12942",
                         x: x, y: y, color: rfe_done, radius: 5,
                         edges: []};
    y += 25;
    issues["8329273"] = {desc:"Some basic MemorySegment IR tests",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/18535",
                         x: x, y: y, color: rfe_done, radius: 5,
                         edges: []};

    y += 25;
    issues["8331659"] = {desc:"missing optimizations in TestMemorySegment.java",
                         assigned:"Emanuel",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};
    y += 25;
    issues["8327209"] = {desc:"missing RCE for checkIndexL with int index etc.",
                         assigned:"Emanuel",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};


    y += 200;
    issues["8343685"] = {desc:"Refactor VPointer with MemPointer",
                         assigned:"Emanuel",
                         jdk: 25,
                         pr: "https://github.com/openjdk/jdk/pull/21926",
                         x: x, y: y, color: priority, radius: 7,
                         edges: []};
    // TODO comment

    y += 25;
    issues["8331576"] = {desc:"Pointer parsing issue with CastX2P",
                         assigned:"Emanuel",
                         jdk: 0,
                         pr: "",
                         x: x+20, y: y, color: rfe_open, radius: 5,
                         edges: [{style: "parent", name: "8343685", color: "blue"}]};
    y += 25;

    // -------------------------- Testing / Benchmarking
    x = 2530;
    y = 10;
    tags.push({text: "Testing: Tests and Testing Frameworks",
               x: x-20, y: y, style: "color=black;font-weight:bold"});
    y += 25;
    issues["8310308"] = {desc:"IR Framework: check vector size/type",
                         assigned:"Emanuel",
                         jdk: 22,
                         pr: "https://github.com/openjdk/jdk/pull/14539",
                         x: x, y: y, color: rfe_done, radius: 7,
                         edges: []};
    y += 25;
    issues["8324641"] = {desc:"IR Framework: @Setup",
                         assigned:"Emanuel",
                         jdk: 23,
                         pr: "https://github.com/openjdk/jdk/pull/17557",
                         x: x, y: y, color: rfe_done, radius: 5,
                         edges: []};
    y += 25;
    issues["8337221"] = {desc:"CompileFramework test library",
                         assigned:"Emanuel",
                         jdk: 24,
                         pr: "https://github.com/openjdk/jdk/pull/20184",
                         x: x, y: y, color: rfe_done, radius: 5,
                         edges: []};
    y += 25;
    issues["8342387"] = {desc:"Refactor TestDependencyOffsets.java (CompF)",
                         assigned:"Emanuel",
                         jdk: 24,
                         pr: "https://github.com/openjdk/jdk/pull/21541",
                         x: x+20, y: y, color: rfe_done, radius: 5,
                         edges: [{style: "parent", name: "8337221", color: "blue"}]};
    y += 25;
    issues["8340010"] = {desc:"Fix tests after Lilliput",
                         assigned:"Emanuel",
                         jdk: 24,
                         pr: "https://github.com/openjdk/jdk/pull/22199",
                         x: x, y: y, color: bug_done, radius: 3,
                         edges: []};
    y += 25;
    issues["8346106"] = {desc:"Verify.checkEQ for result verification",
                         assigned:"Emanuel",
                         jdk: 25,
                         pr: "https://github.com/openjdk/jdk/pull/22715",
                         x: x, y: y, color: rfe_done, radius: 5,
                         edges: []};
    y += 25;
    issues["8346107"] = {desc:"Generators: random distributions for testing",
                         assigned:"Theo",
                         jdk: 0,
                         pr: "https://github.com/openjdk/jdk/pull/22941",
                         x: x, y: y, color: priority, radius: 5,
                         edges: []};
    y += 25;
    issues["8344942"] = {desc:"Template-Based Testing Framework",
                         assigned:"Emanuel",
                         jdk: 0,
                         pr: "https://github.com/openjdk/jdk/pull/22483",
                         x: x, y: y, color: priority, radius: 7,
                         edges: []};
    y += 25;
    // TODO comment?


    issues["8310523"] = {desc:"IR tests for RotateRight/LeftV",
                         assigned:"E/Monty",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 3,
                         edges: []};
    y += 25;
    issues["8310891"] = {desc:"Move some @requires to IR applyIf",
                         assigned:"-",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};
    y += 25;
    issues["8320224"] = {desc:"Add MaxVectorSize to JTREG_WHITELIST_FLAGS",
                         assigned:"-",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};
    y += 25;
    issues["8309183"] = {desc:"Add UseKNLSetting to JTREG_WHITELIST_FLAGS",
                         assigned:"-",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};
    y += 25;
    issues["8310533"] = {desc:"IR Framework: automatic value verification",
                         assigned:"-",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: rfe_open, radius: 5,
                         edges: []};
    y += 25;


    // --------------------------- TODO
    x = 1750;
    y = 600;
    issues["8324751"] = {desc:"AliasingAnalysis runtime check",
                         assigned:"Emanuel",
                         jdk: 0,
                         pr: "",
                         x: x, y: y, color: priority, radius: 7,
                         edges: [{style: "after", name: "8323582", color: "orange"}]};
    tags.push({text: "Especially important for MemorySegment, where we never statically know if they alias.",
               x: x, y: y+25, style: "color=black"});

    x = 2250;
    y = 650;
    issues["8340093"] = {desc:"Implement Cost-Model",
                         assigned:"Emanuel",
                         jdk: 0,
                         pr: "https://github.com/openjdk/jdk/pull/20964",
                         x: x, y: y, color: priority, radius: 7,
                         edges: [{style: "after", name: "8343685", color: "orange"}]};
    tags.push({text: "Cost-Model enables: reductions, shuffle, extract, if-conversion, ... all introduce additional nodes that have additional cost.",
               x: x, y: y+50, style: "color=black"});
    y += 25;

    issues["8346993"] = {desc:"Refactor VectorNode::make",
                         assigned:"Emanuel",
                         jdk: 25,
                         pr: "https://github.com/openjdk/jdk/pull/22917",
                         x: x+20, y: y, color: rfe_done, radius: 3,
                         edges: [{style: "parent", name: "8340093", color: "blue"}]};
    y += 25;

    for (const [name, issue] of Object.entries(issues)) {
      issue.name = name;
      div = addIssue(issue)
      issue.div = div;
    }

    for (var tag of tags) {
      tag.div = addTag(tag);
    }

    updateCanvas()
  }

  init()
</script>
