maxX = 100;
maxY = 100;

issues = {}

function updateMax(x,y) {
  maxX = Math.max(maxX,x);
  maxY = Math.max(maxY,y);
}

function updateCanvas(overFocusId) {
  var universe = document.getElementById("universe")
  var canv = document.getElementById("mainCanvas")
  canv.width = maxX + 405;
  canv.height = maxY + 25;

  var ctx = canv.getContext("2d");
  ctx.clearRect(0, 0, canv.width, canv.height);
  ctx.rect(0, 0, canv.width, canv.height);
  ctx.fillStyle = "#eeeeee";
  ctx.fill();

  console.log("update");
  for (issue of issues) {
    var div = issue.div;
    
    if (overFocusId==div.id) {
      div.style.border = "solid #000000";
      console.log("over " + div.id);
    } else {
      div.style.border = "";
    }
  }
}

function addIssue(issue) {
  var universe = document.getElementById("universe")
  var div = document.createElement("myelement");
  div.style.background = "#ffffff";
  div.style.color = "black";
  div.innerHTML = "<a href='https://bugs.openjdk.org/browse/" + issue.name
                  + "' style='font-size:14px' target='_blank'>"
                  + issue.name + ": " + issue.desc + "</a>";
  if (issue.pr != "") {
    div.innerHTML += " <a href='" + issue.pr
                     + "' style='font-size:14px' target='_blank'>[PR]</a>";
  }

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

function init() {
  var universe =  document.createElement('universe');
  universe.id = "universe"
  graph_div = document.getElementById("issue_graph")
  graph_div.appendChild(universe);

  var canv = document.createElement('canvas');
  canv.id = 'mainCanvas';
  universe.appendChild(canv);

  issues = [
    {name: "JDK-8346993",
     desc:"Refactor VectorNode::make",
     pr: "https://github.com/openjdk/jdk/pull/22917",
     x: 10, y: 10, type: "review"},
    {name: "JDK-8343685",
     desc:"Revactor VPointer with MemPointer",
     pr: "https://github.com/openjdk/jdk/pull/21926",
     x: 910, y: 950, type: "open"},
    //{name: "JDK-",
    // desc:"",
    // pr: "https://github.com/openjdk/jdk/pull/",
    // jira: "https://bugs.openjdk.org/browse/JDK-",
    // x: 10, y: 20, type: "open"},
  ];

  for (issue of issues) {
    div = addIssue(issue)
    issue.div = div;
  }

  updateCanvas()
}

init()
